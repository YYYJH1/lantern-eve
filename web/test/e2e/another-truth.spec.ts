import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, replayInCpython, test } from "../support/fixtures.ts";
import { putSave, type Recording, recordFollower } from "../support/follower.ts";
import { fitsWidth } from "../support/slice.ts";

// A new game is a case of its own. The opening page starts the first game (seed 492, the boatman as the truth) and keeps its Start for it.
// Every game after it, from the menu or from the ending, is the same rules at a seed and with a story true that the page picks at
// random and does not say, and once a game has been played to its end the opening page offers the same: "Another truth". The game that
// reached its end here is the follower's, made by the core under CPython and loaded as a save, so that the ending is the real one.

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";
const RULES = { opening: "op_li_er_hearsay", weather_heavy: 0, goods: "promised" };
const STORIES = ["v_boat", "v_flood", "v_drunk"];
// The page of a player: no game named in the address, so the opening page and the slice held behind it. The tutorial is put away, since
// it holds the world under a card and these tests are about what comes before and after it.
const OPENING = "pace=60&map=off";

type Lantern = import("../support/fixtures.ts").LanternPage;

let ended: Recording;
test.beforeAll(() => {
  // the ending comes at 21:02 of the fifth day: this is a moment just after it
  ended = recordFollower(5, 21, 3);
});

async function openPage(lantern: Lantern, query = OPENING): Promise<void> {
  await lantern.page.addInitScript(() => {
    if (localStorage.getItem("lantern.tutorial") === null) localStorage.setItem("lantern.tutorial", "skipped");
  });
  await lantern.page.goto(`${lantern.servers.app.origin}/?${query}`);
  await lantern.waitReady();
  await expect(lantern.page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
}

interface Case {
  seed: number;
  variant: string;
  config: Record<string, unknown>;
}

/** The game that is running, as its recording says it: the seed, the story that is true in it, and the rest of its config. */
async function caseOf(page: Page): Promise<Case> {
  const header = await page.evaluate(async () => (await window.__lantern.client.exportReplay()).header);
  return { seed: header.seed, variant: String(header.config.variant), config: header.config };
}

/** Lets the world run a while and puts the game under CPython: the record of a case of its own plays again to the same hashes. */
async function replaysUnderCpython(page: Page, label: string): Promise<void> {
  await page.waitForFunction(() => window.__lantern.client.state.simTick >= 140, undefined, { timeout: 90_000 });
  const replay = await page.evaluate(() => window.__lantern.client.exportReplay());
  const report = replayInCpython(replay, label);
  expect(report.ok, JSON.stringify(report)).toBe(true);
}

/** Loads the game that reached its end as the newest save, and continues from the opening page. */
async function continueToTheEnd(page: Page): Promise<void> {
  await putSave(page, "the fifth night", ended);
  await page.evaluate(() => window.__lantern.client.refreshSaves());
  await expect(page.getByTestId("opening-continue")).toBeEnabled();
  await page.getByTestId("opening-continue").click();
  await expect(page.getByTestId("ending")).toBeVisible({ timeout: 240_000 });
}

let shots = 0;
/** A picture of the page, with the button the picture is about scrolled into view, since the ending is a long sheet. */
async function snap(page: Page, name: string, tag: string, scrollTo = ""): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  if (scrollTo !== "") await page.getByTestId(scrollTo).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SHOTS, `another-${String(++shots).padStart(2, "0")}-${name}-${tag}.png`) });
}

