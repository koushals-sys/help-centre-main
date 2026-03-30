// export_webflow_csv.cjs
// Exports Markdown/MDX docs into Webflow-friendly CSV files.

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

const DOCS_DIR = path.resolve(__dirname, 'src/content/docs');
const OUT_DIR = path.resolve(__dirname, 'webflow_export');

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function toTitleCase(slug) {
  return slug
    .split(/[-_]/g)
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function slugifyPath(pathStr) {
  return pathStr
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9\-/_]/g, '')
    .replace(/\//g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function findMarkdownFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMarkdownFiles(full));
    } else if (entry.name.endsWith('.md') || entry.name.endsWith('.mdx')) {
      results.push(full);
    }
  }
  return results;
}

function csvEscape(value) {
  const str = value == null ? '' : String(value);
  const escaped = str.replace(/"/g, '""');
  return `"${escaped}"`;
}

function writeCsv(filePath, headers, rows) {
  const lines = [];
  lines.push(headers.map(csvEscape).join(','));
  for (const row of rows) {
    lines.push(headers.map(h => csvEscape(row[h])).join(','));
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

function collectCategories(pathSegments) {
  const categories = [];
  let currentPath = '';
  for (const segment of pathSegments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    const parentPath = currentPath.includes('/')
      ? currentPath.split('/').slice(0, -1).join('/')
      : '';
    categories.push({
      name: toTitleCase(segment),
      slug: slugifyPath(currentPath),
      parentSlug: parentPath ? slugifyPath(parentPath) : '',
      fullPath: currentPath,
    });
  }
  return categories;
}

ensureDir(OUT_DIR);

const files = findMarkdownFiles(DOCS_DIR);
const articles = [];
const categoryMap = new Map();

for (const filePath of files) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = matter(raw);

  const relPath = path.relative(DOCS_DIR, filePath);
  const relPosix = relPath.split(path.sep).join('/');
  const dir = path.posix.dirname(relPosix) === '.' ? '' : path.posix.dirname(relPosix);
  const fileName = path.posix.basename(relPosix);
  const slug = fileName.replace(/\.mdx?$/, '');

  const pathSegments = dir ? dir.split('/') : [];
  const title = parsed.data.title || toTitleCase(slug);
  const description = parsed.data.description || '';
  const video = parsed.data.video || '';

  const html = marked.parse(parsed.content);

  const categorySlug = pathSegments.length > 0 ? slugifyPath(pathSegments[0]) : '';
  const fullPathSlug = dir ? slugifyPath(dir) : '';

  // Collect category chain for this path.
  for (const category of collectCategories(pathSegments)) {
    const key = category.fullPath;
    if (!categoryMap.has(key)) {
      categoryMap.set(key, category);
    }
  }

  articles.push({
    Name: title,
    Slug: slug,
    Summary: description,
    Body: html,
    Path: dir,
    CategorySlug: categorySlug,
    CategoryPathSlug: fullPathSlug,
    VideoUrl: video,
    SourceFile: relPosix,
  });
}

const categories = Array.from(categoryMap.values()).sort((a, b) => {
  if (a.fullPath < b.fullPath) return -1;
  if (a.fullPath > b.fullPath) return 1;
  return 0;
});

writeCsv(
  path.join(OUT_DIR, 'categories.csv'),
  ['Name', 'Slug', 'ParentSlug', 'FullPath'],
  categories.map(c => ({
    Name: c.name,
    Slug: c.slug,
    ParentSlug: c.parentSlug,
    FullPath: c.fullPath,
  }))
);

writeCsv(
  path.join(OUT_DIR, 'articles.csv'),
  ['Name', 'Slug', 'Summary', 'Body', 'Path', 'CategorySlug', 'CategoryPathSlug', 'VideoUrl', 'SourceFile'],
  articles
);

console.log(`Exported ${articles.length} articles to ${path.join(OUT_DIR, 'articles.csv')}`);
console.log(`Exported ${categories.length} categories to ${path.join(OUT_DIR, 'categories.csv')}`);
