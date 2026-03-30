#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');

const WEBFLOW_API_BASE = 'https://api.webflow.com/v2';
const VIMEO_API_BASE = 'https://api.vimeo.com';

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_ARTICLES_COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
const VIMEO_ACCESS_TOKEN = process.env.VIMEO_ACCESS_TOKEN;
const WEBFLOW_VIDEO_FIELD_KEY = process.env.WEBFLOW_VIDEO_FIELD_KEY;
const WEBFLOW_VIDEO_FIELD_LABEL = process.env.WEBFLOW_VIDEO_FIELD_LABEL || 'Video Link';

const APPLY = process.argv.includes('--apply');

function requireEnv(v, n) {
  if (!v) {
    console.error(`Missing env var: ${n}`);
    process.exit(1);
  }
  return v;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function httpRequest(urlString, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const opts = {
      method,
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      port: url.port || 443,
      headers,
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`${url.hostname} ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function webflowRequest(path, { method = 'GET', body } = {}) {
  return httpRequest(`${WEBFLOW_API_BASE}${path}`, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${requireEnv(WEBFLOW_API_TOKEN, 'WEBFLOW_API_TOKEN')}`,
      'accept-version': '2.0.0',
      'content-type': 'application/json',
    },
  });
}

function vimeoRequest(path) {
  return httpRequest(`${VIMEO_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${requireEnv(VIMEO_ACCESS_TOKEN, 'VIMEO_ACCESS_TOKEN')}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
    },
  });
}

async function getWebflowVideoFieldKey() {
  if (WEBFLOW_VIDEO_FIELD_KEY) return WEBFLOW_VIDEO_FIELD_KEY;

  const collection = await webflowRequest(`/collections/${requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID')}`);
  const fields = collection?.fields || [];
  const label = String(WEBFLOW_VIDEO_FIELD_LABEL || '').toLowerCase();
  const match = fields.find(field => {
    const candidates = [field.slug, field.name, field.displayName, field.label]
      .filter(Boolean)
      .map(v => String(v).toLowerCase());
    return candidates.includes(label);
  });

  if (!match) {
    console.error(`Could not find a Webflow field matching label: ${WEBFLOW_VIDEO_FIELD_LABEL}`);
    process.exit(1);
  }

  return match.slug;
}

async function getAllWebflowItems() {
  const allItems = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const data = await webflowRequest(
      `/collections/${requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID')}/items?limit=${limit}&offset=${offset}`
    );
    const items = data?.items || data?.collectionItems || [];
    allItems.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }

  return allItems;
}

async function getAllVimeoVideos() {
  const allVideos = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const data = await vimeoRequest(`/me/videos?per_page=${perPage}&page=${page}&fields=uri,name,link`);
    const items = data?.data || [];
    allVideos.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }

  return allVideos;
}

async function getAllVimeoFolders() {
  const all = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    // Projects (folders) endpoint
    const data = await vimeoRequest(`/me/projects?per_page=${perPage}&page=${page}&fields=uri,name`);
    const items = data?.data || [];
    all.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }

  return all;
}

async function getVideosInFolder(folderUri) {
  const all = [];
  let page = 1;
  const perPage = 100;

  // folderUri often is like "/projects/{id}" or "/users/{id}/projects/{id}"
  while (true) {
    const data = await vimeoRequest(`${folderUri}/videos?per_page=${perPage}&page=${page}&fields=uri,name,link`);
    const items = data?.data || [];
    all.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }

  return all;
}

async function updateWebflowItem(itemId, fieldData) {
  await webflowRequest(
    `/collections/${requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID')}/items/${itemId}`,
    { method: 'PATCH', body: JSON.stringify({ fieldData }) }
  );
}

