/**
 * The ONE save-envelope builder (hardening item 2). Every byte that leaves
 * the editor for /api/editor/[id] — scheduled autosave and beforeunload
 * keepalive alike — is serialized here, so the two paths cannot drift.
 * The conditional-revision protocol is unchanged: `baseRevision` is the
 * client's mirror of the last acknowledged server revision.
 */
import type { DocumentState } from './reducer';

export interface SaveEnvelope {
  doc: DocumentState['doc'];
  baseRevision: number;
  clientId: string;
}

export function buildSaveEnvelope(
  state: Pick<DocumentState, 'doc' | 'revision' | 'clientId'>
): SaveEnvelope {
  return { doc: state.doc, baseRevision: state.revision, clientId: state.clientId };
}

/** Serialized form — the exact request body. */
export function buildSavePayload(
  state: Pick<DocumentState, 'doc' | 'revision' | 'clientId'>
): string {
  return JSON.stringify(buildSaveEnvelope(state));
}
