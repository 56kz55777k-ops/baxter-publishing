'use client';

/**
 * The gate in front of the island (blueprint §2.1): a coarse pointer or a
 * small viewport gets the desk message and the island is NEVER imported —
 * next/dynamic only fetches the editor (and Konva) chunk when the gate
 * renders it (DoD F8: network shows no editor chunk on mobile).
 */
import { useEffect, useState } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

const MIN_VIEWPORT_PX = 900;

const EditorIsland = dynamic(() => import('./editor-island'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh items-center justify-center bg-canvas">
      <p className="metadata text-ink-faint">Opening the editor…</p>
    </div>
  ),
});

export function EditorGate(props: {
  publicationId: string;
  title: string;
  docRow: { doc: unknown; revision: number } | null;
}) {
  const [atADesk, setAtADesk] = useState<boolean | null>(null);

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    const small = window.innerWidth < MIN_VIEWPORT_PX;
    setAtADesk(!(coarse || small));
  }, []);

  if (atADesk === null) {
    return <div className="h-dvh bg-canvas" aria-hidden />;
  }

  if (!atADesk) {
    return (
      <main className="flex h-dvh items-center justify-center bg-canvas px-8" data-testid="desk-gate">
        <div className="max-w-measure">
          <p className="metadata text-ink-faint mb-4">Editor</p>
          <h1 className="font-serif text-h2 leading-tight">The editor opens at a desk.</h1>
          <p className="font-serif text-body text-ink-soft mt-6">
            Native publishing needs a pointer and room to compose. Open this publication in a
            desktop browser to continue.
          </p>
          <p className="mt-8">
            <Link
              href={`/studio/publications/${props.publicationId}`}
              className="metadata text-accent underline underline-offset-4 hover:text-ink transition-colors duration-400 ease-gentle"
            >
              Back to the workspace
            </Link>
          </p>
        </div>
      </main>
    );
  }

  return <EditorIsland {...props} />;
}

