import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// Teaching an act the first time it is of use: no act is hidden by the day, the button of the act glows once and a small card
// says what it does. Each card is a hint, lit one at a time, and what an act taught is not taught again, in this browser.

test.use({ map: true });

async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern, { ...fake.tasksWhere({ t_bamboo_first: "open" }), notebook: [], commitments: [], ...extras }, fake.GUIDED);
  await fake.primeHelp(lantern.page);
  // What the frames fed while the page opened taught is not what the test is about: it starts with nothing taught.
  await lantern.page.evaluate(() => {
    window.__lantern.play.guide.taught.clear();
    localStorage.removeItem("lantern.taught");
  });
}

/** Marks acts as taught on the page, as a browser that has been through them has. */
const markTaught = (lantern: LanternPage, acts: string[]): Promise<void> =>
  lantern.page.evaluate((list) => {
    for (const act of list) window.__lantern.play.guide.taught.add(act);
    localStorage.setItem("lantern.taught", [...window.__lantern.play.guide.taught].sort().join(","));
  }, acts);

const taught = (lantern: LanternPage): Promise<string | null> => lantern.page.evaluate(() => localStorage.getItem("lantern.taught"));
const log = (lantern: LanternPage): Promise<string[]> => lantern.page.evaluate(() => window.__lantern.play.guide.hints.log.map((entry) => entry.id));

/** A talk in which the manager may ask and nothing else: what the first talk of a game offers where there is no request to make. */
const ASK_ONLY = ["leave", "ask", "track"];

/** A task that is followed and asks for the call for helpers. */
function rallyTask(): Record<string, unknown> {
  return { tracked: "t_helpers", tasks: [{ id: "t_helpers", kind: "need", job: "bridge", text: { zh: "找帮手", en: "Find helpers" }, why: null, next: { zh: "先召集一下", en: "Call the town first" }, state: "open", blocker: null, action: { verb: "rally" }, window: null }] };
}

