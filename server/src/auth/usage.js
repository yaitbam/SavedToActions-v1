import { AsyncLocalStorage } from "node:async_hooks";
export function createUsage({ db, provider, config, clock }) {
  const scope = new AsyncLocalStorage();
  const maxFor = account => account.kind === "demo" ? 0 : account.kind === "owner" ? 100 : config.freeDailyCredits;
  const day = () => new Date(clock()).toISOString().slice(0, 10);
  function credits(account) {
    const used = db.prepare("SELECT muse_calls FROM usage WHERE account_id=? AND day=?").get(account.id, day())?.muse_calls ?? 0;
    const max = maxFor(account), remaining = Math.max(0, max - used);
    return { remaining, max, display: `Free credits left today: ${remaining} of ${max}` };
  }
  return {
    credits,
    run: (account, next) => scope.run({ account, charged: false, successful: false }, next),
    provider: { ...provider, async chat(...args) {
      const operation = scope.getStore();
      if (!operation) throw new Error("Missing usage context");
      const { account } = operation;
      if (!operation.charged) {
        operation.day = day();
        db.prepare("INSERT OR IGNORE INTO usage VALUES (?,?,0)").run(account.id, operation.day);
        const result = db.prepare("UPDATE usage SET muse_calls=muse_calls+1 WHERE account_id=? AND day=? AND muse_calls<?")
          .run(account.id, operation.day, maxFor(account));
        if (!result.changes) { const error = new Error("Daily credit limit reached"); error.status = 429; error.publicCode = "daily_limit_reached"; throw error; }
        operation.charged = true;
      }
      try { const result = await provider.chat(...args); operation.successful = true; return result; }
      catch (error) {
        if (!operation.successful) {
          db.prepare("UPDATE usage SET muse_calls=max(0,muse_calls-1) WHERE account_id=? AND day=?").run(account.id, operation.day);
          operation.charged = false;
        }
        throw error;
      }
    } },
  };
}
