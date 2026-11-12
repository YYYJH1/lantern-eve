import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { feedPeople, known, MORNING, peopleRows, stamp } from "../support/people.ts";
import * as fake from "../support/slice.ts";
import * as statement from "../support/statement.ts";
import { drawing } from "../support/sprites.ts";
import { pressStart } from "../support/start.ts";

// This spec looks at the page with the map on it: the people book is a page of the notebook, and the tags over the heads are drawn on the map.
test.use({ map: true });

const openNotebook = async (page: Page): Promise<void> => {
  await page.getByTestId("btn-notebook").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
};

const openPeople = async (page: Page): Promise<void> => {
  await openNotebook(page);
  await page.getByTestId("workspace-tab-people").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "people");
  await expect(page.getByTestId("people-leaf")).toBeVisible();
};

/** The text of an element with the runs of white space made one space, as a reader sees it. */
const textOf = async (page: Page, testid: string): Promise<string> => ((await page.getByTestId(testid).innerText()) ?? "").replace(/\s+/g, " ").trim();

test.describe("the page of the first six", () => {
  test("comes after Start and before the first card of the tutorial, with the six people of the design, their lines and what comes next", async ({ lantern }) => {
    const page = lantern.page;
    await page.goto(`${lantern.servers.app.origin}/?pace=10`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByTestId("opening-people")).toHaveCount(0);
    await page.getByTestId("opening-start").click();
    // The six people, in the order of the design, with the line the town says of each: the scene's own, the same for everyone.
    const six = page.getByTestId("people-six-person");
    await expect(six).toHaveCount(6);
    expect(await six.evaluateAll((items) => items.map((item) => item.getAttribute("data-person")))).toEqual(["zuzhang", "li_laotai", "li_er", "li_da", "zhou_zhanggui", "zhou_huoji"]);
    const cast = await page.evaluate(() => (window.__lantern.client.state.scene as unknown as { cast: Array<{ id: string; zh: string; en: string; intro: { zh: string; en: string } }> }).cast);
    for (const [index, id] of ["zuzhang", "li_laotai", "li_er", "li_da", "zhou_zhanggui", "zhou_huoji"].entries()) {
      const person = cast.find((p) => p.id === id);
      expect(person, id).toBeDefined();
      await expect(six.nth(index).getByTestId("people-six-name")).toHaveText(person?.en ?? "");
      await expect(six.nth(index).getByTestId("people-six-intro")).toHaveText(person?.intro.en ?? "");
    }
    await expect(page.getByTestId("people-more")).toHaveText("A dozen or so more people live in town. You will get to know them when you meet.");
    // Their portraits are cut from the sprites of the map.
    await expect(page.locator('[data-testid="portrait"][data-drawn="true"]')).toHaveCount(6, { timeout: 30_000 });
    // The world is held behind the page, and the tutorial has not begun.
    const tick = await lantern.tick();
    await page.waitForTimeout(400);
    expect(await lantern.tick()).toBe(tick);
    await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
    // The words of the page say nothing of the case.
    const words = await textOf(page, "people-six");
    for (const word of ["rail", "witness", "culprit", "saw", "blame", "truth"]) expect(words.toLowerCase(), word).not.toContain(word);
    // In Chinese the same people, in the same order.
    await page.getByTestId("opening-people").getByTestId("lang-zh").click();
    await expect(page.getByTestId("people-opening-title")).toHaveText("这几个人");
    await expect(six.nth(1).getByTestId("people-six-name")).toHaveText("李老太");
    await expect(six.nth(1).getByTestId("people-six-intro")).toHaveText(cast.find((p) => p.id === "li_laotai")?.intro.zh ?? "");
    await expect(page.getByTestId("people-more")).toHaveText("镇上还有十来位，见了面再认识。");
    await expect(page.getByTestId("people-enter")).toHaveText("进镇");
    // The button goes on to the first day: the page is gone, the world runs, and the tutorial gives its first card.
    await page.getByTestId("people-enter").click();
    await expect(page.getByTestId("opening-people")).toHaveCount(0);
    await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "granny");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is left out for a player who has no tutorial, and Start goes straight into the town", async ({ lantern }) => {
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
    await page.goto(`${lantern.servers.app.origin}/?pace=10`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("opening")).toHaveCount(0);
    await expect(page.getByTestId("people-six")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is the same in both themes, and the helper that presses Start goes through it", async ({ lantern }) => {
    const page = lantern.page;
    await page.goto(`${lantern.servers.app.origin}/?pace=10`);
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await page.getByTestId("opening-start").click();
    await page.getByTestId("opening-people").getByTestId("theme-dark").click();
    expect(await fake.contrast(page, '[data-testid="people-six-intro"]')).toBeGreaterThan(4.5);
    await page.getByTestId("opening-people").getByTestId("theme-light").click();
    expect(await fake.contrast(page, '[data-testid="people-six-intro"]')).toBeGreaterThan(4.5);
    expect(await fake.contrast(page, '[data-testid="people-six-name"]')).toBeGreaterThan(4.5);
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await pressStart(page);
    await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "granny");
  });
});

