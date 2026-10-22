# Baxter — Security Operations

**Audience:** whoever is developing or operating Baxter, human or agent.
**Status:** established 2026-09-21 by the security hardening gate.
**Scope:** how credentials are stored, which environments hold what authority,
what protects the repository, and what to do when something goes wrong.

This document contains **no credential values and no account identifiers**, and
must not acquire any. It describes where things live and how they are handled;
it is not a place to record what they are. `SECURITY.md` at the repository root
is the separate public-facing vulnerability-reporting policy.

---

## 1 · Why this exists

On 2026-09-19, `git add -A` in this repository staged a Vercel recovery-code
file and two live Resend API keys into a commit destined for a **public**
repository. The commit aborted before writing, for an unrelated reason, and
nothing was pushed.

The audit that followed established, and this document preserves, the precise
conclusion:

> **No evidence was found that the identified credentials or recovery codes
> entered the Git history available to us or GitHub's current secret-scanning
> surface.**

That is the defensible claim. It is deliberately **not** the stronger claim
that no secret has ever entered Git history — exact-content blob analysis
establishes facts about the exact contents and history surfaces inspected. It
cannot prove that a credential never appeared embedded in another file, that
transformed or partial material never existed, that rewritten history elsewhere
never contained something, or that another machine or clone never did. This was
a **near-miss and a credential-storage failure, not a breach.** Do not
re-describe it as a leak or a compromise unless new evidence establishes that.

The root cause was not the near-miss itself. It was that three credential files
sat in the working tree of a public repository, protected by nothing but the
habit of not typing the wrong git command.

---

## 2 · Where credentials live

**Credentials do not live inside `~/Desktop/baxter-app`, ever.** Not ignored,
not in a subfolder, not "temporarily".

| Material | Home |
|---|---|
| API keys, tokens, account passwords, recovery codes | A password manager |
| Deployed runtime secrets | Vercel environment variables, type **Secret** |
| Local development values | `apps/web/.env.local`, git-ignored, never committed |
| E2E fixture credentials | `apps/web/.env.e2e.local`, git-ignored, never committed |
| Placeholder template | `.env.example`, committed, **values always empty** |

`.env.example` is the one environment file in git. It exists to name the
variables; every value in it stays empty. If you ever find a real value there,
that is an incident.

**`.gitignore` is defence in depth, not a credential store.** A file being
ignored says nothing about whether it is safe where it sits — it only means git
will not volunteer it. The protection that matters is that the file is not in
the repository at all.

---

## 3 · Layered protection

The model, outermost first:

1. **Credentials outside the repository.** The only layer that actually works.
2. **Targeted `.gitignore` rules** for credential-shaped filenames. Deliberately
   narrow: broad patterns like `*Documentation/` or `*.rtf` would silently hide
   legitimate Baxter material, and a rule that hides real work is worse than no
   rule.
3. **Staged-secret guard** — `scripts/check-staged-secrets.mjs`, run by
   `.githooks/pre-commit`. Inspects only staged content, matches high-confidence
   vendor token formats and credential filenames, and reports file, line and
   credential *kind* — never the value.
4. **GitHub push protection**, enabled. Blocks pushes containing supported
   provider patterns.
5. **GitHub secret scanning**, enabled. Alerts on secrets already pushed.

### Limits of the guard, stated plainly

- It can be bypassed with `git commit --no-verify`. That is deliberate — an
  unbypassable guard gets disabled instead.
- It only exists in a clone where `npm install` has run: the root `prepare`
  script points `core.hooksPath` at `.githooks`.
- It sees staged content only. It knows nothing about history.
- Push protection covers *supported provider patterns*, not everything. It has
  no pattern for recovery codes, which are not tokens. **Never treat push
  protection as the boundary.**

Regression coverage lives in `apps/web/test/security/staged-secret-guard.test.ts`
and runs with the normal suite.

---

## 4 · Environment boundaries

**Supabase.** The publishable key is designed to be shipped to browsers and is
bounded by Row Level Security. The **secret/service-role key bypasses RLS** and
must never leave server-side control — it must not appear on a developer
machine, in a client bundle, or in CI. Verified at the time of writing: no
service-role key exists in local development.

**Vercel.** Since 24 Aug 2026 a variable is **Config** (value stays readable to
members with access) or **Secret** (value is write-only after saving — it
remains available to deployments and can be replaced, but nobody can read it
back). Variables created under the now-deprecated *Enforce Sensitive
Environment Variables* team policy are treated as Secrets automatically.
Anything that can bypass database access control, move money, send production
email, modify production storage, sign privileged requests or administer an
external service is **Secret**, not Config.

