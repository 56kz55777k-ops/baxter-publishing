'use client';

import { useActionState } from 'react';
import { claimHandle, type ProfileState } from './actions';

const initialState: ProfileState = { status: 'idle' };

export function ClaimHandleForm() {
  const [state, formAction, pending] = useActionState(claimHandle, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <label className="flex flex-col gap-2">
        <span className="metadata">Handle</span>
        <div className="flex items-baseline border-b border-rule focus-within:border-ink transition-colors duration-300">
          <span className="font-shell text-[0.95rem] text-ink-faint pr-1">baxter.press/</span>
          <input
            name="handle"
            type="text"
            required
            disabled={pending}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={24}
            pattern="[a-z][a-z0-9-]{1,22}[a-z0-9]"
            className="bg-transparent flex-1 py-2 text-[1.05rem] text-ink focus:outline-none"
          />
        </div>
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
        {pending ? 'Claiming…' : 'Claim handle'}
      </button>
    </form>
  );
}
