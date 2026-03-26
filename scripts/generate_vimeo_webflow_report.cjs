#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');
const fs = require('fs');

const WEBFLOW_API_BASE = 'https://api.webflow.com/v2';
const VIMEO_API_BASE = 'https://api.vimeo.com';

const WEBFLOW_API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const WEBFLOW_ARTICLES_COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
const VIMEO_ACCESS_TOKEN = process.env.VIMEO_ACCESS_TOKEN;
const USE_FOLDERS = !!process.env.VIMEO_USE_FOLDERS;
const OUTPUT = process.env.OUTPUT_PATH || 'scripts/vimeo_webflow_report.csv';
const WEBFLOW_VIDEO_FIELD_LABEL = process.env.WEBFLOW_VIDEO_FIELD_LABEL || 'Video Link';

function requireEnv(v, n) {
  if (!v) {
    console.error(`Missing env var: ${n}`);
    process.exit(1);
  }
  return v;
}

function slugify(value) {
  return String(value || '')
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
    const opts = { method, hostname: url.hostname, path: url.pathname + (url.search || ''), port: url.port || 443, headers };
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

async function getAllWebflowItems() {
  const all = [];
  let offset = 0; const limit = 100;
  while (true) {
    const data = await webflowRequest(`/collections/${requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID')}/items?limit=${limit}&offset=${offset}`);
    const items = data?.items || data?.collectionItems || [];
    all.push(...items);
    if (items.length < limit) break;
    offset += limit;
  }
  return all;
}

async function getAllVimeoVideos() {
  const all = [];
  let page = 1; const perPage = 100;
  while (true) {
    const data = await vimeoRequest(`/me/videos?per_page=${perPage}&page=${page}&fields=uri,name,link`);
    const items = data?.data || [];
    all.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }
  return all;
}

async function getAllVimeoFolders() {
  const all = [];
  let page = 1; const perPage = 100;
  while (true) {
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
  let page = 1; const perPage = 100;
  while (true) {
    const data = await vimeoRequest(`${folderUri}/videos?per_page=${perPage}&page=${page}&fields=uri,name,link`);
    const items = data?.data || [];
    all.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }
  return all;
}

async function getWebflowVideoFieldKey() {
  const collection = await webflowRequest(`/collections/${requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID')}`);
  const fields = collection?.fields || [];
  const label = String(WEBFLOW_VIDEO_FIELD_LABEL || '').toLowerCase();
  const match = fields.find(field => {
    const candidates = [field.slug, field.name, field.displayName, field.label].filter(Boolean).map(v => String(v).toLowerCase());
    return candidates.includes(label);
  });
  if (!match) throw new Error(`Could not find field matching label: ${WEBFLOW_VIDEO_FIELD_LABEL}`);
  return match.slug;
}

(async function main(){
  try {
    requireEnv(WEBFLOW_API_TOKEN, 'WEBFLOW_API_TOKEN');
    requireEnv(WEBFLOW_ARTICLES_COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');
    requireEnv(VIMEO_ACCESS_TOKEN, 'VIMEO_ACCESS_TOKEN');

    const fieldKey = await getWebflowVideoFieldKey();

    // build video map
    const videoMap = new Map();
    let videos = [];
    if (USE_FOLDERS) {
      const folders = await getAllVimeoFolders();
      for (const folder of folders) {
        const folderName = folder?.name || '';
        const folderSlug = slugify(folderName);
        const folderUri = folder?.uri || '';
        if (!folderUri) continue;
        const folderVideos = await getVideosInFolder(folderUri);
        for (const v of folderVideos) {
          if (!v?.name || !v?.link) continue;
          const vslug = slugify(v.name);
          if (vslug && !videoMap.has(vslug)) videoMap.set(vslug, v.link);
        }
        if (folderSlug && folderVideos.length > 0 && !videoMap.has(folderSlug)) {
          videoMap.set(folderSlug, folderVideos[0].link);
        }
        videos.push(...folderVideos);
      }
      const fallback = await getAllVimeoVideos();
      for (const v of fallback) {
        if (!v?.name || !v?.link) continue;
        const vslug = slugify(v.name);
        if (vslug && !videoMap.has(vslug)) videoMap.set(vslug, v.link);
      }
      videos = Array.from(new Set(videos.concat(fallback || [])));
    } else {
      videos = await getAllVimeoVideos();
      for (const v of videos) {
        if (!v?.name || !v?.link) continue;
        const vslug = slugify(v.name);
        if (vslug && !videoMap.has(vslug)) videoMap.set(vslug, v.link);
      }
    }

    const items = await getAllWebflowItems();

    const rows = [];
    rows.push(['itemId','name','slug','existingVideo','matchedVideo','status'].join(','));

    for (const item of items) {
      const id = item._id || item.id || '';
      const name = (item.fieldData && (item.fieldData.name || item.fieldData.title)) || item.name || '';
      const slug = (item.fieldData && (item.fieldData.slug)) || item.slug || '';
      const existing = item.fieldData && Object.prototype.hasOwnProperty.call(item.fieldData, fieldKey) ? item.fieldData[fieldKey] : '';
      const matched = videoMap.get(slug) || '';
      let status = 'no-match';
      if (matched) {
        if (existing && String(existing) === String(matched)) status = 'matched';
        else status = 'will-update';
      }
      // Escape fields with quotes if they contain commas or quotes
      const esc = s => {
        if (s == null) return '';
        const str = String(s);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return '"' + str.replace(/"/g,'""') + '"';
        }
        return str;
      };
      rows.push([esc(id), esc(name), esc(slug), esc(existing), esc(matched), esc(status)].join(','));
    }

    fs.writeFileSync(OUTPUT, rows.join('\n'));
    console.log(`Wrote report: ${OUTPUT}`);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
})();
