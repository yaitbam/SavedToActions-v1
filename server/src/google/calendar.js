// Google Calendar access: FreeBusy for the first slot search, events.list for event level reads,
// and the writes (insert, patch, delete) behind the approval gate. Primary calendar only.
// Everything returns plain data or throws CalendarError with a stable code.
import { google } from "googleapis";
import { toIso } from "../scheduler/time.js";

const CALENDAR_ID = "primary";
const FREEBUSY_CHUNK_MS = 60 * 24 * 60 * 60_000;
const MAX_LIST_PAGES = 40;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class CalendarError extends Error {
  constructor(code, message, { status = null } = {}) {
    super(message);
    this.name = "CalendarError";
    this.code = code;
    this.status = status;
  }
}

/** HTTP status for a calendar error code. Setup problems are 409, an expired login 401, the rest is Google's fault. */
export const calendarErrorStatus = (code) => ({ google_not_connected: 409, google_missing_scopes: 409, google_auth_error: 401, calendar_event_changed: 409 })[code] ?? 502;

/** googleapis / gaxios errors carry the HTTP status in err.code (number) or err.response.status. */
export function mapGoogleError(err) {
  if (err instanceof CalendarError) return err;
  const status = Number(err?.code ?? err?.status ?? err?.response?.status) || null;
  const message = String(err?.message ?? err);
  if (status === 401 || /invalid_grant/i.test(message)) {
    return new CalendarError("google_auth_error", "Google rejected the stored login. Connect Google again.", { status });
  }
  if (status === 403) {
    const reason = err?.errors?.[0]?.reason ?? err?.response?.data?.error?.errors?.[0]?.reason ?? "";
    if (/rateLimit|quota/i.test(reason)) return new CalendarError("google_unavailable", "Google rate limit reached. Try again shortly.", { status });
    return new CalendarError("google_forbidden", "Google denied the request. The granted scopes may not be enough.", { status });
  }
  if (status === 404) return new CalendarError("google_not_found", "Google could not find that item.", { status });
  if (status === 409) return new CalendarError("event_exists", "An event with this id already exists.", { status });
  if (status === 412) return new CalendarError("calendar_event_changed", "The calendar event changed. Try again.", { status });
  if (status === 429 || (status && status >= 500)) return new CalendarError("google_unavailable", `Google is unavailable (HTTP ${status}).`, { status });
  if (status) return new CalendarError("google_error", `Google returned HTTP ${status}.`, { status });
  return new CalendarError("google_unreachable", `Could not reach Google: ${message}`);
}

/**
 * The Google event we write. dateTime is an exact UTC instant, timeZone says which zone to show it in.
 * start/end/tz are read back after the write and compared (see scheduler/readback.js).
 */
export function buildEventBody({ eventId, summary, description, startUtc, endUtc, tz, tags }) {
  return {
    id: eventId,
    summary,
    description,
    start: { dateTime: startUtc, timeZone: tz },
    end: { dateTime: endUtc, timeZone: tz },
    transparency: "opaque",
    extendedProperties: { private: tags },
  };
}

export function createCalendarClient({ googleAuth, apiFactory = (auth) => google.calendar({ version: "v3", auth }) }) {
  function api() {
    const status = googleAuth.status();
    if (!status.connected) throw new CalendarError("google_not_connected", "Google Calendar is not connected.");
    if (status.missingScopes.length) {
      throw new CalendarError("google_missing_scopes", `Google access is missing: ${status.missingScopes.join(", ")}. Connect Google again.`);
    }
    const auth = googleAuth.authorizedClient();
    if (!auth) throw new CalendarError("google_not_connected", "Google Calendar is not connected.");
    return apiFactory(auth);
  }

  async function call(fn) {
    try {
      return await fn(api());
    } catch (err) {
      throw mapGoogleError(err);
    }
  }

  return {
    /** Busy intervals (epoch ms) from the FreeBusy query. Used for the first slot search only. */
    async freeBusy({ fromMs, toMs }) {
      const busy = [];
      for (let start = fromMs; start < toMs; start += FREEBUSY_CHUNK_MS) {
        const end = Math.min(toMs, start + FREEBUSY_CHUNK_MS);
        const res = await call((a) =>
          a.freebusy.query({ requestBody: { timeMin: toIso(start), timeMax: toIso(end), items: [{ id: CALENDAR_ID }] } }),
        );
        const cal = res.data?.calendars?.[CALENDAR_ID];
        if (cal?.errors?.length) {
          throw new CalendarError("google_freebusy_error", `FreeBusy failed: ${cal.errors.map((e) => e.reason).join(", ")}`);
        }
        for (const b of cal?.busy ?? []) busy.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
      }
      return busy;
    },

    /** Event level read over a window. Recurring events come expanded. Deleted events are not returned. */
    async listEvents({ fromMs, toMs }) {
      const items = [];
      let pageToken;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const res = await call((a) =>
          a.events.list({
            calendarId: CALENDAR_ID,
            timeMin: toIso(fromMs),
            timeMax: toIso(toMs),
            singleEvents: true,
            orderBy: "startTime",
            maxResults: 250,
            showDeleted: false,
            pageToken,
          }),
        );
        items.push(...(res.data?.items ?? []));
        pageToken = res.data?.nextPageToken;
        if (!pageToken) break;
      }
      return items;
    },

    /**
     * The connected account's email, or null. The token has no profile scope and calendarList.get is refused, so it is
     * read from the primary calendar: its title is the account email, with the organizer of our own events as fallback.
     */
    async accountEmail() {
      const res = await call((a) =>
        a.events.list({ calendarId: CALENDAR_ID, timeMin: toIso(Date.now()), maxResults: 1, singleEvents: true, orderBy: "startTime", fields: "summary,items(organizer(email,self))" }),
      );
      const title = res.data?.summary;
      if (typeof title === "string" && EMAIL_RE.test(title)) return { email: title, source: "calendar_title" };
      const self = (res.data?.items ?? []).find((e) => e.organizer?.self && EMAIL_RE.test(e.organizer.email ?? ""));
      return self ? { email: self.organizer.email, source: "event_organizer" } : null;
    },

    async insertEvent(body) {
      const res = await call((a) => a.events.insert({ calendarId: CALENDAR_ID, requestBody: body }));
      return res.data;
    },

    async patchEvent(eventId, body, { etag } = {}) {
      const options = etag ? { headers: { "If-Match": etag } } : {};
      const res = await call((a) => a.events.patch({ calendarId: CALENDAR_ID, eventId, requestBody: body }, options));
      return res.data;
    },

    /** The event, a cancelled event (Google keeps deleted ids), or null if it is gone. */
    async getEvent(eventId) {
      try {
        const res = await call((a) => a.events.get({ calendarId: CALENDAR_ID, eventId }));
        return res.data;
      } catch (err) {
        if (err.code === "google_not_found" || err.status === 410) return null;
        throw err;
      }
    },

    async deleteEvent(eventId) {
      try {
        await call((a) => a.events.delete({ calendarId: CALENDAR_ID, eventId }));
        return { alreadyGone: false };
      } catch (err) {
        if (err.code === "google_not_found" || err.status === 410) return { alreadyGone: true };
        throw err;
      }
    },
  };
}
