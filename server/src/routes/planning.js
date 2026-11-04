// HTTP for planning. Thin: parse, call the service, send. Writes need `approved: true` in the body.

import fs from "node:fs";
import path from "node:path";

const FILE_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;

export function registerPlanningRoutes(app, { db, planning, recheck, agent, locks, config, jobs }) {
  const raw = app;
  if(locks){const actual=app;app={get:(...args)=>actual.get(...args),post:(path,handler)=>actual.post(path,(req,res)=>locks.run(Number(req.params.id),()=>handler(req,res)))};}

  const send = (res, result, okStatus = 200) => {
    if (!result.ok) {
      const { ok, status, error, ...rest } = result;
      return res.status(status).json({ error, ...rest });
    }
    const { ok, replayed, ...rest } = result;
    return res.status(replayed ? 200 : okStatus).json(replayed === undefined ? rest : { replayed, ...rest });
  };
  const id = (req) => Number(req.params.id);
  const slotOf = (req) => ({ startUtc: req.body?.startUtc, endUtc: req.body?.endUtc });

  // Read only: the proposed slot, or what would change a red outcome.
  // effortMin is the minutes on screen, used for this search only. notBeforeUtc asks for "another time".
  app.post("/api/actions/:id/propose", async (req, res) => {
    const notBefore = req.body?.notBeforeUtc == null ? 0 : Date.parse(req.body.notBeforeUtc);
    if (!Number.isFinite(notBefore)) return res.status(400).json({ error: "invalid_slot", detail: "notBeforeUtc must be an ISO instant." });
    return send(res, await planning.propose({ actionId: id(req), effortMin: req.body?.effortMin ?? null, notBeforeMs: notBefore }));
  });

  // effortMin: the minutes shown with the time. Approving confirms them.
  app.post("/api/actions/:id/approve", async (req, res) =>
    send(res, await planning.approve({ actionId: id(req), slot: slotOf(req), approved: req.body?.approved, effortMin: req.body?.effortMin ?? null }), 201),
  );

  app.post("/api/actions/:id/move", async (req, res) =>
    send(res, await planning.move({ actionId: id(req), slot: slotOf(req), approved: req.body?.approved }), 201),
  );

  // "Recheck now": the exact function the background watcher runs, labeled source "manual". Reads the calendar,
  // never writes. An amber result carries the alternative, moving to it is a separate approved POST /move.
  app.post("/api/actions/:id/recheck", async (req, res) => send(res, await recheck.recheckAction({ actionId: id(req), source: "manual" })));
  app.get("/api/actions/:id/checks", (req, res) => send(res, recheck.history({ actionId: id(req), limit: req.query.limit })));

  // The agent step. The model reads (get_availability, find_slot) and proposes. It can never write: a person
  // still calls /approve or /move. Every run is kept as a trace.
  app.post("/api/actions/:id/agent-plan", async (req, res) => send(res, await agent.run({ actionId: id(req), instruction: req.body?.instruction })));
  app.get("/api/actions/:id/traces", (req, res) => send(res, agent.listTraces({ actionId: id(req) })));
  app.get('/api/traces/:id/stream',(req,res)=>{
    const found=agent.getTrace({id:id(req)});if(!found.ok)return send(res,found);
    res.status(200).set({'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.flushHeaders();
    let previous='',timer,closed=false;
    const tick=()=>{if(closed)return;const result=agent.getTrace({id:id(req)});if(!result.ok){res.write(`event: error\ndata: ${JSON.stringify({error:result.error})}\n\n`);res.end();clearInterval(timer);return}const payload=JSON.stringify(result.trace);if(payload!==previous){res.write(`event: trace\ndata: ${payload}\n\n`);previous=payload}if(result.trace.finishedAt){res.write('event: end\ndata: {}\n\n');res.end();clearInterval(timer)}};
    tick();if(!res.writableEnded){timer=setInterval(tick,500);timer.unref?.()}
    req.on('close',()=>{closed=true;clearInterval(timer)});
  });
  app.get("/api/traces/:id", (req, res) => send(res, agent.getTrace({ id: id(req) })));

  app.post('/api/actions/:id/restore',async(req,res)=>{
    const slot=planning.currentSlot({actionId:id(req)});
    if(!slot.ok)return send(res,slot);
    return send(res,await planning.move({actionId:id(req),slot:slot.slot,approved:req.body?.approved,restore:true}),201);
  });
  app.post('/api/actions/:id/undo',async(req,res)=>send(res,await planning.undo({actionId:id(req),approved:req.body?.approved})));

  app.post("/api/actions/:id/readback", async (req, res) => send(res, await planning.readback({ actionId: id(req) })));

  app.post("/api/actions/:id/done", async (req, res) => send(res, await planning.markDone({ actionId: id(req), approved: req.body?.approved })));

  app.post("/api/actions/:id/skip", async (req, res) => {
    if(req.body?.removeFromCalendar===true && req.body?.approved!==true)return res.status(400).json({error:'approval_required'});
    return send(res, await planning.skip({ actionId: id(req), removeFromCalendar: req.body?.removeFromCalendar === true }));
  });

  // Permanent. Always needs approval. With removeFromCalendar the calendar events are deleted and read back first,
  // and if that fails nothing is deleted. Without it the events stay on the calendar.
  raw.delete("/api/saves/:id", async (req, res) => {
    const saveId = Number(req.params.id);
    if (!Number.isSafeInteger(saveId) || saveId < 1) return res.status(400).json({ error: "invalid_id" });
    if (req.body?.approved !== true) return res.status(400).json({ error: "approval_required", detail: "Send approved: true to delete a save." });
    if (jobs?.isRunning(saveId)) return res.status(409).json({ error: "extraction_in_progress", detail: "Wait for the extraction to finish, then delete the save." });
    const actionIds = db.prepare("SELECT id FROM actions WHERE save_id = ?").all(saveId).map((r) => r.id);
    const run = (ids, work) => (ids.length && locks ? locks.run(ids[0], () => run(ids.slice(1), work)) : work());
    const result = await run(actionIds, () => planning.deleteSave({ saveId, removeFromCalendar: req.body?.removeFromCalendar === true }));
    if (result.ok && FILE_RE.test(result.screenshotPath ?? "") && config?.screenshotDir) {
      try { fs.unlinkSync(path.join(config.screenshotDir, result.screenshotPath)); } catch (error) { if (error.code !== "ENOENT") result.screenshotKept = true; }
    }
    const { screenshotPath, ...rest } = result;
    return send(res, rest);
  });
}
