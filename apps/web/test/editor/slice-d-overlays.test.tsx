// @vitest-environment jsdom
/**
 * Slice D stage 7 — D-6 selection and lock indicators (plan §4.8, AC-10,
 * AC-15, implementation choices 10–11) through the REAL editor shell.
 *
 * Mounted for real: `EditorShell`, the document reducer and history, the real
 * autosave hook (`fetch` stubbed: a save is a counted PUT), `SpreadStage`,
 * `ElementsLayer`, the overlays, the inspector, the unit list and the gesture
 * hook. Stood in: `react-konva` (jsdom has no canvas). Here every Konva
 * component renders a plain `<div>` carrying its kind, `name`, `id` and its
 * primitive props as JSON, nested as Konva nests them, so the tests read the
 * chrome the stage actually rendered: which overlays exist, their unit-space
 * geometry, their group scale and their `listening` flags. Real Konva and the
 * rendered pixels are checked in the Chromium probe (R29–R36).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addElement,
  getFormatPreset,
  newEditorDoc,
  newEllipseElement,
  newLineElement,
  newRectElement,
  newTextElement,
  type EditorDoc,
  type EditorElement,
} from '@baxter/domain';
import { AUTOSAVE_DEBOUNCE_MS } from '@/components/editor/state/autosave-core';
import { LOCK_ICON_PX, LOCK_INSET_PX } from '@/components/editor/StageOverlays';

/* -------------------------------------------------------------------------- */
/* The react-konva stand-in: Konva components as inspectable DOM               */
/* -------------------------------------------------------------------------- */

/* eslint-disable @typescript-eslint/no-explicit-any -- the stand-in mirrors Konva's untyped prop surface */
const K = vi.hoisted(() => ({
  nodes: new Map<string, Record<string, any>>(),
  attached: [] as unknown[],
  size: { w: 1000, h: 800 },
}));

vi.mock('react-konva', async () => {
  const React = await import('react');
  const attrs = (p: Record<string, any>) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p)) {
      if (k === 'children' || typeof v === 'function' || (v !== null && typeof v === 'object' && !Array.isArray(v))) continue;
      o[k] = v;
    }
    return JSON.stringify(o);
  };
  const make = (kind: string) =>
    function Fake(p: Record<string, any>) {
      if (typeof p.id === 'string' && (kind === 'Rect' || kind === 'Ellipse')) K.nodes.set(p.id, p);
      return React.createElement('div', { 'data-k': kind, 'data-name': p.name ?? '', 'data-id': p.id ?? '', 'data-attrs': attrs(p) }, p.children);
    };
  const stage = {
    findOne: (sel: string) => (K.nodes.has(sel.slice(1)) ? { id: sel.slice(1) } : undefined),
    getPointerPosition: () => ({ x: 0, y: 0 }),
    content: document.createElement('div'),
  };
  const tr = {
    nodes(arr?: unknown[]) {
      if (arr) {
        K.attached = arr;
        return tr;
      }
      return K.attached;
    },
    getStage: () => stage,
    getLayer: () => ({ batchDraw() {} }),
    isTransforming: () => false,
    stopTransform() {},
    keepRatio() {
      return tr;
    },
    forceUpdate() {},
    getActiveAnchor: () => 'bottom-right',
  };
  return {
    Stage: make('Stage'),
    Layer: make('Layer'),
    Group: make('Group'),
    Rect: make('Rect'),
    Ellipse: make('Ellipse'),
    Line: make('Line'),
    Arc: make('Arc'),
    Transformer: React.forwardRef(function FakeTransformer(p: Record<string, any>, ref: React.Ref<unknown>) {
      React.useImperativeHandle(ref, () => tr, []);
      return React.createElement('div', { 'data-k': 'Transformer', 'data-attrs': attrs(p) });
    }),
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock('@/components/editor/use-viewport-measure', async () => {
  const React = await import('react');
  return {
    useViewportMeasure: (_t: unknown, mirror?: { current: { w: number; h: number } }) => {
      const [s] = React.useState(K.size);
      if (mirror) mirror.current = s;
      return s;
    },
  };
});

const { EditorShell } = await import('@/components/editor/EditorShell');
const { DocumentProvider, useDocumentState } = await import('@/components/editor/state/document-context');
const { EditorUiProvider, useEditorUi, useEditorUiDispatch } = await import('@/components/editor/state/editor-ui-context');

/* -------------------------------------------------------------------------- */

let container: HTMLDivElement;
let root: Root;
let state: ReturnType<typeof useDocumentState>;
let ui: ReturnType<typeof useEditorUi>;
let uiDispatch: ReturnType<typeof useEditorUiDispatch>;
let puts: string[] = [];

function Probe() {
  state = useDocumentState();
  ui = useEditorUi();
  uiDispatch = useEditorUiDispatch();
  return null;
}

/** Elements placed by page index (0 = front cover; 1–2 = the first spread). */
function mount(placed: { page: number; el: EditorElement }[], select: string[] = []) {
  let d: EditorDoc = newEditorDoc(getFormatPreset('zine_a5')!);
  for (const p of placed) d = addElement(d, d.pages[p.page]!.id, p.el);
  act(() =>
    root.render(
      <DocumentProvider doc={d} revision={1}>
        <EditorUiProvider>
          <EditorShell publication={{ id: 'pub-test', title: 'T' }} />
          <Probe />
        </EditorUiProvider>
      </DocumentProvider>
    )
  );
  if (select.length) act(() => uiDispatch({ type: 'SET_SELECTION', ids: select }));
}

/* ------------------------------- reading the chrome ------------------------------- */

const attrsOf = (el: Element) => JSON.parse(el.getAttribute('data-attrs') ?? '{}') as Record<string, unknown>;
const named = (name: string) => [...container.querySelectorAll(`[data-name="${name}"]`)];
const border = () => {
  const b = named('multi-selection-border');
  return b.length ? (attrsOf(b[0]!) as { x: number; y: number; width: number; height: number; dash: number[]; listening: boolean }) : null;
};
const borders = () => named('multi-selection-border').length;
const outlines = () => named('selection-outline').map((e) => attrsOf(e) as { x: number; y: number; width: number; height: number });
const locks = () =>
  named('lock-indicator').map((e) => ({ ...(attrsOf(e) as { x: number; y: number; scaleX: number; scaleY: number; listening: boolean }), id: e.getAttribute('data-id')!.replace(/^lock-/, '') }));
const view = () => {
  const [x, y, scale] = (container.querySelector('[data-testid="spread-stage"]') as HTMLElement).dataset.view!.split(' ').map(Number) as [number, number, number];
  return { x, y, scale };
};
const offsets = () => (container.querySelector('[data-testid="spread-stage"]') as HTMLElement).dataset.pageOffsets!.split(' ').map(Number);
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const box = (b: { x: number; y: number; width: number; height: number } | null) => b && { x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) };
const unitButtons = () => [...container.querySelectorAll('ul button')] as HTMLButtonElement[];
const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement | undefined;

