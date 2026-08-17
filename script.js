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
let calCursor = new Date(); calCursor.setDate(1);
let pickStart = null, pickEnd = null;
let editingTripId = null;
let pendingImportTrips = null;
let pendingExcludedRanges = [];
let pickingExclusion = false;
let exclPickStart = null, exclPickEnd = null;
let editingExclusionIndex = null;
let checkerYearCursor = new Date().getFullYear();

function newId(){
  if('randomUUID' in crypto) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function toDate(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function isoOf(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmt(iso){ const d=toDate(iso); return new Intl.DateTimeFormat('en-GB', {day:'2-digit',month:'short',year:'numeric'}).format(d); }
function fmtShort(iso){ const d=toDate(iso); return new Intl.DateTimeFormat('en-GB', {day:'2-digit',month:'short'}).format(d); }
function adjacentMonthLabel(cursor, offset){
  const d = new Date(cursor.getFullYear(), cursor.getMonth() + offset, 1);
  return new Intl.DateTimeFormat('en-GB', {month:'short'}).format(d);
}
// Wraps a formatted date in a bold span for use inside the Quick check result's innerHTML —
// day-count phrases (margins, overages) stay plain text and are never passed through this.
function boldDate(iso){ return `<b class="qc-date">${fmt(iso)}</b>`; }

function dayCount(n){ return `${n} day${n === 1 ? '' : 's'}`; }

function overLimitBody(overBy, used, dateHtml){
  return `${used} of 90 days used in the 180 days ending ${dateHtml}. You are ${overBy} day${overBy === 1 ? '' : 's'} over.`;
}

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
        label: `Leave by <strong>${fmt(altEnd)}</strong> instead (${dayCount(altDays)}) to stay compliant.`,
        start, end: altEnd
      });
    }
    const altStart = earliestCompliantStart(listExcluding, duration, capDays);
    if(altStart && altStart !== start){
      const altEndForStart = isoOf(addDays(toDate(altStart), duration-1));
      suggestions.push({
        label: `Shift the whole trip to start <strong>${fmt(altStart)}</strong> instead (still ${dayCount(duration)}).`,
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

async function insertTrip(start, end, label, excludedRanges, note){
  const trip = { id: newId(), start, end, label, excludedRanges: excludedRanges || [], note: note || '' };
  await dbPut(trip);
  await loadTrips();
  markTripsChanged();
}

async function updateTrip(id, start, end, label, excludedRanges, note){
  const existing = trips.find(t => t.id === id);
  const trip = { id, start, end, label, excludedRanges: excludedRanges || (existing && existing.excludedRanges) || [], note: note !== undefined ? note : ((existing && existing.note) || '') };
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
  stopEditTrip();
  switchTab('calendar');
});
document.getElementById('homeAddTripBtn').addEventListener('click', ()=>{
  stopEditTrip();
  switchTab('calendar');
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
    kickerEl.textContent = 'Days over limit';
    titleEl.textContent = `+${overBy}`;
    let html = overLimitBody(overBy, used, boldDate(refISO));
    const free = nextFreeDate(trips, 90);
    if(free) html += ` Days free up again from ${boldDate(free)}.`;
    bodyEl.innerHTML = html;
  } else if(exitISO === null){
    kickerEl.textContent = 'Status';
    titleEl.textContent = 'N/A';
    bodyEl.innerHTML = `Already over the limit on ${boldDate(entryForCalc)} — no compliant stay possible from that entry date.`;
  } else {
    kickerEl.textContent = 'Last day to leave';
    titleEl.textContent = fmt(exitISO);
    let html = `${used} of 90 days used in the 180 days ending ${boldDate(refISO)}.`;
    if(remaining <= 20) html += ` Only ${remaining} day${remaining === 1 ? '' : 's'} of margin left.`;
    bodyEl.innerHTML = html;
  }

  const todayPill = document.getElementById('qcTodayPill');
  todayPill.style.display = (refISO === todayISO()) ? '' : 'none';

  renderTripRows();
  renderNextTrip();
  renderCountriesCard();
  renderCalendar();
  renderYearView();
  renderHistoryView();
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
  fullPanel.style.display = (!active && next) ? 'block' : 'none';
  empty.style.display = !next ? 'block' : 'none';

  if(active) renderActiveTrip(active);
  if(active && next) renderCompactNextTrip(next);
  if(!active && next) renderFullNextTrip(next);
}

function renderActiveTrip(trip){
  const panel = document.getElementById('activeTripPanel');
  const daysWrap = document.getElementById('activeTripDaysWrap');
  const tagEl = document.getElementById('activeTripTag');
  const bigEl = document.getElementById('activeTripBig');
  const bigLabelEl = document.getElementById('activeTripBigLabel');
  const datesEl = document.getElementById('activeTripDatesLine');
  const bodyEl = document.getElementById('activeTripBody');

  document.getElementById('activeTripCountry').innerHTML = `${trip.label ? flagIconHtml(trip.label) : ''}${trip.label ? escapeHtml(trip.label) : '—'}`;

  // A trip already in progress can't shift its start or trim its already-lived days, so
  // the overstay case is framed as "you're over" (reusing the same copy as the Quick check
  // card above) rather than the forward-looking trim/later-start suggestions used for a
  // trip that hasn't started yet.
  const overstay = tripOverstayInfo(trips, trip, 90);
  if(overstay){
    const overBy = overstay.used - 90;
    daysWrap.style.display = 'none';
    tagEl.textContent = 'Overstay risk';
    tagEl.className = 'tag tag-accent-2';
    datesEl.textContent = `Entered ${fmt(trip.start)}`;
    bodyEl.innerHTML = overLimitBody(overBy, overstay.used, boldDate(overstay.date));
  } else {
    const maxDays = maxConsecutiveFrom(trips, trip.start, 90);
    const lastExit = isoOf(addDays(toDate(trip.start), maxDays - 1));
    const daysLeft = Math.round((toDate(lastExit) - toDate(todayISO())) / 86400000) + 1;

    daysWrap.style.display = 'block';
    bigEl.textContent = String(daysLeft);
    bigLabelEl.textContent = daysLeft === 1 ? 'day left' : 'days left';
    tagEl.textContent = 'Active';
    tagEl.className = 'tag tag-accent';
    datesEl.textContent = `${fmt(trip.start)} → ${fmt(trip.end)}`;
    bodyEl.innerHTML = `Entered ${fmt(trip.start)} · planned exit ${fmt(trip.end)} · could stay until ${boldDate(lastExit)}`;
  }

  panel.onclick = () => switchTab('trips');
}

function renderCompactNextTrip(trip){
  const row = document.getElementById('nextTripCompact');
  document.getElementById('nextTripCompactCountry').textContent = trip.label || '—';
  document.getElementById('nextTripCompactDates').textContent = `${fmt(trip.start)} → ${fmt(trip.end)}`;
  row.onclick = () => switchTab('trips');
}

function renderFullNextTrip(trip){
  const panel = document.getElementById('nextTripPanel');
  panel.innerHTML = '';
  const row = buildTripRow(trip, 'planned');
  const actions = row.querySelector('.row-actions');
  if(actions) actions.remove();
  panel.appendChild(row);
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
  document.getElementById('countriesCount').textContent = `${visited.size} of ${ALL_COUNTRIES.length}`;
}

function renderCountries(){
  const visited = visitedCountries();
  document.getElementById('countriesSubtitle').textContent =
    `${visited.size} of ${ALL_COUNTRIES.length} Schengen countries stamped`;
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

function buildTripRow(trip, status){
  const days = Math.round((toDate(trip.end) - toDate(trip.start))/86400000) + 1;
  const overstay = tripOverstayInfo(trips, trip, 90);
  const warnIcon = overstay
    ? `<span class="warn-icon" title="This stay tips you over the 90-day limit on ${fmt(overstay.date)} (${overstay.used} of 90 used)">&#9888;</span>`
    : '';

  let statusHtml;
  if(status === 'past'){
    statusHtml = `<div class="done-stamp"><div class="t">DONE</div><svg viewBox="0 0 24 24" fill="var(--color-text)"><path d="M12 0l2.9 8.1 8.6.1-6.9 5.3 2.6 8.2L12 16.9 5.8 21.7l2.6-8.2L1.5 8.2l8.6-.1z"></path></svg></div>`;
  } else if(status === 'active'){
    statusHtml = `<span class="tag tag-accent">Active</span>`;
  } else {
    statusHtml = `<span class="tag tag-outline">Planned</span>`;
  }

  let exclDays = 0;
  for(const r of (trip.excludedRanges || [])) exclDays += Math.round((toDate(r.end) - toDate(r.start))/86400000) + 1;
  const exclNote = exclDays > 0
    ? `<div style="margin-top:4px;"><span class="tag tag-excluded">Side trip: ${dayCount(exclDays)}</span></div>`
    : '';
  const noteHtml = trip.note
    ? `<p class="note trip-note">${escapeHtml(trip.note)}</p>`
    : '';

  const row = document.createElement('div');
  row.className = 'card elev-sm trip-row';
  row.innerHTML = `
    <div class="trip-days"><div class="n">${days}</div><div class="lbl">days</div></div>
    <div class="trip-info">
      <div class="country">${trip.label ? flagIconHtml(trip.label) : ''}${trip.label ? escapeHtml(trip.label) : '—'}${warnIcon}</div>
      <div class="dates">${fmt(trip.start)} – ${fmt(trip.end)}</div>
      ${exclNote}
      ${noteHtml}
      <div class="row-actions">
        <button type="button" class="link-btn" data-action="edit" data-id="${trip.id}">Edit</button>
        <button type="button" class="link-btn danger-link" data-action="remove" data-id="${trip.id}">Remove</button>
      </div>
    </div>
    <div class="trip-status">${statusHtml}</div>
  `;
  return row;
}

function renderTripRows(){
  const rowsEl = document.getElementById('tripRows');
  rowsEl.innerHTML = '';
  if(trips.length === 0){
    rowsEl.innerHTML = `<div class="empty-note">No stays logged yet.</div>`;
    return;
  }
  trips.sort((a,b)=>{
    const aActive = classifyTrip(a) === 'active';
    const bActive = classifyTrip(b) === 'active';
    if(aActive !== bActive) return aActive ? -1 : 1;
    return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
  });

  const completedRows = [];
  for(const trip of trips){
    const status = classifyTrip(trip);
    const row = buildTripRow(trip, status);
    if(status === 'past') completedRows.push(row);
    else rowsEl.appendChild(row);
  }

  // All done stays live collapsed under one expandable group, out of the way by default.
  if(completedRows.length){
    const group = document.createElement('details');
    group.className = 'card';
    group.innerHTML = `
      <summary class="qc-title-row">
        <span class="qc-title-label"><span class="qc-title-black">Completed trips (${completedRows.length})</span></span>
        <span class="qc-title-rule"></span>
      </summary>
    `;
    const list = document.createElement('div');
    list.className = 'stack';
    list.style.marginTop = '10px';
    completedRows.forEach(row => list.appendChild(row));
    group.appendChild(list);
    rowsEl.appendChild(group);
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

// --- Passport control (secondary screen, reached from Home) ---
// Per-trip breakdown of a chosen 180-day window — meant to be shown to a border
// official alongside the passport stamps, unlike the day-by-day breakdown modal.

// A trip that started before the window, or (for a future control date) hasn't
// finished by the control date, only partly counts — `clippedStart`/`clippedEnd`
// mark the portion that actually falls inside the window.
function passportControlRows(list, controlISO){
  const windowStartISO = isoOf(addDays(toDate(controlISO), -179));
  const rows = [];
  for(const trip of list){
    if(trip.end < windowStartISO || trip.start > controlISO) continue;
    const clippedStart = trip.start < windowStartISO ? windowStartISO : trip.start;
    const clippedEnd = trip.end > controlISO ? controlISO : trip.end;
    let daysInWindow = 0;
    let cur = toDate(clippedStart);
    const end = toDate(clippedEnd);
    while(cur <= end){
      const iso = isoOf(cur);
      if(!isExcludedDay(trip, iso)) daysInWindow++;
      cur = addDays(cur, 1);
    }
    const fullDays = Math.round((toDate(trip.end) - toDate(trip.start)) / 86400000) + 1;
    const isPartial = clippedStart !== trip.start || clippedEnd !== trip.end;
    rows.push({ trip, fullDays, isPartial, clippedStart, clippedEnd, daysInWindow });
  }
  rows.sort((a,b)=> a.trip.start < b.trip.start ? -1 : a.trip.start > b.trip.start ? 1 : 0);
  return { windowStartISO, rows };
}

function renderPassportControl(){
  const controlISO = document.getElementById('pcDate').value || todayISO();
  document.getElementById('pcTodayPill').style.display = (controlISO === todayISO()) ? '' : 'none';

  const { windowStartISO, rows } = passportControlRows(trips, controlISO);
  document.getElementById('pcWindowRange').textContent = `${fmt(windowStartISO)} to ${fmt(controlISO)}`;
  document.getElementById('pcTotalDays').textContent = String(usedDaysInWindow(trips, controlISO));

  const rowsEl = document.getElementById('pcTripRows');
  rowsEl.innerHTML = '';
  if(rows.length === 0){
    rowsEl.innerHTML = `<div class="empty-note">No trips fall within this 180-day window.</div>`;
    return;
  }
  for(const r of rows){
    const row = document.createElement('div');
    row.className = 'card elev-sm trip-row';
    const country = `${r.trip.label ? flagIconHtml(r.trip.label) : ''}${r.trip.label ? escapeHtml(r.trip.label) : '—'}`;
    const dates = `${fmt(r.trip.start)} – ${fmt(r.trip.end)}`;
    const partialNote = r.isPartial
      ? `<p class="note pc-trip-partial">Partially within 180-day window: ${fmt(r.clippedStart)} – ${fmt(r.clippedEnd)} · ${dayCount(r.daysInWindow)}</p>`
      : '';
    row.innerHTML = `
      <div class="trip-days"><div class="n">${r.fullDays}</div><div class="lbl">days</div></div>
      <div class="trip-info">
        <div class="country">${country}</div>
        <div class="dates">${dates}</div>
        ${partialNote}
      </div>
    `;
    rowsEl.appendChild(row);
  }
}

document.getElementById('passportControlBtn').addEventListener('click', ()=>{
  document.getElementById('pcDate').value = todayISO();
  renderPassportControl();
  switchTab('passportControl');
});
document.getElementById('passportControlBackBtn').addEventListener('click', ()=> switchTab('home'));
document.getElementById('pcDate').addEventListener('change', renderPassportControl);

document.getElementById('pcPrintBtn').addEventListener('click', ()=>{
  const controlISO = document.getElementById('pcDate').value || todayISO();
  const { windowStartISO, rows } = passportControlRows(trips, controlISO);
  const totalDays = usedDaysInWindow(trips, controlISO);
  let html = `<h1>Schengen Guard — passport control</h1><p>Control date ${fmt(controlISO)} · 180-day window ${fmt(windowStartISO)} to ${fmt(controlISO)} · ${dayCount(totalDays)} in the Schengen Area</p>`;
  html += '<table><thead><tr><th>Country</th><th>Entry</th><th>Exit</th><th>Days</th><th>Days in window</th></tr></thead><tbody>';
  for(const r of rows){
    const windowNote = r.isPartial ? ` (${fmt(r.clippedStart)} – ${fmt(r.clippedEnd)})` : '';
    html += `<tr><td>${escapeHtml(r.trip.label || '')}</td><td>${fmt(r.trip.start)}</td><td>${fmt(r.trip.end)}</td><td>${r.fullDays}</td><td>${r.daysInWindow}${windowNote}</td></tr>`;
  }
  html += '</tbody></table>';
  document.getElementById('printArea').innerHTML = html;
  window.print();
});

// --- Safe Trip Checker (Trips tab) ---

function updateEditStayCompliance(){
  const msgEl = document.getElementById('editStayMsg');
  const errEl = document.getElementById('formError');
  const saveBtn = document.getElementById('addTripBtn');
  const breakdownBtn = document.getElementById('editStayBreakdownBtn');
  const suggestionsEl = document.getElementById('editStaySuggestions');
  const start = pickStart;
  const end = pickEnd;
  errEl.style.display = 'none';
  breakdownBtn.style.display = 'none';
  suggestionsEl.style.display = 'none';
  suggestionsEl.innerHTML = '';

  if(!start || !end){
    msgEl.textContent = 'Pick an entry and exit date to check compliance before you save it.';
    saveBtn.disabled = true;
    return;
  }
  if(end < start){
    msgEl.textContent = '';
    errEl.textContent = 'Exit date must be on or after the entry date.';
    errEl.style.display = 'block';
    saveBtn.disabled = true;
    return;
  }

  const days = Math.round((toDate(end) - toDate(start)) / 86400000) + 1;
  const baseline = trips.filter(t => t.id !== editingTripId);
  const hypothetical = baseline.concat([{ start, end, label: '__editStay__', excludedRanges: pendingExcludedRanges }]);
  const overstay = tripOverstayInfo(hypothetical, { start, end }, 90);
  breakdownBtn.style.display = 'inline-flex';
  if(overstay){
    msgEl.innerHTML = `${days}-day stay — <strong style="color:var(--color-accent-2-700)">would breach your limit</strong> on ${fmt(overstay.date)} (${overstay.used} of 90 used).`;
    const suggestion = computeTripSuggestion(hypothetical, baseline, start, end, 90);
    if(suggestion.suggestions.length){
      suggestionsEl.style.display = 'grid';
      for(const s of suggestion.suggestions){
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'suggestion-btn';
        btn.innerHTML = s.label;
        btn.addEventListener('click', ()=>{
          pickStart = s.start; pickEnd = s.end;
          document.getElementById('tripStart').value = s.start;
          document.getElementById('tripEnd').value = s.end;
          document.getElementById('pickStartLbl').textContent = `Entry: ${fmt(s.start)}`;
          document.getElementById('pickEndLbl').textContent = `Exit: ${fmt(s.end)}`;
          pendingExcludedRanges = pendingExcludedRanges.filter(r => r.start >= s.start && r.end <= s.end);
          calCursor = new Date(toDate(s.start)); calCursor.setDate(1);
          renderCalendar();
          renderExclusionSection();
        });
        suggestionsEl.appendChild(btn);
      }
    }
  } else {
    const margin = 90 - usedDaysInWindow(hypothetical, end);
    msgEl.innerHTML = `${days}-day stay — <strong style="color:var(--color-safe)">safe, within limits</strong>. ${dayCount(margin)} of margin left on ${fmt(end)}.`;
  }
  saveBtn.disabled = false;
}


// Classifies a single day for the Year/History views — same priority the month
// calendar's CSS applies (cal-day.overstay's !important wins over in-trip/excluded).
function classifyYearDay(iso, covered, plannedSet, excluded){
  const used = usedDaysInWindow(trips, iso);
  if(used > 90) return 'overstay';
  if(covered.has(iso)) return plannedSet.has(iso) ? 'planned' : 'active';
  if(excluded.has(iso)) return 'excluded';
  return null;
}

function renderYearView(){
  const year = checkerYearCursor;
  document.getElementById('checkerYearLabel').textContent = String(year);
  document.getElementById('checkerYearPrevLabel').textContent = String(year - 1);
  document.getElementById('checkerYearNextLabel').textContent = String(year + 1);

  const covered = coveredDates(trips);
  const plannedSet = coveredDates(trips.filter(t=>classifyTrip(t)==='planned'));
  const excluded = excludedDatesSet(trips);
  const today = todayISO();

  let daysInZone = 0;
  let html = '';
  for(let m=0; m<12; m++){
    const monthLabel = new Date(year, m, 1).toLocaleDateString('en-GB', { month: 'short' });
    const firstDay = new Date(year, m, 1);
    let startOffset = firstDay.getDay() - 1; if(startOffset < 0) startOffset = 6;
    const daysInMonth = new Date(year, m+1, 0).getDate();

    let cells = '';
    for(let i=0; i<startOffset; i++) cells += `<div class="myd pad"></div>`;
    for(let day=1; day<=daysInMonth; day++){
      const iso = year+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      const cls = classifyYearDay(iso, covered, plannedSet, excluded);
      if(cls === 'active' || cls === 'planned' || cls === 'overstay') daysInZone++;
      const todayCls = iso === today ? ' today' : '';
      cells += `<div class="myd${cls ? ' '+cls : ''}${todayCls}">${day}</div>`;
    }
    html += `<div class="mini-month" data-month="${m}"><div class="mini-month-label">${escapeHtml(monthLabel)}</div><div class="mini-grid">${cells}</div></div>`;
  }

  document.getElementById('checkerYearGrid').innerHTML = html;
  document.getElementById('checkerYearStat').innerHTML = `${daysInZone} day${daysInZone === 1 ? '' : 's'} spent in the Schengen zone in ${year}`;

  document.querySelectorAll('#checkerYearGrid .mini-month').forEach(el=>{
    el.addEventListener('click', ()=>{
      const m = Number(el.getAttribute('data-month'));
      const lastDay = new Date(year, m+1, 0).getDate();
      const endIso = year+'-'+String(m+1).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
      openBreakdown(trips, endIso);
    });
  });
}

document.getElementById('checkerYearPrev').addEventListener('click', ()=>{ checkerYearCursor--; renderYearView(); });
document.getElementById('checkerYearNext').addEventListener('click', ()=>{ checkerYearCursor++; renderYearView(); });

// Samples the rolling 180-day window at each month's last day across a year — the
// underlying window is a genuine day-by-day slide, but listing all 365 would be
// unreadable, so this shows the same trend at twelve checkpoints instead.
function renderHistoryView(){
  const year = checkerYearCursor;
  document.getElementById('checkerHistoryLabel').textContent = String(year);
  document.getElementById('checkerHistoryPrevLabel').textContent = String(year - 1);
  document.getElementById('checkerHistoryNextLabel').textContent = String(year + 1);

  const months = [];
  for(let m=0; m<12; m++){
    const lastDay = new Date(year, m+1, 0).getDate();
    const endIso = year+'-'+String(m+1).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
    const startIso = isoOf(addDays(toDate(endIso), -179));
    const used = usedDaysInWindow(trips, endIso);
    const remaining = Math.max(0, 90 - used);
    let status = 'safe';
    if(used > 90 || remaining <= 14) status = 'warn';
    months.push({ m, endIso, startIso, used, remaining, status });
  }

  const W = 620, H = 200, padL = 30, padR = 14, padT = 14, padB = 26;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const yMax = Math.max(100, Math.ceil((Math.max(...months.map(d=>d.used), 90) + 5) / 10) * 10);
  const xAt = i => padL + (i / (months.length - 1)) * plotW;
  const yAt = v => padT + plotH - (v / yMax) * plotH;
  const statusColor = s => s === 'warn' ? 'var(--color-warn)' : 'var(--color-safe)';

  const linePoints = months.map((d,i)=> `${xAt(i).toFixed(1)},${yAt(d.used).toFixed(1)}`).join(' ');
  const areaPoints = `${xAt(0).toFixed(1)},${yAt(0).toFixed(1)} ` + linePoints + ` ${xAt(months.length-1).toFixed(1)},${yAt(0).toFixed(1)}`;
  const limitY = yAt(90).toFixed(1);
  const zeroY = yAt(0).toFixed(1);
  const midY = yAt(yMax/2).toFixed(1);

  const dots = months.map((d,i)=>{
    const isLast = i === months.length - 1;
    return `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(d.used).toFixed(1)}" r="${isLast ? 6 : 4}" fill="${statusColor(d.status)}"></circle>`;
  }).join('');

  const monthLabels = months.filter((d,i)=> i % 2 === 0).map(d=>{
    const label = new Date(year, d.m, 1).toLocaleDateString('en-GB', { month: 'short' });
    return `<text x="${xAt(d.m).toFixed(1)}" y="${H-8}" text-anchor="middle" font-size="9" fill="var(--color-neutral-600)">${escapeHtml(label)}</text>`;
  }).join('');

  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(`Days used in the trailing 180 days, end of each month, ${year}`)}">
    <line x1="${padL}" y1="${zeroY}" x2="${W-padR}" y2="${zeroY}" stroke="var(--color-neutral-300)" stroke-width="1"></line>
    <line x1="${padL}" y1="${midY}" x2="${W-padR}" y2="${midY}" stroke="var(--color-neutral-300)" stroke-width="1"></line>
    <text x="${padL-6}" y="${Number(zeroY)+3}" text-anchor="end" font-size="9" fill="var(--color-neutral-600)">0</text>
    <text x="${padL-6}" y="${Number(midY)+3}" text-anchor="end" font-size="9" fill="var(--color-neutral-600)">${yMax/2}</text>
    <line x1="${padL}" y1="${limitY}" x2="${W-padR}" y2="${limitY}" stroke="var(--color-danger)" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.7"></line>
    <text x="${W-padR}" y="${Number(limitY)-4}" text-anchor="end" font-size="9" font-weight="700" fill="var(--color-danger)">${escapeHtml("90-day limit")}</text>
    <polygon points="${areaPoints}" fill="var(--color-accent)" opacity="0.12"></polygon>
    <polyline points="${linePoints}" fill="none" stroke="var(--color-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
    ${dots}
    ${monthLabels}
  </svg>`;
  document.getElementById('checkerHistoryChartWrap').innerHTML = svg;

  const listHtml = months.map(d=>{
    const monthName = new Date(year, d.m, 1).toLocaleDateString('en-GB', { month: 'long' });
    return `<div class="period-row" data-month="${d.m}">
      <div>
        <div class="period-month">${escapeHtml(monthName)}</div>
        <div class="period-range">${fmtShort(d.startIso)} – ${fmt(d.endIso)}</div>
      </div>
      <div class="period-stat">
        <div class="period-used">${d.used}<span>/90</span></div>
        <div class="period-pill ${d.status}">${d.remaining} left</div>
      </div>
    </div>`;
  }).join('');
  document.getElementById('checkerHistoryList').innerHTML = listHtml;

  document.querySelectorAll('#checkerHistoryList .period-row').forEach(el=>{
    el.addEventListener('click', ()=>{
      const m = Number(el.getAttribute('data-month'));
      openBreakdown(trips, months[m].endIso);
    });
  });
}

document.getElementById('checkerHistoryPrev').addEventListener('click', ()=>{ checkerYearCursor--; renderHistoryView(); });
document.getElementById('checkerHistoryNext').addEventListener('click', ()=>{ checkerYearCursor++; renderHistoryView(); });

// --- "Share your year" recap card — a passport-styled summary of Year view's own numbers ---

function renderRecapStarArc(){
  const arc = document.getElementById('recapStarArc');
  arc.innerHTML = '';
  const n = 9, spread = 280, cx = 146, baseY = 11, dip = 7;
  for(let i = 0; i < n; i++){
    const frac = i / (n - 1);
    const el = document.createElement('span');
    el.textContent = '★';
    el.style.left = ((frac - 0.5) * spread + cx) + 'px';
    el.style.top = (baseY - Math.sin(frac * Math.PI) * dip) + 'px';
    el.style.opacity = String(0.55 + 0.45 * Math.sin(frac * Math.PI));
    arc.appendChild(el);
  }
}

function openYearRecap(){
  const year = checkerYearCursor;
  const yearTrips = trips.filter(tr => tr.start.slice(0, 4) === String(year));

  const covered = coveredDates(trips);
  const plannedSet = coveredDates(trips.filter(tr=>classifyTrip(tr)==='planned'));
  const excluded = excludedDatesSet(trips);

  let daysInZone = 0;
  const perMonthTotal = new Array(12).fill(0);
  const perMonthPlanned = new Array(12).fill(0);
  for(let m=0; m<12; m++){
    const daysInMonth = new Date(year, m+1, 0).getDate();
    for(let day=1; day<=daysInMonth; day++){
      const iso = year+'-'+String(m+1).padStart(2,'0')+'-'+String(day).padStart(2,'0');
      const cls = classifyYearDay(iso, covered, plannedSet, excluded);
      if(cls === 'active' || cls === 'overstay' || cls === 'planned'){
        daysInZone++;
        perMonthTotal[m]++;
        if(cls === 'planned') perMonthPlanned[m]++;
      }
    }
  }

  const visitedSet = new Set();
  for(const tr of yearTrips){
    if(classifyTrip(tr) !== 'planned' && tr.label) visitedSet.add(tr.label);
  }

  let longest = null;
  for(const tr of yearTrips){
    const days = Math.round((toDate(tr.end) - toDate(tr.start)) / 86400000) + 1;
    if(!longest || days > longest.days) longest = { label: tr.label, days };
  }

  let closest = null;
  for(let m=0; m<12; m++){
    const lastDay = new Date(year, m+1, 0).getDate();
    const endIso = year+'-'+String(m+1).padStart(2,'0')+'-'+String(lastDay).padStart(2,'0');
    const remaining = Math.max(0, 90 - usedDaysInWindow(trips, endIso));
    if(!closest || remaining < closest.remaining) closest = { m, remaining };
  }

  document.getElementById('recapYear').textContent = String(year);
  document.getElementById('recapDays').textContent = String(daysInZone);
  document.getElementById('recapCountries').textContent = String(visitedSet.size);
  document.getElementById('recapTrips').textContent = String(yearTrips.length);

  document.getElementById('recapLongest').textContent = longest ? String(longest.days) : '—';
  document.getElementById('recapLongestLabel').textContent = longest
    ? `Longest stay · ${longest.label ? escapeHtml(longest.label) : '—'}`
    : 'No trips logged this year';

  document.getElementById('recapClosest').textContent = closest ? String(closest.remaining) : '—';
  document.getElementById('recapClosestLabel').textContent = closest
    ? `Days to spare · closest call, ${new Date(year, closest.m, 1).toLocaleDateString('en-GB', { month: 'long' })}`
    : '';

  const maxMonthDays = Math.max(...perMonthTotal, 1);
  document.getElementById('recapMonthStrip').innerHTML = perMonthTotal.map((v, m) => {
    const height = v === 0 ? 12 : 12 + (v / maxMonthDays) * 88;
    const violet = perMonthPlanned[m] > v / 2;
    return `<i class="${violet ? 'violet' : ''}" style="height:${height.toFixed(0)}%;"></i>`;
  }).join('');

  document.getElementById('recapStampRow').innerHTML = [...visitedSet].map(label => stampHtml(label)).join('');

  renderRecapStarArc();
  document.getElementById('yearRecapModal').style.display = 'flex';
}

document.getElementById('checkerShareYearBtn').addEventListener('click', openYearRecap);
document.getElementById('yearRecapCloseBtn').addEventListener('click', ()=>{
  document.getElementById('yearRecapModal').style.display = 'none';
});
document.getElementById('yearRecapModal').addEventListener('click', (e)=>{
  if(e.target.id === 'yearRecapModal') document.getElementById('yearRecapModal').style.display = 'none';
});

// --- Calendar tab (log/edit a stay by tapping dates) ---

function renderCalendar(){
  const label = document.getElementById('calMonthLabel');
  label.textContent = calCursor.toLocaleDateString('en-GB',{month:'long', year:'numeric'});
  document.getElementById('prevMonth').textContent = '← ' + adjacentMonthLabel(calCursor, -1);
  document.getElementById('nextMonth').textContent = adjacentMonthLabel(calCursor, 1) + ' →';
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
    if(pendingExcludedRanges.some(r => iso >= r.start && iso <= r.end)) el.classList.add('excluded');
    if(iso === today) el.classList.add('today');
    const used = usedDaysInWindow(trips, iso);
    const remaining = 90 - used;
    if(used > 90) el.classList.add('overstay');
    if(pickStart && iso === pickStart) el.classList.add('pick-start');
    if(pickEnd && iso === pickEnd) el.classList.add('pick-end');
    if(pickStart && pickEnd && iso > pickStart && iso < pickEnd) el.classList.add('pick-range');
    if(pickingExclusion){
      if(!pickStart || !pickEnd || iso < pickStart || iso > pickEnd){
        el.classList.add('excl-disabled');
      } else if(exclPickStart && (iso === exclPickStart || (exclPickEnd && iso >= exclPickStart && iso <= exclPickEnd))){
        el.classList.add('selecting');
      }
    }
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
  pickingExclusion = false; exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
  document.getElementById('tripLabel').value = trip.label;
  document.getElementById('tripStart').value = trip.start;
  document.getElementById('tripEnd').value = trip.end;
  document.getElementById('tripNote').value = trip.note || '';
  document.getElementById('pickStartLbl').textContent = `Entry: ${fmt(trip.start)}`;
  document.getElementById('pickEndLbl').textContent = `Exit: ${fmt(trip.end)}`;
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = 'Update stay';
  document.getElementById('cancelEditBtn').style.display = 'block';

  calCursor = new Date(toDate(trip.start)); calCursor.setDate(1);
  switchTab('calendar');
  renderCalendar();
  renderExclusionSection();
}

function stopEditTrip(){
  editingTripId = null;
  pickStart = null; pickEnd = null;
  pendingExcludedRanges = [];
  pickingExclusion = false; exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
  document.getElementById('tripLabel').value = 'Spain';
  document.getElementById('tripStart').value = '';
  document.getElementById('tripEnd').value = '';
  document.getElementById('tripNote').value = '';
  document.getElementById('pickStartLbl').textContent = 'Entry: —';
  document.getElementById('pickEndLbl').textContent = 'Exit: —';
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = 'Log stay';
  document.getElementById('cancelEditBtn').style.display = 'none';
  renderCalendar();
  renderExclusionSection();
}

// --- Side-trip exclusion (mark days within a logged stay as spent outside Schengen) ---

function renderExclusionSection(){
  const section = document.getElementById('exclusionSection');
  if(!pickStart || !pickEnd){
    section.style.display = 'none';
    pickingExclusion = false; exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
    updateEditStayCompliance();
    return;
  }
  section.style.display = 'block';
  document.getElementById('exclusionNote').textContent = `Left and came back during this stay — like a UK leg? Add the dates below (must fall within ${fmt(pickStart)}–${fmt(pickEnd)}) and they won't count toward your 90-day limit.`;

  const tooShort = pickStart === pickEnd;
  if(tooShort){
    pickingExclusion = false; exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
  }
  document.getElementById('markSideTripBtn').style.display = !tooShort ? 'block' : 'none';
  document.getElementById('exclusionTooShort').style.display = tooShort ? 'block' : 'none';
  document.getElementById('exclusionPicker').style.display = (!tooShort && pickingExclusion) ? 'block' : 'none';
  document.getElementById('addExclusionBtn').textContent = editingExclusionIndex !== null ? 'Save changes' : 'Add side trip';
  updateExclusionPickLabels();
  renderExclusionList();
  updateEditStayCompliance();
}

function updateExclusionPickLabels(){
  document.getElementById('exclPickStartLbl').textContent = `From: ${exclPickStart ? fmt(exclPickStart) : '—'}`;
  document.getElementById('exclPickEndLbl').textContent = `To: ${exclPickEnd ? fmt(exclPickEnd) : '—'}`;
}

function renderExclusionList(){
  const listEl = document.getElementById('exclusionList');
  listEl.innerHTML = '';
  pendingExcludedRanges.forEach((r, idx)=>{
    const days = Math.round((toDate(r.end) - toDate(r.start)) / 86400000) + 1;
    const item = document.createElement('div');
    item.className = 'exclusion-item';
    item.innerHTML = `<span>${fmt(r.start)} – ${fmt(r.end)} (${dayCount(days)})</span>`;
    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'link-btn';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', ()=>{
      editingExclusionIndex = idx;
      pickingExclusion = true;
      exclPickStart = r.start; exclPickEnd = r.end;
      document.getElementById('exclusionError').style.display = 'none';
      renderExclusionSection();
      renderCalendar();
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'link-btn danger-link';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', ()=>{
      pendingExcludedRanges.splice(idx, 1);
      if(editingExclusionIndex === idx){
        pickingExclusion = false; exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
      }
      renderExclusionSection();
      renderCalendar();
    });
    const actions = document.createElement('div');
    actions.className = 'exclusion-item-actions';
    actions.appendChild(editBtn);
    actions.appendChild(removeBtn);
    item.appendChild(actions);
    listEl.appendChild(item);
  });
}

document.getElementById('markSideTripBtn').addEventListener('click', ()=>{
  pickingExclusion = true;
  exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
  document.getElementById('exclusionError').style.display = 'none';
  renderExclusionSection();
  renderCalendar();
});

document.getElementById('cancelExclusionBtn').addEventListener('click', ()=>{
  pickingExclusion = false;
  exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
  document.getElementById('exclusionError').style.display = 'none';
  renderExclusionSection();
  renderCalendar();
});

document.getElementById('addExclusionBtn').addEventListener('click', ()=>{
  const errEl = document.getElementById('exclusionError');
  errEl.style.display = 'none';
  if(!exclPickStart || !exclPickEnd){
    errEl.textContent = 'Tap the first and last day of the side trip on the calendar.';
    errEl.style.display = 'block';
    return;
  }
  const overlaps = pendingExcludedRanges.some((r, idx) => idx !== editingExclusionIndex && exclPickStart <= r.end && exclPickEnd >= r.start);
  if(overlaps){
    errEl.textContent = 'That range overlaps a side trip you already added.';
    errEl.style.display = 'block';
    return;
  }
  if(editingExclusionIndex !== null){
    pendingExcludedRanges[editingExclusionIndex] = { start: exclPickStart, end: exclPickEnd };
  } else {
    pendingExcludedRanges.push({ start: exclPickStart, end: exclPickEnd });
  }
  pendingExcludedRanges.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  pickingExclusion = false;
  exclPickStart = null; exclPickEnd = null; editingExclusionIndex = null;
  renderExclusionSection();
  renderCalendar();
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
  if(pickingExclusion){
    handleExclusionPick(iso);
    return;
  }
  if(!pickStart || (pickStart && pickEnd)){
    pickStart = iso; pickEnd = null;
    pendingExcludedRanges = []; // range is changing — old exclusions may no longer make sense
  } else {
    if(iso >= pickStart) pickEnd = iso;
    else { pickEnd = pickStart; pickStart = iso; }
  }
  document.getElementById('tripStart').value = pickStart || '';
  document.getElementById('tripEnd').value = pickEnd || '';
  document.getElementById('pickStartLbl').textContent = `Entry: ${pickStart ? fmt(pickStart) : '—'}`;
  document.getElementById('pickEndLbl').textContent = `Exit: ${pickEnd ? fmt(pickEnd) : '—'}`;
  renderCalendar();
  renderExclusionSection();
}

function handleExclusionPick(iso){
  if(!pickStart || !pickEnd || iso < pickStart || iso > pickEnd) return;
  if(!exclPickStart || (exclPickStart && exclPickEnd)){
    exclPickStart = iso; exclPickEnd = null;
  } else {
    if(iso >= exclPickStart) exclPickEnd = iso;
    else { exclPickEnd = exclPickStart; exclPickStart = iso; }
  }
  document.getElementById('exclusionError').style.display = 'none';
  updateExclusionPickLabels();
  renderCalendar();
}

document.getElementById('addTripBtn').addEventListener('click', async ()=>{
  const label = document.getElementById('tripLabel').value.trim();
  const start = document.getElementById('tripStart').value;
  const end = document.getElementById('tripEnd').value;
  const note = document.getElementById('tripNote').value.trim();
  const errEl = document.getElementById('formError');
  errEl.style.display = 'none';
  if(!start || !end){
    errEl.textContent = 'Tap an entry date, then an exit date, on the calendar.';
    errEl.style.display = 'block';
    return;
  }
  if(end < start){
    errEl.textContent = 'Exit date must be on or after the entry date.';
    errEl.style.display = 'block';
    return;
  }
  const overlapping = trips.find(ot => ot.id !== editingTripId && start <= ot.end && end >= ot.start);
  if(overlapping){
    const verb = editingTripId ? 'Update' : 'Log';
    const proceed = confirm(`This overlaps with your logged stay in ${overlapping.label} (${fmt(overlapping.start)} – ${fmt(overlapping.end)}). ${verb} it anyway?`);
    if(!proceed) return;
  }
  const wasEditing = editingTripId !== null;
  try{
    if(wasEditing){
      await updateTrip(editingTripId, start, end, label, pendingExcludedRanges, note);
    } else {
      await insertTrip(start, end, label, pendingExcludedRanges, note);
    }
  }catch(e){
    errEl.textContent = 'Could not save that stay — please try again.';
    errEl.style.display = 'block';
    return;
  }
  stopEditTrip();
  render();
  switchTab('trips');
});

document.getElementById('refDate').addEventListener('change', render);

document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(!confirm("Clear all logged stays? This cannot be undone.")) return;
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
        new Notification("Schengen Guard", {
          body: `${dayCount(realRemaining)} left of your 90-day allowance.`
        });
      }catch(e){}
      localStorage.setItem(NOTIF_LAST_FIRED_KEY, String(threshold));
      break;
    }
  }
}

