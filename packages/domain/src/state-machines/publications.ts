/**
 * Publication state machine.
 *
 * Pure TypeScript. No I/O, no React, no Drizzle. This file is the rulebook
 * that both the app layer and (eventually) DB triggers consult to decide
 * whether a transition is legal.
 *
 * The Editorial Constitution applies even here: a creator should never see
 * a button for an illegal action. Compute permissions from `canTransition`.
 */

export type PublicationStatus =
  | 'draft'
  | 'in_review'
  | 'revisions'
  | 'published'
  | 'unpublished'
  | 'archived';

/** Who is attempting the transition. */
export type Actor = 'creator' | 'admin' | 'system';

/** Legal transitions, keyed by source state. */
const TRANSITIONS: Record<
  PublicationStatus,
  Array<{ to: PublicationStatus; by: Actor[] }>
> = {
  draft: [
    { to: 'in_review', by: ['creator'] },
    { to: 'archived', by: ['creator', 'admin'] },
  ],
  in_review: [
    { to: 'published', by: ['admin'] },
    { to: 'revisions', by: ['admin'] },
    { to: 'draft', by: ['creator'] }, // creator withdraws
  ],
  revisions: [
    { to: 'in_review', by: ['creator'] }, // resubmit
    { to: 'draft', by: ['creator'] },
    { to: 'archived', by: ['creator', 'admin'] },
  ],
  published: [
    { to: 'unpublished', by: ['creator', 'admin'] },
    { to: 'archived', by: ['admin'] },
  ],
  unpublished: [
    { to: 'published', by: ['admin'] },
    { to: 'archived', by: ['creator', 'admin'] },
  ],
  archived: [], // terminal
};

export interface TransitionRequest {
  from: PublicationStatus;
  to: PublicationStatus;
  by: Actor;
}

export interface TransitionResult {
  ok: boolean;
  /** Human-readable reason when ok = false. Surfaced in logs, not UI. */
  reason?: string;
}

/**
 * Is this transition legal for this actor?
 */
export function canTransition({ from, to, by }: TransitionRequest): TransitionResult {
  if (from === to) {
    return { ok: false, reason: 'No-op transition.' };
  }
  const legal = TRANSITIONS[from];
  const match = legal.find((t) => t.to === to);
  if (!match) {
    return { ok: false, reason: `Illegal transition: ${from} → ${to}.` };
  }
  if (!match.by.includes(by)) {
    return { ok: false, reason: `Actor ${by} cannot perform ${from} → ${to}.` };
  }
  return { ok: true };
}

/**
 * All states reachable in one step from `from` for the given actor.
 * Use this to drive UI affordances.
 */
export function nextStates(from: PublicationStatus, by: Actor): PublicationStatus[] {
  return TRANSITIONS[from].filter((t) => t.by.includes(by)).map((t) => t.to);
}

/** Terminal? */
export function isTerminal(status: PublicationStatus): boolean {
  return TRANSITIONS[status].length === 0;
}
