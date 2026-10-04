/**
 * History and selection (contracts #4, #24) — one intention, one entry.
 *
 * Undo/redo are transaction-log operations on the document reducer; selection
 * travels with each entry as opaque data and is restored by the shell into
 * the UI context. These tests pin both halves of that seam, and the
 * no-op/terminal-phase guarantees that keep the log honest.
 */
import { describe, expect, it } from 'vitest';
import {
  addElement,
  getFormatPreset,
  liveSelection,
  newEditorDoc,
  newRectElement,
  updateElement,
} from '@baxter/domain';
import { documentReducer, initialDocumentState, HISTORY_CAP } from '@/components/editor/state/reducer';
import { editorUiReducer, isCreationTool, type EditorUiState } from '@/components/editor/state/editor-ui';
import { PX_PER_MM } from '@/components/editor/geometry';

const preset = getFormatPreset('zine_a5')!;
const base = newEditorDoc(preset);

function start() {
  return initialDocumentState({ doc: base, revision: 3, clientId: 'c1' });
}

function commit(state: ReturnType<typeof start>, nextDoc: typeof base, selection: string[] = []) {
  return documentReducer(state, { type: 'COMMIT', nextDoc, selection, label: 'test' });
}

describe('COMMIT — one intention, one entry', () => {
  it('appends one entry holding the PREVIOUS document and its selection', () => {
    const s0 = start();
    const el = newRectElement({ x: 5, y: 5 });
    const s1 = commit(s0, addElement(base, base.pages[1]!.id, el), ['before']);
    expect(s1.history).toHaveLength(1);
    expect(s1.history[0]!.doc).toBe(base);
    expect(s1.history[0]!.selection).toEqual(['before']);
    expect(s1.future).toEqual([]);
  });

  it('a no-op commit creates nothing (reference equality)', () => {
    const s0 = start();
    expect(commit(s0, base)).toBe(s0);
  });

  it('a fresh commit clears the redo stack', () => {
    const s0 = start();
    const el = newRectElement({ x: 5, y: 5 });
    const s1 = commit(s0, addElement(base, base.pages[1]!.id, el));
    const undone = documentReducer(s1, { type: 'UNDO', currentSelection: [] });
    expect(undone.future).toHaveLength(1);
    const s2 = commit(undone, addElement(base, base.pages[1]!.id, newRectElement({ x: 9, y: 9 })));
    expect(s2.future).toEqual([]);
  });
});

describe('UNDO / REDO', () => {
  it('restores the previous document and offers it back', () => {
    const s0 = start();
    const el = newRectElement({ x: 5, y: 5 });
    const withEl = addElement(base, base.pages[1]!.id, el);
    const s1 = commit(s0, withEl, []);

    const undone = documentReducer(s1, { type: 'UNDO', currentSelection: [el.id] });
    expect(undone.doc).toBe(base);
    expect(undone.history).toHaveLength(0);
    expect(undone.future).toHaveLength(1);
    expect(undone.future[0]!.doc).toBe(withEl);
    expect(undone.future[0]!.selection).toEqual([el.id]);

    const redone = documentReducer(undone, { type: 'REDO', currentSelection: [] });
    expect(redone.doc).toBe(withEl);
    expect(redone.history).toHaveLength(1);
    expect(redone.future).toHaveLength(0);
  });

  it('round-trips a multi-step stack in order', () => {
    let s = start();
    const a = newRectElement({ x: 1, y: 1 });
    const b = newRectElement({ x: 2, y: 2 });
    const d1 = addElement(base, base.pages[1]!.id, a);
    const d2 = addElement(d1, d1.pages[1]!.id, b);
    s = commit(s, d1);
    s = commit(s, d2);

    s = documentReducer(s, { type: 'UNDO', currentSelection: [] });
    expect(s.doc).toBe(d1);
    s = documentReducer(s, { type: 'UNDO', currentSelection: [] });
    expect(s.doc).toBe(base);
    s = documentReducer(s, { type: 'REDO', currentSelection: [] });
    expect(s.doc).toBe(d1);
    s = documentReducer(s, { type: 'REDO', currentSelection: [] });
    expect(s.doc).toBe(d2);
  });

  it('is a no-op on empty stacks', () => {
    const s0 = start();
    expect(documentReducer(s0, { type: 'UNDO', currentSelection: [] })).toBe(s0);
    expect(documentReducer(s0, { type: 'REDO', currentSelection: [] })).toBe(s0);
  });

  it('stands down in the terminal phases, like every mutating action', () => {
    const s0 = start();
    const s1 = commit(s0, addElement(base, base.pages[1]!.id, newRectElement({ x: 1, y: 1 })));
    for (const phase of ['SAVE_CONFLICT', 'WINDOW_CLOSED'] as const) {
      const frozen =
        phase === 'SAVE_CONFLICT'
          ? documentReducer(s1, { type: 'SAVE_CONFLICT', serverRevision: 9 })
          : documentReducer(s1, { type: 'WINDOW_CLOSED' });
      expect(documentReducer(frozen, { type: 'UNDO', currentSelection: [] })).toBe(frozen);
      expect(documentReducer(frozen, { type: 'REDO', currentSelection: [] })).toBe(frozen);
    }
  });

  it('respects the history cap by dropping the oldest entry', () => {
    let s = start();
    let doc = base;
    for (let i = 0; i < HISTORY_CAP + 5; i++) {
      doc = addElement(doc, doc.pages[1]!.id, newRectElement({ x: i, y: 0 }));
      s = commit(s, doc);
    }
    expect(s.history).toHaveLength(HISTORY_CAP);
  });
});

