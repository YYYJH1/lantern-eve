import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { mapAtRest, openTheNote, pickAtSpot } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// The buttons of the tasks of the days after the first: each request a task may ask of a person and each way of speaking in public has
// its words in both languages, and a click does what the task says. A request has the talk with that request ready, with its preview, and
// the player has only to go ahead. Fake frames, with the world held; what the page sends is recorded and not passed on.
test.use({ map: true });

interface Request {
  task: string;
  npc: string;
  en: string;
  zh: string;
  /** What the host is asked for a preview of. */
  asked: Record<string, unknown>;
}

const REQUESTS: Request[] = [
  { task: "t_bamboo_more", npc: "li_da", en: "Ask Li Da to send a batch of bamboo", zh: "请李大送一批竹料", asked: { verb: "entrust", npc: "li_da", kind: "material" } },
  { task: "t_timber", npc: "zhou_zhanggui", en: "Ask Shopkeeper Zhou to send a batch of timber", zh: "请周掌柜送一批木料", asked: { verb: "entrust", npc: "zhou_zhanggui", kind: "material" } },
  { task: "t_lend", npc: "li_laotai", en: "Ask Granny Li to lend the bamboo", zh: "请李老太借出竹料", asked: { verb: "entrust", npc: "li_laotai", kind: "lend" } },
  { task: "t_helper_zhou", npc: "zhou_dalang", en: "Ask Zhou Dalang to help out", zh: "请周家大郎来帮忙", asked: { verb: "entrust", npc: "zhou_dalang", kind: "join" } },
  { task: "t_helper_chain", npc: "li_xiaomei", en: "Ask Li Xiaomei to talk Zhou Erlang round", zh: "请李家小妹去劝周家二郎", asked: { verb: "entrust", npc: "li_xiaomei", kind: "persuade", target: "zhou_erlang" } },
  { task: "t_lane", npc: "miaozhu", en: "Ask Temple Keeper to open the lane behind the temple", zh: "请庙祝打开庙后的夹道", asked: { verb: "entrust", npc: "miaozhu", kind: "lane" } },
  { task: "t_witness", npc: "gengfu", en: "Ask Night Watchman to say what they saw", zh: "请更夫说说亲眼看见了什么", asked: { verb: "entrust", npc: "gengfu", kind: "testify" } },
  { task: "t_convene", npc: "zuzhang", en: "Ask Clan Elder to call the clan", zh: "请族长召集族人", asked: { verb: "entrust", npc: "zuzhang", kind: "convene" } },
];

/** Opens the first day with the tasks of the days after, one of them followed, and takes the preview and the actions into the test's hands. */
async function open(lantern: Parameters<typeof fake.openFirstDay>[0], tracked: string): Promise<Page> {
  await fake.openFirstDay(lantern, fake.laterTasks(tracked));
  await fake.recordSent(lantern.page);
  await fake.answerPreview(lantern.page, fake.PREVIEW);
  return lantern.page;
}