test.describe("another truth", () => {
  test("is not offered on the opening page before a game has been played to its end, and Start is still the first game", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await openPage(lantern);
    await expect(page.getByTestId("opening-another")).toHaveCount(0);
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("opening")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    const first = await caseOf(page);
    expect(first).toMatchObject({ seed: 492, variant: "v_boat" });
    expect(first.config).toMatchObject(RULES);
    expect(await page.evaluate(() => localStorage.getItem("lantern.finished"))).toBeNull();
  });

  test("is what the menu's new game starts: the rules of the first game at a seed and with a story of its own each time, and the replay says both", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    await openPage(lantern);
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    const seen = [await caseOf(page)];
    for (let i = 0; i < 2; i++) {
      await lantern.openMenu();
      await page.getByTestId("btn-new").click();
      await expect.poll(async () => (await caseOf(page)).seed, { timeout: 30_000 }).not.toBe(seen.at(-1)?.seed);
      const now = await caseOf(page);
      expect(STORIES).toContain(now.variant);
      expect(now.config).toMatchObject(RULES);
      seen.push(now);
      await page.getByTestId("menu-close").click();
    }
    // Not the game of the opening page, and not one another: three cases.
    expect(new Set(seen.map((c) => c.seed)).size).toBe(3);
    expect(seen.slice(1).every((c) => c.seed !== 492)).toBe(true);
    // The first day is the one the opening gives every case: the first card is the bamboo of the Li family.
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
    await replaysUnderCpython(page, "another-truth-menu");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is offered by the ending, picks a story other than the one it told, and is offered by the opening page from then on", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    await openPage(lantern);
    await continueToTheEnd(page);
    // The game that was played is the boatman's, and the page says so before it offers another.
    await expect(page.getByTestId("reveal-truth")).toHaveAttribute("data-variant", "v_boat");
    await expect(page.getByTestId("ending-new")).toHaveText("Another truth");
    expect(await page.evaluate(() => localStorage.getItem("lantern.finished"))).toBe("v_boat");
    await page.getByTestId("ending-new").click();
    await expect(page.getByTestId("ending")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    const second = await caseOf(page);
    expect(second.seed).not.toBe(492);
    expect(["v_flood", "v_drunk"]).toContain(second.variant);
    expect(second.config).toMatchObject(RULES);
    await replaysUnderCpython(page, "another-truth-ending");

    // A page opened again offers it beside Start and Continue, and Start is still the first game.
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("opening-another")).toBeEnabled();
    await expect(page.getByTestId("opening-another")).toHaveText("Another truth");
    expect(await fitsWidth(page)).toBe(true);
    await page.getByTestId("opening-another").click();
    await expect(page.getByTestId("opening")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    const third = await caseOf(page);
    expect(third.seed).not.toBe(492);
    // The story that was last told to this browser is not the one it picks.
    expect(["v_flood", "v_drunk"]).toContain(third.variant);
    expect(third.config).toMatchObject(RULES);
    await replaysUnderCpython(page, "another-truth-opening");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the first game for Start, and the tutorial of the first day plays that game again", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await openPage(lantern);
    await page.evaluate(() => localStorage.setItem("lantern.finished", "v_flood"));
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-another")).toBeVisible();
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(await caseOf(page)).toMatchObject({ seed: 492, variant: "v_boat" });
    // A new game from the menu goes elsewhere, and the tutorial from the menu comes back to the first game.
    await lantern.openMenu();
    await page.getByTestId("btn-new").click();
    await expect.poll(async () => (await caseOf(page)).seed, { timeout: 30_000 }).not.toBe(492);
    await page.getByTestId("btn-tutorial").click();
    await expect.poll(async () => (await caseOf(page)).seed, { timeout: 30_000 }).toBe(492);
    expect(await caseOf(page)).toMatchObject({ variant: "v_boat" });
    await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "goal");
    expect(lantern.pageErrors).toEqual([]);
  });
});

// The pictures for a look at the opening page with its third button and at the foot of the ending, in Chinese on the light theme and in
// English on the dark one. They are taken only when a folder is named.
for (const [locale, scheme, tag] of [
  ["zh-CN", "light", "zh-light"],
  ["en-US", "dark", "en-dark"],
] as const) {
  test.describe(`pictures of another truth, ${tag}`, () => {
    test.use({ locale, colorScheme: scheme, viewport: { width: 1280, height: 760 } });

    test(`the ending and the opening page, ${tag}`, async ({ lantern }) => {
      test.skip(SHOTS === "", "pictures are taken when LANTERN_SHOTS_DIR names a folder");
      test.setTimeout(600_000);
      const page = lantern.page;
      await openPage(lantern);
      await continueToTheEnd(page);
      await expect(page.getByTestId("ending-new")).toHaveText(locale === "zh-CN" ? "换一种真相再来" : "Another truth");
      await snap(page, "ending", tag, "ending-new");
      await page.reload();
      await lantern.waitReady();
      await expect(page.getByTestId("opening-another")).toBeVisible();
      await snap(page, "opening", tag);
    });
  });
}

