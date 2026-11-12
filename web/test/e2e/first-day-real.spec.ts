import type { Page } from "@playwright/test";
import { zh } from "../../src/i18n/zh.ts";
import { expect, type LanternPage, test } from "../support/fixtures.ts";
import { appliedActions, clockOf, closeElder, eventsOf, leaveTalk, notebookCount, openRequest, openTopic, untilHeld, untilSettled, waitForClock } from "../support/real.ts";
import { openTheNote } from "../support/play.ts";

// A new player's first day, on the real core in the browser host, through what a player may use and nothing else: the opening page, the page of the
// first six people, the red slip and its button, the talk with its four buttons and the one more that comes with what is waiting, the notebook with
// its pairing and its people book, and the public clarification with what the people there made of it. The first test goes from the opening page
// to the evening at the teahouse and Li Da's first promise. The second goes on, with the same first day, to the next morning, when the bamboo is
// at the bridge and the card that says the first day is done comes up. Nothing is sent to the core by hand and nothing is fed to the page.
test.use({ map: true, locale: "zh-CN", actionTimeout: 20_000 });

// The people of the first day are where the player can talk to them for a few hours of the game: Granny Li is at home for the last half hour before seven, Li Da for the three evening hours
// before he sleeps. A page that is slow takes seconds between two calls of this test, and the game goes on meanwhile, so the game runs at a pace at which three hours are some forty seconds.
const GAME = "pace=1";
const FOUR = ["verb-ask", "verb-entrust", "verb-tell", "verb-leave"] as const;

/** What a talk looks like at any moment: the four buttons, one more at most for what is waiting, no minutes on any of them and no count of hands. */
async function theFaceOfTheTalk(page: Page): Promise<void> {
  const area = page.getByTestId("talk-area");
  await expect(area).toBeVisible();
  for (const id of FOUR) await expect(area.getByTestId(id), id).toHaveCount(1);
  expect(await area.getByTestId("verb-context").count()).toBeLessThanOrEqual(1);
  expect(await area.locator("button.verb").count()).toBeLessThanOrEqual(FOUR.length + 1);
  await expect(page.locator('[data-testid^="cost-"]')).toHaveCount(0);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, "");
  expect(text).not.toMatch(/第[一二三四五六七八九十\d]+手|[一二三四五六七八九十\d]+手$/);
}

/**
 * Does something in the talk and waits until the person has answered it and, unless `paid` is false, the minutes of it are paid for (or the person
 * has gone). A card of the tutorial that comes up with the answer holds the world, and the minutes wait for the player to put it away.
 */
async function answeredAfter(page: Page, act: () => Promise<void>, paid = true): Promise<number> {
  const before = await page.evaluate(() => window.__lantern.play.state.talk?.lines.length ?? 0);
  await act();
  await page.waitForFunction((n) => (window.__lantern.play.state.talk?.lines.length ?? n + 2) >= n + 2, before, { timeout: 30_000 });
  if (paid) await untilSettled(page);
  const after = await page.evaluate(() => window.__lantern.play.state.talk?.lines.length ?? 0);
  return after - before;
}

/** Waits until the game's clock is at or past `hour`:`minute` of day `day`, and fails at once if the clan elder comes by on the way. */
async function clockReaches(page: Page, hour: number, minute = 0, day = 1): Promise<void> {
  const seen = await page.waitForFunction(
    ([d, m]) => {
      if (window.__lantern.play.guide.elder.open) return "the elder came by";
      const time = (window.__lantern.client.state.frame as unknown as { time: { day: number; hour: number; minute: number } }).time;
      return time.day > d || (time.day === d && time.hour * 60 + time.minute >= m) ? "reached" : false;
    },
    [day, hour * 60 + minute] as const,
    { timeout: 120_000, polling: 150 },
  );
  expect(await seen.jsonValue()).toBe("reached");
}

/** Leaves the talk with the button, as a player does, and waits until the game has the player out of it. */
async function leave(page: Page): Promise<void> {
  await leaveTalk(page);
  await page.waitForFunction(() => window.__lantern.play.state.talk === null);
}

/**
 * The button of the red slip, pressed until the page has walked the player up to someone and opened a talk with them. The person may be busy or
 * have moved on by the time the player is there, and then the button is pressed again.
 */
async function followTheSlip(page: Page): Promise<string> {
  await expect
    .poll(
      async () => {
        await closeElder(page);
        const state = await page.evaluate(() => ({ talking: window.__lantern.play.state.talk?.npc ?? null, idle: window.__lantern.play.state.approach === null }));
        if (state.talking !== null) return state.talking;
        if (state.idle && (await page.getByTestId("task-do").count()) > 0) await page.getByTestId("task-do").click({ timeout: 4000 }).catch(() => undefined);
        return null;
      },
      { timeout: 120_000, intervals: [400] },
    )
    .not.toBeNull();
  await untilHeld(page);
  const partner = (await page.evaluate(() => window.__lantern.play.state.talk?.npc ?? null)) ?? "";
  await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", partner);
  return partner;
}