Audited 2026-09-21, all 21 project variables: **every one is Secret**,
confirmed against the project API, which returns no value for any of them.
Two consequences follow, and both matter operationally:

- Public-by-design values (`NEXT_PUBLIC_*`) and plain configuration
  (`STRIPE_PLATFORM_FEE_BPS`) are Secret too. Harmless, but it means nobody
  can read back what the deployed site URL or fee basis points actually are.
- **A variable's value cannot be recovered, so changing its environment scope
  means re-entering the value from the password manager.** Any re-scoping is a
  deliberate, manual operation — plan it, don't improvise it.

**Preview deployments.** The question for each variable is not "must Preview
differ from Production?" but **"does this environment actually need this level
of authority?"** A preview that can charge a card or send mail as the
production domain is a preview with production authority.

As audited: Preview tracks *all unassigned git branches*, and **17 of the 21
variables carry the same value into Preview as into Production** — including
the Supabase service-role key, `DATABASE_URL`, the Stripe secret and webhook
secret, the Resend key, the Cloudflare Images token and the Inngest signing
key. Every branch push therefore builds a deployment holding full production
authority. Four R2 variables are Production-only, which leaves Preview unable
to use R2 at all; that inconsistency fails closed and is not a fault.

Two controls hold that risk down and must stay on: **Vercel Authentication**
is enabled for all deployments except custom domains, so preview URLs are not
publicly reachable, and **git fork protection** is on, so an outside pull
request cannot conjure a deployment carrying these credentials. Neither
control changes the underlying fact that preview builds hold production
authority; they only limit who can reach the result.

The vendor-supported remedy is the **Separate Production Secret Values** team
policy (Security & Privacy → team settings), which requires each key to use a
different value in Production than in Preview, Development and custom
environments. It is **not** enabled. Vercel's own changelog tells teams that
had the deprecated policy — which this team evidently did, given all 21
variables are Secret — to decide explicitly whether to enable it.

**Development.** No variable targets the Development environment, so
`vercel env pull` yields nothing. Local development runs on a hand-written
`apps/web/.env.local` holding the two public Supabase values and a feature
flag — no service-role key, no Stripe secret, no Resend key. That is the right
shape; keep it.

**Unnecessary authority.** `DATABASE_URL` — a direct Postgres connection
string — is deployed to Production and Preview and is read by nothing the
application runs. Its only readers are `packages/db/src/client.ts` and
`packages/db/drizzle.config.ts`, and no file under `apps/web` imports
`@baxter/db` or `drizzle-orm`. It belongs with the migration tooling, not in
the deployed runtime environment.

**Scope at the provider, not just in the vault.** Where a variable is stored
decides who can read it; what the credential is *allowed to do* decides what a
reader gains. Both are needed. For every third-party key, write down the
narrowest permission the code actually exercises and set the key to that.

Worked example — Resend, audited 2026-09-21. Baxter's entire use of Resend is
`POST https://api.resend.com/emails` from `lib/email/resend.ts`: plain-text
sends, no domain management, no audiences, no broadcasts, no webhooks. The
account's single key was **Full access, all domains**. It is now **Sending
access**, which is exactly what the code exercises. Two things make this the
right move rather than a risky one:

- Resend allows a key's **permission and domain restriction to be edited in
  place**; only the *value* is immutable after creation. Narrowing scope
  therefore needs no rotation, no environment update and no redeploy, and it
  is reversible from the same dialog.
- Narrowing is bounded by what the code calls. Verify that first. Here the
  account also showed one verified domain, no send history and a key unused
  for three months, so the blast radius was nil.

The domain restriction was deliberately **not** applied, because
`RESEND_FROM_ADDRESS` is a Secret and cannot be read back: if the deployed
from-address is not on the verified domain, restricting the key would break
sending. Confirm the address first, then restrict.

**Another project's credential is scoped, not seized.** The same in-place
narrowing is how a key belonging to a different client gets made safer without
touching its value — no rotation, no downtime, no coordination required for
the narrowing step itself. Rotation still needs that project's owner.

**CI.** GitHub Actions holds **no repository or environment secrets**. The
workflow supplies literal placeholder values and talks to no live service.
`permissions: contents: read` is declared in the workflow itself, so a later
settings change cannot silently widen it. Keep it that way: if CI ever needs a
real credential, that is a design decision, not a convenience.

---

## 5 · Verification clone rules

Executable verification runs in a clean Linux clone while implementation
happens on the developer machine. The clone exists to prove one thing:

> **the tested tree is the committed tree.**

**Transfer is git-native.** Fetch the commit; check it out; compare tree
hashes. Do not `rsync` the working repository into the verification
environment — a 2026-09-19 rsync excluded build artifacts but not dotfiles, and
silently copied `.env.local` and `.env.e2e.local` into a second location. Note
that `git clean -fd` does **not** remove ignored files; `-x` is required.

