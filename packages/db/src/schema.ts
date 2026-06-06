import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  numeric,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Publication lifecycle.
 * Transitions are recorded in `state_transitions` — enforced by app + DB triggers,
 * not just by writing the new value to `publications.status`.
 */
export const publicationStatus = pgEnum('publication_status', [
  'draft',           // creator is composing
  'in_review',       // submitted, sitting in admin queue
  'revisions',       // admin returned with notes
  'published',       // live in marketplace
  'unpublished',     // taken down (by creator or admin)
  'archived',        // soft-deleted, retained for history
]);

/** Order lifecycle. Funds are held until `fulfilled` (or refunded on cancel). */
export const orderStatus = pgEnum('order_status', [
  'pending',         // created, awaiting payment confirmation
  'paid',            // payment succeeded, funds held by Baxter
  'in_fulfillment',  // creator notified, preparing shipment / delivery
  'fulfilled',       // shipped or digital delivery sent; payout released
  'cancelled',       // pre-fulfillment cancellation
  'refunded',        // post-fulfillment refund
]);

/** Format of a publication. */
export const publicationFormat = pgEnum('publication_format', [
  'print',           // physical, ships from creator or POD
  'digital',         // PDF or digital reader
  'print_digital',   // bundled
]);

/**
 * Preflight lifecycle for an uploaded artifact.
 * `pending` until the worker runs; `passed` (file may proceed, possibly with
 * non-blocking warnings) or `failed` (blocking issues, file cannot proceed).
 * Written server-side only (Inngest worker, service role) — never by clients.
 */
export const preflightStatus = pgEnum('preflight_status', [
  'pending',
  'passed',
  'failed',
]);

/** Account role. */
export const userRole = pgEnum('user_role', [
  'reader',          // can purchase, review, follow
  'creator',         // reader + can create and submit publications
  'admin',           // reader + creator + admin queue access
]);

/* -------------------------------------------------------------------------- */
/* Users — mirrors auth.users; profile fields live here                       */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey(),                       // matches Supabase auth.users.id
    email: text('email').notNull().unique(),
    handle: text('handle').notNull(),                   // unique slug for /@handle
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    avatarKey: text('avatar_key'),                      // R2 object key
    role: userRole('role').notNull().default('reader'),
    stripeAccountId: text('stripe_account_id'),         // Stripe Connect Express account
    stripeChargesEnabled: boolean('stripe_charges_enabled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    handleIdx: uniqueIndex('users_handle_idx').on(t.handle),
    roleIdx: index('users_role_idx').on(t.role),
  })
);

/* -------------------------------------------------------------------------- */
/* Publications                                                                */
/* -------------------------------------------------------------------------- */

export const publications = pgTable(
  'publications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    creatorId: uuid('creator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    slug: text('slug').notNull(),                        // /@handle/<slug>
    title: text('title').notNull(),
    subtitle: text('subtitle'),
    description: text('description'),
    format: publicationFormat('format').notNull(),
    formatPresetId: text('format_preset_id'),            // @baxter/domain preset id, e.g. 'zine_a5'
    category: text('category').notNull(),                // editorial taxonomy (free-form for now)
    status: publicationStatus('status').notNull().default('draft'),
    /** Price in minor units (cents). Currency held in publications.currency. */
    priceMinor: integer('price_minor'),
    currency: text('currency').notNull().default('CAD'),
    editionSize: integer('edition_size'),                // null = open edition
    pageCount: integer('page_count'),
    trimWidthMm: numeric('trim_width_mm', { precision: 6, scale: 2 }),
    trimHeightMm: numeric('trim_height_mm', { precision: 6, scale: 2 }),
    coverAssetId: uuid('cover_asset_id'),                // FK declared below to avoid cycle
    publishedAt: timestamp('published_at', { withTimezone: true }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugByCreator: uniqueIndex('publications_creator_slug_idx').on(t.creatorId, t.slug),
    statusIdx: index('publications_status_idx').on(t.status),
    publishedAtIdx: index('publications_published_at_idx').on(t.publishedAt),
  })
);

/* -------------------------------------------------------------------------- */
/* Artifacts — the print-ready file lineage                                   */
/* -------------------------------------------------------------------------- */

