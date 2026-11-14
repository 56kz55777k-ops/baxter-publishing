/**
 * The resize session — Slice D stage 4 (plan §4.3–§4.6, §0.10–§0.11).
 *
 * One session per resize gesture, from the anchor press (`transformstart`)
 * to release or cancel, threshold-pending included. It owns every piece of
 * transient gesture state (ADR-003 invariant 4) and is deliberately
 * Konva-free: Konva's callbacks arrive as explicit inputs, and the owner
 * learns the outcome through three callbacks. That is what makes the whole
 * policy testable in jsdom, where no canvas exists.
 *
 *   anchorBound(oldAbs, proposed, pointer, mods, activeAnchor)
 *       ← Konva `anchorDragBoundFunc`. D-5 threshold (screen px), segment
 *         capture before Konva runs (§3.5 step 2), the Q7 ratio anchor clamp
 *         (§3.5 step 0).
 *   boxBound(oldBox, raw, activeAnchor, mods)
 *       ← Konva `boundBoxFunc`. `boundResize`, then the payload, written
 *         SYNCHRONOUSLY (the release-point rule: release commits the last
 *         payload processed here, never a value recomputed from mouseup
 *         coordinates or from a React render).
 *   release() / transformEnd(hadMouseUp) / cancel(reason) / dispose()
 *       ← mouseup, `transformend`, readOnly, unmount. Release commits AT
 *         MOST once: only when the threshold was crossed and the final box
 *         differs from the start in H (§0.11 clarification 2).
 *   handleWheel(evt) / noteViewportSize(size)
 *       ← the viewport freeze (§4.6): wheel blocked from the press; viewport
 *         size changes deferred into one refit, with the latest size,
 *         reported at the end.
 *
 * Keyboard (§4.5). While the session lives, its capture-phase listeners on
 * the window see every key first and stop it from reaching the shell's
 * handlers — no ⌘Z, Delete, nudge, clipboard, tool letter or Escape-deselect
 * can run mid-gesture (Q3 default: only resize is guarded). Escape cancels.
 * Space is TRACKED whatever the focused target (the shell hook returns early
 * on a focused button), and Space/Enter on a focused control are prevented,
 * so the control cannot activate. Q2 (a): Space does not change the session.
 *
 * After the session ends, a Space, Enter or Escape it swallowed keeps a
 * residual suppression until that key's keyup: auto-repeats of Escape never
 * reach the resting-state deselect, and a focused control cannot activate on
 * keyup (or through the keyboard `click` that follows it). Residuals end on
 * the keyup, a fresh (non-repeat) press, window blur, or `dispose()`.
 *
 * Space at the end (§0.11 clarification 1): release and Escape report the
 * tracked value; window blur reports false and clears everything (#26). The
 * owner syncs its own Space state from `onEnd`. Panning needs a NEW press
 * (`panMayStart`); a resize drag is never turned into a pan.
 *
 * NOT CONNECTED IN STAGE 4 (stage 5, unauthorized): nothing in the editor
 * creates a session yet. No Transformer calls these hooks, no node or
 * preview layer consumes `onPreview`, the shell's `onResize` is not wired
 * to `onCommit`, and `SpreadStage`'s wheel, refit and pan paths do not
 * consult `handleWheel`, `noteViewportSize` or `panMayStart`.
 */
import {
  boundResize,
  createResizeState,
  ratioMinimumBox,
  resizePayload,
  sameBoxH,
  startBoxH,
  withSegment,
  type BoxH,
  type ResizeAnchor,
  type ResizeState,
  type StoredGeometry,
  type TargetsH2,
} from '@baxter/domain';
import { pastIntentThreshold } from './geometry';
import type { EditorTool, ViewTransform } from './state/editor-ui';
import { isControlTarget } from './use-editor-keyboard';

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

/** Absolute stage px. */
export interface PxPoint {
  x: number;
  y: number;
}

