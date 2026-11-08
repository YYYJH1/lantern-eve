import { expect, test } from "../support/fixtures.ts";
import { startGame } from "../support/real.ts";

// The brief guidance on the real first day of the slice, from the opening page: the task card names the goal and what is in the way and has no button, and
// the clan elder gives the button with his third level, which walks the manager to Granny Li.
test.use({ map: true });

test.describe("the brief guidance on the real core", () => {
  test("leaves the next step to the elder: no button on the card, the third level has it, and it takes the step", async ({ lantern }) => {
    test.setTimeout(240_000);
    const page = lantern.page;
    await startGame(lantern, "pace=10");
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
    // The step is taken: the page walks the manager up to Granny Li, or talks to her at once.
    await expect.poll(() => page.evaluate(() => window.__lantern.play.state.approach?.npc ?? window.__lantern.play.state.talk?.npc ?? null), { timeout: 60_000 }).toBe("li_laotai");
    expect(lantern.pageErrors).toEqual([]);
  });
});
