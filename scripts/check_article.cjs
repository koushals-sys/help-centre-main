#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');
const requireEnv = (v, name) => { if (!v) { console.error(`Missing env var: ${name}`); process.exit(1); } return v; };
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;
const API_BASE = 'https://api.webflow.com/v2';

function httpRequest(urlString, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const opts = { method, hostname: url.hostname, path: url.pathname + (url.search || ''), port: url.port || 443, headers: {
      Authorization: `Bearer ${requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN')}`,
      'accept-version': '2.0.0', 'content-type': 'application/json', ...headers } };
    const req = https.request(opts, res => { let data = ''; res.on('data', c => data += c); res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`Webflow API ${res.statusCode}: ${data}`)); try { resolve(JSON.parse(data)); } catch (e) { resolve(data); } }); }); req.on('error', reject); if (body) req.write(body); req.end();
  });
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN');
  requireEnv(COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');
  const slug = process.argv[2] || 'appointment-booking-commercial-insurance-pay-with-referral-physician-options';
  const url = `${API_BASE}/collections/${COLLECTION_ID}/items?limit=100`;
  const data = await httpRequest(url);
  const items = data?.items || data?.collectionItems || [];
  const item = items.find(i => (i.fieldData && (i.fieldData.slug === slug)) || i.slug === slug);
  if (!item) { console.log('Item not found in collection for slug:', slug); process.exit(0); }
  console.log('Found item id:', item._id || item.id || item.id);
  const body = (item.fieldData && (item.fieldData.body || item.fieldData.content || item.fieldData['post-body'])) || item.body || null;
  console.log('BODY:');
  console.log(body ? String(body).slice(0,2000) : '<empty>');
}

main().catch(err => { console.error(err); process.exit(1); });
