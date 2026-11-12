import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import * as fake from "../support/slice.ts";

// The ledger in the days after the first, on fake frames that follow the key `board` of the frame. It has three pages, one for each job, and
// a bookmark at the right edge for each: the bridge (the work it takes and what has come, item by item, the helpers by family, the work hours,
// the next work time, why the last one did nothing, the deadline, what was promised), the truth (what it takes and how the last statement stood
// against it) and the peace (the grudge as a stick of incense, the acts, the witness), in both languages and themes. The map is not drawn here.

const DEADLINE = { en: "Day 4 18:00", zh: "第四天 18:00" } as const;

type PageName = "bridge" | "truth" | "peace";
const tab = (page: Page, name: PageName) => page.getByTestId(name === "bridge" ? "board-toggle" : `board-tab-${name}`);

/** Turns the ledger to a page: the bookmark of the page that is open is a second press that shuts the book, so it is pressed only for another page. */
async function turnTo(page: Page, name: PageName): Promise<void> {
  if ((await tab(page, name).getAttribute("aria-expanded")) !== "true") await tab(page, name).click();
  await expect(page.getByTestId("board")).toHaveAttribute("data-page", name);
}

/** Opens the town, puts a moment of the five days in it, and opens the ledger at the bridge. */
async function atMoment(lantern: Parameters<typeof fake.openFirstDay>[0], moment: fake.Moment, extras: Record<string, unknown> = {}): Promise<void> {
  await fake.openFirstDay(lantern);
  await fake.feedFrame(lantern.page, { ...fake.moment(moment), ...extras });
  await tab(lantern.page, "bridge").click();
  await expect(lantern.page.getByTestId("board-bridge")).toBeVisible();
}

const material = (page: Page, item: string) => page.locator(`[data-testid="board-material"][data-item="${item}"]`);

test.describe("the ledger on the second day, with the first batch of bamboo in", () => {
  test("says what came and what is still to be done: the batch, one helper, no work yet, and what the town needs to see", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day2");
    // The three bookmarks say which jobs are done: none is.
    for (const name of ["bridge", "truth", "peace"] as const) await expect(tab(page, name)).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("ledger-title")).toHaveText("The bridge");
    // The bamboo came in one batch of four, and the timber has not been asked for. The pile at the bridge is on the line as well.
    await expect(material(page, "bamboo")).toHaveAttribute("data-promised", "4");
    await expect(material(page, "bamboo")).toHaveAttribute("data-delivered", "4");
    await expect(material(page, "bamboo")).toHaveText(/Bamboo\s*promised 4\s*delivered 4/);
    await expect(material(page, "timber")).toHaveAttribute("data-promised", "0");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "4");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-timber", "0");
    // One helper, of the Li family, so both families are not there yet, and the page says so.
    await expect(page.getByTestId("board-helper")).toHaveText(["Li family 1"]);
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("Have 1");
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveAttribute("data-need", "5");
    await expect(page.getByTestId("board-both")).toHaveText("At least one helper from each family");
    // No work yet, and the next time it is done at the bridge; no reason for a work time that did nothing, since there was none.
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "0");
    await expect(page.getByTestId("board-hours")).toContainText("Needs 10 hours");
    await expect(page.getByTestId("board-window")).toContainText("Day 3 08:00 to 12:00, Stone Bridge");
    await expect(page.getByTestId("board-stop")).toHaveCount(0);
    await expect(page.getByTestId("board-deadline")).toContainText(DEADLINE.en);
    // The truth is open, and no statement was made.
    await turnTo(page, "truth");
    await expect(page.getByTestId("truth-state")).toHaveText("Not yet set straight in public");
    await expect(page.getByTestId("truth-state")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("truth-need")).toHaveText(["at least five familiar faces there", "at least six in ten of them believe it", "the elder believes it"]);
    await expect(page.getByTestId("truth-need").first()).toHaveAttribute("data-met", "");
    await expect(page.getByTestId("truth-last")).toHaveCount(0);
    // The peace is open, with the grudge as a stick of incense, three acts and no witness.
    await turnTo(page, "peace");
    await expect(page.getByTestId("peace-meter")).toHaveAttribute("value", "70");
    await expect(page.getByTestId("peace-grudge")).toHaveText("Grudge 70");
    await expect(page.getByTestId("peace-act")).toHaveCount(3);
    await expect(page.getByTestId("peace-act").first()).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId("peace-witness")).toHaveText("Nobody has seen the families make peace yet");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says the same in Chinese, in both themes, in numerals of the town and clock times in digits", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day2");
    for (const theme of ["dark", "light"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("zh");
      await turnTo(page, "bridge");
      await expect(page.getByTestId("ledger-title")).toHaveText("修桥");
      await expect(material(page, "bamboo")).toHaveText(/竹料\s*答应四根\s*送到四根/);
      await expect(page.getByTestId("board-helper")).toHaveText(["李家一人"]);
      await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("有一人");
      await expect(page.getByTestId("board-both")).toHaveText("两家各至少要出一个人");
      await expect(page.getByTestId("board-hours")).toContainText("要十个钟头");
      await expect(page.getByTestId("board-window")).toContainText("第三天 辰时 08:00 到 12:00，石桥");
      await expect(page.getByTestId("board-deadline")).toContainText(DEADLINE.zh);
      await turnTo(page, "truth");
      await expect(page.getByTestId("truth-state")).toHaveText("还没当众说清");
      await expect(page.getByTestId("truth-need")).toHaveText(["至少五个熟面孔在场", "在场的人有六成以上信", "族长也信"]);
      await turnTo(page, "peace");
      await expect(page.getByTestId("peace-grudge")).toHaveText("积怨 70");
      await expect(page.getByTestId("peace-witness")).toHaveText("还没人亲眼看见两家和好");
      for (const selector of ['[data-testid="peace-witness"]', '[data-testid="peace-grudge"]']) {
        expect(await fake.contrast(page, selector), `${theme} ${selector}`).toBeGreaterThan(4.5);
      }
    }
  });
});

