const WEBFLOW_API_BASE = 'https://api.webflow.com/v2';

const WEBFLOW_API_TOKEN = import.meta.env.WEBFLOW_API_TOKEN;
const WEBFLOW_ARTICLES_COLLECTION_ID = import.meta.env.WEBFLOW_ARTICLES_COLLECTION_ID;
const WEBFLOW_CATEGORIES_COLLECTION_ID = import.meta.env.WEBFLOW_CATEGORIES_COLLECTION_ID;
const WEBFLOW_TAGS_COLLECTION_ID = import.meta.env.WEBFLOW_TAGS_COLLECTION_ID;
const WEBFLOW_ASSET_HOST = import.meta.env.WEBFLOW_ASSET_HOST || 'https://uploads-ssl.webflow.com';

// Build-time cache to avoid hitting rate limits
const buildCache = new Map<string, any>();

const labelOverrides: Record<string, string> = {
  'clinicians-module': "Clinician's Module",
  'front-desk-module': 'Front Desk Module',
  'billing-videos': 'Billing Videos',
  'new-features': 'New Features',
  'new-updates': 'New Updates',
  'profile-management': 'Profile Management',
};

function toTitleCase(slug: string) {
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

async function fetchJson(path: string) {
  const token = requireEnv(WEBFLOW_API_TOKEN, 'WEBFLOW_API_TOKEN');
  const response = await fetch(`${WEBFLOW_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'accept-version': '2.0.0',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Webflow API error ${response.status}: ${text}`);
  }

  return response.json();
}

function getField(item: any, keys: string[]) {
  for (const key of keys) {
    if (item?.fieldData && item.fieldData[key] != null) {
      return item.fieldData[key];
    }
    if (item && item[key] != null) {
      return item[key];
    }
  }
  return undefined;
}

function normalizeVideoUrl(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (typeof value.url === 'string') return value.url;
    if (typeof value.src === 'string') return value.src;
    if (typeof value.href === 'string') return value.href;
    if (value.file && typeof value.file.url === 'string') return value.file.url;
  }
  return undefined;
}

function normalizeImageUrl(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return normalizeAssetUrl(value);
  if (typeof value === 'object') {
    if (typeof value.url === 'string') return normalizeAssetUrl(value.url);
    if (value.file && typeof value.file.url === 'string') {
      return normalizeAssetUrl(value.file.url);
    }
  }
  return undefined;
}

function normalizeAssetUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/') && !value.startsWith('//')) {
    return `${WEBFLOW_ASSET_HOST}${value}`;
  }
  return value;
}

function normalizeRichTextHtml(html: any): string | undefined {
  if (!html || typeof html !== 'string') return html;

  const srcAttr = /(<(?:img|source)[^>]*?\s(?:src)=["'])([^"']+)(["'])/gi;
  const srcsetAttr = /(<(?:img|source)[^>]*?\s(?:srcset)=["'])([^"']+)(["'])/gi;

  const normalizeSrcset = (value: string) =>
    value
      .split(',')
      .map(part => {
        const [url, descriptor] = part.trim().split(/\s+/, 2);
        const normalizedUrl = url ? normalizeAssetUrl(url) : '';
        return descriptor ? `${normalizedUrl} ${descriptor}` : normalizedUrl;
      })
      .join(', ');

  return html
    .replace(srcAttr, (_match, prefix, url, suffix) => `${prefix}${normalizeAssetUrl(url)}${suffix}`)
    .replace(srcsetAttr, (_match, prefix, value, suffix) => `${prefix}${normalizeSrcset(value)}${suffix}`);
}

function resolveVideoUrl(item: any): string | undefined {
  const direct = normalizeVideoUrl(
    getField(item, ['video-link', 'video-url', 'videourl', 'VideoUrl', 'video', 'videoUrl'])
  );
  if (direct) return direct;

  const fieldData = item?.fieldData;
  if (fieldData && typeof fieldData === 'object') {
    for (const [key, value] of Object.entries(fieldData)) {
      if (!key.toLowerCase().includes('video')) continue;
      const inferred = normalizeVideoUrl(value);
      if (inferred) return inferred;
    }
  }

  const itemValues = item && typeof item === 'object' ? Object.entries(item) : [];
  for (const [key, value] of itemValues) {
    if (!key.toLowerCase().includes('video')) continue;
    const inferred = normalizeVideoUrl(value);
    if (inferred) return inferred;
  }

  return undefined;
}

