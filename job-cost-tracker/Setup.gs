/**
 * Job Cost Tracker - one-time setup, the residential template, demo data and backups.
 */

// Category -> line items. "*fee" marks the contractor's fee; "*x" excludes a line from percent complete.
var RESIDENTIAL_TEMPLATE = [
  ['Planning', ['Admin Fee*fee', 'Engineering', 'Financing Cost', 'Legal', 'Permit – Building',
    'Permit – Water', 'Permit – Zoning', 'Review']],
  ['Site Prep', ['Dumpster / Waste Removal', 'Equipment Rental', 'Lot Clearing',
    'Portable Restroom', 'Demolition', 'Temporary Power']],
  ['Earthwork / Excavation', ['Backfill', 'Compaction', 'Foundation Excavation',
    'Retaining Walls', 'Rough Grading', 'Survey']],
  ['Foundation', ['Footing / Slab', 'Hardware', 'Flatwork', 'Basement', 'Waterproofing']],
  ['Rough Framing', ['Lumber', 'Fasteners / Nails / Hardware', 'Framing', 'Roof Framing / Trusses']],
  ['Doors / Windows (Exterior)', ['Exterior Doors', 'Exterior Windows', 'Garage Doors']],
  ['Finish Exterior', ['Stucco', 'Soffit', 'Siding', 'Brick / Stone', 'Paint', 'Stain', 'Block']],
  ['Roofing', ['Tile', 'Shingle', 'Membrane', 'Roof Vents', 'Skylights', 'Flashing']],
  ['Insulation', ['Batts', 'Blown In', 'Foam', 'Blower Door Test']],
  ['Plumbing', ['Underground', 'Top-Out', 'Finish', 'Piping – Gas', 'Piping – Water',
    'Sewer to Home', 'Tubs / Showers', 'Plumbing (general)']],
  ['Electrical', ['Underground', 'Top-Out', 'Finish', 'Lighting Control', 'Intercom', 'Security',
    'Home Theater', 'Electrical (general)']],
  ['HVAC', ['5 Ton Gas Unit', '4 Ton Gas Unit', '3 Ton Gas Unit', 'Mini-Split']],
  ['Drywall / Plaster', ['Home', 'Soffits', 'Decorative Plaster']],
  ['Finish Interior', ['Cabinets', 'Base / Case / Knobs etc.', 'Flooring', 'Interior Doors',
    'Interior Paint', 'Wainscoting', 'Counter Tops', 'Glass']],
  ['Appliances', ['Appliances']],
  ['Landscaping / Exterior', ['Driveway', 'Fencing', 'Irrigation', 'Landscaping', 'Gutters']],
  ['Utilities', ['Power Connection', 'Gas Connection', 'Water / Sewer Connection']],
  ['Closeout', ['Final Cleaning', 'Punch List']],
  ['Contingency', ['Contingency']],
  ['Land', ['Lot Purchase*x']]
];

function setup() {
  withLock_(function () { ensureSetup_(); });
}

/** Creates missing tabs and columns, and seeds the residential template once. */
function ensureSetup_() {
  var ss = getSs_();
  Object.keys(SCHEMA).forEach(function (tab) {
    var cols = SCHEMA[tab];
    var sheet = ss.getSheetByName(tab);
    if (!sheet) {
      sheet = ss.insertSheet(tab);
      sheet.getRange(1, 1, 1, cols.length).setValues([cols]);
      formatTab_(sheet, cols);
      return;
    }
    var lastCol = sheet.getLastColumn();
    var header = lastCol ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String) : [];
    var missing = cols.filter(function (c) { return header.indexOf(c) < 0; });
    if (missing.length) {
      sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
      formatTab_(sheet, header.concat(missing));
    }
  });
  var meta = {};
  readTable_(ss, 'Meta').forEach(function (m) { meta[m.id] = m.value; });
  if (!meta.templateSeeded) {
    var ops = templateOps_('Residential', RESIDENTIAL_TEMPLATE);
    ops.push({ op: 'upsert', tab: 'Meta', obj: { id: 'templateSeeded', value: 'yes' } });
    ops.push({ op: 'upsert', tab: 'Meta', obj: { id: 'schemaVersion', value: '1' } });
    applyOps_(ops);
  }
}

/** Bold frozen header; text columns are formatted as plain text so Sheets never reinterprets them. */
function formatTab_(sheet, header) {
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  var rows = sheet.getMaxRows();
  header.forEach(function (col, i) {
    if (isTextCol_(col)) sheet.getRange(1, i + 1, rows, 1).setNumberFormat('@');
  });
}