/** Konva's Transformer box: absolute stage px (Konva may pass a negative extent). */
export interface PxBox {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

/** Sampled from the same pointer event Konva reads, per move. */
export interface ResizeModifiers {
  shift: boolean;
  alt: boolean;
}

export type ResizePhase = 'pending' | 'active' | 'ended';

export type ResizeEndReason = 'release' | 'escape' | 'blur' | 'readOnly' | 'transformend';

export interface ViewportSizeLike {
  w: number;
  h: number;
}

export interface ResizePreview {
  /** The bounded box, unit space, H. */
  box: BoxH;
  /** What release would commit (stored, page-relative numbers). The same object release passes to `onCommit`. */
  payload: StoredGeometry;
  guideX2: number | null;
  guideY2: number | null;
}

export interface ResizeEnd {
  reason: ResizeEndReason;
  /** True only when `onCommit` was called for this session (at most once). */
  committed: boolean;
  /** Space held at the end: the tracked value on release/Escape/readOnly/transformend, false on blur (#26). */
  spaceHeld: boolean;
  /** The deferred refit (§4.6): the latest viewport size noted during the session, or null if none. */
  refit: ViewportSizeLike | null;
}

export interface ResizeSessionInput {
  elementId: string;
  /** The element's stored geometry (page-relative mm), read at the press. */
  stored: StoredGeometry;
  /** The element's page offset in the unit, H. */
  pageOffsetH: number;
  targets: TargetsH2;
  /** The active anchor at the press. */
  anchor: ResizeAnchor;
  /** The view at the press. Frozen for the session (§4.6), so every conversion uses it. */
  view: ViewTransform;
  /** The press point, absolute stage px (the D-5 threshold is measured from it). */
  pressPoint: PxPoint;
  /** D-2 Keep proportions (session-only UI state; stage 6 supplies it). */
  keepProportions: boolean;
  /** Where the session listens for keys and blur — `window` in the editor. */
  keyTarget: EventTarget;
}

export interface ResizeSessionCallbacks {
  /** Each bounded move's preview, then `null` once at the end. */
  onPreview: (preview: ResizePreview | null) => void;
  /** At most once, on a release that crossed the threshold and changed the box in H. */
  onCommit: (elementId: string, payload: StoredGeometry) => void;
  /** Exactly once per session, except after `dispose()`, which calls nothing. */
  onEnd: (end: ResizeEnd) => void;
}

export interface ResizeSessionSnapshot {
  phase: ResizePhase;
  spaceHeld: boolean;
  box: BoxH;
  payload: StoredGeometry;
  segmentKey: string | null;
  /** Any listener of this session still attached to `keyTarget`. */
  listening: boolean;
  /** Keys whose keyup is still being suppressed after the session. */
  residualKeys: string[];
}

/* -------------------------------------------------------------------------- */
/* Pure policies (consumed by stage 5)                                          */
/* -------------------------------------------------------------------------- */

export interface ResizeStartContext {
  spaceHeld: boolean;
  tool: EditorTool;
  readOnly: boolean;
  selectionCount: number;
  locked: boolean;
}

/**
 * Whether an anchor press may start a resize session. D-4: under Hand or a
 * held Space the handles stay visible but inactive — no session. D-6: no
 * handles for multi-selection or a locked object. A conflict or closed
 * window (readOnly) edits nothing.
 */
export function resizeMayStart(c: ResizeStartContext): boolean {
  return !c.spaceHeld && c.tool === 'select' && !c.readOnly && c.selectionCount === 1 && !c.locked;
}

/**
 * Whether a pointer PRESS may start a pan (the same rule as `SpreadStage`'s
 * `panAvailable`, plus: never while a resize session lives). It is asked
 * only on a press, so a pan is always a new gesture — a resize drag is never
 * converted into one (§0.11 clarification 1).
 */
export function panMayStart(c: { spaceHeld: boolean; tool: EditorTool; session: ResizeSession | null }): boolean {
  if (c.session !== null && c.session.isLive()) return false;
  return c.spaceHeld || c.tool === 'hand';
}

/**
 * The ratio anchor clamp (plan §3.5 step 0; Q7 (a), decided 2026-11-12).
 * One-edge ratio only (a corner, ratio on, no Alt): on each axis, a proposed
 * anchor closer to the segment's fixed corner than the ratio minimum box's
 * extent is moved to exactly that extent, so Konva never sees a negative
 * extent and never renames the anchor. Returns null when the segment is not
 * one-edge ratio. Konva's own skips (F1), its unchanged-anchor hold (S2-1)
 * and the zero-H ratio hold (§3.2) still apply on top of it (§0.11
 * clarification 3).
 */
export function ratioAnchorClamp(
  state: ResizeState,
  view: ViewTransform,
  target: PxPoint
): { target: PxPoint; clamped: boolean; minExtentPx: { w: number; h: number } } | null {
  const g = state.segment;
  if (g === null || !g.ratio || g.alt || g.fixedX === undefined || g.fixedY === undefined) return null;
  const min = ratioMinimumBox(state);
  const minExtentPx = { w: (min.w / 100) * view.scale, h: (min.h / 100) * view.scale };
  const Fx = (g.fixedX / 100) * view.scale + view.x;
  const Fy = (g.fixedY / 100) * view.scale + view.y;
  const out = { x: target.x, y: target.y };
  let clamped = false;
  if (g.xs * (out.x - Fx) < minExtentPx.w) {
    out.x = Fx + g.xs * minExtentPx.w;
    clamped = true;
  }
  if (g.ys * (out.y - Fy) < minExtentPx.h) {
    out.y = Fy + g.ys * minExtentPx.h;
    clamped = true;
  }
  return { target: out, clamped, minExtentPx };
}

/** Keys whose page default the guard prevents mid-session (scroll, bookmark, select-all, back-navigation). */
function preventsDefaultMidSession(e: KeyboardEvent): boolean {
  if (e.key.startsWith('Arrow') || e.key === 'Delete' || e.key === 'Backspace' || e.key === 'Tab') return true;
  if (e.metaKey || e.ctrlKey) return ['z', 'd', 'c', 'x', 'v', 'a'].includes(e.key.toLowerCase());
  return false;
}

/** Keys the session remembers so their keyup (and auto-repeat) stays suppressed after it ends. */
const RESIDUAL_KEYS = new Set([' ', 'Enter', 'Escape']);

/* -------------------------------------------------------------------------- */
/* The session                                                                 */
/* -------------------------------------------------------------------------- */

export class ResizeSession {
  private phase: ResizePhase = 'pending';
  private state: ResizeState;
  private readonly start: BoxH;
  private payload: StoredGeometry;
  private lastAnchorPx: PxPoint | null = null;
  private spaceHeld = false;
  private pendingRefit: ViewportSizeLike | null = null;
  /** key → the target it was pressed on, for keys swallowed while the session lived. */
  private readonly residual = new Map<string, EventTarget | null>();
  /** A keyup was just suppressed on this target: swallow the keyboard click its default action may fire. */
  private clickGuard: EventTarget | null = null;
  private clickGuardTimer: ReturnType<typeof setTimeout> | null = null;
  private listening = false;
  /**
   * Set by `dispose()` only. `phase === 'ended'` stops a second termination;
   * this stops owner callbacks: once the owner disposes the session — even
   * from inside one of its own callbacks while `finish` is running — no
   * further callback reaches it (Codex stage 4 review, 2026-11-12).
   */
  private disposed = false;

