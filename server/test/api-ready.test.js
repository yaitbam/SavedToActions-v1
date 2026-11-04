import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDb,saveSettings,loadTokens} from '../src/db.js';
import {createApp} from '../src/app.js';
import {createPlanningService} from '../src/services/planning.js';
import {createExtractionJobs} from '../src/services/extractionJobs.js';
import {createActionLocks} from '../src/services/actionLocks.js';
import {createFakeCalendar} from './fakeCalendar.js';
import {registerAccountDataRoutes,exportData} from '../src/routes/accountData.js';
import {getActionView,updateAction} from '../src/actions.js';
import {normalizeExtraction} from '../src/extraction/normalize.js';
const NOW=Date.parse('2026-11-03T12:00:00.000Z');
function seed(db){const s=Number(db.prepare("INSERT INTO saves(note,imported_at) VALUES ('note','2026-11-03T10:00:00.000Z')").run().lastInsertRowid);return Number(db.prepare("INSERT INTO actions(save_id,goal_id,kind,title,confirmed_effort_min,status,created_at,updated_at) VALUES (?,1,'try','Try exercise',30,'open','2026-11-03T10:00:00.000Z','2026-11-03T10:00:00.000Z')").run(s).lastInsertRowid)}
function context(){const db=openDb(':memory:');saveSettings(db,{tz:'Africa/Casablanca',workStart:'09:00',workEnd:'21:00',ignoreAllDay:true});const calendar=createFakeCalendar();return {db,calendar,planning:createPlanningService({db,calendar,clock:()=>NOW})}}
test('done and skip can be undone without any calendar write',async()=>{const {db,calendar,planning}=context();try{const id=seed(db);assert.equal((await planning.markDone({actionId:id})).action.status,'done');assert.equal((await planning.undo({actionId:id})).action.status,'open');assert.equal((await planning.undo({actionId:id})).error,'nothing_to_undo');await planning.skip({actionId:id});assert.equal((await planning.undo({actionId:id})).action.status,'open');assert.equal(calendar.calls.length,0)}finally{db.close()}});
test('restore needs approval, replaces drifted block, reads back, and supersedes old row',async()=>{const {db,calendar,planning}=context();try{const id=seed(db),slot={startUtc:'2026-11-04T10:00:00.000Z',endUtc:'2026-11-04T10:30:00.000Z'};calendar.sim.shiftMs=60000;const original=await planning.approve({actionId:id,slot,approved:true});assert.equal(original.block.readback.status,'drift');const before=calendar.bodies.length;assert.equal((await planning.move({actionId:id,slot,approved:false,restore:true})).error,'approval_required');assert.equal(calendar.bodies.length,before);calendar.sim.shiftMs=0;const restored=await planning.move({actionId:id,slot,approved:true,restore:true});assert.equal(restored.block.readback.status,'ok');assert.equal(restored.previous.eventDeleted,true);assert.equal(db.prepare('SELECT superseded_by FROM blocks WHERE id=?').get(original.block.id).superseded_by,restored.block.id);assert.equal((await planning.move({actionId:id,slot,approved:true,restore:true})).error,'restore_not_needed')}finally{db.close()}});
test('extraction jobs queue, reject duplicate work, persist results and recover interrupted work',async()=>{const db=openDb(':memory:');try{const a=seed(db),saveId=db.prepare('SELECT save_id FROM actions WHERE id=?').get(a).save_id;let finish;const jobs=createExtractionJobs({db,clock:()=>NOW,execute:()=>new Promise(resolve=>finish=resolve)});const first=jobs.start(saveId);assert.equal(first.job.state,'queued');assert.equal(jobs.start(saveId).started,false);await Promise.resolve();assert.equal(jobs.get(first.job.id).state,'running');finish({status:201,body:{saveId,action:{id:a}}});await first.promise;assert.equal(jobs.get(first.job.id).state,'done');assert.equal(jobs.get(first.job.id).result.action.id,a);db.prepare("INSERT INTO extraction_jobs(save_id,state,created_at) VALUES (?,'running','2026-11-03T12:00:00.000Z')").run(saveId);const recovered=createExtractionJobs({db,clock:()=>NOW,execute:async()=>({status:502,body:{error:'model_failed',saveId}})});assert.equal(recovered.latest(saveId).error.error,'extraction_interrupted');const retry=recovered.start(saveId);await retry.promise;assert.equal(recovered.get(retry.job.id).state,'failed');assert.equal(recovered.get(retry.job.id).error.saveId,saveId)}finally{db.close()}});
test('per-action locks serialize writes and always release after errors',async()=>{const locks=createActionLocks();let finish;const first=locks.run(1,()=>new Promise(resolve=>finish=resolve));await assert.rejects(locks.run(1,async()=>{}),e=>e.status===409&&e.publicCode==='operation_in_progress');assert.equal(locks.isBusyFor(1),true);await locks.run(2,async()=>{});finish();await first;assert.equal(locks.isBusy(),false);await assert.rejects(locks.run(1,async()=>{throw Error('failure')}));assert.equal(locks.isBusy(),false)});
test('export omits credentials and local deletion requires confirmation and a quiescent app',()=>{const {db}=context(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sta-delete-test-'));try{seed(db);db.prepare("INSERT INTO oauth_tokens(id,tokens_json,updated_at) VALUES (1,?,?)").run(JSON.stringify({access_token:'TEST_SECRET'}),new Date(NOW).toISOString());assert.equal(JSON.stringify(exportData(db,()=>NOW)).includes('TEST_SECRET'),false);const routes=new Map();let busy=false;registerAccountDataRoutes({get:(p,h)=>routes.set('GET '+p,h),post:(p,h)=>routes.set('POST '+p,h),delete:(p,h)=>routes.set('DELETE '+p,h)},{db,config:{screenshotDir:dir},clock:()=>NOW,jobs:{isBusy:()=>busy},locks:{isBusy:()=>false}});let status=200,body;const res={status(s){status=s;return this},json(b){body=b;return this}};const remove=routes.get('DELETE /api/me/data');remove({body:{}},res);assert.equal(status,400);assert.equal(db.prepare('SELECT COUNT(*) n FROM actions').get().n,1);busy=true;remove({body:{approved:true,confirmation:'DELETE MY DATA'}},res);assert.equal(status,409);busy=false;status=200;remove({body:{approved:true,confirmation:'DELETE MY DATA'}},res);assert.equal(body.deleted,true);assert.equal(body.calendarUnchanged,true);assert.equal(loadTokens(db),null);assert.equal(db.prepare('SELECT COUNT(*) n FROM actions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) n FROM goals').get().n,6)}finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}});
async function withHttp(fn){const {db,calendar}=context();const id=seed(db);const app=createApp({db,calendar,provider:{model:'fake',name:'fake'},googleAuth:{status:()=>({connected:false,configured:false,missingScopes:[]}),disconnect:()=>({})},selfTest:{ok:true},config:{frontendOrigin:'http://localhost:5173',maxUploadBytes:1024,screenshotDir:os.tmpdir()},clock:()=>NOW});const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});try{await fn({base:`http://127.0.0.1:${server.address().port}`,db,id})}finally{await new Promise(resolve=>server.close(resolve));db.close()}}
test('HTTP API returns JSON for invalid IDs, invalid input and unknown routes, and blocks foreign Origin writes',async()=>withHttp(async({base})=>{for(const target of ['/api/actions/nope','/api/actions/0','/api/actions/9007199254740992']){const r=await fetch(base+target);assert.equal(r.status,400);assert.equal((await r.json()).error,'invalid_id')}const missing=await fetch(base+'/api/not-a-route');assert.equal(missing.status,404);assert.equal((await missing.json()).error,'not_found');const invalid=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{bad'});assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'invalid_json');const array=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:'[]'});assert.equal(array.status,400);const cross=await fetch(base+'/api/actions/1/done',{method:'POST',headers:{Origin:'https://foreign.example'}});assert.equal(cross.status,403);assert.equal((await cross.json()).error,'origin_not_allowed');const pagination=await fetch(base+'/api/actions?limit=-5');assert.equal(pagination.status,400);assert.equal((await pagination.json()).error,'invalid_pagination')}));
test('HTTP direct save, capabilities, undo, bulk recheck and timezone clearing preserve expected envelopes',async()=>withHttp(async({base,id})=>{const save=await(await fetch(base+'/api/saves/1')).json();assert.equal(save.action.id,id);assert.equal(save.extractionStatus,'done');const caps=await(await fetch(base+'/api/capabilities')).json();assert.equal(caps.extraction.background,true);await fetch(base+`/api/actions/${id}/done`,{method:'POST'});const undo=await(await fetch(base+`/api/actions/${id}/undo`,{method:'POST'})).json();assert.equal(undo.action.status,'open');assert.equal(undo.calendarUnchanged,true);const bulk=await(await fetch(base+'/api/actions/recheck',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids:[id,id,999]})})).json();assert.equal(bulk.results.length,2);assert.equal(bulk.calendarUnchanged,true);assert.equal(bulk.results[0].error,'not_planned');const settings=await(await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"tz":null}'})).json();assert.equal(settings.tz,null)}));

test('background upload, polling and import idempotency retain one save and one action',async()=>{
 const sharp=(await import('sharp')).default;
 const image=await sharp({create:{width:4,height:4,channels:3,background:'#ffffff'}}).png().toBuffer();
 const {db,calendar}=context(),dir=fs.mkdtempSync(path.join(os.tmpdir(),'sta-background-test-'));let calls=0,release;
 const provider={name:'fake',model:'fake',chat:async()=>{calls++;await new Promise(resolve=>release=resolve);return {content:JSON.stringify({transcription:'Try this exercise',title:'Try exercise',goal_id:1,kind:'try',deadline:null,event_dates:[],deliverables:['Try exercise'],verbatim_items:[],evidence_quote:'Try this exercise',suggested_effort_min:15}),model:'fake',ms:5,usage:null}}};
 const app=createApp({db,calendar,provider,googleAuth:{status:()=>({connected:false,missingScopes:[]})},selfTest:{ok:true},config:{frontendOrigin:'http://localhost:5173',maxUploadBytes:1024*1024,screenshotDir:dir},clock:()=>NOW});
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s))});const base=`http://127.0.0.1:${server.address().port}`;
 const upload=(note='note')=>{const form=new FormData();form.append('image',new Blob([image],{type:'image/png'}),'image.png');form.append('note',note);return fetch(base+'/api/saves?async=true',{method:'POST',headers:{'Idempotency-Key':'test-import-1'},body:form})};
 try{
  const original=await upload();assert.equal(original.status,202);const accepted=await original.json();
  const polled=await(await fetch(base+accepted.statusUrl)).json();assert.equal(polled.state,'running');
  const duplicate=await(await upload()).json();assert.equal(duplicate.saveId,accepted.saveId);assert.equal(duplicate.replayed,true);assert.equal(db.prepare('SELECT COUNT(*) n FROM saves').get().n,1);
  const again=await fetch(base+`/api/saves/${accepted.saveId}/extract`,{method:'POST'});assert.equal(again.status,409);assert.equal((await again.json()).error,'extraction_in_progress');
  const conflict=await upload('different note');assert.equal(conflict.status,409);assert.equal((await conflict.json()).error,'idempotency_conflict');
  release();let done;for(let i=0;i<40;i++){done=await(await fetch(base+accepted.statusUrl)).json();if(done.state==='done')break;await new Promise(resolve=>setTimeout(resolve,5))}assert.equal(done.state,'done');assert.equal(done.result.saveId,accepted.saveId);assert.equal(calls,1);
  const replay=await upload();assert.equal(replay.status,200);assert.equal((await replay.json()).action.id,done.result.action.id);assert.equal(calls,1);
  const confirm=await fetch(base+`/api/saves/${accepted.saveId}/confirm`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"confirmedEffortMin":20}'});assert.equal(confirm.status,200);assert.equal((await confirm.json()).effort.confirmedMin,20);
  const edit=await fetch(base+`/api/saves/${accepted.saveId}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"note":"My changed note"}'});assert.equal(edit.status,200);assert.equal((await edit.json()).note,'My changed note');
 }finally{release?.();await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('completed trace stream emits recorded trace and terminates',async()=>withHttp(async({base,db,id})=>{
 const traceId=Number(db.prepare("INSERT INTO agent_traces(action_id,created_at,finished_at,instruction,outcome,model,steps_json,result_json) VALUES (?,? ,?,'','no_slot','fake',?,?)").run(id,new Date(NOW).toISOString(),new Date(NOW).toISOString(),JSON.stringify([{n:1,type:'end',at:new Date(NOW).toISOString(),ms:7}]),JSON.stringify({outcome:'no_slot'})).lastInsertRowid);
 const response=await fetch(base+`/api/traces/${traceId}/stream`);assert.match(response.headers.get('content-type'),/text\/event-stream/);const text=await response.text();assert.match(text,/event: trace/);assert.match(text,/"type":"end"/);assert.match(text,/event: end/);
}));

test('readiness checks local dependencies without external calls',async()=>withHttp(async({base})=>{
 const response=await fetch(base+'/ready');
 const body=await response.json();
 assert.equal(response.status,200);
 assert.equal(body.ready,true);
 assert.equal(body.userTimezoneConfigured,true);
 assert.equal(body.modelConfigured,false);
 assert.equal(body.readyForScheduling,false);
 assert.equal(body.externalCallsPerformed,false);
}));

test('event-passed warnings refresh on reads and edits in the settings timezone',async()=>{
 const {db,planning}=context();
 try{
  const id=seed(db);
  const patch=eventDates=>updateAction(db,id,{eventDates},{settingsTz:'Africa/Casablanca',nowIso:new Date(NOW).toISOString()});
  const date={text:'3 November 2026',start:'2026-11-03',end:'2026-11-03'};
  assert.equal(patch([date]).view.warnings.some(w=>w.code==='event_already_happened'),false);
  assert.equal(getActionView(db,id,{nowMs:Date.parse('2026-11-04T00:01:00Z')}).warnings.some(w=>w.code==='event_already_happened'),true);
  assert.equal(patch([{text:'Past edition',start:'2026-11-01',end:'2026-11-01'}]).view.warnings.some(w=>w.code==='event_already_happened'),true);
  assert.equal(patch([{text:'Next edition',start:'2026-11-05',end:'2026-11-05'}]).view.warnings.some(w=>w.code==='event_already_happened'),false);
  const done=await planning.markDone({actionId:id});
  assert.match(done.action.doneAtDisplay,/12:00 \(\+00:00\)/);
 }finally{db.close()}
});

test('offset correction distinguishes an actual disagreement from a matching model offset',()=>{
 for(const [offset,corrected]of [['+01:00',true],['+00:00',false],['Z',false]]){
  const raw={transcription:'Submit by 5 November at 10:00',deadline:{wall:'2026-11-05T10:00'+offset,tz:'Africa/Casablanca',quote:'Submit by 5 November at 10:00'}};
  const result=normalizeExtraction(raw,{nowMs:NOW,settingsTz:'Africa/Casablanca'});
  const warning=result.warnings.find(w=>w.code==='deadline_offset_ignored');
  assert.equal(warning.proposed.corrected,corrected);
  assert.equal(warning.proposed.computedOffset,'+00:00');
  assert.equal(result.fields.deadline.utc,'2026-11-05T10:00:00.000Z');
 }
});

test('readback provides server formatted drift values without changing the raw evidence',async()=>{
 const {db,calendar,planning}=context();
 try{
  const id=seed(db);calendar.sim.shiftMs=60000;
  const {block}=await planning.approve({actionId:id,approved:true,slot:{startUtc:'2026-11-04T10:00:00.000Z',endUtc:'2026-11-04T10:30:00.000Z'}});
  assert.match(block.readback.atDisplay,/12:00 \(\+00:00\)/);
  assert.equal(block.readback.status,'drift');
  assert.equal(block.readback.drift.length,block.readback.driftDisplay.length);
  assert.match(block.readback.driftDisplay[0].expectedDisplay,/10:00 \(\+00:00\)/);
  assert.match(block.readback.driftDisplay[0].actualDisplay,/10:01 \(\+00:00\)/);
 }finally{db.close()}
});

test('local deletion refuses unsafe stored paths before removing any records or files',()=>{
 const {db}=context();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sta-safe-delete-test-'));
 try{
  seed(db);db.prepare("UPDATE saves SET screenshot_path='../outside.png'").run();
  const routes=new Map();
  registerAccountDataRoutes({get:()=>{},post:()=>{},delete:(p,h)=>routes.set(p,h)},{db,config:{screenshotDir:dir},clock:()=>NOW,jobs:{isBusy:()=>false},locks:{isBusy:()=>false}});
  let status,body;const res={status(s){status=s;return this},json(b){body=b;return this}};
  routes.get('/api/me/data')({body:{approved:true,confirmation:'DELETE MY DATA'}},res);
  assert.equal(status,409);assert.equal(body.error,'unsafe_screenshot_path');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM actions').get().n,1);
 }finally{db.close();fs.rmSync(dir,{recursive:true,force:true})}
});
