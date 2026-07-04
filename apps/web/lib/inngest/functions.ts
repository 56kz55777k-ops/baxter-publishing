import { inngest } from './client';
import { createAdminClient } from '@/lib/supabase/admin';
import { QUARANTINE_BUCKET, CLEAN_BUCKET } from '@/lib/r2/client';
import { getObjectBytes, copyObject, deleteObject } from '@/lib/r2/objects';
import { inspectPdf } from '@/lib/pdf/inspect';
import { renderPreviewPages } from '@/lib/pdf/render';
import { uploadImage, deleteImage } from '@/lib/cloudflare/images';
import { sendAdminEmail, sendEmail } from '@/lib/email/resend';
import { presignedGetUrl } from '@/lib/r2/presigned';
import { loadOrderDetail } from '@/lib/orders/detail';
import {
  evaluatePreflight,
  getFormatPreset,
  type PreflightIssue,
} from '@baxter/domain';

/**
 * Preflight worker.
 *
 * Triggered by `publication/artifact.uploaded` after a file is registered.
 * Downloads the file from quarantine, runs the checks, writes the verdict to
 * the artifact, and — on pass — promotes the object to the clean bucket. Then
 * enforces the retention policy (D-014).
 *
 * All database writes use the service-role client: there is no signed-in user
 * in a worker, and the preflight status must be server-controlled so a creator
 * can never mark their own file `passed`.
 */

type ArtifactUploadedEvent = {
  data: { artifactId: string; publicationId: string; key: string };
};

/** The jsonb written to artifacts.preflight. */
interface PreflightRecord {
  checkedAt: string;
  pageCount: number;
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  facts: {
    hasBleed: boolean | null;
    fontsEmbedded: boolean | null;
    minImageDpi: number | null;
  };
  /** Set when the creator acknowledges the warnings (D-012). */
  warningsAcknowledgedAt: string | null;
}

