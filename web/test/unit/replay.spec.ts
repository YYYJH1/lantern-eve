import { expect, test } from "@playwright/test";
import type { HashRecord, LogRecord, Replay } from "../../src/shared/protocol.ts";
import { groupByTick, ReplayError, ReplayMismatch, runReplay, specOf, validateReplay } from "../../src/shared/replay.ts";
import { FakeGame, type FakeOptions } from "../support/fake-game.ts";

const rec = (tick: number, seq: number, kind: string, body: Record<string, unknown> = {}): LogRecord => [tick, seq, kind, body];
const make = (spec: { seed: number; scenario: string }): FakeGame => new FakeGame(spec.seed, spec.scenario);

/** The replay a live session would have written: call by call, then the hashes read off the game. */
function liveReplay(records: LogRecord[], endTick: number, options: FakeOptions = {}): Replay {
  const game = new FakeGame(7, "m0", options);
  const hashes: HashRecord[] = [];
  const groups = new Map<number, LogRecord[]>();
  for (const r of records) groups.set(r[0], [...(groups.get(r[0]) ?? []), r]);
  let t = 0;
  while (t < endTick || groups.has(t)) {
    const here = groups.get(t) ?? [];
    groups.delete(t);
    const out = JSON.parse(game.step(JSON.stringify(here.map(([, seq, kind, body]) => ({ seq, kind, body }))))) as { advanced: boolean; tick: number; hash?: string };
    if (out.advanced) {
      if (out.hash !== undefined) hashes.push([out.tick, out.hash]);
      t++;
    } else if (groups.size === 0) break;
  }
  return {
    header: JSON.parse(game.headerJson()),
    base: null,
    records,
    hashes,
    snapshots: [],
    end_tick: game.tick,
    host: { name: "browser", version: "t", replayFormat: 1 },
    final: { tick: game.tick, hash: game.hash() },
  };
}

test.describe("groupByTick", () => {
  test("puts inputs of the same tick in one group, in order", () => {
    const groups = groupByTick([rec(0, 0, "pause"), rec(0, 1, "player"), rec(3, 2, "resume")]);
    expect(groups.map((g) => [g.tick, g.inputs.map((i) => i.seq)])).toEqual([
      [0, [0, 1]],
      [3, [2]],
    ]);
    expect(groups[0]?.inputs[0]).toEqual({ seq: 0, kind: "pause", body: {} });
  });

  test("allows gaps in the seq numbers, refuses numbers that do not increase and ticks that go back", () => {
    expect(groupByTick([rec(0, 0, "pause"), rec(0, 5, "resume")])).toHaveLength(1);
    expect(() => groupByTick([rec(0, 1, "pause"), rec(0, 1, "resume")])).toThrow(ReplayError);
    expect(() => groupByTick([rec(5, 0, "pause"), rec(4, 1, "resume")])).toThrow(/before tick/);
  });
});

test.describe("validateReplay", () => {
  const good = (): Replay => liveReplay([rec(2, 0, "player", { action_id: "a" })], 5);

  test("accepts what the host writes", () => {
    expect(validateReplay(JSON.parse(JSON.stringify(good())))).toBeTruthy();
  });

  test("accepts a recording the server wrote, which has none of the host's own keys", () => {
    const { host: _host, final: _final, ...recording } = JSON.parse(JSON.stringify(good()));
    const replay = validateReplay(recording);
    expect(replay.final).toEqual({ tick: replay.end_tick, hash: "" });
    expect(replay.host.name).toBe("unknown");
  });

  test("names what is wrong", () => {
    const bad = (mutate: (r: Record<string, unknown>) => void): string => {
      const copy = JSON.parse(JSON.stringify(good())) as Record<string, unknown>;
      mutate(copy);
      try {
        validateReplay(copy);
        return "accepted";
      } catch (err) {
        return err instanceof ReplayError ? `${err.code}: ${err.message}` : String(err);
      }
    };
    expect(bad((r) => delete r.header)).toMatch(/bad_replay: .*header/);
    expect(bad((r) => ((r.header as Record<string, unknown>).seed = "x"))).toMatch(/header\.seed/);
    expect(bad((r) => ((r.host as Record<string, unknown>).replayFormat = 99))).toMatch(/unsupported_format/);
    expect(bad((r) => (r.base = { tick: 5, snapshot: "{}" }))).toMatch(/unsupported_format: .*snapshot/);
    expect(bad((r) => ((r.records as unknown[])[0] = [-1, 0, "pause", {}]))).toMatch(/records\[0\]/);
    expect(bad((r) => ((r.records as unknown[])[0] = [0, 0, "pause"]))).toMatch(/records\[0\]/);
    expect(bad((r) => (r.hashes = {}))).toMatch(/hashes/);
    expect(bad((r) => ((r.hashes as unknown[])[0] = [100]))).toMatch(/hashes\[0\]/);
    expect(bad((r) => ((r.final as Record<string, unknown>).hash = 5))).toMatch(/final/);
    expect(bad((r) => ((r.final as Record<string, unknown>).tick = 1))).toMatch(/end_tick/);
    expect(bad((r) => delete r.end_tick)).toMatch(/end_tick/);
    expect(() => validateReplay(null)).toThrow(ReplayError);
  });

  test("builds the constructor arguments from the header", () => {
    const replay = good();
    expect(specOf(replay)).toEqual({ seed: 7, scenario: "m0", config: {} });
    replay.header.config = null as unknown as Record<string, number>;
    expect(specOf(replay).config).toBeNull();
  });
});

