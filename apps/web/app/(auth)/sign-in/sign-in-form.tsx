'use client';

import { useActionState } from 'react';
import { signIn, type AuthState } from '../actions';

const initialState: AuthState = { status: 'idle' };

export function SignInForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(signIn, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-6" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        disabled={pending}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        disabled={pending}
      />

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
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}

function Field({
  label,
  helperText,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  helperText?: string;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="metadata">{label}</span>
      <input
        {...props}
        className="bg-transparent border-b border-rule py-2 text-[1.05rem] text-ink focus:outline-none focus:border-ink transition-colors duration-300"
      />
      {helperText && <span className="text-[0.8rem] text-ink-faint">{helperText}</span>}
    </label>
  );
}
