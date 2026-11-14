/** Browser checks: start `node dev/server.js` first, then `node dev/e2e.js [screenshot-dir]`. */
const assert = require('assert');
const { chromium } = require('playwright');

const URL = 'http://localhost:' + (process.env.PORT || 8765);
const shots = process.argv[2];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async name => { if (shots) await page.screenshot({ path: shots + '/' + name + '.png', fullPage: true }); };
  const text = sel => page.locator(sel).first().innerText();
  const tileValue = async label => (await page.locator('.tile', { hasText: label }).first().locator('.numeral').innerText()).trim();

  await page.goto(URL);
  await page.waitForSelector('h1.display');
  assert.match(await text('.empty .title'), /Start your first project/);
  await shot('01-empty');

  // --- Worked example from the spec: 90% complete, $550 over ---
  await page.click('[data-act="new-project"]');
  await page.fill('#pName', 'Worked Example');
  assert.ok(await page.locator('.choice.is-disabled', { hasText: 'Commercial' }).count(), 'commercial unavailable until template is loaded');
  await page.click('#dlg button[type=submit]');
  await page.waitForSelector('#budgetTable');
  const setBudget = async (name, amount) => {
    const input = page.locator('tr.line', { has: page.locator('.lname', { hasText: new RegExp('^' + name.replace(/[/()]/g, '\\$&') + '$') }) }).first().locator('.cell-in');
    await input.fill(String(amount));
    await input.press('Enter');
  };
  await setBudget('Footing / Slab', '36,800');
  await setBudget('Lumber', 20700);
  await setBudget('Framing', 14075);
  await page.waitForTimeout(300);
  assert.match(await text('tr.total'), /\$71,575/);
  await shot('02-budget-entry');
  await page.click('[data-act="finalize"]');
  await page.click('#dlg button[type=submit]');
  await page.waitForSelector('text=Budget finalized');

  const addCost = async (line, amount, vendor) => {
    await page.keyboard.press('n');
    await page.waitForSelector('#cLine');
    await page.fill('#cLine', line);
    await page.locator('.ta-opt', { hasText: line }).first().dispatchEvent('mousedown');
    await page.fill('#cAmount', String(amount));
    await page.fill('#cVendor', vendor);
    await page.fill('#cNote', 'test');
    await page.click('#dlg button[type=submit]');
    await page.waitForSelector('#dlg', { state: 'detached' });
  };
  await addCost('Footing / Slab', 35900, 'Ironwood Concrete');
  await addCost('Lumber', 12000, 'Mesa Lumber');
  await addCost('Lumber', 10150, 'Mesa Lumber');
  await addCost('Framing', 7000, 'Ridgeline Framing');

  // Mark Footing / Slab done through the drill-down panel.
  await page.locator('tr.line', { hasText: 'Footing / Slab' }).first().click();
  await page.waitForSelector('.panel');
  assert.match(await text('.panel'), /Ironwood Concrete/);
  await page.click('.panel [data-act="toggle-done"]');
  await page.waitForSelector('.panel .done-chip');
  await page.keyboard.press('Escape');

  // Drill-down on Lumber: two entries, grouped by vendor, quick add then undo.
  await page.locator('tr.line', { hasText: 'Lumber' }).first().click();
  assert.match(await text('.panel'), /\$22,150\.00/);
  await page.click('[data-act="toggle-group"]');
  assert.match(await text('.panel .entry.is-sub'), /Mesa Lumber/i);
  await page.fill('#qAmount', '99');
  await page.fill('#qVendor', 'Mesa Lumber');
  await page.keyboard.press('Enter');
  await page.waitForSelector('text=$22,249.00');
  await page.locator('.toast button').last().click();
  await page.waitForSelector('.panel >> text=$22,150.00');
  await shot('03-line-panel');
  await page.keyboard.press('Escape');

  await page.click('.seg >> text=Dashboard');
  assert.strictEqual(await tileValue('Percent complete'), '90%');
  assert.strictEqual(await tileValue('Projected over / under'), '$550 over');
  assert.strictEqual(await tileValue('Spent to date'), '$65,050');
  assert.match(await text('.card:has-text("Needs attention")'), /Lumber[\s\S]*\$1,450 over/);

  // Change order: +8,000 budget on Flatwork, +9,600 contract.
  await page.click('.seg >> text=Change orders');
  await page.click('[data-act="new-co"]');
  await page.fill('#oDesc', 'Add covered patio');
  await page.selectOption('#oLine', { label: 'Flatwork' });
  await page.fill('#oBudget', '8000');
  await page.fill('#oContract', '9600');
  await page.click('#dlg button[type=submit]');
  assert.strictEqual(await tileValue('Current contract'), '$81,175');
  await page.click('.seg >> text=Dashboard');
  // contract 81,175 - forecast (72,125 + 8,000) = 1,050 profit
  assert.match(await page.locator('.tile', { hasText: 'Projected margin' }).innerText(), /\$1,050 profit/);

  // Costs ledger: search, sort, edit, delete with undo.
  await page.click('.seg >> text=Costs');
  assert.match(await text('.bar-right .body-2'), /4 entries/);
  await page.fill('#q', 'mesa');
  await page.waitForSelector('text=2 entries');
  assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'q', 'search keeps focus while typing');
  await page.click('[data-act="clear-ledger"]');
  await page.locator('tr.line', { hasText: 'Ridgeline' }).click();
  await page.fill('#cAmount', '7500');
  await page.click('#dlg button[type=submit]');
  await page.waitForSelector('text=$7,500.00');
  await page.locator('tr.line', { hasText: 'Ridgeline' }).click();
  await page.click('[data-act="delete-cost"]');
  await page.waitForSelector('text=3 entries');
  await page.locator('.toast button').last().click();
  await page.waitForSelector('text=4 entries');
  // duplicate warning
  await page.keyboard.press('n');
  await page.fill('#cLine', 'Framing');
  await page.locator('.ta-opt', { hasText: 'Framing' }).first().dispatchEvent('mousedown');
  await page.fill('#cAmount', '7500');
  await page.fill('#cVendor', 'ridgeline framing');
  await page.click('#dlg button[type=submit]');
  assert.match(await text('#dlgError'), /duplicate/);
  await page.keyboard.press('Escape');

  // --- Demo project: totals from the spreadsheet ---
  await page.click('.side-item >> text=Settings');
  await page.click('[data-act="load-demo"]');
  await page.waitForSelector('h1:has-text("Demo: Lot 226")');
  await shot('04-dashboard');
  await page.click('.seg >> text=Budget');
  await page.uncheck('#hideEmpty', { force: true });
  assert.match(await text('tr.total'), /\$558,649/);
  assert.match(await text('tr.grand'), /\$588,649/);
  assert.match(await text('tr.grand'), /Contract price \$588,649/);
  assert.match(await text('tr.line.fee'), /Admin Fee[\s\S]*\$30,000[\s\S]*\$15,000/);
  await shot('05-budget');
  await page.click('.seg >> text=Dashboard');
  assert.match(await page.locator('.tile', { hasText: 'Percent complete' }).innerText(), /excluding land/);
  assert.strictEqual(await tileValue('Spent to date'), '$301,340');

  // Vendors, merge.
  await page.click('.side-item >> text=Vendors');
  await page.fill('#q', 'mesa');
  await page.locator('tr.line', { has: page.locator('.lname', { hasText: /^Mesa Lumber$/ }) }).click();
  await page.click('[data-act="merge-vendor"]');
  await page.selectOption('#mInto', { label: 'Mesa Lumber Supply' });
  await page.click('#dlg button[type=submit]');
  await page.waitForSelector('h1:has-text("Mesa Lumber Supply")');
  assert.strictEqual(await tileValue('Projects'), '2');
  await shot('06-vendor');

  // Settings: load a commercial template, then commercial becomes available.
  await page.click('.side-item >> text=Settings');
  await page.click('[data-act="tpl-type"][data-type="Commercial"]');
  await page.fill('#tplPaste', 'Sitework, Erosion control\nSitework, Paving\nShell\tStructural steel');
  await page.click('[data-act="tpl-import"]');
  await page.waitForSelector('text=2 categories · 3 line items');
  await shot('07-settings');
  await page.click('.side-item >> text=Projects');
  await page.click('[data-act="new-project"]');
  assert.strictEqual(await page.locator('.choice.is-disabled').count(), 0);
  await page.keyboard.press('Escape');

  await page.click('.side-item >> text=Overview');
  await page.waitForSelector('.gt');
  await shot('08-overview');

  // Everything was saved: a fresh load shows the same numbers.
  await page.waitForTimeout(500);
  await page.reload();
  await page.waitForSelector('.gt');
  await page.locator('tr.line', { hasText: 'Worked Example' }).click();
  assert.strictEqual(await tileValue('Spent to date'), '$65,550');
  assert.strictEqual(page.url().split('#')[1].split('/')[2], 'dashboard');
  await page.goBack();
  await page.waitForSelector('h1:has-text("Overview")');

  // Narrow window still works.
  await page.setViewportSize({ width: 390, height: 800 });
  await page.locator('tr.line', { hasText: 'Demo' }).click();
  await page.waitForSelector('.tiles');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'no horizontal scroll at phone width (' + overflow + ')');
  await shot('09-phone');

  assert.deepStrictEqual(errors, [], 'no console errors');
  await browser.close();
  console.log('e2e passed');
})().catch(e => { console.error(e); process.exit(1); });
