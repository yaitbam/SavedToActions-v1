import express from "express";
import { createActionLocks } from "./services/actionLocks.js";
import { registerAccountDataRoutes } from "./routes/accountData.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";
import { registerTimelineRoute } from "./routes/timeline.js";
import { registerCollectionRoutes } from "./routes/collections.js";
import { createAgent } from "./agent/agent.js";
import { archiveGoal, createGoal, goalsSetupDone, markGoalsSetupDone, setupGoals, STARTER_GOALS, getSettings, getGoogleEmail, GoalError, listGoals, reorderGoals, restoreGoal, saveSettings, schemaVersion, updateGoal } from "./db.js";
import { registerPlanningRoutes } from "./routes/planning.js";
import { registerSaveRoutes } from "./routes/saves.js";
import { createHomeService } from "./services/home.js";
import { createPlanningService } from "./services/planning.js";
import { createRecheckService } from "./services/recheck.js";
import { goalMetrics } from "./stats.js";
import { validateWorkingHours } from "./scheduler/time.js";
import { isValidTimezone, listTimezones } from "./tz.js";

/**
 * Express app factory. Dependencies are injected so tests can use an in-memory database
 * and a stub for Google.
 */
export function createApp({ db, config, googleAuth, selfTest, provider, calendar, clock = Date.now, recheck = createRecheckService({ db, calendar, clock }) }) {
  const app = express();
  app.disable("x-powered-by");
  const locks=createActionLocks();

  // Frontend runs on a different origin in dev. No cookies are used, so a plain origin allow is enough.
  app.use((req, res, next) => {
    res.set("Access-Control-Allow-Origin", config.frontendOrigin);
    res.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type,Idempotency-Key");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  app.use((req,res,next)=>{
    res.set('X-Content-Type-Options','nosniff');
    res.set('Cache-Control','no-store');
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.get('Origin')&&req.get('Origin')!==config.frontendOrigin)return res.status(403).json({error:'origin_not_allowed'});
    next();
  });
  app.use(express.json({limit:'1mb'}));
  app.use((req,res,next)=>{
    if(req.body!==undefined && (req.body===null||typeof req.body!=='object'||Array.isArray(req.body)))return res.status(400).json({error:'invalid_body',detail:'Send a JSON object.'});
    next();
  });
  app.param('id',(req,res,next,value)=>{
    if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(Number(value)))return res.status(400).json({error:'invalid_id',detail:'IDs must be positive safe integers.'});
    next();
  });
  app.get("/health", (_req, res) => {
    res.json({ ok: true, timezoneSelfTest: selfTest, schemaVersion: schemaVersion(db), google: googleAuth.status() });
  });

  app.get('/ready',(_req,res)=>{
    const database=db.prepare('SELECT 1 AS ok').get().ok===1;
    const timezone=selfTest?.ok===true;
    const google=googleAuth.status();
    const modelConfigured=Boolean(provider?.configured?.());
    const userTimezoneConfigured=isValidTimezone(getSettings(db).tz);
    res.status(database&&timezone?200:503).json({ready:database&&timezone,database,timezone,userTimezoneConfigured,modelConfigured,googleConnected:google.connected,missingGoogleScopes:google.missingScopes??[],readyForScheduling:database&&timezone&&userTimezoneConfigured&&Boolean(google.connected)&&!(google.missingScopes??[]).length,externalCallsPerformed:false});
  });
  // Settings: working hours and the user's timezone. Missing timezone stays null until the user sets one.
  app.get('/api/me',(_req,res)=>res.json({name:null,email:getGoogleEmail(db),local:true}));
  app.get('/api/capabilities',(_req,res)=>res.json({singleUser:true,calendarWritesRequireApproval:true,extraction:{synchronous:true,background:true,statusPolling:true,streaming:false,importIdempotency:true},operations:{undoLifecycle:true,restore:true,bulkRecheck:true,traceStreaming:true,export:true,deleteLocalData:true},apiVersion:1}));
  app.get("/api/settings", (_req, res) => res.json(getSettings(db)));
  // Zones to choose from, with offsets computed by moment-timezone. The browser never works out offsets.
  app.get("/api/timezones", (_req, res) => res.json({ zones: listTimezones(clock()) }));

  app.put("/api/settings", (req, res) => {
    const current = getSettings(db);
    const next = {
      workStart: req.body?.workStart ?? current.workStart,
      workEnd: req.body?.workEnd ?? current.workEnd,
      tz: Object.hasOwn(req.body??{},'tz') ? req.body.tz : current.tz,
      ignoreAllDay: req.body?.ignoreAllDay ?? current.ignoreAllDay,
    };
    if (typeof next.ignoreAllDay !== "boolean") {
      return res.status(400).json({ error: "invalid_ignore_all_day", detail: "ignoreAllDay must be true or false." });
    }
    if (!validateWorkingHours(next).ok) {
      return res.status(400).json({ error: "invalid_working_hours", detail: "Use HH:mm, end after start, end may be 24:00." });
    }
    if (next.tz != null && !isValidTimezone(next.tz)) {
      return res.status(400).json({ error: "invalid_timezone", detail: "Use an IANA name such as Africa/Casablanca." });
    }
    res.json(saveSettings(db, next));
  });

  // Goals keep { id, name } and gain metrics from database records, with the definitions in stats.js.
  app.get("/api/goals", (_req, res) => {
    const metrics = goalMetrics(db, clock());
    res.json(listGoals(db, { includeArchived: true }).map((g) => ({ ...g, metrics: metrics.get(g.id) })));
  });

  // The general goals offered to everyone. Registered before /api/goals/:id.
  app.get("/api/goals/starters", (_req, res) => res.json(STARTER_GOALS));

  // First login: has the user chosen their goals yet. Registered before /api/goals/:id.
  app.get("/api/goals/setup", (_req, res) => res.json({ done: goalsSetupDone(db) }));

  // Goal changes. Archiving keeps every save and its history. Nothing here deletes a goal.
  const goalRoute = (handler) => (req, res) => {
    try {
      const result = handler(req);
      if (!result) return res.status(404).json({ error: "goal_not_found" });
      // Changing goals by hand counts as setting them up.
      if (req.method !== "GET") markGoalsSetupDone(db);
      res.json(result);
    } catch (err) {
      if (err instanceof GoalError) return res.status(err.status).json({ error: err.code, detail: err.detail });
      throw err;
    }
  };
  app.post("/api/goals/setup", goalRoute((r) => setupGoals(db, r.body ?? {})));
  app.post("/api/goals", (req, res) => goalRoute((r) => createGoal(db, { name: r.body?.name, description: r.body?.description }))(req, res.status(201)));
  app.put("/api/goals/order", goalRoute((r) => reorderGoals(db, r.body?.ids)));
  app.post("/api/goals/:id/archive", goalRoute((r) => archiveGoal(db, Number(r.params.id))));
  app.post("/api/goals/:id/restore", goalRoute((r) => restoreGoal(db, Number(r.params.id))));

  const home = createHomeService({ db, calendar, googleAuth, clock });
  app.get("/api/home", async (_req, res) => res.json(await home.home()));

  app.put("/api/goals/:id", (req, res) => {
    const body = req.body ?? {};
    const patch = {};
    for (const key of ["name", "description", "color"]) if (key in body) patch[key] = body[key];
    try {
      const goal = updateGoal(db, Number(req.params.id), patch);
      if (!goal) return res.status(400).json({ error: "invalid_goal_or_name" });
      markGoalsSetupDone(db);
      res.json(goal);
    } catch (err) {
      if (err instanceof GoalError) return res.status(err.status).json({ error: err.code, detail: err.detail });
      throw err;
    }
  });

  if (config.authMode === "off") app.get('/auth/session', (_req, res) => res.json({ authenticated: true, kind: 'owner', profile_complete: true, name: null, email: null, csrf_token: null, credits: null, calendar_email: null }));
  // Google OAuth.
  app.get("/auth/status", (_req, res) => res.json(googleAuth.status()));

  app.get("/auth/google", (_req, res) => {
    if (!googleAuth.configured()) {
      return res.status(503).json({ error: "google_not_configured", detail: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env." });
    }
    res.redirect(googleAuth.authUrl());
  });

  app.get("/auth/google/callback", async (req, res) => {
    const back = (result) => res.redirect(`${config.frontendOrigin}/?google=${result}`);
    if (req.query.error) return back("denied");
    try {
      const status = await googleAuth.handleCallback({ code: req.query.code, state: req.query.state });
      back(status.missingScopes.length ? "partial" : "connected");
    } catch (err) {
      console.error("Google callback failed:", err.message);
      back("error");
    }
  });

  app.post("/auth/disconnect", (_req, res) => res.json(googleAuth.disconnect()));

  registerWorkspaceRoutes(app, { db, clock, provider, selfTest });
  registerCollectionRoutes(app, { db, clock });
  registerTimelineRoute(app, { db, calendar, clock });
  const jobs=registerSaveRoutes(app, { db, config, provider, clock, locks });
  registerAccountDataRoutes(app,{db,config,clock,jobs,locks});
  app.locals.workspaceBusy = () => jobs.isBusy() || locks.isBusy();
  const planning = createPlanningService({ db, calendar, clock });
  const agent = createAgent({ db, provider, planning, clock });
  registerPlanningRoutes(app, { db, planning, recheck, agent, locks, config, jobs });
  app.post('/api/actions/recheck',async(req,res)=>{
    const ids=req.body?.ids;
    if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!Number.isSafeInteger(id)||id<1))return res.status(400).json({error:'invalid_ids',detail:'Send up to 100 positive action IDs.'});
    const results=[];
    for(const actionId of [...new Set(ids)]){
      try{const result=await locks.run(actionId,()=>recheck.recheckAction({actionId,source:'manual'}));const {ok,status,...body}=result;results.push({actionId,ok,status:ok?200:status,...body})}catch(error){results.push({actionId,ok:false,status:error.status??500,error:error.publicCode??'server_error'})}
    }
    res.json({results,calendarUnchanged:true});
  });
  app.use((_req,res)=>res.status(404).json({error:'not_found'}));

  app.use((err, _req, res, _next) => {
    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({ error: "file_too_large", detail: `Screenshots are limited to ${Math.round(config.maxUploadBytes / 1024 / 1024)} MB.` });
    }
    if (err.name === "MulterError") return res.status(400).json({ error: "bad_upload", detail: err.message });
    const status = err.status ?? 500;
    if(err.type==='entity.parse.failed')return res.status(400).json({error:'invalid_json'});
    if (status >= 500) console.error("Request failed", { name: err.name, code: err.code, status });
    res.status(status).json({ error: status >= 500 ? "server_error" : (err.publicCode??"bad_request"), ...(status<500&&err.publicCode?{detail:err.message}:{}) });
  });

  return app;
}
