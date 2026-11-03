// GET /api/home: everything the Home screen needs in one read. Database records only, no model call,
// no calendar read except the one cached lookup of the connected account's email.
//
// Definitions (nothing here is invented):
// - next_up: the planned action whose active block has not ended yet and starts first. Null if none.
// - upcoming: open or planned actions with a resolved deadline in the future, earliest first.
//   The state is the latest Recheck of the active block, null when there is no block or no check yet.
// - needs_attention: open or planned actions that are past their deadline without completion, planned actions whose
//   latest Recheck is amber, red, needs_input or error, and planned blocks whose read-back drifted or failed.
// - recent_saves: the latest saves, with their action, or action null if extraction failed.
// - inbox_count: open actions with no confirmed effort, plus saves whose extraction failed. There is no separate
//   "reviewed" flag in the data, so this is what still needs the user before it can be scheduled.
// - alerts_count: planned actions whose latest Recheck is amber, red, needs_input or error.
import { getActionView } from "../actions.js";
import { getGoogleEmail, getSettings, setGoogleEmail } from "../db.js";
import { METRIC_DEFINITIONS } from "../stats.js";
import { toIso } from "../scheduler/time.js";
import { formatForDisplay, formatRelative } from "../tz.js";

const LIMIT = 10;
const CHECK_ALERTS = new Set(["amber", "red", "needs_input", "error"]);
// Lower is more urgent. Picks the primary reason of an item and orders the list. A passed deadline is shown as
// state "red" but ranks above a red Recheck, so it is keyed by its type.
const RANK = { red: 1, amber: 2, needs_input: 3, error: 4, readback_drift: 5, readback_failed: 6 };
const rankOf = (reason) => (reason.type === "deadline_passed" ? 0 : (RANK[reason.state] ?? 9));

/** Compact action shape for lists. The full view stays on GET /api/actions/:id. */
export function actionSummary(view) {
  return {
    id: view.id,
    saveId: view.saveId,
    title: view.title,
    kind: view.kind,
    status: view.status,
    goalId: view.goalId,
    isDemo: view.isDemo,
    screenshotUrl: view.screenshotUrl,
    deadline: view.deadline && { wall: view.deadline.wall, tz: view.deadline.tz, utc: view.deadline.utc, display: view.deadline.display, relative: view.deadline.relative },
    effort: view.effort,
    block: view.block && {
      id: view.block.id,
      startUtc: view.block.startUtc,
      endUtc: view.block.endUtc,
      tz: view.block.tz,
      durationMin: view.block.durationMin,
      startDisplay: view.block.startDisplay,
      endDisplay: view.block.endDisplay,
      startRelative: view.block.startRelative,
      endRelative: view.block.endRelative,
      rangeRelative: view.block.rangeRelative,
      readback: { status: view.block.readback.status },
    },
    check:
      view.check && {
        id: view.check.id,
        state: view.check.state,
        reason: view.check.reason,
        source: view.check.source,
        checkedAt: view.check.checkedAt,
        checkedAtDisplay: view.check.checkedAtDisplay,
        checkedAtRelative: view.check.checkedAtRelative,
        latestFeasibleStart: view.check.latestFeasibleStart,
      },
    warnings: view.warnings.map((w) => w.code),
  };
}

