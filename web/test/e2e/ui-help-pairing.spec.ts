import type { Page } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { zh } from "../../src/i18n/zh.ts";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";
import * as stmt from "../support/statement.ts";

// The notebook's pairing, on fake frames that follow the frame of the core: take a claim, show a line against it, and say in one of three plain answers
// how the two stand, each with a small example. A wrong answer says "think again" and writes nothing; "look at another pair" sends nothing. The line
// shown is the `a` of the core's judgement and the claim its `b`.

test.use({ map: true });

const openNotebook = async (page: Page): Promise<void> => {
  await page.getByTestId("btn-notebook").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  // What was written since the player last looked flashes once; the page counts it as seen after a moment.
  await expect(page.getByTestId("note").first()).toHaveAttribute("data-fresh", "false", { timeout: 8000 });
};

const lastId = async (page: Page): Promise<string> => String((await fake.sentSoFar(page)).at(-1)?.action_id);
const ack = (id: string, result: "applied" | "rejected" = "applied", reason: string | null = null, tick = 8) => ({ kind: "action_ack", tick, action_id: id, result, reason });
const note = (page: Page, id: string) => page.locator(`[data-testid="note"][data-id="${id}"]`);
const claim = (page: Page, id: string) => note(page, id).getByTestId("note-claim");
const show = (page: Page, id: string) => note(page, id).getByTestId("note-show");

/** Takes `n_broke` as the claim and shows `n_clerk` against it. */
async function pair(page: Page): Promise<void> {
  await claim(page, "n_broke").click();
  await show(page, "n_clerk").click();
  await expect(page.getByTestId("pairing")).toHaveAttribute("data-step", "answer");
}