/* ------------------------------- driving a drag ------------------------------- */

/** Press an element node as Konva would deliver it, at a unit-space mm point. */
function pressElement(id: string, mm: { x: number; y: number }, shiftKey = false) {
  const v = view();
  const pt = { x: v.x + mm.x * v.scale, y: v.y + mm.y * v.scale };
  act(() =>
    K.nodes.get(id)!.onMouseDown({
      evt: { button: 0, shiftKey, clientX: pt.x, clientY: pt.y },
      target: { getStage: () => ({ getPointerPosition: () => pt }) },
      cancelBubble: false,
    })
  );
}
function mouse(type: 'mousemove' | 'mouseup', mm: { x: number; y: number }) {
  const v = view();
  act(() => void window.dispatchEvent(new MouseEvent(type, { clientX: v.x + mm.x * v.scale, clientY: v.y + mm.y * v.scale, bubbles: true, buttons: 1 })));
}
function key(k: string, init: KeyboardEventInit = {}) {
  act(() => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })));
}
async function flushSaves() {
  for (const ms of [AUTOSAVE_DEBOUNCE_MS + 10, 500, 1000, 2000, 4000]) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
}

/* -------------------------------------------------------------------------- */

const A = { ...newRectElement({ x: 20, y: 30 }), width: 40, height: 20 };
const B = { ...newEllipseElement({ x: 80, y: 70 }), width: 24, height: 36 };
const L = { ...newRectElement({ x: 30, y: 120 }), width: 30, height: 10, locked: true };

beforeEach(() => {
  vi.useFakeTimers();
  puts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      if ((init?.method ?? 'GET') === 'PUT') puts.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({ revision: 2 + puts.length }), { status: 200 });
    })
  );
  K.nodes.clear();
  K.attached = [];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/* ========================================================================== */

