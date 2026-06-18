# Slice 4 — Preview & Cover Generation — Plan

**Date:** 2026-06-06
**Builds on:** Slice 3b (preflight pipeline, live). Reframed from the original "Preview Generation + Preflight UI" since preflight UI shipped in 3b.
**Status:** ✅ **SHIPPED & VERIFIED in production** (commits `9bcb450` + `808b4ed`; decision `D-015`). Built as planned below — mupdf render, Cloudflare Images delivery, TrimBox crop, assets-table reuse (no migration), isolated failure handling, re-render-on-replace. Production-verified end-to-end (cover + previews render; re-render sweeps old images). See progress report §15.

---

## 1. Scope

Turn a **passed** PDF into the public presentation imagery the marketplace sells with:

- A **cover** rendered from **page 1**.
- **Preview pages** = cover + **first six pages**.
- Cropped to the **TrimBox** so public images show the finished page, not the 3 mm bleed.
- Delivered through **Cloudflare Images** with responsive variants.
- Surfaced on the publication detail page now; the same assets feed Slice 7 (marketplace).

This is the visual foundation for the marketplace, so it lands before Slice 7.

### Locked decisions
- Engine: **mupdf** (WASM). Delivery: **Cloudflare Images** (D-004).
- Cover from page 1; previews = cover + first 6 pages; crop to TrimBox.
- One high-res master per page uploaded to Cloudflare Images; responsive **variants** for delivery.
- Variant defaults: **cover ~1200w, grid ~600w, full ~1600w**. JPEG **quality ~80**.
- Source PDF stays **private** in `baxter-clean`.
- Preview/cover generation failure **must not block a passed publication**, but is **visible internally**.
- Creator cover override **deferred**. **No creator-facing progress UI.**

---

## 2. Spike result (engine proven)

mupdf (pure WASM, 13 MB, no native binaries) rendered cover + 6 previews in **~340 ms** (light vector A5) to **~520 ms** (heavy full-page-image PDF), peak memory **~124 MB**, valid JPEGs at expected dimensions. Comfortably inside Vercel's function limits (250 MB bundle, 1 GB memory) and an Inngest step. No alternate runtime or rendering service required. Full numbers in the session record / Slice 3b review follow-up.

---

## 3. Architecture

**Pipeline — chains off the existing preflight worker.**
On a pass, *after* promotion to `baxter-clean`, a new durable step:
1. Loads the promoted PDF bytes (from clean).
2. Renders page 1 + first 6 pages with mupdf, each cropped to its TrimBox, at high resolution (~1600w master), JPEG q≈80.
3. Uploads each rendered page as a master image to **Cloudflare Images**.
4. Writes `assets` rows and sets the publication's cover.

This reuses the durable, retryable pipeline — no new trigger or infrastructure.

**Rendering.** `apps/web/lib/pdf/render.ts` — mupdf wrapper: open bytes, for each target page render the TrimBox region to a JPEG buffer at a target width, return `{ page, jpeg, width, height }`. Pure-ish (bytes in, buffers out), unit-testable without storage.

**Delivery.** `apps/web/lib/cloudflare/images.ts` — upload a buffer to Cloudflare Images (returns the image id), and delete by id (for re-render cleanup). Public delivery URLs are built as `https://imagedelivery.net/<account_hash>/<image_id>/<variant>`; variants (`cover`/`grid`/`full`) are account-level config.

**Data — no schema migration.** Reuse the existing tables:
- `assets`: one row per rendered image — `kind` = `cover` | `preview_page`, `provider` = `cloudflare_images`, `external_id` = CF image id, `meta` = `{ page, width, height }`, `publication_id` set.
- `publications.cover_asset_id` → the cover asset.

(Avoiding a migration is deliberate — the only Slice 3b production defect was an unapplied migration.)

**Failure handling.** The render step is isolated from the pass verdict: if rendering or upload fails, the publication **stays `passed` and live**, `cover_asset_id` simply remains null, and the failed step is visible in the Inngest run history (plus `console.error`). Retryable via Inngest. No creator-facing error or progress UI — when images are ready they appear; until then, the page shows no cover quietly.

**Re-render on replace (retention parity with D-014).** When a new file passes for a publication, regenerate previews and **delete the superseded Cloudflare images + their `assets` rows**, so derived imagery tracks the active file. Idempotent (tolerate already-deleted images).

**Surface.** Publication detail page: cover gets disproportionate space; previews read as *leafing through a copy*, not a thumbnail grid (Editorial Constitution §publication pages). Building blocks shared with Slice 7.

---

## 4. Cloudflare Images — setup required (for the parallel token work)

**Enable Cloudflare Images** on the account (it's a paid add-on, billed per image stored + delivered).

**API token** — create an **account-scoped** API token with:
- **Permission:** `Account` → **Cloudflare Images** → **Edit** (read + write; needed for upload *and* delete on re-render). Read-only is insufficient.
- **Account resources:** limited to the Baxter Cloudflare account only.
- No Zone permissions required.

**Environment variables** (Vercel, Production + Preview, all server-only / Sensitive):

| Var | Purpose | Where to find it |
|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | Upload/delete API endpoint (`/accounts/{id}/images/v1`) | Cloudflare dashboard → account home (right sidebar), or the R2/Images URL. |
| `CLOUDFLARE_IMAGES_API_TOKEN` | Auth for upload/delete (the token above) | Created in My Profile → API Tokens (account-scoped, Images:Edit). |
| `CLOUDFLARE_IMAGES_ACCOUNT_HASH` | Build public delivery URLs (`imagedelivery.net/<hash>/...`) | Images dashboard → any image's "Delivery URL" (the hash segment). |

Notes:
- The account hash is public (it appears in delivery URLs); we still keep it server-side and emit finished URLs to the client, so no `NEXT_PUBLIC_` is needed.
- **Variants** (`cover` ~1200w, `grid` ~600w, `full` ~1600w) are account-level config — set them once in the Images dashboard (or I can create them via the API once the token exists). "Fit: scale-down" so we never upscale; format auto (WebP/AVIF where supported).
- The integration is **gated on these three vars + the variants**, but the render step is not — render is built and tested against mupdf first; Cloudflare wiring lands when the token is in.

---

## 5. Build sequence

1. `lib/pdf/render.ts` — mupdf render + TrimBox crop; verify against real PDFs (done in spike; port into repo). **← starting here**
2. `lib/cloudflare/images.ts` — upload/delete client (gated on token; build + unit-shape now, live-test once env is set).
3. Worker step — after promotion, render → upload → write `assets` + `cover_asset_id`; isolated failure handling.
4. Re-render/cleanup on replace.
5. Publication detail UI — cover + previews (leafing layout).
6. Production verify: clean A5 + heavy image PDF → cover and 6 previews appear, correct variants, source stays private; replace → old images cleaned; induce a render failure → publication stays passed.

---

## 6. Deferred / open

- Creator cover override (pick a page other than 1).
- Preview gating policy beyond "first 6" (e.g. per-format), if needed later.
- Marketplace presentation itself (Slice 7) — this slice only produces + surfaces the assets.
- Coordination: `mupdf` dependency add waits until the in-flight ESLint flat-config migration is committed, to avoid `package.json`/lockfile entanglement.
