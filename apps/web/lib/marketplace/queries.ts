/**
 * Marketplace data layer (Slice 7).
 *
 * The public read layer for `published` works. All reads go through the caller's
 * server client (anon, RLS-respecting): `publications` are publicly readable
 * when `status = 'published'`, `assets` when their publication is published, and
 * `users` are world-readable — so no service-role client is needed here.
 *
 * D-025 — the homepage is a *composition*, not a feed. `composeHome()` returns
 * an ordered list of typed sections; the page renders whatever it's given. New
 * section kinds (seasonal, essays, featured creators, collections) slot in here
 * as new `HomeSection`s and new renderers, without the page assuming chronology.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { imageDeliveryUrl } from '@/lib/cloudflare/images';
import { estimateProduction } from '@baxter/domain';
import { productionMarginBps } from '@/lib/production/config';

/**
 * D-032 — the catalogue could not be read (database unreachable, paused,
 * timing out, or the query itself rejected). Thrown instead of returning an
 * empty list, so "Baxter has no published work" and "Baxter could not look"
 * never render the same. Pages catch it with `readCatalogue()` and show a
 * calm, brief notice; the failure itself is in the server log.
 */
export class CatalogueUnavailableError extends Error {
  constructor(readonly query: string) {
    super(`catalogue unavailable: ${query}`);
    this.name = 'CatalogueUnavailableError';
  }
}

interface QueryError {
  code?: string;
  message?: string;
}

/**
 * Log a failed catalogue read. Only the query name and PostgREST's code and
 * message go to the log — never connection details, keys, or request headers
 * (PostgREST errors carry none of those).
 */
function logCatalogueFailure(query: string, error: QueryError, fatal: boolean) {
  console.error('catalogue: query failed', {
    query,
    fatal,
    code: error.code ?? null,
    error: error.message ?? String(error),
  });
}

/** The rows of a catalogue read, or CatalogueUnavailableError — never a silent []. */
function rowsOrThrow<T>(
  query: string,
  res: { data: unknown; error: QueryError | null }
): T[] {
  if (res.error) {
    logCatalogueFailure(query, res.error, true);
    throw new CatalogueUnavailableError(query);
  }
  return (res.data as T[] | null) ?? [];
}

/**
 * Run a catalogue read for a page. Healthy → `{ ok: true, value }` (an empty
 * catalogue is a healthy, legitimate result). Unavailable → `{ ok: false }`
 * so the page can say so plainly. Any other error is not ours to hide and
 * propagates unchanged.
 */
export async function readCatalogue<T>(
  read: Promise<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  try {
    return { ok: true, value: await read };
  } catch (e) {
    if (e instanceof CatalogueUnavailableError) return { ok: false };
    throw e;
  }
}

/**
 * A card's price is the retail a buyer pays — built from production (D-029),
 * not the creator's stored earnings figure. Null when the work can't yet be
 * priced (no page count or undeclared interior), in which case the card simply
 * omits the price (D-023: price is the quietest metadata).
 */
function retailMinor(r: PubRow): number | null {
  if (
    !r.format_preset_id ||
    !r.page_count ||
    (r.interior !== 'mono' && r.interior !== 'colour') ||
    r.price_minor === null ||
    r.price_minor === undefined
  ) {
    return null;
  }
  return estimateProduction({
    formatPresetId: r.format_preset_id,
    pageCount: r.page_count,
    interior: r.interior,
    creatorEarningsMinor: r.price_minor,
    marginBps: productionMarginBps(),
  }).retailMinor;
}

/** The four things a card shows, in hierarchy order (D-023). */
export interface PublicationCard {
  id: string;
  title: string;
  slug: string;
  handle: string;
  creatorName: string;
  /** /[handle]/[slug] — a work lives at its creator's address (D-022). */
  href: string;
  coverUrl: string | null;
  priceMinor: number | null;
  currency: string;
}

export type HomeSectionKind = 'editors_picks' | 'new_releases';

/** One composed block of the homepage (D-025). Editorial, not chronological. */
export interface HomeSection {
  kind: HomeSectionKind;
  /** Institutional for New Releases; the Editor's voice for Picks (D-024). */
  title: string;
  /** Optional "see more" target, e.g. All publications. */
  href?: string;
  cards: PublicationCard[];
}

// Columns every card needs. Kept in one place so all listing queries agree.
const CARD_COLUMNS =
  'id, title, slug, creator_id, cover_asset_id, format_preset_id, interior, page_count, price_minor, currency, published_at, editor_pick_at';

interface PubRow {
  id: string;
  title: string;
  slug: string;
  creator_id: string;
  cover_asset_id: string | null;
  format_preset_id: string | null;
  interior: string | null;
  page_count: number | null;
  price_minor: number | null;
  currency: string | null;
}

/**
 * Resolve raw published rows into cards — bulk-fetching creators and cover
 * images so a shelf costs three queries, not three-per-row.
 */
