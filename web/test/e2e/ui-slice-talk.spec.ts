import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { openTheNote } from "../support/play.ts";
import * as fake from "../support/slice.ts";

// This spec looks at the page with the map on it.
test.use({ map: true });

const WORDS = {
  en: { ask: "Ask", askSource: "Ask the source", tell: "Tell", tellOther: "Say it another way", entrust: "Request", promise: "Promise", leave: "Leave", ten: "10 min", fifteen: "15 min", twenty: "20 min" },
  zh: { ask: "问", askSource: "问来源", tell: "说", tellOther: "换个说法", entrust: "求", promise: "许", leave: "告辞", ten: "十分钟", fifteen: "十五分钟", twenty: "二十分钟" },
} as const;

/** The id of the action that the page sent last. */
const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);

test.describe("the talk area", () => {
  test("has the acts that the frame offers and no others, each with the minutes it costs, in both languages and both themes", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    // Outside a talk there is none of it, and no button that is greyed out.
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    for (const verb of ["ask", "askSource", "tell", "tellOther", "entrust", "promise", "leave"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("talk-area")).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        const w = WORDS[lang];
        for (const verb of ["askSource", "tell", "tellOther", "entrust", "promise", "leave"] as const) {
          await expect(page.getByTestId(`verb-${verb}`)).toContainText(w[verb]);
          await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
        }
        // Asking is the row of tags, with the minutes of a question in the line above it.
        await expect(page.getByTestId("verb-ask")).toHaveCount(0);
        await expect(page.getByTestId("topic-chips")).toBeVisible();
        await expect(page.getByTestId("chips-note")).toContainText(w.ten);
        await expect(page.getByTestId("cost-askSource")).toHaveText(w.ten);
        await expect(page.getByTestId("cost-tell")).toHaveText(w.fifteen);
        await expect(page.getByTestId("cost-entrust")).toHaveText(w.twenty);
        await expect(page.getByTestId("cost-promise")).toHaveText(w.twenty);
        await expect(page.getByTestId("cost-askSource")).toHaveAttribute("data-minutes", "10");
        // Leaving costs nothing, and so does saying it another way, which is a way of telling that has the cost of telling.
        await expect(page.getByTestId("verb-leave").getByTestId("cost-leave")).toHaveCount(0);
        await expect(page.getByTestId("talk-time-note")).toBeVisible();
        expect(await fake.contrast(page, '[data-testid="topic-chip"]'), `${theme} ${lang} tag`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="chips-note"]'), `${theme} ${lang} note`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="cost-askSource"]'), `${theme} ${lang} cost`).toBeGreaterThan(3);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    await lantern.setLang("en");
    await expect(page.getByTestId("talk-time-note")).toHaveText("Time stands still while you talk. A question costs the minutes shown above the tags, and every other act the minutes on its button.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-time-note")).toHaveText("谈话时世界停着。提问花的分钟写在标签上方，其他每件事花的分钟写在各自的按钮上。");
    await lantern.setLang("en");
    // The acts the frame does not list are not there, and not greyed out.
    await fake.feedFrame(page, { hud: { verbs: ["leave", "ask"] } });
    for (const verb of ["askSource", "tell", "tellOther", "entrust", "promise"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await expect(page.getByTestId("verb-leave")).toBeEnabled();
    // A talk that does not say what things cost shows no minutes and no note about them.
    const base = await fake.playerOf(page);
    await fake.feedFrame(page, { player: { ...base, talk: { npc: "li_laotai", leaves_at: { hour: 15, minute: 30 } } } });
    await expect(page.getByTestId("chips-note")).toHaveText("Tap a tag to ask them about it.");
    await expect(page.getByTestId("talk-time-note")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the person's card short in a talk, with when they have to go in front", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "li_laotai");
    await expect(page.getByTestId("person-leaves")).toBeVisible();
    await expect(page.getByTestId("person-leaves")).toContainText("15:30");
    await expect(page.getByTestId("person-leaves")).toHaveAttribute("data-hour", "15");
    await lantern.setLang("zh");
    await expect(page.getByTestId("person-leaves")).toContainText("几时要走");
    await lantern.setLang("en");
    // What else is known of them is one click away, and shut.
    const facts = page.getByTestId("person-facts");
    await expect(facts.locator("summary")).toHaveText("About them");
    await expect(page.getByTestId("person-wants")).toBeHidden();
    await facts.locator("summary").click();
    await expect(page.getByTestId("person-wants")).toBeVisible();
    // The card has its button, which says that the talk is on.
    await expect(page.getByTestId("card-talk")).toHaveText("Talking now");
    await expect(page.getByTestId("card-talk")).toBeDisabled();
    // The talk is a strip over the bottom of the map, and the note of the slip is put away while it goes on.
    const talk = await page.getByTestId("talk-area").boundingBox();
    const map = await page.getByTestId("map").boundingBox();
    if (talk === null || map === null) throw new Error("no box");
    expect(talk.y).toBeGreaterThanOrEqual(map.y);
    expect(talk.y + talk.height).toBeLessThanOrEqual(map.y + map.height + 1);
    await expect(page.getByTestId("slip-head")).toHaveAttribute("aria-expanded", "false");
  });

  test("shows only the acts that can be done outside a talk, none of them greyed out, and does them", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { hud: { verbs: ["move"] } });
    await fake.recordSent(page);
    await expect(page.getByTestId("around")).toHaveCount(0);
    await fake.feedFrame(page, { hud: { verbs: ["move", "listen"] } });
    await expect(page.getByTestId("verb-listen")).toBeVisible();
    for (const verb of ["look", "rally", "speak"]) await expect(page.getByTestId(`verb-${verb}`)).toHaveCount(0);
    await fake.feedFrame(page, { hud: { verbs: ["move", "listen", "look", "rally", "speak", "speak_publicly"] }, player: { ...(await fake.playerOf(page)), look: ["t_rail"], offers: { speak: [{ id: "meal", label: { zh: "摆一桌和解饭", en: "Lay a table for peace" }, body: { kind: "meal" } }] } } });
    await expect(page.locator('[data-testid="around"] .verb')).toHaveCount(4);
    await expect(page.locator('[data-testid="around"] .verb:disabled')).toHaveCount(0);
    await page.getByTestId("verb-listen").click();
    await page.getByTestId("verb-rally").click();
    expect((await fake.sentSoFar(page)).map((s) => s.type)).toEqual(["listen", "rally"]);
    // Looking and speaking up ask what, in a list, in the place of the buttons.
    await page.getByTestId("verb-look").click();
    await expect(page.getByTestId("picker-look")).toBeVisible();
    await page.getByTestId("picker-look").getByTestId("picker-option").first().click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "look", at: "t_rail" });
    await page.getByTestId("verb-speak").click();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Lay a table for peace"]);
    await page.getByTestId("picker-speak").getByTestId("picker-option").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "meal" });
    await lantern.setLang("zh");
    await expect(page.getByTestId("verb-listen")).toHaveText("听");
    await expect(page.getByTestId("verb-speak")).toContainText("当众说");
    await expect(page.getByTestId("cost-speak")).toHaveText("三十分钟");
    // Once a talk starts they go, and when it is over they are back.
    await fake.startTalk(page, "li_laotai");
    await expect(page.getByTestId("around")).toHaveCount(0);
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null }, hud: { verbs: ["move", "listen"] } }, [{ kind: "talk_end", tick: 9, npc: "li_laotai", reason: "left" }]);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await expect(page.getByTestId("verb-listen")).toBeVisible();
  });
});

