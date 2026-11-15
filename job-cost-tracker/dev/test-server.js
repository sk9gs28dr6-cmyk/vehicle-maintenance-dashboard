/** Server-side checks: `node dev/test-server.js` */
const assert = require('assert');
const { createEnv } = require('./fake-gas');

const env = createEnv();
let d = JSON.parse(env.call('apiLoad'));
assert.strictEqual(d.templates.length, 93, 'template has 93 lines');
assert.strictEqual(new Set(d.templates.map(t => t.category)).size, 20, 'template has 20 categories');
assert.strictEqual(d.templates.filter(t => t.fee).map(t => t.lineItem).join(), 'Admin Fee');
assert.strictEqual(d.templates.filter(t => t.excludeProgress).map(t => t.lineItem).join(), 'Lot Purchase');

// Loading twice must not seed the template twice.
d = JSON.parse(env.call('apiLoad'));
assert.strictEqual(d.templates.length, 93);

d = JSON.parse(env.call('apiLoadDemo'));
assert.strictEqual(d.projects.length, 1);
const lines = d.lineItems;
const total = Math.round(lines.reduce((s, l) => s + l.originalBudget, 0) * 100) / 100;
assert.strictEqual(total, 588649.05, 'demo total matches the spreadsheet');
assert.strictEqual(lines.filter(l => l.originalBudget > 0).length, 36, '36 budgeted lines');
assert.strictEqual(d.projects[0].originalContract, 588649.05);
const cat = name => Math.round(lines.filter(l => l.category === name).reduce((s, l) => s + l.originalBudget, 0) * 100) / 100;
const expected = { Planning: 62150, 'Site Prep': 7870, 'Earthwork / Excavation': 7000, Foundation: 45080, 'Rough Framing': 52525,
  'Doors / Windows (Exterior)': 24300, 'Finish Exterior': 25975, Roofing: 20125, Insulation: 6670, Plumbing: 19880, Electrical: 21950,
  HVAC: 15234.05, 'Drywall / Plaster': 16215, 'Finish Interior': 87500, Appliances: 6175, Land: 170000 };
for (const k in expected) assert.strictEqual(cat(k), expected[k], 'subtotal ' + k);

// Upsert merges partial objects, appends new ones, and soft-deleted costs are not returned.
const c0 = d.costs[0];
env.call('apiOps', [[
  { op: 'upsert', tab: 'Costs', obj: { id: c0.id, amount: '1234.567' } },
  { op: 'upsert', tab: 'Costs', obj: { id: 'new1', projectId: c0.projectId, lineItemId: c0.lineItemId, vendorId: c0.vendorId, amount: -50, date: '2026-11-01', note: '=cmd' } },
  { op: 'upsert', tab: 'Costs', obj: { id: d.costs[1].id, deleted: true } }
]]);
let d2 = JSON.parse(env.call('apiLoad'));
assert.strictEqual(d2.costs.find(c => c.id === c0.id).amount, 1234.57);
assert.strictEqual(d2.costs.find(c => c.id === c0.id).vendorId, c0.vendorId, 'partial update keeps other fields');
assert.strictEqual(d2.costs.find(c => c.id === 'new1').amount, -50);
assert.ok(!d2.costs.find(c => c.id === d.costs[1].id), 'deleted cost hidden');
assert.strictEqual(d2.costs.length, d.costs.length);

// Remove, and validation.
env.call('apiOps', [[{ op: 'upsert', tab: 'ChangeOrders', obj: { id: 'co1', projectId: c0.projectId, number: '1', budgetChange: 100, status: 'Approved' } }]]);
env.call('apiOps', [[{ op: 'remove', tab: 'ChangeOrders', id: 'co1' }]]);
assert.strictEqual(JSON.parse(env.call('apiLoad')).changeOrders.length, 0);
assert.throws(() => env.call('apiOps', [[{ op: 'upsert', tab: 'Costs', obj: { id: 'x', amount: 'abc' } }]]), /Invalid number/);
assert.throws(() => env.call('apiOps', [[{ op: 'upsert', tab: 'Nope', obj: { id: 'x' } }]]), /Unknown table/);
assert.throws(() => env.call('apiOps', [[{ op: 'upsert', tab: 'Meta', obj: { id: 'x' } }]]), /Unknown table/);
assert.throws(() => env.call('apiOps', [[{ op: 'upsert', tab: 'Costs', obj: { id: 'bad id!' } }]]), /Invalid id/);

// A date the Sheet has turned into a Date object still comes back as text.
const costs = env.sheets.Costs._data;
costs[1][costs[0].indexOf('date')] = new Date(2026, 4, 12);
assert.strictEqual(JSON.parse(env.call('apiLoad')).costs.find(c => c.id === costs[1][0]).date, '2026-05-12');

// Columns are matched by header name, so a hand-reordered sheet still works.
const v = env.sheets.Vendors._data;
v.forEach(r => r.reverse());
const names = JSON.parse(env.call('apiLoad')).vendors.map(x => x.name);
assert.ok(names.includes('Ironwood Concrete'));
env.call('apiOps', [[{ op: 'upsert', tab: 'Vendors', obj: { id: 'v9', name: 'New Co', trade: 'Paint' } }]]);
assert.strictEqual(JSON.parse(env.call('apiLoad')).vendors.find(x => x.id === 'v9').trade, 'Paint');

console.log('server tests passed');
