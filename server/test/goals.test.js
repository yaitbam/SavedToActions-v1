import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import {
  GoalError, MAX_ACTIVE_GOALS, MIGRATIONS, STARTER_GOALS, archiveGoal, createGoal, listGoals, openDb,
  goalsSetupDone, reorderGoals, restoreGoal, setupGoals, updateGoal,
} from "../src/db.js";
import { buildSystemPrompt } from "../src/extraction/extract.js";
import { runSelfTest } from "../src/tz.js";

const config = { frontendOrigin: "http://localhost:5173" };
const google = {
  configured: () => true,
  authUrl: () => "https://accounts.google.test/consent",
  handleCallback: async () => ({ connected: true, missingScopes: [] }),
  status: () => ({ configured: true, connected: false, hasRefreshToken: false, missingScopes: [] }),
  disconnect: () => ({ configured: true, connected: false, hasRefreshToken: false, missingScopes: [] }),
};

async function withServer(fn) {
  const db = openDb(":memory:");
  const app = createApp({ db, config, googleAuth: google, selfTest: runSelfTest() });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, db);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const send = (url, method, body) =>
  fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

function code(fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof GoalError, `expected GoalError, got ${err}`);
    return err.code;
  }
  assert.fail("expected a GoalError");
}

test("starter goals are general and a new workspace starts with the first six", () => {
  assert.equal(STARTER_GOALS.length, 8);
  assert.ok(STARTER_GOALS.every((g) => g.name && g.description && g.description.length <= 40));
  const db = openDb(":memory:");
  const goals = listGoals(db);
  assert.deepEqual(goals.map((g) => g.name), STARTER_GOALS.slice(0, 6).map((g) => g.name));
  assert.deepEqual(goals.map((g) => g.color), [0, 1, 2, 3, 4, 5]);
  assert.ok(goals.every((g) => g.description && g.archived === false));
});

test("createGoal validates the name, rejects duplicates and assigns a free color", () => {
  const db = openDb(":memory:");
  // Make room: a new workspace already has six goals.
  const removed = listGoals(db).at(-1);
  db.prepare("DELETE FROM goals WHERE id = ?").run(removed.id);
  assert.equal(code(() => createGoal(db, { name: "   " })), "invalid_goal_or_name");
  assert.equal(code(() => createGoal(db, { name: "x".repeat(41) })), "goal_name_too_long");
  assert.equal(code(() => createGoal(db, { name: "earn MORE" })), "goal_name_exists");
  assert.equal(code(() => createGoal(db, { name: "Fine", description: "y".repeat(121) })), "goal_description_too_long");
  const goal = createGoal(db, { name: "  Side   projects ", description: " Apps,  tools " });
  assert.equal(goal.name, "Side projects");
  assert.equal(goal.description, "Apps, tools");
  assert.equal(goal.color, removed.color);
  assert.equal(code(() => createGoal(db, { name: "One too many" })), "goal_limit_reached");
});

test("at most six active goals, archiving frees a slot", () => {
  const db = openDb(":memory:");
  assert.equal(listGoals(db).length, MAX_ACTIVE_GOALS);
  assert.equal(code(() => createGoal(db, { name: "Seven" })), "goal_limit_reached");
  const first = listGoals(db)[0];
  archiveGoal(db, first.id);
  const seven = createGoal(db, { name: "Seven" });
  assert.equal(seven.color, first.color);
  assert.equal(code(() => restoreGoal(db, first.id)), "goal_limit_reached");
});

