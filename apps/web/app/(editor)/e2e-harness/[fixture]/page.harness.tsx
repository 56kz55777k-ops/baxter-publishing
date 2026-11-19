import { notFound } from 'next/navigation';
import { harnessDocRow } from '@/test/e2e-harness/fixtures';
import { EditorGate } from '../../studio/editor/[id]/editor-gate';

/**
 * Slice D stage 8A — the local application harness (plan §8.2, Q5 approved by
 * Ben 2026-11-18).
 *
 * This file is a route ONLY in a build made with BAXTER_E2E_HARNESS=1, which
 * adds 'harness.tsx' to `pageExtensions` (next.config.js). In a default build
 * Next's app-dir matcher does not recognise `page.harness.tsx`, so there is no
 * route, no entry and nothing below is compiled — proved per commit from the
 * default build's route manifest and output (stage 8A verification).
 *
 * It renders the real editor exactly as /studio/editor/[id] does —
 * EditorGate → next/dynamic → EditorIsland → EditorShell → SpreadStage →
 * Transformer, with the application's CSS — but the publication is the fixed
 * id `e2e-harness` and the document comes from an allowlisted fixture
 * (`test/e2e-harness/fixtures.ts`), not from Supabase. No auth, no database:
 * every editor API request it makes is fulfilled by the test's mock in the
 * browser; the server never handles one.
 */
export const metadata = { title: 'Editor harness — Baxter (local test build)' };
export const dynamic = 'force-dynamic';

export default async function EditorHarnessPage({ params }: { params: Promise<{ fixture: string }> }) {
  const { fixture } = await params;
  const docRow = harnessDocRow(fixture);
  if (docRow === undefined) notFound();
  return <EditorGate publicationId="e2e-harness" title={`Harness · ${fixture}`} docRow={docRow} />;
}
