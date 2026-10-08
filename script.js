const DB_NAME = 'schengenGuardDB';
const DB_VERSION = 2; // v2 adds the `people` store
const STORE_NAME = 'trips';
const PEOPLE_STORE = 'people';
const SCHEMA_VERSION = 2; // bump when the exported JSON trip shape changes (v2: people + personId/groupId)

const NOTIF_PREFS_KEY = 'schengenGuardNotifThresholds';
// Pre-people single tracker — only read once, to carry its value over to the first person.
const NOTIF_LAST_FIRED_KEY = 'schengenGuardNotifLastFired';
const NOTIF_LAST_FIRED_BY_PERSON_KEY = 'schengenGuardNotifLastFiredByPerson';
const ACTIVE_PERSON_KEY = 'schengenGuardActivePerson';
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

// --- People (one person = one travel document; the 90/180 rule runs per person) ---

const MAX_PEOPLE = 8;
const PERSON_NAME_MAX = 20;
// Fixed palette — stored by name, drawn from CSS custom properties so each colour has
// a light and a dark variant. Only ever used as a decorative dot, never as the only signal.
const PERSON_COLOURS = ['teal','rose','amber','violet','green','blue','orange','slate'];

// Minimal string table for copy added with multiple people. Older copy is still inline;
// this is the seam a full translation pass (Priority 5) can grow from.
const STRINGS = {
  defaultPersonName: 'Me',
  person: 'person',
  people: 'people',
  peopleTitle: 'People',
  whoFor: 'Who is it for?',
  everyone: 'Everyone',
  addPerson: 'Add person',
  addPersonAria: 'Add a person',
  personNameLabel: 'Name',
  switchPerson: 'Switch person, currently {name}',
  nameRequired: 'Enter a name.',
  nameTooLong: 'Names can be up to 20 characters.',
  nameTaken: 'Someone already has that name.',
  peopleCap: 'You can add up to 8 people.',
  lastPersonNote: "You need at least one person, so the last one can't be deleted.",
  peopleNamesNote: 'Names are only used to label trips on this device.',
  renamePerson: 'Rename {name}',
  deletePerson: 'Delete {name}',
  save: 'Save',
  cancel: 'Cancel',
  deletePersonConfirm: 'Delete {name} and their {stays}? This cannot be undone.',
  loggedStay: 'logged stay',
  loggedStays: 'logged stays',
  personAdded: '{name} added',
  personRenamed: 'Name updated',
  personDeleted: '{name} deleted',
  personDaysLeft: '{name} has {days} left.',
  personOverBy: '{name} is {days} over.',
  overviewDaysLeft: '{days} left',
  overviewOver: '{days} over',
  showingDaysFor: "Showing {name}'s days",
  selectSomeone: 'Pick at least one person.',
  notSafeFor: 'Not safe for {names}.',
  safeForEveryone: 'Safe for everyone.',
  tightestMargin: 'Tightest margin: {name}, {days}.',
  worstBreach: '{name} would reach 90 days on {date} ({used} of 90 used). Leave by {lastSafe}.',
  rowSafe: '{days} left on exit',
  rowOver: 'Over on {date} ({used} of 90)',
  rowStay: '{days} in Schengen',
  rowBreakdown: 'How is this calculated?',
  rowBreakdownAria: 'How is this calculated for {name}?',
  breakdownFor: 'For {name}. ',
  noCommonOption: 'No single change works for everyone. Best option for each person:',
  overlapPeople: 'This overlaps a stay already logged for {names}. Save anyway?',
  groupEditOne: 'Apply this change to the 1 other person on this trip?',
  groupEditMany: 'Apply this change to the {count} other people on this trip?',
  groupDeleteOne: 'This stay is shared with 1 other person.',
  groupDeleteMany: 'This stay is shared with {count} other people.',
  applyToEveryone: 'Apply to everyone',
  ownerChipAria: '{name} (this trip belongs to them)',
  removeFromTripConfirm: 'Remove this stay for {names}? Their copy will be deleted.',
  removeForEveryone: 'Remove for everyone',
  onlyName: 'Only {name}',
  clearPersonStays: "Clear {name}'s stays",
  clearEveryoneStays: "Clear everyone's stays",
  clearPersonConfirm: "Clear all of {name}'s logged stays? This cannot be undone.",
  clearEveryoneConfirm: "Clear everyone's logged stays? This cannot be undone.",
  countriesSubtitlePerson: '{name}: {count} of {total} Schengen countries stamped',
  notifPerson: '{name} has {days} left.',
  importWhichPerson: 'Add these trips to which person?',
  importOldFile: 'This backup was made before Schengen Guard had people, so it has {trips} and no names.',
  importTooManyPeople: 'This backup would take you over 8 people. Delete someone first, or choose Replace. No changes were made.',
  importTooManyPeopleReplace: 'This backup has more than 8 people, so it cannot be restored. No changes were made.',
  importPersonMsg: "{name} has {existing} saved and this backup has {incoming}. Merge them, or replace {name}'s stays?",
  importMergeIntoPerson: "Merge with {name}'s trips",
  importReplacePerson: "Replace {name}'s trips",
  trip: 'trip',
  tripsWord: 'trips',
  exportOnePerFile: 'One file per person',
  csvSideTrips: 'Side trips (outside Schengen)',
  printUsed: '{used} of 90 days used in the 180 days ending {date}. {remaining} remaining.',
  printOver: '{used} of 90 days used in the 180 days ending {date}. {over} over the limit.',
  printNoStays: 'No stays logged.',
  csvPerson: 'Person',
  passportFor: 'Traveller: {name}'
};
function i18n(key, vars){
  let s = STRINGS[key] !== undefined ? STRINGS[key] : key;
  if(vars) s = s.replace(/\{(\w+)\}/g, (m, k) => vars[k] !== undefined ? String(vars[k]) : m);
  return s;
}
function countOf(n, singularKey, pluralKey){ return `${n} ${i18n(n === 1 ? singularKey : pluralKey)}`; }
const listFormatter = ('ListFormat' in Intl) ? new Intl.ListFormat('en-GB', { style: 'long', type: 'conjunction' }) : null;
function formatNames(names){ return listFormatter ? listFormatter.format(names) : names.join(', '); }

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

// `allTrips` is every stored trip, for every person. `trips` is only the active person's
// trips — the view almost every screen reads — so the rule engine never sees a mixed list.
let allTrips = []; // {id, personId, groupId?, start:'YYYY-MM-DD', end:'YYYY-MM-DD', label, excludedRanges:[{start,end}], note}
let trips = [];
let people = []; // {id, name, colour, createdAt}
let activePersonId = null;
let selectedPersonIds = new Set(); // "Who is it for?" chips on the Calendar form
let tripListScope = 'person'; // 'person' | 'everyone' — Trips tab toggle
let exportSelectedIds = new Set(); // "Who is it for?" on the Export card
let exportDefaultFor = null; // the active person the export selection was last defaulted to
let exportOnePerFile = false;
let pendingImportPeople = null;
let pendingImportPersonId = null; // v1 backups: which existing person receives the trips
let calCursor = new Date(); calCursor.setDate(1);
let pickStart = null, pickEnd = null;
let editingTripId = null;
let pendingImportTrips = null;
let pendingExcludedRanges = [];
let exclusionFormOpen = false;
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

// Line-icon bin, matching the stroke style of the bottom-nav icons — used in place
// of the word "Delete" on danger-link buttons, which stay screen-reader-labelled
// via aria-label on the button itself.
const BIN_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16"/><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/><path d="M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/><path d="M10 11v6M14 11v6"/></svg>`;
const PEN_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;

// Outline when a trip has no note yet; filled (with the card's own background
// color cutting through the two "lines of text") once it does, so the icon alone
// signals note state without needing "Add note" vs "Edit note" wording.
function noteIconSvg(hasNote){
  return hasNote
    ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5" stroke="var(--color-surface)" stroke-width="1.8" stroke-linecap="round"/></svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg>`;
}

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

// Shared 90/180 verdict for a single trip — one source of wording/logic for both the
// Log a Stay form and the calendar view (see renderVerdict()). Only two states, by
// design: a trip either fits or it doesn't, no intermediate "warning" state.
// `allTrips` must already include `trip` itself, matching how tripOverstayInfo() and
// usedDaysInWindow() are used everywhere else in this file — pass the same list you'd
// hand to those functions directly.
function computeVerdict(trip, allTrips){
  if(!trip || !trip.start || !trip.end) return null;

  const overstay = tripOverstayInfo(allTrips, trip, 90);
  if(overstay){
    const lastSafeDate = isoOf(addDays(toDate(overstay.date), -1));
    return {
      status: 'fail',
      headline: 'This trip goes over the limit',
      detail: `You'd reach 90 days on ${fmt(overstay.date)} — leave by ${fmt(lastSafeDate)}.`,
      breakDate: overstay.date
    };
  }

  const daysLeft = 90 - usedDaysInWindow(allTrips, trip.end);
  return {
    status: 'ok',
    headline: 'This trip is fine',
    detail: `${dayCount(daysLeft)} left when you leave on ${fmt(trip.end)}.`,
    breakDate: null,
    daysLeft
  };
}

// Renders a computeVerdict() result into a banner container. Pass null to clear/hide it
// (e.g. no trip selected yet). All text is escaped — verdict wording is currently always
// machine-generated, but this stays safe if that ever changes.
function renderVerdict(el, verdict){
  if(!el) return;
  if(!verdict){
    el.hidden = true;
    el.className = 'verdict-banner';
    el.innerHTML = '';
    return;
  }
  el.hidden = false;
  el.className = `verdict-banner verdict-${verdict.status}`;
  const iconPath = verdict.status === 'ok'
    ? '<path d="M4 12l5 5L20 6" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
    : '<path d="M12 9v4M12 16.5h.01M10.6 4.6L2.9 18a1.8 1.8 0 0 0 1.55 2.7h15.1A1.8 1.8 0 0 0 21.1 18L13.4 4.6a1.8 1.8 0 0 0-2.8 0Z" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>';
  const daysHtml = (verdict.status === 'ok' && verdict.daysLeft != null)
    ? `<div class="verdict-days">${verdict.daysLeft}<span class="verdict-days-lbl">${verdict.daysLeft === 1 ? 'day' : 'days'} left</span></div>`
    : '';
  el.innerHTML = `
    <svg class="verdict-icon" viewBox="0 0 24 24" aria-hidden="true">${iconPath}</svg>
    <div class="verdict-body">
      <div class="verdict-headline">${escapeHtml(verdict.headline)}</div>
      ${daysHtml}
      <div class="verdict-detail">${escapeHtml(verdict.detail)}</div>
    </div>
  `;
}

function classifyTrip(t){
  const today = todayISO();
  if(t.end < today) return 'past';
  if(t.start <= today && today <= t.end) return 'active';
  return 'planned';
}

