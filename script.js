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

let trips = []; // {id, start:'YYYY-MM-DD', end:'YYYY-MM-DD', label, excludedRanges:[{start,end}]}
let calCursor = new Date(); calCursor.setDate(1);
let pickStart = null, pickEnd = null;
let editingTripId = null;
let pendingImportTrips = null;
let pendingExcludedRanges = [];

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
const PRIMARY_TABS = ['home','trips','calendar','settings'];

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
  updateRing(remaining, colorVar);

  const kickerEl = document.getElementById('lastDayKicker');
  const titleEl = document.getElementById('lastDayTitle');
  const bodyEl = document.getElementById('lastDayBody');
  titleEl.style.color = colorVar;

  if(used > 90){
    const overBy = used - 90;
    kickerEl.textContent = t('home.daysOverLimit');
    titleEl.textContent = `+${overBy}`;
    bodyEl.textContent = tn('home.overLimitBody', overBy, { date: fmt(refISO) });
    const free = nextFreeDate(trips, 90);
    if(free) bodyEl.textContent += t('home.compliantAgainFrom', { date: fmt(free) });
  } else if(exitISO === null){
    kickerEl.textContent = t('home.status');
    titleEl.textContent = t('home.na');
    bodyEl.textContent = t('home.noCompliantStay', { date: fmt(entryForCalc) });
  } else {
    kickerEl.textContent = t('home.lastDayToLeave');
    titleEl.textContent = fmt(exitISO);
    const whose = coveringTrip ? t('home.thisStay') : t('home.stayEntering', { date: fmt(refISO) });
    bodyEl.textContent = t('home.usedOfWindow', { used, date: fmt(refISO), whose, exit: fmt(exitISO) });
  }

  renderTripRows();
  renderNextTrip();
  renderCountriesCard();
  renderCalendar();
  updateChecker();
  updateAppBadge();
  checkNotifications();
  renderBackupNudge();
}

// Soonest trip that hasn't finished yet (ongoing or upcoming)
function nextTrip(){
  const today = todayISO();
  const upcoming = trips.filter(t => t.end >= today);
  upcoming.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  return upcoming[0] || null;
}

