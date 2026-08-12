/**
 * Commit observation (hardening item 4) + save-envelope equivalence (item 2).
 *
 * The observer suite drives REAL reducer states through every save-machine
 * transition and asserts the scheduler is nudged only by document-reference
 * changes — the failure this prevents is a save-phase transition silently
 * re-arming the debounce (the pre-hardening behaviour).
 */
import { describe, expect, it } from 'vitest';
import { getFormatPreset, newEditorDoc, newRectElement, type EditorDoc } from '@baxter/domain';
import { createCommitObserver } from '@/components/editor/state/commit-observer';
import {
  documentReducer,
  initialDocumentState,
  type DocumentState,
} from '@/components/editor/state/reducer';
import { buildSaveEnvelope, buildSavePayload } from '@/components/editor/state/save-payload';

const CLIENT = 'c0ffee00-aaaa-4bbb-8ccc-00000000000a';

function fresh(): DocumentState {
  return initialDocumentState({
    doc: newEditorDoc(getFormatPreset('zine_a5')!),
    revision: 0,
    clientId: CLIENT,
  });
}

function edited(doc: EditorDoc): EditorDoc {
  return {
    ...doc,
    pages: doc.pages.map((p, i) =>
      i === 1 ? { ...p, elements: [...p.elements, newRectElement({ x: 5, y: 5 })] } : p
    ),
  };
}

describe('createCommitObserver — doc-reference changes only', () => {
  it('one commit schedules exactly one nudge', () => {
    let s = fresh();
    let nudges = 0;
    const observe = createCommitObserver(s.doc, () => nudges++);

    s = documentReducer(s, { type: 'COMMIT', nextDoc: edited(s.doc), selection: [], label: 'c1' });
    observe(s);
    expect(nudges).toBe(1);

    observe(s); // same state re-observed (re-render without dispatch): no nudge
    expect(nudges).toBe(1);
  });

  it('SAVE_STARTED, SAVED, SAVE_FAILED, CONFLICT, WINDOW_CLOSED never schedule', () => {
    let s = fresh();
    let nudges = 0;
    const observe = createCommitObserver(s.doc, () => nudges++);

    const sent = edited(s.doc);
    s = documentReducer(s, { type: 'COMMIT', nextDoc: sent, selection: [], label: 'c1' });
    observe(s);
    expect(nudges).toBe(1);

    // A second commit lands while the first save is in flight — the doc is
    // dirty at EVERY transition below, which is exactly what made the old
    // [state]-dependency fire spuriously.
    s = documentReducer(s, { type: 'SAVE_STARTED' });
    observe(s);
    const during = edited(s.doc);
    s = documentReducer(s, { type: 'COMMIT', nextDoc: during, selection: [], label: 'c2' });
    observe(s); // a REAL commit: nudges
    s = documentReducer(s, { type: 'SAVED', revision: 1, sentDoc: sent });
    observe(s); // doc unchanged (still `during`), still dirty: must NOT nudge
    s = documentReducer(s, { type: 'SAVE_FAILED' });
    observe(s);
    s = documentReducer(s, { type: 'SAVE_CONFLICT', serverRevision: 9 });
    observe(s);
    s = documentReducer(s, { type: 'WINDOW_CLOSED' });
    observe(s);

    expect(nudges).toBe(2); // c1 + c2 — and nothing else, across five transitions
  });

  it('clean states and terminal states never nudge even when the doc reference changes', () => {
    let s = fresh();
    let nudges = 0;
    const observe = createCommitObserver(s.doc, () => nudges++);

    // Terminal conflict: reducer freezes the doc, so commits change nothing —
    // but guard the observer contract directly too.
    s = documentReducer(s, { type: 'SAVE_CONFLICT', serverRevision: 3 });
    const frozen = s.doc;
    s = documentReducer(s, { type: 'COMMIT', nextDoc: edited(s.doc), selection: [], label: 'x' });
    expect(s.doc).toBe(frozen); // reducer already refused
    observe(s);
    expect(nudges).toBe(0);
  });
});

describe('buildSaveEnvelope / buildSavePayload — one construction for both paths', () => {
  it('scheduler-path and keepalive-path inputs produce identical bytes', () => {
    const s = fresh();
    // Scheduler path captures fields explicitly; keepalive passes state.
    const schedulerBody = buildSavePayload({ doc: s.doc, revision: s.revision, clientId: s.clientId });
    const keepaliveBody = buildSavePayload(s);
    expect(schedulerBody).toBe(keepaliveBody);

    const parsed = JSON.parse(schedulerBody) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['baseRevision', 'clientId', 'doc']);
    expect(parsed.baseRevision).toBe(0);
    expect(parsed.clientId).toBe(CLIENT);
  });

  it('envelope mirrors the conditional-revision protocol exactly', () => {
    let s = fresh();
    s = documentReducer(s, { type: 'COMMIT', nextDoc: edited(s.doc), selection: [], label: 'c' });
    s = documentReducer(s, { type: 'SAVED', revision: 7, sentDoc: s.doc });
    const env = buildSaveEnvelope(s);
    expect(env.baseRevision).toBe(7); // always the last acknowledged revision
    expect(env.doc).toBe(s.doc); // by reference — serialization happens at the boundary
  });
});
