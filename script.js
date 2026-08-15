const DB_NAME = 'schengenGuardDB';
const DB_VERSION = 1;
const STORE_NAME = 'trips';
const SCHEMA_VERSION = 1; // bump when the exported JSON trip shape changes

const NOTIF_PREFS_KEY = 'schengenGuardNotifThresholds';
const NOTIF_LAST_FIRED_KEY = 'schengenGuardNotifLastFired';
const LAST_BACKUP_KEY = 'schengenGuardLastBackupAt';
const BACKUP_NUDGE_DISMISSED_KEY = 'schengenGuardBackupNudgeDismissedAt';
const DISCLAIMER_ACK_KEY = 'schengenGuardDisclaimerAcknowledged';
const RING_RADIUS = 99;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ALL_COUNTRIES = [
  'Austria','Belgium','Bulgaria','Croatia','Czechia','Denmark','Estonia','Finland','France',
  'Germany','Greece','Hungary','Iceland','Italy','Latvia','Liechtenstein','Lithuania',
  'Luxembourg','Malta','Netherlands','Norway','Poland','Portugal','Romania','Slovakia',
  'Slovenia','Spain','Sweden','Switzerland'
];

// ISO 3166-1 alpha-2 codes, keyed to the flag-icons CSS class (fi-<code>)
const COUNTRY_ISO = {
  'Austria':'at','Belgium':'be','Bulgaria':'bg','Croatia':'hr','Czechia':'cz','Denmark':'dk',
  'Estonia':'ee','Finland':'fi','France':'fr','Germany':'de','Greece':'gr','Hungary':'hu',
  'Iceland':'is','Italy':'it','Latvia':'lv','Liechtenstein':'li','Lithuania':'lt',
  'Luxembourg':'lu','Malta':'mt','Netherlands':'nl','Norway':'no','Poland':'pl',
  'Portugal':'pt','Romania':'ro','Slovakia':'sk','Slovenia':'si','Spain':'es','Sweden':'se',
  'Switzerland':'ch'
};

// Decorative flag icon markup for a country name; text label stays the a11y source of truth.
function flagIconHtml(name){
  const code = COUNTRY_ISO[name];
  if(!code) return '';
  return `<span class="flag-icon fi fi-${code}" aria-hidden="true" aria-label="${name}"></span>`;
}

// Small stable hash so each country's stamp tilt is fixed (not re-randomized on every
// render) without having to store a rotation value anywhere — same input, same output.
function stampRotationDeg(code){
  let hash = 0;
  for(let i = 0; i < code.length; i++) hash = (hash * 31 + code.charCodeAt(i)) | 0;
  const t = ((hash % 1000) + 1000) % 1000 / 1000; // 0..1, stable per code
  return (t * 8 - 4).toFixed(2); // -4..4deg
}

// Postage-stamp flag for the Countries grid's visited tiles — see flagIconHtml() above
// for the plain inline flag used everywhere else (trip rows, etc.), which this doesn't
// replace. Decorative + aria-hidden, same as flagIconHtml(): the tile's visible .name
// text underneath stays the a11y source of truth rather than duplicating an announcement.
function stampHtml(name){
  const code = COUNTRY_ISO[name];
  if(!code) return '';
  const rotate = stampRotationDeg(code);
  // arc id needs to be unique per tile (up to 29 on screen at once) since textPath
  // references it by id and duplicate ids would make every stamp's text follow
  // whichever <path> the browser happens to resolve first.
  const arcId = `stamp-arc-${code}`;
  return `<div class="stamp" style="--stamp-rotate:${rotate}deg;">
    <div class="stamp-paper">
      <span class="stamp-flag fi fi-${code}" aria-hidden="true" aria-label="${name}"></span>
      <svg class="postmark" viewBox="0 0 100 100" aria-hidden="true">
        <path id="${arcId}" d="M 15,50 A 35,35 0 0,1 85,50" fill="none"/>
        <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" stroke-width="2.5"/>
        <text><textPath href="#${arcId}" startOffset="50%" text-anchor="middle">VISITED</textPath></text>
        <line x1="15" y1="50" x2="85" y2="50" stroke="currentColor" stroke-width="2"/>
      </svg>
    </div>
  </div>`;
}

