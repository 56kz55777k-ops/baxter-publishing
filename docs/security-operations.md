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

**Vercel.** Values are **Config** (readable after save) or **Secret**
(write-only after save, redacted from build logs at 32+ characters). Anything
that can bypass database access control, move money, send production email,
modify production storage, sign privileged requests or administer an external
service is **Secret**, not Config.

**Preview deployments.** The question for each variable is not "must Preview
differ from Production?" but **"does this environment actually need this level
of authority?"** A preview that can charge a card or send mail as the
production domain is a preview with production authority.

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

## 8 · Known deferred work

- **Move automated E2E testing off production.** The current fixture
  authenticates as a real account against the production Supabase project, owns
  a real draft publication, and writes to it during the smoke test. It should
  move to an isolated E2E project with disposable fixture data and
  appropriately scoped credentials. Until then, do **not** put the fixture
  password into GitHub Actions secrets to obtain a green Playwright badge.
- **Next.js** carries one remaining moderate advisory whose only fix is a
  major-version upgrade. Tracked as a decision, not a patch.
- **`drizzle-orm`** carries a high advisory but is unimported dead code;
  removing the dependency is preferable to upgrading it.