describe('selection restoration is filtered, never recreated (contract #4)', () => {
  it('drops ids that do not exist in the restored document', () => {
    const el = newRectElement({ x: 5, y: 5 });
    const withEl = addElement(base, base.pages[1]!.id, el);
    // Undoing back to `base` must not resurrect the element's id.
    expect(liveSelection(base, [el.id])).toEqual([]);
    expect(liveSelection(withEl, [el.id])).toEqual([el.id]);
  });
});

describe('editor UI reducer — selection is session state', () => {
  const ui: EditorUiState = {
    unitIndex: 0,
    view: { x: 0, y: 0, scale: PX_PER_MM },
    tool: 'select',
    selection: [],
  };

  it('sets, toggles and clears', () => {
    const a = editorUiReducer(ui, { type: 'SET_SELECTION', ids: ['x', 'y'] });
    expect(a.selection).toEqual(['x', 'y']);
    const b = editorUiReducer(a, { type: 'TOGGLE_SELECTION', ids: ['y', 'z'] });
    expect(b.selection).toEqual(['x', 'z']);
    expect(editorUiReducer(b, { type: 'CLEAR_SELECTION' }).selection).toEqual([]);
  });

  it('returns the same state for no-op selection and tool changes', () => {
    expect(editorUiReducer(ui, { type: 'CLEAR_SELECTION' })).toBe(ui);
    expect(editorUiReducer(ui, { type: 'SET_SELECTION', ids: [] })).toBe(ui);
    expect(editorUiReducer(ui, { type: 'SET_TOOL', tool: 'select' })).toBe(ui);
  });

  it('a tool change never touches selection — the affordance hides, the set persists', () => {
    const selected = editorUiReducer(ui, { type: 'SET_SELECTION', ids: ['x'] });
    const armed = editorUiReducer(selected, { type: 'SET_TOOL', tool: 'rect' });
    expect(armed.selection).toEqual(['x']);
    expect(isCreationTool(armed.tool)).toBe(true);
    expect(isCreationTool('select')).toBe(false);
    expect(isCreationTool('hand')).toBe(false);
  });
});

describe('inspector edits are ordinary commits', () => {
  it('one patch is one entry; an identical patch is none', () => {
    const el = newRectElement({ x: 5, y: 5 });
    const withEl = addElement(base, base.pages[1]!.id, el);
    let s = commit(start(), withEl);
    const moved = updateElement(withEl, el.id, { x: 40 });
    s = commit(s, moved);
    expect(s.history).toHaveLength(2);
    // Re-committing the same value produces the same reference → no entry.
    expect(commit(s, updateElement(moved, el.id, { x: 40 }))).toBe(s);
  });
});