// --- IndexedDB storage layer (trips and people live only on this device) ---

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
      if(!idb.objectStoreNames.contains(PEOPLE_STORE)){
        idb.createObjectStore(PEOPLE_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
  return dbPromise;
}

function withStore(mode, fn, storeName = STORE_NAME){
  return openDB().then(idb => new Promise((resolve, reject)=>{
    const tx = idb.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = ()=> resolve(result);
    tx.onerror = ()=> reject(tx.error);
  }));
}

// One readwrite transaction across both stores, so a multi-step change (delete a person
// and their trips, restore a backup) either fully lands or doesn't land at all.
function withBothStores(fn){
  return openDB().then(idb => new Promise((resolve, reject)=>{
    const tx = idb.transaction([STORE_NAME, PEOPLE_STORE], 'readwrite');
    fn(tx.objectStore(STORE_NAME), tx.objectStore(PEOPLE_STORE), tx);
    tx.oncomplete = ()=> resolve();
    tx.onerror = ()=> reject(tx.error);
    tx.onabort = ()=> reject(tx.error);
  }));
}

function dbGetAll(storeName = STORE_NAME){
  return openDB().then(idb => new Promise((resolve, reject)=>{
    const tx = idb.transaction(storeName, 'readonly');
    const req = tx.objectStore(storeName).getAll();
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

// The engine only ever gets one person's trips — never pass `allTrips` into it.
function tripsFor(personId){ return allTrips.filter(t => t.personId === personId); }
function personById(id){ return people.find(p => p.id === id) || null; }
function activePerson(){ return personById(activePersonId) || people[0] || null; }
function personColourVar(colour){
  return `var(--person-${PERSON_COLOURS.includes(colour) ? colour : PERSON_COLOURS[0]})`;
}
function nextFreeColour(list){
  const used = new Set(list.map(p => p.colour));
  return PERSON_COLOURS.find(c => !used.has(c)) || PERSON_COLOURS[list.length % PERSON_COLOURS.length];
}
function personDotHtml(person){
  return `<span class="person-dot" style="--pc:${personColourVar(person && person.colour)};" aria-hidden="true"></span>`;
}
function personTagHtml(person){
  if(!person) return '';
  return `<span class="person-tag">${personDotHtml(person)}${escapeHtml(person.name)}</span>`;
}

// Returns an error message, or null if the name is fine. `exceptId` lets a rename keep its own name.
function validatePersonName(name, exceptId, list = people){
  const trimmed = String(name || '').trim();
  if(!trimmed) return i18n('nameRequired');
  if(trimmed.length > PERSON_NAME_MAX) return i18n('nameTooLong');
  const lower = trimmed.toLocaleLowerCase();
  if(list.some(p => p.id !== exceptId && p.name.toLocaleLowerCase() === lower)) return i18n('nameTaken');
  return null;
}

function sortPeople(list){ return list.sort((a,b)=> (a.createdAt || 0) - (b.createdAt || 0)); }

async function loadPeople(){
  people = sortPeople(await dbGetAll(PEOPLE_STORE));
}

// Writes the given people (and only them) — used by rename and import.
async function savePeople(list){
  await withStore('readwrite', store => { for(const p of list) store.put(p); }, PEOPLE_STORE);
  await loadPeople();
}

async function addPerson(name){
  const err = people.length >= MAX_PEOPLE ? i18n('peopleCap') : validatePersonName(name);
  if(err) throw new Error(err);
  const person = { id: newId(), name: name.trim(), colour: nextFreeColour(people), createdAt: Date.now() };
  await savePeople([person]);
  return person;
}

async function renamePerson(id, name){
  const person = personById(id);
  if(!person) return;
  const err = validatePersonName(name, id);
  if(err) throw new Error(err);
  await savePeople([{ ...person, name: name.trim() }]);
}

// Deletes a person and every trip of theirs in one transaction. The last person can't go.
async function deletePerson(id){
  if(people.length <= 1) return;
  const theirTripIds = allTrips.filter(t => t.personId === id).map(t => t.id);
  await withBothStores((tripStore, peopleStore)=>{
    for(const tripId of theirTripIds) tripStore.delete(tripId);
    peopleStore.delete(id);
  });
  const lastFired = loadNotifLastFired();
  delete lastFired[id];
  saveNotifLastFired(lastFired);
  await loadPeople();
  if(activePersonId === id) setActivePersonId(people[0].id);
  await loadTrips();
  markTripsChanged();
}

function setActivePersonId(id){
  activePersonId = id;
  try{ localStorage.setItem(ACTIVE_PERSON_KEY, id); }catch(e){}
  trips = tripsFor(id);
}

// Runs once before first render, and is safe to run again: makes sure at least one person
// exists ("Me"), gives any trip without a valid owner to the first person, and restores the
// active person. Check-and-create happens inside one transaction, so two tabs opening at
// once can't both create a "Me".
async function ensurePeople(){
  await withBothStores((tripStore, peopleStore)=>{
    const peopleReq = peopleStore.getAll();
    peopleReq.onsuccess = ()=>{
      const existing = sortPeople(peopleReq.result || []);
      let owner = existing[0];
      if(!owner){
        owner = { id: newId(), name: i18n('defaultPersonName'), colour: PERSON_COLOURS[0], createdAt: Date.now() };
        peopleStore.put(owner);
      }
      const ids = new Set(existing.map(p => p.id).concat([owner.id]));
      const tripsReq = tripStore.getAll();
      tripsReq.onsuccess = ()=>{
        for(const trip of (tripsReq.result || [])){
          if(!ids.has(trip.personId)) tripStore.put({ ...trip, personId: owner.id });
        }
      };
    };
  });
  await loadPeople();
  let stored = null;
  try{ stored = localStorage.getItem(ACTIVE_PERSON_KEY); }catch(e){}
  activePersonId = personById(stored) ? stored : people[0].id;
  try{ localStorage.setItem(ACTIVE_PERSON_KEY, activePersonId); }catch(e){}
  // Carry the pre-people notification tracker over to the first person, once.
  try{
    const legacy = localStorage.getItem(NOTIF_LAST_FIRED_KEY);
    if(legacy !== null){
      const map = loadNotifLastFired();
      if(map[people[0].id] === undefined) map[people[0].id] = Number(legacy);
      saveNotifLastFired(map);
      localStorage.removeItem(NOTIF_LAST_FIRED_KEY);
    }
  }catch(e){}
}

// Load all trips from IndexedDB into `allTrips`, and the active person's into `trips`
async function loadTrips(){
  const rows = await dbGetAll();
  allTrips = rows.map(t => ({ ...t, excludedRanges: t.excludedRanges || [] }));
  trips = tripsFor(activePersonId);
}

function buildTrip(personId, start, end, label, excludedRanges, note, groupId){
  const trip = { id: newId(), personId, start, end, label, excludedRanges: (excludedRanges || []).map(r => ({ ...r })), note: note || '' };
  if(groupId) trip.groupId = groupId;
  return trip;
}

async function insertTrip(personId, start, end, label, excludedRanges, note, groupId){
  await dbPut(buildTrip(personId, start, end, label, excludedRanges, note, groupId));
  await loadTrips();
  markTripsChanged();
}

// One identical stay for several people, saved together and sharing a groupId — a new one,
// or `groupId` when adding people to an existing trip.
async function insertTripForPeople(personIds, start, end, label, excludedRanges, groupId){
  if(!personIds.length) return;
  if(personIds.length === 1 && !groupId) return insertTrip(personIds[0], start, end, label, excludedRanges);
  groupId = groupId || newId();
  await dbPutAll(personIds.map(pid => buildTrip(pid, start, end, label, excludedRanges, '', groupId)));
  await loadTrips();
  markTripsChanged();
}

// `groupId`: undefined keeps the trip's current group, null takes it out of its group.
async function updateTrip(id, start, end, label, excludedRanges, note, groupId){
  const existing = allTrips.find(t => t.id === id);
  if(!existing) return;
  const trip = {
    id, personId: existing.personId, start, end, label,
    excludedRanges: excludedRanges || existing.excludedRanges || [],
    note: note !== undefined ? note : (existing.note || '')
  };
  const nextGroup = groupId === undefined ? existing.groupId : groupId;
  if(nextGroup) trip.groupId = nextGroup;
  await dbPut(trip);
  await loadTrips();
  markTripsChanged();
}

async function deleteTrip(id){
  await dbDelete(id);
  await loadTrips();
  markTripsChanged();
}

async function deleteTrips(ids){
  await withStore('readwrite', store => { for(const id of ids) store.delete(id); });
  await loadTrips();
  markTripsChanged();
}

// With a person id, clears only that person's trips; with none, clears everyone's.
async function deleteAllTrips(personId){
  if(personId){
    await deleteTrips(tripsFor(personId).map(t => t.id));
    return;
  }
  await dbClearAll();
  allTrips = [];
  trips = [];
  markTripsChanged();
}

// Days a person can still stay in the Schengen zone today: 90 minus days already used in
// the rolling 180-day window ending today (never the "Check as of" date).
function realDaysLeft(personId){
  return Math.max(0, 90 - usedDaysInWindow(tripsFor(personId), todayISO()));
}

// Home-screen app icon badge (installed PWA only) — the lowest days-left across everyone,
// since that's the one number that matters most. Independent of whatever date the
// "Check as of" field is scrubbed to, and naturally changes day to day as old covered
// days age out of each person's window.
function updateAppBadge(){
  if(!people.length) return;
  const daysLeft = Math.min(...people.map(p => realDaysLeft(p.id)));
  if(daysLeft <= 0){ clearAppBadge(); return; }
  if(!('setAppBadge' in navigator)) return;
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

let toastTimer = null;
function showToast(message){
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 2200);
}

document.querySelectorAll('.tab-btn').forEach(btn=>{
  btn.addEventListener('click', ()=> switchTab(btn.getAttribute('data-tab')));
});
document.getElementById('countriesCard').addEventListener('click', ()=>{
  renderCountries();
  switchTab('countries');
});
document.getElementById('countriesBackBtn').addEventListener('click', ()=> switchTab('trips'));
document.getElementById('tripListAddBtn').addEventListener('click', ()=>{
  stopEditTrip();
  switchTab('calendar');
});
document.getElementById('homeAddTripBtn').addEventListener('click', ()=>{
  stopEditTrip();
  switchTab('calendar');
});
document.getElementById('faqCard').addEventListener('click', ()=> switchTab('faq'));
document.getElementById('calendarFaqLink').addEventListener('click', ()=> switchTab('faq'));
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
  renderPeopleUI();
  renderWhoForChips();
  updateEditStayCompliance();
}

// --- People: Home switcher, overview strip, Settings card, Trips/Export toggles ---

// Copy from the string table that lives in static markup.
function applyStaticStrings(){
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = i18n(el.getAttribute('data-i18n')); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = i18n(el.getAttribute('data-i18n-placeholder')); });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', i18n(el.getAttribute('data-i18n-aria'))); });
}

function switchActivePerson(id){
  if(!personById(id) || id === activePersonId) return;
  // An in-progress edit belongs to the previous person's trip — drop it rather than
  // checking it against the wrong person's history.
  if(editingTripId !== null) stopEditTrip();
  setActivePersonId(id);
  selectedPersonIds = new Set([id]);
  render();
}

function renderPeopleUI(){
  renderPersonSwitcher();
  renderPeopleOverview();
  renderPeopleCard();
  renderTripScopeToggle();
  renderExportChips();
  renderResetButtons();
  renderCalendarPersonTag();
}

function renderPersonSwitcher(){
  const person = activePerson();
  if(!person) return;
  const btn = document.getElementById('personSwitcherBtn');
  const multi = people.length > 1;
  btn.innerHTML = `${personDotHtml(person)}<span class="person-chip-name">${escapeHtml(person.name)}</span>${multi ? '<span class="person-chip-caret" aria-hidden="true">▾</span>' : ''}`;
  btn.setAttribute('aria-label', i18n('switchPerson', { name: person.name }));
  btn.classList.toggle('quiet', !multi);

  const list = document.getElementById('personSwitcherList');
  list.innerHTML = '';
  if(multi){
    for(const p of people){
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'person-menu-item';
      item.setAttribute('aria-pressed', String(p.id === activePersonId));
      item.innerHTML = `${personDotHtml(p)}<span>${escapeHtml(p.name)}</span>${p.id === activePersonId ? '<span class="person-menu-tick" aria-hidden="true">✓</span>' : ''}`;
      item.addEventListener('click', ()=>{
        closePersonSwitcher();
        switchActivePerson(p.id);
      });
      list.appendChild(item);
    }
  }
  const atCap = people.length >= MAX_PEOPLE;
  document.getElementById('personSwitcherAddForm').style.display = atCap ? 'none' : '';
  document.getElementById('personSwitcherCapNote').style.display = atCap ? '' : 'none';
}

function openPersonSwitcher(){
  const menu = document.getElementById('personSwitcherMenu');
  menu.hidden = false;
  document.getElementById('personSwitcherBtn').setAttribute('aria-expanded', 'true');
  document.getElementById('personSwitcherError').style.display = 'none';
  const first = menu.querySelector('.person-menu-item[aria-pressed="true"]') || document.getElementById('personSwitcherAddName');
  if(first) first.focus();
}
function closePersonSwitcher(){
  const menu = document.getElementById('personSwitcherMenu');
  if(menu.hidden) return;
  menu.hidden = true;
  document.getElementById('personSwitcherBtn').setAttribute('aria-expanded', 'false');
}
document.getElementById('personSwitcherBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  if(document.getElementById('personSwitcherMenu').hidden) openPersonSwitcher();
  else closePersonSwitcher();
});
document.addEventListener('click', (e)=>{
  if(!document.getElementById('personSwitcher').contains(e.target)) closePersonSwitcher();
});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && !document.getElementById('personSwitcherMenu').hidden){
    closePersonSwitcher();
    document.getElementById('personSwitcherBtn').focus();
  }
});

