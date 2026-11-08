import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { callCost, CallTracker, MAX_CALLS } from "../../src/shared/model-calls.ts";
import type { CoreEvent, CoreInput, ModelRequest, StepOutputs, Usage } from "../../src/shared/protocol.ts";

/** One micro-yuan per token on the cheap tier and five on the strong one, as the tests of the core do. */
const PRICES = { price_cheap_in: 1_000_000, price_cheap_out: 1_000_000, price_strong_in: 5_000_000, price_strong_out: 5_000_000 };

function request(id: string, tier = "cheap", extra: Record<string, unknown> = {}): ModelRequest {
  const reserve = { input_tokens: 96, output_tokens: 100 };
  const rate = tier === "strong" ? 5 : tier === "cheap" ? 1 : 0;
  return {
    request_id: id,
    tier,
    messages: [],
    max_tokens: 100,
    interaction_id: `i-${id}`,
    issued_tick: 7,
    category: "reply",
    reserve,
    hold: (reserve.input_tokens + reserve.output_tokens) * rate,
    ...extra,
  };
}

function outputs(tick: number, parts: { events?: CoreEvent[]; requests?: ModelRequest[] } = {}): StepOutputs {
  return {
    tick,
    advanced: true,
    frame: { npcs: [] },
    events: parts.events ?? [],
    requests: parts.requests ?? [],
    cancels: [],
    clock: { paused: false, rate: [1, 1] },
  };
}

let seq = 0;
function result(id: string, status: string, usage: Usage | null, extra: Record<string, unknown> = {}): CoreInput {
  return { seq: seq++, kind: "model_result", body: { request_id: id, status, text: "", usage, latency_ms: 40, ...extra } };
}

const tracker = (config: Record<string, number> = PRICES): CallTracker => new CallTracker(config, (r) => (r.tier === "local" ? null : `model-${r.tier}`));

test.describe("what a call costs", () => {
  const file = JSON.parse(readFileSync(new URL("../support/cost-vectors.json", import.meta.url), "utf8")) as {
    prices: Record<string, Record<string, number>>;
    vectors: Array<[string, string, number, number, number]>;
  };

  test("is what the core works out, for every vector the core produced", () => {
    expect(file.vectors.length).toBeGreaterThan(50);
    for (const [prices, tier, input, output, cost] of file.vectors) {
      const config = file.prices[prices] as Record<string, number>;
      expect(callCost(config, tier, { input_tokens: input, output_tokens: output }), `${prices} ${tier} ${input}+${output}`).toBe(cost);
    }
  });

  test("is rounded up for each of the two parts, the local tier is free, and a game without prices has no cost", () => {
    expect(callCost({ price_cheap_in: 3, price_cheap_out: 7 }, "cheap", { input_tokens: 1, output_tokens: 1 })).toBe(2);
    expect(callCost(PRICES, "local", { input_tokens: 5000, output_tokens: 5000 })).toBe(0);
    expect(callCost({}, "cheap", { input_tokens: 5000, output_tokens: 5000 })).toBeNull();
    expect(callCost({}, "local", { input_tokens: 5000, output_tokens: 5000 })).toBe(0);
  });
});

