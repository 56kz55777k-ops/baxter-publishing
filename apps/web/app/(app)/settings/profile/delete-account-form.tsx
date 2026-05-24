'use client';

import { useActionState } from 'react';
import { deleteAccount, type DeleteAccountState } from './actions';

const initialState: DeleteAccountState = { status: 'idle' };

/**
 * Account deletion form.
 *
 * Type-handle-to-confirm guards against misfires without staging an
 * "are you absolutely sure" modal. One step, composed.
 */
export function DeleteAccountForm({ handle }: { handle: string }) {
  const [state, formAction, pending] = useActionState(deleteAccount, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      <label className="flex flex-col gap-2">
        <span className="metadata">Confirm your handle</span>
        <input
          name="handle"
          type="text"
          required
          disabled={pending}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={24}
          className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300"
        />
        <span className="text-[0.8rem] text-ink-faint">
          Type {handle} to confirm.
        </span>
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
        {pending ? 'Removing…' : 'Delete account'}
      </button>
    </form>
  );
}