// Trip labels normally only ever come from the fixed country <select>, but a restored
// backup file can carry arbitrary text — escape before any innerHTML interpolation so a
// crafted label can't inject markup/event handlers.
const HTML_ESCAPES = { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' };
function escapeHtml(str){
  return String(str).replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

let trips = []; // {id, start:'YYYY-MM-DD', end:'YYYY-MM-DD', label, excludedRanges:[{start,end}]}
let editingTripId = null;
let pendingImportTrips = null;
let checkerPendingExcludedRanges = [];
let checkerPickingExclusion = false;
let checkerEditingExclusionIndex = null;
let checkerCalCursor = new Date(); checkerCalCursor.setDate(1);
let checkerPickStart = null, checkerPickEnd = null;
let checkerExclPickStart = null, checkerExclPickEnd = null;

function newId(){
  if('randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

// --- i18n: lightweight per-locale JSON + t()/tn() lookup, English fallback ---
// Framework ships now; zh.json/ja.json are placeholders (deliberate per the brief —
// real translated copy lands in a later pass, and missing keys fall back to English
// rather than showing a blank string or a raw key).

const LANG_KEY = 'schengenGuardLang';
const VALID_LANGS = ['en', 'zh', 'ja'];
const INTL_LOCALE = { en: 'en-GB', zh: 'zh-CN', ja: 'ja-JP' };
let currentLang = 'en';
let i18nEn = {};
let i18nActive = {};

async function loadLocale(lang){
  if(Object.keys(i18nEn).length === 0){
    i18nEn = await fetch('i18n/en.json').then(r => r.json()).catch(() => ({}));
  }
  i18nActive = (lang === 'en') ? i18nEn : await fetch(`i18n/${lang}.json`).then(r => r.json()).catch(() => ({}));
  currentLang = lang;
}

function rawT(key){
  const fromActive = i18nActive[key];
  return fromActive !== undefined ? fromActive : i18nEn[key];
}

function interpolate(str, vars){
  if(!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m));
}

function t(key, vars){
  const raw = rawT(key);
  return raw === undefined ? key : interpolate(raw, vars);
}

// Pluralized keys are stored as `${key}.one` / `${key}.other`. English is the only one
// of the three shipped locales with a grammatical singular/plural distinction (zh/ja
// don't inflect for number), so "one" only ever applies when n===1 in English.
function tn(key, n, vars){
  const suffix = (currentLang === 'en' && n === 1) ? 'one' : 'other';
  return t(`${key}.${suffix}`, Object.assign({ n }, vars));
}

function applyStaticI18n(){
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  // Elements whose translation needs embedded markup (e.g. a link) rather than
  // plain text — the translation string itself is trusted app copy, not user input.
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = t(el.getAttribute('data-i18n-html'));
  });
}

function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function toDate(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function isoOf(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmt(iso){ const d=toDate(iso); return new Intl.DateTimeFormat(INTL_LOCALE[currentLang] || 'en-GB', {day:'2-digit',month:'short',year:'numeric'}).format(d); }
function fmtShort(iso){ const d=toDate(iso); return new Intl.DateTimeFormat(INTL_LOCALE[currentLang] || 'en-GB', {day:'2-digit',month:'short'}).format(d); }
// Wraps a formatted date in a bold span for use inside the Quick check result's innerHTML —
// day-count phrases (margins, overages) stay plain text and are never passed through this.
function boldDate(iso){ return `<b class="qc-date">${fmt(iso)}</b>`; }

function isExcludedDay(trip, iso){
  for(const r of (trip.excludedRanges || [])){
    if(iso >= r.start && iso <= r.end) return true;
  }
  return false;
}

// Build set of ISO date strings covered by trips (inclusive) that count toward the
// 90-day limit — days inside a trip's own excludedRanges (a side trip outside Schengen,
// e.g. a UK leg) are skipped, since they were never actually spent in Schengen.
function coveredDates(list){
  const set = new Set();
  for(const t of list){
    let cur = toDate(t.start);
    const end = toDate(t.end);
    while(cur <= end){
      const iso = isoOf(cur);
      if(!isExcludedDay(t, iso)) set.add(iso);
      cur = addDays(cur,1);
    }
  }
  return set;
}

// Days that fall within a trip's date range but are marked as spent outside Schengen —
// used only for calendar display, since coveredDates() already excludes them from counting.
function excludedDatesSet(list){
  const set = new Set();
  for(const t of list){
    for(const r of (t.excludedRanges || [])){
      let cur = toDate(r.start);
      const end = toDate(r.end);
      while(cur <= end){ set.add(isoOf(cur)); cur = addDays(cur,1); }
    }
  }
  return set;
}

function usedDaysInWindow(list, windowEndISO){
  const windowEnd = toDate(windowEndISO);
  const windowStart = addDays(windowEnd, -179);
  const covered = coveredDates(list);
  let count = 0;
  let cur = windowStart;
  while(cur <= windowEnd){
    if(covered.has(isoOf(cur))) count++;
    cur = addDays(cur,1);
  }
  return count;
}

// Checks each day inside a specific trip's own date range and returns the first day
// (and running total) where that trip's presence pushes the rolling window over the cap —
// i.e. the trip actually responsible for tipping things over, not just any trip riding
// along afterwards on an already-blown total.
function tripOverstayInfo(list, trip, capDays){
  let cur = toDate(trip.start);
  const end = toDate(trip.end);
  while(cur <= end){
    const iso = isoOf(cur);
    const used = usedDaysInWindow(list, iso);
    if(used > capDays) return {date: iso, used};
    cur = addDays(cur,1);
  }
  return null;
}

// Simulate: starting from entryISO, how many consecutive additional days (beyond existing trips)
// could be spent before hitting the 90-day cap, given existing logged trips.
function maxConsecutiveFrom(list, entryISO, capDays){
  const existingCovered = coveredDates(list);
  let cur = toDate(entryISO);
  let count = 0;
  const hypothetical = new Set();
  for(let i=0;i<400;i++){ // hard safety cap ~13 months
    const iso = isoOf(cur);
    if(!existingCovered.has(iso)) hypothetical.add(iso);
    const windowStart = addDays(cur, -179);
    let used = 0;
    let d = windowStart;
    while(d <= cur){
      const diso = isoOf(d);
      if(existingCovered.has(diso) || hypothetical.has(diso)) used++;
      d = addDays(d,1);
    }
    if(used > capDays){
      hypothetical.delete(iso);
      break;
    }
    count++;
    cur = addDays(cur,1);
  }
  return count;
}

function nextFreeDate(list, capDays){
  // first future date on which used days in trailing window drops back under cap (i.e. re-entry becomes possible)
  let d = addDays(new Date(),1);
  for(let i=0;i<400;i++){
    const iso = isoOf(d);
    const used = usedDaysInWindow(list, iso);
    if(used < capDays) return iso;
    d = addDays(d,1);
  }
  return null;
}

// Rough human-friendly label for how far off a future/ongoing start date is
function relativeStart(startISO){
  const today = todayISO();
  if(startISO <= today) return 'ongoing';
  const diffDays = Math.round((toDate(startISO) - toDate(today)) / 86400000);
  if(diffDays === 1) return 'tomorrow';
  if(diffDays < 7) return `in ${diffDays} days`;
  if(diffDays < 14) return 'next week';
  if(diffDays < 31) return `in ${Math.round(diffDays / 7)} weeks`;
  if(diffDays < 62) return 'next month';
  return `in ${Math.round(diffDays / 30)} months`;
}

// Earliest future start date (from tomorrow) at which a stay of `duration` days would
// not breach the cap, given `list` (which should NOT include the trip being planned).
function earliestCompliantStart(list, duration, capDays){
  let d = addDays(new Date(),1);
  for(let i=0;i<400;i++){
    const startISO = isoOf(d);
    const endISO = isoOf(addDays(d, duration-1));
    const candidate = { start: startISO, end: endISO };
    const overstay = tripOverstayInfo(list.concat([candidate]), candidate, capDays);
    if(!overstay) return startISO;
    d = addDays(d,1);
  }
  return null;
}

// One or two concrete alternatives for a trip that would overstay, or how much slack
// remains if it wouldn't — not an open-ended optimizer, just the obvious next questions:
// "how much shorter" / "how much later" / "how much more could I stay."
// `listIncluding` must already contain the trip/candidate's own days; `listExcluding` must not.
function computeTripSuggestion(listIncluding, listExcluding, start, end, capDays){
  const duration = Math.round((toDate(end) - toDate(start)) / 86400000) + 1;
  const overstay = tripOverstayInfo(listIncluding, { start, end }, capDays);

  if(overstay){
    const suggestions = [];
    const altEnd = isoOf(addDays(toDate(overstay.date), -1));
    if(altEnd >= start){
      const altDays = Math.round((toDate(altEnd) - toDate(start)) / 86400000) + 1;
      suggestions.push({
        label: t('trips.suggestion.trim', { date: fmt(altEnd), n: tn('trips.marginDays', altDays) }),
        start, end: altEnd
      });
    }
    const altStart = earliestCompliantStart(listExcluding, duration, capDays);
    if(altStart && altStart !== start){
      const altEndForStart = isoOf(addDays(toDate(altStart), duration-1));
      suggestions.push({
        label: t('trips.suggestion.laterStart', { date: fmt(altStart), n: tn('trips.marginDays', duration) }),
        start: altStart, end: altEndForStart
      });
    }
    return { overstay: true, suggestions };
  }

  const maxDays = maxConsecutiveFrom(listIncluding, start, capDays);
  const extra = maxDays - duration;
  if(extra > 0){
    return { overstay: false, extendable: true, extra, lastExit: isoOf(addDays(toDate(start), maxDays - 1)) };
  }
  return { overstay: false, extendable: false };
}

function classifyTrip(t){
  const today = todayISO();
  if(t.end < today) return 'past';
  if(t.start <= today && today <= t.end) return 'active';
  return 'planned';
}

// --- IndexedDB storage layer (trips live only on this device) ---

let dbPromise = null;
function openDB(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = ()=>{
      const idb = req.result;
      if(!idb.objectStoreNames.contains(STORE_NAME)){
        idb.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  return dbPromise;
}

function withStore(mode, fn){
  return openDB().then(idb => new Promise((resolve, reject)=>{
    const tx = idb.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = fn(store);
    tx.oncomplete = ()=> resolve(result);
    tx.onerror = ()=> reject(tx.error);
  }));
}

function dbGetAll(){
  return openDB().then(idb => new Promise((resolve, reject)=>{
    const tx = idb.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  }));
}

function dbPut(trip){ return withStore('readwrite', store => store.put(trip)); }
function dbDelete(id){ return withStore('readwrite', store => store.delete(id)); }
function dbClearAll(){ return withStore('readwrite', store => store.clear()); }
function dbPutAll(list){
  return openDB().then(idb => new Promise((resolve, reject)=>{
    const tx = idb.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for(const t of list) store.put(t);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
  }));
}

// Load all trips from IndexedDB into the in-memory `trips` array the rest of the app reads
async function loadTrips(){
  const rows = await dbGetAll();
  trips = rows.map(t => ({ ...t, excludedRanges: t.excludedRanges || [] }));
}

async function insertTrip(start, end, label, excludedRanges){
  const trip = { id: newId(), start, end, label, excludedRanges: excludedRanges || [] };
  await dbPut(trip);
  await loadTrips();
  markTripsChanged();
}

async function updateTrip(id, start, end, label, excludedRanges){
  const existing = trips.find(t => t.id === id);
  const trip = { id, start, end, label, excludedRanges: excludedRanges || (existing && existing.excludedRanges) || [] };
  await dbPut(trip);
  await loadTrips();
  markTripsChanged();
}

async function deleteTrip(id){
  await dbDelete(id);
  await loadTrips();
  markTripsChanged();
}

async function deleteAllTrips(){
  await dbClearAll();
  trips = [];
  markTripsChanged();
}

// Home-screen app icon badge (installed PWA only) — days you can still stay in the
// Schengen zone today: 90 minus days already used in the rolling 180-day window
// ending today. Independent of whatever date the "Check as of" field is scrubbed to,
// and naturally changes day to day as old covered days age out of that window.
function updateAppBadge(){
  if(!('setAppBadge' in navigator)) return;
  const used = usedDaysInWindow(trips, todayISO());
  const daysLeft = Math.max(0, 90 - used);
  try{ navigator.setAppBadge(daysLeft).catch(()=>{}); }catch(e){}
}
function clearAppBadge(){
  if(!('clearAppBadge' in navigator)) return;
  try{ navigator.clearAppBadge().catch(()=>{}); }catch(e){}
}

// --- Tab / screen navigation ---
const PRIMARY_TABS = ['home','trips','settings'];

function switchTab(name){
  document.querySelectorAll('.screen').forEach(el=>{
    const isTarget = el.id === 'tab-' + name;
    el.style.display = isTarget ? 'block' : 'none';
    el.classList.remove('screen-active');
    if(isTarget){
      void el.offsetWidth; // restart the entry animation on every switch
      el.classList.add('screen-active');
    }
  });
  document.querySelectorAll('.tab-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-tab') === name);
  });
  document.getElementById('tabbar').style.display = PRIMARY_TABS.includes(name) ? 'flex' : 'none';
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> switchTab(btn.getAttribute('data-tab')));
});
document.getElementById('countriesCard').addEventListener('click', ()=>{
  renderCountries();
  switchTab('countries');
});
document.getElementById('countriesBackBtn').addEventListener('click', ()=> switchTab('settings'));
document.getElementById('addTripShortcutBtn').addEventListener('click', ()=>{
  document.getElementById('checkerEntry').focus();
});
document.getElementById('homeAddTripBtn').addEventListener('click', ()=>{
  switchTab('trips');
  document.getElementById('checkerEntry').focus();
});
document.getElementById('faqCard').addEventListener('click', ()=> switchTab('faq'));
document.getElementById('faqBackBtn').addEventListener('click', ()=> switchTab('settings'));
document.getElementById('privacyCard').addEventListener('click', ()=> switchTab('privacy'));
document.getElementById('privacyBackBtn').addEventListener('click', ()=> switchTab('settings'));

