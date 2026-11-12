import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const n = (zh: string, en: string): { zh: string; en: string } => ({ zh, en });

/** The id of the action that the page sent last. */
const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);

/** The keys of `player.talk` of the frame on screen, with these laid over them. */
async function talkKeys(page: Page, keys: Record<string, unknown>): Promise<void> {
  const player = await fake.playerOf(page);
  await fake.feedFrame(page, { player: { ...player, talk: { ...(player.talk as Record<string, unknown>), ...keys } } });
}

const WANTS = {
  key: "li_laotai|lend|bamboo",
  token: "572e6130",
  asks: n("请李老太把竹料借给灯会", "Ask Granny Li to lend the bamboo for the bridge"),
  request: { id: "ask_bamboo", label: n("请李老太把竹料送到桥边", "Ask Granny Li to bring the bamboo to the bridge"), body: { kind: "material" }, status: "refused", for: "t_bamboo_first" },
  offer: { id: "role:t_honor_light", label: n("许李老太点主灯的体面差事", "Promise Granny Li the honour of lighting the main lantern"), body: { op: "make", due: 3, what: "role", item: "t_honor_light" } },
};

const KEEP = {
  kind: "keep",
  pledge: "k1",
  due: 3,
  early: true,
  what: n("十文工钱", "10 coins in wages"),
  offer: { id: "keep:k1", label: n("兑现许诺 k1", "Keep promise k1"), body: { op: "keep", id: "k1" } },
};

const KEEP_ONE = { ...KEEP, pledge: "k2", due: 2, what: n("节目单上的第二位", "place 2 in the programme"), offer: { id: "keep:k2", label: n("兑现许诺 k2", "Keep promise k2"), body: { op: "keep", id: "k2" } } };

const ANSWER = { kind: "answer", key: WANTS.key, token: WANTS.token };

/** The preview of the promise the person asks for. */
const PROMISE_PREVIEW = { ...fake.PROMISE_PREVIEW, asks: n("许下：让李家点主灯", "Promise: the Li family lights the main lantern") };

