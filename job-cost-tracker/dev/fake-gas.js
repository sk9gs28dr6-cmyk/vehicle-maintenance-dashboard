/**
 * A small in-memory stand-in for the Apps Script services the app uses, so the real
 * .gs files can run under Node for local development and tests. Not deployed.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function createEnv() {
  const sheets = {};
  const order = [];

  function makeSheet(name) {
    const data = []; // rows of cells
    const sheet = {
      getName: () => name,
      getLastRow: () => data.length,
      getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
      getMaxRows: () => Math.max(1000, data.length),
      setFrozenRows() {},
      deleteRow(n) { data.splice(n - 1, 1); },
      appendRow(row) { data.push(row.slice()); },
      getDataRange() { return sheet.getRange(1, 1, Math.max(data.length, 1), Math.max(sheet.getLastColumn(), 1)); },
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = [];
              for (let j = 0; j < nc; j++) {
                const v = (data[r - 1 + i] || [])[c - 1 + j];
                row.push(v === undefined ? '' : v);
              }
              out.push(row);
            }
            return out;
          },
          setValues(vals) {
            if (vals.length !== nr || vals.some(v => v.length !== nc)) throw new Error('setValues size mismatch');
            for (let i = 0; i < nr; i++) {
              while (data.length < r + i) data.push([]);
              for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = vals[i][j];
            }
            return this;
          },
          setFontWeight() { return this; },
          setNumberFormat() { return this; }
        };
      },
      _data: data
    };
    return sheet;
  }

  const ss = {
    getSheetByName: n => sheets[n] || null,
    insertSheet(n) { sheets[n] = makeSheet(n); order.push(n); return sheets[n]; },
    getSpreadsheetTimeZone: () => 'America/Denver',
    getUrl: () => 'https://docs.google.com/spreadsheets/d/dev',
    getId: () => 'dev',
    getName: () => 'Job Cost Tracker (dev)'
  };

  const sandbox = {
    console,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ({ createMenu: () => ({ addItem() { return this; }, addToUi() {} }) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      formatDate(d, tz, fmt) {
        if (process.env.FAKE_TODAY && Math.abs(Date.now() - d.getTime()) < 60000) return process.env.FAKE_TODAY;
        const p = n => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      }
    },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this; }, everyWeeks() { return this; }, create() {} }) },
    HtmlService: {}
  };
  vm.createContext(sandbox);
  const root = path.join(__dirname, '..');
  for (const f of ['Data.gs', 'Code.gs', 'Setup.gs']) {
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), sandbox, { filename: f });
  }
  return { sandbox, ss, sheets, call: (fn, args) => vm.runInContext(fn, sandbox).apply(null, args || []) };
}

/** Renders Index.html the way HtmlService would, resolving include() calls. */
function renderIndex(extraHead) {
  const root = path.join(__dirname, '..');
  let html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
  html = html.replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (m, name) => fs.readFileSync(path.join(root, name + '.html'), 'utf8'));
  return html.replace('<head>', '<head>' + (extraHead || ''));
}

module.exports = { createEnv, renderIndex };
