import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The end of the first day on a page of fake frames, with the world held at tick 300 so that what a test feeds stays as it was fed: the
// card that says the first day is done (when it comes, what it says, that it holds the world), the words of the top bar and of the task
// card when nothing is left to follow, and the clan elder who stays home and still answers.
test.use({ map: true });

const WORDS = {
  en: {
    title: "The first day is done",
    reached: "The first bamboo has reached the Stone Bridge. The festival is on the night of the fifth day. Before then: gather the bamboo and the timber, and mend the bridge; find out how the bridge broke and tell the town; make peace between the two families.",
    keep: "Keep playing",
    idleTop: "Nothing to follow right now",
    idleTask: "Everything on the list is done. Look around if you like, and wait for the festival on the night of the fifth day.",
    overTop: "The festival is over",
    overTask: "The festival is over.",
    pick: "Pick something to follow",
    none: "Nothing is being followed. Pick one of the tasks below.",
    running: "running",
  },
  zh: {
    title: "第一天完成",
    reached: "第一批竹料送到了石桥。灯会在第五天晚上，在那之前还要：凑齐竹料和木料，把桥修好；查清桥是怎么坏的，当众说清；让两家和解。",
    keep: "接着玩",
    idleTop: "眼下没有要追的事",
    idleTask: "事项都办完了，可以四处走走，等第五天晚上的灯会。",
    overTop: "灯会已过",
    overTask: "灯会办完了。",
    pick: "挑一件事来追",
    none: "还没有追哪一件。从下面挑一件。",
    running: "进行中",
  },
} as const;

const DONE_ALL = { t_bamboo_first: "done", t_source: "done", t_evening: "done", t_promise: "done" };
/** The frame after the bamboo reached the bridge: every task is done, and the core follows none. */
const done = (time: { day: number; hour: number; minute: number }): Record<string, unknown> => ({ ...fake.tasksWhere(DONE_ALL, null), time: { ...time, phase: "day" } });
const OPEN = fake.tasksWhere({ t_bamboo_first: "open" });

/** The ticks the story may stand still before the elder comes by. */
const STILL = 600;

/**
 * The first day with the help on and taking the frame it was fed as what was true from the start: the task of the bamboo is open, the
 * notebook and the promises are empty. Only what a test feeds after this is news to the help.
 */
async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern, { ...OPEN, notebook: [], commitments: [], ...extras }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

const holdOn = (page: Page): Promise<boolean> => page.evaluate(() => window.__lantern.play.hold.active);

