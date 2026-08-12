# Slice A Blueprint — Amendment 1

**Date:** 2026-08-03 (Slice A hardening gate). The original
`native-publishing-slice-a-blueprint.md` is preserved unchanged as the
historical planning record; this amendment supersedes it on exactly the
points below.

## 1 · Browser smoke testing begins before Slice B feature work

The blueprint phased Playwright at Slice C ("browser E2E … by Slice C"). The
production stage incident invalidated that phasing: the editor's one real
production failure — a hidden page starving ResizeObserver delivery so the
stage never mounted — was invisible to all 76 unit tests, to development
usage, and to every headless check; only a real browser in the right state
exposed it.

Amended position: a **narrow Playwright smoke ships with the Slice A
hardening gate** (`apps/web/test/e2e/editor-smoke.spec.ts` — authorized
entry, uninteracted stage mount with non-zero dimensions, one real commit,
autosave completion, reload rehydration, zero console errors). The full
interaction suite still arrives with Slice C as planned; only first browser
coverage moved earlier.

Honesty note carried with the smoke: headless Chromium renders background
pages, so the exact hidden-page starvation is not reproducible in the
runner; the incident mechanism is pinned by the unit-level no-observer
regression (`test/editor/viewport-measure.test.tsx`), and the smoke asserts
the no-intervention mount path.

## 2 · Sizing description superseded by ADR-001

The blueprint's §2.1 described the stage measuring its viewport via
ResizeObserver. Per ADR-001 (frame-independent initialization), the initial
measurement is **synchronous** (`getBoundingClientRect` in a layout effect);
the observer handles subsequent changes only. `useViewportMeasure` is the
reference implementation.

## 3 · Discovery flag naming superseded by ADR-002

The blueprint named the flag `NEXT_PUBLIC_NATIVE_PUBLISHING`. `NEXT_PUBLIC_`
values are build-inlined everywhere (including server components), which
froze the toggle into the artifact. The flag is server-read
`NATIVE_PUBLISHING` (deviation D5; ADR-002), gating discovery only.
