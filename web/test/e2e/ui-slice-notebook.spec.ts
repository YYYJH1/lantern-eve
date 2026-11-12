import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const openNotebook = async (page: Page): Promise<void> => {
  await page.getByTestId("btn-notebook").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  // What was written since the player last looked flashes once; the page counts it as seen after a moment.
  await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "false", { timeout: 8000 });
};

const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);

test.describe("the notebook as a workspace", () => {
  test("has the words of each line and, under them, where they came from", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await openNotebook(page);
    const note = page.getByTestId("note").nth(1);
    await expect(note.getByTestId("note-words")).toContainText("Li Er was at the bridge last night.");
    await expect(note.getByTestId("note-words")).toContainText("What was said");
    await expect(note.getByTestId("note-source")).toContainText("Who told you");
    await expect(note.getByTestId("note-source").getByTestId("source-badge")).toHaveText("Zhou's Clerk says they saw it");
    const words = await note.getByTestId("note-words").boundingBox();
    const source = await note.getByTestId("note-source").boundingBox();
    if (words === null || source === null) throw new Error("no box");
    // The words are ruled first, and where they came from is written under them in a smaller hand.
    expect(source.y).toBeGreaterThanOrEqual(words.y + words.height - 2);
    expect(Math.abs(source.x - words.x)).toBeLessThan(4);
    await lantern.setLang("zh");
    await expect(note.getByTestId("note-words")).toContainText("原话");
    await expect(note.getByTestId("note-source")).toContainText("听谁说的");
    await expect(note.getByTestId("note-source").getByTestId("source-badge")).toHaveText("周家伙计说，是亲眼看见的");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("folds the note of the red slip while it is open, as the ledger does, and opens it again when it is shut", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    const slip = page.getByTestId("topbar-task");
    await expect(slip, "the note is open").toHaveAttribute("data-open", "true");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(slip, "the note is folded while the notebook is open").toHaveAttribute("data-open", "false");
    // Nothing of the note shows over the sheet: the slip is its head and nothing else.
    const [head, card] = [await page.getByTestId("slip-head").boundingBox(), await slip.boundingBox()];
    if (head === null || card === null) throw new Error("no box");
    expect(card.y + card.height, "nothing of the note hangs below the head").toBeLessThanOrEqual(head.y + head.height + 12);
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await expect(slip, "the note is open again when the notebook is shut").toHaveAttribute("data-open", "true");
    // A player who shut the note keeps it shut.
    await page.getByTestId("slip-head").click();
    await expect(slip).toHaveAttribute("data-open", "false");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await page.getByTestId("btn-notebook").click();
    await expect(slip).toHaveAttribute("data-open", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has a button to use a judged pair to clear it up, with the half hour it takes, which waits for the teahouse in the evening and then sends the claim, what it rests on and the judgement", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { judgments: [fake.JUDGMENT, { a: "n_boat", b: "n_clerk", relation: "contradicts", made: 420 }] });
    await fake.recordSent(page);
    await openNotebook(page);
    await expect(page.getByTestId("judgment")).toHaveCount(2);
    // Every relation the player judged right can be said in public: the core decides whether it shows.
    for (const row of [0, 1]) await expect(page.getByTestId("judgment").nth(row).getByTestId("judgment-clarify")).toHaveCount(1);
    const button = page.getByTestId("judgment").first().getByTestId("judgment-clarify");
    await expect(button).toContainText("Use to clear it up");
    await expect(button.getByTestId("cost-clarify")).toHaveCount(0);
    await expect(button).toBeDisabled();
    // It says where and when, and does not leave the player to guess.
    await expect(page.getByTestId("judgment-where").first()).toHaveText("To clear it up in public, go to the teahouse between 17:00 and 21:00, or wait until the elder has called the clan to the hall.");
    await fake.feedFrame(page, { hud: { verbs: ["move", "speak", "speak_publicly", "judge", "hint"] } });
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("judgment-where")).toHaveCount(0);
    await button.click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "clarify", claim: "n_broke", basis: ["n_clerk"], judgment: "unsupported" });
    // The other relation is said the same way, with its own relation.
    await page.getByTestId("judgment").nth(1).getByTestId("judgment-clarify").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "clarify", claim: "n_clerk", basis: ["n_boat"], judgment: "contradicts" });
    await lantern.setLang("zh");
    if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
    await expect(button).toContainText("拿去当众说清");
    // Not at the venue, or in a talk: the same button waits, and in a talk it says what to do.
    await fake.feedFrame(page, { hud: { verbs: ["move", "judge", "hint"] } });
    await expect(page.getByTestId("judgment-where").first()).toHaveText("要当众说清，就在傍晚 17:00 到 21:00 去茶馆，或者等族长把族人召到祠堂。");
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("judgment-where").first()).toHaveText("你还在和人说话，先告辞吧。");
  });

  test("says in words why a speech in public was turned down, next to the pair it was about, for each reason the core gives", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { judgments: [fake.JUDGMENT], hud: { verbs: ["move", "speak", "speak_publicly", "judge", "hint"] } });
    await fake.recordSent(page);
    await openNotebook(page);
    const button = page.getByTestId("judgment-clarify");
    const words: Record<string, { en: string; zh: string }> = {
      no_entry: { en: "That note is not in your notebook.", zh: "见闻簿里没有这一条。" },
      not_shown: { en: "Those two lines alone do not show that.", zh: "单凭这两句，看不出这一点。" },
      overclaim: { en: "You said more than these lines show. Those who know better will remember it.", zh: "你说的比这几句话能证明的多。知道底细的人会记着。" },
      no_witness: { en: "Nobody says they saw it happen, so there is nobody to bear it out.", zh: "没人说自己亲眼看见过，找不出人作证。" },
      said_already: { en: "You said this here already, to the same people.", zh: "这些话你已经当着这些人说过了。" },
      no_venue: { en: "Not here. Speak at the teahouse in the evening, or at the hall when the clan is called.", zh: "这里不是当众说话的地方。傍晚去茶馆，或族长召集族人时去祠堂。" },
      not_evening: { en: "The teahouse only fills up after 17:00.", zh: "茶馆要到 17:00 以后才有人。" },
      no_meeting: { en: "The elder has not called the clan to the hall.", zh: "族长还没把族人召到祠堂。" },
      empty_room: { en: "There is nobody here to hear you.", zh: "这里没有人听你说。" },
    };
    let tick = 20;
    for (const [reason, w] of Object.entries(words)) {
      await button.click();
      await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: tick++, action_id: await lastId(page), result: "rejected", reason }]);
      const no = page.getByTestId("clarify-no");
      await expect(no).toHaveAttribute("data-reason", reason);
      await expect(no).toHaveText(w.en);
      // In no note over the map, and the button is there to say it again.
      await expect(page.getByTestId("game-note")).toHaveCount(0);
      await expect(button).toBeEnabled();
    }
    await lantern.setLang("zh");
    if ((await page.getByTestId("notebook").getAttribute("data-open")) !== "true") await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("clarify-no")).toHaveText(words.empty_room?.zh ?? "");
    // The pair that was said again waits for the core and shows no old rejection.
    await button.click();
    await expect(page.getByTestId("clarify-no")).toHaveCount(0);
    await expect(button).toBeDisabled();
    // A speech the core took shows no rejection, and the sheet of what they made of it is the answer.
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 40, action_id: await lastId(page), result: "applied", reason: null }]);
    await expect(page.getByTestId("clarify-no")).toHaveCount(0);
    await expect(button).toBeEnabled();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("holds the world while it is open and lets it go when it is shut, if it was going", async ({ lantern }) => {
    const page = lantern.page;
    // A world that is running.
    await lantern.open("scenario=bridge&seed=7&pace=20", { menu: false });
    await lantern.waitForTick(40);
    await expect(page.getByTestId("status")).toHaveText("running");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    expect(await page.evaluate(() => window.__lantern.client.state.stats?.reasons)).toEqual(["page"]);
    const held = await lantern.tick();
    await page.waitForTimeout(600);
    expect(await lantern.tick()).toBe(held);
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick(held + 5);
    // The player can let go of the world while the notebook holds it: resume runs it with the notebook open.
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await expect(page.getByTestId("btn-pause")).toHaveText("Resume");
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick((await lantern.tick()) + 5);
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await lantern.waitForTick((await lantern.tick()) + 5);
    // A world that the player had paused stays paused.
    await page.getByTestId("btn-pause").click();
    await expect(page.getByTestId("status")).toHaveText("paused");
    await page.getByTestId("btn-notebook").click();
    await page.getByTestId("notebook-close").click();
    await page.waitForTimeout(400);
    await expect(page.getByTestId("status")).toHaveText("paused");
  });
});

