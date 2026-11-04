import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { createApp } from "../src/app.js";
import {
  GoalError, MAX_ACTIVE_GOALS, MIGRATIONS, STARTER_GOALS, archiveGoal, createGoal, listGoals, openDb,
  reorderGoals, restoreGoal, updateGoal,
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

test("starter goals are general and start with the three presets", () => {
  assert.equal(STARTER_GOALS.length, 8);
  assert.ok(STARTER_GOALS.every((g) => g.name && g.description));
  const db = openDb(":memory:");
  const goals = listGoals(db);
  assert.deepEqual(goals.map((g) => g.name), STARTER_GOALS.slice(0, 3).map((g) => g.name));
  assert.deepEqual(goals.map((g) => g.color), [0, 1, 2]);
  assert.ok(goals.every((g) => g.description && g.archived === false));
});

test("createGoal validates the name, rejects duplicates and assigns a free color", () => {
  const db = openDb(":memory:");
  const goal = createGoal(db, { name: "  Health   and wellbeing ", description: " Fitness,  sleep " });
  assert.equal(goal.name, "Health and wellbeing");
  assert.equal(goal.description, "Fitness, sleep");
  assert.equal(goal.color, 3);
  assert.equal(code(() => createGoal(db, { name: "   " })), "invalid_goal_or_name");
  assert.equal(code(() => createGoal(db, { name: "x".repeat(41) })), "goal_name_too_long");
  assert.equal(code(() => createGoal(db, { name: "earn MORE" })), "goal_name_exists");
  assert.equal(code(() => createGoal(db, { name: "Fine", description: "y".repeat(121) })), "goal_description_too_long");
  assert.equal(createGoal(db, { name: "No description" }).description, null);
});

test("at most six active goals, archiving frees a slot", () => {
  const db = openDb(":memory:");
  for (const name of ["Four", "Five", "Six"]) createGoal(db, { name });
  assert.equal(listGoals(db).length, MAX_ACTIVE_GOALS);
  assert.equal(code(() => createGoal(db, { name: "Seven" })), "goal_limit_reached");
  const first = listGoals(db)[0];
  archiveGoal(db, first.id);
  const seven = createGoal(db, { name: "Seven" });
  assert.equal(seven.color, first.color);
  assert.equal(code(() => restoreGoal(db, first.id)), "goal_limit_reached");
});

test("archiving keeps the goal and its saves, and the last active goal stays", () => {
  const db = openDb(":memory:");
  const [a, b, c] = listGoals(db);
  archiveGoal(db, a.id);
  assert.deepEqual(listGoals(db).map((g) => g.id), [b.id, c.id]);
  const all = listGoals(db, { includeArchived: true });
  assert.deepEqual(all.map((g) => g.id), [b.id, c.id, a.id]);
  assert.equal(all.at(-1).archived, true);
  archiveGoal(db, b.id);
  assert.equal(code(() => archiveGoal(db, c.id)), "last_active_goal");
  assert.equal(code(() => createGoal(db, { name: a.name })), "goal_name_exists");
  assert.equal(restoreGoal(db, a.id).archived, false);
  assert.equal(archiveGoal(db, 999), null);
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
  const [a, b, c] = listGoals(db).map((g) => g.id);
  assert.deepEqual(reorderGoals(db, [c, a, b]).map((g) => g.id), [c, a, b]);
  assert.equal(code(() => reorderGoals(db, [a, b])), "invalid_goal_order");
  assert.equal(code(() => reorderGoals(db, [a, a, b])), "invalid_goal_order");
  assert.equal(code(() => reorderGoals(db, "abc")), "invalid_goal_order");
});

test("goal API: create, edit, reorder, archive and restore", async () => {
  await withServer(async (base) => {
    const starters = await (await fetch(`${base}/api/goals/starters`)).json();
    assert.equal(starters.length, 8);
    assert.ok(starters.every((g) => g.name && g.description));

    const created = await send(`${base}/api/goals`, "POST", { name: "Create and build", description: "Content, projects" });
    assert.equal(created.status, 201);
    const goal = await created.json();
    assert.equal(goal.name, "Create and build");

    const dup = await send(`${base}/api/goals`, "POST", { name: "create and build" });
    assert.equal(dup.status, 409);
    assert.equal((await dup.json()).error, "goal_name_exists");

    const edited = await send(`${base}/api/goals/${goal.id}`, "PUT", { description: "Writing and design" });
    assert.equal((await edited.json()).description, "Writing and design");

    const list = await (await fetch(`${base}/api/goals`)).json();
    assert.equal(list.length, 4);
    assert.ok(list.every((g) => g.metrics && g.metrics.importedSaves === 0));

    const order = list.map((g) => g.id).reverse();
    const reordered = await send(`${base}/api/goals/order`, "PUT", { ids: order });
    assert.deepEqual((await reordered.json()).map((g) => g.id), order);
    assert.equal((await send(`${base}/api/goals/order`, "PUT", { ids: [1] })).status, 400);

    const archived = await send(`${base}/api/goals/${goal.id}/archive`, "POST");
    assert.equal((await archived.json()).archived, true);
    const after = await (await fetch(`${base}/api/goals`)).json();
    assert.equal(after.length, 4);
    assert.equal(after.at(-1).archived, true);
    const restored = await send(`${base}/api/goals/${goal.id}/restore`, "POST");
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
    // Sending the goal it already has still works after that goal is archived.
    archiveGoal(db, a.id);
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
