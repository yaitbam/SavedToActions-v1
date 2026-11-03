// Saves and actions: create from an extraction, build the API view, apply validated edits.
// Badges and match flags are computed when the view is built, from the stored note and transcription,
// so they stay true after edits. Only confirmed effort is ever scheduled.
import { blockView, checkView, getActiveBlock, getLatestCheck } from "./blockStore.js";
import { formatForDisplay, formatRelative, isValidTimezone, wallToUtc, localDate } from "./tz.js";
import { getSettings } from "./db.js";
import { KINDS, LABELS, VERBATIM_TYPES, badgeFor, badgeLabel, matchSources, eventDateWarning } from "./extraction/normalize.js";

const TZ_SOURCE_LABELS = Object.freeze({
  model: "Read by the model from the post or note",
  settings_fallback: "Not stated in the post. Using your settings timezone",
  user: "Set by you",
});

const parse = (json, fallback) => {
  try {
    return json ? JSON.parse(json) : fallback;
  } catch {
    return fallback;
  }
};

export function createSave(db, { screenshotFile, note, nowIso, isDemo = false }) {
  const info = db
    .prepare("INSERT INTO saves (screenshot_path, note, imported_at, is_demo) VALUES (?, ?, ?, ?)")
    .run(screenshotFile, note, nowIso, isDemo ? 1 : 0);
  return Number(info.lastInsertRowid);
}

export const getSave = (db, id) => db.prepare("SELECT * FROM saves WHERE id = ?").get(id);
export const getActionForSave = (db, saveId) => db.prepare("SELECT * FROM actions WHERE save_id = ?").get(saveId);