function templateOps_(type, template) {
  var ops = [];
  template.forEach(function (cat, ci) {
    cat[1].forEach(function (raw, li) {
      var name = raw.replace(/\*(fee|x)$/, '');
      ops.push({ op: 'upsert', tab: 'Templates', obj: {
        id: 'tpl_' + type.substring(0, 3).toLowerCase() + '_' + (ci + 1) + '_' + (li + 1),
        type: type, category: cat[0], categoryOrder: ci + 1, lineItem: name, lineOrder: li + 1,
        fee: /\*fee$/.test(raw), excludeProgress: /\*x$/.test(raw), active: true
      } });
    });
  });
  return ops;
}

/* ---------- Demo project (the sample job from the cost breakdown spreadsheet) ---------- */

var DEMO_BUDGET = {
  'Planning|Admin Fee': 30000, 'Planning|Engineering': 3000, 'Planning|Permit – Building': 12000,
  'Planning|Permit – Water': 17000, 'Planning|Permit – Zoning': 150,
  'Site Prep|Dumpster / Waste Removal': 6370, 'Site Prep|Lot Clearing': 1500,
  'Earthwork / Excavation|Backfill': 2500, 'Earthwork / Excavation|Foundation Excavation': 2500,
  'Earthwork / Excavation|Survey': 2000,
  'Foundation|Footing / Slab': 36800, 'Foundation|Flatwork': 8280,
  'Rough Framing|Lumber': 20700, 'Rough Framing|Framing': 14075,
  'Rough Framing|Roof Framing / Trusses': 17750,
  'Doors / Windows (Exterior)|Exterior Doors': 7750,
  'Doors / Windows (Exterior)|Exterior Windows': 11235,
  'Doors / Windows (Exterior)|Garage Doors': 5315,
  'Finish Exterior|Stucco': 18975, 'Finish Exterior|Block': 7000,
  'Roofing|Tile': 20125,
  'Insulation|Batts': 6440, 'Insulation|Blower Door Test': 230,
  'Plumbing|Plumbing (general)': 19880,
  'Electrical|Finish': 2700, 'Electrical|Electrical (general)': 19250,
  'HVAC|5 Ton Gas Unit': 15234.05,
  'Drywall / Plaster|Home': 16215,
  'Finish Interior|Cabinets': 23275, 'Finish Interior|Flooring': 25000,
  'Finish Interior|Interior Doors': 9625, 'Finish Interior|Interior Paint': 9625,
  'Finish Interior|Counter Tops': 17375, 'Finish Interior|Glass': 2600,
  'Appliances|Appliances': 6175,
  'Land|Lot Purchase': 170000
};

// [category|line, vendor, amount, date, note, marks the line done]
var DEMO_COSTS = [
  ['Land|Lot Purchase', 'Burke Springs Title Co.', 170000, '2026-05-12', 'Lot closing', true],
  ['Planning|Engineering', 'Summit Structural Engineering', 3200, '2026-05-20', 'Inv 1042', true],
  ['Planning|Permit – Building', 'City Building Department', 12000, '2026-06-02', '', true],
  ['Planning|Permit – Water', 'Water Conservancy District', 17000, '2026-06-02', 'Impact fee', true],
  ['Planning|Permit – Zoning', 'City Building Department', 150, '2026-06-02', '', true],
  ['Planning|Admin Fee', 'General contractor services', 10000, '2026-07-01', 'GC invoice 1', false],
  ['Planning|Admin Fee', 'General contractor services', 5000, '2026-09-01', 'GC invoice 2', false],
  ['Earthwork / Excavation|Survey', 'Red Rock Surveying', 1850, '2026-06-05', '', true],
  ['Site Prep|Lot Clearing', 'Desert Edge Excavation', 1500, '2026-06-10', '', true],
  ['Earthwork / Excavation|Foundation Excavation', 'Desert Edge Excavation', 2500, '2026-06-18', '', true],
  ['Site Prep|Dumpster / Waste Removal', 'Canyon Waste Services', 1450, '2026-06-20', 'Haul 1', false],
  ['Site Prep|Equipment Rental', 'Sunstate Rentals', 640, '2026-06-24', 'Skid steer, 2 days', false],
  ['Foundation|Footing / Slab', 'Ironwood Concrete', 18000, '2026-07-08', 'Footings', false],
  ['Foundation|Footing / Slab', 'Ironwood Concrete', 17900, '2026-07-22', 'Slab pour', true],
  ['Earthwork / Excavation|Backfill', 'Desert Edge Excavation', 2800, '2026-07-28', 'Extra import fill', true],
  ['Rough Framing|Lumber', 'Mesa Lumber Supply', 12000, '2026-08-04', 'Package 1', false],
  ['Site Prep|Dumpster / Waste Removal', 'Canyon Waste Services', 1450, '2026-08-15', 'Haul 2', false],
  ['Rough Framing|Framing', 'Ridgeline Framing', 7000, '2026-08-20', 'Draw 1', false],
  ['Rough Framing|Lumber', 'Mesa Lumber Supply', 10150, '2026-09-03', 'Package 2', false],
  ['Rough Framing|Roof Framing / Trusses', 'Truss Systems Inc.', 17750, '2026-09-18', '', true],
  ['Foundation|Flatwork', 'Ironwood Concrete', 4000, '2026-10-06', 'Garage apron', false]
];

