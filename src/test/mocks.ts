/**
 * Mocks have moved into `src/test/setup.ts` so Vitest's babel plugin
 * hoists the `vi.mock` calls to the top of the test pipeline.
 *
 * This file now exists as a re-export shim — test files can keep doing
 * `import './mocks'` for clarity (and grep-ability) without paying the
 * cost of duplicate registrations. The actual mock factories live in
 * setup.ts; importing this file is a no-op at runtime.
 */
export {}
