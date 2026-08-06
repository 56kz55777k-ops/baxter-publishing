/**
 * Autosave scheduler — the timing/ordering core, free of React and fetch so
 * every behaviour runs under fake timers (blueprint §2.5).
 *
 * Contract:
 * - Debounce 2 s from the LAST commit; max-wait 10 s from the FIRST unsaved
 *   commit, so continuous editing still reaches the server.
 * - ONE in-flight save. Commits during flight mark dirty; when the flight
 *   resolves and dirt remains, the debounce restarts. A save is never aborted
 *   (idempotent by revision); late responses are ordering-safe because the
 *   reducer pins savedDoc to the exact acknowledged payload reference.
 * - Failure retries at 10 s → 30 s → 60 s, holding at 60 s. New commits mark
 *   dirty but do NOT shorten the backoff; a success resets the ladder.
 * - 'conflict' and 'window-closed' outcomes are terminal: all timers stop,
 *   nothing is scheduled again for the life of this machine.
 *
 * The driver (React hook) supplies `performSave`, which captures the current
 * doc/revision at call time, serializes AT the network boundary, dispatches
 * reducer actions, and reports the outcome back here; `isDirty` reads the
 * reducer's derived reference-inequality.
 */

export type AutosaveOutcome = 'saved' | 'failed' | 'conflict' | 'window-closed';

export interface AutosaveDriver {
  isDirty(): boolean;
  performSave(): Promise<AutosaveOutcome>;
}

export const AUTOSAVE_DEBOUNCE_MS = 2_000;
export const AUTOSAVE_MAX_WAIT_MS = 10_000;
export const AUTOSAVE_RETRY_LADDER_MS = [10_000, 30_000, 60_000] as const;

export class AutosaveScheduler {
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private failures = 0;
  private terminal = false;
  private disposed = false;

  constructor(private readonly driver: AutosaveDriver) {}

  /** A commit landed. Restart the debounce; arm max-wait if not armed. */
  noteCommit(): void {
    if (this.terminal || this.disposed) return;
    if (this.retryTimer) return; // backoff governs the next attempt, not typing
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.attempt();
    }, AUTOSAVE_DEBOUNCE_MS);
    if (!this.maxWaitTimer && !this.inFlight) {
      this.maxWaitTimer = setTimeout(() => {
        this.maxWaitTimer = null;
        void this.attempt();
      }, AUTOSAVE_MAX_WAIT_MS);
    }
  }

  /** beforeunload/manual flush: save immediately if there is anything to save. */
  flushNow(): void {
    if (this.terminal || this.disposed) return;
    this.clearScheduling();
    void this.attempt();
  }

  dispose(): void {
    this.disposed = true;
    this.clearScheduling();
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // An in-flight save is deliberately not aborted.
  }

  get isTerminal(): boolean {
    return this.terminal;
  }

  private clearScheduling(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  private async attempt(): Promise<void> {
    if (this.terminal || this.disposed || this.inFlight) return;
    if (!this.driver.isDirty()) {
      this.clearScheduling();
      return;
    }
    this.clearScheduling();
    this.inFlight = true;
    let outcome: AutosaveOutcome;
    try {
      outcome = await this.driver.performSave();
    } catch {
      outcome = 'failed'; // performSave shouldn't throw; treat it as a failure
    }
    this.inFlight = false;
    if (this.disposed) return;

    switch (outcome) {
      case 'saved': {
        this.failures = 0;
        // Edits that landed during the flight are still dirty — go again
        // through the ordinary debounce.
        if (this.driver.isDirty()) this.noteCommit();
        return;
      }
      case 'failed': {
        const delay =
          AUTOSAVE_RETRY_LADDER_MS[Math.min(this.failures, AUTOSAVE_RETRY_LADDER_MS.length - 1)]!;
        this.failures += 1;
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          void this.attempt();
        }, delay);
        return;
      }
      case 'conflict':
      case 'window-closed': {
        this.terminal = true;
        this.clearScheduling();
        return;
      }
    }
  }
}
