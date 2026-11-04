import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, saveSettings } from '../src/db.js';
import { registerCollectionRoutes, collectionPage } from '../src/routes/collections.js';
import { timelineDays, registerTimelineRoute } from '../src/routes/timeline.js';

test('collection reads distinguish review, failed extraction and reviewed without fabricating records',()=>{
 const db=openDb(':memory:');
 const routes=new Map();registerCollectionRoutes({get:(path,fn)=>routes.set(path,fn)},{db});
 const now='2026-11-02T12:00:00.000Z';
 const save=()=>Number(db.prepare('INSERT INTO saves (note,imported_at) VALUES (?,?)').run('my note',now).lastInsertRowid);
 const failed=save(), pending=save(), confirmed=save();
 const insert=db.prepare("INSERT INTO actions (save_id,kind,title,status,confirmed_effort_min,created_at,updated_at) VALUES (?,'try',?,'open',?,?,?)");
 insert.run(pending,'Review me',null,now,now);insert.run(confirmed,'Confirmed',30,now,now);
 const read=(path,query)=>{let payload;routes.get(path)({query},{json:value=>payload=value});return payload};
 assert.equal(read('/api/saves',{status:'input'}).items[0].saveId,failed);
 assert.equal(read('/api/saves',{status:'review'}).items[0].saveId,pending);
 assert.equal(read('/api/saves',{status:'reviewed'}).items[0].saveId,confirmed);
 assert.equal(read('/api/actions',{q:'review'}).total,1);
 assert.equal(read('/api/actions',{q:'no match'}).total,0);
 assert.equal(read('/api/actions',{limit:1,offset:1}).items.length,1);
 assert.equal(read('/api/actions',{status:'done'}).total,0);
 db.close();
});
test('collection pagination retains total and caps page size',()=>{
 assert.deepEqual(collectionPage([1,2,3],{offset:1,limit:1}),{items:[2],total:3,offset:1,limit:1});
 assert.equal(collectionPage([],{limit:1000}).limit,100);
});
test('timeline uses Casablanca server offsets and clips geometry to working hours',()=>{
 const settings={tz:'Africa/Casablanca',workStart:'09:00',workEnd:'21:00',ignoreAllDay:true};
 const action={deadline:null,block:{googleEventId:'ours',startUtc:'2026-11-02T10:00:00Z',endUtc:'2026-11-02T11:00:00Z'}};
 const events=[{id:'meeting',summary:'Meeting',start:{dateTime:'2026-11-02T08:00:00Z'},end:{dateTime:'2026-11-02T10:00:00Z'}},{id:'all-day',start:{date:'2026-11-02'},end:{date:'2026-11-03'}},{id:'ours',start:{dateTime:action.block.startUtc},end:{dateTime:action.block.endUtc}}];
 const days=timelineDays({action,events,settings,now:Date.parse('2026-11-02T09:00:00Z')});
 const privateDays=timelineDays({action,events,settings,now:Date.parse('2026-11-02T09:00:00Z'),privateEvents:true});
 assert.equal(privateDays[0].chips.length,2);
 assert.equal(privateDays[0].chips[0].title,'Busy');
 assert.equal(JSON.stringify(privateDays).includes('Meeting'),false);
 assert.equal(days.length,7);assert.equal(days[0].now,0);assert.equal(days[0].chips.length,2);
 assert.equal(days[0].chips[0].left,0);assert.match(days[0].chips[0].endDisplay,/10:00 \(\+00:00\)/);
 for(const day of days)for(const chip of day.chips){assert.ok(chip.left>=0&&chip.width>=0&&chip.left+chip.width<=100)}
 assert.equal(timelineDays({action:{deadline:{utc:'2027-01-01T00:00:00Z'},block:null},events:[],settings,now:Date.parse('2026-11-02T09:00:00Z')}).length,21);
});

test('week route navigates by ?date in the settings timezone, rejects bad dates, reads only that week',async()=>{
 const db=openDb(':memory:');saveSettings(db,{tz:'Africa/Casablanca',workStart:'09:00',workEnd:'21:00',ignoreAllDay:true});
 const reads=[];const calendar={listEvents:async(w)=>{reads.push(w);return []}};
 const routes=new Map();registerTimelineRoute({get:(p,fn)=>routes.set(p,fn)},{db,calendar,clock:()=>Date.parse('2026-11-05T10:00:00Z')});
 const call=async(query)=>{let status=200,body;const res={status:s=>{status=s;return res},json:b=>{body=b;return res}};await routes.get('/api/week')({query},res);return {status,body}};
 const now=await call({});
 assert.equal(now.body.todayDate,'2026-11-05');
 assert.equal(new Date(reads[0].fromMs).toISOString(),'2026-11-02T00:00:00.000Z');
 assert.equal(now.body.previousDate,'2026-10-26');assert.equal(now.body.nextDate,'2026-11-09');
 const next=await call({date:'2026-11-11'});
 assert.equal(next.status,200);assert.equal(new Date(reads[1].fromMs).toISOString(),'2026-11-09T00:00:00.000Z');assert.equal(reads[1].toMs-reads[1].fromMs,7*24*3600*1000);
 for(const bad of ['2026-13-01','11/09/2026','2026-11-09T00:00','x']){const r=await call({date:bad});assert.equal(r.status,400,bad);assert.equal(r.body.error,'invalid_date')}
 assert.equal(reads.length,2,'bad dates never read the calendar');
 db.close();
});

test('saved=week means a deadline within 7 days of now, not a block or the calendar week',()=>{
 const db=openDb(':memory:');saveSettings(db,{tz:'America/New_York',workStart:'09:00',workEnd:'21:00',ignoreAllDay:true});
 const routes=new Map();registerCollectionRoutes({get:(path,fn)=>routes.set(path,fn)},{db,clock:()=>Date.parse('2026-11-04T15:00:00Z')});
 const at='2026-11-04T12:00:00.000Z';
 const add=(title,deadlineUtc)=>{
  const saveId=Number(db.prepare('INSERT INTO saves (note,imported_at) VALUES (?,?)').run(title,at).lastInsertRowid);
  const id=Number(db.prepare("INSERT INTO actions (save_id,kind,title,status,deadline_wall,deadline_tz,deadline_utc,created_at,updated_at) VALUES (?,'try',?,'open',?,'UTC',?,?,?)").run(saveId,title,deadlineUtc?.slice(0,16)??null,deadlineUtc,at,at).lastInsertRowid);
  return id;
 };
 const far=add('Far deadline, block this week','2026-11-22T23:59:00.000Z');
 add('Due in 3 days','2026-11-07T20:00:00.000Z');
 add('Overdue','2026-11-03T20:00:00.000Z');
 add('Just past 7 days','2026-11-11T15:00:00.000Z');
 add('No deadline',null);
 db.prepare("INSERT INTO blocks (action_id,google_event_id,idempotency_key,start_utc,end_utc,tz,created_at) VALUES (?,'e','k','2026-11-05T14:00:00Z','2026-11-05T14:30:00Z','UTC',?)").run(far,at);
 let payload;routes.get('/api/actions')({query:{saved:'week'}},{json:v=>payload=v});
 assert.deepEqual(payload.items.map(a=>a.title),['Due in 3 days']);
 db.close();
});
