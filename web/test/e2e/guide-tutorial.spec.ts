import type { Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { expect, test } from "../support/fixtures.ts";
import { pressStart } from "../support/start.ts";
import { openRequest } from "../support/real.ts";

// The tutorial of the first day on a real game of the slice, from Start to the evening, and on a page of fake frames where the
// states it waits for are fed by hand.
test.use({ map: true });

/** Opens the page as a player does, and presses Start once the town is ready. */
async function start(lantern: import("../support/fixtures.ts").LanternPage, query = "pace=100"): Promise<void> {
  await lantern.page.goto(`${lantern.servers.app.origin}/?${query}`);
  await lantern.waitReady();
  await expect(lantern.page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
  await pressStart(lantern.page);
}

const tickOf = (page: Page): Promise<number> => page.evaluate(() => window.__lantern.client.state.simTick);

/** Whether the tick stays where it is for a while: the world is held. */
async function stands(page: Page, ms = 700): Promise<boolean> {
  const before = await tickOf(page);
  await page.waitForTimeout(ms);
  return (await tickOf(page)) === before;
}

/** Talks to a person: the page walks up to them and talks, and tries again if they are busy. */
async function talkTo(page: Page, npc: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const play = window.__lantern.play;
          if (play.state.talk?.npc === id) return true;
          if (play.state.approach === null && play.state.talk === null) play.talkOrWalk(id);
          return false;
        }, npc),
      { timeout: 90_000, intervals: [300] },
    )
    .toBe(true);
}

const ask = (page: Page, topic: string): Promise<void> => page.evaluate((id) => window.__lantern.play.ask(id, { zh: id, en: id }), topic);

/**
 * Asks `topic` of `npc` until the notebook has `count` notes. A person who changes duty ends a talk that is open (the clerk does at 10:00, 12:00 and 13:00, and the steps of the page
 * land at such an hour on a slow machine), and a question asked after that is turned away as `not_talking`. So the poll opens the talk again where there is none, asks once for each
 * note it still lacks, and asks again only where the answer has not come in a few seconds.
 */
async function askUntil(page: Page, npc: string, topic: string, count: number): Promise<void> {
  let asked = { have: -1, at: 0 };
  await expect
    .poll(
      async () => {
        const have = Number(await page.getByTestId("notebook-count").textContent());
        if (have >= count) return have;
        const talking = await page.evaluate((id) => window.__lantern.play.state.talk?.npc === id, npc);
        if (!talking) {
          await page.evaluate((id) => {
            const play = window.__lantern.play;
            if (play.state.approach === null && play.state.talk === null) play.talkOrWalk(id);
          }, npc);
        } else if (asked.have !== have || Date.now() - asked.at > 4000) {
          asked = { have, at: Date.now() };
          await ask(page, topic);
        }
        return have;
      },
      { timeout: 90_000, intervals: [400] },
    )
    .toBe(count);
}

