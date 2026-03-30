#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');
const API_BASE = 'https://api.webflow.com/v2';
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
const SITE_ID = process.env.WEBFLOW_SITE_ID;
const WEBFLOW_ASSET_HOST = process.env.WEBFLOW_ASSET_HOST || 'https://uploads-ssl.webflow.com';

function requireEnv(v, n) { if (!v) { console.error(`Missing env var: ${n}`); process.exit(1); } return v; }

function httpRequest(urlString, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const opts = {
      method,
      hostname: url.hostname,
      path: url.pathname + (url.search || ''),
      port: url.port || 443,
      headers: {
        Authorization: `Bearer ${requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN')}`,
        'accept-version': '2.0.0',
        'content-type': 'application/json',
        ...(headers || {}),
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Webflow API ${res.statusCode}: ${data}`));
        }
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch (err) {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function normalizeAssetUrl(u) {
  if (!u) return null;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `${WEBFLOW_ASSET_HOST}${u}`;
  return u;
}

function scoreFilename(name, slug) {
  if (!name) return 0;
  const n = name.toLowerCase();
  const s = slug.toLowerCase();
  let score = 0;
  if (n.includes(s)) score += 100;
  const parts = s.split('-').filter(Boolean);
  for (const p of parts) if (n.includes(p)) score += 5;
  if (n.endsWith('.png') || n.endsWith('.jpg') || n.endsWith('.jpeg') || n.endsWith('.gif')) score += 1;
  return score;
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN');
  requireEnv(COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');
  requireEnv(SITE_ID, 'WEBFLOW_SITE_ID');

  const slug = process.argv[2] || 'appointment-booking-commercial-insurance-pay-with-referral-physician-options';

  // 1) list assets for site
  const assetsUrl = `${API_BASE}/sites/${SITE_ID}/assets?limit=200`;
  let data;
  try {
    data = await httpRequest(assetsUrl);
  } catch (err) {
    console.error('Failed to list assets:', err.message || err);
    process.exit(1);
  }

  const assets = data?.items || data || [];
  if (!Array.isArray(assets) || assets.length === 0) {
    console.log('No assets returned from Webflow for site', SITE_ID);
    process.exit(0);
  }

  // 2) find best match by filename
  const candidates = assets.map(a => ({
    name: a.name || a.filename || a.fileName || (a.file && a.file.name) || '',
    url: a.url || (a.file && a.file.url) || a['url'] || a['file']?.url,
    raw: a,
    score: scoreFilename(a.name || a.filename || '', slug),
  })).filter(c => c.url);

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];
  if (!best || best.score === 0) {
    console.log('No matching assets found for slug:', slug);
    process.exit(0);
  }

  const assetUrl = normalizeAssetUrl(best.url);
  console.log('Best match:', best.name, assetUrl);

  // 3) fetch collection item
  const listItemsUrl = `${API_BASE}/collections/${COLLECTION_ID}/items?limit=200`;
  const itemsResp = await httpRequest(listItemsUrl);
  const items = itemsResp?.items || itemsResp?.collectionItems || [];
  const item = items.find(i => (i.fieldData && (i.fieldData.slug === slug)) || i.slug === slug);
  if (!item) {
    console.error('No CMS item found for slug:', slug);
    process.exit(1);
  }

  const id = item._id || item.id;
  const fieldData = item.fieldData || {};
  const currentBody = String(fieldData.body || item.body || '');

  // prepend image HTML if not already present
  if (currentBody.includes(assetUrl)) {
    console.log('Asset URL already present in body; no change needed.');
    process.exit(0);
  }

  const imgHtml = `<p><img src="${assetUrl}" alt="${escapeHtml(fieldData.name || item.name || '')}" style="max-width:100%;height:auto" /></p>`;
  const newBody = imgHtml + '\n' + currentBody;

  const updates = { ...fieldData, body: newBody };
  const patchUrl = `${API_BASE}/collections/${COLLECTION_ID}/items/${id}`;
  await httpRequest(patchUrl, { method: 'PATCH', body: JSON.stringify({ fieldData: updates }) });
  console.log('Patched CMS item with image:', assetUrl);
}

function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

main().catch(err => { console.error(err.message || err); process.exit(1); });
