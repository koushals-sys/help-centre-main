#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const API_BASE = 'https://api.webflow.com/v2';
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
function requireEnv(v, n) { if (!v) { console.error(`Missing env var: ${n}`); process.exit(1); } return v; }
function httpRequest(urlString, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const opts = { method, hostname: url.hostname, path: url.pathname + (url.search || ''), port: url.port || 443, headers: {
      Authorization: `Bearer ${requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN')}`,
      'accept-version': '2.0.0', 'content-type': 'application/json', ...headers } };
    const req = https.request(opts, res => { let data=''; res.on('data', c=>data+=c); res.on('end', ()=>{ if (res.statusCode<200||res.statusCode>=300) return reject(new Error(`Webflow API ${res.statusCode}: ${data}`)); try{ resolve(JSON.parse(data)); }catch(e){ resolve(data); } }); }); req.on('error', reject); if(body) req.write(body); req.end();
  });
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN'); requireEnv(COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');
  const targetMd = process.argv[2] || 'src/content/docs/front-desk-module/appointment-booking/appointment-booking-commercial-insurance-pay-with-referral-physician-options.md';
  const md = fs.readFileSync(path.resolve(process.cwd(), targetMd), 'utf8');
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const front = {};
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n').map(l=>l.trim()).filter(Boolean)) {
      const m = line.match(/^([a-zA-Z0-9_-]+):\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
      if (m) front[m[1]] = m[2] ?? m[3] ?? (m[4]||'').trim();
    }
  }
  const slug = front.slug || path.basename(targetMd, '.md');

  const listUrl = `${API_BASE}/collections/${COLLECTION_ID}/items?limit=100`;
  const data = await httpRequest(listUrl);
  const items = data?.items || data?.collectionItems || [];
  const item = items.find(i => (i.fieldData && (i.fieldData.slug === slug)) || i.slug === slug);
  if (!item) { console.error('Item not found for slug', slug); process.exit(1); }
  const id = item._id || item.id;
  const description = front.description || front.summary || `Guide: ${front.title || slug}`;

  const fieldData = item.fieldData || {};
  if (fieldData.body && String(fieldData.body).trim().length > 0) {
    console.log('Item already has body; nothing to change.');
    return;
  }

  const updates = { ...fieldData, body: description };
  const patchUrl = `${API_BASE}/collections/${COLLECTION_ID}/items/${id}`;
  await httpRequest(patchUrl, { method: 'PATCH', body: JSON.stringify({ fieldData: updates }) });
  console.log('Patched item', slug, '-> body set to description.');
}

main().catch(err=>{ console.error(err); process.exit(1); });
