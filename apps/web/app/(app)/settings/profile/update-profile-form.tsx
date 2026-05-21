'use client';

import { useActionState } from 'react';
import { updateProfile, type ProfileState } from './actions';

const initialState: ProfileState = { status: 'idle' };

export function UpdateProfileForm({
  initialDisplayName,
  initialBio,
}: {
  initialDisplayName: string;
  initialBio: string;
}) {
  const [state, formAction, pending] = useActionState(updateProfile, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <label className="flex flex-col gap-2">
        <span className="metadata">Display name</span>
        <input
          name="display_name"
          type="text"
          required
          maxLength={64}
          defaultValue={initialDisplayName}
          disabled={pending}
          className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300"
        />
      </label>

      <label className="flex flex-col gap-2">
        <span className="metadata">Bio</span>
        <textarea
          name="bio"
          rows={4}
          maxLength={600}
          defaultValue={initialBio}
          disabled={pending}
          placeholder="A sentence or two on what you make."
          className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300 resize-none"
        />
        <span className="text-[0.8rem] text-ink-faint">Up to 600 characters.</span>
      </label>

      {state.status === 'error' && (
        <p
          role="alert"
          className="text-[0.9rem] text-accent border-l-2 border-accent pl-3"
        >
          {state.message}
        </p>
      )}
      {state.status === 'success' && (
        <p className="text-[0.9rem] text-ink-soft border-l-2 border-ink-faint pl-3">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="font-shell text-[0.85rem] tracking-[0.1em] uppercase border border-ink text-ink py-3 px-6 self-start hover:bg-ink hover:text-canvas transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
