import { saveReadback } from "../blockStore.js";
import { CalendarError } from "../google/calendar.js";
import { APP_ID, compareReadback, readTags, toIso } from "../scheduler/index.js";

const PREFIX = "Done · ";
const MARKER = "stDone";
const fail = (status, error, detail) => ({ ok: false, status, error, detail });

// Only the active event owned by this app can receive or lose our completion prefix.
export async function updateCompletionTitle({ db, calendar, block, done, approved, clock }) {
  if (done && approved !== true) return fail(400, "approval_required", "Approve marking the calendar event Done.");
  const event = await calendar.getEvent(block.google_event_id);
  if (!event || event.status === "cancelled") {
    return fail(409, "calendar_event_missing", "The calendar event is missing. The task status has not changed.");
  }
  const tags = readTags(event);
  if (tags.app !== APP_ID || tags.key !== block.idempotency_key) {
    return fail(409, "calendar_event_not_owned", "This calendar event no longer belongs to this task. The task status has not changed.");
  }

  const marked = event.extendedProperties?.private?.[MARKER] === "1";
  if (!done && !marked) return { ok: true, updated: false };
  const title = event.summary ?? "";
  let summary = title;
  if (done && (!marked || !title.startsWith(PREFIX))) summary = PREFIX + title;
  if (!done && marked && title.startsWith(PREFIX)) summary = title.slice(PREFIX.length);
  const needsPatch = marked !== done || summary !== title;
  if (needsPatch) {
    if (approved !== true) return fail(400, "approval_required", "Approve restoring the calendar event title.");
    await calendar.patchEvent(block.google_event_id, {
      summary,
      extendedProperties: { private: { [MARKER]: done ? "1" : null } },
    }, { etag: event.etag });
  }

  // Even a retry after a successful write must verify the title before changing local status.
  let actual;
  try {
    actual = await calendar.getEvent(block.google_event_id);
  } catch (error) {
    if (error instanceof CalendarError) saveReadback(db, block.id, { status: "failed", drift: [], error: error.code }, toIso(clock()));
    throw error;
  }
  const readback = compareReadback({ block, event: actual });
  if (actual?.summary !== summary) readback.drift.push({ field: "summary", expected: summary, actual: actual?.summary ?? null });
  if ((actual?.extendedProperties?.private?.[MARKER] === "1") !== done) {
    readback.drift.push({ field: "completion_marker", expected: done, actual: !done });
  }
  readback.status = readback.drift.length ? "drift" : "ok";
  saveReadback(db, block.id, readback, toIso(clock()));
  if (readback.status !== "ok" || actual?.summary !== summary ||
      (actual?.extendedProperties?.private?.[MARKER] === "1") !== done) {
    throw new CalendarError("calendar_completion_unverified", "Could not verify the calendar title and booking. The task status has not changed. Try again.");
  }
  return { ok: true, updated: needsPatch };
}
