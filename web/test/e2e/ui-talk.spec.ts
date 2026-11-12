import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { openTheNote } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const WORDS = {
  en: { ask: "Ask around", entrust: "Ask a favour", tell: "Tell", leave: "Take your leave" },
  zh: { ask: "打听", entrust: "请帮忙", tell: "说", leave: "告辞" },
} as const;

const n = (zh: string, en: string): { zh: string; en: string } => ({ zh, en });

/** The id of the action that the page sent last. */
const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);

/** The keys of `player.talk` of the frame on screen, with these laid over them. */
async function talkKeys(page: Page, keys: Record<string, unknown>): Promise<void> {
  const player = await fake.playerOf(page);
  await fake.feedFrame(page, { player: { ...player, talk: { ...(player.talk as Record<string, unknown>), ...keys } } });
}

test.describe("the acts of a talk", () => {
  test("are four, with the one thing the talk puts forward under them, and no minutes on any of them, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    // Outside a talk there is none of it.
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    for (const verb of ["ask", "entrust", "tell", "leave", "context"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("talk-area")).toBeVisible();
    // Four acts, and the one thing put forward is a fifth word that is not one of the four.
    await expect(page.locator('[data-testid="talk-verbs"] > .verb')).toHaveCount(4);
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-count", "1");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = WORDS[lang];
        await expect(page.getByTestId("verb-ask")).toContainText(w.ask);
        await expect(page.getByTestId("verb-tell")).toContainText(w.tell);
        await expect(page.getByTestId("verb-leave")).toContainText(w.leave);
        for (const verb of ["ask", "tell", "leave", "entrust"]) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
        // No minutes on a button, and nowhere in the row: no cost badge, no note that says what an act costs.
        await expect(page.locator('[data-testid^="cost-"]')).toHaveCount(0);
        await expect(page.locator(".verb-cost")).toHaveCount(0);
        expect((await page.getByTestId("talk-verbs").innerText()) + (await page.getByTestId("talk-context").innerText())).not.toMatch(/\d+\s*min|分钟/);
        await expect(page.getByTestId("talk-time-note")).toBeVisible();
        expect(await fake.contrast(page, '[data-testid="verb-ask"]'), `${theme} ${lang} act`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    await lantern.setLang("en");
    await expect(page.getByTestId("talk-time-note")).toHaveText("Time stands still while you talk. It moves on once you have said something.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-time-note")).toHaveText("说话的时候，时间停着。说完一件事，时间才往前走。");
    await lantern.setLang("en");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("have a request on the second button where the town puts one forward, and the plain words where it puts none", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask Granny Li to bring the bamboo to the bridge");
    await lantern.setLang("zh");
    await expect(page.getByTestId("verb-entrust")).toHaveText("请李老太把竹料送到桥边");
    await talkKeys(page, { ask_for: null });
    await expect(page.getByTestId("verb-entrust")).toHaveText("请帮忙");
    await lantern.setLang("en");
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask a favour");
  });

  test("grey an act that the town cannot offer and say why when it is pressed, and leave out an act that has no reason", async ({ lantern }) => {
    const page = lantern.page;
    // The reason an act gives when it is pressed goes after 5 seconds, which a slow machine can take between two calls: it goes after four times as long here.
    await lantern.stretchTimer(5000);
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    // The gift of the day is given: the button is greyed, says why on hover and on a press, and sends nothing.
    await fake.feedFrame(page, { hud: { verbs: fake.TALK_VERBS.filter((v) => v !== "gift"), verbs_off: { gift: "gift_today" }, gift: fake.giftHud(true, "zhou_zhanggui") } });
    const gift = page.getByTestId("gift-open");
    await expect(gift).toHaveAttribute("aria-disabled", "true");
    await expect(gift).toHaveAttribute("title", "A gift has been given today already. Try again tomorrow.");
    await expect(page.getByTestId("talk-off")).toHaveCount(0);
    // A browser's own check of "enabled" counts aria-disabled as disabled: the press is forced, as a mouse press would be.
    await gift.click({ force: true });
    await expect(page.getByTestId("talk-off")).toHaveText("A gift has been given today already. Try again tomorrow.");
    await expect(page.getByTestId("talk-off")).toHaveAttribute("data-verb", "gift");
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "gift")).toEqual([]);
    await expect(page.getByTestId("gift-panel")).toHaveCount(0);
    await lantern.switchLang("zh");
    await expect(page.getByTestId("talk-off")).toHaveText("今天已经送过礼了，明天再送。");
    // A person who has had two says so by name.
    await fake.feedFrame(page, { hud: { verbs: fake.TALK_VERBS.filter((v) => v !== "gift"), verbs_off: { gift: "gift_full" } } });
    await page.getByTestId("gift-open").click({ force: true });
    await expect(page.getByTestId("talk-off")).toHaveText("李老太已经收过两份礼了。");
    // An act that is off with a reason is there, greyed, and says why; one the frame gives no reason for is not drawn.
    await fake.feedFrame(page, { hud: { verbs: ["leave", "ask", "tell"], verbs_off: { entrust: "night" } } });
    await expect(page.getByTestId("verb-entrust")).toHaveAttribute("aria-disabled", "true");
    await page.getByTestId("verb-entrust").click({ force: true });
    await expect(page.getByTestId("talk-off")).toHaveText("夜里了，人都睡了。");
    await fake.feedFrame(page, { hud: { verbs: ["leave", "ask"], verbs_off: {} } });
    await expect(page.getByTestId("verb-entrust")).toHaveCount(0);
    await expect(page.getByTestId("verb-tell")).toHaveCount(0);
    // A reason the page has no words for is said in the general line.
    await fake.feedFrame(page, { hud: { verbs: ["leave", "ask"], verbs_off: { tell: "gremlins" } } });
    await page.getByTestId("verb-tell").click({ force: true });
    await expect(page.getByTestId("talk-off")).toHaveText("现在不行。");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keep the person's card short in a talk, with when they have to go in front, and the hearts on it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "li_laotai");
    await expect(page.getByTestId("person-leaves")).toContainText("15:30");
    await expect(page.getByTestId("person-hearts").getByTestId("hearts")).toHaveAttribute("data-value", "3");
    await lantern.setLang("zh");
    await expect(page.getByTestId("person-leaves")).toContainText("什么时候走");
    await lantern.setLang("en");
    const facts = page.getByTestId("person-facts");
    await expect(facts.locator("summary")).toHaveText("About Granny Li");
    await expect(page.getByTestId("card-talk")).toHaveText("Talking now");
    // The talk is a strip over the bottom of the map, and the note of the slip is put away while it goes on.
    const talk = await page.getByTestId("talk-area").boundingBox();
    const map = await page.getByTestId("map").boundingBox();
    if (talk === null || map === null) throw new Error("no box");
    expect(talk.y).toBeGreaterThanOrEqual(map.y);
    expect(talk.y + talk.height).toBeLessThanOrEqual(map.y + map.height + 1);
    await expect(page.getByTestId("slip-head")).toHaveAttribute("aria-expanded", "false");
  });

  test("are the only acts outside a talk that the frame offers, none of them greyed out, and are done", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { hud: { verbs: ["move"] } });
    await fake.recordSent(page);
    // Nothing is listed: no act can be pressed (an act the frame gives a reason for stands there grey).
    await expect(page.locator('[data-testid="around"] .verb:not([aria-disabled="true"])')).toHaveCount(0);
    await fake.feedFrame(page, { hud: { verbs: ["move", "listen"] } });
    await expect(page.getByTestId("verb-listen")).toBeVisible();
    // The acts the frame does not list are not pressable: only the one that was listed is.
    await expect(page.locator('[data-testid="around"] .verb:not([aria-disabled="true"])')).toHaveCount(1);
    await fake.feedFrame(page, { hud: { verbs: ["move", "listen", "look", "rally", "speak", "speak_publicly"] }, player: { ...(await fake.playerOf(page)), look: ["t_rail"], offers: { speak: [{ id: "meal", label: n("摆一桌，请两家同席", "Lay a table for the two families"), body: { kind: "meal" } }] } } });
    await expect(page.locator('[data-testid="around"] .verb')).toHaveCount(4);
    await expect(page.locator('[data-testid="around"] .verb:disabled')).toHaveCount(0);
    await page.getByTestId("verb-listen").click();
    await page.getByTestId("verb-rally").click();
    expect((await fake.sentSoFar(page)).map((s) => s.type)).toEqual(["listen", "rally"]);
    await page.getByTestId("verb-look").click();
    await expect(page.getByTestId("picker-look")).toBeVisible();
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "look", at: "t_rail" });
    await page.getByTestId("verb-speak").click();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Lay a table for the two families"]);
    await page.getByTestId("picker-speak").getByTestId("picker-option").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "meal" });
    // Once a talk starts they go, and when it is over they are back.
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("around")).toHaveCount(0);
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null }, hud: { verbs: ["move", "listen"] } }, [{ kind: "talk_end", tick: 9, npc: "li_laotai", reason: "left" }]);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await expect(page.getByTestId("verb-listen")).toBeVisible();
  });
});

