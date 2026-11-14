# Slice D stage 5 — real-Konva probe results

Browser: Chromium 153.0.8010.12 (headless, Playwright 1.62.1), device pixel ratio 1, viewport 1280 × 900.
Konva 10.3.0, react-konva 19.2.5. Firefox and WebKit: NOT EXECUTED (no builds in this environment).

**14 / 14 PASS.**

| Case | Input | Result | Notes |
|---|---|---|---|
| R1 changed release (rect, bottom-right): pill = commit; one Resize; one save | real | PASS | scale 3.3464293968107235; pill during drag "71.97 × 65.86 mm"; cursor during drag "nwse-resize"; committed {"x":20,"y":20,"width":71.97,"height":65.86}; expected 71.97 × 65.86; history ["Resize"]; PUTs 1 |
| R2 anchor click (no movement): zero history, zero saves | real | PASS | history []; PUTs 0; geometry {"x":20,"y":20,"width":40,"height":30} |
| R3 out and back to the press point: unchanged in H → zero history, zero saves | real | PASS | history []; PUTs 0; geometry {"x":20,"y":20,"width":40,"height":30} |
| R4 Escape mid-drag: cancelled; later moves and mouseup do nothing; selection kept; zero saves | real | PASS | history []; selection ["0ae82539-3a95-463e-9aca-512f82598e1e"]; tool select; pill null; PUTs 0 |
| R5 Space held through release (Q2 a): one commit; handles then inactive — a new press on the anchor pans; after keyup it resizes again | real | PASS | after release: history ["Resize"], hover cursor "grab"; second press: view 179.36422463600647 48 3.3464293968107235 → 219.36422463600647 78 3.3464293968107235, cursor "grabbing", history ["Resize"]; after keyup: history ["Resize","Resize"] |
| R6 Space held through Escape: zero commits, selection kept; a new press pans | real | PASS | history []; selection ["a8939c38-d02d-4891-8a41-c2dfe29cfcdb"]; cursor after Escape "grab"; view 179.36422463600647 48 3.3464293968107235 → 229.36422463600647 88 3.3464293968107235 |
| R7 Space held through window blur: zero commits, selection kept, Space cleared — the next anchor press resizes (no stuck pan) | mixed | PASS | after blur: history [], selection ["5876e746-8e14-402a-a9d7-1722ae36155d"], cursor "default"; next press: history ["Resize"] (blur and focus dispatched programmatically) |
| R8 Q7 (a) with Shift: a fast drag far past the fixed corner holds it — the ratio minimum box 5.34 × 4.01 | real | PASS | pill "5.34 × 4.01 mm"; committed {"x":20,"y":20,"width":5.34,"height":4.01} |
| R9 wheel during the resize is consumed (no pan, no zoom); after release it pans again | real | PASS | view at press 179.36422463600647 48 3.3464293968107235; during 179.36422463600647 48 3.3464293968107235; after release + wheel 179.36422463600647 -72 3.3464293968107235; history ["Resize"] |
| R10 ellipse, top-left: pill = commit; the fixed corner (bottom-right) unchanged | real | PASS | pill "36.25 × 28 mm"; committed {"x":17.75,"y":50,"width":36.25,"height":28} |
| R11 native control activation (Chromium): Space on a focused button during a resize, released after it, does not click | mixed | PASS | control click count 1; focus after the anchor press "BODY"; clicks after resize 1; history ["Resize"] |
| R12 native control activation (Chromium): Enter on a focused button during a resize does not click, during or after | mixed | PASS | control click count 1; clicks after resize 1; history ["Resize"] |
| R13 shortcuts mid-resize do nothing (⌘Z, Delete, H); they work after | real | PASS | mid: tool select, elements 2; after release + Ctrl+Z: history [], rect {"x":20,"y":20,"width":40,"height":30} |
| R14 Hand tool: handles visible but inactive — an anchor press pans, nothing resizes | real | PASS | hover cursor "grab"; view 179.36422463600647 48 3.3464293968107235 → 229.36422463600647 88 3.3464293968107235; history [] |

Input kinds: **real** = only Playwright mouse and keyboard input; **mixed** = real input plus the named programmatic step (window blur/focus; `focus()` on the button during the drag, because a pointer press on the canvas moves focus off it).
