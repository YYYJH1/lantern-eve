import type { Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import { pressStart } from "../support/start.ts";

// The help in the world on a page of fake frames, with the world held at tick 300 so that what a test feeds stays as it was fed:
// the signals and the log of hints, asking the elder at three levels, and the elder who comes by when nothing moves.
test.use({ map: true });

/**
 * The first day with the help on and taking the frame it was fed as what was true from the start: the task that is followed is open, the
 * notebook and the promises are empty, and what the test adds. Only what a test feeds after this is news to the help.
 */
async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: [], commitments: [], ...extras }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

const NOTEBOOK_TWO = [
  { id: "n_clerk", text: { zh: "李二昨晚在桥边。", en: "Li Er was at the bridge last night." }, source: { kind: "heard", who: { zh: "周家伙计", en: "Zhou's Clerk", id: "zhou_huoji" }, how: "saw" }, marks: [], chain: [] },
  { id: "n_broke", text: { zh: "李二昨晚把栏杆弄坏了。", en: "Li Er broke the bridge railing last night." }, source: { kind: "heard", who: { zh: "茶馆老板娘", en: "Teahouse Keeper", id: "cha_laoban" }, how: "unsure" }, marks: ["unconfirmed"], chain: [] },
];

test.describe("the signals of the world", () => {
  test("light what is new where it appears, one at a time, and stop when the player presses what is lit", async ({ lantern }) => {
    const page = lantern.page;
    // A page that was fed nothing new has nothing lit: what was true when it opened is not news.
    await guided(lantern);
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    await expect(page.locator(".is-signal")).toHaveCount(0);
    // A line in the notebook is new. The button of the notebook glows, and a line says what it is. No window, nothing in the way.
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO.slice(0, 1) });
    await expect(page.getByTestId("btn-notebook")).toHaveClass(/is-signal/);
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "notebook");
    await expect(page.getByTestId("hint-pill")).toContainText(en["cue.notebook"]);
    expect(await fake.fitsWidth(page)).toBe(true);
    // A second line is another hint, and it waits its turn behind the first.
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO });
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "notebook");
    // Pressing what is lit puts the signal out, and the one that waits is lit next.
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "compare");
    await page.getByTestId("notebook-close").click();
    await page.getByTestId("hint-pill-close").click();
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    await expect(page.locator(".is-signal")).toHaveCount(0);
    // No modal anywhere in this: nothing took the keyboard, and nothing is a dialog but the sheets the player opened.
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("say what is new in the words of the game and the page, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    // A task that is blocked is lit on the task card.
    await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
    await expect(page.getByTestId("task-card")).toHaveClass(/is-signal/);
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "blocked");
    const words = { en: en["cue.blocked"], zh: zh["cue.blocked"] } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        // The signal goes out nine seconds after it was lit, and four turns of the menu can take longer than that on a slow machine: it is lit again for each look.
        await fake.relight(page, "blocked");
        await expect(page.getByTestId("hint-pill").locator(".hint-pill-text")).toHaveText(words[lang]);
        expect(await fake.contrast(page, '[data-testid="hint-pill"]'), `${theme} ${lang}`).toBeGreaterThan(4.5);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are kept in a list in the menu that the player can open again, and each can be shown again", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await lantern.openMenu();
    await expect(page.getByTestId("btn-hints")).toHaveText("Hints (0)");
    await page.getByTestId("btn-hints").click();
    await expect(page.getByTestId("hint-log-empty")).toContainText("No hints yet");
    await page.getByTestId("menu-close").click();
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO, ...fake.tasks("t_bamboo_first") });
    await page.getByTestId("hint-pill-close").click();
    await page.getByTestId("hint-pill-close").click();
    await page.getByTestId("hint-pill-close").click();
    await expect(page.locator(".is-signal")).toHaveCount(0);
    await lantern.openMenu();
    await expect(page.getByTestId("btn-hints")).toHaveText("Hints (3)");
    const entries = page.getByTestId("hint-log-entry");
    // The newest is first, each with the time it was given at in the game.
    await expect(entries).toHaveCount(3);
    await expect(entries.nth(0)).toHaveAttribute("data-hint", "blocked");
    await expect(entries.nth(2)).toHaveAttribute("data-hint", "notebook");
    await expect(entries.nth(2).locator(".hint-log-when")).toHaveText("Day 1 08:30");
    await expect(entries.nth(2).locator(".hint-log-text")).toContainText(en["cue.notebook"]);
    expect(await fake.fitsWidth(page)).toBe(true);
    // Show me lights it again where it is, and the menu is put away.
    await entries.nth(0).getByTestId("hint-show").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("task-card")).toHaveClass(/is-signal/);
    await lantern.setLang("zh");
    await lantern.openMenu();
    await expect(page.getByTestId("btn-hints")).toHaveText("提示（3）");
    await expect(page.getByTestId("hint-log-entry").nth(2).locator(".hint-log-when")).toHaveText("第一天 08:30");
    await expect(page.getByTestId("hint-log-entry").nth(2).locator(".hint-log-text")).toContainText(zh["cue.notebook"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are off when the viewer turned them off in the menu, and the list says so", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await lantern.openMenu();
    const box = page.getByTestId("menu-hints").locator("input");
    await expect(box).toBeChecked();
    await box.uncheck();
    expect(await page.evaluate(() => localStorage.getItem("lantern.hints"))).toBe("off");
    await page.getByTestId("menu-close").click();
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO });
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    await expect(page.locator(".is-signal")).toHaveCount(0);
    await lantern.openMenu();
    await expect(page.getByTestId("btn-hints")).toHaveText("Hints (0)");
    await page.getByTestId("btn-hints").click();
    await expect(page.getByTestId("hint-log-off")).toHaveText("The hints in the town are off in the settings.");
    // Asking the elder still works: it is the player's own call.
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("btn-elder")).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are not there on a page that was made for a game named in its address", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { notebook: NOTEBOOK_TWO });
    await expect(page.getByTestId("help-bar")).toHaveCount(0);
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    await expect(page.locator(".is-signal")).toHaveCount(0);
    await lantern.openMenu();
    await expect(page.getByTestId("menu-help")).toHaveCount(0);
  });
});

