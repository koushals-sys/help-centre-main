// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import fs from 'node:fs';
import path from 'node:path';

// ─── Recursive sidebar from src/content/docs ──────────────────────────────────
//
// STRUCTURE SUPPORTED:
//   src/content/docs/
//     soap/                          ← top-level category (auto-detected)
//       documentation/index.md       ← article (created via CMS)
//       charting/                    ← sub-category (auto-detected by Starlight)
//         overview/index.md
//         alerts/index.md
//     billing-videos/
//       refunds/index.md
//
// HOW RECURSION WORKS:
//   This script detects the TOP-LEVEL directories in src/content/docs and
//   creates one sidebar group per directory using Starlight's `autogenerate`.
//   Starlight's autogenerate is itself recursive — it walks ALL subfolders
//   and nested index.md files automatically, so sub-categories appear as
//   nested groups without any extra code here.
//
// ADDING A NEW CATEGORY:
//   In the CMS, type a path like  soap/documentation  in the path field.
//   Decap saves it as  src/content/docs/soap/documentation/index.md.
//   The top-level folder (soap/) is detected here and gets its own sidebar group.
//   All subfolders inside soap/ are handled recursively by Starlight.
//
// ─────────────────────────────────────────────────────────────────────────────

const docsRoot = path.resolve('./src/content/docs');
const SKIP_FILES = new Set(['index.mdx', 'index.md']);

// Override display labels for specific folder names
const labelOverrides = {
  'clinicians-module':  "Clinician's Module",
  'front-desk-module':  'Front Desk Module',
  'billing-videos':     'Billing Videos',
  'new-features':       'New Features',
  'new-updates':        'New Updates',
  'profile-management': 'Profile Management',
};

/** Convert kebab-case folder name → Title Case label */
function toTitleCase(slug) {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Read the `title` field from a markdown file's frontmatter */
function readFrontmatterTitle(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const match = content.match(/^---[\s\S]*?\ntitle:\s*(.+)/m);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, '');
  } catch {}
  return null;
}

const allEntries = fs.readdirSync(docsRoot, { withFileTypes: true });

// 1. Root-level loose .md files (not index.md) → individual links under "General"
//    These are articles saved outside any folder — shown at the top of the sidebar.
const rootPages = allEntries
  .filter(e => e.isFile() && /\.mdx?$/.test(e.name) && !SKIP_FILES.has(e.name))
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(file => {
    const slug = file.name.replace(/\.mdx?$/, '');
    const label =
      readFrontmatterTitle(path.join(docsRoot, file.name)) ?? toTitleCase(slug);
    return { label, slug };
  });

// 2. Top-level directories → one sidebar group each.
//    Starlight's autogenerate recursively walks ALL subfolders and index.md files
//    inside each directory, so nested sub-categories appear automatically.
const directoryGroups = allEntries
  .filter(e => e.isDirectory())
  .sort((a, b) => a.name.localeCompare(b.name))
  .map(dir => ({
    label: labelOverrides[dir.name] ?? toTitleCase(dir.name),
    autogenerate: { directory: dir.name },
  }));

// Combine: loose root pages first (if any), then directory groups
const sidebar = [
  ...(rootPages.length > 0
    ? [{ label: 'General', items: rootPages }]
    : []),
  ...directoryGroups,
];

// https://astro.build/config

export default defineConfig({
  site: 'https://help.spryhealth.com',
  base: '/guide',
  output: 'server',
  adapter: cloudflare(),
  vite: {
    ssr: {
      external: ['node:fs', 'node:path'],
      noExternal: ['@astrojs/starlight'],
    },
  },
  integrations: [
		starlight({
			title: 'SpryHealth Help Centre',
			logo: {
				src: './src/assets/spry-logo.webp',
				alt: 'SPRY',
				replacesTitle: true,
			},
			customCss: ['./src/styles/custom.css'],
      components: {
        Sidebar: './src/components/Sidebar.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        ThemeProvider: './src/components/ThemeProvider.astro',
      },
			lastUpdated: false,
			social: [],
			sidebar,
		}),
		react(),
  ],
});