test.describe("a first meeting", () => {
  test("puts who the person is beside the speaker for the length of the first talk, and the person in the book", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await expect(page.getByTestId("meeting-note")).toHaveCount(0);
    const intro = await page.evaluate(() => (window.__lantern.client.state.scene as unknown as { cast: Array<{ id: string; intro: { zh: string; en: string } }> }).cast.find((p) => p.id === "li_da")?.intro);
    // Li Da is known in the frame in which the player is in a talk with him: this is the first.
    const rows = await peopleRows(page, { li_da: known({ hearts: 1, met: [stamp(8, 31, "p_li_house")] }) });
    await fake.startTalk(page, "li_da", { people: rows });
    const note = page.getByTestId("meeting-note");
    await expect(note).toBeVisible();
    await expect(note.getByTestId("meeting-name")).toHaveText("Li Da");
    await expect(note.getByTestId("meeting-intro")).toHaveText(intro?.en ?? "");
    await expect(note.getByTestId("meeting-added")).toHaveText("Now in the people book.");
    // The same frame again, or another frame of the same talk, says the same.
    await fake.feedFrame(page, { people: rows });
    await expect(note).toBeVisible();
    // The talk is over: the note goes, and a second talk with the same person has none.
    await fake.feedFrame(page, { people: rows, player: { ...(await fake.playerOf(page)), talk: null } }, [{ kind: "talk_end", tick: 400, npc: "li_da", reason: "leave" }]);
    await expect(note).toHaveCount(0);
    await fake.startTalk(page, "li_da", { people: rows });
    await expect(page.getByTestId("talk-strip")).toHaveAttribute("data-talking", "true");
    await expect(page.getByTestId("meeting-note")).toHaveCount(0);
    // Another person, the first time: the note again, in Chinese when the page is.
    await lantern.setLang("zh");
    const other = await peopleRows(page, { li_er: known({ hearts: 1, met: [stamp(8, 40, "p_workshop")] }) });
    await fake.feedFrame(page, { people: rows, player: { ...(await fake.playerOf(page)), talk: null } }, [{ kind: "talk_end", tick: 410, npc: "li_da", reason: "leave" }]);
    await expect(page.getByTestId("talk-strip")).toHaveAttribute("data-talking", "false");
    await fake.startTalk(page, "li_er", { people: other });
    await expect(page.getByTestId("meeting-name")).toHaveText("李二");
    await expect(page.getByTestId("meeting-added")).toHaveText("人物谱里记下了。");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not a meeting for a person the frame had known all the time, as in a game that was loaded", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await fake.startTalk(page, "cha_laoban", { people: await peopleRows(page) });
    await expect(page.getByTestId("talk-strip")).toHaveAttribute("data-talking", "true");
    await expect(page.getByTestId("meeting-note")).toHaveCount(0);
  });
});

