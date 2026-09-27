import { defineConfig } from 'vite';
import { resolve } from 'node:path';
export default defineConfig({
  base: './',
  server: { fs: { allow: ['..'] }, port: 5173, host: true },
  build: { rollupOptions: { input: { main: resolve(import.meta.dirname, 'index.html') } } },
});
