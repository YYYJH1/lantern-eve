import type { Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The hints are in the menu, as a list that can be opened. What the world says on the first day is five things, said as the clan
// elder (his seal at the head of the line, a glow on the button, no window), and the cards that teach an act are in the same list.

test.use({ map: true });

async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: [], commitments: [], ...extras }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
}

const NOTEBOOK_TWO = [
  { id: "n_clerk", text: { zh: "李二昨晚在桥边。", en: "Li Er was at the bridge last night." }, source: { kind: "heard", who: { zh: "周家伙计", en: "Zhou's Clerk", id: "zhou_huoji" }, how: "saw" }, marks: [], chain: [] },
  { id: "n_broke", text: { zh: "李二昨晚把栏杆弄坏了。", en: "Li Er broke the bridge railing last night." }, source: { kind: "heard", who: { zh: "茶馆老板娘", en: "Teahouse Keeper", id: "cha_laoban" }, how: "unsure" }, marks: ["unconfirmed"], chain: [] },
];

const count = (text: string, n: number): string => text.replace("{n}", String(n));

/** Opens the list of hints in the menu, which is a closed line in its help, and leaves the menu open. */
async function openList(page: Page, lantern: LanternPage): Promise<void> {
  await lantern.openMenu();
  const list = page.getByTestId("hint-log");
  if ((await list.getAttribute("open")) === null) await page.getByTestId("btn-hints").click();
  await expect(list).toHaveAttribute("open", "");
}

test.describe("the list of hints in the menu", () => {
  test("is a line of the menu's help, with how many hints there are, and the corner has no button for it", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await expect(page.getByTestId("corner").locator('[data-testid="btn-hints"]')).toHaveCount(0);
    await expect(page.getByTestId("help-bar")).toHaveCount(0);
    await lantern.openMenu();
    await expect(page.getByTestId("menu-help").getByTestId("btn-hints")).toHaveText(count(en["hint.log.open"], 0));
    // Closed, it shows nothing of the hints; opened, it says there are none yet.
    await expect(page.getByTestId("hint-log-empty")).toBeHidden();
    await page.getByTestId("btn-hints").click();
    await expect(page.getByTestId("hint-log-empty")).toHaveText(en["hint.log.empty"]);
    await lantern.setLang("zh");
    await expect(page.getByTestId("btn-hints")).toHaveText(count(zh["hint.log.open"], 0));
    expect(await fake.fitsWidth(page)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lists what the world said, the newest first, each with when it was said, and lights it again where it was said", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO });
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "notebook");
    await openList(page, lantern);
    await expect(page.getByTestId("btn-hints")).toHaveText(count(en["hint.log.open"], 2));
    const entries = page.getByTestId("hint-log-entry");
    await expect(entries).toHaveCount(2);
    await expect(entries.nth(0)).toHaveAttribute("data-hint", "compare");
    await expect(entries.nth(0)).toContainText(en["cue.compare"]);
    await expect(entries.nth(1)).toHaveAttribute("data-hint", "notebook");
    await expect(entries.nth(1)).toContainText(en["cue.notebook"]);
    await expect(entries.nth(1).locator(".hint-log-when")).toHaveText("Day 1 08:30");
    // Showing one again closes the menu, and the button it is about glows with its line.
    await entries.nth(1).getByTestId("hint-show").click();
    await expect(page.getByTestId("menu")).toHaveAttribute("data-open", "false");
    await expect(page.getByTestId("btn-notebook")).toHaveClass(/is-signal/);
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "notebook");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says that the hints are off where the viewer turned them off", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await lantern.openMenu();
    await page.getByTestId("menu-hints").locator("input").uncheck();
    await page.getByTestId("btn-hints").click();
    await expect(page.getByTestId("hint-log-off")).toHaveText(en["hint.log.off"]);
    // A hint is not lit while they are off, and the list does not grow.
    await page.getByTestId("menu-close").click();
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO });
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    expect(await page.evaluate(() => window.__lantern.play.guide.hints.lit)).toBeNull();
  });
});

