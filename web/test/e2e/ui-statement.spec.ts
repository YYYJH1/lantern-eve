import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

// The statement card on the page, on fake frames that follow the key `statement` of the frame: a second page of the notebook beside the
// notes (a tab of its own), opened from the notebook, from the board and from a task; a choice in each of the three parts, the marks for and against each option and the notes behind them; the button that makes the
// full statement, the question that comes first and the result in the panel of a clarification. What the page sends is recorded and not
// passed on, so that a test answers it as it likes. The map is not drawn here.

type Lantern = Parameters<typeof fake.openFirstDay>[0];

/** The first day with this card in the frame and what the page sends recorded. The notebook is shut. */
async function open(lantern: Lantern, statement: Record<string, unknown> | null = stmt.statementKey(), extras: Record<string, unknown> = {}): Promise<Page> {
  await fake.openFirstDay(lantern, statement === null ? extras : { statement, ...extras });
  await fake.recordSent(lantern.page);
  return lantern.page;
}

/** Opens the notebook and turns to the card. */
async function turnToCard(page: Page): Promise<void> {
  await page.getByTestId("btn-notebook").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  await page.getByTestId("workspace-tab-statement").click();
  await expect(page.getByTestId("statement-card")).toBeVisible();
}

const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);
const ackOf = (id: string, result: "applied" | "rejected" = "applied", reason: string | null = null) => ({ kind: "action_ack", tick: 8, action_id: id, result, reason });
const sentOf = async (page: Page, type: string): Promise<Array<Record<string, unknown>>> => (await fake.sentSoFar(page)).filter((s) => s.type === type);

/** A list of tasks with one, followed, whose button does `action`. */
function taskWith(action: Record<string, unknown>): Record<string, unknown> {
  return {
    tracked: "t_state",
    tasks: [{ id: "t_state", kind: "need", job: "truth", text: { zh: "把桥的事当众说清", en: "Tell the town how the bridge broke" }, why: null, next: null, state: "open", blocker: null, action, window: null }],
  };
}

