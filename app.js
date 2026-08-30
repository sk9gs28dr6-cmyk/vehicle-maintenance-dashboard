/* ---------------------------------------------------------
   Garage — Vehicle Maintenance Dashboard
   Mobile-first redesign. Data lives in localStorage, mirrored
   best-effort to data.json on disk (via the local server) so the
   scheduled PowerShell script can send email reminders. OCR runs
   entirely client-side via Tesseract.js — nothing leaves the browser.
--------------------------------------------------------- */

const LS_KEY = 'vmd_state_v2';

const DEFAULT_INTERVALS = {
  'Oil Change':              { miles: 5000,  months: 6,  glyph: '◉' },
  'Tire Rotation':           { miles: 6000,  months: 6,  glyph: '◐' },
  'Air Filter':              { miles: 15000, months: 12, glyph: '◪' },
  'Cabin Air Filter':        { miles: 15000, months: 12, glyph: '◫' },
  'Brake Inspection':        { miles: 12000, months: 12, glyph: '◒' },
  'Brake Pads':              { miles: 40000, months: null, glyph: '●' },
  'Battery':                 { miles: null,  months: 48, glyph: '▮' },
  'Coolant Flush':           { miles: 30000, months: 24, glyph: '◇' },
  'Transmission Fluid':      { miles: 45000, months: null, glyph: '◈' },
  'Spark Plugs':             { miles: 30000, months: null, glyph: '✳' },
  'Wiper Blades':            { miles: null,  months: 12, glyph: '◜' },
  'Alignment':               { miles: 12000, months: 12, glyph: '◧' },
  'Inspection / Registration': { miles: null, months: 12, glyph: '☑' },
  'Tire Replacement':        { miles: 50000, months: null, glyph: '◍' },
};

const SERVICE_KEYWORDS = {
  'Oil Change': ['oil change', 'oil filter', 'synthetic oil', 'oil & filter', 'oil and filter', 'lube service', 'lof '],
  'Tire Rotation': ['tire rotation', 'rotate tires', 'tires rotated'],
  'Air Filter': ['engine air filter', 'air filter'],
  'Cabin Air Filter': ['cabin air filter', 'cabin filter'],
  'Brake Inspection': ['brake inspection', 'brake check', 'inspect brakes'],
  'Brake Pads': ['brake pad', 'brake pads', 'brake service', 'brake replacement', 'front brakes', 'rear brakes'],
  'Battery': ['battery replacement', 'battery test', 'battery'],
  'Coolant Flush': ['coolant flush', 'coolant', 'antifreeze', 'radiator flush'],
  'Transmission Fluid': ['transmission fluid', 'transmission service', 'trans flush'],
  'Spark Plugs': ['spark plug'],
  'Wiper Blades': ['wiper blade', 'wipers'],
  'Alignment': ['wheel alignment', 'alignment'],
  'Inspection / Registration': ['state inspection', 'emissions test', 'registration', 'safety inspection'],
  'Tire Replacement': ['new tires', 'tire replacement', 'tires installed', 'tire install'],
};

const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const OVER = { tileBg: 'var(--danger-tint)', tileFg: 'var(--danger)', pillBg: 'var(--danger-tint)', pillFg: 'var(--danger)', dot: 'var(--danger)' };
const SOON = { tileBg: 'var(--warn-tint)',   tileFg: 'var(--warn)',   pillBg: 'var(--warn-tint)',   pillFg: 'var(--warn)',   dot: 'var(--warn)' };
const OK   = { tileBg: 'var(--rule)',        tileFg: 'var(--text-dim)', pillBg: 'var(--rule)',      pillFg: 'var(--text-dim)', dot: 'var(--ok-dot)' };