describe('stage 7 · A — the multi-selection border', () => {
  it('two objects with different origins and sizes: exactly one dashed [3, 2] union border, no per-object outlines, no handles', () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }], [A.id, B.id]);
    expect(borders()).toBe(1);
    expect(box(border())).toEqual({ x: 20, y: 30, width: 84, height: 76 }); // x 20..104, y 30..106
    expect(border()!.dash).toEqual([3, 2]);
    expect(border()!.listening).toBe(false);
    expect(outlines()).toEqual([]);
    expect(K.attached).toEqual([]);
  });

  it('a locked member is inside the union; it gets a padlock, and still no handles', () => {
    mount([{ page: 0, el: A }, { page: 0, el: L }], [A.id, L.id]);
    expect(box(border())).toEqual({ x: 20, y: 30, width: 40, height: 100 }); // y 30..130 — L included
    expect(locks().map((l) => l.id)).toEqual([L.id]);
    expect(K.attached).toEqual([]);
  });

  it('both pages of a spread: the recto member is placed at its page offset in the union', () => {
    const left = { ...newRectElement({ x: 100, y: 40 }), width: 30, height: 20 };
    const right = { ...newRectElement({ x: 10, y: 50 }), width: 20, height: 30 };
    mount([{ page: 1, el: left }, { page: 2, el: right }]);
    act(() => unitButtons()[1]!.click());
    const off = offsets();
    expect(off).toHaveLength(2);
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [left.id, right.id] }));
    expect(box(border())).toEqual(box({ x: 100, y: 40, width: off[1]! + 30 - 100, height: 40 })); // right edge = offset + 10 + 20
  });

  it('selected ids on another unit do not contaminate this unit\'s bounds', () => {
    const elsewhere = { ...newRectElement({ x: 5, y: 5 }), width: 100, height: 150 };
    mount([{ page: 0, el: A }, { page: 0, el: B }, { page: 1, el: elsewhere }], [A.id, B.id, elsewhere.id]);
    expect(ui.unitIndex).toBe(0);
    expect(box(border())).toEqual({ x: 20, y: 30, width: 84, height: 76 });
  });

  it('transitions: none → single (solid outline) → multi (dashed union) → single → none', () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }]);
    expect([borders(), outlines().length]).toEqual([0, 0]);
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [A.id] }));
    expect([borders(), outlines().length]).toEqual([0, 1]);
    expect(K.attached).toHaveLength(1); // single unlocked rect: handles
    act(() => uiDispatch({ type: 'TOGGLE_SELECTION', ids: [B.id] }));
    expect([borders(), outlines().length]).toEqual([1, 0]);
    expect(K.attached).toEqual([]);
    act(() => uiDispatch({ type: 'TOGGLE_SELECTION', ids: [A.id] }));
    expect([borders(), outlines().length]).toEqual([0, 1]);
    expect(box(outlines()[0]!)).toEqual({ x: 80, y: 70, width: 24, height: 36 });
    act(() => uiDispatch({ type: 'CLEAR_SELECTION' }));
    expect([borders(), outlines().length]).toEqual([0, 0]);
  });

  it('lock all / unlock all on a multi-selection: padlocks appear and go; the union border stays', async () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }], [A.id, B.id]);
    act(() => button('Lock all')!.click());
    expect(locks().map((l) => l.id).sort()).toEqual([A.id, B.id].sort());
    expect(borders()).toBe(1);
    act(() => button('Unlock all')!.click());
    expect(locks()).toEqual([]);
    expect(borders()).toBe(1);
  });

  it('drag preview of a mixed selection: the unlocked members move, the locked one stays, and the union is recomputed from the displayed boxes', () => {
    mount([{ page: 0, el: A }, { page: 0, el: L }], [A.id, L.id]);
    pressElement(A.id, { x: 30, y: 35 });
    mouse('mousemove', { x: 50, y: 15 }); // +20, −20 mm
    // A previewed at (40, 10) 40 × 20; L stays at (30, 120) 30 × 10 → union x 30..80, y 10..130.
    expect(box(border())).toEqual({ x: 30, y: 10, width: 50, height: 120 });
    // Not the original union (20..60 × 30..130) translated by (+20, −20): that would be x 40..80, y 10..110.
    expect(locks()[0]).toMatchObject({ id: L.id, x: 30 + LOCK_INSET_PX / view().scale, y: 120 + LOCK_INSET_PX / view().scale });
    mouse('mouseup', { x: 50, y: 15 });
    expect(state.history.map((h) => h.label)).toEqual(['Move']);
    expect(box(border())).toEqual({ x: 30, y: 10, width: 50, height: 120 }); // release = the document
  });

  it('drag cancelled with Escape: the border returns to the document union; no history', () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }], [A.id, B.id]);
    pressElement(A.id, { x: 30, y: 35 });
    mouse('mousemove', { x: 60, y: 45 });
    expect(box(border())).toEqual({ x: 50, y: 40, width: 84, height: 76 }); // both move +30, +10
    key('Escape');
    expect(box(border())).toEqual({ x: 20, y: 30, width: 84, height: 76 });
    mouse('mouseup', { x: 60, y: 45 });
    expect(state.history).toHaveLength(0);
  });

  it('undo and redo of a move: the border follows the restored document', () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }], [A.id, B.id]);
    pressElement(A.id, { x: 30, y: 35 });
    mouse('mousemove', { x: 40, y: 45 });
    mouse('mouseup', { x: 40, y: 45 });
    expect(box(border())).toEqual({ x: 30, y: 40, width: 84, height: 76 });
    key('z', { metaKey: true });
    expect(box(border())).toEqual({ x: 20, y: 30, width: 84, height: 76 });
    key('z', { metaKey: true, shiftKey: true });
    expect(box(border())).toEqual({ x: 30, y: 40, width: 84, height: 76 });
  });
});

