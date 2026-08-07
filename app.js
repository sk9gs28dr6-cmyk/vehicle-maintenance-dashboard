/* ---------------------------------------------------------
   Garage — Vehicle Maintenance Dashboard
   All data lives in localStorage, mirrored best-effort to a
   data.json file on disk (via the local server) so a scheduled
   PowerShell script can send email reminders. OCR runs entirely
   client-side via Tesseract.js — nothing leaves the browser.
--------------------------------------------------------- */

const LS_KEY = 'vmd_state_v2';

const DEFAULT_INTERVALS = {
  'Oil Change':              { miles: 5000,  months: 6  },
  'Tire Rotation':           { miles: 6000,  months: 6  },
  'Air Filter':              { miles: 15000, months: 12 },
  'Cabin Air Filter':        { miles: 15000, months: 12 },
  'Brake Inspection':        { miles: 12000, months: 12 },
  'Brake Pads':              { miles: 40000, months: null },
  'Battery':                 { miles: null,  months: 48 },
  'Coolant Flush':           { miles: 30000, months: 24 },
  'Transmission Fluid':      { miles: 45000, months: null },
  'Spark Plugs':             { miles: 30000, months: null },
  'Wiper Blades':            { miles: null,  months: 12 },
  'Alignment':                { miles: 12000, months: 12 },
  'Inspection / Registration': { miles: null, months: 12 },
  'Tire Replacement':        { miles: 50000, months: null },
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

function uid() { return Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

// ---------------- state ----------------
function defaultState() {
  return {
    vehicles: [],
    activeVehicleId: null,
    records: [],
    odometers: {},
    intervals: structuredClone(DEFAULT_INTERVALS),
    settings: { emailTo: '' },
  };
}

function migrateLegacy(state) {
  // pull in data from the old single-vehicle version of this app, if present
  const oldRecords = JSON.parse(localStorage.getItem('vmd_records') || 'null');
  const oldIntervals = JSON.parse(localStorage.getItem('vmd_intervals') || 'null');
  const oldOdo = Number(localStorage.getItem('vmd_currentOdo')) || 0;
  const oldName = localStorage.getItem('vmd_vehicleName');

  if (!oldRecords && !oldName) return state;

  const vehicleId = uid();
  state.vehicles.push({ id: vehicleId, name: oldName || 'My Vehicle', make: '', model: '', year: '' });
  state.activeVehicleId = vehicleId;
  if (oldRecords) {
    state.records = oldRecords.map(r => ({ ...r, vehicleId }));
  }
  if (oldOdo) state.odometers[vehicleId] = oldOdo;
  if (oldIntervals) state.intervals = oldIntervals;

  ['vmd_records', 'vmd_intervals', 'vmd_currentOdo', 'vmd_vehicleName'].forEach(k => localStorage.removeItem(k));
  return state;
}

let STATE = loadState();

function loadState() {
  let s;
  let migrated = false;
  try { s = JSON.parse(localStorage.getItem(LS_KEY)); } catch { s = null; }
  if (!s) {
    s = migrateLegacy(defaultState());
    migrated = true;
  }
  if (!s.vehicles) s.vehicles = [];
  if (!s.records) s.records = [];
  if (!s.odometers) s.odometers = {};
  if (!s.intervals) s.intervals = structuredClone(DEFAULT_INTERVALS);
  if (!s.settings) s.settings = { emailTo: '' };
  if (!s.activeVehicleId && s.vehicles.length) s.activeVehicleId = s.vehicles[0].id;
  if (migrated) {
    localStorage.setItem(LS_KEY, JSON.stringify(s));
    fetch('/api/data', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(s),
    }).catch(() => {});
  }
  return s;
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(STATE));
  // best-effort mirror to disk so the scheduled reminder script can read it too.
  // silently ignored if the app isn't running through the local server (e.g. file://).
  fetch('/api/data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(STATE),
  }).catch(() => {});
}

async function hydrateFromServerIfEmpty() {
  if (STATE.vehicles.length) return;
  try {
    const res = await fetch('/api/data');
    if (!res.ok) return;
    const data = await res.json();
    if (data && data.vehicles && data.vehicles.length) {
      STATE = data;
      localStorage.setItem(LS_KEY, JSON.stringify(STATE));
    }
  } catch { /* offline / static file mode — fine, localStorage is source of truth */ }
}

function activeVehicle() {
  return STATE.vehicles.find(v => v.id === STATE.activeVehicleId) || null;
}

// ---------------- tabs ----------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    renderAll();
  });
});

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
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
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

