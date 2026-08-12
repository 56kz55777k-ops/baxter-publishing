'use client';

/**
 * The editor island — the only module tree that imports Konva. Loaded via
 * next/dynamic (ssr: false) from the gate, so none of this touches the
 * shared First-Load JS.
 *
 * Boot: an existing document arrives as a server-component prop (amendment
 * A2 — no GET endpoint); a first-time publication initializes through an
 * explicit POST (create-if-absent, race-safe server-side; StrictMode's
 * double-effect is harmless for the same reason). Every path through boot
 * runs parseEditorDoc — a document that cannot be re-saved is never rendered
 * (calm situation screen instead of a crash).
 */
import { useEffect, useState } from 'react';
import { parseEditorDoc, type EditorDoc } from '@baxter/domain';
import { EditorShell } from '@/components/editor/EditorShell';
import { DocumentProvider } from '@/components/editor/state/document-context';
import { EditorUiProvider } from '@/components/editor/state/editor-ui-context';

type Boot =
  | { kind: 'loading' }
  | { kind: 'ready'; doc: EditorDoc; revision: number }
  | { kind: 'error'; message: string };

export default function EditorIsland({
  publicationId,
  title,
  docRow,
}: {
  publicationId: string;
  title: string;
  docRow: { doc: unknown; revision: number } | null;
}) {
  const [boot, setBoot] = useState<Boot>({ kind: 'loading' });

  useEffect(() => {
    performance.mark('baxter:editor:island-mounted');
    let cancelled = false;

    async function bootUp() {
      try {
        if (docRow) {
          const doc = parseEditorDoc(docRow.doc);
          if (!cancelled) setBoot({ kind: 'ready', doc, revision: docRow.revision });
          return;
        }
        const res = await fetch(`/api/editor/${publicationId}`, { method: 'POST' });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { message?: string };
          if (!cancelled) {
            setBoot({
              kind: 'error',
              message: body.message ?? 'Something prevented the document from being created.',
            });
          }
          return;
        }
        const json = (await res.json()) as { doc: unknown; revision: number };
        const doc = parseEditorDoc(json.doc);
        if (!cancelled) setBoot({ kind: 'ready', doc, revision: json.revision });
      } catch {
        if (!cancelled) {
          setBoot({
            kind: 'error',
            message: 'This document could not be read safely, so the editor is standing back rather than risking it.',
          });
        }
      }
    }

    void bootUp();
    return () => {
      cancelled = true;
    };
    // docRow/publicationId are stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (boot.kind === 'loading') {
    return (
      <div className="flex h-dvh items-center justify-center bg-canvas">
        <p className="metadata text-ink-faint">Opening the editor…</p>
      </div>
    );
  }

  if (boot.kind === 'error') {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas px-8">
        <div className="max-w-measure">
          <p className="metadata text-ink-faint mb-4">Editor</p>
          <p className="font-serif text-lede text-ink">{boot.message}</p>
          <p className="text-caption text-ink-soft mt-6">
            <a href="" onClick={(e) => { e.preventDefault(); window.location.reload(); }} className="text-accent underline underline-offset-4">
              Try again
            </a>
          </p>
        </div>
      </main>
    );
  }

  return (
    <DocumentProvider doc={boot.doc} revision={boot.revision}>
      <EditorUiProvider>
        <EditorShell publication={{ id: publicationId, title }} />
      </EditorUiProvider>
    </DocumentProvider>
  );
}
