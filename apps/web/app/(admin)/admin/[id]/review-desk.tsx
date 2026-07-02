'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  EDITORIAL_REASON_CODES,
  REASON_CODE_GROUPS,
  type ReasonCodeGroup,
} from '@baxter/domain';
import { decidePublication } from '../actions';

type Props = { publicationId: string };

/**
 * The decision desk (D-020) — writing over clicking.
 *
 * The editor's note is the primary element of this surface: a generous writing
 * space, set in the reading serif, because it is a letter to a person. It is the
 * message the creator reads, in the editor's own words (D-021, Editorial Voice).
 *
 * Reason codes sit quietly beneath it, clearly marked internal. They are for
 * Baxter's records only; the creator never sees them and they never become copy.
 * If a layout tension ever arises, the writing wins.
 */
export function ReviewDesk({ publicationId }: Props) {
  const router = useRouter();
  const [note, setNote] = useState('');
  const [codes, setCodes] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const by: Record<ReasonCodeGroup, typeof EDITORIAL_REASON_CODES[number][]> = {
      production: [],
      content: [],
      editorial_fit: [],
    };
    for (const c of EDITORIAL_REASON_CODES) by[c.group].push(c);
    return by;
  }, []);

  function toggle(id: string) {
    setCodes((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function decide(decision: 'publish' | 'revise') {
    setMessage(null);
    if (decision === 'revise' && !note.trim()) {
      setMessage('A note is needed to return this to the creator.');
      return;
    }
    start(async () => {
      const res = await decidePublication({
        publicationId,
        decision,
        note,
        reasonCodes: [...codes],
      });
      if (res.ok) {
        router.push('/admin');
        router.refresh();
      } else {
        setMessage(res.message ?? 'Something prevented the decision from saving.');
      }
    });
  }

  return (
    <div>
      {/* The note — the primary output of the review (D-020). */}
      <label className="metadata text-ink-faint" htmlFor="editorial-note">
        Your note to the creator
      </label>
      <p className="text-[0.85rem] text-ink-faint mt-1 mb-4 max-w-measure">
        Written in your words. The creator reads this. Required to return the
        work; optional when publishing.
      </p>
      <textarea
        id="editorial-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={12}
        className="w-full bg-transparent border border-rule focus:border-ink p-5 font-serif text-body text-ink leading-relaxed outline-none resize-y transition-colors duration-300"
      />

      {/* Reason codes — internal metadata, deliberately quiet and secondary. */}
      <details className="mt-10 group">
        <summary className="metadata text-ink-faint cursor-pointer list-none select-none hover:text-ink transition-colors duration-300">
          For Baxter&rsquo;s records
        </summary>
        <p className="text-[0.8rem] text-ink-faint mt-2 max-w-measure">
          Internal only. The creator never sees these. They help Baxter keep
          track of its own editorial patterns; they are not part of your note.
        </p>
        <div className="mt-6 space-y-8">
          {(Object.keys(grouped) as ReasonCodeGroup[]).map((g) => (
            <fieldset key={g}>
              <legend className="metadata text-ink-faint mb-3">
                {REASON_CODE_GROUPS[g]}
              </legend>
              <div className="space-y-2">
                {grouped[g].map((c) => (
                  <label
                    key={c.id}
                    className="flex items-baseline gap-3 text-[0.9rem] text-ink-soft cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={codes.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="accent-ink"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
        </div>
      </details>

      {/* The two decisions (D-019). No third path; declining is revisions + note. */}
      <div className="mt-12 pt-8 border-t border-rule flex items-center gap-10">
        <button
          type="button"
          onClick={() => decide('publish')}
          disabled={pending}
          className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle disabled:opacity-50"
        >
          {pending ? 'Working' : 'Publish'}
        </button>
        <button
          type="button"
          onClick={() => decide('revise')}
          disabled={pending}
          className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink-soft border-b border-transparent pb-1 hover:text-ink hover:border-ink transition-colors duration-400 ease-gentle disabled:opacity-50"
        >
          Request revisions
        </button>
      </div>

      {message && (
        <p
          role="alert"
          className="mt-8 text-[0.9rem] text-accent border-l-2 border-accent pl-3"
        >
          {message}
        </p>
      )}
    </div>
  );
}