async function toCards(
  db: SupabaseClient,
  rows: PubRow[]
): Promise<PublicationCard[]> {
  if (rows.length === 0) return [];

  const creatorIds = [...new Set(rows.map((r) => r.creator_id))];
  const coverIds = rows
    .map((r) => r.cover_asset_id)
    .filter((v): v is string => !!v);

  // Creators are required: without them every card is skipped below, which
  // would turn a failed read into an empty shelf. So a failure here is fatal.
  const creatorById = new Map<string, { handle: string; name: string }>();
  {
    const users = rowsOrThrow<{ id: string; handle: string; display_name: string }>(
      'creators',
      await db.from('users').select('id, handle, display_name').in('id', creatorIds)
    );
    for (const u of users)
      creatorById.set(u.id, { handle: u.handle, name: u.display_name });
  }

  const coverExternalById = new Map<string, string>();
  const hashReady = Boolean(process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH);
  if (coverIds.length && hashReady) {
    // Covers are not required: a card without one still renders and links.
    // A failure degrades to cover-less cards, but is logged, not hidden.
    const { data, error } = await db
      .from('assets')
      .select('id, external_id')
      .in('id', coverIds);
    if (error) logCatalogueFailure('covers', error, false);
    for (const a of data ?? [])
      if (a.external_id) coverExternalById.set(a.id, a.external_id);
  }

  const cards: PublicationCard[] = [];
  for (const r of rows) {
    const creator = creatorById.get(r.creator_id);
    // A card without a resolvable creator handle can't be linked; skip it
    // rather than render a dead address.
    if (!creator?.handle) continue;
    const coverExternal = r.cover_asset_id
      ? coverExternalById.get(r.cover_asset_id)
      : undefined;
    cards.push({
      id: r.id,
      title: r.title,
      slug: r.slug,
      handle: creator.handle,
      creatorName: creator.name,
      href: `/${encodeURIComponent(creator.handle)}/${encodeURIComponent(r.slug)}`,
      coverUrl: coverExternal ? imageDeliveryUrl(coverExternal, 'grid') : null,
      priceMinor: retailMinor(r),
      currency: r.currency ?? 'CAD',
    });
  }
  return cards;
}

/** Editor's Picks — selected works, most-recently-picked first (D-023 timeline). */
export async function getEditorsPicks(
  db: SupabaseClient,
  limit = 6
): Promise<PublicationCard[]> {
  const res = await db
    .from('publications')
    .select(CARD_COLUMNS)
    .eq('status', 'published')
    .not('editor_pick_at', 'is', null)
    .order('editor_pick_at', { ascending: false })
    .limit(limit);
  return toCards(db, rowsOrThrow<PubRow>('editors_picks', res));
}

/** New Releases — published, newest first. Honest recency, not "popular". */
export async function getNewReleases(
  db: SupabaseClient,
  limit = 12
): Promise<PublicationCard[]> {
  const res = await db
    .from('publications')
    .select(CARD_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false })
    .limit(limit);
  return toCards(db, rowsOrThrow<PubRow>('new_releases', res));
}

/** All published works (browse), optionally within one category. */
export async function getAllPublished(
  db: SupabaseClient,
  opts: { category?: string } = {}
): Promise<PublicationCard[]> {
  let q = db
    .from('publications')
    .select(CARD_COLUMNS)
    .eq('status', 'published')
    .order('published_at', { ascending: false });
  if (opts.category) q = q.eq('category', opts.category);
  return toCards(db, rowsOrThrow<PubRow>('all_published', await q));
}

/** Published works by one creator (their profile shelf), newest first. */
export async function getCreatorPublished(
  db: SupabaseClient,
  creatorId: string
): Promise<PublicationCard[]> {
  const res = await db
    .from('publications')
    .select(CARD_COLUMNS)
    .eq('status', 'published')
    .eq('creator_id', creatorId)
    .order('published_at', { ascending: false });
  return toCards(db, rowsOrThrow<PubRow>('creator_published', res));
}

/**
 * Compose the homepage (D-025). Returns an ordered list of sections; empty
 * sections are omitted so the page never renders a heading over nothing.
 *
 * This is the seam: adding a "Seasonal selection" or "Featured creator" section
 * later means adding an entry here and a renderer — the page itself stays a
 * generic map over `HomeSection[]` and never assumes a single chronological list.
 */
export async function composeHome(db: SupabaseClient): Promise<HomeSection[]> {
  const [picks, newReleases] = await Promise.all([
    getEditorsPicks(db, 6),
    getNewReleases(db, 12),
  ]);

  const sections: HomeSection[] = [];
  if (picks.length > 0) {
    sections.push({ kind: 'editors_picks', title: "Editor's Picks", cards: picks });
  }
  if (newReleases.length > 0) {
    sections.push({
      kind: 'new_releases',
      title: 'New Releases',
      href: '/publications',
      cards: newReleases,
    });
  }
  return sections;
}
