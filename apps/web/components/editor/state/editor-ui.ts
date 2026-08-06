/**
 * Editor UI state — the second context of the two-context architecture
 * (blueprint §2.4). Ephemeral by definition: never persisted, never history,
 * never dirties the document. Slice A carries exactly what the empty surface
 * needs — unit index, viewport, tool — and nothing speculative; selection and
 * mode state arrive with the slices that own them (B and I) so the shape is
 * extended rather than reshaped.
 */

export interface ViewTransform {
  /** Screen px offset of the unit origin. */
  x: number;
  y: number;
  /** Screen px per mm — PX_PER_MM × zoom factor is pre-multiplied here. */
  scale: number;
}

export type EditorTool = 'select' | 'hand';

export interface EditorUiState {
  unitIndex: number;
  view: ViewTransform;
  tool: EditorTool;
}

export type EditorUiAction =
  | { type: 'SET_UNIT'; index: number; view: ViewTransform }
  | { type: 'SET_VIEW'; view: ViewTransform }
  | { type: 'SET_TOOL'; tool: EditorTool };

export function editorUiReducer(state: EditorUiState, action: EditorUiAction): EditorUiState {
  switch (action.type) {
    case 'SET_UNIT':
      // Navigation auto-fits: the caller computes the fitted view (contract
      // #27 — auto-fit on spread navigation, never on mode toggles).
      return { ...state, unitIndex: action.index, view: action.view };
    case 'SET_VIEW':
      return { ...state, view: action.view };
    case 'SET_TOOL':
      return { ...state, tool: action.tool };
  }
}
