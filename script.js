const SUPABASE_URL = 'https://dwjftvqlynlefwruvwfs.supabase.co';
const SUPABASE_KEY = 'sb_publishable_JPZoPe7suyMtyV-EEEqD8Q_ksgb0Q9o';
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000; // auto sign-out after 1 day of not opening the app
const LAST_ACTIVE_KEY = 'schengenBuddyLastActive';
const NOTIF_PREFS_KEY = 'schengenBuddyNotifThresholds';
const NOTIF_LAST_FIRED_KEY = 'schengenBuddyNotifLastFired';
const RING_RADIUS = 99;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

const ALL_COUNTRIES = [
  'Austria','Belgium','Bulgaria','Croatia','Czechia','Denmark','Estonia','Finland','France',
  'Germany','Greece','Hungary','Iceland','Italy','Latvia','Liechtenstein','Lithuania',
  'Luxembourg','Malta','Netherlands','Norway','Poland','Portugal','Romania','Slovakia',
  'Slovenia','Spain','Sweden','Switzerland'
];

let currentUser = null;
let trips = []; // {id, start:'YYYY-MM-DD', end:'YYYY-MM-DD', label}
let calCursor = new Date(); calCursor.setDate(1);
let pickStart = null, pickEnd = null;
let editingTripId = null;

function todayISO(){
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
}
function toDate(iso){ const [y,m,d]=iso.split('-').map(Number); return new Date(y,m-1,d); }
function addDays(d,n){ const r=new Date(d); r.setDate(r.getDate()+n); return r; }
function isoOf(d){ return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); }
function fmt(iso){ const d=toDate(iso); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}); }
function fmtShort(iso){ const d=toDate(iso); const day=d.toLocaleDateString('en-GB',{day:'2-digit'}); const mon=d.toLocaleDateString('en-GB',{month:'short'}); return `${day} ${mon}`; }