// --- Home: arc ring + last-day card + next trip + countries ---

function statusColorVar(used, remaining, exitIsoIsNull){
  if(used > 90 || exitIsoIsNull) return 'var(--color-accent-2-700)';
  if(remaining <= 20) return 'var(--color-accent-2-600)';
  return 'var(--color-accent)';
}

// Result-block background tint — healthy gets the accent tint, warning and danger
// (over limit / no valid exit) share the same accent-2 tint the eyebrow/big-date use.
function statusTintVar(used, remaining, exitIsoIsNull){
  if(used > 90 || exitIsoIsNull || remaining <= 20) return 'var(--color-accent-2-100)';
  return 'var(--color-accent-100)';
}

function updateRing(remaining, colorVar){
  const fraction = Math.max(0, Math.min(1, remaining / 90));
  const fg = document.getElementById('ringFg');
  fg.style.stroke = colorVar;
  fg.setAttribute('stroke-dasharray', String(RING_CIRCUMFERENCE));
  fg.style.strokeDashoffset = String(RING_CIRCUMFERENCE * (1 - fraction));

  const angle = -90 + fraction * 360;
  const rad = angle * Math.PI / 180;
  const cx = 115, cy = 115;
  const x = cx + RING_RADIUS * Math.cos(rad);
  const y = cy + RING_RADIUS * Math.sin(rad);
  const star = document.getElementById('ringStar');
  star.style.left = x + 'px';
  star.style.top = y + 'px';
  star.style.background = colorVar;

  document.getElementById('ringN').textContent = String(remaining);
  document.getElementById('ringN').style.color = colorVar;
}

function render(){
  const refInput = document.getElementById('refDate');
  const refISO = refInput.value || todayISO();

  const used = usedDaysInWindow(trips, refISO);
  const remaining = Math.max(0, 90 - used);

  const coveringTrip = trips.find(t => t.start <= refISO && refISO <= t.end);
  const entryForCalc = coveringTrip ? coveringTrip.start : refISO;
  const maxDays = maxConsecutiveFrom(trips, entryForCalc, 90);
  const exitISO = maxDays > 0 ? isoOf(addDays(toDate(entryForCalc), maxDays - 1)) : null;

  const colorVar = statusColorVar(used, remaining, exitISO === null);
  const tintVar = statusTintVar(used, remaining, exitISO === null);
  updateRing(remaining, colorVar);

  const resultEl = document.getElementById('qcResult');
  const kickerEl = document.getElementById('lastDayKicker');
  const titleEl = document.getElementById('lastDayTitle');
  const bodyEl = document.getElementById('lastDayBody');
  resultEl.style.background = tintVar;
  kickerEl.style.color = colorVar;
  titleEl.style.color = colorVar;

  if(used > 90){
    const overBy = used - 90;
    kickerEl.textContent = t('home.daysOverLimit');
    titleEl.textContent = `+${overBy}`;
    let html = tn('home.overLimitBody', overBy, { used, date: boldDate(refISO) });
    const free = nextFreeDate(trips, 90);
    if(free) html += t('home.compliantAgainFrom', { date: boldDate(free) });
    bodyEl.innerHTML = html;
  } else if(exitISO === null){
    kickerEl.textContent = t('home.status');
    titleEl.textContent = t('home.na');
    bodyEl.innerHTML = t('home.noCompliantStay', { date: boldDate(entryForCalc) });
  } else {
    kickerEl.textContent = t('home.lastDayToLeave');
    titleEl.textContent = fmt(exitISO);
    let html = t('home.usedOfWindow', { used, date: boldDate(refISO) });
    if(remaining <= 20) html += tn('home.marginLeft', remaining);
    bodyEl.innerHTML = html;
  }

  const todayPill = document.getElementById('qcTodayPill');
  todayPill.style.display = (refISO === todayISO()) ? '' : 'none';

  renderTripRows();
  renderNextTrip();
  renderCountriesCard();
  renderCheckerCalendar();
  updateChecker();
  updateAppBadge();
  checkNotifications();
  renderBackupNudge();
}

// The trip actually in progress today, if any
function activeTrip(){
  return trips.find(t => classifyTrip(t) === 'active') || null;
}

// Soonest trip that hasn't started yet
function upcomingTrip(){
  const planned = trips.filter(t => classifyTrip(t) === 'planned');
  planned.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  return planned[0] || null;
}

function renderNextTrip(){
  const active = activeTrip();
  const next = upcomingTrip();

  const activePanel = document.getElementById('activeTripPanel');
  const compactPanel = document.getElementById('nextTripCompact');
  const fullPanel = document.getElementById('nextTripPanel');
  const empty = document.getElementById('nextTripEmpty');

  activePanel.style.display = active ? 'flex' : 'none';
  compactPanel.style.display = (active && next) ? 'block' : 'none';
  fullPanel.style.display = (!active && next) ? 'flex' : 'none';
  empty.style.display = !next ? 'block' : 'none';

  if(active) renderActiveTrip(active);
  if(active && next) renderCompactNextTrip(next);
  if(!active && next) renderFullNextTrip(next);
}

function renderActiveTrip(trip){
  const panel = document.getElementById('activeTripPanel');
  const tagRow = document.getElementById('activeTripTagRow');
  const tagEl = document.getElementById('activeTripTag');
  const bigEl = document.getElementById('activeTripBig');
  const bigLabelEl = document.getElementById('activeTripBigLabel');
  const dividerEl = document.getElementById('activeTripDivider');
  const bodyEl = document.getElementById('activeTripBody');

  document.getElementById('activeTripCountry').textContent = trip.label || t('calendar.dash');

  // A trip already in progress can't shift its start or trim its already-lived days, so
  // the overstay case is framed as "you're over" (reusing the same copy as the Quick check
  // card above) rather than the forward-looking trim/later-start suggestions used for a
  // trip that hasn't started yet.
  const overstay = tripOverstayInfo(trips, trip, 90);
  if(overstay){
    const overBy = overstay.used - 90;
    tagRow.style.display = 'flex';
    tagEl.textContent = t('home.overstayRisk');
    tagEl.className = 'tag tag-accent-2';
    bigEl.style.display = 'none';
    bigLabelEl.style.display = 'none';
    dividerEl.style.display = 'none';
    bodyEl.innerHTML = tn('home.overLimitBody', overBy, { used: overstay.used, date: boldDate(overstay.date) });
  } else {
    const maxDays = maxConsecutiveFrom(trips, trip.start, 90);
    const lastExit = isoOf(addDays(toDate(trip.start), maxDays - 1));
    const daysLeft = Math.round((toDate(lastExit) - toDate(todayISO())) / 86400000) + 1;

    tagRow.style.display = 'none';
    bigEl.style.display = 'block';
    bigEl.textContent = String(daysLeft);
    bigLabelEl.style.display = 'block';
    bigLabelEl.textContent = tn('home.activeDaysLeft', daysLeft);
    dividerEl.style.display = 'block';
    bodyEl.innerHTML = t('home.activeTripMeta', {
      entry: fmt(trip.start),
      exit: fmt(trip.end),
      maxDate: boldDate(lastExit)
    });
  }

  panel.onclick = () => switchTab('trips');
}

