/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // typedRoutes will be re-enabled once Slice 2 fills in the missing pages.
  typedRoutes: false,
  outputFileTracingRoot: __dirname,
  transpilePackages: ['@baxter/ui-tokens', '@baxter/domain', '@baxter/db'],
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'imagedelivery.net' },
      { protocol: 'https', hostname: '**.r2.cloudflarestorage.com' },
    ],
  },
};

module.exports = nextConfig;
