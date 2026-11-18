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
 *
 * The fake shapes keep the node's LIVE attributes as react-konva 19 does in
 * its default (non-strict) mode: a render applies only the props that changed
 * since the previous render, and `setAttrs` (the adapter's imperative write)
 * changes the live attributes directly. So a render whose props equal the
 * previous render's does not repair an imperative write — the condition behind
 * Codex's stage 5 finding 1.
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
  newImageElement,
  newLineElement,
  newRectElement,
  type EditorDoc,
  updateElement,
  type EditorElement,
  type ResizeAnchor,
} from '@baxter/domain';
import { AUTOSAVE_DEBOUNCE_MS } from '@/components/editor/state/autosave-core';
import { fitUnitView } from '@/components/editor/geometry';
import { ellipseNodeAttrs, nodeAttrsFor, rectNodeAttrs } from '@/components/editor/node-attrs';
import { anchorPositionPx, konvaStep, type PxBox } from './support/slice-d-konva-port';

/* -------------------------------------------------------------------------- */
/* The react-konva stand-in                                                     */
/* -------------------------------------------------------------------------- */

interface FakeNode {
  kind: 'rect' | 'ellipse';
  props: Record<string, unknown>;
  /** The node's live attributes: changed props on each render, plus every setAttrs. */
  live: Record<string, unknown>;
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
  /** Konva's keepProportion on the last move (stage 6: must agree with the session's ratio mode). */
  lastKonvaKeep: null as boolean | null,
}));

