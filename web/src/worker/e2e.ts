import { HostError, type HostToPage, type ModelRequest, type PageToHost } from "../shared/protocol.ts";
import type { HostRuntime, RuntimeEnv } from "../shared/runtime.ts";
import { describeError } from "../shared/secrets.ts";
import type { ModelCall, StreamingTransport } from "../shared/transport.ts";

type E2EMessage = Extract<PageToHost, { type: "e2e" }>;

/** What a store of saves throws when it cannot write, as the host would see it, by the name a test gives it. */
function refusal(how: unknown): Error {
  if (how === "quota") return new DOMException("The current transaction exceeded its quota limitations.", "QuotaExceededError");
  if (how === "busy") return new HostError("busy", "a load is running");
  return new HostError("storage", "IndexedDB is not available: SecurityError: The operation is insecure.");
}

/**
 * Hooks for the browser tests. This module is imported only when the bundle is built with
 * `--mode e2e`; the production bundle does not contain it.
 *
 * Ops:
 *   request          start a model call straight on the transport, bypassing the core, and reply
 *                    with its outcome
 *   request-via-core submit a request as if the core had emitted it
 *   cancel           abort calls by request id, as the core's `cancels` would
 *   stall            block this worker for a while, like a throttled or busy thread
 *   throttle         make every timer of the host fire no sooner than `minDelayMs` after it was set,
 *                    which is what a browser does to the timers of a page in the background
 *   state            internal counters of the runtime
 *   csp-probe        try things the policy forbids and report what the worker saw
 *   log-probe        write a line through the worker's own log function, as an error path would
 *   fail-saves       make the store of saves refuse to write, as a browser that will not does (`how`: `storage`, `quota`
 *                    for a store that is full, `busy` for a host that is in the middle of a load), or, with `how` null,
 *                    write again; for the tests of what the page says of a save that cannot be made
 */
export function createE2EHandler(
  transport: StreamingTransport,
  post: (message: HostToPage) => void,
  log: (level: "info" | "warn" | "error", message: string) => void,
  env: RuntimeEnv,
): (message: E2EMessage, runtime: HostRuntime) => void {
  const direct = new Map<string, ModelCall>();
  const put = env.saves.put.bind(env.saves);

  return (message, runtime) => {
    const reply = (result: unknown): void =>
      post({ type: "reply", reqId: message.reqId, ok: true, result });
    const args = (message.args ?? {}) as Record<string, unknown>;

    switch (message.op) {
      case "request": {
        const request = args.request as ModelRequest;
        const call = transport.start(request, { timeoutMs: args.timeoutMs as number | undefined });
        direct.set(request.request_id, call);
        void call.done.then((outcome) => {
          direct.delete(request.request_id);
          reply(outcome);
        });
        break;
      }
      case "request-via-core":
        runtime.submitRequest(args.request as ModelRequest);
        reply(null);
        break;
      case "cancel": {
        const ids = args.ids as string[];
        const forCore: string[] = [];
        for (const id of ids) {
          const call = direct.get(id);
          if (call !== undefined) call.abort("cancel");
          else forCore.push(id);
        }
        runtime.cancelRequests(forCore);
        reply(null);
        break;
      }
      case "stall": {
        const ms = Number(args.ms);
        const end = performance.now() + ms;
        while (performance.now() < end) {
          // busy wait
        }
        reply({ stalledMs: ms });
        break;
      }
      case "throttle": {
        const floor = Number(args.minDelayMs);
        env.setTimeout = (fn, ms) => setTimeout(fn, Math.max(ms, floor));
        reply({ minDelayMs: floor });
        break;
      }
      case "state":
        reply(runtime.debugState());
        break;
      case "fail-saves": {
        const how = args.how ?? null;
        env.saves.put =
          how === null
            ? put
            : () => {
                throw refusal(how);
              };
        reply(how);
        break;
      }
      case "log-probe":
        log("error", describeError(new Error(String(args.text))));
        reply(null);
        break;
      case "csp-probe": {
        const url = String(args.fetchUrl ?? "");
        void (async () => {
          const out: Record<string, unknown> = {};
          const indirectEval = globalThis.eval;
          try {
            out.evalValue = indirectEval("1 + 1");
            out.evalBlocked = false;
          } catch {
            out.evalBlocked = true;
          }
          try {
            out.functionValue = new Function("return 2 + 2")();
            out.functionBlocked = false;
          } catch {
            out.functionBlocked = true;
          }
          if (url !== "") {
            try {
              await fetch(url, { mode: "no-cors", cache: "no-store" });
              out.fetchBlocked = false;
            } catch (err) {
              out.fetchBlocked = true;
              out.fetchError = describeError(err);
            }
          }
          reply(out);
        })();
        break;
      }
      default:
        post({
          type: "reply",
          reqId: message.reqId,
          ok: false,
          error: { code: "unknown_e2e_op", message: message.op },
        });
    }
  };
}
