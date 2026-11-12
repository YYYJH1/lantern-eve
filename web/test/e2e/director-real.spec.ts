import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, type LanternPage, replayInCpython, test } from "../support/fixtures.ts";
import { steady } from "../support/steady.ts";

// A moment of the festival on the real core in the browser host. The page says that it watches, the core holds the world when the first lantern is on
// the second bank of the river, the show plays over the map while the tick stands still, and the page lets the world go with a player action that the
// recording keeps. CPython then plays the recording again and comes to the same hashes: the hold, the pause of the show and the release are all in it.
test.use({ map: true });

/** Where the pictures go, when a folder is named. */
const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";

const director = (page: Page) => page.getByTestId("director");
const tick = (page: Page): Promise<number> => page.evaluate(() => window.__lantern.client.state.simTick);
const frameOf = (page: Page) =>
  page.evaluate(() => {
    const frame = window.__lantern.client.state.frame as unknown as { moments?: Array<{ kind: string }>; moment_hold?: string[] } | null;
    return { moments: frame?.moments ?? null, hold: frame?.moment_hold ?? null };
  });

/** A town of the bridge game with the test actions on and the show controller on, once the map is up and the page has said that it watches the moments. */
async function opened(lantern: LanternPage): Promise<void> {
  const page = lantern.page;
  await lantern.open("scenario=bridge&seed=7&pace=3&config=dev_actions:1&director=on", { menu: false });
  await page.waitForFunction(() => window.__lantern.play.director.port !== null, undefined, { timeout: 120_000 });
  await lantern.waitForTick(60);
  // The controller said, in its first call after the map came up, that it watches the moments: the frames of the game have the keys now.
  await expect.poll(async () => (await frameOf(page)).moments, { timeout: 30_000 }).toEqual([]);
  expect((await frameOf(page)).hold).toEqual([]);
}

/** A promise of a household to light a lantern, by the test action of the game. */
const promise = (page: Page, npc: string) => page.evaluate((who) => window.__lantern.client.player({ type: "dev_goal", op: "join", npc: who }), npc);

test.describe("a moment of the festival, on the real core", () => {
  test("the world is held at the first lantern on the second bank while the show plays, and the recording of it plays again in CPython to the same hashes", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await opened(lantern);

    // A promise in the house of the Li, on the west bank, and one in the teahouse, on the east bank.
    await promise(page, "li_da");
    await page.waitForTimeout(300);
    expect((await frameOf(page)).moments).toEqual([]);
    await promise(page, "cha_laoban");
    await expect(director(page)).toHaveAttribute("data-show", "both_banks", { timeout: 60_000 });
    await expect(page.getByTestId("director-caption")).toHaveText("Lanterns hang on both banks.");
    const held = await frameOf(page);
    expect(held.moments).toEqual([expect.objectContaining({ kind: "both_banks", place: "p_bridge", x: 27, y: 15 })]);
    expect(held.hold).toEqual(["both_banks"]);

    // The world stands still while the words are over the map: no tick for most of a second, whatever the host would do.
    const at = await tick(page);
    await page.waitForTimeout(700);
    expect(await tick(page)).toBe(at);
    await expect(director(page)).toHaveAttribute("data-show", "both_banks");

    // A click on the map goes on. The core is told to, in a player action, and the world runs again.
    await page.getByTestId("director-veil").click();
    await expect(director(page)).toHaveCount(0);
    await expect.poll(async () => (await frameOf(page)).hold, { timeout: 30_000 }).toEqual([]);
    await expect.poll(() => tick(page), { timeout: 60_000 }).toBeGreaterThan(at + 250);
    expect((await frameOf(page)).moments).toEqual([expect.objectContaining({ kind: "both_banks" })]);
    await expect(director(page)).toHaveCount(0);

    // The recording has the page's two actions, and the core in CPython comes to every hash of the browser's.
    await page.evaluate(() => window.__lantern.client.pause());
    await expect(page.getByTestId("status")).toHaveText("paused");
    const replay = await lantern.exportReplay();
    const moment = replay.records.filter((record) => record[2] === "player" && record[3].type === "moment");
    expect(moment.map((record) => record[3].op)).toEqual(["watch", "release"]);
    expect(moment.map((record) => record[3].kind)).toEqual([undefined, "both_banks"]);
    expect(replay.hashes.some(([hashTick]) => hashTick > at)).toBe(true);
    const cpython = replayInCpython(replay, "director-real");
    expect(cpython.error).toBeUndefined();
    expect(cpython).toMatchObject({ ok: true, final_tick: replay.final.tick, final_hash: replay.final.hash, checkpoints_checked: replay.hashes.length, mismatches: [], checkpoints_missing: [] });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("pictures", () => {
  test.skip(SHOTS === "", "pictures are taken when LANTERN_SHOTS_DIR names a folder");

  for (const [lang, theme] of [
    ["zh", "light"],
    ["en", "dark"],
  ] as const) {
    test(`the first lantern on the second bank, on the real core, ${lang} ${theme}`, async ({ lantern }) => {
      test.setTimeout(300_000);
      const page = lantern.page;
      await page.setViewportSize({ width: 1280, height: 760 });
      await opened(lantern);
      await lantern.setLang(lang);
      await lantern.setTheme(theme);
      mkdirSync(SHOTS, { recursive: true });
      await promise(page, "li_da");
      await promise(page, "cha_laoban");
      await expect(director(page)).toHaveAttribute("data-show", "both_banks", { timeout: 60_000 });
      await page.waitForTimeout(1400);
      await steady(page);
      await page.screenshot({ path: path.join(SHOTS, `after-moment-real-both_banks-${lang}-${theme}-1280x760.png`) });
      await page.getByTestId("director-veil").click();
      await expect(director(page)).toHaveCount(0);
    });
  }
});
