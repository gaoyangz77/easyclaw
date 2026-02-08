#!/usr/bin/env node
/**
 * Patch OpenClaw bundler bug: inline __exportAll function in all affected files
 *
 * This script replaces:
 *   import { Br as __exportAll } from "./loader-dMjP-sfw.js";
 *
 * With the inlined function definition:
 *   const __exportAll = (all, no_symbols) => { ... }
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const INLINE_EXPORT_ALL = `// Inlined __exportAll function to work around bundler issue
const __exportAll = (all, no_symbols) => {
\tlet target = {};
\tfor (var name in all) {
\t\tif (name !== "default" && !no_symbols?.includes(name)) {
\t\t\tObject.defineProperty(target, name, {
\t\t\t\tget: all[name],
\t\t\t\tenumerable: true
\t\t\t});
\t\t}
\t}
\treturn target;
};`;

// Pattern to match the problematic import
const IMPORT_PATTERN = /import\s*\{\s*\w+\s+as\s+__exportAll\s*\}\s*from\s*["']\.\/[^"']+["'];?\s*/;

async function patchFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');

    // Check if file has the problematic import
    if (!IMPORT_PATTERN.test(content)) {
      return { patched: false, reason: 'no import found' };
    }

    // Check if already patched
    if (content.includes('Inlined __exportAll function')) {
      return { patched: false, reason: 'already patched' };
    }

    // Replace the import with the inlined function
    const patched = content.replace(IMPORT_PATTERN, INLINE_EXPORT_ALL + '\n');

    if (patched === content) {
      return { patched: false, reason: 'replacement failed' };
    }

    writeFileSync(filePath, patched, 'utf-8');
    return { patched: true };

  } catch (err) {
    return { patched: false, reason: `error: ${err.message}` };
  }
}

async function main() {
  console.log('Searching for files with __exportAll import...');

  const distDir = join(process.cwd(), 'vendor/openclaw/dist');
  const files = readdirSync(distDir)
    .filter(f => f.endsWith('.js'))
    .map(f => join(distDir, f));

  console.log(`Found ${files.length} JS files in vendor/openclaw/dist/\n`);

  let patchedCount = 0;
  let skippedCount = 0;

  for (const file of files) {
    const result = await patchFile(file);

    if (result.patched) {
      patchedCount++;
      console.log(`✅ Patched: ${file}`);
    } else {
      skippedCount++;
      // console.log(`⏭️  Skipped: ${file} (${result.reason})`);
    }
  }

  console.log(`\n✨ Done! Patched ${patchedCount} files, skipped ${skippedCount} files.`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