function renderCompactNextTrip(trip){
  const row = document.getElementById('nextTripCompact');
  document.getElementById('nextTripCompactCountry').textContent = trip.label || t('calendar.dash');
  document.getElementById('nextTripCompactDates').textContent = `${fmt(trip.start)} → ${fmt(trip.end)}`;
  row.onclick = () => switchTab('trips');
}

function renderFullNextTrip(trip){
  const days = Math.round((toDate(trip.end) - toDate(trip.start)) / 86400000) + 1;
  document.getElementById('nextTripCountry').textContent = trip.label || t('calendar.dash');
  document.getElementById('nextTripDates').textContent = `${fmt(trip.start)} → ${fmt(trip.end)} · ${tn('trips.marginDays', days)}`;

  const tagEl = document.getElementById('nextTripTag');
  const suggestionEl = document.getElementById('nextTripSuggestion');
  const otherTrips = trips.filter(t => t.id !== trip.id);
  const suggestion = computeTripSuggestion(trips, otherTrips, trip.start, trip.end, 90);
  if(suggestion.overstay){
    tagEl.textContent = t('home.overstayRisk');
    tagEl.className = 'tag tag-accent-2';
    suggestionEl.innerHTML = suggestion.suggestions[0] ? suggestion.suggestions[0].label : '';
  } else {
    tagEl.textContent = t('home.withinLimits');
    tagEl.className = 'tag tag-accent';
    suggestionEl.innerHTML = suggestion.extendable
      ? tn('home.extendSuggestion', suggestion.extra, { date: fmt(suggestion.lastExit) })
      : '';
  }

  document.getElementById('nextTripPanel').onclick = () => switchTab('trips');
}

// Countries with a trip that's already started (active or past) count as "visited" —
// like a passport stamp you only get once you've actually been there.
function visitedCountries(){
  const set = new Set();
  for(const t of trips){
    if(classifyTrip(t) !== 'planned' && t.label) set.add(t.label);
  }
  return set;
}

function renderCountriesCard(){
  const visited = visitedCountries();
  document.getElementById('countriesCount').textContent = t('home.countriesOf', { count: visited.size, total: ALL_COUNTRIES.length });
}

function renderCountries(){
  const visited = visitedCountries();
  document.getElementById('countriesSubtitle').textContent =
    t('countries.subtitle', { count: visited.size, total: ALL_COUNTRIES.length });
  const grid = document.getElementById('countriesGrid');
  grid.innerHTML = '';
  for(const name of ALL_COUNTRIES){
    const tile = document.createElement('div');
    if(visited.has(name)){
      tile.className = 'country-tile visited';
      tile.innerHTML = `${stampHtml(name)}<div class="name">${name}</div>`;
    } else {
      tile.className = 'country-tile pending';
      tile.innerHTML = `<div class="name">${name}</div>`;
    }
    grid.appendChild(tile);
  }
}

// --- Trips list ---

function renderTripRows(){
  const rowsEl = document.getElementById('tripRows');
  rowsEl.innerHTML = '';
  if(trips.length === 0){
    rowsEl.innerHTML = `<div class="empty-note">${t('trips.noStaysLogged')}</div>`;
    return;
  }
  trips.sort((a,b)=>{
    const aActive = classifyTrip(a) === 'active';
    const bActive = classifyTrip(b) === 'active';
    if(aActive !== bActive) return aActive ? -1 : 1;
    return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
  });
  for(const trip of trips){
    const days = Math.round((toDate(trip.end) - toDate(trip.start))/86400000) + 1;
    const status = classifyTrip(trip);
    const overstay = tripOverstayInfo(trips, trip, 90);
    const warnIcon = overstay
      ? `<span class="warn-icon" title="${t('trips.overstayWarnTitle', { date: fmt(overstay.date), used: overstay.used })}">&#9888;</span>`
      : '';

    let statusHtml;
    if(status === 'past'){
      statusHtml = `<div class="done-stamp"><div class="t">${t('trips.done')}</div><svg viewBox="0 0 24 24" fill="var(--color-text)"><path d="M12 0l2.9 8.1 8.6.1-6.9 5.3 2.6 8.2L12 16.9 5.8 21.7l2.6-8.2L1.5 8.2l8.6-.1z"></path></svg></div>`;
    } else if(status === 'active'){
      statusHtml = `<span class="tag tag-accent">${t('trips.active')}</span>`;
    } else {
      statusHtml = `<span class="tag tag-outline">${t('trips.planned')}</span>`;
    }

    let exclDays = 0;
    for(const r of (trip.excludedRanges || [])) exclDays += Math.round((toDate(r.end) - toDate(r.start))/86400000) + 1;
    const exclNote = exclDays > 0
      ? `<div style="margin-top:4px;"><span class="tag tag-excluded">${tn('trips.excludedDays', exclDays)}</span></div>`
      : '';

    const row = document.createElement('div');
    row.className = 'card elev-sm trip-row';
    row.innerHTML = `
      <div class="trip-days"><div class="n">${days}</div><div class="lbl">${t('trips.days')}</div></div>
      <div class="trip-info">
        <div class="country">${trip.label ? flagIconHtml(trip.label) : ''}${trip.label ? escapeHtml(trip.label) : t('calendar.dash')}${warnIcon}</div>
        <div class="dates">${fmt(trip.start)} – ${fmt(trip.end)}</div>
        ${exclNote}
        <div class="row-actions">
          <button type="button" class="link-btn" data-action="edit" data-id="${trip.id}">${t('trips.edit')}</button>
          <button type="button" class="link-btn danger-link" data-action="remove" data-id="${trip.id}">${t('trips.remove')}</button>
        </div>
      </div>
      <div class="trip-status">${statusHtml}</div>
    `;
    rowsEl.appendChild(row);
  }
  rowsEl.querySelectorAll('[data-action="remove"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      await deleteTrip(e.currentTarget.getAttribute('data-id'));
      render();
    });
  });
  rowsEl.querySelectorAll('[data-action="edit"]').forEach(btn=>{
    btn.addEventListener('click', (e)=> startEditTrip(e.currentTarget.getAttribute('data-id')));
  });
}

// --- Safe Trip Checker (Trips tab) ---

function updateChecker(){
  const msgEl = document.getElementById('checkerMsg');
  const errEl = document.getElementById('checkerError');
  const saveBtn = document.getElementById('checkerSaveBtn');
  const breakdownBtn = document.getElementById('checkerBreakdownBtn');
  const suggestionsEl = document.getElementById('checkerSuggestions');
  const start = document.getElementById('checkerEntry').value;
  const end = document.getElementById('checkerExit').value;
  errEl.style.display = 'none';
  breakdownBtn.style.display = 'none';
  suggestionsEl.style.display = 'none';
  suggestionsEl.innerHTML = '';
  renderCheckerExclusionSection();

  if(!start || !end){
    msgEl.textContent = t('trips.checkerPrompt');
    saveBtn.disabled = true;
    return;
  }
  if(end < start){
    msgEl.textContent = '';
    errEl.textContent = t('trips.checkerExitBeforeEntry');
    errEl.style.display = 'block';
    saveBtn.disabled = true;
    return;
  }

  const days = Math.round((toDate(end) - toDate(start)) / 86400000) + 1;
  const hypothetical = trips.concat([{ start, end, label: '__checker__', excludedRanges: checkerPendingExcludedRanges }]);
  const overstay = tripOverstayInfo(hypothetical, { start, end }, 90);
  breakdownBtn.style.display = 'inline-flex';
  if(overstay){
    msgEl.innerHTML = t('trips.checkerResult.breach', { n: days, date: fmt(overstay.date), used: overstay.used });
    const suggestion = computeTripSuggestion(hypothetical, trips, start, end, 90);
    if(suggestion.suggestions.length){
      suggestionsEl.style.display = 'grid';
      for(const s of suggestion.suggestions){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'suggestion-btn';
        btn.innerHTML = s.label;
        btn.addEventListener('click', ()=>{
          checkerPickStart = s.start; checkerPickEnd = s.end;
          document.getElementById('checkerEntry').value = s.start;
          document.getElementById('checkerExit').value = s.end;
          document.getElementById('checkerPickStartLbl').textContent = t('calendar.entryTag', { date: fmt(s.start) });
          document.getElementById('checkerPickEndLbl').textContent = t('calendar.exitTag', { date: fmt(s.end) });
          checkerPendingExcludedRanges = checkerPendingExcludedRanges.filter(r => r.start >= s.start && r.end <= s.end);
          checkerCalCursor = new Date(toDate(s.start)); checkerCalCursor.setDate(1);
          renderCheckerCalendar();
          updateChecker();
        });
        suggestionsEl.appendChild(btn);
      }
    }
  } else {
    const margin = 90 - usedDaysInWindow(hypothetical, end);
    msgEl.innerHTML = t('trips.checkerResult.safe', { n: days, margin: tn('trips.marginDays', margin), date: fmt(end) });
  }
  saveBtn.disabled = false;
}

