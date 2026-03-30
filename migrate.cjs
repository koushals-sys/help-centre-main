// migrate.js
// Migrates SpryHealth export (CSV + RTF articles) into Astro Starlight markdown files.

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const fse = require('fs-extra');
const axios = require('axios');

// ─── Paths ────────────────────────────────────────────────────────────────────
const CSV_FILE    = path.resolve(__dirname, '../spryhealth_Export/combined_export_metadata.csv');
const ARTICLES_DIR = path.resolve(__dirname, '../spryhealth_Export/articles');
const DOCS_DIR    = path.resolve(__dirname, 'src/content/docs');
const VIDEOS_DIR  = path.resolve(__dirname, 'public/videos');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strip RTF control codes and return plain text.
 * The exported files appear to be plain text already, but this acts as a
 * safety net in case any file has actual RTF encoding.
 */
function stripRtf(content) {
  if (!content.trim().startsWith('{\\rtf')) {
    return content.trim();
  }

  let text = content;
  // Remove ignorable destination groups  (e.g. {\*\generator ...})
  text = text.replace(/\{\\[*][^}]*\}/gs, '');
  // Remove common metadata blocks
  text = text.replace(/\{\\fonttbl[\s\S]*?\}/g, '');
  text = text.replace(/\{\\colortbl[\s\S]*?\}/g, '');
  text = text.replace(/\{\\stylesheet[\s\S]*?\}/g, '');
  text = text.replace(/\{\\info[\s\S]*?\}/g, '');
  // Paragraph / line breaks
  text = text.replace(/\\par\b\s*/g, '\n');
  text = text.replace(/\\line\b\s*/g, '\n');
  text = text.replace(/\\tab\b/g, '  ');
  // Hex-encoded characters  \'xx
  text = text.replace(/\\'[0-9a-fA-F]{2}/g, '');
  // Remaining control words  \word  or  \word123
  text = text.replace(/\\[a-zA-Z]+\d*[ ]?/g, '');
  // Strip curly braces
  text = text.replace(/[{}]/g, '');
  // Normalise whitespace
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0)
    .join('\n')
    .trim();
}

/**
 * Generate a URL-safe slug from any string.
 * e.g. "Adding a User to the Dashboard" → "adding-a-user-to-the-dashboard"
 */
function toSlug(str) {
  return str
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')   // remove non-alphanumeric (keep spaces & hyphens)
    .replace(/\s+/g, '-')            // spaces → hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .replace(/^-|-$/g, '');          // trim leading/trailing hyphens
}

/**
 * Convert a CSV Path string into a relative folder path.
 * "Clinician's Module  >> Documentation Features " → "clinicians-module/documentation-features"
 * "" → ""  (root docs dir)
 */
function pathToFolder(pathStr) {
  return pathStr
    .split('>>')
    .map(segment => toSlug(segment))
    .filter(s => s.length > 0)
    .join('/');
}

/**
 * Convert the plain-text article content into readable Markdown.
 * - Intro sentence  → plain paragraph
 * - "Step N:" lines → bold heading
 * - Closing "Thank you" → italic footer
 */
function textToMarkdown(text) {
  const lines = text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);

  const out = [];

  for (const line of lines) {
    if (/^step\s+\d+:/i.test(line)) {
      // Step line → bold
      out.push(`\n**${line}**\n`);
    } else if (/^thank you/i.test(line)) {
      // Closing line → italic separator
      out.push(`\n---\n\n*${line}*`);
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

/**
 * Download a video from `url` and save it to `destPath`.
 * Streams the response so large files don't load into memory.
 */
async function downloadVideo(url, destPath) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 120_000,         // 2 minutes per video
  });

  const writer = fs.createWriteStream(destPath);
  response.data.pipe(writer);

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function migrate() {
  // Ensure output directories exist
  fse.ensureDirSync(DOCS_DIR);
  fse.ensureDirSync(VIDEOS_DIR);

  // 1. Parse the CSV
  const rows = await new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(CSV_FILE)
      .pipe(csv())
      .on('data', row => results.push(row))
      .on('end', () => resolve(results))
      .on('error', reject);
  });

  console.log(`\nFound ${rows.length} articles to migrate.\n`);

  let successCount = 0;
  let skipCount    = 0;

  // 2. Process each row
  for (const row of rows) {
    const title       = (row['Guide Name']   || '').trim();
    const pathStr     = (row['Path']         || '').trim();
    const articleFile = (row['Article Files']|| '').trim();
    const videoUrl    = (row['Video Link']   || '').trim();

    if (!title) {
      console.warn('⚠  Skipping row with empty Guide Name.');
      skipCount++;
      continue;
    }

    const slug       = toSlug(title);
    const folder     = pathToFolder(pathStr);
    const outputDir  = folder
      ? path.join(DOCS_DIR, folder)
      : DOCS_DIR;

    console.log(`→ Processing: "${title}"`);

    // Ensure the nested folder exists
    fse.ensureDirSync(outputDir);

    // 3. Read & clean article text
    let bodyMarkdown = '';
    if (articleFile) {
      const rtfPath = path.join(ARTICLES_DIR, articleFile);
      if (fse.existsSync(rtfPath)) {
        const raw = fs.readFileSync(rtfPath, 'utf8');
        const plain = stripRtf(raw);
        bodyMarkdown = textToMarkdown(plain);
      } else {
        console.warn(`  ⚠  RTF file not found: ${articleFile}`);
      }
    }

    // 4. Download video (with fallback to original URL)
    let videoSrc = videoUrl;   // default: use remote URL as fallback
    if (videoUrl) {
      const videoDestPath = path.join(VIDEOS_DIR, `${slug}.mp4`);
      try {
        process.stdout.write(`  ↓  Downloading video...`);
        await downloadVideo(videoUrl, videoDestPath);
        videoSrc = `/videos/${slug}.mp4`;
        console.log(` done.`);
      } catch (err) {
        console.log('');
        console.error(`  ✗  Video download failed (${err.message}). Using remote URL as fallback.`);
        // videoSrc already set to videoUrl
      }
    }

    // 5. Build the markdown file content
    const safeTitle = title.replace(/"/g, '\\"');

    const frontmatter = `---
title: "${safeTitle}"
description: "Guide for ${safeTitle}"
---`;

    const videoTag = videoSrc
      ? `<video controls src="${videoSrc}" style="width: 100%"></video>`
      : '';

    const mdContent = [frontmatter, videoTag, bodyMarkdown]
      .filter(s => s.trim().length > 0)
      .join('\n\n') + '\n';

    // 6. Write the markdown file
    const mdFilePath = path.join(outputDir, `${slug}.md`);
    fs.writeFileSync(mdFilePath, mdContent, 'utf8');

    console.log(`  ✔  Created: src/content/docs/${folder ? folder + '/' : ''}${slug}.md`);
    successCount++;
  }

  console.log(`
──────────────────────────────────────────
Migration complete.
  ✔  Created : ${successCount} articles
  ⚠  Skipped : ${skipCount} rows
──────────────────────────────────────────`);
}

migrate().catch(err => {
  console.error('\nFatal error during migration:', err);
  process.exit(1);
});