function uid() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
function fmt(n) { return Math.round(n).toLocaleString('en-US'); }
function money0(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
function money2(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function parseD(s) { const p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function shortD(s) { const d = parseD(s); return MON[d.getMonth()] + ' ' + d.getFullYear(); }
function escapeHtml(s) { const div = document.createElement('div'); div.textContent = s; return div.innerHTML; }
function todayISO() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }

// ---------------- state ----------------
function defaultState() {
  return {
    vehicles: [],
    activeVehicleId: null,
    records: [],
    odometers: {},
    intervals: stripGlyphs(structuredClone(DEFAULT_INTERVALS)),
    settings: { emailTo: '', emailEnabled: false, pushEnabled: false },
  };
}
function stripGlyphs(intervals) {
  // glyphs are a presentation concern, not persisted with user-edited intervals
  const out = {};
  for (const [k, v] of Object.entries(intervals)) out[k] = { miles: v.miles, months: v.months };
  return out;
}
function glyphFor(name) { return (DEFAULT_INTERVALS[name] && DEFAULT_INTERVALS[name].glyph) || '•'; }

function migrateLegacy(state) {
  const oldRecords = JSON.parse(localStorage.getItem('vmd_records') || 'null');
  const oldIntervals = JSON.parse(localStorage.getItem('vmd_intervals') || 'null');
  const oldOdo = Number(localStorage.getItem('vmd_currentOdo')) || 0;
  const oldName = localStorage.getItem('vmd_vehicleName');
  if (!oldRecords && !oldName) return state;

  const vehicleId = uid();
  state.vehicles.push({ id: vehicleId, name: oldName || 'My Vehicle', make: '', model: '', year: '' });
  state.activeVehicleId = vehicleId;
  if (oldRecords) state.records = oldRecords.map(r => ({ ...r, vehicleId }));
  if (oldOdo) state.odometers[vehicleId] = oldOdo;
  if (oldIntervals) state.intervals = oldIntervals;

  ['vmd_records', 'vmd_intervals', 'vmd_currentOdo', 'vmd_vehicleName'].forEach(k => localStorage.removeItem(k));
  return state;
}

let STATE = loadState();

function loadState() {
  let s, migrated = false;
  try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch { s = null; }
  if (!s) { s = migrateLegacy(defaultState()); migrated = true; }
  if (!s.vehicles) s.vehicles = [];
  if (!s.records) s.records = [];
  if (!s.odometers) s.odometers = {};
  if (!s.intervals) s.intervals = stripGlyphs(structuredClone(DEFAULT_INTERVALS));
  if (!s.settings) s.settings = { emailTo: '', emailEnabled: false, pushEnabled: false };
  if (s.settings.emailEnabled === undefined) s.settings.emailEnabled = !!s.settings.emailTo;
  if (s.settings.pushEnabled === undefined) s.settings.pushEnabled = false;
  if (!s.activeVehicleId && s.vehicles.length) s.activeVehicleId = s.vehicles[0].id;
  if (migrated) persistRaw(s);
  return s;
}
function persistRaw(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
  fetch('/api/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) }).catch(() => {});
}
function persist() { persistRaw(STATE); }

async function hydrateFromServerIfEmpty() {
  if (STATE.vehicles.length) return;
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.vehicles && data.vehicles.length) { STATE = data; localStorage.setItem(LS_KEY, JSON.stringify(STATE)); }
  } catch {}
}

function activeVehicle() { return STATE.vehicles.find(v => v.id === STATE.activeVehicleId) || null; }
function vehicleSub(v) { return [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle'; }

// ---------------- business logic (mirrors the design's data model) ----------------
function lastByType(vehicleId) {
  const out = {};
  for (const r of STATE.records) {
    if (r.vehicleId !== vehicleId) continue;
    for (const service of r.services) {
      if (!out[service] || r.date > out[service].date || (r.date === out[service].date && r.mileage > out[service].mileage)) {
        out[service] = r;
      }
    }
  }
  return out;
}

function computeServices(vehicle) {
  const odo = STATE.odometers[vehicle.id] || 0;
  const last = lastByType(vehicle.id);
  const out = [];
  for (const [name, iv] of Object.entries(STATE.intervals)) {
    if (iv.miles == null && iv.months == null) continue;
    const l = last[name];
    if (!l) continue; // only show services that have at least one logged record
    let kind, delta, everyLabel, lastLabel, targetLabel, nextAt, detail;
    if (iv.miles != null) {
      kind = 'mi';
      const target = l.mileage + iv.miles;
      delta = target - odo;
      everyLabel = 'Every ' + fmt(iv.miles) + ' mi';
      lastLabel = fmt(l.mileage) + ' mi';
      targetLabel = 'At ' + fmt(target) + ' mi · every ' + fmt(iv.miles) + ' mi';
      nextAt = fmt(target) + ' mi';
      detail = delta < 0 ? fmt(-delta) + ' mi past due' : 'In ' + fmt(delta) + ' mi';
    } else {
      kind = 'mo';
      const d = parseD(l.date);
      const now = new Date();
      const ml = (d.getFullYear() * 12 + d.getMonth() + iv.months) - (now.getFullYear() * 12 + now.getMonth());
      delta = ml * 400;
      everyLabel = 'Every ' + iv.months + ' months';
      lastLabel = shortD(l.date);
      const targetStr = MON[d.getMonth()] + ' ' + (d.getFullYear() + Math.round(iv.months / 12));
      targetLabel = 'By ' + targetStr + ' · every ' + iv.months + ' mo';
      nextAt = targetStr;
      detail = ml < 0 ? Math.abs(ml) + ' months past due' : 'In ' + ml + ' month' + (ml === 1 ? '' : 's');
    }
    const status = delta < 0 ? 'over' : (kind === 'mi' ? delta <= 1000 : delta <= 800) ? 'soon' : 'ok';
    const c = status === 'over' ? OVER : status === 'soon' ? SOON : OK;
    let pill = status === 'over' ? 'Overdue' : status === 'ok' ? 'OK' : (kind === 'mi' ? fmt(delta) + ' mi' : Math.round(delta / 400) + ' mo');
    out.push({ name, glyph: glyphFor(name), status, delta, kind, everyLabel, lastLabel, targetLabel, nextAt, detail, pill, ...c, record: l });
  }
  const rank = { over: 0, soon: 1, ok: 2 };
  out.sort((a, b) => rank[a.status] - rank[b.status] || a.delta - b.delta);
  return out;
}

function computeCosts(vehicle) {
  const rs = STATE.records.filter(r => r.vehicleId === vehicle.id);
  const total = rs.reduce((s, r) => s + (r.cost || 0), 0);
  const cutoff = new Date(); cutoff.setFullYear(cutoff.getFullYear() - 1);
  const yr = rs.filter(r => parseD(r.date) >= cutoff).reduce((s, r) => s + (r.cost || 0), 0);
  const mis = rs.map(r => r.mileage);
  const odo = STATE.odometers[vehicle.id] || 0;
  const span = mis.length ? Math.max(odo - Math.min(...mis), 1) : 1;
  return { total, totalLabel: money0(total), year: money0(yr), perMile: money2(total / span), perMileLabel: 'Per mi over ' + fmt(span), n: rs.length };
}

function recTitle(r) { return r.services.join(', '); }

// ---------------- OCR parsing helpers ----------------
function parseDateFromText(text) {
  const patterns = [
    { re: /\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/, order: 'ymd' },
    { re: /\b(\d{1,2})[-\/](\d{1,2})[-\/](20\d{2})\b/, order: 'mdy' },
    { re: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i, order: 'month-name' },
  ];
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  for (const p of patterns) {
    const m = text.match(p.re);
    if (!m) continue;
    let y, mo, d;
    if (p.order === 'ymd') { y = +m[1]; mo = +m[2]; d = +m[3]; }
    else if (p.order === 'mdy') { mo = +m[1]; d = +m[2]; y = +m[3]; }
    else { mo = months[m[1].slice(0,3).toLowerCase()]; d = +m[2]; y = +m[3]; }
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  return '';
}
function parseMileageFromText(text) {
  const contextRe = /(?:mileage|odometer|miles?\b|mi\.?\b)[:\s]*([\d,]{3,7})/i;
  let m = text.match(contextRe);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  const trailRe = /\b([\d,]{4,7})\s*(?:mi\.?|miles)\b/i;
  m = text.match(trailRe);
  if (m) return parseInt(m[1].replace(/,/g, ''), 10);
  return null;
}
function parseCostFromText(text) {
  const matches = [...text.matchAll(/\$\s?([\d,]+\.\d{2})/g)].map(m => parseFloat(m[1].replace(/,/g, '')));
  if (!matches.length) return null;
  return Math.max(...matches);
}
function detectServicesFromText(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const [service, keywords] of Object.entries(SERVICE_KEYWORDS)) {
    if (keywords.some(k => lower.includes(k))) found.push(service);
  }
  return found;
}

// ================= NAVIGATION =================
let currentScreen = 'garage';
function showScreen(name) {
  currentScreen = name;
  document.querySelectorAll('.screen').forEach(el => el.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.tab-item').forEach(el => el.classList.toggle('on', el.dataset.tab === name));
  document.querySelector('.screens').scrollTop = 0;
  renderCurrentScreen();
}
function renderCurrentScreen() {
  if (currentScreen === 'garage') renderGarage();
  else if (currentScreen === 'dashboard') renderDashboard();
  else if (currentScreen === 'due') renderDue();
  else if (currentScreen === 'records') renderRecords();
  else if (currentScreen === 'settings') renderSettings();
  renderTabBadge();
}
document.querySelectorAll('.tab-item[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.tab));
});

function renderTabBadge() {
  let total = 0;
  for (const v of STATE.vehicles) total += computeServices(v).filter(s => s.status !== 'ok').length;
  const badge = document.getElementById('tabDueBadge');
  badge.textContent = total;
  badge.hidden = total === 0;
}

// ================= VEHICLE CHIPS (shared across dashboard/due/records) =================
function renderChips(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '';
  for (const v of STATE.vehicles) {
    const pill = document.createElement('div');
    pill.className = 'pill' + (v.id === STATE.activeVehicleId ? ' on' : '');
    pill.textContent = v.name;
    pill.addEventListener('click', () => { STATE.activeVehicleId = v.id; persist(); renderCurrentScreen(); });
    el.appendChild(pill);
  }
}

// ================= GARAGE SCREEN =================
function renderGarage() {
  document.getElementById('garageSub').textContent = STATE.vehicles.length + ' vehicle' + (STATE.vehicles.length === 1 ? '' : 's') + ' · ' + STATE.records.length + ' record' + (STATE.records.length === 1 ? '' : 's');
  const container = document.getElementById('garageCards');
  container.innerHTML = '';
  document.getElementById('garageEmpty').hidden = STATE.vehicles.length !== 0;
  for (const v of STATE.vehicles) {
    const svcs = computeServices(v);
    const over = svcs.filter(s => s.status === 'over').length;
    const soon = svcs.filter(s => s.status === 'soon').length;
    const c = over ? OVER : soon ? SOON : OK;
    const worst = svcs[0];
    const card = document.createElement('div');
    card.className = 'card veh-card';
    card.innerHTML = `
      <div class="veh-card-top">
        <div><div class="veh-name">${escapeHtml(v.name)}</div><div class="veh-sub">${escapeHtml(vehicleSub(v))}</div></div>
        <div><div class="veh-odo">${fmt(STATE.odometers[v.id] || 0)}</div><div class="veh-unit">mi</div></div>
      </div>
      <div class="veh-rule"></div>
      <div class="veh-status-row">
        <div style="display:flex;gap:10px;align-items:center">
          <span class="dot" style="background:${c.dot}"></span>
          <span class="veh-headline">${over ? over + ' overdue' : soon ? soon + ' due soon' : 'All up to date'}</span>
        </div>
        <span class="veh-tail">${worst ? escapeHtml(worst.name + ' · ' + worst.detail) : ''}</span>
      </div>
    `;
    card.addEventListener('click', () => { STATE.activeVehicleId = v.id; persist(); showScreen('dashboard'); });
    container.appendChild(card);
  }
}
document.getElementById('addVehicleFromGarage').addEventListener('click', () => openVehicleModal());

// ================= DASHBOARD SCREEN =================
function renderDashboard() {
  const v = activeVehicle();
  if (!v) { showScreen('garage'); return; }
  document.getElementById('dashVehName').textContent = v.name;
  document.getElementById('dashVehSub').textContent = vehicleSub(v);
  renderChips('dashChips');

  document.getElementById('odoView').hidden = false;
  document.getElementById('odoEditBox').hidden = true;
  const odo = STATE.odometers[v.id] || 0;
  document.getElementById('odoValue').textContent = fmt(odo);
  document.getElementById('odoUpdated').textContent = 'Updated ' + (v.updated || 'just now');

  const svcs = computeServices(v);
  const cost = computeCosts(v);
  const over = svcs.filter(s => s.status === 'over').length;
  const soon = svcs.filter(s => s.status === 'soon').length;
  document.getElementById('statOverdueNum').textContent = over;
  document.getElementById('statSoonNum').textContent = soon;
  document.getElementById('statCost').hidden = cost.n === 0;
  document.getElementById('statCostNum').textContent = cost.year;

  const top = svcs.slice(0, 4);
  const list = document.getElementById('dashTopServices');
  list.innerHTML = '';
  document.getElementById('dashEmpty').hidden = top.length !== 0;
  for (const s of top) list.appendChild(serviceRowEl(s));

  document.getElementById('costCard').hidden = cost.n === 0;
  document.getElementById('costPerMile').textContent = cost.perMile;
  document.getElementById('costPerMileLabel').textContent = cost.perMileLabel;
  document.getElementById('costTotal2').textContent = cost.totalLabel;
}
function serviceRowEl(s) {
  const row = document.createElement('div');
  row.className = 'card-flat svc-row';
  row.innerHTML = `
    <div class="svc-tile" style="background:${s.tileBg};color:${s.tileFg}">${s.glyph}</div>
    <div style="flex:1;min-width:0"><div class="svc-name">${escapeHtml(s.name)}</div><div class="svc-detail">${escapeHtml(s.detail)}</div></div>
    <div class="svc-pill" style="background:${s.pillBg};color:${s.pillFg}">${escapeHtml(s.pill)}</div>
  `;
  row.addEventListener('click', () => openServiceSheet(s.name));
  return row;
}
document.getElementById('dashToGarage').addEventListener('click', () => showScreen('garage'));
document.getElementById('dashEdit').addEventListener('click', () => openVehicleModal(STATE.activeVehicleId));
document.getElementById('dashSeeAll').addEventListener('click', () => showScreen('due'));
document.getElementById('statOverdue').addEventListener('click', () => showScreen('due'));
document.getElementById('statSoon').addEventListener('click', () => showScreen('due'));
document.getElementById('statCost').addEventListener('click', () => showScreen('records'));

// odometer edit
document.getElementById('openOdo').addEventListener('click', () => {
  document.getElementById('odoView').hidden = true;
  document.getElementById('odoEditBox').hidden = false;
  const v = activeVehicle();
  document.getElementById('odoDraftInput').value = '';
  document.getElementById('odoDraftInput').placeholder = fmt(STATE.odometers[v.id] || 0);
  document.getElementById('odoDraftInput').focus();
});
document.getElementById('cancelOdo').addEventListener('click', () => { document.getElementById('odoView').hidden = false; document.getElementById('odoEditBox').hidden = true; });
document.getElementById('saveOdo').addEventListener('click', () => {
  const v = activeVehicle();
  const n = parseInt(String(document.getElementById('odoDraftInput').value).replace(/\D/g, ''), 10);
  if (!n) { document.getElementById('odoView').hidden = false; document.getElementById('odoEditBox').hidden = true; return; }
  STATE.odometers[v.id] = n;
  v.updated = 'just now';
  persist();
  renderDashboard(); renderGarage();
});
document.getElementById('scanOdoBtn').addEventListener('click', () => document.getElementById('odoScanInput').click());
document.getElementById('odoScanInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('odoDraftInput').placeholder = 'Reading…';
  try {
    const result = await Tesseract.recognize(file, 'eng');
    const mi = parseMileageFromText(result.data.text || '');
    if (mi) document.getElementById('odoDraftInput').value = mi;
    else alert('Could not read a mileage number from that photo — enter it manually.');
  } catch { alert('Scan failed — enter the mileage manually.'); }
  document.getElementById('odoDraftInput').placeholder = fmt(STATE.odometers[activeVehicle().id] || 0);
  e.target.value = '';
});

// ================= DUE SCREEN =================
function renderDue() {
  const v = activeVehicle();
  if (!v) { showScreen('garage'); return; }
  document.getElementById('dueSub').textContent = v.name + ' · ' + fmt(STATE.odometers[v.id] || 0) + ' mi';
  renderChips('dueChips');

  const svcs = computeServices(v);
  const groups = [
    { label: 'Overdue now', dot: OVER.dot, items: svcs.filter(s => s.status === 'over') },
    { label: 'Coming up', dot: SOON.dot, items: svcs.filter(s => s.status === 'soon') },
    { label: 'On schedule', dot: OK.dot, items: svcs.filter(s => s.status === 'ok') },
  ].filter(g => g.items.length);

  const container = document.getElementById('dueGroups');
  container.innerHTML = '';
  document.getElementById('dueEmpty').hidden = groups.length !== 0;
  for (const g of groups) {
    const block = document.createElement('div');
    block.className = 'due-group';
    block.innerHTML = `<div class="due-group-head"><span class="dot" style="background:${g.dot}"></span><span class="due-group-label">${g.label}</span></div>`;
    const items = document.createElement('div');
    items.className = 'due-group-items';
    for (const s of g.items) {
      const row = document.createElement('div');
      row.className = 'due-row';
      row.innerHTML = `<div style="flex:1;min-width:0"><div class="svc-name">${escapeHtml(s.name)}</div><div class="due-target">${escapeHtml(s.targetLabel)}</div></div><div style="font:600 12.5px 'DM Sans';white-space:nowrap;color:${s.pillFg}">${escapeHtml(s.pill)}</div>`;
      row.addEventListener('click', () => openServiceSheet(s.name));
      items.appendChild(row);
    }
    block.appendChild(items);
    container.appendChild(block);
  }

  const total = svcs.filter(s => s.status !== 'ok').length;
  const line = document.getElementById('reminderLine');
  if (STATE.settings.pushEnabled) line.textContent = 'Push reminders on for ' + total + ' upcoming item' + (total === 1 ? '' : 's');
  else if (STATE.settings.emailEnabled) line.textContent = 'Email reminders on for ' + total + ' upcoming item' + (total === 1 ? '' : 's');
  else line.textContent = 'Reminders are off';
}
document.getElementById('dueEdit').addEventListener('click', () => showScreen('settings'));

// ================= RECORDS SCREEN =================
function renderRecords() {
  const v = activeVehicle();
  if (!v) { showScreen('garage'); return; }
  const cost = computeCosts(v);
  document.getElementById('recordsSub').textContent = cost.n + ' record' + (cost.n === 1 ? '' : 's') + ' for ' + v.name;
  renderChips('recordsChips');

  document.getElementById('recCostCard').hidden = cost.n === 0;
  document.getElementById('recCostTotal').textContent = cost.totalLabel;
  document.getElementById('recCostYear').textContent = cost.year;
  document.getElementById('recCostPerMile').textContent = cost.perMile;
  document.getElementById('recCostPerMileLabel').textContent = cost.perMileLabel;

  const recs = STATE.records.filter(r => r.vehicleId === v.id).slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const years = [];
  for (const r of recs) {
    const y = r.date.slice(0, 4);
    let g = years.find(x => x.year === y);
    if (!g) { g = { year: y, items: [], sum: 0 }; years.push(g); }
    g.sum += (r.cost || 0);
    g.items.push(r);
  }
  const container = document.getElementById('recordYears');
  container.innerHTML = '';
  document.getElementById('recordsEmpty').hidden = recs.length !== 0;
  for (const g of years) {
    const block = document.createElement('div');
    block.className = 'year-block';
    block.innerHTML = `<div class="year-head"><div class="eyebrow">${g.year}</div><div style="font:500 11.5px 'DM Sans';color:var(--text-faint)">${money0(g.sum)}</div></div>`;
    const card = document.createElement('div');
    card.className = 'card';
    card.style.overflow = 'hidden';
    for (const r of g.items) {
      const d = parseD(r.date);
      const row = document.createElement('div');
      row.className = 'rec-row';
      row.innerHTML = `
        <div class="rec-day-col"><div class="rec-day">${d.getDate()}</div><div class="rec-mon">${MON[d.getMonth()]}</div></div>
        <div style="flex:1;min-width:0"><div class="rec-title">${escapeHtml(recTitle(r))}</div><div class="rec-meta">${fmt(r.mileage)} mi · ${escapeHtml(r.notes || 'Not recorded')}</div></div>
        <div><div class="rec-cost">${money0(r.cost || 0)}</div><div class="rec-receipt">${r.rawText ? 'receipt' : '—'}</div></div>
      `;
      row.addEventListener('click', () => openRecordSheet(r.id));
      card.appendChild(row);
    }
    block.appendChild(card);
    container.appendChild(block);
  }
}

// ================= SERVICE DETAIL SHEET =================
function openServiceSheet(name) {
  const v = activeVehicle();
  const s = computeServices(v).find(x => x.name === name);
  if (!s) return;
  document.getElementById('svcTile').style.background = s.tileBg;
  document.getElementById('svcTile').style.color = s.tileFg;
  document.getElementById('svcTile').textContent = s.glyph;
  document.getElementById('svcName').textContent = s.name;
  document.getElementById('svcDetail').textContent = s.detail;
  document.getElementById('svcEvery').textContent = s.everyLabel;
  document.getElementById('svcLast').textContent = s.lastLabel;
  document.getElementById('svcNextAt').textContent = s.nextAt;
  const hist = STATE.records.filter(r => r.vehicleId === v.id && r.services.includes(name)).sort((a,b)=> b.date.localeCompare(a.date));
  document.getElementById('svcHistory').textContent = hist.length
    ? 'Logged ' + hist.length + ' time' + (hist.length === 1 ? '' : 's') + ' · last ' + shortD(hist[0].date) + ' at ' + money0(hist[0].cost || 0)
    : 'No logged history for this service yet.';
  document.getElementById('logThisServiceBtn').onclick = () => { closeSheet('service'); startLog([name]); };
  showSheet('service');
}
document.getElementById('closeServiceSheet').addEventListener('click', () => closeSheet('service'));

// ================= RECORD DETAIL SHEET =================
function openRecordSheet(id) {
  const r = STATE.records.find(x => x.id === id);
  if (!r) return;
  const v = STATE.vehicles.find(x => x.id === r.vehicleId);
  const d = parseD(r.date);
  document.getElementById('recTitle').textContent = recTitle(r);
  document.getElementById('recMeta').textContent = d.getDate() + ' ' + MON[d.getMonth()] + ' ' + d.getFullYear() + ' · ' + (v ? v.name : '');
  document.getElementById('recCost').textContent = money2(r.cost || 0);
  document.getElementById('recSlot').textContent = r.rawText ? 'Raw OCR text captured with this record' : 'No receipt scanned — entered manually';
  document.getElementById('recShop').textContent = r.notes || 'Not recorded';
  document.getElementById('recMileage').textContent = fmt(r.mileage) + ' mi';
  showSheet('record');
}
document.getElementById('closeRecordSheet').addEventListener('click', () => closeSheet('record'));

// ================= sheet show/hide helpers =================
function showSheet(name) { document.getElementById('scrim' + cap(name)).hidden = false; document.getElementById('sheet' + cap(name)).hidden = false; }
function closeSheet(name) { document.getElementById('scrim' + cap(name)).hidden = true; document.getElementById('sheet' + cap(name)).hidden = true; }
function cap(s) { return s[0].toUpperCase() + s.slice(1); }
document.getElementById('scrimService').addEventListener('click', () => closeSheet('service'));
document.getElementById('scrimRecord').addEventListener('click', () => closeSheet('record'));
document.getElementById('scrimVehicle').addEventListener('click', () => closeSheet('vehicle'));
document.getElementById('scrimInterval').addEventListener('click', () => closeSheet('interval'));

// ================= VEHICLE FORM SHEET =================
let editingVehicleId = null;
function openVehicleModal(vehicleId = null) {
  editingVehicleId = vehicleId;
  const v = vehicleId ? STATE.vehicles.find(x => x.id === vehicleId) : null;
  document.getElementById('vehicleFormTitle').textContent = v ? 'Edit vehicle' : 'Add vehicle';
  document.getElementById('vName').value = v ? v.name : '';
  document.getElementById('vMake').value = v ? v.make : '';
  document.getElementById('vModel').value = v ? v.model : '';
  document.getElementById('vYear').value = v ? v.year : '';
  document.getElementById('vOdo').value = v ? (STATE.odometers[v.id] || '') : '';
  document.getElementById('vehicleModalDelete').hidden = !v;
  showSheet('vehicle');
}
document.getElementById('vehicleModalCancel').addEventListener('click', () => closeSheet('vehicle'));
document.getElementById('vehicleForm').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('vName').value.trim();
  const make = document.getElementById('vMake').value.trim();
  const model = document.getElementById('vModel').value.trim();
  const year = document.getElementById('vYear').value.trim();
  const odo = Number(document.getElementById('vOdo').value) || 0;
  if (!name) return;
  if (editingVehicleId) {
    Object.assign(STATE.vehicles.find(x => x.id === editingVehicleId), { name, make, model, year });
  } else {
    const id = uid();
    STATE.vehicles.push({ id, name, make, model, year });
    STATE.activeVehicleId = id;
  }
  if (odo) STATE.odometers[editingVehicleId || STATE.activeVehicleId] = odo;
  persist();
  closeSheet('vehicle');
  showScreen('dashboard');
});
document.getElementById('vehicleModalDelete').addEventListener('click', () => {
  if (!editingVehicleId) return;
  if (!confirm('Delete this vehicle and all of its service records? This cannot be undone.')) return;
  STATE.vehicles = STATE.vehicles.filter(v => v.id !== editingVehicleId);
  STATE.records = STATE.records.filter(r => r.vehicleId !== editingVehicleId);
  delete STATE.odometers[editingVehicleId];
  if (STATE.activeVehicleId === editingVehicleId) STATE.activeVehicleId = STATE.vehicles.length ? STATE.vehicles[0].id : null;
  persist();
  closeSheet('vehicle');
  showScreen('garage');
});