vi.mock('react-konva', async () => {
  const React = await import('react');
  const pass = (p: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, p.children);
  const shape = (kind: 'rect' | 'ellipse') => (p: Record<string, unknown>) => {
    if (typeof p.id === 'string') {
      const n = (K.nodes.get(p.id) as FakeNode | undefined) ?? {
        kind,
        props: {},
        live: {},
        setAttrsCalls: [],
        setAttrs(a: Record<string, unknown>) {
          this.setAttrsCalls.push(a);
          Object.assign(this.live, a);
        },
      };
      // react-konva's non-strict update: apply only the props that changed since the last render.
      for (const [k, v] of Object.entries(p)) if (!Object.is(n.props[k], v)) n.live[k] = v;
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
      // keepRatio as Konva holds it: react-konva applies the prop when it changes; the adapter may also set it.
      if (!K.trProps || !Object.is(K.trProps.keepRatio, p.keepRatio)) K.tr.keep = !!p.keepRatio;
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
    /** Konva's keepRatio() value. */
    keep: false,
    keepRatioCalls: [] as boolean[],
    keepRatio(v?: boolean) {
      if (v === undefined) return tr.keep;
      tr.keepRatioCalls.push(v);
      tr.keep = v;
      return tr;
    },
    forceUpdateCalls: 0,
    forceUpdate() {
      tr.forceUpdateCalls++;
    },
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
/** The live node's geometry and scale — what Konva would draw. */
const liveGeom = (id: string) => {
  const l = node(id).live;
  return node(id).kind === 'rect'
    ? { x: l.x, y: l.y, width: l.width, height: l.height, scaleX: l.scaleX, scaleY: l.scaleY }
    : { x: l.x, y: l.y, radiusX: l.radiusX, radiusY: l.radiusY, scaleX: l.scaleX, scaleY: l.scaleY };
};
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
  // Konva 10.3.0 `_handleMouseMove`: the keepProportion rule by `shiftBehavior` (the adapter sets 'default').
  const sb = K.trProps!.shiftBehavior ?? 'default';
  const keep = sb === 'inverted' ? K.tr.keep && !mods.shiftKey : sb === 'none' ? K.tr.keep : K.tr.keep || !!mods.shiftKey;
  K.lastKonvaKeep = keep;
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

/**
 * Advance past the debounce in steps (as the autosave seam test does), each in its own `act`.
 *
 * Why steps: the hook's `isDirty()` reads React state (`doc !== savedDoc`). A save's acknowledgement
 * (`SAVED`) only becomes visible to it once React renders, and React renders at an `act` boundary. One
 * long advance inside a single `act` keeps that state stale, so after the first save the scheduler still
 * sees the document as dirty and schedules redundant attempts (3 PUTs for one commit when measured).
 * It is NOT the max-wait timer firing during the in-flight save: `AutosaveScheduler` clears max-wait
 * before it calls `performSave`. Separate `act`s model the browser, where React renders between timer
 * tasks; the real-Konva probe's R1 counts exactly one PUT for one resize. (Corrected after Codex's
 * stage 5 review; autosave behaviour is unchanged.)
 */
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
  K.trProps = null;
  K.lastKonvaKeep = null;
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

/* ========================================================================== */

describe('stage 5 correction — a cancelled resize restores the LIVE node (Codex finding 1)', () => {
  const escapeRaw = () => void document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const cases = [
    { name: 'rect', el: RECT, to: { x: 75, y: 70 } },
    { name: 'ellipse', el: ELLIPSE, to: { x: 70, y: 95 } },
  ] as const;
  const modelAttrs = (el: EditorElement & { x: number; y: number; width: number; height: number }) => {
    const g = geometryOf(el.id);
    return nodeAttrsFor(el.type as 'rect' | 'ellipse', g);
  };

  for (const c of cases) {
    it(`${c.name}: Escape BEFORE the first preview render (press, move, Escape in one act) → live node = model, scale 1`, async () => {
      mount([c.el], c.el.id);
      const before = liveGeom(c.el.id);
      act(() => {
        press(c.el.id);
        moveMm(c.to);
        expect(node(c.el.id).live.width ?? node(c.el.id).live.radiusX).not.toBe(before.width ?? before.radiusX); // the imperative write happened
        escapeRaw();
      });
      expect(liveGeom(c.el.id)).toEqual(modelAttrs(c.el));
      expect(liveGeom(c.el.id)).toEqual(before);
      expect(geometryOf(c.el.id)).toEqual({ x: c.el.x, y: c.el.y, width: c.el.width, height: c.el.height });
      expect(state.history).toHaveLength(0);
      expect(pill()).toBeNull();
      expect(node(c.el.id).props).toMatchObject(modelAttrs(c.el)); // no preview left in the props
      expect(K.tr.transforming).toBe(false);
      expect(K.tr.forceUpdateCalls).toBeGreaterThan(0); // the handles re-fit the restored node
      await flushSaves();
      expect(puts).toEqual([]);
    });

    it(`${c.name}: Escape AFTER a rendered preview → live node = model, scale 1`, async () => {
      mount([c.el], c.el.id);
      const before = liveGeom(c.el.id);
      act(() => press(c.el.id));
      act(() => void moveMm(c.to));
      expect(pill()).not.toBeNull(); // the preview rendered
      key('keydown', 'Escape');
      expect(liveGeom(c.el.id)).toEqual(before);
      expect(liveGeom(c.el.id)).toEqual(modelAttrs(c.el));
      expect(state.history).toHaveLength(0);
      expect(pill()).toBeNull();
      await flushSaves();
      expect(puts).toEqual([]);
    });

    it(`${c.name}: after a before-render cancel, the next resize works and its changed release commits exactly once`, async () => {
      mount([c.el], c.el.id);
      act(() => {
        press(c.el.id);
        moveMm(c.to);
        escapeRaw();
      });
      key('keyup', 'Escape');
      act(() => press(c.el.id));
      act(() => void moveMm(c.to));
      act(() => mouseup());
      expect(state.history.map((h) => h.label)).toEqual(['Resize']);
      expect(geometryOf(c.el.id)).not.toEqual({ x: c.el.x, y: c.el.y, width: c.el.width, height: c.el.height });
      expect(liveGeom(c.el.id)).toEqual(modelAttrs(c.el)); // the committed geometry is what is drawn
      await flushSaves();
      expect(puts).toHaveLength(1);
    });
  }

  it('a newer document update is not overwritten: the element moved mid-resize (rendered), then Escape → live = the NEW model', () => {
    mount();
    act(() => press(RECT.id));
    act(() => void moveMm({ x: 75, y: 70 }));
    act(() => docDispatch({ type: 'COMMIT', nextDoc: updateElement(state.doc, RECT.id, { x: 25 }), selection: [RECT.id], label: 'Move' }));
    key('keydown', 'Escape');
    expect(geometryOf(RECT.id)).toEqual({ x: 25, y: 20, width: 40, height: 30 });
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs({ x: 25, y: 20, width: 40, height: 30 }));
  });

  it('a newer document update in the SAME act as the move and Escape (not yet rendered) still ends drawn as the new model', () => {
    mount();
    act(() => {
      press(RECT.id);
      moveMm({ x: 75, y: 70 });
      docDispatch({ type: 'COMMIT', nextDoc: updateElement(state.doc, RECT.id, { x: 25 }), selection: [RECT.id], label: 'Move' });
      escapeRaw();
    });
    expect(geometryOf(RECT.id)).toEqual({ x: 25, y: 20, width: 40, height: 30 });
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs({ x: 25, y: 20, width: 40, height: 30 }));
  });

  it('a save conflict (read-only) in the same act as the move: the handles detach, and the live node is still restored', () => {
    mount();
    act(() => {
      press(RECT.id);
      moveMm({ x: 75, y: 70 });
      docDispatch({ type: 'SAVE_CONFLICT', serverRevision: 9 });
    });
    expect(K.tr.attached).toEqual([]);
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs({ x: 20, y: 20, width: 40, height: 30 }));
    expect(state.history).toHaveLength(0);
  });

  it('blur and an eventless transformend restore the live node too', () => {
    mount();
    act(() => {
      press(RECT.id);
      moveMm({ x: 75, y: 70 });
      window.dispatchEvent(new Event('blur'));
    });
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs({ x: 20, y: 20, width: 40, height: 30 }));
    act(() => {
      press(RECT.id);
      moveMm({ x: 75, y: 70 });
      K.tr.stopTransform();
    });
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs({ x: 20, y: 20, width: 40, height: 30 }));
    expect(state.history).toHaveLength(0);
  });
});

