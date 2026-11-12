import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { asPlayer, frameOf, loadMoment, recordFollower } from "../support/follower.ts";

// The button that skips to the next thing, on the real core. The page of the game the opening page starts loads the follower's game at a moment of
// the days after the first at which every task only waits (see days-real.spec.ts), and the world goes on from there: the button is pressed and the
// clock of the real game is read. The run is made at the pace of a skip (twelve times the common one), which the page asks the host for and writes
// down on the way, and the pace of the player is back at the end of each run. The summary of the night comes at dusk and holds the world: it ends
// a run that passes it, and the next run goes on from there. The pictures are taken when LANTERN_SHOTS_DIR names a folder.
test.use({ map: true });

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";

let shots = 0;
const picture = (name: string, tag: string): string => path.join(SHOTS, `skip-${String(++shots).padStart(2, "0")}-${name}-${tag}.png`);

/** A picture of the page as it stands: the bar, the card and the town. */
async function snap(page: Page, name: string, tag: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: picture(name, tag) });
}

/** Writes down the paces the page asks the host for, in order, and passes them on. */
async function watchPace(page: Page): Promise<void> {
  await page.evaluate(() => {
    const asked: number[] = [];
    (window as unknown as { __paces: number[] }).__paces = asked;
    const client = window.__lantern.client;
    const original = client.setPace.bind(client);
    client.setPace = (speed: number, skip = false) => {
      asked.push(speed);
      original(speed, skip);
    };
  });
}

const paces = (page: Page): Promise<number[]> => page.evaluate(() => (window as unknown as { __paces: number[] }).__paces);

/** The tick of the page's frame, and the time of the page's clock it was read at, in one call. */
const tickAt = (page: Page): Promise<{ tick: number; at: number }> => page.evaluate(() => ({ tick: window.__lantern.client.state.simTick, at: performance.now() }));

/** Waits until the world is running: the save the page loaded is held, and the player lets it go. */
async function letGo(page: Page): Promise<void> {
  await page.getByTestId("btn-pause").click();
  await page.waitForFunction(() => window.__lantern.client.state.paused === false, undefined, { timeout: 30_000 });
}

/** Holds the world with the pause button, and waits until the host says it is held. */
async function hold(page: Page): Promise<void> {
  await page.getByTestId("btn-pause").click();
  await page.waitForFunction(() => window.__lantern.client.state.paused === true, undefined, { timeout: 30_000 });
}

/** Presses the incense and waits until the run is over, whatever ended it. */
async function runOnce(page: Page, label: string): Promise<void> {
  await expect(page.getByTestId("btn-skip"), `${label}: the incense is lit`).toBeEnabled({ timeout: 30_000 });
  await page.getByTestId("btn-skip").click();
  await page.waitForFunction(() => window.__lantern.play.skip.running === false, undefined, { timeout: 600_000, polling: 250 });
}