If non-git material ever genuinely must be transferred, use an explicit
allowlist of paths, never an exclusion list — an exclusion list fails open.

---

## 6 · Dependency security

- `npm audit --omit=dev` is the production-relevant view.
- Classify before acting: runtime-reachable, build-time only, dead/unimported,
  transitive. **"The version is affected" is not the same as "Baxter is
  exploitable through this path,"** and the difference decides priority.
- Never `npm audit fix --force`. Never upgrade broadly to reduce an advisory
  count.
- A fix that requires a major version bump of a framework is a **material
  engineering decision**, not routine maintenance. Report it.
- Dependabot alerts and security updates are enabled; treat its pull requests
  as proposals to assess, not to merge on sight.
- **Dependabot scans the default branch.** Its alert count will not match a
  local `npm audit` run on a working branch, and the gap is not a discrepancy
  to explain away — it is the upgrade not being on `main` yet. Compare like
  with like before drawing a conclusion from either number.
- **Third-party GitHub Actions are pinned to full-length commit SHAs**, with
  the human-readable version in a trailing comment. A tag is a movable
  pointer: whoever can move `v4` changes what runs in CI with our
  `GITHUB_TOKEN`. A SHA cannot be moved. There is no `dependabot.yml` for
  the `github-actions` ecosystem, so nothing bumps the pins automatically:
  re-pin by hand, resolving the SHA from the upstream tag
  (`git ls-remote --tags`), never from a search result. Since 2026-10-06
  both actions are on Node-24-runtime majors (checkout v7.0.1, setup-node
  v6.5.0).
- The repository's Actions policy is still **Allow all actions and reusable
  workflows**, and *Require actions to be pinned to a full-length commit SHA*
  is off. Turning that requirement on is only safe once every workflow is
  pinned — otherwise CI breaks on the next run. The workflow is pinned; the
  policy switch is the follow-up.

---

## 7 · If a credential is exposed

Order matters. **Rotate first, scrub second.**

1. **Revoke or rotate at the provider.** Once a secret reaches a public
   repository, assume it is compromised. History rewriting alone never makes it
   safe: forks, clones and caches persist.
2. **Rotate anything that credential could reach.** A mail key that can send as
   the domain can be used for phishing; a storage key can reach objects.
3. **Then** rewrite history if it is genuinely in history (`git filter-repo`),
   and force-push.
4. Ask GitHub Support to purge cached views.
5. Confirm the secret-scanning alert closes.
6. Write down what happened and what changed, in language that matches the
   evidence.

**Another client's credential is not ours to rotate.** If material belonging to
a different project turns up in Baxter's environment, remove it from Baxter,
secure it, and treat rotation as a **coordinated operational action** with that
project's owner. Continuity of their live system is a hard requirement.

**Unreachable local git objects** created by an accidental `git add` are local
and unpushable. Do not perform destructive history surgery to remove them —
normal garbage collection will. Destroying forensic evidence immediately buys
nothing.

---

## 8 · The E2E fixture, and its blast radius

Stated precisely, because "it runs against production" is too vague to act on.

The smoke (`apps/web/test/e2e/editor-smoke.spec.ts`) signs in through the real
`/sign-in` form with `E2E_EMAIL` / `E2E_PASSWORD` — **a real account password,
kept in `apps/web/.env.e2e.local`, gitignored**. As of Slice B it runs against
a **production build** served by `next start` on `localhost:3007` (Playwright
reuses an already-running server there), not against the deployed site; but
local configuration points at the **production Supabase project**, so the
reads and writes are production reads and writes.

What it changes, exactly (Slice C smoke and acceptance, revised 2026-10-04 —
measured on the wire, every `PUT /api/editor/*` counted): real pointer and
keyboard gestures on the editor for the publication named by
`E2E_PUBLICATION_ID`, each settling through the ordinary autosave
`PUT /api/editor/[id]` — a conditional update of one `editor_documents` row,
bumping its revision. The route deletes nothing outside that document, touches
no other publication, and cannot reach payments, email, storage or image
delivery — `.env.local` holds none of those credentials, so any code path
needing them fails rather than acts. It refuses anything but the signed-in
owner's own draft (401 / 404 / 423), with RLS enforcing the same boundary.

| Run (per browser) | Where in the fixture | Autosave PUTs | Residue |
|---|---|---|---|
| Smoke (`editor-smoke.spec.ts`, committed) | first spread | **5** | **none** — deletes what it created; asserts the spread's count is back to its starting value after a reload |
| Behavioural acceptance (one-off, not committed) | back cover — must be empty at the start | **15** | **none** — deletes everything on the unit it proved empty; asserts empty after a reload |