/* ========================================================================== */
/* Stage 6 — D-2 Keep proportions (plan §4.10, §0.17)                          */
/* ========================================================================== */

const keepBox = () => container.querySelector('[data-testid="keep-proportions"]') as HTMLInputElement | null;
const numField = (name: 'w' | 'h') => container.querySelector(`[data-testid="num-${name}"]`) as HTMLInputElement;
const clickKeep = () => act(() => keepBox()!.click());
/** A 2:1 ellipse — a different ratio from the 4:3 rect. */
/**
 * Ratio mode (toggle or Shift) for the drag to (+30, +10) mm past the bottom-right corner. Checked by hand
 * against AC-4: the controlling axis is the larger start axis (W), exact on the 0.01 grid; H is derived and
 * rounded half-up — 64.5 × 3/4 = 48.375 → 48.38; 52.15 / 2 = 26.075 → 26.08. The fixed corner stays put.
 */
const ONEXP_RECT = { x: 20, y: 20, width: 64.5, height: 48.38 };
const ONEXP_ELL = { x: 30, y: 60, width: 52.15, height: 26.08 };
const WIDE = { ...newEllipseElement({ x: 30, y: 60 }), width: 24, height: 12 };

/** One full corner gesture: press, one move to `to` (unit mm), release. */
function drag(id: string, anchor: ResizeAnchor, to: { x: number; y: number }, mods: { shiftKey?: boolean; altKey?: boolean } = {}) {
  act(() => press(id, anchor));
  act(() => void moveMm(to, mods));
  act(() => mouseup());
}
const ratioHeld = (g: { width: number; height: number }, w0: number, h0: number) =>
  Math.abs(g.height - (g.width * h0) / w0) <= 0.011 || Math.abs(g.width - (g.height * w0) / h0) <= 0.011;