test.describe("telling, and saying it another way", () => {
  test("tells an entry as it is, and has a submenu for the other ways, each with the risk it runs", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    // Tell: the entries of the notebook, as they stand. The other ways are not in this list.
    await page.getByTestId("verb-tell").click();
    const tell = page.getByTestId("picker-tell");
    await expect(tell).toBeVisible();
    await expect(tell.locator("[data-group]")).toHaveAttribute("data-group", "notebook");
    await expect(tell.getByTestId("picker-option")).toHaveCount(4);
    await expect(tell.getByTestId("picker-option").nth(1)).toContainText("Zhou's Clerk says he saw Li Er by the bridge that night.");
    await tell.locator('[data-testid="picker-option"][data-id="n_clerk"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "tell", entry: "n_clerk" });
    expect((await fake.sentSoFar(page)).at(-1)).not.toHaveProperty("how");

    // Say it another way: four ways, each with a line about its risk and what can be told that way.
    const heads = { en: ["As if you saw it", "Heavier", "Without the source", "Make something up"], zh: ["说成亲眼所见", "添油加醋", "不说来源", "凭空编一条"] } as const;
    const risks = {
      en: ["They believe it more. If someone holds proof against it, you are caught lying.", "It lands harder and the blame spreads. It is not a lie, but it can come back on you.", "They believe it a little less. To get to you, others must first find who told you.", "It is recorded as a lie and the truth does not change. Anyone with proof can expose you."],
      zh: ["听的人更信。要是有人手里有反证，你就被拆穿。", "说得更重，怪罪也传得更开。不算撒谎，可能反过来害你。", "听的人信得少些。别人要追到你，得先找到告诉你的人。", "记作撒谎，真相不变。谁手里有反证，都能拆穿你。"],
    } as const;
    for (const lang of ["en", "zh"] as const) {
      await lantern.setLang(lang);
      await page.getByTestId("verb-tellOther").click();
      const other = page.getByTestId("picker-tellOther");
      await expect(other).toBeVisible();
      await expect(other.locator(".picker-heading")).toHaveText([...heads[lang]]);
      await expect(other.locator(".picker-note")).toHaveText([...risks[lang]]);
      await expect(other.locator('[data-group="way-as_seen"] [data-testid="picker-option"]')).toHaveCount(1);
      await expect(other.locator('[data-group="way-sharpen"] [data-testid="picker-option"]')).toHaveCount(1);
      await expect(other.locator('[data-group="way-fabricate"] [data-testid="picker-option"]')).toHaveCount(1);
      await lantern.settled();
      await page.keyboard.press("Escape");
      await expect(other).toHaveCount(0);
    }
    await lantern.setLang("en");
    await page.getByTestId("verb-tellOther").click();
    await page.locator('[data-testid="picker-tellOther"] [data-group="way-as_seen"] [data-testid="picker-option"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "tell", entry: "n_clerk", how: "as_seen" });
    await page.getByTestId("verb-tellOther").click();
    await page.locator('[data-testid="picker-tellOther"] [data-group="way-fabricate"] [data-testid="picker-option"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "tell", how: "fabricate", pred: "hit", subject: "old_he" });
    // Without a way on offer the submenu is not there.
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), offers: { tell: [], entrust: [], promise: [] } } });
    await expect(page.getByTestId("verb-tellOther")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("asks, and asks where it came from, with the minutes on the buttons, and the lines of the talk follow", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "zhou_huoji");
    await page.locator('[data-testid="topic-chip"][data-id="t_rail"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask", topic: "t_rail" });
    await fake.feedFrame(page, { bubbles: [{ npc: "zhou_huoji", until: 999_999, text: { zh: "栏杆是朝河那边断的。", en: "The rail broke on the river side." } }] }, [{ kind: "action_ack", tick: 2, action_id: await lastId(page), result: "applied", reason: null }]);
    await expect(page.getByTestId("talk-line")).toHaveCount(2);
    await expect(page.getByTestId("talk-line").nth(1)).toHaveText("The rail broke on the river side.");
    await page.getByTestId("verb-askSource").click();
    await expect(page.getByTestId("picker-askSource").getByTestId("picker-option")).toHaveCount(3);
    await page.getByTestId("picker-askSource").getByTestId("picker-option").first().click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask_source", entry: "n_clerk" });
  });
});

