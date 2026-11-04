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
  for(const id of ['pain','how','value','impact']) assert.equal(await page.locator(`#${id}`).count(),1,`section ${id}`);
  assert.equal(await page.locator('.hero-machine, .ba-range, .inspection-grid').count(),0,'interactive demos removed');
  assert.equal(await page.locator('.metric').count(),6);
  await fs.mkdir('artifacts/design',{recursive:true});
  for(const theme of ['light','dark']) {
   if(theme==='dark') await page.getByRole('button',{name:'Use dark theme'}).click();
   for(const width of [1440,768,390]) {
    await page.setViewportSize({width,height:1000});
    await page.evaluate(async()=>{ await document.fonts.ready; window.scrollTo(0,0); });
    await page.waitForTimeout(150);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${theme} ${width}`);
    await page.screenshot({path:`artifacts/design/${theme}-${width}.png`,fullPage:true});
   }
  }
  await page.reload();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  assert.deepEqual(errors,[]);
  console.log('PASS: sections present, demos removed, no horizontal overflow, theme persistence, six responsive snapshots; no page errors.');
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
