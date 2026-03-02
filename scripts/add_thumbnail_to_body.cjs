#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');
const API_BASE = 'https://api.webflow.com/v2';
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
const WEBFLOW_ASSET_HOST = process.env.WEBFLOW_ASSET_HOST || 'https://uploads-ssl.webflow.com';
const requireEnv = (v, n) => { if (!v) { console.error(`Missing env var: ${n}`); process.exit(1); } return v; };

function httpRequest(urlString, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const opts = { method, hostname: url.hostname, path: url.pathname + (url.search || ''), port: url.port || 443, headers: {
      Authorization: `Bearer ${requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN')}`,
      'accept-version': '2.0.0', 'content-type': 'application/json', ...headers } };
    const req = https.request(opts, res => { let data=''; res.on('data', c=>data+=c); res.on('end', ()=>{ if (res.statusCode<200||res.statusCode>=300) return reject(new Error(`Webflow API ${res.statusCode}: ${data}`)); try{ resolve(JSON.parse(data)); }catch(e){ resolve(data); } }); }); req.on('error', reject); if(body) req.write(body); req.end();
  });
}

function normalizeAssetUrl(url) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('/')) return `${WEBFLOW_ASSET_HOST}${url}`;
  return url;
}

function findImageInFields(fieldData) {
  if (!fieldData || typeof fieldData !== 'object') return null;
  const candidates = [];
  for (const [k, v] of Object.entries(fieldData)) {
    const key = k.toLowerCase();
    if (key.includes('image') || key.includes('thumbnail') || key.includes('cover') || key.includes('photo')) {
      if (!v) continue;
      if (typeof v === 'string') candidates.push(v);
      else if (v.file && v.file.url) candidates.push(v.file.url);
      else if (v.url) candidates.push(v.url);
    }
  }
  return candidates.length ? normalizeAssetUrl(candidates[0]) : null;
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN'); requireEnv(COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');
  const slug = process.argv[2] || 'appointment-booking-commercial-insurance-pay-with-referral-physician-options';
  const listUrl = `${API_BASE}/collections/${COLLECTION_ID}/items?limit=200`;
  const data = await httpRequest(listUrl);
  const items = data?.items || data?.collectionItems || [];
  const item = items.find(i => (i.fieldData && (i.fieldData.slug === slug)) || i.slug === slug);
  if (!item) { console.error('Item not found for slug:', slug); process.exit(1); }

  const imageUrl = findImageInFields(item.fieldData) || (item.thumbnailUrl || item.thumb || null);
  console.log('Detected image URL:', imageUrl);
  if (!imageUrl) { console.log('No image found to insert.'); process.exit(0); }

  const body = (item.fieldData && (item.fieldData.body || '')) || item.body || '';
  const imgHtml = `<p><img src="${imageUrl}" alt="${escapeHtml(item.fieldData.name || item.name || '')}" style="max-width:100%;height:auto" /></p>`;
  const newBody = imgHtml + '\n' + body;

  const updates = { ...(item.fieldData || {}), body: newBody };
  const patchUrl = `${API_BASE}/collections/${COLLECTION_ID}/items/${item._id || item.id}`;
  await httpRequest(patchUrl, { method: 'PATCH', body: JSON.stringify({ fieldData: updates }) });
  console.log('Patched item body with image prepended.');
}

function escapeHtml(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

main().catch(err => { console.error(err.message || err); process.exit(1); });
