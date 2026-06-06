import { inngest } from './client';
import { createAdminClient } from '@/lib/supabase/admin';
import { QUARANTINE_BUCKET, CLEAN_BUCKET } from '@/lib/r2/client';
import { getObjectBytes, copyObject, deleteObject } from '@/lib/r2/objects';
import { inspectPdf } from '@/lib/pdf/inspect';
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

export const functions = [preflight];
