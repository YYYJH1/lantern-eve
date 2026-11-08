/// <reference lib="webworker" />
import type { HostToPage, InitMessage, PageToHost } from "../shared/protocol.ts";
import { ReplayRuntime } from "../shared/player.ts";
import { HostRuntime, type RuntimeEnv } from "../shared/runtime.ts";
import { describeError, redact } from "../shared/secrets.ts";
import { StreamingTransport } from "../shared/transport.ts";
import { IdbSaveStore } from "../shared/idb-saves.ts";
import { bootCore } from "./pyodide-game.ts";

const scope = self as unknown as DedicatedWorkerGlobalScope;

const post = (message: HostToPage): void => scope.postMessage(message);

// Every line that leaves this worker for the console goes through redact().
function log(level: "info" | "warn" | "error", message: string): void {
  console[level](`[host] ${redact(message)}`);
}

interface PolicyViolation extends Event {
  violatedDirective: string;
  blockedURI: string;
}

scope.addEventListener("securitypolicyviolation", (event) => {
  const violation = event as PolicyViolation;
  post({ type: "csp-violation", directive: violation.violatedDirective, blocked: violation.blockedURI });
  log("warn", `CSP blocked ${violation.blockedURI} (${violation.violatedDirective})`);
});
scope.addEventListener("error", (event) => {
  log("error", describeError(event.error ?? event.message));
});
scope.addEventListener("unhandledrejection", (event) => {
  log("error", describeError(event.reason));
});

/** What either host does with a message of the page. */
let runtime: { handle(message: PageToHost): void } | null = null;
let booting = false;
const early: PageToHost[] = [];

async function boot(init: InitMessage): Promise<void> {
  const started = performance.now();
  try {
    const core = await bootCore({
      pyodideBase: init.pyodideBase,
      coreBase: init.coreBase,
      onStage: (stage, ms) => post({ type: "boot", stage, ms }),
      log,
    });
    const ready = (instance: { handle(message: PageToHost): void }, coreMs: number, game: { seed: number; scenario: string }): void => {
      runtime = instance;
      post({
        type: "ready",
        timings: {
          pyodideMs: core.timings.pyodideMs,
          wheelMs: core.timings.wheelMs,
          coreMs,
          totalMs: performance.now() - started,
        },
        coreVersion: core.coreVersion,
        coreFormat: core.coreFormat,
        pyodideVersion: core.pyodideVersion,
        pythonVersion: core.pythonVersion,
        wheel: core.wheel,
        seed: game.seed,
        scenario: game.scenario,
      });
      log(
        "info",
        `ready: pyodide ${core.pyodideVersion}, python ${core.pythonVersion}, core ${core.coreVersion}, ` +
          `${Math.round(performance.now() - started)} ms`,
      );
      for (const message of early.splice(0)) instance.handle(message);
    };
    if (init.mode === "replay") {
      // A host that plays a recording. It makes no model call and keeps no key.
      const player = new ReplayRuntime({
        now: () => performance.now(),
        setTimeout: (fn, ms) => setTimeout(fn, ms),
        clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
        yieldNow: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
        post,
        newGame: core.newGame,
        restoreGame: core.restoreGame,
        core: { version: core.coreVersion, format: core.coreFormat },
        log,
        // Test builds only: the page can ask where the seeks of a recording started from.
        e2e: __LANTERN_E2E__
          ? (message, instance) => post({ type: "reply", reqId: message.reqId, ok: true, result: instance.debugState() })
          : undefined,
      });
      player.start(init.hidden);
      ready(player, core.timings.importMs, init);
      return;
    }
    const transport = new StreamingTransport();
    const env: RuntimeEnv = {
      now: () => performance.now(),
      wallClockIso: () => new Date().toISOString(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      yieldNow: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
      post,
      newGame: core.newGame,
      preset: core.preset,
      core: { version: core.coreVersion, format: core.coreFormat },
      transport,
      saves: new IdbSaveStore(),
      pace: __LANTERN_E2E__ ? (init.pace ?? 1) : 1,
      allowBaseUrl: __LANTERN_E2E__,
      pauseAtTick: __LANTERN_E2E__ ? init.pauseAtTick : undefined,
      gameConfig: __LANTERN_E2E__ ? init.config : undefined,
      log,
    };
    if (__LANTERN_E2E__) {
      const { createE2EHandler } = await import("./e2e.ts");
      env.e2e = createE2EHandler(transport, post, log, env);
    }
    const coreStart = performance.now();
    const instance = new HostRuntime(env);
    const game = instance.start(init.seed, init.scenario, init.hidden, init.preset);
    ready(instance, core.timings.importMs + (performance.now() - coreStart), game);
  } catch (err) {
    log("error", `boot failed: ${describeError(err)}`);
    post({ type: "fatal", code: "boot_failed", message: describeError(err) });
  }
}

scope.addEventListener("message", (event: MessageEvent<PageToHost>) => {
  const message = event.data;
  if (message.type === "init") {
    if (!booting) {
      booting = true;
      void boot(message);
    }
    return;
  }
  if (runtime === null) {
    early.push(message);
    return;
  }
  runtime.handle(message);
});
