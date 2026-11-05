import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)), 'server-only': fileURLToPath(new URL('./tests/money/server-only.ts', import.meta.url)) } },
  test: { environment: 'node', include: ['tests/money/**/*.test.ts'], clearMocks: true, restoreMocks: true, setupFiles: ['./tests/money/setup.ts'] },
});