test.describe("the button of a task that asks a person for something", () => {
  for (const request of REQUESTS) {
    test(`${request.task} (${String(request.asked.kind)}) says what it asks in both languages, walks up to the person, and has the request ready in the talk`, async ({ lantern }) => {
      const page = await open(lantern, request.task);
      const button = page.getByTestId("task-do");
      await expect(button).toHaveText(request.en);
      await expect(button).toHaveAttribute("data-verb", "entrust");
      await lantern.setLang("zh");
      await expect(button).toHaveText(request.zh);
      await lantern.setLang("en");
      // The player is not in a talk with them: the page asks for the talk, and nothing of the request is sent.
      await button.click();
      const sent = await fake.sentSoFar(page);
      expect(sent.map((s) => s.type)).toEqual([expect.stringMatching(/^(move|talk)$/)]);
      // The talk is on, and the town puts the request forward: the request is up with its preview, and the list is not opened in its place.
      await fake.startTalk(page, request.npc, {}, fake.TALK_VERBS, fake.entrustOffers(request.npc));
      const card = page.getByTestId("request-card");
      await expect(card).toHaveAttribute("data-phase", "preview");
      await expect(card).toHaveAttribute("data-verb", "entrust");
      await expect(page.getByTestId("picker-entrust")).toHaveCount(0);
      expect(await fake.previewsAsked(page)).toEqual([request.asked]);
      await expect(page.getByTestId("request-confirm")).toBeEnabled();
      await expect(page.getByTestId("request-cancel")).toBeEnabled();
      expect((await fake.sentSoFar(page)).filter((s) => s.type === "entrust")).toEqual([]);
      // The player goes ahead, and what is sent is the request with the version the preview was made on.
      await page.getByTestId("request-confirm").click();
      const { verb: _verb, npc: _npc, ...fields } = request.asked;
      expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", ...fields, version: 42 });
      expect(lantern.pageErrors).toEqual([]);
    });
  }

  test("has the request ready at once when the player is already talking to the person, and a second button replaces the first", async ({ lantern }) => {
    const page = await open(lantern, "t_helper_chain");
    await fake.startTalk(page, "li_xiaomei", fake.laterTasks("t_helper_chain"), fake.TALK_VERBS, fake.entrustOffers("li_xiaomei"));
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_xiaomei", kind: "persuade", target: "zhou_erlang" }]);
    // No second talk is asked for.
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "talk")).toEqual([]);
    // The task that names the other person to talk round has that one picked.
    const other = fake.laterTasks("t_helper_chain");
    (other.tasks as Array<Record<string, unknown>>)[4] = { ...(other.tasks as Array<Record<string, unknown>>)[4], action: { verb: "entrust", npc: "li_xiaomei", request: "persuade", target: "zhou_dalang" } };
    await fake.feedFrame(page, other);
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    await expect.poll(async () => (await fake.previewsAsked(page)).length).toBe(2);
    expect((await fake.previewsAsked(page))[1]).toEqual({ verb: "entrust", npc: "li_xiaomei", kind: "persuade", target: "zhou_dalang" });
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
  });

  test("opens the list of what to ask when the town does not put that request forward to the person now", async ({ lantern }) => {
    const page = await open(lantern, "t_helper_zhou");
    // The town offers Zhou Dalang nothing to ask: the list is open, and says so.
    await fake.startTalk(page, "zhou_dalang", {}, fake.TALK_VERBS, []);
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("picker-entrust")).toBeVisible();
    await expect(page.getByTestId("request-card")).toHaveCount(0);
    expect(await fake.previewsAsked(page)).toEqual([]);
    // Another person's request is not this one: the list has what the town puts forward.
    await page.getByTestId("picker-close").click();
    await fake.startTalk(page, "zhou_dalang", {}, fake.TALK_VERBS, fake.entrustOffers("li_da"));
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    // The list has everything that can be asked of the person, the request on the button of the talk too, and what can be promised.
    await expect(page.getByTestId("picker-entrust").locator('[data-group="asks"] [data-testid="picker-option"]')).toHaveText(["Ask Li Da to bring the bamboo to the bridge"]);
    await expect(page.getByTestId("request-card")).toHaveCount(0);
  });

  test("asks for the one request the town puts forward when the task names only the thing it wants, and opens the list where it puts none", async ({ lantern }) => {
    await fake.openFirstDay(lantern, { tracked: "t_plain", tasks: [{ id: "t_plain", kind: "need", job: "bridge", text: { zh: "取得竹料", en: "Get the bamboo" }, state: "open", action: { verb: "entrust", npc: "li_laotai", item: "bamboo" }, window: null }] });
    const page = lantern.page;
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await expect(page.getByTestId("task-do")).toHaveText("Ask Granny Li for help");
    await fake.startTalk(page, "li_laotai");
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    // The request on the button of the talk is the one the task asks for, and its preview is up: there is no list to pick it from.
    await expect(page.getByTestId("picker-entrust")).toHaveCount(0);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_laotai", kind: "material" }]);
    // Where the town puts no request forward, the list is what opens.
    await page.getByTestId("request-cancel").click();
    await fake.startTalk(page, "li_laotai", {}, fake.TALK_VERBS, []);
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("picker-entrust")).toBeVisible();
    await expect(page.getByTestId("request-card")).toHaveCount(0);
  });
});