test.describe("the ledger on the fourth day, with the work under way and a statement that fell short", () => {
  test("adds up the batches, counts the helpers by family, says why the last work time did nothing, and which condition the statement missed", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day4");
    // Three batches of bamboo, two in and one promised, and the timber that came: promised and delivered are two numbers, and the pile a third.
    await expect(material(page, "bamboo")).toHaveAttribute("data-promised", "10");
    await expect(material(page, "bamboo")).toHaveAttribute("data-delivered", "8");
    await expect(material(page, "bamboo")).toHaveAttribute("data-site", "8");
    await expect(material(page, "timber")).toHaveAttribute("data-promised", "8");
    await expect(material(page, "timber")).toHaveAttribute("data-delivered", "8");
    // Both families have helpers, so the warning is gone.
    await expect(page.getByTestId("board-helper")).toHaveText(["Li family 3", "Zhou family 2"]);
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("Have 5");
    await expect(page.getByTestId("board-both")).toHaveCount(0);
    // Four of the ten hours are done, and they are counted in tally strokes with the number beside them.
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "4");
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-need", "10");
    await expect(page.getByTestId("board-hours").locator(".tally")).toHaveAttribute("data-n", "4");
    await expect(page.getByTestId("board-window")).toContainText("Day 4 13:00 to 17:00, Stone Bridge");
    await expect(page.getByTestId("board-stop")).toContainText("Heavy rain the day before kept everyone off the bridge");
    await expect(page.getByTestId("board-deadline")).toContainText(DEADLINE.en);
    // The statement was made and fell short: the last one, and each condition met or missed.
    await turnTo(page, "truth");
    await expect(page.getByTestId("truth-state")).toHaveAttribute("data-state", "open");
    for (const [i, met] of ["false", "false", "false"].entries()) await expect(page.getByTestId("truth-need").nth(i)).toHaveAttribute("data-met", met);
    await expect(page.getByTestId("truth-last")).toContainText("Day 3 18:00, Teahouse: 4 there, 2 believed it (50%), the elder was not there");
    await expect(page.getByTestId("truth-last")).toHaveAttribute("data-elder", "absent");
    await expect(page.getByTestId("truth-missed")).toHaveText("Fell short: Fewer than five familiar faces were there, and the elder was not there");
    // Two of the three acts of the peace are done, and nobody has seen it.
    await turnTo(page, "peace");
    await expect(page.getByTestId("peace-act").nth(0)).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("peace-act").nth(1)).toHaveAttribute("data-done", "true");
    await expect(page.getByTestId("peace-act").nth(2)).toHaveAttribute("data-done", "false");
    await expect(page.getByTestId("peace-witness")).toHaveText("Nobody has seen the families make peace yet");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("says the same in Chinese, in both themes, and the last statement is read in Chinese as well", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day4");
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("zh");
      await turnTo(page, "bridge");
      await expect(material(page, "bamboo")).toHaveText(/竹料\s*答应十根\s*送到八根/);
      await expect(page.getByTestId("board-helper")).toHaveText(["李家三人", "周家两人"]);
      await expect(page.getByTestId("board-stop")).toContainText("昨天下大雨，没有人上工");
      await turnTo(page, "truth");
      await expect(page.getByTestId("truth-last")).toContainText("第三天 18:00在茶馆，到场四人，两人信了，占50%，族长没到场");
      await expect(page.getByTestId("truth-missed")).toHaveText("没成，因为在场的熟面孔不到五个，族长也不在场");
      for (const selector of ['[data-testid="truth-last"] p:nth-child(1)', '[data-testid="truth-missed"]', '[data-testid="truth-need"]']) {
        expect(await fake.contrast(page, selector), `${theme} ${selector}`).toBeGreaterThan(4.5);
      }
    }
  });
});

