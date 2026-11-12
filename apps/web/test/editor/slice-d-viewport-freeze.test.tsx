// @vitest-environment jsdom
/**
 * Slice D stage 4 — the viewport-freeze policy and deferred-refit
 * bookkeeping (plan §4.6, §7 `slice-d-viewport-freeze.test.tsx`).
 *
 * Stage 4 supplies the policy on the production session object
 * (`handleWheel`, `noteViewportSize`, `onEnd.refit`, `panMayStart`).
 * `SpreadStage`'s live wheel handler, refit effect and pan start are NOT
 * connected to it until stage 5 (unauthorized); those integrations, and the
 * browser behaviour (Firefox's Ctrl+wheel page zoom, trackpad pinch), are
 * NOT EXECUTED here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { startBoxH } from '@baxter/domain';
import { ResizeSession, panMayStart, type ResizeEnd } from '@/components/editor/resize-session';

const live: ResizeSession[] = [];
afterEach(() => {
  for (const s of live.splice(0)) s.dispose();
});

function session() {
  const ends: ResizeEnd[] = [];
  const commits: unknown[] = [];
  const stored = { x: 100, y: 100, width: 40, height: 30 };
  const start = startBoxH(stored, 0);
  const view = { x: 0, y: 0, scale: 3.4 };
  const press = { x: ((start.x + start.w) / 100) * 3.4, y: ((start.y + start.h) / 100) * 3.4 };
  const s = new ResizeSession(
    { elementId: 'e', stored, pageOffsetH: 0, targets: { x: [], y: [] }, anchor: 'bottom-right', view, pressPoint: press, keepProportions: false, keyTarget: window },
    { onPreview: () => {}, onCommit: (_id, p) => void commits.push(p), onEnd: (e) => void ends.push(e) }
  );
  live.push(s);
  /** Cross the threshold and make a real change, Konva-style: anchorBound then boxBound. */
  const activate = () => {
    const p = { x: press.x + 34, y: press.y + 34 };
    s.anchorBound(press, p, p, { shift: false, alt: false }, 'bottom-right');
    s.boxBound(
      { x: 340, y: 340, width: 136, height: 102 },
      { x: 340, y: 340, width: 136 + 34, height: 102 + 34 },
      'bottom-right',
      { shift: false, alt: false }
    );
  };
  return { s, ends, commits, activate };
}

const wheel = () => ({ preventDefault: vi.fn() });
const blur = () => act(() => void window.dispatchEvent(new Event('blur')));
const escape = () => act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));

const exits = {
  release: (s: ResizeSession) => void s.release(),
  escape: () => escape(),
  blur: () => blur(),
  readOnly: (s: ResizeSession) => void s.cancel('readOnly'),
  transformend: (s: ResizeSession) => void s.transformEnd(false),
  unmount: (s: ResizeSession) => s.dispose(),
} as const;

describe('stage 4 — wheel is frozen from the anchor press', () => {
  it('threshold-pending: plain and ctrl/⌘ wheel are prevented and consumed', () => {
    const { s } = session();
    expect(s.snapshot().phase).toBe('pending');
    for (let i = 0; i < 3; i++) {
      const w = wheel();
      expect(s.handleWheel(w)).toBe(true);
      expect(w.preventDefault).toHaveBeenCalledTimes(1);
    }
  });

  it('active resizing: prevented and consumed', () => {
    const { s, activate } = session();
    activate();
    expect(s.snapshot().phase).toBe('active');
    const w = wheel();
    expect(s.handleWheel(w)).toBe(true);
    expect(w.preventDefault).toHaveBeenCalledTimes(1);
  });

  it.each(Object.keys(exits) as (keyof typeof exits)[])('after %s: the next wheel is not blocked and not prevented (suppression released)', (exit) => {
    const { s, activate } = session();
    activate();
    exits[exit](s);
    const w = wheel();
    expect(s.handleWheel(w)).toBe(false);
    expect(w.preventDefault).not.toHaveBeenCalled();
    expect(s.isLive()).toBe(false);
    expect(panMayStart({ spaceHeld: false, tool: 'hand', session: s })).toBe(true);
  });
});

describe('stage 4 — viewport size changes are deferred into ONE refit with the latest size', () => {
  it.each(['release', 'escape', 'blur', 'readOnly', 'transformend'] as const)('%s: three size changes → exactly one refit, the latest size, reported once at the end', (exit) => {
    const { s, ends, activate } = session();
    activate();
    expect(s.noteViewportSize({ w: 800, h: 600 })).toBe(true);
    expect(s.noteViewportSize({ w: 1024, h: 700 })).toBe(true);
    expect(s.noteViewportSize({ w: 1280, h: 720 })).toBe(true);
    exits[exit](s);
    expect(ends).toHaveLength(1);
    expect(ends[0]!.refit).toEqual({ w: 1280, h: 720 });
  });

  it('threshold-pending sessions defer too', () => {
    const { s, ends } = session();
    s.noteViewportSize({ w: 900, h: 500 });
    s.release();
    expect(ends[0]).toEqual({ reason: 'release', committed: false, spaceHeld: false, refit: { w: 900, h: 500 } });
  });

  it('no size change during the session → no refit at the end', () => {
    const { s, ends, activate } = session();
    activate();
    s.release();
    expect(ends[0]!.refit).toBeNull();
  });

  it('after the end, size changes are not deferred (the owner refits normally)', () => {
    const { s, ends } = session();
    s.release();
    expect(s.noteViewportSize({ w: 1, h: 1 })).toBe(false);
    expect(ends).toHaveLength(1);
  });

  it('the stored size is a copy: mutating the caller\'s object later changes nothing', () => {
    const { s, ends } = session();
    const size = { w: 640, h: 480 };
    s.noteViewportSize(size);
    size.w = 1;
    s.release();
    expect(ends[0]!.refit).toEqual({ w: 640, h: 480 });
  });

  it('unmount: the session is disposed without dispatching anything into the dead owner — no refit, no end, no commit', () => {
    const { s, ends, commits, activate } = session();
    activate();
    s.noteViewportSize({ w: 1000, h: 1000 });
    s.dispose();
    expect([ends, commits]).toEqual([[], []]);
    expect(s.noteViewportSize({ w: 2, h: 2 })).toBe(false);
  });
});