test.describe("a request", () => {
  /** Opens the list of what to ask Granny Li for, and picks the first thing. */
  async function pickRequest(page: Page): Promise<void> {
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("picker-entrust")).toBeVisible();
    await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
    await expect(page.getByTestId("picker-entrust")).toHaveCount(0);
  }

  test("is shown as the preview of the core first, and nothing is sent until the player confirms", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    await expect(card).toHaveAttribute("data-verb", "entrust");
    // The page makes no preview of its own, and the host was asked for the action the player would send, with `verb` in the place of `type`.
    await expect(card).not.toHaveAttribute("data-fake", /.*/);
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "entrust", npc: "li_laotai", kind: "material" }]);
    // The button that decides is in view when the card opens, with no scrolling of the column by hand.
    await expect(page.getByTestId("request-confirm")).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByTestId("request-cancel")).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByTestId("request-asks").locator("dd")).toHaveText("Ask Li Da to bring the first bamboo to the bridge");
    await expect(page.getByTestId("request-cost")).toHaveText("20 min");
    // A request gives nothing, and the card has no row for it: a promise is an act of its own.
    await expect(page.getByTestId("request-gives")).toHaveCount(0);
    await expect(page.getByTestId("request-give")).toHaveCount(0);
    // What stands in the way, the chance and the reasons are the core's.
    await expect(page.getByTestId("request-blocker")).toHaveText("Granny Li has not dropped her objection");
    await expect(page.getByTestId("request-odds").locator("dd")).toHaveText("Middling");
    await expect(page.getByTestId("request-reasons").locator("li")).toHaveCount(2);
    expect(await fake.sentSoFar(page)).toEqual([]);
    // Another act puts the preview away, and so does asking by a tag. So does Not now.
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
    await expect(card).toHaveCount(0);
    await pickRequest(page);
    await page.getByTestId("request-cancel").click();
    await expect(card).toHaveCount(0);
    // Only the question that was asked by a tag went out.
    expect(await fake.sentSoFar(page)).toEqual([{ type: "ask", topic: "li_er", action_id: "t0" }]);
  });

  test("says that it has no preview when the host cannot give one, makes none up, and lets the player ask again", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    for (const answer of ["none", "error"] as const) {
      await fake.answerPreview(page, answer);
      await pickRequest(page);
      const card = page.getByTestId("request-card");
      await expect(card).toHaveAttribute("data-phase", "failed");
      await expect(page.getByTestId("request-failed")).toHaveText("The preview could not be made. Try again.");
      // Nothing to confirm, nothing guessed: no cost, no blocker, no chance.
      for (const id of ["request-confirm", "request-cost", "request-asks", "request-blockers", "request-odds"]) await expect(page.getByTestId(id)).toHaveCount(0);
      await page.getByTestId("request-cancel").click();
      await expect(card).toHaveCount(0);
    }
    expect(await fake.sentSoFar(page)).toEqual([]);
    // Try again, with a host that answers.
    await fake.answerPreview(page, "error");
    await pickRequest(page);
    await expect(page.getByTestId("request-failed")).toBeVisible();
    await fake.answerPreview(page, fake.PREVIEW);
    await page.getByTestId("request-retry").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await lantern.setLang("zh");
    await fake.answerPreview(page, "none");
    await pickRequest(page);
    await expect(page.getByTestId("request-failed")).toHaveText("这次没能看清，请再试一次。");
    await expect(page.getByTestId("request-retry")).toHaveText("再试一次");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("becomes the result in the same place when the player confirms, with what she said and what was done", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    // The element that shows the preview is the one that shows the result.
    await card.evaluate((el) => el.setAttribute("data-mark", "same"));
    await page.getByTestId("request-confirm").click();
    await expect(card).toHaveAttribute("data-phase", "sending");
    await expect(page.getByTestId("request-confirm")).toBeDisabled();
    const sent = (await fake.sentSoFar(page)).at(-1);
    expect(sent).toMatchObject({ type: "entrust", kind: "material", version: 42 });
    expect(sent).not.toHaveProperty("offer");
    expect(typeof sent?.action_id).toBe("string");

    const reply = { npc: "li_laotai", until: 999_999, text: { zh: "答应了，明早送到桥边。", en: "Agreed. It will be at the bridge by morning." } };
    await fake.feedFrame(page, { bubbles: [reply] }, [
      { kind: "entrusted", tick: 3, npc: "li_laotai", request: "material", result: "agreed", pending: true },
      { kind: "action_ack", tick: 3, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(card).toHaveAttribute("data-phase", "result");
    await expect(card).toHaveAttribute("data-mark", "same");
    await expect(page.getByTestId("request-card")).toHaveCount(1);
    await expect(page.getByTestId("request-result")).toHaveText("Granny Li agreed.");
    await expect(page.getByTestId("request-result")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("request-reply")).toHaveText("Agreed. It will be at the bridge by morning.");
    await expect(page.getByTestId("request-facts")).toHaveText("Granny Li says yes and will see to it shortly.");
    await expect(card.getByText("That took 20 minutes.")).toBeVisible();
    // The preview is gone from the place, and the talk has the line of the request.
    for (const id of ["request-asks", "request-gives", "request-blockers", "request-confirm", "request-cost"]) await expect(page.getByTestId(id)).toHaveCount(0);
    // The offer says the act already, so the line is the offer after "you", once.
    await expect(page.getByTestId("talk-line").first()).toHaveText("You ask them to bring the bamboo to the bridge");
    // And in Chinese.
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-line").first()).toHaveText("你请对方把竹料送到桥边");
    await expect(page.getByTestId("request-result")).toHaveText("李老太答应了。");
    await expect(page.getByTestId("request-reply")).toHaveText("答应了，明早送到桥边。");
    await expect(page.getByTestId("request-facts")).toHaveText("李老太应下了，过一会儿就去办。");
    await page.getByTestId("request-close").click();
    await expect(card).toHaveCount(0);
  });

  test("shows what the core says in the preview, the odds and the reasons and the blockers, in both languages and both themes, and sends the version of the preview", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    const words = {
      en: { odds: "Middling", blocker: "Granny Li has not dropped her objection", reasons: ["+Li Da owes you a favour", "−Li Da hardly knows you yet"], title: "Asking Granny Li", confirm: "Go ahead", asks: "Ask Li Da to bring the first bamboo to the bridge" },
      zh: { odds: "中", blocker: "李老太还没撤回阻拦", reasons: ["+李大欠你人情", "−李大对你还不太熟"], title: "请李老太", confirm: "就这么办", asks: "请李大把第一批竹料送到桥边" },
    } as const;
    // The preview of the core is shown as it came: its words are in both languages.
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        // The language switch lives in the menu, and opening the menu puts the preview away. Ask again each time.
        await lantern.setLang(lang);
        if ((await card.count()) === 0) await pickRequest(page);
        const w = words[lang];
        await expect(card.locator(".request-title")).toHaveText(w.title);
        await expect(page.getByTestId("request-asks").locator("dd")).toHaveText(w.asks);
        await expect(page.getByTestId("request-odds").locator("dd")).toHaveText(w.odds);
        await expect(page.getByTestId("request-odds")).toHaveAttribute("data-odds", "mid");
        await expect(page.getByTestId("request-blocker")).toHaveText(w.blocker);
        await expect(page.getByTestId("request-reasons").locator("li")).toHaveText([...w.reasons]);
        await expect(page.getByTestId("request-confirm")).toContainText(w.confirm);
        expect(await fake.contrast(page, '[data-testid="request-asks"] dd'), `${theme} ${lang} asks`).toBeGreaterThan(4.5);
        expect(await fake.contrast(page, '[data-testid="request-confirm"]'), `${theme} ${lang} confirm`).toBeGreaterThan(4.5);
        expect(await fake.fitsWidth(page)).toBe(true);
      }
    }
    await lantern.setLang("en");
    if ((await card.count()) === 0) await pickRequest(page);
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", kind: "material", version: 42 });
  });

  test("goes back to a new preview when the core says that the state has moved on (stale), and says so", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-confirm").click();
    const first = await lastId(page);
    await fake.answerPreview(page, { ...fake.PREVIEW, version: 51 });
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 4, action_id: first, result: "rejected", reason: "stale" }]);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("request-stale")).toHaveText("Things have changed, have another look");
    expect((await fake.previewsAsked(page)).length).toBe(1);
    // Nothing was said to her about it: no note, and no result.
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    await expect(page.getByTestId("request-result")).toHaveCount(0);
    await lantern.setLang("zh");
    await pickRequest(page);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    // The new request is a new action, so that it is settled once as itself, with the version of the new preview.
    await page.getByTestId("request-confirm").click();
    expect(await lastId(page)).not.toBe(first);
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "entrust", version: 51 });
  });

  test("says the line in Chinese too when the state has moved on", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    await page.getByTestId("request-confirm").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 4, action_id: await lastId(page), result: "rejected", reason: "stale" }]);
    await expect(page.getByTestId("request-stale")).toBeVisible();
    await lantern.setLang("zh");
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    await page.getByTestId("request-confirm").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 5, action_id: await lastId(page), result: "rejected", reason: "stale" }]);
    await expect(page.getByTestId("request-stale")).toHaveText("局面变了，请重新看一下");
  });

  test("shows a refusal as the result, with the reason, in both languages, and not as a note over the map", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await pickRequest(page);
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-confirm").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 4, action_id: await lastId(page), result: "rejected", reason: "needs_nod" }]);
    const result = page.getByTestId("request-result");
    await expect(result).toHaveAttribute("data-ok", "false");
    await expect(result).toHaveText("×They want someone else to agree first.");
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(result).toHaveText("×对方得先等别人点头。");
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "result");
    // A reason the page has no words for is said in the general line.
    await page.getByTestId("request-close").click();
    await pickRequest(page);
    await page.getByTestId("request-confirm").click();
    await fake.feedFrame(page, {}, [{ kind: "action_ack", tick: 5, action_id: await lastId(page), result: "rejected", reason: "gremlins" }]);
    await expect(result).toHaveText("×镇上不让这样做（gremlins）。");
  });

  test("is the same for a promise, which has the preview of what the player gives, and its result is the player's word given", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.answerPreview(page, fake.PROMISE_PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-promise").click();
    await expect(page.getByTestId("picker-promise").getByTestId("picker-option")).toHaveText(["Promise the honour of lighting the main lantern"]);
    await page.getByTestId("picker-promise").getByTestId("picker-option").click();
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    await expect(card).toHaveAttribute("data-verb", "promise");
    expect(await fake.previewsAsked(page)).toEqual([{ verb: "promise", npc: "li_laotai", op: "make", what: "role", item: "t_honor_light", due: 3 }]);
    await expect(card.locator(".request-title")).toHaveText("Promising Granny Li");
    await expect(page.getByTestId("request-cost")).toHaveText("20 min");
    // A promise is what the player gives: it has nothing to ask for, and the core's words for it are what it gives.
    await expect(page.getByTestId("request-give")).toHaveCount(0);
    await expect(page.getByTestId("request-asks")).toHaveCount(0);
    await expect(page.getByTestId("request-gives").locator("dt")).toHaveText("You promise");
    await expect(page.getByTestId("request-gives").locator("dd")).toHaveText("Promise: the Li family lights the main lantern");
    await page.getByTestId("request-confirm").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "promise", op: "make", what: "role", item: "t_honor_light", due: 3, version: 43 });
    await fake.feedFrame(page, {}, [
      { kind: "pledged", tick: 6, npc: "li_laotai", pledge: "k1", what: "role", item: "t_honor_light", amount: 0, due: 3 },
      { kind: "action_ack", tick: 6, action_id: await lastId(page), result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("request-result")).toHaveText("You gave your word to Granny Li.");
    await expect(page.getByTestId("request-facts")).toHaveText("You promised Granny Li the honour of lighting the main lantern, by day 3.");
    // The talk has the promise once, in the words of the offer.
    await expect(page.getByTestId("talk-line").first()).toHaveText("You promise the honour of lighting the main lantern");
    await lantern.setLang("zh");
    await expect(page.getByTestId("request-result")).toHaveText("你向李老太许下了。");
    await expect(page.getByTestId("request-facts")).toHaveText("你许了李老太点主灯的体面，第三日前兑现。");
    await expect(page.getByTestId("talk-line").first()).toHaveText("你许对方点主灯的体面");
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
    // 15:15 and 15:30: a question (10) and the source (10) stop short, telling (15), a request (20) and a promise (20) do not.
    for (const verb of ["tell", "entrust", "promise"]) {
      await expect(page.getByTestId(`late-${verb}`)).toHaveText(WILL_GO.en);
      await expect(page.getByTestId(`verb-${verb}`)).toContainText(WILL_GO.en);
    }
    for (const verb of ["askSource", "leave"]) await expect(page.getByTestId(`late-${verb}`)).toHaveCount(0);
    await expect(page.getByTestId("chips-late")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(page.getByTestId("late-entrust")).toHaveText(WILL_GO.zh);
    expect(await fake.fitsWidth(page)).toBe(true);
    // Ten minutes later a question runs to it too, and the tags say so.
    await lantern.setLang("en");
    await talkAt(page, 15, 20);
    await expect(page.getByTestId("late-askSource")).toHaveText(WILL_GO.en);
    await expect(page.getByTestId("chips-late")).toHaveText(WILL_GO.en);
    // Early in the day none of them does, and a frame that does not say the hour says nothing of it.
    await talkAt(page, 8, 30);
    await expect(page.locator('[data-testid^="late-"]')).toHaveCount(0);
    await expect(page.getByTestId("chips-late")).toHaveCount(0);
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
    await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("request-leaves")).toHaveText(WILL_GO.en);
    await lantern.setLang("zh");
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
    await expect(page.getByTestId("request-leaves")).toHaveText(WILL_GO.zh);
    // A request that stops short says nothing.
    await talkAt(page, 14, 0);
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("request-leaves")).toHaveCount(0);
  });

  test("says that time is passing while an act is paid for, holds the acts back until the world stands still, and lets leaving through", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    const acts = ["askSource", "tell", "tellOther", "entrust", "promise"];
    const badge = page.getByTestId("talk-badge");
    // The world stands still: the acts are there, and the badge says so.
    await expect(badge).toHaveAttribute("data-paying", "false");
    await expect(badge.getByTestId("talk-still")).toHaveText("Time stands still while you talk");
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "true");
    // An act is paid for: the clock runs at [20, 1] and is not held.
    await fake.feedFrame(page, {}, [], fake.PAYING);
    await expect(badge).toHaveAttribute("data-paying", "true");
    await expect(badge.getByTestId("talk-passing")).toHaveText("Time is passing while this is said");
    await expect(badge.getByTestId("talk-still")).toHaveCount(0);
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeDisabled();
    await expect(page.locator('[data-testid="topic-chip"]:enabled')).toHaveCount(0);
    await expect(page.getByTestId("topic-chip").first()).toBeDisabled();
    await expect(page.getByTestId("verb-leave")).toBeEnabled();
    await expect(page.getByTestId("talk-time-note")).toHaveAttribute("data-paying", "true");
    await expect(page.getByTestId("talk-time-note")).toHaveText("The minutes of that act are going by. You can go on when time stands still again.");
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "false");
    await lantern.setLang("zh");
    await expect(badge.getByTestId("talk-passing")).toHaveText("说话间时间在流逝");
    await expect(page.getByTestId("talk-time-note")).toHaveText("这件事要花的工夫正在过去，等时间停住了再继续。");
    // The player pauses the world in the middle of the payment: nothing is passing, and the act is still owed, so the acts still wait.
    await fake.feedFrame(page, {}, [], { paused: true, rate: [20, 1] });
    await expect(badge).toHaveAttribute("data-paying", "false");
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeDisabled();
    // It is paid for, and the world holds again.
    await fake.feedFrame(page, {}, [], { paused: true, rate: [1, 1] });
    await expect(badge).toHaveAttribute("data-paying", "false");
    for (const verb of acts) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
    await expect(page.getByTestId("topic-chip").first()).toBeEnabled();
    await expect(page.getByTestId("calm")).toHaveAttribute("data-on", "true");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not let a request be confirmed while an act is owed, and the notebook cannot ask meanwhile", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.answerPreview(page, fake.PREVIEW);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
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

