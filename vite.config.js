import { defineConfig } from 'vite';

export default defineConfig({
  // Rutas relativas: la app funciona servida desde cualquier subcarpeta (p. ej. GitHub Pages)
  base: './',
  build: {
    // three.js ocupa ~600 kB sin comprimir; es esperado
    chunkSizeWarningLimit: 1200,
  },
});
