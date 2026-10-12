import { join } from "node:path";

// Native Windows CLI startups can exceed Bun's default test timeout.
export const CLI_TEST_TIMEOUT_MS = 30_000;

// Pass these overrides before subprocess startup: Bun caches os.homedir().
// Keep Windows profile and application data paths inside the same fixture.
export function homeEnvironment(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: join(home, "AppData", "Roaming"),
    LOCALAPPDATA: join(home, "AppData", "Local"),
  };
}

export function observeChild(child) {
  const observed = { child, closed: false, close: null, errors: [] };
  // The response waiter ends before teardown. Keep lifecycle error handlers
  // until close so a late EPIPE or process error is recorded, not uncaught.
  const onError = err => observed.errors.push(err);
  child.on("error", onError);
  child.stdin?.on("error", onError);
  // Register immediately after spawn, before any termination request can race close.
  observed.close = new Promise(resolveClose => child.once("close", () => {
    observed.closed = true;
    child.removeListener("error", onError);
    child.stdin?.removeListener("error", onError);
    resolveClose();
  }));
  return observed;
}

export async function stopChild(observed, timers = { set: setTimeout, clear: clearTimeout }) {
  if (observed.closed) {
    if (observed.errors.length) throw new AggregateError(observed.errors, "Child lifecycle errors");
    return;
  }
  let escalation;
  let deadline;
  let signalError;
  const signal = name => {
    try { observed.child.kill(name); } catch (err) { signalError = err; }
  };
  try {
    await Promise.race([
      observed.close,
      new Promise((_, reject) => {
        // Escalation shares one five-second cleanup budget; it never reruns the command.
        escalation = timers.set(() => signal("SIGKILL"), 2_500);
        deadline = timers.set(() => reject(new Error("Child termination unconfirmed after 5s; retain HOME/cache" + (signalError ? `: ${signalError.message}` : ""))), 5_000);
        signal("SIGTERM");
      }),
    ]);
  } finally {
    timers.clear(escalation);
    timers.clear(deadline);
  }
  if (observed.errors.length) throw new AggregateError(observed.errors, "Child lifecycle errors");
}