export function createHomeService({ db, calendar, googleAuth, clock = Date.now }) {
  const view = (id) => getActionView(db, id, {nowMs:clock()});

  /** The connected account's email. Cached after the first successful lookup, cleared on disconnect and reconnect. */
  async function connectedAccount() {
    if (!googleAuth?.status?.().connected) return { connected: false, email: null };
    const cached = getGoogleEmail(db);
    if (cached) return { connected: true, email: cached };
    try {
      const found = await calendar.accountEmail();
      if (found?.email) {
        setGoogleEmail(db, found.email);
        return { connected: true, email: found.email };
      }
    } catch {
      // A failed lookup is shown as unknown, never guessed, and never cached.
    }
    return { connected: true, email: null };
  }

  async function home() {
    const nowMs = clock();
    const nowIso = toIso(nowMs);
    const { tz } = getSettings(db);
    const fmt = (iso) => (tz && iso ? formatForDisplay(iso, tz) : null);
    const rel = (iso) => (tz && iso ? formatRelative(iso, tz, nowMs) : null);

    // Next up.
    const upNext = db
      .prepare(
        `SELECT a.id FROM actions a JOIN blocks b ON b.action_id = a.id AND b.superseded_by IS NULL AND b.cancelled_at IS NULL
         WHERE a.status = 'planned' AND b.end_utc > ? ORDER BY b.start_utc, a.id LIMIT 1`,
      )
      .get(nowIso);

    // Upcoming deadlines.
    const upcoming = db
      .prepare(
        `SELECT id FROM actions WHERE status IN ('open', 'planned') AND deadline_utc IS NOT NULL AND deadline_utc > ?
         ORDER BY deadline_utc, id LIMIT ?`,
      )
      .all(nowIso, LIMIT)
      .map(({ id }) => {
        const s = actionSummary(view(id));
        return { ...s, state: s.check?.state ?? null };
      });

    // Needs attention and alerts.
    const candidates = db
      .prepare(
        `SELECT id FROM actions WHERE status = 'planned'
            OR (status = 'open' AND deadline_utc IS NOT NULL AND deadline_utc <= ?) ORDER BY id`,
      )
      .all(nowIso);
    const needsAttention = [];
    let alerts = 0;
    for (const { id } of candidates) {
      const v = view(id);
      const reasons = [];
      if (v.deadline?.utc && v.deadline.utc <= nowIso) {
        reasons.push({ type: "deadline_passed", state: "red", reason: "deadline_passed", text: `The deadline (${v.deadline.display ?? v.deadline.utc}) has passed and this is not marked done.` });
      }
      if (v.status === "planned" && v.check && CHECK_ALERTS.has(v.check.state)) {
        alerts += 1;
        reasons.push({ type: "check", state: v.check.state, reason: v.check.reason, text: v.check.explanation?.[0] ?? v.check.reason });
      }
      const rb = v.block?.readback?.status;
      if (v.status === "planned" && (rb === "drift" || rb === "failed")) {
        const fields = v.block.readback.drift.map((d) => d.field).join(", ");
        reasons.push({ type: "readback", state: `readback_${rb}`, reason: `readback_${rb}`, text: rb === "drift" ? `Google stored the block differently (${fields}).` : "The read-back after the write could not be completed." });
      }
      if (!reasons.length) continue;
      reasons.sort((a, b) => rankOf(a) - rankOf(b));
      needsAttention.push({ action: actionSummary(v), state: reasons[0].state, reason: reasons[0].reason, text: reasons[0].text, reasons });
    }
    needsAttention.sort((a, b) => rankOf(a.reasons[0]) - rankOf(b.reasons[0]) || a.action.id - b.action.id);

    // Recent saves.
    const recentSaves = db
      .prepare("SELECT * FROM saves ORDER BY imported_at DESC, id DESC LIMIT ?")
      .all(LIMIT)
      .map((s) => {
        const actionRow = db.prepare("SELECT id FROM actions WHERE save_id = ? ORDER BY id LIMIT 1").get(s.id);
        return {
          saveId: s.id,
          importedAt: s.imported_at,
          importedAtDisplay: fmt(s.imported_at),
          importedAtRelative: rel(s.imported_at),
          note: s.note ? String(s.note).slice(0, 200) : "",
          screenshotUrl: `/api/saves/${s.id}/screenshot`,
          isDemo: Boolean(s.is_demo),
          extraction: db.prepare('SELECT state FROM extraction_jobs WHERE save_id=? ORDER BY id DESC LIMIT 1').get(s.id)?.state ?? (actionRow ? "done" : "failed"),
          action: actionRow ? actionSummary(view(actionRow.id)) : null,
        };
      });

    // Inbox.
    const needsEffort = db.prepare("SELECT COUNT(*) AS n FROM actions WHERE status = 'open' AND confirmed_effort_min IS NULL").get().n;
    const failedExtractions = db.prepare("SELECT COUNT(*) AS n FROM saves s WHERE NOT EXISTS (SELECT 1 FROM actions a WHERE a.save_id = s.id) AND COALESCE((SELECT state FROM extraction_jobs j WHERE j.save_id=s.id ORDER BY id DESC LIMIT 1),'failed')='failed'").get().n;

    const account = await connectedAccount();
    return {
      now: { utc: nowIso, tz, display: tz ? formatForDisplay(nowMs, tz) : null },
      google_connected: account.connected,
      connected_email: account.email,
      next_up: upNext ? actionSummary(view(upNext.id)) : null,
      upcoming,
      needs_attention: needsAttention,
      recent_saves: recentSaves,
      inbox_count: needsEffort + failedExtractions,
      inbox: { needs_effort: needsEffort, failed_extractions: failedExtractions },
      alerts_count: alerts,
      metric_definitions: METRIC_DEFINITIONS,
    };
  }

  return { home };
}
