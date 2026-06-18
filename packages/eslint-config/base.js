import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

/**
 * Base flat config for plain (non-Next) TypeScript packages.
 *
 * Mirrors the old `next/typescript` shareable config
 * (`@typescript-eslint/recommended`) and layers on our shared
 * unused-vars convention. Consumed by `@baxter/db`, `@baxter/domain`,
 * and `@baxter/ui-tokens`.
 */
const config = [
  { ignores: ['dist/**', 'node_modules/**'] },
  ...compat.extends('next/typescript'),
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
];

export default config;
