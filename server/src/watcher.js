// Background watcher: calls `run` every intervalMs (default 5 minutes). `run` is recheckAll, which calls the
// same recheckAction the "Recheck now" button calls. The demo uses the button and never implies instant polling.
// A tick never overlaps the previous one, and a failing run is logged, never thrown.
export function createWatcher({
  run,
  intervalMs = 5 * 60_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  logger = console,
}) {
  let timer = null;
  let running = false;

  async function tick() {
    if (running) {
      logger.warn("watcher: the previous run is still going, skipping this tick");
      return { skipped: "busy" };
    }
    running = true;
    try {
      return await run();
    } catch (err) {
      logger.error(`watcher: run failed: ${err.message}`);
      return { error: err.message };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    intervalMs,
    isStarted: () => timer !== null,
    start() {
      if (timer) return;
      timer = setIntervalImpl(() => {
        void tick();
      }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (!timer) return;
      clearIntervalImpl(timer);
      timer = null;
    },
  };
}