test.describe("the book of the people", () => {
  test("has a line for each person the player has talked with, in the order they met, with what the player learned of each", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await openNotebook(page);
    await expect(page.getByTestId("workspace-tab-people")).toHaveText("People0");
    await page.getByTestId("workspace-tab-people").click();
    await expect(page.getByTestId("people-empty")).toHaveText("You have not talked with anyone yet. Each person you talk with gets a line here.");
    await expect(page.getByTestId("people-count")).toHaveText("0 people met");
    await feedPeople(page);
    await expect(page.getByTestId("workspace-tab-people")).toHaveText("People3");
    await expect(page.getByTestId("people-count")).toHaveText("3 people met");
    const lines = page.getByTestId("people-line");
    await expect(lines).toHaveCount(3);
    expect(await lines.evaluateAll((items) => items.map((item) => item.getAttribute("data-person")))).toEqual(["li_laotai", "zhou_huoji", "cha_laoban"]);

    const granny = lines.nth(0);
    await expect(granny.getByTestId("people-name")).toHaveText("Granny Li");
    await expect(granny.getByTestId("people-role")).toHaveText("Matriarch of the Li family");
    await expect(granny.getByTestId("people-family")).toHaveCount(0); // the role says it already
    await expect(granny.getByTestId("people-met-at")).toHaveText(["Day 1 08:10, at Li Family House"]);
    await expect(granny.getByTestId("people-asked-what")).toHaveText("the role of honour of lighting the main lantern");
    await expect(granny.getByTestId("people-asked-for")).toHaveText("For: Ask Granny Li to lend the bamboo for the bridge");
    await expect(granny.getByTestId("people-like")).toHaveText("Likespastries");
    await expect(granny.getByTestId("people-dislike")).toHaveText("Dislikeswine");
    await expect(granny.getByTestId("people-said")).toHaveCount(0);
    await expect(granny.getByTestId("portrait")).toHaveAttribute("data-drawn", "true", { timeout: 30_000 });

    const clerk = lines.nth(1);
    await expect(clerk.getByTestId("people-name")).toHaveText("Zhou's Clerk");
    await expect(clerk.getByTestId("people-asked")).toHaveCount(0);
    await expect(clerk.getByTestId("people-like")).toHaveCount(0);
    await expect(clerk.getByTestId("people-said-entry")).toHaveText(["Li Er was at the bridge last night.Day 1 08:20, at Teahouse"]);

    const madam = lines.nth(2);
    await expect(madam.getByTestId("people-met-at")).toHaveText(["Day 1 08:24, at Teahouse", "Day 1 08:50, in the street"]);
    await expect(madam.getByTestId("people-neutral")).toHaveText("Does not mindtea leaves");
    await expect(madam.getByTestId("people-said-entry")).toHaveCount(2);
    await expect(madam.getByTestId("people-said-entry").first()).toContainText("Li Er broke the bridge railing last night.");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("shows nobody the player has not talked with, whatever else their row says", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page, { ...MORNING, zhou_zhanggui: { known: false, hearts: 6, met: [stamp(8, 5, "p_zhou_house")], asked: { what: { zh: "前排摊位", en: "a front-row stall" }, for: { zh: "请周掌柜送木料", en: "Ask the shopkeeper for timber" }, ...stamp(8, 6, null) }, likes_known: [{ item: "tea", like: "like" }] } });
    await openPeople(page);
    await expect(page.getByTestId("people-line")).toHaveCount(3);
    const text = await textOf(page, "people-leaf");
    for (const word of ["Shopkeeper Zhou", "front-row stall", "timber"]) expect(text, word).not.toContain(word);
  });

  test("opens the card of what stands behind the hearts when they are pressed, and shuts it when they are pressed again", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await openPeople(page);
    const granny = page.getByTestId("people-line").first();
    const hearts = granny.getByTestId("hearts");
    await expect(hearts).toHaveAttribute("data-value", "3");
    await expect(hearts).toHaveAttribute("aria-label", /1 and a half of five hearts/);
    await expect(page.getByTestId("hearts-card")).toHaveCount(0);
    // The hearts open the card of the person, the same sheet as in a talk and on the person card: it holds the world while it is up and has the facts of the card.
    await hearts.click();
    const sheet = page.getByTestId("hearts-sheet");
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute("data-person", "li_laotai");
    const card = sheet.getByTestId("hearts-card");
    await expect(card.getByTestId("hearts-trust")).toBeVisible();
    await expect(card.getByTestId("hearts-favours")).toBeVisible();
    await expect(card.getByTestId("hearts-change")).toHaveCount(2);
    // Another person's hearts are opened the same way once the sheet is put away.
    await page.getByTestId("hearts-close").click();
    await expect(sheet).toHaveCount(0);
    await page.getByTestId("people-line").nth(2).getByTestId("hearts").click();
    await expect(page.getByTestId("hearts-sheet")).toHaveAttribute("data-person", "cha_laoban");
    await expect(page.getByTestId("hearts-sheet").getByTestId("hearts-favours")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("hearts-sheet")).toHaveCount(0);
  });

  test("says that a person has joined the helpers only of one who has, and nothing of one whose friends are in but who is not", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    // The call was for the crew and no more: Granny Li is among the helpers, the Teahouse Keeper has nobody left to wait for and is not, and the
    // clerk still waits for two of the people they know.
    await feedPeople(page, {
      ...MORNING,
      li_laotai: { ...MORNING.li_laotai, card: { ...(MORNING.li_laotai?.card as Record<string, unknown>), waiting: 0, joined: true } },
      cha_laoban: { ...MORNING.cha_laoban, card: { ...(MORNING.cha_laoban?.card as Record<string, unknown>), waiting: 0, joined: false } },
      zhou_huoji: { ...MORNING.zhou_huoji, card: { ...(MORNING.zhou_huoji?.card as Record<string, unknown>), waiting: 2, joined: false } },
    });
    await openPeople(page);
    const open = async (index: number) => {
      await page.getByTestId("people-line").nth(index).getByTestId("hearts").click();
      return page.getByTestId("hearts-sheet").getByTestId("hearts-card");
    };
    let card = await open(2);
    await expect(card).toHaveAttribute("data-person", "cha_laoban");
    expect(await card.innerText()).not.toContain("has joined the helpers");
    await expect(card.getByTestId("hearts-joined")).toHaveCount(0);
    await expect(card.getByTestId("hearts-waiting")).toHaveCount(0);
    await page.getByTestId("hearts-close").click();
    card = await open(0);
    await expect(card).toHaveAttribute("data-person", "li_laotai");
    await expect(card.getByTestId("hearts-joined")).toHaveText("Granny Li has joined the helpers.");
    await expect(card.getByTestId("hearts-waiting")).toHaveCount(0);
    await page.getByTestId("hearts-close").click();
    card = await open(1);
    await expect(card).toHaveAttribute("data-person", "zhou_huoji");
    await expect(card.getByTestId("hearts-joined")).toHaveCount(0);
    await expect(card.getByTestId("hearts-waiting")).toHaveAttribute("data-waiting", "2");
    await lantern.setLang("zh");
    await expect(card.getByTestId("hearts-waiting")).toHaveText("想等熟人先来，还差两个");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is put away by the corner of the book at every page, with the three tabs and the corner side by side", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { statement: statement.statementKey() });
    await feedPeople(page);
    await openNotebook(page);
    const boxes = async (): Promise<Record<string, { x: number; width: number }>> => {
      const out: Record<string, { x: number; width: number }> = {};
      for (const id of ["workspace-tab-notes", "workspace-tab-statement", "workspace-tab-people", "notebook-close"]) {
        const box = await page.getByTestId(id).boundingBox();
        if (box === null) throw new Error(`no box for ${id}`);
        out[id] = { x: box.x, width: box.width };
      }
      return out;
    };
    for (const part of ["notes", "statement", "people"] as const) {
      await page.getByTestId(`workspace-tab-${part}`).click();
      await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", part);
      const at = await boxes();
      // The tab of the people stands to the left of the corner that puts the book away, and does not lie over it.
      expect((at["workspace-tab-people"]?.x ?? 0) + (at["workspace-tab-people"]?.width ?? 0)).toBeLessThanOrEqual(at["notebook-close"]?.x ?? 0);
      await page.getByTestId("notebook-close").click();
      await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
      await page.getByTestId("btn-notebook").click();
      await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    }
  });

  test("says all of it in Chinese and in both themes with the contrast the paper needs, and fits the window", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await openPeople(page);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const first = page.getByTestId("people-line").first();
        await expect(first.getByTestId("people-name")).toHaveText(lang === "en" ? "Granny Li" : "李老太");
        await expect(first.getByTestId("people-met-at")).toHaveText([lang === "en" ? "Day 1 08:10, at Li Family House" : "第一天 08:10，在李家宅"]);
        await expect(page.getByTestId("people-count")).toHaveText(lang === "en" ? "3 people met" : "认识三位");
        await expect(first.getByTestId("people-asked-what")).toHaveText(lang === "en" ? "the role of honour of lighting the main lantern" : "灯会上的体面角色：点主灯");
        await expect(first.getByTestId("people-like")).toHaveText(lang === "en" ? "Likespastries" : "喜欢点心");
        await expect(first.getByTestId("people-dislike")).toHaveText(lang === "en" ? "Dislikeswine" : "不爱酒");
        await expect(page.getByTestId("workspace-tab-people")).toHaveText(lang === "en" ? "People3" : "人物3");
        for (const selector of ['[data-testid="people-name"]', '[data-testid="people-role"]', '[data-testid="people-asked-for"]', '[data-testid="people-met-at"]']) {
          expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
        }
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not count a talk that was not kept as a meeting and does not break on a person with no talks kept", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page, { li_er: known({ hearts: 2, met: [] }), li_da: known({ hearts: 0, met: [stamp(8, 0, null)] }) });
    await openPeople(page);
    const lines = page.getByTestId("people-line");
    await expect(lines).toHaveCount(2);
    expect(await lines.evaluateAll((items) => items.map((item) => item.getAttribute("data-person")))).toEqual(["li_da", "li_er"]);
    await expect(lines.nth(1).getByTestId("people-met")).toHaveCount(0);
    await expect(lines.nth(0).getByTestId("people-met-at")).toHaveText(["Day 1 08:00, in the street"]);
  });
});

