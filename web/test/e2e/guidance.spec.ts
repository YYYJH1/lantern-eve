import type { Page } from "@playwright/test";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

// How much the task card does for the player: the full guidance as it was, and the brief one, which names the goal, why, what is in
// the way and the time and place, and leaves the next step and its button to the clan elder. On a page of fake frames, with the world held.
test.use({ map: true });

/** The first day with the help on, the task of the bamboo blocked, and what is true taken as the start. */
async function guided(lantern: LanternPage, extras: Record<string, unknown> = {}, query = fake.GUIDED): Promise<void> {
  await fake.openFirstDay(lantern, { notebook: [], commitments: [], ...extras }, query);
  await fake.primeHelp(lantern.page);
}

const choose = async (lantern: LanternPage, guidance: "full" | "brief"): Promise<void> => {
  await lantern.openMenu();
  await lantern.page.getByTestId(`guidance-${guidance}`).click();
  await lantern.page.getByTestId("menu-close").click();
};

const card = (page: Page) => page.getByTestId("task-card");

test.describe("the full guidance", () => {
  test("is as it was: the next step and the button that does it on the slip, and nothing at the foot of the page while nobody speaks", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await expect(card(page).getByTestId("task-text")).toHaveText("The Li family will not give bamboo");
    await expect(card(page).getByTestId("task-why")).toContainText("Li Er broke the bridge");
    await expect(card(page).getByTestId("task-next")).toHaveText("Find out where that talk came from");
    await expect(card(page).getByTestId("task-blocker")).toContainText("Granny Li will not lend bamboo");
    await expect(card(page).getByTestId("task-window")).toContainText("Li Family House");
    await expect(page.getByTestId("task-do")).toHaveText("Talk to Granny Li");
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    await lantern.openMenu();
    await expect(page.getByTestId("menu-guidance")).toBeVisible();
    await expect(page.getByTestId("guidance-switch")).toHaveAttribute("data-guidance", "full");
    await expect(page.getByTestId("guidance-full")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("guidance-brief")).toHaveAttribute("aria-pressed", "false");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the brief guidance", () => {
  test("names the goal, why, what is in the way and the time and place, and leaves out the next step and its button, on the slip", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await choose(lantern, "brief");
    await expect(card(page).getByTestId("task-text")).toHaveText("The Li family will not give bamboo");
    await expect(page.getByTestId("topbar-task-text")).toHaveText("The Li family will not give bamboo");
    await expect(card(page).getByTestId("task-why")).toContainText("Li Er broke the bridge");
    await expect(card(page).getByTestId("task-blocker")).toContainText("Granny Li will not lend bamboo");
    await expect(card(page).getByTestId("task-window")).toHaveText("Li Family House, 08:00 to 17:00");
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    // Nothing is said at the foot of the page, and so there is no next step there.
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    // The other tasks can still be followed: that is a choice of goal and not a step.
    await expect(page.getByTestId("task-more")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("lantern.guidance"))).toBe("brief");
    // In Chinese too.
    await lantern.setLang("zh");
    await expect(card(page).getByTestId("task-text")).toHaveText("李家不肯给竹料");
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says nothing at the foot of the page when no task is followed, as the full guidance does", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await choose(lantern, "brief");
    await fake.feedFrame(page, { tasks: [], tracked: null });
    await expect(page.getByTestId("dialogue-line")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is kept per browser: a page that is opened again has it, and the full one comes back with the choice", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await choose(lantern, "brief");
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await guided(lantern);
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    await lantern.openMenu();
    await expect(page.getByTestId("guidance-brief")).toHaveAttribute("aria-pressed", "true");
    await page.getByTestId("guidance-full").click();
    await page.getByTestId("menu-close").click();
    await expect(page.getByTestId("task-do")).toHaveText("Talk to Granny Li");
    await expect(page.getByTestId("task-next")).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("lantern.guidance"))).toBe("full");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("leaves out the buttons of the tasks on the card of a person too, and keeps the button that talks to them", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await page.evaluate(() => window.__lantern.play.onFocus?.("zhou_huoji"));
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "zhou_huoji");
    await expect(page.getByTestId("person-task")).toHaveCount(1);
    await choose(lantern, "brief");
    await expect(page.getByTestId("person-card")).toBeVisible();
    await expect(page.getByTestId("person-task")).toHaveCount(0);
    await expect(page.getByTestId("card-talk")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("leaves out the button of the task that asks for the statement too, and the card of the statement is still one click away", async ({ lantern }) => {
    const page = lantern.page;
    const task = {
      id: "t_state",
      kind: "need",
      job: "truth",
      text: { zh: "把桥的事当众说清", en: "Tell the town how the bridge broke" },
      why: { zh: "三栏还没填满", en: "The card is not filled in" },
      next: { zh: "把陈述卡填好", en: "Fill in the card" },
      state: "open",
      blocker: null,
      action: { verb: "state" },
      window: null,
    };
    await guided(lantern, { statement: stmt.statementKey(), tracked: "t_state", tasks: [task] });
    await expect(page.getByTestId("task-do")).toHaveText("Fill in the statement card");
    await choose(lantern, "brief");
    await expect(card(page).getByTestId("task-text")).toHaveText("Tell the town how the bridge broke");
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    await page.getByTestId("btn-notebook").click();
    await page.getByTestId("workspace-tab-statement").click();
    await expect(page.getByTestId("statement-card")).toBeVisible();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says what the hint of a blocked task says in words that do not point at a next step", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, fake.tasksWhere({ t_bamboo_first: "open" }));
    await choose(lantern, "brief");
    await fake.feedFrame(page, fake.tasks("t_bamboo_first"));
    await expect(page.getByTestId("hint-pill")).toHaveAttribute("data-hint", "blocked");
    await expect(page.getByTestId("hint-pill")).toHaveText("Something is in the way. The note of the slip says what, and why.");
    await expect(card(page)).toHaveClass(/is-signal/);
    await lantern.setLang("zh");
    await expect(page.getByTestId("hint-pill")).toHaveText("有东西挡了路。签的便笺里写着是什么拦着，以及缘由。");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("does not change a page that has no help: the card is as it was", async ({ lantern }) => {
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.guidance", "brief"));
    await fake.openFirstDay(lantern, {});
    await expect(page.getByTestId("task-do")).toHaveText("Talk to Granny Li");
    await expect(page.getByTestId("task-next")).toBeVisible();
    await lantern.openMenu();
    await expect(page.getByTestId("menu-help")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the elder gives the button", () => {
  test("with the third level, when asked, and a click on it puts his card away and takes the step", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern, { notebook: [] });
    await choose(lantern, "brief");
    await fake.recordSent(page);
    await page.getByTestId("btn-elder").click();
    await page.getByTestId("elder-level-1").click();
    await expect(page.getByTestId("elder-text")).toHaveText("Think about this: Find out where that talk came from");
    await expect(page.getByTestId("elder-do")).toHaveCount(0);
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-answer-3").getByTestId("elder-text")).toHaveText("Your next step: Talk to Granny Li");
    await expect(page.getByTestId("elder-do")).toHaveText("Talk to Granny Li");
    await page.getByTestId("elder-do").click();
    await expect(page.getByTestId("elder")).toHaveCount(0);
    // Granny Li is not in reach, so the page walks to her; it asks the core to move the manager.
    await expect.poll(async () => (await fake.sentSoFar(page)).map((body) => body.type)).toContain("move");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("with the third level when he comes by after a stall, and not with the full guidance, which has the button on the card", async ({ lantern }) => {
    const page = lantern.page;
    const STILL = 600;
    await guided(lantern);
    // Full: the third level is words, and the button is on the card.
    await page.getByTestId("btn-elder").click();
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-answer-3")).toBeVisible();
    await expect(page.getByTestId("elder-do")).toHaveCount(0);
    await page.getByTestId("elder-close").click();
    // Brief: nothing moves for a while, he comes by, and the third level he gives has the button.
    await choose(lantern, "brief");
    await fake.feedAt(page, 1000, { notebook: fake.notebook().slice(0, 1) });
    await fake.feedAt(page, 1000 + STILL);
    await expect(page.getByTestId("elder")).toHaveAttribute("data-visit", "true");
    await expect(page.getByTestId("elder-do")).toHaveCount(0);
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-do")).toHaveText("Talk to Granny Li");
    await page.getByTestId("elder-close").click();
    // The third visit gives it without being asked. (The host sends a frame of its own when the card is put away, and that moves the story, so the
    // visits are counted anew here: two have been made.)
    await fake.feedAt(page, 5000, { notebook: fake.notebook().slice(0, 2) });
    await page.evaluate(() => {
      window.__lantern.play.guide.stall.visits = 2;
    });
    await fake.feedAt(page, 5000 + STILL);
    await expect(page.getByTestId("elder")).toHaveAttribute("data-visit", "true");
    await expect(page.getByTestId("elder-answer-3")).toBeVisible();
    await expect(page.getByTestId("elder-do")).toBeVisible();
    // Nothing left to follow: the elder says so, and there is no step to take.
    await page.getByTestId("elder-close").click();
    await fake.feedFrame(page, { tasks: [], tracked: null, board: fake.boardKey() });
    await page.getByTestId("btn-elder").click();
    await page.getByTestId("elder-level-3").click();
    await expect(page.getByTestId("elder-do")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the choice", () => {
  test("is in the menu with its words in both languages, and a click on it is kept", async ({ lantern }) => {
    const page = lantern.page;
    await guided(lantern);
    await lantern.openMenu();
    const group = page.getByTestId("menu-guidance");
    await expect(group.locator("strong")).toHaveText("Guidance");
    await expect(page.getByTestId("guidance-full")).toHaveText("Full");
    await expect(page.getByTestId("guidance-brief")).toHaveText("Brief");
    await expect(group).toContainText("Brief: the note gives only the goal");
    await lantern.setLang("zh");
    await expect(group.locator("strong")).toHaveText("指引");
    await expect(page.getByTestId("guidance-full")).toHaveText("完整");
    await expect(page.getByTestId("guidance-brief")).toHaveText("简略");
    await page.getByTestId("guidance-brief").click();
    await expect(page.getByTestId("guidance-switch")).toHaveAttribute("data-guidance", "brief");
    await expect(page.getByTestId("guidance-brief")).toHaveAttribute("aria-pressed", "true");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      // The buttons change their colours over a moment.
      await expect.poll(() => fake.contrast(page, '[data-testid="guidance-brief"]'), { message: `${theme} on` }).toBeGreaterThan(4.5);
      await expect.poll(() => fake.contrast(page, '[data-testid="guidance-full"]'), { message: `${theme} off` }).toBeGreaterThan(4.5);
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is offered at the last step of the tutorial, which teaches with the full guidance, and takes hold when the card is put away", async ({ lantern }) => {
    const page = lantern.page;
    await page.addInitScript(() => localStorage.setItem("lantern.guidance", "brief"));
    await guided(lantern);
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await fake.beginTutorial(page);
    // While the tutorial is on, the task card is the full one, whatever was chosen.
    await expect(page.getByTestId("task-do")).toBeVisible();
    await expect(page.getByTestId("task-next")).toBeVisible();
    await page.evaluate(() => {
      const tutorial = window.__lantern.play.guide.tutorial;
      tutorial.index = 5;
      tutorial.phase = "card";
      window.__lantern.play.touch();
    });
    const evening = page.getByTestId("tutorial-card");
    await expect(evening).toHaveAttribute("data-step", "evening");
    const choice = page.getByTestId("tut-guidance");
    await expect(choice).toContainText("From here on, you choose how much the slip does for you.");
    await expect(choice.getByTestId("guidance-brief")).toHaveAttribute("aria-pressed", "true");
    await choice.getByTestId("guidance-full").click();
    await expect(choice.getByTestId("guidance-full")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => localStorage.getItem("lantern.guidance"))).toBe("full");
    await choice.getByTestId("guidance-brief").click();
    await expect(choice.getByTestId("guidance-brief")).toHaveAttribute("aria-pressed", "true");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await expect.poll(() => fake.contrast(page, '[data-testid="tut-guidance"] [data-testid="guidance-brief"]'), { message: `${theme} on` }).toBeGreaterThan(4.5);
      await expect.poll(() => fake.contrast(page, '[data-testid="tut-guidance"] [data-testid="guidance-full"]'), { message: `${theme} off` }).toBeGreaterThan(4.5);
      await expect.poll(() => fake.contrast(page, ".tut-guidance-help"), { message: `${theme} help` }).toBeGreaterThan(4.5);
    }
    await lantern.setTheme("light");
    // Putting the card away ends the tutorial, and the choice takes hold.
    await page.getByTestId("tutorial-next").click();
    await expect(evening).toHaveCount(0);
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(page.getByTestId("task-next")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

});