test.describe("the ledger on the fifth day, with everything done", () => {
  test("says the truth is set straight and the families have made peace, each with a tick, and the work done under the seal 办妥 at the head of the page", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day5");
    // Every job has its seal on its bookmark, and the bridge page has the big seal at its foot, with no next work time and no deadline to come.
    for (const name of ["bridge", "truth", "peace"] as const) await expect(tab(page, name)).toHaveAttribute("data-state", "done");
    await expect(tab(page, "bridge").locator(".mark-seal")).toHaveCount(1);
    await expect(page.getByTestId("board-bridge")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("board").locator(".ledger-seal")).toHaveCount(1);
    await expect(page.getByTestId("board-window")).toHaveCount(0);
    await expect(page.getByTestId("board-deadline")).toHaveCount(0);
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "10");
    await expect(material(page, "bamboo")).toHaveAttribute("data-delivered", "10");
    await expect(page.getByTestId("board-both")).toHaveCount(0);
    await turnTo(page, "truth");
    await expect(page.getByTestId("truth-state")).toHaveText("Set straight in public");
    await expect(page.getByTestId("truth-state")).toHaveAttribute("data-state", "done");
    await expect(page.getByTestId("truth-state").locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("truth-need")).toHaveCount(0);
    await turnTo(page, "peace");
    await expect(page.getByTestId("peace-state")).toHaveText("The two families have made peace");
    await expect(page.getByTestId("peace-state").locator("svg")).toHaveCount(1);
    await expect(page.getByTestId("peace-meter")).toHaveCount(0);
    await expect(page.getByTestId("peace-act")).toHaveCount(0);
    for (const theme of ["light", "dark"] as const) {
      await lantern.setTheme(theme);
      await lantern.setLang("zh");
      await turnTo(page, "truth");
      await expect(page.getByTestId("truth-state")).toHaveText("已当众说清");
      expect(await fake.contrast(page, '[data-testid="truth-state"]'), `${theme} truth-state`).toBeGreaterThan(4.5);
      await turnTo(page, "peace");
      await expect(page.getByTestId("peace-state")).toHaveText("两家已经和好");
      expect(await fake.contrast(page, '[data-testid="peace-state"]'), `${theme} peace-state`).toBeGreaterThan(4.5);
    }
    // On a bookmark the seal sits on the cloth under the title slip, clear of it (ui-marks.spec.ts measures the whole bookmark).
    for (const lang of ["zh", "en"] as const) {
      await lantern.setLang(lang);
      for (const name of ["bridge", "truth", "peace"] as const) {
        const gap = await tab(page, name).evaluate((mark) => {
          const label = mark.querySelector(".mark-label");
          const seal = mark.querySelector(".mark-seal");
          if (label === null || seal === null) return null;
          return seal.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
        });
        expect(gap, `${lang} ${name} has a slip and a seal`).not.toBeNull();
        expect(gap ?? -99, `${lang} ${name} gap from the slip to the seal`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the ledger where the frame has less", () => {
  test("shows a dash for what a board leaves out, and the numbers of the hud where it has no board at all", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day4", { judgments: undefined, board: fake.boardKey({ helpers: null, need: null, both: null, hours: null, window: null, stop: null, deadline: null, truth: null, peace: null }) });
    await expect(page.getByTestId("board-window")).toHaveCount(0);
    // The helpers are the workers the hud counts; nothing else of the days after is there.
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("Have 5");
    for (const id of ["board-both", "board-hours", "board-stop", "board-deadline"]) await expect(page.getByTestId(id)).toHaveCount(0);
    await turnTo(page, "truth");
    await expect(page.getByTestId("statement-empty")).toHaveText("–");
    await expect(page.getByTestId("truth-state")).toHaveCount(0);
    await turnTo(page, "peace");
    await expect(page.getByTestId("board-peace")).toContainText("–");
    for (const id of ["peace-state", "peace-witness"]) await expect(page.getByTestId(id)).toHaveCount(0);
    for (const name of ["truth", "peace"] as const) await expect(tab(page, name)).toHaveAttribute("data-state", "");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("keeps the three columns of the statement where a later core sends them, with tallies for the notes that support and a struck number for the notes against", async ({ lantern }) => {
    const page = lantern.page;
    const statement = [
      { part: "cause", support: 1, against: 0, gap: true },
      { part: "course", support: 0, against: 0, gap: true },
      { part: "rumour", support: 1, against: 0, gap: false },
    ];
    await atMoment(lantern, "day4", { board: fake.boardKey({ statement, truth: { state: "open", last: null } }) });
    await turnTo(page, "truth");
    await expect(page.getByTestId("board-statement")).toHaveAttribute("data-view", "columns");
    await expect(page.getByTestId("statement-column")).toHaveCount(3);
    const first = page.getByTestId("statement-column").first();
    await expect(first).toHaveAttribute("data-support", "1");
    await expect(first).toHaveAttribute("data-against", "0");
    await expect(first).toHaveAttribute("data-gap", "true");
    await expect(first).toContainText("How it broke");
    await expect(first.locator(".tally")).toHaveAttribute("data-n", "1");
    await expect(page.getByTestId("statement-column").nth(2)).toContainText("Why people got it wrong");
    // the marks have a line that says what they are, at the foot of the page
    await expect(page.locator(".ledger-legend")).toHaveText("Each stroke of the tally is a note that fits. The figure after the struck stroke is how many notes go against it.");
    // under the columns, whether the matter is set straight in public and what that takes
    await expect(page.getByTestId("truth-state")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("truth-need")).toHaveCount(3);
    await lantern.setLang("zh");
    await expect(page.getByTestId("statement-column").first()).toContainText("怎么坏的");
    await expect(page.locator(".ledger-legend")).toHaveText("正字每一笔是见闻簿里一条对得上的。划掉的那一笔后面写着几，就有几条对不上。");
  });

  test("says the pile against what the bridge takes where the board gives it", async ({ lantern }) => {
    const page = lantern.page;
    await atMoment(lantern, "day4", { board: fake.boardKey({ needs: { bamboo: 10, timber: 8 }, helpers: [{ family: "fam_li", count: 3 }, { family: "fam_zhou", count: 2 }], both: true }) });
    await expect(material(page, "bamboo")).toHaveAttribute("data-need", "10");
    await expect(material(page, "bamboo")).toHaveAttribute("data-site", "8");
    await expect(material(page, "bamboo")).toContainText("Needs 10");
    await expect(material(page, "bamboo")).toContainText("Here 8");
    // the timber is all there, and the line has its tick; the bamboo is not, and has none
    await expect(material(page, "timber").locator(".lrow-mark svg")).toHaveCount(1);
    await expect(material(page, "bamboo").locator(".lrow-mark svg")).toHaveCount(0);
    await lantern.setLang("zh");
    await expect(material(page, "bamboo")).toContainText("要十根");
    await expect(material(page, "bamboo")).toContainText("到八根");
    await expect(material(page, "timber")).toContainText("到八根");
  });
});

test.describe("the helpers when there are more than the work takes", () => {
  test("say that they have come and what the work takes, in both languages", async ({ lantern }) => {
    const page = lantern.page;
    const crowd = [
      { family: "fam_li", count: 4 },
      { family: "fam_zhou", count: 5 },
      { family: null, count: 8 },
    ];
    await atMoment(lantern, "day4", { board: fake.boardKey({ helpers: crowd, both: true }) });
    const total = page.getByTestId("board-helpers").locator(".helper-total");
    await expect(total).toHaveText("Have 17");
    await expect(page.getByTestId("board-helpers")).toContainText("Needs 5");
    // enough: the line has its tick
    await expect(page.getByTestId("board-helpers").locator(".lrow-mark svg")).toHaveCount(1);
    await lantern.setLang("zh");
    await expect(total).toHaveText("有十七人");
    await expect(page.getByTestId("board-helpers")).toContainText("要五人");
    // Below the need there is no tick.
    await fake.feedFrame(page, { board: fake.boardKey({ helpers: [{ family: "fam_li", count: 3 }], both: false }) });
    await expect(total).toHaveText("有三人");
    await expect(page.getByTestId("board-helpers").locator(".lrow-mark svg")).toHaveCount(0);
    await lantern.setLang("en");
    await expect(total).toHaveText("Have 3");
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the ledger when a page is long", () => {
  test("folds the promises older than the newest four under one line, and turns a page that runs past the leaf", async ({ lantern }) => {
    const page = lantern.page;
    const [first] = fake.commitments("delivered").commitments as Array<Record<string, unknown>>;
    const promises = Array.from({ length: 6 }, (_, number) => ({ ...first, id: `c_${number}`, state: "delivered" }));
    await atMoment(lantern, "day4", { commitments: promises });
    await expect(page.getByTestId("commitment")).toHaveCount(6);
    const older = page.getByTestId("commitments-older");
    await expect(older.locator("summary")).toHaveText("2 earlier");
    await expect(older.getByTestId("commitment")).toHaveCount(2);
    await expect(older).not.toHaveAttribute("open", "");
    await older.locator("summary").click();
    await expect(older.getByTestId("commitment").first()).toBeVisible();
    await lantern.setLang("zh");
    await expect(older.locator("summary")).toHaveText("更早的两条");
    // A page that is longer than the leaf has the phrase that turns it, at its foot, and the turn scrolls the leaf.
    const leaf = page.locator(".ledger-leaf");
    const longer = await leaf.evaluate((el) => el.scrollHeight > el.clientHeight + 4);
    if (longer) {
      await expect(page.getByTestId("ledger-turn")).toBeVisible();
      await page.getByTestId("ledger-turn").getByRole("button").click();
      await expect.poll(() => leaf.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    } else {
      await expect(page.getByTestId("ledger-turn")).toHaveCount(0);
    }
    // A page that is turned to starts at its head.
    await tab(page, "truth").click();
    await expect.poll(() => leaf.evaluate((el) => el.scrollTop)).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});
