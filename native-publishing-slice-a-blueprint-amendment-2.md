# Slice A Blueprint — Amendment 2

**Date:** 2026-08-19 (publication bleed model). The original
`native-publishing-slice-a-blueprint.md` and `amendment-1` are preserved
unchanged as historical planning records; this amendment supersedes them on
exactly the points below. The decision itself is **D-033** in `decisions.md`.

## 1 · Preset bleed is 3.175 mm per applicable edge, not 3 mm

The blueprint shipped `bleedMm: 3` on all three presets as a calibration
default. D-033 resolves the reported "quarter-inch bleed" as **¼ inch added to
each full page dimension** — ⅛ in / **0.125 in = 3.175 mm = 9 pt per applicable
edge**, measured outward from trim. A 6 × 9 in page bleeding on all four edges
occupies 6.25 × 9.25 in.

Amended position: all presets and the inngest generic-rules fallback carry
`GENERIC_PUBLICATION_BLEED_MM` (= `0.125 × 25.4`, exactly 3.175). `0.25 in` is
never encoded as a per-edge value.

**Unit honesty note.** 3 mm and 3.175 mm are industry synonyms in prose —
Adobe writes "0.125 inches (3 mm)" — but they are 0.175 mm apart. The generic
profile uses the exact imperial-derived value; `bleedMm` stays a plain number
so a future printer profile can state a true 3.0 mm requirement.

## 2 · `FormatPrintRules.bleedMm` is documented as per-edge, and is provisionally scalar

The blueprint's field comment ("Expected bleed margin in mm") did not say
whether the value was per-edge or total. It is **per-edge**. The field is now
documented as such.

It remains a scalar **only** because every current preset bleeds symmetrically
on four edges. Publication workflows require zero bleed on the binding edge
(IngramSpark, Amazon KDP and Gorham all forbid gutter bleed), so the field
becomes `{top, right, bottom, left}` when output profiles arrive.

That conversion is **migration-free**: bleed is derived from the format preset
and never persisted into `editor_documents.doc`, which freezes only
`formatPresetId`, `marginMm` and `safeMm` (D-031). Deferring it costs nothing;
building it now would be infrastructure with no consumer.

## 3 · Guides, fit and preflight are unchanged in behaviour

`StageGuides` and the three fit functions still assume symmetry
(`±bleedMm`, `+2 × bleedMm`). That assumption is correct for every current
preset and is the thing §2 will revisit.

Preflight is untouched: its bleed check gates on `rules.bleedMm > 0` and never
on the magnitude, so the value change alters no verdict.

The editor's bleed rectangle grows 0.175 mm per edge — 0.595 px at the
3.4 px/mm base, 4.76 px at 8× zoom. Because bleed is derived rather than
frozen, existing documents adopt the new value on next open. That is the
intended consequence of D-031's deliberate choice not to persist trim/bleed.

## 4 · Margins and safe are explicitly out of scope

A4 (15/6) and square (14/6) remain **PROVISIONAL** and untouched by this
amendment. Bleed and safe solve different problems and neither derives from
the other; the margin/safe ruling is a separate open decision (D-031).

## 5 · Slice B is not begun

No editing tools, no output-profile system, no PDF exporter, no preflight
restructuring. The future PDF page-box invariants and the two-family preflight
model are **recorded in D-033 as direction only**.