test.describe("the list of model calls", () => {
  test("opens a call for each request that goes out, with its tier, category, hold and model", () => {
    const calls = tracker();
    const changed = calls.observe(outputs(7, { requests: [request("r7-0", "strong", { category: "director" })] }), []);
    expect(changed).toEqual([
      {
        id: "r7-0",
        tick: 7,
        category: "director",
        asked: "strong",
        tier: "strong",
        reason: null,
        model: "model-strong",
        hold: 980,
        status: "pending",
        code: null,
        latency_ms: null,
        usage: null,
        cost: null,
        settled: null,
        late: false,
        voided: null,
      },
    ]);
    expect(calls.has("r7-0")).toBe(true);
  });

  test("books the cost of the tokens the result reports, and the whole reservation where they are unknown", () => {
    const calls = tracker();
    calls.observe(outputs(7, { requests: [request("a"), request("b", "strong")] }), []);
    const settled = calls.observe(
      outputs(9),
      [result("a", "ok", { input_tokens: 50, output_tokens: 20 }), result("b", "timeout", null, { latency_ms: 8000 })],
    );
    const [a, b] = settled;
    expect(a).toMatchObject({ id: "a", status: "ok", usage: { input_tokens: 50, output_tokens: 20 }, cost: 70, latency_ms: 40, settled: 9, code: null });
    // The strong request held 980 and was never heard of again, so the core charges all of it.
    expect(b).toMatchObject({ id: "b", status: "timeout", usage: null, cost: 980, hold: 980, latency_ms: 8000, settled: 9 });
  });

  test("keeps the short code of an error", () => {
    const calls = tracker();
    calls.observe(outputs(1, { requests: [request("a")] }), []);
    const [a] = calls.observe(outputs(2), [result("a", "error", { input_tokens: 0, output_tokens: 0 }, { text: "http_429" })]);
    expect(a).toMatchObject({ status: "error", code: "http_429", cost: 0 });
  });

  test("says which tier was asked for and why the request was moved down", () => {
    const calls = tracker();
    const moved: CoreEvent = { kind: "downgrade", tick: 7, request_id: "a", interaction_id: "i-a", asked: "strong", tier: "cheap", reason: "budget" };
    const [a] = calls.observe(outputs(7, { events: [moved], requests: [request("a", "cheap")] }), []);
    expect(a).toMatchObject({ asked: "strong", tier: "cheap", reason: "budget", status: "pending" });
  });

  test("lists a request the gate turned into a script line, which never went out and costs nothing", () => {
    const calls = tracker();
    const turned: CoreEvent = { kind: "downgrade", tick: 12, request_id: "r12-0", interaction_id: "i1", asked: "cheap", tier: "template", reason: "cloud_down" };
    const [line] = calls.observe(outputs(12, { events: [turned] }), []);
    expect(line).toMatchObject({ id: "r12-0", asked: "cheap", tier: "template", reason: "cloud_down", status: "template", cost: 0, hold: 0, model: null, tick: 12, category: null });
    // The core may name the category in the event some day. The list takes it when it does.
    const named = tracker().observe(outputs(12, { events: [{ ...turned, category: "paper" }] }), []);
    expect(named[0]?.category).toBe("paper");
  });

  test("marks an answer that comes after the request was settled as late, and books nothing for it", () => {
    const calls = tracker();
    calls.observe(outputs(1, { requests: [request("a")] }), []);
    calls.observe(outputs(3), [result("a", "timeout", null)]);
    const voided: CoreEvent = { kind: "void", tick: 6, request_id: "a", interaction_id: null, status: "ok", reason: "unknown_request" };
    const changed = calls.observe(outputs(6, { events: [voided] }), [result("a", "ok", { input_tokens: 10, output_tokens: 10 })]);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatchObject({ id: "a", status: "timeout", cost: 196, late: true });
    // Nothing more to say the second time.
    expect(calls.observe(outputs(7), [result("a", "ok", null)])).toEqual([]);
  });

  test("says that the core threw an answer away, though it booked what it cost", () => {
    const calls = tracker();
    calls.observe(outputs(1, { requests: [request("a"), request("b")] }), []);
    const events: CoreEvent[] = [
      { kind: "void", tick: 3, request_id: "a", interaction_id: "i-a", status: "ok", reason: "cancelled" },
      { kind: "void", tick: 3, request_id: "b", interaction_id: "i-b", status: "ok", reason: "invalid" },
    ];
    const changed = calls.observe(outputs(3, { events }), [result("a", "ok", { input_tokens: 4, output_tokens: 4 }), result("b", "ok", { input_tokens: 5, output_tokens: 5 })]);
    expect(changed.map((c) => [c.id, c.voided, c.cost, c.late])).toEqual([
      ["a", "cancelled", 8, false],
      ["b", "invalid", 10, false],
    ]);
  });

  test("does not list a result for a request it never saw", () => {
    const calls = tracker();
    expect(calls.observe(outputs(3), [result("ghost", "ok", null)])).toEqual([]);
    expect(calls.snapshot()).toEqual([]);
  });

  test("has no cost for a game without prices, and a local call is free", () => {
    const calls = tracker({});
    calls.observe(outputs(1, { requests: [request("a"), request("b", "local")] }), []);
    const [a, b] = calls.observe(outputs(2), [result("a", "ok", { input_tokens: 3, output_tokens: 3 }), result("b", "ok", { input_tokens: 3, output_tokens: 3 })]);
    expect(a?.cost).toBeNull();
    expect(b).toMatchObject({ cost: 0, model: null, tier: "local" });
  });

  test("keeps the newest calls, hands out copies, and lists a request taken up on its own once", () => {
    const calls = tracker();
    for (let i = 0; i < MAX_CALLS + 5; i++) calls.observe(outputs(i, { requests: [request(`c${i}`)] }), []);
    const kept = calls.snapshot();
    expect(kept).toHaveLength(MAX_CALLS);
    expect(kept[0]?.id).toBe("c5");
    expect(kept[kept.length - 1]?.id).toBe(`c${MAX_CALLS + 4}`);
    (kept[0] as { status: string }).status = "ok";
    expect(calls.snapshot()[0]?.status).toBe("pending");

    const own = tracker();
    const listed = own.track(request("hook", "cheap", { issued_tick: undefined }), 41);
    expect(listed).toMatchObject({ id: "hook", tick: 41, status: "pending" });
    expect(own.track(request("hook"), 42)).toBeNull();
    // A request the call of the core brought is not listed twice by the host's own submit.
    const brought = tracker();
    brought.observe(outputs(3, { requests: [request("x")] }), []);
    expect(brought.track(request("x"), 3)).toBeNull();
  });

  test("adds up to the money the core booked: the sum of the costs of the settled calls", () => {
    const calls = tracker();
    const sizes: Array<[string, Usage | null]> = [
      ["a", { input_tokens: 10, output_tokens: 5 }],
      ["b", null],
      ["c", { input_tokens: 96, output_tokens: 100 }],
      ["d", { input_tokens: 0, output_tokens: 0 }],
    ];
    calls.observe(outputs(1, { requests: sizes.map(([id]) => request(id)) }), []);
    const settled = calls.observe(
      outputs(2),
      sizes.map(([id, usage]) => result(id, usage === null ? "timeout" : "ok", usage)),
    );
    expect(settled.reduce((sum, c) => sum + (c.cost ?? 0), 0)).toBe(15 + 196 + 196 + 0);
  });
});
