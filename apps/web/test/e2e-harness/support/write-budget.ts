/**
 * Slice D stage 8A — the write budget (plan §8.5 "Phases and caps", "Counters", "Synchronous
 * reservation", "Accounting"). HARNESS-ONLY: used by `editor-write-budget.harness.spec.ts` against the
 * local Node mock. It approves no production allowance (Q1) and is wired into no production script.
 *
 * One budget per phase (action | cleanup | recovery), each with its own cap and counters:
 * - attempted: every write request reaching the handler;
 * - admitted: reserved against the cap (then forwarded, or aborted unforwarded — charged either way);
 * - blocked: refused at reservation.
 * Invariants: attempted = admitted + blocked, admitted ≤ cap. `reserve()` has no await between its
 * check and its increment, so concurrent requests on Node's single event loop cannot both pass.
 */

export type Phase = 'action' | 'cleanup' | 'recovery';

export class WriteBudgetExhausted extends Error {
  constructor(readonly phase: Phase, readonly reason: 'cap' | 'closed') {
    super(`write budget ${reason === 'cap' ? 'exhausted' : 'closed'} (${phase})`);
    this.name = 'WriteBudgetExhausted';
  }
}

export class WriteBudget {
  attempted = 0;
  admitted = 0;
  blocked = 0;
  private closedFlag = false;
  private signalled = false;
  private reject!: (e: WriteBudgetExhausted) => void;
  /** Rejects once: at the first refused reservation or when the phase closes. Never resolves. */
  readonly exhausted: Promise<never>;

  constructor(
    readonly phase: Phase,
    readonly cap: number
  ) {
    if (!Number.isInteger(cap) || cap < 0) throw new Error(`invalid cap ${cap}`);
    this.exhausted = new Promise<never>((_, rej) => {
      this.reject = rej;
    });
    this.exhausted.catch(() => undefined); // observed by `step`/callers; never an unhandled rejection
  }

  get closed() {
    return this.closedFlag;
  }

  /** Synchronous check-and-increment. True = admitted (charged); false = blocked (the caller aborts). */
  reserve(): boolean {
    this.attempted += 1;
    if (this.closedFlag || this.admitted >= this.cap) {
      this.blocked += 1;
      this.signal(this.closedFlag ? 'closed' : 'cap');
      return false;
    }
    this.admitted += 1;
    return true;
  }

  /** End the phase: every later write is blocked and `exhausted` rejects. */
  close() {
    this.closedFlag = true;
    this.signal('closed');
  }

  /** Race one await of an action against exhaustion, so the action throws at its next await. */
  step<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, this.exhausted]);
  }

  invariantsHold() {
    return this.attempted === this.admitted + this.blocked && this.admitted <= this.cap;
  }

  snapshot() {
    return { phase: this.phase, cap: this.cap, attempted: this.attempted, admitted: this.admitted, blocked: this.blocked, closed: this.closedFlag };
  }

  private signal(reason: 'cap' | 'closed') {
    if (this.signalled) return;
    this.signalled = true;
    this.reject(new WriteBudgetExhausted(this.phase, reason));
  }
}

export type RequestClass = 'write' | 'auth' | 'other-non-get' | 'read';

/**
 * §8.5 request classes. Write: a non-GET/HEAD/OPTIONS request to the app origin whose path is the
 * fixture publication's editor API. Auth: the sign-in server action POST. Anything else non-GET:
 * blocked, and the run fails.
 */
export function classify(method: string, url: URL, origin: string, apiPath: string): RequestClass {
  const m = method.toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
  if (url.origin === origin && url.pathname === apiPath) return 'write';
  if (url.origin === origin && url.pathname === '/sign-in' && m === 'POST') return 'auth';
  return 'other-non-get';
}