test("archiving hides a goal from the active list and the last active goal stays", () => {
  const db = openDb(":memory:");
  const goals = listGoals(db);
  const [a, ...others] = goals;
  archiveGoal(db, a.id);
  assert.deepEqual(listGoals(db).map((g) => g.id), others.map((g) => g.id));
  const all = listGoals(db, { includeArchived: true });
  assert.deepEqual(all.map((g) => g.id), [...others.map((g) => g.id), a.id]);
  assert.equal(all.at(-1).archived, true);
  for (const goal of others.slice(0, -1)) archiveGoal(db, goal.id);
  assert.equal(code(() => archiveGoal(db, others.at(-1).id)), "last_active_goal");
  assert.equal(code(() => createGoal(db, { name: a.name })), "goal_name_exists");
  assert.equal(restoreGoal(db, a.id).archived, false);
  assert.equal(archiveGoal(db, 999), null);
});

test("a goal with saves cannot be archived until they move", () => {
  const db = openDb(":memory:");
  const [a, b] = listGoals(db);
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO saves (screenshot_path, imported_at) VALUES ('x.png', ?)").run(now);
  db.prepare("INSERT INTO actions (save_id, goal_id, kind, status, created_at, updated_at) VALUES (1, ?, 'other', 'done', ?, ?)").run(a.id, now, now);
  assert.equal(code(() => archiveGoal(db, a.id)), "goal_in_use");
  assert.equal(listGoals(db).length, 6);
  // Another goal with no saves can still be archived.
  assert.equal(archiveGoal(db, b.id).archived, true);
  db.prepare("UPDATE actions SET goal_id = ? WHERE id = 1").run(listGoals(db)[1].id);
  assert.equal(archiveGoal(db, a.id).archived, true);
});

test("updateGoal changes only the fields sent", () => {
  const db = openDb(":memory:");
  const [a, b] = listGoals(db);
  const renamed = updateGoal(db, a.id, { description: "New words" });
  assert.equal(renamed.name, a.name);
  assert.equal(renamed.description, "New words");
  assert.equal(updateGoal(db, a.id, { color: 5 }).color, 5);
  assert.equal(code(() => updateGoal(db, a.id, { color: 6 })), "invalid_goal_color");
  assert.equal(code(() => updateGoal(db, a.id, { name: b.name })), "goal_name_exists");
  assert.equal(updateGoal(db, a.id, { name: a.name.toUpperCase() }).name, a.name.toUpperCase());
  assert.equal(code(() => updateGoal(db, a.id, {})), "invalid_goal_or_name");
  assert.equal(updateGoal(db, 999, { name: "Nope" }), null);
});

test("reorderGoals needs every active goal exactly once", () => {
  const db = openDb(":memory:");
  const ids = listGoals(db).map((g) => g.id);
  const rotated = [...ids.slice(1), ids[0]];
  assert.deepEqual(reorderGoals(db, rotated).map((g) => g.id), rotated);
  assert.equal(code(() => reorderGoals(db, ids.slice(1))), "invalid_goal_order");
  assert.equal(code(() => reorderGoals(db, [ids[0], ...ids.slice(0, -1)])), "invalid_goal_order");
  assert.equal(code(() => reorderGoals(db, "abc")), "invalid_goal_order");
});

