import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";

// The tutorial of the first day on a real game of the slice, from Start to the evening, and on a page of fake frames where the
// states it waits for are fed by hand.
test.use({ map: true });

/** Opens the page as a player does, and presses Start once the town is ready. */
async function start(lantern: import("../support/fixtures.ts").LanternPage, query = "pace=100"): Promise<void> {
  await lantern.page.goto(`${lantern.servers.app.origin}/?${query}`);
  await lantern.waitReady();
  await expect(lantern.page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
  await lantern.page.getByTestId("opening-start").click();
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

test.describe("the tutorial on a real game", () => {
  test("is walked from the goal to the evening, and the world waits for every card", async ({ lantern }) => {
    test.setTimeout(420_000);
    const page = lantern.page;
    // A pace at which the player's walk is not a race against the day on a loaded machine: a day of the game is 20 seconds.
    await start(lantern, "pace=10");
    const card = page.getByTestId("tutorial-card");
    const step = page.getByTestId("tutorial-step");

    // 1. The goal and the first task. The world has not moved a tick, and the button of the pause does not let it go under the card.
    await expect(card).toHaveAttribute("data-step", "goal");
    await expect(step).toHaveText("Tutorial 1 of 6");
    await expect(page.getByTestId("tutorial-title")).toHaveText("The festival is on the night of the fifth day");
    await expect(page.getByTestId("tut-task")).toContainText("Get the first bamboo from the Li family");
    await expect(page.getByTestId("btn-pause")).toBeDisabled();
    expect(await stands(page)).toBe(true);
    expect(await tickOf(page)).toBe(0);
    await page.getByTestId("tutorial-next").click();

    // 2. Go to Granny Li. The card says where and how, still on the first tick, and puts away what is not needed.
    await expect(card).toHaveAttribute("data-step", "ask");
    await expect(step).toHaveText("Tutorial 2 of 6");
    await expect(card).toContainText("Granny Li");
    expect(await stands(page, 400)).toBe(true);
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("tutorial-line")).toHaveText("Go to Granny Li and ask for the bamboo.");
    await expect(page.getByTestId("tutorial-chip")).toHaveAttribute("data-step", "ask");
    // The world runs, the button that does it glows, and a ring on the map shows who.
    await expect.poll(() => tickOf(page)).toBeGreaterThan(5);
    await expect(page.getByTestId("task-do")).toHaveClass(/is-signal/);
    await expect(page.getByTestId("map-ping")).toHaveAttribute("data-id", "li_laotai");
    // The button walks the player up to her and talks. If she has moved on before the player is there, it is pressed again.
    await expect
      .poll(
        async () => {
          if ((await page.getByTestId("talk-badge").count()) > 0) return true;
          const idle = await page.evaluate(() => window.__lantern.play.state.approach === null && window.__lantern.play.state.talk === null);
          if (idle) await page.getByTestId("task-do").click();
          return false;
        },
        { timeout: 90_000, intervals: [400] },
      )
      .toBe(true);
    // In the talk the act that the task asks for is the one that glows.
    await expect(page.getByTestId("verb-entrust")).toHaveClass(/is-signal/);
    await page.locator('[data-testid="picker-option"][data-id="lend"]').click();
    await page.getByTestId("request-confirm").click();

    // 3. Her refusal, in the words of the core: what is in the way, why, and what to do next.
    await expect(card).toHaveAttribute("data-step", "refusal", { timeout: 90_000 });
    await expect(step).toHaveText("Tutorial 3 of 6");
    await expect(page.getByTestId("tutorial-title")).toHaveText("She will not lend it");
    await expect(page.getByTestId("tut-blocker").locator("dd")).toHaveText("The Li family will not give the bamboo");
    await expect(page.getByTestId("tut-why").locator("dd")).toHaveText("Granny Li says the town blames her second son, and you said nothing.");
    await expect(page.getByTestId("tut-next").locator("dd")).toHaveText("Find out where that talk came from.");
    expect(await stands(page)).toBe(true);
    await page.getByTestId("tutorial-next").click();

    // 4. Where did the talk come from. The two cards come one after the other, and then the world is the player's.
    await expect(card).toHaveAttribute("data-step", "source");
    await expect(page.getByTestId("tutorial-title")).toHaveText("Where did the talk come from?");
    await page.getByTestId("tutorial-next").click();
    await expect(page.getByTestId("tutorial-line")).toHaveText("Ask around who told whom, back to the one who saw it.");
    await page.evaluate(() => window.__lantern.play.leave());
    await talkTo(page, "cha_laoban");
    await ask(page, "li_er");
    await expect(page.getByTestId("notebook-count")).toHaveText("1", { timeout: 90_000 });
    await page.evaluate(() => window.__lantern.play.leave());
    await talkTo(page, "zhou_huoji");
    await ask(page, "li_er");
    await expect(page.getByTestId("notebook-count")).toHaveText("2", { timeout: 90_000 });
    await ask(page, "li_er");
    await expect(page.getByTestId("notebook-count")).toHaveText("3", { timeout: 90_000 });

    // 5. Two lines side by side in the notebook, and how they stand, shown once. The notebook opens by itself.
    await expect(card).toHaveAttribute("data-step", "compare", { timeout: 90_000 });
    await expect(step).toHaveText("Tutorial 5 of 6");
    // The lines are quoted without the full stop they end with, which the sentence has of its own.
    await expect(page.getByTestId("tut-pair")).toContainText("“Li Er was at the Stone Bridge last night” and “");
    await expect(page.getByTestId("tut-relation")).toHaveText("The second goes beyond the first");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    // The notebook is scrolled to the pair, past the entries that are new, so that the relation and the button that judges are in view.
    await expect(page.getByTestId("pairing")).toBeInViewport({ ratio: 0.9 });
    await expect(page.getByTestId("pair-first")).toContainText("Li Er was at the Stone Bridge last night.");
    await expect(page.getByTestId("rel-unsupported")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("btn-notebook")).toHaveClass(/is-signal/);
    expect(await stands(page)).toBe(true);
    await page.getByTestId("tutorial-next").click();
    // The core takes judgements (`judge` is among the verbs of the frame), so the step is done when the player judges the pair that was set up.
    await page.getByTestId("pair-judge").click();
    await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "true");

    // 6. The evening at the teahouse comes when the afternoon does, and the world goes on until then (the notebook held it, and so did the talk: the core holds the clock for the whole of a talk, so the player leaves it first).
    await page.getByTestId("notebook-close").click();
    await page.evaluate(() => window.__lantern.play.leave());
    await expect(card).toHaveAttribute("data-step", "evening", { timeout: 60_000 });
    await expect(step).toHaveText("Tutorial 6 of 6");
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
    await page.getByTestId("opening-start").click();
    await expect(page.getByTestId("status")).toHaveText("running");
    await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
    // The menu plays it again: the first day starts over, held under the first card.
    await lantern.openMenu();
    await page.getByTestId("btn-tutorial").click();
    await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "goal");
    expect(await stands(page)).toBe(true);
    expect(await tickOf(page)).toBeLessThan(5);
    expect(await page.evaluate(() => localStorage.getItem("lantern.tutorial"))).toBe("new");
    await page.getByTestId("tutorial-next").click();
    await expect(page.getByTestId("tutorial-card")).toHaveAttribute("data-step", "ask");
    await page.getByTestId("tutorial-next").click();
    await expect.poll(() => tickOf(page)).toBeGreaterThan(10);
    await expect(page.getByTestId("status")).toHaveText("running");
    expect(lantern.pageErrors).toEqual([]);
  });

});