test.describe("the button that skips to the next thing, on the real core", () => {
  test.describe("in Chinese on the light theme", () => {
    test.use({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1280, height: 760 } });

    test("skips the afternoon of the fourth day, when the lead waits for the watchman and the evening, at the pace of a skip, and the pace of the player is back", async ({ lantern }) => {
      test.setTimeout(900_000);
      const page = lantern.page;
      const recording = recordFollower(4, 12, 5);
      await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "fourth afternoon", recording);
      await letGo(page);
      const waiting = await frameOf(page);
      expect(waiting.time).toMatchObject({ day: 4 });
      // Nothing is left to do for a stretch: no task has a step now, and the button says when the next thing comes: the statement in public and
      // the table for the heads are offered for this evening, the first on which they can be had, and for no evening before it.
      expect(waiting.tasks.filter((t) => (t.state === "open" || t.state === "blocked") && t.action !== null)).toEqual([]);
      const bar = page.getByTestId("btn-skip");
      await expect(bar).toHaveAttribute("aria-label", /^快进到第四天 1[5-7]:\d\d$/);
      await snap(page, "afternoon-waits", "zh-light-1280x760");

      // The run: the page asks for the pace of a skip, and gives the player's back after it.
      await watchPace(page);
      const began = await tickAt(page);
      await runOnce(page, "to the evening");
      const reached = await tickAt(page);
      const seen = await frameOf(page);
      expect(seen.time.day).toBe(4);
      expect(seen.time.hour).toBeGreaterThanOrEqual(15);
      expect(seen.time.hour).toBeLessThanOrEqual(17);
      expect(seen.tasks.some((t) => (t.state === "open" || t.state === "blocked") && t.action !== null)).toBe(true); // something is to be done now
      expect(await paces(page)).toEqual([12, 1]);
      // The host ran the hours at the high pace: a long way of the game's clock in a short time.
      const rate = (reached.tick - began.tick) / ((reached.at - began.at) / 1000);
      const ran = `${reached.tick - began.tick} ticks in ${((reached.at - began.at) / 1000).toFixed(1)} s, ${rate.toFixed(0)} ticks a second`;
      test.info().annotations.push({ type: "pace of the run", description: ran });
      console.log(`skip: pace of the run: ${ran}`);
      await snap(page, "evening-comes", "zh-light-1280x760");

      // The pace is the player's own again: the clock goes on at its pace, which is slower than the run's. The host owes the game time that it was asked for and could not run (at most two
      // seconds of the player's pace, which is all its clock keeps), and works it off as fast as the machine goes when the pace comes back: a window that begins at the end of the run
      // measures that and not the pace, and on two cores the machine goes no faster than it did in the run. The player's pause owes nothing, so the pace is read after the world has been
      // held and let go.
      await hold(page);
      await letGo(page);
      const slow0 = await tickAt(page);
      await page.waitForTimeout(3000);
      const slow1 = await tickAt(page);
      const after = (slow1.tick - slow0.tick) / ((slow1.at - slow0.at) / 1000);
      test.info().annotations.push({ type: "pace after the run", description: `${after.toFixed(0)} ticks a second` });
      console.log(`skip: pace after the run: ${after.toFixed(0)} ticks a second (the test build runs the common pace at 30)`);
      expect(after).toBeLessThan(rate);
      expect(lantern.pageErrors).toEqual([]);
    });

    test("is ended at dusk by the summary of the night, which holds the world, and goes on from there to the next morning's first step", async ({ lantern }) => {
      test.setTimeout(900_000);
      const page = lantern.page;
      const recording = recordFollower(3, 17, 50);
      await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "third evening", recording);
      await asPlayer(page); // the help is on, and a card of it holds the world
      await letGo(page);
      await expect(page.getByTestId("btn-skip")).toHaveAttribute("aria-label", /^快进到第四天 0[5-6]:\d\d$/);
      await watchPace(page);
      // The first run passes the evening and ends at dusk, where the summary of the night comes up and holds the world.
      await runOnce(page, "to dusk");
      await expect(page.getByTestId("night")).toBeVisible();
      expect(await page.evaluate(() => window.__lantern.play.skip.ended)).toBe("held");
      // The page asks the host to hold the world under the card, and the host says so with its next state. The frames the host had made at the
      // pace of the skip before it heard are still on the way, so the clock may read a little past the hour the card came at.
      await page.waitForFunction(() => window.__lantern.client.state.paused === true, undefined, { timeout: 10_000 });
      expect(await page.evaluate(() => window.__lantern.play.hold.active)).toBe(true);
      await page.waitForTimeout(500);
      const dusk = await frameOf(page);
      expect(dusk.time.day).toBe(3);
      expect(dusk.time.hour).toBeGreaterThanOrEqual(21);
      expect(dusk.time.hour).toBeLessThanOrEqual(22);
      const held = await tickAt(page);
      await page.waitForTimeout(1500);
      expect((await tickAt(page)).tick).toBe(held.tick);
      await snap(page, "dusk-holds", "zh-light-1280x760");
      await page.getByTestId("night-done").click();
      await expect(page.getByTestId("night")).toHaveCount(0);
      // The second run goes through the night to the first step of the next day.
      await runOnce(page, "to the morning");
      const morning = await frameOf(page);
      expect(morning.time.day).toBe(4);
      expect(morning.time.hour).toBeLessThanOrEqual(7);
      expect(await paces(page)).toEqual([12, 1, 12, 1]);
      expect(lantern.pageErrors).toEqual([]);
    });
  });

});