test("goal API: create, edit, reorder, archive and restore", async () => {
  await withServer(async (base) => {
    const starters = await (await fetch(`${base}/api/goals/starters`)).json();
    assert.equal(starters.length, 8);
    assert.ok(starters.every((g) => g.name && g.description));

    // A new workspace has six goals, so one must be archived before another can be added.
    const full = await send(`${base}/api/goals`, "POST", { name: "Side projects" });
    assert.equal(full.status, 409);
    assert.equal((await full.json()).error, "goal_limit_reached");
    const start = await (await fetch(`${base}/api/goals`)).json();
    assert.equal(start.length, 6);
    const spare = start.at(-1);
    const archived = await send(`${base}/api/goals/${spare.id}/archive`, "POST");
    assert.equal((await archived.json()).archived, true);

    const created = await send(`${base}/api/goals`, "POST", { name: "Side projects", description: "Apps to ship" });
    assert.equal(created.status, 201);
    const goal = await created.json();
    assert.equal(goal.name, "Side projects");

    const dup = await send(`${base}/api/goals`, "POST", { name: "side PROJECTS" });
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).error, "goal_name_exists");

    const edited = await send(`${base}/api/goals/${goal.id}`, "PUT", { description: "Things I build" });
    assert.equal((await edited.json()).description, "Things I build");

    const list = await (await fetch(`${base}/api/goals`)).json();
    assert.equal(list.length, 7);
    assert.equal(list.at(-1).id, spare.id);
    assert.equal(list.at(-1).archived, true);
    assert.ok(list.every((g) => g.metrics && g.metrics.importedSaves === 0));

    const order = list.filter((g) => !g.archived).map((g) => g.id).reverse();
    const reordered = await send(`${base}/api/goals/order`, "PUT", { ids: order });
    assert.deepEqual((await reordered.json()).map((g) => g.id), order);
    assert.equal((await send(`${base}/api/goals/order`, "PUT", { ids: [1] })).status, 400);

    // Six are active again, so the archived goal cannot come back until another is archived.
    const blocked = await send(`${base}/api/goals/${spare.id}/restore`, "POST");
    assert.equal(blocked.status, 409);
    await send(`${base}/api/goals/${goal.id}/archive`, "POST");
    const restored = await send(`${base}/api/goals/${spare.id}/restore`, "POST");
    assert.equal((await restored.json()).archived, false);
    assert.equal((await send(`${base}/api/goals/999/archive`, "POST")).status, 404);
  });
});

test("an archived goal cannot be assigned to an action", async () => {
  await withServer(async (base, db) => {
    const [a, b] = listGoals(db);
    db.prepare("INSERT INTO saves (screenshot_path, imported_at) VALUES ('x.png', '2026-01-01T00:00:00Z')").run();
    const now = "2026-01-01T00:00:00Z";
    db.prepare("INSERT INTO actions (save_id, goal_id, kind, status, created_at, updated_at) VALUES (1, ?, 'other', 'open', ?, ?)").run(a.id, now, now);
    archiveGoal(db, b.id);
    const res = await send(`${base}/api/actions/1`, "PATCH", { goalId: b.id });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, "invalid_goal");
    // Sending the goal it already has still works if that goal was archived some other way.
    db.prepare("UPDATE goals SET archived_at = ? WHERE id = ?").run(now, a.id);
    const same = await send(`${base}/api/actions/1`, "PATCH", { goalId: a.id });
    assert.equal(same.status, 200);
  });
});

test("extraction prompt lists active goals with their descriptions on one line", () => {
  const prompt = buildSystemPrompt({
    today: "2026-11-04",
    goals: [
      { id: 1, name: "Earn more", description: "Freelance,\n side income" },
      { id: 2, name: "Plain", description: null },
    ],
  });
  assert.match(prompt, /^1: Earn more \(Freelance, side income\)$/m);
  assert.match(prompt, /^2: Plain$/m);
});

