import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");
export const REPO_ROOT = path.resolve(SERVER_ROOT, "..");

// .env lives at the repo root and is gitignored. Missing file is fine (env may be set another way).
try {
  process.loadEnvFile(path.join(REPO_ROOT, ".env"));
} catch (err) {
  if (err.code !== "ENOENT") throw err;
}

// Written into extendedProperties.private on every block we create. Defined once, with the scheduler.
export { APP_ID } from "./scheduler/blocks.js";

function reasoningEffortFromEnv(value) {
  if (value === undefined || value === "") return "low";
  return ["off", "default", "none"].includes(value.toLowerCase()) ? null : value;
}

export const config = {
  port: Number(process.env.PORT || 3000),
  frontendOrigin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  dbPath: process.env.DB_PATH || path.join(SERVER_ROOT, "data", "savedtoaction.db"),
  screenshotDir: process.env.SCREENSHOT_DIR || path.join(SERVER_ROOT, "data", "screenshots"),
  maxUploadBytes: 8 * 1024 * 1024,
  // Background recheck of planned blocks. Same function as the "Recheck now" button. WATCHER=off disables it.
  watcher: {
    enabled: process.env.WATCHER !== "off",
    intervalMs: Number(process.env.WATCHER_INTERVAL_MS || 5 * 60_000),
  },
  // Provider switch. Baseten only for now (Meta Model API is deferred).
  model: {
    provider: process.env.MODEL_PROVIDER || "baseten",
    baseten: {
      apiKey: process.env.BASETEN_API_KEY || "",
      baseUrl: process.env.BASETEN_BASE_URL || "https://inference.baseten.co/v1",
      model: process.env.BASETEN_MODEL || "meta-models/muse-spark-open-1026",
      // Default "low". Measured Nov 2 on 5 screenshots (4 synthetic, 1 real), 2 runs each: 45% faster, 79% fewer
      // reasoning tokens, same accuracy (69/70 checks both ways). One of minimal, low, medium, high.
      // BASETEN_REASONING_EFFORT=off sends no reasoning_effort at all (the model's own default).
      reasoningEffort: reasoningEffortFromEnv(process.env.BASETEN_REASONING_EFFORT),
    },
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/auth/google/callback",
    // Fall back to calendar.readonly only if these prove insufficient (CLAUDE.md).
    scopes: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/calendar.freebusy",
    ],
  },
};

export function googleConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}
