#!/usr/bin/env node
// Minimal smoke test: serves the app locally, boots it in headless Chromium,
// and checks that each primary tab renders with zero console errors. Not a
// substitute for real test coverage — this exists so a broken push (bad
// selector, syntax slip that only shows up at runtime, a tag-balance issue
// that somehow slipped past check-html-balance) fails CI instead of failing
// silently in production.

import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 8913;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2'
};

function startServer() {
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent(req.url.split('?')[0]);
      const filePath = join(ROOT, urlPath === '/' ? '/index.html' : urlPath);
      const data = await readFile(filePath);
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function isSupabaseApp(html) {
  return html.includes('supabase');
}

async function main() {
  const indexHtml = await readFile(join(ROOT, 'index.html'), 'utf8');
  const needsSupabaseMock = isSupabaseApp(indexHtml);

  const server = await startServer();
  const browser = await chromium.launch();
  const errors = [];
  let failed = false;

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    page.on('pageerror', (exc) => errors.push(String(exc)));

    if (needsSupabaseMock) {
      await page.addInitScript(() => {
        function chain() {
          const o = {
            select() { return o; },
            order() { return Promise.resolve({ data: [], error: null }); },
            insert() { return Promise.resolve({ error: null }); },
            update() { return o; },
            delete() { return o; },
            eq() { return Promise.resolve({ error: null }); }
          };
          return o;
        }
        window.supabase = {
          createClient: () => ({
            auth: {
              getSession: async () => ({ data: { session: { user: { id: 'smoke-test', email: 'smoke@test.local' } } } }),
              signOut: async () => ({ error: null })
            },
            from: () => chain()
          })
        };
      });
    }

    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.waitForTimeout(800);

    const ackBtn = await page.$('#firstRunAckBtn');
    if (ackBtn) { await ackBtn.click(); await page.waitForTimeout(200); }

    const tabs = ['home', 'calendar', 'trips', 'settings'];
    for (const tab of tabs) {
      await page.click(`[data-tab="${tab}"]`);
      await page.waitForTimeout(300);
      const visible = await page.$eval(`#tab-${tab}`, (el) => el.checkVisibility());
      if (!visible) {
        failed = true;
        console.error(`✗ tab "${tab}" did not become visible after click`);
      }
    }

    // CDN-hosted assets (flag-icons, the Supabase client) can fail to load under a
    // restrictive network policy without indicating an app bug — filter that class
    // of noise out, but let every other console error fail the run.
    const realErrors = errors.filter((e) => !/ERR_TUNNEL|ERR_FAILED|ERR_NAME_NOT_RESOLVED|404 \(Not Found\)/.test(e));
    if (realErrors.length) {
      failed = true;
      console.error(`✗ ${realErrors.length} console error(s) during smoke test:`);
      for (const e of realErrors) console.error(`    ${e}`);
    }
  } finally {
    await browser.close();
    server.close();
  }

  if (failed) {
    console.error('\n✗ smoke test failed');
    process.exit(1);
  } else {
    console.log(`✓ smoke test passed — all ${4} tabs render with zero console errors`);
  }
}

main();
