import { defineConfig } from 'vite';

// Custom plugin to enforce SSR noExternal configuration
const forceStarlightBundling = () => ({
  name: 'force-starlight-bundling',
  enforce: 'pre',
  config(config, { command }) {
    if (command === 'build') {
      // Merge our SSR config with any existing config
      config.ssr = {
        ...config.ssr,
        external: config.ssr?.external || ['node:fs', 'node:path'],
        noExternal: [
          ...(config.ssr?.noExternal || []),
          '@astrojs/starlight',
        ],
      };
    }
    return config;
  },
});

export default defineConfig({
  plugins: [forceStarlightBundling()],
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