function renderNextTrip(){
  const panel = document.getElementById('nextTripPanel');
  const empty = document.getElementById('nextTripEmpty');
  const trip = nextTrip();

  if(!trip){
    panel.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  panel.style.display = 'flex';

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

  panel.onclick = () => switchTab('trips');
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
      tile.innerHTML = `<svg viewBox="0 0 24 24" fill="var(--color-accent-700)"><path d="M12 0l2.9 8.1 8.6.1-6.9 5.3 2.6 8.2L12 16.9 5.8 21.7l2.6-8.2L1.5 8.2l8.6-.1z"></path></svg><div class="name">${name}</div>`;
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
  trips.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
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
      ? `<div class="card-meta">${tn('trips.excludedDays', exclDays)}</div>`
      : '';

    const row = document.createElement('div');
    row.className = 'card elev-sm trip-row';
    row.innerHTML = `
      <div class="trip-days"><div class="n">${days}</div><div class="lbl">${t('trips.days')}</div></div>
      <div class="trip-info">
        <div class="country">${trip.label || t('calendar.dash')}${warnIcon}</div>
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
  const hypothetical = trips.concat([{ start, end, label: '__checker__' }]);
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
          document.getElementById('checkerEntry').value = s.start;
          document.getElementById('checkerExit').value = s.end;
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

document.getElementById('checkerEntry').addEventListener('change', updateChecker);
document.getElementById('checkerExit').addEventListener('change', updateChecker);

document.getElementById('checkerSaveBtn').addEventListener('click', async ()=>{
  const label = document.getElementById('checkerCountry').value;
  const start = document.getElementById('checkerEntry').value;
  const end = document.getElementById('checkerExit').value;
  const errEl = document.getElementById('checkerError');
  errEl.style.display = 'none';
  if(!start || !end || end < start) return;

  const overlapping = trips.find(ot => start <= ot.end && end >= ot.start);
  if(overlapping){
    const proceed = confirm(t('trips.overlapWarning', { label: overlapping.label, start: fmt(overlapping.start), end: fmt(overlapping.end) }));
    if(!proceed) return;
  }
  try{
    await insertTrip(start, end, label);
  }catch(e){
    errEl.textContent = t('trips.saveError');
    errEl.style.display = 'block';
    return;
  }
  document.getElementById('checkerEntry').value = '';
  document.getElementById('checkerExit').value = '';
  render();
});

// --- Calendar tab (log/edit a stay by tapping dates) ---

function renderCalendar(){
  const label = document.getElementById('calMonthLabel');
  label.textContent = calCursor.toLocaleDateString('en-GB',{month:'long', year:'numeric'});
  const grid = document.getElementById('calGrid');
  grid.innerHTML = '';
  ['Mo','Tu','We','Th','Fr','Sa','Su'].forEach(d=>{
    const el = document.createElement('div');
    el.className='cal-dow'; el.textContent=d;
    grid.appendChild(el);
  });
  const year = calCursor.getFullYear(), month = calCursor.getMonth();
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
    if(iso === today) el.classList.add('today');
    const used = usedDaysInWindow(trips, iso);
    const remaining = 90 - used;
    if(used > 90) el.classList.add('overstay');
    if(pickStart && iso === pickStart) el.classList.add('pick-start');
    if(pickEnd && iso === pickEnd) el.classList.add('pick-end');
    if(pickStart && pickEnd && iso > pickStart && iso < pickEnd) el.classList.add('pick-range');
    el.innerHTML = `<span class="daynum">${day}</span><span class="rem">${used>90 ? '−'+(used-90) : remaining}</span>`;
    el.addEventListener('click', ()=>handlePick(iso));
    grid.appendChild(el);
  }
}

// Pre-fill the log-a-stay form with an existing trip's data and switch into edit mode
function startEditTrip(id){
  const trip = trips.find(t => String(t.id) === String(id));
  if(!trip) return;

  editingTripId = trip.id;
  pickStart = trip.start;
  pickEnd = trip.end;
  pendingExcludedRanges = (trip.excludedRanges || []).map(r => ({ ...r }));
  document.getElementById('tripLabel').value = trip.label;
  document.getElementById('tripStart').value = trip.start;
  document.getElementById('tripEnd').value = trip.end;
  document.getElementById('pickStartLbl').textContent = t('calendar.entryTag', { date: fmt(trip.start) });
  document.getElementById('pickEndLbl').textContent = t('calendar.exitTag', { date: fmt(trip.end) });
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = t('calendar.updateStay');
  document.getElementById('cancelEditBtn').style.display = 'block';
  document.getElementById('calendarHeading').textContent = t('calendar.editHeading');

  calCursor = new Date(toDate(trip.start)); calCursor.setDate(1);
  switchTab('calendar');
  renderCalendar();
  renderExclusionSection();
}

function stopEditTrip(){
  editingTripId = null;
  pickStart = null; pickEnd = null;
  pendingExcludedRanges = [];
  document.getElementById('tripLabel').value = '';
  document.getElementById('tripStart').value = '';
  document.getElementById('tripEnd').value = '';
  document.getElementById('pickStartLbl').textContent = t('calendar.entryTag', { date: t('calendar.dash') });
  document.getElementById('pickEndLbl').textContent = t('calendar.exitTag', { date: t('calendar.dash') });
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = t('calendar.logStay');
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('calendarHeading').textContent = t('calendar.logHeading');
  renderCalendar();
  renderExclusionSection();
}

// --- Side-trip exclusion (mark days within a logged stay as spent outside Schengen) ---

function renderExclusionSection(){
  const section = document.getElementById('exclusionSection');
  if(!pickStart || !pickEnd){
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  document.getElementById('exclStart').min = pickStart;
  document.getElementById('exclStart').max = pickEnd;
  document.getElementById('exclEnd').min = pickStart;
  document.getElementById('exclEnd').max = pickEnd;
  renderExclusionList();
}

function renderExclusionList(){
  const listEl = document.getElementById('exclusionList');
  listEl.innerHTML = '';
  pendingExcludedRanges.forEach((r, idx)=>{
    const days = Math.round((toDate(r.end) - toDate(r.start)) / 86400000) + 1;
    const item = document.createElement('div');
    item.className = 'exclusion-item';
    item.innerHTML = `<span>${fmt(r.start)} – ${fmt(r.end)} (${tn('calendar.exclusionDays', days)})</span>`;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'link-btn danger-link';
    removeBtn.textContent = t('calendar.exclusionRemove');
    removeBtn.addEventListener('click', ()=>{
      pendingExcludedRanges.splice(idx, 1);
      renderExclusionList();
    });
    item.appendChild(removeBtn);
    listEl.appendChild(item);
  });
}

document.getElementById('addExclusionBtn').addEventListener('click', ()=>{
  const errEl = document.getElementById('exclusionError');
  errEl.style.display = 'none';
  const exStart = document.getElementById('exclStart').value;
  const exEnd = document.getElementById('exclEnd').value;
  if(!exStart || !exEnd){
    errEl.textContent = t('calendar.exclusionMissingDates');
    errEl.style.display = 'block';
    return;
  }
  if(exEnd < exStart){
    errEl.textContent = t('calendar.exclusionEndBeforeStart');
    errEl.style.display = 'block';
    return;
  }
  if(exStart < pickStart || exEnd > pickEnd){
    errEl.textContent = t('calendar.exclusionOutOfRange');
    errEl.style.display = 'block';
    return;
  }
  const overlaps = pendingExcludedRanges.some(r => exStart <= r.end && exEnd >= r.start);
  if(overlaps){
    errEl.textContent = t('calendar.exclusionOverlap');
    errEl.style.display = 'block';
    return;
  }
  pendingExcludedRanges.push({ start: exStart, end: exEnd });
  pendingExcludedRanges.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  document.getElementById('exclStart').value = '';
  document.getElementById('exclEnd').value = '';
  renderExclusionList();
});

document.getElementById('cancelEditBtn').addEventListener('click', ()=>{
  stopEditTrip();
  switchTab('trips');
});

document.getElementById('prevMonth').addEventListener('click', ()=>{
  calCursor.setMonth(calCursor.getMonth()-1);
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', ()=>{
  calCursor.setMonth(calCursor.getMonth()+1);
  renderCalendar();
});

function handlePick(iso){
  if(!pickStart || (pickStart && pickEnd)){
    pickStart = iso; pickEnd = null;
    pendingExcludedRanges = []; // range is changing — old exclusions may no longer make sense
  } else {
    if(iso >= pickStart) pickEnd = iso;
    else { pickEnd = pickStart; pickStart = iso; }
  }
  document.getElementById('tripStart').value = pickStart || '';
  document.getElementById('tripEnd').value = pickEnd || '';
  document.getElementById('pickStartLbl').textContent = t('calendar.entryTag', { date: pickStart ? fmt(pickStart) : t('calendar.dash') });
  document.getElementById('pickEndLbl').textContent = t('calendar.exitTag', { date: pickEnd ? fmt(pickEnd) : t('calendar.dash') });
  renderCalendar();
  renderExclusionSection();
}

document.getElementById('addTripBtn').addEventListener('click', async ()=>{
  const label = document.getElementById('tripLabel').value.trim();
  const start = document.getElementById('tripStart').value;
  const end = document.getElementById('tripEnd').value;
  const errEl = document.getElementById('formError');
  errEl.style.display = 'none';
  if(!start || !end){
    errEl.textContent = t('calendar.missingDates');
    errEl.style.display = 'block';
    return;
  }
  if(end < start){
    errEl.textContent = t('calendar.exitBeforeEntry');
    errEl.style.display = 'block';
    return;
  }
  const overlapping = trips.find(ot => ot.id !== editingTripId && start <= ot.end && end >= ot.start);
  if(overlapping){
    const key = editingTripId ? 'trips.overlapUpdateWarning' : 'trips.overlapLogWarning';
    const proceed = confirm(t(key, { label: overlapping.label, start: fmt(overlapping.start), end: fmt(overlapping.end) }));
    if(!proceed) return;
  }
  const wasEditing = editingTripId !== null;
  try{
    if(wasEditing){
      await updateTrip(editingTripId, start, end, label, pendingExcludedRanges);
    } else {
      await insertTrip(start, end, label, pendingExcludedRanges);
    }
  }catch(e){
    errEl.textContent = t('trips.saveError');
    errEl.style.display = 'block';
    return;
  }
  stopEditTrip();
  render();
  if(wasEditing) switchTab('trips');
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
    html += `<tr><td>${t.label || ''}</td><td>${fmt(t.start)}</td><td>${fmt(t.end)}</td><td>${days}</td><td>${excludedDayCount(t)}</td><td>${classifyTrip(t)}</td></tr>`;
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
    tr.innerHTML = `<td>${dateText}</td><td>${first.label}</td><td>${last.running} / 90</td>`;
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
