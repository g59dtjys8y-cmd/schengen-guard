#!/usr/bin/env node
// Schengen Guard / Schengen Guard Anywhere are two independently-maintained repos
// that share ~90% of their markup and logic with no shared code path — every
// feature has to be hand-ported between them. This script catches unintentional
// drift by diffing element ids between the two index.html files: anything that
// exists in only one repo must be explicitly listed in parity-allowlist.json as
// an intentional, feature-driven difference (e.g. sign-in ids only exist in the
// cloud-synced app). Anything else is flagged as a probable missed port.
//
// Usage: node scripts/check-parity.mjs <path-to-sibling-repo>

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const selfRoot = join(here, '..');
const siblingRoot = process.argv[2];

if (!siblingRoot || !existsSync(join(siblingRoot, 'index.html'))) {
  console.error('Usage: node scripts/check-parity.mjs <path-to-sibling-repo-checkout>');
  console.error('  (expects <path>/index.html to exist)');
  process.exit(2);
}

function extractIds(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const ids = new Set();
  for (const m of html.matchAll(/\bid="([a-zA-Z0-9_-]+)"/g)) ids.add(m[1]);
  return ids;
}

function appName(root) {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const m = html.match(/<title>(.*?)<\/title>/);
  return m ? m[1] : root;
}

const selfIds = extractIds(join(selfRoot, 'index.html'));
const siblingIds = extractIds(join(siblingRoot, 'index.html'));
const selfName = appName(selfRoot);
const siblingName = appName(siblingRoot);

// Allowlist entries are { "id": "reason it's intentionally one-sided" } so the
// file documents *why*, not just *that*, an id is app-specific.
const allowlistPath = join(here, 'parity-allowlist.json');
const allowlist = existsSync(allowlistPath) ? JSON.parse(readFileSync(allowlistPath, 'utf8')) : { selfOnly: {}, siblingOnly: {} };
const selfOnlyAllowed = new Set(Object.keys(allowlist.selfOnly || {}));
const siblingOnlyAllowed = new Set(Object.keys(allowlist.siblingOnly || {}));

const onlyInSelf = [...selfIds].filter(id => !siblingIds.has(id)).sort();
const onlyInSibling = [...siblingIds].filter(id => !selfIds.has(id)).sort();

const unexpectedSelfOnly = onlyInSelf.filter(id => !selfOnlyAllowed.has(id));
const unexpectedSiblingOnly = onlyInSibling.filter(id => !siblingOnlyAllowed.has(id));

const staleSelfOnlyAllowlist = [...selfOnlyAllowed].filter(id => !onlyInSelf.includes(id));
const staleSiblingOnlyAllowlist = [...siblingOnlyAllowed].filter(id => !onlyInSibling.includes(id));

let ok = true;

if (unexpectedSelfOnly.length) {
  ok = false;
  console.error(`\n✗ ids present in "${selfName}" but missing from "${siblingName}" (not in allowlist):`);
  for (const id of unexpectedSelfOnly) console.error(`    #${id}`);
  console.error('  → either port the feature to the sibling repo, or add the id to selfOnly in parity-allowlist.json with a reason.');
}

if (unexpectedSiblingOnly.length) {
  ok = false;
  console.error(`\n✗ ids present in "${siblingName}" but missing from "${selfName}" (not in allowlist):`);
  for (const id of unexpectedSiblingOnly) console.error(`    #${id}`);
  console.error('  → either port the feature to this repo, or add the id to siblingOnly in parity-allowlist.json with a reason.');
}

if (staleSelfOnlyAllowlist.length || staleSiblingOnlyAllowlist.length) {
  console.warn('\n⚠ stale allowlist entries (id no longer differs — safe to remove from parity-allowlist.json):');
  for (const id of staleSelfOnlyAllowlist) console.warn(`    selfOnly: #${id}`);
  for (const id of staleSiblingOnlyAllowlist) console.warn(`    siblingOnly: #${id}`);
}

if (ok) {
  console.log(`✓ parity check passed — ${selfIds.size} ids in "${selfName}", ${siblingIds.size} in "${siblingName}", all differences accounted for.`);
  process.exit(0);
} else {
  console.error('');
  process.exit(1);
}