test.describe("the card as a page of the notebook", () => {
  test("is the right page of the book, beside the notes, with a title for each page and the choices made counted on its title", async ({ lantern }) => {
    const page = await open(lantern);
    await page.getByTestId("btn-notebook").click();
    const book = page.getByTestId("notebook");
    await expect(book).toHaveAttribute("data-open", "true");
    await expect(book).toHaveAttribute("data-part", "notes");
    await expect(page.getByTestId("workspace-tab-notes")).toHaveText("Notes4");
    await expect(page.getByTestId("workspace-tab-notes")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("workspace-tab-statement")).toHaveText("Statement card0/3");
    await expect(page.getByTestId("workspace-tab-statement")).toHaveAttribute("aria-selected", "false");
    // A wide screen has the book open at both pages: the notes on the left, the card on the right, the thread between.
    await expect(page.getByTestId("note")).toHaveCount(4);
    await expect(page.getByTestId("statement-card")).toBeVisible();
    const left = await page.getByTestId("notes-leaf").boundingBox();
    const right = await page.getByTestId("workspace-statement").boundingBox();
    if (left === null || right === null) throw new Error("no box");
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
    expect(Math.abs(left.y - right.y)).toBeLessThan(2);
    await expect(page.getByTestId("notebook-entries")).toHaveText("4 entries");
    await expect(page.getByTestId("statement-part")).toHaveCount(3);
    await expect(page.getByTestId("statement-part-title")).toHaveText(["How the bridge broke:", "What happened that night:", "Why people got it wrong:"]);
    // The titles say which page the player is at, and turn to the one they are given.
    await page.getByTestId("workspace-tab-statement").click();
    await expect(book).toHaveAttribute("data-part", "statement");
    await expect(page.getByTestId("workspace-tab-statement")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByTestId("statement-card")).toBeVisible();
    await page.getByTestId("workspace-tab-notes").click();
    await expect(book).toHaveAttribute("data-part", "notes");
    await expect(page.getByTestId("note")).toHaveCount(4);
    // A choice shows on the tab.
    await fake.feedFrame(page, { statement: stmt.statementKey({ cause: "c_boat", rumour: "u_made_up" }) });
    await expect(page.getByTestId("workspace-tab-statement")).toHaveText("Statement card2/3");
    await lantern.setLang("zh");
    await expect(page.getByTestId("workspace-tab-notes")).toHaveText("记下的事4");
    await expect(page.getByTestId("workspace-tab-statement")).toHaveText("讲稿2/3");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not there where the frame has no card: no tab for it, and the notes and the people as the only pages", async ({ lantern }) => {
    const page = await open(lantern, null);
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("workspace-tab-statement")).toHaveCount(0);
    await expect(page.getByTestId("workspace-tabs").getByRole("tab")).toHaveCount(2);
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-spread", "false");
    await expect(page.getByTestId("note")).toHaveCount(4);
    await expect(page.getByTestId("workspace-tab-notes")).toHaveText("Notes4");
    // The board has no button for it either.
    await page.getByTestId("notebook-close").click();
    await page.getByTestId("board-tab-truth").click();
    await expect(page.getByTestId("statement-open")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("stands in for the notes while it is up: the notebook button, Escape and the close button put away whichever page is turned to", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    await expect(page.getByTestId("btn-notebook")).toHaveAttribute("aria-expanded", "true");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "notes");
    await page.getByTestId("workspace-tab-statement").click();
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("holds the world still while it is up, as the notes do", async ({ lantern }) => {
    const page = await open(lantern);
    const holding = (): Promise<boolean> => page.evaluate(() => window.__lantern.play.hold.active);
    expect(await holding()).toBe(false);
    await turnToCard(page);
    await expect.poll(holding).toBe(true);
    // Turning back to the notes keeps it held, and putting the notebook away lets it go.
    await page.getByTestId("workspace-tab-notes").click();
    await expect.poll(holding).toBe(true);
    await page.getByTestId("workspace-tab-statement").click();
    await expect.poll(holding).toBe(true);
    await page.getByTestId("notebook-close").click();
    await expect.poll(holding).toBe(false);
  });
});

test.describe("opening the card", () => {
  test("from the board: the statement part has a button that opens it at the card, and says which parts have a choice", async ({ lantern }) => {
    const page = await open(lantern, stmt.statementKey({ cause: "c_boat" }), {
      board: fake.boardKey({
        statement: [
          { part: "cause", support: 3, against: 2, gap: false },
          { part: "course", support: 1, against: 0, gap: false },
          { part: "rumour", support: 2, against: 1, gap: false },
        ],
      }),
    });
    await page.getByTestId("board-tab-truth").click();
    const open_ = page.getByTestId("statement-open");
    await expect(open_).toHaveText("Open the statement card");
    await expect(open_).toHaveAttribute("data-chosen", "1");
    await expect(page.getByTestId("statement-column")).toHaveCount(3);
    await expect(page.getByTestId("statement-column").nth(0)).toHaveAttribute("data-chosen", "true");
    await expect(page.getByTestId("statement-column").nth(0)).toHaveAttribute("data-support", "3");
    await expect(page.getByTestId("statement-column").nth(0)).toHaveAttribute("data-against", "2");
    await expect(page.getByTestId("statement-column").nth(0).locator(".statement-picked")).toHaveCount(1);
    await expect(page.getByTestId("statement-column").nth(1)).toHaveAttribute("data-chosen", "false");
    await expect(page.getByTestId("statement-column").nth(1)).toHaveAttribute("data-support", "1");
    await expect(page.getByTestId("statement-column").nth(1)).toHaveAttribute("data-against", "0");
    await expect(page.getByTestId("statement-column").nth(1).locator(".statement-picked")).toHaveCount(0);
    await open_.click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "statement");
    await expect(page.getByTestId("statement-card")).toBeVisible();
    // The notebook has the place of the ledger while it is open. The ledger is turned to the truth again, in Chinese.
    await lantern.setLang("zh");
    await page.getByTestId("board-tab-truth").click();
    await expect(page.getByTestId("statement-open")).toHaveText("打开讲稿");
    await expect(page.getByTestId("statement-column").nth(0)).toContainText("怎么坏的");
    await expect(page.getByTestId("statement-column").nth(0)).toHaveAttribute("data-support", "3");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("from a task whose action is state: the button says so in both languages, and opens the card", async ({ lantern }) => {
    const page = await open(lantern, stmt.statementKey(), taskWith({ verb: "state" }));
    await expect(page.getByTestId("task-do")).toHaveText("Fill in the statement card");
    await expect(page.getByTestId("task-do")).toHaveAttribute("data-verb", "state");
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("去写讲稿");
    await lantern.setLang("en");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "statement");
    expect(await fake.sentSoFar(page)).toEqual([]);
  });

  test("from a task whose action is judge: the notebook opens at the notes, as it did, with the card a tab away", async ({ lantern }) => {
    const page = await open(lantern, stmt.statementKey(), taskWith({ verb: "judge" }));
    await expect(page.getByTestId("task-do")).toHaveText("Compare two lines in the notebook");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "notes");
    await expect(page.getByTestId("pairing")).toBeVisible();
    await expect(page.getByTestId("workspace-tab-statement")).toBeVisible();
    // The card was the page last turned to: judging the lines is about the notes all the same.
    await page.getByTestId("workspace-tab-statement").click();
    await page.getByTestId("notebook-close").click();
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "notes");
    await expect(page.getByTestId("pairing")).toBeVisible();
  });

  test("from a task that makes the statement: the card opens while a part has no choice, and where the manager stands once all have one", async ({ lantern }) => {
    const speak = { verb: "speak", kind: "statement" };
    const page = await open(lantern, stmt.statementKey({ cause: "c_boat" }), taskWith(speak));
    await expect(page.getByTestId("task-do")).toHaveText("Make the statement");
    await expect(page.getByTestId("task-do")).toHaveAttribute("data-verb", "speak");
    await lantern.setLang("zh");
    await expect(page.getByTestId("task-do")).toHaveText("照讲稿当众说");
    await lantern.setLang("en");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "statement");
    // Nothing was sent, and no list of what to say opened: the card is where it is made.
    expect(await fake.sentSoFar(page)).toEqual([]);
    await expect(page.getByTestId("picker-speak")).toHaveCount(0);
    await page.getByTestId("notebook-close").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "false");
    await fake.feedFrame(page, { statement: stmt.readyKey() });
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "statement");
    await expect(page.getByTestId("statement-state")).toBeEnabled();
    expect(await sentOf(page, "move")).toEqual([]);
  });
});