test.describe("the button of a task that keeps a promise", () => {
  test("says it in both languages, walks up to the person and has the offer that keeps the promise ready in the talk", async ({ lantern }) => {
    await fake.openFirstDay(lantern, { tracked: "t_keep_1", tasks: [fake.keepTask()] });
    const page = lantern.page;
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    const button = page.getByTestId("task-do");
    await expect(button).toHaveText("Keep your promise to Li Da");
    await expect(button).toHaveAttribute("data-verb", "promise");
    await lantern.setLang("zh");
    await expect(button).toHaveText("兑现对李大的许诺");
    await lantern.setLang("en");
    await button.click();
    expect((await fake.sentSoFar(page)).map((s) => s.type)).toEqual([expect.stringMatching(/^(move|talk)$/)]);
    // The talk is on, and the town puts the open promise forward among the offers of a promise: it is up with its preview, and the list is not.
    await fake.startTalk(page, "li_da", {}, fake.TALK_VERBS, fake.entrustOffers("li_da"), fake.promiseOffers());
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    await expect(card).toHaveAttribute("data-verb", "promise");
    await expect(page.getByTestId("picker-promise")).toHaveCount(0);
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_da", op: "keep", id: "k1" }]);
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "promise")).toEqual([]);
    // The player goes ahead, and what is sent keeps that promise, on the version the preview was made on.
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "promise", op: "keep", id: "k1", version: 42 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("opens the list of what to promise when the promise is not open with the person now", async ({ lantern }) => {
    await fake.openFirstDay(lantern, { tracked: "t_keep_1", tasks: [fake.keepTask()] });
    const page = lantern.page;
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await page.getByTestId("task-do").click();
    await fake.startTalk(page, "li_da", {}, fake.TALK_VERBS, fake.entrustOffers("li_da"));
    await expect(page.getByTestId("request-card")).toHaveCount(0);
    await expect(page.getByTestId("picker-promise")).toBeVisible();
    expect(await fake.previewsAsked(page)).toEqual([]);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the button of a task that speaks in public", () => {
  /** The first day with the tasks of the days after and the town offering to speak: the manager stands where they may. */
  async function atTheTeahouse(lantern: Parameters<typeof fake.openFirstDay>[0], tracked: string, speak: unknown[] = fake.SPEAK_OFFERS): Promise<Page> {
    const page = await open(lantern, tracked);
    const frame = fake.speakingFrame(await fake.playerOf(page));
    await fake.feedFrame(page, { ...frame, player: { ...(frame.player as Record<string, unknown>), offers: { entrust: [], promise: [], tell: [], speak } } });
    return page;
  }

  test("sets the record straight with the evidence: the words in both languages, and the list of what to say is cut down to the evidence", async ({ lantern }) => {
    const page = await atTheTeahouse(lantern, "t_statement");
    await expect(page.getByTestId("task-do")).toHaveText("Set the record straight in public");
    await expect(page.getByTestId("task-do")).toHaveAttribute("data-verb", "speak");
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("当众说清");
    await lantern.setLang("en");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("picker-speak")).toBeVisible();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Show everything you hold", "Show: fresh scrapes on the bridge pier"]);
    // Nothing is sent until the player picks, and what is sent is the speech with the evidence.
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "speak")).toEqual([]);
    await page.locator('[data-testid="picker-option"][data-id="all"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "evidence" });
    await expect(page.getByTestId("picker-speak")).toHaveCount(0);
    // The list the player opens with the verb's own button has all of it.
    await page.getByTestId("verb-speak").click();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveCount(3);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lays a table for the two families: the words in both languages, and the list has the table and nothing else", async ({ lantern }) => {
    const page = await atTheTeahouse(lantern, "t_meal");
    await expect(page.getByTestId("task-do")).toHaveText("Lay a table for peace");
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("摆一桌和解饭");
    await lantern.setLang("en");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Lay a table for peace"]);
    await page.getByTestId("picker-option").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "meal" });
  });

  test("says there is nothing to show when the manager holds no evidence, and does not offer the table in its place", async ({ lantern }) => {
    const page = await atTheTeahouse(lantern, "t_statement", fake.SPEAK_OFFERS.filter((offer) => offer.body.kind === "meal"));
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("picker-speak")).toBeVisible();
    await expect(page.getByTestId("picker-empty")).toHaveText("There is nothing to choose yet.");
    await expect(page.getByTestId("picker-option")).toHaveCount(0);
  });

  test("waits for the manager to stand where they may speak, and then opens the list", async ({ lantern }) => {
    const page = await open(lantern, "t_meal");
    await page.getByTestId("task-do").click();
    // The act is there and grey while the manager is not where they may speak.
    await expect(page.getByTestId("verb-speak")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("picker-speak")).toHaveCount(0);
    // The manager gets there: the town offers to speak, and the list that was asked for opens by itself.
    await fake.feedFrame(page, fake.speakingFrame(await fake.playerOf(page)));
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Lay a table for peace"]);
  });

  test("clears a claim up from the notebook, where the lines the player judged are", async ({ lantern }) => {
    const page = await open(lantern, "t_clarify");
    await expect(page.getByTestId("task-do")).toHaveText("Clear up the talk in public");
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("当众把这话说清");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("picker-speak")).toHaveCount(0);
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "speak")).toEqual([]);
  });
});

