/**
 * Job Cost Tracker - web app entry points and the functions the page calls.
 */

var APP_VERSION = '1.0.0';

function doGet() {
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle('Job Cost Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Job Cost Tracker')
    .addItem('Set up / repair tabs', 'setup')
    .addItem('Load demo project', 'menuLoadDemo')
    .addItem('Turn on weekly backup', 'installBackupTrigger')
    .addToUi();
}

/** Returns everything the app needs, as a JSON string. */
function apiLoad() {
  return withLock_(function () {
    ensureSetup_();
    return JSON.stringify(loadAll_());
  });
}

function loadAll_() {
  var ss = getSs_();
  var meta = {};
  readTable_(ss, 'Meta').forEach(function (m) { meta[m.id] = m.value; });
  return {
    version: APP_VERSION,
    sheetUrl: ss.getUrl(),
    today: Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
    meta: meta,
    projects: readTable_(ss, 'Projects'),
    templates: readTable_(ss, 'Templates'),
    lineItems: readTable_(ss, 'LineItems'),
    costs: readTable_(ss, 'Costs').filter(function (c) { return !c.deleted; }),
    changeOrders: readTable_(ss, 'ChangeOrders'),
    vendors: readTable_(ss, 'Vendors')
  };
}

/** Saves a batch of changes from the page. */
function apiOps(ops) {
  return withLock_(function () {
    (ops || []).forEach(function (op) {
      if (op && op.tab === 'Meta') throw new Error('Unknown table.');
    });
    applyOps_(ops);
    return 'ok';
  });
}

function apiLoadDemo() {
  return withLock_(function () {
    ensureSetup_();
    loadDemo_();
    return JSON.stringify(loadAll_());
  });
}

function apiInstallBackup() {
  installBackupTrigger();
  return apiLoad();
}

function menuLoadDemo() {
  apiLoadDemo();
}
