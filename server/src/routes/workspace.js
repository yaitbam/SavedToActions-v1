import moment from 'moment-timezone';
import { getActionView } from '../actions.js';
import { listGoals } from '../db.js';
import { goalMetrics, METRIC_DEFINITIONS } from '../stats.js';
import { scheduledMinutes } from '../scheduler/blocks.js';

export function insightsView(db, now, goalId = null) {
  const filter=goalId===null?'':' AND a.goal_id = ?';
  const args=goalId===null?[]:[goalId];
  const count=(sql,...values)=>db.prepare(sql).get(...values).n;
  // Same definitions as stats.js: a save counts once it has an action in a goal. Failed extractions are not counted.
  const imported=count(`SELECT COUNT(DISTINCT a.save_id) AS n FROM actions a WHERE a.goal_id IS NOT NULL${filter}`,...args);
  const doneSaves=count(`SELECT COUNT(DISTINCT a.save_id) AS n FROM actions a WHERE a.status='done' AND a.goal_id IS NOT NULL${filter}`,...args);
  const markedDone=count(`SELECT COUNT(*) AS n FROM actions a WHERE a.status='done'${filter}`,...args);
  const missed=count(`SELECT COUNT(*) AS n FROM actions a WHERE a.status IN ('open','planned') AND a.deadline_utc <= ?${filter}`,new Date(now).toISOString(),...args);
  const scheduled=scheduledMinutes(db.prepare(`SELECT b.start_utc,b.end_utc,b.superseded_by,b.cancelled_at FROM blocks b JOIN actions a ON a.id=b.action_id WHERE 1=1${filter}`).all(...args));
  const demo=count(`SELECT COUNT(DISTINCT s.id) AS n FROM saves s LEFT JOIN actions a ON a.save_id=s.id WHERE s.is_demo=1${filter}`,...args);
  const weekly=Array.from({length:8},(_,i)=>{
    const start=moment.utc(now).startOf('isoWeek').subtract(7-i,'weeks');
    const until=new Date(Math.min(now,start.clone().add(1,'week').valueOf())).toISOString();
    const n=count(`SELECT COUNT(DISTINCT a.save_id) AS n FROM actions a JOIN saves s ON s.id=a.save_id WHERE a.goal_id IS NOT NULL AND s.imported_at < ?${filter}`,until,...args);
    const done=count(`SELECT COUNT(DISTINCT a.save_id) AS n FROM actions a JOIN saves s ON s.id=a.save_id WHERE a.goal_id IS NOT NULL AND a.status='done' AND a.done_at < ? AND s.imported_at < ?${filter}`,until,until,...args);
    return {weekStart:start.format('YYYY-MM-DD'),label:start.format('D MMM'),importedSaves:n,doneSaves:done,actionRate:n?done/n:null};
  });
  const metrics=goalMetrics(db,now);
  return {totals:{importedSaves:imported,markedDone,savesWithDoneAction:doneSaves,actionRate:imported?doneSaves/imported:null,deadlinePassedWithoutCompletion:missed,timeScheduledMin:scheduled,demoSaves:demo},weekly,goals:listGoals(db).filter(g=>goalId===null||g.id===goalId).map(g=>({...g,metrics:metrics.get(g.id)})),kinds:db.prepare(`SELECT a.kind AS name, COUNT(*) AS count FROM actions a WHERE 1=1${filter} GROUP BY a.kind`).all(...args),definitions:METRIC_DEFINITIONS,seriesNote:'Cumulative records by ISO week in UTC. Historical goal charts use current goal assignments. Completions are self reported.'};
}
export function registerWorkspaceRoutes(app,{db,clock,provider,selfTest}){
  app.get('/api/insights',(_req,res)=>res.json(insightsView(db,clock())));
  app.get('/api/goals/:id',(req,res)=>{
    const id=Number(req.params.id),goal=listGoals(db).find(g=>g.id===id);
    if(!goal)return res.status(404).json({error:'not_found'});
    const actions=db.prepare('SELECT id FROM actions WHERE goal_id=? ORDER BY created_at DESC').all(id).map(a=>getActionView(db,a.id,{nowMs:clock()}));
    res.json({goal,actions,...insightsView(db,clock(),id)});
  });
  app.get('/api/about',(_req,res)=>res.json({name:'SavedToAction',model:provider?.model??null,provider:provider?.name??null,timezoneSelfTest:selfTest,storage:'Local SQLite database and uploaded screenshots',authentication:'Single-user local application',calendarPolicy:'Explicit approval before calendar writes. Read-back after each write.',inputPolicy:'User-uploaded screenshots, notes and pasted text. No scraping.'}));
}