test.describe("a request", () => {
  test("is the one on the button, asked for with one press, shown as the preview of the core first, and nothing is sent until the player confirms", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    await expect(card).toHaveAttribute("data-verb", "entrust");
    // The page makes no preview of its own, and the host was asked for the action the player would send, with `verb` in the place of `type`.
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_laotai", kind: "material" }]);
    // The button that decides is in view when the card opens, with no scrolling of the column by hand.
    await expect(page.getByTestId("request-confirm")).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByTestId("request-cancel")).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByTestId("request-asks").locator("dd")).toHaveText("Ask Li Da to bring the bamboo to the bridge");
    // No minutes on the button that sends it.
    await expect(page.getByTestId("request-cost")).toHaveCount(0);
    await expect(page.getByTestId("request-confirm")).toHaveText("Go ahead");
    await expect(page.getByTestId("request-gives")).toHaveCount(0);
    // What stands in the way, in plain words, and how it looks, and why, are the core's.
    await expect(page.getByTestId("request-blockers").locator("dt")).toHaveText("In the way");
    await expect(page.getByTestId("request-blocker")).toHaveText("Granny Li has not dropped her objection");
    await expect(page.getByTestId("request-odds").locator("dt")).toHaveText("Will it work");
    await expect(page.getByTestId("request-odds").locator("dd")).toHaveText("Hard to say");
    await expect(page.getByTestId("request-reasons").locator("li")).toHaveCount(2);
    expect(await fake.sentSoFar(page)).toEqual([]);
    // Another act puts the preview away: so does asking about a topic. So does Not now.
    await page.getByTestId("verb-ask").click();
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
    await expect(card).toHaveCount(0);
    await page.getByTestId("verb-entrust").click();
    await page.getByTestId("request-cancel").click();
    await expect(card).toHaveCount(0);
    expect(await fake.sentSoFar(page)).toEqual([{ type: "ask", topic: "li_er", action_id: "t0" }]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says in plain words what stands in the way, and that nothing does when nothing does, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    const card = page.getByTestId("request-card");
    const words = {
      en: { odds: "Hard to say", blocker: "Granny Li has not dropped her objection", reasons: ["+Li Da owes you a favour", "−Li Da hardly knows you yet"], title: "Asking Granny Li", confirm: "Go ahead", asks: "Ask Li Da to bring the bamboo to the bridge" },
      zh: { odds: "说不准", blocker: "李老太还没撤回阻拦", reasons: ["+李大欠你人情", "−李大对你还不太熟"], title: "请李老太", confirm: "就这么办", asks: "请李大把竹料送到桥边" },
    } as const;
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        // The language switch lives in the menu, and opening the menu puts the preview away. Ask again each time.
        await lantern.setLang(lang);
        if ((await card.count()) === 0) await page.getByTestId("verb-entrust").click();
        const w = words[lang];
        await expect(card.locator(".request-title")).toHaveText(w.title);
        await expect(page.getByTestId("request-asks").locator("dd")).toHaveText(w.asks);
        await expect(page.getByTestId("request-odds").locator("dd")).toHaveText(w.odds);
        await expect(page.getByTestId("request-blocker")).toHaveText(w.blocker);
        await expect(page.getByTestId("request-reasons").locator("li")).toHaveText([...w.reasons]);
        await expect(page.getByTestId("request-confirm")).toContainText(w.confirm);
        expect(await fake.contrast(page, '[data-testid="request-asks"] dd'), `${theme} ${lang} asks`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="request-confirm"]'), `${theme} ${lang} confirm`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    // With nothing in the way the card says so, in words and not as an unknown.
    await fake.answerPreview(page, { ...fake.PREVIEW, blockers: [] });
    await lantern.setLang("en");
    await page.getByTestId("request-cancel").click();
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-blockers").locator("dd")).toHaveText("Nothing in the way that you can see.");
    await lantern.setLang("zh");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-blockers").locator("dd")).toHaveText("眼下没看出有什么拦着。");
  });

  test("says that it has no preview when the host cannot give one, makes none up, and lets the player ask again", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    for (const answer of ["none", "error"] as const) {
      await fake.answerPreview(page, answer);
      await page.getByTestId("verb-entrust").click();
      const card = page.getByTestId("request-card");
      await expect(card).toHaveAttribute("data-phase", "failed");
      await expect(page.getByTestId("request-failed")).toHaveText("That could not be worked out. Try again.");
      for (const id of ["request-confirm", "request-asks", "request-blockers", "request-odds"]) await expect(page.getByTestId(id)).toHaveCount(0);
      await page.getByTestId("request-cancel").click();
      await expect(card).toHaveCount(0);
    }
    expect(await fake.sentSoFar(page)).toEqual([]);
    await fake.answerPreview(page, "error");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-failed")).toBeVisible();
    await fake.answerPreview(page, fake.PREVIEW);
    await page.getByTestId("request-retry").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("becomes the result in the same place when the player confirms, with what the person said and what was done", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    const card = page.getByTestId("request-card");
    await card.evaluate((el) => el.setAttribute("data-mark", "same"));
    await page.getByTestId("request-confirm").click();
    await expect(card).toHaveAttribute("data-phase", "sending");
    await expect(page.getByTestId("request-confirm")).toBeDisabled();
    const sent = (await fake.sentSoFar(page)).at(-1);
    expect(sent).toMatchObject({ type: "entrust", kind: "material", version: 42 });
    expect(sent).not.toHaveProperty("offer");
    const reply = { npc: "li_laotai", until: 999_999, text: n("答应了，明早送到桥边。", "Agreed. It will be at the bridge by morning.") };
    await fake.feedFrame(page, { bubbles: [reply] }, [
      { kind: "entrusted", tick: 3, npc: "li_laotai", request: "material", result: "agreed", pending: true },
      { kind: "action_ack", tick: 3, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(card).toHaveAttribute("data-phase", "result");
    await expect(card).toHaveAttribute("data-mark", "same");
    await expect(page.getByTestId("request-result")).toHaveText("Granny Li agreed.");
    await expect(page.getByTestId("request-reply")).toHaveText("Agreed. It will be at the bridge by morning.");
    await expect(page.getByTestId("request-facts")).toHaveText("Granny Li says yes and will see to it shortly.");
    // After the act the card says how long it took, and the buttons never did.
    await expect(page.getByTestId("request-spent")).toHaveText("That took 20 minutes.");
    await expect(page.getByTestId("request-follow")).toHaveCount(0);
    await expect(page.getByTestId("talk-line").first()).toHaveText("You ask Granny Li to bring the bamboo to the bridge");
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-line").first()).toHaveText("你请李老太把竹料送到桥边");
    await expect(page.getByTestId("request-result")).toHaveText("李老太答应了。");
    await page.getByTestId("request-close").click();
    await expect(card).toHaveCount(0);
  });

  test("goes back to a new preview when the core says that the state has moved on (stale), and says so", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    await page.getByTestId("request-confirm").click();
    const first = await lastId(page);
    await fake.answerPreview(page, { ...fake.PREVIEW, version: 51 });
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 4, action_id: first, result: "rejected", reason: "stale" }]);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("request-stale")).toHaveText("Things have changed. Have another look");
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    await page.getByTestId("request-confirm").click();
    expect(await lastId(page)).not.toBe(first);
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", version: 51 });
    await lantern.setLang("zh");
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 5, action_id: await lastId(page), result: "rejected", reason: "stale" }]);
    await expect(page.getByTestId("request-stale")).toHaveText("情况变了，再看一遍");
  });

  test("shows a refusal as the result, with the reason, in both languages, and not as a note over the map", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    await page.getByTestId("request-confirm").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 4, action_id: await lastId(page), result: "rejected", reason: "needs_nod" }]);
    const result = page.getByTestId("request-result");
    await expect(result).toHaveAttribute("data-ok", "false");
    await expect(result).toHaveText("×Granny Li wants someone else to agree first.");
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(result).toHaveText("×李老太得先等别人点头。");
    await page.getByTestId("request-close").click();
    await page.getByTestId("verb-entrust").click();
    await page.getByTestId("request-confirm").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 5, action_id: await lastId(page), result: "rejected", reason: "gremlins" }]);
    await expect(result).toHaveText("×这样做不成。");
  });

  test("does not let a request be confirmed while an act is owed, and the notebook cannot ask meanwhile", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-confirm")).toBeEnabled();
    await fake.feedFrame(page, {}, [], fake.PAYING);
    await expect(page.getByTestId("request-confirm")).toBeDisabled();
    await expect(page.getByTestId("request-cancel")).toBeEnabled();
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("note-ask").first()).toBeDisabled();
    await fake.feedFrame(page, {}, [], { paused: true, rate: [1, 1] });
    await expect(page.getByTestId("note-ask").first()).toBeEnabled();
    await expect(page.getByTestId("request-confirm")).toBeEnabled();
  });
});