// ================= SETTINGS SCREEN =================
function renderSettings() {
  document.getElementById('pushSwitch').classList.toggle('on', STATE.settings.pushEnabled);
  document.getElementById('emailSwitch').classList.toggle('on', STATE.settings.emailEnabled);
  document.getElementById('emailSub').textContent = STATE.settings.emailEnabled ? (STATE.settings.emailTo || 'Set an address') : 'Off';
  document.getElementById('emailDetail').hidden = !STATE.settings.emailEnabled;
  document.getElementById('sEmailTo').value = STATE.settings.emailTo || '';
  renderEmailStatus();

  const body = document.getElementById('intervalsList');
  body.innerHTML = '';
  for (const [name, iv] of Object.entries(STATE.intervals)) {
    const row = document.createElement('div');
    row.className = 'set-row';
    const every = iv.miles ? fmt(iv.miles) + ' mi' : iv.months ? iv.months + ' mo' : 'Not tracked';
    row.innerHTML = `<div style="flex:1"><div class="set-title" style="font-weight:500;font-size:14px">${escapeHtml(name)}</div></div><div style="font:400 13px 'DM Sans';color:var(--text-dim)">${every}</div><div class="chev">›</div>`;
    row.addEventListener('click', () => openIntervalSheet(name));
    body.appendChild(row);
  }

  const vbody = document.getElementById('settingsVehicleList');
  vbody.innerHTML = '';
  for (const v of STATE.vehicles) {
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `<div style="flex:1;min-width:0"><div class="set-title">${escapeHtml(v.name)}</div><div class="set-sub">${escapeHtml(vehicleSub(v))} · ${fmt(STATE.odometers[v.id]||0)} mi</div></div><div class="chev">›</div>`;
    row.addEventListener('click', () => openVehicleModal(v.id));
    vbody.appendChild(row);
  }
  const addRow = document.createElement('div');
  addRow.className = 'set-row';
  addRow.style.color = 'var(--primary)';
  addRow.style.fontWeight = '600';
  addRow.textContent = '+ Add a vehicle';
  addRow.addEventListener('click', () => openVehicleModal());
  vbody.appendChild(addRow);
}