/**
 * An artifact is a single uploaded file (PDF, source, etc.) associated with a
 * publication. Multiple versions are retained so reviews and revisions can
 * reference specific uploads.
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicationId: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    /** R2 object key in the *clean* bucket. Files quarantine elsewhere until cleared. */
    r2Key: text('r2_key').notNull(),
    bucket: text('bucket').notNull().default('clean'),
    sizeBytes: integer('size_bytes').notNull(),
    contentType: text('content_type').notNull(),
    /** Output of preflight: pageCount, dimensions, fontEmbedding, bleed, dpi, warnings. */
    preflight: jsonb('preflight'),
    /** Lifecycle status of the preflight check. Server-written only. */
    preflightStatus: preflightStatus('preflight_status').notNull().default('pending'),
    /** Whether this artifact is the canonical submission for the publication. */
    isCanonical: boolean('is_canonical').notNull().default(false),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pubIdx: index('artifacts_pub_idx').on(t.publicationId),
    canonicalIdx: index('artifacts_canonical_idx').on(t.publicationId, t.isCanonical),
  })
);

/* -------------------------------------------------------------------------- */
/* Assets — derived imagery (covers, previews, thumbnails)                    */
/* -------------------------------------------------------------------------- */

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  publicationId: uuid('publication_id').references(() => publications.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  /** Cloudflare Images ID or R2 key, depending on `provider`. */
  provider: text('provider').notNull(),                // 'cloudflare_images' | 'r2'
  externalId: text('external_id').notNull(),
  /** 'cover' | 'preview_page' | 'avatar' | 'thumbnail' */
  kind: text('kind').notNull(),
  meta: jsonb('meta'),                                  // { page, w, h, alt, ... }
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Orders                                                                      */
/* -------------------------------------------------------------------------- */

export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerId: uuid('buyer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    publicationId: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'restrict' }),
    creatorId: uuid('creator_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    status: orderStatus('status').notNull().default('pending'),
    /** Captured at order time; immutable. */
    unitPriceMinor: integer('unit_price_minor').notNull(),
    quantity: integer('quantity').notNull().default(1),
    subtotalMinor: integer('subtotal_minor').notNull(),
    shippingMinor: integer('shipping_minor').notNull().default(0),
    taxMinor: integer('tax_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    platformFeeMinor: integer('platform_fee_minor').notNull(),
    currency: text('currency').notNull().default('CAD'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),
    stripeTransferId: text('stripe_transfer_id'),
    shippingAddress: jsonb('shipping_address'),
    fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    buyerIdx: index('orders_buyer_idx').on(t.buyerId),
    creatorIdx: index('orders_creator_idx').on(t.creatorId),
    statusIdx: index('orders_status_idx').on(t.status),
  })
);

/* -------------------------------------------------------------------------- */
/* State transition logs — the audit spine                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every publication state change. Insert-only.
 * App enforces legal transitions via state machine; DB stores the truth.
 */
export const publicationEvents = pgTable(
  'publication_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    publicationId: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    fromStatus: publicationStatus('from_status'),
    toStatus: publicationStatus('to_status').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Free-form context: { note, artifactId, reason, ... } */
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pubIdx: index('publication_events_pub_idx').on(t.publicationId),
  })
);

/** Every order state change. Insert-only. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatus('from_status'),
    toStatus: orderStatus('to_status').notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('order_events_order_idx').on(t.orderId),
  })
);

/* -------------------------------------------------------------------------- */
/* Reviews (deferred from MVP scope, but the table exists for shape)          */
/* -------------------------------------------------------------------------- */

export const reviews = pgTable(
  'reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
    publicationId: uuid('publication_id').notNull().references(() => publications.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    stars: integer('stars').notNull(),                  // 1–5
    body: text('body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    onePerOrder: uniqueIndex('reviews_one_per_order_idx').on(t.orderId),
    pubIdx: index('reviews_pub_idx').on(t.publicationId),
    starsCheck: sql`CHECK (stars BETWEEN 1 AND 5)`,
  })
);

/* -------------------------------------------------------------------------- */
/* Follows                                                                     */
/* -------------------------------------------------------------------------- */

export const follows = pgTable(
  'follows',
  {
    followerId: uuid('follower_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    creatorId: uuid('creator_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('follows_pk').on(t.followerId, t.creatorId),
  })
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                   */
/* -------------------------------------------------------------------------- */

export const usersRelations = relations(users, ({ many }) => ({
  publications: many(publications),
  ordersAsBuyer: many(orders, { relationName: 'buyer' }),
  ordersAsCreator: many(orders, { relationName: 'creator' }),
}));

export const publicationsRelations = relations(publications, ({ one, many }) => ({
  creator: one(users, { fields: [publications.creatorId], references: [users.id] }),
  artifacts: many(artifacts),
  assets: many(assets),
  events: many(publicationEvents),
  orders: many(orders),
  reviews: many(reviews),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, { fields: [orders.buyerId], references: [users.id], relationName: 'buyer' }),
  creator: one(users, { fields: [orders.creatorId], references: [users.id], relationName: 'creator' }),
  publication: one(publications, { fields: [orders.publicationId], references: [publications.id] }),
  events: many(orderEvents),
}));