// Shared by the Home switcher and the Settings card: validates, saves, reports.
async function handleAddPerson(inputEl, errEl, makeActive){
  errEl.style.display = 'none';
  let person;
  try{
    person = await addPerson(inputEl.value);
  }catch(err){
    errEl.textContent = err.message;
    errEl.style.display = 'block';
    return;
  }
  inputEl.value = '';
  if(makeActive){
    closePersonSwitcher();
    switchActivePerson(person.id);
  } else {
    render();
  }
  showToast(i18n('personAdded', { name: person.name }));
}
document.getElementById('personSwitcherAddForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  handleAddPerson(document.getElementById('personSwitcherAddName'), document.getElementById('personSwitcherError'), true);
});

// Same healthy / warning / danger split as the ring, as of the "Check as of" date.
function personStatus(personId, refISO){
  const list = tripsFor(personId);
  const used = usedDaysInWindow(list, refISO);
  const remaining = Math.max(0, 90 - used);
  return { used, remaining, colorVar: statusColorVar(used, remaining, false) };
}

function renderPeopleOverview(){
  const strip = document.getElementById('peopleOverview');
  if(people.length < 2){ strip.hidden = true; strip.innerHTML = ''; return; }
  strip.hidden = false;
  const refISO = document.getElementById('refDate').value || todayISO();
  strip.innerHTML = '';
  for(const p of people){
    const st = personStatus(p.id, refISO);
    const over = st.used > 90;
    const figure = over ? i18n('overviewOver', { days: dayCount(st.used - 90) }) : i18n('overviewDaysLeft', { days: dayCount(st.remaining) });
    const sentence = over ? i18n('personOverBy', { name: p.name, days: dayCount(st.used - 90) }) : i18n('personDaysLeft', { name: p.name, days: dayCount(st.remaining) });
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'people-overview-row' + (p.id === activePersonId ? ' active' : '');
    row.setAttribute('aria-label', sentence);
    if(p.id === activePersonId) row.setAttribute('aria-current', 'true');
    row.innerHTML = `<span class="people-overview-name">${personDotHtml(p)}${escapeHtml(p.name)}</span><span class="people-overview-days" style="color:${st.colorVar};">${st.colorVar !== statusColorVar(0, 90, false) ? '<span aria-hidden="true">&#9888;</span> ' : ''}${escapeHtml(figure)}</span>`;
    row.addEventListener('click', ()=> switchActivePerson(p.id));
    strip.appendChild(row);
  }
}

let renamingPersonId = null;
function renderPeopleCard(){
  const list = document.getElementById('peopleList');
  list.innerHTML = '';
  const onlyOne = people.length <= 1;
  for(const p of people){
    const row = document.createElement('div');
    row.className = 'people-row';
    if(renamingPersonId === p.id){
      row.classList.add('renaming');
      row.innerHTML = `
        <form class="person-add-row people-rename-form">
          <input class="input" maxlength="${PERSON_NAME_MAX}" aria-label="${escapeHtml(i18n('personNameLabel'))}" value="${escapeHtml(p.name)}">
          <button type="submit" class="btn btn-secondary">${escapeHtml(i18n('save'))}</button>
          <button type="button" class="link-btn" data-action="cancel-rename">${escapeHtml(i18n('cancel'))}</button>
        </form>
        <div class="form-error" style="display:none;"></div>`;
      const form = row.querySelector('form');
      const input = form.querySelector('input');
      const errEl = row.querySelector('.form-error');
      form.addEventListener('submit', async (e)=>{
        e.preventDefault();
        try{
          await renamePerson(p.id, input.value);
        }catch(err){
          errEl.textContent = err.message;
          errEl.style.display = 'block';
          return;
        }
        renamingPersonId = null;
        render();
        showToast(i18n('personRenamed'));
      });
      row.querySelector('[data-action="cancel-rename"]').addEventListener('click', ()=>{
        renamingPersonId = null;
        renderPeopleCard();
      });
      list.appendChild(row);
      setTimeout(()=> input.focus(), 0);
      continue;
    }
    const stays = tripsFor(p.id).length;
    row.innerHTML = `
      <span class="people-row-name">${personDotHtml(p)}<span>${escapeHtml(p.name)}</span></span>
      <span class="people-row-count">${escapeHtml(countOf(stays, 'loggedStay', 'loggedStays'))}</span>
      <span class="row-actions row-actions-icons">
        <button type="button" class="link-btn" data-action="rename" aria-label="${escapeHtml(i18n('renamePerson', { name: p.name }))}">${PEN_ICON_SVG}</button>
        <button type="button" class="link-btn danger-link" data-action="delete" aria-label="${escapeHtml(i18n('deletePerson', { name: p.name }))}" ${onlyOne ? 'disabled' : ''}>${BIN_ICON_SVG}</button>
      </span>`;
    row.querySelector('[data-action="rename"]').addEventListener('click', ()=>{
      renamingPersonId = p.id;
      renderPeopleCard();
    });
    row.querySelector('[data-action="delete"]').addEventListener('click', async ()=>{
      if(people.length <= 1) return;
      const message = i18n('deletePersonConfirm', { name: p.name, stays: countOf(stays, 'loggedStay', 'loggedStays') });
      if(!confirm(message)) return;
      try{
        await deletePerson(p.id);
      }catch(err){
        showToast('Could not delete that person — please try again.');
        return;
      }
      selectedPersonIds = new Set([activePersonId]);
      render();
      showToast(i18n('personDeleted', { name: p.name }));
    });
    list.appendChild(row);
  }
  document.getElementById('peopleLastNote').style.display = onlyOne ? '' : 'none';
  const atCap = people.length >= MAX_PEOPLE;
  document.getElementById('addPersonForm').style.display = atCap ? 'none' : '';
  document.getElementById('peopleCapNote').style.display = atCap ? '' : 'none';
}
document.getElementById('addPersonForm').addEventListener('submit', (e)=>{
  e.preventDefault();
  handleAddPerson(document.getElementById('addPersonName'), document.getElementById('peopleError'), false);
});

// Two-button "[Name] / Everyone" toggle, shared by the Trips tab and the Export card.
function renderScopeToggle(wrapId, personBtnId, everyoneBtnId, scope){
  const wrap = document.getElementById(wrapId);
  wrap.hidden = people.length < 2;
  const person = activePerson();
  document.getElementById(personBtnId).textContent = person ? person.name : '';
  document.getElementById(personBtnId).setAttribute('aria-pressed', String(scope !== 'everyone'));
  document.getElementById(everyoneBtnId).setAttribute('aria-pressed', String(scope === 'everyone'));
}
function renderTripScopeToggle(){
  if(people.length < 2) tripListScope = 'person';
  renderScopeToggle('tripScopeToggle', 'tripScopePersonBtn', 'tripScopeEveryoneBtn', tripListScope);
}
// "Who is it for?" on the Export card — defaults to the active person, hidden with one person.
function renderExportChips(){
  const field = document.getElementById('exportWhoField');
  const multi = people.length > 1;
  if(exportDefaultFor !== activePersonId){
    exportDefaultFor = activePersonId;
    exportSelectedIds = new Set(activePersonId ? [activePersonId] : []);
  }
  exportSelectedIds = new Set([...exportSelectedIds].filter(id => personById(id)));
  field.hidden = !multi;
  const none = multi && exportSelectedIds.size === 0;
  document.getElementById('exportCsvBtn').disabled = none;
  document.getElementById('printTripsBtn').disabled = none;
  document.getElementById('exportWhoNote').style.display = none ? '' : 'none';
  document.getElementById('exportPerPersonRow').hidden = !(multi && exportSelectedIds.size > 1);
  document.getElementById('exportPerPersonToggle').checked = exportOnePerFile;
  if(!multi) return;
  renderPersonChips(document.getElementById('exportWhoChips'), exportSelectedIds, { resetTo: activePersonId, onChange: renderExportChips });
}
document.getElementById('exportPerPersonToggle').addEventListener('change', (e)=>{ exportOnePerFile = e.target.checked; });
document.getElementById('tripScopePersonBtn').addEventListener('click', ()=>{ tripListScope = 'person'; renderTripScopeToggle(); renderTripRows(); });
document.getElementById('tripScopeEveryoneBtn').addEventListener('click', ()=>{ tripListScope = 'everyone'; renderTripScopeToggle(); renderTripRows(); });

function renderResetButtons(){
  const person = activePerson();
  const multi = people.length > 1;
  document.getElementById('resetBtn').textContent = multi && person ? i18n('clearPersonStays', { name: person.name }) : 'Clear all logged stays';
  document.getElementById('resetAllBtn').style.display = multi ? '' : 'none';
}