test.describe("the other requests", () => {
  const OTHERS = [
    { id: "join", label: n("请李老太加入帮工", "Ask Granny Li to join the helpers"), body: { kind: "join" }, status: "open" },
    { id: "persuade:li_da", label: n("请李老太去劝李大", "Ask Granny Li to talk Li Da round"), body: { kind: "persuade", target: "li_da" }, status: "waiting" },
    { id: "persuade:li_er", label: n("请李老太去劝李二", "Ask Granny Li to talk Li Er round"), body: { kind: "persuade", target: "li_er" }, status: "refused" },
    { id: "testify", label: n("请李老太说说亲眼所见", "Ask Granny Li to tell what was seen"), body: { kind: "testify" }, status: "done" },
  ];

  test("are one word beside the request on the button, and open every one of the others with where it stands", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, { ...fake.PREVIEW, asks: n("请李老太加入帮工", "Ask Granny Li to join the helpers") });
    await fake.startTalk(page, "li_laotai");
    // With no other request and nothing to promise there is no word for them.
    await talkKeys(page, { give: { preferred: null, more: [], ways: [] } });
    await expect(page.getByTestId("entrust-more")).toHaveCount(0);
    // What can be promised is in the list of the others, so that a promise can be made without having been turned down first.
    await talkKeys(page, { give: { preferred: WANTS.offer, more: [], ways: [] } });
    await expect(page.getByTestId("entrust-more")).toHaveText("Others");
    await talkKeys(page, { asks_more: OTHERS });
    await page.getByTestId("entrust-more").click();
    const list = page.getByTestId("picker-entrust");
    await expect(list).toBeVisible();
    await expect(list.getByTestId("picker-option")).toHaveCount(5);
    await expect(list.locator('[data-group="give"] .picker-heading')).toHaveText("Promise Granny Li something");
    await expect(list.locator('[data-group="give"] [data-testid="picker-option"]')).toHaveText(["Promise Granny Li the honour of lighting the main lantern"]);
    // Each says where it stands, except one that has not been asked for.
    await expect(list.locator('[data-id="join"] .picker-badge')).toHaveCount(0);
    await expect(list.locator('[data-id="persuade:li_da"] .picker-badge')).toHaveText("Agreed, to be done");
    await expect(list.locator('[data-id="persuade:li_er"] .picker-badge')).toHaveText("Turned down today");
    await expect(list.locator('[data-id="testify"] .picker-badge')).toHaveText("Done");
    // The ones that ask someone to talk another round are under a heading of their own.
    await expect(list.locator('[data-group="persuade"] [data-testid="picker-option"]')).toHaveCount(2);
    // The language switch is in the menu, and a press outside the list puts the list away: it is opened again.
    await lantern.setLang("zh");
    await page.getByTestId("entrust-more").click();
    await expect(list.locator('[data-id="persuade:li_da"] .picker-badge')).toHaveText("已答应，等着办");
    await lantern.setLang("en");
    await page.getByTestId("entrust-more").click();
    // A request that is turned down today can be asked again from here: its preview is the core's.
    await list.locator('[data-id="persuade:li_er"]').click();
    await expect(page.getByTestId("picker-entrust")).toHaveCount(0);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_laotai", kind: "persuade", target: "li_er" }]);
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", kind: "persuade", target: "li_er" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("are the list itself where the town puts none forward, so that every request can still be made", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, { ...fake.PREVIEW, asks: n("请李老太加入帮工", "Ask Granny Li to join the helpers") });
    await fake.startTalk(page, "li_laotai");
    await talkKeys(page, { ask_for: null, asks_more: OTHERS });
    // The button is the plain words, and opens the list.
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask a favour");
    await expect(page.getByTestId("entrust-more")).toHaveCount(0);
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("picker-entrust").getByTestId("picker-option")).toHaveCount(5);
    await page.getByTestId("picker-entrust").locator('[data-id="join"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", kind: "join" });
  });

  test("have the promises in them too: a promise made from the list is previewed and sent as a promise, before any request was turned down", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, PROMISE_PREVIEW);
    await fake.startTalk(page, "li_laotai");
    // Nothing was turned down: the queue is empty, and the promise is still there to make.
    await talkKeys(page, { wants: null, keep: null, queue: [], give: { preferred: WANTS.offer, more: [], ways: [] } });
    await expect(page.getByTestId("talk-context")).toHaveCount(0);
    await page.getByTestId("entrust-more").click();
    await page.locator('[data-testid="picker-entrust"] [data-group="give"] [data-id="role:t_honor_light"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-verb", "promise");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_laotai", op: "make", what: "role", item: "t_honor_light", due: 3 }]);
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "promise", op: "make", what: "role", item: "t_honor_light", due: 3, version: 43 });
  });

  test("are listed from the offers of the town where the frame has no keys for them (a core from before them)", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    const player = await fake.playerOf(page);
    const talk = player.talk as Record<string, unknown>;
    const old = { npc: talk.npc, costs: talk.costs, leaves_at: talk.leaves_at };
    await fake.feedFrame(page, { player: { ...player, talk: old } });
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask a favour");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("picker-entrust").locator('[data-id="ask_bamboo"]')).toHaveCount(1);
    await expect(page.getByTestId("talk-context")).toHaveCount(0);
  });
});

