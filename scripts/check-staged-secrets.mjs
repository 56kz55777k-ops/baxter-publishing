#!/usr/bin/env node
/**
 * Staged-secret guard.
 *
 * Runs from .githooks/pre-commit and inspects ONLY what is staged. It exists
 * because of a real near-miss: `git add -A` staged a Vercel recovery-code file
 * and two live Resend API keys into a commit destined for a public repository.
 * `.gitignore` did not stop it, because none of those paths was ignored — they
 * were untracked merely because nobody had added them.
 *
 * Design rules, learned from guards people end up disabling:
 *
 * 1. HIGH CONFIDENCE ONLY. Every pattern below is either a vendor token format
 *    with a distinctive prefix, or a filename that has no legitimate reason to
 *    be committed. No entropy heuristics, no "looks like a password" guessing.
 *    A guard that cries wolf is a guard that gets bypassed with --no-verify.
 * 2. NO DEPENDENCIES. Plain Node against `git diff --cached`. Nothing to
 *    install, nothing to keep patched, nothing to supply-chain us.
 * 3. NEVER PRINT THE MATCH. The report names the file, the line number and the
 *    kind of credential. It never echoes the value — a guard that prints
 *    secrets into terminal scrollback and CI logs has moved the leak, not
 *    stopped it.
 *
 * LIMITS — stated plainly, because this is one layer and not a boundary:
 * - It can be bypassed with `git commit --no-verify`, deliberately.
 * - It only exists in a clone where `npm install` has run (the root `prepare`
 *   script points core.hooksPath at .githooks).
 * - It sees staged content only: it cannot judge what is already in history,
 *   and it is not a substitute for GitHub push protection or secret scanning.
 *
 * The real control is that credentials live outside the repository.
 */
import { execFileSync } from 'node:child_process';

/** Vendor token formats with distinctive, low-false-positive prefixes. */
const CONTENT_PATTERNS = [
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Supabase secret key', re: /\bsb_secret_[A-Za-z0-9_-]{16,}\b/ },
  { name: 'Stripe secret/restricted key', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/ },
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Cloudflare API token', re: /\bCLOUDFLARE_[A-Z_]*TOKEN\s*=\s*['"]?[A-Za-z0-9_-]{30,}/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'Supabase service-role JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

/**
 * Filenames that should never be committed. `.env.example` is explicitly
 * allowed — it is the documented, placeholder-only template.
 */
const PATH_PATTERNS = [
  { name: 'recovery codes', re: /recovery[-_ ]?codes?/i },
  { name: 'environment file with real values', re: /(^|\/)\.env(\.[A-Za-z0-9_-]+)*$/ },
  { name: 'credential file', re: /(^|\/)(credentials?|secrets?)\.[A-Za-z0-9]+$/i },
  { name: 'private key file', re: /\.(pem|key|p12|pfx)$/i },
  { name: 'SSH private key', re: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/ },
];

const ALLOWED_PATHS = new Set(['.env.example']);

function staged() {
  const out = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], {
    encoding: 'utf8',
  });
  return out.split('\n').filter(Boolean);
}

function stagedContent(path) {
  try {
    return execFileSync('git', ['show', `:${path}`], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  } catch {
    return null; // binary, deleted, or unreadable — nothing to scan
  }
}

const findings = [];

for (const path of staged()) {
  if (ALLOWED_PATHS.has(path)) continue;

  for (const p of PATH_PATTERNS) {
    if (p.re.test(path)) findings.push({ path, line: null, kind: p.name, how: 'filename' });
  }

  const content = stagedContent(path);
  if (content === null || content.includes('\u0000')) continue; // binary

  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    for (const p of CONTENT_PATTERNS) {
      if (p.re.test(lines[i])) {
        findings.push({ path, line: i + 1, kind: p.name, how: 'content' });
      }
    }
  }
}

if (findings.length === 0) process.exit(0);

// Deliberately reports WHERE and WHAT KIND. Never the value.
console.error('\n  Commit blocked: staged changes look like credential material.\n');
for (const f of findings) {
  const where = f.line === null ? f.path : `${f.path}:${f.line}`;
  console.error(`    ${f.kind.padEnd(32)} ${where}   (matched by ${f.how})`);
}
console.error(`
  Credentials belong outside this repository — see SECURITY.md.

  If this is a false positive, unstage the file, or commit with
  --no-verify and say why in the commit message so the next reader
  knows it was a considered decision rather than an accident.
`);
process.exit(1);