function renderCalendarPersonTag(){
  const el = document.getElementById('calendarPersonTag');
  const person = activePerson();
  if(people.length < 2 || !person){ el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `${personDotHtml(person)}${escapeHtml(i18n('showingDaysFor', { name: person.name }))}`;
}

// --- "Who is it for?" chips on the Calendar form ---

function selectedPeople(){
  return people.filter(p => selectedPersonIds.has(p.id));
}

function renderWhoForChips(){
  const field = document.getElementById('whoForField');
  // Drop anyone who no longer exists; default to the active person.
  selectedPersonIds = new Set([...selectedPersonIds].filter(id => personById(id)));
  if(people.length < 2){
    selectedPersonIds = new Set(people.length ? [activePerson().id] : []);
  }
  if(people.length < 2){ field.hidden = true; return; }
  // While editing, the trip's owner stays selected; others can be added or removed.
  const owner = editingOwnerId();
  if(owner) selectedPersonIds.add(owner);
  field.hidden = false;
  renderPersonChips(document.getElementById('whoForChips'), selectedPersonIds, {
    lockedId: owner,
    resetTo: owner || activePersonId,
    onChange: ()=>{ renderWhoForChips(); updateEditStayCompliance(); }
  });
}

// One chip per person (plus "Everyone" at 3+), toggling ids in `selected` in place.
// `lockedId` stays selected and ignores taps; clearing "Everyone" falls back to `resetTo`.
function renderPersonChips(container, selected, { lockedId = null, resetTo = null, onChange }){
  container.innerHTML = '';
  const chip = (label, pressed, onClick, person) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'who-chip';
    b.setAttribute('aria-pressed', String(pressed));
    if(person && person.id === lockedId){
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-label', i18n('ownerChipAria', { name: person.name }));
    }
    b.innerHTML = `<span class="who-chip-tick" aria-hidden="true">${pressed ? '✓' : ''}</span>${person ? personDotHtml(person) : ''}<span class="who-chip-name">${escapeHtml(label)}</span>`;
    b.addEventListener('click', onClick);
    container.appendChild(b);
  };
  if(people.length >= 3){
    const allSelected = people.every(p => selected.has(p.id));
    chip(i18n('everyone'), allSelected, ()=>{
      selected.clear();
      if(allSelected){ if(resetTo) selected.add(resetTo); }
      else people.forEach(p => selected.add(p.id));
      onChange();
    });
  }
  for(const p of people){
    chip(p.name, selected.has(p.id), ()=>{
      if(p.id === lockedId) return;
      if(selected.has(p.id)) selected.delete(p.id);
      else selected.add(p.id);
      onChange();
    }, p);
  }
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

  const activeCard = document.getElementById('activeTripCard');
  const compactPanel = document.getElementById('nextTripCompact');
  const nextCard = document.getElementById('nextTripCard');
  const empty = document.getElementById('nextTripEmpty');

  activeCard.style.display = active ? 'flex' : 'none';
  compactPanel.style.display = (active && next) ? 'block' : 'none';
  nextCard.style.display = (!active && next) ? 'flex' : 'none';
  empty.style.display = !next ? 'block' : 'none';

  if(active) renderActiveTrip(active);
  if(active && next) renderCompactNextTrip(next);
  if(!active && next) renderFullNextTrip(next);
}

function renderActiveTrip(trip){
  const card = document.getElementById('activeTripCard');
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

  card.onclick = () => switchTab('trips');
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
  const tripInfo = row.querySelector('.trip-info');
  // The direct-child row-actions (Edit/Add note/Delete) — not the one nested inside
  // .note-editor, which is that editor's own Save/Cancel row.
  const actions = tripInfo.querySelector(':scope > .row-actions');

  const otherTrips = trips.filter(t => t.id !== trip.id);
  const suggestion = computeTripSuggestion(trips, otherTrips, trip.start, trip.end, 90);
  const suggestionText = suggestion.overstay
    ? (suggestion.suggestions[0] ? suggestion.suggestions[0].label : '')
    : (suggestion.extendable
        ? `Could extend by <strong>${suggestion.extra} more day${suggestion.extra === 1 ? '' : 's'}</strong> — max stay until ${fmt(suggestion.lastExit)}.`
        : '');
  if(suggestionText){
    const p = document.createElement('p');
    p.className = 'card-body';
    p.style.marginTop = '6px';
    p.innerHTML = suggestionText;
    tripInfo.appendChild(p);
  }
  // Move Edit/Add note/Delete below the suggestion text instead of above it.
  if(actions) tripInfo.appendChild(actions);

  panel.appendChild(row);
  wireTripRowActions(panel);
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

// The country you've actually spent the most days in — side-trip days excluded,
// since those days weren't spent in that country's Schengen territory at all.
function topVisitedCountry(){
  const dayTotals = new Map();
  for(const t of trips){
    if(classifyTrip(t) === 'planned' || !t.label) continue;
    const span = Math.round((toDate(t.end) - toDate(t.start))/86400000) + 1;
    const days = span - excludedDayCount(t);
    dayTotals.set(t.label, (dayTotals.get(t.label) || 0) + days);
  }
  let top = null;
  for(const [label, days] of dayTotals){
    if(!top || days > top.days) top = { label, days };
  }
  return top;
}

function renderCountriesCard(){
  const visited = visitedCountries();
  document.getElementById('countriesCount').textContent = `${visited.size} of ${ALL_COUNTRIES.length}`;
  document.getElementById('countriesProgressFill').style.width =
    `${(visited.size / ALL_COUNTRIES.length) * 100}%`;

  const preview = document.getElementById('countriesPreview');
  const top = document.getElementById('countriesTop');
  if(visited.size === 0){
    preview.innerHTML = `<span class="countries-preview-caption">Log your first trip to start stamping</span>`;
    top.innerHTML = '';
    return;
  }

  // Most-recently-stamped country per label wins, then sorted newest first, so the
  // preview mirrors "what would I see if I opened the grid right now."
  const lastVisit = new Map();
  for(const t of trips){
    if(classifyTrip(t) === 'planned' || !t.label) continue;
    if(!lastVisit.has(t.label) || t.end > lastVisit.get(t.label)) lastVisit.set(t.label, t.end);
  }
  const byRecency = [...lastVisit.entries()].sort((a, b) => b[1].localeCompare(a[1])).map(([label]) => label);

  const MAX_CHIPS = 4;
  const shown = byRecency.slice(0, MAX_CHIPS);
  const overflow = byRecency.length - shown.length;
  const chipsHtml = shown.map(name =>
    `<span class="countries-preview-chip" title="${escapeHtml(name)}">${flagIconHtml(name)}</span>`
  ).join('') + (overflow > 0 ? `<span class="countries-preview-chip more">+${overflow}</span>` : '');

  preview.innerHTML = `${chipsHtml}<span class="countries-preview-caption">Last stamped: ${escapeHtml(byRecency[0])}</span>`;

  const topCountry = topVisitedCountry();
  top.innerHTML = topCountry
    ? `${flagIconHtml(topCountry.label)}<span class="countries-top-caption">Top country: <b>${escapeHtml(topCountry.label)}</b> · ${dayCount(topCountry.days)}</span>`
    : '';
}

function renderCountries(){
  const visited = visitedCountries();
  const person = activePerson();
  document.getElementById('countriesSubtitle').textContent = (people.length > 1 && person)
    ? i18n('countriesSubtitlePerson', { name: person.name, count: visited.size, total: ALL_COUNTRIES.length })
    : `${visited.size} of ${ALL_COUNTRIES.length} Schengen countries stamped`;

  const grid = document.getElementById('countriesGrid');
  grid.innerHTML = '';
  for(const name of ALL_COUNTRIES){
    if(!visited.has(name)) continue;
    const tile = document.createElement('div');
    tile.className = 'country-tile visited';
    tile.innerHTML = `${stampHtml(name)}<div class="name">${name}</div>`;
    grid.appendChild(tile);
  }
  if(!grid.children.length) grid.innerHTML = `<div class="empty-note">Log your first trip to start stamping.</div>`;

  // Countries with no stamp yet stay out of the way, collapsed by default.
  const pendingGrid = document.getElementById('countriesGridPending');
  pendingGrid.innerHTML = '';
  let pendingCount = 0;
  for(const name of ALL_COUNTRIES){
    if(visited.has(name)) continue;
    const tile = document.createElement('div');
    tile.className = 'country-tile pending';
    tile.innerHTML = `<div class="name">${name}</div>`;
    pendingGrid.appendChild(tile);
    pendingCount++;
  }
  document.getElementById('countriesPendingDetails').style.display = pendingCount ? '' : 'none';
  document.getElementById('countriesPendingLabel').textContent = `Not yet visited (${pendingCount})`;
}

// --- Trips list ---

// `showPerson` adds the owner's tag — used by the Trips tab's Everyone view.
function buildTripRow(trip, status, showPerson){
  const days = Math.round((toDate(trip.end) - toDate(trip.start))/86400000) + 1;
  const overstay = tripOverstayInfo(tripsFor(trip.personId), trip, 90);
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
      ${showPerson ? `<div class="trip-person">${personTagHtml(personById(trip.personId))}</div>` : ''}
      ${exclNote}
      ${noteHtml}
      <div class="note-editor" id="noteEditor-${trip.id}" style="display:none; margin-top:6px;">
        <textarea class="input" rows="2" placeholder="Add a note (optional)" aria-label="Note">${escapeHtml(trip.note || '')}</textarea>
        <div class="row-actions">
          <button type="button" class="link-btn" data-action="save-note" data-id="${trip.id}">Save note</button>
          <button type="button" class="link-btn" data-action="cancel-note" data-id="${trip.id}">Cancel</button>
        </div>
      </div>
      <div class="row-actions row-actions-icons">
        <button type="button" class="link-btn" data-action="edit" data-id="${trip.id}" aria-label="Edit trip">${PEN_ICON_SVG}</button>
        <button type="button" class="link-btn" data-action="note" data-id="${trip.id}" aria-label="${trip.note ? 'Edit note' : 'Add note'}">${noteIconSvg(!!trip.note)}</button>
        <button type="button" class="link-btn danger-link" data-action="remove" data-id="${trip.id}" aria-label="Delete trip">${BIN_ICON_SVG}</button>
      </div>
    </div>
    <div class="trip-status">${statusHtml}</div>
  `;
  return row;
}

function renderTripRows(){
  const rowsEl = document.getElementById('tripRows');
  rowsEl.innerHTML = '';
  const everyone = tripListScope === 'everyone' && people.length > 1;
  const list = everyone ? [...allTrips] : trips;
  if(list.length === 0){
    rowsEl.innerHTML = `<div class="empty-note">No stays logged yet.</div>`;
    return;
  }
  // Everyone view is a plain timeline (newest start first); the per-person view keeps
  // an active trip pinned to the top.
  list.sort((a,b)=>{
    if(!everyone){
      const aActive = classifyTrip(a) === 'active';
      const bActive = classifyTrip(b) === 'active';
      if(aActive !== bActive) return aActive ? -1 : 1;
    }
    return a.start < b.start ? 1 : a.start > b.start ? -1 : 0;
  });

  const completedRows = [];
  let inlineCount = 0;
  for(const trip of list){
    const status = classifyTrip(trip);
    const row = buildTripRow(trip, status, everyone);
    if(status === 'past') completedRows.push(row);
    else { rowsEl.appendChild(row); inlineCount++; }
  }

  // At most 4 trips stay visible inline in total. Active/planned trips always show
  // (they're current or upcoming, not history), and the most-recently-completed
  // stays fill any remaining slots up to that cap; anything past the cap collapses
  // into one expandable group, out of the way by default.
  const VISIBLE_TRIP_CAP = 4;
  const recentCompletedCount = Math.max(0, VISIBLE_TRIP_CAP - inlineCount);
  completedRows.slice(0, recentCompletedCount).forEach(row => rowsEl.appendChild(row));
  const olderCompletedRows = completedRows.slice(recentCompletedCount);

  if(olderCompletedRows.length){
    const group = document.createElement('details');
    group.className = 'card';
    group.innerHTML = `
      <summary class="qc-title-row">
        <span class="qc-title-label"><span class="qc-title-black">Earlier trips (${olderCompletedRows.length})</span></span>
        <span class="qc-title-rule"></span>
      </summary>
    `;
    const list = document.createElement('div');
    list.className = 'stack';
    list.style.marginTop = '10px';
    olderCompletedRows.forEach(row => list.appendChild(row));
    group.appendChild(list);
    rowsEl.appendChild(group);
  }

  wireTripRowActions(rowsEl);
}

// Wires up Edit/Add note/Delete and the inline note editor's Save/Cancel for every
// trip row inside a container — shared by the Trips tab's full list and Home's
// single-trip "Next trip" preview, so both are equally interactive.
function wireTripRowActions(container){
  container.querySelectorAll('[data-action="remove"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.currentTarget.getAttribute('data-id');
      const trip = allTrips.find(t => String(t.id) === String(id));
      if(!trip) return;
      const others = groupMates(trip);
      try{
        if(others.length){
          const owner = personById(trip.personId);
          const choice = await askGroupScope(
            others.length === 1 ? i18n('groupDeleteOne') : i18n('groupDeleteMany', { count: others.length }),
            i18n('removeForEveryone'),
            i18n('onlyName', { name: owner ? owner.name : '' })
          );
          if(!choice) return;
          await deleteTrips(choice === 'all' ? [trip.id, ...others.map(t => t.id)] : [trip.id]);
        } else {
          await deleteTrip(trip.id);
        }
      }catch(err){
        showToast('Could not delete that trip — please try again.');
        return;
      }
      render();
    });
  });
  container.querySelectorAll('[data-action="edit"]').forEach(btn=>{
    btn.addEventListener('click', (e)=> startEditTrip(e.currentTarget.getAttribute('data-id')));
  });
  container.querySelectorAll('[data-action="note"]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      const editor = document.getElementById(`noteEditor-${e.currentTarget.getAttribute('data-id')}`);
      if(!editor) return;
      const opening = editor.style.display === 'none';
      editor.style.display = opening ? '' : 'none';
      if(opening) editor.querySelector('textarea').focus();
    });
  });
  container.querySelectorAll('[data-action="cancel-note"]').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      document.getElementById(`noteEditor-${e.currentTarget.getAttribute('data-id')}`).style.display = 'none';
    });
  });
  container.querySelectorAll('[data-action="save-note"]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      const id = e.currentTarget.getAttribute('data-id');
      const trip = allTrips.find(t => String(t.id) === String(id));
      if(!trip) return;
      const note = document.getElementById(`noteEditor-${id}`).querySelector('textarea').value.trim();
      try{
        await updateTrip(trip.id, trip.start, trip.end, trip.label, trip.excludedRanges, note);
      }catch(err){
        showToast('Could not save that note — please try again.');
        return;
      }
      render();
      showToast('Note saved');
    });
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
  const pcPerson = activePerson();
  let html = `<h1>Schengen Guard — passport control</h1>${people.length > 1 && pcPerson ? `<p>${escapeHtml(i18n('passportFor', { name: pcPerson.name }))}</p>` : ''}<p>Control date ${fmt(controlISO)} · 180-day window ${fmt(windowStartISO)} to ${fmt(controlISO)} · ${dayCount(totalDays)} in the Schengen Area</p>`;
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

// The person whose trip is being edited, or null when logging a new stay.
function editingOwnerId(){
  if(editingTripId === null) return null;
  const trip = allTrips.find(t => t.id === editingTripId);
  return trip ? trip.personId : null;
}

// Ids of the trip being edited and its group mates — each person's own copy is left out
// of their baseline so it isn't double-counted against the edited dates.
function editingGroupTripIds(){
  if(editingTripId === null) return new Set();
  const trip = allTrips.find(t => t.id === editingTripId);
  return new Set([editingTripId, ...groupMates(trip).map(t => t.id)]);
}

// The people the checker is running for: whoever is selected in "Who is it for?"
// (while editing, that always includes the trip's owner).
function checkerPeople(){
  return selectedPeople();
}

// One person's view of the candidate stay: their own trips plus the candidate, never
// anyone else's. `baseline` excludes the trip being edited so it isn't double-counted.
function checkCandidateFor(person, candidate){
  const skip = editingGroupTripIds();
  const baseline = tripsFor(person.id).filter(t => !skip.has(t.id));
  const hypothetical = baseline.concat([candidate]);
  const overstay = tripOverstayInfo(hypothetical, candidate, 90);
  return {
    person, baseline, hypothetical, overstay,
    daysLeft: overstay ? null : 90 - usedDaysInWindow(hypothetical, candidate.end)
  };
}

// Worst first: anyone over the limit (earliest breach, then highest total), then the
// smallest margin.
function compareCheckResults(a, b){
  if(!!a.overstay !== !!b.overstay) return a.overstay ? -1 : 1;
  if(a.overstay){
    if(a.overstay.date !== b.overstay.date) return a.overstay.date < b.overstay.date ? -1 : 1;
    return b.overstay.used - a.overstay.used;
  }
  return a.daysLeft - b.daysLeft;
}

// Headline for several people at once — the worst case across the selection.
function computeGroupVerdict(sortedResults){
  const failing = sortedResults.filter(r => r.overstay);
  if(failing.length){
    const worst = failing[0];
    const lastSafe = isoOf(addDays(toDate(worst.overstay.date), -1));
    return {
      status: 'fail',
      headline: i18n('notSafeFor', { names: formatNames(failing.map(r => r.person.name)) }),
      detail: i18n('worstBreach', { name: worst.person.name, date: fmt(worst.overstay.date), used: worst.overstay.used, lastSafe: fmt(lastSafe) }),
      breakDate: worst.overstay.date
    };
  }
  const tightest = sortedResults[0];
  return {
    status: 'ok',
    headline: i18n('safeForEveryone'),
    detail: i18n('tightestMargin', { name: tightest.person.name, days: dayCount(tightest.daysLeft) }),
    breakDate: null,
    daysLeft: tightest.daysLeft
  };
}

function renderVerdictPeople(sortedResults, candidate){
  const el = document.getElementById('verdictPeople');
  const counted = coveredDates([candidate]).size;
  el.innerHTML = '';
  for(const r of sortedResults){
    const row = document.createElement('div');
    row.className = `verdict-person ${r.overstay ? 'verdict-person-fail' : 'verdict-person-ok'}`;
    const result = r.overstay
      ? `<span class="warn-icon" aria-hidden="true">&#9888;</span> ${escapeHtml(i18n('rowOver', { date: fmt(r.overstay.date), used: r.overstay.used }))}`
      : escapeHtml(i18n('rowSafe', { days: dayCount(r.daysLeft) }));
    row.innerHTML = `
      <div class="verdict-person-top">
        ${personTagHtml(r.person)}
        <span class="verdict-person-stay">${escapeHtml(i18n('rowStay', { days: dayCount(counted) }))}</span>
      </div>
      <div class="verdict-person-result">${result}</div>
      <button type="button" class="qc-link verdict-person-breakdown" aria-label="${escapeHtml(i18n('rowBreakdownAria', { name: r.person.name }))}">${escapeHtml(i18n('rowBreakdown'))}</button>`;
    row.querySelector('.verdict-person-breakdown').addEventListener('click', ()=>{
      openBreakdown(r.hypothetical, candidate.end, r.person);
    });
    el.appendChild(row);
  }
  el.hidden = false;
}

