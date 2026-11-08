import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The paper of the morning and the summary of the night on a page of fake frames, with the world held at tick 300 so that what a test feeds
// stays as it was fed: what each card says in both languages and both themes, that each holds the world until it is put away, the order the
// sheets come in, and the setting that turns the night off. A morning of a core that has no paper is the recap of before.
test.use({ map: true });

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";
const AT_SEVEN = { time: { day: 2, hour: 7, minute: 0, phase: "day" } };
const AT_DUSK = { time: { day: 1, hour: 21, minute: 0, phase: "night" } };
const OPEN = fake.tasksWhere({ t_bamboo_first: "open" });

/** The first day with the help on, taking the frame it was fed as what was true from the start. */
async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern, { ...OPEN, notebook: [], commitments: [], ...extras }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

const holdOn = (page: Page): Promise<boolean> => page.evaluate(() => window.__lantern.play.hold.active);

/** A picture of the page, taken when LANTERN_SHOTS_DIR names a folder. */
async function snap(page: Page, name: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SHOTS, `paper-${name}.png`) });
}

const EN = {
  head: "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.",
  news: ["Granny Li no longer stands in the way.", "Li Da promised to bring 4 poles of bamboo."],
  talk: ["The street talks of little else than the festival, and people are already counting the lanterns at each door.", "The street has split into two camps, one for the Li family and one for the Zhou family, and neither can win the other over."],
  title: "The Town Gazette",
  issue: "Day 2, morning",
  today: "The rest of the bamboo",
  when: "Stone Bridge, 06:00 to 09:00",
  next: "Next: Be at the bridge at the agreed time and see the bamboo arrive.",
  more: "Tell the town how the bridge broke",
  moreWhen: "Teahouse, 17:00 to 19:00",
} as const;

const ZH = {
  head: "李大答应的四根竹料，已经送到石桥。",
  news: ["李老太撤回了阻拦。", "李大答应送来四根竹料。"],
  talk: ["街上都在说灯会，哪家挂几盏灯，已经有人在数了。", "街上分成了两拨，一拨向着李家，一拨向着周家，谁也说不服谁。"],
  title: "镇报",
  issue: "第二日，清晨",
  today: "凑齐竹料",
  when: "石桥，卯时 06:00 到 09:00",
  next: "下一步：按约好的时间去桥边，看竹料送到没有。",
  more: "当众把桥的事说清楚",
  moreWhen: "茶馆，酉时 17:00 到 19:00",
} as const;

