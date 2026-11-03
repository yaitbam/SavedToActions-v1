import test from "node:test";
import assert from "node:assert/strict";
import { CalendarError, buildEventBody, createCalendarClient, mapGoogleError } from "../src/google/calendar.js";

const DAY = 24 * 60 * 60_000;
const FROM = Date.parse("2026-11-02T00:00:00Z");
const auth = (over = {}) => ({ status: () => ({ connected: true, missingScopes: [], ...over }), authorizedClient: () => ({ fake: "auth" }) });
const httpError = (code, message = "boom", extra = {}) => Object.assign(new Error(message), { code, ...extra });

function clientWith(handlers, authOver) {
  const seen = [];
  const api = {
    freebusy: { query: async (p) => (seen.push(["freebusy.query", p]), handlers.freebusy(p)) },
    events: {
      list: async (p) => (seen.push(["events.list", p]), handlers.list(p)),
      insert: async (p) => (seen.push(["events.insert", p]), handlers.insert(p)),
      get: async (p) => (seen.push(["events.get", p]), handlers.get(p)),
      delete: async (p) => (seen.push(["events.delete", p]), handlers.delete(p)),
    },
  };
  const client = createCalendarClient({
    googleAuth: auth(authOver),
    apiFactory: (a) => {
      assert.deepEqual(a, { fake: "auth" });
      return api;
    },
  });
  return { client, seen };
}

test("freeBusy: asks for the primary calendar, splits long ranges into 60 day chunks, parses busy intervals", async () => {
  let n = 0;
  const { client, seen } = clientWith({
    freebusy: async () => ({ data: { calendars: { primary: { busy: [{ start: `2026-11-0${++n}T13:00:00Z`, end: `2026-11-0${n}T14:00:00Z` }] } } } }),
  });
  const busy = await client.freeBusy({ fromMs: FROM, toMs: FROM + 100 * DAY });
  assert.equal(seen.length, 2);
  assert.deepEqual(seen[0][1].requestBody, { timeMin: "2026-11-02T00:00:00.000Z", timeMax: new Date(FROM + 60 * DAY).toISOString(), items: [{ id: "primary" }] });
  assert.equal(seen[1][1].requestBody.timeMin, new Date(FROM + 60 * DAY).toISOString());
  assert.equal(seen[1][1].requestBody.timeMax, new Date(FROM + 100 * DAY).toISOString());
  assert.deepEqual(busy, [
    { start: Date.parse("2026-11-01T13:00:00Z"), end: Date.parse("2026-11-01T14:00:00Z") },
    { start: Date.parse("2026-11-02T13:00:00Z"), end: Date.parse("2026-11-02T14:00:00Z") },
  ]);
});

test("freeBusy: errors reported inside the response are not silently treated as free time", async () => {
  const { client } = clientWith({ freebusy: async () => ({ data: { calendars: { primary: { errors: [{ reason: "notFound" }] } } } }) });
  await assert.rejects(client.freeBusy({ fromMs: FROM, toMs: FROM + DAY }), { code: "google_freebusy_error" });
});

test("listEvents: event level read, expanded recurring events, newest page token followed", async () => {
  const pages = [
    { data: { items: [{ id: "a" }], nextPageToken: "t2" } },
    { data: { items: [{ id: "b" }] } },
  ];
  const { client, seen } = clientWith({ list: async () => pages.shift() });
  const events = await client.listEvents({ fromMs: FROM, toMs: FROM + DAY });
  assert.deepEqual(events.map((e) => e.id), ["a", "b"]);
  assert.deepEqual(seen[0][1], {
    calendarId: "primary",
    timeMin: "2026-11-02T00:00:00.000Z",
    timeMax: "2026-11-03T00:00:00.000Z",
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 250,
    showDeleted: false,
    pageToken: undefined,
  });
  assert.equal(seen[1][1].pageToken, "t2");
});

test("insertEvent: sends the body as is, a duplicate id is event_exists", async () => {
  const body = { id: "staabc", summary: "S" };
  const ok = clientWith({ insert: async () => ({ data: { ...body, status: "confirmed" } }) });
  assert.equal((await ok.client.insertEvent(body)).status, "confirmed");
  assert.deepEqual(ok.seen[0][1], { calendarId: "primary", requestBody: body });
  const dup = clientWith({ insert: async () => { throw httpError(409); } });
  await assert.rejects(dup.client.insertEvent(body), (e) => e instanceof CalendarError && e.code === "event_exists" && e.status === 409);
});

