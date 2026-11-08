import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { appliedActions, askByTag, askUntilNoted, clockOf, closeElder, eventsOf, leaveTalk, startGame, talkTo, untilHeld, waitForClock } from "../support/real.ts";

// The talk and the notebook on the real core, in the browser host (Pyodide): the first day of the slice, played the way a person
// plays it, with nothing fed to the page by hand. What these tests look at is the interface of the talk.

// A press that has nothing to press fails in seconds with its own name, instead of waiting out the whole test.
test.use({ actionTimeout: 20_000 });

// Three times the common pace, so that a day of the game is a minute. The map is left out: it is the heavy part of a page.
const GAME = "pace=3&map=off";

interface Name {
  zh: string;
  en: string;
}

/** What the core answers to `preview`, as the page asks it of the host. */
interface CorePreview {
  version: number;
  cost: number;
  asks: Name;
  gives: Name | null;
  blockers: Name[];
  odds: "high" | "mid" | "low" | null;
  reasons: Array<{ sign: 1 | -1; text: Name }>;
}

const corePreview = (page: Page, action: Record<string, unknown>): Promise<CorePreview> => page.evaluate((a) => window.__lantern.client.call<CorePreview>({ op: "preview", action: a }), action);

test.describe("a request on the real core", () => {
  test("is previewed by the core, sent with the version of that preview, takes its minutes while the acts wait, and its answer stays when the person has to go", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await talkTo(page, "li_laotai");
    await untilHeld(page);

    // Someone who knows nothing of a matter says whom to ask, and the event of the answer names the person.
    expect(await askByTag(page, "zhou_erlang")).toBe(true);
    const asked = (await eventsOf(page, "asked")).at(-1);
    expect(asked).toMatchObject({ npc: "li_laotai", answer: "ignorant", pointer: "cha_laoban" });
    const name = page.getByTestId("talk-line").last().getByTestId("pointer");
    await expect(name).toHaveAttribute("data-npc", "cha_laoban");
    await expect(name).toHaveText("Teahouse Keeper");
    await name.click();
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "cha_laoban");
    await expect(page.getByTestId("lead")).toHaveAttribute("data-npc", "cha_laoban");
    // There is no list of pointers in the frame for the page to find it in: a bubble has the words and nothing more.
    expect(await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { bubbles: Array<Record<string, unknown>> }).bubbles.every((b) => !("points" in b)))).toBe(true);

    // The card is the core's preview of the action the player is about to send, word for word.
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="lend"]').click();
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    const core = await corePreview(page, { verb: "entrust", npc: "li_laotai", kind: "lend" });
    expect(core.cost).toBe(20);
    expect(core.odds).toBe("low");
    expect(core.blockers.length).toBeGreaterThan(0);
    expect(core.blockers.map((b) => b.en).join(" ")).toMatch(/Granny Li/);
    await expect(page.getByTestId("request-asks").locator("dd")).toHaveText(core.asks.en);
    await expect(page.getByTestId("request-cost")).toHaveAttribute("data-minutes", String(core.cost));
    await expect(page.getByTestId("request-blocker")).toHaveText(core.blockers.map((b) => b.en));
    await expect(page.getByTestId("request-odds")).toHaveAttribute("data-odds", core.odds ?? "");
    await expect(page.getByTestId("request-reasons").locator("li")).toHaveCount(core.reasons.length);
    // The page has no preview of its own: nothing was made up, and nothing went out.
    await expect(card).not.toHaveAttribute("data-fake", /.*/);
    expect((await appliedActions(lantern)).filter((a) => a.type === "entrust")).toEqual([]);

    // When the minutes of the request would run to the hour she has to go, the card says so, and the talk then ends with the answer.
    const goes = (await page.getByTestId("request-leaves").count()) > 0;
    await expect(page.getByTestId("late-entrust")).toHaveCount(goes ? 1 : 0);
    if (goes) await expect(page.getByTestId("request-leaves")).toHaveText("Granny Li will have to go once this is said");

    // The player confirms. The action goes out with the id of the card and the version of the preview.
    await lantern.e2e("throttle", { minDelayMs: 300 });
    await page.getByTestId("request-confirm").click();
    const badge = page.getByTestId("talk-badge");
    await expect(badge).toHaveAttribute("data-paying", "true");
    await expect(badge.getByTestId("talk-passing")).toHaveText("Time is passing while this is said");
    // While the minutes go by the acts wait, and leaving does not.
    for (const verb of ["tell", "entrust", "promise"]) await expect(page.getByTestId(`verb-${verb}`)).toBeDisabled();
    await expect(page.getByTestId("topic-chip").first()).toBeDisabled();
    await expect(page.getByTestId("verb-leave")).toBeEnabled();
    await expect(page.getByTestId("talk-time-note")).toHaveAttribute("data-paying", "true");
    // She says no, in the core's words, where the preview was, and the answer took the minutes the preview said.
    await expect(card).toHaveAttribute("data-phase", "result");
    await expect(page.getByTestId("request-result")).toHaveAttribute("data-ok", "false");
    await expect(page.getByTestId("request-result")).toHaveText("×They will not even discuss it until something else is settled.");
    await expect(page.getByTestId("request-spent")).toHaveText("That took 20 minutes.");
    await expect(page.getByTestId("request-reply")).not.toBeEmpty();
    if (goes) {
      // She had to go as it was said, as the card told: the talk is over, the world runs, and the answer is still there to read.
      await expect(badge).toHaveCount(0);
      await expect(page.getByTestId("talk-ended")).toBeVisible();
      await expect(card).toHaveAttribute("data-phase", "result");
      // The column is scrolled to it, where the player is looking, and not left with the card below the fold.
      await expect(card).toBeInViewport({ ratio: 0.9 });
      await expect(page.getByTestId("request-result")).toHaveText("×They will not even discuss it until something else is settled.");
      await expect(page.getByTestId("status")).toHaveText("running");
      await page.getByTestId("request-close").click();
      await expect(page.getByTestId("talk-ended")).toHaveCount(0);
    } else {
      // The world holds again once the minutes are paid for, and the acts are back.
      await expect(badge).toHaveAttribute("data-paying", "false");
      await untilHeld(page);
      for (const verb of ["tell", "entrust", "promise"]) await expect(page.getByTestId(`verb-${verb}`)).toBeEnabled();
      await expect(badge.getByTestId("talk-still")).toBeVisible();
    }
    const sent = (await appliedActions(lantern)).filter((a) => a.type === "entrust");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "lend", version: core.version });
    expect(sent[0]).not.toHaveProperty("offer");
    // The task is blocked now, and the card of the task says why.
    await expect(page.getByTestId("task-card")).toContainText("Granny Li");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says that the person will have to go once a request is said, and the answer stays on the card, in view, when they have gone", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await talkTo(page, "li_laotai");
    await untilHeld(page);
    // Ask about other things, ten minutes each, until the twenty minutes of the request would run to the hour she has to go.
    const topics = ["zhou_erlang", "li_er", "li_da", "p_bridge"];
    for (const topic of topics) {
      await page.getByTestId("verb-entrust").click();
      await page.locator('[data-testid="picker-option"][data-id="lend"]').click();
      await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
      if ((await page.getByTestId("request-leaves").count()) > 0) break;
      await page.getByTestId("request-cancel").click();
      expect(await askByTag(page, topic), `the tag of ${topic}`).toBe(true);
      await untilHeld(page);
    }
    const card = page.getByTestId("request-card");
    await expect(page.getByTestId("request-leaves")).toHaveText("Granny Li will have to go once this is said");
    await expect(page.getByTestId("late-entrust")).toHaveText("Granny Li will have to go once this is said");
    await expect(page.getByTestId("late-promise")).toHaveText("Granny Li will have to go once this is said");
    await expect(page.getByTestId("late-askSource")).toHaveCount(0);
    await page.getByTestId("request-confirm").click();
    // She says it, and goes: the talk is over and the world runs, and her answer is still where the player can read it.
    await expect(page.getByTestId("talk-badge")).toHaveCount(0);
    await expect(page.getByTestId("talk-ended")).toBeVisible();
    await expect(card).toHaveAttribute("data-phase", "result");
    await expect(page.getByTestId("request-result")).toHaveText("×They will not even discuss it until something else is settled.");
    await expect(page.getByTestId("request-reply")).not.toBeEmpty();
    await expect(card).toBeInViewport({ ratio: 0.9 });
    await expect(page.getByTestId("status")).toHaveText("running");
    await page.getByTestId("request-close").click();
    await expect(page.getByTestId("talk-ended")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes back to a new preview, with the line that things have changed, when the state moved on after the preview was made", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await talkTo(page, "li_laotai");
    await untilHeld(page);
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="lend"]').click();
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    const first = await corePreview(page, { verb: "entrust", npc: "li_laotai", kind: "lend" });
    // The state moves on behind the card: another act is made, and its minutes go by.
    await page.evaluate(() => window.__lantern.play.ask("li_er", { zh: "李二", en: "Li Er" }));
    await page.waitForFunction(() => window.__lantern.play.state.talk?.lines.length === 2);
    await untilHeld(page);
    const second = await corePreview(page, { verb: "entrust", npc: "li_laotai", kind: "lend" });
    expect(second.version).toBeGreaterThan(first.version);
    // The card still holds the old version, and the core turns it down as stale and does nothing.
    await expect(card).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-confirm").click();
    await expect(page.getByTestId("request-stale")).toHaveText("Things have changed, have another look");
    await expect(card).toHaveAttribute("data-phase", "preview");
    // What went out was the action with the version of the first preview, and the core turned it down and did nothing with it.
    const refused = (await appliedActions(lantern)).filter((a) => a.type === "entrust");
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ kind: "lend", version: first.version });
    expect((await eventsOf(page, "action_ack")).at(-1)).toMatchObject({ result: "rejected", reason: "stale", action_id: refused[0]?.action_id });
    // Nothing was said to her about it: no result, no note, and the world did not run for it.
    await expect(page.getByTestId("request-result")).toHaveCount(0);
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    await untilHeld(page);
    // The new card carries the new version.
    await page.getByTestId("request-confirm").click();
    await expect(card).toHaveAttribute("data-phase", "result");
    const sent = (await appliedActions(lantern)).filter((a) => a.type === "entrust");
    expect(sent).toHaveLength(2);
    expect(sent[1]?.version).toBeGreaterThanOrEqual(second.version);
    expect(sent[1]?.action_id).not.toBe(sent[0]?.action_id);
    expect(lantern.pageErrors).toEqual([]);
  });
});

