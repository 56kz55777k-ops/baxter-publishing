/**
 * Vitest — unit and integration tests for @baxter/web (introduced in Native
 * Publishing Slice A; the repo's first enforced test runner).
 *
 * Environment: node by default. Files that need a DOM declare it per-file
 * with `// @vitest-environment jsdom`.
 *
 * The app tsconfig excludes `test/` from the Next build; tsconfig.test.json
 * covers the test tree for typecheck-of-tests without touching the app build.
 */
import path from 'node:path';
import ts from 'typescript';
import { defineConfig, type Plugin } from 'vitest/config';

/**
 * The app tsconfig keeps `jsx: preserve` (Next owns the app build). Vitest's
 * bundled Vite 8 transforms with OXC, which honours that per-file tsconfig —
 * leaving JSX intact and breaking import analysis for app/components sources.
 * This pre-plugin compiles our own .tsx with the typescript package (already
 * a devDependency) using the automatic JSX runtime, so tests see plain ESM.
 */
const tsxForTests: Plugin = {
  name: 'baxter:tsx-for-tests',
  enforce: 'pre',
  transform(code, id) {
    const clean = id.split('?')[0]!;
    if (!clean.endsWith('.tsx') || clean.includes('node_modules')) return null;
    const out = ts.transpileModule(code, {
      fileName: clean,
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        inlineSourceMap: true,
        inlineSources: true,
      },
    });
    return { code: out.outputText, map: null };
  },
};

export default defineConfig({
  plugins: [tsxForTests],
  resolve: {
    alias: {
      '@baxter/domain': path.resolve(import.meta.dirname, '../../packages/domain/src'),
      '@baxter/db': path.resolve(import.meta.dirname, '../../packages/db/src'),
      '@': path.resolve(import.meta.dirname, '.'),
    },
  },
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    environment: 'node',
    // The preflight verifier predates vitest and runs as a plain node script.
    exclude: ['**/node_modules/**', 'test/preflight.verify.ts'],
  },
});