const lastSent = async (page: Page): Promise<Record<string, unknown> | undefined> => (await fake.sentSoFar(page)).at(-1);

test.describe("asking the elder", () => {
  test("gives three levels, each when it is asked: the way to think, the lines to set side by side, the next step spelled out", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { notebook: NOTEBOOK_TWO });
    await fake.recordSent(page);
    await page.getByTestId("btn-elder").click();
    const sheet = page.getByTestId("elder");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-visit", "false");
    await expect(page.getByTestId("elder-lead")).toHaveText("You asked the elder.");
    // The world is held while he talks: the pause button does not let it go.
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    for (const level of [1, 2, 3]) await expect(page.getByTestId(`elder-level-${level}`)).toBeEnabled();
    await expect(page.getByTestId("elder-level-1")).toHaveText("Which way to think");
    await expect(page.getByTestId("elder-level-2")).toHaveText("Which lines to compare");
    await expect(page.getByTestId("elder-level-3")).toHaveText("Just tell me the next step");

    // Level 1: the next of the task that is followed.
    await page.getByTestId("elder-level-1").click();
    await expect(page.getByTestId("elder-answer-1").getByTestId("elder-text")).toHaveText("Think about this. Find out who started that talk.");
    await expect(page.getByTestId("elder-level-1")).toHaveCount(0);

    // Level 2: the core's pair, asked of the core, and the relation it gives when asked a second time.
    await page.getByTestId("elder-level-2").click();
    expect(await lastSent(page)).toMatchObject({ type: "hint" });
    await fake.feedFrame(page, { hint: { a: "n_clerk", b: "n_broke" } });
    const two = page.getByTestId("elder-answer-2");
    await expect(two).toHaveAttribute("data-from", "core");
    await expect(two.getByTestId("elder-text")).toHaveText("Check “Li Er was at the bridge last night” against the claim “Li Er broke the bridge railing last night”.");
    await fake.feedFrame(page, { hint: { a: "n_clerk", b: "n_broke", relation: "unsupported" } });
    await expect(two.locator(".elder-extra")).toHaveText("As I see it, it doesn't prove the claim.");

    // Level 3: the next step, from the action of the task, with where and when.
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-answer-3").getByTestId("elder-text")).toHaveText("Your next step: Talk to Granny Li");
    await expect(page.getByTestId("elder-answer-3").locator(".elder-extra")).toHaveText("At Li Family House, Day 1 08:00 to 17:00.");
    await expect(page.getByTestId("elder-levels")).toHaveCount(0);

    // In Chinese, in both themes.
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("zh");
      await expect(page.getByTestId("elder-answer-1").getByTestId("elder-text")).toHaveText("你往这头想想。问清这话是谁先说的。");
      await expect(page.getByTestId("elder-answer-3").getByTestId("elder-text")).toHaveText("下一步，去找李老太说话。");
      await expect(page.getByTestId("elder-answer-3").locator(".elder-extra")).toHaveText("在李家宅，第一天 辰时 08:00 到 17:00。");
      expect(await fake.contrast(page, '[data-testid="elder-answer-1"] [data-testid="elder-text"]'), theme).toBeGreaterThan(4.5);
      await lantern.setLang("en");
    }
    // He is thanked, and the world is let go of.
    await page.getByTestId("elder-close").click();
    await expect(sheet).toHaveCount(0);
    await expect(page.getByTestId("btn-pause")).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("falls back to the lines the notebook marks where the core has no hint to give, and says so when there are none", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { notebook: NOTEBOOK_TWO, hud: { verbs: fake.FREE_VERBS.filter((verb) => verb !== "hint") } });
    await fake.recordSent(page);
    await page.getByTestId("btn-elder").click();
    await page.getByTestId("elder-level-2").click();
    // No verb to ask the core with: nothing was sent, and the pair is the one the marks of the notebook give.
    expect(await fake.sentSoFar(page)).toEqual([]);
    await expect(page.getByTestId("elder-answer-2")).toHaveAttribute("data-from", "page");
    await expect(page.getByTestId("elder-answer-2").getByTestId("elder-text")).toContainText("“Li Er was at the bridge last night” against the claim “Li Er broke the bridge railing last night”");
    await page.getByTestId("elder-close").click();
    // With nothing to compare, and nothing followed, the elder says what he has.
    await fake.feedFrame(page, { notebook: [NOTEBOOK_TWO[0]], tracked: null });
    await page.getByTestId("btn-elder").click();
    await page.getByTestId("elder-level-1").click();
    await page.getByTestId("elder-level-2").click();
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-answer-1").getByTestId("elder-text")).toHaveText("Pick something to do first, and I will tell you which way to think.");
    await expect(page.getByTestId("elder-answer-2").getByTestId("elder-text")).toHaveText("Nothing in your notebook is worth setting side by side yet. Ask around first.");
    await expect(page.getByTestId("elder-answer-3").getByTestId("elder-text")).toHaveText("Pick something to do first.");
    // Escape closes his card.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("elder")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the elder who comes by", () => {
  /** The ticks the story may stand still before he comes, and the game time that counts. */
  const STILL = 600;

  test("comes when nothing has moved for a while of game time, with one level more at each visit, and only game time counts", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    // Something moves at tick 1000, a line in the notebook, and the wait begins there.
    await fake.feedAt(page, 1000, { notebook: NOTEBOOK_TWO.slice(0, 1) });
    // A world that is held does not move the tick, however long the page waits.
    await page.waitForTimeout(500);
    await fake.feedAt(page, 1000);
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await fake.feedAt(page, 1000 + STILL - 1);
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await fake.feedAt(page, 1000 + STILL);
    const sheet = page.getByTestId("elder");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-visit", "true");
    await expect(page.getByTestId("elder-lead")).toHaveText("The elder came by. You look stuck.");
    await expect(page.getByTestId("elder-answer-1")).toBeVisible();
    await expect(page.getByTestId("elder-answer-2")).toHaveCount(0);
    await page.getByTestId("elder-close").click();
    await expect(sheet).toHaveCount(0);
    // The wait starts over, and the next visit gives the second level too.
    await fake.feedAt(page, 1000 + STILL * 2 - 1);
    await expect(sheet).toHaveCount(0);
    await fake.feedAt(page, 1000 + STILL * 2);
    await expect(page.getByTestId("elder-answer-1")).toBeVisible();
    await expect(page.getByTestId("elder-answer-2")).toBeVisible();
    await expect(page.getByTestId("elder-answer-3")).toHaveCount(0);
    await page.getByTestId("elder-close").click();
    // Something moves in the story, and the elder starts from the first level again.
    await fake.feedAt(page, 1000 + STILL * 2 + 10, { notebook: NOTEBOOK_TWO });
    await fake.feedAt(page, 1000 + STILL * 3 + 9);
    await expect(sheet).toHaveCount(0);
    await fake.feedAt(page, 1000 + STILL * 3 + 10);
    await expect(page.getByTestId("elder-answer-1")).toBeVisible();
    await expect(page.getByTestId("elder-answer-2")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not count the night, nor the wait for what somebody promised that is not due yet, and counts the day from the first frame of it", async ({ lantern }) => {
    const page = lantern.page;
    const DAY = { day: 1, hour: 18, minute: 30, phase: "day" };
    const NIGHT = { day: 1, hour: 23, minute: 0, phase: "night" };
    const MORNING = { day: 2, hour: 7, minute: 0, phase: "day" };
    await guided(lantern);
    // The elder is not there after a night: it is three times the wait, and every frame of it says that it is night.
    await fake.feedAt(page, 1000, { notebook: NOTEBOOK_TWO.slice(0, 1), time: DAY });
    for (let tick = 1100; tick <= 1000 + STILL * 3; tick += 100) await fake.feedAt(page, tick, { time: NIGHT });
    await expect(page.getByTestId("elder")).toHaveCount(0);
    // The day begins, and the wait with it, from the second frame: he comes when STILL ticks of the day have gone, and not before.
    const dawn = 1000 + STILL * 3 + 10;
    await fake.feedAt(page, dawn, { time: DAY });
    await fake.feedAt(page, dawn + STILL - 1, { time: DAY });
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await fake.feedAt(page, dawn + STILL, { time: DAY });
    await expect(page.getByTestId("elder")).toBeVisible();
    await page.getByTestId("elder-close").click();
    // Li Da has promised the bamboo for tomorrow morning, and the task of the bamboo has nothing left to do but wait for it.
    const base = fake.tasksWhere({ t_bamboo_first: "open" }) as { tracked: string; tasks: Array<Record<string, unknown>> };
    const waiting = { tracked: base.tracked, tasks: base.tasks.map((task) => (task.id === "t_bamboo_first" ? { ...task, kind: "need", action: null, blocker: null } : task)) };
    const promised = dawn + STILL * 2;
    await fake.feedAt(page, promised, { ...waiting, ...fake.commitments("promised"), time: DAY });
    for (let tick = promised + 100; tick <= promised + STILL * 4; tick += 100) await fake.feedAt(page, tick, { time: DAY });
    await expect(page.getByTestId("elder")).toHaveCount(0);
    // The hour it was due comes and the bamboo has not: the player who is still waiting may be stuck, and the wait begins to count.
    const late = promised + STILL * 4 + 10;
    await fake.feedAt(page, late, { time: MORNING });
    await fake.feedAt(page, late + STILL - 1, { time: MORNING });
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await fake.feedAt(page, late + STILL, { time: MORNING });
    await expect(page.getByTestId("elder")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not come while the player is in a talk, or when the hints are off, or while a card of the tutorial is up", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedAt(page, 2000, { notebook: NOTEBOOK_TWO.slice(0, 1) });
    await fake.startTalk(page, "li_laotai");
    await fake.feedAt(page, 2000 + STILL * 3, { player: { ...(await fake.playerOf(page)) } });
    await expect(page.getByTestId("elder")).toHaveCount(0);
    // The talk ends, and he comes: the story has stood still all the while.
    await fake.feedAt(page, 2000 + STILL * 3 + 1, { player: { ...(await fake.playerOf(page)), talk: null, offers: {}, topics: [] } }, [{ kind: "talk_end", tick: 1, npc: "li_laotai", reason: "left" }]);
    await expect(page.getByTestId("elder")).toBeVisible();
    await page.getByTestId("elder-close").click();
    // Off in the settings: he does not come, whatever the tick.
    await page.evaluate(() => window.__lantern.play.guide.setHintsOn(false));
    await fake.feedAt(page, 2000 + STILL * 9);
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await page.evaluate(() => window.__lantern.play.guide.setHintsOn(true));
    // A tutorial that is on is the elder's own, and he does not come to say the same twice.
    await fake.beginTutorial(page);
    await fake.feedAt(page, 2000 + STILL * 12);
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await expect(page.getByTestId("tutorial-card")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the elder on a real game", () => {
  test("comes by himself when the player stands still, holds the world while he talks and lets it go when he is thanked", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await page.goto(`${lantern.servers.app.origin}/?pace=100`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await pressStart(page);
    await expect(page.getByTestId("status")).toHaveText("running");
    // Nothing is done for five hours of the game's clock.
    const sheet = page.getByTestId("elder");
    await expect(sheet).toBeVisible({ timeout: 60_000 });
    await expect(sheet).toHaveAttribute("data-visit", "true");
    await expect(page.getByTestId("elder-answer-1").getByTestId("elder-text")).toHaveText("Think about this. Go to the Li house and ask Granny Li to lend the bamboo.");
    // The world waits for him.
    const tick = await page.evaluate(() => window.__lantern.client.state.simTick);
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBe(tick);
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.getByTestId("elder-close").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.simTick)).toBeGreaterThan(tick);
    expect(lantern.pageErrors).toEqual([]);
  });
});
