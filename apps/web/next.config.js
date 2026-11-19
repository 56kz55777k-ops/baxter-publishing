const path = require('path');

/**
 * Slice D stage 8A (plan §8.2, Q5): the local application harness exists only
 * in a build made with BAXTER_E2E_HARNESS=1. Any other value — unset, '0', '' —
 * is a default build. The flag does two things, both at build time:
 *  - `pageExtensions` gains 'harness.tsx', so app/(editor)/e2e-harness/[fixture]/
 *    page.harness.tsx becomes a route. Without it Next's app-dir matcher
 *    (`(^|/)page\.(tsx|ts|jsx|js)$`) does not see that file at all: no route, no
 *    entry, nothing it imports is compiled.
 *  - `env.BAXTER_E2E_HARNESS` is inlined as '1' or '0', so harness-only code
 *    (`if (process.env.BAXTER_E2E_HARNESS === '1')`) is a constant the minifier
 *    removes from a default build.
 */
const HARNESS = process.env.BAXTER_E2E_HARNESS === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: HARNESS ? ['tsx', 'ts', 'jsx', 'js', 'harness.tsx'] : ['tsx', 'ts', 'jsx', 'js'],
  env: { BAXTER_E2E_HARNESS: HARNESS ? '1' : '0' },
  // A harness build writes to its own directory, so it can never be mistaken for, or mixed into, the
  // default build in `.next` (Next's default, unchanged).
  ...(HARNESS ? { distDir: '.next-harness' } : {}),
  // typedRoutes will be re-enabled once Slice 2 fills in the missing pages.
  typedRoutes: false,
  // npm workspaces hoists node_modules to the repo root, two levels up.
  // Pointing this at apps/web skewed file tracing for hoisted packages.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  // The Next server runtime lazily requires this source-map module; the
  // tracer can't see the dynamic require and drops it, crashing every
  // serverless function with "Cannot find module 'next/dist/compiled/source-map'".
  outputFileTracingIncludes: {
    '/**': ['../../node_modules/next/dist/compiled/source-map/**/*'],
    // The preflight worker rasterizes PDFs with mupdf (WASM). Force its files
    // — including the .wasm — into the Inngest function bundle so they exist at
    // runtime; the tracer won't follow mupdf's internal wasm load otherwise.
    '/api/inngest/**': ['../../node_modules/mupdf/**/*'],
  },
  // mupdf is WASM-backed; keep it external so webpack doesn't try to bundle the
  // .wasm and instead loads it from node_modules at runtime.
  serverExternalPackages: ['mupdf'],
  transpilePackages: ['@baxter/ui-tokens', '@baxter/domain'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
};

module.exports = nextConfig;
