import { defineConfig } from 'vitest/config';

/**
 * Kept separate from vite.config.ts, whose `root` points at src/web for the
 * site build; tests live at the repository root.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