test.describe("where a note came from", () => {
  test("is said by who told it and how they know it, with when and where on the hover, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await openNotebook(page);
    const badge = (id: string) => page.locator(`[data-testid="note"][data-id="${id}"]`).getByTestId("source-badge");
    await expect(badge("n_scrape")).toHaveText("You saw it");
    await expect(badge("n_scrape")).toHaveAttribute("title", "Day 1 08:10, at Stone Bridge");
    await expect(badge("n_clerk")).toHaveText("Zhou's Clerk says they saw it");
    await expect(badge("n_clerk")).toHaveAttribute("data-how", "saw");
    await expect(badge("n_broke")).toHaveText("Teahouse Keeper says they heard it from Shopkeeper Zhou");
    await expect(badge("n_broke")).toHaveAttribute("data-how", "heard");
    await expect(badge("n_boat")).toHaveText("Teahouse Keeper cannot say who told them");
    await expect(badge("n_boat")).toHaveAttribute("data-how", "unsure");
    await lantern.setLang("zh");
    await expect(badge("n_scrape")).toHaveText("你亲眼看见的");
    await expect(badge("n_clerk")).toHaveText("周家伙计说，是亲眼看见的");
    await expect(badge("n_broke")).toHaveText("茶馆老板娘说，是听周掌柜说的");
    await expect(badge("n_boat")).toHaveText("茶馆老板娘说，记不清是听谁说的");
    await expect(badge("n_clerk")).toHaveAttribute("title", "第一天 08:20，在茶馆");
    // No count of hands anywhere on the sheet.
    expect(await textOf(page, "notebook")).not.toMatch(/第[一二三四五六七八九\d]+手|\b\d(st|nd|rd|th) hand\b/);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the people on the map", () => {
  const labels = async (page: Page): Promise<Record<string, { text: string; known: boolean; dot: boolean; edge: number | null }>> => {
    const shown = (await drawing(page)).headLabels;
    return Object.fromEntries(shown.map((label) => [label.id, { text: label.text, known: label.known, dot: label.dot, edge: label.edge }]));
  };

  test("have their names over their heads when the player has talked with them and their role when not, with the red dot over the one the slip points to", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await expect.poll(async () => Object.keys(await labels(page)).length, { timeout: 15_000 }).toBeGreaterThan(8);
    const shown = await labels(page);
    // The people the player knows are by name, the others by what they are (the part of the role before the comma).
    expect(shown.zhou_huoji).toMatchObject({ text: "Zhou's Clerk", known: true });
    expect(shown.cha_laoban).toMatchObject({ text: "Teahouse Keeper", known: true });
    // (Li Da stands under the placard of the day at this size, which hides his tag as it hides him.)
    expect(shown.li_xiaomei).toMatchObject({ text: "Daughter of Li Da", known: false });
    expect(shown.zhou_zhanggui).toMatchObject({ text: "Head of the Zhou shop", known: false });
    expect(shown.zuzhang).toMatchObject({ text: "Elder of the clan", known: false });
    // The slip points to Granny Li: she has the dot, and nobody else.
    expect(shown.li_laotai).toMatchObject({ text: "Granny Li", known: true, dot: true });
    expect(Object.entries(shown).filter(([, label]) => label.dot).map(([id]) => id)).toEqual(["li_laotai"]);
    // The two families have a line in their colour, the others none.
    expect(shown.li_xiaomei?.edge).toBe(0xd0593a);
    expect(shown.li_laotai?.edge).toBe(0xd0593a);
    expect(shown.zhou_zhanggui?.edge).toBe(0x3f7fa6);
    expect(shown.zhou_huoji?.edge).toBe(0x3f7fa6);
    expect(shown.cha_laoban?.edge).toBeNull();
    expect(shown.zuzhang?.edge).toBeNull();
    // In Chinese the words follow.
    await lantern.setLang("zh");
    await expect.poll(async () => (await labels(page)).li_xiaomei?.text).toBe("李大的女儿");
    expect((await labels(page)).li_laotai?.text).toBe("李老太");
    expect((await labels(page)).zhou_huoji?.text).toBe("周家伙计");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keep clear of the boxes of paper the page lays over the map: no tag lies under the placard of the day, the slip or the key to the lights", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await expect.poll(async () => (await drawing(page)).headLabels.length, { timeout: 15_000 }).toBeGreaterThan(8);
    // The boxes are read a few times a second and the tags laid out again when they moved: give it a moment, and look at what is drawn.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const boxes = [...document.querySelectorAll(".placard, .slip, .map-tools, .map-legend, .side, .marks")].map((el) => el.getBoundingClientRect());
            return window.__lantern.view.drawing().headLabels.filter((tag) => boxes.some((b) => tag.x < b.right && b.left < tag.x + tag.w && tag.y < b.bottom && b.top < tag.y + tag.h)).map((tag) => tag.id);
          }),
        { timeout: 10_000 },
      )
      .toEqual([]);
    expect((await drawing(page)).headLabels.length).toBeGreaterThan(8);
  });

  test("lose the dot when the slip points elsewhere, and a person the player talks to has none", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await expect.poll(async () => (await labels(page)).li_laotai?.dot).toBe(true);
    await fake.feedFrame(page, fake.tasks("t_source"));
    await expect.poll(async () => (await labels(page)).zhou_huoji?.dot).toBe(true);
    expect((await labels(page)).li_laotai?.dot).toBe(false);
    // The player is in a talk with the person the slip points to: they have found them.
    await fake.startTalk(page, "zhou_huoji", { people: await peopleRows(page) });
    await expect.poll(async () => (await labels(page)).zhou_huoji?.dot ?? false).toBe(false);
  });

  test("are left without a tag over the head while they speak, and the person who is picked has the tag under their feet", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await feedPeople(page);
    await expect.poll(async () => (await labels(page)).cha_laoban?.text).toBe("Teahouse Keeper");
    const tick = await lantern.tick();
    await fake.feedFrame(page, { bubbles: [{ npc: "cha_laoban", text: { zh: "来喝茶。", en: "Come and have tea." }, until: tick + 500 }] });
    await expect.poll(async () => (await labels(page)).cha_laoban).toBeUndefined();
    expect((await labels(page)).zhou_huoji?.text).toBe("Zhou's Clerk");
    await fake.feedFrame(page, { bubbles: [] });
    await expect.poll(async () => (await labels(page)).cha_laoban?.text).toBe("Teahouse Keeper");
    await page.evaluate(() => window.__lantern.view.select("zhou_huoji"));
    await expect.poll(async () => (await labels(page)).zhou_huoji).toBeUndefined();
    await expect.poll(async () => (await drawing(page)).nameTags.map((tag) => tag.name)).toEqual(["Zhou's Clerk"]);
  });
});
