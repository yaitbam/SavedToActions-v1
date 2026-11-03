// Compares one extracted action with its manifest entry. Pure, no database and no network.
// The manifest is a check, never model input. Only goal and deadline are compared.

const DEADLINE_RE = /^(\d{4}-\d{2}-\d{2})(?:\s+(\d{2}:\d{2}))?(?:\s+(GMT|UTC))?/;

/** "2026-11-20 23:59 GMT" -> { date, time, utcStated }. "2026-11-30 (RSVP)" -> time null. null stays null. */
export function parseExpectedDeadline(text) {
  if (text == null) return null;
  const m = String(text).match(DEADLINE_RE);
  return m ? { date: m[1], time: m[2] ?? null, utcStated: Boolean(m[3]) } : { unreadable: String(text) };
}

const shown = (v) => (v == null ? "Missing" : v);

/**
 * entry: manifest item. action: Action view or null. goals: [{ id, name }].
 * Returns { goal: { expected, got, ok }, deadline: { expected, got, ok, note }, ok }.
 */
export function compareToManifest(entry, action, goals) {
  const gotGoal = goals.find((g) => g.id === action?.goalId)?.name ?? null;
  const goal = { expected: entry.expected_goal ?? null, got: gotGoal, ok: (entry.expected_goal ?? null) === gotGoal };

  const exp = parseExpectedDeadline(entry.deadline_in_image);
  const dl = action?.deadline ?? null;
  const timeMissingDate = action?.warnings?.find((w) => w.code === "deadline_time_missing")?.proposed?.date ?? null;
  let ok;
  let note = "";
  if (exp === null) {
    ok = dl === null;
    if (!ok) note = "deadline not in the image";
  } else if (exp.unreadable) {
    ok = false;
    note = "manifest value not understood";
  } else if (exp.time === null) {
    // Date only. By design no time is invented, so the deadline stays Missing and the date is kept as a warning.
    if (dl === null) {
      ok = timeMissingDate === exp.date;
      note = ok ? "date only, time Missing" : "date not read";
    } else {
      ok = false;
      note = dl.wall.startsWith(exp.date) ? "time invented" : "wrong date";
    }
  } else if (dl === null) {
    ok = false;
    note = "deadline Missing";
  } else if (dl.wall !== `${exp.date}T${exp.time}`) {
    ok = false;
    note = "wrong wall time";
  } else if (exp.utcStated && dl.utc !== `${exp.date}T${exp.time}:00.000Z`) {
    ok = false;
    note = `wrong timezone (${dl.tz})`;
  } else {
    ok = true;
  }
  const expectedText = exp === null ? null : (exp.unreadable ?? [exp.date, exp.time].filter(Boolean).join(" "));
  const gotText = dl ? `${dl.wall.replace("T", " ")} ${dl.tz ?? ""}`.trim() : null;
  return { goal, deadline: { expected: shown(expectedText), got: shown(gotText), ok, note }, ok: goal.ok && ok };
}