// --- Checker's own mini calendar + side-trip exclusion (tap-based, mirrors the Calendar tab) ---

function renderCheckerCalendar(){
  const label = document.getElementById('checkerCalMonthLabel');
  label.textContent = checkerCalCursor.toLocaleDateString('en-GB',{month:'long', year:'numeric'});
  const grid = document.getElementById('checkerCalGrid');
  grid.innerHTML = '';
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d=>{
    const el = document.createElement('div');
    el.className='cal-dow'; el.textContent=d;
    grid.appendChild(el);
  });
  const year = checkerCalCursor.getFullYear(), month = checkerCalCursor.getMonth();
  const firstDay = new Date(year, month, 1);
  let startOffset = firstDay.getDay() - 1; if(startOffset < 0) startOffset = 6;
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const covered = coveredDates(trips);
  const plannedSet = coveredDates(trips.filter(t=>classifyTrip(t)==='planned'));
  const excluded = excludedDatesSet(trips);
  const today = todayISO();

  for(let i=0;i<startOffset;i++){
    const pad = document.createElement('div'); pad.className='cal-day pad';
    grid.appendChild(pad);
  }
  for(let day=1; day<=daysInMonth; day++){
    const iso = year+'-'+String(month+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
    const el = document.createElement('div');
    el.className = 'cal-day';
    if(covered.has(iso)){
      el.classList.add('in-trip');
      if(plannedSet.has(iso)) el.classList.add('planned');
    } else if(excluded.has(iso)){
      el.classList.add('excluded');
    }
    if(checkerPendingExcludedRanges.some(r => iso >= r.start && iso <= r.end)) el.classList.add('excluded');
    if(iso === today) el.classList.add('today');
    const used = usedDaysInWindow(trips, iso);
    const remaining = 90 - used;
    if(used > 90) el.classList.add('overstay');
    if(checkerPickStart && iso === checkerPickStart) el.classList.add('pick-start');
    if(checkerPickEnd && iso === checkerPickEnd) el.classList.add('pick-end');
    if(checkerPickStart && checkerPickEnd && iso > checkerPickStart && iso < checkerPickEnd) el.classList.add('pick-range');
    if(checkerPickingExclusion){
      if(!checkerPickStart || !checkerPickEnd || iso < checkerPickStart || iso > checkerPickEnd){
        el.classList.add('excl-disabled');
      } else if(checkerExclPickStart && (iso === checkerExclPickStart || (checkerExclPickEnd && iso >= checkerExclPickStart && iso <= checkerExclPickEnd))){
        el.classList.add('selecting');
      }
    }
    el.innerHTML = `<span class="daynum">${day}</span><span class="rem">${used>90 ? '−'+(used-90) : remaining}</span>`;
    el.addEventListener('click', ()=>checkerHandlePick(iso));
    grid.appendChild(el);
  }
}

document.getElementById('checkerPrevMonth').addEventListener('click', ()=>{
  checkerCalCursor.setMonth(checkerCalCursor.getMonth()-1);
  renderCheckerCalendar();
});
document.getElementById('checkerNextMonth').addEventListener('click', ()=>{
  checkerCalCursor.setMonth(checkerCalCursor.getMonth()+1);
  renderCheckerCalendar();
});

function checkerHandlePick(iso){
  if(checkerPickingExclusion){
    checkerHandleExclusionPick(iso);
    return;
  }
  if(!checkerPickStart || (checkerPickStart && checkerPickEnd)){
    checkerPickStart = iso; checkerPickEnd = null;
    checkerPendingExcludedRanges = []; // range is changing — old side trips may no longer make sense
  } else {
    if(iso >= checkerPickStart) checkerPickEnd = iso;
    else { checkerPickEnd = checkerPickStart; checkerPickStart = iso; }
  }
  document.getElementById('checkerEntry').value = checkerPickStart || '';
  document.getElementById('checkerExit').value = checkerPickEnd || '';
  document.getElementById('checkerPickStartLbl').textContent = t('calendar.entryTag', { date: checkerPickStart ? fmt(checkerPickStart) : t('calendar.dash') });
  document.getElementById('checkerPickEndLbl').textContent = t('calendar.exitTag', { date: checkerPickEnd ? fmt(checkerPickEnd) : t('calendar.dash') });
  renderCheckerCalendar();
  updateChecker();
}

function checkerHandleExclusionPick(iso){
  if(!checkerPickStart || !checkerPickEnd || iso < checkerPickStart || iso > checkerPickEnd) return;
  if(!checkerExclPickStart || (checkerExclPickStart && checkerExclPickEnd)){
    checkerExclPickStart = iso; checkerExclPickEnd = null;
  } else {
    if(iso >= checkerExclPickStart) checkerExclPickEnd = iso;
    else { checkerExclPickEnd = checkerExclPickStart; checkerExclPickStart = iso; }
  }
  document.getElementById('checkerExclusionError').style.display = 'none';
  updateCheckerExclusionPickLabels();
  renderCheckerCalendar();
}

function updateCheckerExclusionPickLabels(){
  document.getElementById('checkerExclPickStartLbl').textContent = t('calendar.exclusionFromTag', { date: checkerExclPickStart ? fmt(checkerExclPickStart) : t('calendar.dash') });
  document.getElementById('checkerExclPickEndLbl').textContent = t('calendar.exclusionToTag', { date: checkerExclPickEnd ? fmt(checkerExclPickEnd) : t('calendar.dash') });
}

function renderCheckerExclusionSection(){
  const start = document.getElementById('checkerEntry').value;
  const end = document.getElementById('checkerExit').value;
  const section = document.getElementById('checkerExclusionSection');
  const prompt = document.getElementById('checkerExclusionPrompt');
  if(!start || !end || end < start){
    section.style.display = 'none';
    prompt.style.display = 'block';
    checkerPickingExclusion = false; checkerEditingExclusionIndex = null;
    renderCheckerExclusionList();
    return;
  }
  prompt.style.display = 'none';
  section.style.display = 'block';
  document.getElementById('checkerExclusionNote').textContent = t('calendar.exclusionNote', { start: fmt(start), end: fmt(end) });

  const tooShort = start === end;
  if(tooShort){
    checkerPickingExclusion = false; checkerEditingExclusionIndex = null;
  }
  document.getElementById('checkerMarkSideTripBtn').style.display = !tooShort ? 'block' : 'none';
  document.getElementById('checkerExclusionTooShort').style.display = tooShort ? 'block' : 'none';
  document.getElementById('checkerExclusionPicker').style.display = (!tooShort && checkerPickingExclusion) ? 'block' : 'none';
  document.getElementById('checkerAddExclusionBtn').textContent = checkerEditingExclusionIndex !== null ? t('calendar.saveExclusion') : t('calendar.addExclusion');

  updateCheckerExclusionPickLabels();
  renderCheckerExclusionList();
}

