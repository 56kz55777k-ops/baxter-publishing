# Baxter Publishing — Slice 7 Design Questions

**Date:** 2026-07-02
**From:** Claude Code (paired with Ben Gibson)
**For:** review before implementation
**Builds on:** `docs/implementation-plan.md` §Slice 7, the Editorial Constitution (§Publication pages, §Marketplace browsing, §Transitions and empty states, and the two-voice / "editorial office" principles D-021), and the shipped Slices 1–6.
**Slice 7 goal (from the plan):** the marketplace shell — the public home for `published` works. Homepage sections (hero, editor picks, new releases), the public publication page, basic browse/search. The Constitution flags this as **the most important atmosphere slice** ("Will likely take 1.5 days, not 1. The homepage does *less* than it could. That restraint is the design.").

**Scope note:** this brief is deliberately **atmosphere-first**, per Ben's framing — homepage composition, the public publication page, Editor's Picks, New Releases, browse/search restraint, and how discovery should *feel*. The actual **transaction** (Stripe checkout, orders) is Slice 8; every "buy" affordance here is a restrained, non-functional placeholder until then. Keeping commerce out is not a gap — it's the point of doing atmosphere before plumbing.

---

## STATUS — PARTIALLY LOCKED (2026-07-02)

Ben locked the two highest-leverage decisions and a foundational refinement; recorded as **D-022, D-023, D-024** in `decisions.md`, with the Constitution updated to match. The remaining decisions (1, 2, 4, 5, and parts of 3) are proceeding on the brief's recommended defaults unless Ben redirects.

