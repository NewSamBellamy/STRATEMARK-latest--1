/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath, URL } from 'node:url';

// SINGLEFILE=1 inlines all JS/CSS into one index.html — used to publish a
// self-contained public demo (works with the user's own key, client-side).
const singleFile = process.env.SINGLEFILE === '1';

// Relative asset base under Electron/file:// or singlefile; root '/' for web deployments and deep routing.
const isElectron = process.env.ELECTRON === '1';
const base = isElectron || singleFile ? './' : '/';

export default defineConfig({
  plugins: [react(), ...(singleFile ? [viteSingleFile()] : [])],
  base,
  // Visible build stamp: browsers cache the published single-file HTML hard,
  // and a stale build looks exactly like "you broke my features". The stamp in
  // the sidebar makes "which build am I on?" answerable in one glance.
  define: {
    __BUILD_AT__: JSON.stringify(new Date().toISOString()),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    allowedHosts: true,
    // Allow importing the workspace packages' TS source from the monorepo root.
    fs: { allow: ['../..'] },
  },
  // Workspace packages export raw .ts; let Vite transform them instead of pre-bundling.
  optimizeDeps: { exclude: ['@mi/contracts', '@mi/mocks', '@mi/research'] },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.{test,spec}.{ts,tsx}',
        'src/test/**',
        'src/main.tsx',
        'src/**/*.stories.tsx',
      ],
    },
  },
});
