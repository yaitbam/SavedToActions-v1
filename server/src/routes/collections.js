import moment from 'moment-timezone';
import { getActionView } from '../actions.js';
import { getSettings } from '../db.js';
import { formatForDisplay } from '../tz.js';

function invalid(code,detail){const error=new Error(detail);error.status=400;error.publicCode=code;throw error}
function integer(value,fallback,min){if(value===undefined||value==='')return fallback;const number=Number(value);if(!Number.isSafeInteger(number)||number<min)invalid('invalid_pagination','limit must be a positive integer and offset a nonnegative integer.');return number}
export function collectionPage(items,query){const limit=Math.min(100,integer(query.limit,50,1)),offset=integer(query.offset,0,0);return {items:items.slice(offset,offset+limit),total:items.length,offset,limit}}
export function registerCollectionRoutes(app,{db,clock=Date.now}){
 app.get('/api/actions',(req,res)=>{
  let items=db.prepare('SELECT id FROM actions ORDER BY id DESC').all().map(({id})=>getActionView(db,id,{nowMs:clock()}));
  const q=req.query,now=new Date(clock()).toISOString();
  const risk=a=>['open','planned'].includes(a.status)&&((a.deadline?.utc&&a.deadline.utc<=now)||['amber','red','needs_input','error'].includes(a.check?.state)||['drift','failed'].includes(a.block?.readback.status));
  if(q.q!==undefined){if(typeof q.q!=='string'||q.q.length>200)invalid('invalid_search','Search must be at most 200 characters.');items=items.filter(a=>(a.title??'').toLowerCase().includes(q.q.toLowerCase()))}
  if(q.goal){if(!/^[1-9]\d*$/.test(String(q.goal)))invalid('invalid_goal','Use a positive goal ID.');items=items.filter(a=>String(a.goalId)===q.goal)}
  if(q.kind){if(!['try','opportunity','other'].includes(q.kind))invalid('invalid_kind','Unknown kind.');items=items.filter(a=>a.kind===q.kind)}
  if(q.status){const aliases={fits:'green',conflict:'amber',doesnt_fit:'red'};const status=aliases[q.status]??q.status;if(!['open','planned','done','skipped','green','amber','red','needs_input','error','event_passed'].includes(status))invalid('invalid_status','Unknown action or availability status.');items=items.filter(a=>a.status===status||a.check?.state===status||(status==='needs_input'&&a.status==='open'&&!a.effort.confirmed)||(status==='event_passed'&&a.warnings.some(w=>w.code==='event_already_happened')))}
  if(q.has_deadline!==undefined){if(!['true','false'].includes(q.has_deadline))invalid('invalid_has_deadline','Use true or false.');items=items.filter(a=>Boolean(a.deadline)===(q.has_deadline==='true'))}
  if(q.saved&&!['all','risk','later','week'].includes(q.saved))invalid('invalid_view','Unknown saved view.');
  const counts={all:items.length,risk:items.filter(risk).length,later:items.filter(a=>a.label==='someday').length};
  if(q.saved==='risk')items=items.filter(risk);
  if(q.saved==='later')items=items.filter(a=>a.label==='someday');
  if(q.saved==='week'){const {tz}=getSettings(db);if(!tz)return res.status(409).json({error:'missing_timezone',detail:'Set your timezone before using This week.'});const start=moment.tz(clock(),tz).startOf('isoWeek').valueOf(),end=moment.tz(start,tz).add(1,'week').valueOf();items=items.filter(a=>[a.deadline?.utc,a.block?.startUtc].some(v=>v&&Date.parse(v)>=start&&Date.parse(v)<end))}
  const sort=q.sort??'deadline_asc';if(!['deadline','deadline_asc','deadline_desc','created_desc'].includes(sort))invalid('invalid_sort','Use deadline_asc, deadline_desc or created_desc.');
  items.sort((a,b)=>sort==='created_desc'?b.createdAt.localeCompare(a.createdAt)||b.id-a.id:!a.deadline?.utc?(!b.deadline?.utc?b.id-a.id:1):!b.deadline?.utc?-1:(sort==='deadline_desc'?-1:1)*a.deadline.utc.localeCompare(b.deadline.utc)||b.id-a.id);
  res.json({...collectionPage(items,q),countsByView:counts});
 });
 app.get('/api/saves',(req,res)=>{
  const {tz}=getSettings(db);
  if(req.query.status&&!['review','input','reviewed','queued','running','failed','done'].includes(req.query.status))invalid('invalid_status','Unknown Inbox status.');
  let items=db.prepare('SELECT * FROM saves ORDER BY imported_at DESC,id DESC').all().map(s=>{
   const row=db.prepare('SELECT id FROM actions WHERE save_id=? ORDER BY id LIMIT 1').get(s.id),action=row?getActionView(db,row.id,{nowMs:clock()}):null;
   const job=db.prepare('SELECT id,state FROM extraction_jobs WHERE save_id=? ORDER BY id DESC LIMIT 1').get(s.id);
   return {saveId:s.id,note:s.note??'',importedAt:s.imported_at,importedAtDisplay:tz?formatForDisplay(s.imported_at,tz):null,screenshotUrl:`/api/saves/${s.id}/screenshot`,isDemo:Boolean(s.is_demo),extraction:job?.state??(action?'done':'failed'),jobId:job?.id??null,action};
  });
  if(req.query.status==='review')items=items.filter(s=>s.action?.status==='open'&&!s.action.effort.confirmed);
  else if(req.query.status==='input')items=items.filter(s=>s.extraction==='failed');
  else if(req.query.status==='reviewed')items=items.filter(s=>s.action&&(s.action.effort.confirmed||s.action.status!=='open'));
  else if(req.query.status)items=items.filter(s=>s.extraction===req.query.status);
  res.json(collectionPage(items,req.query));
 });
}
