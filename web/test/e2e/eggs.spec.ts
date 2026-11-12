import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { RIDDLE_RIGHT } from "../../src/page/eggs.ts";
import { arrange, type Cell, clicks, clock, festivalNight, lanternAt, openingPage, pressLantern, reasons, said, speakers, tickOf, today } from "../support/eggs.ts";
import { CASES, loadFinished, openNight } from "../support/festival.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { mapDrawn, mouseOnMap } from "../support/play.ts";
import * as fake from "../support/slice.ts";
import type { Page } from "@playwright/test";

// The small secrets of the town, on the page: the riddle lantern at the door of the workshop, the watchman's verse at night, a rumour about the manager who
// stands still, and the Lantern Festival of the calendar. Each is found by the page's own entries (a click, a wait, the date of the computer) and each stays
// out of where it must not be.
test.use({ map: true });

const FULL = CASES.find((c) => c.name === "full") ?? (CASES[0] as (typeof CASES)[number]);
const APART = CASES.find((c) => c.name === "split-apart") ?? (CASES[0] as (typeof CASES)[number]);

test.describe("the riddle lantern at the door of the workshop", () => {
  test("hangs by the door of the workshop, and a click on it opens a slip with the riddle of the day and three answers", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    await arrange(page);
    const at = await lanternAt(page);
    // by the door: a little east of it, and higher on the screen than the cell of the door
    const door = await page.evaluate(() => window.__lantern.play.scene?.places.find((p) => p.kind === "workshop")?.door);
    if (door == null) throw new Error("no workshop door");
    const doorAt = await page.evaluate(([x, y]) => window.__lantern.view.cellToScreen(x as number, y as number), door);
    const zoom = await page.evaluate(() => window.__lantern.view.camera.zoom);
    expect((at.x - doorAt.x) / zoom / 32).toBeGreaterThan(1);
    expect((at.x - doorAt.x) / zoom / 32).toBeLessThan(4);
    expect(at.y).toBeLessThan(doorAt.y);
    expect(at.level).toBe(0);
    await expect(page.getByTestId("riddle-sheet")).toHaveCount(0);

    await pressLantern(page);
    const sheet = page.getByTestId("riddle-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-riddle", "1");
    await expect(sheet).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("riddle-text")).toHaveText(en["egg.riddle.1.q"]);
    await expect(page.getByTestId("riddle-day")).toHaveText("Day 1");
    await expect(sheet.locator('[data-testid^="riddle-answer-"]')).toHaveText(["A ferry boat", "A pier", "A stone bridge"]);
    await expect(page.getByTestId("riddle-hint")).toHaveText(en["egg.riddle.hint"]);
    // it comes down with its word, and the lantern counts as opened
    await page.getByTestId("riddle-close").click();
    await expect(sheet).toHaveCount(0);
    expect(await page.evaluate(() => window.__lantern.play.eggs.riddles.opened)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("stops a world that is running while the slip is up, and lets it go on when the slip is put away", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    // the player lets the world run, and the lantern is opened as a click on it would
    await page.evaluate(() => window.__lantern.client.resume());
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(false);
    await page.evaluate(() => window.__lantern.play.eggs.openRiddle());
    await expect(page.getByTestId("riddle-sheet")).toBeVisible();
    await expect.poll(() => reasons(page)).toContain("page");
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("riddle-sheet")).toHaveCount(0);
    await expect.poll(() => reasons(page)).not.toContain("page");
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(false);
  });

  test("takes the right answer with the lantern maker's line, and the lantern burns brighter for it, by day as well", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    await arrange(page);
    await pressLantern(page);
    const sheet = page.getByTestId("riddle-sheet");
    const right = RIDDLE_RIGHT[0] as number;
    await page.getByTestId(`riddle-answer-${right}`).click();
    await expect(sheet).toHaveAttribute("data-state", "right");
    await expect(page.getByTestId("riddle-line")).toHaveText(en["egg.riddle.right"]);
    await expect(page.getByTestId("riddle-said").locator(".riddle-maker")).toHaveText("Lantern Maker");
    await expect(page.getByTestId("riddle-hint")).toHaveCount(0);
    // the answers are given up: a day has one guess
    for (let i = 0; i < 3; i++) await expect(page.getByTestId(`riddle-answer-${i}`)).toBeDisabled();
    await expect(page.getByTestId(`riddle-answer-${right}`)).toHaveAttribute("aria-pressed", "true");
    await expect(sheet.locator("svg.tick")).toHaveCount(1);
    // the lantern burns a step brighter, in the daylight too
    await expect.poll(async () => (await lanternAt(page)).level).toBe(1);
    expect((await lanternAt(page)).lit).toBe(true);
    expect(await page.evaluate(() => window.__lantern.play.eggs.riddles.right)).toBe(1);
    // the slip says the same when the lantern is opened again the same day
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await pressLantern(page);
    await expect(sheet).toHaveAttribute("data-state", "right");
    await expect(page.getByTestId("riddle-line")).toHaveText(en["egg.riddle.right"]);
    await expect(page.getByTestId("riddle-answer-0")).toBeDisabled();
    await page.getByTestId("riddle-x").click();
    await expect(sheet).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("takes a wrong answer kindly, with the answer and a new riddle tomorrow, and nothing is lost; the last day says the festival is tonight", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    await arrange(page, {}, clock(2, 9));
    await pressLantern(page);
    const sheet = page.getByTestId("riddle-sheet");
    // the second riddle, of the second day
    await expect(sheet).toHaveAttribute("data-riddle", "2");
    await expect(page.getByTestId("riddle-day")).toHaveText("Day 2");
    await expect(page.getByTestId("riddle-text")).toHaveText(en["egg.riddle.2.q"]);
    const wrong = (RIDDLE_RIGHT[1] as number) === 0 ? 1 : 0;
    await page.getByTestId(`riddle-answer-${wrong}`).click();
    await expect(sheet).toHaveAttribute("data-state", "wrong");
    await expect(page.getByTestId("riddle-line")).toHaveText("Not this time, and no harm done. It was the night watchman. I'll paste up a new one tomorrow.");
    await expect(sheet.locator("svg.tick")).toHaveCount(0);
    expect((await lanternAt(page)).level).toBe(0);
    expect(await page.evaluate(() => window.__lantern.play.eggs.riddles.guessed)).toBe(1);
    await page.getByTestId("riddle-close").click();
    // the next day brings the next riddle, with a guess of its own
    await fake.feedFrame(page, clock(3, 9));
    await pressLantern(page);
    await expect(sheet).toHaveAttribute("data-riddle", "3");
    await expect(sheet).toHaveAttribute("data-state", "open");
    await page.keyboard.press("Escape");
    // the fifth day: there is no tomorrow to paste a riddle for
    await fake.feedFrame(page, clock(5, 9));
    await pressLantern(page);
    await expect(sheet).toHaveAttribute("data-riddle", "5");
    const last = (RIDDLE_RIGHT[4] as number) === 0 ? 1 : 0;
    await page.getByTestId(`riddle-answer-${last}`).click();
    await expect(page.getByTestId("riddle-line")).toHaveText("Not this time, and no harm done. It was the Town Gazette. The festival is tonight, and every lantern is hung.");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says the riddle in the language of the page, with the answer to a wrong guess in corner brackets, and follows a switch of the language", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    await arrange(page);
    await lantern.setLang("zh");
    await pressLantern(page);
    await expect(page.getByTestId("riddle-sheet")).toBeVisible();
    await expect(page.getByTestId("riddle-text")).toHaveText(zh["egg.riddle.1.q"]);
    await expect(page.getByTestId("riddle-day")).toHaveText("第一天");
    await expect(page.getByTestId("riddle-answer-0")).toHaveText("渡船");
    await expect(page.getByTestId("riddle-hint")).toHaveText(zh["egg.riddle.hint"]);
    await page.getByTestId("riddle-answer-0").click();
    await expect(page.getByTestId("riddle-line")).toHaveText("没猜中，不碍事。谜底是「石桥」。明天我糊条新的，再来猜。");
    await expect(page.getByTestId("riddle-said").locator(".riddle-maker")).toHaveText("扎灯师傅");
    // a switch of the language with the slip up says it in the other language, with the same answer picked
    await lantern.setLang("en");
    await expect(page.getByTestId("riddle-text")).toHaveText(en["egg.riddle.1.q"]);
    await expect(page.getByTestId("riddle-answer-0")).toHaveAttribute("aria-pressed", "true");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not open in a talk, nor with the notebook open, and a click on it is then a click on the town", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await mapDrawn(page);
    await arrange(page);
    // in a talk
    await fake.startTalk(page, "li_laotai");
    await pressLantern(page);
    await expect(page.getByTestId("riddle-sheet")).toHaveCount(0);
    expect(await page.evaluate(() => window.__lantern.play.eggs.riddles.opened)).toBe(false);
    // out of the talk, with the notebook open
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null } }, [{ kind: "talk_end", npc: "li_laotai", reason: "left" }]);
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await pressLantern(page);
    await expect(page.getByTestId("riddle-sheet")).toHaveCount(0);
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    // with nothing over the map it opens
    await pressLantern(page);
    await expect(page.getByTestId("riddle-sheet")).toBeVisible();
    // and a talk that begins puts the slip away
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("riddle-sheet")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is a click on the ground where it is not the lantern: the walk to a place is as it was", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await mapDrawn(page);
    await arrange(page);
    const at = await lanternAt(page);
    // the door of the workshop, a little left of the lantern and lower, is a click on the building
    const door = await page.evaluate(() => window.__lantern.play.scene?.places.find((p) => p.kind === "workshop")?.door);
    if (door == null) throw new Error("no workshop door");
    const doorAt = await page.evaluate(([x, y]) => window.__lantern.view.cellToScreen(x as number, y as number), door);
    await mouseOnMap(page, doorAt, "click");
    await expect(page.getByTestId("riddle-sheet")).toHaveCount(0);
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "move" });
    // and a click on the lantern is not a walk
    const before = (await fake.sentSoFar(page)).length;
    await mouseOnMap(page, { x: at.x, y: at.y }, "click");
    await expect(page.getByTestId("riddle-sheet")).toBeVisible();
    expect((await fake.sentSoFar(page)).length).toBe(before);
  });

  test("keeps what was guessed in the notes of a save, and a game that is loaded has it back: the guesses, the brightness and the count", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    await arrange(page);
    expect(await page.evaluate(() => window.__lantern.client.pageNotes?.() ?? null)).toBeNull();
    await pressLantern(page);
    await page.getByTestId(`riddle-answer-${RIDDLE_RIGHT[0] as number}`).click();
    await page.getByTestId("riddle-close").click();
    const notes = await page.evaluate(() => window.__lantern.client.pageNotes?.() ?? null);
    expect(notes).toEqual({ riddles: { opened: true, guesses: { "1": RIDDLE_RIGHT[0] } } });
    const meta = await page.evaluate(() => window.__lantern.client.save("with a riddle"));
    // a new game has no guess and an unlit lantern
    await page.evaluate(() => window.__lantern.client.newGame(null));
    await expect.poll(() => page.evaluate(() => window.__lantern.play.eggs.riddles.guessed)).toBe(0);
    await expect.poll(async () => (await lanternAt(page)).level).toBe(0);
    expect(await page.evaluate(() => window.__lantern.client.pageNotes?.() ?? null)).toBeNull();
    // the save brings it back
    await page.evaluate((m) => window.__lantern.client.load(m.id), meta);
    await expect.poll(() => page.evaluate(() => window.__lantern.play.eggs.riddles.pickOf(1))).toBe(RIDDLE_RIGHT[0]);
    expect(await page.evaluate(() => window.__lantern.play.eggs.riddles.opened)).toBe(true);
    await expect.poll(async () => (await lanternAt(page)).level).toBe(1);
    expect(await page.evaluate(() => window.__lantern.client.pageNotes?.() ?? null)).toEqual(notes);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the riddles on the ending page", () => {
  /** The page at the end of a game that is loaded from a save with these notes. */
  async function endedWith(lantern: LanternPage, notes: Record<string, unknown> | undefined, lang: "en" | "zh" = "en"): Promise<void> {
    const page = lantern.page;
    await openNight(lantern, FULL, lang, "dark");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();
    await loadFinished(page, FULL, {}, notes);
    await expect(page.getByTestId("director")).toHaveAttribute("data-show", "festival");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();
  }

  const GUESSED = { riddles: { opened: true, guesses: { "1": RIDDLE_RIGHT[0], "2": RIDDLE_RIGHT[1], "3": RIDDLE_RIGHT[2], "4": (RIDDLE_RIGHT[3] as number) === 0 ? 1 : 0 } } };

  test("say in one small line how many were guessed right, for a player who opened the lantern, in English", async ({ lantern }) => {
    const page = lantern.page;
    await endedWith(lantern, GUESSED);
    const line = page.getByTestId("ending-riddles");
    await expect(line).toHaveText("You guessed three of the riddles.");
    await expect(line).toHaveAttribute("data-right", "3");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("say it in Chinese too", async ({ lantern }) => {
    const page = lantern.page;
    await endedWith(lantern, GUESSED, "zh");
    await expect(page.getByTestId("ending-riddles")).toHaveText("灯谜猜中了三条。");
  });

  test("have a line for none and for all five", async ({ lantern }) => {
    const page = lantern.page;
    await endedWith(lantern, { riddles: { opened: true, guesses: {} } });
    await expect(page.getByTestId("ending-riddles")).toHaveText("You guessed none of the riddles.");
    await endedWith(lantern, { riddles: { opened: true, guesses: Object.fromEntries(RIDDLE_RIGHT.map((right, i) => [String(i + 1), right])) } }, "zh");
    await expect(page.getByTestId("ending-riddles")).toHaveText("五条灯谜全猜中了。");
  });

  test("say nothing for a player who never opened the lantern", async ({ lantern }) => {
    const page = lantern.page;
    await endedWith(lantern, undefined);
    await expect(page.getByTestId("ending-riddles")).toHaveCount(0);
    // not for a save of a game that kept no notes of the riddles, nor for notes that say nothing
    await endedWith(lantern, { moments: { pictures: {} } });
    await expect(page.getByTestId("ending-riddles")).toHaveCount(0);
    await endedWith(lantern, { riddles: { guesses: {} } });
    await expect(page.getByTestId("ending-riddles")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("count what the lantern was told in the game, from the page and not only from a save", async ({ lantern }) => {
    const page = lantern.page;
    await openNight(lantern, FULL, "en", "dark");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("ending")).toBeVisible();
    await expect(page.getByTestId("ending-riddles")).toHaveCount(0);
    await page.evaluate(() => {
      const eggs = window.__lantern.play.eggs;
      eggs.riddles.opened = true;
      eggs.riddles.guess(1, 2);
      window.__lantern.play.touch();
    });
    await expect(page.getByTestId("ending-riddles")).toHaveText("You guessed one of the riddles.");
  });
});

test.describe("the watchman's verse", () => {
  /** The watchman stands in the street by the bridge, at night, and nobody else is near. */
  async function atNight(lantern: LanternPage, day = 1, hour = 23): Promise<{ x: number; y: number }> {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await mapDrawn(page);
    await arrange(page, { gengfu: [30, 16] }, clock(day, hour));
    const spot = await page.evaluate(() => window.__lantern.view.bodyPositionOf("gengfu"));
    if (spot === null) throw new Error("no watchman");
    return spot;
  }

  /** The clock moves on, to a time and a day, a few ticks later. */
  const later = async (page: Page, day: number, hour: number, minute = 0, ticks = 10): Promise<void> => fake.feedAt(page, (await tickOf(page)) + ticks, clock(day, hour, minute));

  test("is said over his head by three clicks on him within two seconds at night, in his own voice, and he says it once for each night", async ({ lantern }) => {
    const page = lantern.page;
    const spot = await atNight(lantern);
    await clicks(page, spot, 1);
    // the first click is the click it always was: he is picked, and nothing is said
    await expect(page.getByTestId("person-name")).toHaveText("Night Watchman");
    expect(await speakers(page)).toEqual([]);
    await clicks(page, spot, 2);
    expect(await speakers(page)).toEqual(["gengfu"]);
    await expect.poll(() => said(page)).toEqual([en["egg.verse.1"]]);
    // a reader that cannot see the map has the line too
    await expect(page.getByTestId("dialogue")).toContainText(en["egg.verse.1"]);
    // the verse is the page's: nothing went to the core for it, and the game's own lines are not touched
    expect((await fake.sentSoFar(page)).filter((m) => m.type !== "move" && m.type !== "talk")).toEqual([]);
    expect(await page.evaluate(() => window.__lantern.view.texts().bubbles)).toEqual([]);
    // it goes after a while, and the night does not give a second
    await later(page, 1, 23, 40, 200);
    expect(await speakers(page)).toEqual([]);
    await expect.poll(() => said(page)).toEqual([]);
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual([]);
    // past midnight it is the same night
    await later(page, 1, 2, 0);
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual([]);
    // the next night has another
    await later(page, 2, 22, 30);
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual(["gengfu"]);
    await expect.poll(() => said(page)).toEqual([en["egg.verse.2"]]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is said in the language of the page", async ({ lantern }) => {
    const page = lantern.page;
    const spot = await atNight(lantern);
    await lantern.setLang("zh");
    await clicks(page, spot, 3);
    await expect.poll(() => said(page)).toEqual([zh["egg.verse.1"]]);
    await lantern.setLang("en");
    await expect.poll(() => said(page)).toEqual([en["egg.verse.1"]]);
  });

  test("is not said by day, nor before 22:00, nor from 05:00, nor to clicks that are too slow, nor to clicks with another click between", async ({ lantern }) => {
    const page = lantern.page;
    const spot = await atNight(lantern, 1, 14);
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual([]);
    for (const [hour, minute] of [[21, 59], [5, 0], [6, 0]] as const) {
      await later(page, 1, hour, minute, 5);
      await clicks(page, spot, 3);
      expect(await speakers(page), `${hour}:${minute}`).toEqual([]);
    }
    // at night, clicks that take more than two seconds for the three
    await later(page, 1, 23, 0, 5);
    await clicks(page, spot, 3, 1_100);
    expect(await speakers(page)).toEqual([]);
    // two clicks on him and one on the ground between (the two slow ones before are not counted with them)
    await clicks(page, { x: 20, y: 20 }, 1);
    await clicks(page, spot, 1);
    await clicks(page, { x: 20, y: 20 }, 1);
    await clicks(page, spot, 2);
    expect(await speakers(page)).toEqual([]);
    // and then three in a row do
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual(["gengfu"]);
  });

  test("is not said while the manager is in a talk, and is put away by a talk that begins", async ({ lantern }) => {
    const page = lantern.page;
    const spot = await atNight(lantern);
    await fake.startTalk(page, "li_laotai");
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual([]);
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null } }, [{ kind: "talk_end", npc: "li_laotai", reason: "left" }]);
    await clicks(page, spot, 3);
    expect(await speakers(page)).toEqual(["gengfu"]);
    await fake.startTalk(page, "li_laotai");
    expect(await speakers(page)).toEqual([]);
    await expect.poll(() => said(page)).toEqual([]);
  });
});

test.describe("a rumour about the manager", () => {
  /** The manager stands at a cell with the people given near; the game clock is at 09:00 of the first day. Returns what moves the clock to a time of day. */
  async function standingAt(lantern: LanternPage, cell: Cell, near: Record<string, Cell>): Promise<(hour: number, minute: number) => Promise<void>> {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await mapDrawn(page);
    await arrange(page, near, { ...clock(1, 9), player: { ...(await fake.playerOf(page)), x: cell[0], y: cell[1], activity: "rest", talk: null } });
    let tick = 1_000;
    return (hour, minute) => fake.feedAt(page, (tick += 100), clock(1, hour, minute));
  }

  test("is said by the nearest person after an hour of game time at the market, in their own voice, and only once in a game", async ({ lantern }) => {
    const page = lantern.page;
    const at = await standingAt(lantern, [19, 20], { li_er: [21, 20], li_laotai: [24, 18] });
    await at(9, 30);
    await at(9, 59);
    expect(await speakers(page)).toEqual([]);
    await at(10, 0);
    expect(await speakers(page)).toEqual(["li_er"]);
    await expect.poll(() => said(page)).toEqual([en["egg.rumour.li_er"]]);
    await expect(page.getByTestId("dialogue")).toContainText(en["egg.rumour.li_er"]);
    // it is the page's: the game's own lines are not touched
    expect(await page.evaluate(() => window.__lantern.view.texts().bubbles)).toEqual([]);
    // it goes after a while, and does not come back however long the manager stands there
    await fake.feedAt(page, (await tickOf(page)) + 300, clock(1, 11, 0));
    expect(await speakers(page)).toEqual([]);
    await expect.poll(() => said(page)).toEqual([]);
    for (const hour of [12, 14, 17]) await at(hour, 0);
    expect(await speakers(page)).toEqual([]);
  });

  test("is said in the language of the page, and by a person with a voice of their own at the door of the teahouse", async ({ lantern }) => {
    const page = lantern.page;
    const at = await standingAt(lantern, [34, 14], { cha_laoban: [33, 14] });
    await lantern.setLang("zh");
    await at(9, 30);
    expect(await speakers(page)).toEqual([]);
    await at(10, 0);
    await expect.poll(() => said(page)).toEqual([zh["egg.rumour.cha_laoban"]]);
  });

  test("begins again for an act of the manager, for a step and for a talk, and is not for a place other than the market and the teahouse door", async ({ lantern }) => {
    const page = lantern.page;
    const at = await standingAt(lantern, [19, 20], { li_er: [21, 20] });
    await fake.recordSent(page);
    await at(9, 40);
    // an act: the manager listens
    await page.evaluate(() => window.__lantern.play.listen());
    await at(10, 10);
    await at(10, 50);
    expect(await speakers(page)).toEqual([]);
    // a step to the next cell
    await fake.feedAt(page, (await tickOf(page)) + 10, { ...clock(1, 10, 55), player: { ...(await fake.playerOf(page)), x: 20, y: 20 } });
    await at(11, 50);
    expect(await speakers(page)).toEqual([]);
    // a talk
    await fake.startTalk(page, "li_er");
    await at(13, 0);
    await at(14, 30);
    expect(await speakers(page)).toEqual([]);
    // and then out of it, an hour of standing does it
    await fake.feedAt(page, (await tickOf(page)) + 10, { ...clock(1, 14, 31), player: { ...(await fake.playerOf(page)), talk: null } }, [{ kind: "talk_end", npc: "li_er", reason: "left" }]);
    await at(15, 20);
    expect(await speakers(page)).toEqual([]);
    await at(15, 31);
    expect(await speakers(page)).toEqual(["li_er"]);
  });

  test("is not said anywhere else: an hour at the workshop door says nothing", async ({ lantern }) => {
    const page = lantern.page;
    const at = await standingAt(lantern, [5, 22], { li_er: [6, 22] });
    for (const [hour, minute] of [[9, 30], [10, 0], [11, 0], [13, 0]] as const) await at(hour, minute);
    expect(await speakers(page)).toEqual([]);
  });

  test("starts again with a game that is loaded", async ({ lantern }) => {
    const page = lantern.page;
    const at = await standingAt(lantern, [19, 20], { li_er: [21, 20] });
    await at(9, 30);
    await at(10, 0);
    expect(await speakers(page)).toEqual(["li_er"]);
    await page.evaluate(() => {
      const client = window.__lantern.client as unknown as { onMessage(message: unknown): void };
      const state = window.__lantern.client.state;
      const base = state.frame;
      client.onMessage({ type: "reset", seed: state.seed ?? 7, scenario: state.scenario ?? "bridge" });
      client.onMessage({ type: "frame", tick: 100, advanced: false, frame: base, events: [], clock: { paused: true, rate: [1, 1] } });
      client.onMessage({ type: "loaded", info: { id: 1, name: "again", tick: 100, hash: "h", savedHash: "h", match: true, hashesChecked: 1, reissued: 0, cancelledOpen: 0 } });
    });
    expect(await speakers(page)).toEqual([]);
    // the game that is loaded is at 10:00 again, and an hour of standing there says it once more
    await fake.feedAt(page, 600, clock(1, 10, 30));
    expect(await speakers(page)).toEqual([]);
    await fake.feedAt(page, 620, clock(1, 11, 0));
    expect(await speakers(page)).toEqual(["li_er"]);
  });
});

test.describe("the Lantern Festival today", () => {
  const DAYS: Array<[string, string, boolean]> = [
    ["on the day of 2027", "2027-02-20T00:00:00", true],
    ["late on the day of 2027", "2027-02-20T23:59:30", true],
    ["on the day of 2034, in March", "2034-03-05T12:00:00", true],
    ["the day before", "2027-02-19T12:00:00", false],
    ["the day after", "2027-02-21T12:00:00", false],
    ["a day of this year", "2026-11-08T12:00:00", false],
    ["the festival of a year the table does not have", "2037-02-26T12:00:00", false],
  ];

  for (const [name, local, wanted] of DAYS) {
    test(`${wanted ? "shows" : "does not show"} one more line on the opening page: ${name}`, async ({ lantern }) => {
      const page = lantern.page;
      await today(page, local);
      await openingPage(lantern);
      const line = page.getByTestId("opening-today");
      if (!wanted) {
        await expect(line).toHaveCount(0);
        return;
      }
      await expect(line).toHaveText("It is the Lantern Festival today, too.");
      await page.getByTestId("opening").getByTestId("lang-zh").click();
      await expect(line).toHaveText("今天也是元宵节。");
      // under the line of what the five days are for
      const goal = await page.getByTestId("opening-goal").boundingBox();
      const lineBox = await line.boundingBox();
      expect(lineBox?.y ?? 0).toBeGreaterThan((goal?.y ?? 0) + (goal?.height ?? 0) - 1);
      expect(lantern.pageErrors).toEqual([]);
    });
  }

  test("doubles the lanterns of the river on the festival night of a day of the table", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await today(page, "2028-02-09T20:00:00");
    await openNight(lantern, FULL, "en", "dark");
    const night = await festivalNight(page);
    expect(night.plan.route).toBe("bridge");
    expect(night.stage.river).toBe(2 * 50);
  });

  test("leaves the river as it was on another day", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await today(page, "2028-02-10T20:00:00");
    await openNight(lantern, FULL, "en", "dark");
    expect((await festivalNight(page)).stage.river).toBe(50);
  });

  test("doubles the few lanterns of a night with no parade as well", async ({ lantern }) => {
    test.setTimeout(150_000);
    const page = lantern.page;
    await today(page, "2030-02-17T09:00:00");
    await openNight(lantern, APART, "en", "light");
    const night = await festivalNight(page);
    expect(night.plan.route).toBe("none");
    expect(night.stage.river).toBe(2 * 4);
  });
});