describe('stage 6 — Keep proportions: state and inspector UI', () => {
  it('defaults OFF: the checkbox is unchecked, the UI state false, Konva keepRatio false', () => {
    mount();
    expect(keepBox()).not.toBeNull();
    expect(keepBox()!.checked).toBe(false);
    expect(ui.keepProportions).toBe(false);
    expect(K.trProps!.keepRatio).toBe(false);
  });

  it('toggling changes only UI state: same document reference, no history, not dirty, no save', async () => {
    mount();
    const doc0 = state.doc;
    clickKeep();
    expect(keepBox()!.checked).toBe(true);
    expect(ui.keepProportions).toBe(true);
    expect(K.trProps!.keepRatio).toBe(true);
    clickKeep();
    clickKeep();
    expect(state.doc).toBe(doc0);
    expect(state.history).toHaveLength(0);
    expect(state.doc === state.savedDoc).toBe(true);
    await flushSaves();
    expect(puts).toEqual([]);
  });

  it('survives selection changes (other object, deselect, back) within the session', () => {
    mount([RECT, WIDE], RECT.id);
    clickKeep();
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [WIDE.id] }));
    expect(keepBox()!.checked).toBe(true);
    act(() => uiDispatch({ type: 'CLEAR_SELECTION' }));
    expect(keepBox()).toBeNull(); // the page panel has no checkbox
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [RECT.id] }));
    expect(keepBox()!.checked).toBe(true);
    expect(ui.keepProportions).toBe(true);
  });

  it('a fresh editor session (remount) starts OFF again; nothing was stored', () => {
    const before = { ...window.localStorage };
    mount();
    clickKeep();
    expect(ui.keepProportions).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(ui.keepProportions).toBe(false);
    expect(keepBox()!.checked).toBe(false);
    expect({ ...window.localStorage }).toEqual(before);
    expect(JSON.stringify(state.doc)).not.toContain('keepProportions');
  });

  it('label, caption and aria-describedby; placed in Position & Size directly under the X/Y/W/H grid', () => {
    mount();
    const box = keepBox()!;
    expect(box.type).toBe('checkbox');
    expect(box.labels?.[0]?.textContent?.trim()).toBe('Keep proportions');
    const caption = document.getElementById(box.getAttribute('aria-describedby')!)!;
    expect(caption.textContent).toBe('Corner handles only. Shift does the same. W and H are typed separately.');
    expect(caption.className).toContain('text-caption');
    const fieldset = box.closest('fieldset')!;
    expect(fieldset.querySelector('legend')!.textContent).toBe('Position & Size');
    const grid = numField('h').closest('.grid')!;
    expect(grid.nextElementSibling).toBe(box.closest('label')!.parentElement);
  });

  it('shown for rect and ellipse only: not for an image or a line', () => {
    const img = { ...newImageElement({ x: 10, y: 10 }), width: 30, height: 20 };
    const line = newLineElement({ x: 10, y: 10 });
    mount([RECT, WIDE, img, line], img.id);
    expect(numField('w')).not.toBeNull(); // the image has W/H …
    expect(keepBox()).toBeNull(); // … but no Keep proportions (images arrive with Slice E)
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [line.id] }));
    expect(keepBox()).toBeNull();
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [WIDE.id] }));
    expect(keepBox()).not.toBeNull();
  });

  it('disabled with the fieldset for a locked object and in a read-only editor', () => {
    mount([{ ...RECT, locked: true }], RECT.id);
    expect(keepBox()!.matches(':disabled')).toBe(true);
    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(keepBox()!.matches(':disabled')).toBe(false);
    act(() => docDispatch({ type: 'SAVE_CONFLICT', serverRevision: 9 }));
    expect(keepBox()!.matches(':disabled')).toBe(true);
  });

  it('native keyboard: Space and Enter on the focused checkbox stay native (not prevented, no editor pan)', () => {
    mount();
    const box = keepBox()!;
    act(() => box.focus());
    const space = key('keydown', ' ', {}, box);
    expect(space.defaultPrevented).toBe(false);
    expect(K.trProps!.listening).toBe(true); // Space did not become the editor's Space-pan
    key('keyup', ' ', {}, box);
    const enter = key('keydown', 'Enter', {}, box);
    expect(enter.defaultPrevented).toBe(false);
    act(() => box.click()); // the activation the browser performs for Space
    expect(ui.keepProportions).toBe(true);
  });

  it('editor shortcuts still work with the checkbox focused (⌘Z, Delete, H/V)', () => {
    mount();
    drag(RECT.id, 'bottom-right', { x: 75, y: 70 });
    expect(state.history).toHaveLength(1);
    const box = keepBox()!;
    act(() => box.focus());
    clickKeep();
    key('keydown', 'z', { metaKey: true }, box);
    expect(state.history).toHaveLength(0); // undone
    expect(ui.keepProportions).toBe(true); // undo does not touch the preference
    key('keydown', 'h', {}, box);
    expect(ui.tool).toBe('hand');
    key('keydown', 'v', {}, box);
    expect(ui.tool).toBe('select');
    key('keydown', 'Delete', {}, box);
    expect(state.doc.pages[0]!.elements).toHaveLength(0);
  });
});

