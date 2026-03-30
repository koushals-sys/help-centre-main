#!/usr/bin/env node
const https = require('https');
const { URL } = require('url');

const VIMEO_API_BASE = 'https://api.vimeo.com';
const VIMEO_ACCESS_TOKEN = process.env.VIMEO_ACCESS_TOKEN_EDIT || process.env.VIMEO_ACCESS_TOKEN;

const APPLY = process.argv.includes('--apply');

function requireEnv(value, name) {
  if (!value) {
    console.error(`Missing env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

function vimeoRequest(path, { method = 'GET', body } = {}) {
  return httpRequest(`${VIMEO_API_BASE}${path}`, {
    method,
    body,
    headers: {
      Authorization: `Bearer ${requireEnv(VIMEO_ACCESS_TOKEN, 'VIMEO_ACCESS_TOKEN')}`,
      Accept: 'application/vnd.vimeo.*+json;version=3.4',
      'Content-Type': 'application/json',
    },
  });
}

function getVideoId(uri) {
  if (!uri) return undefined;
  const match = String(uri).match(/\/videos\/(\d+)/);
  return match ? match[1] : undefined;
}

async function getAllVideos(perPage) {
  const videos = [];
  let page = 1;

  while (true) {
    const data = await vimeoRequest(`/me/videos?per_page=${perPage}&page=${page}&fields=uri,name`);
    const items = data?.data || [];
    videos.push(...items);
    if (items.length < perPage) break;
    page += 1;
  }

  return videos;
}

async function updateVideoEmbed(videoId, settings) {
  await vimeoRequest(`/videos/${videoId}`, {
    method: 'PATCH',
    body: JSON.stringify({ embed: settings }),
  });
}

async function main() {
  requireEnv(VIMEO_ACCESS_TOKEN, 'VIMEO_ACCESS_TOKEN');

  const perPage = Math.min(parseInt(getArgValue('--per-page') || '100', 10), 100);
  const limit = parseInt(getArgValue('--limit') || '0', 10) || undefined;

  const settings = {
    color: '3E1150',
    title: {
      name: 'hide',
      owner: 'hide',
      portrait: 'hide',
    },
    logos: {
      vimeo: false,
    },
    buttons: {
      like: false,
      watchlater: false,
      share: false,
      embed: false,
    },
  };

  const videos = await getAllVideos(perPage);
  let updated = 0;
  let skipped = 0;

  for (const video of videos) {
    if (limit && updated >= limit) break;
    const videoId = getVideoId(video?.uri);
    if (!videoId) {
      skipped += 1;
      continue;
    }

    if (APPLY) {
      await updateVideoEmbed(videoId, settings);
      await sleep(150);
    }

    updated += 1;
    console.log(`${APPLY ? 'Updated' : 'Would update'}: ${videoId} ${video?.name || ''}`.trim());
  }

  console.log(`Videos scanned: ${videos.length}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped: ${skipped}`);

  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to update Vimeo.');
  }
}

main().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