// "Better options" that keep everyone selected compliant: the shortest trim (leave the day
// before the earliest breach) and the earliest shared start date. If neither works for
// everyone, fall back to each person's own best option.
function computeGroupSuggestions(results, start, end, excludedRanges){
  const duration = Math.round((toDate(end) - toDate(start)) / 86400000) + 1;
  const fitsEveryone = (cand) => results.every(r => !tripOverstayInfo(r.baseline.concat([cand]), cand, 90));
  const suggestions = [];

  const failing = results.filter(r => r.overstay);
  const earliestBreach = failing.map(r => r.overstay.date).sort()[0];
  const altEnd = isoOf(addDays(toDate(earliestBreach), -1));
  if(altEnd >= start){
    const trimmed = { start, end: altEnd, excludedRanges: excludedRanges.filter(r => r.end <= altEnd) };
    if(fitsEveryone(trimmed)){
      const altDays = Math.round((toDate(altEnd) - toDate(start)) / 86400000) + 1;
      suggestions.push({ label: `Leave by <strong>${fmt(altEnd)}</strong> instead (${dayCount(altDays)}) to keep everyone compliant.`, start, end: altEnd });
    }
  }

  const ownStarts = results.map(r => earliestCompliantStart(r.baseline, duration, 90));
  if(ownStarts.every(Boolean)){
    let d = toDate(ownStarts.sort()[ownStarts.length - 1]);
    for(let i = 0; i < 400; i++){
      const cand = { start: isoOf(d), end: isoOf(addDays(d, duration - 1)) };
      if(fitsEveryone(cand)){
        if(cand.start !== start){
          suggestions.push({ label: `Shift the whole trip to start <strong>${fmt(cand.start)}</strong> instead (still ${dayCount(duration)}) to keep everyone compliant.`, start: cand.start, end: cand.end });
        }
        break;
      }
      d = addDays(d, 1);
    }
  }
  if(suggestions.length) return { common: true, suggestions };

  const perPerson = [];
  for(const r of failing){
    const own = computeTripSuggestion(r.hypothetical, r.baseline, start, end, 90).suggestions[0];
    if(own) perPerson.push({ ...own, label: `<strong>${escapeHtml(r.person.name)}:</strong> ${own.label}` });
  }
  return { common: false, suggestions: perPerson };
}

