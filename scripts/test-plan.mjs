#!/usr/bin/env node
// Comprehensive functional test plan, executed against a live instance of the app.
// This goes well beyond scripts/smoke-test.mjs (which only checks that each tab
// renders with zero console errors) — it drives real user flows (logging a stay,
// editing, removing, importing a backup, changing settings) and asserts on the
// resulting UI state, plus the boundary/edge cases documented in
// test-data/README.md.
//
// "All possible iterations and scenarios" is not a finite target — the plan below
// is deliberately scoped to: every primary screen and its main interactive flows,
// every documented edge case in the stress-test fixture, and the cross-cutting
// checks (console errors, XSS-safety, dark mode) that matter regardless of screen.
// Anything not listed is out of scope for this pass — see the "Known gaps" section
// printed at the end of a run.
//
// Usage: node scripts/test-plan.mjs [--json <output-path>]

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 8914;
const TODAY = '2026-08-17'; // fixed reference date used throughout this session

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

// ---------------------------------------------------------------------------
// Result collection
// ---------------------------------------------------------------------------

const results = []; // { group, id, name, status: 'pass'|'fail', error? }
let currentGroup = null;
let currentPage = null;
let lastPrintedGroup = null;
const consoleErrorsByGroup = new Map();

function isRealConsoleError(text) {
  return !/ERR_TUNNEL|ERR_FAILED|ERR_NAME_NOT_RESOLVED|404 \(Not Found\)/.test(text);
}

// Print every result the moment it's known, rather than buffering to the end —
// a crash mid-run (uncaught error, a hung click) must never cost us the record
// of everything that already passed or failed before it.
function report(r) {
  results.push(r);
  if (r.group !== lastPrintedGroup) {
    console.log(`\n${r.group}`);
    lastPrintedGroup = r.group;
  }
  if (r.status === 'pass') console.log(`  ✓ ${r.id}  ${r.name}`);
  else console.log(`  ✗ ${r.id}  ${r.name}\n      ${r.error}`);
}