document.getElementById('pushSwitch').addEventListener('click', async () => {
  const turningOn = !STATE.settings.pushEnabled;
  if (turningOn && 'Notification' in window && Notification.permission === 'default') {
    await Notification.requestPermission();
  }
  STATE.settings.pushEnabled = turningOn;
  persist();
  renderSettings();
});
document.getElementById('emailSwitch').addEventListener('click', () => {
  STATE.settings.emailEnabled = !STATE.settings.emailEnabled;
  persist();
  renderSettings();
});
document.getElementById('saveEmailSettings').addEventListener('click', () => {
  STATE.settings.emailTo = document.getElementById('sEmailTo').value.trim();
  persist();
  renderSettings();
});
document.getElementById('sendTestEmailBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('testEmailResult');
  resultEl.textContent = 'Sending…';
  try {
    const res = await fetch('/api/test-email', { method: 'POST' });
    const data = await res.json();
    resultEl.textContent = data.success ? '✅ ' + data.message : '❌ ' + data.message;
  } catch { resultEl.textContent = '❌ Could not reach the local server. Is it running?'; }
});
async function renderEmailStatus() {
  const hint = document.getElementById('emailStatusHint');
  try {
    const res = await fetch('/api/email-status');
    if (!res.ok) throw new Error();
    const data = await res.json();
    hint.textContent = data.configured
      ? `✅ Automatic weekly reminders are set up, sending from ${data.smtpUser}.`
      : '⚠️ Email sending isn\'t configured yet — add your Gmail App Password to .claude/email-config.json.';
  } catch { hint.textContent = 'Running in static/offline mode — start the local server to enable email status & test sending.'; }
}

