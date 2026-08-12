# ADR-003 — Editor state ownership

**Status:** Accepted (2026-08-03, Slice A hardening) · **Origin:** the Slice A blueprint (§2.3–2.4) as implemented and hardened.

## Decision

The editor's state architecture is fixed by these invariants:

1. **The document reducer is a transaction log.** One generic
   `COMMIT { nextDoc, selection, label }` carries every document mutation, in
   every slice. Element semantics live in pure helpers that *produce*
   `nextDoc`; **per-element-type reducer actions are prohibited**. One
   accepted gesture = one history entry; no-ops are detected by reference
   equality and create nothing.
2. **Dirty is derived, never stored:** `state.doc !== state.savedDoc`.
   `SAVED` pins `savedDoc` to the exact acknowledged payload reference, which
   makes late-response ordering safe by construction.
3. **Two contexts, one direction.** `DocumentContext` (document, history,
   save machine) and `EditorUiContext` (unit, viewport, tool) never merge.
   Viewport/tool churn is structurally unable to reach autosave or history.
4. **Transient gesture state lives outside both stores** — refs and local
   state beside the stage, existing only mousedown→mouseup, feeding exactly
   one `COMMIT`.
5. **Autosave observes commits, not state transitions** — a
   document-reference comparison (`commit-observer.ts`); save-machine
   transitions cannot schedule saves.
6. **Mount-time server props are the boot authority; the client working copy
   is the session authority.** The island reads `docRow` once; later RSC
   re-renders (e.g. `router.refresh`) do not re-hydrate a mounted editor.
   Recovering server state is a full reload — by design, not omission.
7. **Save-phase UI is isolated** in a self-subscribing chip
   (`SaveStateChip`), and canvas-subtree components sit behind `memo`
   boundaries with stable props — render-count evidence (hardening pass):
   save-cycle re-renders of stage/unit-list/status-bar fell 3→1 (only the
   commit render), and unit-list pan churn fell to zero after taking
   `unitIndex` as a prop instead of subscribing to the UI context.

## Consequences

Slice B adds selection/mode fields to the UI context and element helpers
feeding `COMMIT` — and changes nothing above. Custom memo equality functions
remain prohibited without measured evidence.
