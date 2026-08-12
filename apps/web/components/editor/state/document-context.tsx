'use client';

/**
 * Document context — one of the two contexts in the state architecture
 * (blueprint §2.3/§2.4): document + history + save machine phase. Split from
 * EditorUiContext so viewport/tool churn never re-renders document consumers
 * and vice versa.
 */
import { createContext, useContext, useReducer, useState, type Dispatch, type ReactNode } from 'react';
import type { EditorDoc } from '@baxter/domain';
import {
  documentReducer,
  initialDocumentState,
  type DocumentAction,
  type DocumentState,
} from './reducer';

const StateContext = createContext<DocumentState | null>(null);
const DispatchContext = createContext<Dispatch<DocumentAction> | null>(null);

export function DocumentProvider({
  doc,
  revision,
  children,
}: {
  doc: EditorDoc;
  revision: number;
  children: ReactNode;
}) {
  const [clientId] = useState(() => crypto.randomUUID());
  // useReducer reads its initial argument exactly once, on mount — mount-time
  // props are the authority for the page's life (ADR-003); no memo needed.
  const [state, dispatch] = useReducer(
    documentReducer,
    { doc, revision, clientId },
    initialDocumentState
  );
  return (
    <StateContext.Provider value={state}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  );
}

export function useDocumentState(): DocumentState {
  const v = useContext(StateContext);
  if (!v) throw new Error('useDocumentState outside DocumentProvider');
  return v;
}

export function useDocumentDispatch(): Dispatch<DocumentAction> {
  const v = useContext(DispatchContext);
  if (!v) throw new Error('useDocumentDispatch outside DocumentProvider');
  return v;
}