function resolveThumbnailUrl(item: any): string | undefined {
  const direct = normalizeImageUrl(
    getField(item, [
      'thumbnail',
      'thumbnail-image',
      'thumbnailimage',
      'cover',
      'cover-image',
      'featured-image',
      'card-image',
      'listing-image',
      'hero-image',
      'image',
    ])
  );
  if (direct) return direct;

  const fieldData = item?.fieldData;
  if (fieldData && typeof fieldData === 'object') {
    for (const [key, value] of Object.entries(fieldData)) {
      const lower = key.toLowerCase();
      if (!lower.includes('image') && !lower.includes('thumbnail') && !lower.includes('cover')) {
        continue;
      }
      const inferred = normalizeImageUrl(value);
      if (inferred) return inferred;
    }
  }

  const itemValues = item && typeof item === 'object' ? Object.entries(item) : [];
  for (const [key, value] of itemValues) {
    const lower = key.toLowerCase();
    if (!lower.includes('image') && !lower.includes('thumbnail') && !lower.includes('cover')) {
      continue;
    }
    const inferred = normalizeImageUrl(value);
    if (inferred) return inferred;
  }

  return undefined;
}

async function getCollectionItems(collectionId: string) {
  const allItems: any[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await fetchJson(`/collections/${collectionId}/items?limit=${limit}&offset=${offset}`);
    const items = data?.items || data?.collectionItems || [];
    allItems.push(...items);

    if (items.length < limit) {
      break;
    }
    offset += limit;
  }

  return allItems;
}

export async function getAllArticles() {
  const cacheKey = 'articles';
  if (buildCache.has(cacheKey)) {
    return buildCache.get(cacheKey);
  }

  const collectionId = requireEnv(
    WEBFLOW_ARTICLES_COLLECTION_ID,
    'WEBFLOW_ARTICLES_COLLECTION_ID'
  );
  const items = await getCollectionItems(collectionId);

  const articles = items.map(item => ({
    id: item.id,
    name: getField(item, ['name', 'title']),
    slug: getField(item, ['slug']),
    summary: getField(item, ['summary', 'description']),
    body: normalizeRichTextHtml(getField(item, ['body', 'content', 'post-body'])),
    path: getField(item, ['path', 'category-path', 'folder']),
    subpath: getField(item, ['subpath', 'sub-path']),
    sourceFile: getField(item, ['sourcefile', 'source-file', 'source']),
    tagIds: (() => {
      const tags = getField(item, ['tags']);
      return Array.isArray(tags) ? tags : [];
    })(),
    videoUrl: resolveVideoUrl(item),
    thumbnailUrl: resolveThumbnailUrl(item),
    raw: item,
  }));

  buildCache.set(cacheKey, articles);
  return articles;
}

export async function getAllCategories() {
  const cacheKey = 'categories';
  if (buildCache.has(cacheKey)) {
    return buildCache.get(cacheKey);
  }

  if (!WEBFLOW_CATEGORIES_COLLECTION_ID) {
    return [];
  }
  const items = await getCollectionItems(WEBFLOW_CATEGORIES_COLLECTION_ID);

  const categories = items.map(item => ({
    id: item.id,
    name: getField(item, ['name', 'title']),
    slug: getField(item, ['slug']),
    parent: getField(item, ['parent', 'parent-category']),
    raw: item,
  }));

  buildCache.set(cacheKey, categories);
  return categories;
}

export async function getAllTags() {
  const cacheKey = 'tags';
  if (buildCache.has(cacheKey)) {
    return buildCache.get(cacheKey);
  }

  if (!WEBFLOW_TAGS_COLLECTION_ID) {
    return [];
  }
  const items = await getCollectionItems(WEBFLOW_TAGS_COLLECTION_ID);

  const tags = items.map(item => ({
    id: item.id,
    name: getField(item, ['name', 'title']),
    slug: getField(item, ['slug']),
    raw: item,
  }));

  buildCache.set(cacheKey, tags);
  return tags;
}