Slice C made both runs self-cleaning (decision C-8), so the blast radius is
**writes without residue: 20 PUTs per browser, 60 for the three-browser gate
(Chromium, WebKit, Firefox)** — all to one row. The smoke identifies its own
objects by identity (position + inspector values) and never deletes "everything
on the spread"; if it fails mid-run it still removes its own objects, each only
after the inspector confirms it. The objects earlier slices' runs left behind
(Slice A/B: 22 on the front cover, 4 on the first spread) were removed on
2026-10-06 on Ben's explicit go — backed up first (the document as served at
revision 239, checksummed), deleted through the editor in one autosave write,
and verified empty after reload; the fixture is now clean. The real exposure is
still not the writes; it is that **a production account password sits in a
file on the developer machine** so a test can type it.

**Running it without copying credentials.** Where the smoke runs somewhere
other than the working checkout (e.g. a clean verification clone), load
`.env.local` and `.env.e2e.local` into the test process's environment from
where they live (`set -a; . <path>; set +a`) — never copy the files into a
second location (§ 5), and never print them.

**Deferred: move automated E2E testing off production.** It should run against
an isolated E2E Supabase project with disposable fixture data and
appropriately scoped credentials. Until then, do **not** put the fixture
password into GitHub Actions secrets to obtain a green Playwright badge — that
trades a local file for a credential in CI, which is worse.

---

## 9 · Known deferred work

- **Separate Production Secret Values** (Vercel team policy) — not enabled;
  the decision Vercel asks teams with the deprecated policy to make. See § 4.
- **`DATABASE_URL` in Preview and Production** — a direct Postgres connection
  string no runtime code reads. See § 4.
- **`Require actions to be pinned to a full-length commit SHA`** — enable once
  the pinned workflow is on `main`. See § 6.
- **Actions policy** is `Allow all actions and reusable workflows`; narrowing
  it to GitHub-authored plus verified-creator actions is worth assessing
  against what CodeQL default setup and Dependabot need.
- **Fork PR workflow approval** is `first-time contributors`; on a public
  repository, `all external contributors` is the stricter setting.
- ~~**Node version divergence**~~ — **closed 2026-10-06**: CI runs on Node 24,
  matching the Vercel project's Node.js 24.x setting.
- **`npm install --legacy-peer-deps`** is Vercel's install command, so the
  deployed tree is not built by `npm ci` from the lockfile and peer conflicts
  are ignored. Moving the deployment to `npm ci` would make the deployed
  dependency tree the committed one.
- **Next.js** carries one remaining moderate advisory whose only fix is a
  major-version upgrade. Tracked as a decision, not a patch.
- ~~**`drizzle-orm`** in the web app~~ — **closed 2026-10-06**: `@baxter/db`,
  `drizzle-orm` and `postgres` are removed from `apps/web` (manifest,
  `transpilePackages`, tsconfig paths); `packages/db` keeps the schema and
  migration tooling on drizzle-orm 0.45.3. No deployed code reads
  `DATABASE_URL` now — deleting it from Vercel Preview and Production is
  Ben's action (the entry above).
- **OpenTelemetry advisories** (`@opentelemetry/sdk-node`, `propagator-jaeger`,
  `core` and ~30 instrumentation/exporter packages) arrive through `inngest`,
  but only `inngest/experimental` (the extended-traces middleware) imports
  them; Baxter imports `inngest` and `inngest/next` only. An in-range update
  exists; it is not taken because it would be a broad update of unreachable
  code to lower a count (§ 6). Dismissing the alerts as "vulnerable code not
  used" is Ben's call.
- **Disabling the unused Next.js image optimiser** (`images: { unoptimized: true }`).
  Optional, and explicitly *not* a patch — 15.5.25 already contains the
  relevant Image Optimization fixes, and changing it changes production image
  behaviour. It is recorded because the surface is pure overhead here:
  `images.remotePatterns` keeps `/_next/image` enabled and publicly reachable;
  `middleware.ts` excludes `_next/image` from its matcher, so requests to it
  bypass that layer entirely; the codebase renders **zero** `<Image>`
  components and says so in a comment (Cloudflare Images variants arrive
  already CDN-optimised); and the endpoint is backed by `sharp`, present only
  as a transitive dependency of `next`, which carries its own open advisories
  in the native image libraries it wraps (libvips per `npm audit`, libheif per
  Dependabot). Turning the optimiser off retires all of that at once. Assess
  it on its merits, not as an incident response.
- **Resend domain restriction** on the Baxter key, once the deployed
  `RESEND_FROM_ADDRESS` is confirmed to be on the verified domain. See § 4.
