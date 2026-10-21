import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // node:sqlite is a real builtin in the runtimes we ship on, but vite's
    // builtin list predates it and tries to resolve it as a file.
    server: { deps: { external: [/^node:sqlite$/] } },
  },
});
