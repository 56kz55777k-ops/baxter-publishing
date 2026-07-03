/* eslint-disable @next/next/no-img-element -- Cloudflare Images delivery URLs. */
import Link from 'next/link';
import type { PublicationCard as Card } from '@/lib/marketplace/queries';

/**
 * A single publication, as it appears on a shelf (D-023).
 *
 * Strict hierarchy, four lines, nothing else:
 *   1. Cover   — the protagonist, given the space
 *   2. Title
 *   3. Creator
 *   4. Price   — the quietest line; information, not persuasion
 *
 * No badges, no "From…", no CTA, no urgency, no availability. Price is set like
 * page count or edition size. Hover is a quiet colour shift — no scale, no
 * shadow, no spring (Constitution §Marketplace browsing).
 */
function formatPrice(minor: number | null, currency: string): string | null {
  if (minor === null || minor === undefined) return null;
  return `$${(minor / 100).toFixed(2)} ${currency}`;
}

export function PublicationCard({ card }: { card: Card }) {
  const price = formatPrice(card.priceMinor, card.currency);
  return (
    <Link href={card.href} className="group block">
      {/* 1. Cover */}
      {card.coverUrl ? (
        <img
          src={card.coverUrl}
          alt={`${card.title} — cover`}
          className="w-full h-auto border border-rule"
        />
      ) : (
        // Restrained placeholder — a quiet solid field, never stock imagery.
        <div className="w-full aspect-[3/4] border border-rule bg-ink/[0.03]" />
      )}

      {/* 2. Title */}
      <p className="font-serif text-body text-ink mt-5 group-hover:text-accent transition-colors duration-300">
        {card.title}
      </p>

      {/* 3. Creator */}
      <p className="metadata text-ink-soft mt-2">{card.creatorName}</p>

      {/* 4. Price — quietest element on the card */}
      {price && <p className="metadata text-ink-faint mt-1">{price}</p>}
    </Link>
  );
}

/**
 * A shelf: an optional heading (+ optional "see more" link) over a quiet grid of
 * cards. Three across at desktop, generous gutters, tops aligned; covers keep
 * their natural aspect (no cropping the creator's work). Reused by the homepage
 * sections, the browse view, and the creator profile.
 */
export function PublicationShelf({
  title,
  href,
  hrefLabel = 'All publications',
  cards,
}: {
  title?: string;
  href?: string;
  hrefLabel?: string;
  cards: Card[];
}) {
  return (
    <section>
      {(title || href) && (
        <div className="flex items-baseline justify-between mb-10">
          {title ? <p className="metadata">{title}</p> : <span />}
          {href && (
            <Link
              href={href}
              className="font-shell text-[0.72rem] tracking-[0.08em] uppercase text-ink-faint hover:text-ink transition-colors duration-300"
            >
              {hrefLabel}
            </Link>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-12 gap-y-16 items-start">
        {cards.map((card) => (
          <PublicationCard key={card.id} card={card} />
        ))}
      </div>
    </section>
  );
}