const preflight = inngest.createFunction(
  { id: 'publication-preflight', retries: 3 },
  { event: 'publication/artifact.uploaded' },
  async ({ event, step }) => {
    const { artifactId, publicationId, key } = (event as ArtifactUploadedEvent)
      .data;
    const db = createAdminClient();

    // --- Load the artifact + its publication -------------------------------
    const loaded = await step.run('load', async () => {
      const { data: artifact } = await db
        .from('artifacts')
        .select('id, publication_id, r2_key, bucket')
        .eq('id', artifactId)
        .maybeSingle();
      if (!artifact) return null;

      const { data: publication } = await db
        .from('publications')
        .select('id, format_preset_id, trim_width_mm, trim_height_mm')
        .eq('id', publicationId)
        .maybeSingle();
      return { artifact, publication };
    });

    if (!loaded?.artifact || !loaded.publication) {
      return { ok: false, reason: 'artifact or publication not found' };
    }
    const { publication } = loaded;

    // --- Inspect + evaluate ------------------------------------------------
    const outcome = await step.run('inspect', async () => {
      const bytes = await getObjectBytes(QUARANTINE_BUCKET, key);
      if (!bytes) {
        return failure('The file could not be retrieved for checking.');
      }

      const preset = publication.format_preset_id
        ? getFormatPreset(publication.format_preset_id)
        : undefined;

      try {
        const facts = await inspectPdf(bytes);
        const trim = {
          widthMm: Number(publication.trim_width_mm),
          heightMm: Number(publication.trim_height_mm),
        };
        // Fall back to generous generic rules if the preset is unknown.
        const rules = preset?.rules ?? {
          minPages: 1,
          maxPages: 1000,
          requiresMultipleOfFour: false,
          dimensionToleranceMm: 1,
          bleedMm: 3,
          minImageDpi: 300,
        };
        const result = evaluatePreflight(facts, trim, rules);
        return {
          status: result.status,
          pageCount: facts.pageCount,
          blockers: result.blockers,
          warnings: result.warnings,
          facts: {
            hasBleed: facts.hasBleed,
            fontsEmbedded: facts.fontsEmbedded,
            minImageDpi: facts.minImageDpi,
          },
        };
      } catch {
        return failure('The file could not be read. It may be damaged.');
      }
    });

    // --- Persist the verdict ----------------------------------------------
    await step.run('record-verdict', async () => {
      const record: PreflightRecord = {
        checkedAt: new Date().toISOString(),
        pageCount: outcome.pageCount,
        blockers: outcome.blockers,
        warnings: outcome.warnings,
        facts: outcome.facts,
        warningsAcknowledgedAt: null,
      };
      await db
        .from('artifacts')
        .update({ preflight: record, preflight_status: outcome.status })
        .eq('id', artifactId);
    });

    // --- On pass: promote to clean, mark canonical, set page count ---------
    if (outcome.status === 'passed') {
      await step.run('promote', async () => {
        await copyObject({
          sourceBucket: QUARANTINE_BUCKET,
          destBucket: CLEAN_BUCKET,
          key,
        });
        // Repoint the artifact at the clean bucket and make it the canonical file.
        await db
          .from('artifacts')
          .update({ bucket: CLEAN_BUCKET, is_canonical: true })
          .eq('id', artifactId);
        // Demote any other artifacts for this publication.
        await db
          .from('artifacts')
          .update({ is_canonical: false })
          .eq('publication_id', publicationId)
          .neq('id', artifactId);
        // The page count is now authoritative.
        await db
          .from('publications')
          .update({
            page_count: outcome.pageCount,
            updated_at: new Date().toISOString(),
          })
          .eq('id', publicationId);
        // Remove the now-promoted copy from quarantine.
        await deleteObject(QUARANTINE_BUCKET, key);
      });

      // Render cover + preview pages and publish them to Cloudflare Images.
      // Isolated: a render/upload failure must NEVER unmake a passed
      // publication — it stays passed and live; the cover simply stays absent
      // and the failure is logged for internal visibility. Retried by the
      // creator re-uploading; not by failing the run (so the sweep still runs).
      await step.run('render-previews', async () => {
        try {
          const bytes = await getObjectBytes(CLEAN_BUCKET, key);
          if (!bytes) {
            console.error('render-previews: clean object missing', {
              key,
              publicationId,
            });
            return { ok: false, reason: 'clean object missing' };
          }

          // Re-render cleanup (D-014 parity): drop previous preview assets so
          // derived imagery always tracks the active file. Clear the cover
          // reference first to avoid a dangling pointer mid-rebuild.
          await db
            .from('publications')
            .update({ cover_asset_id: null })
            .eq('id', publicationId);
          const { data: stale } = await db
            .from('assets')
            .select('external_id')
            .eq('publication_id', publicationId)
            .eq('provider', 'cloudflare_images')
            .eq('kind', 'preview_page');
          for (const a of stale ?? []) {
            if (a.external_id) await deleteImage(a.external_id);
          }
          if (stale && stale.length > 0) {
            await db
              .from('assets')
              .delete()
              .eq('publication_id', publicationId)
              .eq('provider', 'cloudflare_images')
              .eq('kind', 'preview_page');
          }

          // Render → upload → record one asset per page.
          const pages = renderPreviewPages(bytes, {
            maxPages: 6,
            targetWidth: 1600,
            quality: 80,
          });
          let coverAssetId: string | null = null;
          for (const p of pages) {
            const imageId = await uploadImage(
              p.jpeg,
              `pub-${publicationId}-p${p.page}.jpg`
            );
            const { data: asset } = await db
              .from('assets')
              .insert({
                publication_id: publicationId,
                provider: 'cloudflare_images',
                external_id: imageId,
                kind: 'preview_page',
                meta: { page: p.page, width: p.width, height: p.height },
              })
              .select('id')
              .single();
            if (p.page === 1 && asset) coverAssetId = asset.id;
          }

          // Page 1 is the cover.
          if (coverAssetId) {
            await db
              .from('publications')
              .update({
                cover_asset_id: coverAssetId,
                updated_at: new Date().toISOString(),
              })
              .eq('id', publicationId);
          }

          return { ok: true, count: pages.length };
        } catch (err) {
          console.error('render-previews failed (publication remains passed)', {
            publicationId,
            error: String(err),
          });
          return { ok: false, error: String(err) };
        }
      });
    }

    // --- Retention sweep (D-014) ------------------------------------------
    await step.run('sweep', async () => {
      const { data: all } = await db
        .from('artifacts')
        .select('id, r2_key, bucket, preflight_status, uploaded_at')
        .eq('publication_id', publicationId)
        .order('uploaded_at', { ascending: false });
      if (!all || all.length === 0) return;

      const keep = new Set<string>();
      const active = all.find((a) => a.preflight_status === 'passed') ?? null;

      if (active) {
        keep.add(active.id); // never sweep the active file
        const idx = all.findIndex((a) => a.id === active.id);
        const predecessor = all[idx + 1];
        if (predecessor) keep.add(predecessor.id);
        // Any in-flight attempt newer than the active file.
        for (const a of all) {
          if (a.uploaded_at > active.uploaded_at) keep.add(a.id);
        }
      } else {
        // No passed file yet: keep the two most recent uploads.
        if (all[0]) keep.add(all[0].id);
        if (all[1]) keep.add(all[1].id);
      }

      const sweep = all.filter((a) => !keep.has(a.id));
      for (const a of sweep) {
        await deleteObject(a.bucket, a.r2_key);
        await db.from('artifacts').delete().eq('id', a.id);
      }
      return { swept: sweep.length };
    });

    return { ok: true, status: outcome.status };
  }
);

