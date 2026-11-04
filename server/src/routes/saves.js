// Upload a screenshot + note, extract, and read or edit the resulting action.
import crypto from "node:crypto";
import { createExtractionJobs } from "../services/extractionJobs.js";
import { formatForDisplay, formatRelative } from "../tz.js";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { createSave, getActionForSave, getActionView, getSave, insertActionFromExtraction, updateAction } from "../actions.js";
import { getSettings, listGoals } from "../db.js";
import { extractFromScreenshot, ExtractionError } from "../extraction/extract.js";
import { isDecodable, prepareForModel } from "../extraction/image.js";
import { normalizeExtraction } from "../extraction/normalize.js";
import { localDate } from "../tz.js";
import { cleanPostLink, linkView } from "../postLink.js";

// The note is a one line instruction (when, how long), not a prompt. A short limit keeps model cost small and fixed.
export const MAX_NOTE_CHARS = 160;
const FILE_RE = /^[0-9a-f-]{36}\.(png|jpg|webp)$/;
const EXT_BY_MIME = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MIME_BY_EXT = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

/** Trust the bytes, not the filename or the declared content type. */
export function detectImageType(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function registerSaveRoutes(app, { db, config, provider, clock, locks }) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 6 },
  });

  async function runExtraction(saveId, res) {
    const save = getSave(db, saveId);
    const settings = getSettings(db);
    const goals = listGoals(db);
    const nowMs = clock();
    const file = path.join(config.screenshotDir, save.screenshot_path);
    const imageBuffer = fs.readFileSync(file);
    // Only the copy sent to the model is downscaled. The stored screenshot stays as uploaded.
    let prepared;
    try {
      prepared = await prepareForModel(imageBuffer, detectImageType(imageBuffer));
    } catch {
      return res.status(422).json({ error: "image_unreadable", detail: "The screenshot could not be decoded.", saveId });
    }

    let extraction;
    try {
      extraction = await extractFromScreenshot({
        provider,
        imageBuffer: prepared.buffer,
        mimeType: prepared.mimeType,
        note: save.note,
        goals,
        today: localDate(nowMs, settings.tz ?? "UTC"),
      });
    } catch (err) {
      if (!(err instanceof ExtractionError)) throw err;
      console.error(`Extraction failed for save ${saveId}: ${err.code}`);
      // The save is kept so the user can retry without uploading again.
      return res.status(502).json({ error: err.code, detail: err.message, saveId });
    }

    const normalizationStarted=performance.now();
    const { fields, warnings } = normalizeExtraction(extraction.raw, { note: save.note, goals, settingsTz: settings.tz, nowMs });
    const normalizationMs=Math.round(performance.now()-normalizationStarted);
    const image = {
      originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight,
      sentWidth: prepared.width, sentHeight: prepared.height,
      sentBytes: prepared.buffer.length, resized: prepared.resized,
    };
    const actionId = db.transaction(() => {
      const id=insertActionFromExtraction(db, {
        saveId,
        fields,
        warnings,
        raw: extraction.raw,
        modelName: extraction.model,
        nowIso: new Date(nowMs).toISOString(),
      });
      const finishedAt=new Date(clock()).toISOString();
      const steps=[{n:1,type:'extraction',at:finishedAt,ms:extraction.ms,usage:extraction.usage,image}];
      const correction=warnings.find(w=>w.code==='deadline_offset_ignored' && w.proposed?.corrected);
      if(correction)steps.push({n:2,type:'timezone_correction',at:finishedAt,ms:normalizationMs,...correction.proposed});
      db.prepare('INSERT INTO agent_traces(action_id,created_at,finished_at,instruction,outcome,model,steps_json,result_json) VALUES (?,?,?,?,?,?,?,?)')
        .run(id,new Date(nowMs).toISOString(),finishedAt,'','extracted',extraction.model??null,JSON.stringify(steps),JSON.stringify({outcome:'extracted',saveId}));
      return id;
    })();
    return res.status(201).json({
      saveId,
      action: getActionView(db, actionId, {nowMs:clock()}),
      extraction: {
        ms: extraction.ms,
        usage: extraction.usage,
        image,
      },
    });
  }

  const jobs=createExtractionJobs({db,clock,execute:async(saveId)=>{
    let status=200,body;
    const response={status(value){status=value;return this},json(value){body=value;return this}};
    await runExtraction(saveId,response);
    return {status,body};
  }});
  async function extractResponse(req,res,saveId){
    const job=jobs.start(saveId);
    if(!job.started)return res.status(409).json({error:'extraction_in_progress',saveId,jobId:job.job.id});
    if(req.query.async==='true')return res.status(202).json({saveId,jobId:job.job.id,extractionStatus:job.job.state,statusUrl:`/api/extractions/${job.job.id}`});
    const output=await job.promise;
    return res.status(output.status).json(output.body);
  }
  app.get('/api/extractions/:id',(req,res)=>{
    const job=jobs.get(Number(req.params.id));
    return job?res.json(job):res.status(404).json({error:'not_found'});
  });
  app.patch('/api/saves/:id',(req,res)=>{
    const save=getSave(db,Number(req.params.id));if(!save)return res.status(404).json({error:'not_found'});
    if(jobs.isRunning(save.id))return res.status(409).json({error:'extraction_in_progress'});
    const body=req.body??{},hasNote=Object.hasOwn(body,'note'),hasLink=Object.hasOwn(body,'link');
    if(!hasNote&&!hasLink)return res.status(400).json({error:'invalid_note',detail:`Send a note of at most ${MAX_NOTE_CHARS} characters or a link.`});
    if(hasNote&&(typeof body.note!=='string'||body.note.trim().length>MAX_NOTE_CHARS))return res.status(400).json({error:'invalid_note',detail:`Notes must be text of at most ${MAX_NOTE_CHARS} characters.`});
    let link;
    if(hasLink){const checked=cleanPostLink(body.link);if(!checked.ok)return res.status(400).json({error:'invalid_link',detail:'Use a web address that starts with http or https.'});link=checked.url}
    if(hasNote)db.prepare('UPDATE saves SET note=? WHERE id=?').run(body.note.trim(),save.id);
    if(hasLink)db.prepare('UPDATE saves SET source_url=? WHERE id=?').run(link,save.id);
    const saved=getSave(db,save.id),action=getActionForSave(db,save.id);
    res.json({saveId:save.id,note:saved.note??'',link:linkView(saved.source_url),action:action?getActionView(db,action.id,{nowMs:clock()}):null});
  });
  app.get('/api/saves/:id',(req,res)=>{
    const save=getSave(db,Number(req.params.id));if(!save)return res.status(404).json({error:'not_found'});
    const action=getActionForSave(db,save.id),job=jobs.latest(save.id),tz=getSettings(db).tz;
    res.json({saveId:save.id,note:save.note??'',link:linkView(save.source_url),importedAt:save.imported_at,importedAtDisplay:tz?formatForDisplay(save.imported_at,tz):null,importedAtRelative:tz?formatRelative(save.imported_at,tz,clock()):null,isDemo:Boolean(save.is_demo),screenshotUrl:`/api/saves/${save.id}/screenshot`,extractionStatus:job?.state??(action?'done':'failed'),job,action:action?getActionView(db,action.id,{nowMs:clock()}):null});
  });
  app.post("/api/saves", upload.single("image"), async (req, res) => {
    const note = typeof req.body?.note === "string" ? req.body.note.trim() : "";
    if (note.length > MAX_NOTE_CHARS) return res.status(400).json({ error: "note_too_long", detail: `Notes are limited to ${MAX_NOTE_CHARS} characters.` });
    const checkedLink = cleanPostLink(req.body?.link);
    if (!checkedLink.ok) return res.status(400).json({ error: "invalid_link", detail: "Use a web address that starts with http or https." });
    const sourceUrl = checkedLink.url;
    if (!req.file) return res.status(400).json({ error: "image_required", detail: 'Send the screenshot as multipart field "image".' });
    const mime = detectImageType(req.file.buffer);
    if (!mime || !(await isDecodable(req.file.buffer))) {
      return res.status(415).json({ error: "unsupported_image", detail: "Use a PNG, JPEG or WebP screenshot." });
    }

    const key=req.get('Idempotency-Key');
    if(key && !/^[\x21-\x7e]{1,128}$/.test(key))return res.status(400).json({error:'invalid_idempotency_key'});
    const hash=crypto.createHash('sha256').update(req.file.buffer).update('\0').update(note).update('\0').update(sourceUrl??'').digest('hex');
    if(key){
      const previous=db.prepare('SELECT * FROM saves WHERE import_key=?').get(key);
      if(previous){
        if(previous.import_hash!==hash)return res.status(409).json({error:'idempotency_conflict',detail:'That import key was already used with a different screenshot or note.'});
        const job=jobs.latest(previous.id);
        if(job?.state==='done')return res.json({...job.result,replayed:true});
        if(job?.state==='queued'||job?.state==='running')return res.status(202).json({saveId:previous.id,jobId:job.id,extractionStatus:job.state,statusUrl:`/api/extractions/${job.id}`,replayed:true});
        return res.status(409).json({error:'previous_extraction_failed',saveId:previous.id,detail:'Retry this saved screenshot with /extract instead of uploading it again.'});
      }
    }
    fs.mkdirSync(config.screenshotDir, { recursive: true });
    const filename = `${crypto.randomUUID()}.${EXT_BY_MIME[mime]}`;
    fs.writeFileSync(path.join(config.screenshotDir, filename), req.file.buffer);
    const saveId = createSave(db, { screenshotFile: filename, note, nowIso: new Date(clock()).toISOString(), sourceUrl });
    if(key)db.prepare('UPDATE saves SET import_key=?,import_hash=? WHERE id=?').run(key,hash,saveId);
    return extractResponse(req,res,saveId);
  });

  // Retry extraction for a save whose model call failed.
  app.post("/api/saves/:id/extract", async (req, res) => {
    const save = getSave(db, Number(req.params.id));
    if (!save) return res.status(404).json({ error: "not_found" });
    if (getActionForSave(db, save.id)) return res.status(409).json({ error: "already_extracted" });
    return extractResponse(req,res,save.id);
  });

  app.post('/api/saves/:id/confirm',(req,res)=>{
    const save=getSave(db,Number(req.params.id));if(!save)return res.status(404).json({error:'not_found'});
    const action=getActionForSave(db,save.id);if(!action)return res.status(409).json({error:'not_extracted'});
    if(locks?.isBusyFor(action.id))return res.status(409).json({error:'operation_in_progress'});
    if(req.body?.confirmedEffortMin==null)return res.status(400).json({error:'effort_required',detail:'Confirm your own effort in minutes.'});
    const result=updateAction(db,action.id,{confirmedEffortMin:req.body.confirmedEffortMin},{settingsTz:getSettings(db).tz,nowIso:new Date(clock()).toISOString()});
    return result.ok?res.json(result.view):res.status(result.status).json({error:result.error,field:result.field});
  });
  app.post("/api/saves/:id/retry", async(req,res)=>{
    const save=getSave(db,Number(req.params.id));if(!save)return res.status(404).json({error:"not_found"});
    if(getActionForSave(db,save.id))return res.status(409).json({error:"already_extracted"});
    return extractResponse(req,res,save.id);
  });

  app.get("/api/saves/:id/screenshot", (req, res) => {
    const save = getSave(db, Number(req.params.id));
    if (!save || !FILE_RE.test(save.screenshot_path ?? "")) return res.status(404).json({ error: "not_found" });
    res.type(MIME_BY_EXT[path.extname(save.screenshot_path).slice(1)]);
    res.sendFile(path.resolve(config.screenshotDir, save.screenshot_path));
  });

  app.get("/api/actions/:id", (req, res) => {
    const view = getActionView(db, Number(req.params.id), {nowMs:clock()});
    if (!view) return res.status(404).json({ error: "not_found" });
    res.json(view);
  });

  app.patch("/api/actions/:id", (req, res) => {
    if(locks?.isBusyFor?.(Number(req.params.id)))return res.status(409).json({error:"operation_in_progress"});
    const result = updateAction(db, Number(req.params.id), req.body, {
      settingsTz: getSettings(db).tz,
      nowIso: new Date(clock()).toISOString(),
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error, field: result.field });
    res.json(result.view);
  });
  return jobs;
}