test.describe("the card that says the first day is done", () => {
  test("comes after the recap card is put away, says it in the words of the game, and holds the world until the player goes on", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    const card = page.getByTestId("end-card");
    // The bamboo lands at half past six: the card waits for the recap, which comes at seven, and for the player to put it away.
    await fake.feedFrame(page, done({ day: 2, hour: 6, minute: 30 }));
    await expect(card).toHaveCount(0);
    // A frame shows the clock after its tick, so the one before the recap's reads seven already.
    await fake.feedFrame(page, done({ day: 2, hour: 7, minute: 0 }));
    await expect(card).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    await fake.feedFrame(page, { ...done({ day: 2, hour: 7, minute: 0 }), ...fake.recap() }, [{ kind: "recap", tick: 900, lines: 3 }]);
    await expect(page.getByTestId("recap")).toBeVisible();
    await fake.feedFrame(page, { ...done({ day: 2, hour: 7, minute: 1 }), recap: null });
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(card).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    await page.getByTestId("recap-done").click();
    await expect(page.getByTestId("recap")).toHaveCount(0);
    // Put away, the recap makes room for the card, which comes without another frame, and the world waits for it.
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("role", "dialog");
    await expect(page.getByTestId("end-title")).toHaveText(WORDS.en.title);
    await expect(page.getByTestId("end-reached")).toHaveText(WORDS.en.reached);
    // The card names what the days after ask for, and says nothing of the elder: he comes by again while a task is live.
    await expect(page.getByTestId("end-more")).toHaveCount(0);
    await expect(page.getByTestId("end-card")).not.toContainText(/elder|族长/);
    await expect(page.getByTestId("end-close")).toHaveText(WORDS.en.keep);
    await expect(page.getByTestId("end-close")).toBeFocused();
    expect(await holdOn(page)).toBe(true);
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    await expect(page.getByTestId("btn-elder")).toBeDisabled();
    // Frames that come while it is up neither take it away nor bring it twice, and it is the only card.
    await fake.feedFrame(page, { ...done({ day: 2, hour: 7, minute: 2 }), recap: null });
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
    // One button, and it lets the world go.
    await page.getByTestId("end-close").click();
    await expect(card).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    await expect(page.getByTestId("btn-pause")).toBeEnabled();
    await expect(page.getByTestId("btn-elder")).toBeEnabled();
    // It was once for the game: not for the frames after it, not when the task is done again.
    await fake.feedFrame(page, done({ day: 2, hour: 8, minute: 0 }));
    await fake.feedFrame(page, { ...fake.tasksWhere({ ...DONE_ALL, t_promise: "open" }, "t_promise"), time: { day: 2, hour: 9, minute: 0, phase: "day" } });
    await fake.feedFrame(page, done({ day: 2, hour: 10, minute: 0 }));
    await expect(card).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("comes at once for a bamboo that lands after seven, and the keyboard puts it away: Enter on its button, and Escape", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    // A promise made in the day falls due two hours later.
    await fake.feedFrame(page, done({ day: 1, hour: 13, minute: 5 }));
    await expect(page.getByTestId("end-card")).toBeVisible();
    await expect(page.getByTestId("end-close")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    // Escape does the same, in a game of its own.
    await page.evaluate(() => window.__lantern.play.guide.reset());
    await fake.feedFrame(page, { ...OPEN, time: { day: 2, hour: 8, minute: 0, phase: "day" } });
    await fake.feedFrame(page, done({ day: 2, hour: 9, minute: 15 }));
    await expect(page.getByTestId("end-card")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("waits behind the clan elder and behind what the people said, and is not for a game that began with the bamboo at the bridge", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await page.getByTestId("btn-elder").click();
    await expect(page.getByTestId("elder")).toBeVisible();
    await fake.feedFrame(page, done({ day: 1, hour: 13, minute: 5 }));
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    await page.getByTestId("elder-close").click();
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await expect(page.getByTestId("end-card")).toBeVisible();
    await page.getByTestId("end-close").click();

    // What the people said at the teahouse is up when the bamboo lands.
    await page.evaluate(() => window.__lantern.play.guide.reset());
    await fake.feedFrame(page, { ...OPEN, time: { day: 1, hour: 18, minute: 0, phase: "day" } });
    await fake.feedFrame(page, { ...done({ day: 1, hour: 18, minute: 30 }), notebook: fake.notebook() }, [fake.clarified()]);
    await expect(page.getByTestId("clarify")).toBeVisible();
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    await page.getByTestId("clarify-done").click();
    await expect(page.getByTestId("end-card")).toBeVisible();
    await page.getByTestId("end-close").click();

    // A game whose first frame has the bamboo at the bridge (one that was loaded) has nothing to say about it.
    await page.evaluate(() => window.__lantern.play.guide.reset());
    await fake.feedFrame(page, done({ day: 2, hour: 9, minute: 0 }));
    await fake.feedFrame(page, done({ day: 2, hour: 9, minute: 5 }));
    await fake.feedFrame(page, done({ day: 2, hour: 12, minute: 0 }));
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not on a page that was made for a game named in its address", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { ...OPEN, notebook: [], commitments: [] });
    await fake.feedFrame(page, done({ day: 1, hour: 13, minute: 5 }));
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    // The words of the bar are the frame's and not the help's, so they are there all the same.
    await expect(page.getByTestId("topbar-task-text")).toHaveText(WORDS.en.idleTop);
    expect(lantern.pageErrors).toEqual([]);
  });
});

/** The elder's three answers when the days after have nothing open now. */
const ELDER_IDLE = {
  en: [
    "Nothing on the list is left to follow. Look around as you like, and be ready for the festival on the night of the fifth day.",
    "No task asks you to compare any lines now. Any two lines in your notebook can be set side by side whenever you like.",
    "Nothing has to be done right now. Go where you like and ask whom you like until the festival on the night of the fifth day.",
  ],
  zh: [
    "眼下没有哪件事要追。你随意走走看看，等第五天晚上的灯会就好。",
    "眼下没有哪个事项要你对照哪两句。见闻簿里的话，想并排放着看，随时都行。",
    "眼下没有非办不可的事。想去哪里、问谁都行，等到第五天晚上的灯会。",
  ],
} as const;

/** The festival night has come and gone: the ending, in the least it can say. */
const ENDING = { kind: "ending", tick: 9000, ending: "ending_perfect", label: { zh: "圆满", en: "Perfect" }, hidden: [], inputs: { bridge_fixed: true, detour_done: false, reconciled: true, truth_told: true }, passage: "mended", promised: 9, turnout: 1500 };

// A game with no task open is not one that is over.
test.describe("a game with nothing open", () => {
  test("says there is nothing to follow now and what to do meanwhile, in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, done({ day: 2, hour: 9, minute: 0 }));
    // The card of the first day comes all the same, and is put away.
    await page.getByTestId("end-close").click();
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = WORDS[lang];
        await expect(page.getByTestId("topbar-task-text")).toHaveText(w.idleTop);
        await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "idle");
        await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-id", "");
        await expect(page.getByTestId("task-text")).toHaveText(w.idleTask);
        await expect(page.getByTestId("task-card")).toHaveAttribute("data-state", "none");
        await expect(page.getByTestId("task-more")).toHaveCount(0);
        await expect(page.getByTestId("task-do")).toHaveCount(0);
        expect(await fake.contrast(page, '[data-testid="topbar-task-text"]'), `${theme} ${lang} bar`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="task-text"]'), `${theme} ${lang} card`).toBeGreaterThan(4.5);
        expect(await fake.overflows(page, '[data-testid="topbar-task-text"]')).toBe(false);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    // With a task open and none followed, the words ask the player to pick one.
    await fake.feedFrame(page, fake.laterTasks(null));
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      await expect(page.getByTestId("topbar-task-text")).toHaveText(WORDS[lang].pick);
      await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "none");
      await expect(page.getByTestId("task-text")).toHaveText(WORDS[lang].none);
    }
    // Nothing is open and the bamboo did not come: still nothing to follow.
    await fake.feedFrame(page, fake.tasksWhere({ ...DONE_ALL, t_bamboo_first: "stale" }, null));
    await expect(page.getByTestId("topbar-task-text")).toHaveText(WORDS.zh.idleTop);
    // The festival has been held: the words say so, and no longer say to wait for it.
    await fake.feedFrame(page, done({ day: 5, hour: 22, minute: 0 }), [ENDING]);
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      await expect(page.getByTestId("topbar-task-text")).toHaveText(WORDS[lang].overTop);
      await expect(page.getByTestId("topbar-task")).toHaveAttribute("data-state", "over");
      await expect(page.getByTestId("task-text")).toHaveText(WORDS[lang].overTask);
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has the elder answer that nothing is left and that the festival is to come, and come by again when a task is left", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.recordSent(page);
    await fake.feedAt(page, 1000, done({ day: 2, hour: 9, minute: 0 }));
    await page.getByTestId("end-close").click();
    for (let tick = 1100; tick <= 1000 + STILL * 3; tick += 100) await fake.feedAt(page, tick, done({ day: 2, hour: 9, minute: 0 }));
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await page.getByTestId("btn-elder").click();
    for (const level of [1, 2, 3]) await page.getByTestId(`elder-level-${level}`).click();
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      for (const level of [1, 2, 3]) {
        await expect(page.getByTestId(`elder-answer-${level}`)).toHaveAttribute("data-from", "idle");
        await expect(page.getByTestId(`elder-answer-${level}`).getByTestId("elder-text")).toHaveText(ELDER_IDLE[lang][level - 1] ?? "");
      }
    }
    await page.getByTestId("elder-close").click();
    // A task is open and the story stands still: he comes by.
    await fake.feedAt(page, 5000, { ...fake.laterTasks(null), time: { day: 2, hour: 9, minute: 0, phase: "day" } });
    await fake.feedAt(page, 5000 + STILL - 1, {});
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await fake.feedAt(page, 5000 + STILL, {});
    await expect(page.getByTestId("elder")).toHaveAttribute("data-visit", "true");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the card of the morning", () => {
  const AT_SEVEN = { time: { day: 2, hour: 7, minute: 0, phase: "day" } };
  const RECAP_EVENT = [{ kind: "recap", tick: 900, lines: 3 }];

  test("ends with what to do today: the task that is followed with its time and place, else the most urgent one, and no line when there is none", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.recap(), ...AT_SEVEN }, RECAP_EVENT);
    const today = page.getByTestId("recap-today");
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(page.getByTestId("recap-line")).toHaveCount(3);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("en");
      await expect(today).toHaveText("Today: Ask Li Da for another batch of bamboo, Li Family House, Day 2 08:00 to 17:00");
      expect(await fake.contrast(page, '[data-testid="recap-today"]'), `${theme} en`).toBeGreaterThan(4.5);
      await lantern.setLang("zh");
      await expect(today).toHaveText("今天：再请李大送一批竹料，李家宅，第二日 辰时 08:00 到 17:00");
      expect(await fake.contrast(page, '[data-testid="recap-today"]'), `${theme} zh`).toBeGreaterThan(4.5);
    }
    // It is the last thing on the card, after the three lines and before the button.
    const order = await page.getByTestId("recap").evaluate((card) => Array.from(card.querySelectorAll('[data-testid="recap-lines"], [data-testid="recap-today"], [data-testid="recap-done"]')).map((el) => el.getAttribute("data-testid")));
    expect(order).toEqual(["recap-lines", "recap-today", "recap-done"]);
    // Another task followed, or none followed: the most urgent that is open.
    await lantern.setLang("en");
    await fake.feedFrame(page, fake.laterTasks("t_timber"));
    await expect(today).toHaveText("Today: Ask Shopkeeper Zhou for the timber");
    await fake.feedFrame(page, fake.laterTasks(null, { t_bamboo_more: "done" }));
    await expect(today).toHaveText("Today: Ask Shopkeeper Zhou for the timber");
    // Nothing open: no line, and the card is the three lines as before.
    await fake.feedFrame(page, done({ day: 2, hour: 7, minute: 5 }));
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(today).toHaveCount(0);
    await expect(page.getByTestId("recap-line")).toHaveCount(3);
    expect(lantern.pageErrors).toEqual([]);
  });

});