function renderSuggestionButtons(suggestions, introText){
  const suggestionsEl = document.getElementById('editStaySuggestions');
  if(!suggestions.length && !introText) return;
  suggestionsEl.style.display = 'grid';
  if(introText){
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = introText;
    suggestionsEl.appendChild(p);
  }
  for(const s of suggestions){
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

function updateEditStayCompliance(){
  const msgEl = document.getElementById('editStayMsg');
  const errEl = document.getElementById('formError');
  const saveBtn = document.getElementById('addTripBtn');
  const breakdownBtn = document.getElementById('editStayBreakdownBtn');
  const suggestionsEl = document.getElementById('editStaySuggestions');
  const bannerEl = document.getElementById('verdictBanner');
  const peopleEl = document.getElementById('verdictPeople');
  const start = pickStart;
  const end = pickEnd;
  errEl.style.display = 'none';
  breakdownBtn.style.display = 'none';
  suggestionsEl.style.display = 'none';
  suggestionsEl.innerHTML = '';
  peopleEl.hidden = true;
  peopleEl.innerHTML = '';
  document.getElementById('clearPickBtn').style.display = (start || end) ? 'inline-flex' : 'none';

  const stopWith = (message) => {
    msgEl.style.display = message ? 'block' : 'none';
    msgEl.textContent = message || '';
    renderVerdict(bannerEl, null);
    saveBtn.disabled = true;
    document.getElementById('logStayCue').style.display = 'none';
  };

  if(!start || !end){
    stopWith('Pick an entry and exit date to check compliance before you save it.');
    return;
  }
  if(end < start){
    stopWith('');
    errEl.textContent = 'Exit date must be on or after the entry date.';
    errEl.style.display = 'block';
    return;
  }
  const chosen = checkerPeople();
  if(chosen.length === 0){
    stopWith(i18n('selectSomeone'));
    return;
  }

  msgEl.style.display = 'none';
  const candidate = { start, end, label: '__editStay__', excludedRanges: pendingExcludedRanges };
  const results = chosen.map(p => checkCandidateFor(p, candidate)).sort(compareCheckResults);
  if(results.length === 1){
    // One person: exactly the original single-trip result.
    const r = results[0];
    breakdownBtn.style.display = 'inline-flex';
    renderVerdict(bannerEl, computeVerdict(candidate, r.hypothetical));
    if(r.overstay){
      renderSuggestionButtons(computeTripSuggestion(r.hypothetical, r.baseline, start, end, 90).suggestions);
    }
  } else {
    renderVerdict(bannerEl, computeGroupVerdict(results));
    renderVerdictPeople(results, candidate);
    if(results.some(r => r.overstay)){
      const group = computeGroupSuggestions(results, start, end, pendingExcludedRanges);
      renderSuggestionButtons(group.suggestions, group.common ? '' : i18n('noCommonOption'));
    }
  }
  saveBtn.disabled = false;
  document.getElementById('logStayCue').style.display = 'block';
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
      openBreakdown(trips, endIso, activePerson());
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
      openBreakdown(trips, months[m].endIso, activePerson());
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
    el.innerHTML = `<span class="daynum">${day}</span><span class="rem">${used>90 ? '−'+(used-90) : remaining}</span>`;
    el.addEventListener('click', ()=>handlePick(iso));
    grid.appendChild(el);
  }
}

// Pre-fill the log-a-stay form with an existing trip's data and switch into edit mode
function startEditTrip(id){
  const trip = allTrips.find(t => String(t.id) === String(id));
  if(!trip) return;
  // Editing from the Everyone view: the form checks against the owner's own history,
  // so make the owner the active person first.
  if(trip.personId !== activePersonId){
    setActivePersonId(trip.personId);
    render();
  }

  editingTripId = trip.id;
  pickStart = trip.start;
  pickEnd = trip.end;
  pendingExcludedRanges = (trip.excludedRanges || []).map(r => ({ ...r }));
  exclusionFormOpen = false; editingExclusionIndex = null;
  document.getElementById('exclusionSection').open = pendingExcludedRanges.length > 0;
  document.getElementById('tripLabel').value = trip.label;
  document.getElementById('tripStart').value = trip.start;
  document.getElementById('tripEnd').value = trip.end;
  document.getElementById('pickStartLbl').textContent = `Entry: ${fmt(trip.start)}`;
  document.getElementById('pickEndLbl').textContent = `Exit: ${fmt(trip.end)}`;
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = 'Update stay';
  document.getElementById('cancelEditBtn').style.display = 'block';
  selectedPersonIds = new Set([trip.personId, ...groupMates(trip).map(t => t.personId)]);
  renderWhoForChips();

  calCursor = new Date(toDate(trip.start)); calCursor.setDate(1);
  switchTab('calendar');
  renderCalendar();
  renderExclusionSection();
}

function stopEditTrip(){
  editingTripId = null;
  pickStart = null; pickEnd = null;
  pendingExcludedRanges = [];
  exclusionFormOpen = false; editingExclusionIndex = null;
  document.getElementById('exclusionSection').open = false;
  document.getElementById('tripLabel').value = 'Spain';
  document.getElementById('tripStart').value = '';
  document.getElementById('tripEnd').value = '';
  document.getElementById('pickStartLbl').textContent = 'Entry: —';
  document.getElementById('pickEndLbl').textContent = 'Exit: —';
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = 'Log stay';
  document.getElementById('cancelEditBtn').style.display = 'none';
  selectedPersonIds = new Set(activePersonId ? [activePersonId] : []);
  renderWhoForChips();
  renderCalendar();
  renderExclusionSection();
}

// --- Side-trip exclusion (mark days within a logged stay as spent outside Schengen) ---

function renderExclusionSection(){
  const section = document.getElementById('exclusionSection');
  if(!pickStart || !pickEnd){
    section.style.display = 'none';
    exclusionFormOpen = false; editingExclusionIndex = null;
    updateEditStayCompliance();
    return;
  }
  section.style.display = 'block';
  document.getElementById('exclusionNote').textContent = `Left and came back during this stay — like a UK leg? Add the dates below (must fall within ${fmt(pickStart)}–${fmt(pickEnd)}) and they won't count toward your 90-day limit.`;

  const tooShort = pickStart === pickEnd;
  if(tooShort){
    exclusionFormOpen = false; editingExclusionIndex = null;
  }
  document.getElementById('markSideTripBtn').style.display = !tooShort ? 'block' : 'none';
  document.getElementById('exclusionTooShort').style.display = tooShort ? 'block' : 'none';
  document.getElementById('exclusionPicker').style.display = (!tooShort && exclusionFormOpen) ? 'block' : 'none';

  const startInput = document.getElementById('exclStartInput');
  const endInput = document.getElementById('exclEndInput');
  startInput.min = pickStart; startInput.max = pickEnd;
  endInput.min = pickStart; endInput.max = pickEnd;

  document.getElementById('addExclusionBtn').textContent = editingExclusionIndex !== null ? 'Save changes' : 'Add side trip';
  renderExclusionList();
  updateEditStayCompliance();
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
      exclusionFormOpen = true;
      document.getElementById('exclStartInput').value = r.start;
      document.getElementById('exclEndInput').value = r.end;
      document.getElementById('exclusionError').style.display = 'none';
      renderExclusionSection();
    });
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'link-btn danger-link';
    removeBtn.innerHTML = BIN_ICON_SVG;
    removeBtn.setAttribute('aria-label', 'Delete side trip');
    removeBtn.addEventListener('click', ()=>{
      pendingExcludedRanges.splice(idx, 1);
      if(editingExclusionIndex === idx){
        exclusionFormOpen = false; editingExclusionIndex = null;
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
  exclusionFormOpen = true;
  editingExclusionIndex = null;
  document.getElementById('exclStartInput').value = '';
  document.getElementById('exclEndInput').value = '';
  document.getElementById('exclusionError').style.display = 'none';
  renderExclusionSection();
});

document.getElementById('cancelExclusionBtn').addEventListener('click', ()=>{
  exclusionFormOpen = false;
  editingExclusionIndex = null;
  document.getElementById('exclusionError').style.display = 'none';
  renderExclusionSection();
});

document.getElementById('addExclusionBtn').addEventListener('click', ()=>{
  const errEl = document.getElementById('exclusionError');
  errEl.style.display = 'none';
  const exclStart = document.getElementById('exclStartInput').value;
  const exclEnd = document.getElementById('exclEndInput').value;
  if(!exclStart || !exclEnd){
    errEl.textContent = 'Pick the day you left and the day you returned.';
    errEl.style.display = 'block';
    return;
  }
  if(exclEnd < exclStart){
    errEl.textContent = 'The return date must be on or after the day you left.';
    errEl.style.display = 'block';
    return;
  }
  if(exclStart < pickStart || exclEnd > pickEnd){
    errEl.textContent = `Both dates must fall within your trip (${fmt(pickStart)}–${fmt(pickEnd)}).`;
    errEl.style.display = 'block';
    return;
  }
  const overlaps = pendingExcludedRanges.some((r, idx) => idx !== editingExclusionIndex && exclStart <= r.end && exclEnd >= r.start);
  if(overlaps){
    errEl.textContent = 'That range overlaps a side trip you already added.';
    errEl.style.display = 'block';
    return;
  }
  if(editingExclusionIndex !== null){
    pendingExcludedRanges[editingExclusionIndex] = { start: exclStart, end: exclEnd };
  } else {
    pendingExcludedRanges.push({ start: exclStart, end: exclEnd });
  }
  pendingExcludedRanges.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  exclusionFormOpen = false;
  editingExclusionIndex = null;
  renderExclusionSection();
  renderCalendar();
});

// The exclusion date fields don't need a page reload or a click to see their effect —
// re-check compliance (debounced, since these are free-typed date inputs) as soon as
// either changes, same as entry/exit dates already do via handlePick().
let verdictDebounceTimer = null;
function scheduleVerdictUpdate(){
  clearTimeout(verdictDebounceTimer);
  verdictDebounceTimer = setTimeout(updateEditStayCompliance, 150);
}
document.getElementById('exclStartInput').addEventListener('input', scheduleVerdictUpdate);
document.getElementById('exclStartInput').addEventListener('change', scheduleVerdictUpdate);
document.getElementById('exclEndInput').addEventListener('input', scheduleVerdictUpdate);
document.getElementById('exclEndInput').addEventListener('change', scheduleVerdictUpdate);

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
  document.getElementById('pickStartLbl').textContent = `Entry: ${pickStart ? fmt(pickStart) : '—'}`;
  document.getElementById('pickEndLbl').textContent = `Exit: ${pickEnd ? fmt(pickEnd) : '—'}`;
  renderCalendar();
  renderExclusionSection();
}

// Resets just the picked dates (and anything derived from them: side trips, the
// verdict, suggestions) without leaving edit mode or touching the country/note fields —
// a narrower reset than Cancel edit, for "I want to try different dates."
document.getElementById('clearPickBtn').addEventListener('click', ()=>{
  pickStart = null; pickEnd = null;
  pendingExcludedRanges = [];
  document.getElementById('tripStart').value = '';
  document.getElementById('tripEnd').value = '';
  document.getElementById('pickStartLbl').textContent = 'Entry: —';
  document.getElementById('pickEndLbl').textContent = 'Exit: —';
  renderCalendar();
  renderExclusionSection();
});

// Other trips saved together with this one for other people (same groupId).
function groupMates(trip){
  if(!trip || !trip.groupId) return [];
  return allTrips.filter(t => t.groupId === trip.groupId && t.id !== trip.id);
}

// Two-choice dialog for grouped trips. Resolves 'all', 'one', or null (cancelled).
function askGroupScope(message, allLabel, oneLabel){
  const modal = document.getElementById('groupModal');
  document.getElementById('groupModalMsg').textContent = message;
  const allBtn = document.getElementById('groupAllBtn');
  const oneBtn = document.getElementById('groupOneBtn');
  const cancelBtn = document.getElementById('groupCancelBtn');
  allBtn.textContent = allLabel;
  oneBtn.textContent = oneLabel;
  modal.style.display = 'flex';
  allBtn.focus();
  return new Promise(resolve => {
    const done = (value) => {
      modal.style.display = 'none';
      allBtn.onclick = oneBtn.onclick = cancelBtn.onclick = null;
      resolve(value);
    };
    allBtn.onclick = () => done('all');
    oneBtn.onclick = () => done('one');
    cancelBtn.onclick = () => done(null);
  });
}

