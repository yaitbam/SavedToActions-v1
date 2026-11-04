// Local browser regression for screenshot previews. All API requests are intercepted.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.WEB_URL || 'http://localhost:5173';
const out = path.resolve(__dirname, '../artifacts/upload');

async function main() {
  await fs.mkdir(out, { recursive: true });
  const bytes = await fs.readFile(path.resolve(__dirname, '../public/demo/03.png'));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [], uploads = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      window.previewUrls = { created: [], revoked: [] };
      URL.createObjectURL = blob => {
        const url = create(blob);
        window.previewUrls.created.push(url);
        return url;
      };
      URL.revokeObjectURL = url => {
        window.previewUrls.revoked.push(url);
        return revoke(url);
      };
    });
    await page.route('**/api/**', async route => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (!pathname.startsWith('/api/')) return route.continue();
      if (request.method() !== 'GET') {
        uploads.push(request);
        return route.fulfill({ status: 503, json: { error: 'model_failed' } });
      }
      return route.fulfill({ json: pathname === '/api/goals' ? [] : { items: [], total: 0, limit: 100, offset: 0 } });
    });
    await page.route('**/auth/session', route => route.fulfill({ json: { authenticated: true, kind: 'owner', profile_complete: true, name: 'Test owner', email: 'owner@example.test', csrf_token: 'test-csrf' } }));
    await page.goto(base + '/app/saves');
    await page.getByRole('heading', { name: 'Saves', exact: true }).waitFor();

    const transfer = async type => {
      await page.evaluate(({ data, type }) => {
        const file = new File([Uint8Array.from(data)], 'dropped.png', { type: 'image/png' });
        const transfer = new DataTransfer();
        transfer.items.add(file);
        const event = type === 'paste'
          ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
          : new DragEvent(type, { dataTransfer: transfer, bubbles: true, cancelable: true });
        document.querySelector('main').dispatchEvent(event);
      }, { data: [...bytes], type });
    };
    const dialog = page.getByRole('dialog', { name: 'New save', exact: true });
    const preview = dialog.getByAltText('Your screenshot', { exact: true });
    const verifyPreview = async () => {
      await dialog.waitFor();
      await preview.evaluate(image => image.decode());
      assert.equal(await preview.evaluate(image => image.naturalWidth), 1080);
      const src = await preview.getAttribute('src');
      assert.equal(await page.evaluate(url => window.previewUrls.revoked.includes(url), src), false,
        'The displayed preview URL is still live');
      return src;
    };
    const verifyReleased = async () => {
      await page.waitForFunction(() => window.previewUrls.created.every(url => window.previewUrls.revoked.includes(url)));
    };

    await transfer('dragover');
    await transfer('drop');
    await verifyPreview();
    assert.equal(uploads.length, 0, 'Dropping a file never uploads before Extract');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: path.join(out, 'drag-preview-1440.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await verifyReleased();

    await transfer('paste');
    await verifyPreview();
    await page.keyboard.press('Escape');
    await verifyReleased();

    await page.getByRole('button', { name: 'New save', exact: true }).click();
    const picker = dialog.locator('input[type="file"]');
    await picker.setInputFiles({ name: 'picked.png', mimeType: 'image/png', buffer: bytes });
    const original = await verifyPreview();
    await picker.setInputFiles({ name: 'replacement.png', mimeType: 'image/png', buffer: bytes });
    const replacement = await verifyPreview();
    assert.notEqual(replacement, original);
    assert.equal(await page.evaluate(url => window.previewUrls.revoked.includes(url), original), true);
    await dialog.getByRole('button', { name: 'Extract', exact: true }).click();
    await dialog.getByRole('alert').waitFor();
    assert.equal(uploads.length, 1);
    assert.ok(uploads[0].postDataBuffer().includes(bytes), 'Upload retains the dropped or selected image bytes');
    assert.ok(uploads[0].postDataBuffer().includes(Buffer.from('filename="replacement.png"')));
    await verifyPreview();
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await verifyReleased();
    assert.deepEqual(errors, []);
    console.log('PASS: drag, paste, picker, replacement, upload bytes, preview cleanup, no browser errors at 1440');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