- **Decision 0 → D-022 (LOCKED).** The homepage **becomes the marketplace front door** — the opening statement stays, then the work begins beneath it (understand where you are, then look at the work). Not a marketing page, not a storefront. Publication URL locked as **`/[handle]/[slug]`** (creator is the primary author).
- **Decision 6 → D-023 (LOCKED, revised).** Price **does** appear in the grid — reversing the original omit-price instinct — but as the **quietest** element. Card is exactly **Cover → Title → Creator → Price**, nothing else: no badges, "From…", CTA, urgency, or sale framing. Price is metadata, like page count. Principle: **remove performative commerce, not commerce.**
- **New — D-024 (LOCKED).** **The three actors** — Platform (Institutional Voice, the homepage), Editor (Editorial Voice, Editor's Picks), Creator (protagonist, the publication page). Surfaces must keep them separate. Constitution-level; extends D-021.
- **Still open (working defaults from §5 below):** homepage section set (opening line → Editor's Picks → New Releases; latest ~12; no "Load more"); publication-page composition (cover-dominant, price plain, Slice-8 purchase as one honest line); Editor's Picks storage (`editor_pick_at` timestamp column + admin toggle); **omit "Popular"** in v1; browse by category, **defer search**. These are recommendations — confirm or redirect before/inside the build.

---

## 1. What Baxter is, in two paragraphs

Baxter is a curated publishing marketplace. Through Slice 6, the full creator-and-editor loop is live: create → preflight → submission ceremony → editorial review → **publish**. A `published` publication is genuinely live in data — it has a cover, preview pages, a description, a price, a creator, and (as of D-019) a `published_at`.

Slice 7 gives those works a **public room to be seen in**. This is the first surface a reader (not a creator) encounters, and the Constitution is unusually specific about it: it must feel like *walking the aisles of a gallery bookstore — you browse with your eyes, not your filters* — and a publication page must feel like *a page in a museum bookstore catalog, where the transaction is incidental to the encounter*. The whole risk of the slice is drifting into e-commerce defaults (dense grids, filter sidebars, "Add to cart" as the centre of gravity, urgency, "customers also bought"). The design is what we refuse to build.

---

## 2. Where Slice 7 sits

**Upstream (shipped):** publishing works end to end. `published` rows exist with `cover_asset_id`, `preview_page` assets (Cloudflare Images), `price_minor`/`currency`/`edition_size`, `category`, `slug`, `published_at`.

**This slice:** the public marketplace — homepage as a curated shelf, a public publication page, and restrained browse/discovery. Read-only; no auth required to view.

**Downstream (Slice 8):** Stripe Connect checkout turns the placeholder buy affordance into a real order. **Not in this slice.**

---

## 3. Verified current state (confirmed against the live code)

- **`published` works currently render *nowhere* public.** The homepage (`(marketing)/page.tsx`) is a static editorial *statement* — no live works. The creator profile (`app/[handle]/page.tsx`) has a **"Publications" section that is a hardcoded "No publications yet." placeholder** — it does not query published works yet. So Slice 7 builds the first real public listing from scratch.
- **No public publication page exists.** Routes today: `/` (marketing), `/[handle]` (creator profile). There is **no `/[handle]/[slug]`** (or equivalent) public work page. The schema intends the URL `/<handle>/<slug>` (`publications.slug` is `notNull`, unique per creator). *Build-time confirm: that `slug` is actually populated at creation.*
- **No Editor's Pick field exists.** `publications` has `status, published_at, price_minor, currency, edition_size, category, cover_asset_id, slug`. There is **no `editor_pick`/`featured` column** — Editor's Picks needs a decision + (likely) the one migration in this slice. (Editor's Picks was explicitly deferred here from Slice 6.)
- **No "popular" signal exists.** No view counts, no sales (Stripe is Slice 8). Any "Popular" section today would be fabricated ordering.
- **Reviews:** a `reviews` table exists but its **UI is deferred** (plan §7). Not surfaced in Slice 7.
- **Imagery is ready:** covers + preview pages are public Cloudflare Images with responsive variants (`cover` 1200w / `grid` 600w / `full` 1600w) — the marketplace's shop window already has a real image layer.
- **Design tokens exist:** `metadata`, `font-serif`, `text-h1/display/lede`, `text-ink/ink-soft/ink-faint`, `rule`, `border-rule`, `text-accent`, `ease-gentle`, the 12-col grid — the whole visual vocabulary the current pages use.

### The constraint that shapes everything below
The Constitution's §Marketplace browsing is a set of near-binding rules: **≤15–25 works before scroll · no "Load more" · no filter sidebar by default · Editor Picks sparse and editorial, not a shop rail · search exists but isn't primary · hover states subtle (no scale-up, shadow-pop, or "snappy" feedback).** Design *within* these, not around them.

---

## 4. The voice & atmosphere you must design within (Constitution extract)

- **Publication pages:** the cover gets *disproportionate* space (the cover is the storefront); specs/format/page-count present but de-emphasized; "Add to cart" is *not* the visual centre of gravity; no "customers also bought"; no urgency ("Only 3 left"); reviews (later) quiet, below the work. *Feel: a museum bookstore catalog page.*
- **Marketplace browsing:** finite and curated; browse with the eyes, not filters; Editor Picks sparse/editorial; subtle hover/focus. *Feel: the aisles of a gallery bookstore.*
- **Empty/transition states:** written, not illustrated; "No publications yet" is a sentence, not a card-with-CTA; quiet fades, no skeleton shimmer; white space is content.
- **Two voices (D-021):** the marketplace chrome is **Institutional** (facts — a title, a price, a format, "Published [date]"). The **Editorial Voice** appears only where a human editor speaks — which in this slice means **Editor's Picks framing** (if any) and nowhere else. Prices and specs never editorialize.
- **Editorial office, not a moderation/commerce platform:** no "trending," no "bestseller" badges, no "hot," no scarcity, no cart iconography as identity. The reader is a visitor to a publishing house, not a shopper in a store.

---

## 5. The decisions

### Decision 0 — The public shape: does `/` become the marketplace, and what is a work's URL? *(gates everything — decide first)*

Two intertwined questions that every link and layout depend on:

**0a — Homepage identity.** The plan says the homepage *is* the marketplace (hero + picks + new releases). But today `/` is a composed marketing statement ("Independent publishing, made carefully"). Options:
- **A — `/` becomes the marketplace.** The statement is distilled to a single held line at the top, then the shelf (picks / new releases) follows. The current prose moves to a quiet `/about`. One front door; the work leads.
- **B — Keep `/` as the statement; marketplace lives at `/browse` (or `/shelf`).** The homepage stays a lobby; browsing is a deliberate step in.
- **C — Hybrid: `/` keeps a short opening band, then live works below it** (statement and shelf on one page).

*Lean: **C**, leaning toward A over time.* The Constitution's "opening room" idea is worth keeping as one line, but readers should meet real work on the front door — a marketplace whose homepage hides the work behind a marketing page is exactly the platform-humility inversion we avoid. Distil the prose; let covers carry the room.

**0b — Publication URL.** Options: `/[handle]/[slug]` (nested under the creator — the schema's intent) vs a flat `/p/[id]` or `/publications/[id]`.
- *Lean: **`/[handle]/[slug]`.*** It makes the creator's name part of the address (a book spine), matches the schema, and reinforces "when published, it lives at its own address" (already promised on the homepage). Requires confirming `slug` is populated + unique-per-creator (it is, by schema).

**Decide 0a and 0b first** — Decisions 1–2 lay out onto whichever shapes we choose.

---

### Decision 1 — Homepage composition (the atmosphere centrepiece)

Given Decision 0, what sits on the marketplace front door, in what order, and how much?

**1a — Section set.** Candidate sections: an **opening line**; **Editor's Picks** (sparse, editorial); **New Releases** (published_at desc); (and the plan's **"Popular"** — see Decision 4). Question: which of these ship, and in what order? *Lean:* opening line → **Editor's Picks** (a small, editorial feature) → **New Releases**. Drop "Popular" for v1 (Decision 4).

**1b — Density + finitude.** The Constitution caps ~15–25 works before scroll, no "Load more." Question: how many New Releases show on the homepage (e.g. the latest 12–16), and where does "everything else" live — a single quiet "All publications" link to a browse view, or nothing until there's volume? *Lean:* show the latest ~12; one restrained "All publications" link; no pagination chrome.

**1c — The hero.** Is there a single large hero (one featured work or an editorial line), or does the page open straight into Editor's Picks? An e-commerce "hero banner" is a trap; an editorial single-work feature can be beautiful. *Lean:* the opening line *is* the hero (typographic, not a banner); the first Editor's Pick may render large beneath it. Open to a single-featured-work hero if you prefer the work to lead immediately.

---

### Decision 2 — The public publication page (`/[handle]/[slug]`)

The museum-catalog page. Question: the exact composition and the purchase affordance.

**2a — Composition + hierarchy.** Proposed, cover-dominant: large **cover** → **title / subtitle** → **creator** (linked to `/[handle]`) → **description** → a quiet **spec block** (format, page count, edition, category) → the **preview pages** as a quiet leafing column → a single restrained **purchase line**. Reviews deferred. Question: is this the right order, and do previews sit above or below the specs? *Lean: as listed — cover huge, specs de-emphasized, previews low and quiet.*

**2b — The purchase affordance (Slice-8 boundary).** No Stripe yet, so this is a placeholder. Options: (i) a quiet **"Buy — available soon"** line (Institutional, honest); (ii) show the price only, no button, until Slice 8; (iii) a disabled "Buy print / Buy digital" pair. The Constitution forbids "Add to cart" as centre of gravity and any urgency. *Lean:* show the **price** plainly and one restrained line — e.g. *"Print · $12.00. Ordering opens soon."* — no cart button, no disabled-button theatre. Revisit wording in Slice 8.

**2c — Format labels.** Publications carry a `format` (`print` / `digital` / `print_digital`). Question: how is availability shown — "Print", "Digital", "Print and digital" — as a quiet fact, not a toggle? *Lean:* a single Institutional line; no tabbed buy-box.

**2d — Sensitive categories.** D-016 defined a sensitive-category hook. Question: does the public page carry any notice, or is that purely an editorial/review concern? *Lean:* nothing public in v1 (editorial handles it upstream); revisit if a content-risk taxonomy lands.

---

### Decision 3 — Editor's Picks mechanism (the one likely migration)

No field exists; this needs a home and a control.

**3a — Storage.** Options:
- **A — `editor_pick_at timestamptz null` on `publications`** (migration). Sparse, sortable (newest pick first), trivially queryable, and "is it picked" = "is the column non-null." Un-picking = set null.
- **B — a `featured` join table** (publication_id, position, note). Enables ordering + an editorial note per pick, but more schema.
- **C — a domain constant / hardcoded id list.** Zero schema, but not operable by the editor without a deploy — violates "the editor decides," so rejected.
*Lean: **A** for v1* (a timestamp column), upgradeable to B if picks later need manual ordering or a per-pick blurb.

**3b — Who sets it, and where.** Picks are an **editorial** act (Editorial Voice territory). Options: a quiet admin-only "Feature this" control on the **public publication page** when viewed as admin, or a control on a new **admin published-works** list, or back on the review page at publish (but D-019 kept publish clean). *Lean:* an admin-only toggle on the publication page (or a small `/admin` "Published" list) — a separate, deliberate act from publishing, consistent with D-019 keeping the publish moment singular.

**3c — Editorial framing.** Does a pick carry an editor's *words* (Editorial Voice — "Baxter's editor on this work: …") or is it just curation-by-placement (the work appears in the Picks band, no prose)? This is the one place Editorial Voice could surface publicly. *Lean:* curation-by-placement for v1 (sparse, no prose); a per-pick editorial note is a natural B-storage upgrade if you want the editor's voice on the shop window.

---

### Decision 4 — New Releases, and whether "Popular" exists

**New Releases** = `published` ordered by `published_at desc`. Honest and available now.

**"Popular"** — the plan lists it, stubbed by `published_at` for v1. But there is **no popularity signal** (no views, no sales until Slice 8). Question: show a "Popular" section faked by recency (two sections that are secretly the same sort), or **omit it** until there's real signal? *Lean: **omit Popular** in v1.* A "Popular" rail with no popularity behind it is exactly the commerce-forward theatre the Constitution warns against; add it in Slice 8+ when orders exist.

---

### Decision 5 — Browse & search restraint

The Constitution: no default filter sidebar; search exists but isn't primary discovery.

**5a — Browse.** Is there a browse surface beyond the homepage? Options: (i) **category pages** — a quiet list of the ten categories, each linking to `/browse/[category]` listing that category's published works; (ii) a single **"All publications"** list with no filters; (iii) both. *Lean:* an "All publications" list + category as the *only* filter (via category pages or a quiet category nav) — browse with the eyes, category as the one concession.

**5b — Search.** Options: (i) **no search in v1** (catalog is tiny; search is premature); (ii) a **single unobtrusive search** by title/creator/category, not in the primary chrome. *Lean:* **defer search** to when the catalog is large enough to need it — or, if you want it present, one quiet field on the browse page only, never in the homepage hero. Question for you: presence or absence in v1?

---

### Decision 6 — What a work looks like *in a listing* (the discovery-feel decision)

How a publication renders as a **card in a grid/shelf** is where "gallery bookstore" vs "shop" is won or lost.

- **Card contents.** Options: (i) **cover only**, title/creator on hover; (ii) **cover + title + creator** always, quiet metadata; (iii) cover + title + creator + **price**. *Lean: **(ii)** — cover leads, title + creator in metadata beneath, **no price in the grid.*** Price belongs on the work's page, not scattered across the shelf as shop-signage. This single choice does the most to keep browse gallery-like.
- **Grid density + hover.** Subtle: no scale-up, no shadow pop, no snappy spring. A hairline or a quiet opacity shift on hover, nothing more. Generous gutters; the current 12-col grid. Question: columns at desktop (2–3 large, or 3–4 medium)? *Lean:* 3 across at desktop, large covers, generous whitespace — density that reads as "curated," not "inventory."
- **No badges.** No "new," "bestseller," "trending," "sale" chips anywhere. "New Releases" is a section heading, not a per-card badge.

---

## 6. What to send back

Priority order:

1. **Decision 0** — homepage identity (A/B/C) + publication URL shape. Everything links off these; pick first.
2. **Decision 1** — the homepage section set, density, and whether the hero is typographic or a featured work. This is the atmosphere centrepiece.
3. **Decision 6** — what a work looks like in a listing (esp. **price in the grid or not**) — the discovery-feel call.
4. **Decision 2** — the publication-page composition and, specifically, how the Slice-8 purchase boundary reads today (real strings help).
5. **Decision 3** — Editor's Picks storage (migration or not), who sets it, and whether picks carry editorial prose.
6. **Decisions 4 & 5** — omit Popular? and the browse/search minimalism (search present or deferred?).

Once settled I'll lock them as `D-022…` in `decisions.md` and build — mirroring how D-012/D-013 and D-019–D-021 were locked before their slices.