test.describe("a talk with a model chosen", () => {
  test("has no typing button, box or note, whichever provider is chosen", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.startTalk(page, "li_laotai");
    const nothingToType = async (what: string): Promise<void> => {
      await expect(page.getByTestId("talk-area")).toBeVisible();
      for (const id of ["typing", "verb-type", "dialogue-input", "typing-note"]) await expect(page.getByTestId(id), `${id} ${what}`).toHaveCount(0);
      // The acts of the talk are there as they were.
      await expect(page.getByTestId("verb-leave")).toBeVisible();
    };
    await nothingToType("with no provider");
    // A provider that needs a key is not a model until it has one, and a local one needs none.
    await page.evaluate(() => window.__lantern.client.configure({ provider: "bailian" }));
    await nothingToType("with a provider and no key");
    await page.evaluate(() => window.__lantern.client.configure({ provider: "bailian", key: "sk-test-key-for-the-page" }));
    await nothingToType("with a provider and its key");
    await page.evaluate(() => window.__lantern.client.configure({ provider: "ollama" }));
    await nothingToType("with a local model");
    await lantern.setLang("zh");
    await expect(page.getByTestId("talk-verbs")).not.toContainText("打字");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("leaving a talk", () => {
  test("sends the leave, puts away a request that was not confirmed, and takes the talk area away when the core ends the talk", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="ask_bamboo"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("verb-leave").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "leave" });
    await expect(page.getByTestId("request-card")).toHaveCount(0);
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null }, hud: { verbs: ["move"] } }, [
      { kind: "action_ack", tick: 7, action_id: await lastId(page), result: "applied", reason: null },
      { kind: "talk_end", tick: 7, npc: "li_laotai", reason: "left" },
    ]);
    await expect(page.getByTestId("talk-area")).toHaveCount(0);
    await expect(page.getByTestId("verb-ask")).toHaveCount(0);
  });

  test("keeps the lists above the strip under the slip when its note is open, so that the note and its buttons are not covered", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, fake.tasks("t_source"));
    await fake.recordSent(page);
    await fake.startTalk(page, "zhou_huoji", fake.tasks("t_source"));
    // The talk folded the note of the slip, and the player opens it.
    await openTheNote(page);
    const slip = await page.locator(".slip").boundingBox();
    const chips = await page.getByTestId("topic-chips").boundingBox();
    if (slip === null || chips === null) throw new Error("no box");
    expect(chips.y).toBeGreaterThanOrEqual(slip.y + slip.height - 1);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("opens the list that a task's button asked for once the talk is on", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, fake.tasks("t_source"));
    await fake.recordSent(page);
    await expect(page.getByTestId("task-do")).toHaveText("Ask Zhou's Clerk who told them");
    await fake.startTalk(page, "zhou_huoji", fake.tasks("t_source"));
    // The talk folded the note of the slip, and the player opens it to press the phrase.
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    // Already talking to him: no second talk, and the list of the entries heard from someone is open.
    await expect(page.getByTestId("picker-askSource")).toBeVisible();
    expect((await fake.sentSoFar(page)).filter((s) => s.type === "talk")).toEqual([]);
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("问周家伙计听谁说的");
  });
});