test.describe("asking around", () => {
  /** A talk with Granny Li with a longer list of topics than the list shows. */
  async function manyTopics(page: Page): Promise<void> {
    const player = await fake.playerOf(page);
    const more = ["li_da", "li_xiaomei", "zhou_zhanggui", "zhou_niangzi"].map((id) => ({ id, kind: "person", label: n(`人${id}`, `Person ${id}`) }));
    await fake.feedFrame(page, { player: { ...player, topics: [...(player.topics as unknown[]), ...more, { id: "p_bridge", kind: "place", label: n("石桥", "Stone Bridge") }, { id: "likes:li_da", kind: "taste", label: n("李大爱什么", "What Li Da likes") }] } });
  }

  test("lists three topics when the act is pressed, and the others behind a word, and a topic asks at once", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "zhou_huoji");
    await manyTopics(page);
    // Nothing is listed until the act is pressed.
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await expect(page.getByTestId("ask-top").getByTestId("topic-chip")).toHaveCount(3);
    await expect(page.getByTestId("ask-more")).toHaveText("Others");
    await expect(page.getByTestId("ask-more")).toHaveAttribute("aria-expanded", "false");
    // The others are not shown until the word is pressed, and then they are listed by what they are, each once.
    await expect(page.locator('.chip-group[data-kind="person"]')).toHaveCount(0);
    await page.getByTestId("ask-more").click();
    await expect(page.getByTestId("ask-more")).toHaveAttribute("aria-expanded", "true");
    const all = await page.locator('[data-testid="topic-chip"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id")));
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(9);
    await expect(page.locator('.chip-group[data-kind="taste"] [data-testid="topic-chip"]')).toHaveText(["What Li Da likes"]);
    // The language switch is in the menu, and a press outside the list puts the list away: it is opened again.
    await lantern.setLang("zh");
    await page.getByTestId("verb-ask").click();
    await page.getByTestId("ask-more").click();
    await expect(page.getByTestId("ask-more")).toHaveText("收起");
    await expect(page.locator('.chip-group[data-kind="taste"] .chip-group-label')).toHaveText("喜好");
    await lantern.setLang("en");
    await page.getByTestId("verb-ask").click();
    // A topic asks, and the list stays for the next question. The tasks of the day speak of Li Er and Li Da, so those lead; the rail is among the others.
    await page.getByTestId("ask-more").click();
    await page.locator('[data-testid="topic-chip"][data-id="t_rail"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask", topic: "t_rail" });
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    // A list that is pressed again is shut, and so it is by Escape.
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("topic-chips")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("puts first what the task in hand is about, and after what was asked, the topics that were not", async ({ lantern }) => {
    const page = lantern.page;
    // The task that is followed asks Zhou's Clerk who told him: the clerk is the topic that matters now.
    await fake.openFirstDay(lantern, fake.tasks("t_source"));
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai", fake.tasks("t_source"));
    const player = await fake.playerOf(page);
    await fake.feedFrame(page, { player: { ...player, topics: [...(player.topics as unknown[]), { id: "zhou_huoji", kind: "person", label: n("周家伙计", "Zhou's Clerk") }] } });
    await page.getByTestId("verb-ask").click();
    const top = async (): Promise<string[]> => page.getByTestId("ask-top").locator('[data-testid="topic-chip"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? ""));
    expect((await top())[0]).toBe("zhou_huoji");
    // Once it is asked it goes after the others.
    await page.locator('[data-testid="topic-chip"][data-id="zhou_huoji"]').click();
    await expect.poll(async () => (await top()).includes("zhou_huoji")).toBe(false);
    await page.getByTestId("ask-more").click();
    await expect(page.locator('[data-testid="topic-chip"][data-id="zhou_huoji"]')).toHaveCount(1);
  });

  test("has a tag of its own at the head for a line of the notebook that the person is the next to be asked about", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    const heard = { kind: "heard", who: { ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" }, how: "heard", via: { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" } };
    const line = { id: "n_rail", text: n("栏杆是朝河那边断的。", "The rail broke on the river side."), source: heard, marks: [], chain: [{ ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" }, { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }, null] };
    await fake.startTalk(page, "zhou_huoji", { notebook: [...fake.notebook(), line] });
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("ask-follow")).toHaveText("Who told you: The rail broke on the river side");
    await page.getByTestId("ask-follow").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask_source", entry: "n_rail" });
    // Another person is not the next to be asked.
    await fake.startTalk(page, "li_laotai", { notebook: [...fake.notebook(), line] });
    await page.getByTestId("verb-ask").click();
    await expect(page.getByTestId("ask-follow")).toHaveCount(0);
  });

  test("puts a phrase beside an answer that was passed on to the person, which asks who told them, and none beside one they saw", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "zhou_huoji");
    await page.getByTestId("verb-ask").click();
    await page.locator('[data-testid="topic-chip"][data-id="t_rail"]').click();
    const passed = { kind: "heard", who: { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }, how: "heard", via: { ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" } };
    const entry = { id: "n_rail", text: n("栏杆是朝河那边断的。", "The rail broke on the river side."), source: passed, marks: [], chain: [{ ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }, { ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" }, null] };
    const reply = { npc: "zhou_huoji", until: 999_999, text: n("我听老板娘说，栏杆是朝河那边断的。", "I heard from the madam that the rail broke on the river side.") };
    await fake.feedFrame(page, { bubbles: [reply], notebook: [...fake.notebook(), entry] }, [
      { kind: "asked", tick: 2, npc: "zhou_huoji", topic: "t_rail", entry: "n_rail" },
      { kind: "action_ack", tick: 2, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("talk-follow")).toHaveText("Who told you?");
    await page.getByTestId("talk-follow").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask_source", entry: "n_rail" });
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-follow")).toHaveText("谁跟你说的？");
    // An answer the person gave from what they saw has none.
    const saw = { ...entry, id: "n_saw", source: { kind: "heard", who: { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }, how: "saw" }, chain: [{ ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }] };
    await page.getByTestId("verb-ask").click();
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
    const reply2 = { npc: "zhou_huoji", until: 999_999, text: n("我亲眼看见他在桥边。", "I saw him by the bridge myself.") };
    await fake.feedFrame(page, { bubbles: [reply2], notebook: [...fake.notebook(), entry, saw] }, [
      { kind: "asked", tick: 3, npc: "zhou_huoji", topic: "li_er", entry: "n_saw" },
      { kind: "action_ack", tick: 3, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("talk-line")).toHaveCount(4);
    await expect(page.getByTestId("talk-follow")).toHaveCount(1);
  });

  test("opens when a task's button asks for a question, lit for a moment, and the list of the entries heard from someone when it asks for the source", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, fake.tasks("t_source"));
    await fake.recordSent(page);
    await expect(page.getByTestId("task-do")).toHaveText("Ask Zhou's Clerk who told them");
    await fake.startTalk(page, "zhou_huoji", fake.tasks("t_source"));
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    // Already talking to him: no second talk, and the list of the entries heard from someone is open.
    await expect(page.getByTestId("picker-askSource")).toBeVisible();
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "talk")).toEqual([]);
    await page.getByTestId("picker-askSource").getByTestId("picker-option").first().click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask_source" });
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("问周家伙计听谁说的");
  });

  test("keeps the list above the strip under the slip when its note is open, so that the note and its buttons are not covered", async ({ lantern }) => {
    const page = lantern.page;
    // The strip of a first talk is tall (the note of the meeting, the hearts, two rows of acts), so the room for the list under an open note is a window of this height.
    await page.setViewportSize({ width: 1280, height: 900 });
    await fake.openFirstDay(lantern, fake.tasks("t_source"));
    await fake.startTalk(page, "zhou_huoji", fake.tasks("t_source"));
    await openTheNote(page);
    await page.getByTestId("verb-ask").click();
    const slip = await page.locator(".slip").boundingBox();
    const chips = await page.getByTestId("topic-chips").boundingBox();
    if (slip === null || chips === null) throw new Error("no box");
    expect(chips.y).toBeGreaterThanOrEqual(slip.y + slip.height - 1);
    expect(lantern.pageErrors).toEqual([]);
  });
});