/** Has the preview of the request up, the one on the button of the talk or the one among the others. */
async function askFor(page: Page, offer: string): Promise<void> {
  await openRequest(page, offer);
  await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
}

/**
 * Presses the button of the card of the request until the person has answered. If the town moved on between the look and the press, the card says so and looks
 * again, as it does for a player, who then presses the button once more.
 */
async function goAhead(page: Page): Promise<void> {
  const card = page.getByTestId("request-card");
  const confirm = page.getByTestId("request-confirm");
  await expect
    .poll(
      async () => {
        const phase = await card.getAttribute("data-phase", { timeout: 2000 }).catch(() => null);
        if (phase === "preview" && (await confirm.isEnabled().catch(() => false))) await confirm.click({ timeout: 4000 }).catch(() => undefined);
        return phase;
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe("result");
}

/** The people book, opened from the notebook and read: who is in it, in the order they were met. */
async function peopleBook(page: Page): Promise<string[]> {
  await page.getByTestId("btn-notebook").click();
  await page.getByTestId("workspace-tab-people").click();
  await expect(page.getByTestId("people-leaf")).toBeVisible();
  const met = await page.getByTestId("people-line").evaluateAll((items) => items.map((item) => item.getAttribute("data-person") ?? ""));
  await page.getByTestId("notebook-close").click();
  return met;
}

/** The first day: the opening page to the evening at the teahouse and Li Da's first promise. Returns the pair that was said in public. */
async function theFirstEvening(lantern: LanternPage): Promise<void> {
  const page = lantern.page;
  const card = page.getByTestId("tutorial-card");

  // --- 1. The opening page, then the page of the first six, then the elder's first card
  await page.goto(`${lantern.servers.app.origin}/?${GAME}`);
  await lantern.waitReady();
  await expect(page.getByTestId("opening-title")).toHaveText("灯会前夕");
  await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("opening-start").click();
  await expect(page.getByTestId("people-six-person")).toHaveCount(6);
  await expect(page.getByTestId("people-more")).toHaveText("镇上还有十来位，见了面再认识。");
  await expect(page.getByTestId("tutorial-card")).toHaveCount(0);
  await page.getByTestId("people-enter").click();
  await expect(card).toHaveAttribute("data-step", "granny");
  expect(await peopleBook(page)).toEqual([]);
  // The world waits under the card, and Granny Li goes to pray at seven. The first talk with her ends twelve minutes of the game after the request that the test makes in it
  // has been paid for, which is under a second at this pace, so the walk to her is begun under the card: the moment she is met in does not depend on how long the machine
  // takes to put the card away and look at the page. The card lies over the slip, so the button is pressed by the page's own press and not by the mouse.
  await page.getByTestId("task-do").evaluate((button: HTMLElement) => button.click());
  await page.getByTestId("tutorial-next").click();
  await expect(card).toHaveCount(0);

  // --- 2. Granny Li, by the red slip: the four buttons, her name and what she is on the first meeting, the request on the button
  expect(await followTheSlip(page)).toBe("li_laotai");
  await theFaceOfTheTalk(page);
  await expect(page.getByTestId("meeting-note")).toBeVisible();
  await expect(page.getByTestId("meeting-name")).toHaveText("李老太");
  await expect(page.getByTestId("hearts").first()).toBeVisible();
  await expect(page.getByTestId("verb-entrust")).toHaveClass(/is-signal/);
  await askFor(page, "lend");
  await goAhead(page);
  await expect(card).toHaveAttribute("data-step", "clerk", { timeout: 90_000 });
  await page.getByTestId("tutorial-next").click();
  await expect(card).toHaveCount(0);
  // What stands behind the hearts opens from the hearts, and the world waits while it is open.
  await page.getByTestId("hearts").first().click();
  await expect(page.getByTestId("hearts-sheet")).toBeVisible();
  await expect(page.getByTestId("hearts-trust")).toBeVisible();
  await page.getByTestId("hearts-close").click();
  await expect(page.getByTestId("hearts-sheet")).toHaveCount(0);
  await theFaceOfTheTalk(page);

  // --- 3. The rumour back to the one who said it. One question is one answer of two lines at most, and the answer has a phrase beside it
  // that asks who told them: the first step is that phrase, the next ones are what the red slip says.
  await openTheNote(page);
  await page.getByTestId("task-do").click();
  await closeElder(page);
  await expect(page.getByTestId("topic-chips")).toBeVisible();
  const said = await answeredAfter(page, async () => {
    expect(await openTopic(page, "li_er")).toBe(true);
    await page.locator('[data-testid="topic-chip"][data-id="li_er"]').click();
  });
  expect(said).toBeLessThanOrEqual(3);
  expect(await notebookCount(page)).toBe(1);
  // Granny Li may have to go before the question is paid for, and then the talk is over; while it is on it has the same face.
  if ((await page.evaluate(() => window.__lantern.play.state.talk)) !== null) await theFaceOfTheTalk(page);
  await leave(page);
  for (const next of ["cha_laoban", "zhou_huoji"]) {
    await closeElder(page);
    await expect(page.getByTestId("task-do")).toContainText("听谁说的");
    expect(await followTheSlip(page)).toBe(next);
    await expect(page.getByTestId("picker-askSource")).toBeVisible();
    if (next === "zhou_huoji") {
      // The clerk is the last of the line. The tutorial's card of the next step comes up with his answer, and the world waits under it.
      await answeredAfter(page, () => page.getByTestId("picker-option").first().click(), false);
      break;
    }
    await answeredAfter(page, () => page.getByTestId("picker-option").first().click());
    await leave(page);
  }
  expect(await notebookCount(page)).toBe(2);
  // Each of the three is in the book of the people, with the hearts, and what they told is under their name with when and where.
  await expect(card).toHaveAttribute("data-step", "compare", { timeout: 60_000 });
  await page.getByTestId("tutorial-next").click();
  await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
  await page.getByTestId("workspace-tab-people").click();
  await expect(page.getByTestId("people-leaf")).toBeVisible();
  expect(await page.getByTestId("people-line").evaluateAll((items) => items.map((item) => item.getAttribute("data-person")))).toEqual(["li_laotai", "cha_laoban", "zhou_huoji"]);
  await expect(page.getByTestId("people-line").locator('[data-testid="hearts"]')).toHaveCount(3);
  await expect(page.getByTestId("people-said-entry").first()).toBeVisible();
  await page.getByTestId("workspace-tab-notes").click();

  // --- 4. The pair: a claim, a line shown against it, one of three plain answers. The wrong answer says to think again and writes nothing down.
  await expect(page.getByTestId("pair-shown")).toContainText("李二昨晚在桥边。");
  await expect(page.getByTestId("pair-claim")).toContainText("眼红人家出风头");
  await expect(page.getByTestId("ans-unsupported")).toContainText(zh["pairing.ans.unsupported"]);
  await expect(page.getByTestId("ans-contradicts")).toContainText(zh["pairing.ans.contradicts"]);
  await expect(page.getByTestId("ans-mismatch")).toContainText(zh["pairing.ans.mismatch"]);
  await page.getByTestId("ans-contradicts").click();
  await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "false");
  await expect(page.getByTestId("pair-outcome")).toHaveText(zh["pairing.wrong"]);
  await expect(page.getByTestId("judgment")).toHaveCount(0);
  await page.getByTestId("ans-unsupported").click();
  await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "true");
  await expect(page.getByTestId("judgment")).toHaveCount(1);
  await expect(page.getByTestId("judgment")).toHaveAttribute("data-relation", "unsupported");
  const pair = { a: (await page.getByTestId("judgment").getAttribute("data-a")) ?? "", b: (await page.getByTestId("judgment").getAttribute("data-b")) ?? "" };
  await page.getByTestId("notebook-close").click();
  await leave(page);

  // --- 5. The evening at the teahouse: the slip says what to do and when, and the button comes at four
  await expect(card).toHaveAttribute("data-step", "evening", { timeout: 240_000 });
  await page.getByTestId("tutorial-next").click();
  await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_clear_rumour");
  await expect(page.getByTestId("topbar-task-text")).toHaveText("把李二的事当众说清");
  await expect(page.getByTestId("task-window")).toHaveText("茶馆，酉时 17:00 到 19:00");
  await waitForClock(page, 16, 5, 1, 240_000);
  await expect(page.getByTestId("task-do")).toHaveText("去茶馆");
  await page.getByTestId("task-do").click();
  await expect(page.getByTestId("verb-speak")).toBeVisible({ timeout: 120_000 });
  await waitForClock(page, 17, 45);

  // --- 6. The clarification in public, from the notebook, and what each of the people there made of it
  await page.getByTestId("btn-notebook").click();
  const row = page.locator(`[data-testid="judgment"][data-a="${pair.a}"][data-b="${pair.b}"]`);
  await expect(row.getByTestId("judgment-clarify")).toBeEnabled();
  await expect(page.locator('[data-testid^="cost-"]')).toHaveCount(0);
  await row.getByTestId("judgment-clarify").click();
  await expect(page.getByTestId("clarify")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("clarify-claim")).toContainText("眼红人家出风头");
  await expect.poll(() => page.getByTestId("hearer").count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("clarify-sum")).toBeVisible({ timeout: 30_000 });
  const clarified = (await eventsOf(page, "clarified")).at(-1) as { accepted: number; venue: string };
  expect(clarified.venue).toBe("p_teahouse");
  expect(clarified.accepted).toBeGreaterThanOrEqual(4);
  expect((await eventsOf(page, "objection_withdrawn")).at(-1)).toMatchObject({ npc: "li_laotai", what: "bamboo" });
  await page.getByTestId("clarify-done").click();
  await page.getByTestId("notebook-close").click();
  await untilSettled(page);

  // --- 7. Li Da, by the red slip: the request on the button, its preview, his yes
  await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
  expect(await followTheSlip(page)).toBe("li_da");
  await theFaceOfTheTalk(page);
  await askFor(page, "material");
  await expect(page.getByTestId("request-asks").locator("dd")).toHaveText("请李大把竹料送到桥边。要是答应，明早07:00前先送四根。");
  await goAhead(page);
  await expect(page.getByTestId("request-result")).toHaveAttribute("data-ok", "true");
  // The press may have been sent twice: the core turns back a press whose preview is out of date (the hold it was taken in ended before the press) and
  // the card asks for a new preview and presses again. That is a press the core did not apply, so what counts is the one promise that came of them.
  const sent = (await appliedActions(lantern)).filter((a) => a.type === "entrust" && a.kind === "material");
  // At least one press was sent, and every one by the button, with no note cited and no person named in it.
  expect(sent.length).toBeGreaterThanOrEqual(1);
  for (const action of sent) expect(action).toMatchObject({ cite: [], target: "" });
  await page.getByTestId("board-toggle").click();
  await expect(page.getByTestId("commitment")).toHaveCount(1);
  await expect(page.getByTestId("commitment")).toHaveAttribute("data-state", "promised");
  await page.getByTestId("board-toggle").click();
  // He is in the book of the people now with the hearts, and the bamboo he promised is on the slip with the hour it comes.
  expect(await peopleBook(page)).toEqual(["li_laotai", "cha_laoban", "zhou_huoji", "li_da"]);
  await expect(page.getByTestId("task-window")).toHaveText("石桥，第二天 卯时 06:00 到 07:00");
  await expect(page.getByTestId("task-do")).toHaveCount(0);
}