document.getElementById('replayOnboardingBtn').addEventListener('click', () => startOnboarding());
document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('This will permanently delete all vehicles, records, and settings. Continue?')) return;
  STATE = defaultState();
  persist();
  showScreen('garage');
});

// ================= INTERVAL EDIT SHEET =================
let editingInterval = null;
function openIntervalSheet(name) {
  editingInterval = name;
  const iv = STATE.intervals[name];
  document.getElementById('intervalFormTitle').textContent = name;
  document.getElementById('iMiles').value = iv.miles ?? '';
  document.getElementById('iMonths').value = iv.months ?? '';
  showSheet('interval');
}
document.getElementById('closeIntervalSheet').addEventListener('click', () => closeSheet('interval'));
document.getElementById('saveIntervalBtn').addEventListener('click', () => {
  if (!editingInterval) return;
  const miles = document.getElementById('iMiles').value === '' ? null : Number(document.getElementById('iMiles').value);
  const months = document.getElementById('iMonths').value === '' ? null : Number(document.getElementById('iMonths').value);
  STATE.intervals[editingInterval] = { miles, months };
  persist();
  closeSheet('interval');
  renderSettings();
});

// ================= LOG SERVICE FLOW =================
let logState = null;
let cropSelection = null;
let dragStart = null;

