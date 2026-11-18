'use client';

/**
 * The resize session's owner on the stage (Slice D stage 5, plan §4.3–§4.7).
 *
 * `ResizeSession` (stage 4) decides every behaviour; this hook only builds a
 * session from the editor's current state at the anchor press and turns the
 * session's three callbacks into stage state and shell calls:
 *
 *   onPreview → `preview` (the bounded geometry for `ElementsLayer`, the
 *               outline, the `W × H mm` pill, the snap guides)
 *   onCommit  → `onResize(id, payload)` — the shell's one COMMIT 'Resize'
 *   onEnd     → the live cursor clears; the shell's Space state is synced
 *               from `spaceHeld`; one deferred refit with the latest size
 *
 * Lifetime: a session that has ended may still hold a residual key
 * suppression (a swallowed key whose keyup has not arrived), so ended
 * sessions are NOT disposed on release or cancel — they detach themselves
 * when the key sequence finishes. Every session still listening is disposed,
 * silently, when the stage unmounts: no callback reaches a dead owner.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { anchorCursor, resizeTargetsH2, toH, type EditorElement, type ResizeAnchor, type StoredGeometry } from '@baxter/domain';
import { pageWidthMm, type UnitGeometry } from './geometry';
import { ResizeSession, type PxPoint, type ResizeEnd, type ViewportSizeLike } from './resize-session';
import type { ElementBox } from './use-stage-gestures';
import type { ViewTransform } from './state/editor-ui';
import type { ResizeCursorName } from './cursor';

export interface ResizeHostPreview {
  id: string;
  /** Page-relative mm — what release commits. */
  geometry: StoredGeometry;
  /** Snap guides, unit-space mm, or null. */
  guideX: number | null;
  guideY: number | null;
}

export interface ResizeHostOptions {
  geom: UnitGeometry;
  /** Unit-space boxes of the shown unit's elements (snap targets; the resized one is excluded). */
  boxes: readonly ElementBox[];
  view: ViewTransform;
  /** The element's page index in the shown unit, or -1. */
  pageIndexOf: (id: string) => number;
  onResize: (id: string, payload: StoredGeometry) => void;
  onSpaceSync: (held: boolean) => void;
  onRefit: (size: ViewportSizeLike) => void;
}

export interface ResizeBegin {
  element: EditorElement & { x: number; y: number; width: number; height: number };
  anchor: ResizeAnchor;
  pressPoint: PxPoint;
  keepProportions: boolean;
  /** The adapter's own end hook (stop Konva's transform on a cancel). Runs after the owner's handling. */
  onEnded?: (end: ResizeEnd) => void;
}

export interface ResizeHost {
  begin: (b: ResizeBegin) => ResizeSession | null;
  /** The live session (pending or active), or null. Read synchronously by the wheel, refit and pan paths. */
  liveRef: React.MutableRefObject<ResizeSession | null>;
  preview: ResizeHostPreview | null;
  cursor: ResizeCursorName | null;
}

export function useResizeHost(options: ResizeHostOptions): ResizeHost {
  const [preview, setPreview] = useState<ResizeHostPreview | null>(null);
  const [cursor, setCursor] = useState<ResizeCursorName | null>(null);
  const liveRef = useRef<ResizeSession | null>(null);
  const sessions = useRef<ResizeSession[]>([]);
  const opts = useRef(options);
  opts.current = options;
  /** True between the layout effect's setup and its cleanup. Set in setup (not at creation) so
   *  StrictMode's simulated cleanup → setup leaves a mounted host live. */
  const mounted = useRef(false);

  // A LAYOUT effect: its cleanup runs synchronously in React's commit, so an owner unmounted
  // synchronously (flushSync) from inside a session callback is torn down before that callback
  // returns: the session then skips every later callback (stage 4 correction), and `onEnd` below
  // stops between its own steps (stage 5 correction).
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Unmount: dispose every session still listening (live or holding a residual), silently.
      for (const s of sessions.current) s.dispose();
      sessions.current = [];
      liveRef.current = null;
    };
  }, []);

  const begin = useCallback((b: ResizeBegin): ResizeSession | null => {
    const o = opts.current;
    const pageIndex = o.pageIndexOf(b.element.id);
    if (pageIndex < 0) return null;
    const g = o.geom;
    const targets = resizeTargetsH2(
      { pageWidthMm: pageWidthMm(g), pageHeightMm: g.heightMm, pageOffsetsMm: g.pageOffsetsMm, marginMm: g.marginMm },
      o.boxes.filter((x) => x.id !== b.element.id).map((x) => x.box)
    );
    const id = b.element.id;
    const session: ResizeSession = new ResizeSession(
      {
        elementId: id,
        stored: { x: b.element.x, y: b.element.y, width: b.element.width, height: b.element.height },
        pageOffsetH: toH(g.pageOffsetsMm[pageIndex] ?? 0),
        targets,
        anchor: b.anchor,
        view: { ...o.view },
        pressPoint: b.pressPoint,
        keepProportions: b.keepProportions,
        keyTarget: window,
      },
      {
        onPreview: (p) =>
          setPreview(
            p === null
              ? null
              : { id, geometry: p.payload, guideX: p.guideX2 === null ? null : p.guideX2 / 200, guideY: p.guideY2 === null ? null : p.guideY2 / 200 }
          ),
        onCommit: (elementId, payload) => opts.current.onResize(elementId, payload),
        onEnd: (end) => {
          if (liveRef.current === session) liveRef.current = null;
          if (!mounted.current) return;
          setCursor(null);
          opts.current.onSpaceSync(end.spaceHeld);
          // Any owner callback may have unmounted the stage synchronously: re-check before each next step.
          if (!mounted.current) return;
          if (end.refit) opts.current.onRefit(end.refit);
          if (!mounted.current) return;
          b.onEnded?.(end);
        },
      }
    );
    // Ended sessions that have finished their key sequences have detached themselves; forget them.
    sessions.current = sessions.current.filter((s) => s.snapshot().listening);
    sessions.current.push(session);
    liveRef.current = session;
    setCursor(anchorCursor(b.anchor));
    return session;
  }, []);

  return { begin, liveRef, preview, cursor };
}
