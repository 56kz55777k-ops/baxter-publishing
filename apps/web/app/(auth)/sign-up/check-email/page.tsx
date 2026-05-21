import Link from 'next/link';

export const metadata = {
  title: 'Check your email — Baxter',
};

export default function CheckEmailPage() {
  return (
    <article className="max-w-[28rem] mx-auto pt-8">
      <p className="metadata mb-4">Account</p>
      <h1 className="text-[2rem] leading-[1.15] tracking-tight mb-6">
        Check your email.
      </h1>
      <p className="text-ink-soft mb-4 prose-editorial">
        Baxter sent a confirmation link to the address you provided. Click the
        link to finish setting up your account.
      </p>
      <p className="text-ink-soft mb-10 prose-editorial">
        If the email does not arrive within a few minutes, check the spam
        folder, or sign up again with a different address.
      </p>

      <div className="pt-6 rule">
        <p className="text-[0.9rem] text-ink-soft">
          <Link
            href="/sign-in"
            className="text-ink underline underline-offset-4 decoration-rule hover:decoration-accent"
          >
            Return to sign in
          </Link>
          .
        </p>
      </div>
    </article>
  );
}
