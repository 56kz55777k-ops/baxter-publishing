// @vitest-environment jsdom
/**
 * Slice D stage 3 — the D-1 inspector width/height floor (plan §4.10, §7
 * `slice-d-inspector.test.tsx`; AC-14).
 *
 * The floor of an axis is the smaller of 4 mm and the axis's size when the
 * edit starts (its current value at each commit). A normal axis cannot go
 * below 4 mm; a grandfathered axis can grow and never shrink, and a shrink
 * attempt is a no-op: no patch, no history entry, no save.
 *
 * Three layers: the pure rule (`sizeBounds` + `commitNum`/`stepNum`), the
 * Inspector component (what it patches), and the real shell (history and the
 * document reference — autosave follows commits by construction). The
 * Keep-proportions toggle is stage 6 and not tested here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addElement,
  commitNum,
  findElement,
  formatNum,
  getFormatPreset,
  newEditorDoc,
  newEllipseElement,
  newRectElement,
  stepNum,
  type EditorDoc,
  type EditorElement,
} from '@baxter/domain';
import { sizeBounds } from '@/components/editor/inspector/NumField';

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) =>
    React.createElement('a', { href }, children),
}));
vi.mock('@/components/editor/SpreadStage', () => ({ SpreadStage: () => null }));
vi.mock('@/components/editor/state/use-autosave', () => ({ useAutosave: () => {} }));

const { Inspector } = await import('@/components/editor/inspector/Inspector');
const { EditorShell } = await import('@/components/editor/EditorShell');
const { DocumentProvider, useDocumentState } = await import('@/components/editor/state/document-context');
const { EditorUiProvider, useEditorUiDispatch } = await import('@/components/editor/state/editor-ui-context');

/* -------------------------------------------------------------------------- */
/* The pure rule                                                               */
/* -------------------------------------------------------------------------- */

const typed = (current: number, draft: string) => commitNum(draft, sizeBounds(current));
const step = (current: number, dir: 1 | -1, shift = false) => stepNum(current, sizeBounds(current), dir, shift);

describe('D-1 floor — the pure rule (sizeBounds + the numeric field rules)', () => {
  it('the floor is min(4 mm, the value when the edit starts); steps stay ±1 / Shift ±5', () => {
    expect(sizeBounds(10)).toEqual({ min: 4, step: 1, shiftStep: 5 });
    expect(sizeBounds(4)).toEqual({ min: 4, step: 1, shiftStep: 5 });
    expect(sizeBounds(2.5)).toEqual({ min: 2.5, step: 1, shiftStep: 5 });
  });

  it('a normal axis: typing 3 commits 4; stepping down from 4.3 commits 4; at 4, down is a no-op', () => {
    expect(typed(10, '3')).toBe(4);
    expect(typed(10, '0.5')).toBe(4);
    expect(typed(10, '4.01')).toBe(4.01);
    expect(step(4.3, -1)).toBe(4);
    expect(step(4, -1)).toBe(4); // equal to the current value → the field writes nothing
    expect(step(10, -1, true)).toBe(5);
  });

  it('a grandfathered 2.5: grows to 3.2 or 3; a shrink to 2 resolves to 2.5 (no-op); ↑ → 3.5; ↓ is a no-op', () => {
    expect(typed(2.5, '3.2')).toBe(3.2);
    expect(typed(2.5, '3')).toBe(3);
    expect(typed(2.5, '2')).toBe(2.5);
    expect(typed(2.5, '2.49')).toBe(2.5);
    expect(step(2.5, 1)).toBe(3.5);
    expect(step(2.5, -1)).toBe(2.5);
    // the new value is the floor for the next edit: from 3.2, 2.8 resolves to 3.2
    expect(typed(3.2, '2.8')).toBe(3.2);
    expect(typed(3.2, '3.5')).toBe(3.5);
  });

  it('an off-grid grandfathered value (legacy 2.504) never rounds below itself: 2 → 2.504 (no-op); ↓ → 2.504; ↑ → 3.5', () => {
    expect(typed(2.504, '2')).toBe(2.504);
    expect(typed(2.504, '2.5041')).toBe(2.504); // 2.5041 rounds to 2.5 on the 0.01 grid, below the floor
    expect(step(2.504, -1)).toBe(2.504);
    expect(step(2.504, 1)).toBe(3.5);
  });

  it('a stored size that rounds to 0 H (0.004 mm) is never written as 0: 0 → 0.004 (no-op); 0.01 grows it', () => {
    expect(typed(0.004, '0')).toBe(0.004);
    expect(typed(0.004, '0.001')).toBe(0.004);
    expect(typed(0.004, '0.01')).toBe(0.01);
    expect(step(0.004, -1)).toBe(0.004);
  });

  it('other fields keep their bounds: the minimum guard never moves an on-grid result', () => {
    expect(commitNum('-0.004', { min: 0, step: 0.1, shiftStep: 1 })).toBe(0);
    expect(commitNum('-40', { step: 1, shiftStep: 5 })).toBe(-40);
    expect(commitNum('101', { min: 0, max: 100, step: 1, shiftStep: 5 })).toBe(100);
  });
});