test.describe("runReplay", () => {
  test("rebuilds the same world and checks every hash", async () => {
    const replay = liveReplay([rec(3, 0, "player", { action_id: "a" }), rec(150, 1, "pause"), rec(150, 2, "player", { action_id: "b" }), rec(150, 3, "resume")], 420);
    const result = await runReplay(make, replay);
    expect(result.nextTick).toBe(420);
    expect(result.hash).toBe(replay.final.hash);
    expect(result.hashesChecked).toBe(replay.hashes.length);
    expect(replay.hashes.length).toBeGreaterThanOrEqual(4);
  });

  test("applies the inputs of calls that were made while paused as one call", async () => {
    // Live, the pause call and the resume call are separate; the log only has ticks, so the replay merges them.
    const replay = liveReplay([rec(10, 0, "pause"), rec(10, 1, "player", { action_id: "x" }), rec(10, 2, "resume")], 30);
    const result = await runReplay(make, replay);
    expect(result.nextTick).toBe(30);
    expect(result.hash).toBe(replay.final.hash);
  });

  test("passes the header's seed and scenario to the constructor", async () => {
    const replay = liveReplay([], 10);
    const seen: Array<{ seed: number; scenario: string }> = [];
    await runReplay((spec) => {
      seen.push(spec);
      return make(spec);
    }, replay);
    expect(seen).toEqual([{ seed: 7, scenario: "m0", config: {} }]);
  });

  test("detects a changed checkpoint hash and says where", async () => {
    const replay = liveReplay([], 250);
    replay.hashes[1] = [replay.hashes[1]![0], "0".repeat(64)];
    const err = await runReplay(make, replay).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplayMismatch);
    expect((err as ReplayMismatch).tick).toBe(replay.hashes[1]![0]);
    expect((err as ReplayMismatch).where).toBe("checkpoint");
  });

  test("detects a changed final hash", async () => {
    const replay = liveReplay([rec(5, 0, "player", { action_id: "a" })], 60);
    replay.final = { ...replay.final, hash: "f".repeat(64) };
    const err = await runReplay(make, replay).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReplayMismatch);
    expect((err as ReplayMismatch).where).toBe("final");
  });

  test("detects a changed input, which shows at the next hash", async () => {
    const replay = liveReplay([rec(5, 0, "player", { action_id: "a" })], 260);
    replay.records[0] = rec(5, 0, "player", { action_id: "other" });
    await expect(runReplay(make, replay)).rejects.toBeInstanceOf(ReplayMismatch);
  });

  test("detects a checkpoint that the rebuilt world never reaches", async () => {
    const replay = liveReplay([], 250);
    replay.hashes.push([150, "a".repeat(64)]);
    await expect(runReplay(make, replay)).rejects.toThrow(/hash differs at tick 150/);
  });

  test("an empty end hash means there is nothing to compare at the end", async () => {
    const replay = liveReplay([], 40);
    replay.final = { tick: 40, hash: "" };
    const result = await runReplay(make, replay);
    expect(result.nextTick).toBe(40);
  });

  test("refuses a log that runs on while the world is paused", async () => {
    const replay = liveReplay([rec(2, 0, "pause")], 10);
    replay.records.push(rec(8, 1, "player", { action_id: "late" }));
    await expect(runReplay(make, replay)).rejects.toThrow(/paused at tick 2/);
  });

  test("destroys the game it built when the replay fails", async () => {
    const replay = liveReplay([], 120);
    replay.final = { ...replay.final, hash: "e".repeat(64) };
    const games: FakeGame[] = [];
    await runReplay((spec) => {
      const g = make(spec);
      games.push(g);
      return g;
    }, replay).catch(() => undefined);
    expect(games).toHaveLength(1);
    expect(games[0]?.destroyed).toBe(true);
  });

  test("reports the requests that no result settled", async () => {
    const options: FakeOptions = { requestEvery: 10, cancelAt: { 25: "r20" } };
    const replay = liveReplay([rec(14, 0, "model_result", { request_id: "r10", status: "ok", text: "t", usage: { input_tokens: 1, output_tokens: 1 }, latency_ms: 5 })], 40, options);
    const result = await runReplay((spec) => new FakeGame(spec.seed, spec.scenario, options), replay);
    // r10 was answered, r20 was cancelled by the core and never reported, r30 is still open.
    expect(result.openRequests.map((r) => r.request_id)).toEqual(["r30"]);
    expect(result.cancelledOpen).toEqual(["r20"]);
  });

  test("yields to the event loop on long replays", async () => {
    const replay = liveReplay([], 600);
    let yields = 0;
    await runReplay(make, replay, { yieldEvery: 100, yieldNow: async () => { yields++; } });
    expect(yields).toBeGreaterThanOrEqual(5);
  });
});