function sameRanges(a, b){
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function overlappingTrip(personId, start, end, ignoreIds){
  return tripsFor(personId).find(ot => !ignoreIds.includes(ot.id) && start <= ot.end && end >= ot.start) || null;
}

document.getElementById('addTripBtn').addEventListener('click', async ()=>{
  const label = document.getElementById('tripLabel').value.trim();
  const start = document.getElementById('tripStart').value;
  const end = document.getElementById('tripEnd').value;
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
  const wasEditing = editingTripId !== null;
  const editing = wasEditing ? allTrips.find(t => t.id === editingTripId) : null;
  if(wasEditing && !editing){ stopEditTrip(); render(); return; }

  // Which trips this save touches, per person.
  let targets; // [{ personId, tripId|null }]
  let detach = false;
  let addedIds = [];    // people newly added to the trip being edited
  let removedTrips = []; // group mates' copies to delete
  if(wasEditing){
    targets = [{ personId: editing.personId, tripId: editing.id }];
    const allMates = groupMates(editing);
    const chosen = new Set(selectedPeople().map(p => p.id));
    chosen.add(editing.personId);
    const mates = allMates.filter(m => chosen.has(m.personId));
    removedTrips = allMates.filter(m => !chosen.has(m.personId));
    const matePeople = new Set(allMates.map(m => m.personId));
    addedIds = [...chosen].filter(id => id !== editing.personId && !matePeople.has(id));
    if(removedTrips.length){
      const names = formatNames(removedTrips.map(m => (personById(m.personId) || {}).name || ''));
      if(!confirm(i18n('removeFromTripConfirm', { names }))) return;
    }
    const changed = editing.start !== start || editing.end !== end || editing.label !== label || !sameRanges(editing.excludedRanges, pendingExcludedRanges);
    if(mates.length && changed){
      const owner = personById(editing.personId);
      const choice = await askGroupScope(
        mates.length === 1 ? i18n('groupEditOne') : i18n('groupEditMany', { count: mates.length }),
        i18n('applyToEveryone'),
        i18n('onlyName', { name: owner ? owner.name : '' })
      );
      if(!choice) return;
      if(choice === 'all') targets = targets.concat(mates.map(m => ({ personId: m.personId, tripId: m.id })));
      else detach = true;
    }
  } else {
    targets = selectedPeople().map(p => ({ personId: p.id, tripId: null }));
    if(!targets.length){
      errEl.textContent = i18n('selectSomeone');
      errEl.style.display = 'block';
      return;
    }
  }

  // Overlap check per person; one confirm covers everyone affected.
  const ignore = targets.map(x => x.tripId).filter(Boolean);
  const overlapTargets = targets.concat(addedIds.map(id => ({ personId: id, tripId: null })));
  const overlaps = overlapTargets.map(x => ({ x, trip: overlappingTrip(x.personId, start, end, ignore) })).filter(o => o.trip);
  if(overlaps.length){
    let message;
    if(people.length < 2){
      const verb = wasEditing ? 'Update' : 'Log';
      const o = overlaps[0].trip;
      message = `This overlaps with your logged stay in ${o.label} (${fmt(o.start)} – ${fmt(o.end)}). ${verb} it anyway?`;
    } else {
      message = i18n('overlapPeople', { names: formatNames(overlaps.map(o => (personById(o.x.personId) || {}).name || '')) });
    }
    if(!confirm(message)) return;
  }

  try{
    if(wasEditing){
      // Note intentionally omitted — the Calendar form no longer edits it, and
      // updateTrip() falls back to the existing note when none is passed, so a
      // plain date/country edit here never clobbers a note added from the trip row.
      // People added while editing join the owner's group (a new one if needed). After
      // "Only [name]" the owner leaves the old group, so added people start a fresh one.
      let ownerGroup = detach ? null : undefined;
      if(addedIds.length) ownerGroup = (!detach && editing.groupId) ? editing.groupId : newId();
      for(const x of targets){
        await updateTrip(x.tripId, start, end, label, pendingExcludedRanges, undefined, x.tripId === editing.id ? ownerGroup : undefined);
      }
      if(addedIds.length) await insertTripForPeople(addedIds, start, end, label, pendingExcludedRanges, ownerGroup);
      if(removedTrips.length) await deleteTrips(removedTrips.map(m => m.id));
    } else {
      await insertTripForPeople(targets.map(x => x.personId), start, end, label, pendingExcludedRanges);
    }
  }catch(e){
    errEl.textContent = 'Could not save that stay — please try again.';
    errEl.style.display = 'block';
    return;
  }
  stopEditTrip();
  render();
  switchTab('trips');
  showToast(wasEditing ? 'Trip updated' : 'Trip saved');
});

document.getElementById('refDate').addEventListener('change', render);

document.getElementById('resetBtn').addEventListener('click', async ()=>{
  const person = activePerson();
  if(people.length > 1 && person){
    if(!confirm(i18n('clearPersonConfirm', { name: person.name }))) return;
    await deleteAllTrips(person.id);
  } else {
    if(!confirm("Clear all logged stays? This cannot be undone.")) return;
    await deleteAllTrips();
  }
  render();
});
document.getElementById('resetAllBtn').addEventListener('click', async ()=>{
  if(!confirm(i18n('clearEveryoneConfirm'))) return;
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

// The people the CSV/print export covers (in People order): whoever is picked on the
// Export card, or simply the one person when there's only one.
function exportPeople(){
  if(people.length < 2) return people.slice(0, 1);
  return people.filter(p => exportSelectedIds.has(p.id));
}
function sortedTripsFor(personId){
  return tripsFor(personId).sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
}
function personName(personId){
  const p = personById(personId);
  return p ? p.name : '';
}
// Filename-safe form of a name: "Anna Lee" → "anna-lee" (letters in any script are kept).
function fileSlug(name){
  return String(name).toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'person';
}

function excludedDayCount(trip){
  let n = 0;
  for(const r of (trip.excludedRanges || [])) n += Math.round((toDate(r.end) - toDate(r.start))/86400000) + 1;
  return n;
}
function sideTripsText(trip, format){
  return (trip.excludedRanges || []).map(r => `${format(r.start)} – ${format(r.end)}`).join('; ');
}

// CSV rows for the given people; a Person column only when the file covers more than one.
function csvRows(list){
  const withPerson = list.length > 1;
  const header = ['Country','Entry date','Exit date','Days','Excluded days',i18n('csvSideTrips'),'Status'];
  const rows = [withPerson ? [i18n('csvPerson')].concat(header) : header];
  for(const p of list){
    for(const t of sortedTripsFor(p.id)){
      const days = Math.round((toDate(t.end) - toDate(t.start))/86400000) + 1;
      const row = [t.label || '', t.start, t.end, String(days), String(excludedDayCount(t)), sideTripsText(t, iso => iso), classifyTrip(t)];
      rows.push(withPerson ? [p.name].concat(row) : row);
    }
  }
  return rows;
}
function downloadCsv(filename, rows){
  const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
}

document.getElementById('exportCsvBtn').addEventListener('click', async ()=>{
  const chosen = exportPeople();
  if(!chosen.length) return;
  const date = todayISO();
  if(chosen.length === 1 || exportOnePerFile){
    for(let i = 0; i < chosen.length; i++){
      // A short gap between files — browsers drop rapid back-to-back downloads.
      if(i) await new Promise(r => setTimeout(r, 400));
      downloadCsv(`schengen-trips-${fileSlug(chosen[i].name)}-${date}.csv`, csvRows([chosen[i]]));
    }
    return;
  }
  const who = chosen.length === people.length ? 'everyone' : chosen.map(p => fileSlug(p.name)).join('-');
  downloadCsv(`schengen-trips-${who}-${date}.csv`, csvRows(chosen));
});

// One section per person, each starting on a new printed page: name, days used and
// remaining as of today, then their stays with side trips marked.
document.getElementById('printTripsBtn').addEventListener('click', ()=>{
  const chosen = exportPeople();
  if(!chosen.length) return;
  const today = todayISO();
  let html = '';
  chosen.forEach((p, i)=>{
    const used = usedDaysInWindow(tripsFor(p.id), today);
    const standing = used > 90
      ? i18n('printOver', { used, date: fmt(today), over: dayCount(used - 90) })
      : i18n('printUsed', { used, date: fmt(today), remaining: dayCount(90 - used) });
    html += `<section class="print-person${i ? ' print-new-page' : ''}">`;
    html += `<h1>Schengen Guard — trip history</h1><h2>${escapeHtml(p.name)}</h2><p>Generated ${fmt(today)} · ${escapeHtml(standing)}</p>`;
    const list = sortedTripsFor(p.id);
    if(!list.length){
      html += `<p>${escapeHtml(i18n('printNoStays'))}</p></section>`;
      return;
    }
    html += `<table><thead><tr><th>Country</th><th>Entry</th><th>Exit</th><th>Days</th><th>Excluded days</th><th>${escapeHtml(i18n('csvSideTrips'))}</th><th>Status</th></tr></thead><tbody>`;
    for(const t of list){
      const days = Math.round((toDate(t.end) - toDate(t.start))/86400000) + 1;
      html += `<tr><td>${escapeHtml(t.label || '')}</td><td>${fmt(t.start)}</td><td>${fmt(t.end)}</td><td>${days}</td><td>${excludedDayCount(t)}</td><td>${sideTripsText(t, fmt) || '—'}</td><td>${classifyTrip(t)}</td></tr>`;
    }
    html += '</tbody></table></section>';
  });
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

function loadNotifLastFired(){
  try{
    const parsed = JSON.parse(localStorage.getItem(NOTIF_LAST_FIRED_BY_PERSON_KEY) || '{}');
    return (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : {};
  }catch(e){ return {}; }
}
function saveNotifLastFired(map){
  try{ localStorage.setItem(NOTIF_LAST_FIRED_BY_PERSON_KEY, JSON.stringify(map)); }catch(e){}
}

// Fires a local notification once per threshold per rolling window, per person: tracks
// the lowest threshold already notified for each person's current "streak" of being under
// 14 days remaining, and resets once their count climbs back above every threshold.
function checkNotifications(){
  if(!('Notification' in window) || Notification.permission !== 'granted') return;
  const thresholds = enabledThresholds();
  const lastFiredMap = loadNotifLastFired();
  for(const person of people){
    const realRemaining = realDaysLeft(person.id);
    if(realRemaining > 14){
      delete lastFiredMap[person.id];
      continue;
    }
    const lastFired = lastFiredMap[person.id] !== undefined ? Number(lastFiredMap[person.id]) : Infinity;
    for(const threshold of thresholds){
      if(realRemaining <= threshold && threshold < lastFired){
        // Same red/amber split as the Home ring, baked into the icon since the OS draws
        // the rest of the notification card and won't let the app recolour it directly.
        const icon = realRemaining <= 7 ? 'icon-192-danger.png' : 'icon-192-warn.png';
        const body = people.length > 1
          ? i18n('notifPerson', { name: person.name, days: dayCount(realRemaining) })
          : `${dayCount(realRemaining)} left of your 90-day allowance.`;
        try{
          new Notification("Schengen Guard", { body, icon, tag: `schengen-guard-${person.id}` });
        }catch(e){}
        lastFiredMap[person.id] = threshold;
        break;
      }
    }
  }
  saveNotifLastFired(lastFiredMap);
}

// --- "How is this calculated?" day-by-day breakdown (Home + Safe Trip Checker) ---

// Which trip's label (if any) accounts for a given counted day — lets the breakdown
// show "France" instead of a generic 'In Schengen' status, so it's clear at a glance
// which stay is responsible for each day.
function coveringTripLabel(list, iso){
  const trip = list.find(t => t.start <= iso && iso <= t.end && !isExcludedDay(t, iso));
  return trip ? (trip.label || '—') : 'In Schengen';
}

// `person` (optional) names whose figures these are, when several people exist.
function openBreakdown(list, windowEndISO, person){
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
  const forPerson = (people.length > 1 && person) ? i18n('breakdownFor', { name: person.name }) : '';
  summaryEl.textContent = forPerson + `Showing the 180 days ending ${fmt(windowEndISO)}. ${running} of those days count toward your 90-day limit.`
    + (agedOut > 0 ? ` ${agedOut} earlier day${agedOut === 1 ? '' : 's'} you spent in Schengen ${agedOut === 1 ? 'has' : 'have'} aged out of this window and no longer count${agedOut === 1 ? 's' : ''}.` : '');

  document.getElementById('breakdownModal').style.display = 'flex';
}

document.getElementById('homeBreakdownBtn').addEventListener('click', ()=>{
  const refISO = document.getElementById('refDate').value || todayISO();
  openBreakdown(trips, refISO, activePerson());
});
document.getElementById('editStayBreakdownBtn').addEventListener('click', ()=>{
  if(!pickStart || !pickEnd || pickEnd < pickStart) return;
  const label = document.getElementById('tripLabel').value;
  const person = checkerPeople()[0];
  if(!person) return;
  const skip = editingGroupTripIds();
  const baseline = tripsFor(person.id).filter(t => !skip.has(t.id));
  openBreakdown(baseline.concat([{ start: pickStart, end: pickEnd, label, excludedRanges: pendingExcludedRanges }]), pickEnd, person);
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
  if(allTrips.length === 0){ banner.style.display = 'none'; return; }

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
  const payload = {
    schemaVersion: SCHEMA_VERSION,
    people: people.map(p => ({ id: p.id, name: p.name, colour: p.colour })),
    trips: allTrips.map(t => {
      const out = { id: t.id, personId: t.personId, start: t.start, end: t.end, label: t.label || '', excludedRanges: t.excludedRanges || [], note: t.note || '' };
      if(t.groupId) out.groupId = t.groupId;
      return out;
    })
  };
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

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isValidRange(r){
  return r && typeof r.start === 'string' && typeof r.end === 'string' && ISO_DATE_RE.test(r.start) && ISO_DATE_RE.test(r.end) && r.start <= r.end;
}

// Validates a backup without writing anything. Returns { people, trips } (people is null for
// a pre-people file) or { error }. Every check happens here, so a bad file never half-imports.
function parseBackup(parsed){
  const notOurs = "That file doesn't look like a Schengen Guard backup.";
  const malformed = 'That backup file is malformed — no changes were made.';
  let rawTrips, rawPeople = null;
  if(Array.isArray(parsed)){
    rawTrips = parsed; // very old shape: a bare array of trips
  } else if(parsed && typeof parsed === 'object' && Array.isArray(parsed.trips) && typeof parsed.schemaVersion === 'number'){
    if(parsed.schemaVersion > SCHEMA_VERSION){
      return { error: "This backup was made with a newer version of Schengen Guard and can't be read here — update the app first." };
    }
    rawTrips = parsed.trips;
    if(parsed.schemaVersion >= 2){
      if(!Array.isArray(parsed.people)) return { error: malformed };
      rawPeople = parsed.people;
    }
  } else {
    return { error: notOurs };
  }
  if(!rawTrips.every(it => isValidRange(it) && (it.excludedRanges === undefined || (Array.isArray(it.excludedRanges) && it.excludedRanges.every(isValidRange))))){
    return { error: malformed };
  }

  let outPeople = null;
  if(rawPeople){
    const seenIds = new Set();
    outPeople = [];
    for(const it of rawPeople){
      if(!it || typeof it.id !== 'string' || !it.id || seenIds.has(it.id) || typeof it.name !== 'string') return { error: malformed };
      if(validatePersonName(it.name, null, outPeople)) return { error: malformed };
      seenIds.add(it.id);
      outPeople.push({ id: it.id, name: it.name.trim(), colour: PERSON_COLOURS.includes(it.colour) ? it.colour : nextFreeColour(outPeople) });
    }
    if(!rawTrips.every(it => seenIds.has(it.personId))) return { error: malformed };
    if(outPeople.length === 0 && rawTrips.length) return { error: malformed };
  }

  const outTrips = rawTrips.map(it => {
    const trip = {
      id: typeof it.id === 'string' && it.id ? it.id : newId(),
      personId: rawPeople ? it.personId : null,
      start: it.start, end: it.end, label: typeof it.label === 'string' ? it.label : '',
      excludedRanges: Array.isArray(it.excludedRanges) ? it.excludedRanges.map(r => ({ start: r.start, end: r.end })) : [],
      note: typeof it.note === 'string' ? it.note : ''
    };
    if(typeof it.groupId === 'string' && it.groupId) trip.groupId = it.groupId;
    return trip;
  });
  return { people: outPeople, trips: outTrips };
}

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

  const result = parseBackup(parsed);
  if(result.error){
    errEl.textContent = result.error;
    errEl.style.display = 'block';
    return;
  }
  pendingImportTrips = result.trips;
  pendingImportPeople = result.people;
  pendingImportPersonId = null;

  if(!pendingImportPeople){
    // Pre-people backup: ask once who the trips belong to (no question when there's only
    // one person), then merge/replace as before.
    if(people.length > 1){
      openImportPersonPicker();
      return;
    }
    pendingImportPersonId = people[0].id;
    if(allTrips.length === 0){
      await applyImport('merge');
      return;
    }
    document.getElementById('importMergeBtn').textContent = 'Merge with current trips';
    document.getElementById('importReplaceBtn').textContent = 'Replace current trips';
    document.getElementById('importModalMsg').textContent =
      `You have ${allTrips.length} trip${allTrips.length === 1 ? '' : 's'} saved and this backup has ${pendingImportTrips.length}. Merge them, or replace what's on this device?`;
    document.getElementById('importModal').style.display = 'flex';
    return;
  }
  // A fresh device (no trips, only the default person) just takes the backup as-is.
  if(allTrips.length === 0 && people.length === 1){
    await applyImport('replace');
    return;
  }
  document.getElementById('importMergeBtn').textContent = 'Merge with current trips';
  document.getElementById('importReplaceBtn').textContent = 'Replace current trips';
  document.getElementById('importModalMsg').textContent =
    `You have ${allTrips.length} trip${allTrips.length === 1 ? '' : 's'} saved and this backup has ${pendingImportTrips.length}. Merge them, or replace what's on this device?`;
  document.getElementById('importModal').style.display = 'flex';
});

function openImportPersonPicker(){
  document.getElementById('importPersonMsg').textContent =
    i18n('importOldFile', { trips: countOf(pendingImportTrips.length, 'trip', 'tripsWord') }) + ' ' + i18n('importWhichPerson');
  const list = document.getElementById('importPersonList');
  list.innerHTML = '';
  for(const p of people){
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-block person-pick-btn';
    btn.innerHTML = `${personDotHtml(p)}<span>${escapeHtml(p.name)}</span>`;
    btn.addEventListener('click', async ()=>{
      document.getElementById('importPersonModal').style.display = 'none';
      pendingImportPersonId = p.id;
      const existing = tripsFor(p.id).length;
      if(existing === 0){
        await applyImport('merge');
        return;
      }
      document.getElementById('importMergeBtn').textContent = i18n('importMergeIntoPerson', { name: p.name });
      document.getElementById('importReplaceBtn').textContent = i18n('importReplacePerson', { name: p.name });
      document.getElementById('importModalMsg').textContent = i18n('importPersonMsg', {
        name: p.name,
        existing: countOf(existing, 'trip', 'tripsWord'),
        incoming: countOf(pendingImportTrips.length, 'trip', 'tripsWord')
      });
      document.getElementById('importModal').style.display = 'flex';
    });
    list.appendChild(btn);
  }
  document.getElementById('importPersonModal').style.display = 'flex';
}
document.getElementById('importPersonCancelBtn').addEventListener('click', ()=>{
  clearPendingImport();
  document.getElementById('importPersonModal').style.display = 'none';
});

function clearPendingImport(){
  pendingImportTrips = null;
  pendingImportPeople = null;
  pendingImportPersonId = null;
}

function tripKey(t){ return `${t.personId}|${t.start}|${t.end}|${t.label || ''}`; }

// Works out the full set of writes first (people to add, trips to put, what to clear),
// then applies them in one transaction.
function planImport(mode){
  if(pendingImportPersonId){
    // Pre-people file: every trip goes to the chosen person.
    const incoming = pendingImportTrips.map(t => ({ ...t, personId: pendingImportPersonId }));
    const keep = mode === 'replace' ? allTrips.filter(t => t.personId !== pendingImportPersonId) : allTrips;
    return finishPlan(mode === 'replace' ? tripsFor(pendingImportPersonId).map(t => t.id) : [], [], incoming, keep, false);
  }
  if(mode === 'replace'){
    if(pendingImportPeople.length > MAX_PEOPLE) return { error: i18n('importTooManyPeopleReplace') };
    const now = Date.now();
    const newPeople = pendingImportPeople.map((p, i) => ({ ...p, createdAt: now + i }));
    return finishPlan([], newPeople, pendingImportTrips, [], true);
  }
  // Merge: match people by id, then by name (case-insensitive); anyone else is added.
  const idMap = new Map();
  const added = [];
  const now = Date.now();
  for(const fp of pendingImportPeople){
    const match = personById(fp.id) || people.find(p => p.name.toLocaleLowerCase() === fp.name.toLocaleLowerCase())
      || added.find(p => p.name.toLocaleLowerCase() === fp.name.toLocaleLowerCase());
    if(match){ idMap.set(fp.id, match.id); continue; }
    const current = people.concat(added);
    const colour = current.some(p => p.colour === fp.colour) ? nextFreeColour(current) : fp.colour;
    const person = { ...fp, colour, createdAt: now + added.length };
    added.push(person);
    idMap.set(fp.id, person.id);
  }
  if(people.length + added.length > MAX_PEOPLE) return { error: i18n('importTooManyPeople') };
  const incoming = pendingImportTrips.map(t => ({ ...t, personId: idMap.get(t.personId) }));
  return finishPlan([], added, incoming, allTrips, false);
}

function finishPlan(deleteIds, peopleToPut, incoming, keep, replaceAll){
  const seen = new Set(keep.map(tripKey));
  const takenIds = new Set(keep.map(t => t.id));
  const tripsToPut = [];
  for(const t of incoming){
    const key = tripKey(t);
    if(seen.has(key)) continue; // already on this device — skip in merge mode
    seen.add(key);
    const trip = takenIds.has(t.id) ? { ...t, id: newId() } : t;
    takenIds.add(trip.id);
    tripsToPut.push(trip);
  }
  return { deleteIds, peopleToPut, tripsToPut, replaceAll };
}

async function applyImport(mode){
  if(!pendingImportTrips) return;
  const errEl = document.getElementById('backupError');
  document.getElementById('importModal').style.display = 'none';
  const plan = planImport(mode);
  if(plan.error){
    clearPendingImport();
    errEl.textContent = plan.error;
    errEl.style.display = 'block';
    return;
  }
  try{
    await withBothStores((tripStore, peopleStore)=>{
      if(plan.replaceAll){ tripStore.clear(); peopleStore.clear(); }
      for(const id of plan.deleteIds) tripStore.delete(id);
      for(const p of plan.peopleToPut) peopleStore.put(p);
      for(const t of plan.tripsToPut) tripStore.put(t);
    });
  }catch(err){
    clearPendingImport();
    errEl.textContent = 'Could not restore that backup — no changes were made.';
    errEl.style.display = 'block';
    return;
  }
  clearPendingImport();
  await ensurePeople(); // re-reads people, keeps the active person if they still exist
  selectedPersonIds = new Set([activePersonId]);
  await loadTrips();
  render();
}

document.getElementById('importMergeBtn').addEventListener('click', ()=> applyImport('merge'));
document.getElementById('importReplaceBtn').addEventListener('click', ()=> applyImport('replace'));
document.getElementById('importCancelBtn').addEventListener('click', ()=>{
  clearPendingImport();
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

  applyStaticStrings();
  await ensurePeople();
  selectedPersonIds = new Set([activePersonId]);
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
