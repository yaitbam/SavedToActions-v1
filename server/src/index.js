import { createAuthenticatedApp } from "./auth/app.js";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db.js";
import { createGoogleAuth } from "./google/auth.js";
import { createCalendarClient } from "./google/calendar.js";
import { createProvider } from "./model/provider.js";
import { createRecheckService } from "./services/recheck.js";
import { createWatcher } from "./watcher.js";
import { runSelfTest } from "./tz.js";

// Startup self test: moment-timezone must say Africa/Casablanca is +00:00 on 2026-11-05.
// If not, stop. Every wall time to UTC conversion in this app depends on that data.
let selfTest;
try {
  selfTest = runSelfTest();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
console.log(
  `Timezone self test passed: ${selfTest.tz} at ${selfTest.instantUtc} is ${selfTest.actual} ` +
    `(moment-timezone tzdata ${selfTest.momentTimezoneDataVersion}, Node Intl says ${selfTest.nodeIntlOffset}, not used)`,
);

if (config.authMode === "off" && process.env.NODE_ENV === "production") throw new Error("AUTH_MODE=off is only supported for local development");
const provider = createProvider(config.model);
let app;
if (config.authMode !== "off") {
  const authenticated = createAuthenticatedApp({ config, provider, selfTest });
  app = authenticated.app;
} else {
const db = openDb(config.dbPath);
const googleAuth = createGoogleAuth({ db, config });
const calendar = createCalendarClient({ googleAuth });
// The watcher and the "Recheck now" button share this one service, and so the same recheckAction function.
const recheck = createRecheckService({ db, calendar, canRun: () => googleAuth.status().connected });
app = createApp({ db, config, googleAuth, selfTest, provider, calendar, recheck });
const watcher = createWatcher({ run: () => recheck.recheckAll({ source: "watcher" }), intervalMs: config.watcher.intervalMs });
if (config.watcher.enabled) watcher.start();

}

// Bind to loopback for the local app or an HTTPS reverse proxy.
app.listen(config.port, "127.0.0.1", () => {
  console.log(`SavedToAction server on http://localhost:${config.port}`);
  console.log(`Model: ${provider.name} ${provider.model} (${provider.configured() ? "key set" : `NOT configured, set ${provider.name === "meta" ? "META_API_KEY or MODEL_API_KEY" : "BASETEN_API_KEY"}`})`);
  console.log(`Watcher: ${config.watcher.enabled ? `every ${Math.round(config.watcher.intervalMs / 1000)} s` : "off"} (the "Recheck now" button runs the same function)`);
  console.log(`Google OAuth: ${config.google.clientId && config.google.clientSecret ? "client configured" : "NOT configured (set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET)"}`);
});