test("migration v7 gives existing goals colors and descriptions without losing data", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "goals-migration-"));
  const file = path.join(dir, "old.sqlite");
  try {
    const old = new Database(file);
    for (let i = 0; i < 6; i++) old.exec(MIGRATIONS[i]);
    old.pragma("user_version = 6");
    old.prepare("INSERT INTO goals (name, position) VALUES (?, ?)").run("Earn more", 0);
    old.prepare("INSERT INTO goals (name, position) VALUES (?, ?)").run("My custom goal", 1);
    old.close();

    const db = openDb(file);
    const goals = listGoals(db);
    assert.deepEqual(goals.map((g) => g.name), ["Earn more", "My custom goal"]);
    assert.deepEqual(goals.map((g) => g.color), [0, 1]);
    assert.equal(goals[0].description, STARTER_GOALS[0].description);
    assert.equal(goals[1].description, null);
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("first login setup replaces the starting goals with the user's choice", () => {
  const db = openDb(":memory:");
  assert.equal(goalsSetupDone(db), false);
  const goals = setupGoals(db, { goals: [
    { name: "career growth", description: "Jobs, networking" },
    { name: "Earn more", description: "Freelance, side income, grants" },
    { name: "Side projects" },
  ] });
  assert.deepEqual(goals.map((g) => g.name), ["career growth", "Earn more", "Side projects"]);
  assert.deepEqual(goals.map((g) => g.color), [0, 1, 2]);
  assert.equal(goals[2].description, null);
  assert.equal(goalsSetupDone(db), true);
  // "Earn more" kept its id, so nothing linked to it would be lost. Unchosen starting goals are gone.
  assert.equal(db.prepare("SELECT id FROM goals WHERE name = 'Earn more'").get().id, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM goals").get().n, 3);
});

test("first login setup can be skipped and validates the choice", () => {
  const db = openDb(":memory:");
  assert.equal(code(() => setupGoals(db, { goals: [] })), "invalid_goal_setup");
  assert.equal(code(() => setupGoals(db, { goals: Array.from({ length: 7 }, (_, i) => ({ name: `G${i}` })) })), "invalid_goal_setup");
  assert.equal(code(() => setupGoals(db, { goals: [{ name: "A" }, { name: "a" }] })), "goal_name_exists");
  assert.equal(code(() => setupGoals(db, { goals: [{ name: "" }] })), "invalid_goal_or_name");
  assert.equal(goalsSetupDone(db), false);
  assert.equal(setupGoals(db, { skip: true }).length, 6);
  assert.equal(goalsSetupDone(db), true);
});

test("setup is not asked of a workspace that already has saves, and cannot remove linked goals", () => {
  const db = openDb(":memory:");
  const now = "2026-01-01T00:00:00Z";
  db.prepare("INSERT INTO saves (screenshot_path, imported_at) VALUES ('x.png', ?)").run(now);
  assert.equal(goalsSetupDone(db), true);
  db.prepare("INSERT INTO actions (save_id, goal_id, kind, status, created_at, updated_at) VALUES (1, 1, 'other', 'open', ?, ?)").run(now, now);
  assert.equal(code(() => setupGoals(db, { goals: [{ name: "Other" }] })), "goals_setup_unavailable");
  assert.equal(listGoals(db).length, 6);
});

test("goal setup API and editing a goal both mark setup as done", async () => {
  await withServer(async (base) => {
    assert.equal((await (await fetch(`${base}/api/goals/setup`)).json()).done, false);
    const res = await send(`${base}/api/goals/setup`, "POST", { goals: [{ name: "Health and wellbeing", description: "Fitness, nutrition, sleep" }] });
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).map((g) => g.name), ["Health and wellbeing"]);
    assert.equal((await (await fetch(`${base}/api/goals/setup`)).json()).done, true);
  });
  await withServer(async (base) => {
    await send(`${base}/api/goals/1`, "PUT", { description: "Mine" });
    assert.equal((await (await fetch(`${base}/api/goals/setup`)).json()).done, true);
  });
});

test("migration v9 fills a missing timezone but never changes one the user chose", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-migration-"));
  try {
    const make = (name, tz) => {
      const file = path.join(dir, name);
      const old = new Database(file);
      for (let i = 0; i < 8; i++) old.exec(MIGRATIONS[i]);
      old.pragma("user_version = 8");
      old.prepare("INSERT INTO settings (key, value) VALUES ('tz', ?)").run(tz);
      old.close();
      return file;
    };
    const unset = openDb(make("unset.sqlite", null));
    assert.equal(unset.prepare("SELECT value FROM settings WHERE key = 'tz'").get().value, "America/New_York");
    unset.close();
    const chosen = openDb(make("chosen.sqlite", "Africa/Casablanca"));
    assert.equal(chosen.prepare("SELECT value FROM settings WHERE key = 'tz'").get().value, "Africa/Casablanca");
    chosen.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
