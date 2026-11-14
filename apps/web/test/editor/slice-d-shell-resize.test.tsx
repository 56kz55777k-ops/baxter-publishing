// @vitest-environment jsdom
/**
 * Slice D stage 5 — the resize wiring through the REAL shell entry points
 * (plan §4.1–§4.7, §7 `slice-d-shell-resize.test.tsx`).
 *
 * Mounted for real: `EditorShell` (with its `onResize` → COMMIT), the real
 * document reducer and history, the REAL autosave hook (network stubbed: a
 * "save" is a counted PUT — no production data, no preview), `SpreadStage`,
 * `ElementsLayer`, `useResizeHost`, `SelectionTransformer` and
 * `ResizeSession`, and the real `useEditorKeyboard`.
 *
 * Stood in: `react-konva` (jsdom has no canvas). The fake Transformer below
 * behaves as Konva 10.3.0's does at the adapter's boundary — it calls the
 * adapter's `onTransformStart`, `anchorDragBoundFunc`, `boundBoxFunc`,
 * `onTransform` and `onTransformEnd` in Konva's order, computes Konva's
 * proposed box with the stage 2 port (`konvaStep`, matched to real Konva in
 * stage 1), fires `transformend` with the mouseup event on release and with
 * none on `stopTransform()`. Real Konva is exercised separately in the
 * Chromium probe (`docs/evidence/slice-d-stage5-probe/`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  addElement,
  findElement,
  getFormatPreset,
  newEditorDoc,
  newEllipseElement,
  newRectElement,
  type EditorDoc,
  type EditorElement,
  type ResizeAnchor,
} from '@baxter/domain';
import { AUTOSAVE_DEBOUNCE_MS } from '@/components/editor/state/autosave-core';
import { fitUnitView } from '@/components/editor/geometry';
import { ellipseNodeAttrs, rectNodeAttrs } from '@/components/editor/node-attrs';
import { anchorPositionPx, konvaStep, type PxBox } from './support/slice-d-konva-port';

/* -------------------------------------------------------------------------- */
/* The react-konva stand-in                                                     */
/* -------------------------------------------------------------------------- */