// --- "How is this calculated?" day-by-day breakdown (Home + Safe Trip Checker) ---

// Which trip's label (if any) accounts for a given counted day — lets the breakdown
// show "France" instead of a generic 'In Schengen' status, so it's clear at a glance
// which stay is responsible for each day.
function coveringTripLabel(list, iso){
  const trip = list.find(t => t.start <= iso && iso <= t.end && !isExcludedDay(t, iso));
  return trip ? (trip.label || '—') : 'In Schengen';
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
    const label = counts ? coveringTripLabel(list, iso) : (excluded.has(iso) ? 'Outside Schengen (excluded)' : '—');
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
  summaryEl.textContent = `Showing the 180 days ending ${fmt(windowEndISO)}. ${running} of those days count toward your 90-day limit.`
    + (agedOut > 0 ? ` ${agedOut} earlier day${agedOut === 1 ? '' : 's'} you spent in Schengen ${agedOut === 1 ? 'has' : 'have'} aged out of this window and no longer count${agedOut === 1 ? 's' : ''}.` : '');

  document.getElementById('breakdownModal').style.display = 'flex';
}

document.getElementById('homeBreakdownBtn').addEventListener('click', ()=>{
  const refISO = document.getElementById('refDate').value || todayISO();
  openBreakdown(trips, refISO);
});
document.getElementById('editStayBreakdownBtn').addEventListener('click', ()=>{
  if(!pickStart || !pickEnd || pickEnd < pickStart) return;
  const label = document.getElementById('tripLabel').value;
  const baseline = trips.filter(t => t.id !== editingTripId);
  openBreakdown(baseline.concat([{ start: pickStart, end: pickEnd, label, excludedRanges: pendingExcludedRanges }]), pickEnd);
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
  const linkHtml = `<a href="#" id="backupNudgeLink">Back them up</a>`;
  document.getElementById('backupNudgeText').innerHTML = `Your trips live only on this device. ${linkHtml} so you don't lose them.`;
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
  note.textContent = `Last backup: ${fmt(isoOf(new Date(lastBackup)))}`;
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
    errEl.textContent = "That file could not be read — make sure it's a Schengen Guard backup JSON file.";
    errEl.style.display = 'block';
    return;
  }

  if(!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.trips) || typeof parsed.schemaVersion !== 'number'){
    errEl.textContent = "That file doesn't look like a Schengen Guard backup.";
    errEl.style.display = 'block';
    return;
  }
  if(parsed.schemaVersion > SCHEMA_VERSION){
    errEl.textContent = "This backup was made with a newer version of Schengen Guard and can't be read here — update the app first.";
    errEl.style.display = 'block';
    return;
  }
  const validTrips = parsed.trips.every(it => it && typeof it.start === 'string' && typeof it.end === 'string');
  if(!validTrips){
    errEl.textContent = 'That backup file is malformed — no changes were made.';
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
    `You have ${trips.length} trip${trips.length === 1 ? '' : 's'} saved and this backup has ${pendingImportTrips.length}. Merge them, or replace what's on this device?`;
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
  el.innerHTML = `Last checked: ${fmt(ETIAS_LAST_CHECKED_ISO)}. ETIAS's launch date has shifted before, so treat the timing above as current-best-information rather than fixed — check ${linkHtml} for the authoritative date.`;
}

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

  renderEtiasLastChecked();
  maybeShowFirstRunModal();

  document.getElementById('todayTag').textContent = fmt(todayISO());
  document.getElementById('refDate').value = todayISO();

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