export function insertActionFromExtraction(db, { saveId, fields, warnings, raw, modelName, nowIso }) {
  const d = fields.deadline;
  const info = db
    .prepare(
      `INSERT INTO actions (
         save_id, goal_id, kind, label, title,
         deadline_wall, deadline_tz, deadline_tz_source, deadline_utc, deadline_label, deadline_quote, deadline_year_assumed,
         deliverables_json, verbatim_items_json, evidence_quote, transcription, warnings_json, model_output_json, model_name,
         edited_fields_json, suggested_effort_min, event_dates_json, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
    )
    .run(
      saveId,
      fields.goalId,
      fields.kind,
      fields.label,
      fields.title,
      d?.wall ?? null,
      d?.tz ?? null,
      d?.tzSource ?? null,
      d?.utc ?? null,
      d?.label ?? null,
      d?.quote ?? null,
      d?.yearAssumed ? 1 : 0,
      JSON.stringify(fields.deliverables),
      JSON.stringify(fields.verbatimItems.map(({ type, text }) => ({ type, text }))),
      fields.evidenceQuote,
      fields.transcription,
      JSON.stringify(warnings),
      JSON.stringify(raw),
      modelName ?? null,
      "[]",
      fields.suggestedEffortMin,
      JSON.stringify(fields.eventDates.map(({ text, start, end }) => ({ text, start, end }))),
      nowIso,
      nowIso,
    );
  return Number(info.lastInsertRowid);
}

export function getActionView(db, id, {nowMs=Date.now()}={}) {
  const row = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  if (!row) return null;
  const block = getActiveBlock(db, id);
  return viewOf(row, getSave(db, row.save_id), block, block ? getLatestCheck(db, id, block.id) : null, {nowMs,tz:getSettings(db).tz,extractionMs:extractionMsOf(db,id)});
}

/** How long the model took to read the screenshot. It is the first step of the extraction trace. Null if unknown. */
function extractionMsOf(db, actionId) {
  const row = db.prepare("SELECT steps_json FROM agent_traces WHERE action_id = ? AND outcome = 'extracted' ORDER BY id LIMIT 1").get(actionId);
  const ms = parse(row?.steps_json, [])[0]?.ms;
  return Number.isFinite(ms) ? ms : null;
}

export function viewOf(row, save, activeBlock = null, latestCheck = null, {nowMs=Date.now(),tz=null,extractionMs=null}={}) {
  const edited = parse(row.edited_fields_json, []);
  const sources = { note: save.note ?? "", transcription: row.transcription ?? "" };

  const evidenceMatches = row.evidence_quote ? matchSources(row.evidence_quote, sources) : { note: false, transcription: false };
  const evidenceBadge = row.evidence_quote ? badgeFor(evidenceMatches, { edited: edited.includes("evidence_quote") }) : null;

  const confirmed = row.confirmed_effort_min != null;
  const effortLabel = confirmed ? "Your estimate" : row.suggested_effort_min != null ? "Model estimate" : null;
  const eventDates=parse(row.event_dates_json, []).map(item=>{
    const matches=matchSources(item.text,sources);
    const badge=badgeFor(matches,{edited:edited.includes('event_dates')});
    return {...item,matches,badge,badgeLabel:badgeLabel(badge)};
  });
  const warnings=parse(row.warnings_json, []).filter(w=>w.code!=='event_already_happened' && !edited.includes(w.field));
  const pastEvent=eventDateWarning(eventDates,localDate(nowMs,tz??'UTC'));
  if(pastEvent)warnings.push(pastEvent);
  // The model wrote an offset that disagrees with the zone. Code recomputed the time, the Review screen says so.
  const hasTimezoneCorrection=warnings.some(w=>w.code==='deadline_offset_ignored' && w.proposed?.corrected===true);

  return {
    id: row.id,
    saveId: row.save_id,
    status: row.status,
    goalId: row.goal_id,
    kind: row.kind,
    label: row.label,
    title: row.title,
    note: save.note ?? "",
    transcription: row.transcription ?? "",
    screenshotUrl: `/api/saves/${row.save_id}/screenshot`,
    isDemo: Boolean(save.is_demo),
    // The active calendar block, with server formatted times and the read-back result. Null until approved.
    block: blockView(activeBlock,{nowMs}),
    // Latest Recheck of that block: green, amber, red, needs_input or error. Null until one has run.
    check: checkView(latestCheck,{nowMs}),
    doneAt: row.done_at,
    doneAtDisplay: row.done_at && tz ? formatForDisplay(row.done_at,tz) : null,
    doneAtRelative: row.done_at && tz ? formatRelative(row.done_at,tz,nowMs) : null,
    deadline: row.deadline_wall
      ? {
          wall: row.deadline_wall,
          tz: row.deadline_tz,
          tzSource: row.deadline_tz_source,
          tzSourceLabel: row.deadline_tz_source ? TZ_SOURCE_LABELS[row.deadline_tz_source] : null,
          utc: row.deadline_utc,
          // Formatted here. The browser must never convert times itself.
          display: row.deadline_utc && row.deadline_tz ? formatForDisplay(row.deadline_utc, row.deadline_tz) : null,
          relative: row.deadline_utc && row.deadline_tz ? formatRelative(row.deadline_utc, row.deadline_tz, nowMs) : null,
          label: row.deadline_label,
          quote: row.deadline_quote,
          yearAssumed: Boolean(row.deadline_year_assumed),
        }
      : null,
    // Dates of the event itself, verbatim as on the post. Not a deadline.
    eventDates,
    deliverables: parse(row.deliverables_json, []),
    verbatimItems: parse(row.verbatim_items_json, []).map((item) => {
      const matches = matchSources(item.text, sources);
      const badge = badgeFor(matches, {edited:edited.includes("verbatim_items")});
      return { ...item, matches, badge, badgeLabel: badgeLabel(badge) };
    }),
    evidence: {
      quote: row.evidence_quote,
      matches: evidenceMatches,
      badge: evidenceBadge,
      badgeLabel: row.evidence_quote ? badgeLabel(evidenceBadge) : null,
    },
    effort: {
      suggestedMin: row.suggested_effort_min,
      confirmedMin: row.confirmed_effort_min,
      confirmed,
      label: effortLabel,
      // Only confirmed effort is scheduled.
      scheduledMin: row.confirmed_effort_min,
    },
    edited,
    // A warning about a field the user has since edited is no longer relevant.
    warnings,
    model: row.model_name,
    extractionLatencyMs: extractionMs,
    hasTimezoneCorrection,
    createdAt: row.created_at,
  };
}

const fail = (status, error, field) => ({ ok: false, status, error, field });

function optString(v, max) {
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  if (t.length > max) return undefined;
  return t || null;
}

/**
 * Apply a PATCH. Every field is optional and validated. Changed fields are recorded in edited_fields_json
 * so the UI can say "Edited by you". The model's suggested effort is never editable, the user confirms
 * their own with confirmedEffortMin.
 * Returns { ok: true, view } or { ok: false, status, error, field }.
 */
export function updateAction(db, id, patch, { settingsTz = null, nowIso }) {
  const row = db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
  if (!row) return fail(404, "not_found");
  if (row.status === "done" || row.status === "skipped") return fail(409, "action_closed");
  if (!patch || typeof patch !== "object") return fail(400, "invalid_body");

  const edited = new Set(parse(row.edited_fields_json, []));
  const set = {};

  if ("title" in patch) {
    const v = optString(patch.title, 200);
    if (v === undefined) return fail(400, "invalid_title", "title");
    if (v !== row.title) {
      set.title = v;
      edited.add("title");
    }
  }

  if ("goalId" in patch) {
    const v = patch.goalId;
    if (v !== null && !(Number.isInteger(v) && db.prepare("SELECT 1 FROM goals WHERE id = ?").get(v))) return fail(400, "invalid_goal", "goal");
    if (v !== row.goal_id) {
      set.goal_id = v;
      edited.add("goal");
    }
  }

  if ("kind" in patch) {
    if (!KINDS.includes(patch.kind)) return fail(400, "invalid_kind", "kind");
    if (patch.kind !== row.kind) {
      set.kind = patch.kind;
      edited.add("kind");
    }
  }

  if ("label" in patch) {
    if (patch.label !== null && !LABELS.includes(patch.label)) return fail(400, "invalid_label", "label");
    if (patch.label !== row.label) {
      set.label = patch.label;
      edited.add("label");
    }
  }

  if ("deliverables" in patch) {
    const list = patch.deliverables;
    if (!Array.isArray(list) || list.length > 20) return fail(400, "invalid_deliverables", "deliverables");
    const cleaned = [];
    for (const d of list) {
      const t = optString(d, 500);
      if (typeof t !== "string") return fail(400, "invalid_deliverables", "deliverables");
      cleaned.push(t);
    }
    if (JSON.stringify(cleaned) !== row.deliverables_json) {
      set.deliverables_json = JSON.stringify(cleaned);
      edited.add("deliverables");
    }
  }

  if ("verbatimItems" in patch) {
    const list = patch.verbatimItems;
    if (!Array.isArray(list) || list.length > 30) return fail(400, "invalid_verbatim_items", "verbatim_items");
    const cleaned = [];
    for (const item of list) {
      const text = optString(item?.text, 2000);
      if (typeof text !== "string" || !VERBATIM_TYPES.includes(item.type)) return fail(400, "invalid_verbatim_items", "verbatim_items");
      cleaned.push({ type: item.type, text });
    }
    if (JSON.stringify(cleaned) !== row.verbatim_items_json) {
      set.verbatim_items_json = JSON.stringify(cleaned);
      edited.add("verbatim_items");
    }
  }

  if ("eventDates" in patch) {
    const list = patch.eventDates;
    if (!Array.isArray(list) || list.length > 10) return fail(400, "invalid_event_dates", "event_dates");
    const cleaned = [];
    for (const item of list) {
      const text = optString(item?.text, 200);
      const iso = (v) => v === null || v === undefined || (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && wallToUtc(`${v}T00:00`, "UTC").ok);
      if (typeof text !== "string" || !iso(item.start) || !iso(item.end)) return fail(400, "invalid_event_dates", "event_dates");
      cleaned.push({ text, start: item.start ?? null, end: item.end ?? item.start ?? null });
    }
    if (JSON.stringify(cleaned) !== row.event_dates_json) {
      set.event_dates_json = JSON.stringify(cleaned);
      edited.add("event_dates");
    }
  }

  if ("evidenceQuote" in patch) {
    const v = optString(patch.evidenceQuote, 1000);
    if (v === undefined) return fail(400, "invalid_evidence_quote", "evidence_quote");
    if (v !== row.evidence_quote) {
      set.evidence_quote = v;
      edited.add("evidence_quote");
    }
  }

  if ("deadline" in patch) {
    const d = patch.deadline;
    if (d === null) {
      if (row.deadline_wall !== null) {
        Object.assign(set, {
          deadline_wall: null,
          deadline_tz: null,
          deadline_tz_source: null,
          deadline_utc: null,
          deadline_label: null,
          deadline_quote: null,
          deadline_year_assumed: 0,
        });
        edited.add("deadline");
      }
    } else {
      if (!d || typeof d !== "object" || typeof d.wall !== "string") return fail(400, "invalid_deadline", "deadline");
      let tz = row.deadline_tz;
      let source = row.deadline_tz_source;
      if (d.tz !== undefined) {
        if (typeof d.tz === "string" && d.tz.trim()) {
          if (!isValidTimezone(d.tz.trim())) return fail(400, "invalid_timezone", "deadline");
          tz = d.tz.trim();
          source = "user";
        } else if (settingsTz) {
          tz = settingsTz;
          source = "settings_fallback";
        } else {
          tz = null;
          source = null;
        }
      } else if (!tz && settingsTz) {
        tz = settingsTz;
        source = "settings_fallback";
      }
      const resolved = wallToUtc(d.wall, tz);
      if (!resolved.ok && resolved.reason !== "missing_timezone") return fail(400, "invalid_deadline", "deadline");
      const utc = resolved.ok ? resolved.utc : null;
      if (d.wall !== row.deadline_wall || tz !== row.deadline_tz) {
        Object.assign(set, {
          deadline_wall: d.wall,
          deadline_tz: tz,
          deadline_tz_source: source,
          deadline_utc: utc,
          deadline_year_assumed: 0,
        });
        if ("label" in d) set.deadline_label = optString(d.label, 200) ?? null;
        edited.add("deadline");
      }
    }
  }

  if ("confirmedEffortMin" in patch) {
    const v = patch.confirmedEffortMin;
    if (v !== null && !(Number.isInteger(v) && v >= 1 && v <= 1440)) return fail(400, "invalid_effort", "effort");
    if (v !== row.confirmed_effort_min) set.confirmed_effort_min = v;
  }

  if (Object.keys(set).length) {
    // Column names come from the keys assigned above, never from the request.
    const cols = Object.keys(set);
    db.prepare(`UPDATE actions SET ${cols.map((c) => `${c} = ?`).join(", ")}, edited_fields_json = ?, updated_at = ? WHERE id = ?`).run(
      ...cols.map((c) => set[c]),
      JSON.stringify([...edited]),
      nowIso,
      id,
    );
  }
  return { ok: true, view: getActionView(db, id, {nowMs:Date.parse(nowIso)}) };
}