function renderCheckerExclusionList(){
  const listEl = document.getElementById('checkerExclusionList');
  listEl.innerHTML = '';
  checkerPendingExcludedRanges.forEach((r, idx)=>{
    const days = Math.round((toDate(r.end) - toDate(r.start)) / 86400000) + 1;
    const item = document.createElement('div');
    item.className = 'exclusion-item';
    item.innerHTML = `<span>${fmt(r.start)} – ${fmt(r.end)} (${tn('calendar.exclusionDays', days)})</span>`;
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'link-btn';
    editBtn.textContent = t('calendar.exclusionEdit');
    editBtn.addEventListener('click', ()=>{
      checkerEditingExclusionIndex = idx;
      checkerPickingExclusion = true;
      checkerExclPickStart = r.start; checkerExclPickEnd = r.end;
      document.getElementById('checkerExclusionError').style.display = 'none';
      renderCheckerExclusionSection();
      renderCheckerCalendar();
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'link-btn danger-link';
    removeBtn.textContent = t('calendar.exclusionRemove');
    removeBtn.addEventListener('click', ()=>{
      checkerPendingExcludedRanges.splice(idx, 1);
      if(checkerEditingExclusionIndex === idx){
        checkerPickingExclusion = false; checkerExclPickStart = null; checkerExclPickEnd = null; checkerEditingExclusionIndex = null;
      }
      renderCheckerExclusionSection();
      renderCheckerCalendar();
      updateChecker();
    });
    const actions = document.createElement('div');
    actions.className = 'exclusion-item-actions';
    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);
    item.appendChild(actions);
    listEl.appendChild(item);
  });
}

document.getElementById('checkerMarkSideTripBtn').addEventListener('click', ()=>{
  checkerPickingExclusion = true;
  checkerExclPickStart = null; checkerExclPickEnd = null; checkerEditingExclusionIndex = null;
  document.getElementById('checkerExclusionError').style.display = 'none';
  renderCheckerExclusionSection();
  renderCheckerCalendar();
});

document.getElementById('checkerCancelExclusionBtn').addEventListener('click', ()=>{
  checkerPickingExclusion = false;
  checkerExclPickStart = null; checkerExclPickEnd = null; checkerEditingExclusionIndex = null;
  document.getElementById('checkerExclusionError').style.display = 'none';
  renderCheckerExclusionSection();
  renderCheckerCalendar();
});

document.getElementById('checkerAddExclusionBtn').addEventListener('click', ()=>{
  const errEl = document.getElementById('checkerExclusionError');
  errEl.style.display = 'none';
  if(!checkerExclPickStart || !checkerExclPickEnd){
    errEl.textContent = t('calendar.exclusionMissingDates');
    errEl.style.display = 'block';
    return;
  }
  const overlaps = checkerPendingExcludedRanges.some((r, idx) => idx !== checkerEditingExclusionIndex && checkerExclPickStart <= r.end && checkerExclPickEnd >= r.start);
  if(overlaps){
    errEl.textContent = t('calendar.exclusionOverlap');
    errEl.style.display = 'block';
    return;
  }
  if(checkerEditingExclusionIndex !== null){
    checkerPendingExcludedRanges[checkerEditingExclusionIndex] = { start: checkerExclPickStart, end: checkerExclPickEnd };
  } else {
    checkerPendingExcludedRanges.push({ start: checkerExclPickStart, end: checkerExclPickEnd });
  }
  checkerPendingExcludedRanges.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  checkerPickingExclusion = false;
  checkerExclPickStart = null; checkerExclPickEnd = null; checkerEditingExclusionIndex = null;
  renderCheckerExclusionSection();
  renderCheckerCalendar();
  updateChecker();
});

document.getElementById('checkerSaveBtn').addEventListener('click', async ()=>{
  const label = document.getElementById('checkerCountry').value;
  const start = document.getElementById('checkerEntry').value;
  const end = document.getElementById('checkerExit').value;
  const errEl = document.getElementById('checkerError');
  errEl.style.display = 'none';
  if(!start || !end || end < start) return;

  const overlapping = trips.find(ot => ot.id !== editingTripId && start <= ot.end && end >= ot.start);
  if(overlapping){
    const key = editingTripId ? 'trips.overlapUpdateWarning' : 'trips.overlapWarning';
    const proceed = confirm(t(key, { label: overlapping.label, start: fmt(overlapping.start), end: fmt(overlapping.end) }));
    if(!proceed) return;
  }
  const wasEditing = editingTripId !== null;
  try{
    if(wasEditing){
      await updateTrip(editingTripId, start, end, label, checkerPendingExcludedRanges);
    } else {
      await insertTrip(start, end, label, checkerPendingExcludedRanges);
    }
  }catch(e){
    errEl.textContent = t('trips.saveError');
    errEl.style.display = 'block';
    return;
  }
  stopCheckerEdit();
  render();
});

// Pre-fill the Safe Trip Checker with an existing trip's data and switch it into edit mode
function startEditTrip(id){
  const trip = trips.find(t => String(t.id) === String(id));
  if(!trip) return;

  editingTripId = trip.id;
  checkerPickStart = trip.start;
  checkerPickEnd = trip.end;
  checkerPendingExcludedRanges = (trip.excludedRanges || []).map(r => ({ ...r }));
  checkerPickingExclusion = false; checkerExclPickStart = null; checkerExclPickEnd = null; checkerEditingExclusionIndex = null;
  document.getElementById('checkerCountry').value = trip.label;
  document.getElementById('checkerEntry').value = trip.start;
  document.getElementById('checkerExit').value = trip.end;
  document.getElementById('checkerPickStartLbl').textContent = t('calendar.entryTag', { date: fmt(trip.start) });
  document.getElementById('checkerPickEndLbl').textContent = t('calendar.exitTag', { date: fmt(trip.end) });
  document.getElementById('checkerError').style.display = 'none';
  document.getElementById('checkerSaveBtn').textContent = t('trips.updateTrip');
  document.getElementById('checkerCancelEditBtn').style.display = 'block';
  document.getElementById('checkerEditingNote').style.display = 'block';

  checkerCalCursor = new Date(toDate(trip.start)); checkerCalCursor.setDate(1);
  switchTab('trips');
  renderCheckerCalendar();
  renderCheckerExclusionSection();
  updateChecker();
  document.getElementById('checkerCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Leaves edit mode, whether from a successful save or an explicit cancel
function stopCheckerEdit(){
  editingTripId = null;
  checkerPickStart = null; checkerPickEnd = null;
  checkerPendingExcludedRanges = [];
  checkerPickingExclusion = false; checkerExclPickStart = null; checkerExclPickEnd = null; checkerEditingExclusionIndex = null;
  document.getElementById('checkerEntry').value = '';
  document.getElementById('checkerExit').value = '';
  document.getElementById('checkerPickStartLbl').textContent = t('calendar.entryTag', { date: t('calendar.dash') });
  document.getElementById('checkerPickEndLbl').textContent = t('calendar.exitTag', { date: t('calendar.dash') });
  document.getElementById('checkerError').style.display = 'none';
  document.getElementById('checkerSaveBtn').textContent = t('trips.saveTrip');
  document.getElementById('checkerCancelEditBtn').style.display = 'none';
  document.getElementById('checkerEditingNote').style.display = 'none';
  renderCheckerCalendar();
  renderCheckerExclusionSection();
  updateChecker();
}

document.getElementById('checkerCancelEditBtn').addEventListener('click', ()=>{
  stopCheckerEdit();
});

document.getElementById('refDate').addEventListener('change', render);

document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(!confirm(t('calendar.clearStays'))) return;
  await deleteAllTrips();
  render();
});

// --- Notification thresholds (Settings) ---

function loadNotifPrefs(){
  try{
    const raw = localStorage.getItem(NOTIF_PREFS_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  return [14, 7]; // matches the design's default: 14 & 7 checked, 3 unchecked
}
function saveNotifPrefs(thresholds){
  localStorage.setItem(NOTIF_PREFS_KEY, JSON.stringify(thresholds));
}
function enabledThresholds(){
  const prefs = new Set(loadNotifPrefs());
  return [14, 7, 3].filter(t => prefs.has(t));
}

// --- Export trip history for visa/border use (CSV + print) — separate from the JSON backup ---

function csvEscape(val){
  const s = String(val);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function sortedTrips(){
  return [...trips].sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
}

function excludedDayCount(trip){
  let n = 0;
  for(const r of (trip.excludedRanges || [])) n += Math.round((toDate(r.end) - toDate(r.start))/86400000) + 1;
  return n;
}

document.getElementById('exportCsvBtn').addEventListener('click', ()=>{
  const header = ['Country','Entry date','Exit date','Days','Excluded days','Status'];
  const rows = [header];
  for(const t of sortedTrips()){
    const days = Math.round((toDate(t.end) - toDate(t.start))/86400000) + 1;
    rows.push([t.label || '', t.start, t.end, String(days), String(excludedDayCount(t)), classifyTrip(t)]);
  }
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `schengen-guard-trips-${todayISO()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

document.getElementById('printTripsBtn').addEventListener('click', ()=>{
  let html = `<h1>Schengen Guard — trip history</h1><p>Generated ${fmt(todayISO())}</p>`;
  html += '<table><thead><tr><th>Country</th><th>Entry</th><th>Exit</th><th>Days</th><th>Excluded days</th><th>Status</th></tr></thead><tbody>';
  for(const t of sortedTrips()){
    const days = Math.round((toDate(t.end) - toDate(t.start))/86400000) + 1;
    html += `<tr><td>${escapeHtml(t.label || '')}</td><td>${fmt(t.start)}</td><td>${fmt(t.end)}</td><td>${days}</td><td>${excludedDayCount(t)}</td><td>${classifyTrip(t)}</td></tr>`;
  }
  html += '</tbody></table>';
  document.getElementById('printArea').innerHTML = html;
  window.print();
});

function initNotifCheckboxes(){
  const prefs = new Set(loadNotifPrefs());
  const map = { notif14: 14, notif7: 7, notif3: 3 };
  Object.entries(map).forEach(([id, threshold])=>{
    const box = document.getElementById(id);
    box.checked = prefs.has(threshold);
    box.addEventListener('change', ()=>{
      const current = new Set(loadNotifPrefs());
      if(box.checked){
        current.add(threshold);
        if('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
      } else {
        current.delete(threshold);
      }
      saveNotifPrefs([...current]);
    });
  });
}

// Fires a local notification once per threshold per rolling window: tracks the lowest
// threshold already notified for the current "streak" of being under 14 days remaining,
// and resets once the count climbs back above every threshold (a new window has opened up).
function checkNotifications(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const realRemaining = Math.max(0, 90 - usedDaysInWindow(trips, todayISO()));
  const thresholds = enabledThresholds();
  if(realRemaining > 14){
    localStorage.removeItem(NOTIF_LAST_FIRED_KEY);
    return;
  }
  const lastFired = Number(localStorage.getItem(NOTIF_LAST_FIRED_KEY) || Infinity);
  for(const threshold of thresholds){
    if(realRemaining <= threshold && threshold < lastFired){
      try{
        new Notification(t('notification.title'), {
          body: tn('notification.body', realRemaining)
        });
      }catch(e){}
      localStorage.setItem(NOTIF_LAST_FIRED_KEY, String(threshold));
      break;
    }
  }
}

// --- "How is this calculated?" day-by-day breakdown (Home + Safe Trip Checker) ---

// Which trip's label (if any) accounts for a given counted day — lets the breakdown
// show "France" instead of a generic "In Schengen" status, so it's clear at a glance
// which stay is responsible for each day.
function coveringTripLabel(list, iso){
  const trip = list.find(t => t.start <= iso && iso <= t.end && !isExcludedDay(t, iso));
  return trip ? (trip.label || t('calendar.dash')) : t('breakdown.inSchengen');
}

function openBreakdown(list, windowEndISO){
  const windowEnd = toDate(windowEndISO);
  const windowStart = addDays(windowEnd, -179);
  const windowStartISO = isoOf(windowStart);
  const covered = coveredDates(list);
  const excluded = excludedDatesSet(list);
  const todayIso = todayISO();

  // One entry per day first — label, counted status, and running total as of that day.
  const days = [];
  let running = 0;
  let cur = windowStart;
  while(cur <= windowEnd){
    const iso = isoOf(cur);
    const counts = covered.has(iso);
    if(counts) running++;
    const label = counts ? coveringTripLabel(list, iso) : (excluded.has(iso) ? t('breakdown.excluded') : t('breakdown.notCounted'));
    days.push({ iso, counts, label, running });
    cur = addDays(cur, 1);
  }

  // Then collapse consecutive days sharing the same (counts, label) into one range row —
  // a 15-day trip becomes a single row instead of 15. The running total shown is the
  // value as of the last day in the range, since that's what changes day-to-day within it.
  const rowsEl = document.getElementById('breakdownRows');
  rowsEl.innerHTML = '';
  let i = 0;
  while(i < days.length){
    let j = i;
    while(j + 1 < days.length && days[j+1].counts === days[i].counts && days[j+1].label === days[i].label) j++;
    const first = days[i], last = days[j];
    const dateText = (i === j) ? fmtShort(first.iso) : `${fmtShort(first.iso)} – ${fmtShort(last.iso)}`;
    const tr = document.createElement('tr');
    if(first.counts) tr.classList.add('counts');
    if(first.iso <= todayIso && todayIso <= last.iso) tr.classList.add('today-row');
    tr.innerHTML = `<td>${dateText}</td><td>${escapeHtml(first.label)}</td><td>${last.running} / 90</td>`;
    rowsEl.appendChild(tr);
    i = j + 1;
  }

  let agedOut = 0;
  for(const iso of covered){ if(iso < windowStartISO) agedOut++; }
  const summaryEl = document.getElementById('breakdownSummary');
  summaryEl.textContent = t('breakdown.summary', { date: fmt(windowEndISO), n: running })
    + (agedOut > 0 ? tn('breakdown.agedOut', agedOut) : '');

  document.getElementById('breakdownModal').style.display = 'flex';
}

document.getElementById('homeBreakdownBtn').addEventListener('click', ()=>{
  const refISO = document.getElementById('refDate').value || todayISO();
  openBreakdown(trips, refISO);
});
document.getElementById('checkerBreakdownBtn').addEventListener('click', ()=>{
  const start = document.getElementById('checkerEntry').value;
  const end = document.getElementById('checkerExit').value;
  if(!start || !end || end < start) return;
  const label = document.getElementById('checkerCountry').value;
  openBreakdown(trips.concat([{ start, end, label }]), end);
});
document.getElementById('breakdownCloseBtn').addEventListener('click', ()=>{
  document.getElementById('breakdownModal').style.display = 'none';
});
document.getElementById('breakdownModal').addEventListener('click', (e)=>{
  if(e.target.id === 'breakdownModal') document.getElementById('breakdownModal').style.display = 'none';
});

// --- Backup / restore (the only mechanism for keeping trip data — there is no account) ---

function markTripsChanged(){
  // Any edit re-opens the nudge on the next render unless a fresh-enough backup already covers it.
}

function renderBackupNudgeText(){
  const linkHtml = `<a href="#" id="backupNudgeLink">${t('backupNudge.link')}</a>`;
  document.getElementById('backupNudgeText').innerHTML = t('backupNudge.text', { link: linkHtml });
}

function renderBackupNudge(){
  const banner = document.getElementById('backupNudge');
  if(trips.length === 0){ banner.style.display = 'none'; return; }

  const lastBackup = Number(localStorage.getItem(LAST_BACKUP_KEY) || 0);
  const dismissedAt = Number(localStorage.getItem(BACKUP_NUDGE_DISMISSED_KEY) || 0);
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const needsBackup = (Date.now() - lastBackup) > SEVEN_DAYS_MS;
  const recentlyDismissed = (Date.now() - dismissedAt) < SEVEN_DAYS_MS;

  banner.style.display = (needsBackup && !recentlyDismissed) ? 'flex' : 'none';
}

document.getElementById('backupNudgeDismiss').addEventListener('click', ()=>{
  localStorage.setItem(BACKUP_NUDGE_DISMISSED_KEY, String(Date.now()));
  document.getElementById('backupNudge').style.display = 'none';
});
// Delegated so the link keeps working after renderBackupNudgeText() replaces it via innerHTML
document.getElementById('backupNudgeText').addEventListener('click', (e)=>{
  if(e.target && e.target.id === 'backupNudgeLink'){
    e.preventDefault();
    switchTab('settings');
  }
});

function updateLastBackupNote(){
  const note = document.getElementById('lastBackupNote');
  const lastBackup = Number(localStorage.getItem(LAST_BACKUP_KEY) || 0);
  if(!lastBackup){ note.style.display = 'none'; return; }
  note.style.display = 'block';
  note.textContent = t('settings.lastBackup', { date: fmt(isoOf(new Date(lastBackup))) });
}

document.getElementById('exportBtn').addEventListener('click', ()=>{
  const payload = { schemaVersion: SCHEMA_VERSION, trips };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `schengen-guard-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  document.getElementById('backupNudge').style.display = 'none';
  updateLastBackupNote();
});

document.getElementById('importBtn').addEventListener('click', ()=>{
  document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (e)=>{
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file later
  if(!file) return;
  const errEl = document.getElementById('backupError');
  errEl.style.display = 'none';

  let parsed;
  try{
    const text = await file.text();
    parsed = JSON.parse(text);
  }catch(err){
    errEl.textContent = t('settings.importError.parse');
    errEl.style.display = 'block';
    return;
  }

  if(!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.trips) || typeof parsed.schemaVersion !== 'number'){
    errEl.textContent = t('settings.importError.shape');
    errEl.style.display = 'block';
    return;
  }
  if(parsed.schemaVersion > SCHEMA_VERSION){
    errEl.textContent = t('settings.importError.newer');
    errEl.style.display = 'block';
    return;
  }
  const validTrips = parsed.trips.every(it => it && typeof it.start === 'string' && typeof it.end === 'string');
  if(!validTrips){
    errEl.textContent = t('settings.importError.malformed');
    errEl.style.display = 'block';
    return;
  }

  // schemaVersion 1 is the only shape so far, so no migration step is needed yet.
  pendingImportTrips = parsed.trips.map(it => ({
    id: typeof it.id === 'string' ? it.id : newId(),
    start: it.start, end: it.end, label: it.label || '',
    excludedRanges: Array.isArray(it.excludedRanges) ? it.excludedRanges : []
  }));

  if(trips.length === 0){
    await applyImport('replace');
    return;
  }
  document.getElementById('importModalMsg').textContent =
    t('settings.importPrompt', { existing: tn('settings.tripCount', trips.length), incoming: pendingImportTrips.length });
  document.getElementById('importModal').style.display = 'flex';
});

async function applyImport(mode){
  if(!pendingImportTrips) return;
  if(mode === 'replace'){
    await dbClearAll();
    await dbPutAll(pendingImportTrips);
  } else {
    await dbPutAll(pendingImportTrips);
  }
  pendingImportTrips = null;
  document.getElementById('importModal').style.display = 'none';
  await loadTrips();
  render();
}

document.getElementById('importMergeBtn').addEventListener('click', ()=> applyImport('merge'));
document.getElementById('importReplaceBtn').addEventListener('click', ()=> applyImport('replace'));
document.getElementById('importCancelBtn').addEventListener('click', ()=>{
  pendingImportTrips = null;
  document.getElementById('importModal').style.display = 'none';
});

// --- Theme ---
const THEME_KEY = 'schengenGuardTheme';
const THEME_COLORS = { light:'#f3f2f2', dark:'#1b1918' };
const darkMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

function resolvedTheme(choice){
  return choice === 'system' ? (darkMediaQuery.matches ? 'dark' : 'light') : choice;
}
function applyTheme(choice){
  if(choice === 'light' || choice === 'dark'){
    document.documentElement.setAttribute('data-theme', choice);
  } else {
    choice = 'system';
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem(THEME_KEY, choice);
  document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_COLORS[resolvedTheme(choice)]);
  document.querySelectorAll('.theme-btn').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-theme-choice') === choice);
  });
}
document.getElementById('themeLightBtn').addEventListener('click', ()=> applyTheme('light'));
document.getElementById('themeDarkBtn').addEventListener('click', ()=> applyTheme('dark'));
document.getElementById('themeSystemBtn').addEventListener('click', ()=> applyTheme('system'));
darkMediaQuery.addEventListener('change', ()=>{
  if((localStorage.getItem(THEME_KEY) || 'system') === 'system'){
    document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_COLORS[resolvedTheme('system')]);
  }
});

// Fixed to when this copy was last actually reviewed — not "today", which would
// falsely imply a fresh review happens on every page load.
const ETIAS_LAST_CHECKED_ISO = '2026-08-12';
function renderEtiasLastChecked(){
  const el = document.getElementById('etiasLastChecked');
  if(!el) return;
  const linkHtml = '<a href="https://etias.europa.eu" target="_blank" rel="noopener">etias.europa.eu</a>';
  el.innerHTML = t('faq.etias.lastChecked', { date: fmt(ETIAS_LAST_CHECKED_ISO), link: linkHtml });
}

// --- Language switcher (Settings) ---

async function applyLang(lang){
  if(VALID_LANGS.indexOf(lang) === -1) lang = 'en';
  await loadLocale(lang);
  document.documentElement.setAttribute('lang', lang);
  document.documentElement.setAttribute('data-lang', lang);
  localStorage.setItem(LANG_KEY, lang);
  document.querySelectorAll('[data-lang-choice]').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-lang-choice') === lang);
  });
  applyStaticI18n();
  renderEtiasLastChecked();
  render();
}
document.getElementById('langEnBtn').addEventListener('click', ()=> applyLang('en'));
document.getElementById('langZhBtn').addEventListener('click', ()=> applyLang('zh'));
document.getElementById('langJaBtn').addEventListener('click', ()=> applyLang('ja'));

