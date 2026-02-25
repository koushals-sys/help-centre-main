// refine_content.cjs
// Fixes Step formatting in all .md files under src/content/docs.
//
// Problems it solves:
//  1. "textStep 1:"        → text\n\n**Step 1:**
//  2. "**Step 1: full text**" → \n\n**Step 1:** full text  (only label is bold)
//  3. "\nStep 1:"          → \n\n**Step 1:**             (single newline → double + bold)
//  4. "\n\nStep 1:"        → \n\n**Step 1:**             (no bold → add bold)

const fs   = require('fs');
const path = require('path');

const DOCS_DIR = path.resolve(__dirname, 'src/content/docs');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Recursively collect all .md files under a directory. */
function findMdFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findMdFiles(full));
    } else if (entry.name.endsWith('.md')) {
      results.push(full);
    }
  }
  return results;
}

/** Apply all formatting fixes to a file's content string. */
function fixContent(content) {
  // ── 1. Unwrap fully-bolded step lines ──────────────────────────────────────
  // "**Step 3: Some text.**"  →  "Step 3: Some text."
  // Captures the label (Step N:) and the trailing text separately so we can
  // re-bold only the label in step 4.
  content = content.replace(/\*\*(Step\s+\d+[:.])([^*]*)\*\*/g, '$1$2');

  // ── 2. Insert double newline before any Step that is glued to prior text ───
  // Handles "...sentence.Step 1:" or "...sentence. Step 1:"
  content = content.replace(/([^\n])(Step\s+\d+[:.]\s)/g, '$1\n\n$2');

  // ── 3. Upgrade single newline before Step to double newline ────────────────
  // "\nStep 1:" → "\n\nStep 1:"
  content = content.replace(/\n(Step\s+\d+[:.]\s)/g, '\n\n$1');

  // ── 4. Bold every Step N: / Step N. label ─────────────────────────────────
  // At this point all step labels are plain text; wrap label only (not full line)
  content = content.replace(/(Step\s+\d+[:.])(\s)/g, '**$1**$2');

  // ── 5. Collapse 3+ consecutive newlines down to 2 ─────────────────────────
  content = content.replace(/\n{3,}/g, '\n\n');

  return content;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const files = findMdFiles(DOCS_DIR);
let fixed = 0;
let unchanged = 0;

for (const filePath of files) {
  const original = fs.readFileSync(filePath, 'utf8');
  const updated  = fixContent(original);

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
Formatting complete.
  ✔  Files updated   : ${fixed}
  –  Files unchanged : ${unchanged}
──────────────────────────────────────────`);
