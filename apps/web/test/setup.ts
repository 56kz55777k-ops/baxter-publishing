/**
 * Shared vitest setup. React 19's `act` requires the environment to declare
 * itself act-capable; jsdom suites render with createRoot + act directly
 * (no testing-library), so the flag is set here for every environment that
 * has a window.
 */
if (typeof window !== 'undefined') {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
}