test.describe("what the person asks in return, and what is left to keep or promise", () => {
  async function asking(page: Page, keys: Record<string, unknown> = {}): Promise<void> {
    await talkKeys(page, { ask_for: null, wants: WANTS, keep: KEEP, queue: [ANSWER, KEEP, { kind: "give" }], ...keys });
  }

  test("shows the first of the queue, with the others counted, and in the order of the core", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await asking(page);
    const context = page.getByTestId("talk-context");
    await expect(context).toHaveAttribute("data-kind", "answer");
    await expect(context).toHaveAttribute("data-count", "3");
    await expect(page.getByTestId("answer-ask")).toHaveText("Granny Li wants something in return before doing this.");
    await expect(page.getByTestId("answer-offer")).toHaveText("Promise Granny Li the honour of lighting the main lantern");
    await expect(page.getByTestId("answer-for")).toHaveText("For: Ask Granny Li to lend the bamboo for the bridge");
    await expect(page.getByTestId("context-more")).toHaveText("2 more");
    await lantern.setLang("zh");
    await expect(page.getByTestId("answer-ask")).toHaveText("李老太想先要点回报，才肯办这件事。");
    await expect(page.getByTestId("context-more")).toHaveText("还有两件");
    await expect(page.getByTestId("answer-yes")).toHaveText("答应");
    await expect(page.getByTestId("answer-no")).toHaveText("不答应");
    // The rest are listed, each can be done from there, and the first is not among them.
    await page.getByTestId("context-more").click();
    await expect(page.getByTestId("picker-rest").getByTestId("picker-option")).toHaveText(["提前兑现许诺，给李老太十文工钱", "许李老太点什么"]);
    // Only one thing is put forward at a time, and the acts are still four.
    await expect(page.locator('[data-testid="talk-verbs"] > .verb')).toHaveCount(4);
    expect(await fake.fitsWidth(page)).toBe(true);
  });

  test("makes the promise when the player says yes, with no second press, and offers the request that was turned down, looked at again", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, PROMISE_PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await asking(page);
    await page.getByTestId("answer-yes").click();
    // The core was asked about the promise it named, which went out as it previewed it.
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_laotai", op: "make", what: "role", item: "t_honor_light", due: 3 }]);
    await expect.poll(async () => (await fake.sentSoFar(page)).at(-1)?.type).toBe("promise");
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ op: "make", what: "role", item: "t_honor_light", due: 3, version: 43 });
    await fake.feedFrame(page, {}, [
      { kind: "pledged", tick: 6, npc: "li_laotai", pledge: "k1", what: "role", item: "t_honor_light", amount: 0, due: 3 },
      { kind: "action_ack", tick: 6, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("request-result")).toHaveText("You gave your word to Granny Li.");
    // The core no longer lists what was asked in return: the frame has no wants, and the request turned down is on offer again.
    await talkKeys(page, { wants: null, queue: [KEEP, { kind: "give" }] });
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await fake.answerPreview(page, { ...fake.PREVIEW, version: 60, blockers: [] });
    await page.getByTestId("request-follow").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-verb", "entrust");
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_laotai", kind: "material" }]);
    // It is sent when the player confirms it, with the version of the new preview.
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", kind: "material", version: 60 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("sends nothing when the player says no, and does not put the same question again, and it comes again when the core gives it a new token", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await asking(page);
    await page.getByTestId("answer-no").click();
    expect(await fake.sentSoFar(page)).toEqual([]);
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    // What is behind it is first now: the promise that can be kept, and then the one that can be made.
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "keep");
    await expect(page.getByTestId("verb-context")).toHaveText("Keep your promise to Granny Li ahead of time: 10 coins in wages");
    await expect(page.getByTestId("context-more")).toHaveText("1 more");
    // The core lists it still, and the page does not show it again until the proposal changes.
    await asking(page);
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await asking(page, { wants: { ...WANTS, token: "bbbbbbbb" }, queue: [{ ...ANSWER, token: "bbbbbbbb" }, KEEP, { kind: "give" }] });
    await expect(page.getByTestId("answer-line")).toHaveAttribute("data-token", "bbbbbbbb");
    // Another request that was weighed alike has the same token, and it is a question of its own: it is put even though this one was put aside.
    await page.getByTestId("answer-no").click();
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    const other = { ...ANSWER, key: "li_laotai|join|", token: "bbbbbbbb" };
    await asking(page, { wants: { ...WANTS, key: other.key, token: other.token }, queue: [other, KEEP, { kind: "give" }] });
    await expect(page.getByTestId("answer-line")).toHaveAttribute("data-token", "bbbbbbbb");
    await expect(page.getByTestId("answer-line")).toHaveAttribute("data-key", "li_laotai|join|");
  });

  test("keeps a promise from the button, with the preview of the core first, as the promise it is, and the request is not asked again after it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, { ...fake.PROMISE_PREVIEW, asks: n("兑现：十文工钱", "Keep: 10 coins in wages"), gives: n("兑现：十文工钱", "Keep: 10 coins in wages") });
    await fake.startTalk(page, "li_laotai");
    await talkKeys(page, { ask_for: null, wants: null, keep: KEEP, queue: [KEEP, KEEP_ONE, { kind: "give" }] });
    await expect(page.getByTestId("verb-context")).toHaveText("Keep your promise to Granny Li ahead of time: 10 coins in wages");
    await expect(page.getByTestId("context-more")).toHaveText("2 more");
    await page.getByTestId("verb-context").click();
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_laotai", op: "keep", id: "k1" }]);
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "promise", op: "keep", id: "k1" });
    // A promise kept after its day, and none kept early, says the same without "early".
    await talkKeys(page, { keep: { ...KEEP, early: false }, queue: [{ ...KEEP, early: false }] });
    await page.evaluate(() => window.__lantern.play.flows.cancel());
    await expect(page.getByTestId("verb-context")).toHaveText("Keep your promise to Granny Li: 10 coins in wages");
    // Each of the rest can be done from its list, as a first can, and so can one kept early.
    await talkKeys(page, { keep: KEEP, queue: [KEEP, KEEP_ONE, { kind: "give" }] });
    await page.getByTestId("context-more").click();
    await page.getByTestId("picker-rest").getByTestId("picker-option").first().click();
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_laotai", op: "keep", id: "k1" }, { verb: "promise", npc: "li_laotai", op: "keep", id: "k2" }]);
  });

  test("lists what can be promised, the one the person wants first and the others after, and a promise from it is previewed and sent as a promise", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, PROMISE_PREVIEW);
    await fake.startTalk(page, "li_laotai");
    const more = { id: "stall:front", label: n("许李老太一个前排摊位", "Promise Granny Li a front-row stall"), body: { op: "make", due: 3, what: "stall", item: "front" } };
    await talkKeys(page, { wants: null, keep: null, queue: [{ kind: "give" }], give: { preferred: WANTS.offer, more: [more], ways: [] } });
    await expect(page.getByTestId("verb-context")).toHaveText("Promise Granny Li something");
    await page.getByTestId("verb-context").click();
    const list = page.getByTestId("picker-promise");
    await expect(list.locator(".picker-heading")).toHaveText(["What Granny Li wants", "Others"]);
    await expect(list.getByTestId("picker-option")).toHaveText(["Promise Granny Li the honour of lighting the main lantern", "Promise Granny Li a front-row stall"]);
    await list.locator('[data-id="role:t_honor_light"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-verb", "promise");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_laotai", op: "make", what: "role", item: "t_honor_light", due: 3 }]);
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "promise", op: "make", what: "role", item: "t_honor_light", due: 3, version: 43 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says what can be done instead when nothing is left to promise", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await talkKeys(page, { wants: null, keep: null, queue: [{ kind: "give" }], give: { preferred: null, more: [], ways: ["clear_truth", "gift", "ask_others"] } });
    await page.getByTestId("verb-context").click();
    await expect(page.getByTestId("give-none")).toHaveText("Nothing is left to promise. You can still try these.");
    await expect(page.getByTestId("give-ways").locator("li")).toHaveCount(3);
    await expect(page.locator('[data-way="clear_truth"]')).toContainText("Set the truth straight in public, where Granny Li will hear it");
    await expect(page.locator('[data-way="ask_others"]')).toContainText("Ask someone else to help");
    // The way of the gift has its button, which opens the small things.
    await page.getByTestId("give-way-gift").click();
    await expect(page.getByTestId("gift-panel")).toBeVisible();
    // With nothing to promise and no way left the talk puts nothing forward.
    await talkKeys(page, { queue: [], give: { preferred: null, more: [], ways: [] } });
    await expect(page.getByTestId("talk-context")).toHaveCount(0);
  });
});

