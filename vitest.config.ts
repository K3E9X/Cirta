import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts, whose `root` points at src/web for the
 * site build; tests live at the repository root.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Many tests run the command line as a user does, in a child process,
    // and a dozen do so at once. Five seconds was the time one took alone;
    // under load one went over by 32 ms. A hang still fails, a minute later.
    testTimeout: 60_000,
  },
});