test.describe("choosing", () => {
  test("a click on an option sends the choice, and the next frame shows it chosen: no game time, and the world stays as it is", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    const cause = page.locator('[data-testid="statement-part"][data-part="cause"]');
    await expect(cause.getByTestId("statement-option")).toHaveCount(4);
    await expect(cause.getByTestId("statement-pick").first()).toHaveAttribute("aria-pressed", "false");
    await expect(cause.getByTestId("statement-clear")).toHaveCount(0);
    const tickBefore = await page.evaluate(() => window.__lantern.client.state.simTick);
    await cause.locator('[data-id="c_boat"]').getByTestId("statement-pick").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "choose", part: "cause", option: "c_boat" });
    // The choice is the core's: until a frame shows it, the card does not.
    await expect(cause.locator('[data-id="c_boat"]')).toHaveAttribute("data-chosen", "false");
    await fake.feedFrame(page, { statement: stmt.statementKey({ cause: "c_boat" }) }, [ackOf(await lastId(page))]);
    await expect(cause.locator('[data-id="c_boat"]')).toHaveAttribute("data-chosen", "true");
    await expect(cause.locator('[data-id="c_boat"]').getByTestId("statement-pick")).toHaveAttribute("aria-pressed", "true");
    await expect(cause.getByTestId("statement-chosen")).toHaveText("Chosen");
    await expect(cause).toHaveAttribute("data-chosen", "c_boat");
    await expect(page.getByTestId("workspace-statement-count")).toHaveText("1/3");
    expect(await page.evaluate(() => window.__lantern.client.state.simTick)).toBeGreaterThanOrEqual(tickBefore);
    expect(await page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
    // Only the one is chosen in a part: another option takes its place when the core says so.
    await cause.locator('[data-id="c_flood"]').getByTestId("statement-pick").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "choose", part: "cause", option: "c_flood" });
    await fake.feedFrame(page, { statement: stmt.statementKey({ cause: "c_flood" }) });
    await expect(cause.getByTestId("statement-chosen")).toHaveCount(1);
    await expect(cause.locator('[data-id="c_flood"]')).toHaveAttribute("data-chosen", "true");
    await expect(cause.locator('[data-id="c_boat"]')).toHaveAttribute("data-chosen", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("chooses in each part on its own, and takes a choice back with the button of the part or by a second click on the option", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    const part = (id: string) => page.locator(`[data-testid="statement-part"][data-part="${id}"]`);
    await part("course").locator('[data-id="r_night_boat"]').getByTestId("statement-pick").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "choose", part: "course", option: "r_night_boat" });
    await part("rumour").locator('[data-id="u_clerk_saw"]').getByTestId("statement-pick").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "choose", part: "rumour", option: "u_clerk_saw" });
    await fake.feedFrame(page, { statement: stmt.statementKey({ course: "r_night_boat", rumour: "u_clerk_saw" }) });
    await expect(part("course").getByTestId("statement-clear")).toHaveText("Clear");
    await expect(part("course").getByTestId("statement-clear")).toHaveAttribute("aria-label", "Clear the choice for What happened that night");
    await expect(part("cause").getByTestId("statement-clear")).toHaveCount(0);
    await expect(page.getByTestId("workspace-statement-count")).toHaveText("2/3");
    // The button of the part.
    await part("course").getByTestId("statement-clear").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "clear", part: "course" });
    // A second click on the option that is chosen.
    await part("rumour").locator('[data-id="u_clerk_saw"]').getByTestId("statement-pick").click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "clear", part: "rumour" });
    await fake.feedFrame(page, { statement: stmt.statementKey() });
    await expect(page.getByTestId("statement-chosen")).toHaveCount(0);
    await expect(page.getByTestId("workspace-statement-count")).toHaveText("0/3");
    expect((await sentOf(page, "statement")).map((s) => s.op)).toEqual(["choose", "choose", "clear", "clear"]);
  });

  test("tells where the core turned a choice down, under the button, in words", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    await page.locator('[data-id="c_boat"]').getByTestId("statement-pick").click();
    await fake.feedFrame(page, {}, [ackOf(await lastId(page), "rejected", "unknown_option")]);
    await expect(page.getByTestId("statement-no")).toHaveAttribute("data-reason", "unknown_option");
    await expect(page.getByTestId("statement-no")).toHaveAttribute("data-type", "statement");
    await expect(page.getByTestId("statement-no")).toHaveText("That is not one of the options.");
    // An option that no note bears on yet is not one to choose.
    await page.locator('[data-id="c_dalang"]').getByTestId("statement-pick").click();
    await fake.feedFrame(page, {}, [ackOf(await lastId(page), "rejected", "not_shown")]);
    await expect(page.getByTestId("statement-no")).toHaveText("Nothing in your notebook bears on that yet.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("statement-no")).toHaveText("见闻簿里还没有和这个说法有关的话。");
    await lantern.setLang("en");
    // The next choice clears it.
    await page.locator('[data-id="c_flood"]').getByTestId("statement-pick").click();
    await expect(page.getByTestId("statement-no")).toHaveCount(0);
  });
});