interface FakeNode {
  kind: 'rect' | 'ellipse';
  props: Record<string, unknown>;
  setAttrsCalls: Record<string, unknown>[];
  setAttrs(a: Record<string, unknown>): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- the react-konva stand-in mirrors Konva's untyped callback surface */
const K = vi.hoisted(() => ({
  nodes: new Map<string, unknown>(),
  trProps: null as Record<string, any> | null,
  stageProps: null as Record<string, any> | null,
  tr: null as any,
  pointer: { x: 0, y: 0 },
  size: { w: 1000, h: 800 },
  setSize: null as null | ((s: { w: number; h: number }) => void),
  content: null as unknown as HTMLDivElement,
}));

vi.mock('react-konva', async () => {
  const React = await import('react');
  const pass = (p: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, p.children);
  const shape = (kind: 'rect' | 'ellipse') => (p: Record<string, unknown>) => {
    if (typeof p.id === 'string') {
      const n = (K.nodes.get(p.id) as FakeNode | undefined) ?? {
        kind,
        props: {},
        setAttrsCalls: [],
        setAttrs(a: Record<string, unknown>) {
          this.setAttrsCalls.push(a);
        },
      };
      n.props = p;
      K.nodes.set(p.id, n);
    }
    return null;
  };
  return {
    Stage: (p: Record<string, any>) => {
      K.stageProps = p;
      return React.createElement('div', { 'data-konva': 'stage' }, p.children);
    },
    Layer: pass,
    Group: pass,
    Line: () => null,
    Rect: shape('rect'),
    Ellipse: shape('ellipse'),
    Transformer: React.forwardRef(function FakeTransformer(p: Record<string, any>, ref: React.Ref<unknown>) {
      K.trProps = p;
      React.useImperativeHandle(ref, () => K.tr, []);
      return null;
    }),
  };
});
/* eslint-enable @typescript-eslint/no-explicit-any */

vi.mock('@/components/editor/use-viewport-measure', async () => {
  const React = await import('react');
  return {
    useViewportMeasure: (_t: unknown, mirror?: { current: { w: number; h: number } }) => {
      const [s, set] = React.useState(K.size);
      K.setSize = set;
      if (mirror) mirror.current = s;
      return s;
    },
  };
});

function makeTransformer() {
  const stage = {
    findOne: (sel: string) => K.nodes.get(sel.slice(1)),
    getPointerPosition: () => ({ ...K.pointer }),
    content: K.content,
  };
  const tr = {
    activeAnchor: 'bottom-right' as ResizeAnchor,
    transforming: false,
    stopCalls: 0,
    attached: [] as unknown[],
    getActiveAnchor: () => tr.activeAnchor,
    nodes(arr?: unknown[]) {
      if (arr) {
        tr.attached = arr;
        return tr;
      }
      return tr.attached;
    },
    getStage: () => stage,
    getLayer: () => ({ batchDraw() {} }),
    isTransforming: () => tr.transforming,
    stopTransform() {
      tr.stopCalls++;
      if (!tr.transforming) return;
      tr.transforming = false;
      K.trProps!.onTransformEnd({ evt: undefined }); // Konva: _removeEvents() with no event
    },
  };
  return tr;
}

/* -------------------------------------------------------------------------- */
/* The shell                                                                   */
/* -------------------------------------------------------------------------- */

const { EditorShell } = await import('@/components/editor/EditorShell');
const { DocumentProvider, useDocumentState, useDocumentDispatch } = await import('@/components/editor/state/document-context');
const { EditorUiProvider, useEditorUi, useEditorUiDispatch } = await import('@/components/editor/state/editor-ui-context');

let container: HTMLDivElement;
let root: Root;
let state: ReturnType<typeof useDocumentState>;
let ui: ReturnType<typeof useEditorUi>;
let uiDispatch: ReturnType<typeof useEditorUiDispatch>;
let docDispatch: ReturnType<typeof useDocumentDispatch>;
let puts: string[] = [];

function Probe() {
  state = useDocumentState();
  ui = useEditorUi();
  uiDispatch = useEditorUiDispatch();
  docDispatch = useDocumentDispatch();
  return null;
}

const RECT = { ...newRectElement({ x: 20, y: 20 }), width: 40, height: 30 };
const ELLIPSE = { ...newEllipseElement({ x: 30, y: 60 }), width: 24, height: 18 };

function mount(elements: EditorElement[] = [RECT], select: string | null = RECT.id) {
  let d: EditorDoc = newEditorDoc(getFormatPreset('zine_a5')!);
  for (const el of elements) d = addElement(d, d.pages[0]!.id, el);
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
  if (select) act(() => uiDispatch({ type: 'SET_SELECTION', ids: [select] }));
}

const wrapper = () => container.querySelector('[data-testid="spread-stage"]') as HTMLDivElement;
const view = () => {
  const [x, y, scale] = wrapper().dataset.view!.split(' ').map(Number) as [number, number, number];
  return { x, y, scale };
};
const pill = () => container.querySelector('[data-testid="size-readout"]')?.textContent ?? null;
const node = (id: string) => K.nodes.get(id) as FakeNode;
const geometryOf = (id: string) => {
  const e = findElement(state.doc, id) as EditorElement & { x: number; y: number; width: number; height: number };
  return { x: e.x, y: e.y, width: e.width, height: e.height };
};

/* --------------------- driving the adapter as Konva does -------------------- */

let G: { box: PxBox; sin: number; cos: number } | null = null;

function press(id: string, anchor: ResizeAnchor = 'bottom-right') {
  const v = view();
  const g = geometryOf(id);
  const box = { x: v.x + g.x * v.scale, y: v.y + g.y * v.scale, w: g.width * v.scale, h: g.height * v.scale };
  const hyp = Math.hypot(box.w, box.h);
  G = { box, sin: box.h / hyp, cos: box.w / hyp };
  K.tr.activeAnchor = anchor;
  K.tr.transforming = true;
  K.pointer = anchorPositionPx(box, anchor);
  K.trProps!.onTransformStart({});
}

/** One Konva move to a unit-space mm point: anchorDragBoundFunc → (port) → boundBoxFunc → transform. */
function moveMm(mm: { x: number; y: number }, mods: { shiftKey?: boolean; altKey?: boolean } = {}) {
  const v = view();
  const p = { x: v.x + mm.x * v.scale, y: v.y + mm.y * v.scale };
  K.pointer = p;
  const oldAbs = anchorPositionPx(G!.box, K.tr.activeAnchor);
  const target = K.trProps!.anchorDragBoundFunc(oldAbs, p, { shiftKey: !!mods.shiftKey, altKey: !!mods.altKey });
  if (target.x === oldAbs.x && target.y === oldAbs.y) return 'unchanged';
  const keep = !!K.trProps!.keepRatio || !!mods.shiftKey;
  const k = konvaStep(G!.box, K.tr.activeAnchor, target, keep, !!mods.altKey, G!.sin, G!.cos);
  if (k.skip) return 'skip';
  K.tr.activeAnchor = k.anchor;
  const out = K.trProps!.boundBoxFunc(
    { x: G!.box.x, y: G!.box.y, width: G!.box.w, height: G!.box.h, rotation: 0 },
    { x: k.raw.x, y: k.raw.y, width: k.raw.w, height: k.raw.h, rotation: 0 }
  );
  G!.box = { x: out.x, y: out.y, w: out.width, h: out.height };
  K.trProps!.onTransform({});
  return 'proceed';
}

/** A real mouseup: Konva's capture-phase window listener → `_removeEvents(e)` → transformend WITH the event. */
function mouseup() {
  K.tr.transforming = false;
  K.trProps!.onTransformEnd({ evt: new MouseEvent('mouseup') });
}

function key(type: 'keydown' | 'keyup', k: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true, ...init });
  act(() => void target.dispatchEvent(e));
  return e;
}

