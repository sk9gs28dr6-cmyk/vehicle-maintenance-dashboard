/**
 * Job Cost Tracker - data layer.
 * Every tab is a flat table: header row + one record per row, keyed by `id`.
 */

var SCHEMA = {
  Projects: ['id', 'name', 'type', 'status', 'client', 'location', 'startDate', 'endDate',
    'originalContract', 'budgetFinal', 'notes', 'created', 'archived'],
  Templates: ['id', 'type', 'category', 'categoryOrder', 'lineItem', 'lineOrder', 'fee',
    'excludeProgress', 'active'],
  LineItems: ['id', 'projectId', 'category', 'categoryOrder', 'name', 'lineOrder',
    'originalBudget', 'forecastOverride', 'fee', 'excludeProgress', 'done', 'doneDate',
    'hidden', 'notes'],
  Costs: ['id', 'projectId', 'lineItemId', 'vendorId', 'amount', 'date', 'note', 'created',
    'deleted'],
  ChangeOrders: ['id', 'projectId', 'number', 'date', 'description', 'lineItemId',
    'budgetChange', 'contractChange', 'status'],
  Vendors: ['id', 'name', 'trade', 'phone', 'email', 'notes', 'archived'],
  Meta: ['id', 'value']
};

var NUM_COLS = { categoryOrder: 1, lineOrder: 1, originalBudget: 1, amount: 1,
  budgetChange: 1, contractChange: 1 };
// Numbers that may be blank ("not set").
var OPT_NUM_COLS = { originalContract: 1, forecastOverride: 1 };
var BOOL_COLS = { budgetFinal: 1, archived: 1, fee: 1, excludeProgress: 1, active: 1,
  done: 1, hidden: 1, deleted: 1 };
var ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

function getSs_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}

function isTextCol_(col) {
  return !NUM_COLS[col] && !OPT_NUM_COLS[col] && !BOOL_COLS[col];
}

/** Value from a Sheet cell -> clean JSON value for the given column. */
function fromCell_(col, v, tz) {
  if (BOOL_COLS[col]) return v === true || String(v).toUpperCase() === 'TRUE';
  if (NUM_COLS[col]) { var n = Number(v); return isFinite(n) ? round2_(n) : 0; }
  if (OPT_NUM_COLS[col]) {
    if (v === '' || v === null) return '';
    var m = Number(v);
    return isFinite(m) ? round2_(m) : '';
  }
  if (Object.prototype.toString.call(v) === '[object Date]') return Utilities.formatDate(v, tz, 'yyyy-MM-dd');
  return v === null || v === undefined ? '' : String(v);
}

/** Value from the client -> validated value for the given column. Throws on bad input. */
function toCell_(col, v) {
  if (BOOL_COLS[col]) return v === true || v === 'true' || v === 'TRUE';
  if (NUM_COLS[col] || OPT_NUM_COLS[col]) {
    if (v === '' || v === null || v === undefined) {
      if (OPT_NUM_COLS[col]) return '';
      return 0;
    }
    var n = Number(v);
    if (!isFinite(n) || Math.abs(n) > 1e11) throw new Error('Invalid number for ' + col);
    return round2_(n);
  }
  var s = v === null || v === undefined ? '' : String(v);
  if (s.length > 2000) s = s.substring(0, 2000);
  return s;
}

function defaultFor_(col) {
  if (BOOL_COLS[col]) return false;
  if (NUM_COLS[col]) return 0;
  return '';
}

/** Opens a tab and indexes it. Columns are matched by header name, not position. */
function openTab_(ss, tab) {
  var sheet = ss.getSheetByName(tab);
  if (!sheet) throw new Error('Missing tab "' + tab + '". Run setup again.');
  var values = sheet.getDataRange().getValues();
  var header = values.length ? values[0].map(String) : [];
  var colIdx = {};
  header.forEach(function (h, i) { colIdx[h] = i; });
  SCHEMA[tab].forEach(function (c) {
    if (colIdx[c] === undefined) throw new Error('Tab "' + tab + '" is missing column "' + c + '".');
  });
  var idRow = {};
  for (var r = 1; r < values.length; r++) {
    var id = String(values[r][colIdx.id]);
    if (id) idRow[id] = r + 1; // 1-based sheet row
  }
  return { tab: tab, sheet: sheet, values: values, header: header, colIdx: colIdx,
    idRow: idRow, appends: [], pending: {}, removes: [] };
}

function readTable_(ss, tab) {
  var t = openTab_(ss, tab);
  var tz = ss.getSpreadsheetTimeZone();
  var cols = SCHEMA[tab];
  var out = [];
  for (var r = 1; r < t.values.length; r++) {
    var row = t.values[r];
    if (row[t.colIdx.id] === '' || row[t.colIdx.id] === null) continue;
    var o = {};
    for (var c = 0; c < cols.length; c++) o[cols[c]] = fromCell_(cols[c], row[t.colIdx[cols[c]]], tz);
    out.push(o);
  }
  return out;
}

/**
 * Applies a list of operations in one pass.
 *   { op: 'upsert', tab: 'Costs', obj: { id: 'abc', amount: 12 } }  (partial objects merge into the row)
 *   { op: 'remove', tab: 'ChangeOrders', id: 'abc' }
 */
function applyOps_(ops) {
  if (!ops || !ops.length) return;
  if (ops.length > 5000) throw new Error('Too many changes in one save.');
  var ss = getSs_();
  var tabs = {};
  ops.forEach(function (op) {
    if (!op || !SCHEMA[op.tab]) throw new Error('Unknown table.');
    var t = tabs[op.tab] || (tabs[op.tab] = openTab_(ss, op.tab));
    var cols = SCHEMA[op.tab];
    if (op.op === 'upsert') {
      var src = op.obj || {};
      var id = String(src.id || '');
      if (!ID_RE.test(id)) throw new Error('Invalid id.');
      var patch = {};
      cols.forEach(function (c) {
        if (Object.prototype.hasOwnProperty.call(src, c)) patch[c] = toCell_(c, src[c]);
      });
      patch.id = id;
      if (t.pending[id]) {
        for (var k in patch) t.pending[id][k] = patch[k];
      } else if (t.idRow[id]) {
        var rowNum = t.idRow[id];
        var arr = t.values[rowNum - 1];
        for (var k2 in patch) arr[t.colIdx[k2]] = patch[k2];
        t.sheet.getRange(rowNum, 1, 1, arr.length).setValues([arr]);
      } else {
        var full = {};
        cols.forEach(function (c) { full[c] = patch.hasOwnProperty(c) ? patch[c] : defaultFor_(c); });
        t.pending[id] = full;
        t.appends.push(full);
      }
    } else if (op.op === 'remove') {
      var rid = String(op.id || '');
      if (t.idRow[rid]) t.removes.push(t.idRow[rid]);
    } else {
      throw new Error('Unknown operation.');
    }
  });
  Object.keys(tabs).forEach(function (name) {
    var t = tabs[name];
    if (t.appends.length) {
      var width = t.header.length;
      var rows = t.appends.map(function (o) {
        var arr = [];
        for (var i = 0; i < width; i++) arr.push('');
        SCHEMA[name].forEach(function (c) { arr[t.colIdx[c]] = o[c]; });
        return arr;
      });
      t.sheet.getRange(t.sheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
    }
    t.removes.sort(function (a, b) { return b - a; }).forEach(function (rowNum, i, all) {
      if (i > 0 && all[i - 1] === rowNum) return;
      t.sheet.deleteRow(rowNum);
    });
  });
}
