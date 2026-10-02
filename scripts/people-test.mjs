#!/usr/bin/env node
// Acceptance tests for multiple people (travellers): migration, per-person rules,
// the multi-person Safe Trip Checker, grouped edit/delete, notifications, badge,
// delete, and the v2 backup round trip. Runs against the real app in headless
// Chromium, driving it through the same functions and controls a user would.
//
// Usage: node scripts/people-test.mjs [--screenshots <dir>]

import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright';
import { supabaseMockScript } from './supabase-mock.mjs';

const ROOT = process.cwd();
const PORT = 8915;
const shotsIdx = process.argv.indexOf('--screenshots');
const SHOTS_DIR = shotsIdx > -1 ? process.argv[shotsIdx + 1] : null;
// The same suite runs against both apps; the Supabase one gets an in-memory backend.
let IS_SUPABASE = false;
let KEY = 'schengenGuard'; // localStorage key prefix

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

let passed = 0, failed = 0;
async function check(id, name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${id}  ${name}`);
  } catch (err) {
    failed++;
    console.log(`  ✗ ${id}  ${name}\n      ${String(err && err.message || err)}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// Dates relative to the real "today", so the suite never goes stale.
function iso(offsetDays) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function freshPage(browser, { legacyTrips = null, colorScheme = 'light' } = {}) {
  // Service workers blocked: the app reloads itself when a new worker takes control,
  // which would throw away the in-memory Supabase mock mid-test.
  const context = await browser.newContext({ viewport: { width: 390, height: 1400 }, colorScheme, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_|404/.test(m.text())) errors.push(m.text()); });
  // Recorders for notifications, the badge, and confirm() dialogs.
  await page.addInitScript(() => {
    window.__notifs = [];
    window.__badges = [];
    window.Notification = function (title, opts) { window.__notifs.push({ title, body: opts && opts.body }); };
    window.Notification.permission = 'granted';
    window.Notification.requestPermission = async () => 'granted';
    navigator.setAppBadge = async (n) => { window.__badges.push(n); };
    navigator.clearAppBadge = async () => { window.__badges.push(0); };
    localStorage.setItem('schengenGuardDisclaimerAcknowledged', 'true');
    localStorage.setItem('schengenGuardAnywhereDisclaimerAcknowledged', 'true');
  });
  if (IS_SUPABASE) {
    await page.route('**/supabase-js@*/**', (route) => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* blocked in test */' }));
    const rows = (legacyTrips || []).map((t) => ({ id: t.id, start_date: t.start, end_date: t.end, country: t.label, excluded_ranges: t.excludedRanges || [], note: t.note || '' }));
    await page.addInitScript(supabaseMockScript(), { tables: { trips: rows }, user: { id: 'people-test', email: 'people@test.local' } });
    if (legacyTrips) await page.addInitScript(() => localStorage.setItem('schengenGuardAnywhereNotifLastFired', '7'));
  }
  page.__dialogs = [];
  page.on('dialog', async (d) => { page.__dialogs.push(d.message()); await d.accept(); });

  if (legacyTrips && !IS_SUPABASE) {
    // Build a pre-people (v1) database before the app ever opens it.
    await page.goto(`http://localhost:${PORT}/sw.js`);
    await page.evaluate(async ({ trips }) => {
      await new Promise((res) => { const r = indexedDB.deleteDatabase('schengenGuardDB'); r.onsuccess = r.onerror = r.onblocked = res; });
      await new Promise((res, rej) => {
        const req = indexedDB.open('schengenGuardDB', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('trips', { keyPath: 'id' });
        req.onsuccess = () => {
          const tx = req.result.transaction('trips', 'readwrite');
          for (const t of trips) tx.objectStore('trips').put(t);
          tx.oncomplete = () => { req.result.close(); res(); };
          tx.onerror = () => rej(tx.error);
        };
        req.onerror = () => rej(req.error);
      });
      localStorage.setItem('schengenGuardNotifLastFired', '7');
    }, { trips: legacyTrips });
  }
  await page.goto(`http://localhost:${PORT}/index.html`);
  await page.waitForFunction(() => typeof people !== 'undefined' && people.length > 0 && document.getElementById('ringN').textContent !== '—');
  page.__errors = errors;
  return page;
}

// Seeds people + trips through the app's own persistence functions.
async function seedAnnaAndTom(page, { annaUsed = 80, tomUsed = 10 } = {}) {
  return page.evaluate(async ({ annaStart, annaEnd, tomStart, tomEnd }) => {
    await renamePerson(people[0].id, 'Anna');
    const tom = await addPerson('Tom');
    const anna = people.find(p => p.name === 'Anna');
    await insertTrip(anna.id, annaStart, annaEnd, 'France');
    await insertTrip(tom.id, tomStart, tomEnd, 'Italy');
    switchActivePerson(anna.id);
    render();
    return { anna: anna.id, tom: tom.id };
  }, { annaStart: iso(-annaUsed), annaEnd: iso(-1), tomStart: iso(-tomUsed), tomEnd: iso(-1) });
}

async function pickRange(page, start, end) {
  await page.evaluate(({ start, end }) => { pickStart = null; pickEnd = null; handlePick(start); handlePick(end); }, { start, end });
}

async function main() {
  IS_SUPABASE = (await readFile(join(ROOT, 'index.html'), 'utf8')).includes('supabase');
  if (IS_SUPABASE) KEY = 'schengenGuardAnywhere';
  const server = await startServer();
  const browser = await chromium.launch();
  if (SHOTS_DIR) await mkdir(SHOTS_DIR, { recursive: true });
  try {
    console.log('\n1 — Migration');
    {
      const legacy = [
        { id: 'a1', start: iso(-40), end: iso(-31), label: 'Spain', excludedRanges: [], note: 'kept' },
        { id: 'a2', start: iso(-80), end: iso(-41), label: 'Italy', excludedRanges: [] },
        { id: 'a3', start: iso(-30), end: iso(-1), label: 'Malta', excludedRanges: [] }
      ];
      const page = await freshPage(browser, { legacyTrips: legacy });
      await check('1a', 'existing trips all belong to one new person "Me"', async () => {
        const s = await page.evaluate(() => ({ people: people.map(p => p.name), owners: [...new Set(allTrips.map(t => t.personId))], n: allTrips.length, me: people[0].id, note: allTrips.find(t => t.id === 'a1').note }));
        assert(s.people.length === 1 && s.people[0] === 'Me', `people: ${JSON.stringify(s.people)}`);
        assert(s.n === 3 && s.owners.length === 1 && s.owners[0] === s.me, JSON.stringify(s));
        assert(s.note === 'kept', 'note lost');
      });
      await check('1b', 'running the migration again changes nothing', async () => {
        const s = await page.evaluate(async () => {
          const before = JSON.stringify({ people, allTrips });
          await ensurePeople(); await loadTrips();
          return before === JSON.stringify({ people, allTrips });
        });
        assert(s, 'state changed after second run');
      });
      await check('1c', 'the old notification tracker moves to "Me" (no repeat notification)', async () => {
        // 80 days used → 10 left: the 14-day alert already fired (tracker said 7), so nothing new fires.
        const s = await page.evaluate((KEY) => ({ fired: window.__notifs.length, left: realDaysLeft(people[0].id), legacy: localStorage.getItem(KEY + 'NotifLastFired'), map: JSON.parse(localStorage.getItem(KEY + 'NotifLastFiredByPerson') || '{}'), me: people[0].id }), KEY);
        assert(s.left === 10 && s.fired === 0 && s.legacy === null && s.map[s.me] === 7, JSON.stringify(s));
      });
      await check('1d', 'one person: no overview strip, no chips, no Everyone toggle', async () => {
        const s = await page.evaluate(() => ({
          strip: document.getElementById('peopleOverview').hidden,
          chips: document.getElementById('whoForField').hidden,
          toggle: document.getElementById('tripScopeToggle').hidden,
          deleteDisabled: document.querySelector('#peopleList [data-action="delete"]').disabled
        }));
        assert(s.strip && s.chips && s.toggle && s.deleteDisabled, JSON.stringify(s));
      });
      await check('1e', 'no console errors', async () => assert(page.__errors.length === 0, page.__errors.join(' | ')));
      await page.context().close();
    }

    console.log('\n2 — Separate rules + multi-person checker');
    {
      const page = await freshPage(browser);
      const ids = await seedAnnaAndTom(page);
      await page.click('[data-tab="calendar"]');
      await check('2a', 'chips show, active person selected by default, no Everyone chip for 2 people', async () => {
        const s = await page.$$eval('#whoForChips .who-chip', els => els.map(e => [e.textContent.trim(), e.getAttribute('aria-pressed')]));
        assert(s.length === 2, JSON.stringify(s));
        assert(s.find(x => x[0].includes('Anna'))[1] === 'true' && s.find(x => x[0].includes('Tom'))[1] === 'false', JSON.stringify(s));
      });
      await page.click('#whoForChips .who-chip:nth-child(2)'); // Tom
      await pickRange(page, iso(1), iso(15));
      await check('2b', 'headline: not safe for Anna, with her breach date', async () => {
        const h = await page.textContent('#verdictBanner .verdict-headline');
        const d = await page.textContent('#verdictBanner .verdict-detail');
        assert(h.trim() === 'Not safe for Anna.', h);
        assert(/Anna would reach 90 days on/.test(d), d);
      });
      await check('2c', 'one row per person, worst first; Tom shows his margin', async () => {
        const rows = await page.$$eval('#verdictPeople .verdict-person', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
        assert(rows.length === 2, JSON.stringify(rows));
        assert(/^Anna/.test(rows[0]) && /Over on/.test(rows[0]), rows[0]);
        assert(/^Tom/.test(rows[1]) && /65 days left on exit/.test(rows[1]), rows[1]);
      });
      await check('2d', 'suggestion keeps everyone compliant', async () => {
        const txt = await page.textContent('#editStaySuggestions');
        assert(/keep everyone compliant/.test(txt), txt);
      });
      await check('2e', 'a single selection looks exactly like before (no per-person rows)', async () => {
        await page.click('#whoForChips .who-chip:nth-child(1)'); // deselect Anna → only Tom
        const s = await page.evaluate(() => ({ rows: document.getElementById('verdictPeople').hidden, h: document.querySelector('#verdictBanner .verdict-headline').textContent }));
        assert(s.rows && s.h === 'This trip is fine', JSON.stringify(s));
        await page.click('#whoForChips .who-chip:nth-child(1)'); // reselect Anna
      });
      await check('2f', 'no one selected: save disabled', async () => {
        await page.click('#whoForChips .who-chip:nth-child(1)');
        await page.click('#whoForChips .who-chip:nth-child(1)'.replace('1', '2'));
        const dis = await page.$eval('#addTripBtn', b => b.disabled);
        const msg = await page.textContent('#editStayMsg');
        assert(dis && /at least one person/.test(msg), `${dis} ${msg}`);
        await page.click('#whoForChips .who-chip:nth-child(1)');
        await page.click('#whoForChips .who-chip:nth-child(2)');
      });
      await check('2g', 'saving creates two trips sharing one groupId', async () => {
        await page.click('#addTripBtn');
        await page.waitForTimeout(300);
        const s = await page.evaluate(({ start }) => allTrips.filter(t => t.start === start).map(t => ({ p: t.personId, g: t.groupId })), { start: iso(1) });
        assert(s.length === 2 && s[0].g && s[0].g === s[1].g && s[0].p !== s[1].p, JSON.stringify(s));
      });
      if (SHOTS_DIR) {
        await page.click('[data-tab="home"]');
        await page.screenshot({ path: join(SHOTS_DIR, 'home-light.png'), fullPage: true });
      }

      console.log('\n3 — Switching');
      await check('3a', 'switching to Tom changes ring, countries, calendar and trip list', async () => {
        const before = await page.evaluate(() => ({ ring: ringN.textContent }));
        await page.click('[data-tab="home"]');
        await page.click('#peopleOverview .people-overview-row:nth-child(2)');
        const s = await page.evaluate(() => ({
          ring: document.getElementById('ringN').textContent,
          active: people.find(p => p.id === activePersonId).name,
          countries: (renderCountries(), document.getElementById('countriesSubtitle').textContent),
          cal: document.getElementById('calendarPersonTag').textContent,
          rows: [...document.querySelectorAll('#tripRows .trip-row .country')].map(e => e.textContent),
          warn: document.querySelectorAll('#tripRows .warn-icon').length
        }));
        assert(s.active === 'Tom' && s.ring !== before.ring, JSON.stringify(s));
        assert(/^Tom:/.test(s.countries) && /Tom's days/.test(s.cal), JSON.stringify(s));
        assert(!s.rows.some(r => r.includes('France')) && s.warn === 0, JSON.stringify(s));
      });
      await check('3b', 'Everyone view lists both people with tags', async () => {
        await page.click('[data-tab="trips"]');
        await page.click('#tripScopeEveryoneBtn');
        const tags = await page.$$eval('#tripRows .trip-person', els => els.map(e => e.textContent.trim()));
        assert(tags.includes('Anna') && tags.includes('Tom'), JSON.stringify(tags));
        await page.click('#tripScopePersonBtn');
      });

      console.log('\n4 — Overlap');
      await check('4a', 'overlap with Anna only names Anna', async () => {
        page.__dialogs.length = 0;
        await page.click('[data-tab="calendar"]');
        await page.evaluate(({ a }) => { selectedPersonIds = new Set(people.map(p => p.id)); renderWhoForChips(); }, ids);
        await pickRange(page, iso(-3), iso(-2)); // inside both seeded stays...
        // ...so first narrow to a range only Anna has logged: Tom's stay is the last 10 days.
        await pickRange(page, iso(-30), iso(-29));
        await page.evaluate(() => { selectedPersonIds = new Set(people.map(p => p.id)); renderWhoForChips(); updateEditStayCompliance(); });
        await page.click('#addTripBtn');
        await page.waitForTimeout(300);
        assert(page.__dialogs.length === 1, JSON.stringify(page.__dialogs));
        assert(page.__dialogs[0] === 'This overlaps a stay already logged for Anna. Save anyway?', page.__dialogs[0]);
      });

      console.log('\n5 — Grouped edit and delete');
      await check('5a', '"Only Tom" detaches Tom\'s copy', async () => {
        const tomTrip = await page.evaluate(({ start, tom }) => allTrips.find(t => t.start === start && t.personId === tom).id, { start: iso(1), tom: ids.tom });
        await page.evaluate((id) => startEditTrip(id), tomTrip);
        await page.evaluate(({ s, e }) => { handlePick(s); handlePick(e); }, { s: iso(2), e: iso(10) });
        await page.click('#addTripBtn');
        await page.waitForSelector('#groupModal', { state: 'visible' });
        const msg = await page.textContent('#groupModalMsg');
        assert(msg === 'Apply this change to the 1 other person on this trip?', msg);
        assert((await page.textContent('#groupOneBtn')) === 'Only Tom');
        await page.click('#groupOneBtn');
        await page.waitForTimeout(300);
        const s = await page.evaluate(({ start, id }) => ({ tom: allTrips.find(t => t.id === id), anna: allTrips.filter(t => t.start === start) }), { start: iso(1), id: tomTrip });
        assert(s.tom.start === iso(2) && !s.tom.groupId, JSON.stringify(s.tom));
        assert(s.anna.length === 1 && s.anna[0].groupId, JSON.stringify(s.anna));
      });
      await check('5b', '"Apply to everyone" updates both', async () => {
        await page.evaluate(async ({ s, e }) => { await insertTripForPeople(people.map(p => p.id), s, e, 'Malta', []); render(); }, { s: iso(120), e: iso(125) });
        const id = await page.evaluate(({ s }) => allTrips.find(t => t.start === s).id, { s: iso(120) });
        await page.evaluate((id) => startEditTrip(id), id);
        await page.evaluate(({ s, e }) => { handlePick(s); handlePick(e); }, { s: iso(121), e: iso(126) });
        await page.click('#addTripBtn');
        await page.waitForSelector('#groupModal', { state: 'visible' });
        await page.click('#groupAllBtn');
        await page.waitForTimeout(300);
        const s = await page.evaluate(({ s }) => allTrips.filter(t => t.label === 'Malta').map(t => t.start + '|' + (t.groupId ? 'g' : '-')), { s: iso(121) });
        assert(s.length === 2 && s.every(x => x === iso(121) + '|g'), JSON.stringify(s));
      });
      await check('5c', '"Remove for everyone" deletes both copies', async () => {
        await page.click('[data-tab="trips"]');
        await page.click('#tripScopeEveryoneBtn');
        const id = await page.evaluate(() => allTrips.find(t => t.label === 'Malta').id);
        await page.click(`#tripRows [data-action="remove"][data-id="${id}"]`);
        await page.waitForSelector('#groupModal', { state: 'visible' });
        await page.click('#groupAllBtn');
        await page.waitForTimeout(300);
        const n = await page.evaluate(() => allTrips.filter(t => t.label === 'Malta').length);
        assert(n === 0, `still ${n}`);
        await page.click('#tripScopePersonBtn');
      });

      console.log('\n6/7 — Notifications and badge');
      await check('6a', 'each person is notified once, by name, and never twice', async () => {
        const s = await page.evaluate(async (KEY) => {
          localStorage.removeItem(KEY + 'NotifLastFiredByPerson');
          window.__notifs.length = 0;
          checkNotifications(); checkNotifications();
          return window.__notifs.map(n => n.body);
        }, KEY);
        // Anna has 80 days used → 10 left (≤14) ; Tom has 10 used → 80 left.
        assert(s.length === 1 && s[0] === 'Anna has 10 days left.', JSON.stringify(s));
      });
      await check('6b', 'Tom crossing 14 later gets his own notification', async () => {
        const s = await page.evaluate(async () => {
          const tom = people.find(p => p.name === 'Tom');
          const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return isoOf(x); };
          await insertTrip(tom.id, d(-150), d(-81), 'Spain'); // +70 days → 80 used
          window.__notifs.length = 0;
          checkNotifications(); checkNotifications();
          return { bodies: window.__notifs.map(n => n.body), expected: `Tom has ${dayCount(realDaysLeft(tom.id))} left.`, left: realDaysLeft(tom.id) };
        });
        assert(s.left <= 14 && s.bodies.length === 1 && s.bodies[0] === s.expected, JSON.stringify(s));
      });
      await check('7a', 'badge shows the lowest days-left across everyone', async () => {
        const s = await page.evaluate(async () => {
          const tom = people.find(p => p.name === 'Tom');
          await deleteTrip(allTrips.find(t => t.personId === tom.id && t.label === 'Spain').id);
          window.__badges.length = 0;
          updateAppBadge();
          return { badge: window.__badges[0], each: people.map(p => realDaysLeft(p.id)) };
        });
        assert(s.badge === Math.min(...s.each), JSON.stringify(s));
      });

      console.log('\n9 — Backup round trip');
      let backup;
      await check('9a', 'export → clear everything → import restores people, trips and groups', async () => {
        backup = await page.evaluate(async () => {
          let captured = null;
          const orig = URL.createObjectURL;
          URL.createObjectURL = (blob) => { captured = blob; return orig.call(URL, blob); };
          document.getElementById('exportBtn').click();
          URL.createObjectURL = orig;
          return JSON.parse(await captured.text());
        });
        assert(backup.schemaVersion === 2 && backup.people.length === 2, JSON.stringify(backup).slice(0, 200));
        const before = await page.evaluate(() => {
          // Ids may be reassigned on import (the Supabase app always does), so compare by
          // names and by which trips share a group, not by raw ids.
          const name = (id) => (people.find(p => p.id === id) || {}).name;
          const groups = [...new Set(allTrips.map(t => t.groupId).filter(Boolean))];
          const groupOf = (t) => t.groupId ? allTrips.filter(x => x.groupId === t.groupId).map(x => name(x.personId) + x.start).sort().join('+') : '';
          return JSON.stringify({ p: people.map(p => [p.name, p.colour]), t: allTrips.map(t => [name(t.personId), t.start, t.end, t.label, t.note, groupOf(t)].join('|')).sort(), groups: groups.length });
        });
        await page.evaluate(async () => {
          await deleteAllTrips();
          await deletePerson(people.find(p => p.name === 'Tom').id);
          render();
        });
        await page.evaluate((json) => {
          const input = document.getElementById('importFile');
          const dt = new DataTransfer();
          dt.items.add(new File([json], 'b.json', { type: 'application/json' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, JSON.stringify(backup));
        await page.waitForTimeout(600);
        const after = await page.evaluate(() => {
          // Ids may be reassigned on import (the Supabase app always does), so compare by
          // names and by which trips share a group, not by raw ids.
          const name = (id) => (people.find(p => p.id === id) || {}).name;
          const groups = [...new Set(allTrips.map(t => t.groupId).filter(Boolean))];
          const groupOf = (t) => t.groupId ? allTrips.filter(x => x.groupId === t.groupId).map(x => name(x.personId) + x.start).sort().join('+') : '';
          return JSON.stringify({ p: people.map(p => [p.name, p.colour]), t: allTrips.map(t => [name(t.personId), t.start, t.end, t.label, t.note, groupOf(t)].join('|')).sort(), groups: groups.length });
        });
        assert(before === after, `\n${before}\n${after}`);
      });
      await check('9b', 'merging the same backup again adds nothing', async () => {
        const n0 = await page.evaluate(() => allTrips.length);
        await page.evaluate((json) => {
          const input = document.getElementById('importFile');
          const dt = new DataTransfer();
          dt.items.add(new File([json], 'b.json', { type: 'application/json' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, JSON.stringify(backup));
        await page.waitForSelector('#importModal', { state: 'visible' });
        await page.click('#importMergeBtn');
        await page.waitForTimeout(400);
        const n1 = await page.evaluate(() => allTrips.length);
        assert(n0 === n1, `${n0} → ${n1}`);
      });
      await check('9c', 'an old v1 file asks which person', async () => {
        const v1 = JSON.stringify({ schemaVersion: 1, trips: [{ id: 'x', start: iso(-300), end: iso(-290), label: 'Greece', excludedRanges: [] }] });
        await page.evaluate((json) => {
          const input = document.getElementById('importFile');
          const dt = new DataTransfer();
          dt.items.add(new File([json], 'old.json', { type: 'application/json' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, v1);
        await page.waitForSelector('#importPersonModal', { state: 'visible' });
        const txt = await page.textContent('#importPersonMsg');
        assert(/which person\?/.test(txt), txt);
        await page.click('#importPersonList button:nth-child(2)'); // Tom
        await page.waitForSelector('#importModal', { state: 'visible' });
        await page.click('#importMergeBtn');
        await page.waitForTimeout(400);
        const owner = await page.evaluate(() => people.find(p => p.id === allTrips.find(t => t.label === 'Greece').personId).name);
        assert(owner === 'Tom', owner);
      });
      await check('9d', 'a malformed v2 file writes nothing', async () => {
        const n0 = await page.evaluate(() => JSON.stringify([people.length, allTrips.length]));
        const bad = JSON.stringify({ schemaVersion: 2, people: [{ id: 'z', name: 'Zed', colour: 'teal' }], trips: [{ id: 'q', personId: 'nobody', start: iso(1), end: iso(2), label: 'Spain' }] });
        await page.evaluate((json) => {
          const input = document.getElementById('importFile');
          const dt = new DataTransfer();
          dt.items.add(new File([json], 'bad.json', { type: 'application/json' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, bad);
        await page.waitForTimeout(400);
        const n1 = await page.evaluate(() => JSON.stringify([people.length, allTrips.length]));
        const err = await page.textContent('#backupError');
        assert(n0 === n1 && /malformed/.test(err), `${n0} ${n1} ${err}`);
      });
      await check('9e', 'a backup over the 8-person cap stops before writing', async () => {
        const many = { schemaVersion: 2, people: Array.from({ length: 7 }, (_, i) => ({ id: 'p' + i, name: 'Person ' + i, colour: 'teal' })), trips: [] };
        const n0 = await page.evaluate(() => people.length);
        await page.evaluate((json) => {
          const input = document.getElementById('importFile');
          const dt = new DataTransfer();
          dt.items.add(new File([json], 'many.json', { type: 'application/json' }));
          input.files = dt.files;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }, JSON.stringify(many));
        await page.waitForSelector('#importModal', { state: 'visible' });
        await page.click('#importMergeBtn');
        await page.waitForTimeout(300);
        const s = await page.evaluate(() => ({ n: people.length, err: document.getElementById('backupError').textContent }));
        assert(s.n === n0 && /over 8 people/.test(s.err), JSON.stringify(s));
      });

      console.log('\n8 — Delete');
      await check('8a', 'deleting Tom removes only his trips', async () => {
        const s = await page.evaluate(async () => {
          const tom = people.find(p => p.name === 'Tom');
          const annaBefore = allTrips.filter(t => t.personId !== tom.id).length;
          await deletePerson(tom.id);
          return { tomLeft: allTrips.filter(t => t.personId === tom.id).length, annaAfter: allTrips.length, annaBefore, people: people.map(p => p.name) };
        });
        assert(s.tomLeft === 0 && s.annaAfter === s.annaBefore && s.people.join() === 'Anna', JSON.stringify(s));
      });
      await check('8b', 'the last person cannot be deleted', async () => {
        const s = await page.evaluate(async () => {
          render();
          await deletePerson(people[0].id);
          return { n: people.length, disabled: document.querySelector('#peopleList [data-action="delete"]').disabled, note: getComputedStyle(document.getElementById('peopleLastNote')).display };
        });
        assert(s.n === 1 && s.disabled && s.note !== 'none', JSON.stringify(s));
      });
      await check('8c', 'names: duplicate (any case), blank, too long, and over the cap are refused', async () => {
        const s = await page.evaluate(async () => {
          const out = [];
          for (const name of ['anna', '  ', 'x'.repeat(21)]) { try { await addPerson(name); out.push('ok'); } catch (e) { out.push(e.message); } }
          for (let i = 0; i < 7; i++) await addPerson('P' + i);
          try { await addPerson('Ninth'); out.push('ok'); } catch (e) { out.push(e.message); }
          return out;
        });
        assert(s.join('|') === 'Someone already has that name.|Enter a name.|Names can be up to 20 characters.|You can add up to 8 people.', JSON.stringify(s));
      });
      await check('8d', 'no console errors', async () => assert(page.__errors.length === 0, page.__errors.join(' | ')));
      await page.context().close();
    }

    if (SHOTS_DIR) {
      console.log('\n11 — Screenshots (light/dark, long names)');
      for (const scheme of ['light', 'dark']) {
        const page = await freshPage(browser, { colorScheme: scheme });
        await seedAnnaAndTom(page);
        await page.evaluate(async () => {
          await addPerson('Maximiliana-Josefina');
          await addPerson('李小龍 和 王小明的家人');
          render();
        });
        await page.screenshot({ path: join(SHOTS_DIR, `home-${scheme}.png`), fullPage: true });
        await page.click('#personSwitcherBtn');
        await page.screenshot({ path: join(SHOTS_DIR, `switcher-${scheme}.png`) });
        await page.click('#personSwitcherBtn');
        await page.click('[data-tab="calendar"]');
        await page.evaluate(() => { selectedPersonIds = new Set(people.map(p => p.id)); renderWhoForChips(); });
        await pickRange(page, iso(1), iso(15));
        await page.evaluate(() => { selectedPersonIds = new Set(people.map(p => p.id)); renderWhoForChips(); updateEditStayCompliance(); });
        await page.screenshot({ path: join(SHOTS_DIR, `checker-${scheme}.png`), fullPage: true });
        await page.click('[data-tab="trips"]');
        await page.click('#tripScopeEveryoneBtn');
        await page.screenshot({ path: join(SHOTS_DIR, `trips-${scheme}.png`), fullPage: true });
        await page.click('[data-tab="settings"]');
        await page.screenshot({ path: join(SHOTS_DIR, `settings-${scheme}.png`), fullPage: true });
        await page.context().close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
