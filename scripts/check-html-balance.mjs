#!/usr/bin/env node
// Stack-based HTML tag balance check for index.html. Unlike a plain open/close
// *count* comparison (easy to fool — e.g. a swapped </div></details> still
// balances by count), this actually tracks nesting order and reports the first
// point of mismatch, plus any tags left open at end of file.
//
// Usage: node scripts/check-html-balance.mjs [path-to-index.html]

import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'index.html';
const html = readFileSync(path, 'utf8').replace(/<script\b[\s\S]*?<\/script>/gi, '');

const VOID_ELEMENTS = new Set([
  'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'
]);

const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?(\/?)>/g;
const stack = [];
let match;
let lineOf = (index) => html.slice(0, index).split('\n').length;
let errors = [];

while ((match = tagRe.exec(html))) {
  const [full, name, selfClose] = match;
  const tag = name.toLowerCase();
  const isClosing = full.startsWith('</');

  if (VOID_ELEMENTS.has(tag) || selfClose === '/') continue;

  if (isClosing) {
    if (stack.length === 0 || stack[stack.length - 1].tag !== tag) {
      const expected = stack.length ? stack[stack.length - 1].tag : '(nothing open)';
      errors.push(`line ${lineOf(match.index)}: found </${tag}> but expected </${expected}>`);
      // best-effort recovery: pop matching tag if it exists deeper in the stack
      const idx = stack.map(s => s.tag).lastIndexOf(tag);
      if (idx !== -1) stack.length = idx;
    } else {
      stack.pop();
    }
  } else {
    stack.push({ tag, line: lineOf(match.index) });
  }
}

if (stack.length) {
  for (const s of stack) errors.push(`line ${s.line}: <${s.tag}> never closed`);
}

if (errors.length) {
  console.error(`✗ ${path}: ${errors.length} tag-balance issue(s)`);
  for (const e of errors) console.error(`    ${e}`);
  process.exit(1);
} else {
  console.log(`✓ ${path}: tags balanced`);
}
