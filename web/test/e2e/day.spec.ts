import type { Replay } from "../../src/shared/protocol.ts";
import { expect, type LanternPage, replayInCpython, test } from "../support/fixtures.ts";

const DAY = 1800;
// The one player action the contract documents (core/lantern_core/api.py): the NPC walks to the cell.
const SUMMON = { type: "summon", npc: "npc03", x: 31, y: 10 };

/** The replay as the page offers it for download, the way a player would get it. */
async function downloadReplay(lantern: LanternPage): Promise<Replay> {
  return JSON.parse(await lantern.downloadExport()) as Replay;
}

test("a full game day of 1,800 ticks, exported from the page and replayed in CPython to the same hashes", async ({ lantern }, testInfo) => {
  test.setTimeout(180_000);
  const page = lantern.page;
  // pace only multiplies real time: 1,800 ticks at rate 1/1 take three minutes, so the test runs
  // them thirty times faster. `until` makes the host pause, as a player would, once the day is done.
  await lantern.open(`pace=30&seed=20261101&until=${DAY}`);
  const startedAt = Date.now();

  // Inputs of every kind along the way: a player action, a pause held for real time with an
  // action sent during it, and the first action sent again, as a client does after a reconnect.
  await lantern.waitForTick(200);
  await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "day-1" });
  await lantern.waitForTick(500);
  await expect(page.getByTestId("btn-pause")).toHaveText("Pause");
  await page.getByTestId("btn-pause").click();
  await expect(page.getByTestId("status")).toHaveText("paused");
  await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "day-2" });
  const heldAt = await lantern.tick();
  await page.waitForTimeout(400);
  expect(await lantern.tick()).toBe(heldAt);
  await expect(page.getByTestId("btn-pause")).toHaveText("Resume");
  await page.getByTestId("btn-pause").click();
  await lantern.waitForTick(900);
  await page.evaluate((body) => window.__lantern.client.player(body), { ...SUMMON, action_id: "day-1" });

  await lantern.waitForTick(DAY);
  await expect(page.getByTestId("status")).toHaveText("paused");
  await expect.poll(async () => (await lantern.snapshot()).stats?.models.inflight).toBe(0);
  const realMs = Date.now() - startedAt;

  const snap = await lantern.snapshot();
  expect(snap.error).toBeNull();
  expect(snap.simTick).toBe(DAY);
  expect(await page.getByTestId("tick").textContent()).toBe(String(DAY));
  expect(snap.hashTick).toBe(1700);
  expect(snap.npcCount).toBeGreaterThan(0);

  const replay = await downloadReplay(lantern);
  expect(replay).toEqual(await lantern.exportReplay());

  // The log: numbered in order of receipt without gaps, with the tick of the call that applied each.
  expect(replay.header).toMatchObject({ format: 1, seed: 20261101, scenario: "m0", core_version: snap.ready?.coreVersion });
  expect(replay.host).toMatchObject({ name: "browser", replayFormat: 1 });
  expect(replay.base).toBeNull();
  expect(replay.records.map((r) => r[1])).toEqual(replay.records.map((_, n) => n));
  for (let n = 1; n < replay.records.length; n++) {
    expect(replay.records[n]?.[0]).toBeGreaterThanOrEqual(replay.records[n - 1]?.[0] ?? 0);
  }
  const own = replay.records.filter((r) => r[2] !== "model_result");
  expect(own.map((r) => r[2])).toEqual(["player", "pause", "player", "resume", "player", "pause"]);
  expect(own.filter((r) => r[2] === "pause").map((r) => r[0])).toEqual([expect.any(Number), DAY]);
  expect(own.filter((r) => r[0] === heldAt).map((r) => r[2])).toContain("player");
  expect(replay.end_tick).toBe(DAY);
  expect(replay.final.tick).toBe(DAY);
  // A hash for every hundred ticks that were simulated.
  const hashTicks = replay.hashes.map((h) => h[0]);
  for (let t = 100; t < DAY; t += 100) expect(hashTicks).toContain(t);

  // Every request the core made got exactly one result, whatever the transport did with it.
  const results = replay.records.filter((r) => r[2] === "model_result").map((r) => String(r[3].request_id));
  expect(new Set(results).size).toBe(results.length);
  await expect.poll(async () => (await lantern.snapshot()).stats?.models.started).toBe(results.length);

  // The browser's hashes are CPython's hashes for the same tape.
  const cpython = replayInCpython(replay, "day");
  expect(cpython.error).toBeUndefined();
  expect(cpython).toMatchObject({ ok: true, final_tick: DAY, final_hash: replay.final.hash, checkpoints_checked: replay.hashes.length, mismatches: [], checkpoints_missing: [] });

  const stats = snap.stats;
  expect(stats).not.toBeNull();
  if (stats === null) return;
  console.log(
    [
      `day: ${DAY} ticks in ${realMs} ms of real time at pace 30, ${stats.calls} Game.step calls, ${replay.records.length} logged inputs`,
      `  ms per tick in the browser: Game.step ${stats.pyMeanMs.toFixed(2)} mean, ${stats.pyP95Ms.toFixed(2)} p95, ${stats.pyMaxMs.toFixed(2)} max; whole host call ${stats.hostMeanMs.toFixed(2)} mean, ${stats.hostMaxMs.toFixed(2)} max`,
      `  dropped game time: ${stats.droppedMs} ms; model requests: ${stats.models.started}; CPython replay: ${cpython.calls} calls, ${cpython.checkpoints_checked} hashes checked, ${cpython.requests_emitted} requests emitted`,
    ].join("\n"),
  );
  await testInfo.attach("day-stats", { body: JSON.stringify({ stats, realMs }, null, 2), contentType: "application/json" });
  expect(stats.pyP95Ms).toBeLessThan(20);
});

test("the pace changes how fast the world runs and nothing it does", async ({ lantern, servers, browser }) => {
  test.setTimeout(120_000);
  const run = async (pace: number): Promise<Replay> => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const own = new (lantern.constructor as new (p: typeof page, s: typeof servers) => LanternPage)(page, servers);
    await own.open(`pace=${pace}&seed=555&until=400`);
    await own.waitForTick(400);
    await expect(page.getByTestId("status")).toHaveText("paused");
    const replay = await own.exportReplay();
    await context.close();
    return replay;
  };
  // Without a model every request is answered at once by the host, so the whole session is a
  // function of the seed and the inputs, and the pace cannot show in it.
  const slow = await run(8);
  const fast = await run(40);
  expect(slow.end_tick).toBe(400);
  expect(slow.final).toEqual(fast.final);
  expect(slow.hashes).toEqual(fast.hashes);
  expect(slow.records).toEqual(fast.records);
});