test.describe("a look that was turned down", () => {
  test("is followed by a talk that puts the promise forward with no question, and the look is made again after it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { hud: { verbs: ["move", "look"] } });
    await fake.recordSent(page);
    await fake.answerPreview(page, PROMISE_PREVIEW);
    // The boatman will not let the manager look at his boat yet: the core turns the look down, and the page says why.
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), look: ["t_he_boat"] } });
    await page.getByTestId("verb-look").click();
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "look", at: "t_he_boat" });
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 5, action_id: await lastId(page), result: "rejected", reason: "refused" }]);
    await expect(page.getByTestId("game-note").last()).toHaveText("You hardly know each other, so they will not let you look.");
    // In the talk with him the promise is put forward, though nothing was asked: no question, and the one he wants is first.
    await fake.startTalk(page, "old_he");
    await talkKeys(page, { ask_for: null, asks_more: [], wants: null, keep: null, queue: [{ kind: "give" }], give: { preferred: { id: "wage:10", label: n("许李老太十文工钱", "Promise Granny Li 10 coins in wages"), body: { op: "make", what: "wage", amount: 10, due: 3 } }, more: [], ways: [] } });
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "give");
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await page.getByTestId("verb-context").click();
    await expect(page.getByTestId("picker-promise").getByTestId("picker-option")).toHaveText(["Promise Granny Li 10 coins in wages"]);
    await page.getByTestId("picker-promise").getByTestId("picker-option").click();
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "promise", op: "make", what: "wage", amount: 10 });
    await fake.feedFrame(page, {}, [
      { kind: "pledged", tick: 6, npc: "old_he", pledge: "k1", what: "wage", item: "", amount: 10, due: 3 },
      { kind: "action_ack", tick: 6, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("request-result")).toHaveText("You gave your word to Boatman He.");
    // Out of the talk, the look is made again.
    await page.getByTestId("verb-leave").click();
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null, look: ["t_he_boat"] }, hud: { verbs: ["move", "look"] } }, [{ kind: "talk_end", tick: 7, npc: "old_he", reason: "left" }]);
    await page.getByTestId("verb-look").click();
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "look")).toHaveLength(2);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("telling", () => {
  test("lists what has been noted, and a line the manager saw is told as it is at once, with nothing to choose", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-tell").click();
    const tell = page.getByTestId("picker-tell");
    await expect(tell).toBeVisible();
    await expect(tell.getByTestId("picker-option")).toHaveCount(4);
    // Each says how it reached the manager, in the words people use, with no count of hands.
    await expect(tell.locator('[data-id="n_scrape"] .picker-badge')).toHaveText("You saw it");
    await expect(tell.locator('[data-id="n_clerk"] .picker-badge')).toHaveText("Zhou's Clerk says they saw it");
    await expect(tell.locator('[data-id="n_broke"] .picker-badge')).toHaveText("Teahouse Keeper says they heard it from Shopkeeper Zhou");
    expect(await tell.innerText()).not.toMatch(/hand|第[一二三四]手/i);
    await tell.locator('[data-id="n_scrape"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "tell", entry: "n_scrape", how: "faithful" });
    await expect(page.getByTestId("picker-tell")).toHaveCount(0);
  });

  test("asks how, for a line the manager did not see: as it is, or as if seen with what that risks, and sends the way chosen", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-tell").click();
    await page.locator('[data-testid="picker-tell"] [data-id="n_clerk"]').click();
    const how = page.getByTestId("say-how");
    await expect(how).toBeVisible();
    await expect(page.getByTestId("say-line")).toHaveText("Li Er was at the bridge last night.");
    await expect(page.getByTestId("tell-faithful")).toHaveText("Tell it as it is");
    await expect(page.getByTestId("tell-as_seen")).toHaveText("Say I saw it myself");
    await expect(page.getByTestId("say-risk")).toHaveText("You did not see this yourself, so saying so is a lie. If you are caught, Granny Li will trust you less.");
    // Nothing is sent by choosing the line.
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "tell")).toEqual([]);
    await lantern.setLang("zh");
    await expect(page.getByTestId("tell-faithful")).toHaveText("照实说");
    await expect(page.getByTestId("tell-as_seen")).toHaveText("说成我亲眼看见的");
    await expect(page.getByTestId("tell-back")).toHaveText("换一条");
    // Back to the list, and the other line, told the other way.
    await page.getByTestId("tell-back").click();
    await expect(page.getByTestId("picker-tell")).toBeVisible();
    await page.locator('[data-testid="picker-tell"] [data-id="n_broke"]').click();
    await page.getByTestId("tell-as_seen").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "tell", entry: "n_broke", how: "as_seen" });
    await page.getByTestId("verb-tell").click();
    await page.locator('[data-testid="picker-tell"] [data-id="n_clerk"]').click();
    await page.getByTestId("tell-faithful").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "tell", entry: "n_clerk", how: "faithful" });
    // The three other ways of telling are not there for the player.
    for (const gone of ["verb-tellOther", "picker-tellOther"]) await expect(page.getByTestId(gone)).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says that there is nothing to tell when nothing is noted", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai", { notebook: [] });
    await page.getByTestId("verb-tell").click();
    await expect(page.getByTestId("picker-tell").getByTestId("picker-empty")).toHaveText("You have noted nothing to tell yet.");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("picker-tell")).toHaveCount(0);
  });
});

