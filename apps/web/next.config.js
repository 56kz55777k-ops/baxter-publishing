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
  },
  transpilePackages: ['@baxter/ui-tokens', '@baxter/domain', '@baxter/db'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
};

module.exports = nextConfig;
