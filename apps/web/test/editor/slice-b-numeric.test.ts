/**
 * The numeric contract (#19) and the two commit grids, as pure rules.
 *
 * These are the R12 fixtures that earned acceptance, plus the precision rule
 * the handoff flags as deliberately inconsistent across systems: creation and
 * drag commit at 0.1 mm, the inspector and resize at 0.01 mm. Both are pinned
 * so neither can be "tidied" into the other without a decision.
 */
import { describe, expect, it } from 'vitest';
import {
  clampNum,
  commitNum,
  formatNum,
  parseNum,
  quantizeCreate,
  quantizeInspector,
  stepNum,
  type NumFieldBounds,
} from '@baxter/domain';

const SIZE: NumFieldBounds = { min: 2, step: 1, shiftStep: 5 };
const FINE: NumFieldBounds = { min: 0, step: 0.1, shiftStep: 1 };
const FREE: NumFieldBounds = { step: 1, shiftStep: 5 };

describe('precision — the two grids are different on purpose', () => {
  it('creation, drag and nudge commit at 0.1 mm', () => {
    expect(quantizeCreate(20.04)).toBe(20);
    expect(quantizeCreate(20.05)).toBe(20.1);
    expect(quantizeCreate(-3.14159)).toBe(-3.1);
  });

  it('the inspector and resize commit at 0.01 mm', () => {
    expect(quantizeInspector(20.004)).toBe(20);
    expect(quantizeInspector(20.005)).toBe(20.01);
    expect(quantizeInspector(70.001)).toBe(70);
  });

  it('the two grids disagree, and that difference is the contract', () => {
    expect(quantizeCreate(20.05)).not.toBe(quantizeInspector(20.05));
  });

  it('normalises -0 so equal documents never compare unequal', () => {
    expect(Object.is(quantizeCreate(-0.001), 0)).toBe(true);
    expect(Object.is(quantizeInspector(-0.0001), 0)).toBe(true);
  });
});

describe('parseNum — transitional drafts are never values', () => {
  it('refuses the drafts the contract names', () => {
    for (const draft of ['', '-', '12.', '.', '+', 'abc', '1.2.3', '1e3']) {
      expect(parseNum(draft)).toBeNull();
    }
  });

  it('accepts complete decimals, signed and leading-dot', () => {
    expect(parseNum('12')).toBe(12);
    expect(parseNum('-12.5')).toBe(-12.5);
    expect(parseNum('.5')).toBe(0.5);
    expect(parseNum('  7 ')).toBe(7);
  });
});

describe('clamping happens only at real declared bounds', () => {
  it('X/Y are unbounded — negative page-relative values are first-class (#2)', () => {
    expect(clampNum(-40, FREE)).toBe(-40);
    expect(clampNum(10_000, FREE)).toBe(10_000);
  });

  it('W/H carry the inspector floor of 2', () => {
    expect(clampNum(0.5, SIZE)).toBe(2);
    expect(clampNum(2, SIZE)).toBe(2);
  });
});

describe('commitNum', () => {
  it('returns null for an invalid draft so the field restores', () => {
    expect(commitNum('12.', SIZE)).toBeNull();
    expect(commitNum('', SIZE)).toBeNull();
  });

  it('clamps and quantizes a valid draft to the 0.01 grid', () => {
    expect(commitNum('1', SIZE)).toBe(2);
    expect(commitNum('20.004', FREE)).toBe(20);
    expect(commitNum('20.006', FREE)).toBe(20.01);
  });
});

describe('stepping — every typed-reachable bound is step-reachable', () => {
  it('arrow is ±step; Shift is the field’s declared shift rate', () => {
    expect(stepNum(10, FREE, 1, false)).toBe(11);
    expect(stepNum(10, FREE, -1, false)).toBe(9);
    expect(stepNum(10, FREE, 1, true)).toBe(15);
    expect(stepNum(10, FREE, -1, true)).toBe(5);
  });

  it('fine fields step ±0.1 and Shift-step ±1 — both rates stated literally', () => {
    expect(stepNum(0.5, FINE, -1, false)).toBe(0.4);
    expect(stepNum(0.5, FINE, 1, true)).toBe(1.5);
  });

  it('the R12 fixture: stroke 0.5 steps down to exactly 0, which nulls the stroke', () => {
    let v = 0.5;
    for (let i = 0; i < 5; i++) v = stepNum(v, FINE, -1, false);
    expect(v).toBe(0);
  });

  it('stepping clamps at the bound rather than overshooting', () => {
    expect(stepNum(0, FINE, -1, false)).toBe(0);
    expect(stepNum(2, SIZE, -1, true)).toBe(2);
  });
});

describe('display equals the model exactly', () => {
  it('≤ 2 dp, trailing zeros stripped, −0 normalised', () => {
    expect(formatNum(12)).toBe('12');
    expect(formatNum(12.5)).toBe('12.5');
    expect(formatNum(12.5)).not.toBe('12.50');
    expect(formatNum(12.004)).toBe('12');
    expect(formatNum(12.006)).toBe('12.01');
    expect(formatNum(-0)).toBe('0');
    expect(formatNum(-12.3)).toBe('-12.3');
  });
});