// ---------------- Add Record tab: upload + cropper + OCR ----------------
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const ocrStatus = document.getElementById('ocrStatus');
const ocrProgress = document.getElementById('ocrProgress');
const cropperWrap = document.getElementById('cropperWrap');
const cropperStage = document.getElementById('cropperStage');
const cropperImg = document.getElementById('cropperImg');
const cropRect = document.getElementById('cropRect');
const scanCroppedBtn = document.getElementById('scanCroppedBtn');
const scanFullBtn = document.getElementById('scanFullBtn');
const clearCropBtn = document.getElementById('clearCropBtn');

let cropSelection = null; // {x,y,w,h} in displayed-image pixel space

dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
dropzone.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files.length) handleFile(fileInput.files[0]);
});

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    ocrStatus.textContent = 'Please upload an image file.';
    return;
  }
  const url = URL.createObjectURL(file);
  cropperImg.src = url;
  cropperWrap.hidden = false;
  document.getElementById('dropzoneText').textContent = '📷 Click or drag a different photo to replace';
  clearCropSelection();
  ocrStatus.textContent = 'Optionally drag a box around the invoice text, then scan.';
}

// --- drag-to-select crop rectangle ---
let dragStart = null;

cropperStage.addEventListener('pointerdown', e => {
  if (!cropperImg.src) return;
  const rect = cropperStage.getBoundingClientRect();
  dragStart = { x: e.clientX - rect.left + cropperStage.scrollLeft, y: e.clientY - rect.top + cropperStage.scrollTop };
  cropRect.hidden = false;
  cropRect.style.left = dragStart.x + 'px';
  cropRect.style.top = dragStart.y + 'px';
  cropRect.style.width = '0px';
  cropRect.style.height = '0px';
});

cropperStage.addEventListener('pointermove', e => {
  if (!dragStart) return;
  const rect = cropperStage.getBoundingClientRect();
  const x = e.clientX - rect.left + cropperStage.scrollLeft;
  const y = e.clientY - rect.top + cropperStage.scrollTop;
  const left = Math.min(x, dragStart.x);
  const top = Math.min(y, dragStart.y);
  const w = Math.abs(x - dragStart.x);
  const h = Math.abs(y - dragStart.y);
  cropRect.style.left = left + 'px';
  cropRect.style.top = top + 'px';
  cropRect.style.width = w + 'px';
  cropRect.style.height = h + 'px';
  cropSelection = { x: left, y: top, w, h };
});

window.addEventListener('pointerup', () => {
  if (!dragStart) return;
  dragStart = null;
  scanCroppedBtn.disabled = !(cropSelection && cropSelection.w > 15 && cropSelection.h > 15);
});

function clearCropSelection() {
  cropSelection = null;
  cropRect.hidden = true;
  scanCroppedBtn.disabled = true;
}
clearCropBtn.addEventListener('click', clearCropSelection);

scanFullBtn.addEventListener('click', () => runOCR(cropperImg.src));

scanCroppedBtn.addEventListener('click', () => {
  if (!cropSelection) return;
  const scaleX = cropperImg.naturalWidth / cropperImg.clientWidth;
  const scaleY = cropperImg.naturalHeight / cropperImg.clientHeight;
  const canvas = document.createElement('canvas');
  canvas.width = cropSelection.w * scaleX;
  canvas.height = cropSelection.h * scaleY;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(
    cropperImg,
    cropSelection.x * scaleX, cropSelection.y * scaleY, cropSelection.w * scaleX, cropSelection.h * scaleY,
    0, 0, canvas.width, canvas.height
  );
  runOCR(canvas.toDataURL('image/png'));
});

async function runOCR(imageSource) {
  ocrStatus.textContent = 'Reading invoice…';
  ocrProgress.hidden = false;
  ocrProgress.value = 0;
  try {
    const result = await Tesseract.recognize(imageSource, 'eng', {
      logger: m => {
        if (m.status === 'recognizing text' && m.progress != null) {
          ocrProgress.value = m.progress;
          ocrStatus.textContent = `Reading invoice… ${Math.round(m.progress * 100)}%`;
        } else if (m.status) {
          ocrStatus.textContent = m.status.charAt(0).toUpperCase() + m.status.slice(1) + '…';
        }
      }
    });
    const text = result.data.text || '';
    ocrProgress.hidden = true;
    ocrStatus.textContent = text.trim()
      ? 'Done — review the extracted details below and correct anything that\'s off.'
      : 'Could not read any text from this image. Please fill in the details manually.';
    prefillForm(text);
  } catch (err) {
    ocrProgress.hidden = true;
    ocrStatus.textContent = 'OCR failed — you can still fill in the details manually.';
    console.error(err);
  }
}