/** Picks a person by clicking their piece on the map. */
async function pickOnMap(page: Page, id: string): Promise<void> {
  await mapAtRest(page);
  const spot = await page.evaluate((who) => window.__lantern.view.screenPositionOf(who), id);
  if (spot === null) throw new Error(`there is no ${id} on the map`);
  await pickAtSpot(page, spot, id);
  await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", id);
}

test.describe("the card of a person", () => {
  test("has a button for each request that is asked of them, with the same words, and does the same", async ({ lantern }) => {
    const page = await open(lantern, "t_bamboo_more");
    // Granny Li has two things asked of her by two tasks: lending, and (in this list) nothing else; Li Xiaomei has two requests to talk round.
    const both = fake.laterTasks("t_bamboo_more");
    (both.tasks as Array<Record<string, unknown>>).push({ ...(both.tasks as Array<Record<string, unknown>>)[4], id: "t_helper_chain_2", text: { zh: "请李小妹去劝周家大郎", en: "Ask Li Xiaomei to talk Zhou Dalang round" }, action: { verb: "entrust", npc: "li_xiaomei", request: "persuade", target: "zhou_dalang" } });
    await fake.feedFrame(page, both);
    await pickOnMap(page, "li_xiaomei");
    const card = page.getByTestId("person-card");
    await expect(card.getByTestId("person-task")).toHaveText(["Ask Li Xiaomei to talk Zhou Erlang round", "Ask Li Xiaomei to talk Zhou Dalang round"]);
    await lantern.setLang("zh");
    await expect(card.getByTestId("person-task")).toHaveText(["请李家小妹去劝周家二郎", "请李家小妹去劝周家大郎"]);
    await lantern.setLang("en");
    // A click on the second asks for that one.
    await card.getByTestId("person-task").nth(1).click();
    await fake.startTalk(page, "li_xiaomei", both, fake.TALK_VERBS, fake.entrustOffers("li_xiaomei"));
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_xiaomei", kind: "persuade", target: "zhou_dalang" }]);
  });
});