test.describe("the look of the card", () => {
  test("is readable and fits the sheet in both languages and themes, and is one card with one button", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, done({ day: 1, hour: 13, minute: 5 }));
    await expect(page.getByTestId("end-card")).toBeVisible();
    await expect(page.getByTestId("end-card").locator("button")).toHaveCount(1);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = WORDS[lang];
        await expect(page.getByTestId("end-title")).toHaveText(w.title);
        await expect(page.getByTestId("end-reached")).toHaveText(w.reached);
        await expect(page.getByTestId("end-close")).toHaveText(w.keep);
        for (const id of ["end-title", "end-reached", "end-close"]) {
          expect(await fake.contrast(page, `[data-testid="${id}"]`), `${theme} ${lang} ${id}`).toBeGreaterThan(4.5);
        }
        const box = await page.getByTestId("end-card").boundingBox();
        const stage = await page.locator("#stage").boundingBox();
        expect(box?.x ?? -1, `${theme} ${lang} left`).toBeGreaterThanOrEqual(stage?.x ?? 0);
        expect((box?.x ?? 0) + (box?.width ?? 9999), `${theme} ${lang} right`).toBeLessThanOrEqual((stage?.x ?? 0) + (stage?.width ?? 0) + 0.5);
        await expect(page.getByTestId("end-close")).toBeInViewport();
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

});

test.describe("the card on a real game", () => {
  test("does not come while the first day is being played: a game that has just begun has the bamboo to get", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await page.goto(`${lantern.servers.app.origin}/?pace=100`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText(WORDS.en.running);
    // The bar has the first task and the card is nowhere.
    await expect(page.getByTestId("topbar-task-text")).toHaveText("Get the first bamboo from the Li family");
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