test.describe("the topic tags of a long row", () => {
  test("show the first eight and fold the rest behind a line that says how many, in both languages, and a tag in the fold asks like any other", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    const base = await fake.playerOf(page);
    const ids = ["li_da", "li_er", "shitou", "li_xiaomei", "zhou_zhanggui", "zhou_niangzi", "zhou_dalang", "zhou_erlang", "zhou_huoji", "cha_laoban", "old_he", "zuzhang"];
    const topics = ids.map((id) => ({ id, kind: "person", label: { zh: `人${id}`, en: `Person ${id}` } }));
    await fake.feedFrame(page, { player: { ...base, topics } });
    const shown = page.locator('.chip-group[data-kind="person"] > .chip-row > li');
    const fold = page.getByTestId("chips-more");
    await expect(shown).toHaveCount(8);
    await expect(fold.locator("summary")).toHaveText("and 4 more");
    await expect(fold.locator('[data-testid="topic-chip"]').first()).toBeHidden();
    // The whole list is there in the core's order, the fold included.
    await expect(page.locator('.chip-group[data-kind="person"] [data-testid="topic-chip"]')).toHaveText(ids.map((id) => `Person ${id}`));
    await fold.locator("summary").click();
    await expect(fold.locator('[data-testid="topic-chip"]')).toHaveCount(4);
    await expect(fold.locator('[data-testid="topic-chip"]').first()).toBeVisible();
    await lantern.setLang("zh");
    await expect(fold.locator("summary")).toHaveText("另有四个");
    await fold.locator('[data-testid="topic-chip"][data-id="zuzhang"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask", topic: "zuzhang" });
    // A row of eight or fewer has no fold.
    await fake.feedFrame(page, { player: { ...base, topics: topics.slice(0, 8) } });
    await expect(fold).toHaveCount(0);
    await expect(shown).toHaveCount(8);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("a list that runs past its paper says so at the foot, and the phrase turns it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai");
    const base = await fake.playerOf(page);
    const long = (kind: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `${kind}${i}`,
        kind,
        label: { zh: `第${i}件${kind}的事，写得很长很长很长很长很长很长很长很长很长很长很长`, en: `The ${kind} matter number ${i}, written out at some length so that it takes a line of its own on the paper` },
      }));
    await fake.feedFrame(page, { player: { ...base, topics: [...long("entry", 8), ...long("thing", 8), ...long("place", 8)] } });
    const chips = page.getByTestId("topic-chips");
    const turn = page.getByTestId("chips-turn");
    await expect(turn).toBeVisible();
    await expect(turn).toHaveText("More below");
    await lantern.setLang("zh");
    await expect(turn).toHaveText("往下还有");
    // The phrase moves the paper on, and at the foot of it the phrase is gone.
    await turn.getByRole("button").click();
    await expect.poll(() => chips.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await chips.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(turn).toHaveCount(0);
    // A short list has no phrase at all.
    await fake.feedFrame(page, { player: { ...base, topics: long("entry", 1) } });
    await expect(turn).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

// A list of choices that is longer than the room over the strip (what to ask a person for, when the town offers many things) shows whole rows, with the phrase that
// turns the page at its foot, as the tags and the ledger have: a row is never cut in half at the foot, and the phrase turns the list to the rows that come next. Looked at
// in the windows of the smallest size and a little above it, in Chinese on the light theme and in English on the dark one.

const LIST_WINDOWS = [
  { width: 1200, height: 600 },
  { width: 1280, height: 720 },
  { width: 1280, height: 760 },
];

const LIST_LOOKS = [
  { lang: "zh", theme: "light", locale: "zh-CN", turn: "往下还有" },
  { lang: "en", theme: "dark", locale: "en-US", turn: "More below" },
] as const;

/** What the town offers to ask a person for, as many as there are people to talk round. */
const MANY_OFFERS = [
  ["lend", "请她把竹料借给灯会", "Ask her to lend the bamboo for the bridge"],
  ["join", "请对方加入帮工", "Ask them to join the helpers"],
  ["persuade:li_da", "请对方去劝李大", "Ask them to talk Li Da round"],
  ["persuade:li_er", "请对方去劝李二", "Ask them to talk Li Er round"],
  ["persuade:li_xiaomei", "请对方去劝李家小妹", "Ask them to talk Li Xiaomei round"],
  ["persuade:cha_laoban", "请对方去劝茶馆老板娘", "Ask them to talk the Teahouse Keeper round"],
  ["persuade:xiansheng", "请对方去劝私塾先生", "Ask them to talk the Schoolmaster round"],
  ["persuade:zhou_dalang", "请对方去劝周家大郎", "Ask them to talk Zhou Dalang round"],
  ["persuade:zhou_erlang", "请对方去劝周家二郎", "Ask them to talk Zhou Erlang round"],
  ["persuade:zhou_huoji", "请对方去劝周家伙计", "Ask them to talk Zhou's Clerk round"],
  ["persuade:gengfu", "请对方去劝更夫", "Ask them to talk the Night Watchman round"],
  ["persuade:miaozhu", "请对方去劝庙祝", "Ask them to talk the Temple Keeper round"],
].map(([id = "", zh = "", en = ""]) => ({ id, label: { zh, en }, body: { kind: "persuade", target: id.split(":")[1] } }));

/** How much of a row may lie across an edge, in pixels: the foot of the paper and the scroll land on whole pixels, and a row is 34.1 of them high. */
const EDGE = 1;

/** The part of the list that is in view: where its rows are, and where the phrase that turns the page begins, on the screen. */
const listInView = (page: import("@playwright/test").Page) =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="picker-entrust"]');
    if (list === null) throw new Error("no list");
    const top = list.getBoundingClientRect().top + list.clientTop;
    const bottom = top + list.clientHeight;
    const bar = list.querySelector(".turn-bar");
    return {
      scrollTop: list.scrollTop,
      top,
      bottom,
      barTop: bar === null ? null : bar.getBoundingClientRect().top,
      rows: Array.from(list.querySelectorAll("li")).map((row) => {
        const r = row.getBoundingClientRect();
        return { id: row.querySelector("[data-id]")?.getAttribute("data-id") ?? "", top: r.top, bottom: r.bottom };
      }),
    };
  });

