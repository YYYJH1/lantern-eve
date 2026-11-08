import { expect, test } from "@playwright/test";
import { SKIP_PACE } from "../../src/page/skip.ts";
import type { HostToPage, LoadInfo, Replay } from "../../src/shared/protocol.ts";
import { runReplay } from "../../src/shared/replay.ts";
import { keptNotes, MAX_PAGE_NOTES, MAX_SKIP_SPEED, MAX_SPEED } from "../../src/shared/runtime.ts";
import { FakeGame, type FakeOptions } from "../support/fake-game.ts";
import { VirtualHost } from "../support/virtual-env.ts";

function started(options: FakeOptions = {}, hidden = false, pace = 1): VirtualHost {
  const host = new VirtualHost(options, pace);
  host.runtime.start(42, "m0", hidden);
  return host;
}

const tickOf = (host: VirtualHost): number => host.runtime.stats().nextTick;
const logOf = (host: VirtualHost): Array<[number, number, string]> => host.runtime.buildReplay().records.map(([tick, seq, kind]) => [tick, seq, kind]);
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};
const player = (id: string) => ({ type: "player" as const, body: { action_id: id } });

async function rebuildHash(replay: Replay, options: FakeOptions = {}): Promise<{ hash: string; tick: number }> {
  const result = await runReplay((spec) => new FakeGame(spec.seed, spec.scenario, options), replay);
  return { hash: result.hash, tick: result.nextTick };
}

test.describe("the game's config", () => {
  test("is the core's own unless the test build gives one, and then every game the host starts has it, a new game too", () => {
    const plain = started();
    expect(plain.specs.map((spec) => spec.config)).toEqual([null]);
    plain.runtime.handle({ type: "new-game", seed: 43 });
    expect(plain.specs.map((spec) => spec.config)).toEqual([null, null]);

    const tests = new VirtualHost({}, 1, { days: 1, dev_actions: 1 });
    tests.runtime.start(42, "bridge", false);
    tests.runtime.handle({ type: "new-game", seed: 43 });
    expect(tests.specs.map((spec) => [spec.seed, spec.scenario, spec.config])).toEqual([
      [42, "bridge", { days: 1, dev_actions: 1 }],
      [43, "bridge", { days: 1, dev_actions: 1 }],
    ]);
  });
});

test.describe("a named game of the core", () => {
  const SLICE = { variant: "v_boat", opening: "op_li_er_hearsay", weather_heavy: 0 };

  test("is the seed, the scenario and the config the core gives it, texts and all, whatever the page says of its own", () => {
    const host = new VirtualHost();
    const game = host.runtime.start(1, "m0", false, "slice");
    expect(game).toEqual({ seed: 492, scenario: "bridge" });
    expect(host.specs).toEqual([{ seed: 492, scenario: "bridge", config: SLICE }]);
    // The replay header the game would be rebuilt from keeps the texts, so a recording of the slice plays again.
    expect(host.runtime.buildReplay().header).toMatchObject({ seed: 492, scenario: "bridge" });
    // A game of a seed is as it was.
    const plain = new VirtualHost();
    expect(plain.runtime.start(7, "m0", false)).toEqual({ seed: 7, scenario: "m0" });
    expect(plain.specs).toEqual([{ seed: 7, scenario: "m0", config: null }]);
  });

  test("is laid under the config of the test build, key by key", () => {
    const host = new VirtualHost({}, 1, { days: 1, weather_heavy: 5 });
    host.runtime.start(1, "m0", false, "slice");
    expect(host.specs[0]?.config).toEqual({ ...SLICE, days: 1, weather_heavy: 5 });
  });

  test("is what a new game by name starts, with the reset the page reads, and a name the core does not know changes nothing", () => {
    const host = new VirtualHost();
    host.runtime.start(1, "m0", false);
    host.runtime.handle({ type: "new-game", preset: "slice" });
    expect(host.specs.at(-1)).toEqual({ seed: 492, scenario: "bridge", config: SLICE });
    expect(host.posted.filter((m) => m.type === "reset")).toEqual([{ type: "reset", seed: 492, scenario: "bridge" }]);
    const games = host.games.length;
    host.runtime.handle({ type: "new-game", preset: "nowhere" });
    expect(host.games).toHaveLength(games);
    expect(host.posted.at(-1)).toMatchObject({ type: "notice", code: "bad_game" });
    host.advance(500);
    expect(host.frames().length).toBeGreaterThan(0);
    expect(host.runtime.stats().nextTick).toBeGreaterThan(0);
  });
});