/** Advance past the debounce in steps (as the autosave seam test does), letting each save settle. */
async function flushSaves() {
  for (const ms of [AUTOSAVE_DEBOUNCE_MS + 10, 500, 1000, 2000, 4000]) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }
}

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
  K.size = { w: 1000, h: 800 };
  K.content = document.createElement('div');
  K.tr = makeTransformer();
  G = null;
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

describe('stage 5 — a changed release: one COMMIT \'Resize\', selection and page kept, one save', () => {
  it('bottom-right to (71.234, 61.07) → 51.23 × 41.07, one history entry, one PUT; undo restores box and selection', async () => {
    mount();
    expect(K.tr.attached).toEqual([node(RECT.id)]); // attached by node id
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 71.234, y: 61.07 }));
    expect(pill()).toBe('51.23 × 41.07 mm');
    act(() => mouseup());
    expect(state.history).toHaveLength(1);
    expect(state.history[0]!.label).toBe('Resize');
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 51.23, height: 41.07 });
    expect(state.doc.pages[0]!.elements.map((e) => e.id)).toEqual([RECT.id]); // page ownership (#2)
    expect(ui.selection).toEqual([RECT.id]);
    expect(pill()).toBeNull();
    await flushSaves();
    expect(puts).toHaveLength(1);
    expect(puts[0]).toContain('51.23');
    act(() => void key('keydown', 'z', { metaKey: true }));
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 40, height: 30 });
    expect(ui.selection).toEqual([RECT.id]);
  });

  it('release before React renders: press, moves and mouseup in ONE act commit the last synchronously bounded payload', () => {
    mount();
    act(() => {
      press(RECT.id);
      moveMm({ x: 65, y: 55 });
      moveMm({ x: 71.234, y: 61.07 });
      // no render has happened: the Rect is still drawn from the model
      expect(node(RECT.id).props.width).toBe(40);
      mouseup();
    });
    expect(state.history).toHaveLength(1);
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 51.23, height: 41.07 });
  });

  it('ellipse, top-left corner: the committed geometry is page-relative top-left; the ellipse node is centre-origin', () => {
    mount([RECT, ELLIPSE], ELLIPSE.id);
    act(() => press(ELLIPSE.id, 'top-left'));
    act(() => void moveMm({ x: 25.5, y: 52.25 }));
    const n = node(ELLIPSE.id);
    const expected = { x: 25.5, y: 52.25, width: 28.5, height: 25.75 };
    expect(n.setAttrsCalls.at(-1)).toEqual(ellipseNodeAttrs(expected)); // the live node: radii, scale 1
    expect({ x: n.props.x, y: n.props.y, radiusX: n.props.radiusX, radiusY: n.props.radiusY, scaleX: n.props.scaleX }).toEqual({
      ...ellipseNodeAttrs(expected),
      scaleY: undefined,
    } as never as Record<string, number>);
    act(() => mouseup());
    expect(geometryOf(ELLIPSE.id)).toEqual(expected);
    expect(state.history.map((h) => h.label)).toEqual(['Resize']);
  });
});