test.describe("the tutorial on a real game", () => {
  test("is walked from the goal to the evening, and the world waits for every card", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    // A pace at which the player's walk is not a race against the day on a loaded machine: Granny Li is at home for three hours of the morning and for three at noon, and the
    // page has to walk the manager to her and open the talk in that time, which at this pace is some twenty seconds of the machine's.
    await start(lantern, "pace=2");
    const card = page.getByTestId("tutorial-card");
    const step = page.getByTestId("tutorial-step");

    // 1. The goal and the first task, on one card that leads to Granny Li. The world has not moved a tick, and the button of the pause does not let it go under the card.
    await expect(card).toHaveAttribute("data-step", "granny");
    await expect(step).toHaveText("Tutorial 1 of 4");
    await expect(page.getByTestId("tutorial-title")).toHaveText(en["tut.granny.title"]);
    await expect(card).toContainText("Granny Li");
    await expect(page.getByTestId("tut-task")).toContainText("Get the first load of bamboo from the Li family");
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    expect(await stands(page)).toBe(true);
    expect(await tickOf(page)).toBe(0);
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveCount(0);

    // 2. Go to Granny Li. The line says where and how, the world runs, the button that does it glows, and a ring on the map shows who.
    await expect(page.getByTestId("tutorial-line")).toHaveText("Go to Granny Li and ask for the bamboo.");
    await expect(page.getByTestId("tutorial-chip")).toHaveAttribute("data-step", "granny");
    await expect.poll(() => tickOf(page)).toBeGreaterThan(5);
    await expect(page.getByTestId("task-do")).toHaveClass(/is-signal/);
    await expect(page.getByTestId("map-ping")).toHaveAttribute("data-id", "li_laotai");
    // The button walks the player up to her and talks. If she has moved on before the player is there, it is pressed again. The talk can open between the look at the page and the
    // press, and the slip folds then and has no button to press: a press that has none waits a few seconds, and the next look finds the talk.
    await expect
      .poll(
        async () => {
          if ((await page.getByTestId("talk-badge").count()) > 0) return true;
          const idle = await page.evaluate(() => window.__lantern.play.state.approach === null && window.__lantern.play.state.talk === null);
          if (idle) await page.getByTestId("task-do").click({ timeout: 4000 }).catch(() => undefined);
          return false;
        },
        { timeout: 90_000, intervals: [400] },
      )
      .toBe(true);
    // In the talk the act that the task asks for is the one that glows.
    await expect(page.getByTestId("verb-entrust")).toHaveClass(/is-signal/);
    await openRequest(page, "lend");
    await page.getByTestId("request-confirm").click();

    // 3. Her refusal, in the words of the core, and the second person the tutorial leads to: Zhou's Clerk.
    await expect(card).toHaveAttribute("data-step", "clerk", { timeout: 90_000 });
    await expect(step).toHaveText("Tutorial 2 of 4");
    await expect(page.getByTestId("tutorial-title")).toHaveText(en["tut.clerk.title"]);
    await expect(page.getByTestId("tut-blocker").locator("dd")).toHaveText("The Li family will not give the bamboo");
    await expect(page.getByTestId("tut-why").locator("dd")).toHaveText("The town is saying Li Er broke the bridge. Granny Li is angry that you, the manager, have said nothing.");
    expect(await stands(page)).toBe(true);
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("tutorial-line")).toHaveText(en["tut.clerk.chip"]);
    await expect(page.getByTestId("tutorial-chip")).toHaveAttribute("data-step", "clerk");
    await expect(page.getByTestId("map-ping")).toHaveAttribute("data-id", "zhou_huoji");
    // Ask around who told whom, back to the one who saw it: the madam, and then the clerk.
    await page.evaluate(() => window.__lantern.play.leave());
    await talkTo(page, "cha_laoban");
    await askUntil(page, "cha_laoban", "li_er", 1);
    await page.evaluate(() => window.__lantern.play.leave());
    await talkTo(page, "zhou_huoji");
    await askUntil(page, "zhou_huoji", "li_er", 2);
    await askUntil(page, "zhou_huoji", "li_er", 3);

    // 4. A claim, and a line shown against it, and how they stand, shown once. The notebook opens by itself.
    await expect(card).toHaveAttribute("data-step", "compare", { timeout: 90_000 });
    await expect(step).toHaveText("Tutorial 3 of 4");
    // The lines are quoted without the full stop they end with, which the sentence has of its own.
    await expect(page.getByTestId("tut-pair")).toContainText("the line you set against it is \u201cLi Er was at the bridge last night\u201d");
    await expect(page.getByTestId("tut-relation")).toHaveText(en["pairing.ans.unsupported"]);
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    // The notebook is scrolled to the pair, past the entries that are new, so that the answers are in view. The page shows the pair by its foot, above the phrase that turns the page, and the pair can be
    // taller than that by as much as the lines of the title of the slip, which the book starts under, take from the page (the book is open at two pages, and the page is narrow): what is in view is then
    // the answers, which the step needs, and not the whole of the pair, whose heading lies above the page.
    await expect(page.getByTestId("answers")).toBeInViewport({ ratio: 0.99 });
    await expect(page.getByTestId("pair-shown")).toContainText("Li Er was at the bridge last night.");
    await expect(page.getByTestId("ans-unsupported")).toHaveClass(/is-signal/);
    await expect(page.getByTestId("btn-notebook")).toHaveClass(/is-signal/);
    expect(await stands(page)).toBe(true);
    await page.getByTestId("tutorial-next").click();
    // The core takes judgements (`judge` is among the verbs of the frame), so the step is done when the player answers for the pair that was set up.
    await page.getByTestId("ans-unsupported").click();
    await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "true");

    // 6. The evening at the teahouse comes when the afternoon does, and the world goes on until then (the notebook held it, and so did the talk: the core holds the clock for the whole of a talk, so the player leaves it first).
    await page.getByTestId("notebook-close").click();
    await page.evaluate(() => window.__lantern.play.leave());
    await expect(card).toHaveAttribute("data-step", "evening", { timeout: 60_000 });
    await expect(step).toHaveText("Tutorial 4 of 4");
    await expect(page.getByTestId("tut-when")).toContainText("Teahouse, Day 1 17:00 to 19:00");
    // Those who will be there are a few names and a count of the rest, because the whole town is expected.
    await expect(page.getByTestId("tut-expected").locator("li").first()).toBeVisible();
    expect(await page.getByTestId("tut-expected").locator("li").count()).toBeLessThanOrEqual(6);
    await expect(page.getByTestId("tut-expected-more")).toContainText("more");
    expect(await stands(page)).toBe(true);
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("tutorial-chip")).toHaveCount(0);
    await expect(page.getByTestId("game-note").last()).toHaveText("The tutorial is done. Ask the elder any time you need a hand.");
    expect(await page.evaluate(() => localStorage.getItem("lantern.tutorial"))).toBe("done");
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("can be skipped from a card, lets the world go, and does not come back; the menu plays it again from the first tick", async ({ lantern }) => {
    test.setTimeout(180_000);
    const page = lantern.page;
    await start(lantern, "pace=60");
    await expect(page.getByTestId("tutorial-card")).toBeVisible();
    await page.getByTestId("tutorial-skip").click();
    await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
    await expect(page.getByTestId("tutorial-chip")).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect.poll(() => tickOf(page)).toBeGreaterThan(30);
    expect(await page.evaluate(() => localStorage.getItem("lantern.tutorial"))).toBe("skipped");
    // A page that is opened again does not show it.
    await page.reload();
    await lantern.waitReady();
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await pressStart(page);
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
    // The menu plays it again: the first day starts over, held under the first card.
    await lantern.openMenu();
    await page.getByTestId("btn-tutorial").click();
    await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "granny");
    expect(await stands(page)).toBe(true);
    expect(await tickOf(page)).toBeLessThan(5);
    expect(await page.evaluate(() => localStorage.getItem("lantern.tutorial"))).toBe("new");
    // The help is shown again from the start: what the browser had been taught is forgotten.
    expect(await page.evaluate(() => localStorage.getItem("lantern.taught"))).toBe("");
    await page.getByTestId("tutorial-next").click();
    await expect.poll(() => tickOf(page)).toBeGreaterThan(10);
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
  });

});
