# Slice A Blueprint — Amendment 3

**Date:** 2026-09-18 (editor margins and safe guides). The original
`native-publishing-slice-a-blueprint.md`, `amendment-1` and `amendment-2` are
preserved unchanged as historical planning records; this amendment supersedes
them on exactly the points below. The decision itself is **D-034** in
`decisions.md`.

## 1 · The provisional margin values are settled

The blueprint proposed A4 15/6 and square 14/6 and marked them for Ben's
confirmation at the Slice A review (ranked unknown #5); D-031 shipped them as
**PROVISIONAL**. D-034 settles them.

Amended position — the accepted `layout` defaults:

| Preset | Trim (mm) | Margin (mm) | Safe (mm) |
|---|---|---|---|
| `zine_a5` | 148 × 210 | **12** (unchanged) | **5** |
| `magazine_a4` | 210 × 297 | **15** (accepted as proposed) | **6** |
| `photobook_square_210` | 210 × 210 | **19** (revised from 14) | **6** |

Nothing in `formats.ts` is provisional any more. The blueprint's "Ben confirms
numbers at slice review" line is discharged.

The square moved because it is the one preset where the scalar cannot express
the requirement: perfect-bound across a 12× page range (20–240), where the
gutter requirement scales with page count and the outer requirement does not.
At 14 mm it cleared KDP's 12.7 mm inside figure by 1.3 mm with no headroom
while perfect binding consumes 6.35–9.53 mm of each inner page. Reasoning and
evidence in full: D-034.

## 2 · `safeMm` is an editorial guide, not a printer guarantee

The blueprint described safe only as "keep important content inside". That is
now stated precisely, because the looser reading invites a false claim.

`safeMm` expresses where **Baxter** thinks critical content should sit on the
page. It asserts nothing about any printer's safety requirement and **must not
be described as satisfying one** — including in UI copy, documentation or
commit messages. The industry 0.25 in / 6.35 mm figure was considered as a
floor and **deliberately not adopted**: safe has no preflight role today, and
standardising to a printer-derived number would dress an editorial guide as a
production guarantee.

Real output safety — per-edge, gutter-aware, page-count-aware, profile-owned —
is the job of the future output-profile and preflight work recorded in D-033
(preflight family **B**, critical-content safety). It is not the job of this
number, and the two must not be conflated when that work arrives.

## 3 · The scalar model is retained, with a dated prerequisite

`marginMm` and `safeMm` remain single scalars applied symmetrically to all four
edges. No current consumer requires otherwise: `preflight.ts` reads neither
value, no exporter exists, and Slice B's inspector only displays them.
Building per-edge geometry now would be speculative infrastructure by exactly
the standard Amendment 2 §2 applied to per-edge *bleed*.

**The deferral is dated.** Binding-relative per-edge margins are a **hard
prerequisite before M2.4/export ships**. The future representation is:

```
{ top, bottom, inner, outer }        // binding-relative — correct
{ top, right, bottom, left }         // screen-relative — wrong for margins
```

"Inner" is the left edge on a recto and the right edge on a verso. Storing
screen-relative edges would push that flip into every consumer.

**Not implemented in this amendment.** Do not add the future schema, a
per-edge type, or a compatibility shim for it in Slice B.

> **Note the difference from bleed.** Amendment 2 recorded bleed's future
> representation as `{top, right, bottom, left}`. That wording is left
> unaltered as the historical record of D-033, but margins are binding-relative
> for the reason above, and bleed's own gutter rule (IngramSpark, KDP and
> Gorham all forbid gutter bleed) is binding-relative in substance too.
> Whichever lands first should settle a single shared edge vocabulary rather
> than inventing two.

## 4 · Persistence is unchanged — D-031's freeze contract is preserved

New documents freeze the accepted defaults at creation. **Existing documents
keep their frozen values forever**, including square documents born at 14 mm.

- No backfill.
- No SQL migration.
- No schema-version bump.
- No silent mutation of stored documents.

Preset defaults and document values are allowed to diverge; that divergence is
the intended behaviour of D-031, not a defect to be tidied away. Two
populations of square documents will coexist permanently and legitimately.

## 5 · The square page range is not narrowed

`photobook_square_210.maxPages` stays **240**. Reducing the product's page
range to make a temporary scalar margin model comfortable was considered and
rejected. Binding, page-count and output-profile requirements belong to future
preflight and profile logic.

## 6 · Bleed is untouched

Publication bleed remains **0.125 in = 3.175 mm = 9 pt per applicable edge**
(D-033, Amendment 2), unchanged in value, derivation and terminology. Bleed and
safe solve different problems and neither derives from the other.

## 7 · Slice B is unblocked

The margin ruling was the only remaining gate. Slice B (shapes + selection +
inspector foundation + persistence/history/autosave integration) may begin on a
fresh branch off the merge state, per production handoff Part 11 and the 27
accepted contracts. This amendment changes nothing else about Slice A: no
editing tools, no output-profile system, no exporter, no preflight
restructuring are introduced here.