  constructor(
    private readonly input: ResizeSessionInput,
    private readonly cb: ResizeSessionCallbacks
  ) {
    this.start = startBoxH(input.stored, input.pageOffsetH);
    this.state = createResizeState(this.start, input.targets);
    this.payload = resizePayload(input.stored, this.start, this.start, input.pageOffsetH);
    this.attach();
  }

  /* ----------------------------- queries ---------------------------------- */

  isLive(): boolean {
    return this.phase !== 'ended';
  }

  snapshot(): ResizeSessionSnapshot {
    return {
      phase: this.phase,
      spaceHeld: this.spaceHeld,
      box: { ...this.state.prev },
      payload: this.payload,
      segmentKey: this.state.segment?.key ?? null,
      listening: this.listening,
      residualKeys: [...this.residual.keys()],
    };
  }

  /* ----------------------------- Konva hooks ------------------------------ */

  /**
   * Konva `anchorDragBoundFunc`. Returns `oldAbs` (no move) until the
   * pointer is 3 screen px from the press; the move that crosses applies the
   * full proposed displacement. Then captures the segment for this move's
   * key and applies the Q7 ratio clamp.
   */
  anchorBound(oldAbs: PxPoint, proposed: PxPoint, pointer: PxPoint, mods: ResizeModifiers, activeAnchor: ResizeAnchor): PxPoint {
    if (this.phase === 'ended') return oldAbs;
    if (this.phase === 'pending') {
      if (!pastIntentThreshold(this.input.pressPoint, pointer)) return oldAbs;
      this.phase = 'active';
    }
    this.state = withSegment(this.state, activeAnchor, this.ratioRequested(mods), mods.alt);
    const clamp = ratioAnchorClamp(this.state, this.input.view, proposed);
    const target = clamp ? clamp.target : { x: proposed.x, y: proposed.y };
    this.lastAnchorPx = target;
    return target;
  }