test.describe("a named game at another seed and with another story true", () => {
  const SLICE = { variant: "v_boat", opening: "op_li_er_hearsay", weather_heavy: 0 };

  test("is the rules of the name at the seed and with the story the new game asks for, and the reset says the seed", () => {
    const host = new VirtualHost();
    host.runtime.start(1, "m0", false, "slice");
    host.runtime.handle({ type: "new-game", preset: "slice", seed: 7, variant: "v_flood" });
    expect(host.specs.at(-1)).toEqual({ seed: 7, scenario: "bridge", config: { ...SLICE, variant: "v_flood" } });
    expect(host.posted.filter((m) => m.type === "reset")).toEqual([{ type: "reset", seed: 7, scenario: "bridge" }]);
    // A recording of it says both, the way it says the first game of the name.
    expect(host.runtime.buildReplay().header).toMatchObject({ seed: 7, scenario: "bridge" });
    host.advance(500);
    expect(host.frames().length).toBeGreaterThan(0);
  });

  test("keeps the story of the name where only a seed is asked for, and the seed where only a story is", () => {
    const host = new VirtualHost();
    host.runtime.start(1, "m0", false, "slice");
    host.runtime.handle({ type: "new-game", preset: "slice", seed: 8 });
    expect(host.specs.at(-1)).toEqual({ seed: 8, scenario: "bridge", config: SLICE });
    host.runtime.handle({ type: "new-game", preset: "slice", variant: "v_drunk" });
    expect(host.specs.at(-1)).toEqual({ seed: 492, scenario: "bridge", config: { ...SLICE, variant: "v_drunk" } });
    // Seed 0 is a seed.
    host.runtime.handle({ type: "new-game", preset: "slice", seed: 0, variant: "v_boat" });
    expect(host.specs.at(-1)).toMatchObject({ seed: 0 });
  });

  test("is laid under the config of the test build, key by key, a new game of another story too", () => {
    const host = new VirtualHost({}, 1, { days: 1, weather_heavy: 5 });
    host.runtime.start(1, "m0", false, "slice");
    host.runtime.handle({ type: "new-game", preset: "slice", seed: 3, variant: "v_drunk" });
    expect(host.specs.at(-1)).toEqual({ seed: 3, scenario: "bridge", config: { ...SLICE, variant: "v_drunk", days: 1, weather_heavy: 5 } });
  });

  test("changes nothing, and is said so, when the story or the seed is not the core's, or a story has no game by name", () => {
    const host = new VirtualHost();
    host.runtime.start(1, "m0", false, "slice");
    const games = host.games.length;
    for (const bad of [{ preset: "slice", variant: "v_nothing" }, { preset: "slice", seed: -4 }, { variant: "v_flood" }, { seed: 5, variant: "v_flood" }]) {
      host.runtime.handle({ type: "new-game", ...bad });
      expect(host.games, JSON.stringify(bad)).toHaveLength(games);
      expect(host.posted.at(-1), JSON.stringify(bad)).toMatchObject({ type: "notice", code: "bad_game" });
    }
    expect(host.posted.filter((m) => m.type === "reset")).toEqual([]);
    host.advance(500);
    expect(host.runtime.stats().nextTick).toBeGreaterThan(0); // the game that was running went on
  });
});

