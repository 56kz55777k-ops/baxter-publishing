'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleEditorPick } from './actions';

/**
 * Admin-only Editor's Pick control (D-024 — the Editor's voice).
 *
 * A quiet toggle, shown only to an admin, kept visually apart from the public
 * page it sits on. Selecting is an editorial act; the placement on the shelf is
 * the editorial statement — there is no note in v1 (D-023).
 */
export function EditorPickToggle({
  publicationId,
  handle,
  slug,
  isPicked,
}: {
  publicationId: string;
  handle: string;
  slug: string;
  isPicked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function toggle() {
    setMessage(null);
    start(async () => {
      const res = await toggleEditorPick(publicationId, handle, slug);
      if (res.ok) router.refresh();
      else setMessage(res.message ?? 'Something prevented the change.');
    });
  }

  return (
    <div>
      <p className="metadata text-ink-faint mb-3">Editor</p>
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft border-b border-rule pb-1 hover:text-ink hover:border-ink transition-colors duration-300 disabled:opacity-50"
      >
        {pending
          ? 'Working'
          : isPicked
            ? "Remove from Editor's Picks"
            : "Select as Editor's Pick"}
      </button>
      {isPicked && !pending && (
        <p className="metadata text-ink-faint mt-3">
          This work is an Editor&rsquo;s Pick.
        </p>
      )}
      {message && (
        <p role="alert" className="text-[0.9rem] text-accent border-l-2 border-accent pl-3 mt-4">
          {message}
        </p>
      )}
    </div>
  );
}