describe('stage 5 — the preview: node attributes, ElementsLayer, pill and guides from the bounded session result', () => {
  it('rect: every transform sets nodeAttrsFor(payload) with scale 1, and ElementsLayer renders the same attributes', () => {
    mount();
    act(() => press(RECT.id));
    for (const p of [{ x: 64.37, y: 58.81 }, { x: 70.003, y: 49.996 }]) {
      act(() => void moveMm(p));
      const n = node(RECT.id);
      const last = n.setAttrsCalls.at(-1)!;
      expect(last).toMatchObject({ scaleX: 1, scaleY: 1 });
      const fromProps = { x: n.props.x, y: n.props.y, width: n.props.width, height: n.props.height, scaleX: n.props.scaleX, scaleY: n.props.scaleY };
      expect(fromProps).toEqual(last);
    }
    expect(node(RECT.id).setAttrsCalls.at(-1)).toEqual(rectNodeAttrs({ x: 20, y: 20, width: 50, height: 30 }));
    expect(pill()).toBe('50 × 30 mm');
    // the document is untouched until the COMMIT
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 40, height: 30 });
    expect(state.history).toHaveLength(0);
  });

  it('a snap target engages: the guide is drawn and the box lands on it (another element\'s left edge at 80)', () => {
    const other = { ...newRectElement({ x: 80, y: 100 }), width: 10, height: 10 };
    mount([RECT, other]);
    act(() => press(RECT.id, 'middle-right'));
    act(() => void moveMm({ x: 79.2, y: 35 }));
    expect(node(RECT.id).setAttrsCalls.at(-1)).toMatchObject({ width: 60 }); // 20 → 80
    act(() => mouseup());
    expect(geometryOf(RECT.id).width).toBe(60);
  });
});

describe('stage 5 — no history entry and no save for clicks, unchanged releases and cancellations', () => {
  const zero = async () => {
    expect(state.history).toHaveLength(0);
    await flushSaves();
    expect(puts).toEqual([]);
  };

  it('an anchor click (no 3 px crossing)', async () => {
    mount();
    const before = state.doc;
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 60.5, y: 50.3 })); // < 3 px at this zoom
    act(() => mouseup());
    expect(state.doc).toBe(before);
    await zero();
  });

  it('out and back to the start in H', async () => {
    mount();
    const before = state.doc;
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => void moveMm({ x: 60, y: 50 }));
    act(() => mouseup());
    expect(state.doc).toBe(before);
    await zero();
  });

  it('Escape: cancels, Konva\'s transform is stopped (its eventless transformend is a no-op), selection kept, the node restored', async () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    key('keydown', 'Escape');
    expect(K.tr.stopCalls).toBe(1);
    expect(K.tr.transforming).toBe(false);
    expect(ui.selection).toEqual([RECT.id]);
    expect(node(RECT.id).props).toMatchObject({ width: 40, height: 30 });
    expect(pill()).toBeNull();
    await zero();
  });

  it('window blur', async () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(ui.selection).toEqual([RECT.id]);
    await zero();
  });

  it('a save conflict mid-resize (the editor turns read-only) cancels it and stops Konva; the handles go away', async () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => docDispatch({ type: 'SAVE_CONFLICT', serverRevision: 9 }));
    expect(K.tr.stopCalls).toBe(1);
    expect(K.tr.transforming).toBe(false);
    expect(K.tr.attached).toEqual([]);
    expect(node(RECT.id).props).toMatchObject({ width: 40, height: 30 });
    expect(state.history).toHaveLength(0);
  });

  it('Konva\'s eventless transformend (stopTransform / destroy, F4) cancels', async () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => K.tr.stopTransform());
    await zero();
  });
});

