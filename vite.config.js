import { defineConfig } from 'vite';

export default defineConfig({
  ssr: {
    external: ['node:fs', 'node:path'],
    noExternal: ['@astrojs/starlight'],
  },
  build: {
    rollupOptions: {
      external: [],
    },
  },
});
