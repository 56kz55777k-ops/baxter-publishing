'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { OrderStatus } from '@baxter/domain';
import { advanceOrder } from '../actions';

const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  in_fulfillment: 'Begin fulfilment',
  fulfilled: 'Mark fulfilled',
  cancelled: 'Cancel order',
};

/**
 * The desk's fulfilment control — one button per legal next state (D-016 voice:
 * plain verbs, no workflow chrome). "Mark fulfilled" is the moment the creator's
 * earnings are released, so it is stated, not styled as a celebration.
 */
export function FulfilmentControl({
  orderId,
  nextStates,
}: {
  orderId: string;
  nextStates: OrderStatus[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (nextStates.length === 0) return null;

  function advance(to: OrderStatus) {
    setMessage(null);
    start(async () => {
      const res = await advanceOrder(orderId, to);
      if (res.ok) router.refresh();
      else setMessage(res.message);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-4">
        {nextStates.map((to) => (
          <button
            key={to}
            type="button"
            disabled={pending}
            onClick={() => advance(to)}
            className="font-shell text-[0.8125rem] tracking-[0.12em] uppercase text-ink border-b border-ink pb-1 hover:text-accent hover:border-accent transition-colors duration-400 ease-gentle disabled:opacity-50"
          >
            {pending ? 'Working' : (ACTION_LABEL[to] ?? to)}
          </button>
        ))}
      </div>
      {message && (
        <p
          role="alert"
          className="text-[0.9rem] text-accent border-l-2 border-accent pl-3"
        >
          {message}
        </p>
      )}
    </div>
  );
}
