import { describe, expect, it } from 'vitest';
import { getFormatPreset, newEditorDoc, newRectElement, type EditorDoc } from '@baxter/domain';
import {
  HISTORY_CAP,
  documentReducer,
  initialDocumentState,
  type DocumentState,
} from '@/components/editor/state/reducer';
import { selectDirty, selectReadOnly, selectSaveLabel, selectUnits } from '@/components/editor/state/selectors';

const CLIENT = 'c0ffee00-aaaa-4bbb-8ccc-00000000000a';

function freshState(): DocumentState {
  const doc = newEditorDoc(getFormatPreset('zine_a5')!);
  return initialDocumentState({ doc, revision: 0, clientId: CLIENT });
}

/** Immutable single-page edit — the shape every future slice will use. */
function withElementOnPage(doc: EditorDoc, pageIndex: number): EditorDoc {
  return {
    ...doc,
    pages: doc.pages.map((p, i) =>
      i === pageIndex ? { ...p, elements: [...p.elements, newRectElement({ x: 10, y: 10 })] } : p
    ),
  };
}

describe('documentReducer — transaction log semantics (contract #24, amendment A1)', () => {
  it('initial state hydrates with savedDoc === doc (clean), empty history', () => {
    const s = freshState();
    expect(s.doc).toBe(s.savedDoc);
    expect(selectDirty(s)).toBe(false);
    expect(s.history).toHaveLength(0);
    expect(selectSaveLabel(s)).toBe('All changes saved');
  });

  it('COMMIT with the same reference is a no-op: SAME state object, no history entry', () => {
    const s = freshState();
    const after = documentReducer(s, {
      type: 'COMMIT',
      nextDoc: s.doc,
      selection: [],
      label: 'noop',
    });
    expect(after).toBe(s);
  });

  it('an accepted COMMIT produces a new root reference and one history entry', () => {
    const s = freshState();
    const next = withElementOnPage(s.doc, 1);
    const after = documentReducer(s, { type: 'COMMIT', nextDoc: next, selection: ['a'], label: 'add rect' });

    expect(after).not.toBe(s);
    expect(after.doc).toBe(next);
    expect(after.history).toHaveLength(1);
    expect(after.history[0]!.doc).toBe(s.doc); // undo target by reference
    expect(after.history[0]!.selection).toEqual(['a']);
    expect(selectDirty(after)).toBe(true);
    expect(selectSaveLabel(after)).toBe('Unsaved changes');
  });

  it('immutable page edits share structure: untouched pages keep their identity', () => {
    const s = freshState();
    const next = withElementOnPage(s.doc, 1);
    expect(next.pages[0]).toBe(s.doc.pages[0]);
    expect(next.pages[2]).toBe(s.doc.pages[2]);
    expect(next.pages[3]).toBe(s.doc.pages[3]);
    expect(next.pages[1]).not.toBe(s.doc.pages[1]);
    expect(next.meta).toBe(s.doc.meta);
  });

  it('SAVED pins savedDoc to the EXACT acknowledged payload reference', () => {
    let s = freshState();
    const sent = withElementOnPage(s.doc, 1);
    s = documentReducer(s, { type: 'COMMIT', nextDoc: sent, selection: [], label: 'edit' });
    s = documentReducer(s, { type: 'SAVE_STARTED' });
    s = documentReducer(s, { type: 'SAVED', revision: 1, sentDoc: sent });

    expect(s.savedDoc).toBe(sent);
    expect(s.revision).toBe(1);
    expect(selectDirty(s)).toBe(false);
    expect(selectSaveLabel(s)).toBe('All changes saved');
  });

  it('edits made during an in-flight save stay dirty after the older payload is acknowledged', () => {
    let s = freshState();
    const sent = withElementOnPage(s.doc, 1);
    s = documentReducer(s, { type: 'COMMIT', nextDoc: sent, selection: [], label: 'first' });
    s = documentReducer(s, { type: 'SAVE_STARTED' }); // flight carries `sent`

    const during = withElementOnPage(s.doc, 2); // user keeps editing mid-flight
    s = documentReducer(s, { type: 'COMMIT', nextDoc: during, selection: [], label: 'second' });

    s = documentReducer(s, { type: 'SAVED', revision: 1, sentDoc: sent }); // late ack of the OLD payload
    expect(s.savedDoc).toBe(sent);
    expect(s.doc).toBe(during);
    expect(selectDirty(s)).toBe(true); // the newer document was never marked clean
  });

  it('conflict is terminal: commits and save-state changes are ignored until reload', () => {
    let s = freshState();
    s = documentReducer(s, { type: 'SAVE_CONFLICT', serverRevision: 7 });
    expect(s.savePhase).toBe('conflict');
    expect(s.conflictServerRevision).toBe(7);
    expect(selectReadOnly(s)).toBe(true);

    const frozenDoc = s.doc;
    const next = withElementOnPage(s.doc, 1);
    s = documentReducer(s, { type: 'COMMIT', nextDoc: next, selection: [], label: 'blocked' });
    expect(s.doc).toBe(frozenDoc);

    s = documentReducer(s, { type: 'SAVED', revision: 9, sentDoc: next });
    expect(s.savePhase).toBe('conflict'); // a late response never revives the session
    expect(s.savedDoc).not.toBe(next);
  });

  it('window-closed is equally terminal', () => {
    let s = freshState();
    s = documentReducer(s, { type: 'WINDOW_CLOSED' });
    const frozen = s;
    s = documentReducer(s, {
      type: 'COMMIT',
      nextDoc: withElementOnPage(s.doc, 1),
      selection: [],
      label: 'x',
    });
    expect(s).toBe(frozen);
    expect(selectSaveLabel(s)).toMatch(/Editing is closed/);
  });

  it('history caps at 100 entries, dropping the oldest', () => {
    let s = freshState();
    for (let i = 0; i < HISTORY_CAP + 10; i++) {
      s = documentReducer(s, {
        type: 'COMMIT',
        nextDoc: withElementOnPage(s.doc, 1),
        selection: [],
        label: `c${i}`,
      });
    }
    expect(s.history).toHaveLength(HISTORY_CAP);
    expect(s.history[HISTORY_CAP - 1]!.label).toBe(`c${HISTORY_CAP + 9}`);
    expect(s.history[0]!.label).toBe('c10');
  });

  it('a COMMIT clears the redo future', () => {
    let s = freshState();
    s = { ...s, future: [{ doc: s.doc, selection: [], label: 'redo-me' }] };
    s = documentReducer(s, {
      type: 'COMMIT',
      nextDoc: withElementOnPage(s.doc, 1),
      selection: [],
      label: 'new work',
    });
    expect(s.future).toHaveLength(0);
  });

  it('selectUnits memoizes per pages reference (stable identity for React)', () => {
    const s = freshState();
    const u1 = selectUnits(s.doc);
    const u2 = selectUnits(s.doc);
    expect(u1).toBe(u2);
    const next = withElementOnPage(s.doc, 1);
    expect(selectUnits(next)).not.toBe(u1); // pages array changed → new units
  });
});
