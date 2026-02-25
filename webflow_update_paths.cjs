// webflow_update_paths.cjs
// Updates Webflow CMS items by slug with path and subpath derived from sourcefile.

const API_BASE = 'https://api.webflow.com/v2';
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const ARTICLES_COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;

function requireEnv(value, name) {
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN')}`,
      'accept-version': '2.0.0',
      'content-type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webflow API error ${response.status}: ${text}`);
  }

  return response.json();
}

async function getAllItems() {
  const collectionId = requireEnv(
    ARTICLES_COLLECTION_ID,
    'WEBFLOW_ARTICLES_COLLECTION_ID'
  );
  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await fetchJson(
      `${API_BASE}/collections/${collectionId}/items?limit=${limit}&offset=${offset}`
    );
    const items = data?.items || data?.collectionItems || [];
    allItems.push(...items);

    if (items.length < limit) {
      break;
    }
    offset += limit;
  }

  return allItems;
}

function deriveSegmentsFromSourceFile(sourceFile) {
  if (!sourceFile || typeof sourceFile !== 'string') return { path: '', subpath: '' };
  if (!sourceFile.includes('/')) return { path: '', subpath: '' };
  const parts = sourceFile.split('/').filter(Boolean);

  // Expected shapes:
  // - path/file.md => path only
  // - path/subpath/file.md => path + subpath
  const pathSegment = parts[0] || '';
  const subpathSegment = parts.length >= 3 ? (parts[1] || '') : '';

  return {
    path: pathSegment,
    subpath: subpathSegment,
  };
}

async function updateItem(collectionId, itemId, fieldData) {
  return fetchJson(`${API_BASE}/collections/${collectionId}/items/${itemId}`, {
    method: 'PATCH',
    body: JSON.stringify({ fieldData }),
  });
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN');
  const collectionId = requireEnv(
    ARTICLES_COLLECTION_ID,
    'WEBFLOW_ARTICLES_COLLECTION_ID'
  );

  const items = await getAllItems();
  let updated = 0;
  let skipped = 0;

  for (const item of items) {
    const fieldData = item.fieldData || {};
    const slug = fieldData.slug || item.slug;
    const sourceFile = fieldData.sourcefile || fieldData['source-file'] || fieldData.source;
    const currentPath = fieldData.path;
    const currentSubpath = fieldData.subpath;
    const derived = deriveSegmentsFromSourceFile(sourceFile);

    if (!slug) {
      skipped++;
      continue;
    }

    if (!derived.path) {
      skipped++;
      continue;
    }

    const updates = {};
    if (derived.path && derived.path !== currentPath) {
      updates.path = derived.path;
    }
    if (derived.subpath !== (currentSubpath || '')) {
      updates.subpath = derived.subpath;
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    await updateItem(collectionId, item.id, {
      ...fieldData,
      ...updates,
    });

    const summary = Object.entries(updates)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');
    console.log(`Updated ${slug} -> ${summary}`);
    updated++;
  }

  console.log(`Done. Updated: ${updated}, Skipped: ${skipped}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