test.describe("a gift", () => {
  test("is one of the four small things of the day, with what the manager knows of the person's tastes beside each, and goes at once", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai", {
      people: [
        fake.relationRow("li_laotai", {
          likes_known: [
            { item: "tea", like: "like" },
            { item: "wine", like: "dislike" },
          ],
        }),
      ],
    });
    await page.getByTestId("gift-open").click();
    const panel = page.getByTestId("gift-panel");
    await expect(panel.locator(".picker-label")).toHaveText(["tea leaves", "pastries", "lantern paper", "wine"]);
    await expect(panel.locator('[data-id="tea"] .picker-badge')).toHaveText("Granny Li likes it");
    await expect(panel.locator('[data-id="wine"] .picker-badge')).toHaveText("Granny Li does not care for it");
    await expect(panel.locator('[data-id="pastry"] .picker-badge')).toHaveCount(0);
    await expect(page.getByTestId("gift-note")).toHaveText("You can give one gift a day, whoever it is for. One person takes at most two.");
    // No minutes are written on it, and none are spent: the act is not one of those that have a cost.
    expect(await panel.innerText()).not.toMatch(/min|分钟/);
    await lantern.setLang("zh");
    await page.getByTestId("gift-open").click();
    await expect(panel.locator(".picker-label")).toHaveText(["茶叶", "点心", "灯纸", "酒"]);
    await expect(panel.locator('[data-id="tea"] .picker-badge')).toHaveText("李老太喜欢");
    await panel.locator('[data-id="tea"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "gift", item: "tea" });
    await expect(page.getByTestId("gift-panel")).toHaveCount(0);
    // The person's answer is the core's line, after the line of the gift.
    const reaction = { npc: "li_laotai", until: 999_999, text: n("茶叶啊，我就爱这个，多谢！", "Tea leaves! Just what I like. Thank you!") };
    await fake.feedFrame(page, { bubbles: [reaction], hud: { verbs: fake.TALK_VERBS.filter((v) => v !== "gift"), verbs_off: { gift: "gift_today" }, gift: fake.giftHud(true, "li_laotai") } }, [
      { kind: "gifted", tick: 8, npc: "li_laotai", item: "tea", like: "like", gain: 8 },
      { kind: "hearts", tick: 8, npc: "li_laotai", delta: 1, hearts: 4, why: "gift" },
      { kind: "action_ack", tick: 8, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("talk-line").first()).toHaveText("你送了茶叶");
    await expect(page.getByTestId("talk-line").nth(1)).toHaveText("茶叶啊，我就爱这个，多谢！");
    // And the heart that moved is said on the spot, with the reason, and the button is greyed with its reason.
    await expect(page.getByTestId("heart-pop")).toContainText("你送了礼");
    await expect(page.getByTestId("gift-open")).toHaveAttribute("aria-disabled", "true");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the hearts", () => {
  const CARD = {
    trust: "friendly",
    owes_you: 1,
    you_owe: 0,
    you_promised: [{ id: "k1", what: "wage", item: "", amount: 10, due: 3 }],
    promised_you: [{ id: "c1", by: "li_laotai", to: "player", what: n("把四根竹料送到石桥", "Bring 4 poles of bamboo to the Stone Bridge"), item: "bamboo", amount: 4, due: { day: 2, hour: 7 }, state: "promised", reason: null }],
    changes: [
      { tick: 360, day: 1, hour: 9, minute: 0, delta: 1, why: "talk" },
      { tick: 400, day: 1, hour: 10, minute: 0, delta: 2, why: "kept" },
      { tick: 500, day: 1, hour: 11, minute: 30, delta: -1, why: "lie" },
    ],
    waiting: 2,
  };

  test("are five, on the card of the person and in the talk, say their number in words, and the world stands still while the card is open", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai", { people: [fake.relationRow("li_laotai", { hearts: 7, card: CARD })] });
    const hearts = page.getByTestId("talk-head").getByTestId("hearts");
    await expect(hearts).toHaveAttribute("data-value", "7");
    await expect(hearts.locator("svg.heart")).toHaveCount(5);
    await expect(hearts.locator("svg.heart.is-full")).toHaveCount(3);
    await expect(hearts.locator("svg.heart.is-half")).toHaveCount(1);
    await expect(hearts.locator("svg.heart.is-empty")).toHaveCount(1);
    await expect(hearts).toHaveAttribute("aria-label", "3 and a half of five hearts. See how things stand between you");
    await lantern.setLang("zh");
    await expect(hearts).toHaveAttribute("aria-label", "三颗半，满分五颗心。看看你们的交情");
    await lantern.setLang("en");
    // The hearts on the card of the person are the same hearts, and the person who is not met has none.
    await expect(page.getByTestId("person-hearts").getByTestId("hearts")).toHaveAttribute("data-value", "7");
    await fake.feedFrame(page, { people: [fake.relationRow("li_laotai", { hearts: 0, known: false, card: null })] });
    await expect(page.getByTestId("person-hearts")).toHaveCount(0);
    await fake.feedFrame(page, { people: [fake.relationRow("li_laotai", { hearts: 7, card: CARD })] });
    // Pressing them opens the card, in plain words.
    await hearts.click();
    const sheet = page.getByTestId("hearts-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.getByTestId("hearts-trust")).toHaveText("Granny Li trusts you.");
    await expect(page.getByTestId("hearts-favours")).toHaveText("Granny Li owes you a favour.");
    await expect(page.getByTestId("hearts-you-promised").getByTestId("hearts-promise")).toHaveText("10 coins in wages, due by Day 3");
    await expect(page.getByTestId("hearts-promised-you").getByTestId("hearts-owed")).toContainText("Bring 4 poles of bamboo to the Stone Bridge");
    await expect(page.getByTestId("hearts-waiting")).toHaveText("Waiting for people they know to come first, 2 more to go");
    await expect(page.getByTestId("hearts-change")).toHaveCount(3);
    await expect(page.getByTestId("hearts-change").nth(1)).toContainText("+a heart");
    await expect(page.getByTestId("hearts-change").nth(1)).toContainText("you kept a promise");
    await expect(page.getByTestId("hearts-change").nth(2)).toContainText("−half a heart");
    await expect(page.getByTestId("hearts-change").nth(2)).toContainText("your lie was caught");
    await expect(page.getByTestId("hearts-closer-text")).toHaveText("Help Granny Li out and keep your promises on time. Give Granny Li things they like. Do not lie. A lie that is caught costs hearts.");
    await expect(page.getByTestId("hearts-likes")).toHaveText("You do not know what Granny Li likes yet. Try a gift, or ask around.");
    expect(await sheet.innerText()).not.toMatch(/hand|第[一二三四]手|把握/);
    // The world is held while the card is up, and it is put away by its word, its corner and Escape.
    await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    await page.getByTestId("hearts-close").click();
    await expect(sheet).toHaveCount(0);
    await hearts.click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await lantern.setLang("zh");
    await page.getByTestId("talk-head").getByTestId("hearts").click();
    await expect(page.getByTestId("hearts-trust")).toHaveText("李老太信得过你。");
    await expect(page.getByTestId("hearts-waiting")).toHaveText("想等熟人先来，还差两个");
    await expect(page.getByTestId("hearts-change").nth(1)).toContainText("你兑现了答应的事");
    await page.getByTestId("hearts-x").click();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("have a card whose gift button gives from the talk, and is greyed with its reason when the town cannot give", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai", {
      people: [
        fake.relationRow("li_laotai", {
          hearts: 4,
          likes_known: [
            { item: "tea", like: "like" },
            { item: "pastry", like: "neutral" },
          ],
        }),
      ],
    });
    await page.getByTestId("talk-head").getByTestId("hearts").click();
    await expect(page.getByTestId("hearts-likes").locator("p")).toHaveText(["Likes: tea leaves", "Does not mind: pastries"]);
    await page.getByTestId("hearts-gift").click();
    await expect(page.getByTestId("hearts-sheet")).toHaveCount(0);
    await expect(page.getByTestId("gift-panel")).toBeVisible();
    await page.keyboard.press("Escape");
    await fake.feedFrame(page, { hud: { verbs: fake.TALK_VERBS.filter((v) => v !== "gift"), verbs_off: { gift: "gift_today" } } });
    await page.getByTestId("talk-head").getByTestId("hearts").click();
    await expect(page.getByTestId("hearts-gift")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("hearts-gift-off")).toHaveText("A gift has been given today already. Try again tomorrow.");
  });

  test("that move are said on the spot with a small heart and the reason, for the person talked to, and go after a few seconds", async ({ lantern }) => {
    const page = lantern.page;
    // A pop goes after 6 seconds, which a slow machine can take between two calls: it goes after four times as long here, and the test waits for it.
    await lantern.stretchTimer(6000);
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await fake.feedFrame(page, { people: [fake.relationRow("li_laotai", { hearts: 4 })] }, [{ kind: "hearts", tick: 3, npc: "li_laotai", delta: 1, hearts: 4, why: "kept" }]);
    const pop = page.getByTestId("heart-pop");
    await expect(pop).toHaveAttribute("data-delta", "1");
    await expect(pop).toHaveAttribute("data-why", "kept");
    await expect(pop).toContainText("+half a heart");
    await expect(pop).toContainText("you kept a promise");
    await expect(pop.locator("svg.heart")).toHaveCount(1);
    await lantern.switchLang("zh");
    await expect(pop).toContainText("+半颗心");
    await expect(pop).toContainText("你兑现了答应的事");
    await fake.feedFrame(page, {}, [{ kind: "hearts", tick: 4, npc: "li_laotai", delta: -3, hearts: 1, why: "lie" }]);
    await expect(page.getByTestId("heart-pop")).toHaveCount(2);
    await expect(page.getByTestId("heart-pop").nth(1)).toContainText("−一颗半心");
    // A heart of somebody else is not said in this talk, nor over the map.
    await fake.feedFrame(page, {}, [{ kind: "hearts", tick: 5, npc: "li_da", delta: 1, hearts: 2, why: "kept" }]);
    await expect(page.getByTestId("heart-pop")).toHaveCount(2);
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    // They go by themselves.
    await expect(page.getByTestId("heart-pop")).toHaveCount(0, { timeout: 40_000 });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("time in a talk", () => {
  /** A talk with Granny Li at `hour`:`minute`, who has to go at 15:30. */
  async function talkAt(page: Page, hour: number, minute: number): Promise<void> {
    await fake.startTalk(page, "li_laotai", { time: { day: 1, hour, minute, phase: "day" } });
  }
  const WILL_GO = { en: "Granny Li will have to go once this is said", zh: "说完这句，李老太就该走了" } as const;

  test("says on the button of an act that would run to the hour the person has to go that they will have to go once it is said, and on no other", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await talkAt(page, 15, 15);
    // 15:15 and 15:30: telling (15) and a request (20) run to it, a question (10) does not.
    for (const verb of ["tell", "entrust"]) {
      await expect(page.getByTestId(`late-${verb}`)).toHaveText(WILL_GO.en);
      await expect(page.getByTestId(`verb-${verb}`)).toContainText(WILL_GO.en);
    }
    for (const verb of ["ask", "leave"]) await expect(page.getByTestId(`late-${verb}`)).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(page.getByTestId("late-entrust")).toHaveText(WILL_GO.zh);
    expect(await fake.fitsWidth(page)).toBe(true);
    // Ten minutes later a question runs to it too, and the list says so.
    await lantern.setLang("en");
    await talkAt(page, 15, 20);
    await expect(page.getByTestId("late-ask")).toHaveText(WILL_GO.en);
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("chips-late")).toHaveText(WILL_GO.en);
    // Early in the day none of them does, and a frame that does not say the hour says nothing of it.
    await talkAt(page, 8, 30);
    await expect(page.locator('[data-testid^="late-"]')).toHaveCount(0);
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: { npc: "li_laotai", costs: fake.COSTS } }, time: { day: 1, hour: 15, minute: 25, phase: "day" } });
    await expect(page.locator('[data-testid^="late-"]')).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says it in the preview of a request that would run to the hour, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.answerPreview(page, fake.PREVIEW);
    await talkAt(page, 15, 15);
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-leaves")).toHaveText(WILL_GO.en);
    await lantern.setLang("zh");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-leaves")).toHaveText(WILL_GO.zh);
    await talkAt(page, 14, 0);
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("request-leaves")).toHaveCount(0);
  });

  test("says that time is passing while an act is paid for, holds the acts back until the world stands still, and lets leaving through", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await talkKeys(page, { ask_for: null });
    const acts = ["ask", "tell", "entrust"];
    const badge = page.getByTestId("talk-badge");
    await expect(badge).toHaveAttribute("data-paying", "false");
    await expect(badge.getByTestId("talk-still")).toHaveText("Time stands still while you talk");
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "true");
    // An act is paid for: the clock runs at [20, 1] and is not held.
    await fake.feedFrame(page, {}, [], fake.PAYING);
    await expect(badge).toHaveAttribute("data-paying", "true");
    await expect(badge.getByTestId("talk-passing")).toHaveText("Time is moving on");
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeDisabled();
    await expect(page.getByTestId("verb-leave")).toBeEnabled();
    await expect(page.getByTestId("talk-time-note")).toHaveAttribute("data-paying", "true");
    await expect(page.getByTestId("talk-time-note")).toHaveText("Time is moving on. You can go on when it stands still again.");
    await expect(page.getByTestId("gift-open")).toBeEnabled();
    await lantern.setLang("zh");
    await expect(badge.getByTestId("talk-passing")).toHaveText("时间在走");
    await fake.feedFrame(page, {}, [], { paused: true, rate: [20, 1] });
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeDisabled();
    await fake.feedFrame(page, {}, [], { paused: true, rate: [1, 1] });
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "true");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("leaving a talk", () => {
  test("sends the leave, puts away a request that was not confirmed and the lists, and takes the talk area away when the core ends the talk", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("request-card")).toHaveCount(0);
    await page.getByTestId("verb-leave").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "leave" });
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null }, hud: { verbs: ["move"] } }, [
      { kind: "action_ack", tick: 7, action_id: await lastId(page), result: "applied", reason: null },
      { kind: "talk_end", tick: 7, npc: "li_laotai", reason: "left" },
    ]);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await expect(page.getByTestId("verb-ask")).toHaveCount(0);
  });
});

