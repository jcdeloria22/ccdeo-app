import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * One runner for both halves of the app.
 *
 * The backend specs need Node and a real database; the frontend specs need a
 * DOM. Rather than two configs and two commands — where the second is the one
 * that quietly stops being run — the include list covers both and
 * `environmentMatchGlobs` gives the web files jsdom.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ['test/**/*.spec.ts', 'web/src/**/*.test.{ts,tsx}'],
    globalSetup: ['test/global-setup.ts'],
    setupFiles: ['test/setup-env.ts', 'web/src/setup-dom.ts'],
    environment: 'node',
    environmentMatchGlobs: [['web/src/**', 'jsdom']],
    testTimeout: 70_000,
    /**
     * Database specs share one database, so they must not run concurrently:
     * one file truncating or deleting rows another file owns produces failures
     * that look like real bugs and are not reproducible in isolation.
     */
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
