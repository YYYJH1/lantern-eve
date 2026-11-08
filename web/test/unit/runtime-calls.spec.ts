import { expect, test } from "@playwright/test";
import type { HostToPage, LoadInfo, ModelCallRecord } from "../../src/shared/protocol.ts";
import type { FakeOptions } from "../support/fake-game.ts";
import { VirtualHost } from "../support/virtual-env.ts";

/** One micro-yuan per token on the cheap tier. A request holds 10 + 16 tokens, so 26 micro-yuan. */
const OPTIONS: FakeOptions = {
  requestEvery: 5,
  config: { price_cheap_in: 1_000_000, price_cheap_out: 1_000_000, price_strong_in: 5_000_000, price_strong_out: 5_000_000 },
  requestFields: { category: "reply", reserve: { input_tokens: 10, output_tokens: 16 }, hold: 26 },
};

type CallsMessage = Extract<HostToPage, { type: "model-calls" }>;

function started(options: FakeOptions = OPTIONS): VirtualHost {
  const host = new VirtualHost(options);
  host.transport.model = "qwen-flash";
  host.runtime.start(42, "bridge", false);
  return host;
}

const callMessages = (host: VirtualHost): CallsMessage[] => host.posted.filter((m): m is CallsMessage => m.type === "model-calls");
const lastOf = (host: VirtualHost, id: string): ModelCallRecord | undefined =>
  callMessages(host)
    .flatMap((m) => m.calls)
    .filter((c) => c.id === id)
    .pop();
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

test.describe("the list of model calls the host sends", () => {
  test("lists a request as soon as the core makes it, before the frame of that call, with the model that will answer", () => {
    const host = started();
    host.advance(700);
    const messages = callMessages(host);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ replace: false, calls: [{ id: "r5", tick: 5, category: "reply", asked: "cheap", tier: "cheap", model: "qwen-flash", hold: 26, status: "pending", cost: null }] });
    const at = host.posted.indexOf(messages[0] as HostToPage);
    const next = host.posted[at + 1];
    expect(next).toMatchObject({ type: "frame", tick: 5 });
    // The transport was started once, and the host did not list the request a second time on submitting it.
    expect(host.transport.started).toEqual(["r5"]);
  });

  test("books the cost when the call that applies the result runs, and lists it before that call's frame", async () => {
    const host = started();
    host.advance(700);
    host.transport.calls.get("r5")?.settle({ status: "ok", usage: { input_tokens: 8, output_tokens: 4 }, latency_ms: 120 });
    await flush();
    const before = host.posted.length;
    host.advance(100);
    const messages = host.posted.slice(before);
    expect(messages.map((m) => m.type)).toEqual(["model-calls", "frame", "stats"].slice(0, messages.length));
    expect(messages[0]).toMatchObject({ type: "model-calls", calls: [{ id: "r5", status: "ok", cost: 12, latency_ms: 120, usage: { input_tokens: 8, output_tokens: 4 }, settled: 7 }] });
  });

  test("books the whole reservation of a call that timed out", async () => {
    const host = started();
    host.advance(700);
    host.transport.calls.get("r5")?.settle({ status: "timeout", text: "", usage: null, latency_ms: 8000 });
    await flush();
    host.advance(100);
    expect(lastOf(host, "r5")).toMatchObject({ status: "timeout", cost: 26, hold: 26, usage: null, latency_ms: 8000 });
  });

  test("lists a request that cannot be made at all, with the code of its refusal and no cost", () => {
    const host = started();
    host.transport.refuse = { status: "error", text: "no_key", usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0, code: "no_key", usageReported: false };
    host.advance(900);
    expect(lastOf(host, "r5")).toMatchObject({ status: "error", code: "no_key", cost: 0, latency_ms: 0 });
  });

  test("starts a new list for a new game", async () => {
    const host = started();
    host.advance(700);
    host.runtime.handle({ type: "new-game", seed: 43 });
    host.advance(600);
    await flush();
    const after = callMessages(host).flatMap((m) => m.calls);
    // Both games number their requests by tick, so the second game's r5 is a call of its own.
    expect(after.filter((c) => c.id === "r5").map((c) => c.status)).toEqual(["pending", "pending"]);
  });

  test("starts the list again after a load, and lists the request it sends again", async () => {
    const host = started();
    host.advance(1100);
    const saved = await host.call({ type: "call", reqId: 1, call: { op: "save" } });
    expect(saved.ok).toBe(true);
    host.advance(1000);
    const reply = await host.call({ type: "call", reqId: 2, call: { op: "load", id: 1 } });
    const info = (reply as { result: LoadInfo }).result;
    expect(info.reissued).toBeGreaterThan(0);
    const messages = callMessages(host);
    const replaced = messages.map((m, i) => (m.replace ? i : -1)).filter((i) => i >= 0);
    expect(replaced).toHaveLength(1);
    const afterLoad = messages.slice((replaced[0] ?? 0) + 1).flatMap((m) => m.calls);
    expect(afterLoad.map((c) => [c.id, c.status])).toEqual([
      ["r5", "pending"],
      ["r10", "pending"],
    ]);
    expect(messages[replaced[0] ?? 0]?.calls).toEqual([]);
  });

  test("lists a request that a test hook submits, once", () => {
    const host = new VirtualHost({ ...OPTIONS, requestEvery: 0 });
    host.runtime.start(42, "bridge", false);
    host.advance(300);
    host.runtime.submitRequest({ request_id: "hook-1", tier: "cheap", messages: [], max_tokens: 8 });
    host.runtime.submitRequest({ request_id: "hook-1", tier: "cheap", messages: [], max_tokens: 8 });
    expect(callMessages(host)).toHaveLength(1);
    expect(lastOf(host, "hook-1")).toMatchObject({ status: "pending", tick: 3, tier: "cheap" });
  });
});
