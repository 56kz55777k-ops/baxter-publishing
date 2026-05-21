import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SignInForm } from './sign-in-form';

export const metadata = {
  title: 'Sign in — Baxter',
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { next } = await searchParams;
  if (user) {
    // If already signed in, honor `next` as long as it's a relative path.
    const target =
      next && next.startsWith('/') && !next.startsWith('//') ? next : '/studio';
    redirect(target);
  }

  return (
    <article className="max-w-[28rem] mx-auto pt-8">
      <p className="metadata mb-4">Account</p>
      <h1 className="text-[2rem] leading-[1.15] tracking-tight mb-6">
        Sign in to Baxter.
      </h1>

      <SignInForm next={next} />

      <div className="mt-10 pt-6 rule">
        <p className="text-[0.9rem] text-ink-soft">
          New to Baxter?{' '}
          <Link href="/sign-up" className="text-ink underline underline-offset-4 decoration-rule hover:decoration-accent">
            Create an account
          </Link>
          .
        </p>
      </div>
    </article>
  );
}
