// fix_steps.cjs
// Converts bold step labels into Markdown h3 headers across all .md files.
//
// Before:  **Step 1:** Begin documenting from the appointment card.
// After:   ### Step 1: Begin documenting from the appointment card.
//
// Handles both forms:
//   **Step N:**   (with colon)
//   **Step N**    (without colon)

const fs   = require('fs');
const path = require('path');

const DOCS_DIR = path.resolve(__dirname, 'src/content/docs');

function findMdFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...findMdFiles(full));
    else if (entry.name.endsWith('.md')) results.push(full);
  }
  return results;
}

const files = findMdFiles(DOCS_DIR);
let fixed = 0;
let unchanged = 0;

for (const filePath of files) {
  const original = fs.readFileSync(filePath, 'utf8');

  // Match **Step N:** or **Step N** (N = one or more digits)
  // Captures the label including the optional colon so it is preserved.
  const updated = original.replace(/\*\*(Step\s+\d+:?)\*\*/g, '### $1');

  if (updated !== original) {
    fs.writeFileSync(filePath, updated, 'utf8');
    const rel = path.relative(process.cwd(), filePath);
    console.log(`  ✔  Fixed: ${rel}`);
    fixed++;
  } else {
    unchanged++;
  }
}

console.log(`
──────────────────────────────────────────
Done.
  ✔  Files updated   : ${fixed}
  –  Files unchanged : ${unchanged}
──────────────────────────────────────────`);
