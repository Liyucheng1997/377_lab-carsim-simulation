import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  server: { port: 5377, open: false },
  build: { chunkSizeWarningLimit: 1000 },
  test: { environment: 'node' },
} as any);