function startLog(preselectTypes) {
  const v = activeVehicle();
  if (!v) { alert('Add a vehicle first.'); return; }
  logState = { step: 'capture', scannedFrom: null, f: { date: todayISO(), mileage: String(STATE.odometers[v.id] || ''), cost: '', notes: '', types: preselectTypes ? preselectTypes.slice() : [] } };
  document.getElementById('logFileInput').value = '';
  document.getElementById('cropperStage').hidden = true;
  document.getElementById('cropperActions').hidden = true;
  clearCropSelection();
  showLogStep('capture');
  document.getElementById('sheetLog').hidden = false;
}
document.getElementById('fabLog').addEventListener('click', () => startLog());
document.getElementById('logCancel').addEventListener('click', () => { clearInterval(window._scanTimer); document.getElementById('sheetLog').hidden = true; });

function showLogStep(step) {
  logState.step = step;
  ['Capture','Scanning','Confirm','Done'].forEach(s => { document.getElementById('logStep' + s).hidden = s.toLowerCase() !== step; });
  document.getElementById('logBack').hidden = step === 'capture' || step === 'done';
  document.getElementById('logStepLabel').textContent = step === 'done' ? 'Saved' : 'Step ' + ({capture:1,scanning:2,confirm:3}[step]||1) + ' of 3';
}
document.getElementById('logBack').addEventListener('click', () => {
  if (logState.step === 'confirm') showLogStep('capture');
  else if (logState.step === 'scanning') showLogStep('capture');
});

// capture step: file -> cropper preview
document.getElementById('logFileInput').addEventListener('change', () => {
  const file = document.getElementById('logFileInput').files[0];
  if (!file) return;
  const img = document.getElementById('cropperImg');
  img.src = URL.createObjectURL(file);
  document.getElementById('cropperStage').hidden = false;
  document.getElementById('cropperActions').hidden = false;
  clearCropSelection();
});
document.getElementById('skipScanBtn').addEventListener('click', () => { logState.scannedFrom = null; showLogStep('confirm'); populateConfirmForm(); });
document.getElementById('scanFullBtn').addEventListener('click', () => runOCR(document.getElementById('cropperImg').src));
document.getElementById('scanCroppedBtn').addEventListener('click', () => {
  if (!cropSelection) return;
  const img = document.getElementById('cropperImg');
  const scaleX = img.naturalWidth / img.clientWidth, scaleY = img.naturalHeight / img.clientHeight;
  const canvas = document.createElement('canvas');
  canvas.width = cropSelection.w * scaleX; canvas.height = cropSelection.h * scaleY;
  canvas.getContext('2d').drawImage(img, cropSelection.x*scaleX, cropSelection.y*scaleY, cropSelection.w*scaleX, cropSelection.h*scaleY, 0, 0, canvas.width, canvas.height);
  runOCR(canvas.toDataURL('image/png'));
});
const cropperStageEl = document.getElementById('cropperStage');
const cropRectEl = document.getElementById('cropRect');
cropperStageEl.addEventListener('pointerdown', e => {
  const rect = cropperStageEl.getBoundingClientRect();
  dragStart = { x: e.clientX - rect.left + cropperStageEl.scrollLeft, y: e.clientY - rect.top + cropperStageEl.scrollTop };
  cropRectEl.hidden = false;
  cropRectEl.style.left = dragStart.x + 'px'; cropRectEl.style.top = dragStart.y + 'px'; cropRectEl.style.width = '0px'; cropRectEl.style.height = '0px';
});
cropperStageEl.addEventListener('pointermove', e => {
  if (!dragStart) return;
  const rect = cropperStageEl.getBoundingClientRect();
  const x = e.clientX - rect.left + cropperStageEl.scrollLeft, y = e.clientY - rect.top + cropperStageEl.scrollTop;
  const left = Math.min(x, dragStart.x), top = Math.min(y, dragStart.y), w = Math.abs(x - dragStart.x), h = Math.abs(y - dragStart.y);
  cropRectEl.style.left = left+'px'; cropRectEl.style.top = top+'px'; cropRectEl.style.width = w+'px'; cropRectEl.style.height = h+'px';
  cropSelection = { x: left, y: top, w, h };
});
window.addEventListener('pointerup', () => { if (!dragStart) return; dragStart = null; document.getElementById('scanCroppedBtn').disabled = !(cropSelection && cropSelection.w > 15 && cropSelection.h > 15); });
function clearCropSelection() { cropSelection = null; cropRectEl.hidden = true; document.getElementById('scanCroppedBtn').disabled = true; }