function loadDemo_() {
  var ss = getSs_();
  var tpl = readTable_(ss, 'Templates').filter(function (t) { return t.type === 'Residential' && t.active; });
  var stamp = new Date().getTime().toString(36);
  var pid = 'demo_' + stamp;
  var ops = [];
  var lineId = {};
  var doneDate = {};
  var total = 0;
  DEMO_COSTS.forEach(function (c) { if (c[5]) doneDate[c[0]] = c[3]; });
  tpl.forEach(function (t, i) {
    var key = t.category + '|' + t.lineItem;
    var id = 'dl_' + stamp + '_' + i;
    lineId[key] = id;
    var budget = DEMO_BUDGET[key] || 0;
    total += budget;
    ops.push({ op: 'upsert', tab: 'LineItems', obj: {
      id: id, projectId: pid, category: t.category, categoryOrder: t.categoryOrder,
      name: t.lineItem, lineOrder: t.lineOrder, originalBudget: budget, forecastOverride: '',
      fee: t.fee, excludeProgress: t.excludeProgress, done: !!doneDate[key],
      doneDate: doneDate[key] || '', hidden: false, notes: ''
    } });
  });
  var vendorId = {};
  var existing = readTable_(ss, 'Vendors');
  existing.forEach(function (v) { vendorId[v.name.toLowerCase()] = v.id; });
  DEMO_COSTS.forEach(function (c, i) {
    var vkey = c[1].toLowerCase();
    if (!vendorId[vkey]) {
      vendorId[vkey] = 'dv_' + stamp + '_' + i;
      ops.push({ op: 'upsert', tab: 'Vendors', obj: { id: vendorId[vkey], name: c[1] } });
    }
    if (!lineId[c[0]]) return;
    ops.push({ op: 'upsert', tab: 'Costs', obj: {
      id: 'dc_' + stamp + '_' + i, projectId: pid, lineItemId: lineId[c[0]],
      vendorId: vendorId[vkey], amount: c[2], date: c[3], note: c[4], created: c[3], deleted: false
    } });
  });
  ops.push({ op: 'upsert', tab: 'Projects', obj: {
    id: pid, name: 'Demo: Lot 226 Residence', type: 'Residential', status: 'Active',
    client: 'Sample client', location: 'Lot 226, Estates at Burke Springs',
    startDate: '2026-05-12', endDate: '2027-03-31', originalContract: round2_(total),
    budgetFinal: true, notes: 'Sample job loaded from the cost breakdown spreadsheet. Safe to archive.',
    created: '2026-05-12', archived: false
  } });
  applyOps_(ops);
}

/* ---------- Weekly backup ---------- */

var BACKUP_FOLDER = 'Job Cost Tracker Backups';
var BACKUPS_TO_KEEP = 8;

function installBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyBackup').timeBased().everyWeeks(1).create();
  withLock_(function () {
    ensureSetup_();
    applyOps_([{ op: 'upsert', tab: 'Meta', obj: { id: 'backupOn', value: 'yes' } }]);
  });
}

function weeklyBackup() {
  var ss = getSs_();
  var folders = DriveApp.getFoldersByName(BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER);
  var stamp = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  DriveApp.getFileById(ss.getId()).makeCopy(ss.getName() + ' backup ' + stamp, folder);
  var files = [];
  var it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  files.slice(BACKUPS_TO_KEEP).forEach(function (f) { f.setTrashed(true); });
  withLock_(function () {
    applyOps_([{ op: 'upsert', tab: 'Meta', obj: { id: 'lastBackup', value: stamp } }]);
  });
}