async function check(id, name, fn) {
  try {
    await fn();
    report({ group: currentGroup, id, name, status: 'pass' });
  } catch (err) {
    report({ group: currentGroup, id, name, status: 'fail', error: String(err && err.message || err) });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ---------------------------------------------------------------------------
// App plumbing — mirrors scripts/smoke-test.mjs's approach to booting the app,
// extended with a seeding helper so each test group can start from known data.
// ---------------------------------------------------------------------------

let browser;
let needsSupabaseMock;

// A *stateful* fake `trips` table — not just a canned response. insertTrip,
// updateTrip, deleteTrip, and the backup-import flow all write via
// insert/update/delete and then immediately re-read via select().order() to
// refresh the in-memory `trips` array; a mock that always returns the original
// seed data (as a plain canned-response mock would) makes every write silently
// vanish on the next read, which looks exactly like an app bug but isn't one.
function supabaseMockScript() {
  return (tripsData) => {
    let table = tripsData.slice();
    let nextId = 1;
    function chain() {
      let mode = null;
      let pendingUpdate = null;
      const o = {
        select() { mode = 'select'; return o; },
        order() { return Promise.resolve({ data: table.slice(), error: null }); },
        insert(rows) {
          for (const r of (Array.isArray(rows) ? rows : [rows])) {
            table.push({ id: r.id || `mock-${nextId++}`, ...r });
          }
          return Promise.resolve({ error: null });
        },
        update(fields) { mode = 'update'; pendingUpdate = fields; return o; },
        delete() { mode = 'delete'; return o; },
        eq(col, val) {
          if (mode === 'update') {
            table = table.map((r) => (r.id === val ? { ...r, ...pendingUpdate } : r));
          } else if (mode === 'delete') {
            table = col === 'user_id' ? [] : table.filter((r) => r[col] !== val);
          }
          return Promise.resolve({ error: null });
        }
      };
      return o;
    }
    // Defined non-writable: a real CDN-loaded supabase-js UMD bundle assigning
    // `global.supabase = factory()` later (e.g. if route interception loses a
    // race on a real network) silently no-ops instead of clobbering the mock.
    Object.defineProperty(window, 'supabase', {
      value: {
        createClient: () => ({
          auth: {
            getSession: async () => ({ data: { session: { user: { id: 'test-plan', email: 'test-plan@test.local' } } } }),
            signOut: async () => ({ error: null })
          },
          from: () => chain()
        })
      },
      writable: false,
      configurable: false
    });
  };
}

// trips use the local schema { id, start, end, label, excludedRanges, note } —
// converted to the anywhere/Supabase row shape when mocking that app.
function toSupabaseRows(trips) {
  return trips.map(t => ({
    id: t.id, start_date: t.start, end_date: t.end, country: t.label,
    excluded_ranges: t.excludedRanges || [], note: t.note || ''
  }));
}

let sharedContext = null;

async function openPage(trips = []) {
  // One shared context for the whole run, a fresh *page* per group, with
  // storage explicitly cleared before each navigation. An earlier version of
  // this harness spun up a brand-new incognito browser context per group, which
  // is the textbook-correct way to isolate tests — but under this sandbox's
  // variable CPU availability, ~15 back-to-back full context launches produced
  // intermittent first-run-modal timeouts that had nothing to do with the app.
  // Reusing one context avoids that overhead while keeping the same isolation
  // guarantee (nothing carries over between groups) via an explicit storage wipe.
  if (!sharedContext) sharedContext = await browser.newContext();
  const page = await sharedContext.newPage({ viewport: { width: 390, height: 1400 } });
  const errs = [];
  page.on('console', (msg) => { if (msg.type() === 'error' && isRealConsoleError(msg.text())) errs.push(msg.text()); });
  page.on('pageerror', (exc) => errs.push(String(exc)));
  page.on('dialog', async (dialog) => { await dialog.accept(); }); // auto-accept confirm()s (e.g. overlap warning)

  if (needsSupabaseMock) {
    // Register the mock (and the CDN-blocking route) *before* the first
    // navigation, not goto-then-reload — an earlier version let the app's
    // first, unmocked load run script.js's top-level `window.supabase.
    // createClient(...)`, which throws in this sandbox (no route reachable
    // yet, window.supabase genuinely undefined). That pageerror got captured
    // into this group's console-error log and never cleared, even though the
    // later reload() with the mock active made every functional check pass —
    // it only ever showed up in the O-final cross-cutting error sweep.
    // localStorage still needs clearing before the app's own init IIFE reads
    // it (stale theme/notif/first-run prefs from a prior group sharing this
    // context) — addInitScript runs before any page script on every
    // navigation, so it's safe to clear synchronously right here too.
    await page.addInitScript(() => { localStorage.clear(); });
    // Fulfill with an empty script rather than aborting — on a real network (CI
    // runners, unlike this sandbox) abort() still let the real Supabase client
    // load moments later and clobber the mock. See scripts/smoke-test.mjs for
    // the full story.
    await page.route('**/supabase-js@*/**', (route) => route.fulfill({
      status: 200, contentType: 'application/javascript', body: '/* blocked in test */'
    }));
    await page.addInitScript(supabaseMockScript(), toSupabaseRows(trips));
    await page.goto(`http://localhost:${PORT}/index.html`);
  } else {
    await page.goto(`http://localhost:${PORT}/index.html`);
    await page.evaluate(async () => {
      localStorage.clear();
      if (window.indexedDB && indexedDB.databases) {
        const dbs = await indexedDB.databases();
        await Promise.all(dbs.map((d) => new Promise((res) => {
          const req = indexedDB.deleteDatabase(d.name);
          req.onsuccess = req.onerror = req.onblocked = res;
        })));
      }
    });
    await page.reload();
    // Wait for the app's own startup IIFE (which does its own loadTrips()+render()
    // against the empty DB) to fully settle before writing seed data underneath
    // it — racing it caused seeded trips to intermittently vanish, since our
    // dbPutAll could land in the middle of the app's own read/render cycle.
    await page.waitForFunction(() => document.getElementById('ringN')?.textContent !== '—', { timeout: 5000 });
    if (trips.length) {
      await page.evaluate(async (tripsData) => {
        await dbPutAll(tripsData.map(t => ({ ...t, note: t.note || '' })));
        await loadTrips();
        render();
      }, trips);
      await page.waitForTimeout(200);
    }
  }

  // Retry-based dismissal, not a single check-then-click: a plain "is it visible
  // right now, click once" proved intermittently unreliable under this sandbox's
  // variable load when many browser contexts spin up back to back. A transient
  // evaluate() failure (e.g. a frame still settling) must NOT be read as "modal
  // already closed" — that false negative was silently ending the retry loop
  // while the modal was still blocking every later click.
  for (let attempt = 0; attempt < 12; attempt++) {
    let stillOpen;
    try {
      stillOpen = await page.locator('#firstRunModal').evaluate((el) => getComputedStyle(el).display !== 'none');
    } catch {
      await page.waitForTimeout(300);
      continue; // couldn't confirm state — do NOT assume closed, just retry
    }
    if (!stillOpen) break;
    await page.locator('#firstRunAckBtn').click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  consoleErrorsByGroup.set(currentGroup, errs);
  currentPage = page;
  return page;
}

async function closePage() {
  if (currentPage) { await currentPage.close().catch(() => {}); }
  currentPage = null;
}

function group(name) {
  currentGroup = name;
}

// ---------------------------------------------------------------------------
// Fixture trip data for individual groups (small, hand-built — the full
// 39-trip stress-test.json is exercised separately as its own group)
// ---------------------------------------------------------------------------

const T = {
  activeAndNext: [
    { id: 'g-active', start: '2026-08-10', end: '2026-08-25', label: 'Spain', excludedRanges: [] },
    { id: 'g-next', start: '2026-09-05', end: '2026-09-15', label: 'Portugal', excludedRanges: [] }
  ],
  overstay: [
    // must still be ongoing today (2026-08-17) for the Active-trip panel to show it —
    // an end date in the past makes this a completed trip instead, not an active one.
    { id: 'g-over', start: '2026-05-01', end: '2026-08-25', label: 'Germany', excludedRanges: [] }
  ],
  editable: [
    { id: 'g-edit', start: '2026-10-01', end: '2026-10-10', label: 'Italy', excludedRanges: [], note: 'original note' }
  ],
  completed: [
    { id: 'g-past-1', start: '2024-01-01', end: '2024-01-05', label: 'France', excludedRanges: [] },
    { id: 'g-past-2', start: '2024-02-01', end: '2024-02-05', label: 'Belgium', excludedRanges: [] },
    { id: 'g-past-3', start: '2024-03-01', end: '2024-03-05', label: 'Austria', excludedRanges: [] }
  ],
  xssNote: [
    { id: 'g-xss', start: '2024-05-01', end: '2024-05-05', label: 'Malta', excludedRanges: [], note: '<script>window.__xssFired=true</script>plain text after' }
  ],
  boundary90: [
    { id: 'g-b90', start: '2025-01-01', end: '2025-03-31', label: 'Spain', excludedRanges: [] }
  ],
  boundary91: [
    { id: 'g-b91', start: '2025-01-01', end: '2025-04-01', label: 'Italy', excludedRanges: [] }
  ]
};

// ---------------------------------------------------------------------------
// Test groups
// ---------------------------------------------------------------------------

async function runGroups() {
  // A — Fresh install, no data
  group('A — Fresh install');
  {
    const page = await openPage([]);
    await check('A1', 'first-run modal dismisses and reveals the app', async () => {
      const bodyVisible = await page.$eval('#appBody', el => el.checkVisibility());
      assert(bodyVisible, '#appBody not visible after dismissing first-run modal');
    });
    await check('A2', 'Home ring shows 90 days left with no trips', async () => {
      const n = await page.$eval('#ringN', el => el.textContent.trim());
      assert(n === '90', `expected ring "90", got "${n}"`);
    });
    await check('A3', 'no Active/Next trip card shown, empty state shown instead', async () => {
      const activeVisible = await page.$eval('#activeTripPanel', el => el.checkVisibility());
      const emptyVisible = await page.$eval('#nextTripEmpty', el => el.checkVisibility());
      assert(!activeVisible, 'active trip panel should be hidden with no trips');
      assert(emptyVisible, 'empty next-trip state should be visible with no trips');
    });
    await check('A4', 'Trips tab shows empty state', async () => {
      await page.click('[data-tab="trips"]');
      await page.waitForTimeout(300);
      const text = await page.$eval('#tripRows', el => el.textContent);
      assert(/No stays logged yet/i.test(text), `Trips tab did not show empty-state text, got: ${text.slice(0,80)}`);
    });
    await check('A5', 'Countries visited shows 0 of 29', async () => {
      await page.click('[data-tab="settings"]');
      await page.waitForTimeout(300);
      const count = await page.$eval('#countriesCount', el => el.textContent.trim());
      assert(count === '0 of 29', `expected "0 of 29", got "${count}"`);
    });
    await check('A6', 'Log stay button disabled with no dates picked', async () => {
      await page.click('[data-tab="calendar"]');
      await page.waitForTimeout(300);
      const disabled = await page.$eval('#addTripBtn', el => el.disabled);
      assert(disabled, 'Log stay button should be disabled with no dates picked');
    });
    await closePage();
  }

  // B — Active + Next trip cards
  group('B — Active + Next trip cards');
  {
    const page = await openPage(T.activeAndNext);
    await check('B1', 'Home Active trip card shows correct country and Active tag', async () => {
      const visible = await page.$eval('#activeTripPanel', el => el.checkVisibility());
      const country = await page.$eval('#activeTripCountry', el => el.textContent.trim());
      const tag = await page.$eval('#activeTripTag', el => el.textContent.trim());
      assert(visible, 'active trip panel should be visible');
      assert(country === 'Spain', `expected Spain, got ${country}`);
      assert(tag === 'Active', `expected Active tag, got ${tag}`);
    });
    await check('B2', 'Home compact Next trip row shows when active trip also exists', async () => {
      const visible = await page.$eval('#nextTripCompact', el => el.checkVisibility());
      const country = await page.$eval('#nextTripCompactCountry', el => el.textContent.trim());
      assert(visible, 'compact next-trip row should be visible');
      assert(country === 'Portugal', `expected Portugal, got ${country}`);
    });
    await check('B3', 'Trips tab shows both trips with correct status tags', async () => {
      await page.click('[data-tab="trips"]');
      await page.waitForTimeout(400);
      const text = await page.$eval('#tripRows', el => el.textContent);
      assert(/Spain/.test(text) && /Portugal/.test(text), `expected both countries listed, got: ${text.slice(0,150)}`);
      const activeTagCount = await page.$$eval('#tripRows .tag-accent', els => els.filter(e => e.textContent.trim() === 'Active').length);
      const plannedTagCount = await page.$$eval('#tripRows .tag-outline', els => els.filter(e => e.textContent.trim() === 'Planned').length);
      assert(activeTagCount === 1, `expected 1 Active tag, got ${activeTagCount}`);
      assert(plannedTagCount === 1, `expected 1 Planned tag, got ${plannedTagCount}`);
    });
    await check('B4', '90/180 overview chart renders an SVG', async () => {
      const svgExists = await page.$('#checkerHistoryChartWrap svg');
      assert(svgExists, 'expected an svg inside the compliance chart wrap');
    });
    await closePage();
  }

  // C — Interactive add-trip flow
  group('C — Add-trip flow (interactive)');
  {
    const page = await openPage([]);
    await page.click('[data-tab="calendar"]');
    await page.waitForTimeout(300);

    await check('C1', 'picking entry+exit dates sets tags and enables Log stay', async () => {
      // re-query fresh each time — the grid re-renders after the entry-date click,
      // which detaches any previously-fetched ElementHandles for the same cells.
      const dayLocator = page.locator('#calGrid .cal-day:not(.pad)');
      await dayLocator.nth(9).click();
      await page.waitForTimeout(150);
      await dayLocator.nth(13).click();
      await page.waitForTimeout(200);
      const startLbl = await page.$eval('#pickStartLbl', el => el.textContent);
      const endLbl = await page.$eval('#pickEndLbl', el => el.textContent);
      const enabled = await page.$eval('#addTripBtn', el => !el.disabled);
      assert(!/—/.test(startLbl), `entry tag not set: ${startLbl}`);
      assert(!/—/.test(endLbl), `exit tag not set: ${endLbl}`);
      assert(enabled, 'Log stay button should be enabled once both dates are picked');
    });

    await check('C2', 'compliance preview shows a "safe" message for a short stay', async () => {
      const headline = await page.$eval('#verdictBanner .verdict-headline', el => el.textContent);
      assert(/fine/i.test(headline), `expected an "ok" verdict headline, got: ${headline}`);
    });

    await check('C3', '"How is this calculated?" breakdown modal opens and closes', async () => {
      await page.click('#editStayBreakdownBtn');
      await page.waitForTimeout(300);
      const openVisible = await page.$eval('#breakdownModal', el => el.checkVisibility());
      assert(openVisible, 'breakdown modal should open');
      await page.click('#breakdownCloseBtn');
      await page.waitForTimeout(200);
      const closedVisible = await page.$eval('#breakdownModal', el => el.checkVisibility());
      assert(!closedVisible, 'breakdown modal should close');
    });

    await check('C4', 'adding a note and saving shows it on the Trips list', async () => {
      await page.selectOption('#tripLabel', 'France');
      await page.fill('#tripNote', 'Automated test note');
      await page.click('#addTripBtn');
      await page.waitForTimeout(500);
      const visible = await page.$eval('#tab-trips', el => el.style.display !== 'none' || el.checkVisibility()).catch(() => true);
      await page.click('[data-tab="trips"]');
      await page.waitForTimeout(300);
      const text = await page.$eval('#tripRows', el => el.textContent);
      assert(/Automated test note/.test(text), `expected note text on trip row, got: ${text.slice(0, 200)}`);
    });
    await closePage();
  }

  // D — Overstay scenario
  group('D — Overstay scenario');
  {
    const page = await openPage(T.overstay);
    await check('D1', 'Home shows overstay state (Active trip tag = Overstay risk)', async () => {
      const tag = await page.$eval('#activeTripTag', el => el.textContent.trim());
      assert(tag === 'Overstay risk', `expected "Overstay risk", got "${tag}"`);
    });
    await check('D2', 'Quick check reflects days-over-limit copy', async () => {
      const body = await page.$eval('#lastDayBody', el => el.textContent);
      assert(/over/i.test(body), `expected "over" language in quick-check body, got: ${body}`);
    });
    await closePage();
  }

  // E — Edit / Remove
  group('E — Edit and remove a trip');
  {
    const page = await openPage(T.editable);
    await page.click('[data-tab="trips"]');
    await page.waitForTimeout(400);

    await check('E1', 'Edit prefills the calendar form with existing trip data', async () => {
      const editBtn = await page.$('[data-action="edit"]');
      assert(editBtn, 'no edit button found');
      await editBtn.click();
      await page.waitForTimeout(400);
      const country = await page.$eval('#tripLabel', el => el.value);
      const note = await page.$eval('#tripNote', el => el.value);
      assert(country === 'Italy', `expected Italy prefilled, got ${country}`);
      assert(note === 'original note', `expected original note prefilled, got "${note}"`);
    });

    await check('E2', 'Cancel edit returns to Trips tab without changes', async () => {
      await page.click('#cancelEditBtn');
      await page.waitForTimeout(300);
      const onTrips = await page.$eval('#tab-trips', el => el.checkVisibility());
      assert(onTrips, 'expected to land back on Trips tab after cancelling edit');
    });

    await check('E3', 'Remove deletes the trip from the list', async () => {
      const removeBtn = await page.$('[data-action="remove"]');
      assert(removeBtn, 'no remove button found');
      await removeBtn.click();
      await page.waitForTimeout(400);
      const text = await page.$eval('#tripRows', el => el.textContent);
      assert(!/Italy/.test(text), `expected Italy trip to be gone, tripRows still contains: ${text.slice(0,150)}`);
    });
    await closePage();
  }

  // F — Completed trips collapse group
  group('F — Completed trips collapse');
  {
    const page = await openPage(T.completed);
    await page.click('[data-tab="trips"]');
    await page.waitForTimeout(400);

    await check('F1', 'completed trips collapse into one group, collapsed by default', async () => {
      const details = await page.$('#tripRows details');
      assert(details, 'expected a details group for completed trips');
      const open = await details.evaluate(el => el.open);
      assert(!open, 'completed-trips group should be collapsed by default');
      const summaryText = await page.$eval('#tripRows details summary', el => el.textContent);
      assert(/Completed trips \(3\)/.test(summaryText), `expected "Completed trips (3)", got: ${summaryText}`);
    });

    await check('F2', 'expanding the group reveals all 3 completed trip rows', async () => {
      const details = await page.$('#tripRows details');
      await details.evaluate(el => el.open = true);
      await page.waitForTimeout(300);
      const rowCount = await page.$$eval('#tripRows details .trip-row', els => els.length);
      assert(rowCount === 3, `expected 3 completed trip rows, got ${rowCount}`);
    });
    await closePage();
  }

  // G — Full Calendar View
  group('G — Full Calendar View');
  {
    const page = await openPage([]);
    await page.click('[data-tab="calendar"]');
    await page.waitForTimeout(300);

    await check('G1', 'Full Calendar View is collapsed by default', async () => {
      const open = await page.$eval('#yearOverviewCard', el => el.open);
      assert(!open, 'Full Calendar View should be collapsed by default');
    });

    await check('G2', 'expanding it shows the Year grid already open', async () => {
      await page.click('#yearOverviewHeading');
      await page.waitForTimeout(400);
      const yearOpen = await page.$eval('#yearOverviewCard', el => el.open);
      const gridOpen = await page.$eval('#checkerYearDetails', el => el.open);
      const gridVisible = await page.$eval('#checkerYearGrid', el => el.checkVisibility());
      assert(yearOpen, 'Full Calendar View should now be open');
      assert(gridOpen && gridVisible, 'Year grid should be open by default once Full Calendar View expands');
    });

    await check('G3', 'year nav prev/next changes the displayed year', async () => {
      const before = await page.$eval('#checkerYearLabel', el => el.textContent.trim());
      await page.click('#checkerYearPrev');
      await page.waitForTimeout(300);
      const after = await page.$eval('#checkerYearLabel', el => el.textContent.trim());
      assert(before !== after, `year label did not change (still "${before}")`);
    });

    await check('G4', '"Share your year" opens and closes the recap modal', async () => {
      await page.click('#checkerShareYearBtn');
      await page.waitForTimeout(400);
      const openVisible = await page.$eval('#yearRecapModal', el => el.checkVisibility());
      assert(openVisible, 'recap modal should open');
      await page.click('#yearRecapCloseBtn');
      await page.waitForTimeout(200);
      const closedVisible = await page.$eval('#yearRecapModal', el => el.checkVisibility());
      assert(!closedVisible, 'recap modal should close');
    });
    await closePage();
  }

  // H — Settings: appearance, notifications, countries
  group('H — Settings: appearance, notifications, countries');
  {
    const page = await openPage(T.activeAndNext);
    await page.click('[data-tab="settings"]');
    await page.waitForTimeout(300);

    await check('H1', 'switching to dark theme sets data-theme="dark"', async () => {
      await page.click('#themeDarkBtn');
      await page.waitForTimeout(200);
      const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      assert(attr === 'dark', `expected data-theme="dark", got "${attr}"`);
    });

    await check('H2', 'switching to light theme sets data-theme="light"', async () => {
      await page.click('#themeLightBtn');
      await page.waitForTimeout(200);
      const attr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      assert(attr === 'light', `expected data-theme="light", got "${attr}"`);
    });

    await check('H3', 'notification threshold checkbox toggles and persists to localStorage', async () => {
      // the raw <input> is visually hidden (custom-styled via a sibling .dot span,
      // pointer-events:none on the input itself) — click the wrapping label instead.
      const before = await page.$eval('#notif7', el => el.checked);
      await page.click('label:has(#notif7)');
      await page.waitForTimeout(150);
      const after = await page.$eval('#notif7', el => el.checked);
      assert(after !== before, 'checkbox state did not change on click');
      const stored = await page.evaluate(() => localStorage.getItem('schengenGuardNotifThresholds') || localStorage.getItem('schengenGuardAnywhereNotifThresholds'));
      assert(stored !== null, 'expected notification thresholds to be persisted to localStorage');
    });

    await check('H4', 'Countries visited grid matches seeded trip countries', async () => {
      await page.click('#countriesCard');
      await page.waitForTimeout(400);
      const visitedNames = await page.$$eval('.country-tile.visited .name', els => els.map(e => e.textContent.trim()).sort());
      // Spain is active (started) -> visited; Portugal is future-only -> not yet visited
      assert(visitedNames.includes('Spain'), `expected Spain to be visited, got: ${visitedNames.join(', ')}`);
      assert(!visitedNames.includes('Portugal'), `expected Portugal to NOT be visited yet (future trip), got: ${visitedNames.join(', ')}`);
    });
    await closePage();
  }

  // I — Backup / import
  group('I — Backup export and import');
  {
    const page = await openPage([]);
    await page.click('[data-tab="settings"]');
    await page.waitForTimeout(300);

    await check('I1', 'export updates the last-backup timestamp without throwing', async () => {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
        page.click('#exportBtn')
      ]);
      await page.waitForTimeout(300);
      const stored = await page.evaluate(() => localStorage.getItem('schengenGuardLastBackupAt') || localStorage.getItem('schengenGuardAnywhereLastBackupAt'));
      assert(download !== null, 'expected a file download to be triggered by Export');
      assert(stored !== null, 'expected last-backup timestamp to be persisted');
    });

    await check('I2', 'importing malformed JSON shows an error, does not crash', async () => {
      await page.evaluate(() => {
        const blob = new Blob(['{not valid json'], { type: 'application/json' });
        const input = document.getElementById('importFile');
        const file = new File([blob], 'bad.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(400);
      const errVisible = await page.$eval('#backupError', el => el.style.display !== 'none');
      assert(errVisible, 'expected an error message for malformed JSON import');
    });

    await check('I3', 'importing a newer schemaVersion shows the version-mismatch error', async () => {
      await page.evaluate(() => {
        const payload = JSON.stringify({ schemaVersion: 999, trips: [] });
        const blob = new Blob([payload], { type: 'application/json' });
        const input = document.getElementById('importFile');
        const file = new File([blob], 'future.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
      await page.waitForTimeout(400);
      const errText = await page.$eval('#backupError', el => el.textContent);
      assert(/newer version/i.test(errText), `expected a "newer version" error, got: "${errText}"`);
    });

    await check('I4', 'importing the stress-test fixture on an empty account applies immediately (no modal) and loads all trips', async () => {
      const fixture = await readFile(join(ROOT, 'test-data/stress-test.json'), 'utf8');
      await page.evaluate((json) => {
        const blob = new Blob([json], { type: 'application/json' });
        const input = document.getElementById('importFile');
        const file = new File([blob], 'stress-test.json', { type: 'application/json' });
        const dt = new DataTransfer();
        dt.items.add(file);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, fixture);
      await page.waitForTimeout(needsSupabaseMock ? 600 : 1500);
      const modalVisible = await page.$eval('#importModal', el => el.checkVisibility()).catch(() => false);
      assert(!modalVisible, 'import modal should not show when starting from an empty account');
      await page.click('[data-tab="trips"]');
      await page.waitForTimeout(500);
      const completedGroup = await page.$('#tripRows details');
      if (completedGroup) await completedGroup.evaluate(el => el.open = true);
      await page.waitForTimeout(300);
      const rowCount = await page.$$eval('#tripRows .trip-row', els => els.length);
      assert(rowCount === 39, `expected all 39 stress-test trips to load, got ${rowCount}`);
    });
    await closePage();
  }

  // J — Clear all data
  group('J — Clear all logged stays');
  {
    const page = await openPage(T.completed);
    await page.click('[data-tab="settings"]');
    await page.waitForTimeout(300);
    await check('J1', 'clearing all data empties the Trips list', async () => {
      const clearDetails = await page.$('summary');
      const resetBtn = await page.$('#resetBtn');
      assert(resetBtn, 'reset button not found');
      // reveal the details group containing the reset button, then click it
      await page.evaluate(() => {
        const btn = document.getElementById('resetBtn');
        btn.closest('details').open = true;
      });
      await page.waitForTimeout(200);
      await page.click('#resetBtn');
      await page.waitForTimeout(500);
      await page.click('[data-tab="trips"]');
      await page.waitForTimeout(300);
      const text = await page.$eval('#tripRows', el => el.textContent);
      assert(/No stays logged yet/i.test(text), `expected empty Trips list after clearing, got: ${text.slice(0,120)}`);
    });
    await closePage();
  }

  // K — Passport control
  group('K — Passport control');
  {
    const page = await openPage(T.activeAndNext);
    await page.click('[data-tab="home"]');
    await page.waitForTimeout(300);
    await check('K1', 'Passport control opens from Home and shows window/total stats', async () => {
      await page.click('#passportControlBtn');
      await page.waitForTimeout(400);
      const visible = await page.$eval('#tab-passportControl', el => el.checkVisibility());
      assert(visible, 'expected to navigate to Passport control');
      const range = await page.$eval('#pcWindowRange', el => el.textContent.trim());
      const total = await page.$eval('#pcTotalDays', el => el.textContent.trim());
      assert(range && range !== '—', `expected a real window range, got "${range}"`);
      assert(total && total !== '—', `expected a real total-days figure, got "${total}"`);
    });
    await check('K2', 'trip rows list for the active trip on the control date', async () => {
      const text = await page.$eval('#pcTripRows', el => el.textContent);
      assert(/Spain/.test(text), `expected Spain listed in Passport control rows, got: ${text.slice(0,150)}`);
    });
    await closePage();
  }

  // L — XSS-safety of trip notes
  group('L — Note rendering is XSS-safe');
  {
    const page = await openPage(T.xssNote);
    await page.click('[data-tab="trips"]');
    await page.waitForTimeout(400);
    await check('L1', 'a <script> tag inside a note renders as inert text, never executes', async () => {
      const fired = await page.evaluate(() => window.__xssFired === true);
      assert(!fired, 'the script tag inside the note EXECUTED — notes are not being escaped');
      const html = await page.$eval('#tripRows .trip-note', el => el.innerHTML).catch(() => null);
      assert(html && html.includes('&lt;script&gt;'), `expected escaped <script> markup in the rendered note, got: ${html}`);
    });
    await closePage();
  }

  // M — Compliance boundary math
  group('M — 90/91-day compliance boundary');
  {
    const page90 = await openPage(T.boundary90);
    await check('M1', 'a trip of exactly 90 days reads as compliant, not overstay', async () => {
      await page90.click('[data-tab="trips"]');
      await page90.waitForTimeout(400);
      const overstayIcon = await page90.$('#tripRows .warn-icon');
      assert(!overstayIcon, 'expected no overstay warning icon on an exactly-90-day trip');
    });
    await closePage();

    const page91 = await openPage(T.boundary91);
    await check('M2', 'a trip of exactly 91 days is flagged as overstay', async () => {
      await page91.click('[data-tab="trips"]');
      await page91.waitForTimeout(400);
      const overstayIcon = await page91.$('#tripRows .warn-icon');
      assert(overstayIcon, 'expected an overstay warning icon on a 91-day trip');
    });
    currentPage = page91;
    await closePage();
  }

  // O — Cross-cutting console-error sweep across every primary + secondary screen
  group('O — Console-error sweep across all screens');
  {
    const page = await openPage(T.activeAndNext);
    const navSteps = [
      ['home', '[data-tab="home"]'],
      ['calendar', '[data-tab="calendar"]'],
      ['trips', '[data-tab="trips"]'],
      ['settings', '[data-tab="settings"]']
    ];
    for (const [name, selector] of navSteps) {
      await check(`O-${name}`, `navigating to ${name} produces no console errors`, async () => {
        await page.click(selector);
        await page.waitForTimeout(300);
      });
    }
    await check('O-faq', 'FAQ screen (from Settings) produces no console errors', async () => {
      await page.click('#faqCard');
      await page.waitForTimeout(300);
    });
    await closePage();
    const errs = consoleErrorsByGroup.get('O — Console-error sweep across all screens') || [];
    report({
      group: 'O — Console-error sweep across all screens', id: 'O-final',
      name: 'zero console errors across the whole sweep',
      status: errs.length ? 'fail' : 'pass', error: errs.length ? errs.join(' | ') : undefined
    });
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main() {
  const indexHtml = await readFile(join(ROOT, 'index.html'), 'utf8');
  needsSupabaseMock = indexHtml.includes('supabase');

  const server = await startServer();
  browser = await chromium.launch();

  let aborted = null;
  try {
    await runGroups();
  } catch (err) {
    // Never let an unhandled error (a hung click, a page crash) erase the
    // record of everything that already ran — report what we have and say
    // plainly that the run didn't finish, instead of dying silently.
    aborted = String(err && err.stack || err);
  } finally {
    try { if (currentPage) await currentPage.close(); } catch {}
    await browser.close();
    server.close();
  }

  const totalPass = results.filter(r => r.status === 'pass').length;
  const totalFail = results.filter(r => r.status === 'fail').length;

  console.log(`\n${'-'.repeat(60)}`);
  if (aborted) {
    console.log(`⚠ RUN ABORTED partway through — ${results.length} case(s) completed before the crash:`);
    console.log(aborted);
  }
  console.log(`${totalPass} passed, ${totalFail} failed, ${totalPass + totalFail} total${aborted ? ' (incomplete run)' : ''}`);

  const jsonFlagIdx = process.argv.indexOf('--json');
  if (jsonFlagIdx !== -1 && process.argv[jsonFlagIdx + 1]) {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(process.argv[jsonFlagIdx + 1], JSON.stringify({ app: needsSupabaseMock ? 'anywhere' : 'guard', totalPass, totalFail, aborted, results }, null, 2));
  }

  process.exit(totalFail > 0 || aborted ? 1 : 0);
}

main();