async function runOCR(imageSource) {
  showLogStep('scanning');
  document.getElementById('scanStatus').textContent = 'Finding the text…';
  document.getElementById('scanProgressFill').style.width = '0%';
  document.getElementById('scanFoundFields').innerHTML = '';
  try {
    const result = await Tesseract.recognize(imageSource, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress != null) {
          document.getElementById('scanProgressFill').style.width = Math.round(m.progress * 100) + '%';
          document.getElementById('scanStatus').textContent = m.progress < 0.5 ? 'Finding the text…' : m.progress < 0.85 ? 'Matching line items to services…' : 'Almost done…';
        }
      }
    });
    const text = result.data.text || '';
    document.getElementById('scanProgressFill').style.width = '100%';
    const date = parseDateFromText(text);
    const mileage = parseMileageFromText(text);
    const cost = parseCostFromText(text);
    const services = detectServicesFromText(text);
    const fields = document.getElementById('scanFoundFields');
    fields.innerHTML = '';
    [['DATE', date || 'not found'], ['MILEAGE', mileage ? fmt(mileage) + ' mi' : 'not found'], ['COST', cost ? money2(cost) : 'not found'], ['SERVICES', services.length ? services.join(', ') : 'not found']]
      .forEach(([k, v]) => { const row = document.createElement('div'); row.className = 'scan-field-row'; row.innerHTML = `<div class="scan-field-k">${k}</div><div class="scan-field-v">${escapeHtml(v)}</div>`; fields.appendChild(row); });

    logState.scannedFrom = 'scan';
    logState.f = {
      date: date || todayISO(),
      mileage: mileage ? String(mileage) : String(STATE.odometers[activeVehicle().id] || ''),
      cost: cost ? cost.toFixed(2) : '',
      notes: '',
      types: services,
    };
    logState.rawText = text;
    setTimeout(() => { showLogStep('confirm'); populateConfirmForm(); }, 400);
  } catch (err) {
    console.error(err);
    document.getElementById('scanStatus').textContent = 'Scan failed — you can enter details manually.';
    setTimeout(() => { logState.scannedFrom = null; showLogStep('confirm'); populateConfirmForm(); }, 800);
  }
}

function populateConfirmForm() {
  const v = activeVehicle();
  document.getElementById('confirmSub').textContent = logState.scannedFrom ? 'Read from the invoice photo. Correct anything that looks wrong.' : 'Fill in what you know. Cost is optional.';
  document.getElementById('fServiceDate').value = logState.f.date;
  document.getElementById('fMileage').value = logState.f.mileage;
  document.getElementById('fCost').value = logState.f.cost;
  document.getElementById('fNotes').value = logState.f.notes;
  document.getElementById('fRawText').value = logState.rawText || '';
  document.getElementById('toggleRawBtn').hidden = !logState.scannedFrom;
  document.getElementById('rawBox').hidden = true;
  document.getElementById('rawBox').textContent = logState.rawText || '';
  document.getElementById('toggleRawBtn').textContent = 'Show raw scan text';
  renderTypeChips();
  updateSaveState();
}
document.getElementById('toggleRawBtn').addEventListener('click', () => {
  const box = document.getElementById('rawBox');
  box.hidden = !box.hidden;
  document.getElementById('toggleRawBtn').textContent = box.hidden ? 'Show raw scan text' : 'Hide raw scan text';
});
function renderTypeChips() {
  const container = document.getElementById('serviceChips');
  container.innerHTML = '';
  for (const name of Object.keys(STATE.intervals)) {
    const chip = document.createElement('div');
    chip.className = 'type-chip' + (logState.f.types.includes(name) ? ' on' : '');
    chip.textContent = name;
    chip.addEventListener('click', () => {
      const ix = logState.f.types.indexOf(name);
      if (ix >= 0) logState.f.types.splice(ix, 1); else logState.f.types.push(name);
      renderTypeChips(); updateSaveState();
    });
    container.appendChild(chip);
  }
}
['fServiceDate','fMileage','fCost','fNotes'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    const map = { fServiceDate: 'date', fMileage: 'mileage', fCost: 'cost', fNotes: 'notes' };
    logState.f[map[id]] = document.getElementById(id).value;
    if (id === 'fMileage') updateSaveState();
  });
});
function updateSaveState() {
  const canSave = logState.f.types.length > 0 && String(logState.f.mileage).replace(/\D/g, '').length > 0;
  const btn = document.getElementById('saveRecordBtn');
  btn.disabled = !canSave;
  btn.style.background = canSave ? 'var(--primary)' : 'var(--track-off)';
  btn.style.color = canSave ? '#fff' : 'var(--text-faint)';
  document.getElementById('saveHint').textContent = canSave ? 'Intervals for the services you picked reset from this reading.' : 'Pick at least one service and an odometer reading.';
}

