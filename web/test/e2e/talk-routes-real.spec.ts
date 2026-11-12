import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { appliedActions, closeElder, eventsOf, leaveTalk, notebookCount, openRequest, startGame, talkTo, untilHeld, untilSettled, waitForClock } from "../support/real.ts";

// The routes of the first day on the real core in the browser host (Pyodide), played through the entries of the talk: the request on the
// button and the list of the others, what a person asks in return and the answer to it, the promise that is made from the list and from the
// button, and the promises that are kept. Each is a way that the game has always had; none is sent but by pressing what the page shows.
// The people are where their routines put them, so each test waits for the hour a person is at their post before it talks to them.
test.use({ actionTimeout: 20_000 });

const GAME = "pace=3&map=off";
/** Ten times the common pace, for the test that waits two days. */
const FAST = "pace=10&map=off";

/** The result card of the request that was confirmed, and whether the core said yes. */
async function confirmed(page: Page): Promise<boolean> {
  await page.getByTestId("request-confirm").click();
  await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "result", { timeout: 90_000 });
  const ok = (await page.getByTestId("request-result").getAttribute("data-ok")) === "true";
  await untilSettled(page);
  return ok;
}

/** Puts the result card away, so that the next act has its place. */
async function putAway(page: Page): Promise<void> {
  await closeElder(page);
  if ((await page.getByTestId("request-close").count()) > 0) await page.getByTestId("request-close").click();
  await expect(page.getByTestId("request-card")).toHaveCount(0);
}

/** The card of the request in progress. */
const card = (page: Page) => page.getByTestId("request-card");

/** The promises the core has applied, in order. */
const promisesOf = async (lantern: Parameters<typeof appliedActions>[0]): Promise<Array<Record<string, unknown>>> => (await appliedActions(lantern)).filter((a) => a.type === "promise");

/** The entries of the talk that carry no minutes: the four acts and what is put forward are words, and none says how long it takes. */
async function noMinutes(page: Page): Promise<void> {
  const text = (await page.getByTestId("talk-verbs").innerText()) + ((await page.getByTestId("talk-context").count()) > 0 ? await page.getByTestId("talk-context").innerText() : "");
  expect(text).not.toMatch(/\d+\s*min/);
}

