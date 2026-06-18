const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
  transpilePackages: ['@baxter/ui-tokens', '@baxter/domain', '@baxter/db'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
};

module.exports = nextConfig;