test.describe("a small window", () => {
  /** Whether a line of a paper that scrolls is above the foot of the paper, so that it can be read. */
  const readable = (line: Locator, paper: string): Promise<boolean> =>
    line.evaluate((element, selector) => {
      const box = element.closest(selector)?.getBoundingClientRect();
      return box !== undefined && element.getBoundingClientRect().bottom <= box.bottom + 1;
    }, paper);

  /** The last line of the paper is under its foot, the phrase at the foot turns it, and then there is no phrase, for the line is in view. */
  async function turns(page: Page, bar: string, last: Locator, paper: string): Promise<void> {
    await expect(page.getByTestId(bar)).toBeVisible();
    expect(await readable(last, paper)).toBe(false);
    // The phrase turns the paper to the lines that come next, and is pressed until the last line is in view, when there is no phrase.
    await expect
      .poll(
        async () => {
          if (await readable(last, paper)) return true;
          await page.getByTestId(bar).getByRole("button").click({ timeout: 2000 }).catch(() => undefined);
          return readable(last, paper);
        },
        { timeout: 20_000, intervals: [200] },
      )
      .toBe(true);
    await expect(page.getByTestId(bar)).toHaveCount(0);
  }

  const PEOPLE: ReadonlyArray<[string, string, string]> = [
    ["li_da", "李大", "Li Da"],
    ["li_er", "李二", "Li Er"],
    ["zhou_zhanggui", "周掌柜", "Shopkeeper Zhou"],
    ["zhou_niangzi", "周娘子", "Madam Zhou"],
    ["old_he", "船夫老何", "Boatman He"],
    ["shitou", "石头", "Shitou"],
  ];

  test("have the phrase that turns a list of requests that runs past its foot, and none where the list is all in view", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1200, height: 600 });
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    const asks = PEOPLE.map(([id, zh, en]) => ({ id: `persuade:${id}`, label: n(`请李老太去劝${zh}`, `Ask Granny Li to talk ${en} round`), body: { kind: "persuade", target: id }, status: "open" }));
    // Two requests are all in view, and there is no phrase.
    await talkKeys(page, { asks_more: asks.slice(0, 1), give: { preferred: null, more: [], ways: [] } });
    await page.getByTestId("entrust-more").click();
    await expect(page.getByTestId("picker-entrust")).toBeVisible();
    await expect(page.getByTestId("picker-turn")).toHaveCount(0);
    // Six more are not, and the phrase turns the list to the last of them. It is the same phrase in both languages' words.
    await talkKeys(page, { asks_more: asks, give: { preferred: WANTS.offer, more: [], ways: [] } });
    await expect(page.getByTestId("picker-entrust")).toBeVisible();
    await expect(page.getByTestId("picker-turn")).toHaveText("More below");
    await turns(page, "picker-turn", page.getByTestId("picker-entrust").getByTestId("picker-option").last(), ".picker");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("have the phrase that turns the slip of topics, where the others of it run past its foot", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1200, height: 600 });
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    const player = await fake.playerOf(page);
    const people = Array.from({ length: 6 }, (_, copy) => PEOPLE.map(([id, zh, en]) => ({ id: copy === 0 ? id : `${id}_${copy}`, kind: "person", label: n(zh, en) }))).flat();
    await fake.feedFrame(page, { player: { ...player, topics: [...(player.topics as unknown[]), ...people, { id: "p_bridge", kind: "place", label: n("石桥", "Stone Bridge") }] } });
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await page.getByTestId("ask-more").click();
    await turns(page, "chips-turn", page.getByTestId("topic-chip").last(), ".chips");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("have the phrase that turns the card of the hearts, where it runs past its foot", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1200, height: 600 });
    await fake.openFirstDay(lantern);
    const card = {
      trust: "friendly",
      owes_you: 1,
      you_owe: 0,
      you_promised: [{ id: "k1", what: "wage", item: "", amount: 10, due: 3 }],
      promised_you: [{ id: "c1", by: "li_laotai", to: "player", what: n("把四根竹料送到石桥", "Bring 4 poles of bamboo to the Stone Bridge"), item: "bamboo", amount: 4, due: { day: 2, hour: 7 }, state: "promised", reason: null }],
      changes: [
        { tick: 360, day: 1, hour: 9, minute: 0, delta: 1, why: "talk" },
        { tick: 400, day: 1, hour: 10, minute: 0, delta: 2, why: "kept" },
        { tick: 500, day: 1, hour: 11, minute: 30, delta: -1, why: "lie" },
      ],
      waiting: 2,
    };
    await fake.startTalk(page, "li_laotai", { people: [fake.relationRow("li_laotai", { hearts: 7, card })] });
    await page.getByTestId("talk-head").getByTestId("hearts").click();
    await expect(page.getByTestId("hearts-sheet")).toBeVisible();
    await turns(page, "hearts-turn", page.getByTestId("hearts-gift"), ".sheet-scroll");
    expect(lantern.pageErrors).toEqual([]);
  });
});
