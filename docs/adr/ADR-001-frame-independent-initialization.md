# ADR-001 — Frame-independent initialization

**Status:** Accepted (2026-08-03, Slice A hardening) · **Origin:** the production stage incident.

## Decision

Initial component state must never depend on frame-delivered callbacks.
Acquire initial state **synchronously** (layout APIs compute on demand:
`getBoundingClientRect`, `getComputedStyle`); use frame-delivered observers —
`ResizeObserver`, `IntersectionObserver`, `requestAnimationFrame` — **only for
subsequent updates**, and never as the sole path to a component's first valid
state.

## Context

The Slice A editor mounted its Konva stage only after a ResizeObserver
delivered the wrapper's dimensions. In a page loaded in a hidden tab, the
observer's initial observation queued forever: RO/IO callbacks and rAF are
delivered as part of the rendering-frame pipeline, and hidden pages produce no
frames. Layout, by contrast, is computed on demand — the boundary trace showed
the wrapper at real dimensions (`getBoundingClientRect` → 1349×805) at the
very moment the observer sat silent. Development never exposed the bug because
the dev tab was always visible; build mode was never the variable.

## Consequences

- `useViewportMeasure` (`apps/web/components/editor/use-viewport-measure.ts`)
  is the reference implementation: synchronous `measure()` in a layout effect,
  zero-dimension guard, one observer per mount for changes, targeted
  disconnect on cleanup.
- The regression suite (`test/editor/viewport-measure.test.tsx`) pins the
  mechanism: an observer that never fires must not prevent initialization.
- Review checklist addition: any `new ResizeObserver` / `new
  IntersectionObserver` / boot-path `requestAnimationFrame` gets the question
  *"what happens if this never fires?"* — hidden tabs, display:none subtrees,
  and frozen pages are ordinary production states, not edge cases.
- Deliberate corollary: a hidden page defers *subsequent* refits until first
  visibility. That is correct — nobody can see a hidden layout — and must not
  be "fixed" with polling or timers.
