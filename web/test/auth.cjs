const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const base = process.env.WEB_URL || 'http://localhost:5173';
const out = path.resolve(__dirname, '../artifacts/auth');
const anonymous = { authenticated: false, kind: 'user', profile_complete: false, name: null, email: null, csrf_token: 'anon-token' };
const member = { authenticated: true, kind: 'user', profile_complete: true, name: 'Test member', email: 'member@example.test', csrf_token: 'member-token' };

(async () => {
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let debugPage;
  try {
    const live = await browser.newContext();
    const response = await live.request.get(base + '/auth/session');
    assert.equal(response.status(), 200, 'Live session endpoint');
    const login = await live.newPage();
    await login.goto(base + '/login');
    await login.getByRole('heading', { name: 'Saved is not done. Sign in to start' }).waitFor();
    await login.getByRole('link', { name: 'Continue with Google', exact: true }).waitFor();
    const oauth = await live.request.get(base + '/auth/login/google', { maxRedirects: 0 });
    assert.equal(oauth.status(), 302);
    assert.equal(new URL(oauth.headers().location).hostname, 'accounts.google.com');
    await live.close();
    console.log('PASS live: session endpoint, login screen, Google authorization redirect');
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 } });
      const page = await context.newPage();
      debugPage = page;
      page.setDefaultTimeout(7000);
      const errors = [], writes = [];
      let session = { ...anonymous }, delay = false, expire = false;
      page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname === '/auth/session') {
          if (delay) await new Promise(resolve => setTimeout(resolve, 300));
          return route.fulfill({ json: session });
        }
        if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/auth/')) return route.continue();
        if (req.method() !== 'GET') {
          writes.push(url.pathname);
          assert.equal(req.headers()['x-csrf-token'], session.csrf_token);
          if (url.pathname === '/auth/demo') session = { ...member, kind: 'demo', name: 'Demo', email: null };
          else if (url.pathname === '/api/me') { session = { ...member, name: req.postDataJSON().name }; }
          else if (url.pathname === '/auth/logout') session = { ...anonymous };
          else throw new Error('Unexpected write: ' + url.pathname);
          return route.fulfill({ json: {} });
        }
        if (expire) { session = { ...anonymous }; return route.fulfill({ status: 401, json: { error: 'unauthenticated' } }); }
        if (url.pathname === '/api/home') return route.fulfill({ json: { now: { display: 'GMT+0', tz: null }, google_connected: false, upcoming: [], needs_attention: [], recent_saves: [], inbox: { needs_effort: 0 }, next_up: null } });
        if (url.pathname === '/api/settings') return route.fulfill({ json: { workStart: '09:00', workEnd: '21:00', tz: null, ignoreAllDay: true } });
        if (url.pathname === '/api/goals') return route.fulfill({ json: [] });
        if (url.pathname === '/auth/status') return route.fulfill({ json: { configured: true, connected: false, hasRefreshToken: false, missingScopes: [] } });
        return route.fulfill({ json: { items: [], total: 0, limit: 100, offset: 0 } });
      });
      const capture = async name => {
        await page.evaluate(() => document.fonts.ready);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await page.screenshot({ path: path.join(out, `${name}-${width}.png`), fullPage: true });
      };
      delay = true;
      await page.goto(base + '/app/saves');
      assert.equal(await page.getByRole('heading', { name: 'Saves', exact: true }).count(), 0);
      await page.getByRole('heading', { name: 'Saved is not done. Sign in to start', exact: true }).waitFor();
      await capture('login');
      delay = false;
      assert.equal(await page.getByRole('link', { name: 'Continue with Google', exact: true }).getAttribute('href'), '/auth/login/google');
      session = { ...member, profile_complete: false };
      await page.goto(base + '/app/saves');
      await page.getByRole('heading', { name: 'Confirm your details', exact: true }).waitFor();
      assert.equal(await page.getByLabel('Email (from Google)').getAttribute('readonly'), '');
      await capture('profile');
      await page.getByLabel('Name', { exact: true }).fill('  New name  ');
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'What needs you today' }).waitFor();
      assert.equal(session.name, 'New name');
      await page.goto(base + '/app/settings');
      await page.getByRole('heading', { name: 'Account', exact: true }).waitFor();
      await capture('settings');
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Saved is not done. Sign in to start' }).waitFor();
      await page.getByRole('button', { name: 'Explore the demo', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'Demo workspace. Read only. Imported demo data' }).waitFor();
      await page.goto(base + '/app/settings');
      await page.getByText('Sign in to do this', { exact: true }).waitFor();
      await capture('demo');
      const blocked = await page.evaluate(async () => {
        const client = await import('/src/api/client.ts');
        try { await client.post('/api/saves', {}); return null; }
        catch (error) { return error.code; }
      });
      assert.equal(blocked, 'demo_readonly');
      assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
      assert.equal(await page.getByRole('link', { name: 'Connect Google Calendar', exact: true }).count(), 0);
      assert.equal(await page.getByLabel('Name', { exact: true }).isDisabled(), true);
      session = { ...member }; expire = true;
      await page.goto(base + '/app/saves');
      await page.getByRole('heading', { name: 'Saved is not done. Sign in to start' }).waitFor();
      assert.deepEqual(writes, ['/api/me', '/auth/logout', '/auth/demo']);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${width}: session gate, profile, CSRF, account, logout, demo, expiry, no overflow`);
    }
  } catch (error) { if (debugPage) console.error(debugPage.url(), await debugPage.locator("body").innerText()); throw error; }
  finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
