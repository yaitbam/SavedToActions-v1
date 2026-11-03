// An in-memory stand in for Google Calendar, with the same interface as createCalendarClient.
// It behaves like Google where it matters to us: event ids are unique (409 on a duplicate), deleted events stay
// readable as "cancelled", events.list hides cancelled events, FreeBusy merges everything busy into intervals,
// and returned dateTimes carry the offset of the event's timezone.
// `sim` switches on the failures we want to catch: a wrong offset (the Casablanca worry), shifted instants,
// a changed timezone, or stripped extended properties.
import moment from "moment-timezone";
import { CalendarError } from "../src/google/calendar.js";

export function createFakeCalendar() {
  const store = new Map();
  const calls = [];
  const bodies = [];
  const failures = new Map();
  const sim = { offset: null, shiftMs: 0, tzOverride: null, dropTags: false };

  const maybeFail = (method) => {
    const err = failures.get(method);
    if (err) {
      failures.delete(method);
      throw err;
    }
  };

  const fmt = (ms, tz) => (sim.offset ? moment.utc(ms).utcOffset(sim.offset).format() : moment.utc(ms).tz(tz).format());

  function render(e) {
    const tz = sim.tzOverride ?? e.tz;
    const day = (ms) => new Date(ms).toISOString().slice(0, 10);
    return {
      id: e.id,
      status: e.status,
      summary: e.summary,
      description: e.description,
      transparency: e.transparency,
      attendees: e.attendees,
      extendedProperties: sim.dropTags ? undefined : e.extendedProperties,
      // All-day events carry a date and no dateTime, like Google's.
      start: e.allDay ? { date: day(e.startMs) } : { dateTime: fmt(e.startMs + sim.shiftMs, e.tz), timeZone: tz },
      end: e.allDay ? { date: day(e.endMs) } : { dateTime: fmt(e.endMs + sim.shiftMs, e.tz), timeZone: tz },
    };
  }

  const overlapping = (fromMs, toMs) => [...store.values()].filter((e) => e.startMs < toMs && e.endMs > fromMs);

  return {
    calls,
    bodies,
    sim,
    failNext: (method, err) => failures.set(method, err),

    // Test controls.
    addEvent({ id, summary = "Meeting", start, end, transparency = "opaque", status = "confirmed", extendedProperties, attendees, allDay = false }) {
      store.set(id, { id, summary, startMs: Date.parse(start), endMs: Date.parse(end), tz: "UTC", transparency, status, extendedProperties, attendees, allDay });
    },
    cancel: (id) => {
      store.get(id).status = "cancelled";
    },
    has: (id) => store.has(id),
    raw: (id) => store.get(id),
    count: () => store.size,

    // Same interface as createCalendarClient.
    accountEmailValue: "owner@example.test",
    async accountEmail() {
      calls.push("accountEmail");
      maybeFail("accountEmail");
      return this.accountEmailValue ? { email: this.accountEmailValue, source: "calendar_title" } : null;
    },

    async freeBusy({ fromMs, toMs }) {
      calls.push("freeBusy");
      maybeFail("freeBusy");
      return overlapping(fromMs, toMs)
        .filter((e) => e.status !== "cancelled" && e.transparency !== "transparent")
        .map((e) => ({ start: e.startMs, end: e.endMs }));
    },

    async listEvents({ fromMs, toMs }) {
      calls.push("listEvents");
      maybeFail("listEvents");
      return overlapping(fromMs, toMs)
        .filter((e) => e.status !== "cancelled")
        .map(render);
    },

    async insertEvent(body) {
      calls.push("insertEvent");
      maybeFail("insertEvent");
      if (store.has(body.id)) throw new CalendarError("event_exists", "An event with this id already exists.", { status: 409 });
      bodies.push(body);
      store.set(body.id, {
        id: body.id,
        summary: body.summary,
        description: body.description,
        startMs: Date.parse(body.start.dateTime),
        endMs: Date.parse(body.end.dateTime),
        tz: body.start.timeZone ?? "UTC",
        transparency: body.transparency,
        status: "confirmed",
        extendedProperties: body.extendedProperties,
      });
      return render(store.get(body.id));
    },

    async getEvent(id) {
      calls.push("getEvent");
      maybeFail("getEvent");
      const e = store.get(id);
      return e ? render(e) : null;
    },

    async deleteEvent(id) {
      calls.push("deleteEvent");
      maybeFail("deleteEvent");
      const e = store.get(id);
      if (!e) return { alreadyGone: true };
      e.status = "cancelled";
      return { alreadyGone: false };
    },
  };
}
