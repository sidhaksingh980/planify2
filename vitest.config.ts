import { defineConfig } from 'vite';

/**
 * Test config. Kept separate from vite.config.ts so the PWA plugin and the dev
 * proxy never load during a test run.
 *
 * Pure logic (dates, recurrence, the NLP parser) runs in Node; anything that
 * mounts a component runs in jsdom against a fake IndexedDB.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // Per-file environments come from a `@vitest-environment` docblock;
    // environmentMatchGlobs was removed in Vitest 3.
    setupFiles: ['src/test/setup.ts'],
    globals: false,
    restoreMocks: true,
    // Mounting the full app and walking onboarding is genuinely slow in jsdom.
    testTimeout: 25000,
    hookTimeout: 25000,
  },
});
