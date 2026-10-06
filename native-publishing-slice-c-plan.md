# Native Publishing — Slice C plan

**Status:** finalized and approved by Ben 2026-10-04 (C-1…C-9 and the four follow-up points below); **implemented on branch `slice-c-movement`**. §2's questions are answered in place and kept as the record of what was decided and why.
**Base:** `main` = `38535ee` (docs sync on `d2d2f8d`, Slice B merged). Handoff copies (canonical / repo / Vault) are all sha1 `d077399030184aa43fca748761b350640aad7374`.
**Scope (production handoff Part 11):** drag (single + multi, rigid), Shift-click / ⌘A / marquee-add, union-box snapping + guides, nudge, duplicate / copy / paste / cut / delete, locked rules end to end, cross-gutter re-parent by centre, multi-object inspector. **Acceptance:** R9 union fixtures and the locked-member matrix, both green in Chromium, WebKit and Firefox.
**Contracts:** #2 · #4 · #5 · #6 · #7 · #8 · #18 · #19 · #20 · #21 · #24 · #25 · #26.

---

## 1 · Decisions (approved 2026-10-04)

| # | Decision |
|---|---|
| **C-1** ✅ | **Drag precision.** Round the **shared delta**, never each member. On an unsnapped axis, round the delta to 0.1 mm (#19's drag grid). On a snapped axis, use the exact snap delta, so the committed edge equals the guide shown (preview == commit). Members stay rigid exactly. This refines #19 and is recorded as decision **D-035** in HANDOFF when C lands. |
| **C-2** ✅ | **Stacking.** A same-page move keeps every element's array index. A re-parent appends the moving set to the top of the target page, keeping its relative order. The spike's "every drag brings to front" is not ported. |
| **C-3** ✅ | **Clipboard.** In memory, per editor session. No system clipboard, no cross-tab or cross-publication paste. Copy takes every selected element, locked ones included. Pasted copies are fresh-id and **unlocked**, at +5 mm on the source page when that page is in the current unit, otherwise at the same page-relative position on the current unit's first page. Pastes are selected. Cut = copy all + delete unlocked only, and it says so. |
| **C-4** ✅ | **Duplicate** follows #20: unlocked members only, +4 mm, fresh ids, copies selected. |
| **C-5** ✅ | **Escape or window blur mid-drag** restores everything, with zero history and zero autosave. |
| **C-6** ✅ | **Typing guard narrowed** as the first commit. `type=color`, `checkbox` and `button` no longer suppress document shortcuts. Text inputs, `range`, `textarea`, `select` and contenteditable still do. This closes HANDOFF §8 item 2 (colour-control ⌘Z). |
| **C-7** ✅ | **Cross-browser gates: Chromium, WebKit and Firefox** all gate Slice C acceptance (Part 12 / Risk 13). A browser that genuinely cannot run is recorded as **NOT EXECUTED — reason** and brought back to Ben. It is never silently waived. See §5. |
| **C-8** ✅ | **The smoke and acceptance scripts delete everything they create**, so they leave no residue. The one-off cleanup of the rectangles already accumulated happens only on Ben's explicit go, through the editor. |
| **C-9** ✅ | **The Shift-marquee defect is fixed in C.** Shift-click stays a toggle (#5). Shift-marquee **adds** (union, order-preserving) and never deselects anything (#6). |

## 2 · Follow-up points — all answered by Ben 2026-10-04

1. **Nudge precision follows from C-1, but isn't literally covered by it.** The spike rounds each member's result to 0.1 mm after a nudge, so a member at X 20.05 nudged +0.5 lands on 20.6, not 20.55. That breaks rigidity the same way per-member drag rounding does. C-1's principle ("round the shared delta, not the members") gives: nudge adds exactly ±0.5 / ±5 (already on the 0.1 grid), and members keep their 0.01-grid offsets. **Answered: apply the shared-delta principle to nudge** — exactly ±0.5 / ±5 mm, each object's existing offset preserved, no independent rounding (recorded with C-1 as D-035).
2. **Escape after a cancelled drag.** #26: "Esc = deselect + Select tool". C-5: "Esc mid-drag = cancel". **Answered: Escape during an active drag cancels only that drag and keeps the selection; a subsequent Escape with no active drag deselects and returns to Select.** One meaning per press.
3. **Where WebKit and Firefox can run (C-7).** I probed the Mac's Linux VM today:
   - Chromium launches (151.0.7922.34).
   - Firefox (build 1538) and WebKit (2336, WPE) **download fine but don't launch**, because system libraries are missing (Firefox: GTK 3; WebKit: libevent, GTK 4, libsoup 3, libwpe and others). The VM has no root.
   - Every missing library exists as an Ubuntu 22.04 arm64 package. WebKit's own unusual deps (libjxl, libavif) are bundled. So the planned route is the same no-root, unpack-into-VM-home method already used for libXdamage.
   - **Expected: Firefox likely to work, WebKit plausible but unproven.**
   - **Fallback if one still can't launch:** you run that browser's project natively on macOS from your Terminal (`npx playwright test --project=webkit|firefox`). Playwright runs WebKit and Firefox natively there, and the credentials stay where they live.
   - **Answered:** attempt Firefox and WebKit in the VM first; if either genuinely cannot execute there, run that project natively on Ben's Mac through Terminal as the gate, on the same committed build/suite, recorded separately. Never waive a browser. *(Outcome: both executed in the VM — see HANDOFF Phase 11.)*
4. **Production writes triple.** **Answered: approved (~60 PUTs for the three-browser gate) provided the tests delete everything they create (C-8); security-operations §8 records the actual per-browser blast radius** (measured: smoke 5 + acceptance 15 = 20 per browser, 60 total, zero residue).
5. **Spike contradicts the contract (for the record).** In the spike, Duplicate copies locked members and unlocks them, against #20. C-4 follows #20. Likewise, cut copies locked members (C-3), and only the delete half skips them.

## 3 · Architecture (extends B; reshapes nothing)

- **Pure domain ops** (`packages/domain/src/editor/moves.ts`, `selection-ops.ts`):
  - `unionBox`, `pageForCentre`;
  - `applyMoves(doc, moves)`: C-1 delta and C-2 stacking, one document out;
  - `removeElements`, `duplicateElements`, `nudgeElements`, `patchAll`: each skips locked members **structurally** (#20);
  - `setLockAll`, `pasteElements`.
  - All are doc → doc and feed the existing generic `COMMIT`. **No new history action kinds.**
- **Snapping:** `snapping.ts` already has the full #8 target set and `bestSnap`. Add `snapUnion(union, targets)`: edges + centre on both axes, radius 1.6 mm, nearest wins, targets exclude the moving set and include locked elements. A single object is a union of one, so there is one code path.
- **Selection:** a new `ADD_TO_SELECTION` UI action (union) for the additive marquee. `TOGGLE_SELECTION` stays for Shift-click. ⌘A = every element on the current unit, locked included.
- **Drag:**
  - a `{ kind: 'drag' }` gesture in `use-stage-gestures.ts` beside creation and marquee (no Konva `draggable`);
  - a press-vs-drag threshold;
  - an unselected press drags that element alone and selects it;
  - a press on a locked member moves nothing;
  - transient delta in refs, rendered as an offset by `ElementsLayer`, guides via `StageGuides`;
  - release = one `COMMIT('Move')`; Escape or blur = cancel (C-5).
- **Cursor (#21):** the existing outer-wrapper resolver gains *object hover* (`move` unlocked / `default` locked; hover stores the id only, lock is looked up live) and *object drag* (`move` held). Still exactly one writer.
- **Keyboard (#26):** Delete/Backspace, arrows (0.5 / Shift 5 mm), ⌘D, ⌘C/X/V, ⌘A, all behind the narrowed guard (C-6).
- **Multi-object inspector (#5/#18):**
  - header `N objects · M locked`;
  - Opacity shared (unlocked only, one entry; mixed values shown as an em dash, never an average);
  - Lock all / Unlock all as one action;
  - Delete removes unlocked only, and a polite live region says what happened ("Deleted 2 · 1 locked kept").
  - Nothing beyond the contract.
- **History (#24):** one entry per drag session, nudge press, delete, duplicate, paste, cut and lock-all. Zero for select-all, marquee, hover, a cancelled drag, or an op whose members are all locked (no-op).

## 4 · Commit sequence — branch `slice-c-movement` from `main`

0. **Environment** (not a repo commit): Firefox/WebKit host libraries unpacked into the Mac VM home. Launch probe per browser recorded PASS / NOT EXECUTED (reason).
1. **C-6** typing guard + regression (red → green).
2. **C-9** additive marquee + regression (red → green). The Shift-click toggle is pinned by its own test.
3. **Domain ops + `snapUnion`**: pure tests, **R9 union fixtures** (rigid multi commit, centre candidates, engage/hold/release, locked-as-targets, C-1 snapped-axis exactness, relative spacing invariant as a property test), plus C-2 stacking tests.
4. **Drag gesture + re-parent by centre**: reducer and React tests (preview offset → single commit; cancel = zero trace).
5. **Cursor states** + resolver table tests.
6. **Keyboard ops + clipboard**, with the **locked-member matrix** (each op × {all unlocked, mixed, all locked} → document, history count, selection after, autosave count).
7. **Multi-object inspector** (em dash, unlocked-only, one entry, delete messaging).
8. **Browser layer**: the smoke is extended (drag, multi-drag across the gutter, nudge, duplicate, delete, self-cleaning). Playwright projects: chromium / webkit / firefox. The behavioural acceptance pass runs per browser and counts every autosave PUT.
9. **Docs**: HANDOFF (D-035, §8 item 2 closed, Vault-sync item closed), security-operations §8 (per-browser blast radius, zero residue), this plan committed as `native-publishing-slice-c-plan.md`.

## 5 · Verification gates

- **Tree:** the tested tree equals the committed tree. Fresh linux-x64 clone + `npm ci`.
- **Battery:** typecheck · lint · all suites · guard suite · forced build.
- **Shared bundle budget:** C is editor-island code, so shared First-Load JS is expected not to move. Any use of the 238 B headroom stops work and is reported.
- **Editor chunk:** measured and reported.
- **Unchanged checks:** preflight 6/6 · audit unchanged.
- **Browsers:** smoke + behavioural acceptance, each recorded **per browser**: Chromium / WebKit / Firefox → PASS / FAIL / NOT EXECUTED (reason). Run on the Mac with credentials loaded in place, never in Actions.
- **Performance:** drag frame time on the 30-element reference document, via `performance.mark`, numbers reported per browser.
- **Hosted:** CI · CodeQL · Vercel preview editor check.
- **PR:** opened, **not merged**.

## 6 · Not in C

Resize/Transformer (D), images (E), crop (F), text (G), lines (H), viewing modes (I), cross-publication clipboard, grouping, multi position/size fields, Dependabot #12/#13 + advisory triage, D-032, EasyPost, Slice G fonts, moving E2E off production.

## 7 · Decisions at acceptance (Ben, 2026-10-06)

- **1a–1d confirmed** as implemented: object operations act on the selected objects of the unit being viewed · multi-object Opacity reflects unlocked members only · "· N locked" only for mixed selections · a click without drag on a member of a multi-selection narrows to it.
- **2** The stage's read-only `data-view` / `data-page-offsets` attributes ship as **internal test instrumentation, not a public application contract**.
- **3** The Slice A/B fixture residue was removed (backup first; HANDOFF Phase 11).
- Merged as PR #15 → `79bbf53` on 2026-10-06.
