import { expect, test } from "../support/fixtures.ts";

// A world at rate 1 and pace 1 takes one tick for each tenth of a second. The tests count ticks
// against the clock of the page, because the machine that runs them may be slow: what they ask is
// that the world kept to the time that really passed, not that a second held ten ticks on a fast one.
const ticksIn = (ms: number): number => Math.ceil(ms / 100);

test.describe("page lifecycle", () => {
  test("hidden means no ticks, visible resumes with no backlog, and both are recorded", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=1&seed=11");
    await lantern.waitForTick(10);

    await lantern.setVisibility("hidden");
    // The host names the reason in the statistics that it sends with the pause, and they count the call that held the world.
    await expect.poll(async () => (await lantern.snapshot()).stats?.reasons).toEqual(["hidden"]);
    await expect.poll(async () => (await lantern.snapshot()).paused).toBe(true);
    const at = await lantern.tick();
    const calls = (await lantern.snapshot()).stats?.calls ?? 0;
    await page.waitForTimeout(3000);
    expect(await lantern.tick()).toBe(at);
    const hidden = await lantern.snapshot();
    expect(hidden.stats?.reasons).toEqual(["hidden"]);
    expect(hidden.stats?.calls).toBe(calls);
    await expect(page.getByTestId("status")).toHaveText("paused");

    const shown = await lantern.setVisibility("visible");
    await expect.poll(async () => (await lantern.snapshot()).paused).toBe(false);
    // The three seconds that passed while hidden are not owed. The world took one tick at the
    // resume and went on at its own speed: a tick for each tenth of a second since the page was shown.
    const resumed = await lantern.tickAt();
    expect(resumed.tick - at).toBeLessThanOrEqual(ticksIn(resumed.at - shown) + 2);
    await page.waitForTimeout(1000);
    const later = await lantern.tickAt();
    const seconds = (later.at - resumed.at) / 1000;
    expect(later.tick - resumed.tick).toBeGreaterThanOrEqual(Math.floor(seconds * 10) - 2);
    expect(later.tick - resumed.tick).toBeLessThanOrEqual(Math.ceil(seconds * 10) + 2);
    expect((await lantern.snapshot()).stats?.droppedMs).toBe(0);

    const replay = await lantern.exportReplay();
    expect(replay.records.filter((r) => r[2] !== "model_result").map((r) => [r[2], r[0]])).toEqual([
      ["pause", at],
      ["resume", at],
    ]);
  });

  test("a page that opens hidden does not start the world until it is shown", async ({ lantern }) => {
    await lantern.page.addInitScript(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    });
    await lantern.open("pace=1&seed=12");
    await lantern.page.waitForTimeout(1500);
    expect(await lantern.tick()).toBe(0);
    expect((await lantern.snapshot()).paused).toBe(true);
    await lantern.setVisibility("visible");
    await lantern.waitForTick(5);
    const replay = await lantern.exportReplay();
    expect(replay.records.map((r) => [r[2], r[0]])).toEqual([
      ["pause", 0],
      ["resume", 0],
    ]);
  });

  test("the pause button holds the world, and showing the page does not undo it", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=1&seed=13");
    await lantern.waitForTick(5);
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    const at = await lantern.tick();

    await lantern.setVisibility("hidden");
    await lantern.setVisibility("visible");
    await page.waitForTimeout(1200);
    expect(await lantern.tick()).toBe(at);
    expect((await lantern.snapshot()).stats?.reasons).toEqual(["user"]);
    await expect(page.getByTestId("btn-pause")).toHaveText("Resume");

    await page.getByTestId("btn-pause").click();
    await lantern.waitForTick(at + 5);
    await expect(page.getByTestId("status")).toHaveText("running");
    const replay = await lantern.exportReplay();
    expect(replay.records.map((r) => r[2])).toEqual(["pause", "resume"]);
  });

  test("a blocked worker catches up by the time it lost, not by how often its timer fired", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=1&seed=14");
    await lantern.waitForTick(5);
    const start = await lantern.tickAt();
    // The worker is busy for 1.2 s, as a throttled or overloaded thread would be. Its timer fires
    // once, late, and finds twelve ticks due.
    await lantern.e2e("stall", { ms: 1200 });
    await lantern.waitForTick(start.tick + 12);
    const caught = await lantern.tickAt();
    expect(caught.tick - start.tick).toBeGreaterThanOrEqual(12);
    expect(caught.tick - start.tick).toBeLessThanOrEqual(ticksIn(caught.at - start.at) + 3);
    expect((await lantern.snapshot()).stats?.droppedMs).toBe(0);
    await page.waitForTimeout(1000);
    const after = await lantern.tickAt();
    const seconds = (after.at - caught.at) / 1000;
    expect(after.tick - caught.tick).toBeGreaterThanOrEqual(Math.floor(seconds * 10) - 2);
    expect(after.tick - caught.tick).toBeLessThanOrEqual(Math.ceil(seconds * 10) + 2);
  });

  test("timers that fire once a second, as in a background tab, still give ten ticks a second", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=1&seed=17");
    await lantern.waitForTick(5);
    await lantern.e2e("throttle", { minDelayMs: 1000 });
    // The next timer was set before the throttle and fires on time. From the one after it, the host runs once a second.
    await page.waitForTimeout(1200);
    const start = await lantern.tickAt();
    await page.waitForTimeout(6000);
    const end = await lantern.tickAt();
    const gained = end.tick - start.tick;
    const seconds = (end.at - start.at) / 1000;
    // Ten ticks a second of real time, in bursts of ten. The last burst may not have fallen due yet.
    expect(gained).toBeGreaterThanOrEqual(Math.floor(seconds * 10) - 11);
    expect(gained).toBeLessThanOrEqual(Math.ceil(seconds * 10) + 2);
    expect((await lantern.snapshot()).stats?.droppedMs).toBe(0);
  });

  test("timers slower than the two-second cap lose game time, which is the price of not building a backlog", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=1&seed=18");
    await lantern.waitForTick(5);
    await lantern.e2e("throttle", { minDelayMs: 3000 });
    await page.waitForTimeout(3300);
    const start = await lantern.tickAt();
    await page.waitForTimeout(9000);
    const end = await lantern.tickAt();
    const gained = end.tick - start.tick;
    // The host runs once in three seconds and each pass adds at most two seconds of game time, so at
    // most 20 ticks a pass: about three passes in nine seconds.
    const passes = (end.at - start.at) / 3000;
    expect(gained).toBeLessThanOrEqual(20 * Math.ceil(passes) + 5);
    expect(gained).toBeGreaterThanOrEqual(10 * Math.floor(passes));
    expect((await lantern.snapshot()).stats?.droppedMs).toBeGreaterThan(1000);
  });

  test("a stall beyond two seconds is not caught up in full", async ({ lantern }) => {
    const page = lantern.page;
    await lantern.open("pace=1&seed=15");
    await lantern.waitForTick(5);
    const start = await lantern.tickAt();
    await lantern.e2e("stall", { ms: 5000 });
    await lantern.waitForTick(start.tick + 20);
    await page.waitForTimeout(500);
    const end = await lantern.tickAt();
    // Two seconds of game time, which is all that one update adds, and then a tick for each tenth of a
    // second after the stall ended. Not the fifty ticks the stall lasted.
    expect(end.tick - start.tick).toBeLessThanOrEqual(20 + ticksIn(end.at - start.at - 5000) + 2);
    const stats = (await lantern.snapshot()).stats;
    expect(stats?.droppedMs).toBeGreaterThan(2500);
  });

  test("a worker that cannot keep up drops time rather than freezing, and a pause still goes through", async ({ lantern }) => {
    const page = lantern.page;
    // 50,000 ticks a second is more than Game.step can give, as on a machine that is far too slow.
    await lantern.open("pace=5000&seed=16");
    await page.waitForTimeout(3500);
    const loaded = await lantern.snapshot();
    expect(loaded.simTick).toBeGreaterThan(1000);
    expect(loaded.stats?.droppedMs).toBeGreaterThan(0);
    expect(loaded.error).toBeNull();

    // The pause goes through although the worker has no time to spare. The time is the page's own,
    // from the click to the word on the screen: a click from the test first checks that the button can
    // be pressed, and that takes as long as the machine is slow, whatever the worker does.
    await lantern.watchPause();
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    expect(await lantern.pauseTime()).toBeLessThan(1500);
    const at = await lantern.tick();
    await page.waitForTimeout(600);
    expect(await lantern.tick()).toBe(at);
  });
});