  /**
   * Konva `boundBoxFunc`: Konva's proposed box (after its possible anchor
   * rename) → the bounded box, in px. The payload is written here,
   * synchronously, before this returns.
   */
  boxBound(oldBox: PxBox, raw: PxBox, activeAnchor: ResizeAnchor, mods: ResizeModifiers): PxBox {
    if (this.phase !== 'active' || this.lastAnchorPx === null) return oldBox;
    const v = this.input.view;
    const rawMm = {
      left: (raw.x - v.x) / v.scale,
      right: (raw.x + raw.width - v.x) / v.scale,
      top: (raw.y - v.y) / v.scale,
      bottom: (raw.y + raw.height - v.y) / v.scale,
    };
    const anchorPoint = { x: (this.lastAnchorPx.x - v.x) / v.scale, y: (this.lastAnchorPx.y - v.y) / v.scale };
    const r = boundResize(this.state, { anchor: activeAnchor, ratio: this.ratioRequested(mods), alt: mods.alt, raw: rawMm, anchorPoint });
    this.state = r.state;
    this.payload = resizePayload(this.input.stored, this.start, r.box, this.input.pageOffsetH);
    this.cb.onPreview({ box: { ...r.box }, payload: this.payload, guideX2: r.guideX2, guideY2: r.guideY2 });
    if (this.disposed) return oldBox; // the owner unmounted inside the preview: nothing more to give it
    return {
      x: (r.box.x / 100) * v.scale + v.x,
      y: (r.box.y / 100) * v.scale + v.y,
      width: (r.box.w / 100) * v.scale,
      height: (r.box.h / 100) * v.scale,
      rotation: oldBox.rotation ?? 0,
    };
  }

  /* ----------------------------- termination ------------------------------ */

  /** The pointer was released (a real mouseup). Commits at most once. */
  release(): boolean {
    return this.finish('release');
  }

  /** Konva `transformend`: with a mouseup it is a release; without one (stopTransform/destroy) a cancel (F4). */
  transformEnd(hadMouseUp: boolean): boolean {
    return this.finish(hadMouseUp ? 'release' : 'transformend');
  }

  /** Cancel with zero trace: no commit, no save, selection untouched (D-3). */
  cancel(reason: Exclude<ResizeEndReason, 'release'>): boolean {
    return this.finish(reason);
  }

  /**
   * The owner is unmounting. Ends the session and every residual silently:
   * no callback reaches a dead owner. Idempotent.
   */
  dispose(): void {
    this.disposed = true;
    this.phase = 'ended';
    this.pendingRefit = null;
    this.residual.clear();
    this.clearClickGuard();
    this.detach();
  }

  /* ----------------------------- viewport freeze -------------------------- */

  /** Wheel from the press on: prevented and consumed (no pan, zoom or browser zoom). Returns true when blocked. */
  handleWheel(evt: { preventDefault(): void }): boolean {
    if (!this.isLive()) return false;
    evt.preventDefault();
    return true;
  }

  /** A viewport size change. While live it is deferred (latest wins) and true is returned: the owner must not refit now. */
  noteViewportSize(size: ViewportSizeLike): boolean {
    if (!this.isLive()) return false;
    this.pendingRefit = { w: size.w, h: size.h };
    return true;
  }

  /* ----------------------------- internals -------------------------------- */

  private ratioRequested(mods: ResizeModifiers): boolean {
    return this.input.keepProportions || mods.shift;
  }