document.getElementById('saveRecordBtn').addEventListener('click', () => {
  const v = activeVehicle();
  const mi = parseInt(String(logState.f.mileage).replace(/\D/g, ''), 10);
  if (!mi || logState.f.types.length === 0) return;
  const cost = parseFloat(String(logState.f.cost).replace(/[^0-9.]/g, '')) || 0;
  const date = logState.f.date || todayISO();

  const record = { id: uid(), vehicleId: v.id, date, mileage: mi, cost, notes: logState.f.notes, rawText: logState.rawText || '', services: logState.f.types.slice() };
  STATE.records.push(record);
  if (mi > (STATE.odometers[v.id] || 0)) STATE.odometers[v.id] = mi;
  v.updated = 'just now';
  persist();

  const summary = logState.f.types.map(name => {
    const iv = STATE.intervals[name];
    let next;
    if (iv.miles) next = fmt(mi + iv.miles) + ' mi';
    else if (iv.months) { const d = parseD(date); next = MON[d.getMonth()] + ' ' + (d.getFullYear() + Math.round(iv.months / 12)); }
    else next = '—';
    return { name, next };
  });
  document.getElementById('doneSub').textContent = summary.length + ' service' + (summary.length === 1 ? '' : 's') + ' logged for ' + v.name + '. Here is when they come due again.';
  const list = document.getElementById('doneList');
  list.innerHTML = '';
  summary.forEach(d => { const row = document.createElement('div'); row.className = 'done-row'; row.innerHTML = `<div class="n">${escapeHtml(d.name)}</div><div class="d">${escapeHtml(d.next)}</div>`; list.appendChild(row); });
  document.getElementById('doneCtaBtn').textContent = 'Back to ' + v.name;
  showLogStep('done');
});
document.getElementById('doneCtaBtn').addEventListener('click', () => {
  document.getElementById('sheetLog').hidden = true;
  showScreen('dashboard');
});

// ================= ONBOARDING =================
let onbStep = 0;
let onbVehicleId = null;
function startOnboarding() {
  onbStep = 1; onbVehicleId = null;
  document.getElementById('nvName').value = '';
  document.getElementById('nvSub').value = '';
  document.getElementById('nvOdo').value = '';
  renderOnboardStep();
  document.getElementById('sheetOnboard').hidden = false;
}
function renderOnboardStep() {
  ['1','2','3'].forEach(n => document.getElementById('onbStep' + n).hidden = String(onbStep) !== n);
  document.getElementById('onbBack').hidden = onbStep === 1;
  document.getElementById('onbDots').innerHTML = [1,2,3].map(n => `<span class="onb-dot${n===onbStep?' on':''}"></span>`).join('');
  document.getElementById('onboardNextBtn').textContent = onbStep === 1 ? 'Get started' : onbStep === 2 ? 'Continue' : 'Open my garage';
  if (onbStep === 3) {
    document.getElementById('onbPushSwitch').classList.toggle('on', STATE.settings.pushEnabled);
    document.getElementById('onbEmailSwitch').classList.toggle('on', STATE.settings.emailEnabled);
    document.getElementById('onbEmailSub').textContent = STATE.settings.emailEnabled ? (STATE.settings.emailTo || 'Set an address in Settings') : 'Off';
  }
}
document.getElementById('onbBack').addEventListener('click', () => { onbStep = Math.max(1, onbStep - 1); renderOnboardStep(); });
document.getElementById('onbSkip').addEventListener('click', () => { document.getElementById('sheetOnboard').hidden = true; showScreen(STATE.vehicles.length ? 'garage' : 'garage'); });
document.getElementById('onbPushSwitch').addEventListener('click', async () => {
  const turningOn = !STATE.settings.pushEnabled;
  if (turningOn && 'Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
  STATE.settings.pushEnabled = turningOn; persist(); renderOnboardStep();
});
document.getElementById('onbEmailSwitch').addEventListener('click', () => { STATE.settings.emailEnabled = !STATE.settings.emailEnabled; persist(); renderOnboardStep(); });

document.getElementById('onboardNextBtn').addEventListener('click', () => {
  if (onbStep < 3) { onbStep++; renderOnboardStep(); return; }
  // finalize: create vehicle from step-2 fields if a name was given
  const name = document.getElementById('nvName').value.trim();
  if (name) {
    const sub = document.getElementById('nvSub').value.trim();
    const odo = Number(String(document.getElementById('nvOdo').value).replace(/\D/g, '')) || 0;
    const id = uid();
    STATE.vehicles.push({ id, name, make: '', model: sub, year: '' });
    STATE.activeVehicleId = id;
    if (odo) STATE.odometers[id] = odo;
    persist();
    document.getElementById('sheetOnboard').hidden = true;
    showScreen('dashboard');
  } else {
    document.getElementById('sheetOnboard').hidden = true;
    showScreen('garage');
  }
});

// ================= export / import / share ================
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vehicle-maintenance-backup.json';
  a.click();
});
document.getElementById('importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.vehicles) { STATE = data; persist(); alert('Import complete.'); showScreen('garage'); }
    else alert('That file doesn\'t look like a valid export from this app.');
  } catch { alert('Could not read that file — is it valid JSON?'); }
  e.target.value = '';
});
function backupFile() {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  return new File([blob], `vehicle-maintenance-backup-${stamp}.json`, { type: 'application/json' });
}
(function initShareBackup() {
  const btn = document.getElementById('shareBackupBtn');
  const canShareFiles = navigator.canShare && navigator.canShare({ files: [backupFile()] });
  if (!canShareFiles) return;
  btn.hidden = false;
  btn.addEventListener('click', async () => {
    try { await navigator.share({ files: [backupFile()], title: 'Vehicle Maintenance Backup' }); }
    catch (err) { if (err.name !== 'AbortError') alert('Could not open the share sheet: ' + err.message); }
  });
})();

// ================= local push-style notification (best-effort, in-app only) =================
function maybeNotifyOverdue() {
  if (!STATE.settings.pushEnabled) return;
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (sessionStorage.getItem('vmd_notified_this_session')) return;
  let total = 0;
  for (const v of STATE.vehicles) total += computeServices(v).filter(s => s.status !== 'ok').length;
  if (total === 0) return;
  try {
    new Notification('Garage', { body: total + ' service item' + (total === 1 ? '' : 's') + ' due or coming up soon.' });
    sessionStorage.setItem('vmd_notified_this_session', '1');
  } catch {}
}

// ================= service worker =================
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker registration failed:', err)));
}

// ================= init =================
(async function init() {
  await hydrateFromServerIfEmpty();
  if (!STATE.vehicles.length) {
    showScreen('garage');
    startOnboarding();
  } else {
    showScreen('garage');
  }
  maybeNotifyOverdue();
})();
