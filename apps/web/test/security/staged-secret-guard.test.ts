/**
 * Staged-secret guard — regression coverage.
 *
 * This guard exists because of a real near-miss: `git add -A` staged a
 * recovery-code file and two live API keys into a commit destined for a public
 * repository. The tests below run the guard's real patterns against realistic
 * inputs, so a future "tidy up the regexes" pass cannot quietly stop it
 * catching the thing it was written for.
 *
 * Every fixture value here is FABRICATED to match a format. None is a real
 * credential, and none should ever be replaced with one.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const GUARD = path.join(__dirname, '../../../../scripts/check-staged-secrets.mjs');
const source = readFileSync(GUARD, 'utf8');

/** Pull the live regexes out of the guard so the tests exercise the real ones. */
function patternsFrom(block: 'CONTENT_PATTERNS' | 'PATH_PATTERNS'): { name: string; re: RegExp }[] {
  const start = source.indexOf(`const ${block} = [`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf('];', start);
  const body = source.slice(start, end);
  const out: { name: string; re: RegExp }[] = [];
  for (const m of body.matchAll(/\{\s*name:\s*'([^']+)',\s*re:\s*(\/.*?\/[gimsuy]*)\s*\}/g)) {
    const [, name, literal] = m;
    const lastSlash = literal!.lastIndexOf('/');
    out.push({ name: name!, re: new RegExp(literal!.slice(1, lastSlash), literal!.slice(lastSlash + 1)) });
  }
  expect(out.length).toBeGreaterThan(0);
  return out;
}

const contentPatterns = patternsFrom('CONTENT_PATTERNS');
const pathPatterns = patternsFrom('PATH_PATTERNS');

const matchesContent = (s: string) => contentPatterns.some((p) => p.re.test(s));
const matchesPath = (s: string) => pathPatterns.some((p) => p.re.test(s));

/**
 * Fixtures are ASSEMBLED AT RUNTIME from fragments, so no literal credential
 * pattern ever exists in this file's bytes.
 *
 * The obvious alternative — writing the fixtures out in full and adding this
 * path to the guard's allowlist — was rejected: an allowlisted file is a hole
 * a real secret could later hide in, and the guard blocking its own test file
 * on every edit is exactly the friction that gets guards disabled with
 * --no-verify. Concatenation keeps both the guard and the test honest.
 *
 * None of these is a real credential. None should ever be replaced with one.
 */
const A16 = 'AAAABBBBCCCCDDDD';
const fixture = {
  resend: ['re', '_', A16 + 'EEEEFFFFGGGG1234'].join(''),
  supabaseSecret: ['sb', '_secret_', A16 + 'EEEE'].join(''),
  stripeLive: ['sk', '_live_', A16 + 'EEEEFFFF'].join(''),
  stripeRestricted: ['rk', '_test_', A16 + 'EEEEFFFF'].join(''),
  githubPat: ['gh', 'p_', A16 + 'EEEEFFFFGGGGHHHHIIII'].join(''),
  awsKeyId: ['AKI', 'A' + A16.slice(0, 16)].join(''),
  privateKey: ['-----BEGIN ', 'RSA ', 'PRIVATE KEY', '-----'].join(''),
  jwt: ['eyJ', 'hbGciOiJIUzI1NiIs', '.', 'eyJzdWIiOiIxMjM0NTY3', '.', 'dBjftJeZ4CVPmB92K27u'].join(''),
};

describe('content patterns catch the credential formats Baxter actually uses', () => {
  it.each([
    ['Resend', `RESEND_API_KEY=${fixture.resend}`],
    ['Supabase secret', `SUPABASE_SECRET=${fixture.supabaseSecret}`],
    ['Stripe live secret', `STRIPE_SECRET_KEY=${fixture.stripeLive}`],
    ['Stripe restricted', fixture.stripeRestricted],
    ['GitHub PAT', `token: ${fixture.githubPat}`],
    ['AWS key id', `AWS_ACCESS_KEY_ID=${fixture.awsKeyId}`],
    ['private key block', fixture.privateKey],
    ['JWT', fixture.jwt],
  ])('flags a %s credential', (_label, line) => {
    expect(matchesContent(line)).toBe(true);
  });
});

describe('content patterns do not fire on ordinary Baxter source', () => {
  it.each([
    ['a publishable Supabase key, which is public by design', 'sb_publishable_abcdefghijklmnop'],
    ['the placeholder CI value', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: sb_publishable_placeholder'],
    ['an ordinary import', "import { re } from './regex';"],
    ['prose mentioning a key', 'The Resend API key lives in the password manager.'],
    ['an empty env template line', 'RESEND_API_KEY='],
    ['a long base64-ish asset hash', 'sha384-oqVuAfXRKap7fdgcCY5uykM6+R9GqQ8K'],
    ['a uuid', 'id: 3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
  ])('ignores %s', (_label, line) => {
    expect(matchesContent(line)).toBe(false);
  });
});

describe('filename patterns catch material that should never be committed', () => {
  it.each([
    'Vercel Documentation/recovery-codes.txt',
    'my-recovery-codes.txt',
    'notes/Recovery Codes.md',
    'apps/web/.env.local',
    'apps/web/.env.e2e.local',
    '.env',
    '.env.production',
    'config/credentials.json',
    'secrets.yaml',
    'certs/server.pem',
    'certs/private.key',
    '.ssh/id_rsa',
  ])('flags %s', (p) => {
    expect(matchesPath(p)).toBe(true);
  });
});

describe('filename patterns leave legitimate Baxter paths alone', () => {
  it.each([
    '.env.example',
    'apps/web/app/(auth)/actions.ts',
    'packages/domain/src/editor/elements.ts',
    'docs/security-operations.md',
    'SECURITY.md',
    'brand/baxter-wordmark-reversed.png',
    'baxter-slice6-smoke-test.md',
    'native-publishing-slice-b-plan.md',
    'apps/web/test/security/staged-secret-guard.test.ts',
  ])('ignores %s', (p) => {
    // `.env.example` matches the env-file pattern by shape; the guard allows it
    // explicitly via ALLOWED_PATHS, which is asserted separately below.
    if (p === '.env.example') return;
    expect(matchesPath(p)).toBe(false);
  });

  it('allows .env.example explicitly, because it is the placeholder template', () => {
    expect(source).toContain("ALLOWED_PATHS = new Set(['.env.example'])");
    expect(matchesPath('.env.example')).toBe(true); // matches by shape…
  });
});

describe('the guard never prints a matched value', () => {
  it('reports only file, line and credential kind', () => {
    // The reporting line interpolates the kind and the location — never the
    // match. If someone adds the matched text here, this test should fail.
    expect(source).toContain('${f.kind.padEnd(32)} ${where}');
    expect(source).not.toMatch(/console\.(error|log)\([^)]*\bmatch\b/);
  });
});

describe('the guard states its own limits', () => {
  it('documents that it is bypassable and is one layer, not a boundary', () => {
    expect(source).toContain('--no-verify');
    expect(source).toContain('npm install');
    expect(source.toLowerCase()).toContain('not a substitute');
  });
});
