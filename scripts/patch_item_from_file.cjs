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

function mdToHtml(md) {
  // Convert lines starting with **Step N:** into <p><strong>Step N:</strong> text</p>
  const lines = md.split(/\r?\n/);
  const out = [];
  for (let line of lines) {
    line = line.trim();
    if (!line) continue;
    const m = line.match(/^\*\*(Step\s+\d+:)\*\*\s*(.*)$/i);
    if (m) {
      const label = m[1];
      const rest = m[2] || '';
      out.push(`<p><strong>${label}</strong> ${escapeHtml(rest)}</p>`);
      continue;
    }
    out.push(`<p>${escapeHtml(line)}</p>`);
  }
  return out.join('\n');
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN');
  requireEnv(COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');

  const slug = process.argv[2] || 'appointment-booking-commercial-insurance-pay-with-referral-physician-options';
  const file = process.argv[3] || 'scripts/tmp_appointment_content.md';
  const abs = path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) { console.error('File not found:', abs); process.exit(1); }
  const md = fs.readFileSync(abs, 'utf8');
  const html = mdToHtml(md);

  // Fetch items
  const listUrl = `${API_BASE}/collections/${COLLECTION_ID}/items?limit=100`;
  const data = await httpRequest(listUrl);
  const items = data?.items || data?.collectionItems || [];
  const item = items.find(i => (i.fieldData && (i.fieldData.slug === slug)) || i.slug === slug);
  if (!item) { console.error('Item not found for slug:', slug); process.exit(1); }
  const id = item._id || item.id;

  const fieldData = item.fieldData || {};
  const updates = { ...fieldData, body: html };
  const patchUrl = `${API_BASE}/collections/${COLLECTION_ID}/items/${id}`;
  await httpRequest(patchUrl, { method: 'PATCH', body: JSON.stringify({ fieldData: updates }) });
  console.log('Patched item', slug, 'with provided markdown (converted to HTML).');
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