test.describe("the loop", () => {
  test("runs ten ticks per second of real time and posts a frame for each", () => {
    const host = started();
    host.advance(1000);
    expect(tickOf(host)).toBe(10);
    expect(host.frames()).toHaveLength(10);
    expect(host.frames().map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(host.frames()[0]?.frame.npcs).toHaveLength(1);
  });

  test("game time does not depend on how often the timer fires", () => {
    // The same 2.5 seconds, once in small steps and once as a few long stalls.
    const fine = started();
    fine.advance(2500);
    const coarse = started();
    coarse.stall(700);
    coarse.stall(1300);
    coarse.stall(500);
    expect(tickOf(coarse)).toBe(tickOf(fine));
    expect(coarse.game.hash()).toBe(fine.game.hash());
  });

  test("a stall is worked off in bursts, and one beyond two seconds is dropped, not caught up", () => {
    const host = started();
    host.advance(300);
    expect(tickOf(host)).toBe(3);
    host.stall(1500);
    expect(tickOf(host)).toBe(18);
    host.stall(30_000);
    expect(tickOf(host)).toBe(38);
    expect(host.runtime.stats().droppedMs).toBeGreaterThan(27_000);
  });

  test("follows the rate the core reports", () => {
    const host = started({ rate: [1, 2] });
    host.advance(4000);
    expect(tickOf(host)).toBeGreaterThanOrEqual(19);
    expect(tickOf(host)).toBeLessThanOrEqual(21);
    expect(host.runtime.stats().rate).toEqual([1, 2]);
  });

  test("pace multiplies real time, and ticks are the same ticks", () => {
    const slow = started();
    slow.advance(2000);
    const fast = started({}, false, 10);
    fast.advance(200);
    expect(tickOf(fast)).toBe(tickOf(slow));
    expect(fast.game.hash()).toBe(slow.game.hash());
  });
});

test.describe("the speed of the day", () => {
  test("is the player's own multiple of the pace: the same ticks come sooner or later, and it is not in the log", () => {
    const normal = started();
    normal.advance(1000);
    const slow = started();
    slow.runtime.handle({ type: "speed", speed: 0.5 });
    slow.advance(1000);
    expect(tickOf(slow)).toBe(5);
    slow.advance(1000);
    expect(tickOf(slow)).toBe(tickOf(normal));
    expect(slow.game.hash()).toBe(normal.game.hash());
    expect(logOf(slow)).toEqual([]);
    // The speed goes on being used until the player changes it, and a new game keeps it.
    slow.runtime.handle({ type: "new-game", seed: 43 });
    slow.advance(1000);
    expect(slow.runtime.stats().nextTick).toBeLessThanOrEqual(6);
    slow.runtime.handle({ type: "speed", speed: 1 });
    const before = tickOf(slow);
    slow.advance(1000);
    expect(tickOf(slow) - before).toBe(10);
  });

  test("is kept between a quarter and four times the common pace, and an answer that is not a number is the common pace", () => {
    const fast = started();
    fast.runtime.handle({ type: "speed", speed: 100 });
    fast.advance(500);
    expect(tickOf(fast)).toBe(20);
    const slow = started();
    slow.runtime.handle({ type: "speed", speed: 0.001 });
    slow.advance(4000);
    expect(tickOf(slow)).toBe(10);
    const odd = started();
    odd.runtime.handle({ type: "speed", speed: Number.NaN });
    odd.advance(1000);
    expect(tickOf(odd)).toBe(10);
  });

  test("keeps a pace that does not say it is a skip's to four times the common pace: twelve without the flag runs as four does", () => {
    const plain = started();
    plain.runtime.handle({ type: "speed", speed: SKIP_PACE });
    plain.advance(500);
    const four = started();
    four.runtime.handle({ type: "speed", speed: MAX_SPEED });
    four.advance(500);
    expect(MAX_SPEED).toBe(4);
    expect(tickOf(plain)).toBe(20);
    expect(tickOf(plain)).toBe(tickOf(four));
    expect(plain.game.hash()).toBe(four.game.hash());
  });

  test("runs at the pace a skip to the next thing asks for as fast as it runs at all: the page asks for the highest the host takes for a skip", () => {
    const skipping = started();
    skipping.runtime.handle({ type: "speed", speed: SKIP_PACE, skip: true });
    skipping.advance(500);
    const highest = started();
    highest.runtime.handle({ type: "speed", speed: 1000, skip: true });
    highest.advance(500);
    expect(SKIP_PACE).toBe(MAX_SKIP_SPEED);
    expect(tickOf(skipping)).toBe(60);
    expect(tickOf(skipping)).toBe(tickOf(highest));
    expect(skipping.game.hash()).toBe(highest.game.hash());
    // The pace the player chose is asked for again at the end of the skip, and the day runs at it from there.
    skipping.runtime.handle({ type: "speed", speed: 1 });
    const before = tickOf(skipping);
    skipping.advance(1000);
    expect(tickOf(skipping) - before).toBe(10);
  });
});

test.describe("inputs", () => {
  test("are numbered on receipt, applied at the next tick and logged with that tick", () => {
    const host = started();
    host.advance(350);
    host.runtime.handle(player("a"));
    host.runtime.handle(player("b"));
    expect(host.runtime.stats().pending).toBe(2);
    expect(logOf(host)).toEqual([]);
    host.advance(50);
    expect(host.runtime.stats().pending).toBe(0);
    expect(logOf(host)).toEqual([
      [3, 0, "player"],
      [3, 1, "player"],
    ]);
    expect(host.game.state.actions).toEqual(["a", "b"]);
    host.runtime.handle(player("c"));
    host.advance(100);
    expect(logOf(host)[2]).toEqual([4, 2, "player"]);
  });

  test("a seq is never reused, whatever happens to the world", () => {
    const host = started();
    host.advance(200);
    host.runtime.handle({ type: "pause", reason: "user" });
    host.runtime.handle(player("a"));
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(300);
    host.runtime.handle(player("b"));
    host.advance(100);
    const seqs = host.runtime.buildReplay().records.map((r) => r[1]);
    expect(seqs).toEqual([0, 1, 2, 3]);
  });
});

test.describe("inputs the core refuses", () => {
  test("player actions in a refused call are dropped with a notice and the call goes through without them", () => {
    const host = started();
    host.advance(250);
    host.runtime.handle(player("fine"));
    host.runtime.handle({ type: "player", body: { action_id: "broken", type: "bad" } });
    host.advance(100);
    const notice = host.posted.find((m) => m.type === "notice");
    expect(notice).toMatchObject({ type: "notice", code: "input_refused" });
    expect((notice as { message: string }).message).toContain("2 player inputs");
    expect(host.posted.some((m) => m.type === "fatal")).toBe(false);
    expect(logOf(host)).toEqual([]);
    expect(tickOf(host)).toBe(3);
    // The numbers the dropped inputs used are not reused.
    host.runtime.handle(player("next"));
    host.advance(100);
    expect(logOf(host)).toEqual([[3, 2, "player"]]);
    expect(host.game.state.actions).toEqual(["next"]);
  });

  test("a refusal with no player action in the list is a failure", async () => {
    const host = started({ requestEvery: 10 });
    host.advance(1100);
    host.transport.calls.get("r10")?.settle({ text: "\ud800 lone surrogate" });
    await flush();
    host.advance(100);
    expect(host.posted.find((m) => m.type === "fatal")).toMatchObject({ code: "core_error" });
  });

  test("the log holds the inputs in the form the core normalized them to", () => {
    const host = started();
    host.advance(150);
    host.runtime.handle({ type: "player", body: { action_id: "a", junk: 1 } });
    host.advance(100);
    expect(host.runtime.buildReplay().records).toEqual([[1, 0, "player", { action_id: "a" }]]);
  });
});

test.describe("pause and resume", () => {
  test("a pause takes effect at once, is recorded, and stops the ticks", () => {
    const host = started();
    host.advance(500);
    host.runtime.handle({ type: "pause", reason: "user" });
    expect(logOf(host)).toEqual([[5, 0, "pause"]]);
    expect(host.runtime.stats().paused).toBe(true);
    const calls = host.runtime.stats().calls;
    host.advance(10_000);
    expect(tickOf(host)).toBe(5);
    expect(host.runtime.stats().calls).toBe(calls);
  });

  test("a resume restarts the world at once and leaves no backlog", () => {
    const host = started();
    host.advance(500);
    host.runtime.handle({ type: "pause", reason: "user" });
    host.advance(60_000);
    host.runtime.handle({ type: "resume", reason: "user" });
    expect(tickOf(host)).toBe(6);
    host.advance(99);
    expect(tickOf(host)).toBe(6);
    host.advance(1);
    expect(tickOf(host)).toBe(7);
    host.advance(1000);
    expect(tickOf(host)).toBe(17);
    expect(logOf(host)).toEqual([
      [5, 0, "pause"],
      [5, 1, "resume"],
    ]);
  });

  test("the world stays paused until every reason is gone, and only the change is recorded", () => {
    const host = started();
    host.advance(200);
    host.runtime.handle({ type: "pause", reason: "hidden" });
    host.runtime.handle({ type: "pause", reason: "user" });
    host.runtime.handle({ type: "resume", reason: "hidden" });
    host.advance(1000);
    expect(tickOf(host)).toBe(2);
    expect(host.runtime.stats().reasons).toEqual(["user"]);
    host.runtime.handle({ type: "resume", reason: "user" });
    expect(logOf(host).map((e) => e[2])).toEqual(["pause", "resume"]);
    host.advance(100);
    expect(tickOf(host)).toBe(4);
  });

  test("a page that starts hidden starts paused, at tick 0", () => {
    const host = started({}, true);
    host.advance(3000);
    expect(tickOf(host)).toBe(0);
    expect(logOf(host)).toEqual([[0, 0, "pause"]]);
    host.runtime.handle({ type: "resume", reason: "hidden" });
    host.advance(100);
    expect(tickOf(host)).toBe(2);
  });

  test("inputs that arrive while paused are applied at once, at the same tick, and replay to the same world", async () => {
    const host = started();
    host.advance(300);
    host.runtime.handle({ type: "pause", reason: "user" });
    host.runtime.handle(player("x"));
    host.advance(5000);
    host.runtime.handle(player("y"));
    expect(tickOf(host)).toBe(3);
    expect(logOf(host)).toEqual([
      [3, 0, "pause"],
      [3, 1, "player"],
      [3, 2, "player"],
    ]);
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(700);
    const replay = host.runtime.buildReplay();
    expect(replay.final.tick).toBe(tickOf(host));
    expect(await rebuildHash(replay)).toEqual({ hash: host.game.hash(), tick: tickOf(host) });
  });
});

test.describe("model requests", () => {
  const OPTIONS: FakeOptions = { requestEvery: 10 };

  test("go to the transport once, and the result comes back as an input", async () => {
    const host = started(OPTIONS);
    host.advance(1100);
    expect(host.transport.started).toEqual(["r10"]);
    expect(host.runtime.stats().models.inflight).toBe(1);
    host.transport.calls.get("r10")?.settle({ text: "hi there", usage: { input_tokens: 9, output_tokens: 4 }, latency_ms: 77 });
    await flush();
    host.advance(100);
    const result = host.runtime.buildReplay().records.find((r) => r[2] === "model_result");
    expect(result?.[3]).toEqual({ request_id: "r10", status: "ok", text: "hi there", usage: { input_tokens: 9, output_tokens: 4 }, latency_ms: 77 });
    expect(host.game.state.results).toEqual(["r10:ok"]);
    expect(host.runtime.stats().models).toMatchObject({ started: 1, ok: 1, inflight: 0 });
    expect(host.runtime.stats().lastModel).toMatchObject({ request_id: "r10", status: "ok", input_tokens: 9, output_tokens: 4 });
  });

  test("errors and timeouts are reported with their status and a short code in text", async () => {
    const host = started(OPTIONS);
    host.advance(2100);
    host.transport.calls.get("r10")?.settle({ status: "error", code: "http_429", text: "http_429", usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 12 });
    host.transport.calls.get("r20")?.settle({ status: "timeout", text: "", usage: null, latency_ms: 8000 });
    await flush();
    host.advance(100);
    const results = host.runtime.buildReplay().records.filter((r) => r[2] === "model_result");
    expect(results.map((r) => [r[3].request_id, r[3].status, r[3].text, r[3].usage])).toEqual([
      ["r10", "error", "http_429", { input_tokens: 0, output_tokens: 0 }],
      ["r20", "timeout", "", null],
    ]);
    expect(host.runtime.stats().models).toMatchObject({ error: 1, timeout: 1 });
  });

  test("a cancel from the core aborts the call and is reported as a cancelled result", async () => {
    const host = started({ requestEvery: 10, cancelAt: { 14: "r10" } });
    host.advance(1100);
    expect(host.transport.calls.get("r10")?.abortReason).toBeNull();
    host.advance(400);
    expect(host.transport.calls.get("r10")?.abortReason).toBe("cancel");
    await flush();
    host.advance(100);
    expect(host.game.state.results).toEqual(["r10:cancelled"]);
    expect(host.game.state.open).toEqual([]);
    expect(host.runtime.stats().models).toMatchObject({ cancelled: 1, inflight: 0 });
  });

  test("a cancel that arrives after the call finished leaves the real result, which the core voids and books", async () => {
    const host = started(OPTIONS);
    host.advance(1100);
    host.transport.calls.get("r10")?.settle({ text: "late", usage: { input_tokens: 7, output_tokens: 3 } });
    await flush();
    host.runtime.cancelRequests(["r10"]);
    host.advance(100);
    const results = host.runtime.buildReplay().records.filter((r) => r[2] === "model_result");
    expect(results).toHaveLength(1);
    expect(results[0]?.[3]).toMatchObject({ request_id: "r10", status: "ok", text: "late", usage: { input_tokens: 7, output_tokens: 3 } });
    expect(host.runtime.stats().models.cancelUnknown).toBe(0);
    expect(host.game.state.usage).toBe(10);
  });

  test("a call that was cancelled while running is reported cancelled with unknown usage, once", async () => {
    const host = started(OPTIONS);
    host.advance(1100);
    host.runtime.cancelRequests(["r10"]);
    expect(host.transport.calls.get("r10")?.abortReason).toBe("cancel");
    await flush();
    host.runtime.cancelRequests(["r10"]);
    host.advance(100);
    const results = host.runtime.buildReplay().records.filter((r) => r[2] === "model_result");
    expect(results.map((r) => r[3])).toEqual([{ request_id: "r10", status: "cancelled", text: "", usage: null, latency_ms: 42 }]);
  });

  test("a cancel for a request the host does not know is counted and does nothing", () => {
    const host = started();
    host.advance(100);
    host.runtime.cancelRequests(["nope"]);
    host.advance(100);
    expect(host.runtime.stats().models.cancelUnknown).toBe(1);
    expect(logOf(host)).toEqual([]);
  });

  test("a request and its cancel in one output both take effect", async () => {
    const host = started({ requestEvery: 10, cancelAt: { 10: "r10" } });
    host.advance(1100);
    expect(host.transport.calls.get("r10")?.abortReason).toBe("cancel");
    await flush();
    host.advance(100);
    expect(host.game.state.results).toEqual(["r10:cancelled"]);
  });

  test("a result that arrives while the world is paused is applied at once", async () => {
    const host = started(OPTIONS);
    host.advance(1100);
    host.runtime.handle({ type: "pause", reason: "user" });
    host.transport.calls.get("r10")?.settle({ text: "during pause" });
    await flush();
    expect(host.game.state.results).toEqual(["r10:ok"]);
    expect(tickOf(host)).toBe(11);
  });

  test("with no provider the host answers at once with an error, so the core is never left waiting", async () => {
    // The real transport does this itself (code no_provider); the host only has to pass it on.
    const host = started(OPTIONS);
    host.advance(1100);
    host.transport.calls.get("r10")?.settle({ status: "error", code: "no_provider", text: "no_provider", usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0 });
    await flush();
    host.advance(100);
    expect(host.game.state.open).toEqual([]);
  });

  test("with no provider the answer is queued at once and lands at the next tick, whatever the pace", () => {
    const refusal = { status: "error" as const, text: "no_provider", usage: { input_tokens: 0, output_tokens: 0 }, latency_ms: 0, code: "no_provider", usageReported: false };
    const run = (pace: number): VirtualHost => {
      const host = started({ requestEvery: 10 }, false, pace);
      host.transport.refuse = refusal;
      host.advance(3000 / pace);
      return host;
    };
    const slow = run(1);
    const fast = run(30);
    const landed = (host: VirtualHost): Array<[number, string]> =>
      host.runtime.buildReplay().records.filter((r) => r[2] === "model_result").map((r) => [r[0], String(r[3].request_id)]);
    expect(landed(slow)).toEqual([[11, "r10"], [21, "r20"]]);
    expect(landed(fast)).toEqual(landed(slow));
    expect(fast.game.hash()).toBe(slow.game.hash());
    expect(slow.transport.started).toEqual([]);
    expect(slow.runtime.stats().models).toMatchObject({ started: 2, error: 2, inflight: 0 });
  });

  test("a duplicate request id is started once", () => {
    const host = started();
    const request = { request_id: "dup", tier: "cheap", messages: [], max_tokens: 8 };
    host.runtime.submitRequest(request);
    host.runtime.submitRequest(request);
    expect(host.transport.started).toEqual(["dup"]);
  });

  test("configure goes to the transport, and a base URL only where the build allows it", () => {
    const host = started();
    host.runtime.handle({ type: "configure", provider: "bailian", key: "k", baseUrl: "http://elsewhere/v1" });
    expect(host.transport.configs).toEqual([{ provider: "bailian", key: "k", model: undefined, baseUrl: undefined }]);
  });
});

test.describe("saves", () => {
  async function playedHost(): Promise<{ host: VirtualHost; options: FakeOptions }> {
    const options: FakeOptions = { requestEvery: 10 };
    const host = started(options);
    host.advance(1100);
    host.transport.calls.get("r10")?.settle({ text: "one" });
    await flush();
    host.runtime.handle(player("a"));
    host.advance(700);
    host.runtime.handle({ type: "pause", reason: "user" });
    host.advance(500);
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(900);
    return { host, options };
  }

  const saveReply = async (host: VirtualHost, reqId = 1): Promise<{ id: number; tick: number; hash: string }> => {
    const reply = await host.call({ type: "call", reqId, call: { op: "save", name: "first" } });
    if (!reply.ok) throw new Error(reply.error.message);
    return reply.result as { id: number; tick: number; hash: string };
  };

  test("a save is the replay, with the hash at the moment of saving", async () => {
    const { host, options } = await playedHost();
    const meta = await saveReply(host);
    expect(meta).toMatchObject({ id: 1, name: "first", tick: tickOf(host), hash: host.game.hash() });
    const row = await host.saves.get(1);
    const replay = row?.replay as Replay;
    expect(replay.header).toEqual({ format: 1, core_version: "fake-1", content_hash: "fakehash", scenario: "m0", config: {}, seed: 42 });
    expect(replay.host).toMatchObject({ name: "browser", replayFormat: 1 });
    expect(replay.base).toBeNull();
    expect(replay.snapshots).toEqual([]);
    expect(replay.end_tick).toBe(tickOf(host));
    expect(replay.final).toEqual({ tick: tickOf(host), hash: host.game.hash() });
    expect(replay.hashes.map((h) => h[0])).toEqual([0, 100].filter((t) => t < tickOf(host)));
    expect(await rebuildHash(replay, options)).toEqual({ hash: meta.hash, tick: meta.tick });
  });

  test("a save keeps what the page sent with it, and a load hands it back with the rest of the load info", async () => {
    const { host } = await playedHost();
    const notes = { recap: { key: "k", lines: [{ text: { zh: "甲", en: "A" }, events: [16] }] } };
    const reply = await host.call({ type: "call", reqId: 1, call: { op: "save", name: "with notes", page: notes } });
    expect(reply.ok).toBe(true);
    const meta = (reply as { result: { id: number; page?: unknown } }).result;
    expect(meta.page).toEqual(notes);
    expect((await host.saves.get(meta.id))?.meta.page).toEqual(notes);
    // The replay is the save and is untouched by the notes.
    expect(JSON.stringify((await host.saves.get(meta.id))?.replay)).not.toContain("recap");
    const loaded = await host.call({ type: "call", reqId: 2, call: { op: "load", id: meta.id } });
    expect((loaded as { result: LoadInfo }).result.page).toEqual(notes);
    const message = host.posted.find((m: HostToPage) => m.type === "loaded");
    expect(message?.type === "loaded" && message.info.page).toEqual(notes);
    // A save without notes has none, and the load info has no key for them.
    const plain = await host.call({ type: "call", reqId: 3, call: { op: "save", name: "plain" } });
    const plainId = (plain as { result: { id: number } }).result.id;
    expect("page" in ((await host.saves.get(plainId))?.meta ?? {})).toBe(false);
    const back = await host.call({ type: "call", reqId: 4, call: { op: "load", id: plainId } });
    expect("page" in (back as { result: LoadInfo }).result).toBe(false);
  });

  test("keeps the notes of the page only when they are a plain object of a size worth keeping", () => {
    expect(keptNotes({ a: 1 })).toEqual({ a: 1 });
    expect(keptNotes({})).toEqual({});
    for (const bad of [undefined, null, 3, "text", [1, 2], { big: "x".repeat(MAX_PAGE_NOTES) }]) expect(keptNotes(bad)).toBeUndefined();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(keptNotes(circular)).toBeUndefined();
    // What is kept is a copy: the caller's object is not held.
    const given = { list: [1] };
    const kept = keptNotes(given);
    given.list.push(2);
    expect(kept).toEqual({ list: [1] });
  });

  test("loading rebuilds the world to the saved hash, holds it, and sends the open request again", async () => {
    const { host } = await playedHost();
    const meta = await saveReply(host);
    const hashAtSave = host.game.hash();
    host.advance(2000);
    expect(tickOf(host)).toBeGreaterThan(meta.tick);

    const reply = await host.call({ type: "call", reqId: 2, call: { op: "load", id: meta.id } });
    expect(reply.ok).toBe(true);
    const info = (reply as { result: LoadInfo }).result;
    expect(info).toMatchObject({ id: 1, tick: meta.tick, hash: hashAtSave, savedHash: hashAtSave, match: true });
    expect(info.reissued).toBe(1);
    expect(host.games).toHaveLength(2);
    expect(host.games[0]?.destroyed).toBe(true);
    expect(tickOf(host)).toBe(meta.tick);
    expect(host.runtime.stats().paused).toBe(true);
    expect(host.runtime.stats().reasons).toEqual(["user"]);
    expect(host.transport.started.filter((id) => id === "r10")).toHaveLength(1);
    expect(host.transport.started.filter((id) => id === "r20")).toHaveLength(2);
    expect(host.posted.some((m: HostToPage) => m.type === "loaded")).toBe(true);
    host.advance(5000);
    expect(tickOf(host)).toBe(meta.tick);

    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(500);
    expect(tickOf(host)).toBeGreaterThan(meta.tick);
    // The session that continued from the save replays to the same world as the live one.
    const replay = host.runtime.buildReplay();
    expect(await rebuildHash(replay, { requestEvery: 10 })).toEqual({ hash: host.game.hash(), tick: tickOf(host) });
  });

  test("a request the core had cancelled before the save is reported cancelled after the load, not sent again", async () => {
    const options: FakeOptions = { requestEvery: 10, cancelAt: { 14: "r10" } };
    const host = started(options);
    host.advance(1600);
    // The call was aborted but its result is still on its way when the save is made.
    host.transport.calls.get("r10")?.settle({ status: "cancelled", text: "" });
    const meta = await saveReply(host);
    const saved = host.saves.rows.get(meta.id)?.replay as Replay;
    expect(saved.records.filter((r) => r[2] === "model_result")).toEqual([]);
    const reply = await host.call({ type: "call", reqId: 2, call: { op: "load", id: meta.id } });
    const info = (reply as { result: LoadInfo }).result;
    expect(info.cancelledOpen).toBe(1);
    expect(info.reissued).toBe(0);
    expect(host.transport.started.filter((id) => id === "r10")).toHaveLength(1);
    expect(host.game.state.results).toContain("r10:cancelled");
  });

  test("a save whose hash does not match is refused and changes nothing", async () => {
    const { host } = await playedHost();
    const meta = await saveReply(host);
    const stored = host.saves.rows.get(meta.id)?.replay as Replay;
    stored.final.hash = "d".repeat(64);
    const before = host.runtime.stats().nextTick;
    const reply = await host.call({ type: "call", reqId: 2, call: { op: "load", id: meta.id } });
    expect(reply.ok).toBe(false);
    expect(reply.ok === false && reply.error.code).toBe("hash_mismatch");
    expect(host.games[host.games.length - 1]?.destroyed).toBe(true);
    expect(host.game.destroyed).toBe(true);
    // The first game is still the one that runs.
    const live = host.games[0];
    expect(live?.destroyed).toBe(false);
    host.advance(1000);
    expect(tickOf(host)).toBeGreaterThan(before);
  });

  test("unknown ids and malformed saves are refused with a code", async () => {
    const { host } = await playedHost();
    const missing = await host.call({ type: "call", reqId: 1, call: { op: "load", id: 99 } });
    expect(missing.ok === false && missing.error.code).toBe("not_found");
    host.saves.rows.set(5, { meta: { id: 5, name: "bad", savedAt: "", tick: 0, hash: "" }, replay: { header: { replayFormat: 1 } } });
    const bad = await host.call({ type: "call", reqId: 2, call: { op: "load", id: 5 } });
    expect(bad.ok === false && bad.error.code).toBe("bad_replay");
  });

  test("list and delete", async () => {
    const { host } = await playedHost();
    await saveReply(host, 1);
    await saveReply(host, 2);
    const list = await host.call({ type: "call", reqId: 3, call: { op: "list-saves" } });
    expect((list as { result: Array<{ id: number }> }).result.map((s) => s.id)).toEqual([2, 1]);
    await host.call({ type: "call", reqId: 4, call: { op: "delete-save", id: 2 } });
    const after = await host.call({ type: "call", reqId: 5, call: { op: "list-saves" } });
    expect((after as { result: Array<{ id: number }> }).result.map((s) => s.id)).toEqual([1]);
  });

  test("export is the same replay the save holds", async () => {
    const { host } = await playedHost();
    const exported = await host.call({ type: "call", reqId: 1, call: { op: "export" } });
    const replay = (exported as { result: Replay }).result;
    expect(replay.final.hash).toBe(host.game.hash());
    expect(replay.records.map((r) => r[2])).toEqual(["model_result", "player", "pause", "resume"]);
  });
});

test.describe("the ending", () => {
  const WHOLE = { kind: "ending", tick: 1800, ending: "ending_full", label: { zh: "圆满", en: "A perfect night" }, hidden: [], inputs: {}, passage: "mended", promised: 9, turnout: 1500, reveal: { truth: null, chains: [] } };
  const posted = (host: VirtualHost): string[] => host.posted.filter((m) => m.type === "scene" || m.type === "ending" || m.type === "reset" || m.type === "frame" || m.type === "loaded").map((m) => m.type);
  const endings = (host: VirtualHost): unknown[] => host.posted.filter((m) => m.type === "ending").map((m) => (m as { ending: unknown }).ending);

  test("a game that is created tells the page its ending after its scene, and a new game does the same", () => {
    const host = started();
    expect(posted(host).slice(0, 2)).toEqual(["scene", "ending"]);
    expect(endings(host)).toEqual([null]);
    host.runtime.handle({ type: "new-game", seed: 7 });
    expect(posted(host).slice(-3)).toEqual(["reset", "scene", "ending"]);
    expect(endings(host)).toEqual([null, null]);
  });

  test("a game that is loaded tells the page the whole ending before its first frame, and the page is told again by a call", async () => {
    // The game of the save is over once it is rebuilt, which the stand-in is told by its options.
    const host = started({ ending: WHOLE });
    host.advance(300);
    const saved = await host.call({ type: "call", reqId: 1, call: { op: "save", name: "the last night" } });
    expect(saved.ok).toBe(true);
    const id = (saved as { result: { id: number } }).result.id;
    host.runtime.handle({ type: "new-game", seed: 9 });
    host.gameOptions = { ending: WHOLE };
    const before = host.posted.length;
    const loaded = await host.call({ type: "call", reqId: 2, call: { op: "load", id } });
    expect(loaded.ok).toBe(true);
    const after = host.posted.slice(before).map((m) => m.type);
    expect(after.filter((type) => type === "ending")).toEqual(["ending"]);
    expect(after.indexOf("reset")).toBeLessThan(after.indexOf("scene"));
    expect(after.indexOf("scene")).toBeLessThan(after.indexOf("ending"));
    expect(after.indexOf("ending")).toBeLessThan(after.indexOf("frame"));
    expect(after.indexOf("frame")).toBeLessThan(after.indexOf("loaded"));
    expect(endings(host).pop()).toEqual(WHOLE);
    // And the call that the page makes for the whole ending when a frame is all it has.
    const asked = await host.call({ type: "call", reqId: 3, call: { op: "ending" } });
    expect(asked).toMatchObject({ ok: true, result: WHOLE });
  });

  test("the call answers null before the game has ended and fails when there is no game", async () => {
    const host = started();
    const asked = await host.call({ type: "call", reqId: 1, call: { op: "ending" } });
    expect(asked).toMatchObject({ ok: true, result: null });
    host.runtime.stop();
    const none = await host.call({ type: "call", reqId: 2, call: { op: "ending" } });
    expect(none).toMatchObject({ ok: false, error: { code: "not_started" } });
  });

  test("a game whose ending cannot be read still plays, and the page is not told", () => {
    const real = FakeGame.prototype.endingJson;
    FakeGame.prototype.endingJson = () => "{";
    try {
      const host = started();
      host.advance(300);
      expect(host.posted.some((m) => m.type === "fatal")).toBe(false);
      expect(host.posted.some((m) => m.type === "ending")).toBe(false);
      expect(host.logs.some((line) => line.startsWith("warn: the ending could not be read"))).toBe(true);
      expect(tickOf(host)).toBeGreaterThan(0);
    } finally {
      FakeGame.prototype.endingJson = real;
    }
  });
});

test.describe("the preview of an action", () => {
  const ASK = { verb: "ask", npc: "cha_laoban", topic: "t_rail" };

  test("is the core's answer to the action as the page gave it, as the reply of the call", async () => {
    const host = started();
    host.advance(300);
    const reply = await host.call({ type: "call", reqId: 1, call: { op: "preview", action: ASK } });
    expect(reply).toMatchObject({ ok: true, result: { version: 4, cost: 20, odds: "mid", gives: null, blockers: [], reasons: [] } });
    // the core got the action word for word, as JSON
    expect(host.game.previews.map((text) => JSON.parse(text))).toEqual([ASK]);
  });

  test("reads and nothing else: it takes no tick, logs no input, and the game goes on as if it were not asked", async () => {
    const asked = started();
    const plain = started();
    asked.advance(300);
    plain.advance(300);
    for (let i = 0; i < 5; i++) await asked.call({ type: "call", reqId: i, call: { op: "preview", action: ASK } });
    asked.advance(500);
    plain.advance(500);
    expect(tickOf(asked)).toBe(tickOf(plain));
    expect(asked.game.hash()).toBe(plain.game.hash());
    expect(logOf(asked)).toEqual(logOf(plain));
    expect(asked.game.calls).toEqual(plain.game.calls);
  });

  test("answers while the world is paused, and the version of the state stays where it was", async () => {
    const host = started();
    host.advance(300);
    host.runtime.handle({ type: "pause", reason: "user" });
    const one = await host.call({ type: "call", reqId: 1, call: { op: "preview", action: ASK } });
    const two = await host.call({ type: "call", reqId: 2, call: { op: "preview", action: ASK } });
    expect(one.ok && two.ok).toBe(true);
    expect((one as { result: { version: number } }).result.version).toBe((two as { result: { version: number } }).result.version);
  });

  test("answers null for a game that has no previews, so that the page knows", async () => {
    const host = started({ noPreviews: true });
    const reply = await host.call({ type: "call", reqId: 1, call: { op: "preview", action: ASK } });
    expect(reply).toMatchObject({ ok: true, result: null });
  });

  test("fails with bad_action for an action the core cannot read, and with not_started when there is no game", async () => {
    const host = started();
    const bad = await host.call({ type: "call", reqId: 1, call: { op: "preview", action: { verb: "dance", npc: "cha_laoban" } } });
    expect(bad).toMatchObject({ ok: false, error: { code: "bad_action" } });
    expect((bad as { error: { message: string } }).error.message).toContain("verb must be one of");
    const noVerb = await host.call({ type: "call", reqId: 2, call: { op: "preview", action: { npc: "cha_laoban" } } });
    expect(noVerb).toMatchObject({ ok: false, error: { code: "bad_action" } });
    // the game was not stopped by it
    expect(host.posted.some((m) => m.type === "fatal")).toBe(false);
    host.advance(300);
    expect(tickOf(host)).toBeGreaterThan(0);
    host.runtime.stop();
    const none = await host.call({ type: "call", reqId: 3, call: { op: "preview", action: ASK } });
    expect(none).toMatchObject({ ok: false, error: { code: "not_started" } });
  });

  test("fails with host_error for anything else the core throws, and still does not stop the game", async () => {
    const real = FakeGame.prototype.previewJson;
    FakeGame.prototype.previewJson = () => {
      throw new Error("the fake world broke");
    };
    try {
      const host = started();
      const reply = await host.call({ type: "call", reqId: 1, call: { op: "preview", action: ASK } });
      expect(reply).toMatchObject({ ok: false, error: { code: "host_error" } });
      host.advance(300);
      expect(host.posted.some((m) => m.type === "fatal")).toBe(false);
    } finally {
      FakeGame.prototype.previewJson = real;
    }
  });
});

test.describe("failure and restart", () => {
  test("an exception in the core stops the loop, reports it, and keeps only inputs the core applied", async () => {
    const host = started({ throwAt: 3 });
    host.runtime.handle(player("early"));
    host.advance(350);
    expect(logOf(host)).toEqual([[0, 0, "player"]]);
    // This input is in the call that throws, so it was never applied and must not be logged.
    host.runtime.handle(player("doomed"));
    host.advance(200);
    const fatal = host.posted.find((m) => m.type === "fatal");
    expect(fatal).toMatchObject({ type: "fatal", code: "core_error" });
    expect((fatal as { message: string }).message).toContain("the fake world broke");
    const ticks = tickOf(host);
    host.advance(5000);
    expect(tickOf(host)).toBe(ticks);
    expect(logOf(host)).toEqual([[0, 0, "player"]]);

    const exported = await host.call({ type: "call", reqId: 1, call: { op: "export" } });
    expect((exported as { result: Replay }).result.final.hash).toBe("");
    const saved = await host.call({ type: "call", reqId: 2, call: { op: "save" } });
    expect(saved.ok === false && saved.error.code).toBe("failed");
  });

  test("a core that reports the wrong tick is a failure, not a silent drift", () => {
    const host = started({ skewFrom: 2 });
    host.advance(500);
    expect(host.posted.find((m) => m.type === "fatal")).toMatchObject({ code: "tick_mismatch" });
  });

  test("a new game starts over, keeps a pause the player asked for, and recovers from a failure", () => {
    const host = started({ throwAt: 2 });
    host.advance(500);
    expect(host.posted.some((m) => m.type === "fatal")).toBe(true);
    host.gameOptions = {};
    host.runtime.handle({ type: "pause", reason: "user" });
    host.runtime.handle({ type: "new-game", seed: 7 });
    expect(host.posted.find((m) => m.type === "reset")).toMatchObject({ seed: 7 });
    expect(host.games).toHaveLength(2);
    expect(host.games[0]?.destroyed).toBe(true);
    expect(host.game.seed).toBe(7);
    expect(logOf(host)).toEqual([[0, 0, "pause"]]);
    host.advance(1000);
    expect(tickOf(host)).toBe(0);
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(1000);
    expect(tickOf(host)).toBeGreaterThanOrEqual(10);
  });

  test("a new game discards the calls of the old one", async () => {
    const host = started({ requestEvery: 10 });
    host.advance(1100);
    host.runtime.handle({ type: "new-game", seed: 9 });
    expect(host.transport.calls.get("r10")?.abortReason).toBe("discard");
    await flush();
    host.advance(200);
    expect(logOf(host)).toEqual([]);
    expect(host.runtime.stats().models.inflight).toBe(0);
  });

  test("stats are posted about twice a second and carry the cost of a step", () => {
    const host = started();
    host.advance(2100);
    const stats = host.posted.filter((m) => m.type === "stats");
    expect(stats.length).toBeGreaterThanOrEqual(3);
    expect(stats.length).toBeLessThanOrEqual(8);
    const last = host.runtime.stats();
    expect(last.calls).toBe(21);
    expect(last.pyMaxMs).toBeGreaterThanOrEqual(0);
  });
});
