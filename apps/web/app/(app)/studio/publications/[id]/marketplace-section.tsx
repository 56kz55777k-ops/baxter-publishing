'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveMarketplace } from './actions';

type Props = {
  publicationId: string;
  initial: {
    subtitle: string;
    description: string;
    price: string;
    edition: string;
  };
  currency: string;
};

const labelClass = 'metadata text-ink-faint';
const inputClass =
  'w-full bg-transparent border-b border-rule focus:border-ink py-2 text-ink text-[0.95rem] outline-none transition-colors duration-300';

/**
 * Workspace marketplace editor (D-016). Editing lives here, in the workspace —
 * not on the submission/review surface. Quiet, hairline-bordered fields; one
 * Save action; no autosave.
 */
export function MarketplaceSection({ publicationId, initial, currency }: Props) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof typeof values>(key: K, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setSaved(false);
  }

  function save() {
    setMessage(null);
    setSaved(false);
    start(async () => {
      const res = await saveMarketplace(publicationId, values);
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setMessage(res.message ?? 'Something prevented the changes from saving.');
      }
    });
  }

  return (
    <div className="space-y-8">
      <div>
        <label className={labelClass} htmlFor="mk-subtitle">
          Subtitle
        </label>
        <input
          id="mk-subtitle"
          type="text"
          value={values.subtitle}
          onChange={(e) => set('subtitle', e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="mk-description">
          Description
        </label>
        <textarea
          id="mk-description"
          rows={4}
          value={values.description}
          onChange={(e) => set('description', e.target.value)}
          className={`${inputClass} resize-none`}
        />
      </div>

      <div className="grid grid-cols-2 gap-8">
        <div>
          <label className={labelClass} htmlFor="mk-price">
            Price ({currency})
          </label>
          <input
            id="mk-price"
            inputMode="decimal"
            value={values.price}
            onChange={(e) => set('price', e.target.value)}
            className={inputClass}
            placeholder="0.00"
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="mk-edition">
            Edition size
          </label>
          <input
            id="mk-edition"
            inputMode="numeric"
            value={values.edition}
            onChange={(e) => set('edition', e.target.value)}
            className={inputClass}
            placeholder="Open edition"
          />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle disabled:opacity-50"
        >
          {pending ? 'Saving' : 'Save'}
        </button>
        {saved && !pending && (
          <span className="metadata text-ink-faint">Saved.</span>
        )}
      </div>

      {message && (
        <p
          role="alert"
          className="text-[0.9rem] text-accent border-l-2 border-accent pl-3"
        >
          {message}
        </p>
      )}
    </div>
  );
}
