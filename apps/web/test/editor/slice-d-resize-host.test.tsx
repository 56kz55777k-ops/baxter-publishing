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

type When = 'commit-sync' | 'commit-batched' | 'space-sync' | 'refit-sync' | 'none';

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
    // INJECTED reproductions (Codex's stage 5 review, finding 2): an owner callback that unmounts the owner
    // synchronously. The production Space setter and refit do not unmount the stage; these cases pin the
    // host's lifetime rule, not an observed production path.
    onSpaceSync: (h) => {
      log.push(`space ${h}`);
      if (unmountOn === 'space-sync') {
        flushSync(() => show(false));
        log.push('unmounted');
      }
    },
    onRefit: () => {
      log.push('refit');
      if (unmountOn === 'refit-sync') {
        flushSync(() => show(false));
        log.push('unmounted');
      }
    },
  });
  return null;
}

function App({ unmountOn }: { unmountOn: When }) {
  const [on, setOn] = React.useState(true);
  show = setOn;
  return on ? <Owner unmountOn={unmountOn} /> : null;
}

const adapterEnded = (end: { reason: string }) => void log.push(`adapter ${end.reason}`);

/** Press at the bottom-right anchor, one real change through the session's own hooks. */
function gesture() {
  const press = { x: 60 * 3.4, y: 50 * 3.4 };
  const s = host.begin({ element: EL, anchor: 'bottom-right', pressPoint: press, keepProportions: false, onEnded: adapterEnded })!;
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
    expect(log).toEqual(['resize', 'space false', 'adapter release']); // delivered to a still-mounted owner
    expect(s.snapshot().listening).toBe(false);
  });

  it('control: an owner that stays mounted gets resize → Space sync → refit, in that order', () => {
    act(() => root.render(<App unmountOn="none" />));
    const s = gesture();
    s.noteViewportSize({ w: 1280, h: 720 });
    act(() => void s.release());
    expect(log).toEqual(['resize', 'space false', 'refit', 'adapter release']);
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

describe('stage 5 correction — host lifetime across the end callbacks (Codex finding 2)', () => {
  // Each end path: a real change, a pending refit, then the end. The owner unmounts synchronously inside
  // the named callback; nothing after it — owner refit or the adapter's own end hook — may run.
  const ends = {
    release: (s: ReturnType<typeof gesture>) => void s.release(),
    escape: (s: ReturnType<typeof gesture>) => void s.cancel('escape'),
    blur: (s: ReturnType<typeof gesture>) => void s.cancel('blur'),
  };
  for (const [name, end] of Object.entries(ends)) {
    it(`${name}: unmount inside onSpaceSync → no refit and no adapter end afterwards`, () => {
      act(() => root.render(<App unmountOn="space-sync" />));
      const s = gesture();
      s.noteViewportSize({ w: 1280, h: 720 });
      act(() => end(s));
      const lead = name === 'release' ? ['resize'] : [];
      expect(log).toEqual([...lead, 'space false', 'unmounted']);
      expect(s.snapshot().listening).toBe(false);
      expect(host.liveRef.current).toBeNull();
    });

    it(`${name}: unmount inside onRefit → no adapter end afterwards`, () => {
      act(() => root.render(<App unmountOn="refit-sync" />));
      const s = gesture();
      s.noteViewportSize({ w: 1280, h: 720 });
      act(() => end(s));
      const lead = name === 'release' ? ['resize'] : [];
      expect(log).toEqual([...lead, 'space false', 'refit', 'unmounted']);
      expect(s.snapshot().listening).toBe(false);
    });
  }

  it('control: unmount inside onResize (the stage 4 case) still stops everything after the commit', () => {
    act(() => root.render(<App unmountOn="commit-sync" />));
    const s = gesture();
    s.noteViewportSize({ w: 1280, h: 720 });
    act(() => void s.release());
    expect(log).toEqual(['resize']);
  });

  it('control: a mounted owner gets each end callback exactly once, refit deferred to the end, adapter last', () => {
    act(() => root.render(<App unmountOn="none" />));
    const s = gesture();
    s.noteViewportSize({ w: 1000, h: 700 });
    s.noteViewportSize({ w: 1280, h: 720 });
    expect(log).toEqual([]); // the refit waits for the end
    act(() => void s.cancel('escape'));
    act(() => void s.release());
    act(() => void s.cancel('blur'));
    expect(log).toEqual(['space false', 'refit', 'adapter escape']);
  });

  it('control: a mounted owner keeps the residual key suppression after the end', () => {
    act(() => root.render(<App unmountOn="none" />));
    const s = gesture();
    const down = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(down));
    act(() => void s.cancel('escape'));
    const up = new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => void document.body.dispatchEvent(up));
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
    expect(log).toEqual(['space false', 'adapter escape']);
    expect(s.snapshot().listening).toBe(false);
  });

  it('StrictMode (mount → cleanup → mount): the host is live after setup, so a mounted owner still gets every end callback', () => {
    act(() =>
      root.render(
        <React.StrictMode>
          <App unmountOn="none" />
        </React.StrictMode>
      )
    );
    const s = gesture();
    s.noteViewportSize({ w: 1280, h: 720 });
    act(() => void s.release());
    expect(log).toEqual(['resize', 'space false', 'refit', 'adapter release']);
  });

  it('StrictMode: a real unmount still stops the callbacks', () => {
    act(() =>
      root.render(
        <React.StrictMode>
          <App unmountOn="space-sync" />
        </React.StrictMode>
      )
    );
    const s = gesture();
    s.noteViewportSize({ w: 1280, h: 720 });
    act(() => void s.release());
    expect(log).toEqual(['resize', 'space false', 'unmounted']);
  });
});
