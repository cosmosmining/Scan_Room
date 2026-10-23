import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Unit tests target the pure systems (layout, pricing, handoff, config) — no
// React/Three, so the node environment is enough. This is the loop's "test"
// phase: fast, deterministic feedback the autonomous mode can gate on.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@mozu/scan-sdk': fileURLToPath(
        new URL('./packages/scan-sdk/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
