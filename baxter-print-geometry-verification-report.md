# Baxter Publishing — Print Geometry Verification Report

**Reviewer:** Independent verification session
**Date:** 2026-08-19
**Subject:** Adversarial review of `baxter-print-geometry-research-verification-handoff.md`
**Scope compliance:** No Baxter code, `formats.ts`, schema, export code, preflight, or Slice A records were read or modified. No model is marked accepted. This is research only.

**Provenance note:** ISO 32000-1:2008 and ISO 32000-2:2020 were obtained and read in full. ISO 15930 (PDF/X) clause text is paywalled; PDF/X box rules below are cited from the CGATS/NPES *Application Notes for PDF/X Standards v4* (committee-authored restatement) and PDF Association technical articles. That gap is flagged wherever it is load-bearing. GWG 2015 and GWG 2022 specifications were obtained and parsed in full.

---

## A. Verdict

# CONFIRMED WITH CHANGES

The handoff's **PDF/PDF-X technical reasoning is largely sound**. Findings 1, 2, 4, 5 and 6 survive verification. Finding 3 survives in substance but is **attributed to the wrong page box** — the load-bearing constraint is the MediaBox, not the BleedBox.

The handoff's **factual premise is the part that does not survive.** Specifically:

> Benjamin Gibson reports that printing partners advise supplying **0.25 inch of artwork beyond the finished page edge on every trimmed edge**.

Across 13 book, magazine and publication printers surveyed with primary-source spec pages, **not one requires 0.25 inch per edge on a book or magazine interior or softcover.** Every one lands on 0.125 in / 3 mm per edge. The number 0.25 inch appears constantly in this literature — but as *total added to each page dimension* (= 0.125 per edge), as the *safe/quiet area*, or as a *hardcover case-wrap* value (which is actually 0.625–0.8 in, not 0.25 in).

Before Baxter hard-codes 6.35 mm as a product standard, someone must go back to the specific printing partner and ask, in writing: **"Is 0.25 inch measured outward from the trim edge on each individual edge, or is it 0.25 inch added to the total width and total height?"** There is a high prior that the answer is the latter, in which case the entire premise of the proposed Baxter model collapses to the conventional 3.175 mm.

Second material change: **the proposed model is symmetric, and real book printing frequently is not.** IngramSpark/Lightning Source, Amazon KDP and Gorham Printing all explicitly require **no bleed on the bind (gutter) edge**. Bleed must be a per-edge quantity in Baxter's schema, not a scalar.

Third material change: **section 6's CropBox guidance is backwards** relative to the Ghent Workgroup requirement that CropBox equal MediaBox or be absent.

---

## B. Claim-by-claim verification

### Finding 1 — "0.125 in is the common convention" → **CONFIRMED**

