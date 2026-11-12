import { expect, test } from "../support/fixtures.ts";
import { appliedActions, startGame } from "../support/real.ts";

// The brief guidance on the real first day of the slice, from the opening page: the task card names the goal and what is in the way and has no button, and
// the clan elder gives the button with his third level, which walks the manager to Granny Li.
test.use({ map: true });

test.describe("the brief guidance on the real core", () => {
  test("leaves the next step to the elder: no button on the card, the third level has it, and it takes the step", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    // The elder comes by when nothing has moved for 600 ticks, and his card covers the slip. The test asks him itself, with his button, which the hints being off leave as it is.
    await page.addInitScript(() => localStorage.setItem("lantern.hints", "off"));
    // The elder's third level gives the step of the task that is followed, and the followed task is not always the first: from four in the afternoon of the first day until seven the evening at
    // the teahouse takes the slip, with a walk to the teahouse for its step. At a pace of 10 that is under four seconds of the page's time, which a machine that is slow from one step of
    // this test to the next lands in. At a pace of 1 the clock reaches four after two minutes.
    await startGame(lantern, "pace=1");
    // As it was: the card says what to do next and has the button that does it.
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
    await expect(page.getByTestId("task-do")).toBeVisible();
    await expect(page.getByTestId("task-next")).toBeVisible();
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    // The brief guidance, from the menu.
    await lantern.openMenu();
    await page.getByTestId("guidance-brief").click();
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    await expect(page.getByTestId("task-text")).not.toHaveText("");
    // The brief guidance still gives the reasons (behind the line of "Why") and the time and place.
    await page.getByTestId("slip-why").locator("summary").click();
    await expect(page.getByTestId("task-why")).toBeVisible();
    await expect(page.getByTestId("task-window")).toBeVisible();
    await expect(page.getByTestId("topbar-task-text")).not.toHaveText("");
    // The card of Granny Li has no button for the task either, and the button that talks to her is there.
    await page.evaluate(() => window.__lantern.play.onFocus?.("li_laotai"));
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "li_laotai");
    await expect(page.getByTestId("person-task")).toHaveCount(0);
    await expect(page.getByTestId("card-talk")).toBeVisible();
    // The elder: the third level has the button.
    await page.getByTestId("btn-elder").click();
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-do")).toBeVisible();
    await expect(page.getByTestId("elder-do")).toHaveAttribute("data-verb", /ask|entrust|talk/);
    await page.getByTestId("elder-do").click();
    await expect(page.getByTestId("elder")).toHaveCount(0);
    // The step is taken: the page walks the manager up to Granny Li, or talks to her at once. A talk can open and be ended by her change of routine between two looks at the
    // page, so a look that finds neither reads what the host has applied: the talk she was asked for is in its record all the same.
    await expect
      .poll(
        async () => {
          const now = await page.evaluate(() => window.__lantern.play.state.approach?.npc ?? window.__lantern.play.state.talk?.npc ?? null);
          if (now !== null) return now;
          return (await appliedActions(lantern)).some((action) => action.type === "talk" && action.npc === "li_laotai") ? "li_laotai" : null;
        },
        { timeout: 60_000 },
      )
      .toBe("li_laotai");
    expect(lantern.pageErrors).toEqual([]);
  });
});
