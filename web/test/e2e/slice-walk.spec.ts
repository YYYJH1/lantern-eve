import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { appliedActions, clockOf, closeElder, eventsOf, leaveTalk, notebookCount, untilHeld, untilSettled, waitForClock } from "../support/real.ts";
import { clearTheMap, openTheNote } from "../support/play.ts";

// The game the opening page starts, from the opening page to the morning of the second day, played in Chinese through the page the way a player plays it, on
// the real core in the browser host (Pyodide): the paper of the next morning, the card that says the first day is done after it, and then
// what the core has for the days after: the task of the rest of the bamboo in the bar and on the card, the other tasks of the second day, the
// preparation board with the numbers of the bridge, the truth and the peace, and the elder, who comes by when nothing has moved. The
// elder's tutorial leads the first steps, and the rest is what the task card, the notebook and the cards of the people say. Nothing is
// fed to the page by hand.
test.use({ map: true, locale: "zh-CN", actionTimeout: 20_000 });

/** A day of the game is about a minute. The people of the town are where their routines put them, and the player walks to them. */
const GAME = "pace=3";

let shots = 0;
/**
 * A picture of the step, in Chinese on the light theme, taken when LANTERN_SHOTS_DIR names a folder. The walk is the same with or without it.
 * With a `size` the page has that size for the picture and is put back after it.
 */
async function snap(page: Page, name: string, settleMs = 400, size?: { width: number; height: number }): Promise<void> {
  const dir = process.env.LANTERN_SHOTS_DIR ?? "";
  if (dir === "") return;
  mkdirSync(dir, { recursive: true });
  shots += 1;
  const before = page.viewportSize();
  if (size !== undefined) await page.setViewportSize(size);
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: path.join(dir, `slice-walk-${String(shots).padStart(2, "0")}-${name}-zh-light.png`) });
  if (size !== undefined && before !== null) await page.setViewportSize(before);
}

/** Opens the list of choices of a verb of the talk. The button of a task has opened it already when the task asked for that verb. */
async function openList(page: Page, verb: string): Promise<void> {
  if ((await page.getByTestId(`picker-${verb}`).count()) === 0) await page.getByTestId(`verb-${verb}`).click();
  await expect(page.getByTestId(`picker-${verb}`)).toBeVisible();
}

/**
 * Has the request of the talk ready for the preview: picks it from the list the task's button opened, unless the task named the request and
 * the page has it up already.
 */
async function askFor(page: Page, offer: string): Promise<void> {
  if ((await page.getByTestId("request-card").count()) === 0) {
    await openList(page, "entrust");
    await page.locator(`[data-testid="picker-option"][data-id="${offer}"]`).click();
  }
  await expect(page.getByTestId("request-card")).toHaveAttribute("data-phase", "preview");
}

/**
 * Does something in the talk and waits until the person has answered it and, unless `paid` is false, the minutes of it are paid for (or
 * the person has gone). A card of the tutorial that comes up with the answer holds the world, and the minutes wait for the player to put it away.
 */
async function answeredAfter(page: Page, act: () => Promise<void>, paid = true): Promise<void> {
  const before = await page.evaluate(() => window.__lantern.play.state.talk?.lines.length ?? 0);
  await act();
  await page.waitForFunction((n) => (window.__lantern.play.state.talk?.lines.length ?? n + 2) >= n + 2, before, { timeout: 30_000 });
  if (paid) await untilSettled(page);
}

/** Picks a person by clicking their piece on the map, as a player does, again if they have moved on, and does not click a person who is picked already. */
async function pick(page: Page, id: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await closeElder(page);
        const picked = (): Promise<string | null> => page.getByTestId("person-card").getAttribute("data-person", { timeout: 300 }).catch(() => null);
        if ((await picked()) === id) return id;
        const spot = await page.evaluate((who) => window.__lantern.view.screenPositionOf(who), id);
        if (spot !== null) {
          await clearTheMap(page);
          await page.getByTestId("map").click({ position: spot, timeout: 4000 }).catch(() => undefined);
        }
        return picked();
      },
      { timeout: 60_000, intervals: [300] },
    )
    .toBe(id);
}

