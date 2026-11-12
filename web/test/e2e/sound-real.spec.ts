import type { Page } from "@playwright/test";
import { rainOf } from "../../src/page/audio/plan.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { clockOf, startGame, waitForClock } from "../support/real.ts";

// The sound of the game, on the real core: from the opening page to the first evening with the sound on, with no error of the page, and
// the sound reading the game and nothing more (a game played with the sound on and one played with it off are the same game).
test.use({ map: true });

interface Heard {
  /** What the last mix was made from. */
  input: { hour: number; minute: number; weather: string } | null;
  begun: boolean;
  on: boolean;
  duck: number;
  stillness: string;
  mix: Record<string, { level: number; pan: number }>;
  engine: { started: boolean; state: string; time: number; festival: boolean; cues: number; volumes: { master: number; ambience: number; music: number; effects: number } };
}

const heard = (page: Page): Promise<Heard> => page.evaluate(() => window.__lantern.sound?.snapshot() as never);

/** What the page said that is about sound or about the audio of the browser, which would be a fault of it. */
const audioTrouble = (lantern: LanternPage): string[] => lantern.consoleLines.filter((line) => /audio|sound/i.test(line) && /(error|warn)/i.test(line.split("]")[0] ?? ""));

test.describe("the sound of the first day", () => {
  test("is made on the first press of Start and not before, and goes with the hours of the first day to the evening without a fault", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await page.goto(`${lantern.servers.app.origin}/?pace=10`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });

    // The opening page: the soundscape is there, but nothing has been pressed and nothing is made.
    const before = await heard(page);
    expect(before).toMatchObject({ begun: false, on: true });
    expect(before.engine.started).toBe(false);
    expect(await page.evaluate(() => typeof (window as unknown as { AudioContext?: unknown }).AudioContext)).toBe("function");

    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect.poll(async () => (await heard(page)).engine.started, { timeout: 10_000 }).toBe(true);
    const started = await heard(page);
    expect(started.begun).toBe(true);
    expect(started.engine.volumes.master).toBe(1);
    // A press of Start lets the browser play: the context runs, and its clock goes on.
    await expect.poll(async () => (await heard(page)).engine.state, { timeout: 10_000 }).toBe("running");
    const first = (await heard(page)).engine.time;
    await expect.poll(async () => (await heard(page)).engine.time, { timeout: 10_000 }).toBeGreaterThan(first);

    // The first morning begins in the early hours. By seven the river runs, no insect is out, and the birds sing unless it rains, which
    // covers them (the first game of the page has a light rain that morning).
    expect((await clockOf(page)).minutes).toBeLessThan(8 * 60);
    await waitForClock(page, 7, 0, 1, 120_000);
    const morning = await heard(page);
    const rain = rainOf(morning.input?.weather ?? "clear");
    expect(morning.mix.river?.level).toBeGreaterThan(0.2);
    expect(morning.mix.rain?.level).toBe(rain);
    if (rain === 0) expect(morning.mix.birds?.level).toBeGreaterThan(0.9);
    else expect(morning.mix.birds?.level).toBeLessThan(0.2);
    expect(morning.mix.insects?.level).toBe(0);
    expect(morning.duck).toBe(1);

    // Noon: the market is heard, and the birds are gone.
    await waitForClock(page, 12, 0, 1, 120_000);
    const noon = await heard(page);
    expect(noon.mix.birds?.level).toBe(0);
    expect(noon.mix.insects?.level).toBe(0);
    expect(noon.mix.market?.level).toBeGreaterThan(0);

    // The first evening: the insects have come (fewer in the rain), and the market is gone.
    await waitForClock(page, 20, 0, 1, 120_000);
    const evening = await heard(page);
    expect(evening.mix.insects?.level).toBeGreaterThan(0.2);
    expect(evening.mix.insects?.level).toBeCloseTo(1 - 0.8 * rainOf(evening.input?.weather ?? "clear"), 5);
    expect(evening.mix.market?.level).toBe(0);
    expect(evening.mix.birds?.level).toBe(0);
    expect(evening.engine.state).toBe("running");

    expect(lantern.pageErrors).toEqual([]);
    expect(audioTrouble(lantern)).toEqual([]);
    expect((await lantern.snapshot()).error).toBeNull();
    expect((await lantern.snapshot()).cspViolations).toEqual([]);
  });

  test("has its controls in the menu: a switch and three volumes that are remembered, and the sound goes quiet with the switch", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await startGame(lantern, "pace=10");
    await expect.poll(async () => (await heard(page)).engine.started, { timeout: 10_000 }).toBe(true);

    await page.getByTestId("btn-menu").click();
    const section = page.getByTestId("menu-sound");
    await expect(section).toBeVisible();
    await expect(section.getByTestId("sound-switch").locator("input")).toBeChecked();
    for (const id of ["ambience", "music", "effects"]) await expect(section.getByTestId(`sound-${id}`).locator("input[type=range]")).toHaveValue("70");

    // A volume moved takes hold at once and is remembered.
    await section.getByTestId("sound-music").locator("input[type=range]").fill("30");
    await expect.poll(async () => (await heard(page)).engine.volumes.music, { timeout: 5000 }).toBeCloseTo(0.09, 3);
    expect(await page.evaluate(() => localStorage.getItem("lantern.sound.music"))).toBe("30");

    // The switch: the master goes to nothing, and it is remembered.
    await section.getByTestId("sound-switch").locator("input").uncheck();
    await expect.poll(async () => (await heard(page)).engine.volumes.master, { timeout: 5000 }).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("lantern.sound"))).toBe("off");
    await expect(section.getByTestId("sound-ambience").locator("input[type=range]")).toBeEnabled();
    await section.getByTestId("sound-switch").locator("input").check();
    await expect.poll(async () => (await heard(page)).engine.volumes.master, { timeout: 5000 }).toBe(1);

    // The words are in both languages.
    await expect(section.getByRole("heading")).toHaveText("Sound");
    await lantern.setLang("zh");
    await expect(section.getByRole("heading")).toHaveText("声音");
    await expect(section.getByTestId("sound-switch")).toContainText("打开声音");
    await lantern.setLang("en");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not made for a viewer who has switched it off, and is made when the switch is turned on", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await page.addInitScript(() => {
      localStorage.setItem("lantern.sound", "off");
      localStorage.setItem("lantern.tutorial", "skipped");
    });
    await page.goto(`${lantern.servers.app.origin}/?pace=10`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await page.waitForTimeout(1500);
    const off = await heard(page);
    expect(off).toMatchObject({ begun: true, on: false });
    expect(off.engine.started).toBe(false);
    await page.getByTestId("btn-menu").click();
    await page.getByTestId("menu-sound").getByTestId("sound-switch").locator("input").check();
    await expect.poll(async () => (await heard(page)).engine.started, { timeout: 10_000 }).toBe(true);
    await expect.poll(async () => (await heard(page)).engine.state, { timeout: 10_000 }).toBe("running");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is quiet while the player has paused the world, and fades back when it runs", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await startGame(lantern, "pace=10");
    await expect.poll(async () => (await heard(page)).engine.volumes.ambience, { timeout: 10_000 }).toBeGreaterThan(0.3);
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect.poll(async () => (await heard(page)).engine.volumes.ambience, { timeout: 5000 }).toBe(0);
    expect((await heard(page)).stillness).toBe("player");
    // The music and the effects are the player's own volumes, and stay.
    expect((await heard(page)).engine.volumes.effects).toBeGreaterThan(0.3);
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect.poll(async () => (await heard(page)).engine.volumes.ambience, { timeout: 5000 }).toBeGreaterThan(0.3);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("plays the festival's music when the show asks, follows how far the procession is, and stops when the show does", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await startGame(lantern, "pace=10");
    await expect.poll(async () => (await heard(page)).engine.state, { timeout: 10_000 }).toBe("running");
    // The world is paused at once, so that no card of the game comes up during the test. The festival's music is not the world's: it plays
    // on a world the player has paused, as it does under the show.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect.poll(async () => (await heard(page)).engine.volumes.ambience, { timeout: 5000 }).toBe(0);
    // The show asks for the music while the procession is far off, and then the procession comes nearer. The strikes and the strings are
    // made a moment ahead of the clock of the audio.
    await page.evaluate(() => {
      window.__lantern.festivalSound?.setDistance(40, -1);
      window.__lantern.festivalSound?.start();
    });
    await expect.poll(async () => (await heard(page)).engine.festival, { timeout: 5000 }).toBe(true);
    const began = (await heard(page)).engine.time;
    await expect.poll(async () => (await heard(page)).engine.time, { timeout: 15_000 }).toBeGreaterThan(began + 3);
    await page.evaluate(() => window.__lantern.festivalSound?.setDistance(2, 0));
    const near = (await heard(page)).engine.time;
    await expect.poll(async () => (await heard(page)).engine.time, { timeout: 15_000 }).toBeGreaterThan(near + 3);
    expect((await heard(page)).engine.festival).toBe(true);
    expect((await heard(page)).engine.volumes.music).toBeGreaterThan(0.3);
    await page.evaluate(() => window.__lantern.festivalSound?.stop());
    await expect.poll(async () => (await heard(page)).engine.festival, { timeout: 5000 }).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
    expect(audioTrouble(lantern)).toEqual([]);
  });

  test("has a small sound for a leaf turned and for a word of ink, once for each press", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await startGame(lantern, "pace=10");
    await expect.poll(async () => (await heard(page)).engine.state, { timeout: 10_000 }).toBe("running");
    const before = (await heard(page)).engine.cues;
    await page.getByTestId("btn-notebook").click();
    await expect.poll(async () => (await heard(page)).engine.cues, { timeout: 5000 }).toBe(before + 1);
    await page.getByTestId("btn-notebook").click();
    await expect.poll(async () => (await heard(page)).engine.cues, { timeout: 5000 }).toBe(before + 2);
    // Nothing else that is pressed has a sound: the pause and the menu are not words of ink.
    await page.getByTestId("btn-pause").click();
    await page.getByTestId("btn-pause").click();
    await page.waitForTimeout(400);
    expect((await heard(page)).engine.cues).toBe(before + 2);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("reads the game and sends it nothing: a game with the sound on and the same game with it off have the same inputs and the same hashes", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    const UNTIL = 360;
    // The page tells the core that it watches the moments, and the id of that action is made from a random prefix of the page's session. The core keeps the ids it has
    // seen, so two sessions never have the same state unless the prefix is the same: the numbers of the page are made to come in the same order in both.
    await page.addInitScript(() => {
      let state = 0x2545f491;
      Math.random = () => {
        state = (state + 0x6d2b79f5) | 0;
        let t = Math.imul(state ^ (state >>> 15), 1 | state);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    });
    const play = async (soundOn: boolean): Promise<{ records: unknown[]; hash: string | null; tick: number | null }> => {
      await page.addInitScript((on) => {
        localStorage.setItem("lantern.tutorial", "skipped");
        localStorage.setItem("lantern.sound", on ? "on" : "off");
      }, soundOn);
      await page.goto(`${lantern.servers.app.origin}/?pace=60&until=${UNTIL}`);
      await lantern.waitReady();
      await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
      await page.getByTestId("opening-start").click();
      await lantern.waitForTick(UNTIL, 120_000);
      await expect(page.getByTestId("status")).toHaveText("paused");
      const snap = await lantern.snapshot();
      const replay = await lantern.exportReplay();
      return { records: replay.records, hash: snap.hash, tick: snap.hashTick };
    };
    const on = await play(true);
    expect((await heard(page)).engine.started).toBe(true);
    const off = await play(false);
    expect((await heard(page)).engine.started).toBe(false);
    expect(on.tick).toBe(off.tick);
    expect(on.hash).not.toBeNull();
    expect(on.hash).toBe(off.hash);
    expect(on.records).toEqual(off.records);
    expect(lantern.pageErrors).toEqual([]);
  });
});