// Keeps "today" (and therefore the badge, stamp gauge, etc.) current if the app is
// left open across midnight — checked on an hourly timer and whenever the tab/app
// regains focus, since there's no way to update the badge while fully closed.
let lastKnownDay = todayISO();
function checkDayRollover(){
  const today = todayISO();
  if(today === lastKnownDay) return;
  const refInput = document.getElementById('refDate');
  const wasFollowingToday = refInput.value === lastKnownDay;
  lastKnownDay = today;
  document.getElementById('todayTag').textContent = fmt(today);
  if(wasFollowingToday) refInput.value = today;
  render();
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkDayRollover();
});
setInterval(checkDayRollover, 60 * 60 * 1000);

// --- First-run disclaimer modal — blocking, no dismissal except the acknowledge button ---

function maybeShowFirstRunModal(){
  if(localStorage.getItem(DISCLAIMER_ACK_KEY) === 'true') return;
  document.getElementById('firstRunModal').style.display = 'flex';
}
document.getElementById('firstRunAckBtn').addEventListener('click', ()=>{
  localStorage.setItem(DISCLAIMER_ACK_KEY, 'true');
  document.getElementById('firstRunModal').style.display = 'none';
});

(async function init(){
  applyTheme(localStorage.getItem(THEME_KEY) || 'system');

  const initialLang = document.documentElement.getAttribute('data-lang') || 'en';
  await loadLocale(initialLang);
  document.querySelectorAll('[data-lang-choice]').forEach(btn=>{
    btn.classList.toggle('active', btn.getAttribute('data-lang-choice') === initialLang);
  });
  applyStaticI18n();
  renderEtiasLastChecked();
  maybeShowFirstRunModal();

  document.getElementById('todayTag').textContent = fmt(todayISO());
  document.getElementById('refDate').value = todayISO();

  const checkerCountrySelect = document.getElementById('checkerCountry');
  ALL_COUNTRIES.forEach(name=>{
    const opt = document.createElement('option');
    opt.textContent = name;
    if(name === 'Spain') opt.selected = true;
    checkerCountrySelect.appendChild(opt);
  });

  initNotifCheckboxes();
  updateLastBackupNote();

  await loadTrips();
  render();
})();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      // iOS Safari is slow to notice a changed sw.js on its own — force a check
      // whenever the app opens or comes back to the foreground, the two moments
      // someone actually expects to see a fresh version.
      reg.update();
      document.addEventListener('visibilitychange', () => {
        if(document.visibilityState === 'visible') reg.update();
      });
    }).catch(() => {});
  });

  // Once a new service worker takes over, this page's already-loaded JS/CSS is
  // stale — reload once to pick up what it just activated, rather than leaving
  // the user on the old version until they manually relaunch the app.
  let refreshingForNewSW = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if(refreshingForNewSW) return;
    refreshingForNewSW = true;
    window.location.reload();
  });
}