test.describe("what a clarification did", () => {
  test("shows the people who were there one by one, who changed their stand and the reason they gave, in both languages and themes", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    const view = page.getByTestId("clarify");
    await expect(view).toBeVisible();
    await expect(page.getByTestId("hearer")).toHaveCount(4);
    const words = {
      en: { claim: "You said in public that this claim goes too far: “Li Er broke the bridge railing last night.”", sum: "3 of 4 changed their minds.", names: ["Zhou's Clerk", "Granny Li", "Teahouse Keeper", "Shopkeeper Zhou"], change: ["blames, now believes", "unsure, now believes", "unsure, now believes", "still blames"], reason: "I only saw him by the bridge. I did not see him touch it.", title: "What they made of it" },
      zh: { claim: "你当众指出这句话说过了头：「李二昨晚把栏杆弄坏了。」", sum: "四个人里，三个改了主意。", names: ["周家伙计", "李老太", "茶馆老板娘", "周掌柜"], change: ["从怪罪变成相信", "从拿不准变成相信", "从拿不准变成相信", "还是怪罪"], reason: "我只看见他在桥边，没看见他碰桥。", title: "在场的人怎么想" },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = words[lang];
        await expect(view.locator(".sheet-title")).toHaveText(w.title);
        await expect(page.getByTestId("clarify-claim")).toHaveText(w.claim);
        await expect(page.getByTestId("clarify-sum")).toHaveText(w.sum);
        await expect(page.getByTestId("hearer").locator(".hearer-name")).toHaveText([...w.names]);
        await expect(page.getByTestId("hearer-change")).toHaveText([...w.change]);
        await expect(page.getByTestId("hearer-reason").first()).toHaveText(w.reason);
        expect(await fake.contrast(page, '[data-testid="hearer-reason"]'), `${theme} ${lang} reason`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="clarify-claim"]'), `${theme} ${lang} claim`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    // Who changed and who did not is in the data of each row, for the eye and for the reader of the page.
    await expect(page.getByTestId("hearer").nth(0)).toHaveAttribute("data-changed", "true");
    await expect(page.getByTestId("hearer").nth(3)).toHaveAttribute("data-changed", "false");
    await expect(page.getByTestId("hearer").nth(1)).toHaveAttribute("data-before", "unsure");
    await expect(page.getByTestId("hearer").nth(1)).toHaveAttribute("data-after", "for");
    // Each stand is a word of its own, and the side it is on (against the clarification, unsure, or for it) is in its class.
    const chips = page.getByTestId("hearer").first();
    await expect(chips.getByTestId("stance-before")).toHaveAttribute("data-stance", "against");
    await expect(chips.getByTestId("stance-after")).toHaveAttribute("data-stance", "for");
    await expect(chips.getByTestId("stance-before")).toHaveClass(/tone-against/);
    await expect(chips.getByTestId("stance-after")).toHaveClass(/tone-for/);
    await expect(page.getByTestId("hearer").nth(1).getByTestId("stance-before")).toHaveClass(/tone-unsure/);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("brings in the people one after the other", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ colorScheme: "light" });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    await expect(page.getByTestId("clarify")).toBeVisible();
    // Each person comes a little after the one before.
    const delays = await page.getByTestId("hearer").evaluateAll((els) => els.map((el) => Number.parseFloat(getComputedStyle(el).animationDelay)));
    expect(delays).toHaveLength(4);
    for (let i = 1; i < delays.length; i++) expect(delays[i] ?? 0, `person ${i}`).toBeGreaterThan(delays[i - 1] ?? 0);
  });

  test("is put away with its button or the Escape key, and says when nobody was there", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    const view = page.getByTestId("clarify");
    await expect(view).toBeVisible();
    await page.getByTestId("clarify-done").click();
    await expect(view).toHaveCount(0);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    await expect(view).toBeVisible();
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(view).toHaveCount(0);
    await fake.feedFrame(page, {}, [{ kind: "clarified", tick: 800, claim: "n_broke", audience: [] }]);
    await expect(page.getByTestId("clarify-empty")).toHaveText("Nobody was there to hear it.");
    await expect(page.getByTestId("hearer")).toHaveCount(0);
    await page.getByTestId("clarify-close").click();
    await expect(view).toHaveCount(0);
  });
});

