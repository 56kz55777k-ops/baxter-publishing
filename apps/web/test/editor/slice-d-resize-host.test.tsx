// @vitest-environment jsdom
/**
 * Slice D stage 5 — `useResizeHost`, the session's owner on the stage:
 * its lifetime rules (plan §0.12 notes carried into stage 5).
 *
 * - An owner that unmounts INSIDE a session callback receives nothing more
 *   (no Space sync, no refit): the host's unmount disposes the session.
 * - Ended sessions are not disposed on release: one still holding a
 *   residual key suppression keeps it until its keyup; the host disposes
 *   every listening session on unmount, silently.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import type { EditorElement, StoredGeometry } from '@baxter/domain';
import { newRectElement } from '@baxter/domain';
import { useResizeHost, type ResizeHost } from '@/components/editor/use-resize-host';

let container: HTMLDivElement;
let root: Root;
let host: ResizeHost;
let log: string[];
let show: (v: boolean) => void;

const EL = { ...newRectElement({ x: 20, y: 20 }), width: 40, height: 30 } as EditorElement & StoredGeometry;
const GEOM = { widthMm: 148, heightMm: 210, pageOffsetsMm: [0], bleedMm: 3.175, marginMm: 12, safeMm: 5 };
const VIEW = { x: 0, y: 0, scale: 3.4 };

type When = 'commit-sync' | 'commit-batched' | 'none';

function Owner({ unmountOn }: { unmountOn: When }) {
  host = useResizeHost({
    geom: GEOM,
    boxes: [{ id: EL.id, locked: false, box: { x: 20, y: 20, width: 40, height: 30 } }],
    view: VIEW,
    pageIndexOf: () => 0,
    onResize: () => {
      log.push('resize');
      // The owner goes away inside the commit: synchronously (flushSync), or batched as React does by default.
      if (unmountOn === 'commit-sync') flushSync(() => show(false));
      if (unmountOn === 'commit-batched') show(false);
    },
    onSpaceSync: (h) => void log.push(`space ${h}`),
    onRefit: () => void log.push('refit'),
  });
  return null;
}

function App({ unmountOn }: { unmountOn: When }) {
  const [on, setOn] = React.useState(true);
  show = setOn;
  return on ? <Owner unmountOn={unmountOn} /> : null;
}

/** Press at the bottom-right anchor, one real change through the session's own hooks. */
function gesture() {
  const press = { x: 60 * 3.4, y: 50 * 3.4 };
  const s = host.begin({ element: EL, anchor: 'bottom-right', pressPoint: press, keepProportions: false })!;
  const p = { x: 70 * 3.4, y: 60 * 3.4 };
  act(() => {
    s.anchorBound(press, p, p, { shift: false, alt: false }, 'bottom-right');
    s.boxBound({ x: 68, y: 68, width: 136, height: 102 }, { x: 68, y: 68, width: 170, height: 136 }, 'bottom-right', { shift: false, alt: false });
  });
  return s;
}

beforeEach(() => {
  log = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('stage 5 — useResizeHost lifetime', () => {
  it('owner unmounted SYNCHRONOUSLY inside onCommit: the commit happens once; no Space sync and no refit reach the dead owner', () => {
    act(() => root.render(<App unmountOn="commit-sync" />));
    const s = gesture();
    s.noteViewportSize({ w: 1280, h: 720 });
    act(() => void s.release());
    expect(log).toEqual(['resize']);
    expect(s.snapshot().listening).toBe(false);
  });

  it('a BATCHED unmount (React\'s default inside an event): the owner is still mounted while the callbacks run, then disposed', () => {
    act(() => root.render(<App unmountOn="commit-batched" />));
    const s = gesture();
    act(() => void s.release());
    expect(log).toEqual(['resize', 'space false']); // delivered to a still-mounted owner
    expect(s.snapshot().listening).toBe(false);
  });

  it('control: an owner that stays mounted gets resize → Space sync → refit, in that order', () => {
    act(() => root.render(<App unmountOn="none" />));
    const s = gesture();
    s.noteViewportSize({ w: 1280, h: 720 });
    act(() => void s.release());
    expect(log).toEqual(['resize', 'space false', 'refit']);
    expect(host.liveRef.current).toBeNull();
  });

  it('release does not dispose a session holding a residual: it lives until the keyup, then detaches itself', () => {
    act(() => root.render(<App unmountOn="none" />));
    const s = gesture();
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    act(() => void s.release());
    expect(s.snapshot()).toMatchObject({ phase: 'ended', listening: true, residualKeys: ['Enter'] });
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(s.snapshot().listening).toBe(false);
  });

  it('unmount disposes an ended session still holding a residual — silently', () => {
    act(() => root.render(<App unmountOn="none" />));
    const s = gesture();
    act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })));
    act(() => void s.release());
    log = [];
    expect(s.snapshot().listening).toBe(true);
    act(() => show(false));
    expect(s.snapshot()).toMatchObject({ listening: false, residualKeys: [] });
    expect(log).toEqual([]);
  });

  it('a later session replaces the live one; earlier ended sessions that finished are forgotten', () => {
    act(() => root.render(<App unmountOn="none" />));
    const a = gesture();
    act(() => void a.release());
    const b = gesture();
    expect(host.liveRef.current).toBe(b);
    act(() => void b.cancel('escape'));
    expect(host.liveRef.current).toBeNull();
    expect(vi.isMockFunction(host.begin)).toBe(false);
  });
});