test.describe("teaching an act", () => {
  test("lights the button of an act the first time it is of use, with a card that names it and says what it does", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    // A talk, in which the manager may ask: the tags glow, and the elder says what asking is.
    await fake.startTalk(page, "li_laotai", {}, ASK_ONLY, []);
    const pill = page.getByTestId("hint-pill");
    await expect(pill).toHaveAttribute("data-hint", "teach.ask");
    await expect(pill).toHaveAttribute("data-card", "true");
    await expect(pill.getByTestId("hint-pill-title")).toHaveText(en["teach.ask.title"]);
    await expect(pill).toContainText(en["teach.ask.text"]);
    await expect(page.getByTestId("verb-ask")).toHaveClass(/is-signal/);
    // It is lit as a card of the world and not as a window.
    await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
    expect(await fake.fitsWidth(page)).toBe(true);
    await lantern.switchLang("zh");
    // The signal goes out nine seconds after it was lit, which a slow machine can take between the calls of this test: it is lit again for the look.
    await fake.relight(page, "teach.ask");
    await expect(pill.getByTestId("hint-pill-title")).toHaveText(zh["teach.ask.title"]);
    await expect(pill).toContainText(zh["teach.ask.text"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is done with when the act is used: the card goes, the act is learned in this browser, and it is not taught again", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.recordSent(page);
    await fake.startTalk(page, "li_laotai", {}, ASK_ONLY, []);
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "teach.ask");
    await page.getByTestId("verb-ask").click();
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "ask", topic: "li_er" });
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    expect(await taught(lantern)).toBe("ask");
    // Leaving the talk and coming back in does not bring the card back.
    await fake.feedFrame(page, { player: { ...(await fake.playerOf(page)), talk: null } }, [{ kind: "talk_end", tick: 5, npc: "li_laotai", reason: "left" }]);
    await fake.startTalk(page, "li_da", {}, ASK_ONLY, []);
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    expect(await log(lantern)).toEqual(["teach.ask"]);
  });

  test("does not teach what the browser has been taught already, and does not teach in a game with the hints off", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await markTaught(lantern, ["ask"]);
    await fake.startTalk(page, "li_laotai", {}, ASK_ONLY, []);
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    expect(await log(lantern)).toEqual([]);
    // The hints off silence the cards as they silence the rest.
    await page.evaluate(() => window.__lantern.play.guide.setHintsOn(false));
    await fake.feedFrame(page, { hud: { verbs: [...fake.FREE_VERBS, "speak"] } }, [{ kind: "talk_end", tick: 6, npc: "li_laotai", reason: "left" }]);
    await expect(page.getByTestId("hint-pill")).toHaveCount(0);
    expect(await log(lantern)).toEqual([]);
  });

  test("teaches speaking up where it may be done, on the strip at the foot of the map", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    // What the strip offers at the start is not taught for good: the cards come the next time the acts are of use.
    await fake.feedFrame(page, { hud: { verbs: ["move"] } });
    await fake.feedFrame(page, { hud: { verbs: [...fake.FREE_VERBS, "speak"] } });
    // Two cards at once: the strip's acts are all of use, and the first is lit while the others wait.
    const ids = await log(lantern);
    expect(ids).toContain("teach.speak");
    await page.evaluate(() => window.__lantern.play.guide.hints.again("teach.speak", performance.now()));
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "teach.speak");
    await expect(page.getByTestId("hint-pill").getByTestId("hint-pill-title")).toHaveText(en["teach.speak.title"]);
    await expect(page.getByTestId("verb-speak")).toHaveClass(/is-signal/);
    await page.getByTestId("verb-speak").click();
    // Pressing what is lit has done its work: the next card is lit, and not this one.
    expect(await page.evaluate(() => window.__lantern.play.guide.hints.lit?.id)).not.toBe("teach.speak");
    expect(await taught(lantern)).toContain("speak");
  });

  test("teaches listening in and looking where the frame offers them, one card after the other", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await fake.feedFrame(page, { hud: { verbs: ["move"] } });
    await fake.feedFrame(page, { hud: { verbs: ["move", "talk", "listen", "look"] }, player: { ...(await fake.playerOf(page)), look: ["t_rail"] } });
    expect(await log(lantern)).toEqual(["teach.listen", "teach.look"]);
    const pill = page.getByTestId("hint-pill");
    await expect(pill).toHaveAttribute("data-hint", "teach.listen");
    await expect(page.getByTestId("verb-listen")).toHaveClass(/is-signal/);
    await page.getByTestId("verb-listen").click();
    await expect(pill).toHaveAttribute("data-hint", "teach.look");
    await expect(page.getByTestId("verb-look")).toHaveClass(/is-signal/);
  });

  test("teaches the call for helpers when a task asks for it, and the request to the elder to call the clan as a card of its own", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await markTaught(lantern, ["ask", "ask_source", "listen", "look"]);
    await fake.recordSent(page);
    await fake.feedFrame(page, rallyTask());
    const pill = page.getByTestId("hint-pill");
    await expect(pill).toHaveAttribute("data-hint", "teach.rally");
    await expect(pill.getByTestId("hint-pill-title")).toHaveText(en["teach.rally.title"]);
    await expect(pill).toContainText("not the same as asking the elder");
    await expect(page.getByTestId("verb-rally")).toHaveClass(/is-signal/);
    await page.getByTestId("verb-rally").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "rally" });
    await expect(pill).toHaveCount(0);
    // Talking to the elder, who can be asked to call the clan: the request is taught, and then its kind.
    await fake.startTalk(page, "zuzhang", {}, ["leave", "ask", "entrust"], fake.entrustOffers("zuzhang"));
    await expect(pill).toHaveAttribute("data-hint", "teach.entrust");
    await expect(page.getByTestId("verb-entrust")).toHaveClass(/is-signal/);
    await page.getByTestId("verb-entrust").click();
    await expect(pill).toHaveAttribute("data-hint", "teach.convene");
    await expect(pill.getByTestId("hint-pill-title")).toHaveText(en["teach.convene.title"]);
    await expect(pill).toContainText("Call for helpers");
    expect(await log(lantern)).toEqual(["teach.rally", "teach.entrust", "teach.convene"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("teaches the gift from the second day, and not on the first, where the first talk is about the bamboo", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await markTaught(lantern, ["ask", "ask_source", "entrust"]);
    await fake.startTalk(page, "li_laotai", {}, [...fake.TALK_VERBS, "gift"]);
    expect(await log(lantern)).not.toContain("teach.gift");
    await fake.feedFrame(page, { time: { day: 2, hour: 9, minute: 0, phase: "day" } });
    await fake.startTalk(page, "li_da", { time: { day: 2, hour: 9, minute: 0, phase: "day" } }, [...fake.TALK_VERBS, "gift"]);
    expect(await log(lantern)).toContain("teach.gift");
  });

  test("lights the gift button of the talk when the gift is taught, so that the card has something to point at", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await markTaught(lantern, ["ask", "ask_source", "entrust"]);
    const day2 = { time: { day: 2, hour: 9, minute: 0, phase: "day" } };
    await fake.feedFrame(page, day2);
    await fake.startTalk(page, "li_da", day2, [...fake.TALK_VERBS, "gift"]);
    const pill = page.getByTestId("hint-pill");
    await expect(pill).toHaveAttribute("data-hint", "teach.gift");
    await expect(page.getByTestId("gift-open")).toHaveClass(/is-signal/);
    // Pressing what is lit has done its work.
    await page.getByTestId("gift-open").click();
    await expect(page.getByTestId("gift-open")).not.toHaveClass(/is-signal/);
    expect(await taught(lantern)).toContain("gift");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("teaches asking who told them where the answer that can be followed is on the screen, and lights the phrase beside it", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await markTaught(lantern, ["ask", "entrust", "gift"]);
    await fake.recordSent(page);
    // A line the player overheard, told by somebody else, is in the notebook, so the core lists the act in every talk; with a person who has said
    // nothing to follow, the phrase is nowhere on the screen and there is nothing to teach.
    const heard = { kind: "heard", who: { zh: "周家伙计", en: "Zhou's Clerk", id: "zhou_huoji" }, how: "heard", via: { zh: "茶馆老板娘", en: "Teahouse Keeper", id: "cha_laoban" } };
    const named = (zh: string, en: string, id: string) => ({ zh, en, id });
    const line = { id: "n_rail", text: { zh: "栏杆是朝河那边断的。", en: "The rail broke on the river side." }, source: heard, marks: [], chain: [named("周家伙计", "Zhou's Clerk", "zhou_huoji"), named("茶馆老板娘", "Teahouse Keeper", "cha_laoban"), null] };
    await fake.startTalk(page, "zhou_huoji", { notebook: [...fake.notebook(), line] });
    await expect(page.getByTestId("talk-follow")).toHaveCount(0);
    await page.waitForTimeout(400);
    expect(await log(lantern)).not.toContain("teach.ask_source");
    // The person answers with a line that was passed on to them: the phrase is there, and the card points at it.
    await page.getByTestId("verb-ask").click();
    await page.locator('[data-testid="topic-chip"][data-id="t_rail"]').click();
    const id = String((await fake.sentSoFar(page)).at(-1)?.action_id);
    const reply = { npc: "zhou_huoji", until: 999_999, text: { zh: "我听老板娘说，栏杆是朝河那边断的。", en: "I heard from the madam that the rail broke on the river side." } };
    await fake.feedFrame(page, { bubbles: [reply], notebook: [...fake.notebook(), line] }, [
      { kind: "asked", tick: 2, npc: "zhou_huoji", topic: "t_rail", entry: "n_rail" },
      { kind: "action_ack", tick: 2, action_id: id, result: "applied", reason: null },
    ]);
    await expect(page.getByTestId("talk-follow")).toHaveText("Who told you?");
    await expect.poll(() => log(lantern)).toContain("teach.ask_source");
    // The hints of the story that the line of the notebook lit come first; the card is lit when its turn comes, and the phrase glows.
    await page.evaluate(() => window.__lantern.play.guide.hints.again("teach.ask_source", performance.now()));
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "teach.ask_source");
    await expect(page.getByTestId("talk-follow")).toHaveClass(/is-signal/);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not by the day: every act of the strip is there at the start, as the frame offers it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { hud: { verbs: [...fake.FREE_VERBS, "speak"] }, player: { ...(await fake.playerOf(page)), look: ["t_rail"] } });
    for (const act of ["listen", "look", "rally", "speak"]) await expect(page.getByTestId(`verb-${act}`)).toBeVisible();
    expect(await page.evaluate(() => window.__lantern.client.state.frame?.time)).toMatchObject({ day: 1 });
  });
});
