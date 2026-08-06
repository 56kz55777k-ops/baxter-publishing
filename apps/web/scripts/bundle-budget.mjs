/**
 * Bundle budget (Native Publishing, Slice A) — zero-dependency guard over
 * two invariants:
 *
 *   1. The shared First-Load JS (chunks every route pays for) must not grow
 *      more than ALLOWED_GROWTH_BYTES over the recorded pre-editor baseline.
 *   2. Konva (and the editor island generally) must live ONLY in chunks
 *      loaded by the editor route — never in shared/root chunks, never in
 *      any other route's chunk set.
 *
 * Methodology: byte sizes of the emitted files named by Next's own
 * manifests (`build-manifest.json` rootMainFiles = the app-router shared
 * baseline; `app-build-manifest.json` pages = per-route chunk lists),
 * summed uncompressed on disk — the same inputs `next build`'s route table
 * prints. The baseline in budget.json was captured from the pre-Slice-A
 * build (see `capturedFrom`). Missing or unparseable manifest data is a
 * loud FAILURE, never treated as zero.
 *
 * Run after `next build`:  npm run budget  (CI runs it on every PR).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const APP_DIR = path.resolve(import.meta.dirname, '..');
const NEXT_DIR = path.join(APP_DIR, '.next');
const BUDGET_FILE = path.join(APP_DIR, 'scripts', 'budget.json');
const ALLOWED_GROWTH_BYTES = 1024;

function fail(message) {
  console.error(`\nBUNDLE BUDGET FAIL: ${message}\n`);
  process.exit(1);
}

function loadJson(file, label) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    fail(`${label} is missing at ${file} — run \`next build\` first.`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    fail(`${label} at ${file} is not valid JSON.`);
  }
}

function fileBytes(rel) {
  const file = path.join(NEXT_DIR, rel);
  try {
    return statSync(file).size;
  } catch {
    fail(`manifest names ${rel} but the file does not exist — stale or partial build.`);
  }
}

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

// --- 1. shared First-Load baseline ------------------------------------------
const buildManifest = loadJson(path.join(NEXT_DIR, 'build-manifest.json'), 'build-manifest.json');
const rootMainFiles = buildManifest.rootMainFiles;
if (!Array.isArray(rootMainFiles) || rootMainFiles.length === 0) {
  fail('build-manifest.json has no rootMainFiles — cannot determine the shared baseline.');
}
const sharedJs = rootMainFiles.filter((f) => f.endsWith('.js'));
const sharedBytes = sharedJs.reduce((sum, f) => sum + fileBytes(f), 0);

const budget = loadJson(BUDGET_FILE, 'scripts/budget.json');
if (typeof budget.baselineSharedBytes !== 'number' || budget.baselineSharedBytes <= 0) {
  fail('budget.json has no numeric baselineSharedBytes.');
}

// --- 2. editor chunk isolation ----------------------------------------------
const appManifest = loadJson(path.join(NEXT_DIR, 'app-build-manifest.json'), 'app-build-manifest.json');
const pages = appManifest.pages;
if (!pages || typeof pages !== 'object' || Object.keys(pages).length === 0) {
  fail('app-build-manifest.json has no pages.');
}

const editorKeys = Object.keys(pages).filter((k) => k.includes('/studio/editor/'));
if (editorKeys.length === 0) {
  fail('no /studio/editor route in the app manifest — the editor page vanished from the build.');
}
const otherKeys = Object.keys(pages).filter((k) => !k.includes('/studio/editor/'));

const editorChunks = new Set(editorKeys.flatMap((k) => pages[k]).filter((f) => f.endsWith('.js')));
const nonEditorChunks = new Set(otherKeys.flatMap((k) => pages[k]).filter((f) => f.endsWith('.js')));
const editorOnly = [...editorChunks].filter((f) => !nonEditorChunks.has(f) && !sharedJs.includes(f));

// The static (server-rendered) page chunk is small; Konva lives in the
// dynamically imported island chunk, which the manifests do not attribute to
// a route. Sweep every emitted chunk instead: Konva must appear ONLY in
// chunks that are neither shared nor attributed to a non-editor route.
const konvaLeaks = [];
let konvaSeen = false;
const chunkDir = path.join(NEXT_DIR, 'static', 'chunks');
function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}
for (const file of walk(chunkDir)) {
  const rel = path.relative(NEXT_DIR, file);
  const content = readFileSync(file, 'utf8');
  if (!content.includes('Konva')) continue; // the library's global name survives minification
  konvaSeen = true;
  if (sharedJs.includes(rel) || nonEditorChunks.has(rel)) konvaLeaks.push(rel);
}
if (!konvaSeen) {
  fail('Konva was not found in any emitted chunk — the island is missing from the build.');
}
if (konvaLeaks.length > 0) {
  fail(`Konva leaked into shared/non-editor chunks:\n  ${konvaLeaks.join('\n  ')}`);
}

// --- report -----------------------------------------------------------------
console.log('bundle budget — shared First-Load JS');
for (const f of sharedJs) console.log(`  ${kb(fileBytes(f)).padStart(9)}  ${f}`);
console.log(`  total   ${kb(sharedBytes)}  (baseline ${kb(budget.baselineSharedBytes)}, +${sharedBytes - budget.baselineSharedBytes} B, allowed +${ALLOWED_GROWTH_BYTES} B)`);
console.log(`editor route chunks not shared with any other route: ${editorOnly.length}`);
console.log('konva containment: editor-only ✓');

if (sharedBytes > budget.baselineSharedBytes + ALLOWED_GROWTH_BYTES) {
  fail(
    `shared First-Load JS grew ${sharedBytes - budget.baselineSharedBytes} bytes over baseline ` +
      `(${kb(sharedBytes)} vs ${kb(budget.baselineSharedBytes)}, allowed +${ALLOWED_GROWTH_BYTES} B).`
  );
}

console.log('\nbundle budget: PASS\n');