function buildMinimalFieldData(item, fieldKey, videoUrl, requiredKeys) {
  const fieldData = {};
  fieldData[fieldKey] = videoUrl;

  for (const key of requiredKeys) {
    if (key === fieldKey) continue;
    if (item?.fieldData && Object.prototype.hasOwnProperty.call(item.fieldData, key)) {
      fieldData[key] = item.fieldData[key];
    }
  }

  return fieldData;
}

async function main() {
  requireEnv(WEBFLOW_API_TOKEN, 'WEBFLOW_API_TOKEN');
  requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');
  requireEnv(VIMEO_ACCESS_TOKEN, 'VIMEO_ACCESS_TOKEN');

  const fieldKey = await getWebflowVideoFieldKey();
  if (fieldKey.includes(' ')) {
    console.error(`Field key looks invalid (contains spaces): ${fieldKey}`);
    process.exit(1);
  }

  const collection = await webflowRequest(
    `/collections/${requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID')}`
  );
  const requiredKeys = (collection?.fields || [])
    .filter(field => field?.isRequired)
    .map(field => field?.slug)
    .filter(Boolean);

  const useFolders = !!process.env.VIMEO_USE_FOLDERS;
  let videos = [];
  const videoMap = new Map();

  if (useFolders) {
    // Build mapping from folder slug -> first video in folder, and also map videos by name slug.
    const folders = await getAllVimeoFolders();
    for (const folder of folders) {
      const folderName = folder?.name || '';
      const folderSlug = slugify(folderName);
      const folderUri = folder?.uri || '';
      if (!folderUri) continue;

      const folderVideos = await getVideosInFolder(folderUri);
      // Map each video by its name slug if missing
      for (const v of folderVideos) {
        if (!v?.name || !v?.link) continue;
        const vslug = slugify(v.name);
        if (vslug && !videoMap.has(vslug)) videoMap.set(vslug, v.link);
      }

      // If folder name itself matches an article slug, prefer the first video in that folder
      if (folderSlug && folderVideos.length > 0 && !videoMap.has(folderSlug)) {
        videoMap.set(folderSlug, folderVideos[0].link);
      }

      videos.push(...folderVideos);
    }

    // Also fetch standalone videos (not in folders) to ensure we don't miss anything
    const fallbackVideos = await getAllVimeoVideos();
    for (const video of fallbackVideos) {
      if (!video?.name || !video?.link) continue;
      const slug = slugify(video.name);
      if (!slug) continue;
      if (!videoMap.has(slug)) videoMap.set(slug, video.link);
    }

    // Flatten videos list for logging
    videos = Array.from(new Set(videos.concat(fallbackVideos || [])));
  } else {
    videos = await getAllVimeoVideos();
    for (const video of videos) {
      if (!video?.name || !video?.link) continue;
      const slug = slugify(video.name);
      if (!slug || videoMap.has(slug)) continue;
      videoMap.set(slug, video.link);
    }
  }

  // Fetch all Webflow items once
  const items = await getAllWebflowItems();

  let updated = 0;
  let skipped = 0;
  let unmatched = 0;

  for (const item of items) {
    const slug = item?.fieldData?.slug || item?.slug;
    if (!slug) {
      skipped += 1;
      continue;
    }
    const videoUrl = videoMap.get(slug);
    if (!videoUrl) {
      unmatched += 1;
      continue;
    }

    const existingValue = item?.fieldData ? item.fieldData[fieldKey] : undefined;
    if (existingValue === videoUrl) {
      skipped += 1;
      continue;
    }

    const fieldData = buildMinimalFieldData(item, fieldKey, videoUrl, requiredKeys);

    if (APPLY) {
      const id = item._id || item.id;
      await updateWebflowItem(id, fieldData);
      await sleep(150);
    }

    updated += 1;
  }

  console.log(`Field key: ${fieldKey}`);
  console.log(`Vimeo videos: ${videos.length}`);
  console.log(`Webflow items: ${items.length}`);
  console.log(`Matches updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Unmatched slugs: ${unmatched}`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to update Webflow.');
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