test.describe("what stands behind an option", () => {
  test("shows the notes for it and against it as two small marks, and says them in words for a reader that cannot see them", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    const option = (id: string) => page.locator(`[data-testid="statement-option"][data-id="${id}"]`);
    // The notes for are strokes of a tally, and the notes against a struck stroke with the number after it in figures.
    await expect(option("c_boat").getByTestId("statement-for")).toHaveAttribute("data-n", "2");
    await expect(option("c_boat").getByTestId("statement-for").locator(".tally-mark")).toHaveCount(1);
    await expect(option("c_boat").getByTestId("statement-against")).toHaveAttribute("data-n", "0");
    await expect(option("c_boat").getByTestId("statement-marks")).toHaveAttribute("aria-label", "2 for, 0 against");
    await expect(option("c_li_er").getByTestId("statement-for")).toHaveAttribute("data-n", "1");
    await expect(option("c_li_er").getByTestId("statement-against")).toHaveAttribute("data-n", "1");
    await expect(option("c_li_er").getByTestId("statement-against")).toHaveText("1");
    await expect(option("c_flood").getByTestId("statement-for")).toHaveClass(/is-zero/);
    await expect(option("c_flood").getByTestId("statement-against")).not.toHaveClass(/is-zero/);
    await expect(option("c_dalang").getByTestId("statement-for")).toHaveAttribute("data-n", "0");
    await expect(option("c_dalang").getByTestId("statement-marks")).toHaveAttribute("data-testid", "statement-marks");
    await expect(option("c_boat")).toHaveAttribute("data-support", "2");
    await lantern.setLang("zh");
    await expect(option("c_boat").getByTestId("statement-marks")).toHaveAttribute("aria-label", "两条对得上，零条对不上");
    await expect(option("c_boat").getByTestId("statement-pick")).toContainText("船夫老何夜里撑船，船头撞断了栏杆");
  });

  test("keeps the notes behind the counts on demand: a line each, and a click on one opens the notebook at that note", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    const boat = page.locator('[data-testid="statement-option"][data-id="c_boat"]');
    const notes = boat.getByTestId("statement-notes");
    await expect(notes.locator("summary")).toHaveText("What it rests on (2)");
    await expect(notes).not.toHaveAttribute("open", "");
    await expect(boat.getByTestId("statement-entry").first()).toBeHidden();
    await notes.locator("summary").click();
    await expect(boat.getByTestId("statement-entry")).toHaveText(["The boat has fresh scratches.", "Boatman He was at the river under the bridge last night."]);
    // An option no note bears on has no list.
    await expect(page.locator('[data-testid="statement-option"][data-id="c_dalang"]').getByTestId("statement-notes")).toHaveCount(0);
    await boat.locator('[data-id="n_boat"]').click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "notes");
    const note = page.locator('[data-testid="note"][data-id="n_boat"]');
    await expect(note).toHaveAttribute("data-pointed", "true");
    await expect(note).toBeInViewport();
    // The mark goes after a few seconds.
    await expect(note).toHaveAttribute("data-pointed", "false", { timeout: 6000 });
    // And the card is a tab away, with its choices as they were.
    await page.getByTestId("workspace-tab-statement").click();
    await expect(page.getByTestId("statement-card")).toBeVisible();
    await lantern.setLang("zh");
    await expect(page.locator('[data-testid="statement-option"][data-id="c_boat"]').getByTestId("statement-notes").locator("summary")).toHaveText("凭这两条");
  });

  test("leaves out a note the notebook does not have, and lists none where none of them are there", async ({ lantern }) => {
    const parts = stmt.partsOf();
    const cause = parts[0] as { options: Array<Record<string, unknown>> };
    cause.options[0] = { ...cause.options[0], entries: ["n_boat", "n_gone"], support: 2 };
    cause.options[1] = { ...cause.options[1], entries: ["n_gone"], support: 0, against: 1 };
    const page = await open(lantern, stmt.statementKey({}, { parts }));
    await turnToCard(page);
    const boat = page.locator('[data-testid="statement-option"][data-id="c_boat"]');
    await boat.getByTestId("statement-notes").locator("summary").click();
    await expect(boat.getByTestId("statement-entry")).toHaveText(["Boatman He was at the river under the bridge last night."]);
    await expect(page.locator('[data-testid="statement-option"][data-id="c_flood"]').getByTestId("statement-notes")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says that nothing held bears on a part, and what is left to choose from; a part the frame leaves out is empty", async ({ lantern }) => {
    const page = await open(lantern, stmt.statementKey({}, { parts: stmt.partsOf({}, ["course"]).filter((p) => p.part !== "rumour") }));
    await turnToCard(page);
    const part = (id: string) => page.locator(`[data-testid="statement-part"][data-part="${id}"]`);
    await expect(part("course")).toHaveAttribute("data-gap", "true");
    await expect(part("course").getByTestId("statement-gap")).toHaveText("Nothing in your notebook bears on this part yet.");
    // The options are still there to choose from, with nothing behind them.
    await expect(part("course").getByTestId("statement-option")).toHaveCount(3);
    await expect(part("course").getByTestId("statement-notes")).toHaveCount(0);
    await expect(part("cause")).toHaveAttribute("data-gap", "false");
    await expect(part("cause").getByTestId("statement-gap")).toHaveCount(0);
    // The part the frame leaves out is there, empty, with the page's own name for it.
    await expect(part("rumour")).toHaveAttribute("data-gap", "true");
    await expect(part("rumour").getByTestId("statement-part-title")).toHaveText("Why people got it wrong:");
    await expect(part("rumour").getByTestId("statement-option")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(part("course").getByTestId("statement-gap")).toHaveText("见闻簿里还没有和这一条有关的话。");
    await expect(part("rumour").getByTestId("statement-part-title")).toHaveText("大家为什么会误会：");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("making the statement", () => {
  test("is off until the core says it can be made, and says why not in the core's words, in both languages", async ({ lantern }) => {
    const page = await open(lantern);
    await turnToCard(page);
    const button = page.getByTestId("statement-state");
    await expect(button).toHaveText("Make the statement");
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("data-state", "core");
    await expect(page.getByTestId("statement-why")).toHaveText(stmt.WHY_NOT.en);
    await expect(button).toHaveAttribute("aria-describedby", "statement-why");
    await lantern.setLang("zh");
    await expect(button).toHaveText("照讲稿当众说");
    await expect(page.getByTestId("statement-why")).toHaveText(stmt.WHY_NOT.zh);
    await lantern.setLang("en");
    // The core says yes: the button is on, and the reason is gone.
    await fake.feedFrame(page, { statement: stmt.readyKey() });
    await expect(button).toBeEnabled();
    await expect(page.getByTestId("statement-why")).toHaveCount(0);
    // Today's is made, and the core gives no other reason.
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, used_today: true }) });
    await expect(button).toBeDisabled();
    await expect(button).toHaveAttribute("data-state", "used");
    await expect(page.getByTestId("statement-why")).toHaveText("You have made your statement today.");
    await lantern.setLang("zh");
    await expect(page.getByTestId("statement-why")).toHaveText("今天已经照讲稿说过一回了。");
    await lantern.setLang("en");
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, why_not: null, used_today: false }) });
    await expect(page.getByTestId("statement-why")).toHaveText("You cannot make the statement now.");
    expect(await sentOf(page, "speak")).toEqual([]);
  });

  test("asks first, with the choices read back, and sends nothing until the manager says yes", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    const box = page.getByTestId("statement-confirm-box");
    await expect(box).toBeVisible();
    await expect(box.locator("h4")).toHaveText("Make the statement now?");
    await expect(page.getByTestId("statement-recap").locator("li")).toHaveText([
      "How the bridge broke: Boatman He's boat struck the railing in the night",
      "What happened that night: Boatman He poled under the bridge in the night and the bow struck the railing. Afterwards the boatman quietly mended the boat",
      "Why people got it wrong: Zhou's Clerk only saw Li Er at the bridge looking for a lantern. Shopkeeper Zhou, holding an old grudge, guessed that Li Er broke the railing. The story grew as it went round and picked up “on purpose” and “envy”",
    ]);
    await expect(box).toContainText("The statement can be made only once a day. A part that does not hold costs you trust with the people there.");
    await expect(page.getByTestId("statement-state")).toHaveCount(0);
    expect(await sentOf(page, "speak")).toEqual([]);
    // The safe answer has the keyboard.
    await expect(page.getByTestId("statement-cancel")).toBeFocused();
    await page.getByTestId("statement-cancel").click();
    await expect(box).toHaveCount(0);
    await expect(page.getByTestId("statement-state")).toBeEnabled();
    expect(await sentOf(page, "speak")).toEqual([]);
    await lantern.setLang("zh");
    await page.getByTestId("statement-state").click();
    await expect(box.locator("h4")).toHaveText("现在就照讲稿当众说吗？");
    await expect(page.getByTestId("statement-recap").locator("li").first()).toHaveText("桥是怎么坏的：船夫老何夜里撑船，船头撞断了栏杆");
    await expect(page.getByTestId("statement-confirm")).toContainText("就这么说");
    await expect(page.getByTestId("statement-cancel")).toHaveText("再想想");
    await expect(box).toContainText("讲稿一天只能拿出来说一回。哪一条站不住，在场的人就少信你几分。");
  });

  test("writes no minutes of the speech on the button or on the yes", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await expect(page.getByTestId("statement-state")).toHaveText("Make the statement");
    await expect(page.locator('[data-testid^="cost-"]')).toHaveCount(0);
    await page.getByTestId("statement-state").click();
    await expect(page.getByTestId("statement-confirm")).toBeVisible();
    await expect(page.locator('[data-testid^="cost-"]')).toHaveCount(0);
  });

  test("goes back to the button when the statement can no longer be made while it is being asked", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    await expect(page.getByTestId("statement-confirm-box")).toBeVisible();
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, why_not: stmt.WHY_USED, used_today: true }) });
    await expect(page.getByTestId("statement-confirm-box")).toHaveCount(0);
    await expect(page.getByTestId("statement-state")).toBeDisabled();
    await expect(page.getByTestId("statement-why")).toHaveText(stmt.WHY_USED.en);
  });

  test("makes the statement on a yes: sent as the speech of the kind statement, once, and the button waits for the core", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    await page.getByTestId("statement-confirm").click();
    expect((await sentOf(page, "speak")).length).toBe(1);
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "statement" });
    expect((await fake.sentSoFar(page)).at(-1)).not.toHaveProperty("part");
    const button = page.getByTestId("statement-state");
    await expect(button).toBeDisabled();
    await expect(button).toHaveText("Speaking…");
    await expect(button).toHaveAttribute("data-state", "waiting");
    await expect(page.getByTestId("statement-confirm-box")).toHaveCount(0);
    await expect(page.getByTestId("clarify")).toHaveCount(0);
  });

  test("shows the result in the panel of a clarification: whether it carried, the part that did not hold and why above the people, and who took it in", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    await page.getByTestId("statement-confirm").click();
    const id = await lastId(page);
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, why_not: stmt.WHY_USED, used_today: true, last: stmt.LAST_WRONG }) }, [ackOf(id), stmt.spokeEvent()]);
    const panel = page.getByTestId("clarify");
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-kind", "statement");
    await expect(panel.locator(".sheet-title")).toHaveText("How the statement went");
    await expect(page.getByTestId("stated-result")).toHaveText("It did not carry.");
    await expect(page.getByTestId("stated-verdict")).toHaveAttribute("data-told", "false");
    await expect(page.getByTestId("stated-wrong")).toHaveText("Did not hold: How the bridge broke");
    await expect(page.getByTestId("stated-why")).toHaveText("Why: The part “How the bridge broke” goes against what Boatman He saw with their own eyes.");
    await expect(page.getByTestId("stated-line")).toHaveText("Day 4 18:00, Teahouse: 7 there, 6 believed it (86%), the elder believed it");
    // The people, one by one, with where they stood and why: the panel of a clarification, below the verdict.
    await expect(page.getByTestId("hearer")).toHaveCount(4);
    await expect(page.getByTestId("hearer").first()).toHaveAttribute("data-npc", "zhou_huoji");
    await expect(page.getByTestId("hearer").first()).toHaveAttribute("data-changed", "true");
    await expect(page.getByTestId("hearer-reason").first()).toHaveText("I only saw him by the bridge. I did not see him touch it.");
    await expect(page.getByTestId("clarify-sum")).toHaveText("2 of 4 changed their minds.");
    const verdict = await page.getByTestId("stated-verdict").boundingBox();
    const hearers = await page.getByTestId("hearers").boundingBox();
    if (verdict === null || hearers === null) throw new Error("no box");
    expect(verdict.y + verdict.height).toBeLessThanOrEqual(hearers.y + 1);
    // The panel is the only sheet over the map: no clarification, no recap.
    await expect(page.getByTestId("recap")).toHaveCount(0);
    expect(await sentOf(page, "speak")).toHaveLength(1);
    // The card shows what was made of it as well, after the panel is put away.
    await page.getByTestId("clarify-done").click();
    await expect(panel).toHaveCount(0);
    await expect(page.getByTestId("statement-last")).toHaveAttribute("data-told", "false");
    await expect(page.getByTestId("statement-last-line")).toHaveText("Day 4 18:00, Teahouse: 7 there, 6 believed it (86%), the elder believed it");
    await expect(page.getByTestId("statement-wrong")).toHaveText("Did not hold: How the bridge broke");
    await expect(page.getByTestId("statement-reason")).toHaveText("Why: The part “How the bridge broke” goes against what Boatman He saw with their own eyes.");
    await expect(page.getByTestId("statement-state")).toBeDisabled();
    await expect(page.getByTestId("statement-why")).toHaveText(stmt.WHY_USED.en);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says it in Chinese as well, and shows a statement that told the truth with no part that did not hold", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await lantern.setLang("zh");
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    await page.getByTestId("statement-confirm").click();
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, why_not: stmt.WHY_USED, used_today: true, last: stmt.LAST_TOLD }) }, [ackOf(await lastId(page)), stmt.spokeEvent(stmt.LAST_TOLD)]);
    const panel = page.getByTestId("clarify");
    await expect(panel.locator(".sheet-title")).toHaveText("当众说的结果");
    await expect(page.getByTestId("stated-result")).toHaveText("你当众把这件事说清了。");
    await expect(page.getByTestId("stated-verdict")).toHaveAttribute("data-told", "true");
    await expect(page.getByTestId("stated-wrong")).toHaveCount(0);
    await expect(page.getByTestId("stated-why")).toHaveCount(0);
    await expect(page.getByTestId("stated-line")).toHaveText("第五天 18:00在茶馆，到场八人，七人信了，占88%，族长信了");
    // A statement with parts that did not hold, in Chinese.
    await page.getByTestId("clarify-done").click();
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, used_today: true, last: { ...stmt.LAST_WRONG, wrong: ["cause", "rumour"], why: { zh: "传走样了", en: "The sources do not match" } } }) });
    await expect(page.getByTestId("statement-wrong")).toHaveText("没站住的：桥是怎么坏的、大家为什么会误会");
    await expect(page.getByTestId("statement-reason")).toHaveText("因为传走样了");
  });

  test("shows the result of a statement when the core does not say who stood where: the verdict and the numbers, no list of people", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    await page.getByTestId("statement-confirm").click();
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, used_today: true, last: stmt.LAST_WRONG }) }, [ackOf(await lastId(page))]);
    await expect(page.getByTestId("stated-result")).toHaveText("It did not carry.");
    await expect(page.getByTestId("stated-line")).toContainText("7 there, 6 believed it (86%)");
    await expect(page.getByTestId("hearers")).toHaveCount(0);
    await expect(page.getByTestId("clarify-empty")).toHaveCount(0);
    await expect(page.getByTestId("clarify-done")).toBeVisible();
  });

  test("says in words each reason the core gives for turning the statement down", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    const reasons: Array<[string, string, string]> = [
      ["incomplete", "The three parts of the card are not all filled in.", "讲稿的三条还没写全。"],
      ["stated_today", "You have made your statement today already.", "今天已经照讲稿说过一回了。"],
      ["too_early", "The statement has to wait for the evening of the fourth day.", "要等第四天傍晚，才能照讲稿当众说。"],
      ["few_present", "There are too few people here to witness it.", "在场的人太少，作不了见证。"],
      ["talking", "You are still talking with someone. Leave first.", "你还在和人说话，先告辞吧。"],
    ];
    for (const [reason, en, zh] of reasons) {
      await page.getByTestId("statement-state").click();
      await page.getByTestId("statement-confirm").click();
      await fake.feedFrame(page, {}, [ackOf(await lastId(page), "rejected", reason)]);
      await expect(page.getByTestId("statement-no")).toHaveAttribute("data-reason", reason);
      await expect(page.getByTestId("statement-no")).toHaveAttribute("data-type", "speak");
      await expect(page.getByTestId("statement-no")).toHaveText(en);
      await lantern.setLang("zh");
      await expect(page.getByTestId("statement-no")).toHaveText(zh);
      await lantern.setLang("en");
    }
  });

  test("is made from the list of what to say in public as well as from the button: the offer of the full statement opens the card and sends nothing", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    const offers = [...fake.SPEAK_OFFERS, { id: "statement", label: { zh: "照讲稿当众说", en: "Make the statement" }, body: { kind: "statement" } }];
    const frame = fake.speakingFrame(await fake.playerOf(page));
    await fake.feedFrame(page, { ...frame, player: { ...(frame.player as Record<string, unknown>), offers: { entrust: [], promise: [], tell: [], speak: offers } } });
    await page.getByTestId("verb-speak").click();
    await expect(page.getByTestId("picker-speak").getByTestId("picker-option")).toHaveText(["Show everything you hold", "Show: fresh scrapes on the bridge pier", "Lay a table for peace", "Make the statement"]);
    await page.locator('[data-testid="picker-option"][data-id="statement"]').click();
    await expect(page.getByTestId("picker-speak")).toHaveCount(0);
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-part", "statement");
    expect(await sentOf(page, "speak")).toEqual([]);
    // The other offers are sent as they were.
    await page.getByTestId("notebook-close").click();
    await page.getByTestId("verb-speak").click();
    await page.locator('[data-testid="picker-option"][data-id="meal"]').click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "speak", kind: "meal" });
  });

  test("tells where the core turned the statement down, with the reason in words, and lets the manager ask again", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    await page.getByTestId("statement-confirm").click();
    await fake.feedFrame(page, {}, [ackOf(await lastId(page), "rejected", "no_venue")]);
    await expect(page.getByTestId("statement-no")).toHaveAttribute("data-reason", "no_venue");
    await expect(page.getByTestId("statement-no")).toHaveText("Not here. Speak at the teahouse in the evening, or at the hall when the clan is called.");
    await expect(page.getByTestId("statement-state")).toBeEnabled();
    await expect(page.getByTestId("clarify")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(page.getByTestId("statement-no")).toContainText("傍晚");
    await page.getByTestId("statement-state").click();
    await expect(page.getByTestId("statement-no")).toHaveCount(0);
    await expect(page.getByTestId("statement-confirm-box")).toBeVisible();
  });
});