function prefillForm(text) {
  document.getElementById('fRawText').value = text;

  const date = parseDateFromText(text);
  if (date) document.getElementById('fServiceDate').value = date;

  const mileage = parseMileageFromText(text);
  if (mileage) document.getElementById('fMileage').value = mileage;

  const cost = parseCostFromText(text);
  if (cost) document.getElementById('fCost').value = cost.toFixed(2);

  const services = detectServicesFromText(text);
  renderServiceChips(services);
}

// ---------------- service chip select ----------------
function renderServiceChips(selected = []) {
  const container = document.getElementById('serviceChips');
  container.innerHTML = '';
  Object.keys(STATE.intervals).forEach(service => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (selected.includes(service) ? ' selected' : '');
    chip.textContent = service;
    chip.dataset.service = service;
    chip.addEventListener('click', () => chip.classList.toggle('selected'));
    container.appendChild(chip);
  });
}

// ---------------- save record ----------------
document.getElementById('recordForm').addEventListener('submit', e => {
  e.preventDefault();
  const vehicle = activeVehicle();
  if (!vehicle) { alert('Add a vehicle first (top right).'); return; }

  const date = document.getElementById('fServiceDate').value;
  const mileage = parseInt(document.getElementById('fMileage').value, 10);
  const cost = parseFloat(document.getElementById('fCost').value) || 0;
  const notes = document.getElementById('fNotes').value.trim();
  const rawText = document.getElementById('fRawText').value;
  const services = [...document.querySelectorAll('#serviceChips .chip.selected')].map(c => c.dataset.service);

  if (!date || !mileage) {
    alert('Please provide at least a service date and mileage.');
    return;
  }
  if (services.length === 0) services.push('Other / Unspecified');

  STATE.records.push({
    id: uid(),
    vehicleId: vehicle.id,
    date, mileage, cost, notes, rawText, services,
  });

  if (mileage > (STATE.odometers[vehicle.id] || 0)) {
    STATE.odometers[vehicle.id] = mileage;
  }
  persist();

  e.target.reset();
  cropperWrap.hidden = true;
  document.getElementById('dropzoneText').textContent = '📷 Click or drag an invoice photo here';
  ocrStatus.textContent = '';
  fileInput.value = '';
  clearCropSelection();
  renderServiceChips([]);

  alert('Record saved!');
  document.querySelector('.tab-btn[data-tab="history"]').click();
});

