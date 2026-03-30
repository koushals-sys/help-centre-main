#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.webflow.com/v2';
const API_TOKEN = process.env.WEBFLOW_API_TOKEN;
const COLLECTION_ID = process.env.WEBFLOW_ARTICLES_COLLECTION_ID;

function requireEnv(v, name) {
  if (!v) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return v;
}

const https = require('https');
const { URL } = require('url');

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
        ...headers,
      },
    };

    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return reject(new Error(`Webflow API ${res.statusCode}: ${data}`));
        }
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve(parsed);
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

function parseFrontmatter(markdown) {
  const fmMatch = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!fmMatch) return { front: {}, body: markdown };
  const fm = fmMatch[1];
  const body = markdown.slice(fmMatch[0].length);
  const lines = fm.split(/\n/).map(l => l.trim()).filter(Boolean);
  const result = {};
  for (const line of lines) {
    const m = line.match(/^([a-zA-Z0-9_-]+):\s*(?:"([^"]*)"|'([^']*)'|(.*))$/);
    if (m) {
      result[m[1]] = m[2] ?? m[3] ?? (m[4] || '').trim();
    }
  }
  return { front: result, body };
}

function stripVideoTags(html) {
  return html.replace(/<video[\s\S]*?<\/video>/gi, '').trim();
}

async function main() {
  requireEnv(API_TOKEN, 'WEBFLOW_API_TOKEN');
  requireEnv(COLLECTION_ID, 'WEBFLOW_ARTICLES_COLLECTION_ID');

  const target = process.argv[2] || 'src/content/docs/front-desk-module/appointment-booking/appointment-booking-commercial-insurance-pay-with-referral-physician-options.md';
  const abs = path.resolve(process.cwd(), target);
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs);
    process.exit(1);
  }

  const md = fs.readFileSync(abs, 'utf8');
  const { front, body } = parseFrontmatter(md);

  const title = front.title || front.name || path.basename(abs, '.md');
  const description = front.description || front.summary || '';
  const slug = front.slug || path.basename(abs, '.md');

  // Remove video tags — user requested text-only
  const cleanedBody = stripVideoTags(body).trim();

  console.log(`Preparing to push article: ${title} (slug: ${slug})`);

  // 1) try to find existing item by slug
  const collectionId = COLLECTION_ID;
  const listUrl = `${API_BASE}/collections/${collectionId}/items?limit=100`;
  const list = await httpRequest(listUrl, { method: 'GET' });
  const items = list?.items || list?.collectionItems || [];

  const existing = items.find(it => {
    const s = (it?.fieldData && (it.fieldData.slug || it.fieldData['source-file'])) || it.slug || '';
    return String(s) === String(slug) || String(it.slug) === String(slug);
  });

  if (existing) {
    console.log('Found existing item — updating (text-only, no media).');
    const fieldData = existing.fieldData || {};
    const updates = {
      ...fieldData,
      name: title,
      slug: slug,
      summary: description,
      body: cleanedBody || fieldData.body || '',
    };

    const patchUrl = `${API_BASE}/collections/${collectionId}/items/${existing._id || existing.id}`;
    await httpRequest(patchUrl, { method: 'PATCH', body: JSON.stringify({ fieldData: updates }) });

    console.log('Updated Webflow item for', slug);
    return;
  }

  console.log('No existing item found — creating a new CMS item (text-only).');
  const createUrl = `${API_BASE}/collections/${collectionId}/items`;
  const payload = {
    fields: {
      name: title,
      slug: slug,
      summary: description,
      body: cleanedBody,
    },
  };

  await httpRequest(createUrl, { method: 'POST', body: JSON.stringify(payload) });
  console.log('Created new Webflow CMS item for', slug);
}

main().catch(err => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
