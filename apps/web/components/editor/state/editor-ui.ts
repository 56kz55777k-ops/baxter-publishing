/**
 * Editor UI state — the second context of the two-context architecture
 * (blueprint §2.4). Ephemeral by definition: never persisted, never history,
 * never dirties the document. Slice A carried exactly what the empty surface
 * needed — unit index, viewport, tool. Slice B extends that shape with
 * SELECTION, as ADR-003's consequences section anticipated; mode state still
 * arrives with the slice that owns it (I).
 *
 * Selection lives here, not in the document, for a structural reason: the
 * commit observer watches the DOCUMENT reducer's `doc` reference, so nothing
 * in this file can schedule an autosave or append a history entry, however
 * often it changes. Selection is carried *through* history as opaque data on
 * `HistoryEntry.selection`, and restored back into this context by the shell
 * — the document reducer never owns it (contracts #4, #24, #25).
 */

export interface ViewTransform {
  /** Screen px offset of the unit origin. */
  x: number;
  y: number;
  /** Screen px per mm — PX_PER_MM × zoom factor is pre-multiplied here. */
  scale: number;
}

/**
 * Slice B adds the two shape-creation tools. `rect` has the accepted keyboard
 * letter R (contract #26); the accepted shortcut map V/H/T/I/R/L assigns no
 * letter to ellipse, so ellipse is toolbar-only rather than inventing one.
 */
export type EditorTool = 'select' | 'hand' | 'rect' | 'ellipse';

export function isCreationTool(tool: EditorTool): boolean {
  return tool === 'rect' || tool === 'ellipse';
}

export interface EditorUiState {
  unitIndex: number;
  view: ViewTransform;
  tool: EditorTool;
  /** Element ids. Selection is ID-based, never object references (#4). */
  selection: readonly string[];
}

export type EditorUiAction =
  | { type: 'SET_UNIT'; index: number; view: ViewTransform }
  | { type: 'SET_VIEW'; view: ViewTransform }
  | { type: 'SET_TOOL'; tool: EditorTool }
  | { type: 'SET_SELECTION'; ids: readonly string[] }
  | { type: 'TOGGLE_SELECTION'; ids: readonly string[] }
  /** Union, order-preserving: never removes an id (Shift-marquee, contract #6). */
  | { type: 'ADD_TO_SELECTION'; ids: readonly string[] }
  | { type: 'CLEAR_SELECTION' };

export function editorUiReducer(state: EditorUiState, action: EditorUiAction): EditorUiState {
  switch (action.type) {
    case 'SET_UNIT':
      // Navigation auto-fits: the caller computes the fitted view (contract
      // #27 — auto-fit on spread navigation, never on mode toggles).
      // Selection survives navigation; it is filtered for display by the
      // unit being rendered, not discarded.
      return { ...state, unitIndex: action.index, view: action.view };
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'SET_TOOL':
      // Tool changes never touch selection — a creation tool hides the
      // selection affordance while the selection itself persists (#4).
      return state.tool === action.tool ? state : { ...state, tool: action.tool };
    case 'SET_SELECTION':
      return sameIds(state.selection, action.ids) ? state : { ...state, selection: action.ids };
    case 'TOGGLE_SELECTION': {
      const next = [...state.selection];
      for (const id of action.ids) {
        const at = next.indexOf(id);
        if (at === -1) next.push(id);
        else next.splice(at, 1);
      }
      return sameIds(state.selection, next) ? state : { ...state, selection: next };
    }
    case 'ADD_TO_SELECTION': {
      // Shift-click toggles (#5); Shift-marquee ADDS (#6) — it must never
      // deselect an object that was already selected.
      const next = [...state.selection];
      for (const id of action.ids) if (!next.includes(id)) next.push(id);
      return next.length === state.selection.length ? state : { ...state, selection: next };
    }
    case 'CLEAR_SELECTION':
      return state.selection.length === 0 ? state : { ...state, selection: [] };
  }
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
