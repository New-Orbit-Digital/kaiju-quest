// Builds the offline sandbox as ONE self-contained script (assets inlined).
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist-sandbox',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
    lib: { entry: resolve(import.meta.dirname, 'src/sandbox.js'), formats: ['iife'], name: 'KaijuSandbox', fileName: () => 'sandbox.js' },
  },
});
