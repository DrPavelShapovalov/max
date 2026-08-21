import { defineConfig } from 'vite';

export default defineConfig({
  base: './',            // относительные пути — работает и в вебе, и в Electron (file://)
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
});