  private finish(reason: ResizeEndReason): boolean {
    if (this.phase === 'ended') return false;
    const crossed = this.phase === 'active';
    this.phase = 'ended'; // first: any reentrant call from a callback below is a no-op
    if (reason === 'blur') {
      this.spaceHeld = false; // #26: blur clears modifier state
      this.residual.clear(); // keyups will not arrive; nothing may stay suppressed
      this.clearClickGuard();
    }
    const commit = reason === 'release' && crossed && !sameBoxH(this.state.prev, this.start);
    const payload = this.payload;
    const refit = this.pendingRefit;
    this.pendingRefit = null;
    this.maybeDetach();
    // Normal order: commit → preview cleared → end. A callback may dispose the session (the owner
    // unmounting synchronously); every later callback is then skipped, the deferred refit included.
    if (commit && !this.disposed) this.cb.onCommit(this.input.elementId, payload);
    if (!this.disposed) this.cb.onPreview(null);
    if (!this.disposed) this.cb.onEnd({ reason, committed: commit, spaceHeld: this.spaceHeld, refit });
    return true;
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.phase !== 'ended') {
      // The guard: nothing reaches the shell's handlers mid-session.
      e.stopImmediatePropagation();
      if (e.key === ' ') {
        this.spaceHeld = true;
        e.preventDefault(); // no page scroll; a focused control cannot activate
        this.remember(e);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.remember(e);
        this.finish('escape');
      } else if (e.key === 'Enter') {
        e.preventDefault(); // a focused control cannot activate
        this.remember(e);
      } else if (preventsDefaultMidSession(e)) {
        e.preventDefault();
      }
      return;
    }
    // Residual: the session has ended but this key is still physically held.
    if (!this.residual.has(e.key)) return;
    if (!e.repeat) {
      // A fresh press: its earlier keyup was missed. It is a new intention.
      this.residual.delete(e.key);
      this.maybeDetach();
      return;
    }
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopImmediatePropagation(); // Escape repeats never reach the resting-state deselect
    } else if (isControlTarget(e.target)) {
      e.preventDefault(); // Space repeat on a focused control
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    const live = this.phase !== 'ended';
    if (live && e.key === ' ') this.spaceHeld = false;
    if (live) e.stopImmediatePropagation();
    if (this.residual.has(e.key)) {
      const target = this.residual.get(e.key) ?? null;
      this.residual.delete(e.key);
      e.preventDefault(); // no keyup activation of a focused control
      // Space's keyup still reaches the shell after the session (it clears the shell's Space state).
      if (!live && e.key !== ' ') e.stopImmediatePropagation();
      this.armClickGuard(target);
    }
    this.maybeDetach();
  };

  private readonly onClick = (e: MouseEvent): void => {
    if (this.clickGuard === null || e.detail !== 0) return; // only a keyboard-initiated click
    if (e.target === this.clickGuard) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  private readonly onBlur = (): void => {
    if (this.phase !== 'ended') {
      this.finish('blur');
      return;
    }
    this.residual.clear();
    this.clearClickGuard();
    this.maybeDetach();
  };

  private remember(e: KeyboardEvent): void {
    if (RESIDUAL_KEYS.has(e.key)) this.residual.set(e.key, e.target);
  }

  private armClickGuard(target: EventTarget | null): void {
    if (target === null || !isControlTarget(target)) return;
    this.clearClickGuard();
    this.clickGuard = target;
    // A keyup's activation click is dispatched as that keyup's default action, in the same task.
    this.clickGuardTimer = setTimeout(() => {
      this.clickGuard = null;
      this.clickGuardTimer = null;
      this.maybeDetach();
    }, 0);
  }

  private clearClickGuard(): void {
    if (this.clickGuardTimer !== null) clearTimeout(this.clickGuardTimer);
    this.clickGuardTimer = null;
    this.clickGuard = null;
  }

  private attach(): void {
    const t = this.input.keyTarget;
    t.addEventListener('keydown', this.onKeyDown as EventListener, true);
    t.addEventListener('keyup', this.onKeyUp as EventListener, true);
    t.addEventListener('click', this.onClick as EventListener, true);
    t.addEventListener('blur', this.onBlur);
    this.listening = true;
  }

  private detach(): void {
    if (!this.listening) return;
    const t = this.input.keyTarget;
    t.removeEventListener('keydown', this.onKeyDown as EventListener, true);
    t.removeEventListener('keyup', this.onKeyUp as EventListener, true);
    t.removeEventListener('click', this.onClick as EventListener, true);
    t.removeEventListener('blur', this.onBlur);
    this.listening = false;
  }

  /** Listeners stay only while the session lives or a residual suppression is pending. */
  private maybeDetach(): void {
    if (this.phase === 'ended' && this.residual.size === 0 && this.clickGuard === null) this.detach();
  }
}