test.describe("what a person asks in return, on the real core", () => {
  test("the elder turns the request to join down and asks a promise in return; yes makes it without a second press, the request is looked at again and he agrees", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "zuzhang", 120_000, 2000);
    await untilHeld(page);
    await noMinutes(page);
    // The red slip is the bamboo, so the elder has no request on the button: it says the plain words and opens the list.
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask a favour");
    await expect(page.getByTestId("talk-context")).toHaveCount(0);
    await openRequest(page, "join");
    const card = page.getByTestId("request-card");
    await expect(card).toHaveAttribute("data-phase", "preview");
    // No minutes on the button that sends it, and the core's preview says in plain words what the chance is.
    await expect(page.getByTestId("request-confirm")).toHaveText("Go ahead");
    await expect(page.getByTestId("request-odds").locator("dd")).toHaveText(/Likely|Hard to say|Unlikely/);
    expect(await confirmed(page)).toBe(false);
    await expect(page.getByTestId("request-result")).toHaveText("×Clan Elder turned you down.");

    // The elder asks something in return: the question is under the acts, with the promise they want and the request it is for.
    await expect(page.getByTestId("answer-line")).toBeVisible();
    await expect(page.getByTestId("answer-offer")).toHaveText("Promise the Clan Elder the honour of leading the lantern parade");
    await expect(page.getByTestId("answer-for")).toContainText("join the helpers");
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "answer");
    expect(await page.getByTestId("answer-line").getAttribute("data-token")).toMatch(/^[0-9a-f]{8}$/);
    await page.getByTestId("request-close").click();

    // Yes: the promise is made as the core previewed it, with no second press.
    await page.getByTestId("answer-yes").click();
    await expect(card).toHaveAttribute("data-verb", "promise");
    await expect(card).toHaveAttribute("data-phase", "result", { timeout: 90_000 });
    await expect(page.getByTestId("request-result")).toHaveText("You gave your word to Clan Elder.");
    await untilSettled(page);
    expect((await promisesOf(lantern)).map((a) => [a.what, a.item])).toEqual([["role", "lead_lanterns"]]);
    await expect(page.getByTestId("answer-line")).toHaveCount(0);

    // The request that was turned down is offered again, to be looked at on the numbers as they are now, and the elder agrees.
    await page.getByTestId("request-follow").click();
    await expect(card).toHaveAttribute("data-verb", "entrust");
    await expect(card).toHaveAttribute("data-offer", "join");
    await expect(card).toHaveAttribute("data-phase", "preview");
    expect((await appliedActions(lantern)).filter((a) => a.type === "entrust")).toHaveLength(1);
    expect(await confirmed(page)).toBe(true);
    await expect(page.getByTestId("request-result")).toHaveText("Clan Elder agreed.");
    expect((await appliedActions(lantern)).filter((a) => a.type === "entrust").map((a) => a.kind)).toEqual(["join", "join"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the keeper of the temple is turned down, and the answer is no: nothing is sent; the same request is not asked again to no purpose; a promise from the button changes the numbers, and the request is turned down again with a new question and three things to do", async ({ lantern }) => {
    test.setTimeout(480_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "miaozhu", 120_000, 2000);
    await untilHeld(page);
    await openRequest(page, "join");
    expect(await confirmed(page)).toBe(false);
    const first = page.getByTestId("answer-line");
    await expect(first).toBeVisible();
    await expect(page.getByTestId("answer-offer")).toHaveText("Promise the Temple Keeper a back-row stall");
    const token = await first.getAttribute("data-token");
    await page.getByTestId("request-close").click();

    // No: nothing is sent. The question is put away, and what is left behind it is the promise that can be made.
    await page.getByTestId("answer-no").click();
    expect(await promisesOf(lantern)).toEqual([]);
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "give");
    await expect(page.getByTestId("verb-context")).toHaveText("Promise Temple Keeper something");

    // The request is turned down today: it is in the list with where it stands.
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("picker-entrust").locator('[data-id="join"] .picker-badge')).toHaveText("Turned down today");
    await page.keyboard.press("Escape");

    // The promise from the button: the one they wanted first, and the others under it.
    await page.getByTestId("verb-context").click();
    const give = page.getByTestId("picker-promise");
    await expect(give.locator(".picker-heading").first()).toHaveText("What Temple Keeper wants");
    await give.locator('[data-id="stall:back"]').click();
    await expect(card(page)).toHaveAttribute("data-verb", "promise");
    expect(await confirmed(page)).toBe(true);
    await expect(page.getByTestId("request-result")).toHaveText("You gave your word to Temple Keeper.");
    expect((await promisesOf(lantern)).map((a) => [a.what, a.item])).toEqual([["stall", "back"]]);
    await putAway(page);

    // The numbers are not what they were: asked again, it is turned down again, with a new question. Behind it are the promise to keep and the
    // promise to make, in that order, and the question is the one put forward.
    await openRequest(page, "join");
    expect(await confirmed(page)).toBe(false);
    await expect(page.getByTestId("answer-line")).toBeVisible();
    expect(await page.getByTestId("answer-line").getAttribute("data-token")).not.toBe(token);
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-count", "3");
    await expect(page.getByTestId("context-more")).toHaveText("2 more");
    await page.getByTestId("context-more").click();
    await expect(page.getByTestId("picker-rest").getByTestId("picker-option").first()).toContainText("ahead of time:");
    await expect(page.getByTestId("picker-rest").getByTestId("picker-option").last()).toHaveText("Promise Temple Keeper something");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the stalls a person asks for have all been promised to others: no return is asked, and what is left to promise is put forward without them", async ({ lantern }) => {
    test.setTimeout(540_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "cha_laoban", 120_000, 2000);
    await untilHeld(page);
    // The keeper of the teahouse turns the request to join down and asks a front-row stall in return; with it promised she agrees.
    await openRequest(page, "join");
    expect(await confirmed(page)).toBe(false);
    await expect(page.getByTestId("answer-offer")).toHaveText("Promise the Teahouse Keeper a front-row stall");
    await page.getByTestId("request-close").click();
    await page.getByTestId("answer-yes").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "result", { timeout: 90_000 });
    await untilSettled(page);
    await page.getByTestId("request-follow").click();
    expect(await confirmed(page)).toBe(true);
    await putAway(page);
    // There are two front stalls, and the second goes to her too, from the list of what can be promised.
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-entrust"] [data-group="give"] [data-id="stall:front"]').click();
    expect(await confirmed(page)).toBe(true);
    await putAway(page);
    expect((await promisesOf(lantern)).filter((a) => a.what === "stall" && a.item === "front")).toHaveLength(2);
    await expect.poll(() => page.evaluate(() => (window.__lantern.client.state.frame?.hud as { resources: { stall_front: number } }).resources.stall_front)).toBe(0);
    await leaveTalk(page);

    // The shopkeeper would have asked the same, and there is none left to promise: his refusal comes with no question, and the promise that can
    // be made is put forward all the same, with the back stalls and the rest and without what he wanted.
    await waitForClock(page, 11, 5);
    await talkTo(page, "zhou_zhanggui", 120_000, 2000);
    await untilHeld(page);
    await openRequest(page, "material");
    expect(await confirmed(page)).toBe(false);
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await page.getByTestId("request-close").click();
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "give");
    await page.getByTestId("verb-context").click();
    const give = page.getByTestId("picker-promise");
    await expect(give.locator(".picker-heading")).toHaveText(["Others"]);
    await expect(give.locator('[data-id="stall:front"]')).toHaveCount(0);
    await expect(give.locator('[data-id="stall:back"]')).toHaveCount(1);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("promises to one person are put forward one at a time, one is kept early from the list behind the first, and the other on the day it falls due, without the word", async ({ lantern }) => {
    test.setTimeout(540_000);
    const page = lantern.page;
    await startGame(lantern, FAST);
    await waitForClock(page, 9, 5);
    await talkTo(page, "zuzhang", 120_000, 2000);
    await untilHeld(page);
    // Two promises from the list of the others, which has what can be promised even before a request was turned down.
    for (const offer of ["wage:10", "slot:1"]) {
      await page.getByTestId("verb-entrust").click();
      await page.locator(`[data-testid="picker-entrust"] [data-group="give"] [data-id="${offer}"]`).click();
      expect(await confirmed(page)).toBe(true);
      await putAway(page);
    }
    expect((await promisesOf(lantern)).map((a) => a.what)).toEqual(["wage", "slot"]);
    // One is put forward and the other is counted. They are in the order they fall due, then the order they were made in.
    const context = page.getByTestId("talk-context");
    await expect(context).toHaveAttribute("data-kind", "keep");
    await expect(context).toHaveAttribute("data-count", "2");
    await expect(page.getByTestId("context-more")).toHaveText("1 more");
    await expect(page.getByTestId("verb-context")).toContainText("ahead of time:");
    const firstWords = (await page.getByTestId("verb-context").innerText()).trim();
    // The other is kept from the list behind the first, before its day.
    await page.getByTestId("context-more").click();
    await expect(page.getByTestId("picker-rest").getByTestId("picker-option")).toHaveCount(1);
    await page.getByTestId("picker-rest").getByTestId("picker-option").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-verb", "promise");
    expect(await confirmed(page)).toBe(true);
    await putAway(page);
    expect((await promisesOf(lantern)).filter((a) => a.op === "keep")).toHaveLength(1);
    // What was kept is not put forward again: the first is the only one left.
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("verb-context")).toHaveText(firstWords);
    await leaveTalk(page);

    // On the day it falls due the word is gone from the button.
    await waitForClock(page, 9, 5, 3, 400_000);
    await talkTo(page, "zuzhang", 150_000, 2000);
    await untilHeld(page);
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "keep");
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-count", "1");
    await expect(page.getByTestId("context-more")).toHaveCount(0);
    const due = (await page.getByTestId("verb-context").innerText()).trim();
    expect(due).toContain("Keep your promise to");
    expect(due).not.toContain("ahead of time");
    expect(firstWords.split(": ").slice(1).join(": ")).toBe(due.split(": ").slice(1).join(": "));
    await page.getByTestId("verb-context").click();
    expect(await confirmed(page)).toBe(true);
    expect((await promisesOf(lantern)).filter((a) => a.op === "keep")).toHaveLength(2);
    await putAway(page);
    await expect(page.getByTestId("talk-context")).toHaveCount(0);
    expect((await eventsOf(page, "pledge_kept")).length).toBeGreaterThan(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("two requests at once, on the real core", () => {
  test("the elder can be asked to join and to call the clan, both from the list, each with its own preview", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "zuzhang", 120_000, 2000);
    await untilHeld(page);
    // The red slip is not about the elder: the button has the plain words, and the list has both, each open.
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask a favour");
    await page.getByTestId("verb-entrust").click();
    const list = page.getByTestId("picker-entrust");
    await expect(list.locator('[data-group="asks"] [data-testid="picker-option"]').filter({ hasText: /join/i })).toHaveCount(1);
    await expect(list.locator('[data-group="asks"] [data-testid="picker-option"]').filter({ hasText: /call the clan/i })).toHaveCount(1);
    await expect(list.locator('[data-id="join"] .picker-badge')).toHaveCount(0);
    await expect(list.locator('[data-id="convene"] .picker-badge')).toHaveCount(0);
    // Each opens its own preview, and the host is asked for the action the player would send.
    for (const kind of ["join", "convene"]) {
      await openRequest(page, kind);
      await expect(page.getByTestId("request-card")).toHaveAttribute("data-offer", kind);
      await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
      await page.getByTestId("request-cancel").click();
      await expect(page.getByTestId("request-card")).toHaveCount(0);
    }
    // Asking to join goes out, and the answer is the core's. The call of the clan stays in the list, open.
    await openRequest(page, "join");
    await confirmed(page);
    expect((await appliedActions(lantern)).filter((a) => a.type === "entrust").map((a) => a.kind)).toEqual(["join"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the keeper of the temple can be asked to open the lane and to tell what they saw, both from the list", async ({ lantern }) => {
    test.setTimeout(300_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "miaozhu", 120_000, 2000);
    await untilHeld(page);
    await page.getByTestId("verb-entrust").click();
    const list = page.getByTestId("picker-entrust");
    for (const kind of ["lane", "testify", "join"]) await expect(list.locator(`[data-id="${kind}"]`)).toHaveCount(1);
    for (const kind of ["lane", "testify"]) {
      await openRequest(page, kind);
      await expect(page.getByTestId("request-card")).toHaveAttribute("data-offer", kind);
      await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
      await page.getByTestId("request-cancel").click();
      await expect(page.getByTestId("request-card")).toHaveCount(0);
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("Granny Li's bamboo, on the real core", () => {
  test("has its three ways in the page: the request on the button, the honour from the list, and the elder who is asked to talk her round", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "li_laotai", 120_000, 2000);
    await untilHeld(page);
    // The red slip is the bamboo: the request on the button is hers to lend it, with its preview up by one press.
    await expect(page.getByTestId("verb-entrust")).toHaveText("Ask Granny Li to lend the bamboo for the bridge");
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-offer", "lend");
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    expect(await confirmed(page)).toBe(false);
    await putAway(page);
    // Way two, the honour of lighting the main lantern for her family: it is in the list of the others, where what can be promised is, before and
    // after the request was turned down. The core did not ask for it in return (it turned the request down for a condition and not for weight).
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await page.getByTestId("verb-entrust").click();
    await page.locator('[data-testid="picker-entrust"] [data-group="give"] [data-id="role:t_honor_light"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-verb", "promise");
    expect(await confirmed(page)).toBe(true);
    expect((await promisesOf(lantern)).map((a) => [a.what, a.item])).toEqual([["role", "t_honor_light"]]);
    await putAway(page);
    // The request for the bamboo is in the list too, turned down today, and it is asked again with the honour promised.
    await openRequest(page, "lend");
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await page.getByTestId("request-cancel").click();
    await leaveTalk(page);

    // Way three, the elder, who is asked to talk her round: it is in his list, with the others, and its preview names her.
    await waitForClock(page, 11, 30);
    await talkTo(page, "zuzhang", 120_000, 2000);
    await untilHeld(page);
    await page.getByTestId("verb-entrust").click();
    await expect(page.getByTestId("picker-entrust").locator('[data-id="persuade:li_laotai"]')).toHaveCount(1);
    await page.locator('[data-testid="picker-entrust"] [data-id="persuade:li_laotai"]').click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
    await expect(page.getByTestId("request-asks").locator("dd")).toContainText("Granny Li");
    await page.getByTestId("request-cancel").click();
    expect(lantern.pageErrors).toEqual([]);
  });
});

/** Walks to the ferry as a click on it does, and waits until the boat is within reach of a look: the look is on the list of the page then. */
async function toTheFerry(page: Page): Promise<void> {
  await page.evaluate(() => window.__lantern.play.goTo({ x: 0, y: 0, place: "p_ferry" }));
  await expect
    .poll(() => page.evaluate(() => ((window.__lantern.client.state.frame as unknown as { player: { look?: string[] } }).player.look ?? []).includes("t_he_boat")), { timeout: 120_000, intervals: [200] })
    .toBe(true);
}

/** Looks at the boat from the list the page opens, and waits for what the page says of it: the boatman will not yet, or the look has begun. */
async function lookAtTheBoat(page: Page, says: RegExp): Promise<void> {
  await closeElder(page);
  await page.getByTestId("verb-look").click();
  await page.locator('[data-testid="picker-look"] [data-id="t_he_boat"]').click();
  await expect(page.getByTestId("game-note").filter({ hasText: says })).toHaveCount(1, { timeout: 30_000 });
}

test.describe("the boatman's boat, on the real core", () => {
  test("a look that was turned down: the first talk of the day is not enough and puts nothing forward, the second puts the promise forward with no question, and the look is let through after it", async ({ lantern }) => {
    test.setTimeout(360_000);
    const page = lantern.page;
    const refused = /will not let you look/;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 0);
    // The boatman does not know the manager yet: the look is turned down, and the page says so.
    await toTheFerry(page);
    await lookAtTheBoat(page, refused);
    await expect(page.getByTestId("game-note").filter({ hasText: refused })).toHaveCount(0, { timeout: 30_000 });
    // The first talk of the day earns a little trust and is not enough. The core puts no promise forward yet, so there is no button for one, though the list of the
    // others has what can be promised.
    await talkTo(page, "old_he", 120_000, 2000);
    await untilHeld(page);
    await expect(page.getByTestId("talk-context")).toHaveCount(0);
    await leaveTalk(page);
    // Turned down once more, now that the manager has talked with him today. This time the core puts the promise forward in the talk, with no request asked.
    await toTheFerry(page);
    await lookAtTheBoat(page, refused);
    await expect(page.getByTestId("game-note").filter({ hasText: refused })).toHaveCount(0, { timeout: 30_000 });
    await talkTo(page, "old_he", 120_000, 2000);
    await untilHeld(page);
    await expect(page.getByTestId("answer-line")).toHaveCount(0);
    await expect(page.getByTestId("talk-context")).toHaveAttribute("data-kind", "give");
    await expect(page.getByTestId("verb-context")).toHaveText("Promise Boatman He something");
    await page.getByTestId("verb-context").click();
    await page.getByTestId("picker-promise").getByTestId("picker-option").first().click();
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-verb", "promise");
    await expect(page.getByTestId("request-card")).toHaveAttribute("data-offer", "wage:10");
    expect(await confirmed(page)).toBe(true);
    await putAway(page);
    expect((await promisesOf(lantern)).map((a) => [a.what, a.amount])).toEqual([["wage", 10]]);
    await leaveTalk(page);
    // After the promise the look is let through: the page says that it has begun and no refusal comes.
    await toTheFerry(page);
    const before = await notebookCount(page);
    await lookAtTheBoat(page, /Looking at/);
    await expect(page.getByTestId("game-note").filter({ hasText: refused })).toHaveCount(0);
    await expect.poll(() => notebookCount(page), { timeout: 90_000, intervals: [300] }).toBeGreaterThan(before);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a gift, on the real core", () => {
  test("goes at once from the talk and is said in it, what was learnt of the taste is on the card of the hearts, and a second one the same day is held back with its reason and is not sent", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await startGame(lantern, GAME);
    await waitForClock(page, 9, 5);
    await talkTo(page, "li_laotai", 120_000, 2000);
    await untilHeld(page);
    const open = page.getByTestId("gift-open");
    await expect(open).not.toHaveAttribute("aria-disabled", "true");
    await open.click();
    await expect(page.getByTestId("gift-panel").locator(".picker-label")).toHaveText(["tea leaves", "pastries", "lantern paper", "wine"]);
    await page.getByTestId("gift-panel").locator('[data-id="tea"]').click();
    await expect(page.getByTestId("gift-panel")).toHaveCount(0);
    await expect.poll(async () => (await appliedActions(lantern)).filter((a) => a.type === "gift").map((a) => a.item), { timeout: 60_000, intervals: [200] }).toEqual(["tea"]);
    await untilSettled(page);
    await expect(page.getByTestId("talk-line").filter({ hasText: "You gave tea leaves" })).toHaveCount(1);
    // The town gives one gift a day: the word is greyed, says why when it is pressed, and nothing is sent.
    await expect(open).toHaveAttribute("aria-disabled", "true");
    await open.click({ force: true });
    await expect(page.getByTestId("talk-off")).toHaveText("A gift has been given today already. Try again tomorrow.");
    await expect(page.getByTestId("gift-panel")).toHaveCount(0);
    // What the gift taught is on the card of the hearts, whose own word for a gift is greyed in the same way.
    await page.getByTestId("talk-head").getByTestId("hearts").click();
    await expect(page.getByTestId("hearts-likes")).toHaveText("Does not mind: tea leaves");
    await expect(page.getByTestId("hearts-gift")).toHaveAttribute("aria-disabled", "true");
    await expect(page.getByTestId("hearts-gift-off")).toHaveText("A gift has been given today already. Try again tomorrow.");
    await page.getByTestId("hearts-close").click();
    expect((await appliedActions(lantern)).filter((a) => a.type === "gift")).toHaveLength(1);
    expect(lantern.pageErrors).toEqual([]);
  });
});