describe('stage 5 — Space (Q2 (a)) through the real shell keyboard', () => {
  const panPress = () =>
    act(() =>
      K.stageProps!.onMouseDown({
        evt: { button: 0, clientX: 10, clientY: 10, shiftKey: false },
        target: { findAncestor: () => null, getStage: () => ({ getPointerPosition: () => ({ x: 10, y: 10 }) }) },
      })
    );

  it('Space pressed then released mid-resize: the resize finishes and commits; handles stay active after', () => {
    mount();
    act(() => press(RECT.id));
    key('keydown', ' ');
    act(() => void moveMm({ x: 71.234, y: 61.07 }));
    key('keyup', ' ');
    act(() => mouseup());
    expect(geometryOf(RECT.id).width).toBe(51.23);
    expect(state.history).toHaveLength(1);
    expect(K.trProps!.listening).toBe(true);
    expect(wrapper().style.cursor).toBe('default');
  });

  it('Space held through release: one commit; then handles inactive and a NEW press pans; the later keyup clears it', () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 71.234, y: 61.07 }));
    expect(wrapper().style.cursor).toBe('nwse-resize'); // the resize cursor outranks hand
    key('keydown', ' ');
    expect(wrapper().style.cursor).toBe('nwse-resize');
    act(() => mouseup());
    expect(state.history).toHaveLength(1);
    expect(K.trProps!.listening).toBe(false); // D-4: visible, inactive
    expect(K.tr.attached).toEqual([node(RECT.id)]);
    expect(wrapper().style.cursor).toBe('grab');
    panPress();
    expect(wrapper().style.cursor).toBe('grabbing');
    act(() => void window.dispatchEvent(new MouseEvent('mouseup')));
    key('keyup', ' ');
    expect(K.trProps!.listening).toBe(true);
    expect(wrapper().style.cursor).toBe('default');
  });

  it('Space held through Escape: zero commits, selection kept, pan available to a new press', async () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    key('keydown', ' ');
    key('keydown', 'Escape');
    expect(ui.selection).toEqual([RECT.id]);
    expect(state.history).toHaveLength(0);
    expect(wrapper().style.cursor).toBe('grab');
    panPress();
    expect(wrapper().style.cursor).toBe('grabbing');
  });

  it('Space held through window blur: zero commits, selection kept, Space cleared — no stuck pan after refocus', () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    key('keydown', ' ');
    act(() => void window.dispatchEvent(new Event('blur')));
    act(() => void window.dispatchEvent(new Event('focus')));
    expect(state.history).toHaveLength(0);
    expect(ui.selection).toEqual([RECT.id]);
    expect(K.trProps!.listening).toBe(true);
    expect(wrapper().style.cursor).toBe('default');
  });

  it('Space already held: handles inactive, no session can start, and the press pans instead', () => {
    mount();
    key('keydown', ' ');
    expect(K.trProps!.listening).toBe(false);
    // even if Konva delivered a transformstart, the adapter refuses it and stops Konva
    act(() => press(RECT.id));
    expect(K.tr.stopCalls).toBe(1);
    act(() => void moveMm({ x: 75, y: 70 }));
    expect(node(RECT.id).setAttrsCalls).toEqual([]);
    key('keyup', ' ');
  });

  it('under Hand the handles are visible and inactive, and an inner anchor cursor is cleared; under a creation tool there are none', () => {
    mount();
    K.content.style.cursor = 'nwse-resize'; // as a Konva anchor's mouseenter leaves it
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'hand' }));
    expect([K.trProps!.listening, K.tr.attached.length, K.content.style.cursor]).toEqual([false, 1, '']);
    act(() => uiDispatch({ type: 'SET_TOOL', tool: 'rect' }));
    expect(K.tr.attached).toEqual([]);
  });

  it('a press on a Transformer child never also reaches the stage\'s marquee or pan', () => {
    mount();
    key('keydown', ' ');
    act(() =>
      K.stageProps!.onMouseDown({
        evt: { button: 0, clientX: 10, clientY: 10, shiftKey: false },
        target: { findAncestor: (sel: string) => (sel === 'Transformer' ? {} : null), getStage: () => null },
      })
    );
    expect(wrapper().style.cursor).toBe('grab'); // not 'grabbing': no pan began
    key('keyup', ' ');
  });
});