/**
 * Waits until the game's clock is at or past `hour`:`minute` of day `day` and puts no card away, as `waitForClock` does for a player who is
 * waiting for the day to go on, and fails at once if the clan elder comes by on the way.
 */
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
 * The button of the task card, pressed until the page has walked the player up to someone and opened a talk with them, as the game
 * has it. The person may be busy or have moved on by the time the player is there, and then the button is pressed again.
 */
async function followTask(page: Page): Promise<string> {
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

test.describe("the game the opening page starts", () => {
  test("is played from the opening page to the end of the first day", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    const card = page.getByTestId("tutorial-card");

    // --- 1. The opening page, and the elder's tutorial
    await page.goto(`${lantern.servers.app.origin}/?${GAME}`);
    await lantern.waitReady();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(page.getByTestId("opening-title")).toHaveText("灯会前夕");
    await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
    await snap(page, "opening-page");
    await page.getByTestId("opening-start").click();
    await expect(card).toHaveAttribute("data-step", "goal");
    await expect(page.getByTestId("tutorial-step")).toHaveText("带教 第 1 步，共 6 步");
    await expect(page.getByTestId("tut-task")).toContainText("取得李家的第一批竹料");
    await snap(page, "tutorial-goal");
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveAttribute("data-step", "ask");
    await expect(card).toContainText("李老太");
    await snap(page, "tutorial-ask");
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveCount(0);
    await expect(page.getByTestId("tutorial-line")).toHaveText("去李老太那里，求竹料。");

    // --- 2. Granny Li refuses the bamboo: the button of the elder's line walks the player up to her, and the request is asked for
    expect(await followTask(page)).toBe("li_laotai");
    await snap(page, "talking-to-granny-li");
    await expect(page.getByTestId("verb-entrust")).toHaveClass(/is-signal/);
    await askFor(page, "lend");
    await snap(page, "request-preview");
    await page.getByTestId("request-confirm").click();
    await expect(card).toHaveAttribute("data-step", "refusal", { timeout: 90_000 });
    await expect(page.getByTestId("tut-blocker").locator("dd")).toHaveText("李家不肯给竹料");
    await expect(page.getByTestId("tut-next").locator("dd")).toHaveText("问清这话是从哪里传出来的。");
    await snap(page, "granny-li-refuses");
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveAttribute("data-step", "source");
    await page.getByTestId("tutorial-next").click();
    await expect(card).toHaveCount(0);
    // The person card has one button for asking Granny Li, though two tasks end in asking her.
    await expect(page.getByTestId("person-card")).toHaveAttribute("data-person", "li_laotai");
    await expect(page.getByTestId("person-card").getByTestId("person-task")).toHaveCount(1);
    await expect(page.getByTestId("person-card").getByTestId("person-task")).toHaveText("问问李老太");
    // What the town says of her is one line in a talk, which opens on a click.
    await expect(page.getByTestId("person-bio")).toHaveAttribute("data-folded", "true");
    await expect(page.getByTestId("person-bio-text")).toBeHidden();
    await snap(page, "person-card-in-a-talk");

    // --- 3. The rumour, back to Zhou's clerk. Each time the task card says whom to ask next: Granny Li about Li Er, then the one she
    // heard it from, and the one that one heard it from. The button walks the player there and opens the list of notes to ask the source of.
    // The talk folded the note of the slip: the player opens it to press the phrase that asks the source.
    await openTheNote(page);
    await page.getByTestId("task-do").click();
    await closeElder(page);
    await expect(page.getByTestId("topic-chips")).toBeVisible();
    await answeredAfter(page, () => page.locator('[data-testid="topic-chip"][data-id="li_er"]').click());
    expect(await notebookCount(page)).toBe(1);
    await page.getByTestId("person-card").scrollIntoViewIfNeeded();
    await snap(page, "granny-li-says-what-she-heard");
    await leave(page);
    for (const next of ["cha_laoban", "zhou_huoji"]) {
      await closeElder(page);
      await expect(page.getByTestId("task-do")).toContainText("听谁说的");
      const who = await followTask(page);
      expect(who).toBe(next);
      await expect(page.getByTestId("picker-askSource")).toBeVisible();
      await snap(page, `asking-${next}-who-told-them`);
      if (next === "zhou_huoji") {
        // The clerk is the last of the line. The tutorial's card of the next step comes up with his answer, and the world waits under it.
        await answeredAfter(page, () => page.getByTestId("picker-option").first().click(), false);
        break;
      }
      await answeredAfter(page, () => page.getByTestId("picker-option").first().click());
      await snap(page, `${next}-answers`);
      await leave(page);
    }
    expect(await notebookCount(page)).toBe(2);

    // --- 4. Judge the pair: what the clerk saw does not support what the town says. The tutorial sets the pair up, and the notebook
    // is open with it. The player judges it.
    await expect(card).toHaveAttribute("data-step", "compare", { timeout: 60_000 });
    await expect(page.getByTestId("tutorial-step")).toHaveText("带教 第 5 步，共 6 步");
    await expect(page.getByTestId("tut-relation")).toHaveText("后一句超出了前一句的证据");
    await expect(page.getByTestId("notebook")).toHaveAttribute("data-open", "true");
    await expect(page.getByTestId("pair-first")).toContainText("李二昨夜在石桥。");
    await expect(page.getByTestId("pair-second")).toContainText("眼红别人在灯会上出风头");
    await expect(page.getByTestId("rel-unsupported")).toHaveAttribute("aria-checked", "true");
    await snap(page, "tutorial-compare");
    await page.getByTestId("tutorial-next").click();
    await page.getByTestId("pair-judge").click();
    await expect(page.getByTestId("pair-outcome")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("pair-outcome")).toHaveText("判得对，记进你的判断里了。");
    await expect(page.getByTestId("judgment")).toHaveCount(1);
    await expect(page.getByTestId("judgment")).toHaveAttribute("data-relation", "unsupported");
    await expect(page.getByTestId("judgment-where")).toBeVisible();
    await expect(page.getByTestId("judgment-clarify")).toBeDisabled();
    const pair = { a: (await page.getByTestId("judgment").getAttribute("data-a")) ?? "", b: (await page.getByTestId("judgment").getAttribute("data-b")) ?? "" };
    await snap(page, "judged");
    await page.getByTestId("notebook-close").click();
    await leave(page);

    // --- 5. At the teahouse in the evening: the elder's last card says when and where, and the world goes on until then
    await expect(card).toHaveAttribute("data-step", "evening", { timeout: 90_000 });
    await expect(page.getByTestId("tutorial-step")).toHaveText("带教 第 6 步，共 6 步");
    await expect(page.getByTestId("tut-when")).toContainText("茶馆，第一日 酉时 17:00 到 19:00");
    await snap(page, "tutorial-evening");
    await page.getByTestId("tutorial-next").click();
    await expect(page.getByTestId("game-note").last()).toHaveText("带教走完了。往后有难处，随时来问族长。");
    // The judgement is done, and the core follows the task that asks for the rumour to be set straight, with the evening at the teahouse for
    // its window. Nothing has to be picked: the bar tells the player what is next. The button that goes to the teahouse comes at four.
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_clear_rumour");
    await expect(page.getByTestId("topbar-task-text")).toHaveText("「李二毁桥」这话还没有当众说清");
    await expect(page.getByTestId("task-changed")).toContainText("接着追踪");
    await expect(page.getByTestId("task-next")).toContainText("用你判对了的两句话，当众说清。");
    await expect(page.getByTestId("task-window")).toHaveText("茶馆，酉时 17:00 到 19:00");
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await waitForClock(page, 16, 5);
    await expect(page.getByTestId("task-do")).toHaveText("去茶馆");
    await page.getByTestId("task-do").click();
    await expect(page.getByTestId("verb-speak")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("cost-speak")).toHaveText("三十分钟");
    // The people have come by a quarter to six, and the player is among them.
    await waitForClock(page, 17, 45);
    await snap(page, "the-teahouse-in-the-evening");

    // Clear it up in public: the pair that was judged, said to the people there, and the panel of what each of them made of it
    await page.getByTestId("btn-notebook").click();
    const row = page.locator(`[data-testid="judgment"][data-a="${pair.a}"][data-b="${pair.b}"]`);
    await expect(row.getByTestId("judgment-clarify")).toBeEnabled();
    await expect(row.getByTestId("judgment-clarify").getByTestId("cost-clarify")).toHaveText("三十分钟");
    await expect(page.getByTestId("judgment-where")).toHaveCount(0);
    await snap(page, "use-it-to-clear-it-up");
    const before = await clockOf(page);
    await row.getByTestId("judgment-clarify").click();
    const sheet = page.getByTestId("clarify");
    await expect(sheet).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("clarify-claim")).toContainText("眼红别人在灯会上出风头");
    const hearers = page.getByTestId("hearer");
    await expect.poll(() => hearers.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
    const stands = await hearers.evaluateAll((els) => els.map((el) => [el.getAttribute("data-before"), el.getAttribute("data-after")]));
    for (const [from, to] of stands) {
      expect(["against", "unsure", "for"]).toContain(from);
      expect(["against", "unsure", "for"]).toContain(to);
    }
    await expect(page.getByTestId("hearer-reason").first()).not.toBeEmpty();
    await expect(page.getByTestId("hearer-change").first().getByTestId("stance-before")).toBeVisible();
    await expect(page.getByTestId("hearer").filter({ hasText: "李老太" })).toHaveCount(1);
    const clarified = (await eventsOf(page, "clarified")).at(-1) as { accepted: number; audience: Array<{ npc: string; before: string; after: string }>; venue: string };
    expect(clarified.venue).toBe("p_teahouse");
    expect(clarified.audience.map((h) => [h.before, h.after])).toEqual(stands);
    expect(clarified.accepted).toBeGreaterThanOrEqual(4);
    // The people come in one after the other, and the picture waits for the last.
    await expect(page.getByTestId("clarify-sum")).toBeVisible({ timeout: 30_000 });
    await snap(page, "the-people-there-answer", 1500);

    // --- 6. Granny Li withdraws her objection: the core says so, and the page says it in words
    expect((await eventsOf(page, "objection_withdrawn")).at(-1)).toMatchObject({ npc: "li_laotai", what: "bamboo" });
    await expect(page.getByTestId("game-note").filter({ hasText: "李老太不再阻拦竹料了。" })).toHaveCount(1);
    await page.getByTestId("clarify-done").click();
    await page.getByTestId("notebook-close").click();
    // The half hour is paid for once the notebook is shut: the clock goes by at the fast rate, and holds no more.
    await expect.poll(async () => (await clockOf(page)).minutes - before.minutes, { timeout: 30_000 }).toBeGreaterThanOrEqual(30);

    // --- 7. Ask Li Da, with the preview first: the task card now says to ask him, and its button walks the player up to him
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
    await expect(page.getByTestId("task-next")).toContainText("请李大把第一批竹料送到桥边。");
    expect(await followTask(page)).toBe("li_da");
    await askFor(page, "material");
    const request = page.getByTestId("request-card");
    // The title says who is asked and not what: the card says what below it, and the offer's own words begin with 请 as well.
    await expect(request.locator(".request-title")).toHaveText("请李大");
    await expect(page.getByTestId("request-asks").locator("dd")).toHaveText("请李大把竹料送到桥边（李大应下的话：先送四根，明早07:00前）");
    await expect(page.getByTestId("request-blockers")).toContainText("你还不知道有什么拦着");
    await expect(page.getByTestId("request-cost")).toHaveAttribute("data-minutes", "20");
    await expect(page.getByTestId("request-confirm")).toBeEnabled();
    expect((await appliedActions(lantern)).filter((a) => a.type === "entrust" && a.kind === "material")).toEqual([]);
    await snap(page, "li-da-preview");

    // --- 8. Li Da promises: the answer is where the preview was, and what he agreed is in the ledger
    await page.getByTestId("request-confirm").click();
    await expect(request).toHaveAttribute("data-phase", "result");
    await expect(page.getByTestId("request-result")).toHaveAttribute("data-ok", "true");
    await expect(page.getByTestId("request-result")).toHaveText("李大答应了。");
    await expect(page.getByTestId("request-spent")).toHaveText("这花了二十分钟。");
    // What he agreed is a line in the ledger, which is opened for the look and shut again, since it lies over the talk.
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("commitment")).toHaveCount(1);
    await expect(page.getByTestId("commitment")).toHaveAttribute("data-state", "promised");
    await page.getByTestId("board-toggle").click();
    const sent = (await appliedActions(lantern)).filter((a) => a.type === "entrust" && a.kind === "material");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveProperty("version");
    // The bamboo waits for the morning and no other task is on yet (the lead on how the bridge broke comes on the afternoon of the second
    // day, the timber and the helpers on the second morning), so the core goes on following it.
    const task = page.getByTestId("task-card");
    // The task card says what is true now: Li Da has promised, and there is nobody left to ask and no button for it.
    await expect(task).toHaveAttribute("data-id", "t_bamboo_first");
    await expect(task).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("task-why")).toHaveText("李大答应了，把四根竹料送到桥边。");
    await expect(page.getByTestId("task-next")).toHaveText("按约好的时间去桥边，看竹料送到没有。");
    // The time is the promise's own: from the hour he sets out to the hour it is due, at the bridge.
    await expect(page.getByTestId("task-window")).toHaveText("石桥，第二日 卯时 06:00 到 07:00");
    await expect(page.getByTestId("task-do")).toHaveCount(0);
    await expect(task).not.toContainText("请李大把第一批竹料送到桥边。");
    await snap(page, "li-da-promises");

    // --- 9. Leave the evening and let the night come. At dusk the summary of the night is up and holds the world: what changed today (Granny Li no
    // longer stands in the way), what is still in the way, and the first step of tomorrow, which is the promise's own time and place. The player puts
    // it away and waits for what Li Da promised, and is right to: the clan elder does not come by to say they look stuck, neither in the evening nor
    // over the night nor at dawn, and no card is put away on the way.
    await leave(page);
    await expect(page.getByTestId("status")).toHaveText("进行中");
    const nightCard = page.getByTestId("night");
    await expect(nightCard).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("night-issue")).toContainText("第一日");
    await expect(page.getByTestId("night-changed-text")).toHaveText("李老太撤回了阻拦。");
    await expect(page.getByTestId("night-blocked-text")).not.toHaveText("");
    await expect(page.getByTestId("night-step")).toHaveAttribute("data-id", "t_bamboo_first");
    await expect(page.getByTestId("night-step-when")).toHaveText("石桥，卯时 06:00 到 07:00");
    await expect(page.getByTestId("status")).toHaveText("已暂停");
    const heldAtDusk = await clockOf(page);
    await page.waitForTimeout(1500);
    expect(await clockOf(page)).toEqual(heldAtDusk);
    await snap(page, "the-night-summary");
    await page.getByTestId("night-done").click();
    await expect(nightCard).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("进行中");
    await clockReaches(page, 22, 0);
    await snap(page, "the-night-passes");
    await clockReaches(page, 5, 50, 2);
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_bamboo_first");
    await expect(page.getByTestId("task-next")).toHaveText("按约好的时间去桥边，看竹料送到没有。");
    // It is the second day now, so the slip leaves the day out.
    await expect(page.getByTestId("task-window")).toHaveText("石桥，卯时 06:00 到 07:00");
    await snap(page, "the-next-dawn");

    // --- 10. In the morning the bamboo is at the bridge: the pile is drawn, and the board and his card say delivered
    const pile = (): Promise<string> => page.evaluate(() => window.__lantern.view.stats().pile);
    expect(await pile()).toBe("none");
    // The bamboo comes with the morning, and the elder has not come by: the night did not count against the player, and the wait for what
    // was promised was not theirs to shorten.
    const morning = await page.waitForFunction(() => (window.__lantern.play.guide.elder.open ? "the elder came by" : window.__lantern.view.stats().pile === "small" ? "the pile" : false), undefined, {
      timeout: 120_000,
      polling: 300,
    });
    expect(await morning.jsonValue()).toBe("the pile");
    await expect(page.getByTestId("elder")).toHaveCount(0);
    await expect(page.getByTestId("game-note").filter({ hasText: "四根竹料送到了石桥。" })).toHaveCount(1);
    // The paper of the morning comes with it, over the map, with the pile under it. It holds the world.
    const recap = page.getByTestId("gazette");
    await expect(recap).toBeVisible();
    await snap(page, "the-bamboo-is-at-the-bridge");
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("board")).toBeVisible();
    const bamboo = page.locator('[data-testid="board-material"][data-item="bamboo"]');
    await expect(bamboo).toHaveAttribute("data-promised", "4");
    await expect(bamboo).toHaveAttribute("data-delivered", "4");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "4");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toContainText("到四根");
    await snap(page, "the-board");
    // The ledger has what was promised, a line each, and the first one has its seal 送到 on it.
    await expect(page.getByTestId("commitment")).toHaveAttribute("data-state", "delivered");
    await expect(page.getByTestId("commitment").locator(".stamp-delivered")).toHaveCount(1);
    await page.getByTestId("board-toggle").click();
    // His card says it too: delivered, and not promised any more.
    await pick(page, "li_da");
    await expect(page.getByTestId("person-commitment")).toHaveAttribute("data-state", "delivered");
    await expect(page.getByTestId("person-commitment").getByTestId("commitment-state")).toHaveText("已送到");
    await snap(page, "his-card-says-delivered");

    // --- 11. The paper has a headline and two short items, what is on today and the street talk, and stays, with the world held, until the player closes it.
    // The items are the objection Granny Li took back and the head of the Zhou family who stopped speaking ill of the other family in public, which
    // he did when the claim was set straight in front of him at the teahouse (the promise of the bamboo is the headline's own story).
    await expect(page.getByTestId("gazette-head")).toHaveText("李大答应的四根竹料，已经送到石桥。");
    await expect(page.getByTestId("gazette-item")).toHaveText(["李老太撤回了阻拦。", "周掌柜当着众人，不再说对方家的不是了。"]);
    await expect(page.getByTestId("gazette-talk-line").first()).not.toHaveText("");
    await expect(page.getByTestId("gazette-today")).toHaveAttribute("data-id", "t_bamboo_rest");
    // the hours are in figures, and the day is not said again on the paper of that day
    await expect(page.getByTestId("gazette-today-when")).toHaveText(/(卯|辰|巳|午|未|申|酉|戌)时 \d\d:\d\d 到 \d\d:\d\d$/);
    await expect(page.getByTestId("status")).toHaveText("已暂停");
    const heldByPaper = await clockOf(page);
    await page.waitForTimeout(1500);
    expect(await clockOf(page)).toEqual(heldByPaper);
    await expect(recap).toBeVisible();
    // The bamboo landed before seven, and the card that says the first day is done follows the paper: it is not up while the paper is.
    const end = page.getByTestId("end-card");
    await expect(end).toHaveCount(0);
    await snap(page, "the-paper");
    await page.getByTestId("gazette-close").click();
    await expect(recap).toHaveCount(0);

    // --- 12. The paper is away, and the card says the first day is done: what was done, what is left, and the elder who stays home. The world waits for it.
    await expect(end).toBeVisible();
    await expect(page.getByTestId("end-title")).toHaveText("第一天完成");
    await expect(page.getByTestId("end-reached")).toHaveText("第一批竹料送到了石桥。灯会在第五天晚上，在那之前还要：凑齐竹料和木料，把桥修好；查清桥是怎么坏的，当众说清；让两家和解。");
    await expect(page.getByTestId("end-more")).toHaveCount(0);
    await expect(page.getByTestId("end-close")).toHaveText("接着玩");
    await expect(page.getByTestId("status")).toHaveText("已暂停");
    const held = await clockOf(page);
    await page.waitForTimeout(1500);
    expect(await clockOf(page)).toEqual(held);
    await snap(page, "the-first-day-is-done", 600, { width: 1280, height: 760 });
    await page.getByTestId("end-close").click();
    await expect(end).toHaveCount(0);
    await expect(page.getByTestId("status")).toHaveText("进行中");

    // --- 13. The core has the tasks of the days after, and follows the next of them now that the bamboo of the first day is at the bridge: the rest
    // of the bamboo, which the bridge still lacks. The bar and the card say so, with the reason of the change; the other tasks of the second
    // morning are the timber (the helpers are asked for once a batch after the first is promised, or from the afternoon; the lead on how the
    // bridge broke comes at noon, the peace on the third morning).
    await expect(page.getByTestId("topbar-task-text")).toHaveText("凑齐竹料");
    const next = page.getByTestId("task-card");
    await expect(next).toHaveAttribute("data-id", "t_bamboo_rest");
    await expect(next).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("task-changed")).toHaveText("「取得李家的第一批竹料」办成了，接着追踪「凑齐竹料」");
    await expect(page.getByTestId("task-why")).toHaveText("桥要十根竹料，桥边才有四根。");
    await expect(page.getByTestId("task-next")).toHaveText("再请李大送一批。");
    await expect(page.getByTestId("task-do")).toHaveText("请李大帮忙");
    expect(await page.getByTestId("task-other").evaluateAll((els) => els.map((el) => el.getAttribute("data-id")))).toEqual(["t_timber"]);
    await snap(page, "the-next-task");

    // The preparation board has the numbers of the real core: what the bridge takes of each item against what lies there, nobody helping
    // yet, no work done, the first morning of work and the deadline, the truth not yet set straight in public, and the peace still far off.
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("board")).toBeVisible();
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-delivered", "4");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-site", "4");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-need", "10");
    await expect(page.locator('[data-testid="board-material"][data-item="timber"]')).toHaveAttribute("data-site", "0");
    await expect(page.locator('[data-testid="board-material"][data-item="timber"]')).toHaveAttribute("data-need", "8");
    await expect(page.getByTestId("board-helper")).toHaveText(["李家零人", "周家零人"]);
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("有零人");
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveAttribute("data-need", "5");
    await expect(page.getByTestId("board-both")).toHaveText("两家各至少要一人");
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "0");
    await expect(page.getByTestId("board-hours")).toContainText("要十个钟头");
    await expect(page.getByTestId("board-window")).toContainText("第三日 辰时 08:00 到 12:00，石桥");
    await expect(page.getByTestId("board-deadline")).toContainText("第四日 18:00");
    await page.getByTestId("board-tab-truth").click();
    await expect(page.getByTestId("truth-state")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("truth-need")).toHaveText(["至少五个有名有姓的人在场", "在场的人里六成以上接受", "族长也接受"]);
    await page.getByTestId("board-tab-peace").click();
    await expect(page.getByTestId("peace-act")).toHaveCount(3);
    await expect(page.getByTestId("peace-witness")).toHaveText("还缺公开见证");
    await snap(page, "the-board-of-the-second-day", 400, { width: 1280, height: 1100 });
    await page.getByTestId("board-tab-peace").click();

    // --- 14. The player waits for what the card asks and does not do it. The world goes on, and neither the paper nor the card of the first day
    // comes back. With a task open, when nothing has moved for a few hours the elder comes by, and says the next step of the card.
    await page.waitForFunction(() => window.__lantern.play.guide.elder.open, undefined, { timeout: 150_000, polling: 300 });
    await expect(recap).toHaveCount(0);
    await expect(end).toHaveCount(0);
    await expect(page.getByTestId("elder-lead")).toHaveText("族长找你来了。看你一时没了主意。");
    await expect(page.getByTestId("elder-text")).toHaveText("往这边想想：再请李大送一批。");
    await snap(page, "the-elder-comes-by");
    await page.getByTestId("elder-close").click();
    await expect(page.getByTestId("topbar-task-text")).toHaveText("凑齐竹料");
    expect(lantern.pageErrors).toEqual([]);
  });
});
