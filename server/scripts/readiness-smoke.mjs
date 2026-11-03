// Read-only live API check. No uploads, calendar writes, exports or data deletion.
import assert from 'node:assert/strict';

const base = new URL(process.env.API_BASE_URL ?? 'http://localhost:3000');
let passed = 0;
async function check(path, validate) {
  const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  assert.match(response.headers.get('content-type'), /application\/json/, path);
  const body = await response.json();
  validate(body);
  passed++;
  console.log(`PASS GET ${path}`);
  return body;
}
await check('/health', b => assert.equal(b.ok, true));
const ready = await check('/ready', b => { assert.equal(b.ready, true); assert.equal(b.externalCallsPerformed, false); });
await check('/api/capabilities', b => assert.equal(b.extraction.background, true));
await check('/api/settings', b => assert.equal(typeof b.workStart, 'string'));
await check('/auth/status', b => assert.equal(typeof b.connected, 'boolean'));
await check('/api/me', b => assert.equal(b.local, true));
await check('/api/goals', b => assert.ok(Array.isArray(b)));
await check('/api/home', b => assert.ok(Array.isArray(b.recent_saves)));
await check('/api/insights', b => assert.equal(typeof b.totals.importedSaves, 'number'));
await check('/api/about', b => assert.equal(b.name, 'SavedToAction'));
const actions = await check('/api/actions?limit=1', b => assert.ok(Array.isArray(b.items)));
const saves = await check('/api/saves?limit=1', b => assert.ok(Array.isArray(b.items)));
if (actions.items.length) {
  const { id } = actions.items[0];
  await check(`/api/actions/${id}`, b => assert.equal(b.id, id));
  await check(`/api/actions/${id}/checks`, b => assert.ok(Array.isArray(b.checks)));
  await check(`/api/actions/${id}/traces`, b => assert.ok(Array.isArray(b.traces)));
}
if (saves.items.length) {
  const { saveId } = saves.items[0];
  await check(`/api/saves/${saveId}`, b => assert.equal(b.saveId, saveId));
}
console.log(`${passed} live read-only API checks passed.`);
console.log(JSON.stringify({ modelConfigured: ready.modelConfigured, googleConnected: ready.googleConnected, userTimezoneConfigured: ready.userTimezoneConfigured, readyForScheduling: ready.readyForScheduling }));