// ---------------- History tab ----------------
function renderHistory() {
  const vehicle = activeVehicle();
  const records = STATE.records
    .filter(r => vehicle && r.vehicleId === vehicle.id)
    .sort((a, b) => b.date.localeCompare(a.date));
  const body = document.getElementById('historyBody');
  const empty = document.getElementById('historyEmpty');
  body.innerHTML = '';

  if (!vehicle) {
    empty.textContent = 'Add a vehicle to start tracking service history.';
    empty.style.display = 'block';
    return;
  }
  if (!records.length) {
    empty.textContent = 'No records yet for this vehicle. Add one in the "Add Record" tab.';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  for (const r of records) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${r.date}</td>
      <td>${r.mileage.toLocaleString()} mi</td>
      <td>${r.services.join(', ')}</td>
      <td>${r.cost ? '$' + r.cost.toFixed(2) : '—'}</td>
      <td>${escapeHtml(r.notes || '')}</td>
      <td><button class="row-delete" data-id="${r.id}">Delete</button></td>
    `;
    body.appendChild(tr);
  }

  body.querySelectorAll('.row-delete').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Delete this record?')) return;
      STATE.records = STATE.records.filter(r => r.id !== btn.dataset.id);
      persist();
      renderAll();
    });
  });
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// export / import
document.getElementById('exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'vehicle-maintenance-backup.json';
  a.click();
});

// share backup (iOS share sheet -> Files / iCloud Drive / Notes / Mail, etc.)
// only shown when the browser actually supports sharing files (mobile Safari, Android Chrome).
function backupFile() {
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  return new File([blob], `vehicle-maintenance-backup-${stamp}.json`, { type: 'application/json' });
}

(function initShareBackup() {
  const btn = document.getElementById('shareBackupBtn');
  const hint = document.getElementById('shareBackupHint');
  const canShareFiles = navigator.canShare && navigator.canShare({ files: [backupFile()] });
  if (!canShareFiles) return; // desktop browsers: Export JSON below covers it
  btn.hidden = false;
  hint.textContent = 'Saves a backup you can send to iCloud Drive, Files, or Notes right from the share sheet.';
  btn.addEventListener('click', async () => {
    try {
      await navigator.share({ files: [backupFile()], title: 'Vehicle Maintenance Backup' });
    } catch (err) {
      if (err.name !== 'AbortError') hint.textContent = 'Could not open the share sheet: ' + err.message;
    }
  });
})();

// register service worker for offline / installable support (no-op if unsupported or on file://)
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker registration failed:', err));
  });
}

document.getElementById('importInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.vehicles) {
      STATE = data;
      persist();
      alert('Import complete.');
      renderAll();
    } else {
      alert('That file doesn\'t look like a valid export from this app.');
    }
  } catch {
    alert('Could not read that file — is it valid JSON?');
  }
  e.target.value = '';
});

// ---------------- Vehicle switcher ----------------
function renderVehicleSelect() {
  const sel = document.getElementById('vehicleSelect');
  sel.innerHTML = '';
  if (!STATE.vehicles.length) {
    const opt = document.createElement('option');
    opt.textContent = 'No vehicles yet';
    sel.appendChild(opt);
    document.getElementById('editVehicleBtn').disabled = true;
    return;
  }
  document.getElementById('editVehicleBtn').disabled = false;
  for (const v of STATE.vehicles) {
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = v.name + (v.year || v.make || v.model ? ` (${[v.year, v.make, v.model].filter(Boolean).join(' ')})` : '');
    if (v.id === STATE.activeVehicleId) opt.selected = true;
    sel.appendChild(opt);
  }
}

document.getElementById('vehicleSelect').addEventListener('change', e => {
  STATE.activeVehicleId = e.target.value;
  persist();
  renderAll();
});

// ---------------- Vehicle add/edit modal ----------------
const vehicleModal = document.getElementById('vehicleModal');
const vehicleForm = document.getElementById('vehicleForm');
let editingVehicleId = null;

function openVehicleModal(vehicleId = null) {
  editingVehicleId = vehicleId;
  const v = vehicleId ? STATE.vehicles.find(x => x.id === vehicleId) : null;
  document.getElementById('vehicleModalTitle').textContent = v ? 'Edit Vehicle' : 'Add Vehicle';
  document.getElementById('vName').value = v ? v.name : '';
  document.getElementById('vMake').value = v ? v.make : '';
  document.getElementById('vModel').value = v ? v.model : '';
  document.getElementById('vYear').value = v ? v.year : '';
  document.getElementById('vOdo').value = v ? (STATE.odometers[v.id] || '') : '';
  document.getElementById('vehicleModalDelete').hidden = !v;
  vehicleModal.hidden = false;
}
function closeVehicleModal() { vehicleModal.hidden = true; editingVehicleId = null; }

document.getElementById('addVehicleBtn').addEventListener('click', () => openVehicleModal());
document.getElementById('addVehicleBtn2').addEventListener('click', () => openVehicleModal());
document.getElementById('editVehicleBtn').addEventListener('click', () => {
  if (STATE.activeVehicleId) openVehicleModal(STATE.activeVehicleId);
});
document.getElementById('vehicleModalCancel').addEventListener('click', closeVehicleModal);

vehicleForm.addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('vName').value.trim();
  const make = document.getElementById('vMake').value.trim();
  const model = document.getElementById('vModel').value.trim();
  const year = document.getElementById('vYear').value.trim();
  const odo = Number(document.getElementById('vOdo').value) || 0;
  if (!name) return;

  if (editingVehicleId) {
    const v = STATE.vehicles.find(x => x.id === editingVehicleId);
    Object.assign(v, { name, make, model, year });
  } else {
    const id = uid();
    STATE.vehicles.push({ id, name, make, model, year });
    STATE.activeVehicleId = id;
  }
  if (odo) STATE.odometers[editingVehicleId || STATE.activeVehicleId] = odo;

  persist();
  closeVehicleModal();
  renderAll();
});

document.getElementById('vehicleModalDelete').addEventListener('click', () => {
  if (!editingVehicleId) return;
  if (!confirm('Delete this vehicle and all of its service records? This cannot be undone.')) return;
  STATE.vehicles = STATE.vehicles.filter(v => v.id !== editingVehicleId);
  STATE.records = STATE.records.filter(r => r.vehicleId !== editingVehicleId);
  delete STATE.odometers[editingVehicleId];
  if (STATE.activeVehicleId === editingVehicleId) {
    STATE.activeVehicleId = STATE.vehicles.length ? STATE.vehicles[0].id : null;
  }
  persist();
  closeVehicleModal();
  renderAll();
});

// ---------------- Settings tab: vehicles table ----------------
function renderVehiclesTable() {
  const body = document.getElementById('vehiclesBody');
  body.innerHTML = '';
  for (const v of STATE.vehicles) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(v.name)}</td>
      <td>${escapeHtml([v.year, v.make, v.model].filter(Boolean).join(' ') || '—')}</td>
      <td>${(STATE.odometers[v.id] || 0).toLocaleString()} mi</td>
      <td><button class="edit-link" data-id="${v.id}">Edit</button></td>
    `;
    body.appendChild(tr);
  }
  body.querySelectorAll('.edit-link').forEach(btn => {
    btn.addEventListener('click', () => openVehicleModal(btn.dataset.id));
  });
}