test.describe("the paper of the morning", () => {
  test("is the card of the morning when the core has the paper, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.gazette(), ...AT_SEVEN }, [{ kind: "recap", tick: 900, lines: 3 }]);
    const card = page.getByTestId("gazette");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("role", "dialog");
    await expect(page.getByTestId("recap")).toHaveCount(0); // the paper is the card, not the recap beside it
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        const words = lang === "en" ? EN : ZH;
        await lantern.setLang(lang);
        await expect(page.getByTestId("gazette-title")).toHaveText(words.title);
        await expect(page.getByTestId("gazette-issue")).toContainText(words.issue);
        await expect(page.getByTestId("gazette-head")).toHaveText(words.head);
        await expect(page.getByTestId("gazette-head")).toHaveAttribute("data-kind", "delivery");
        await expect(page.getByTestId("gazette-item")).toHaveText(words.news);
        await expect(page.getByTestId("gazette-talk-line")).toHaveText(words.talk);
        await expect(page.getByTestId("gazette-today")).toHaveAttribute("data-id", "t_bamboo_rest");
        await expect(page.getByTestId("gazette-today-task")).toHaveText(words.today);
        await expect(page.getByTestId("gazette-today-when")).toHaveText(words.when);
        await expect(page.getByTestId("gazette-today-next")).toHaveText(words.next);
        // The words of the next step may end in a stop of their own: the line adds none, so there is never a pair of them.
        await expect(page.locator(".gazette-today-line")).not.toContainText(/。。|\.\./);
        await expect(page.getByTestId("gazette-chance")).toHaveCount(1);
        await expect(page.getByTestId("gazette-chance-task")).toHaveText(words.more);
        await expect(page.getByTestId("gazette-chance-when")).toHaveText(words.moreWhen);
        for (const id of ["gazette-title", "gazette-head", "gazette-today-task", "gazette-today-when", "gazette-today-next", "gazette-issue"]) {
          expect(await fake.contrast(page, `[data-testid="${id}"]`), `${theme} ${lang} ${id}`).toBeGreaterThan(4.5);
        }
        expect(await fake.contrast(page, '[data-testid="gazette-talk-line"]'), `${theme} ${lang} talk`).toBeGreaterThan(4.5);
        await snap(page, `gazette-${lang}-${theme}-desktop`);
      }
    }
    // The order of the card: the masthead, the headline, the short items, the street talk, what is on today, the button.
    const order = await card.evaluate((el) =>
      Array.from(el.querySelectorAll('[data-testid="gazette-title"], [data-testid="gazette-head"], [data-testid="gazette-news"], [data-testid="gazette-talk"], [data-testid="gazette-today"], [data-testid="gazette-done"]')).map((e) => e.getAttribute("data-testid")),
    );
    expect(order).toEqual(["gazette-title", "gazette-head", "gazette-news", "gazette-talk", "gazette-today", "gazette-done"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("ends each of the other things of the day in a stop of its own, so that two of them do not run into one another", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    const more = (id: string, zh: string, en: string) => ({ id, text: { zh, en }, state: "open", window: { day: 2, from: 17, to: 19, place: "p_teahouse" }, next: null });
    const two = [more("t_a", "取得周家的木料", "Get the timber from the Zhou family"), more("t_b", "备好绕路", "Get a detour ready")];
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.gazette({ more: two }), ...AT_SEVEN }, [{ kind: "recap", tick: 900, lines: 3 }]);
    await expect(page.getByTestId("gazette-chance")).toHaveCount(2);
    for (const [lang, stop] of [
      ["en", ". "],
      ["zh", "。"],
    ] as const) {
      await lantern.setLang(lang);
      const stops = await page.getByTestId("gazette-chance").evaluateAll((els) => els.map((el) => getComputedStyle(el, "::after").content));
      expect(stops, lang).toEqual([`"${stop}"`, `"${stop}"`]);
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("holds the world while it is up, lets it go when it is put away, and the keyboard puts it away", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    expect(await holdOn(page)).toBe(false);
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.gazette(), ...AT_SEVEN });
    await expect(page.getByTestId("gazette")).toBeVisible();
    expect(await holdOn(page)).toBe(true);
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    await expect(page.getByTestId("gazette-done")).toBeFocused();
    // the frames after it have none, and the card stays
    await fake.feedFrame(page, { gazette: null, recap: null, time: { day: 2, hour: 7, minute: 5, phase: "day" } });
    await expect(page.getByTestId("gazette")).toBeVisible();
    expect(await holdOn(page)).toBe(true);
    await page.getByTestId("gazette-done").click();
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    await expect(page.getByTestId("btn-pause")).toBeEnabled();
    // the same paper is not shown again; the next day's is, and Escape puts it away
    await fake.feedFrame(page, { ...fake.gazette(), ...AT_SEVEN });
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    await fake.feedFrame(page, { ...fake.gazette({ day: 3 }), time: { day: 3, hour: 7, minute: 0, phase: "day" } });
    await expect(page.getByTestId("gazette")).toBeVisible();
    await expect(page.getByTestId("gazette-issue")).toContainText("Day 3");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("on a quiet morning has a headline, no short items and no recap lines, and with nothing to recommend says so", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    const quiet = { kind: "quiet", text: { zh: "昨天镇上没有什么大事。", en: "Nothing much happened in town yesterday." } };
    await fake.feedFrame(page, { gazette: fake.gazetteBody({ head: quiet, news: [], today: null, more: [], talk: [] }), recap: null, ...AT_SEVEN });
    await expect(page.getByTestId("gazette-head")).toHaveText("Nothing much happened in town yesterday.");
    await expect(page.getByTestId("gazette-item")).toHaveCount(0);
    await expect(page.getByTestId("gazette-talk-line")).toHaveCount(0);
    await expect(page.getByTestId("gazette-chance")).toHaveCount(0);
    await expect(page.getByTestId("gazette-today-none")).toHaveText("Nothing is set for today. Walk the town, or ask the clan elder.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("gazette-today-none")).toHaveText("今天没有定下的事。可以在镇上走走，也可以去问问族长。");
    await expect(page.getByTestId("gazette-done")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is the recap of before on a core that has no paper: the same card, the same lines, and the world is not held", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.recap(), ...AT_SEVEN }, [{ kind: "recap", tick: 900, lines: 3 }]);
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(page.getByTestId("recap-line")).toHaveCount(3);
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("comes after the clan elder and what the people said, and the card of the first day comes after it", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    // the elder is up when the paper arrives: the paper waits, and the world is held for either
    await page.getByTestId("btn-elder").click();
    await expect(page.getByTestId("elder")).toBeVisible();
    await fake.feedFrame(page, { ...fake.laterTasks("t_bamboo_more"), ...fake.gazette(), ...AT_SEVEN });
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    expect(await holdOn(page)).toBe(true);
    await page.getByTestId("elder-close").click();
    await expect(page.getByTestId("gazette")).toBeVisible();
    expect(await holdOn(page)).toBe(true);
    // the first day is done while the paper is up: its card is not up with it, and comes when the paper is put away
    const done = { ...fake.tasksWhere({ t_bamboo_first: "done", t_source: "done", t_evening: "done", t_promise: "done" }, null), time: { day: 2, hour: 7, minute: 10, phase: "day" } };
    await fake.feedFrame(page, { ...done, gazette: null, recap: null });
    await expect(page.getByTestId("end-card")).toHaveCount(0);
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(1);
    await page.getByTestId("gazette-done").click();
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    await expect(page.getByTestId("end-card")).toBeVisible();
    expect(await holdOn(page)).toBe(true);
    await page.getByTestId("end-close").click();
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

});

const NIGHT_EN = {
  title: "Tonight in short",
  changed: "Li Da promised to bring 4 poles of bamboo.",
  blocked: "Get the timber from the Zhou family",
  blocker: "Shopkeeper Zhou has not agreed yet",
  step: "Get the first bamboo from the Li family",
  when: "Stone Bridge, 06:00 to 07:00",
  none: ["Nothing stands in your way for now.", "Nothing is set for tomorrow."],
  done: "Rest for the night",
} as const;

const NIGHT_ZH = {
  title: "夜里小结",
  changed: "李大答应送来四根竹料。",
  blocked: "取得周家的木料",
  blocker: "周掌柜还没松口",
  step: "取得李家的第一批竹料",
  when: "石桥，卯时 06:00 到 07:00",
  none: ["眼下没有什么拦着你。", "明天没有定下的事。"],
  done: "歇下",
} as const;

test.describe("the summary of the night", () => {
  test("says what changed, what is in the way and the first step of tomorrow, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, { ...fake.night(), ...AT_DUSK });
    const card = page.getByTestId("night");
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("role", "dialog");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        const words = lang === "en" ? NIGHT_EN : NIGHT_ZH;
        await lantern.setLang(lang);
        await expect(card).toHaveAttribute("aria-label", words.title);
        await expect(page.getByTestId("night-changed-text")).toHaveText(words.changed);
        await expect(page.getByTestId("night-blocked")).toHaveAttribute("data-id", "t_timber");
        await expect(page.getByTestId("night-blocked-text")).toHaveText(lang === "en" ? `${words.blocked}, ${words.blocker}.` : `${words.blocked}，${words.blocker}。`);
        await expect(page.getByTestId("night-step")).toHaveAttribute("data-id", "t_bamboo_first");
        await expect(page.getByTestId("night-step-text")).toContainText(words.step);
        await expect(page.getByTestId("night-step-when")).toHaveText(words.when);
        await expect(page.getByTestId("night-done")).toHaveText(words.done);
        for (const id of ["night-changed-text", "night-blocked-text", "night-step-text", "night-step-when", "night-issue"]) {
          expect(await fake.contrast(page, `[data-testid="${id}"]`), `${theme} ${lang} ${id}`).toBeGreaterThan(4.5);
        }
        await snap(page, `night-${lang}-${theme}-desktop`);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says so when nothing stands in the way and nothing is set for tomorrow", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, { ...fake.night({ blocked: null, step: null }), ...AT_DUSK });
    await expect(page.getByTestId("night-blocked-text")).toHaveText(NIGHT_EN.none[0]);
    await expect(page.getByTestId("night-step-text")).toHaveText(NIGHT_EN.none[1]);
    await lantern.setLang("zh");
    await expect(page.getByTestId("night-blocked-text")).toHaveText(NIGHT_ZH.none[0]);
    await expect(page.getByTestId("night-step-text")).toHaveText(NIGHT_ZH.none[1]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("holds the world until it is put away, once for each night, and waits behind the paper of the morning", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await fake.feedFrame(page, { ...fake.night(), ...AT_DUSK });
    await expect(page.getByTestId("night")).toBeVisible();
    expect(await holdOn(page)).toBe(true);
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    await fake.feedFrame(page, { night: null });
    await expect(page.getByTestId("night")).toBeVisible();
    await page.getByTestId("night-done").click();
    await expect(page.getByTestId("night")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    await fake.feedFrame(page, { ...fake.night(), ...AT_DUSK });
    await expect(page.getByTestId("night")).toHaveCount(0); // the same night
    // a morning's paper and the night come together: the paper first, then the night, and the world is held all the while
    await fake.feedFrame(page, { ...fake.gazette(), ...fake.night({ day: 2 }), ...AT_SEVEN });
    await expect(page.getByTestId("gazette")).toBeVisible();
    await expect(page.getByTestId("night")).toHaveCount(0);
    await page.getByTestId("gazette-done").click();
    await expect(page.getByTestId("night")).toBeVisible();
    expect(await holdOn(page)).toBe(true);
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("night")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("can be turned off in the menu, and then none comes, and it is remembered", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { board: fake.boardKey() });
    await lantern.openMenu();
    const box = page.getByTestId("menu-night").locator("input");
    await expect(box).toBeChecked();
    await expect(page.getByTestId("menu-night")).toContainText("Summary at nightfall");
    await box.uncheck();
    expect(await page.evaluate(() => localStorage.getItem("lantern.night"))).toBe("off");
    await page.getByTestId("menu-close").click();
    await fake.feedFrame(page, { ...fake.night(), ...AT_DUSK });
    await expect(page.getByTestId("night")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    // a night that is up goes when it is turned off
    await lantern.openMenu();
    await box.check();
    expect(await page.evaluate(() => localStorage.getItem("lantern.night"))).toBe("on");
    await page.getByTestId("menu-close").click();
    await fake.feedFrame(page, { ...fake.night({ day: 2 }), time: { day: 2, hour: 21, minute: 0, phase: "night" } });
    await expect(page.getByTestId("night")).toBeVisible();
    await lantern.openMenu();
    await box.uncheck();
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("night")).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    // the paper of the morning is not touched by it
    await fake.feedFrame(page, { ...fake.gazette(), ...AT_SEVEN });
    await expect(page.getByTestId("gazette")).toBeVisible();
    await lantern.setLang("zh");
    await lantern.openMenu();
    await expect(page.getByTestId("menu-night")).toContainText("夜里小结");
    expect(lantern.pageErrors).toEqual([]);
  });

});
