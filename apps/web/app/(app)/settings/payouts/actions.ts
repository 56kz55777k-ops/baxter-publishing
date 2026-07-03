'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { stripe } from '@/lib/stripe/client';

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://baxter-publishing-web.vercel.app';

/**
 * Begin (or resume) Stripe Connect Express onboarding for the signed-in creator.
 *
 * Creates an Express connected account on first use (storing `stripe_account_id`
 * via the service-role client — the `stripe_*` columns are server-written only,
 * enforced by a DB trigger), requests the `transfers` capability (Baxter charges
 * on its own account and transfers to the creator at fulfilment — D-026), then
 * mints an Account Link and redirects the creator to Stripe's hosted onboarding.
 */
export async function startPayoutOnboarding(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in?next=/settings/payouts');

  const { data: profile } = await supabase
    .from('users')
    .select('id, email, stripe_account_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) redirect('/settings/profile');

  const admin = createAdminClient();
  let accountId = profile.stripe_account_id as string | null;

  if (!accountId) {
    const account = await stripe().accounts.create({
      type: 'express',
      email: profile.email ?? undefined,
      capabilities: { transfers: { requested: true } },
      business_profile: {
        product_description: 'Independent publications sold on Baxter.',
      },
      metadata: { baxter_user_id: profile.id },
    });
    accountId = account.id;
    await admin
      .from('users')
      .update({ stripe_account_id: accountId, updated_at: new Date().toISOString() })
      .eq('id', profile.id);
  }

  const link = await stripe().accountLinks.create({
    account: accountId,
    refresh_url: `${SITE_URL}/settings/payouts?refresh=1`,
    return_url: `${SITE_URL}/settings/payouts?return=1`,
    type: 'account_onboarding',
  });

  redirect(link.url);
}
