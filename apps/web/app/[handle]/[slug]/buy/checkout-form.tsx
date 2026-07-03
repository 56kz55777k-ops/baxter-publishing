'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  AddressElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

/**
 * The Payment Element, hosted inside Baxter (D-027) so checkout keeps the
 * publishing atmosphere rather than bouncing to a Stripe-branded page. The
 * appearance is tuned to Baxter's palette; the form asks exactly what payment
 * needs and nothing more. On success Stripe redirects to the return URL; the
 * order itself is created by the webhook (the reliable source of truth).
 */
function InnerForm({
  collectShipping,
  returnUrl,
  totalLabel,
}: {
  collectShipping: boolean;
  returnUrl: string;
  totalLabel: string;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function pay(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setPending(true);
    setMessage(null);
    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: `${window.location.origin}${returnUrl}` },
    });
    // If confirmPayment returns, it failed (success redirects away).
    setMessage(error.message ?? 'The payment could not be completed.');
    setPending(false);
  }

  return (
    <form onSubmit={pay} className="space-y-8">
      {collectShipping && (
        <div>
          <p className="metadata text-ink-faint mb-3">Where should it ship?</p>
          <AddressElement options={{ mode: 'shipping' }} />
        </div>
      )}
      <div>
        <p className="metadata text-ink-faint mb-3">Payment</p>
        <PaymentElement />
      </div>
      <button
        type="submit"
        disabled={!stripe || pending}
        className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle disabled:opacity-50"
      >
        {pending ? 'Processing' : `Pay ${totalLabel}`}
      </button>
      {message && (
        <p role="alert" className="text-[0.9rem] text-accent border-l-2 border-accent pl-3">
          {message}
        </p>
      )}
    </form>
  );
}

export function CheckoutForm({
  publishableKey,
  clientSecret,
  collectShipping,
  returnUrl,
  totalLabel,
}: {
  publishableKey: string;
  clientSecret: string;
  collectShipping: boolean;
  returnUrl: string;
  totalLabel: string;
}) {
  const stripePromise = useMemo(
    () => (publishableKey ? loadStripe(publishableKey) : null),
    [publishableKey]
  );

  if (!stripePromise || !clientSecret) {
    return (
      <p className="font-serif text-body text-ink-soft">
        Payment is temporarily unavailable. Try again shortly.
      </p>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: 'stripe',
          variables: {
            colorPrimary: '#8a2820',
            colorText: '#1a1a1a',
            colorBackground: '#f5f3ee',
            colorDanger: '#8a2820',
            fontFamily: 'inherit',
            borderRadius: '0px',
            spacingUnit: '4px',
          },
        },
      }}
    >
      <InnerForm
        collectShipping={collectShipping}
        returnUrl={returnUrl}
        totalLabel={totalLabel}
      />
    </Elements>
  );
}
