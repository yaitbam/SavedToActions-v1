const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.WEB_URL || 'http://localhost:5173';
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const secret = 'SQLITE_FAILURE internal-provider-secret stack trace at /private/server';
    let status = 404, authenticated = false;
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/auth/session') {
        if (status !== 200) return route.fulfill({ status, json: { error: 'not_found', detail: secret } });
        return route.fulfill({ json: { authenticated, kind: 'user', profile_complete: true, csrf_token: 'safe-test', name: 'Test user', email: 'test@example.test' } });
      }
      if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 500, json: { error: 'SQLITE_FAILURE', detail: secret } });
      return route.continue();
    });
    await page.goto(base + '/login');
    await page.getByRole('heading', { name: 'Saved is not done. Sign in to start' }).waitFor();
    await page.getByRole('alert').filter({ hasText: 'Something went wrong' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Continue with Google' }).isDisabled(), true);
    assert.ok(!/not_found|SQLITE_FAILURE|internal-provider-secret|stack trace/.test(await page.locator('body').innerText()));
    const out = path.resolve(__dirname, '../artifacts/auth'); await fs.mkdir(out, { recursive: true });
    await page.screenshot({ path: path.join(out, 'login-retry-1440.png'), fullPage: true });
    status = 200;
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('link', { name: 'Continue with Google' }).waitFor();
    authenticated = true;
    await page.goto(base + '/app/saves');
    await page.getByRole('alert').waitFor();
    assert.ok((await page.getByRole('alert').innerText()).includes('Something went wrong'));
    assert.ok(!(await page.locator('body').innerText()).includes(secret));
    const result = await page.evaluate(async () => {
      const { errorText } = await import('/src/api/errors.ts');
      const { ApiError } = await import('/src/api/client.ts');
      return [errorText(new ApiError(500, { error: 'raw_code', detail: 'secret' })), errorText(new Error('secret')), errorText(new ApiError(400, { error: 'unsupported_image', detail: 'secret' }))];
    });
    assert.deepEqual(result, ['Something went wrong. Please try again', 'Something went wrong. Please try again', 'Use a PNG, JPEG or WebP image']);
    console.log('PASS: missing session shows login with retry, recovery works, technical errors never appear, known validation stays useful');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
