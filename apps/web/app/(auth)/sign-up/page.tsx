import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SignUpForm } from './sign-up-form';

export const metadata = {
  title: 'Create an account — Baxter',
  description:
    'Begin by giving Baxter an email address and a password.',
};

export default async function SignUpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect('/studio');

  return (
    <article className="max-w-[28rem] mx-auto pt-8">
      <p className="metadata mb-4">Account</p>
      <h1 className="text-[2rem] leading-[1.15] tracking-tight mb-6">
        Create an account on Baxter.
      </h1>
      <p className="text-ink-soft mb-10 prose-editorial">
        Begin by giving Baxter an email address and a password. After that,
        choose how your name appears on your publications.
      </p>

      <SignUpForm />

      <div className="mt-10 pt-6 rule">
        <p className="text-[0.9rem] text-ink-soft">
          Already have an account?{' '}
          <Link href="/sign-in" className="text-ink underline underline-offset-4 decoration-rule hover:decoration-accent">
            Sign in
          </Link>
          .
        </p>
      </div>
    </article>
  );
}