test.describe("the recap of the morning", () => {
  test("is a card of at most three lines, in both languages and themes, that stays until the player puts it away and does not come back for the same lines", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await expect(page.getByTestId("recap")).toHaveCount(0);
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 900, lines: 3 }]);
    const card = page.getByTestId("recap");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("recap-line")).toHaveCount(3);
    // The core sends the recap in one frame. The frames after it have none, and the card is still there.
    await fake.feedFrame(page, { recap: null });
    await fake.feedFrame(page, { recap: null });
    await expect(card).toBeVisible();
    const words = {
      en: { title: "What happened yesterday", lines: ["The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.", "You said in public that the claim went too far, and Zhou's Clerk and Granny Li changed their minds.", "Li Da promised to bring 4 poles of bamboo."] },
      zh: { title: "昨天的事", lines: ["李大答应的四根竹料，已经送到石桥。", "你当众指出那句话说过了头，周家伙计和李老太听后改了口。", "李大答应送来四根竹料。"] },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        await expect(card.locator(".sheet-title")).toHaveText(words[lang].title);
        await expect(page.getByTestId("recap-line")).toHaveText([...words[lang].lines]);
        expect(await fake.contrast(page, '[data-testid="recap-line"]'), `${theme} ${lang}`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    // Each line is about real events: the numbers the core gave, in the order it gave them.
    await expect(page.getByTestId("recap-line").first()).toHaveAttribute("data-events", "16,26");
    await expect(page.getByTestId("recap-line").nth(2)).toHaveAttribute("data-events", "16");
    await page.getByTestId("recap-done").click();
    await expect(card).toHaveCount(0);
    // The same lines in the next frames are not shown again.
    await fake.feedFrame(page, fake.recap());
    await fake.feedFrame(page, fake.recap());
    await expect(card).toHaveCount(0);
    // The core says the recap once more, and the card comes back.
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 900 }]);
    await expect(card).toBeVisible();
    await lantern.settled();
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
    // Other lines are a new recap, and a new one takes the place of one that is still on show.
    await lantern.setLang("en");
    await fake.feedFrame(page, { recap: [{ text: { zh: "第二天的小结。", en: "The summary of the second day." }, events: [] }] });
    await expect(page.getByTestId("recap-line")).toHaveText(["The summary of the second day."]);
    // A fourth line is not shown, and a frame without a recap does not take the card away.
    await fake.feedFrame(page, { recap: [1, 2, 3, 4].map((i) => ({ text: { zh: `第${i}句`, en: `Line ${i}` }, events: [i] })) });
    await expect(page.getByTestId("recap-line")).toHaveText(["Line 1", "Line 2", "Line 3"]);
    await fake.feedFrame(page, { recap: null });
    await expect(card).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("waits behind the sheet of a clarification and the ending, and is there when they are put away", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, {}, [fake.clarified()]);
    await expect(page.getByTestId("clarify")).toBeVisible();
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 900 }]);
    await fake.feedFrame(page, { recap: null });
    await expect(page.getByTestId("recap")).toHaveCount(0);
    await page.getByTestId("clarify-close").click();
    await expect(page.getByTestId("recap")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is kept in a save: a save made with the recap on show brings it back when it is loaded, and one made after it was put away does not", async ({ lantern }) => {
    const page = lantern.page;
    // The saves are in the menu drawer, which a click on the sheet puts away.
    await lantern.open(fake.TOWN);
    await lantern.waitForTick(300);
    await fake.feedFrame(page, { ...fake.tasks(), ...fake.commitments("delivered"), weather: "clear", hud: { verbs: fake.FREE_VERBS } });
    await fake.feedFrame(page, fake.recap(), [{ kind: "recap", tick: 301, lines: 3 }]);
    await fake.feedFrame(page, { recap: null });
    await expect(page.getByTestId("recap")).toBeVisible();
    await lantern.openMenu();
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("notice")).toContainText("saved, Day");
    await page.getByTestId("menu-close").click();
    // The player puts it away, and saves again.
    await page.getByTestId("recap-done").click();
    await expect(page.getByTestId("recap")).toHaveCount(0);
    await lantern.openMenu();
    await page.getByTestId("btn-save").click();
    await expect(page.getByTestId("select-saves").locator("option")).toHaveCount(2);
    const [newer, older] = await page.evaluate(() => window.__lantern.client.state.saves.map((save) => ({ id: save.id, page: save.page ?? null })));
    expect(older?.page).toMatchObject({ recap: { lines: [{ events: [16, 26] }, { events: [12] }, { events: [16] }] } });
    expect(newer?.page).toBeNull();
    // Loading the first brings the card back, with the words of the core in both languages.
    await page.getByTestId("select-saves").selectOption(String(older?.id));
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("loaded")).toHaveAttribute("data-match", "true");
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("recap")).toBeVisible();
    await expect(page.getByTestId("recap-line").first()).toHaveText("The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("recap-line").first()).toHaveText("李大答应的四根竹料，已经送到石桥。");
    // Loading the second leaves it away.
    await page.getByTestId("recap-done").click();
    await lantern.openMenu();
    await page.getByTestId("select-saves").selectOption(String(newer?.id));
    await page.getByTestId("btn-load").click();
    await expect(page.getByTestId("loaded")).toHaveAttribute("data-match", "true");
    await page.getByTestId("menu-close").click();
    await page.waitForTimeout(300);
    await expect(page.getByTestId("recap")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

// The notebook lies over the corner at the bottom right. With the help on or off it ends where it always did, above the three things of the corner.

const BOOK_WINDOWS = [
  { width: 1200, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 760 },
];

const BOOK_LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN" },
  { lang: "en", theme: "dark", locale: "en-US" },
] as const;

for (const size of BOOK_WINDOWS) {
  for (const look of BOOK_LOOKS) {
    test.describe(`the notebook and the corner, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: size });

      test("ends where it always did while the help is on, since the hints are in the menu, and is as tall as it was when the notebook is shut and opened again", async ({ lantern }) => {
        test.setTimeout(150_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: fake.notebook(), commitments: [] }, fake.GUIDED);
        await fake.primeHelp(page);
        const bottomOf = (): Promise<number> => page.evaluate(() => document.querySelector('[data-testid="notebook"]')?.getBoundingClientRect().bottom ?? 0);
        await openNotebook(page);
        const open = await bottomOf();
        expect(open).toBeCloseTo(Math.min(84 + 566, size.height - 112), 0);
        // Shut and opened again, the notebook is where it was.
        await page.getByTestId("btn-notebook").click();
        await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
        await page.getByTestId("btn-notebook").click();
        await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
        expect(await bottomOf()).toBeCloseTo(open, 0);
        expect(lantern.pageErrors).toEqual([]);
      });

      test("ends where it always did while the help is off, above the three things of the corner", async ({ lantern }) => {
        test.setTimeout(150_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern);
        await expect(page.getByTestId("btn-hints")).toHaveCount(0);
        await openNotebook(page);
        const bottom = await page.evaluate(() => document.querySelector('[data-testid="notebook"]')?.getBoundingClientRect().bottom ?? 0);
        // 84 px from the top and 566 px tall at the most, or 112 px above the foot of the window where that is less.
        expect(bottom).toBeCloseTo(Math.min(84 + 566, size.height - 112), 0);
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}