describe('stage 7 · B — lock indicators', () => {
  it('every locked object gets one padlock, selected or not; unlocked objects none', () => {
    const L2 = { ...newEllipseElement({ x: 90, y: 20 }), width: 20, height: 20, locked: true };
    mount([{ page: 0, el: A }, { page: 0, el: L }, { page: 0, el: L2 }], []);
    expect(locks().map((l) => l.id).sort()).toEqual([L.id, L2.id].sort());
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [L.id] }));
    expect(locks()).toHaveLength(2);
    expect(locks().filter((l) => l.id === L.id)).toHaveLength(1);
  });

  it('placement from displayed bounds: rect and ellipse at their box top-left (not the ellipse\'s centre origin), a line at its normalised bounds, text at its top-left', () => {
    const E = { ...newEllipseElement({ x: 50, y: 60 }), width: 30, height: 20, locked: true };
    const ln = { ...newLineElement({ x: 100, y: 90 }), width: -40, height: -30, locked: true }; // bounds 60..100 × 60..90
    const tx = { ...newTextElement({ x: 15, y: 140 }), locked: true };
    mount([{ page: 0, el: L }, { page: 0, el: E }, { page: 0, el: ln }, { page: 0, el: tx }]);
    const k = LOCK_INSET_PX / view().scale;
    const at = Object.fromEntries(locks().map((l) => [l.id, { x: round(l.x), y: round(l.y) }]));
    expect(at[L.id]).toEqual({ x: round(30 + k), y: round(120 + k) });
    expect(at[E.id]).toEqual({ x: round(50 + k), y: round(60 + k) }); // not (65, 70), the Konva centre
    expect(at[ln.id]).toEqual({ x: round(60 + k), y: round(60 + k) }); // min of the endpoints, not (100, 90)
    expect(at[tx.id]).toEqual({ x: round(15 + k), y: round(140 + k) });
  });

  it('a locked object on the recto of a spread: its padlock carries the page offset', () => {
    const R = { ...newRectElement({ x: 10, y: 10 }), width: 20, height: 20, locked: true };
    mount([{ page: 2, el: R }]);
    act(() => unitButtons()[1]!.click());
    const k = LOCK_INSET_PX / view().scale;
    expect(round(locks()[0]!.x)).toBe(round(offsets()[1]! + 10 + k));
  });

  it('lock and unlock (inspector button, then undo) update the padlock at once', () => {
    mount([{ page: 0, el: A }], [A.id]);
    expect(locks()).toEqual([]);
    act(() => button('Lock')!.click());
    expect(locks().map((l) => l.id)).toEqual([A.id]);
    expect(K.attached).toEqual([]); // a locked single: no handles …
    expect(outlines()).toHaveLength(1); // … its solid outline stays
    key('z', { metaKey: true });
    expect(locks()).toEqual([]);
    act(() => button('Lock')!.click());
    act(() => button('Unlock')!.click());
    expect(locks()).toEqual([]);
  });

  it('constant screen size: group scale × view scale = 1 at low, normal and high zoom; inset 2 screen px', () => {
    mount([{ page: 0, el: L }]);
    for (const scale of [0.5, 3.4, 27]) {
      act(() => uiDispatch({ type: 'SET_VIEW', view: { x: 50, y: 40, scale } }));
      const l = locks()[0]!;
      expect(l.scaleX * scale).toBeCloseTo(1, 12);
      expect(l.scaleY * scale).toBeCloseTo(1, 12);
      expect((l.x - 30) * scale).toBeCloseTo(LOCK_INSET_PX, 9);
    }
    // The glyph's own extent (in its group's px units) is about LOCK_ICON_PX.
    const g = named('lock-indicator')[0]!;
    const parts = [...g.children].map((c) => ({ k: c.getAttribute('data-k'), ...attrsOf(c) })) as { k: string; x: number; y: number; width?: number; height?: number; outerRadius?: number }[];
    const right = Math.max(...parts.map((p) => (p.k === 'Arc' ? p.x + p.outerRadius! : p.x + (p.width ?? 0))));
    const bottom = Math.max(...parts.map((p) => (p.k === 'Arc' ? p.y : p.y + (p.height ?? 0))));
    expect(Math.max(right, bottom)).toBeGreaterThan(LOCK_ICON_PX - 1.5);
    expect(Math.max(right, bottom)).toBeLessThanOrEqual(LOCK_ICON_PX);
  });

  it('non-interactive: every padlock part and the multi border are listening=false, inside a non-listening layer', () => {
    mount([{ page: 0, el: A }, { page: 0, el: L }], [A.id, L.id]);
    const chrome = [...named('lock-indicator'), ...named('multi-selection-border')];
    expect(chrome.length).toBe(2);
    for (const el of chrome) {
      expect(attrsOf(el).listening).toBe(false);
      const layer = el.closest('[data-k="Layer"]')!;
      expect(attrsOf(layer).listening).toBe(false);
      for (const part of el.querySelectorAll('[data-k]')) expect(attrsOf(part).listening).toBe(false);
    }
  });
});

