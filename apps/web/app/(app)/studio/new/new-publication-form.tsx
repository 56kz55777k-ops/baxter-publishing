'use client';

import { useActionState } from 'react';
import { createPublication, type CreatePublicationState } from './actions';
import {
  PUBLICATION_FORMAT_PRESETS,
  PUBLICATION_CATEGORIES,
} from '@baxter/domain';

const initialState: CreatePublicationState = { status: 'idle' };

export function NewPublicationForm() {
  const [state, formAction, pending] = useActionState(createPublication, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-10" noValidate>
      <label className="flex flex-col gap-2">
        <span className="metadata">Title</span>
        <input
          name="title"
          type="text"
          required
          maxLength={120}
          disabled={pending}
          className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300"
        />
      </label>

      <fieldset className="flex flex-col gap-4" disabled={pending}>
        <legend className="metadata mb-2">Format</legend>
        {PUBLICATION_FORMAT_PRESETS.map((preset) => (
          <label
            key={preset.id}
            className="flex items-baseline gap-3 cursor-pointer"
          >
            <input
              type="radio"
              name="formatPresetId"
              value={preset.id}
              required
              className="accent-ink mt-1"
            />
            <span>
              <span className="font-serif text-body text-ink">{preset.name}</span>
              <span className="metadata text-ink-faint ml-3">
                {preset.trimWidthMm} × {preset.trimHeightMm} mm
              </span>
              <span className="block text-[0.85rem] text-ink-faint mt-1">
                {preset.description}
              </span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex flex-col gap-2">
        <span className="metadata">Category</span>
        <select
          name="category"
          required
          disabled={pending}
          defaultValue=""
          className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300"
        >
          <option value="" disabled>
            Choose a category
          </option>
          {PUBLICATION_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-2">
        <span className="metadata">Page count</span>
        <input
          name="pageCount"
          type="number"
          min={1}
          max={2000}
          required
          disabled={pending}
          className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300"
        />
        <span className="text-[0.8rem] text-ink-faint">Including covers.</span>
      </label>

      {state.status === 'error' && (
        <p
          role="alert"
          className="text-[0.9rem] text-accent border-l-2 border-accent pl-3"
        >
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="font-shell text-[0.85rem] tracking-[0.1em] uppercase border border-ink text-ink py-3 px-6 self-start hover:bg-ink hover:text-canvas transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Saving…' : 'Save as draft'}
      </button>
    </form>
  );
}