// --- Where it is drawn -------------------------------------------------------------------------------------------

/** The boxes of the three parts, left to right as the page draws them. */
async function boxesOf(page: Page): Promise<Array<{ x: number; y: number; width: number; height: number }>> {
  const out: Array<{ x: number; y: number; width: number; height: number }> = [];
  for (let i = 0; i < 3; i++) {
    const box = await page.getByTestId("statement-part").nth(i).boundingBox();
    if (box === null) throw new Error(`no box for part ${i}`);
    out.push(box);
  }
  return out;
}

test.describe("the card on a wide screen", () => {
  test("has the three parts one under the other on the right page, with the notes on the left page and the map around the book", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1280, height: 760 });
    await open(lantern, stmt.readyKey());
    await page.getByTestId("btn-notebook").click();
    const book = page.getByTestId("notebook");
    await expect(page.getByTestId("statement-card")).toBeVisible();
    // The book does not change its size when a page is turned to: both pages are open.
    const widthOf = (): Promise<number> => book.evaluate((el) => (el as HTMLElement).offsetWidth);
    const opened = await widthOf();
    await page.getByTestId("workspace-tab-statement").click();
    expect(Math.abs((await widthOf()) - opened)).toBeLessThan(2);
    const left = await page.getByTestId("notes-leaf").boundingBox();
    const right = await page.getByTestId("workspace-statement").boundingBox();
    if (left === null || right === null) throw new Error("no box");
    expect(left.x + left.width).toBeLessThanOrEqual(right.x + 1);
    // The three parts are one under the other in the page, as wide as one another.
    const [a, b, c] = await boxesOf(page);
    if (a === undefined || b === undefined || c === undefined) throw new Error("no boxes");
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    expect(c.y).toBeGreaterThan(b.y + b.height - 1);
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    expect(Math.abs(a.width - b.width)).toBeLessThan(2);
    expect(a.x).toBeGreaterThanOrEqual(right.x - 1);
    expect(a.x + a.width).toBeLessThanOrEqual(right.x + right.width + 1);
    // The map shows around the book, and the page does not scroll sideways.
    const box = await book.boundingBox();
    if (box === null) throw new Error("no box");
    expect(box.x).toBeGreaterThanOrEqual(20);
    expect(box.x + box.width).toBeLessThanOrEqual(1280 - 20);
    expect(await fake.fitsWidth(page)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("puts the parts one under the other where the sheet is too narrow for three columns, and the page still does not scroll sideways", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 960, height: 700 });
    await open(lantern, stmt.readyKey());
    await turnToCard(page);
    const [a, b, c] = await boxesOf(page);
    if (a === undefined || b === undefined || c === undefined) throw new Error("no boxes");
    expect(b.y).toBeGreaterThan(a.y + a.height - 1);
    expect(c.y).toBeGreaterThan(b.y + b.height - 1);
    expect(Math.abs(a.x - b.x)).toBeLessThan(2);
    expect(await fake.fitsWidth(page)).toBe(true);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the card in both themes", () => {
  test("keeps its small text readable on the paper in English and Chinese, light and dark", async ({ lantern }) => {
    const page = lantern.page;
    await open(lantern, stmt.statementKey({ cause: "c_boat" }, { last: stmt.LAST_WRONG, parts: stmt.partsOf({ cause: "c_boat" }, ["course"]) }));
    await turnToCard(page);
    // The line that says what the strokes count is there until the card is used.
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        expect(await fake.contrast(page, '[data-testid="statement-intro"]'), `${theme} ${lang} intro`).toBeGreaterThan(4.5);
      }
    }
    await page.locator('[data-testid="statement-option"][data-id="c_boat"]').getByTestId("statement-notes").locator("summary").click();
    await expect(page.getByTestId("statement-intro")).toHaveCount(0);
    const selectors = [
      '[data-testid="statement-part-title"]',
      '[data-testid="statement-gap"]',
      '[data-testid="statement-why"]',
      '[data-testid="statement-for"]',
      '[data-testid="statement-against"]',
      '[data-testid="statement-for"].is-zero',
      '[data-testid="statement-chosen"]',
      '[data-testid="statement-pick"]',
      '[data-testid="statement-notes"] summary',
      '[data-testid="statement-entry"]',
      '[data-testid="statement-clear"]',
      '[data-testid="statement-last-line"]',
      '[data-testid="statement-wrong"]',
      '[data-testid="statement-reason"]',
      '[data-testid="workspace-tab-statement"]',
    ];
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        for (const selector of selectors) expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the words of the question and of the result readable too", async ({ lantern }) => {
    const page = lantern.page;
    await open(lantern, stmt.readyKey());
    await turnToCard(page);
    await page.getByTestId("statement-state").click();
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        for (const selector of ['.stmt-confirm-title', '[data-testid="statement-recap"] li', '.stmt-confirm-body', '[data-testid="statement-confirm"]']) {
          expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
        }
      }
    }
    await page.getByTestId("statement-confirm").click();
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, used_today: true, last: stmt.LAST_WRONG }) }, [ackOf(await lastId(page)), stmt.spokeEvent()]);
    await expect(page.getByTestId("hearer")).toHaveCount(4);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        for (const selector of ['[data-testid="stated-result"]', '[data-testid="stated-wrong"]', '[data-testid="stated-why"]', '[data-testid="stated-line"]', ".stated-who", '[data-testid="hearer-reason"]']) {
          expect(await fake.contrast(page, selector), `${theme} ${lang} ${selector}`).toBeGreaterThan(4.5);
        }
      }
    }
    // A statement that told the truth, in the green of a thing done.
    await page.getByTestId("clarify-done").click();
    await fake.feedFrame(page, { statement: stmt.readyKey() });
    await page.getByTestId("statement-state").click();
    await page.getByTestId("statement-confirm").click();
    await fake.feedFrame(page, { statement: stmt.readyKey({ can_state: false, used_today: true, last: stmt.LAST_TOLD }) }, [ackOf(await lastId(page)), stmt.spokeEvent(stmt.LAST_TOLD)]);
    await expect(page.getByTestId("stated-verdict")).toHaveAttribute("data-told", "true");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      for (const lang of ["en", "zh"] as const) {
        await lantern.setLang(lang);
        expect(await fake.contrast(page, '[data-testid="stated-result"]'), `${theme} ${lang} told`).toBeGreaterThan(4.5);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a page of the notebook that runs past its foot", () => {
  test("says so with a phrase at the foot that turns it, in both languages, and the phrase is gone at the end of the page", async ({ lantern }) => {
    const base = fake.notebook();
    const many = [0, 1, 2, 3].flatMap((k) => base.map((entry) => ({ ...entry, id: `${String(entry.id)}_${k}` })));
    const page = await open(lantern, stmt.statementKey(), { notebook: many });
    await page.getByTestId("btn-notebook").click();
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    const leaf = page.getByTestId("notes-leaf");
    const turn = page.getByTestId("notes-turn");
    await expect(turn).toBeVisible();
    await expect(turn).toHaveText("Turn the page");
    // The phrase lies at the very foot of the leaf: no line of the next part of the page shows under it.
    const below = await leaf.evaluate((el) => {
      const bar = el.querySelector("[data-testid='notes-turn']")?.getBoundingClientRect();
      return bar === undefined ? Number.NaN : el.getBoundingClientRect().bottom - bar.bottom;
    });
    expect(below).toBeLessThanOrEqual(1);
    await lantern.setLang("zh");
    await expect(turn).toHaveText("翻页");
    await turn.getByRole("button").click();
    await expect.poll(() => leaf.evaluate((el) => el.scrollTop)).toBeGreaterThan(100);
    await leaf.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(turn).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
