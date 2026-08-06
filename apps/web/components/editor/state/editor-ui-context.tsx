'use client';

/**
 * Editor UI context — ephemeral editor state (unit, viewport, tool).
 * Never persisted, never history, never dirty (blueprint §2.4).
 */
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import { PX_PER_MM } from '../geometry';
import { editorUiReducer, type EditorUiAction, type EditorUiState } from './editor-ui';

const StateContext = createContext<EditorUiState | null>(null);
const DispatchContext = createContext<Dispatch<EditorUiAction> | null>(null);

const INITIAL: EditorUiState = {
  unitIndex: 0,
  // Placeholder until the stage measures its viewport and dispatches the
  // first fit (SET_UNIT) — nothing renders from this view before that.
  view: { x: 0, y: 0, scale: PX_PER_MM },
  tool: 'select',
};

export function EditorUiProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(editorUiReducer, INITIAL);
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useEditorUi(): EditorUiState {
  const v = useContext(StateContext);
  if (!v) throw new Error('useEditorUi outside EditorUiProvider');
  return v;
}

export function useEditorUiDispatch(): Dispatch<EditorUiAction> {
  const v = useContext(DispatchContext);
  if (!v) throw new Error('useEditorUiDispatch outside EditorUiProvider');
  return v;
}
