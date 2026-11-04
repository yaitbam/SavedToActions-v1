const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
(async()=>{
 const browser = await chromium.launch({headless:true});
 try {
  const page = await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.WEB_URL || 'http://127.0.0.1:5173');
  await page.getByRole('heading',{name:'Saved is not done.'}).waitFor();
  for(const id of ['pain','how','features','impact','faq']) assert.equal(await page.locator(`#${id}`).count(),1,`section ${id}`);
  assert.equal(await page.locator('.hero-machine, .ba-range, .inspection-grid').count(),0,'interactive demos removed');
  assert.equal(await page.locator('.feature-grid article').count(),6);
  assert.equal(await page.locator('.faq-list details').count(),7);
  // The FAQ opens and closes without a script.
  await page.locator('.faq-list summary').first().click();
  assert.equal(await page.locator('.faq-list details[open]').count(),1);
  await fs.mkdir('artifacts/design',{recursive:true});
  assert.equal(await page.getByRole('button',{name:/theme/i}).count(),0,'no theme switch');
  for(const width of [1440,768,390]) {
   await page.setViewportSize({width,height:1000});
   await page.evaluate(async()=>{ await document.fonts.ready; window.scrollTo(0,0); });
   await page.waitForTimeout(150);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);
   await page.screenshot({path:`artifacts/design/light-${width}.png`,fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: sections present, demos removed, no theme switch, no horizontal overflow, three responsive snapshots; no page errors.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