function failure(detail: string) {
  return {
    status: 'failed' as const,
    pageCount: 0,
    blockers: [
      { code: 'unreadable', title: 'File', detail } satisfies PreflightIssue,
    ],
    warnings: [] as PreflightIssue[],
    facts: { hasBleed: null, fontsEmbedded: null, minImageDpi: null },
  };
}

/**
 * Submission notification (Slice 5 / D-016).
 *
 * Triggered when a creator submits a publication for review. Sends an admin
 * notification via Resend (a clean integration point that no-ops until the key
 * is set). Isolated from the submission itself — the transition already
 * committed; a notification failure only retries the email.
 */
const submittedNotify = inngest.createFunction(
  { id: 'publication-submitted-notify', retries: 3 },
  { event: 'publication/submitted' },
  async ({ event }) => {
    const { publicationId } = event.data as { publicationId: string };
    const db = createAdminClient();

    const { data: pub } = await db
      .from('publications')
      .select('id, title, category, creator_id, price_minor, currency, edition_size')
      .eq('id', publicationId)
      .maybeSingle();
    if (!pub) return { ok: false, reason: 'publication not found' };

    const { data: creator } = await db
      .from('users')
      .select('handle, display_name')
      .eq('id', pub.creator_id)
      .maybeSingle();

    const price =
      pub.price_minor !== null && pub.price_minor !== undefined
        ? `${(pub.price_minor / 100).toFixed(2)} ${pub.currency ?? 'CAD'}`
        : '—';
    const edition =
      pub.edition_size !== null && pub.edition_size !== undefined
        ? String(pub.edition_size)
        : 'open edition';

    const text = [
      'A publication has been submitted for review.',
      '',
      `Title: ${pub.title}`,
      `Category: ${pub.category}`,
      `Creator: ${creator?.display_name ?? ''} (@${creator?.handle ?? ''})`,
      `Price: ${price}`,
      `Edition: ${edition}`,
      '',
      'The admin review queue arrives in Slice 6.',
    ].join('\n');

    const { sent } = await sendAdminEmail({
      subject: `Submitted for review: ${pub.title}`,
      text,
    });
    return { ok: true, emailed: sent };
  }
);

