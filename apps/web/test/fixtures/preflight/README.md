# Preflight test fixtures (Slice 3b · Decision 4)

PDFs to develop and verify the preflight worker against. Two sources:

1. **Synthetic** — generated in memory by `../preflight.verify.ts` (via `pdf-lib`).
   Run `node apps/web/test/preflight.verify.ts` from the repo root. These cover
   the cases `pdf-lib` can author reliably.
2. **Real exports** — drop actual InDesign / Affinity / Illustrator PDF exports
   into this folder. Real exports are far more valuable for calibrating the
   warning checks, whose detectability is still open. Name them by the case they
   represent, e.g. `low-dpi.pdf`, `unembedded-fonts.pdf`.

## Coverage status

| Case                     | Synthetic? | Notes |
|--------------------------|------------|-------|
| Clean print-ready        | ✅          | A5, multiple-of-four, correct trim, bleed present. Passes clean. |
| Wrong dimensions         | ✅          | A4 page in an A5 publication → blocking. |
| Page count out of bounds | ✅          | Below the format minimum → blocking. |
| Not a multiple of four   | ✅          | Odd page count for a saddle-stitch format → blocking. |
| Missing bleed            | ✅          | TrimBox == MediaBox → bleed warning. |
| Corrupt / unreadable     | ✅          | Truncated bytes → fails gracefully with a composed message. |
| **Low-DPI images**       | ❌          | Needs a real export. **DPI detection is deferred** — the inspector returns `null` (no warning) until a content-stream parser is added and calibrated. |
| **Non-embedded fonts**   | ❌          | `pdf-lib` only produces standard-14 (embedded-equivalent) fonts. Needs a real export that references an unembedded, non-standard font. The detector exists (best-effort font-dictionary walk) but is unverified against real output. |
| Encrypted / password     | ⚠️         | The worker opens with `ignoreEncryption`; a truly password-protected file should fail gracefully. Add a real one to confirm. |

## What to do as real exports arrive

- Drop the file here, named by case.
- Add a case to `preflight.verify.ts` that loads the file from this folder and
  asserts the expected status/warnings.
- When a real low-DPI or unembedded-fonts export confirms behaviour, update the
  inspector (`apps/web/lib/pdf/inspect.ts`) to implement/confirm that check and
  flip the row above to ✅.

Binary PDFs are git-ignored in this folder (see `.gitignore`) so the repo stays
lean — commit a real fixture deliberately with `git add -f` if a regression
test should travel with it.
