import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./test/setup.ts'],
    // Raised from the 5s default and made single-threaded: on a slow/high-latency
    // connection to the Supabase DB, running 20 test files in parallel (each with
    // its own connection pool) causes real queries to queue past 5s even though
    // nothing is actually broken. This is a local/CI environment tuning knob, not
    // a product change.
    testTimeout: 20000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
