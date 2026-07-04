'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { estimateProduction, type Interior } from '@baxter/domain';
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
  /** Inputs to the production estimator (D-029) for the live retail breakdown.
   *  pageCount/interior are null until the file is uploaded and the interior
   *  declared — the breakdown waits for them rather than guessing. */
  estimatorInput: {
    formatPresetId: string;
    pageCount: number | null;
    interior: Interior | null;
    marginBps: number;
  };
};

function money(minor: number, currency: string): string {
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

const labelClass = 'metadata text-ink-faint';
const inputClass =
  'w-full bg-transparent border-b border-rule focus:border-ink py-2 text-ink text-[0.95rem] outline-none transition-colors duration-300';

/**
 * Workspace marketplace editor (D-016). Editing lives here, in the workspace —
 * not on the submission/review surface. Quiet, hairline-bordered fields; one
 * Save action; no autosave.
 */
export function MarketplaceSection({
  publicationId,
  initial,
  currency,
  estimatorInput,
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Live retail breakdown (D-029). "Your earnings per copy" is the only figure
  // the creator sets; Baxter builds retail up from production so the creator can
  // see exactly how the price is formed — print cost, Baxter's margin, and their
  // earnings. Waits until the file is uploaded (page count) and the interior is
  // declared, since both drive the print cost.
  const breakdown = useMemo(() => {
    const { formatPresetId, pageCount, interior, marginBps } = estimatorInput;
    if (!formatPresetId || !pageCount || !interior) return null;
    const earnings = Math.round(Number.parseFloat(values.price || '0') * 100);
    if (!Number.isFinite(earnings) || earnings < 0) return null;
    return estimateProduction({
      formatPresetId,
      pageCount,
      interior,
      creatorEarningsMinor: earnings,
      marginBps,
    });
  }, [estimatorInput, values.price]);

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
            Your earnings per copy ({currency})
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

      {/* Transparent retail breakdown (D-029). Baxter earns by manufacturing,
          not by taxing the creator — so the arithmetic is shown in full. */}
      <div className="border-t border-rule pt-6">
        <p className="metadata text-ink-faint mb-4">How the price is formed</p>
        {breakdown ? (
          <dl className="space-y-2.5 text-[0.9rem]">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Printing &amp; production</dt>
              <dd className="text-ink tabular-nums">
                {money(breakdown.printCostMinor, currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Baxter production margin</dt>
              <dd className="text-ink tabular-nums">
                {money(breakdown.baxterMarginMinor, currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-soft">Your earnings</dt>
              <dd className="text-ink tabular-nums">
                {money(breakdown.creatorEarningsMinor, currency)}
              </dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-rule pt-2.5 mt-1">
              <dt className="font-serif text-ink">Retail price</dt>
              <dd className="font-serif text-ink tabular-nums">
                {money(breakdown.retailMinor, currency)}
              </dd>
            </div>
            <p className="metadata text-ink-faint pt-3 leading-relaxed">
              {breakdown.binding} · {breakdown.paper}. Shipping is calculated
              live at checkout and passed through at cost.
            </p>
          </dl>
        ) : (
          <p className="text-[0.9rem] text-ink-faint leading-relaxed">
            The full breakdown — printing, Baxter&rsquo;s margin, and your
            earnings — appears once the interior is set and the file is uploaded
            (so the page count is known).
          </p>
        )}
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