test.describe("a new player's first day", () => {
  test("goes from the opening page to the clarification at the teahouse and Li Da's first promise", async ({ lantern }) => {
    test.setTimeout(900_000);
    await theFirstEvening(lantern);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes on to the next morning, when the bamboo is at the bridge and the card of the first day done comes", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    await theFirstEvening(lantern);
    // The night: the summary holds the world, the player puts it away and waits for what Li Da promised, and the elder does not come by.
    await leave(page);
    const night = page.getByTestId("night");
    await expect(night).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("night-changed-text")).toHaveText("李老太松口了。");
    await expect(page.getByTestId("night-step")).toHaveAttribute("data-id", "t_bamboo_first");
    await page.getByTestId("night-done").click();
    await expect(night).toHaveCount(0);
    await clockReaches(page, 5, 50, 2);
    await expect(page.getByTestId("elder")).toHaveCount(0);
    const morning = await page.waitForFunction(() => (window.__lantern.play.guide.elder.open ? "the elder came by" : window.__lantern.view.stats().pile === "small" ? "the pile" : false), undefined, {
      timeout: 120_000,
      polling: 300,
    });
    expect(await morning.jsonValue()).toBe("the pile");
    // The paper of the morning comes first and holds the world; the card of the first day done follows it when the paper is put away.
    const paper = page.getByTestId("gazette");
    await expect(paper).toBeVisible();
    await expect(page.getByTestId("gazette-head")).toHaveText("李大答应的四根竹料，已经送到石桥。");
    const end = page.getByTestId("end-card");
    await expect(end).toHaveCount(0);
    const held = await clockOf(page);
    await page.waitForTimeout(1500);
    expect(await clockOf(page)).toEqual(held);
    await page.getByTestId("gazette-close").click();
    await expect(end).toBeVisible();
    await expect(page.getByTestId("end-title")).toHaveText("第一天过完了");
    await expect(page.getByTestId("end-reached")).toHaveText("第一批竹料送到了石桥。灯会在第五天晚上。在那之前，还要把桥修好，把桥是怎么坏的当众说清，再让两家和好。");
    await page.getByTestId("end-close").click();
    await expect(end).toHaveCount(0);
    await expect(page.getByTestId("topbar-task-text")).toHaveText("凑齐竹料");
    // Li Da's hearts moved with what he did, and the book of the people says when and where the player met him.
    expect(await peopleBook(page)).toContain("li_da");
    expect(lantern.pageErrors).toEqual([]);
  });
});
