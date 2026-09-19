'use client';

/**
 * The buffered numeric field (contracts #18, #19) — production-complete from
 * day one, as Part 11 requires. There is deliberately no interim
 * `<input type="number">` anywhere in the editor: the accepted contract is
 * specific enough that a naïve field would have to be replaced rather than
 * extended, and the replacement is where behaviour historically dies.
 *
 * The rules, and where each lives:
 *
 * - **Free draft while focused.** `""`, `"-"`, `"12."` sit in `draft` and are
 *   never parsed, committed or clamped (`parseNum` returns null for them).
 * - **Commit boundaries:** blur, Enter (which keeps focus), and each arrow
 *   press. Nothing commits per keystroke — one completed edit is one
 *   intention and therefore one history entry (#24).
 * - **Invalid draft restores** the last valid value and writes nothing.
 * - **Escape** restores and leaves the field without touching canvas
 *   selection — it is a field-level cancel, not an editor-level one.
 * - **No-ops write nothing:** a commit equal to the current model value
 *   returns early, so visiting a field and leaving creates no history entry
 *   and no autosave.
 * - **No native spinners** (`appearance: textfield`): permanent +/- controls
 *   are barred without a new decision, and the arrow keys are the accepted
 *   stepping affordance.
 * - **Display = model exactly** via `formatNum`, and the field re-syncs to an
 *   external change only while unfocused, so a live draft is never yanked.
 */
import { useEffect, useRef, useState } from 'react';
import { commitNum, formatNum, stepNum, type NumFieldBounds } from '@baxter/domain';

export function NumField({
  label,
  value,
  bounds,
  disabled = false,
  onCommit,
}: {
  label: string;
  value: number;
  bounds: NumFieldBounds;
  disabled?: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatNum(value));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /**
   * Escape blurs the field to leave it, and blur is itself a commit boundary.
   * Without this latch the cancelled draft would be committed by the very act
   * of leaving — the opposite of what Escape means. The flag is a ref because
   * it must be readable inside the blur handler in the same tick, before any
   * re-render restores the displayed value.
   */
  const cancelledRef = useRef(false);

  // External changes (undo, another field, a redo) reach an unfocused field
  // only — a focused draft belongs to the person typing it.
  useEffect(() => {
    if (!focused) setDraft(formatNum(value));
  }, [value, focused]);

  function commit(raw: string) {
    const next = commitNum(raw, bounds);
    if (next === null) {
      setDraft(formatNum(value)); // invalid draft → restore the last valid value
      return;
    }
    setDraft(formatNum(next));
    if (next === value) return; // identical commits create nothing (#19/#24)
    onCommit(next);
  }

  function step(direction: 1 | -1, shift: boolean) {
    const next = stepNum(value, bounds, direction, shift);
    setDraft(formatNum(next));
    if (next === value) return; // already at the bound — no entry
    onCommit(next);
  }

  return (
    <label className="flex items-center gap-2">
      <span className="metadata w-6 shrink-0 text-ink-faint">{label}</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        value={draft}
        aria-label={label}
        data-testid={`num-${label.toLowerCase()}`}
        className="h-[26px] w-full min-w-0 rounded-sm border border-rule bg-canvas px-2 text-caption tabular-nums text-ink outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 disabled:text-ink-faint"
        style={{ appearance: 'textfield' }}
        onFocus={() => setFocused(true)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          setFocused(false);
          if (cancelledRef.current) {
            cancelledRef.current = false;
            setDraft(formatNum(value)); // Escape already restored; do not commit
            return;
          }
          commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draft); // Enter commits and KEEPS focus (#19)
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelledRef.current = true;
            setDraft(formatNum(value));
            inputRef.current?.blur(); // leaves the field; canvas selection is untouched
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            step(1, e.shiftKey);
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            step(-1, e.shiftKey);
          }
        }}
      />
    </label>
  );
}

/** Ordinary geometry field: ±1, Shift ±5. */
export const GEOMETRY_BOUNDS: NumFieldBounds = { step: 1, shiftStep: 5 };
/** Width/height carry the inspector's 2 mm floor (#19). */
export const SIZE_BOUNDS: NumFieldBounds = { min: 2, step: 1, shiftStep: 5 };
/** Fine field: ±0.1, Shift ±1 — the contract states both rates literally. */
export const FINE_BOUNDS: NumFieldBounds = { min: 0, step: 0.1, shiftStep: 1 };
/** Opacity is edited as a percentage; the model stores 0–1. */
export const PERCENT_BOUNDS: NumFieldBounds = { min: 0, max: 100, step: 1, shiftStep: 5 };
