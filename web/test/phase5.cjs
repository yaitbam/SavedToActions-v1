// Run against the local seeded API and Vite. Set PLAYWRIGHT_MODULE if Playwright is installed elsewhere.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.WEB_URL || 'http://localhost:5173';
const out = path.resolve(__dirname, '../artifacts/phase5');

async function capture(page, name) {
  await page.evaluate(() => document.fonts.ready);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
  // Load offscreen thumbnails before capture. A full-page capture does not trigger lazy image loading.
  for (const image of await page.locator('main img').all()) {
    await image.scrollIntoViewIfNeeded();
    await image.evaluate(element => element.decode());
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  // The first Saves viewport contains only demo posts. Keep personal saves out of proof images.
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: name !== 'saves-1440' });
}

async function receiptContrast(receipt) {
  const colors = await receipt.evaluate(element => {
    const style = getComputedStyle(element);
    return [style.color, style.backgroundColor];
  });
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
    .map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const [fg, bg] = colors.map(luminance);
  const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  assert.ok(ratio >= 4.5, `Receipt text contrast ${ratio.toFixed(2)}:1`);
  return ratio;
}

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const checks = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    const writes = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/*', (route) => {
      const req = route.request();
      if (req.method() !== 'GET') { writes.push(req.url()); return route.abort(); }
      return route.continue();
    });
    const read = async (endpoint) => {
      const response = await context.request.get(base + endpoint);
      assert.equal(response.status(), 200, endpoint);
      return response.json();
    };
    const [insights, settings, saves, auth] = await Promise.all([
      read('/api/insights'), read('/api/settings'), read('/api/saves?limit=100'), read('/auth/status'),
    ]);
    assert.ok(insights.totals.demoSaves > 0, 'Existing seeded demo records');
    await page.goto(base + '/app/progress');
    for (const goal of insights.goals) {
      const card = page.locator('section').filter({ has: page.getByRole('heading', { name: goal.name, exact: true }) });
      await card.waitFor();
      const m = goal.metrics;
      const expected = [m.importedSaves, m.planned, m.markedDone, m.deadlinePassedWithoutCompletion,
        m.actionRate === null ? 'Missing' : `${Math.round(m.actionRate * 100)}%`, `${m.timeScheduledMin} min`].map(String);
      assert.deepEqual(await card.locator('dd').allTextContents(), expected);
    }
    await page.getByRole('heading', { name: 'Upcoming deadlines' }).waitFor();
    assert.equal(await page.getByRole('img', { name: /^Cumulative imported saves/ }).count(), 1);
    const firstRecord = insights.weekly.findIndex(week => week.importedSaves > 0 || week.doneSaves > 0);
    const chartWeeks = firstRecord < 0 ? [] : insights.weekly.slice(Math.max(0, firstRecord - 1));
    assert.deepEqual(await page.locator('svg[role="img"] text[y="184"]').allTextContents(), chartWeeks.map(week => week.label));
    assert.equal(await page.getByRole('row').count(), chartWeeks.length + 1);
    await page.getByRole('button', { name: 'How we count' }).click();
    await page.getByText('Action rate is saves you marked done divided by saves imported, per goal. Completions are self reported', { exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await capture(page, 'progress-1440');
    checks.push('Seeded Progress: six metrics match API per goal, weekly chart, deadlines, counting popover');

    await page.goto(base + '/app/settings');
    await page.getByLabel('Start', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Start', { exact: true }).inputValue(), settings.workStart);
    assert.equal(await page.getByLabel('End', { exact: true }).inputValue(), settings.workEnd);
    assert.equal(await page.getByLabel('Timezone', { exact: true }).inputValue(), settings.tz || '');
    assert.equal(await page.getByLabel('Ignore all-day events').isChecked(), settings.ignoreAllDay);
    await page.getByText(auth.connected ? 'Connected' : 'Not connected', { exact: true }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Save settings', exact: true }).isDisabled());
    await capture(page, 'settings-1440');
    checks.push('Seeded Settings: hours, timezone, all-day preference, goal names, Google status at 1440');

    await page.goto(base + '/app/saves');
    await page.getByText(`${saves.total} of ${saves.total} saves`, { exact: true }).waitFor();
    for (const [filter, status] of [['Needs review', 'open'], ['Planned', 'planned'], ['Done', 'done']]) {
      await page.getByRole('button', { name: filter, exact: true }).click();
      assert.equal(await page.locator('main a[href^="/app/saves/"]').count(), saves.items.filter(s => status === 'open' ? !s.action || s.action.status === status : s.action?.status === status).length);
    }
    await page.getByRole('button', { name: 'All', exact: true }).click();
    const named = saves.items.find(s => s.action?.title);
    await page.getByRole('searchbox').fill(named.action.title);
    const card = page.locator('main a[href^="/app/saves/"]').first();
    assert.ok(await card.count() > 0);
    assert.equal(await card.locator('button, a').count(), 0, 'Whole card is one link with no nested controls');
    await card.locator('img').click();
    await page.waitForURL(base + '/app/saves/' + named.saveId);
    await page.goBack();
    await page.getByRole('searchbox').fill('no matching saved post in this test');
    await page.getByText('No saves match these filters').waitFor();
    await page.getByRole('searchbox').fill('');
    assert.equal(await page.getByText('Review save', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Imported demo data', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Demo', { exact: true }).count(), saves.items.filter(save => save.isDemo).length);
    for (const card of await page.locator('main a[href^="/app/saves/"]').all()) {
      assert.equal(await card.locator('span').filter({ hasText: /^(Fits|Conflict|Doesn.t fit|Done|Planned|Needs review|Skipped|Needs input|Error|Calendar changed)$/ }).count(), 1);
    }
    await capture(page, 'saves-1440');
    const thumbnails = await page.locator('main img').evaluateAll(images => images.map(image => ({
      src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight, loaded: image.complete,
    })));
    assert.equal(thumbnails.length, saves.items.length);
    assert.ok(thumbnails.every(image => image.loaded && image.width > 0 && image.height > 0));
    await fs.writeFile(path.join(out, 'thumbnails.json'), JSON.stringify(thumbnails, null, 2));
    checks.push(`Seeded Saves: search, filters, whole-card links, Demo chips, one status, ${thumbnails.length} decoded thumbnails`);
    assert.deepEqual(writes, [], 'Seeded checks are read only');

    let stored = { ...settings }, failGoal = true, goalWrites = 0, settingWrites = 0;
    await page.route('**/api/settings', route => {
      if (route.request().method() === 'GET') return route.fulfill({ json: stored });
      settingWrites++;
      const body = route.request().postDataJSON();
      if (body.tz === 'invalid/zone') return route.fulfill({ status: 400, json: { error: 'invalid_timezone' } });
      stored = body;
      return route.fulfill({ json: stored });
    });
    await page.route('**/api/goals/*', route => {
      goalWrites++;
      if (failGoal) return route.fulfill({ status: 503, json: { error: 'unavailable' } });
      return route.fulfill({ json: { id: Number(new URL(route.request().url()).pathname.split('/').pop()), ...route.request().postDataJSON() } });
    });
    await page.goto(base + '/app/settings');
    await page.getByLabel('End', { exact: true }).fill('08:00');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Working hours must end after they start').waitFor();
    assert.equal(settingWrites, 0);
    await page.getByLabel('End', { exact: true }).fill('24:00');
    await page.getByLabel('Timezone', { exact: true }).fill('invalid/zone');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Use a valid IANA timezone, such as Africa/Casablanca', { exact: true }).waitFor();
    await page.getByLabel('Timezone', { exact: true }).fill(settings.tz);
    await page.getByLabel('Ignore all-day events').uncheck();
    await page.getByLabel(`Goal ${insights.goals[0].id} name`, { exact: true }).fill('Test goal name');
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText(/Some changes were saved/).waitFor();
    failGoal = false;
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await page.getByText('Settings saved', { exact: true }).waitFor();
    assert.equal(settingWrites, 2, 'Retry only writes the remaining failed goal');
    assert.equal(goalWrites, 2);
    assert.equal(stored.workEnd, '24:00');
    assert.equal(stored.ignoreAllDay, false);
    checks.push('Intercepted Settings: validation, timezone error, midnight, rename, partial-save retry');

    let action = { ...named.action, id: 91001, saveId: 91001, title: 'Phase 5 browser test', status: 'planned' };
    const slot = { startUtc: '2026-11-05T10:00:00Z', endUtc: '2026-11-05T10:30:00Z', tz: 'Africa/Casablanca', durationMin: 30,
      startDisplay: 'Thu 5 Nov 2026, 10:00 (+00:00)', endDisplay: 'Thu 5 Nov 2026, 10:30 (+00:00)', startRelative: 'Thu 10:00', endRelative: 'Thu 10:30', rangeRelative: 'Thu 10:00 to 10:30' };
    action.block = { ...slot, id: 91001, readback: { status: 'ok', drift: [], driftDisplay: [] } };
    action.effort = { ...action.effort, confirmed: true, confirmedMin: 30 };
    action.check = { state: 'amber', conflicts: [{ title: 'Test meeting' }], alternative: slot };
    let moves = 0;
    await page.route('**/api/saves/91001', route => route.fulfill({ json: { ...named, saveId: 91001, action } }));
    await page.route('**/api/actions/91001/move', route => {
      assert.equal(route.request().postDataJSON().approved, true);
      moves++;
      action = { ...action, check: null };
      return route.fulfill({ json: { action, block: action.block, previous: { id: 91000, eventDeleted: true } } });
    });
    await page.route('**/api/actions/91001/done', route => {
      assert.equal(route.request().postDataJSON().approved, true);
      action = { ...action, status: 'done' };
      return route.fulfill({ json: { action } });
    });
    await page.goto(base + '/app/saves/91001');
    const booked = page.getByRole('status').filter({ hasText: /^Booked / });
    await booked.waitFor();
    const contrast = await receiptContrast(booked);
    await page.getByRole('button', { name: 'Move to Thu 10:00', exact: true }).click();
    await page.getByText('Moved to Thu 10:00 to 10:30. Calendar matched start, end and timezone', { exact: true }).waitFor();
    assert.equal(moves, 1);
    await capture(page, 'review-moved-1440');
    await page.getByRole('button', { name: 'Mark done', exact: true }).click();
    await page.getByText('Marked done · Self reported', { exact: true }).waitFor();
    await capture(page, 'review-done-1440');
    checks.push('Intercepted Review: approved Move receipt and Marked done · Self reported copy');
    checks.push(`Success receipt text contrast: ${contrast.toFixed(2)}:1 (minimum 4.5:1)`);
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ width: 1440, checks, runtimeErrors: errors, liveWrites: writes }, null, 2));
    console.log(checks.map(check => 'PASS: ' + check).join('\n'));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