test.describe("what the world says on the first day", () => {
  test("is said as the clan elder, with his seal at the head of the line, and is no window", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
    const pill = page.getByTestId("hint-pill");
    await expect(pill).toHaveAttribute("data-hint", "blocked");
    await expect(pill).toContainText(en["cue.blocked"]);
    await expect(pill).toHaveAttribute("data-card", "false");
    // His seal is the one on the tutorial card, smaller, and the line has no title: it is not a card.
    await expect(pill.locator(".tut-token")).toBeVisible();
    await expect(pill.getByTestId("hint-pill-title")).toHaveCount(0);
    // The slip is what is lit, and nothing is a dialog: no window took the keyboard.
    await expect(page.getByTestId("task-card")).toHaveClass(/is-signal/);
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
    await lantern.switchLang("zh");
    // The signal goes out nine seconds after it was lit, which a slow machine can take between the calls of this test: it is lit again for the look.
    await fake.relight(page, "blocked");
    await expect(pill).toContainText(zh["cue.blocked"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are five: the first line of the notebook, two lines to set side by side, what is in the way, the telling to follow back, and the teahouse", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    const ids = (): Promise<string[]> => page.evaluate(() => window.__lantern.play.guide.hints.log.map((entry) => entry.id));
    await fake.feedFrame(page, { notebook: NOTEBOOK_TWO, ...fake.tasks("t_bamboo_first") });
    // The occasion at the teahouse in the evening is the core's `t_tea_tonight`.
    const tea = { id: "t_tea_tonight", kind: "venue", job: "truth", text: { zh: "傍晚茶馆", en: "The teahouse this evening" }, why: null, next: null, state: "open", blocker: null, action: null, window: { day: 1, from: 17, to: 19, place: "p_teahouse" } };
    await fake.feedFrame(page, { tracked: "t_bamboo_first", tasks: [...(fake.tasks("t_bamboo_first").tasks as unknown[]), tea] });
    expect((await ids()).filter((id) => !id.startsWith("teach."))).toEqual(["notebook", "compare", "blocked", "evening"]);
    // Each says its own words: the cues of the story are `cue.*`, and the one about the evening keeps the words it had.
    const words = await page.evaluate(() => window.__lantern.play.guide.hints.log.filter((entry) => entry.act === null).map((entry) => entry.text));
    expect(words).toEqual(["cue.notebook", "cue.compare", "cue.blocked", "hint.evening"]);
    // What was a hint before, and is not now: the tags of a talk, the badge of the hour, the way to follow another task, a lead, the promise.
    for (const gone of ["chips", "leaves", "track", "lead", "promised", "speak", "opened"]) expect(await ids()).not.toContain(gone);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says the telling is to be followed back, and lights the button of the slip, or the slip itself for a player of the brief guidance", async ({ lantern }) => {
    const who = { id: "t_who_said", kind: "lead", job: "truth", text: { zh: "这话是谁传出来的", en: "Who started this talk" }, why: null, next: { zh: "问李老太听谁说的", en: "Ask Granny Li who told her" }, state: "open", blocker: null, action: { verb: "ask_source", npc: "li_laotai" }, window: null };
    for (const brief of [false, true]) {
      await test.step(brief ? "the brief guidance" : "the full guidance", async () => {
        const page = lantern.page;
        await guided(lantern);
        if (brief) await page.evaluate(() => window.__lantern.play.guide.setGuidance("brief"));
        await fake.feedFrame(page, { tracked: "t_who_said", tasks: [who] });
        const pill = page.getByTestId("hint-pill");
        await expect(pill).toHaveAttribute("data-hint", "source");
        await expect(pill).toContainText(brief ? en["cue.source.brief"] : en["cue.source"]);
        await expect(brief ? page.getByTestId("task-card") : page.getByTestId("task-do")).toHaveClass(/is-signal/);
        if (brief) await expect(page.getByTestId("task-do")).toHaveCount(0);
        await page.evaluate(() => window.__lantern.play.guide.setGuidance("full"));
      });
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});