function deriveSegmentsFromSource(sourceFile?: string) {
  if (!sourceFile || typeof sourceFile !== 'string') return { path: '', subpath: '' };
  if (!sourceFile.includes('/')) return { path: '', subpath: '' };
  const segments = sourceFile.split('/').filter(Boolean);
  return {
    path: segments[0] || '',
    subpath: segments[1] || '',
  };
}

function normalizeSegments(path?: string, subpath?: string, sourceFile?: string) {
  const sourceSegments = deriveSegmentsFromSource(sourceFile);
  let pathSegment = path || sourceSegments.path;
  let subpathSegment = subpath || sourceSegments.subpath;

  if (subpathSegment && subpathSegment.endsWith('.md')) {
    subpathSegment = '';
  }

  if (pathSegment && pathSegment.includes('/')) {
    const parts = pathSegment.split('/').filter(Boolean);
    pathSegment = parts[0] || '';
    if (!subpathSegment && parts.length > 1) {
      subpathSegment = parts[1];
    }
  }

  return {
    path: pathSegment,
    subpath: subpathSegment,
  };
}

export function getArticleSegments(article: {
  path?: string;
  subpath?: string;
  sourceFile?: string;
}) {
  return normalizeSegments(article.path, article.subpath, article.sourceFile);
}

export function getArticleUrl(article: {
  slug?: string;
  path?: string;
  subpath?: string;
  sourceFile?: string;
}) {
  const slug = article.slug || '';
  return `/${slug}`;
}

type SidebarGroup = { label: string; items: Array<any>; collapsed?: boolean };

export function formatSegmentLabel(segment: string) {
  return labelOverrides[segment] ?? toTitleCase(segment);
}

export function buildWebflowSidebar(
  articles: Array<{
    name?: string;
    slug?: string;
    path?: string;
    subpath?: string;
    sourceFile?: string;
    tagIds?: string[];
  }>,
  tagMap: Map<string, { id: string; name?: string; slug?: string }>
) {
  const rootItems: Array<any> = [];
  const generalItems: Array<any> = [];
  const groupMap = new Map<string, SidebarGroup>();
  const groupLinkSet = new Set<string>();

  const sorted = [...articles].sort((a, b) => {
    const aKey = `${a.path || ''}/${a.subpath || ''}/${a.slug || ''}`;
    const bKey = `${b.path || ''}/${b.subpath || ''}/${b.slug || ''}`;
    return aKey.localeCompare(bKey);
  });

  function getOrCreateGroup(pathSegments: string[], labels: string[]) {
    let currentItems = rootItems;
    let currentPath = '';

    for (const [index, segment] of pathSegments.entries()) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let group = groupMap.get(currentPath);
      if (!group) {
        const labelText = labels[index] || formatSegmentLabel(segment);
        const href = `/${currentPath}`;
        group = {
          label: `${labelText}||${href}`,
          items: [],
          collapsed: true,
        };
        groupMap.set(currentPath, group);
        currentItems.push(group);
      }

      if (!groupLinkSet.has(currentPath)) {
        groupLinkSet.add(currentPath);
      }
      currentItems = group.items;
    }

    return currentItems;
  }

  for (const article of sorted) {
    const baseLabel = article.name || article.slug || 'Untitled';
    const link = getArticleUrl(article);
    const segments = getArticleSegments(article);
    const pathSegment = segments.path ? segments.path.replace(/^\/+|\/+$/g, '') : '';
    const subpathSegment = segments.subpath ? segments.subpath.replace(/^\/+|\/+$/g, '') : '';
    const pathSegments = [pathSegment, subpathSegment].filter(Boolean);

    const tagLabel = (article.tagIds || [])
      .map(tagId => tagMap.get(tagId)?.name)
      .find(Boolean);
    const subpathLabel = tagLabel || (subpathSegment ? formatSegmentLabel(subpathSegment) : '');
    const labels = [formatSegmentLabel(pathSegment), subpathLabel].filter(Boolean);

    if (pathSegments.length === 0) {
      generalItems.push({ label: baseLabel, link });
      continue;
    }

    const targetItems = getOrCreateGroup(pathSegments, labels);
    targetItems.push({ label: baseLabel, link });
  }

  if (generalItems.length > 0) {
    rootItems.unshift({ label: 'General', items: generalItems, collapsed: true });
  }

  return rootItems;
}
