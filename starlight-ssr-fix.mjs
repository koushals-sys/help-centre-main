/**
 * Astro integration to fix Starlight virtual module resolution in SSR mode.
 * This ensures @astrojs/starlight is bundled instead of externalized,
 * which is required for virtual modules to work in Cloudflare Workers.
 */
export default function starlightSSRFix() {
  return {
    name: 'starlight-ssr-fix',
    hooks: {
      'astro:config:setup': ({ updateConfig }) => {
        updateConfig({
          vite: {
            ssr: {
              noExternal: ['@astrojs/starlight'],
              external: ['node:fs', 'node:path'],
            },
          },
        });
      },
    },
  };
}