test("getEvent: the event, null when gone (404 or 410), errors otherwise", async () => {
  const found = clientWith({ get: async () => ({ data: { id: "x", status: "cancelled" } }) });
  assert.equal((await found.client.getEvent("x")).status, "cancelled");
  assert.deepEqual(found.seen[0][1], { calendarId: "primary", eventId: "x" });
  for (const code of [404, 410]) {
    assert.equal(await clientWith({ get: async () => { throw httpError(code); } }).client.getEvent("x"), null);
  }
  await assert.rejects(clientWith({ get: async () => { throw httpError(500); } }).client.getEvent("x"), { code: "google_unavailable" });
});

test("deleteEvent: already gone is fine, a real failure is not", async () => {
  assert.deepEqual(await clientWith({ delete: async () => ({}) }).client.deleteEvent("x"), { alreadyGone: false });
  for (const code of [404, 410]) {
    assert.deepEqual(await clientWith({ delete: async () => { throw httpError(code); } }).client.deleteEvent("x"), { alreadyGone: true });
  }
  await assert.rejects(clientWith({ delete: async () => { throw httpError(403); } }).client.deleteEvent("x"), { code: "google_forbidden" });
});

test("mapGoogleError: stable codes for every failure we handle", () => {
  const code = (err) => mapGoogleError(err).code;
  assert.equal(code(httpError(401)), "google_auth_error");
  assert.equal(code(httpError(400, "invalid_grant")), "google_auth_error");
  assert.equal(code(httpError(403)), "google_forbidden");
  assert.equal(code(httpError(403, "x", { errors: [{ reason: "rateLimitExceeded" }] })), "google_unavailable");
  assert.equal(code(httpError(404)), "google_not_found");
  assert.equal(code(httpError(409)), "event_exists");
  assert.equal(code(httpError(429)), "google_unavailable");
  assert.equal(code(httpError(503)), "google_unavailable");
  assert.equal(code(httpError(400)), "google_error");
  assert.equal(code(Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" })), "google_unreachable");
  assert.equal(code(Object.assign(new Error("x"), { response: { status: 500 } })), "google_unavailable");
  const own = new CalendarError("google_not_connected", "x");
  assert.equal(mapGoogleError(own), own);
});

test("not connected, missing scopes or no usable login: a clear error and no API call", async () => {
  let built = false;
  const make = (googleAuth) => createCalendarClient({ googleAuth, apiFactory: () => ((built = true), {}) });
  await assert.rejects(make({ status: () => ({ connected: false, missingScopes: [] }), authorizedClient: () => null }).listEvents({ fromMs: 0, toMs: 1 }), { code: "google_not_connected" });
  await assert.rejects(make(auth({ missingScopes: ["calendar.events"] })).getEvent("x"), { code: "google_missing_scopes" });
  await assert.rejects(make({ status: () => ({ connected: true, missingScopes: [] }), authorizedClient: () => null }).freeBusy({ fromMs: 0, toMs: 1 }), { code: "google_not_connected" });
  assert.equal(built, false);
});

test("accountEmail: the primary calendar title is the account email, an organizer who is you is the fallback, else null", async () => {
  const byTitle = clientWith({ list: async () => ({ data: { summary: "me@example.test", items: [] } }) });
  assert.deepEqual(await byTitle.client.accountEmail(), { email: "me@example.test", source: "calendar_title" });
  assert.equal(byTitle.seen[0][1].calendarId, "primary");
  assert.equal(byTitle.seen[0][1].maxResults, 1);

  const byOrganizer = clientWith({ list: async () => ({ data: { summary: "Work calendar", items: [{ organizer: { email: "me@example.test", self: true } }] } }) });
  assert.deepEqual(await byOrganizer.client.accountEmail(), { email: "me@example.test", source: "event_organizer" });

  const notYou = clientWith({ list: async () => ({ data: { summary: "Work calendar", items: [{ organizer: { email: "other@example.test", self: false } }] } }) });
  assert.equal(await notYou.client.accountEmail(), null, "never guess from someone else's event");
  await assert.rejects(clientWith({ list: async () => { throw httpError(403); } }).client.accountEmail(), { code: "google_forbidden" });
});

test("buildEventBody: exact UTC instants, the zone to show them in, our tags, opaque", () => {
  assert.deepEqual(
    buildEventBody({
      eventId: "staabc",
      summary: "Check registration",
      description: "d",
      startUtc: "2026-11-05T14:00:00.000Z",
      endUtc: "2026-11-05T15:00:00.000Z",
      tz: "Africa/Casablanca",
      tags: { stApp: "savedtoaction", stIdempotencyKey: "k" },
    }),
    {
      id: "staabc",
      summary: "Check registration",
      description: "d",
      start: { dateTime: "2026-11-05T14:00:00.000Z", timeZone: "Africa/Casablanca" },
      end: { dateTime: "2026-11-05T15:00:00.000Z", timeZone: "Africa/Casablanca" },
      transparency: "opaque",
      extendedProperties: { private: { stApp: "savedtoaction", stIdempotencyKey: "k" } },
    },
  );
});
