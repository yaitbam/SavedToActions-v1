import moment from 'moment-timezone';
import { getActionView } from '../actions.js';
import { getSettings } from '../db.js';
import { eventInterval, ignoredReason, busyFromEvents } from '../scheduler/conflicts.js';
import { allSupersededKeys, listBlocks, blockView } from '../blockStore.js';
import { formatForDisplay } from '../tz.js';
import { CalendarError, calendarErrorStatus } from '../google/calendar.js';

export function timelineDays({ action, events, settings, now, anchor = now, privateEvents=false, supersededKeys=new Set() }) {
  const tz=settings.tz;
  if(privateEvents)events=busyFromEvents({events,block:action.block??{},tz,ignoreAllDay:settings.ignoreAllDay,supersededKeys}).map(iv=>({summary:'Busy',start:{dateTime:new Date(iv.start).toISOString()},end:{dateTime:new Date(iv.end).toISOString()}}));
  const first=moment.tz(anchor,tz).startOf('day');
  const deadline=action.deadline?.utc ? moment.tz(action.deadline.utc,tz) : null;
  const count=deadline ? Math.min(21,Math.max(1,deadline.clone().startOf('day').diff(first,'days')+1)) : 7;
  return Array.from({length:count},(_,i)=>{
    const day=first.clone().add(i,'days');
    const wall=(s)=>{const [h,m]=s.split(':').map(Number);return day.clone().hour(h).minute(m).valueOf()};
    const start=wall(settings.workStart),end=wall(settings.workEnd);
    const percent=(n)=>Math.max(0,Math.min(100,(n-start)/(end-start)*100));
    const chip=(startMs,endMs,title,kind)=>endMs>start&&startMs<end ? {title,kind,left:percent(startMs),width:percent(endMs)-percent(startMs),startDisplay:formatForDisplay(startMs,tz),endDisplay:formatForDisplay(endMs,tz)} : null;
    const chips=events.filter(e=>!ignoredReason(e,{ignoreAllDay:settings.ignoreAllDay}) && e.id!==action.block?.googleEventId).map(e=>{const iv=eventInterval(e,tz);return iv?chip(iv.start,iv.end,e.summary??'Busy',e.appBlock?'prep':'busy'):null}).filter(Boolean);
    if(action.block){const c=chip(Date.parse(action.block.startUtc),Date.parse(action.block.endUtc),'Your approved block','prep');if(c)chips.push(c)}
    return {date:day.format('YYYY-MM-DD'),label:day.format('ddd D MMM'),startDisplay:settings.workStart,endDisplay:settings.workEnd,now:now>=start&&now<=end?percent(now):null,deadline:deadline&&deadline.valueOf()>=start&&deadline.valueOf()<=end?percent(deadline.valueOf()):null,chips};
  });
}

export function registerTimelineRoute(app,{db,calendar,clock}){
 app.get('/api/week',async(req,res)=>{
  const settings=getSettings(db);if(!settings.tz)return res.status(409).json({error:'missing_timezone',detail:'Set a timezone to view your week.'});
  const now=clock();
  const chosen=req.query.date?moment.tz(String(req.query.date),'YYYY-MM-DD',true,settings.tz):moment.tz(now,settings.tz);
  if(!chosen.isValid())return res.status(400).json({error:'invalid_date',detail:'Use YYYY-MM-DD.'});
  const anchor=chosen.clone().startOf('isoWeek').valueOf();
  const action={deadline:null,block:null};
  try {
   const active=new Set(db.prepare('SELECT google_event_id FROM blocks WHERE superseded_by IS NULL AND cancelled_at IS NULL').all().map(b=>b.google_event_id));
   const events=(await calendar.listEvents({fromMs:anchor,toMs:moment.tz(anchor,settings.tz).add(7,'days').valueOf()})).map(e=>({...e,appBlock:active.has(e.id)}));
   res.json({tz:settings.tz,days:timelineDays({action,events,settings,now,anchor}),maxDays:7,weekLabel:moment.tz(anchor,settings.tz).format('D MMM')+' – '+moment.tz(anchor,settings.tz).add(6,'days').format('D MMM YYYY'),previousDate:moment.tz(anchor,settings.tz).subtract(7,'days').format('YYYY-MM-DD'),nextDate:moment.tz(anchor,settings.tz).add(7,'days').format('YYYY-MM-DD'),todayDate:moment.tz(now,settings.tz).format('YYYY-MM-DD')});
  }catch(error){if(error instanceof CalendarError)return res.status(calendarErrorStatus(error.code)).json({error:error.code,detail:error.message});throw error}
 });

 app.get('/api/actions/:id/timeline',async(req,res)=>{
  const action=getActionView(db,Number(req.params.id),{nowMs:clock()});if(!action)return res.status(404).json({error:'not_found'});
  const settings=getSettings(db);if(!settings.tz)return res.status(409).json({error:'missing_timezone',detail:'Set your timezone in Settings before viewing calendar availability.'});
  const now=clock();
  const days=timelineDays({action,events:[],settings,now});
  const fromMs=moment.tz(days[0].date,settings.tz).valueOf();
  const toMs=moment.tz(days.at(-1).date,settings.tz).add(1,'day').valueOf();
  try{
   const events=await calendar.listEvents({fromMs,toMs});
   return res.json({tz:settings.tz,days:timelineDays({action,events,settings,now,privateEvents:true,supersededKeys:allSupersededKeys(db)}),maxDays:21,
    workingWindow:{start:settings.workStart,end:settings.workEnd},now:{utc:new Date(now).toISOString(),display:formatForDisplay(now,settings.tz)},deadline:action.deadline,
    proposed:action.check?.alternative??null,proposalSource:action.check?.alternative?'latest_recheck':null,
    previousBlocks:listBlocks(db,action.id).filter(b=>b.superseded_by!==null).map(blockView)});
  }catch(error){if(error instanceof CalendarError)return res.status(calendarErrorStatus(error.code)).json({error:error.code,detail:error.message});throw error}
 });
}
