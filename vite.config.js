import { defineConfig } from 'vite';

// Base relativa: el sitio funciona en GitHub Pages (subcarpeta) y en local.
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2020' },
});
