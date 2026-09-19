/**
 * Document state — the editor's transaction log (blueprint §2.3).
 *
 * The reducer owns the document, the last acknowledged save, the server
 * revision mirror, and the (Slice A: placeholder) history stacks. It stays a
 * TRANSACTION LOG: element semantics never live here — future slices produce
 * `nextDoc` immutably in pure helpers and commit it through the one generic
 * COMMIT action. Per-element-type actions are deliberately impossible.
 *
 * Dirty state is DERIVED, never stored: `state.doc !== state.savedDoc` —
 * reference inequality, which is exact because every update is immutable and
 * SAVED points savedDoc at the precise payload reference the server
 * acknowledged (amendment A1: structural sharing, no JSON snapshots).
 *
 * Terminal phases: 'conflict' (another writer won — blueprint §2.6) and
 * 'window-closed' (the publication left draft/revisions). Both freeze the
 * document until reload; every mutating action is ignored.
 */
import type { EditorDoc } from '@baxter/domain';

export const HISTORY_CAP = 100;

/** The autosave machine's phase. Clean/dirty is derived, not stored. */
export type SavePhase = 'idle' | 'saving' | 'retrying' | 'conflict' | 'window-closed';

export interface HistoryEntry {
  /** The document BEFORE the commit (undo target), by reference. */
  doc: EditorDoc;
  /** Selection captured with the entry (restored filtered to live ids). */
  selection: readonly string[];
  label: string;
}

export interface DocumentState {
  doc: EditorDoc;
  /** Exact reference of the last payload the server acknowledged. */
  savedDoc: EditorDoc;
  /** Server revision mirror — sent as baseRevision, never invented here. */
  revision: number;
  history: readonly HistoryEntry[];
  future: readonly HistoryEntry[];
  savePhase: SavePhase;
  /** Per-mount id, travels with saves as autosave diagnostics. */
  clientId: string;
  /** Set alongside the conflict phase for the banner's diagnostics. */
  conflictServerRevision: number | null;
}

export type DocumentAction =
  | { type: 'COMMIT'; nextDoc: EditorDoc; selection: readonly string[]; label: string }
  /**
   * Undo/redo are transaction-log operations, not element operations — they
   * move whole documents between the two stacks and add no per-element
   * vocabulary to this reducer (ADR-003 §1 holds).
   *
   * `currentSelection` is recorded on the entry pushed to the opposite stack
   * so the reverse move can restore it. It is passed in rather than read
   * here because selection belongs to the UI context: this reducer carries it
   * as opaque data and never owns it.
   */
  | { type: 'UNDO'; currentSelection: readonly string[] }
  | { type: 'REDO'; currentSelection: readonly string[] }
  | { type: 'SAVE_STARTED' }
  | { type: 'SAVED'; revision: number; sentDoc: EditorDoc }
  | { type: 'SAVE_FAILED' }
  | { type: 'SAVE_CONFLICT'; serverRevision: number | null }
  | { type: 'WINDOW_CLOSED' };

export function initialDocumentState(args: {
  doc: EditorDoc;
  revision: number;
  clientId: string;
}): DocumentState {
  return {
    doc: args.doc,
    savedDoc: args.doc,
    revision: args.revision,
    history: [],
    future: [],
    savePhase: 'idle',
    clientId: args.clientId,
    conflictServerRevision: null,
  };
}

function isTerminal(phase: SavePhase): boolean {
  return phase === 'conflict' || phase === 'window-closed';
}

export function documentReducer(state: DocumentState, action: DocumentAction): DocumentState {
  switch (action.type) {
    case 'COMMIT': {
      if (isTerminal(state.savePhase)) return state; // read-only: edits stand down
      if (action.nextDoc === state.doc) return state; // no-op commits create nothing
      const entry: HistoryEntry = {
        doc: state.doc,
        selection: action.selection,
        label: action.label,
      };
      const history =
        state.history.length >= HISTORY_CAP
          ? [...state.history.slice(state.history.length - HISTORY_CAP + 1), entry]
          : [...state.history, entry];
      return { ...state, doc: action.nextDoc, history, future: [] };
    }

    case 'UNDO': {
      if (isTerminal(state.savePhase)) return state; // read-only: edits stand down
      const entry = state.history[state.history.length - 1];
      if (!entry) return state;
      // The entry holds the document BEFORE its commit; the current document
      // becomes the redo target, carrying the caller's live selection.
      const redoEntry: HistoryEntry = {
        doc: state.doc,
        selection: action.currentSelection,
        label: entry.label,
      };
      return {
        ...state,
        doc: entry.doc,
        history: state.history.slice(0, -1),
        future: [...state.future, redoEntry],
      };
    }

    case 'REDO': {
      if (isTerminal(state.savePhase)) return state;
      const entry = state.future[state.future.length - 1];
      if (!entry) return state;
      const undoEntry: HistoryEntry = {
        doc: state.doc,
        selection: action.currentSelection,
        label: entry.label,
      };
      return {
        ...state,
        doc: entry.doc,
        history: [...state.history, undoEntry],
        future: state.future.slice(0, -1),
      };
    }

    case 'SAVE_STARTED':
      if (isTerminal(state.savePhase)) return state;
      return { ...state, savePhase: 'saving' };

    case 'SAVED':
      if (isTerminal(state.savePhase)) return state; // a late response never revives a dead session
      return {
        ...state,
        revision: action.revision,
        // The exact acknowledged payload — edits made during the flight keep
        // doc !== savedDoc, so they remain dirty (ordering safety).
        savedDoc: action.sentDoc,
        savePhase: 'idle',
      };

    case 'SAVE_FAILED':
      if (isTerminal(state.savePhase)) return state;
      return { ...state, savePhase: 'retrying' };

    case 'SAVE_CONFLICT':
      return {
        ...state,
        savePhase: 'conflict',
        conflictServerRevision: action.serverRevision,
      };

    case 'WINDOW_CLOSED':
      return { ...state, savePhase: 'window-closed' };
  }
}