describe('stage 7 · C — visibility and non-mutation', () => {
  it('borders show under Select and Hand, hide under creation tools with the selection kept; padlocks stay under every tool', () => {
    mount([{ page: 0, el: A }, { page: 0, el: L }], [A.id, L.id]);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'hand' }));
    expect([borders(), locks().length]).toEqual([1, 1]);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'rect' }));
    expect([borders(), outlines().length, locks().length]).toEqual([0, 0, 1]);
    expect(ui.selection).toEqual([A.id, L.id]);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'ellipse' }));
    expect([borders(), locks().length]).toEqual([0, 1]);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'select' }));
    expect([borders(), locks().length]).toEqual([1, 1]);
    act(() => uiDispatch({ type: 'CLEAR_SELECTION' }));
    expect([borders(), locks().length]).toEqual([0, 1]); // padlocks are not selection chrome
  });

  it('single unlocked rect under Hand keeps its (inactive) handles; locked single and multi never get handles', () => {
    mount([{ page: 0, el: A }, { page: 0, el: L }], [A.id]);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'hand' }));
    expect(K.attached).toHaveLength(1);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'select' }));
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [L.id] }));
    expect(K.attached).toEqual([]);
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [A.id, L.id] }));
    expect(K.attached).toEqual([]);
  });

  it('showing, selecting, zooming, tool changes and navigating change no document, history or saves', async () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }, { page: 0, el: L }, { page: 2, el: { ...newRectElement({ x: 10, y: 10 }), width: 10, height: 10, locked: true } }]);
    const doc0 = state.doc;
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [A.id, B.id, L.id] }));
    act(() => uiDispatch({ type: 'SET_VIEW', view: { x: 10, y: 10, scale: 9 } }));
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'hand' }));
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'rect' }));
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'select' }));
    act(() => unitButtons()[1]!.click());
    expect(locks()).toHaveLength(1);
    act(() => unitButtons()[0]!.click());
    expect(state.doc).toBe(doc0);
    expect(state.history).toHaveLength(0);
    expect(state.doc === state.savedDoc).toBe(true);
    await flushSaves();
    expect(puts).toEqual([]);
  });

  it('control: the setup actions themselves (a drag, a lock) are the only saves — one each', async () => {
    mount([{ page: 0, el: A }, { page: 0, el: B }], [A.id, B.id]);
    pressElement(A.id, { x: 30, y: 35 });
    mouse('mousemove', { x: 40, y: 45 });
    mouse('mouseup', { x: 40, y: 45 });
    await flushSaves();
    expect(puts).toHaveLength(1);
    act(() => button('Lock all')!.click());
    await flushSaves();
    expect(puts).toHaveLength(2);
    expect(state.history.map((h) => h.label)).toEqual(['Move', state.history[1]!.label]);
  });
});
