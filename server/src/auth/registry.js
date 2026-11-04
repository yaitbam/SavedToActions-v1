import fs from "node:fs";
import path from "node:path";
import { openDb } from "../db.js";
import { createGoogleAuth } from "../google/auth.js";
import { createCalendarClient } from "../google/calendar.js";
import { createRecheckService } from "../services/recheck.js";
import { createApp } from "../app.js";
export function createRegistry({ config, provider, selfTest, vault, clock, workspaceFactory }) {
  const contexts = new Map();
  return {
    get(account) {
      let ctx = contexts.get(account.id);
      if (ctx) { ctx.lastUsed = clock(); return ctx; }
      if (contexts.size >= 20) {
        const candidate = [...contexts.entries()].filter(([, item]) => !item.references && !item.app.locals.workspaceBusy?.()).sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
        if (!candidate) { const error = new Error("Workspace capacity reached"); error.status = 503; throw error; }
        candidate[1].db.close(); contexts.delete(candidate[0]);
      }
      if (workspaceFactory) ctx = workspaceFactory(account);
      else {
        const folder = path.join(config.dataDir, "workspaces", account.workspace_key);
        fs.mkdirSync(folder, { recursive: true });
        const db = openDb(path.join(folder, "db.sqlite"));
        const googleAuth = createGoogleAuth({ db, config, vault });
        const calendar = createCalendarClient({ googleAuth });
        const recheck = createRecheckService({ db, calendar, clock, canRun: () => googleAuth.status().connected });
        const workspaceConfig = { ...config, screenshotDir: path.join(folder, "screenshots") };
        ctx = { db, googleAuth, calendar, recheck, folder, app: createApp({ db, config: workspaceConfig, googleAuth, calendar, recheck, provider, selfTest, clock }) };
      }
      ctx.lastUsed = clock(); contexts.set(account.id, ctx); return ctx;
    },
    values: () => [...contexts.values()],
    close() { for (const ctx of contexts.values()) ctx.db.close(); contexts.clear(); },
  };
}
