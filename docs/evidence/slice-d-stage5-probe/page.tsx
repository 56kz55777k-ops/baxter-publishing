/**
 * Slice D stage 5 — real-Konva probe page. NOT production code: not imported
 * by the app, not linted, type-checked, built or run by CI (`docs/` is
 * outside the npm workspaces). Bundled by `run-probe.mjs` with the repo's own
 * esbuild into a standalone page.
 *
 * It mounts the REAL editor — `EditorShell`, `SpreadStage`, `ElementsLayer`,
 * `SelectionTransformer`, `useResizeHost`, `ResizeSession`, the reducer, the
 * real autosave hook, real Konva 10.3.0 and react-konva — on a local fixture
 * document. Only the network is stood in: `fetch` answers every PUT with 200
 * and counts it. No server, no Supabase, no credentials, no production data.
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { addElement, getFormatPreset, newEditorDoc, newEllipseElement, newRectElement, type EditorDoc } from '@baxter/domain';
import { EditorShell } from '@/components/editor/EditorShell';
import { DocumentProvider, useDocumentState } from '@/components/editor/state/document-context';
import { EditorUiProvider, useEditorUi, useEditorUiDispatch } from '@/components/editor/state/editor-ui-context';

declare global {
  interface Window {
    __probe: {
      puts: string[];
      state: () => ReturnType<typeof useDocumentState>;
      ui: () => ReturnType<typeof useEditorUi>;
      uiDispatch: ReturnType<typeof useEditorUiDispatch>;
      ids: { rect: string; ellipse: string };
      clicks: number;
    };
  }
}

const puts: string[] = [];
window.fetch = (async (_url: string, init?: RequestInit) => {
  if ((init?.method ?? 'GET') === 'PUT') puts.push(String(init?.body ?? ''));
  return new Response(JSON.stringify({ revision: 1 + puts.length }), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

const RECT = { ...newRectElement({ x: 20, y: 20 }), width: 40, height: 30 };
const ELLIPSE = { ...newEllipseElement({ x: 30, y: 60 }), width: 24, height: 18 };
let doc: EditorDoc = newEditorDoc(getFormatPreset('zine_a5')!);
doc = addElement(doc, doc.pages[0]!.id, RECT);
doc = addElement(doc, doc.pages[0]!.id, ELLIPSE);

let latestState: ReturnType<typeof useDocumentState>;
let latestUi: ReturnType<typeof useEditorUi>;
function Probe() {
  latestState = useDocumentState();
  latestUi = useEditorUi();
  window.__probe.uiDispatch = useEditorUiDispatch();
  return null;
}

window.__probe = {
  puts,
  state: () => latestState,
  ui: () => latestUi,
  uiDispatch: null as never,
  ids: { rect: RECT.id, ellipse: ELLIPSE.id },
  clicks: 0,
};
document.getElementById('probe-button')!.addEventListener('click', () => void window.__probe.clicks++);

createRoot(document.getElementById('root')!).render(
  <DocumentProvider doc={doc} revision={1}>
    <EditorUiProvider>
      <EditorShell publication={{ id: 'probe', title: 'Stage 5 probe' }} />
      <Probe />
    </EditorUiProvider>
  </DocumentProvider>
);