/*
 * Codex stage 3 review (2026-11-12): an off-grid floor that rounds UP. At
 * f367b58 a shrink clamped to the floor and then rounded, so 2.506 → 2.51,
 * 0.006 → 0.01 and 3.999 → 4: a changed value, a history entry and a save.
 * And focus shows the rounded display, so focus/blur without editing
 * committed the same growth. Both must leave the stored value exactly.
 */
const UPWARD = [
  { stored: 2.506, shown: '2.51', shrink: '2', grow: '3', grown: 3, up: 3.51 },
  { stored: 0.006, shown: '0.01', shrink: '0', grow: '1', grown: 1, up: 1.01 },
  { stored: 3.999, shown: '4', shrink: '0', grow: '5', grown: 5, up: 5 },
] as const;

describe('D-1 floor — an off-grid floor that rounds upward is kept exactly (Codex stage 3 finding)', () => {
  it.each(UPWARD)('$stored: typed shrinks resolve to the exact stored value', ({ stored, shrink }) => {
    for (const d of [shrink, '0', '-1', String(stored)]) {
      expect(Object.is(typed(stored, d), stored)).toBe(true);
    }
  });

  it.each(UPWARD)('$stored: ArrowDown and Shift+ArrowDown resolve to the exact stored value', ({ stored }) => {
    expect(Object.is(step(stored, -1), stored)).toBe(true);
    expect(Object.is(step(stored, -1, true), stored)).toBe(true);
  });

  it.each(UPWARD)('$stored: the unedited display text "$shown" resolves to the stored value', ({ stored, shown }) => {
    expect(formatNum(stored)).toBe(shown); // the display is rounded — the hazard
    expect(Object.is(commitNum(shown, sizeBounds(stored), stored), stored)).toBe(true);
    expect(Object.is(commitNum(` ${shown} `, sizeBounds(stored), stored), stored)).toBe(true);
  });

  it.each(UPWARD)('$stored: growth still works (typed $grow → $grown; ↑ → $up)', ({ stored, grow, grown, up }) => {
    expect(commitNum(grow, sizeBounds(stored), stored)).toBe(grown);
    expect(step(stored, 1)).toBe(up);
  });

  it('values that round DOWN keep their existing protection (2.504, 0.004)', () => {
    expect(Object.is(typed(2.504, '2'), 2.504)).toBe(true);
    expect(Object.is(typed(2.504, '2.5041'), 2.504)).toBe(true);
    expect(Object.is(step(2.504, -1), 2.504)).toBe(true);
    expect(Object.is(typed(0.004, '0'), 0.004)).toBe(true);
    expect(Object.is(commitNum('0', sizeBounds(0.004), 0.004), 0.004)).toBe(true);
  });

  it('the unedited rule is display-exact only: any other text is parsed as before', () => {
    expect(commitNum('2.5', sizeBounds(2.506), 2.506)).toBe(2.506); // a shrink → the floor
    expect(commitNum('2.52', sizeBounds(2.506), 2.506)).toBe(2.52);
    expect(commitNum('abc', sizeBounds(2.506), 2.506)).toBeNull(); // invalid → restore
    expect(commitNum('2.51', sizeBounds(2.506))).toBe(2.51); // no current (mixed): parsed
    // an unbounded off-grid X (legacy 20.004 shows "20"): leaving it unedited keeps it
    expect(Object.is(commitNum('20', { step: 1, shiftStep: 5 }, 20.004), 20.004)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* DOM helpers                                                                 */
/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const field = (testId: string) => container.querySelector(`[data-testid="${testId}"]`) as HTMLInputElement;

function enter(input: HTMLInputElement, text: string) {
  act(() => input.focus());
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
}

/** Focus, then leave without editing: blur, or Enter (which keeps focus). */
function visit(input: HTMLInputElement, leave: 'blur' | 'Enter') {
  act(() => input.focus());
  act(() => {
    if (leave === 'blur') input.blur();
    else input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  if (leave === 'Enter') act(() => input.blur());
}

function arrowShift(input: HTMLInputElement) {
  act(() => input.focus());
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true }));
  });
}

function arrow(input: HTMLInputElement, key: 'ArrowUp' | 'ArrowDown') {
  act(() => input.focus());
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

/* -------------------------------------------------------------------------- */
/* The Inspector component                                                     */
/* -------------------------------------------------------------------------- */

describe('D-1 floor — the Inspector patches only real changes', () => {
  let patches: [Record<string, unknown>, string][];

  function render(element: EditorElement) {
    patches = [];
    act(() =>
      root.render(
        React.createElement(Inspector, {
          element,
          page: { formatName: 'A5', marginMm: 12, safeMm: 12 },
          selectionCount: 1,
          disabled: false,
          onPatch: (p: Record<string, unknown>, label: string) => patches.push([p, label]),
          onArrange: () => {},
          onSetLocked: () => {},
        })
      )
    );
  }

  it('a grandfathered 2.5 × 20 rect: W 3.2 patches; W 2 patches nothing; H 3 patches 4 (H is a normal axis)', () => {
    const el = { ...newRectElement({ x: 10, y: 10 }), width: 2.5, height: 20 };
    render(el);
    enter(field('num-w'), '2');
    expect(patches).toEqual([]);
    expect(field('num-w').value).toBe('2.5'); // the field shows the unchanged value
    enter(field('num-w'), '3.2');
    expect(patches).toEqual([[{ width: 3.2 }, 'Set width']]);
    // apply the patch, as the shell does, before moving to the next field
    render({ ...el, width: 3.2 });
    enter(field('num-h'), '3');
    expect(patches).toEqual([[{ height: 4 }, 'Set height']]);
  });

  it('arrows on a grandfathered ellipse 2.5 × 2.5: ↓ patches nothing; ↑ patches 3.5', () => {
    render({ ...newEllipseElement({ x: 10, y: 10 }), width: 2.5, height: 2.5 });
    arrow(field('num-w'), 'ArrowDown');
    expect(patches).toEqual([]);
    arrow(field('num-w'), 'ArrowUp');
    expect(patches).toEqual([[{ width: 3.5 }, 'Set width']]);
  });

  it.each(UPWARD)(
    'upward-rounding $stored: typed shrink, ↓, Shift+↓, and focus then blur/Enter patch nothing',
    ({ stored, shrink, shown }) => {
      render({ ...newRectElement({ x: 10, y: 10 }), width: stored, height: 20 });
      enter(field('num-w'), shrink);
      arrow(field('num-w'), 'ArrowDown');
      arrowShift(field('num-w'));
      visit(field('num-w'), 'blur');
      visit(field('num-w'), 'Enter');
      expect(patches).toEqual([]);
      act(() => field('num-w').blur());
      expect(field('num-w').value).toBe(shown);
    }
  );
});

/* -------------------------------------------------------------------------- */
/* The real shell: history and document reference                              */
/* -------------------------------------------------------------------------- */

describe('D-1 floor — through the shell: a no-op creates no history entry and leaves the document untouched', () => {
  let state: ReturnType<typeof useDocumentState>;
  let uiDispatch: ReturnType<typeof useEditorUiDispatch>;
  function Probe() {
    state = useDocumentState();
    uiDispatch = useEditorUiDispatch();
    return null;
  }

  function mount(element: EditorElement) {
    const preset = getFormatPreset('zine_a5')!;
    let d: EditorDoc = newEditorDoc(preset);
    d = addElement(d, d.pages[0]!.id, element);
    act(() =>
      root.render(
        <DocumentProvider doc={d} revision={1}>
          <EditorUiProvider>
            <EditorShell publication={{ id: 'p', title: 'T' }} />
            <Probe />
          </EditorUiProvider>
        </DocumentProvider>
      )
    );
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [element.id] }));
  }

  it('2.5 → 2: no entry, same document; 2.5 → 3.2: one entry; then 3.2 → 2.8: no entry (the new floor is 3.2)', () => {
    const A = { ...newRectElement({ x: 10, y: 10 }), width: 2.5, height: 20 };
    mount(A);
    const before = state.doc;
    enter(field('num-w'), '2');
    expect(state.history).toHaveLength(0);
    expect(state.doc).toBe(before);
    expect(findElement(state.doc, A.id)).toMatchObject({ width: 2.5 });

    enter(field('num-w'), '3.2');
    expect(state.history).toHaveLength(1);
    expect(findElement(state.doc, A.id)).toMatchObject({ width: 3.2, height: 20 });

    const after = state.doc;
    enter(field('num-w'), '2.8');
    expect(state.history).toHaveLength(1);
    expect(state.doc).toBe(after);
  });

  it('a normal 10 mm height typed down to 1 commits the 4 mm floor in one entry', () => {
    const A = { ...newRectElement({ x: 10, y: 10 }), width: 30, height: 10 };
    mount(A);
    enter(field('num-h'), '1');
    expect(state.history).toHaveLength(1);
    expect(findElement(state.doc, A.id)).toMatchObject({ height: 4, width: 30 });
  });

  it('a stored 0.004 mm width: typing 0 is a no-op and the stored 0.004 is kept exactly', () => {
    const A = { ...newRectElement({ x: 0, y: 10 }), width: 0.004, height: 20 };
    mount(A);
    const before = state.doc;
    enter(field('num-w'), '0');
    expect(state.history).toHaveLength(0);
    expect(state.doc).toBe(before);
    expect(Object.is((findElement(state.doc, A.id) as { width: number }).width, 0.004)).toBe(true);
  });

  const widthOf = (id: string) => (findElement(state.doc, id) as { width: number }).width;
  const actions: [string, (input: HTMLInputElement, shrink: string) => void][] = [
    ['typing a shrink + Enter', (i, shrink) => enter(i, shrink)],
    ['typing a shrink + blur', (i, shrink) => {
      enter(i, shrink);
      act(() => i.blur());
    }],
    ['ArrowDown', (i) => arrow(i, 'ArrowDown')],
    ['Shift+ArrowDown', (i) => arrowShift(i)],
    ['focus then blur, untouched', (i) => visit(i, 'blur')],
    ['focus then Enter, untouched', (i) => visit(i, 'Enter')],
  ];

  for (const { stored, shrink } of UPWARD) {
    for (const [what, act_] of actions) {
      it(`width ${stored}, H ${stored}: ${what} → no history entry, same document, exact value`, () => {
        const A = { ...newRectElement({ x: 10, y: 10 }), width: stored, height: stored };
        mount(A);
        const before = state.doc;
        act_(field('num-w'), shrink);
        act_(field('num-h'), shrink);
        expect(state.history).toHaveLength(0);
        expect(state.doc).toBe(before);
        expect(Object.is(widthOf(A.id), stored)).toBe(true);
        expect(Object.is((findElement(state.doc, A.id) as { height: number }).height, stored)).toBe(true);
      });
    }
  }

  it('control: after the no-ops, a real growth from 2.506 still commits one entry', () => {
    const A = { ...newRectElement({ x: 10, y: 10 }), width: 2.506, height: 20 };
    mount(A);
    visit(field('num-w'), 'blur');
    arrow(field('num-w'), 'ArrowDown');
    expect(state.history).toHaveLength(0);
    enter(field('num-w'), '3');
    expect(state.history).toHaveLength(1);
    expect(widthOf(A.id)).toBe(3);
  });
});