describe('stage 5 — keyboard cleanup: the session\'s suppression outlives release until the key sequence finishes', () => {
  it('Space pressed on a focused button during the resize: after release its keyup and keyboard click cannot activate it', () => {
    mount();
    const button = document.createElement('button');
    let clicks = 0;
    button.addEventListener('click', () => void clicks++);
    document.body.appendChild(button);
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    key('keydown', ' ', {}, button);
    act(() => mouseup());
    const up = key('keyup', ' ', {}, button);
    act(() => void button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail: 0 })));
    expect([up.defaultPrevented, clicks]).toEqual([true, 0]);
    expect(K.trProps!.listening).toBe(true); // the keyup reached the shell: Space no longer held
    button.remove();
  });

  it('shortcuts are swallowed mid-resize (⌘Z, Delete, V) and work again after', () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    key('keydown', 'Delete');
    key('keydown', 'h');
    expect([ui.tool, findElement(state.doc, RECT.id) !== undefined]).toEqual(['select', true]);
    act(() => mouseup());
    key('keydown', 'z', { metaKey: true });
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 40, height: 30 });
  });
});

describe('stage 5 — viewport freeze and the deferred refit', () => {
  const wheel = (init: WheelEventInit = { deltaX: 0, deltaY: 50 }) => {
    const evt = new WheelEvent('wheel', { cancelable: true, ...init });
    act(() => K.stageProps!.onWheel({ evt, target: { getStage: () => ({ getPointerPosition: () => ({ x: 100, y: 100 }) }) } }));
    return evt;
  };

  it('wheel is blocked from the anchor press (threshold pending) and while active; it pans again after release', () => {
    mount();
    const v0 = wrapper().dataset.view;
    act(() => press(RECT.id));
    const w1 = wheel();
    const w2 = wheel({ deltaY: 40, ctrlKey: true });
    expect([w1.defaultPrevented, w2.defaultPrevented, wrapper().dataset.view]).toEqual([true, true, v0]);
    act(() => void moveMm({ x: 75, y: 70 }));
    wheel();
    expect(wrapper().dataset.view).toBe(v0);
    act(() => mouseup());
    wheel();
    expect(wrapper().dataset.view).not.toBe(v0);
  });

  it.each(['release', 'escape'] as const)('%s: three viewport size changes during the resize → no refit until the end, then ONE with the latest size', (end) => {
    mount();
    const v0 = wrapper().dataset.view;
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    for (const s of [{ w: 900, h: 700 }, { w: 1100, h: 760 }, { w: 1280, h: 720 }]) act(() => K.setSize!(s));
    expect(wrapper().dataset.view).toBe(v0);
    if (end === 'release') act(() => mouseup());
    else key('keydown', 'Escape');
    const fit = fitUnitView(
      { widthMm: 148, heightMm: 210, pageOffsetsMm: [0], bleedMm: 3.175, marginMm: 12, safeMm: 5 },
      1280,
      720
    );
    expect(wrapper().dataset.view).toBe(`${fit.x} ${fit.y} ${fit.scale}`);
  });

  it('no size change during the resize → no refit at the end (the view is not reset)', () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => mouseup());
    const after = wrapper().dataset.view;
    wheel();
    const panned = wrapper().dataset.view;
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 80, y: 72 }));
    act(() => mouseup());
    expect(after).not.toBe(panned);
    expect(wrapper().dataset.view).toBe(panned);
  });

  it('unmount mid-resize with a pending refit: no dispatch into the dead owner, no error, every session listener removed', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => K.setSize!({ w: 640, h: 480 }));
    const rem = vi.spyOn(window, 'removeEventListener');
    act(() => root.unmount());
    root = createRoot(container); // for afterEach
    const captureRemoved = rem.mock.calls.filter((c) => c[2] === true).map((c) => c[0]);
    expect(captureRemoved).toEqual(expect.arrayContaining(['keydown', 'keyup', 'click']));
    expect(errors).not.toHaveBeenCalled();
    key('keydown', 'z', { metaKey: true }); // nothing listening, nothing thrown
    rem.mockRestore();
    errors.mockRestore();
  });
});
