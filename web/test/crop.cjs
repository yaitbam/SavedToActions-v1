// Crops a phone style screenshot in the new save dialog with the mouse and the keyboard, then checks the
// size of the image that is uploaded. Needs the app running (WEB_URL, default http://localhost:5173) and sharp,
// which the server package already installs. The upload is intercepted, so no model is called.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const sharp = require(path.join(__dirname, '../../server/node_modules/sharp'));
const os = require('node:os');
const S = require('node:fs').mkdtempSync(path.join(os.tmpdir(), 'crop-'));
const WEB = process.env.WEB_URL || 'http://localhost:5173';
const assert = require('node:assert/strict');
let b;
(async()=>{
 // A phone screenshot: red status bar on top, the post in blue, green bottom bar. 400 x 800.
 const rect=(w,h,c)=>({create:{width:w,height:h,channels:3,background:c}});
 const img = await sharp(rect(400,800,'#2563eb')).composite([
   {input: await sharp(rect(400,80,'#ef4444')).png().toBuffer(), top:0, left:0},
   {input: await sharp(rect(400,100,'#22c55e')).png().toBuffer(), top:700, left:0},
 ]).png().toBuffer();
 require('fs').writeFileSync(S+'/phone.png', img);
 b=await chromium.launch(); const page=await (await b.newContext({viewport:{width:1100,height:900}})).newPage();
 page.on('pageerror',e=>console.log('E',e.message.slice(0,200)));
 let uploaded=null;
 await page.route(/\/api\/saves$/, async r=>{ if(r.request().method()!=='POST') return r.fallback(); uploaded=r.request().postDataBuffer(); r.fulfill({status:500,json:{error:'model_failed'}}); });
 await page.goto(WEB+'/app'); await page.waitForTimeout(600);
 await page.setInputFiles('input[type=file]', S+'/phone.png').catch(()=>{});
 if(!await page.locator('dialog[open]').count()){ await page.click('button[aria-label="Drop screenshot"]'); await page.waitForSelector('dialog[open]'); await page.setInputFiles('dialog input[type=file]', S+'/phone.png'); }
 await page.waitForSelector('text=Crop'); 
 await page.getByRole('button',{name:'Crop',exact:true}).click(); await page.waitForSelector('.crop-box'); await page.waitForTimeout(400);
 assert.equal(await page.locator('.crop-size').textContent(),'Nothing cut yet');
 // Drag the top edge down 10% and the bottom edge up 12.5% with the mouse.
 const stage=await page.locator('.crop-stage').boundingBox();
 const drag=async(sel,dx,dy)=>{ const g=await page.locator(sel).boundingBox(); const x=g.x+g.width/2,y=g.y+g.height/2; await page.mouse.move(x,y); await page.mouse.down(); await page.mouse.move(x+dx/2,y+dy/2,{steps:4}); await page.mouse.move(x+dx,y+dy,{steps:4}); await page.mouse.up(); };
 await drag('.crop-grip-n',0,stage.height*0.10);
 await drag('.crop-grip-s',0,-stage.height*0.125);
 // And the right edge with the keyboard: focus it and press ArrowLeft 5 times.
 await page.locator('.crop-grip-e').focus(); for(let i=0;i<5;i++) await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('.crop-size').textContent(),'Keeping 380 × 620 px');
 await page.screenshot({path:S+'/crop-editor.png'});
 await page.click('text=Use this crop'); await page.waitForTimeout(500);
 assert.equal(await page.locator('.ns-badge:has-text("Cropped")').count(),1);
 await page.click('button:has-text("Extract")'); await page.waitForTimeout(800);
 const buf=uploaded; const i=buf.indexOf(Buffer.from('IHDR')); 
 assert.deepEqual([buf.readUInt32BE(i+4), buf.readUInt32BE(i+8)],[380,620]);
 console.log('PASS: the uploaded image is the cropped 380 x 620, not the original 400 x 800.');
 // Undo returns the original.
 await page.getByRole('button',{name:'Retry'}).waitFor();
 await b.close();
})().catch(async e=>{console.error(e);process.exitCode=1;}).finally(()=>b&&b.close());
