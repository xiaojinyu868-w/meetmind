#!/usr/bin/env node
// console.log cleanup script
// Handles multi-line console.log calls by tracking parenthesis depth
// Preserves console.error and console.warn
// Usage: node scripts/clean-console-logs.js [--dry-run]

const fs = require('fs');
const path = require('path');

const DRY_RUN = process.argv.includes('--dry-run');
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

let totalRemoved = 0;
let totalFiles = 0;

const SKIP_FILES = new Set([
  'src/lib/config.ts',
  'src/lib/logger.ts',
]);

function countChar(str, ch) {
  let n = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ch) n++;
  }
  return n;
}

function processFile(filePath) {
  const relPath = path.relative(ROOT, filePath);
  if (SKIP_FILES.has(relPath)) return;

  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  let removedInFile = 0;
  const newLines = [];

  let inConsoleLog = false;  // are we inside a multi-line console.log?
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (inConsoleLog) {
      // Continue tracking until parens balance
      parenDepth += countChar(line, '(') - countChar(line, ')');
      if (parenDepth <= 0) {
        inConsoleLog = false;
        parenDepth = 0;
      }
      // Skip this line (part of the console.log call)
      continue;
    }

    // Detect console.log start (but NOT console.error or console.warn)
    if (/^\s*console\.log\s*\(/.test(trimmed)) {
      removedInFile++;
      // Check if it's multi-line (parens don't balance on this line)
      const depth = countChar(line, '(') - countChar(line, ')');
      if (depth > 0) {
        inConsoleLog = true;
        parenDepth = depth;
      }
      continue;
    }

    newLines.push(line);
  }

  if (removedInFile > 0) {
    // Clean up consecutive empty lines (max 1)
    const cleanedLines = [];
    let prevEmpty = false;
    for (const line of newLines) {
      const isEmpty = line.trim() === '';
      if (isEmpty && prevEmpty) continue;
      cleanedLines.push(line);
      prevEmpty = isEmpty;
    }

    if (!DRY_RUN) {
      fs.writeFileSync(filePath, cleanedLines.join('\n'), 'utf8');
    }
    console.log('  ' + relPath + ': removed ' + removedInFile + ' console.log(s)');
    totalRemoved += removedInFile;
    totalFiles++;
  }
}

function walkDir(dir, exts) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'ui') continue;
      files.push(...walkDir(full, exts));
    } else if (exts.some(ext => entry.name.endsWith(ext))) {
      files.push(full);
    }
  }
  return files;
}

console.log(DRY_RUN ? '=== DRY RUN ===' : '=== CLEANING ===');
console.log('');

console.log('Service files:');
for (const f of walkDir(path.join(SRC, 'lib', 'services'), ['.ts'])) processFile(f);

console.log('\nAPI routes:');
for (const f of walkDir(path.join(SRC, 'app', 'api'), ['.ts'])) processFile(f);

console.log('\nOther server files:');
for (const f of walkDir(path.join(SRC, 'lib'), ['.ts'])) {
  if (!f.includes('/services/')) processFile(f);
}

console.log('\nClient components:');
for (const f of walkDir(path.join(SRC, 'components'), ['.tsx'])) processFile(f);

console.log('\nClient hooks:');
for (const f of walkDir(path.join(SRC, 'hooks'), ['.ts', '.tsx'])) processFile(f);
for (const f of walkDir(path.join(SRC, 'lib', 'hooks'), ['.ts', '.tsx'])) processFile(f);

console.log('\nPage files:');
for (const f of walkDir(path.join(SRC, 'app', '(main)'), ['.tsx'])) processFile(f);

console.log('\n---');
console.log('Total: ' + totalRemoved + ' console.log(s) removed from ' + totalFiles + ' files');
if (DRY_RUN) console.log('(dry run - no files modified)');