/**
 * Decision notification (Slice 6 / D-019–D-021).
 *
 * Triggered when an editor publishes a submission or returns it for revisions.
 * Writes to the creator in two voices (D-021): an Institutional frame (Baxter
 * stating what is true) around the editor's own written note (Editorial Voice).
 * The note arrives verbatim — never templated, never assembled from reason
 * codes (D-020). Isolated from the decision itself: the transition already
 * committed; a send failure only retries the email.
 *
 * NOTE (D-017): this is a new Inngest function. After deploying it, the app must
 * be Resynced in Inngest Cloud or it will not register — the exact failure that
 * silently broke the Slice 5 email.
 */
const decidedNotify = inngest.createFunction(
  { id: 'publication-decided-notify', retries: 3 },
  { event: 'publication/decided' },
  async ({ event }) => {
    const { publicationId, decision, note } = event.data as {
      publicationId: string;
      decision: 'publish' | 'revise';
      note: string | null;
    };
    const db = createAdminClient();

    const { data: pub } = await db
      .from('publications')
      .select('id, title, creator_id')
      .eq('id', publicationId)
      .maybeSingle();
    if (!pub) return { ok: false, reason: 'publication not found' };

    const { data: creator } = await db
      .from('users')
      .select('email')
      .eq('id', pub.creator_id)
      .maybeSingle();
    if (!creator?.email) return { ok: false, reason: 'creator email not found' };

    const trimmedNote = note?.trim() || null;

    // Two voices (D-021): Institutional frame, Editorial note verbatim.
    let subject: string;
    let text: string;
    if (decision === 'publish') {
      subject = `Published: ${pub.title}`;
      text = trimmedNote
        ? `${pub.title} is now published.\n\n${trimmedNote}`
        : `${pub.title} is now published.`;
    } else {
      subject = `A note from Baxter on ${pub.title}`;
      text = [
        `Baxter has read ${pub.title}.`,
        '',
        trimmedNote ?? '',
        '',
        "Edit and resubmit when you're ready.",
      ].join('\n');
    }

    const { sent } = await sendEmail({ to: creator.email, subject, text });
    return { ok: true, emailed: sent };
  }
);

/**
 * Order commerce notifications (Slice 9).
 *
 * Triggered by `order/paid` from the Stripe webhook. Sends the three commerce
 * emails a paid order produces: the buyer's receipt, the creator's sale notice
 * (skipped for a proof — the creator sold nothing to themselves), and the
 * admin's production package — the print-ready file plus every spec MGS needs
 * and the delivery address. Emails are best-effort: a failed send retries but
 * never un-books the order.
 */
