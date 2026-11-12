import type { Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

// The statement card as three lines with a blank each: how the bridge broke, what happened that night, why people got it wrong. Each blank is
// filled from the options the card lists, each with the notes for and against it as before, and what is chosen shows in the blank.

test.use({ map: true });

async function open(lantern: Parameters<typeof fake.openFirstDay>[0], statement: Record<string, unknown> = stmt.statementKey()): Promise<Page> {
  await fake.openFirstDay(lantern, { statement });
  await fake.recordSent(lantern.page);
  await lantern.page.getByTestId("btn-notebook").click();
  await expect(lantern.page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  await lantern.page.getByTestId("workspace-tab-statement").click();
  await expect(lantern.page.getByTestId("statement-card")).toBeVisible();
  return lantern.page;
}

test.describe("the statement as three blanks", () => {
  test("has three lines, each the question and a blank that is empty until something is chosen for it", async ({ lantern }) => {
    const page = await open(lantern);
    await expect(page.getByTestId("statement-part")).toHaveCount(3);
    await expect(page.getByTestId("statement-part-title")).toHaveText([`${en["blank.cause"]}:`, `${en["blank.course"]}:`, `${en["blank.rumour"]}:`]);
    const blanks = page.getByTestId("statement-blank");
    await expect(blanks).toHaveCount(3);
    for (let i = 0; i < 3; i++) {
      await expect(blanks.nth(i)).toHaveAttribute("data-filled", "false");
      await expect(blanks.nth(i)).toHaveText("");
    }
    // The blank has a line of ink to write on, which is as wide as a short answer.
    const box = await blanks.first().boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(80);
    await lantern.setLang("zh");
    await expect(page.getByTestId("statement-part-title")).toHaveText([`${zh["blank.cause"]}：`, `${zh["blank.course"]}：`, `${zh["blank.rumour"]}：`]);
    // One name for each part, in every place the card names it: the question, and not the core's title.
    await expect(page.getByTestId("statement-part").first()).toHaveAttribute("aria-label", zh["blank.cause"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("shows what was chosen in the blank, and goes empty again when the choice is taken back", async ({ lantern }) => {
    const page = await open(lantern);
    await page.locator('[data-testid="statement-part"][data-part="cause"]').getByTestId("statement-pick").first().click();
    expect((await fake.sentSoFar(page)).at(-1)).toMatchObject({ type: "statement", op: "choose", part: "cause", option: "c_boat" });
    await fake.feedFrame(page, { statement: stmt.statementKey({ cause: "c_boat" }) }, []);
    const blank = page.locator('[data-testid="statement-part"][data-part="cause"]').getByTestId("statement-blank");
    await expect(blank).toHaveAttribute("data-filled", "true");
    await expect(blank).toHaveText("Boatman He's boat struck the railing in the night");
    await expect(page.locator('[data-testid="statement-part"][data-part="course"]').getByTestId("statement-blank")).toHaveAttribute("data-filled", "false");
    await lantern.setLang("zh");
    await expect(blank).toHaveText("船夫老何夜里撑船，船头撞断了栏杆");
    // Taking the choice back empties the blank.
    await fake.feedFrame(page, { statement: stmt.statementKey() }, []);
    await expect(blank).toHaveAttribute("data-filled", "false");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the notes for and against beside each option, and the notes behind them", async ({ lantern }) => {
    const page = await open(lantern, stmt.statementKey({ cause: "c_li_er" }));
    const option = page.locator('[data-testid="statement-part"][data-part="cause"]').locator('[data-testid="statement-option"][data-id="c_li_er"]');
    await expect(option).toHaveAttribute("data-support", "1");
    await expect(option).toHaveAttribute("data-against", "1");
    await expect(option.getByTestId("statement-marks")).toHaveAttribute("aria-label", "1 for, 1 against");
    await option.getByTestId("statement-notes").locator("summary").click();
    await expect(option.getByTestId("statement-entry")).toHaveCount(2);
    // The options are all there for a part with nothing held, which does not narrow them down.
    const empty = await open(lantern, stmt.statementKey({}, { parts: stmt.partsOf({}, ["course"]) }));
    await expect(empty.locator('[data-testid="statement-part"][data-part="course"]').getByTestId("statement-option")).toHaveCount(3);
  });

  test("says in the same lines what did not hold, and asks with the same lines before the statement is made", async ({ lantern }) => {
    const page = await open(lantern, stmt.readyKey({ last: { ...stmt.LAST_WRONG, wrong: ["cause"] } }));
    await expect(page.getByTestId("statement-wrong")).toHaveText(`Did not hold: ${en["blank.cause"]}`);
    await page.getByTestId("statement-state").click();
    const lines = page.getByTestId("statement-recap").locator("li");
    await expect(lines).toHaveText([`${en["blank.cause"]}: Boatman He's boat struck the railing in the night`, `${en["blank.course"]}: Boatman He poled under the bridge in the night and the bow struck the railing. Afterwards the boatman quietly mended the boat`, `${en["blank.rumour"]}: Zhou's Clerk only saw Li Er at the bridge looking for a lantern. Shopkeeper Zhou, holding an old grudge, guessed that Li Er broke the railing. The story grew as it went round and picked up “on purpose” and “envy”`]);
    expect(lantern.pageErrors).toEqual([]);
  });
});
