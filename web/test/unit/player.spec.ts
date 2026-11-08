import { expect, test } from "@playwright/test";
import type { Replay } from "../../src/shared/protocol.ts";
import { groupByTick } from "../../src/shared/replay.ts";
import { FakeGame, type FakeOptions } from "../support/fake-game.ts";
import { flush, recordGame, VirtualPlayer } from "../support/virtual-player.ts";

/** The world at a position, built straight from the start the way a replay does, for a hash to compare with. */
function straight(replay: Replay, position: number, options: FakeOptions = {}): FakeGame {
  const game = new FakeGame(replay.header.seed, replay.header.scenario, options);
  const groups = groupByTick(replay.records);
  let gi = 0;
  let t = 0;
  while (t < position) {
    const group = groups[gi];
    let inputs: unknown[] = [];
    if (group !== undefined && group.tick === t) {
      inputs = group.inputs;
      gi++;
    }
    const out = JSON.parse(game.step(JSON.stringify(inputs))) as { advanced: boolean; tick: number };
    if (out.advanced) t = out.tick + 1;
  }
  return game;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const action = (id: string) => ({ type: "player" as const, body: { action_id: id } });

test.describe("a recording that is opened", () => {
  test("shows the first tick as a new game, with its scene and no ending, and plays at ten ticks a second", async () => {
    const replay = await recordGame({}, 600);
    const host = new VirtualPlayer();
    await host.open(replay);
    expect(host.types().filter((type) => type !== "replay")).toEqual(["reset", "scene", "ending", "frame"]);
    expect(host.posted.find((m) => m.type === "reset")).toEqual({ type: "reset", seed: 42, scenario: "bridge" });
    expect(host.posted.find((m) => m.type === "ending")).toEqual({ type: "ending", ending: null });
    expect(host.frames()).toHaveLength(1);
    expect(host.frames()[0]).toMatchObject({ tick: 0, advanced: true, events: [], clock: { paused: false, rate: [1, 1] } });
    expect(host.status).toMatchObject({ phase: "ready", tick: 1, endTick: replay.end_tick, playing: true, busy: false, ended: false, speed: 1, seed: 42, scenario: "bridge", host: "browser", error: null });

    host.advance(1000);
    expect(host.frames().map((f) => f.tick)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(host.runtime.status().tick).toBe(11);
    expect(host.game.state.tick).toBe(11);
    // The events of the ticks that are played come with their frames. The picture a jump shows has none.
    expect(host.frames().flatMap((f) => f.events)).toEqual([]);
    host.advance(4000);
    expect(host.frames().flatMap((f) => f.events)).toEqual([{ kind: "tock", tick: 50 }]);
  });

  test("starts where it is told to, held if it is told to wait, and plays when the page says play", async () => {
    const replay = await recordGame({}, 600);
    const host = new VirtualPlayer();
    await host.open(replay, { tick: 300, play: false });
    expect(host.status).toMatchObject({ tick: 300, playing: false, phase: "ready" });
    expect(host.frames().map((f) => f.tick)).toEqual([299]);
    host.advance(2000);
    expect(host.runtime.status().tick).toBe(300);
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(1000);
    expect(host.runtime.status()).toMatchObject({ tick: 310, playing: true });
    expect(host.game.hash()).toBe(straight(replay, 310).hash());
  });

  test("holds while the user or the page's visibility says so, and carries on without a backlog", async () => {
    const replay = await recordGame({}, 600);
    const host = new VirtualPlayer({}, true);
    await host.open(replay);
    // A page that is hidden when the recording is opened holds it.
    expect(host.status.playing).toBe(false);
    host.advance(1000);
    expect(host.runtime.status().tick).toBe(1);
    host.runtime.handle({ type: "resume", reason: "hidden" });
    host.advance(500);
    expect(host.runtime.status().tick).toBe(6);
    host.runtime.handle({ type: "pause", reason: "user" });
    host.runtime.handle({ type: "pause", reason: "hidden" });
    host.advance(5000);
    host.runtime.handle({ type: "resume", reason: "hidden" });
    host.advance(1000);
    expect(host.runtime.status()).toMatchObject({ tick: 6, playing: false });
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(1000);
    // Time that passed while it was held is not played to catch up.
    expect(host.runtime.status().tick).toBe(16);
  });

  test("goes at the speed it is told, and at the rate the core reported when the game was played", async () => {
    const replay = await recordGame({ rate: [1, 2] }, 300);
    const host = new VirtualPlayer({ rate: [1, 2] });
    await host.open(replay);
    host.advance(2000);
    expect(host.runtime.status().tick).toBe(1 + 10);
    host.control({ op: "speed", speed: 4 });
    host.advance(2000);
    expect(host.runtime.status()).toMatchObject({ tick: 1 + 10 + 40, speed: 4 });
    host.control({ op: "speed", speed: 0 });
    host.control({ op: "speed", speed: 1000 });
    host.control({ op: "speed", speed: Number.NaN });
    expect(host.runtime.status().speed).toBe(4);
  });

  test("plays to the end, says so, tells the page the whole ending, and plays again from the start when asked", async () => {
    const ending = { kind: "ending", ending: "ending_full", tick: 0, label: { zh: "圆满", en: "Perfect" }, reveal: { chains: [] } };
    const replay = await recordGame({ ending }, 120);
    const host = new VirtualPlayer({ ending });
    await host.open(replay);
    host.control({ op: "speed", speed: 16 });
    host.advance(3000);
    expect(host.status).toMatchObject({ ended: true, playing: false, tick: replay.end_tick, phase: "ready" });
    expect(host.frames().at(-1)?.tick).toBe(replay.end_tick - 1);
    expect(host.posted.filter((m) => m.type === "ending").at(-1)).toEqual({ type: "ending", ending });
    const ticks = host.frames().length;
    host.advance(3000);
    expect(host.frames()).toHaveLength(ticks);

    // Play at the end plays it again. Holding or hiding does not.
    host.runtime.handle({ type: "pause", reason: "hidden" });
    host.runtime.handle({ type: "resume", reason: "hidden" });
    await flush();
    expect(host.status.ended).toBe(true);
    host.runtime.handle({ type: "resume", reason: "user" });
    await flush();
    expect(host.status).toMatchObject({ ended: false, tick: 1, playing: true });
    expect(host.types().filter((t) => t === "reset")).toHaveLength(2);
  });
});

test.describe("a seek", () => {
  test("goes on from where the world stands when the position is ahead, with no new world", async () => {
    const replay = await recordGame({}, 600);
    const host = new VirtualPlayer();
    await host.open(replay, { play: false });
    await host.seek(250);
    expect(host.games).toHaveLength(1);
    expect(host.status).toMatchObject({ tick: 250, busy: false, playing: false });
    expect(host.game.hash()).toBe(straight(replay, 250).hash());
    // The page is sent a new game and the picture of the position, and none of what happened on the way.
    const after = host.posted.slice(host.posted.findLastIndex((m) => m.type === "reset"));
    expect(after.filter((m) => m.type !== "replay").map((m) => m.type)).toEqual(["reset", "scene", "ending", "frame"]);
    expect(after.find((m) => m.type === "frame")).toMatchObject({ tick: 249, events: [] });
  });

  test("starts from the latest snapshot of the recording before the position when the position is behind", async () => {
    const replay = await recordGame({}, 600, {}, 100);
    expect(replay.snapshots.map((s) => (s as [number, string])[0])).toEqual([100, 200, 300, 400, 500, 600].filter((t) => t <= replay.end_tick));
    const host = new VirtualPlayer();
    await host.open(replay, { tick: 590, play: false });
    // The way to 590 itself began at the snapshot of tick 500.
    expect(host.made).toEqual([{ snapshotTick: 500 }]);
    await host.seek(450);
    expect(host.made.at(-1)).toEqual({ snapshotTick: 400 });
    expect(host.status.tick).toBe(450);
    expect(host.game.hash()).toBe(straight(replay, 450).hash());
    // A position that is a snapshot's own tick starts from the one before it, so that there is a call to draw.
    await host.seek(300);
    expect(host.made.at(-1)).toEqual({ snapshotTick: 200 });
    expect(host.game.hash()).toBe(straight(replay, 300).hash());
    await host.seek(50);
    expect(host.made.at(-1)).toEqual({ seed: 42, scenario: "bridge", config: {} });
    expect(host.game.hash()).toBe(straight(replay, 50).hash());
  });

  test("takes snapshots of its own as it goes, so that a recording with none seeks quickly the second time", async () => {
    const replay = await recordGame({}, 600);
    expect(replay.snapshots).toEqual([]);
    const host = new VirtualPlayer();
    await host.open(replay, { play: false });
    expect(host.runtime.debugState().snapshotTicks).toEqual([]);
    await host.seek(500);
    expect(host.runtime.debugState().snapshotTicks).toEqual([120, 240, 360, 480]);
    expect(host.status.snapshots).toBe(4);
    await host.seek(250);
    expect(host.made.at(-1)).toEqual({ snapshotTick: 240 });
    expect(host.game.hash()).toBe(straight(replay, 250).hash());
    await host.seek(100);
    expect(host.made.at(-1)).toEqual({ seed: 42, scenario: "bridge", config: {} });
    // Playing forward adds more, once each.
    host.runtime.handle({ type: "resume", reason: "user" });
    host.control({ op: "speed", speed: 16 });
    host.advance(10_000);
    expect(host.runtime.debugState().snapshotTicks).toEqual([120, 240, 360, 480, 600].filter((t) => t <= replay.end_tick));
  });

  test("clamps the position to the recording, and leaves a world that was let go of destroyed", async () => {
    const replay = await recordGame({}, 300);
    const host = new VirtualPlayer();
    await host.open(replay, { tick: 99_999, play: false });
    expect(host.status).toMatchObject({ tick: replay.end_tick, ended: true });
    await host.seek(0);
    expect(host.status).toMatchObject({ tick: 1, ended: false });
    await host.seek(-5);
    expect(host.status.tick).toBe(1);
    host.control({ op: "seek", tick: 1.5 });
    await flush();
    expect(host.status.tick).toBe(1);
    expect(host.games.slice(0, -1).every((g) => g.destroyed)).toBe(true);
    expect(host.game.destroyed).toBe(false);
  });

  test("yields to the worker on the way, with the progress it has made", async () => {
    const replay = await recordGame({}, 1500);
    const host = new VirtualPlayer({}, false, 100);
    await host.open(replay, { play: false });
    const before = host.posted.length;
    host.control({ op: "seek", tick: 1000 });
    await flush();
    expect(host.yields).toBeGreaterThanOrEqual(9);
    const progress = host.posted.slice(before).flatMap((m) => (m.type === "replay" ? [m.status] : []));
    const busy = progress.filter((s) => s.busy);
    expect(busy.length).toBeGreaterThanOrEqual(9);
    expect(busy.every((s) => s.progress >= 0 && s.progress < 1)).toBe(true);
    expect(busy.map((s) => s.progress)).toEqual([...busy.map((s) => s.progress)].sort((a, b) => a - b));
    expect(host.status).toMatchObject({ busy: false, progress: 1, tick: 1000 });
  });

  test("a seek that the next one overtakes lets go of the world it built, and the page sees the position that stood", async () => {
    const replay = await recordGame({}, 1500);
    const host = new VirtualPlayer({}, false, 20);
    await host.open(replay, { tick: 1000, play: false });
    expect(host.status.tick).toBe(1000);
    let overtaken = false;
    host.onYield = () => {
      if (overtaken) return;
      overtaken = true;
      host.control({ op: "seek", tick: 800 });
    };
    // Behind the world, so that it builds another to get there, starting from the snapshot of tick 480.
    host.control({ op: "seek", tick: 520 });
    await flush();
    await flush();
    expect(overtaken).toBe(true);
    expect(host.status).toMatchObject({ tick: 800, busy: false, phase: "ready" });
    expect(host.game.hash()).toBe(straight(replay, 800).hash());
    // The world it opened with, and the one the overtaken seek built, are both let go of.
    expect(host.games.map((g) => g.destroyed)).toEqual([true, true, false]);
    expect(host.made.slice(1)).toEqual([{ snapshotTick: 480 }, { snapshotTick: 720 }]);
    // The page was told of the position that stood.
    expect(host.frames().at(-1)?.tick).toBe(799);
    expect(host.frames().filter((f) => f.tick === 519)).toHaveLength(0);
  });

  test("a seek that the next one overtakes on the world's own way goes on from where it got to", async () => {
    const replay = await recordGame({}, 1500);
    const host = new VirtualPlayer({}, false, 100);
    await host.open(replay, { play: false });
    let overtaken = false;
    host.onYield = () => {
      if (overtaken) return;
      overtaken = true;
      host.control({ op: "seek", tick: 700 });
    };
    host.control({ op: "seek", tick: 1400 });
    await flush();
    await flush();
    expect(host.status).toMatchObject({ tick: 700, busy: false });
    expect(host.game.hash()).toBe(straight(replay, 700).hash());
    expect(host.games.every((g, i) => g.destroyed === (i < host.games.length - 1))).toBe(true);
  });

  test("holds the world through a pause in the recording that was let go of at once", async () => {
    // Paused by the player at tick 100 and let go again, with the world held for a while between.
    const script = { 100: [{ type: "pause" as const, reason: "user" as const }, action("held-1")], 110: [{ type: "resume" as const, reason: "user" as const }] };
    const replay = await recordGame({}, 300, script);
    const at100 = replay.records.filter((r) => r[0] === 100).map((r) => r[2]);
    expect(at100).toEqual(["pause", "player", "resume"]);
    const host = new VirtualPlayer();
    await host.open(replay, { play: false });
    await host.seek(replay.end_tick);
    expect(host.status.error).toBeNull();
    expect(host.game.hash()).toBe(replay.final.hash);
    expect(host.game.state.actions).toEqual(["held-1"]);
  });
});

test.describe("a recording that does not replay", () => {
  test("stops at the hash that differs, says where, and plays no more", async () => {
    const replay = await recordGame({}, 600, { 150: [action("a-1")] });
    const altered = clone(replay);
    const record = altered.records.find((r) => r[2] === "player");
    expect(record).toBeDefined();
    (record as unknown as [number, number, string, Record<string, unknown>])[3].action_id = "a-other";
    const host = new VirtualPlayer();
    await host.open(altered, { play: false });
    expect(host.status.phase).toBe("ready");
    await host.seek(400);
    expect(host.status).toMatchObject({ phase: "failed", busy: false, playing: false });
    expect(host.status.error).toMatchObject({ code: "hash_mismatch" });
    expect(host.status.error?.message).toContain("checkpoint hash differs at tick 200");
    const fatal = host.posted.filter((m) => m.type === "fatal");
    expect(fatal).toHaveLength(1);
    expect(fatal[0]).toMatchObject({ code: "hash_mismatch" });
    // A recording that is failed takes no seek and plays nothing.
    const frames = host.frames().length;
    await host.seek(10);
    host.runtime.handle({ type: "resume", reason: "user" });
    host.advance(2000);
    expect(host.frames()).toHaveLength(frames);
    // The same recording, unaltered, is fine.
    const fine = new VirtualPlayer();
    await fine.open(replay, { tick: 400, play: false });
    expect(fine.status).toMatchObject({ phase: "ready", tick: 400, error: null });
  });

  test("names the versions when the recording was made by another core", async () => {
    const replay = await recordGame({}, 300);
    const other = clone(replay);
    other.header.core_version = "0.9.9";
    other.header.content_hash = "feedbeef00";
    const first = other.hashes[1];
    expect(first).toBeDefined();
    (first as [number, string])[1] = "0".repeat(64);
    const host = new VirtualPlayer();
    await host.open(other, { tick: 250, play: false });
    expect(host.status.error?.code).toBe("hash_mismatch");
    expect(host.status.error?.message).toContain("recorded by core 0.9.9 / feedbeef");
    expect(host.status.error?.message).toContain("this one is fake-1 / fakehash");
  });

  test("refuses what it cannot play: a bad shape, a snapshot start, another format, no ticks", async () => {
    const replay = await recordGame({}, 200, { 50: [action("x")] });
    const cases: Array<[string, unknown, string]> = [
      ["not an object", 7, "bad_replay"],
      ["no records", { ...clone(replay), records: "none" }, "bad_replay"],
      ["from a snapshot", { ...clone(replay), base: { tick: 10, snapshot: "{}" } }, "unsupported_format"],
      ["another core format", { ...clone(replay), header: { ...replay.header, format: 2 } }, "unsupported_format"],
      ["another replay format", { ...clone(replay), host: { name: "x", version: "1", replayFormat: 9 } }, "unsupported_format"],
      ["a log that runs backwards", { ...clone(replay), records: [...replay.records, [3, 99999, "player", { action_id: "late" }]] }, "bad_log"],
      ["no ticks", { ...clone(replay), records: [], hashes: [], end_tick: 0, final: { tick: 0, hash: "" } }, "empty_replay"],
    ];
    for (const [name, value, code] of cases) {
      const host = new VirtualPlayer();
      await host.open(value, { play: false });
      expect(host.status.phase, name).toBe("failed");
      expect(host.status.error?.code, name).toBe(code);
      expect(host.posted.some((m) => m.type === "fatal"), name).toBe(true);
    }
  });

  test("ignores a snapshot that is not one and a snapshot that puts the world where it says it does not", async () => {
    const replay = await recordGame({}, 400, {}, 100);
    const odd = clone(replay);
    odd.snapshots = [[100, "not json at all"], "junk", [7], [250.5, "{}"], [9999, "{}"], ...replay.snapshots.slice(1)];
    const host = new VirtualPlayer();
    await host.open(odd, { tick: 350, play: false });
    expect(host.status).toMatchObject({ phase: "ready", tick: 350 });
    expect(host.made).toEqual([{ snapshotTick: 300 }]);
    // A snapshot that is of another tick than the recording says is refused, not played from.
    const lying = clone(replay);
    lying.snapshots = [[300, (replay.snapshots[1] as [number, string])[1]]];
    const bad = new VirtualPlayer();
    await bad.open(lying, { tick: 350, play: false });
    expect(bad.status).toMatchObject({ phase: "failed", error: { code: "bad_snapshot" } });
  });
});

test.describe("a recording is read only", () => {
  test("takes no action, no new game, no provider and no key from the page", async () => {
    const replay = await recordGame({}, 300);
    const host = new VirtualPlayer();
    await host.open(replay, { play: false });
    const calls = host.game.calls.length;
    host.runtime.handle(action("a-1"));
    host.runtime.handle({ type: "new-game", seed: 5 });
    host.runtime.handle({ type: "configure", provider: "bailian", key: "sk-not-for-here-0123456789" });
    host.runtime.handle({ type: "e2e", reqId: 1, op: "state" });
    host.advance(1000);
    expect(host.game.calls).toHaveLength(calls);
    expect(host.games).toHaveLength(1);
    expect(host.status.tick).toBe(1);
  });

  test("answers the call for the ending, says there are no saves, and refuses the rest", async () => {
    const ending = { kind: "ending", ending: "ending_full", tick: 0, label: { zh: "圆满", en: "Perfect" }, reveal: null };
    const replay = await recordGame({ ending }, 200);
    const host = new VirtualPlayer({ ending });
    host.runtime.handle({ type: "call", reqId: 1, call: { op: "ending" } });
    expect(host.posted.at(-1)).toEqual({ type: "reply", reqId: 1, ok: true, result: null });
    await host.open(replay, { play: false });
    host.runtime.handle({ type: "call", reqId: 2, call: { op: "ending" } });
    expect(host.posted.at(-1)).toEqual({ type: "reply", reqId: 2, ok: true, result: ending });
    host.runtime.handle({ type: "call", reqId: 3, call: { op: "list-saves" } });
    expect(host.posted.at(-1)).toEqual({ type: "reply", reqId: 3, ok: true, result: [] });
    for (const call of [{ op: "save" as const }, { op: "load" as const, id: 1 }, { op: "delete-save" as const, id: 1 }, { op: "export" as const }]) {
      host.runtime.handle({ type: "call", reqId: 9, call });
      expect(host.posted.at(-1)).toMatchObject({ type: "reply", reqId: 9, ok: false, error: { code: "unsupported" } });
    }
  });

  test("stops cleanly: no timer runs and the world is let go of", async () => {
    const replay = await recordGame({}, 300);
    const host = new VirtualPlayer();
    await host.open(replay);
    host.advance(500);
    const ticks = host.runtime.status().tick;
    host.runtime.stop();
    host.advance(5000);
    expect(host.game.destroyed).toBe(true);
    expect(host.runtime.debugState().position).toBe(0);
    expect(ticks).toBeGreaterThan(1);
  });
});