// Build set of ISO date strings covered by trips (inclusive), split into past/active vs planned
function coveredDates(list){
  const set = new Set();
  for(const t of list){
    let cur = toDate(t.start);
    const end = toDate(t.end);
    while(cur <= end){
      set.add(isoOf(cur));
      cur = addDays(cur,1);
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

function classifyTrip(t){
  const today = todayISO();
  if(t.end < today) return 'past';
  if(t.start <= today && today <= t.end) return 'active';
  return 'planned';
}

// Load this user's trips from Supabase, mapping DB rows to the shape the rest of the app expects
async function loadTrips(){
  if(!currentUser){ trips = []; return; }
  try{
    const { data, error } = await db.from('trips').select('*').order('start_date');
    if(error) throw error;
    trips = (data || []).map(row => ({ id: row.id, start: row.start_date, end: row.end_date, label: row.country }));
  }catch(e){
    trips = [];
  }
}

// Insert one trip into Supabase, then reload so ids/ordering stay in sync with the database
async function insertTrip(start, end, label){
  const { error } = await db.from('trips').insert([{ start_date: start, end_date: end, country: label }]);
  if(error) throw error;
  await loadTrips();
}

// Update one existing trip's dates/country, then reload so the rest of the app sees the change
async function updateTrip(id, start, end, label){
  const { error } = await db.from('trips').update({ start_date: start, end_date: end, country: label }).eq('id', id);
  if(error) throw error;
  await loadTrips();
}

// Delete one trip by its database id
async function deleteTrip(id){
  const { error } = await db.from('trips').delete().eq('id', id);
  if(error) throw error;
  await loadTrips();
}

// Delete every trip belonging to the current user
async function deleteAllTrips(){
  if(!currentUser) return;
  const { error } = await db.from('trips').delete().eq('user_id', currentUser.id);
  if(error) throw error;
  trips = [];
}

function showSignedIn(){
  localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now()));
  document.getElementById('authPanel').style.display = 'none';
  document.getElementById('appBody').style.display = 'block';
  document.getElementById('tabbar').style.display = 'flex';
  document.getElementById('signedInAs').textContent = 'Signed in as ' + currentUser.email;
}

function showSignedOut(){
  localStorage.removeItem(LAST_ACTIVE_KEY);
  document.getElementById('authPanel').style.display = 'block';
  document.getElementById('appBody').style.display = 'none';
  document.getElementById('tabbar').style.display = 'none';
  clearAppBadge();
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
document.getElementById('countriesBackBtn').addEventListener('click', ()=> switchTab('home'));
document.getElementById('addTripShortcutBtn').addEventListener('click', ()=>{
  document.getElementById('checkerEntry').focus();
});

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
    kickerEl.textContent = 'Days over limit';
    titleEl.textContent = `+${overBy}`;
    bodyEl.textContent = `${overBy} day${overBy===1?'':'s'} over the limit as of ${fmt(refISO)}.`;
    const free = nextFreeDate(trips, 90);
    if(free) bodyEl.textContent += ` Compliant again from ${fmt(free)}.`;
  } else if(exitISO === null){
    kickerEl.textContent = 'Status';
    titleEl.textContent = 'N/A';
    bodyEl.textContent = `Already over the limit on ${fmt(entryForCalc)} — no compliant stay possible from that entry date.`;
  } else {
    kickerEl.textContent = 'Last day to leave';
    titleEl.textContent = fmt(exitISO);
    const whose = coveringTrip ? 'This stay' : `A stay entering ${fmt(refISO)}`;
    bodyEl.textContent = `${used} of 90 days used in the 180 days ending ${fmt(refISO)}. ${whose} must end by ${fmt(exitISO)} at the latest.`;
  }

  renderTripRows();
  renderNextTrip();
  renderCountriesCard();
  renderCalendar();
  updateChecker();
  updateAppBadge();
  checkNotifications();
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
  document.getElementById('nextTripCountry').textContent = trip.label || '—';
  document.getElementById('nextTripDates').textContent = `${fmt(trip.start)} → ${fmt(trip.end)} · ${days} day${days===1?'':'s'}`;

  const tagEl = document.getElementById('nextTripTag');
  const overstay = tripOverstayInfo(trips, trip, 90);
  if(overstay){
    tagEl.textContent = 'Overstay risk';
    tagEl.className = 'tag tag-accent-2';
  } else {
    tagEl.textContent = 'Within limits';
    tagEl.className = 'tag tag-accent';
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
    rowsEl.innerHTML = '<div class="empty-note">No stays logged yet.</div>';
    return;
  }
  trips.sort((a,b)=> a.start < b.start ? -1 : a.start > b.start ? 1 : 0);
  for(const t of trips){
    const days = Math.round((toDate(t.end) - toDate(t.start))/86400000) + 1;
    const status = classifyTrip(t);
    const overstay = tripOverstayInfo(trips, t, 90);
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

    const row = document.createElement('div');
    row.className = 'card elev-sm trip-row';
    row.innerHTML = `
      <div class="trip-days"><div class="n">${days}</div><div class="lbl">days</div></div>
      <div class="trip-info">
        <div class="country">${t.label || '—'}${warnIcon}</div>
        <div class="dates">${fmt(t.start)} – ${fmt(t.end)}</div>
        <div class="row-actions">
          <button type="button" class="link-btn" data-action="edit" data-id="${t.id}">Edit</button>
          <button type="button" class="link-btn danger-link" data-action="remove" data-id="${t.id}">Remove</button>
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
  const start = document.getElementById('checkerEntry').value;
  const end = document.getElementById('checkerExit').value;
  errEl.style.display = 'none';

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
  const hypothetical = trips.concat([{ start, end, label: '__checker__' }]);
  const overstay = tripOverstayInfo(hypothetical, { start, end }, 90);
  if(overstay){
    msgEl.innerHTML = `${days}-day stay — <strong style="color:var(--color-accent-2-700)">would breach your limit</strong> on ${fmt(overstay.date)} (${overstay.used} of 90 used).`;
  } else {
    const margin = 90 - usedDaysInWindow(hypothetical, end);
    msgEl.innerHTML = `${days}-day stay — <strong style="color:var(--color-accent-700)">safe, within limits</strong>. ${margin} day${margin===1?'':'s'} of margin left on ${fmt(end)}.`;
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

  const overlapping = trips.find(t => start <= t.end && end >= t.start);
  if(overlapping){
    const proceed = confirm(`This overlaps with your logged stay in ${overlapping.label} (${fmt(overlapping.start)} – ${fmt(overlapping.end)}). Save it anyway?`);
    if(!proceed) return;
  }
  try{
    await insertTrip(start, end, label);
  }catch(e){
    errEl.textContent = 'Could not save that stay — please try again.';
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
  document.getElementById('tripLabel').value = trip.label;
  document.getElementById('tripStart').value = trip.start;
  document.getElementById('tripEnd').value = trip.end;
  document.getElementById('pickStartLbl').textContent = 'Entry: ' + fmt(trip.start);
  document.getElementById('pickEndLbl').textContent = 'Exit: ' + fmt(trip.end);
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = 'Update stay';
  document.getElementById('cancelEditBtn').style.display = 'block';
  document.getElementById('calendarHeading').textContent = 'Edit stay';

  calCursor = new Date(toDate(trip.start)); calCursor.setDate(1);
  switchTab('calendar');
  renderCalendar();
}

function stopEditTrip(){
  editingTripId = null;
  pickStart = null; pickEnd = null;
  document.getElementById('tripLabel').value = '';
  document.getElementById('tripStart').value = '';
  document.getElementById('tripEnd').value = '';
  document.getElementById('pickStartLbl').textContent = 'Entry: —';
  document.getElementById('pickEndLbl').textContent = 'Exit: —';
  document.getElementById('formError').style.display = 'none';
  document.getElementById('addTripBtn').textContent = 'Log stay';
  document.getElementById('cancelEditBtn').style.display = 'none';
  document.getElementById('calendarHeading').textContent = 'Log a stay';
  renderCalendar();
}

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
  } else {
    if(iso >= pickStart) pickEnd = iso;
    else { pickEnd = pickStart; pickStart = iso; }
  }
  document.getElementById('tripStart').value = pickStart || '';
  document.getElementById('tripEnd').value = pickEnd || '';
  document.getElementById('pickStartLbl').textContent = 'Entry: ' + (pickStart ? fmt(pickStart) : '—');
  document.getElementById('pickEndLbl').textContent = 'Exit: ' + (pickEnd ? fmt(pickEnd) : '—');
  renderCalendar();
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
  const overlapping = trips.find(t => t.id !== editingTripId && start <= t.end && end >= t.start);
  if(overlapping){
    const verb = editingTripId ? 'Update it anyway?' : 'Log it anyway?';
    const proceed = confirm(`This overlaps with your logged stay in ${overlapping.label} (${fmt(overlapping.start)} – ${fmt(overlapping.end)}). ${verb}`);
    if(!proceed) return;
  }
  const wasEditing = editingTripId !== null;
  try{
    if(wasEditing){
      await updateTrip(editingTripId, start, end, label);
    } else {
      await insertTrip(start, end, label);
    }
  }catch(e){
    errEl.textContent = 'Could not save that stay — please try again.';
    errEl.style.display = 'block';
    return;
  }
  stopEditTrip();
  render();
  if(wasEditing) switchTab('trips');
});

document.getElementById('refDate').addEventListener('change', render);

document.getElementById('resetBtn').addEventListener('click', async ()=>{
  if(!confirm('Clear all logged stays? This cannot be undone.')) return;
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
        new Notification('Schengen Buddy', {
          body: `${realRemaining} day${realRemaining===1?'':'s'} left of your 90-day allowance.`
        });
      }catch(e){}
      localStorage.setItem(NOTIF_LAST_FIRED_KEY, String(threshold));
      break;
    }
  }
}

// --- Authentication ---

document.getElementById('signUpBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  if(!email || password.length < 6){
    errEl.textContent = 'Enter an email and a password of at least 6 characters.';
    errEl.style.display = 'block';
    return;
  }
  const { data, error } = await db.auth.signUp({ email, password });
  if(error){
    errEl.textContent = error.message;
    errEl.style.display = 'block';
    return;
  }
  if(data.user){
    currentUser = data.user;
    await loadTrips();
    showSignedIn();
    render();
  }
});

document.getElementById('signInBtn').addEventListener('click', async ()=>{
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  const errEl = document.getElementById('authError');
  errEl.style.display = 'none';
  const { data, error } = await db.auth.signInWithPassword({ email, password });
  if(error){
    errEl.textContent = error.message;
    errEl.style.display = 'block';
    return;
  }
  currentUser = data.user;
  await loadTrips();
  showSignedIn();
  render();
});

document.getElementById('signOutBtn').addEventListener('click', async ()=>{
  await db.auth.signOut();
  currentUser = null;
  trips = [];
  document.getElementById('authEmail').value = '';
  document.getElementById('authPassword').value = '';
  document.getElementById('authError').style.display = 'none';
  showSignedOut();
});

// --- Theme ---
const THEME_KEY = 'schengenBuddyTheme';
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
  if(currentUser) render();
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible') checkDayRollover();
});
setInterval(checkDayRollover, 60 * 60 * 1000);

(async function init(){
  applyTheme(localStorage.getItem(THEME_KEY) || 'system');
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

  const { data: { session } } = await db.auth.getSession();
  if(session && session.user){
    const lastActive = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
    const inactiveFor = Date.now() - lastActive;
    if(lastActive && inactiveFor > INACTIVITY_LIMIT_MS){
      await db.auth.signOut();
      showSignedOut();
      return;
    }
    currentUser = session.user;
    await loadTrips();
    showSignedIn();
    render();
  } else {
    showSignedOut();
  }
})();

if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