test.describe("pairing in the notebook", () => {
  test("brings the answers into view when a line far under them is shown, in a window that is not tall", async ({ lantern }) => {
    const page = lantern.page;
    await page.setViewportSize({ width: 1200, height: 600 });
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await claim(page, "n_broke").click();
    // The last line of the notebook lies under the pairing, out of the window of the sheet until the sheet is scrolled to it.
    const notes = page.getByTestId("note");
    const last = notes.last();
    const id = await last.getAttribute("data-id");
    expect(id).not.toBe("n_broke");
    await last.getByTestId("note-show").click();
    await expect(page.getByTestId("pairing")).toHaveAttribute("data-step", "answer");
    const inView = async (): Promise<boolean> => {
      const answers = await page.getByTestId("answers").boundingBox();
      const sheet = await page.getByTestId("notebook").boundingBox();
      if (answers === null || sheet === null) return false;
      return answers.y >= sheet.y && answers.y + answers.height <= sheet.y + sheet.height;
    };
    await expect.poll(inView).toBe(true);
    // The answer comes back, and what the pairing says of it is in view as well.
    await page.getByTestId("ans-unsupported").click();
    const sent = await lastId(page);
    await fake.feedFrame(page, { judgments: [{ ...fake.JUDGMENT, a: id }] }, [ack(sent)]);
    await expect(page.getByTestId("pair-outcome")).toBeVisible();
    await expect
      .poll(async () => {
        const said = await page.getByTestId("pair-outcome").boundingBox();
        const sheet = await page.getByTestId("notebook").boundingBox();
        return said !== null && sheet !== null && said.y >= sheet.y && said.y + said.height <= sheet.y + sheet.height;
      })
      .toBe(true);
  });

  test("keeps the button of a line in a column of its own, so that the words never run under it, in the narrow page of a spread too", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.feedFrame(page, { ...fake.moment("day4"), ...fake.laterTasks("t_statement"), statement: stmt.statementKey({ cause: "c_boat", rumour: "u_clerk_saw" }) });
    await openNotebook(page);
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-spread", "true");
    const notes = page.getByTestId("note");
    let seen = 0;
    for (let i = 0; i < (await notes.count()); i++) {
      if (!(await notes.nth(i).isVisible())) continue;
      const words = await notes.nth(i).locator(".note-text").boundingBox();
      const button = await notes.nth(i).getByTestId("note-claim").boundingBox();
      if (words === null || button === null) continue;
      seen += 1;
      expect(words.x + words.width, `line ${i}`).toBeLessThanOrEqual(button.x + 0.5);
    }
    expect(seen).toBeGreaterThan(1);
    await lantern.setLang("zh");
    await lantern.setTheme("dark");
    expect(await fake.fitsWidth(page)).toBe(true);
  });

  test("asks first for a claim, then for a line shown against it, then for the answer, and says what each step is", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    const pairing = page.getByTestId("pairing");
    await expect(pairing).toHaveAttribute("data-step", "claim");
    await expect(page.getByTestId("pairing-hint")).toHaveText(en["pairing.step.claim"]);
    await expect(page.getByTestId("answers")).toHaveCount(0);
    // Every line has the same button before there is a claim.
    await expect(page.getByTestId("note-claim")).toHaveCount(4);
    await expect(page.getByTestId("note-claim").first()).toHaveText(en["pairing.pickClaim"]);
    await claim(page, "n_broke").click();
    await expect(pairing).toHaveAttribute("data-step", "show");
    await expect(page.getByTestId("pairing-hint")).toHaveText(en["pairing.step.show"]);
    await expect(page.getByTestId("pair-claim")).toContainText("Li Er broke the bridge railing last night.");
    await expect(page.getByTestId("pair-shown")).toContainText(en["pairing.shown.empty"]);
    // The claim says so on its own line, and the others offer to be shown against it.
    await expect(claim(page, "n_broke")).toHaveText(en["pairing.claimed"]);
    await expect(show(page, "n_clerk")).toHaveText(en["pairing.show"]);
    await expect(page.getByTestId("note-show")).toHaveCount(3);
    await show(page, "n_clerk").click();
    await expect(pairing).toHaveAttribute("data-step", "answer");
    await expect(page.getByTestId("pairing-hint")).toHaveText(en["pairing.step.answer"]);
    await expect(page.getByTestId("pair-shown")).toContainText("Li Er was at the bridge last night.");
    await expect(show(page, "n_clerk")).toHaveText(en["pairing.shown"]);
    // Nothing is sent until there is an answer.
    expect(await fake.sentSoFar(page)).toEqual([]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("gives three answers in plain words, each with a small example, and takes the claim back with a press on it", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await openNotebook(page);
    await pair(page);
    const answers = page.getByTestId("answers").getByRole("button");
    await expect(answers).toHaveCount(3);
    for (const relation of ["unsupported", "contradicts", "mismatch"] as const) {
      const button = page.getByTestId(`ans-${relation}`);
      await expect(button.locator(".answer-name")).toHaveText(en[`pairing.ans.${relation}`]);
      await expect(button.locator(".answer-eg")).toHaveText(en[`pairing.eg.${relation}`]);
    }
    await lantern.setLang("zh");
    await expect(page.getByTestId("ans-unsupported").locator(".answer-name")).toHaveText("撑不起这句话");
    await expect(page.getByTestId("ans-contradicts").locator(".answer-name")).toHaveText("和这句话相反");
    await expect(page.getByTestId("ans-mismatch").locator(".answer-name")).toHaveText("传走样了");
    await expect(page.getByTestId("ans-unsupported").locator(".answer-eg")).toHaveText(zh["pairing.eg.unsupported"]);
    await lantern.setLang("en");
    // The claim, pressed again, is put back, and the line shown goes with it.
    await claim(page, "n_broke").click();
    await expect(page.getByTestId("pairing")).toHaveAttribute("data-step", "claim");
    await expect(page.getByTestId("answers")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("sends the answer at once, with the line shown as a and the claim as b, for each of the three relations", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await pair(page);
    for (const relation of ["unsupported", "contradicts", "mismatch"] as const) {
      await page.getByTestId(`ans-${relation}`).click();
      expect((await fake.sentSoFar(page)).at(-1), relation).toMatchObject({ type: "judge", a: "n_clerk", b: "n_broke", relation });
      await expect(page.getByTestId("pairing")).toHaveAttribute("data-waiting", "true");
      await expect(page.getByTestId("ans-unsupported")).toBeDisabled();
      // The core says no, and the same two lines can be answered again.
      await fake.feedFrame(page, {}, [ack(await lastId(page), "rejected", "not_shown")]);
      await expect(page.getByTestId("ans-unsupported")).toBeEnabled();
    }
    expect((await fake.sentSoFar(page)).filter((m) => m.type === "judge")).toHaveLength(3);
  });

  test("says that it is right in one sentence that names the two lines, and keeps it among the judgements", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await pair(page);
    await page.getByTestId("ans-unsupported").click();
    await fake.feedFrame(page, { judgments: [fake.JUDGMENT] }, [ack(await lastId(page))]);
    const outcome = page.getByTestId("pair-outcome");
    await expect(outcome).toHaveAttribute("data-ok", "true");
    await expect(outcome).toHaveText(en["pairing.ok.unsupported"].replace("{a}", "Li Er was at the bridge last night").replace("{b}", "Li Er broke the bridge railing last night"));
    await expect(page.getByTestId("judgment")).toHaveCount(1);
    await expect(page.getByTestId("judgment").locator(".judgment-relation")).toHaveText(en["pairing.ans.unsupported"]);
    await lantern.setLang("zh");
    await expect(outcome).toHaveText(zh["pairing.ok.unsupported"].replace("{a}", "李二昨晚在桥边").replace("{b}", "李二昨晚把栏杆弄坏了"));
    expect(await fake.fitsWidth(page)).toBe(true);
  });

  test("says think again for a wrong answer, and does not write it down: no judgement, no note, no mark", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await pair(page);
    await page.getByTestId("ans-contradicts").click();
    await fake.feedFrame(page, {}, [ack(await lastId(page), "rejected", "not_shown")]);
    const outcome = page.getByTestId("pair-outcome");
    await expect(outcome).toHaveAttribute("data-ok", "false");
    await expect(outcome).toHaveAttribute("data-reason", "not_shown");
    await expect(outcome).toHaveText(en["pairing.wrong"]);
    await expect(page.getByTestId("judgment")).toHaveCount(0);
    await expect(page.getByTestId("game-note")).toHaveCount(0);
    // The answer that was tried is struck, so that the player sees which they have tried, and the others are not.
    await expect(page.getByTestId("ans-contradicts")).toHaveAttribute("data-tried", "true");
    await expect(page.getByTestId("ans-unsupported")).toHaveAttribute("data-tried", "false");
    // It gives no answer: nothing in the words says which is right.
    expect(en["pairing.wrong"]).not.toMatch(/unsupported|carry|opposite|passed on/i);
    await lantern.setLang("zh");
    await expect(outcome).toHaveText("不对。再想想，这两句能不能都对？");
    // Another answer for the same two lines is another try.
    await page.getByTestId("ans-unsupported").click();
    expect((await fake.sentSoFar(page)).filter((m) => m.type === "judge")).toHaveLength(2);
  });

  test("says the reason in the core's words where the line is not in the notebook", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await pair(page);
    await page.getByTestId("ans-unsupported").click();
    await fake.feedFrame(page, {}, [ack(await lastId(page), "rejected", "unknown_note")]);
    await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-reason", "unknown_note");
    await expect(page.getByTestId("pair-outcome")).not.toHaveText(en["pairing.wrong"]);
  });

  test("looks at another pair when asked, and sends nothing, judges nothing and writes nothing", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await expect(page.getByTestId("pair-swap")).toHaveCount(0);
    await pair(page);
    await expect(page.getByTestId("pair-swap")).toHaveText(en["pairing.swap"]);
    await page.getByTestId("pair-swap").click();
    await expect(page.getByTestId("pairing")).toHaveAttribute("data-step", "claim");
    await expect(page.getByTestId("answers")).toHaveCount(0);
    await expect(page.getByTestId("judgment")).toHaveCount(0);
    expect(await fake.sentSoFar(page)).toEqual([]);
    await lantern.setLang("zh");
    await claim(page, "n_broke").click();
    await expect(page.getByTestId("pair-swap")).toHaveText(zh["pairing.swap"]);
  });

  test("has the controls of judging and of asking for a hint only where the frame lists the acts", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern, { hud: { verbs: ["move"] } });
    await fake.recordSent(page);
    await openNotebook(page);
    await expect(page.getByTestId("note")).toHaveCount(4);
    for (const id of ["pairing", "notebook-hint", "note-claim", "note-show"]) await expect(page.getByTestId(id)).toHaveCount(0);
    await fake.feedFrame(page, { hud: { verbs: ["move", "judge"] } });
    await expect(page.getByTestId("pairing")).toBeVisible();
    await expect(page.getByTestId("note-claim")).toHaveCount(4);
    await expect(page.getByTestId("notebook-hint")).toHaveCount(0);
    await fake.feedFrame(page, { hud: { verbs: ["move", "hint"] } });
    await expect(page.getByTestId("notebook-hint")).toBeVisible();
    await expect(page.getByTestId("pairing")).toHaveCount(0);
    await expect(page.getByTestId("note-claim")).toHaveCount(0);
    expect(await fake.sentSoFar(page)).toEqual([]);
  });

  test("sets the pair the core lit as the claim and the line shown, which the player has then to answer", async ({ lantern }) => {
    const page = lantern.page;
    await fake.openFirstDay(lantern);
    await fake.recordSent(page);
    await openNotebook(page);
    await page.getByTestId("notebook-hint").click();
    await fake.feedFrame(page, { hint: { a: "n_clerk", b: "n_broke" } }, [ack(await lastId(page), "applied", null, 6)]);
    await expect(page.getByTestId("hint-line")).toContainText("Compare these two:");
    await page.getByTestId("notebook-hint").click();
    await fake.feedFrame(page, { hint: { a: "n_clerk", b: "n_broke", relation: "unsupported" } }, [ack(await lastId(page), "applied", null, 7)]);
    // When the core says how they stand, the page says it in the same plain words as the answers.
    await expect(page.getByTestId("hint-relation")).toHaveText(en["pairing.ans.unsupported"]);
    await page.getByTestId("hint-use").click();
    await expect(page.getByTestId("pairing")).toHaveAttribute("data-step", "answer");
    await expect(page.getByTestId("pair-claim")).toHaveAttribute("data-id", "n_broke");
    await expect(page.getByTestId("pair-shown")).toHaveAttribute("data-id", "n_clerk");
    // The core's answer is a help and not a choice made for the player: nothing is sent, and no answer is marked.
    expect((await fake.sentSoFar(page)).filter((m) => m.type === "judge")).toEqual([]);
    await expect(page.getByTestId("answers").locator("[data-tried='true']")).toHaveCount(0);
    await expect(page.getByTestId("hint-use")).toHaveCount(0);
  });
});