// ---------------- Settings tab: intervals ----------------
function renderIntervalsTable() {
  const body = document.getElementById('intervalsBody');
  body.innerHTML = '';
  for (const [service, { miles, months }] of Object.entries(STATE.intervals)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${service}</td>
      <td><input type="number" data-service="${service}" data-field="miles" value="${miles ?? ''}"></td>
      <td><input type="number" data-service="${service}" data-field="months" value="${months ?? ''}"></td>
    `;
    body.appendChild(tr);
  }
}

document.getElementById('saveIntervals').addEventListener('click', () => {
  document.querySelectorAll('#intervalsBody input').forEach(input => {
    const { service, field } = input.dataset;
    const val = input.value === '' ? null : Number(input.value);
    STATE.intervals[service][field] = val;
  });
  persist();
  alert('Intervals saved.');
  renderDashboard();
});

document.getElementById('resetIntervals').addEventListener('click', () => {
  if (!confirm('Reset all intervals to defaults?')) return;
  STATE.intervals = structuredClone(DEFAULT_INTERVALS);
  persist();
  renderIntervalsTable();
  renderDashboard();
});

// ---------------- Settings tab: email reminders ----------------
async function renderEmailStatus() {
  const hint = document.getElementById('emailStatusHint');
  document.getElementById('sEmailTo').value = STATE.settings.emailTo || '';
  try {
    const res = await fetch('/api/email-status');
    if (!res.ok) throw new Error();
    const data = await res.json();
    if (data.configured) {
      hint.textContent = `✅ Automatic weekly reminders are set up, sending from ${data.smtpUser} via a scheduled Windows task.`;
    } else {
      hint.textContent = '⚠️ Email sending isn\'t configured yet — add your Gmail App Password to .claude/email-config.json (see chat for instructions).';
    }
  } catch {
    hint.textContent = 'Running in static/offline mode — start the local server to enable email status & test sending.';
  }
}

document.getElementById('saveEmailSettings').addEventListener('click', () => {
  STATE.settings.emailTo = document.getElementById('sEmailTo').value.trim();
  persist();
  alert('Saved.');
});

document.getElementById('sendTestEmailBtn').addEventListener('click', async () => {
  const resultEl = document.getElementById('testEmailResult');
  resultEl.textContent = 'Sending…';
  try {
    const res = await fetch('/api/test-email', { method: 'POST' });
    const data = await res.json();
    resultEl.textContent = data.success ? '✅ ' + data.message : '❌ ' + data.message;
  } catch {
    resultEl.textContent = '❌ Could not reach the local server. Is it running?';
  }
});

document.getElementById('clearAllBtn').addEventListener('click', () => {
  if (!confirm('This will permanently delete all vehicles, records, and settings. Continue?')) return;
  STATE = defaultState();
  persist();
  renderAll();
});

// ---------------- Dashboard tab ----------------
document.getElementById('quickOdoSave').addEventListener('click', () => {
  const vehicle = activeVehicle();
  if (!vehicle) { alert('Add a vehicle first.'); return; }
  const v = Number(document.getElementById('quickOdoInput').value);
  if (!v || v < 0) { alert('Enter a valid mileage.'); return; }
  STATE.odometers[vehicle.id] = v;
  persist();
  document.getElementById('quickOdoInput').value = '';
  renderDashboard();
});

function monthsBetween(dateStr, now = new Date()) {
  const d = new Date(dateStr + 'T00:00:00');
  return (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth()) + (now.getDate() - d.getDate()) / 30;
}

function computeRecommendations(vehicle) {
  const records = STATE.records.filter(r => r.vehicleId === vehicle.id);
  const currentOdo = STATE.odometers[vehicle.id] || 0;

  const lastByType = {};
  for (const r of records) {
    for (const service of r.services) {
      if (!lastByType[service] || r.date > lastByType[service].date || (r.date === lastByType[service].date && r.mileage > lastByType[service].mileage)) {
        lastByType[service] = r;
      }
    }
  }

  const recos = [];
  for (const [service, { miles, months }] of Object.entries(STATE.intervals)) {
    if (miles == null && months == null) continue;
    const last = lastByType[service];

    let status = 'ok', detailParts = [], dueInfo = '';

    if (!last) {
      status = 'due';
      dueInfo = 'No record yet — add one to start tracking';
    } else {
      let milesRemaining = null, monthsRemaining = null;
      if (miles != null && currentOdo) milesRemaining = (last.mileage + miles) - currentOdo;
      if (months != null) monthsRemaining = months - monthsBetween(last.date);

      const overdue = (milesRemaining != null && milesRemaining <= 0) || (monthsRemaining != null && monthsRemaining <= 0);
      const dueSoon = (milesRemaining != null && milesRemaining <= 500) || (monthsRemaining != null && monthsRemaining <= 1);
      status = overdue ? 'overdue' : dueSoon ? 'due' : 'ok';

      if (milesRemaining != null) {
        detailParts.push(milesRemaining <= 0
          ? `${Math.abs(Math.round(milesRemaining)).toLocaleString()} mi overdue`
          : `${Math.round(milesRemaining).toLocaleString()} mi remaining`);
      }
      if (monthsRemaining != null) {
        detailParts.push(monthsRemaining <= 0
          ? `${Math.abs(monthsRemaining).toFixed(1)} mo overdue`
          : `${monthsRemaining.toFixed(1)} mo remaining`);
      }
      dueInfo = `Last done ${last.date} at ${last.mileage.toLocaleString()} mi`;
    }
    recos.push({ service, status, detailParts, dueInfo, hasRecord: !!last });
  }

  const order = { overdue: 0, due: 1, ok: 2 };
  recos.sort((a, b) => order[a.status] - order[b.status]);
  return recos;
}

function renderDashboard() {
  const vehicle = activeVehicle();
  const records = STATE.records.filter(r => vehicle && r.vehicleId === vehicle.id);
  const currentOdo = vehicle ? (STATE.odometers[vehicle.id] || 0) : 0;

  document.getElementById('currentOdoDisplay').textContent = currentOdo ? currentOdo.toLocaleString() + ' mi' : '—';
  document.getElementById('totalRecords').textContent = records.length;
  document.getElementById('totalSpent').textContent = '$' + records.reduce((s, r) => s + (r.cost || 0), 0).toFixed(2);

  const list = document.getElementById('recommendations');
  list.innerHTML = '';

  if (!vehicle) {
    document.getElementById('overdueCount').textContent = 0;
    list.innerHTML = '<p class="empty-msg">Add a vehicle (top right) to see maintenance recommendations.</p>';
    return;
  }

  const recos = computeRecommendations(vehicle);
  document.getElementById('overdueCount').textContent = recos.filter(r => r.status === 'overdue').length;

  if (!recos.length) {
    list.innerHTML = '<p class="empty-msg">No intervals configured. Add some in Settings.</p>';
    return;
  }
  for (const r of recos) {
    const div = document.createElement('div');
    div.className = `reco-item status-${r.status}`;
    const badgeText = r.status === 'overdue' ? 'Overdue' : r.status === 'due' ? 'Due Soon' : 'OK';
    div.innerHTML = `
      <div>
        <div class="reco-title">${r.service}</div>
        <div class="reco-detail">${r.dueInfo}${r.detailParts.length ? ' · ' + r.detailParts.join(' · ') : ''}</div>
      </div>
      <div class="reco-badge">${badgeText}</div>
    `;
    list.appendChild(div);
  }
}

// ---------------- render all ----------------
function renderAll() {
  renderVehicleSelect();
  renderDashboard();
  renderHistory();
  renderVehiclesTable();
  renderIntervalsTable();
  renderEmailStatus();
  renderServiceChips([]);
}

// ---------------- init ----------------
(async function init() {
  await hydrateFromServerIfEmpty();
  if (!STATE.vehicles.length) {
    openVehicleModal();
  }
  renderAll();
})();