for (const size of LIST_WINDOWS) {
  for (const look of LIST_LOOKS) {
    test.describe(`a list of choices that runs past its room, ${look.lang} ${look.theme} ${size.width}x${size.height}`, () => {
      test.use({ locale: look.locale, colorScheme: look.theme, viewport: size });

      test("shows whole rows on each page, with the phrase that turns it, and the last page ends on the last row", async ({ lantern }) => {
        test.setTimeout(150_000);
        const page = lantern.page;
        await fake.openFirstDay(lantern);
        await fake.recordSent(page);
        await fake.startTalk(page, "li_laotai", {}, fake.TALK_VERBS, MANY_OFFERS);
        await page.getByTestId("verb-entrust").click();
        await expect(page.getByTestId("picker-entrust")).toBeVisible();
        const turn = page.getByTestId("picker-turn");
        await expect(turn).toBeVisible();
        await expect(turn).toHaveText(look.turn);
        const scrollSettled = async (): Promise<void> => {
          let last = -1;
          await expect
            .poll(async () => {
              const now = (await listInView(page)).scrollTop;
              const same = now === last;
              last = now;
              return same;
            }, { intervals: [250] })
            .toBe(true);
        };
        const seenIds = new Set<string>();
        let pages = 0;
        for (;;) {
          const now = await listInView(page);
          const barTop = now.barTop ?? now.bottom;
          const whole = now.rows.filter((row) => row.top >= now.top - 0.5 && row.bottom <= barTop + 0.5);
          for (const row of whole) seenIds.add(row.id);
          expect(whole.length, `page ${pages}: rows are whole above the phrase`).toBeGreaterThanOrEqual(2);
          // No row is cut in half by the foot of the list or by the phrase, and none by the head of it once it has been turned, except on the last page, which
          // is as far as the list goes and begins where that leaves it.
          expect(
            now.rows.filter((row) => row.top < barTop - EDGE && row.bottom > barTop + EDGE).map((row) => row.id),
            `page ${pages}: no row lies across the foot`,
          ).toEqual([]);
          if (now.scrollTop > 0 && now.barTop !== null) expect(now.rows.filter((row) => row.top < now.top - EDGE && row.bottom > now.top + EDGE).map((row) => row.id), `page ${pages}: no row lies across the head`).toEqual([]);
          if (now.barTop === null) {
            // The last page: the last row is in view whole.
            expect(now.rows.at(-1)?.bottom ?? 0, "the last row is in view").toBeLessThanOrEqual(now.bottom + 0.5);
            break;
          }
          expect(pages, "the list ends").toBeLessThan(MANY_OFFERS.length);
          const before = now.scrollTop;
          // (the click is sent to the button as it is: a mouse click on a phrase that is stuck at the foot of a paper makes the test browser scroll it into view first)
          await turn.getByRole("button").dispatchEvent("click");
          await expect.poll(async () => (await listInView(page)).scrollTop).toBeGreaterThan(before);
          await scrollSettled();
          pages++;
        }
        expect(pages, "the list has more than one page").toBeGreaterThanOrEqual(1);
        // Every row was whole on some page, the first row of the next page being the first that was not whole on the one before.
        for (const offer of MANY_OFFERS) expect(seenIds.has(offer.id), `${offer.id} was whole on a page`).toBe(true);
        expect(lantern.pageErrors).toEqual([]);
      });
    });
  }
}