describe('stage 6 — Keep proportions through the real wiring (fake Konva Transformer, real shell and session)', () => {
  const shapes = [
    { name: 'rect', el: RECT, w0: 40, h0: 30, br: { x: 60, y: 50 }, onExpected: ONEXP_RECT },
    { name: 'ellipse', el: WIDE, w0: 24, h0: 12, br: { x: 54, y: 72 }, onExpected: ONEXP_ELL },
  ] as const;
  for (const c of shapes) {
    // A target that is NOT proportional: +30 mm right, +10 mm down from the bottom-right corner.
    const to = { x: c.br.x + 30, y: c.br.y + 10 };

    it(`${c.name}: OFF, no Shift → free corner resize`, () => {
      mount([c.el], c.el.id);
      drag(c.el.id, 'bottom-right', to);
      expect(K.lastKonvaKeep).toBe(false);
      const g = geometryOf(c.el.id);
      expect(g).toMatchObject({ width: c.w0 + 30, height: c.h0 + 10 });
      expect(ratioHeld(g, c.w0, c.h0)).toBe(false);
    });

    it(`${c.name}: ON, no Shift → the gesture-start ratio, fixed corner pinned`, () => {
      mount([c.el], c.el.id);
      clickKeep();
      drag(c.el.id, 'bottom-right', to);
      expect(K.lastKonvaKeep).toBe(true); // Konva proportional too — the two sides agree
      const g = geometryOf(c.el.id);
      expect(ratioHeld(g, c.w0, c.h0)).toBe(true);
      expect(g).toEqual(c.onExpected); // AC-4: the controlling (larger start) axis exact, the other derived
      expect({ x: g.x, y: g.y }).toEqual({ x: c.el.x, y: c.el.y });
    });

    it(`${c.name}: OFF + Shift → ratio`, () => {
      mount([c.el], c.el.id);
      drag(c.el.id, 'bottom-right', to, { shiftKey: true });
      expect(K.lastKonvaKeep).toBe(true);
      expect(geometryOf(c.el.id)).toEqual(c.onExpected); // Shift = the toggle
    });

    it(`${c.name}: ON + Shift → still ratio (Shift adds, never inverts)`, () => {
      mount([c.el], c.el.id);
      clickKeep();
      drag(c.el.id, 'bottom-right', to, { shiftKey: true });
      expect(K.lastKonvaKeep).toBe(true); // Shift adds; it does not invert the toggle
      expect(geometryOf(c.el.id)).toEqual(c.onExpected);
    });

    it(`${c.name}: ON (and ON + Shift) → side handles stay independent`, () => {
      mount([c.el], c.el.id);
      clickKeep();
      drag(c.el.id, 'middle-right', { x: c.br.x + 20, y: c.br.y + 15 });
      expect(K.lastKonvaKeep).toBe(true); // Konva's flag is set, but its side branches ignore it — as the session's
      expect(geometryOf(c.el.id)).toMatchObject({ width: c.w0 + 20, height: c.h0 });
      drag(c.el.id, 'bottom-center', { x: c.br.x + 50, y: c.br.y + 15 }, { shiftKey: true });
      expect(geometryOf(c.el.id)).toMatchObject({ width: c.w0 + 20, height: c.h0 + 15 });
    });

    it(`${c.name}: ON — a changed release is one 'Resize' and one save; a click, an unchanged release and Escape add nothing`, async () => {
      mount([c.el], c.el.id);
      clickKeep();
      act(() => press(c.el.id, 'bottom-right'));
      act(() => void moveMm({ x: c.br.x + 0.2, y: c.br.y + 0.1 })); // under 3 px
      act(() => mouseup());
      act(() => press(c.el.id, 'bottom-right'));
      act(() => void moveMm(to));
      act(() => void moveMm(c.br)); // back to the start in H
      act(() => mouseup());
      act(() => press(c.el.id, 'bottom-right'));
      act(() => void moveMm(to));
      key('keydown', 'Escape');
      key('keyup', 'Escape');
      expect(state.history).toHaveLength(0);
      await flushSaves();
      expect(puts).toEqual([]);
      drag(c.el.id, 'bottom-right', to);
      expect(state.history.map((h) => h.label)).toEqual(['Resize']);
      await flushSaves();
      expect(puts).toHaveLength(1);
    });
  }

  it('a differently proportioned object uses ITS gesture-start ratio, not the previous object\'s', () => {
    mount([RECT, WIDE], RECT.id);
    clickKeep();
    drag(RECT.id, 'bottom-right', { x: 90, y: 60 });
    expect(ratioHeld(geometryOf(RECT.id), 40, 30)).toBe(true);
    act(() => uiDispatch({ type: 'SET_SELECTION', ids: [WIDE.id] }));
    drag(WIDE.id, 'bottom-right', { x: 84, y: 82 });
    const g = geometryOf(WIDE.id);
    expect(ratioHeld(g, 24, 12)).toBe(true); // 2:1
    expect(ratioHeld(g, 40, 30)).toBe(false); // not the rect's 4:3
  });

  it('the ratio is the gesture-start box\'s: after a free resize changes the shape, ON uses the new ratio', () => {
    mount();
    drag(RECT.id, 'bottom-right', { x: 80, y: 50 }); // free: 60 × 30 (2:1)
    expect(geometryOf(RECT.id)).toMatchObject({ width: 60, height: 30 });
    clickKeep();
    drag(RECT.id, 'bottom-right', { x: 100, y: 70 });
    expect(ratioHeld(geometryOf(RECT.id), 60, 30)).toBe(true);
  });

  it('ON: typed and stepped W/H stay independent (W never changes H, H never changes W)', () => {
    mount();
    clickKeep();
    const w = numField('w');
    act(() => w.focus());
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(w, '60');
      w.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => void w.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 60, height: 30 });
    const h = numField('h');
    act(() => h.focus());
    act(() => void h.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })));
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 60, height: 31 });
    act(() => void w.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true, cancelable: true })));
    expect(geometryOf(RECT.id)).toEqual({ x: 20, y: 20, width: 55, height: 31 });
  });

  it('Konva and the session agree for the whole gesture: keepRatio is pinned at the press even if the preference changes mid-gesture', () => {
    mount();
    clickKeep();
    act(() => press(RECT.id, 'bottom-right'));
    expect(K.tr.keepRatioCalls).toEqual([true]); // pinned at the press
    act(() => uiDispatch({ type: 'SET_KEEP_PROPORTIONS', value: false })); // not reachable by a user mid-drag
    expect(K.trProps!.keepRatio).toBe(true);
    expect(K.tr.keep).toBe(true);
    act(() => void moveMm({ x: 90, y: 60 }));
    act(() => mouseup());
    expect(ratioHeld(geometryOf(RECT.id), 40, 30)).toBe(true); // the session's input was ON too
    expect(K.trProps!.keepRatio).toBe(false); // released: back to the preference
    expect(K.tr.keep).toBe(false);
  });

  it('ON: Alt keeps the centre fixed and stays proportional (accepted Alt behaviour)', () => {
    mount();
    clickKeep();
    drag(RECT.id, 'bottom-right', { x: 70, y: 70 }, { altKey: true });
    const g = geometryOf(RECT.id);
    expect(ratioHeld(g, 40, 30)).toBe(true);
    // AC-5: the centre within 0.005 mm, compared in doubled hundredths (float-safe).
    expect(Math.abs(Math.round((2 * g.x + g.width) * 100) - 8000)).toBeLessThanOrEqual(1);
    expect(Math.abs(Math.round((2 * g.y + g.height) * 100) - 7000)).toBeLessThanOrEqual(1);
  });

  it('ON: Q7 — a drag far past the fixed corner holds it at the ratio minimum box', () => {
    mount();
    clickKeep();
    drag(RECT.id, 'bottom-right', { x: -40, y: -60 });
    const g = geometryOf(RECT.id);
    expect({ x: g.x, y: g.y }).toEqual({ x: 20, y: 20 });
    expect(g).toMatchObject({ width: 5.34, height: 4.01 });
  });

  it('ON: Escape before the first preview render restores the live node; the next resize commits once, drawn as committed', async () => {
    mount();
    clickKeep();
    act(() => {
      press(RECT.id, 'bottom-right');
      moveMm({ x: 90, y: 60 });
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    key('keyup', 'Escape');
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs({ x: 20, y: 20, width: 40, height: 30 }));
    expect(state.history).toHaveLength(0);
    expect(K.trProps!.keepRatio).toBe(true);
    drag(RECT.id, 'bottom-right', { x: 90, y: 60 });
    expect(state.history.map((h) => h.label)).toEqual(['Resize']);
    expect(liveGeom(RECT.id)).toEqual(rectNodeAttrs(geometryOf(RECT.id)));
    await flushSaves();
    expect(puts).toHaveLength(1);
  });
});