const orderPaidNotify = inngest.createFunction(
  { id: 'order-paid-notify', retries: 3 },
  { event: 'order/paid' },
  async ({ event }) => {
    const { orderId } = event.data as { orderId: string };
    const db = createAdminClient();

    const detail = await loadOrderDetail(db, orderId);
    if (!detail) return { ok: false, reason: 'order not found' };

    const { order, publication, buyer, creator, estimate, address } = detail;
    const cur = order.currency;
    const money = (minor: number) => `$${(minor / 100).toFixed(2)} ${cur}`;

    // Selected carrier service (D-030), if captured. One shared line for all
    // three emails; empty until EasyPost is enabled.
    const shippingLine = order.shippingCarrier
      ? `${order.shippingCarrier} · ${order.shippingService}${
          order.shippingEstimatedDelivery
            ? ` · ${order.shippingEstimatedDelivery}`
            : ''
        } — ${money(order.shippingMinor)}`
      : null;

    // Buyer receipt — Institutional voice, a plain confirmation.
    let buyerEmailed = false;
    if (buyer.email) {
      const subject = order.isTestPrint
        ? `Your proof copy — ${publication.title}`
        : `Your Baxter order — ${publication.title}`;
      const text = [
        order.isTestPrint
          ? `Your proof copy of ${publication.title} is confirmed.`
          : `Thank you. Your copy of ${publication.title} by ${creator.name} is confirmed.`,
        '',
        `Total ${money(order.totalMinor)}`,
        ...(shippingLine ? [`Shipping: ${shippingLine}`] : []),
        'Baxter will send it into production and ship it to the address you provided.',
      ].join('\n');
      const { sent } = await sendEmail({ to: buyer.email, subject, text });
      buyerEmailed = sent;
    }

    // Creator sale — skipped for a proof (no earnings, no sale).
    let creatorEmailed = false;
    if (!order.isTestPrint && creator.email) {
      const subject = `Your work sold — ${publication.title}`;
      const text = [
        `${publication.title} sold a copy.`,
        '',
        `Your earnings: ${money(order.creatorEarningsMinor)}.`,
        'They will be released when the order is fulfilled.',
      ].join('\n');
      const { sent } = await sendEmail({ to: creator.email, subject, text });
      creatorEmailed = sent;
    }

    // Admin production package — the print-ready file + full specs + address.
    let fileUrl: string | null = null;
    if (detail.fileKey) {
      try {
        fileUrl = await presignedGetUrl({
          bucket: detail.fileBucket ?? CLEAN_BUCKET,
          key: detail.fileKey,
          // A generous window so the desk can act on the email at leisure.
          expiresInSeconds: 60 * 60 * 24 * 3,
        });
      } catch (e) {
        console.error('orderPaidNotify: presign failed', {
          orderId,
          error: String(e),
        });
      }
    }

    const addr = address?.address ?? null;
    const addressLines = addr
      ? [
          address?.name ?? '',
          addr.line1 ?? '',
          addr.line2 ?? '',
          [addr.city, addr.state, addr.postal_code].filter(Boolean).join(', '),
          addr.country ?? '',
          address?.phone ? `Tel: ${address.phone}` : '',
        ].filter(Boolean)
      : ['No delivery address captured.'];

    const specLines = estimate
      ? [
          `Quantity: ${order.quantity}`,
          `Interior: ${publication.interior === 'mono' ? 'Black & white' : publication.interior === 'colour' ? 'Colour' : '—'}`,
          `Pages: ${publication.pageCount ?? '—'}`,
          `Trim: ${publication.trimWidthMm ?? '—'} × ${publication.trimHeightMm ?? '—'} mm`,
          `Binding: ${estimate.binding}`,
          `Paper: ${estimate.paper}`,
          `Est. weight: ${estimate.estimatedWeightGrams} g`,
          `Est. parcel: ${estimate.parcelDimensionsMm.length} × ${estimate.parcelDimensionsMm.width} × ${estimate.parcelDimensionsMm.height} mm`,
        ]
      : ['Specifications unavailable (page count or interior not set).'];

    const adminSubject = order.isTestPrint
      ? `Proof to print: ${publication.title} · ${order.quantity}`
      : `Order to print: ${publication.title} · ${order.quantity}`;
    const adminText = [
      `${publication.title} by ${creator.name}`,
      order.isTestPrint ? '(Creator proof — production cost only.)' : '',
      '',
      'SPECIFICATIONS',
      ...specLines,
      '',
      'DELIVER TO',
      ...addressLines,
      ...(shippingLine ? ['', `Shipping: ${shippingLine}`] : []),
      '',
      'PRINT FILE',
      fileUrl ?? 'No print-ready file attached.',
      '',
      'ECONOMICS',
      `Printing & production: ${money(order.printCostMinor)}`,
      `Baxter production margin: ${money(order.baxterMarginMinor)}`,
      `Creator earnings: ${money(order.creatorEarningsMinor)}`,
      `Shipping: ${money(order.shippingMinor)}`,
      `Total charged: ${money(order.totalMinor)}`,
    ]
      .filter((l) => l !== null && l !== undefined)
      .join('\n');

    const { sent: adminEmailed } = await sendAdminEmail({
      subject: adminSubject,
      text: adminText,
    });

    return { ok: true, buyerEmailed, creatorEmailed, adminEmailed };
  }
);

export const functions = [
  preflight,
  submittedNotify,
  decidedNotify,
  orderPaidNotify,
];