Adobe's current InDesign documentation states verbatim that *"the industry-standard bleed is typically 0.125 inches (3 mm), but verify the requirements with your print provider,"* and adds that *"some print providers may require a larger bleed area."*
([helpx.adobe.com — Print bleed and slug areas](https://helpx.adobe.com/indesign/desktop/print/page-set-up-and-printer-marks/print-bleed-and-slug-areas.html))

Independently corroborated by every printer in the table in §D. Fair characterisation: **0.125 in / ~3 mm per edge is the dominant North American publication convention, and the printer's own specification controls.**

**Correction to wording:** 0.125 in = 3.175 mm; 3 mm = 0.1181 in. Adobe, and most printers, use "0.125 in (3 mm)" as if the two were the same number. **They are not, and Baxter must not treat them as interchangeable.** A tolerance-band model that stores one canonical value and rounds to the other will produce off-by-0.175 mm preflight results and, worse, will silently pass a 3.000 mm file against a 3.175 mm threshold or fail it, depending on rounding direction. Store both, or store the profile's stated value verbatim with its stated unit.

### Finding 2 — "PDF/X does not set a universal physical bleed distance" → **CONFIRMED, and stronger than stated**

ISO 15930-4:2003 clause 3.1 defines bleed as *"additional printing area outside the nominal printing area necessary for the allowance of mechanical tolerance in the trimming process"* — **with no number.** ISO 15930-9:2020 (PDF/X-6) does not define the term at all.

The PDF Association is explicit: *"Certain features needed only for some print applications (e.g., a bleed zone) are not required in PDF/X… PDF/X does not include provisions that although important, may vary depending on the printing conditions, e.g. the minimum image resolution or the bleed zone."* ([pdfa.org — PDF/X: The key facts](https://pdfa.org/pdfx-the-key-facts/))

The CGATS Application Notes contain **zero** occurrences of any bleed dimension.

**Is a 6.35 mm BleedBox compliant?** Yes, with PDF/X-1a, X-3, X-4 and X-6, subject to the containment and annotation rules in §C. There is **no upper bound on bleed distance anywhere in ISO 15930.**

**Correction to the handoff's wording.** The handoff says: *"PDF Association guidance says that where a bleed zone is defined, BleedBox must be outside TrimBox."* That is a loose paraphrase of the actual PDF/X rule, which runs the other direction and is more specific:

> *"Each PDF/X page shall include either an ArtBox or TrimBox, **but not both**. The inclusion of a BleedBox is **optional**. If a BleedBox is present, neither the ArtBox nor the TrimBox may extend beyond the boundaries of the BleedBox."*
> — CGATS/NPES, *Application Notes for PDF/X Standards v4*, §2.10 ([printtechnologies.org](https://printtechnologies.org/standards/files/pdf-x-application-notes_v4-sep06.pdf))

Two facts the handoff omits and Baxter's future exporter needs:
1. **BleedBox is optional under PDF/X.** TrimBox (or ArtBox) is the required one.
2. **TrimBox and ArtBox are mutually exclusive.** Emitting both is a conformance failure. Use TrimBox; the Application Notes state *"The use of TrimBox is recommended in preference to ArtBox."*

### Finding 3 — "full intended production allowance should be represented by BleedBox" → **CONFIRMED IN SUBSTANCE, WRONG BOX**

The conclusion Baxter should act on is correct: **do not ship a file whose artwork extends further than its declared BleedBox.** But the handoff's stated reason — that a downstream system will clip to BleedBox — is the *weaker* of the two mechanisms.

The decisive constraint is the **MediaBox**:

- Esko, verbatim: *"When using an external file as one-up, the available 'bleed' is the artwork between the TrimBox and the MediaBox. **Information outside the MediaBox is never used.**"* ([docs.esko.com — Working with bleed](https://docs.esko.com/docs/en-us/deskpack-prime/16/userguide/en-us/common/pls/concept/co_pls_workingwithbleed.html))
- ISO 32000-1 §14.11.2.1: content outside the MediaBox *"may safely be discarded without affecting the meaning of the PDF file."*
- Harlequin-class RIPs default their page-size bounding box to **MediaBox** and are operator-selectable ([PrintPlanet — Xitron Navigator case](https://printplanet.com/threads/rip-sees-and-outputs-the-elements-and-space-surrounding-cropped-areas-of-pdf-any-way-to-make-the-rip-honor-a-cropped-pdf.292426/)).

So the correct invariant is stronger and simpler than the handoff proposes:

> **BleedBox must equal the actual authored bleed extent, and MediaBox must be strictly ≥ BleedBox (plus marks/slug).** Never collapse MediaBox onto BleedBox if any content is meant to survive beyond it.

This matters because InDesign's default export behaviour does exactly that collapse: *"If the 'paper'-size width and height are set to automatic, the MediaBox size will be equal to the BleedBox size"* ([prepressure.com — page boxes](https://www.prepressure.com/pdf/basics/page-boxes)). Combined with Adobe's own statement that *"objects outside the bleed or slug area (whichever extends farthest) are not printed"* ([helpx.adobe.com — printer's marks, bleeds, slug](https://helpx.adobe.com/nz/indesign/using/printers-marks-bleeds.html)), the 6.35 mm-artwork / 3.175 mm-BleedBox scenario **cannot normally arise from InDesign at all** — the extra artwork is never written to the PDF. It can only arise from a bespoke exporter, i.e. from Baxter. That makes it Baxter's problem to not create, rather than an industry hazard to defend against.

### Finding 4 — "0.125 in should not become a second PDF page box" → **CONFIRMED**

PDF has exactly five page boxes and no second bleed box. There is no mechanism to express "minimum bleed" and "extended bleed" as distinct declarations. Treating 3.175 mm as an editor/preflight-only reference is sound and is the only option available.

### Finding 5 — "safe is independent from bleed" → **CONFIRMED, and understated**

The handoff treats this as a structural nicety. The evidence shows it is more consequential than bleed:

- Safe values are routinely **larger** than bleed: Sheridan 0.25 in, Mixam 0.25 in, KDP cover 0.25 in, IngramSpark interior 0.5 in, Lulu 0.5 in.
- Safe is frequently **per-edge and asymmetric**, and for perfect binding it is **page-count dependent**: KDP's gutter margin scales 0.375 in → 0.875 in with page count ([kdp.amazon.com — print options](https://kdp.amazon.com/en_US/help/topic/G201857950)).
- Some printers stack an additional safety allowance on the bind side: IngramSpark recommends a 0.125 in white strip on the bind edge *in addition to* the 0.5 in margin.

**Consequence for Baxter:** safe must be a per-edge value with a page-count-driven gutter term, not a single inset. Keeping it structurally independent from bleed is correct — but the safe model needs more design attention than the bleed model does.

### Finding 6 — "crop marks should be output-profile dependent" → **CONFIRMED, strongly**

The split is real, documented, and falls along workflow lines rather than vendor preference.

**Marks explicitly NOT wanted:** IngramSpark (*"Please do not include crop / printer / registration marks in a file. These are not necessary for LS's workflow. Marks included in a file could show up in printed copies."*), Amazon KDP, Lulu, Blurb (*"Marks included in your file will appear in the printed book."*), BookBaby, PrintNinja, Gorham.

**Marks wanted:** Friesens, Smartpress, Sheridan (spread-method covers only, with a 9–12 pt setback).

Sheridan proves the principle inside a single document: marks required for the spread imposition method, *"pages should not contain marks for single-page layout method"* ([Sheridan Covers guidelines 2025](https://www.sheridan.com/wp-content/uploads/Sheridan_Covers_guidelines_2025.pdf)).

**Pattern:** POD and automated-imposition houses reject marks; traditional offset houses that impose manually want them. Universally embedding marks would break the majority of the short-run market. Confirmed — make marks a profile setting, default **off**.

---

## C. PDF / PDF-X technical model

### Normative definitions (ISO 32000-1:2008 §14.11.2.1 and Table 30; ISO 32000-2:2020 §14.11.2.1 and Table 31 — wording for BleedBox/TrimBox/ArtBox is **word-for-word identical between PDF 1.7 and PDF 2.0**)

| Box | Normative definition | Default |
|---|---|---|
| **MediaBox** | *"the boundaries of the physical medium on which the page shall be displayed or printed… may include any extended area surrounding the finished page for bleed, printing marks, or other such purposes. Content falling outside this boundary **may safely be discarded**."* | Required; inheritable |
| **CropBox** | *"the visible region of default user space. When the page is displayed or printed, its contents shall be clipped (cropped) to this rectangle."* Explicitly: *"the crop box has **no defined meaning in terms of physical page geometry or intended use**; it merely imposes clipping."* | = MediaBox |
| **BleedBox** | *"the region to which the contents of the page **shall be clipped when output in a production environment**. This may include any extra bleed area needed to accommodate the physical limitations of cutting, folding, and trimming equipment."* | = CropBox |
| **TrimBox** | *"the intended dimensions of the finished page after trimming."* | = CropBox |
| **ArtBox** | *"the extent of the page's meaningful content (including potential white space) as intended by the page's creator."* | = CropBox |

### Containment — what is actually required

| Constraint | Status |
|---|---|
| Crop/Bleed/Trim/Art within MediaBox | **ISO 32000-1: "shall not ordinarily extend beyond… If they do, they are effectively reduced to their intersection with the media box."** ISO 32000-2 softens the writer obligation to *"should not ordinarily"* but hardens the reader obligation: *"a processor **shall** treat the box as its intersection with the media box."* |
| Bleed/Trim/Art within CropBox | **No ISO 32000 requirement.** The only containment sentence in either edition is the MediaBox one. Widely misquoted. |
| PDF/X: TrimBox **xor** ArtBox required | Required |
| PDF/X: BleedBox present | **Optional** |
| PDF/X: Trim/Art within BleedBox (when BleedBox present) | Required |
| PDF/X: Trim/Art within CropBox (when CropBox present) | Required |
| PDF/X: CropBox must contain BleedBox | **Not stated** in the Application Notes; falls back to ISO 32000 (no requirement). Widely asserted in secondary sources. Treat as unverified. |
| PDF/X-1a/X-3/X-4/X-5: annotations entirely outside BleedBox (PrinterMark annotations excepted, and those must still be outside Trim/Art) | Required. **Relaxed in PDF/X-6** ([pdfa.org](https://pdfa.org/technical-side-and-requirements-of-pdfx/)) |

### What happens to content outside BleedBox but inside MediaBox

ISO 32000 answers this by *consumer role*, in an informative note, and the answer differs per role. Anyone who states a single universal answer is quoting one scenario:

| Scenario (ISO 32000-1 §14.11.2.1, NOTE 1) | BleedBox behaviour |
|---|---|
| Printing a finished page | *"The art box and bleed box are **ignored**."* |
| Printing an intermediate page for prepress | *"Content falling within the media box but outside the bleed box **may or may not be imaged**, depending on the specific production process."* — **optional** |
| Building an imposition on a press sheet | *"The bleed box defines the clipping boundary of the content to be imaged; **content outside the bleed box is ignored**."* — **required** |
| Placing page content in another application | *"the placed content **may be clipped** to either the art box or the bleed box."* — permitted, convention-dependent |

NOTE 2 adds the implementation mechanism: *"an application that interprets the bleed, trim, and art boxes for some purpose typically alters the crop box so as to impose the clipping that those boxes prescribe."*

### Recommended relationship for Baxter

```
TrimBox   = exact finished page.                                  [always emitted]
BleedBox  = TrimBox outset per-edge by the ACTIVE PROFILE's bleed. [emitted when bleed > 0]
            Must equal the artwork's actual bleed extent. Never under-declare.
            Per-edge, not scalar — gutter edge may be 0.
MediaBox  = BleedBox + marks/slug allowance from the profile.
            Strictly ≥ BleedBox. Never collapsed onto BleedBox.
CropBox   = OMITTED, or set exactly equal to MediaBox.            [see correction 6]
ArtBox    = NOT emitted (mutually exclusive with TrimBox under PDF/X).
Marks     = profile setting, default OFF, drawn between BleedBox and MediaBox.
3.175 mm  = no PDF box. Editor guide + preflight floor only.
Safe      = no PDF box. Per-edge, page-count-aware.
Margin    = no PDF box. Editorial only.
```

**Annotations:** emit none inside the BleedBox under X-1a/X-3/X-4/X-5. A larger BleedBox enlarges this exclusion zone — the one concrete way an oversized BleedBox creates a conformance failure.

---

## D. Printer evidence table

All rows fetched from live primary spec pages. Bleed column states per-edge value and flags the phrasing form used.

| Printer | Product type | Bleed per edge | Phrasing form | Safe / internal | Crop marks |
|---|---|---|---|---|---|
| **Bookmobile** | Short-run book, offset + digital | **0.125"** all 4 | (a) per-edge — *"We need 1/8" bleed."* | 3/8" min margins | Not requested |
| **Friesens** | Large offset trade book / yearbook | **0.125"** — *"at Friesens we recommend 3mm, or 0.125""* | (a) per-edge | *"typically 6mm, or 0.25", inside the edge"* | **Wanted** — *"include bleed and crop marks"* |
| **Sheridan — Covers** | Large offset journal/magazine | **0.125"**, 3 edges (head, foot, front) | (a) per-edge | **0.25"** — *"must clear trim by minimum 1/4""* | **Split by method**: spread = required w/ 9–12 pt setback; single-page = *"pages should not contain marks"* |
| **Sheridan Random Lake** | Offset magazine/periodical | **0.125"** all 4 — *"at least 1/8" of bleed beyond the trim size on all 4 sides"* | (a) per-edge | 3/16" critical copy; 1/4" hinge from spine on PB covers | Not specified |
| **Mixam** | Digital + offset book/magazine | **0.125"** all 4; **hardcover 0.8"** all edges | (a) + explicit (b) worked example | Quiet area **0.25"** | Not requested |
| **Lulu** | POD / digital short-run | **0.125"** all 4 | **Both (a) and (b) on the same page** | **0.5"** safety margin | **Not wanted** |
| **Amazon KDP** | POD / digital | **0.125"**, **3 edges only** (top, bottom, outer) | (a) + (b) mixed — *"0.25" higher and 0.125" wider"* | Cover 0.25"; interior outside 0.375" w/ bleed; **gutter 0.375"→0.875" by page count** | **Not wanted** |
| **IngramSpark / Lightning Source** | POD + short-run offset | **0.125"**, **3 edges only** — *"Please do not add bleed to the bind (gutter) edge"* | (a) per-edge, asymmetric | **0.5"** margin; cover *"a full 0.25" / 6 mm safety"* | **Not wanted** |
| **PrintNinja** | Offset book / comic | **0.125"** all 4 | (a) per-edge | 0.125" safe; **0.25" for uniform borders** | **Not wanted** |
| **Smartpress** | Digital/offset booklet | **0.125"** booklet; **0.25" large-format only** | (a) + (b) | 0.125"; **0.25" with border** | **Wanted** — all four corners |
| **BookBaby** | Digital short-run book | **0.125"** interiors/softcovers/dustjackets; **0.625" hardcovers** | (a) per-edge | not published | **Not wanted** |
| **Blurb** | Digital photo/trade book | Refuses per-edge math — *"use the spec tool value"* | n/a | not published as single number | **Not wanted** |
| **48 Hour Books** | Digital short-run book | **0.125"** | **(b)** — *"create a page size that is 1/4" wider… and 1/4" taller"* | cover type ≥3/8"; interior ≥3/4" | Not requested |
| **Gorham Printing** | Short-run digital book | **0.125"**, **3 edges only**; *"the inside (gutter) should be set to 0"* | (a) asymmetric — *"trim width + .125 inch and trim height + .25 inches"* | 1" margins once bleed added | **Not wanted** |

### The 0.25-inch ambiguity, resolved

**(a) True per-edge 0.125"** — Bookmobile, Friesens, Mixam, PrintNinja, Sheridan, IngramSpark, KDP, Gorham.

**(b) "Add 0.25" to overall dimensions" = 0.125" per edge** — Lulu: *"Page size must be 0.25 in (6.35 mm) larger in both width and height… A 6 x 9 in book requires a PDF with pages sized 6.25 x 9.25 in."* 48 Hour Books: *"create a page size that is 1/4" wider (1/8" added to the right, and 1/8" added to the left), and 1/4" taller."* Mixam: *"Add 0.125" bleed to each edge (0.25" total per dimension)."* Smartpress and Gorham use the same construction.

**(c) Genuinely 0.25" per edge — found in ZERO book or magazine specifications.** The only 0.25"-per-edge bleed located anywhere is Smartpress for large-format signage: *"For larger items such as custom signs, posters and trade show graphics, bleeds of 0.25″ are needed."* Not a publication spec.

### Where "0.25 inch" legitimately comes from — three candidate explanations

1. **It is the total, not the per-edge value.** Form (b) above. Most likely explanation.
2. **It is the safe area, not the bleed.** Sheridan 0.25", Mixam 0.25", KDP cover 0.25", IngramSpark cover 0.25", PrintNinja 0.25" for bordered art. Also very likely.
3. **It is a hardcover case wrap** — but those are far larger than 0.25": Mixam 0.8", PrintNinja 0.8" foldover, IngramSpark 0.625", BookBaby 0.625". Note dust jackets stay at 0.125"; it is the case-laminate board wrap that jumps.

### The asymmetric-bleed finding — not in the handoff at all

Three of the highest-volume book workflows in North America require **zero bleed on the bind edge**:

- IngramSpark: *"A file that contains bleed elements is required to be submitted with 0.125" (3 mm) bleed added to the three trim edges (top, bottom, outside)… **Please do not add bleed to the bind (gutter) edge as this will cause incorrect positioning.**"* A 6×9 becomes **6.125 × 9.25**, not 6.25 × 9.25.
- KDP: *"extend them 0.125" beyond the final trim size from the top, bottom, and outer edges."*
- Gorham: *"We do not print gutter (inside) bleeds. Toner in the gutter will compromise the binding adhesive. **We will remove your gutter bleeds before printing.**"*

Lulu is the outlier among POD houses, wanting bleed on all four sides.

**This is a schema-shaping fact.** A scalar bleed value cannot express it. Baxter's bleed must be four independent per-edge values with a profile-driven gutter rule.

---

## E. Risk assessment — 6.35 mm artwork with a 3.175 mm BleedBox

**Question:** can a standards-compliant or common workflow lose access to the outer 3.175 mm?

**Classification: PLAUSIBLE** — upper end of plausible. Not theoretical; not demonstrated-common.

### Why not THEORETICAL — the mechanism is documented in named, mainstream tools

1. **Adobe InDesign, placing a PDF.** The Place dialog's *Crop To* option **Bleed** — Adobe's verbatim wording: *"Places only the area that represents where all page content should be clipped, if a bleed area is present."* Content beyond BleedBox is not placed. The setting is **sticky across sessions and restarts** ([Adobe — Importing graphics](https://helpx.adobe.com/ie/incopy/desktop/add-graphics-and-frames/importing-graphics.html); [CreativePro — Understanding InDesign's Place PDF Options](https://creativepro.com/understanding-indesigns-place-pdf-options/)).
2. **Quite Imposing** (widely used Acrobat imposition plug-in), verbatim: *"The bleed box is the exterior of the bleed. If absent, the trim box is used… The bleed exterior runs outside this area and may overlap the crop marks."* Content beyond BleedBox is not carried onto the press sheet ([quite.com manual](https://www.quite.com/docs/qi6/en/qi6_manual/b6_0013.html)).
3. **Enfocus PitStop** ships **Crop line art** — *"Performs a hard crop on line art… Crop line art to the page box of your choice: Removes all line art outside the specified page box"* — inside the stock *Clean Up Content* action list, plus **Crop images** to a page box and **Check if object is completely outside page box** ([PitStop Action Manual](https://cdn.enfocus.com/manuals/Extra/Actions/18/pdf/Actions.pdf)).
4. **Acrobat Preflight fixup** *"Remove page objects which are completely outside of page area"* is routinely retargeted to the BleedBox by prepress operators to strip slugs — a practitioner states this on the record in the long-running Adobe community thread on discarding cropped content ([community.adobe.com](https://community.adobe.com/t5/acrobat-discussions/discarding-cropped-areas-of-pages/td-p/4304473)).
5. ISO 32000's own normative *"shall be clipped when output in a production environment"*, and the explicitly-required clipping in the imposition scenario.

### Why not DEMONSTRATED-COMMON — the dominant stacks do not gate on BleedBox

- **Esko** gates on **MediaBox** and clips relative to **TrimBox** with an operator offset. BleedBox is not mentioned in its bleed documentation.
- **Kodak Prinergy / Preps** use *"the distance you want the bleed to extend on all sides beyond the page **trim box**"* — operator-set, trim-relative ([workflowhelp.kodak.com](https://workflowhelp.kodak.com/display/PRIN110/New+Imposition+Details+dialog+box)).
- **Heidelberg Prinect Signa Station** positions from TrimBox and takes bleed from a preferences default ([onlinehelp.prinect-lounge.com](https://onlinehelp.prinect-lounge.com/Prinect_Signa_Station/Version2019/en/Prinect/TOV_Workflow/TOV_Workflow-6-.htm)).
- **Harlequin-class RIPs** default the page-size bounding box to **MediaBox**, operator-selectable.
- prepressure states the practitioner consensus outright: *"It is nice to know the size of the BleedBox but it isn't that important in graphic arts. **Most prepress systems allow you to define the amount of bleed yourself and ignore the BleedBox.**"*
- **No case report was found** of a job where artwork beyond the BleedBox was lost. Searched PrintPlanet, Adobe forums, prepressure, Enfocus and callas material. That absence is itself evidence.

### The reframe that actually matters

Chain two citations. prepressure: on InDesign export with automatic paper size, *"the MediaBox size will be equal to the BleedBox size."* Esko: *"Information outside the MediaBox is never used."*

Therefore in the ordinary InDesign case the outer artwork **is not in the file at all** — Adobe confirms *"objects outside the bleed or slug area (whichever extends farthest) are not printed."* The scenario in question is not something the industry routinely produces; it is something a **bespoke exporter** would have to deliberately construct. That is Baxter's situation exactly.

**Conclusion:** the risk is real enough to design against, and trivially avoided. Baxter should never emit a file whose artwork exceeds its declared BleedBox — not because the industry will reliably punish it, but because the file would be making a false structural claim about itself and Baxter has no reason to.

### The converse risk the handoff did not consider — over-declaring

Declaring 6.35 mm when the printer requested 3.175 mm is **standards-compliant and low-risk**, but not free:

1. **"Bleed declared but not filled."** Preflight profiles verify not only that the BleedBox is set but *whether the bleed zone actually contains printable content*. callas pdfToolbox's *Check and fix bleed* takes a required bleed, tolerance and safety zone and flags an edge where *"the required bleed zone is empty"* ([help.callassoftware.com](https://help.callassoftware.com/m/pdftoolbox/l/1312388-check-and-fix-bleed)). If a Baxter layout has a full-bleed image that only reaches 4 mm, a declared 6.35 mm BleedBox is a self-inflicted preflight failure.
2. **Synthetic bleed substitution.** An automated *Generate bleed from page content* fixup will mirror or stretch outward from the TrimBox to fill a short bleed zone — replacing real artwork with a smeared fake, silently, with no error raised. This is the sharpest practical harm found in the whole research pass, and it argues for BleedBox always matching real content extent.
3. **PDF/X annotation exclusion zone grows** with the BleedBox (X-1a/X-3/X-4/X-5). Low impact for Baxter if it emits no annotations — but it must not.
4. **Control strips** must sit outside the BleedBox per CGATS App Notes; an inflated BleedBox can swallow one.
5. **Gang/nested imposition collisions.** Esko: *"If two one-ups (or their bleed) would overlap… the clipping mask of both will be restricted to half way the overlap."* Fujifilm XMF loses bleed on overlapping nests with **no vendor fix** ([PrintPlanet](https://printplanet.com/threads/overlapping-pages-lose-bleed.294409/)). Preps and Signa auto-halve adjacent bleeds. Over-declaring is absorbed rather than fatal — but you do not receive what you declared.
6. **PitStop press-layout checks** let a shop define a *minimum distance between media and bleed box*; a BleedBox pushed to the MediaBox edge fails.

**Net:** over-declaring is lower-risk than under-declaring, but only if the artwork genuinely fills the declared zone.

---

## F. Baxter recommendation

**Neither option 1 nor option 2 as written. Recommend a modified option 3.**

### Recommended model: per-edge, profile-driven bleed with a 6.35 mm house default

1. **Bleed is four independent per-edge values**, not a scalar. Non-negotiable given IngramSpark / KDP / Gorham gutter rules.
2. **The output profile owns the bleed values.** The profile carries: per-edge bleed, gutter rule, safe insets, page-count gutter term, marks on/off, PDF/X conformance target.
3. **House default profile: 6.35 mm on all four edges** — as an *authoring canvas*, which is defensible and costs nothing at authoring time. Adobe explicitly permits it: *"some print providers may require a larger bleed area."*
4. **BleedBox always equals the authored bleed extent, and artwork must actually fill it.** This is the invariant that makes option 1 safe and option 2 incoherent. Option 2 as written (3.175 mm BleedBox + 6.35 mm of extra artwork) creates exactly the false structural claim that PitStop, Quite Imposing and InDesign-place will act on, and invites synthetic-bleed substitution. **Reject option 2.**
5. **MediaBox strictly ≥ BleedBox**, plus marks/slug allowance. Never collapsed. This is the real protection, and it is the correction to Finding 3.
6. **Do not name it "Baxter Bleed" in any output the printer sees.** Calling a nonstandard value after your own product invites a prepress operator to assume it is a recognised standard. Internally, fine. In an export dialog, a preflight report, or a printer-facing PDF, call it what it is: the document's bleed, in mm.
7. **Before any of this is accepted, resolve the premise.** Get the printing partner's answer in writing on per-edge vs total. If the answer is "total," the house default should be 3.175 mm per edge and this entire model reduces to the conventional case.

### Why not option 1 exactly as stated

Option 1 is nearly right, but as written it is symmetric, universal, and hard-coded — three properties the printer evidence contradicts. The 6.35 mm value is defensible as a *default*; it is not defensible as a *product constant*.

---

## G. Preflight model

**Reject the proposed three-band model as a universal.** Adopt profile-driven thresholds with a universal floor.

### Recommended structure

Two structurally independent check families, as the handoff proposes — that part is right and should stand:

**Family 1 — Bleed coverage**, evaluated **per edge**:

| Condition | State | Rationale |
|---|---|---|
| Edge is a full-bleed edge and coverage < profile minimum | **FAIL** | Profile supplies the number. Default profile minimum = 3.175 mm. |
| Coverage ≥ profile minimum but < profile target | **ADVISORY** | Baxter house preference. Must be labelled as house preference, **not** as an industry requirement. |
| Coverage ≥ profile target | **PASS** | |
| Bleed declared on an edge the profile forbids (gutter) | **FAIL** | New check. Catches IngramSpark/KDP/Gorham violations. Absent from the handoff. |
| BleedBox declared but bleed zone not filled by content | **FAIL** | New check. Prevents synthetic-bleed substitution downstream. Absent from the handoff. |
| Artwork extent > declared BleedBox | **FAIL** | New check. Prevents the §E scenario from ever being emitted. Absent from the handoff. |

**Family 2 — Critical-content safety**, evaluated per edge, page-count-aware on the gutter, entirely independent of Family 1.

### On whether 3.175 mm should be universal

**As a floor, yes — provisionally. As the only threshold, no.**

The handoff's §9 item 3 anticipated that Ghent Workgroup preflight profiles would supply an authoritative threshold. **They do not.** GWG 2015 and GWG 2022 were both read in full: **there is no bleed requirement in any GWG specification, in any of the 23 GWG 2022 variants, in either direction.** GWG 2022 has 39 requirements and none concerns bleed; the word appears once, referring to an ISO 19593-1 processing-step layer name. GWG's mechanism for conveying per-publication bleed is *metadata* — the GWG Ad Ticket — not preflight.

So there is no standards body that will ever hand Baxter a number. **3.175 mm is convention with zero normative backing.** Use it as the default profile's floor because it is what the market does, but architect the threshold as profile-owned from day one. Do not encode 3.175 mm anywhere outside a default profile definition.

The two GWG requirements that *are* relevant are box-structural, and they contradict the handoff — see correction 6.

---

## H. Corrections

Unsoftened, in order of consequence.

1. **The premise is probably wrong.** No surveyed book or magazine printer requires 0.25 in per edge. The handoff builds an entire model on a reported requirement that, across 13 primary sources, does not exist in that form in publication printing. Zero of thirteen. The number 0.25 in is pervasive in this literature as a *total*, as a *safe area*, and never as a per-edge book-interior bleed. **Resolve this before anything else. Everything downstream is contingent on it.**

2. **The model is symmetric; the market frequently is not.** IngramSpark, Amazon KDP and Gorham all forbid bleed on the bind edge — Gorham states it will strip gutter bleeds itself because *"toner in the gutter will compromise the binding adhesive."* The handoff's phrase "every applicable edge" gestures at this without confronting it. Bleed must be four per-edge values in the schema. A scalar cannot represent the requirements of the three highest-volume POD workflows in the market.

3. **Finding 3 attributes the risk to the wrong page box.** The binding constraint is the **MediaBox**, not the BleedBox. Esko: *"Information outside the MediaBox is never used."* ISO 32000: content outside MediaBox *"may safely be discarded."* Under-declaring the BleedBox is a problem; collapsing the MediaBox is a *worse* problem, and the handoff never names it. §6's MediaBox line should be promoted from a description to a hard invariant.

4. **The PDF/X rule in Finding 2 is stated backwards and incompletely.** "BleedBox must be outside TrimBox" is a loose paraphrase. The actual rules: TrimBox **or** ArtBox is required and they are **mutually exclusive**; **BleedBox is optional**; Trim/Art must not extend beyond BleedBox when BleedBox is present. The handoff nowhere states that BleedBox is optional or that emitting both TrimBox and ArtBox is a conformance failure. Both facts are directly relevant to a future exporter.

5. **The handoff never mentions the PDF/X annotation exclusion rule.** Under X-1a, X-3, X-4 and X-5, *"most types of annotations must fall entirely outside the BleedBox."* Enlarging the BleedBox to 6.35 mm enlarges that forbidden zone — the single clearest spec-grounded cost of the proposed change. Relaxed only in X-6. This should have appeared in §7's list of possible adverse consequences.

6. **§6's CropBox guidance is backwards.** The handoff says *"CropBox: deliberately defined for the workflow; do not assume equality with another box."* Ghent Workgroup requires the opposite. **GWG 2022 R0003 "Visible page area": *"For all pages in the PDF file, the CropBox shall coincide with the MediaBox… This can be accomplished by explicitly defining the CropBox with the same values as the MediaBox, or by omitting the CropBox."*** GWG 2015 §4.3 is identical. ISO 32000 also warns the CropBox *"has no defined meaning in terms of physical page geometry or intended use."* A "deliberately defined" CropBox is a preflight failure against every GWG variant and buys nothing. **Omit it, or set it equal to MediaBox.**

7. **§9 item 3 rests on a false assumption about the Ghent Workgroup.** GWG has no bleed requirement at all — not a minimum, not a maximum, not in 2015, not in 2022, not in any of the 23 variants. Do not plan on GWG resolving the threshold question. (GWG 2022 R0004 does require TrimBox size to be identical across all pages and Rotate to be unused — worth capturing as a separate export invariant.)

8. **Finding 5 is understated.** Safe is not merely "structurally independent" — it is more complex than bleed. It is per-edge, frequently larger than bleed (0.25–0.5 in), and page-count-dependent on the gutter (KDP: 0.375 in → 0.875 in). The handoff treats it as a symmetric inset. It is not.

9. **Unit conflation.** 0.125 in = 3.175 mm; 3 mm = 0.1181 in. Adobe and most printers write "0.125 in (3 mm)" as if identical. The handoff's invariants are arithmetically correct but it does not flag that its sources are not. Baxter must store the profile's stated value in its stated unit and never silently convert-and-round, or preflight will produce off-by-0.175 mm verdicts at the exact threshold that determines pass/fail. *(For reference: 0.25 in = exactly 18 pt, 0.125 in = exactly 9 pt, both exactly representable in PDF user space. 3 mm = 8.5039 pt is not.)*

10. **"Baxter Bleed" is a hazardous product term** in any printer-facing surface. It presents a house preference in the grammatical form of a standard. Keep it internal.

11. **The handoff nowhere considers the over-declaration failure mode.** §7 asks only whether the conservative standard creates adverse consequences, and lists workflow, imposition, file-size, marks and PDF/X. It misses the two that actually bite: **bleed-declared-but-not-filled** preflight failures, and **automated synthetic-bleed generation** overwriting real artwork with a mirrored fake, silently. See §E.

12. **Minor — Finding 2's second sentence is irrelevant to Baxter.** *"Adobe Acrobat PDF settings can derive BleedBox from TrimBox with offsets"* describes Distiller behaviour. Baxter writes its own PDF; this has no bearing on its model and should be dropped rather than carried as supporting evidence.

13. **Evidentiary gap to be honest about.** ISO 15930's normative "Bounding boxes" clause text (§6.12 in X-4, §6.9 in X-6) is paywalled and was not read. Every PDF/X box rule in this report is cited from the CGATS/NPES Application Notes v4 (a committee restatement that is explicitly not a standard) and PDF Association articles. These are near-primary and mutually corroborating, but if Baxter is going to write a PDF/X-conforming exporter, someone should buy ISO 15930-9:2020 and read §6.9 verbatim. Adobe's APPE page-box clipping behaviour is also not publicly documented and remains unverified in both directions.

---

## Stop point

This is research verification only. No Baxter decision is recommended as accepted. The proposed bleed model is **not** marked accepted. Awaiting Benjamin's decision — and, first, the printing partner's clarification on per-edge versus total.

---

## Sources

**Standards and normative material**
- ISO 32000-1:2008 (PDF 1.7), full text — https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf
- ISO 32000-2:2020 (PDF 2.0), PDF Association sponsored release — https://pdfa.org/sponsored-standards/
- ISO 15930-4:2003 (PDF/X-1a), preview incl. clause 3.1 — https://cdn.standards.iteh.ai/samples/39938/062626a2642e4e7cb566ae982e54fd9f/ISO-15930-4-2003.pdf
- CGATS/NPES, *Application Notes for PDF/X Standards v4* — https://printtechnologies.org/standards/files/pdf-x-application-notes_v4-sep06.pdf
- PDF Association, *PDF/X: The key facts* — https://pdfa.org/pdfx-the-key-facts/
- PDF Association, *Technical side and requirements of PDF/X* — https://pdfa.org/technical-side-and-requirements-of-pdfx/
- GWG 2022 specification (spreadsheet) — https://gwg.org/technical-specifications/gwg-2022-specifications/
- GWG 2015 specification — https://web.archive.org/web/20160207180625/http://www.gwg.org/wp-content/uploads/GWG2015-Specification.pdf

**Adobe**
- Print bleed and slug areas — https://helpx.adobe.com/indesign/desktop/print/page-set-up-and-printer-marks/print-bleed-and-slug-areas.html
- Specify printer's marks, bleeds, or slug areas — https://helpx.adobe.com/nz/indesign/using/printers-marks-bleeds.html
- Importing graphics (Place > Crop To options) — https://helpx.adobe.com/ie/incopy/desktop/add-graphics-and-frames/importing-graphics.html
- Discarding cropped areas of pages (community thread) — https://community.adobe.com/t5/acrobat-discussions/discarding-cropped-areas-of-pages/td-p/4304473

**Prepress tooling**
- Esko, Working with bleed — https://docs.esko.com/docs/en-us/deskpack-prime/16/userguide/en-us/common/pls/concept/co_pls_workingwithbleed.html
- Kodak Prinergy, Imposition Details — https://workflowhelp.kodak.com/display/PRIN110/New+Imposition+Details+dialog+box
- Heidelberg Prinect Signa Station — https://onlinehelp.prinect-lounge.com/Prinect_Signa_Station/Version2019/en/Prinect/TOV_Workflow/TOV_Workflow-6-.htm
- Quite Imposing manual, bleed — https://www.quite.com/docs/qi6/en/qi6_manual/b6_0013.html
- Enfocus PitStop Action Manual — https://cdn.enfocus.com/manuals/Extra/Actions/18/pdf/Actions.pdf
- Enfocus PitStop Preflight Checks Overview — https://cdn.enfocus.com/manuals/Extra/PreflightChecks/24/pdf/PreflightChecksOverview.pdf
- callas pdfToolbox, Check and fix bleed — https://help.callassoftware.com/m/pdftoolbox/l/1312388-check-and-fix-bleed
- callas pdfToolbox, Generate bleed from page content — https://help.callassoftware.com/m/99113/l/1329607-generate-bleed-from-page-content-updated-in-pdftoolbox-12
- prepressure.com, PDF page boxes — https://www.prepressure.com/pdf/basics/page-boxes
- PrintPlanet, RIP page-size bounding box — https://printplanet.com/threads/rip-sees-and-outputs-the-elements-and-space-surrounding-cropped-areas-of-pdf-any-way-to-make-the-rip-honor-a-cropped-pdf.292426/
- PrintPlanet, Overlapping pages lose bleed — https://printplanet.com/threads/overlapping-pages-lose-bleed.294409/
- CreativePro, Understanding InDesign's Place PDF Options — https://creativepro.com/understanding-indesigns-place-pdf-options/

**Printers**
- Bookmobile — https://info.bookmobile.com/knowledge/what-are-bleeds
- Friesens — https://www.friesens.com/blog/understanding-bleed-a-comprehensive-guide/
- Sheridan Covers guidelines 2025 — https://www.sheridan.com/wp-content/uploads/Sheridan_Covers_guidelines_2025.pdf
- Mixam file setup — https://mixam.com/support/filesetup
- Lulu full bleed — https://help.lulu.com/en/support/solutions/articles/64000255584-what-is-full-bleed-
- Amazon KDP print options — https://kdp.amazon.com/en_US/help/topic/G201857950
- IngramSpark File Creation Guide — https://www.ingramspark.com/hubfs/downloads/file-creation-guide.pdf
- PrintNinja full bleed setup — https://printninja.com/file-setup-for-full-bleed-printing/
- PrintNinja casebound cover setup — https://printninja.com/hardcover-case-bound-cover-setup-guide/
- Smartpress bleed and borders — https://smartpress.com/support/printing-basics/bleed-borders
- BookBaby, What is bleed — https://support.bookbaby.com/hc/en-us/articles/206285857-What-is-bleed
- Blurb PDF-to-book specifications — https://support.blurb.com/hc/en-us/articles/207792946-PDF-to-Book-specifications-and-checklist
- 48 Hour Books FAQ — https://www.48hrbooks.com/faq
- Gorham Printing, bleeds — https://gorhamprinting.com/diy-book-printing/bleeds.html
