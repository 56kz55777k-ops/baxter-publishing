import nextConfig from '@baxter/eslint-config/next';

const config = [
  // Build output and generated/CommonJS config files that `next lint`
  // excluded by default and that we don't want to lint with the TS rules.
  {
    ignores: ['.next/**', 'next-env.d.ts', 'next.config.js'],
  },
  ...nextConfig,
];

export default config;