/** The ids of the hints of the world that have been given so far, in the order they were. */
const hintsGiven = (page: Page): Promise<string[]> => page.evaluate(() => window.__lantern.play.guide.hints.log.map((entry) => entry.id));

/**
 * Opens the elder (he may have come by already, and given some levels), asks for the levels he has not given, and returns what he said:
 * the words of level 1, of level 2, of level 3 and what he adds of the hour.
 */
async function askElder(page: Page): Promise<string[]> {
  await closeElder(page);
  await page.getByTestId("btn-elder").click();
  await expect(page.getByTestId("elder")).toBeVisible();
  for (const level of [1, 2, 3]) {
    const more = page.getByTestId(`elder-level-${level}`);
    if ((await more.count()) > 0) await more.click();
    await expect(page.getByTestId(`elder-answer-${level}`)).toBeVisible();
  }
  const said = await page.getByTestId("elder-answer-1").getByTestId("elder-text").allTextContents();
  said.push(...(await page.getByTestId("elder-answer-2").getByTestId("elder-text").allTextContents()));
  said.push(...(await page.getByTestId("elder-answer-3").locator("p").allTextContents()));
  await page.getByTestId("elder-close").click();
  await expect(page.getByTestId("elder")).toHaveCount(0);
  return said;
}

test.describe("the notebook and the evening on the real core", () => {
  test("lights a pair, judges it, is told when two lines alone do not show a relation, clears the rumour up at the teahouse and asks Li Da, who promises", async ({ lantern }) => {
    test.setTimeout(600_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    // The madam of the teahouse has heard it, and the clerk of the Zhou shop saw something first hand.
    await talkTo(page, "cha_laoban");
    await untilHeld(page);
    expect(await askByTag(page, "li_er")).toBe(true);
    await leaveTalk(page);
    // The clerk of the Zhou shop is about at noon, and tells what was seen first hand.
    await waitForClock(page, 12, 20);
    await askUntilNoted(page, "zhou_huoji", "li_er", 3);
    await leaveTalk(page);
    // The hints of the world came as the day went: the tags and the hour of a talk, the first line, something to set beside another.
    const given = await hintsGiven(page);
    expect(given.indexOf("chips")).toBeGreaterThanOrEqual(0);
    expect(given.indexOf("leaves")).toBeGreaterThanOrEqual(0);
    expect(given.indexOf("notebook")).toBeGreaterThan(given.indexOf("chips"));
    expect(given.indexOf("compare")).toBeGreaterThan(given.indexOf("notebook"));

    // --- the notebook: a hint lights a pair, a second ask says how they stand, and one press sets them side by side
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    expect(await page.getByTestId("note").count()).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId("pairing")).toBeVisible();
    await expect(page.getByTestId("notebook-hint")).toBeEnabled();
    await expect(page.getByTestId("hint-line")).toHaveCount(0);
    await page.getByTestId("notebook-hint").click();
    const line = page.getByTestId("hint-line");
    await expect(line).toHaveAttribute("data-a", /.+/);
    const lit = { a: (await line.getAttribute("data-a")) ?? "", b: (await line.getAttribute("data-b")) ?? "" };
    await expect(page.locator('[data-testid="note"][data-hinted="true"]')).toHaveCount(2);
    await expect(page.getByTestId("hint-relation")).toHaveCount(0);
    await expect(page.getByTestId("notebook-hint")).toContainText("Tell me how they stand");
    await page.getByTestId("notebook-hint").click();
    await expect(page.getByTestId("hint-relation")).toBeVisible();
    // A second ask says the relation of the same pair, and does not light another.
    await expect(line).toHaveAttribute("data-a", lit.a);
    await expect(line).toHaveAttribute("data-b", lit.b);
    await page.getByTestId("hint-use").click();
    await expect(page.getByTestId("pair-first")).toHaveAttribute("data-id", lit.a);
    await expect(page.getByTestId("pair-second")).toHaveAttribute("data-id", lit.b);
    await expect(page.getByTestId("pair-judge")).toBeEnabled();
    const relation = ((await page.locator('[data-testid^="rel-"][aria-checked="true"]').first().getAttribute("data-testid")) ?? "").replace("rel-", "");
    expect(["unsupported", "contradicts", "mismatch"]).toContain(relation);
    await page.getByTestId("pair-judge").click();
    // The core takes it: it is among the judgements, and the pair that was lit is done with.
    await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("judgment").first()).toHaveAttribute("data-a", lit.a);
    await expect(page.getByTestId("judgment").first()).toHaveAttribute("data-relation", relation);
    expect(await page.locator('[data-testid="note"] [data-testid^="seal-"]').count()).toBeGreaterThan(0);
    await expect(page.getByTestId("hint-line")).toHaveCount(0);

    // --- two lines that alone do not show a relation: the core says so in its words, and nothing is kept
    const ids = await page.getByTestId("note").evaluateAll((els) => els.map((el) => el.getAttribute("data-id") ?? ""));
    const judgedBefore = await page.getByTestId("judgment").count();
    // The pair that was judged stays in its places until it is put away, and a line that is picked twice is not picked.
    const putAway = async (): Promise<void> => {
      if ((await page.getByTestId("pair-hold").count()) > 0) await page.getByTestId("pair-hold").click();
    };
    await putAway();
    let heard = false;
    for (const [a, b] of [ids.slice(0, 2), ids.slice(1, 3), [ids[0] ?? "", ids[2] ?? ""]] as const) {
      await page.locator(`[data-testid="note"][data-id="${a}"]`).getByTestId("note-pick").click();
      await page.locator(`[data-testid="note"][data-id="${b}"]`).getByTestId("note-pick").click();
      await page.getByTestId("rel-contradicts").click();
      await page.getByTestId("pair-judge").click();
      const outcome = page.getByTestId("pair-outcome");
      await expect(outcome).toHaveAttribute("data-ok", /true|false/);
      if ((await outcome.getAttribute("data-ok")) === "false") {
        await expect(outcome).toHaveAttribute("data-reason", "not_shown");
        await expect(outcome).toHaveText("These two alone do not show it");
        heard = true;
        break;
      }
      await putAway();
    }
    expect(heard).toBe(true);
    await putAway();

    // The pair to say in public: what the clerk saw first hand, against the version of the madam. The core takes it if it was not judged.
    const judgedNote = async (text: string): Promise<string> => (await page.locator('[data-testid="note"]', { hasText: text }).first().getAttribute("data-id")) ?? "";
    const seen = await judgedNote("Li Er was at the Stone Bridge last night");
    const version = await judgedNote("out of envy over the festival");
    expect([seen, version]).not.toContain("");
    await page.locator(`[data-testid="note"][data-id="${seen}"]`).getByTestId("note-pick").click();
    await page.locator(`[data-testid="note"][data-id="${version}"]`).getByTestId("note-pick").click();
    await page.getByTestId("rel-unsupported").click();
    await page.getByTestId("pair-judge").click();
    await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "true");
    expect(await page.getByTestId("judgment").count()).toBeGreaterThan(judgedBefore - 1);
    // Before the evening the pair cannot be said yet, and the page says where and when it can.
    await expect(page.getByTestId("judgment-where").first()).toBeVisible();
    await expect(page.getByTestId("judgment-clarify").first()).toBeDisabled();
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("status")).toHaveText("running");

    // --- the elder, with the rumour to set straight: the task that is followed is the core's, and he reads it
    await page.getByTestId("task-more").click();
    await page.locator('[data-testid="task-other"][data-id="t_clear_rumour"]').getByTestId("task-track").click();
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_clear_rumour");
    const elder = await askElder(page);
    expect(elder[0]).toBe("Think about this: Set it straight in public with the two lines you judged.");
    expect(elder[1]).toContain("You have judged these two already");
    expect(elder[1]).toContain("Li Er was at the Stone Bridge last night");
    // The card has no button before the afternoon (the walk to the teahouse is offered from four, an hour before the evening), so the next step
    // is said in the card's own words.
    expect(elder[2]).toBe("Your next step: Set it straight in public with the two lines you judged.");
    // The card has the evening at the teahouse for its window, every day, so the elder says when and where the people are.
    expect(elder[3]).toBe("Find them: Teahouse, Day 1 17:00 to 19:00.");
    expect(elder).toHaveLength(4);

    // --- the evening at the teahouse
    await waitForClock(page, 17, 20);
    // The occasion is listed now, and the elder says when and where the people are.
    const evening = await askElder(page);
    expect(evening[1]).toContain("You have judged these two already");
    expect(evening[2]).toMatch(/^Your next step: (Go to Teahouse|Set it straight in public with the two lines you judged\.)$/);
    expect(evening[3]).toBe("Find them: Teahouse, Day 1 17:00 to 19:00.");
    // The card has the manager speak after six, when everyone who counts is in the room (Li Da, who has the bamboo, comes at a quarter to five,
    // the elder and the Zhou people by half past five): before it, at the teahouse, there is nothing to press.
    await waitForClock(page, 18, 1);
    // The player is at the teahouse, so the button of the card is the one that clears the claim up, and it opens the notebook where the judged
    // pair is. The verbs of the town are under the sheet, and are there when it is shut.
    await expect(page.getByTestId("task-do")).toHaveText("Clear up the claim in public");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("verb-speak")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("cost-speak")).toHaveAttribute("data-minutes", "30");
    await expect(page.getByTestId("cost-speak")).toHaveText("30 min");
    const hints = await hintsGiven(page);
    expect(hints.indexOf("evening")).toBeGreaterThanOrEqual(0);
    expect(hints.indexOf("speak")).toBeGreaterThan(hints.indexOf("evening"));
    // The people have come by six, and the player is among them.
    await page.getByTestId("btn-notebook").click();
    // The clarify button is there for every pair judged right, with its minutes.
    await expect(page.getByTestId("judgment-clarify").first()).toBeEnabled();
    await expect(page.getByTestId("judgment-clarify").first().getByTestId("cost-clarify")).toHaveText("30 min");
    await expect(page.getByTestId("judgment-where")).toHaveCount(0);
    // The pair the player means to say: what the clerk saw, against the madam's version.
    const row = page.locator(`[data-testid="judgment"][data-a="${seen}"][data-b="${version}"]`);
    await expect(row).toHaveCount(1);
    const before = await clockOf(page);
    await row.getByTestId("judgment-clarify").click();
    const sheet = page.getByTestId("clarify");
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    // The people who were there, one after the other, each with a stand before and after and the reason they give in public.
    const hearers = page.getByTestId("hearer");
    expect(await hearers.count()).toBeGreaterThanOrEqual(5);
    const stands = await hearers.evaluateAll((els) => els.map((el) => [el.getAttribute("data-before"), el.getAttribute("data-after")]));
    for (const [from, to] of stands) {
      expect(["against", "unsure", "for"]).toContain(from);
      expect(["against", "unsure", "for"]).toContain(to);
    }
    await expect(page.getByTestId("hearer-reason").first()).not.toBeEmpty();
    await expect(page.getByTestId("hearer-change").first().getByTestId("stance-before")).toBeVisible();
    const clarified = (await eventsOf(page, "clarified")).at(-1) as { accepted: number; audience: Array<{ npc: string; before: string; after: string }>; claim: string; basis: string[]; venue: string };
    expect(clarified).toMatchObject({ venue: "p_teahouse", claim: version, basis: [seen] });
    expect(clarified.audience.map((h) => [h.before, h.after])).toEqual(stands);
    expect(clarified.accepted).toBeGreaterThanOrEqual(4);
    // Granny Li takes her objection back, and the page says so in a note, in words and not as an id.
    expect((await eventsOf(page, "objection_withdrawn")).at(-1)).toMatchObject({ npc: "li_laotai", what: "bamboo" });
    await expect(page.getByTestId("game-note").filter({ hasText: "Granny Li no longer stands in the way of the bamboo." })).toHaveCount(1);
    // The people come in one after the other, and the picture waits for the last (a note does not stay as long).
    await page.getByTestId("clarify-done").click();
    // The same pair cannot be said again to the same people, and the page says why where the pair is.
    await row.getByTestId("judgment-clarify").click();
    await expect(page.getByTestId("clarify-no")).toHaveAttribute("data-reason", "said_already");
    await expect(page.getByTestId("clarify-no")).toHaveText("You said this here already, to the same people.");
    // The half hour is paid for once the notebook, which holds the world, is shut: the clock went by at the fast rate and held no more.
    await page.getByTestId("notebook-close").click();
    await expect.poll(async () => (await clockOf(page)).minutes - before.minutes, { timeout: 30_000 }).toBeGreaterThanOrEqual(30);

    // --- Li Da heard it, and promises the first batch: the preview says when it would come
    // The people of the teahouse tell each other what they heard for a while after it, and a person in the middle of a telling is busy, so the
    // player asks again at once (a few seconds of the test are hours of the game) and has Li Da before he goes home at eight.
    await talkTo(page, "li_da", 120_000, 300);
    await untilHeld(page);
    // The card of the person has what the town says of them and, while they are in the talk, the hour they have to go.
    const person = page.getByTestId("person-card");
    await expect(person).toHaveAttribute("data-person", "li_da");
    await expect(person.getByTestId("person-bio-text")).not.toBeEmpty();
    await expect(person.getByTestId("person-leaves")).toBeVisible();
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-option"][data-id="material"]').click();
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    const material = await corePreview(page, { verb: "entrust", npc: "li_da", kind: "material" });
    await expect(page.getByTestId("request-asks").locator("dd")).toHaveText(material.asks.en);
    expect(material.asks.en).toContain("4 poles, by 7 tomorrow morning");
    expect(material.blockers).toEqual([]);
    await page.getByTestId("request-confirm").click();
    await expect(card).toHaveAttribute("data-phase", "result");
    await expect(page.getByTestId("request-result")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("request-result")).toHaveText("Li Da agreed.");
    // What was promised is a line in the ledger, which is opened for the look and shut again, since it lies over the talk.
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("commitment")).toHaveCount(1);
    await page.getByTestId("board-toggle").click();
    // What they agreed is in the card in a sentence: folded while the talk is on, and open when it is over (the twenty minutes the request takes
    // may be the minutes in which the person has to go).
    await expect(person).toHaveAttribute("data-person", "li_da");
    const folded = person.getByTestId("person-facts");
    if ((await folded.count()) > 0) await folded.locator("summary").click();
    await expect(person.getByTestId("person-commitment-text")).toHaveText("Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 tomorrow morning");
    await expect(person.getByTestId("person-commitment")).toHaveAttribute("data-state", "promised");
    // The hints of the day, in the order the core played it.
    const day = await hintsGiven(page);
    for (const [earlier, later] of [["blocked", "evening"], ["evening", "speak"], ["speak", "opened"], ["opened", "promised"]] as const) {
      if (day.includes(earlier)) expect(day.indexOf(later), `${later} after ${earlier} in ${day.join(",")}`).toBeGreaterThan(day.indexOf(earlier));
    }
    expect(day).toEqual(expect.arrayContaining(["evening", "speak", "opened", "promised"]));
    expect(lantern.pageErrors).toEqual([]);
  });
});
