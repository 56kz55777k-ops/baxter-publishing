import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe, stripeConfigured } from '@/lib/stripe/client';
import { startPayoutOnboarding } from './actions';

export const metadata = {
  title: 'Payouts — Baxter',
};

/**
 * Payouts — the one question this screen answers: can Baxter pay you?
 *
 * A creator sets up Stripe Connect Express here so that, when their work sells,
 * Baxter can transfer their share at fulfilment. Payout status is synced from
 * Stripe on load (and by the `account.updated` webhook). Nothing here performs a
 * transaction — it only establishes the payout relationship.
 */
export default async function PayoutsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/settings/payouts');

  const { data: profile } = await supabase
    .from('users')
    .select('id, stripe_account_id, stripe_charges_enabled')
    .eq('id', user.id)
    .maybeSingle();

  const accountId = profile?.stripe_account_id as string | null;
  let chargesEnabled = Boolean(profile?.stripe_charges_enabled);

  // Sync live status from Stripe (charges/transfers ready?), tolerant of Stripe
  // being unconfigured or the account being mid-onboarding.
  if (accountId && stripeConfigured()) {
    try {
      const account = await stripe().accounts.retrieve(accountId);
      const ready = Boolean(account.charges_enabled && account.payouts_enabled);
      if (ready !== chargesEnabled) {
        await createAdminClient()
          .from('users')
          .update({ stripe_charges_enabled: ready, updated_at: new Date().toISOString() })
          .eq('id', user.id);
        chargesEnabled = ready;
      }
    } catch {
      // Non-fatal: show the last-known status.
    }
  }

  const started = Boolean(accountId);

  return (
    <main className="px-gutter py-24 max-w-[44rem]">
      <p className="metadata mb-4">Payouts</p>
      <h1 className="font-serif text-h1 leading-[1.05] tracking-tight">
        Can Baxter pay you?
      </h1>

      <section className="mt-12 pt-10 border-t border-rule">
        {chargesEnabled ? (
          <>
            <p className="font-serif text-body text-ink">Payouts are set up.</p>
            <p className="metadata text-ink-faint mt-3 max-w-measure">
              When your work sells, Baxter holds the payment and transfers your
              share once the order is fulfilled.
            </p>
          </>
        ) : (
          <>
            <p className="font-serif text-body text-ink">
              {started
                ? 'Your payout setup is not finished.'
                : 'Baxter cannot pay you yet.'}
            </p>
            <p className="metadata text-ink-faint mt-3 max-w-measure">
              To sell work on Baxter, connect a payout account through Stripe.
              Baxter holds each payment and transfers your share once the order
              is fulfilled.
            </p>
            <form action={startPayoutOnboarding} className="mt-10">
              <button
                type="submit"
                className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle"
              >
                {started ? 'Continue payout setup' : 'Set up payouts'}
              </button>
            </form>
          </>
        )}
      </section>

      <div className="mt-16">
        <Link
          href="/settings/profile"
          className="font-shell text-[0.75rem] tracking-[0.08em] uppercase text-ink-soft hover:text-ink transition-colors duration-300"
        >
          Back to settings
        </Link>
      </div>
    </main>
  );
}
