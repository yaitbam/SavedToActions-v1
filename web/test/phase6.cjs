// Run against local Vite. Set PLAYWRIGHT_MODULE if Playwright is installed elsewhere.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.WEB_URL || 'http://localhost:5173';
const out = path.resolve(__dirname, '../artifacts/phase6');

async function main() {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  const requests = [];
  const checks = [];
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const request = route.request();
        const pathname = new URL(request.url()).pathname;
        if (pathname.startsWith('/api/') || pathname.startsWith('/auth/')) {
          requests.push(request.url());
          return route.abort();
        }
        return route.continue();
      });
      await page.goto(base);
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('h1').innerText(), "Don't just\nsave it.\nBook it.");
      assert.equal(await page.getByRole('link', { name: 'Try it', exact: true }).getAttribute('href'), '/app');
      assert.equal(await page.getByRole('link', { name: 'Try it', exact: true }).count(), 1);
      await page.getByRole('link', { name: 'How it works' }).click();
      assert.equal(new URL(page.url()).hash, '#how-it-works');
      for (const image of await page.locator('main img').all()) {
        await image.scrollIntoViewIfNeeded();
        await image.evaluate(element => element.decode());
      }
      await page.waitForFunction(() => Array.from(document.querySelectorAll('main img'))
        .every(image => image.complete && image.naturalWidth > 0));
      assert.equal(await page.locator('main img').count(), 7, 'Three hero fixtures, three product steps and the conflict section');
      assert.deepEqual(await page.locator('.landing-step-list img').evaluateAll(images => images.map(image => image.getAttribute('src'))),
        ['/product/review.png', '/product/receipt.png', '/product/conflict.png']);
      await page.getByRole('heading', { name: 'When your week changes', exact: true }).waitFor();
      for (const open of await page.locator('.landing-note-row button').all()) {
        await open.click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.locator('img').evaluate(image => image.decode());
        assert.equal(await dialog.locator('img').evaluate(image => image.naturalWidth), 1080);
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        assert.ok(await open.evaluate(button => button === document.activeElement), 'Viewer restores focus');
      }
      await page.locator('.landing-step-list button').first().click();
      await page.getByRole('dialog').waitFor();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      const copy = await page.locator('body').innerText();
      assert.ok(!/\d/.test(copy), 'No unsupported numeric claims or build dates');
      assert.ok(copy.includes('Illustrative posts and accounts are fictional.'));
      assert.ok(copy.includes('Imported demo data'));
      assert.ok(copy.includes('The AI proposes.'));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      assert.ok(await page.evaluate(() => Array.from(document.querySelectorAll('main img')).every(image => {
        const rect = image.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= innerWidth;
      })), 'All saved card images fit the viewport');
      await page.evaluate(() => { location.hash = ''; window.scrollTo(0, 0); });
      await page.screenshot({ path: path.join(out, `landing-${width}.png`), fullPage: true });
      checks.push(`${width}: product screenshots, conflict section, viewers, focus restore, anchor, app link, honest copy, no overflow`);
      await context.close();
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    assert.deepEqual(requests, [], 'Landing needs no API or calendar requests');
    await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify({ checks, runtimeErrors: errors, apiRequests: requests }, null, 2) + '\n');
    console.log(checks.map(check => 'PASS: ' + check).join('\n'));
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
