import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { asPlayer, frameOf, letGo, loadMoment, recordFollower, type Seen } from "../support/follower.ts";

// The days after the first, on frames of the real core. The page of the game the opening page starts loads a recording of the follower
// (tools/bots/follower.py), a manager who does only what the top bar says, made by the core under CPython and put into the browser as a save:
// the core in the browser (Pyodide) plays it again tick by tick and checks every hash on the way, and the page shows what it makes of the real
// frames at that moment. Nothing is fed to the page by hand: the top bar, the task card and the preparation board are read off the page and
// compared with the frame the page was given. The paper of the morning and the summary of the night are the cards that the real core makes at
// seven and at dusk: the recording is made a few minutes before, the world is let go, and the card that comes is read against what the page
// kept from the frame that had it. The pictures are taken when LANTERN_SHOTS_DIR names a folder.
test.use({ map: true });

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";

/** What the page kept of the paper of the morning and of the summary of the night, from the frame of the call that made them. */
interface Kept {
  gazette: { day: number; head: { kind: string; text: { zh: string; en: string } }; news: Array<{ kind: string; text: { zh: string; en: string } }>; today: { id: string; text: { zh: string; en: string }; window: { day: number } | null } | null; more: Array<{ id: string }>; talk: Array<{ kind: string }> } | null;
  night: { day: number; changed: { kind: string; text: { zh: string; en: string } }; blocked: { id: string } | null; step: { id: string; window: { day: number } | null } | null } | null;
}

const keptOf = (page: Page): Promise<Kept> =>
  page.evaluate(() => {
    const flows = window.__lantern.play.flows.state;
    return { gazette: (flows.recap?.gazette ?? null) as unknown as Kept["gazette"], night: (flows.night?.night ?? null) as unknown as Kept["night"] };
  });

const holdOn = (page: Page): Promise<boolean> => page.evaluate(() => window.__lantern.play.hold.active);

let shots = 0;
const picture = (name: string, tag: string, more = ""): string => path.join(SHOTS, `days-real-${String(++shots).padStart(2, "0")}-${name}-${tag}${more}.png`);

/** A picture of the page as it stands: the bar, the card and the town. */
async function snap(page: Page, name: string, tag: string): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: picture(name, tag) });
}

/** Two pictures of the preparation board: the column scrolled to it at the size of the page, and the whole of it in a page made tall enough to hold it. */
async function snapBoard(page: Page, name: string, tag: string, size: { width: number; height: number }): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  const board = page.getByTestId("board");
  await board.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await page.screenshot({ path: picture(name, tag) });
  await page.setViewportSize({ width: size.width, height: 1900 });
  await board.evaluate((el) => el.scrollIntoView({ block: "start" }));
  await page.waitForTimeout(600);
  await board.screenshot({ path: picture(name, tag, "-whole") });
  await page.setViewportSize(size);
}

/** Opens the preparation board in the column, if it is shut, and waits until its numbers are in view. */
async function openBoard(page: Page): Promise<void> {
  const toggle = page.getByTestId("board-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByTestId("board-bridge")).toBeVisible();
}

test.describe("the days after the first, on the real core, in Chinese on the light theme", () => {
  test.use({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1280, height: 760 } });

  test("the morning of the second day: a later batch of bamboo is promised, and the bar and the board say what the real frame has", async ({ lantern }) => {
    test.setTimeout(600_000);
    const page = lantern.page;
    // five past seven: the bar was on the timber while the bamboo waited, and goes back to it when its window opens at seven
    const recording = recordFollower(2, 7, 5);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "second morning", recording);
    const frame = await frameOf(page);
    expect(frame.time).toMatchObject({ day: 2, hour: 7 });
    // the second batch is promised and the first lies at the bridge: the rest of the bamboo is the task that is followed, and it waits
    expect(frame.tracked).toBe("t_bamboo_rest");
    const task = frame.tasks.find((t) => t.id === "t_bamboo_rest");
    expect(task).toMatchObject({ state: "open", action: null });
    expect(task?.window).toMatchObject({ day: 2, place: "p_bridge" });
    await expect(page.getByTestId("topbar-task-text")).toHaveText("凑齐竹料");
    const card = page.getByTestId("task-card");
    await expect(card).toHaveAttribute("data-id", "t_bamboo_rest");
    await expect(page.getByTestId("task-why")).toHaveText("桥要十根竹料，到了四根，李大又答应送四根。");
    await expect(page.getByTestId("task-next")).toHaveText("按约好的时间去桥边，看竹料送到没有。");
    await expect(page.getByTestId("task-window")).toHaveText("石桥，辰时 07:00 到 10:00"); // today: the day is left out
    await expect(page.getByTestId("task-do")).toHaveCount(0); // nothing to do but be there
    await snap(page, "second-morning-bar", "zh-light-1280x760");
    await openBoard(page);
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-site", "4");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-need", "10");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toContainText("要十根");
    await expect(page.locator('[data-testid="board-material"][data-item="timber"]')).toHaveAttribute("data-site", "0");
    await expect(page.locator('[data-testid="board-material"][data-item="timber"]')).toHaveAttribute("data-need", "8");
    await expect(page.getByTestId("board-tab-truth")).toHaveAttribute("data-state", "open");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-promised", "8");
    await expect(page.locator('[data-testid="board-material"][data-item="bamboo"]')).toHaveAttribute("data-delivered", "4");
    await snapBoard(page, "second-morning-board", "zh-light-1280x760", { width: 1280, height: 760 });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the morning of the third day: the bridge waits for the work, and the truth and the peace are still to come", async ({ lantern }) => {
    test.setTimeout(600_000);
    const page = lantern.page;
    // five past eight: the helpers have been asked and are on their way, and the window of the work is the one that closes soonest, so the work
    // is the task that is followed (before eight the promises that fall due this morning have the bar, and the follower keeps them)
    const recording = recordFollower(3, 8, 5);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "third morning", recording);
    const frame = await frameOf(page);
    expect(frame.time).toMatchObject({ day: 3, hour: 8 });
    expect(frame.tracked).toBe("t_work_3");
    // the lead on how the bridge broke has been on since the second afternoon and the peace since six this morning: they wait for the days;
    // the promises that are not kept yet have the button on the day they fall due, and not before
    expect(frame.tasks.filter((t) => t.state === "open" && !t.id.startsWith("t_keep_")).map((t) => t.id)).toEqual(["t_work_3", "t_how_broke", "t_tell_town", "t_make_peace"]);
    const owed = frame.tasks.filter((t) => t.id.startsWith("t_keep_") && t.state === "open");
    expect(owed.length).toBeGreaterThan(0);
    expect(owed.every((t) => (t.action === null) === (t.window?.day !== 3))).toBe(true);
    expect(frame.site).toEqual({ bamboo: 10, timber: 8 });
    expect(frame.board.truth.state).toBe("open");
    expect(frame.board.peace).toMatchObject({ state: "open", witnessed: false });
    await expect(page.getByTestId("topbar-task-text")).toHaveText("第三天早上施工");
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_work_3");
    await expect(page.getByTestId("task-next")).toHaveText("早上去桥边，看帮手开工。");
    await expect(page.getByTestId("task-window")).toHaveText("石桥，辰时 08:00 到 12:00");
    await expect(page.getByTestId("task-do")).toHaveCount(1); // the button came at seven, an hour before the window
    await expect(page.getByTestId("task-why")).toHaveText("五个帮手一早上能做五个钟头，桥还差十个钟头。");
    await snap(page, "third-morning-bar", "zh-light-1280x760");
    await openBoard(page);
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "10");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-timber", "8");
    await expect(page.getByTestId("board-both")).toHaveCount(0); // both families have someone: nothing to warn of
    await expect(page.getByTestId("board-helper")).toHaveText(["李家一人", "周家一人", "无家族三人"]);
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveText("有五人");
    await expect(page.getByTestId("board-helpers").locator(".helper-total")).toHaveAttribute("data-need", "5");
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "0");
    await expect(page.getByTestId("board-hours")).toContainText("要十个钟头");
    await expect(page.getByTestId("board-window")).toContainText("第三日 辰时 08:00 到 12:00，石桥");
    await expect(page.getByTestId("board-tab-truth")).toHaveAttribute("data-state", "open");
    await page.getByTestId("board-tab-peace").click();
    await expect(page.getByTestId("board-peace")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("peace-act")).toHaveCount(3);
    await expect(page.getByTestId("peace-act").nth(0)).toHaveAttribute("data-done", "true"); // the heads stopped accusing at the teahouse
    await expect(page.getByTestId("peace-act").nth(1)).toHaveAttribute("data-done", "false");
    await page.getByTestId("board-toggle").click();
    await snapBoard(page, "third-morning-board", "zh-light-1280x760", { width: 1280, height: 760 });
    // it goes on from the recording: the world is let go and the five helpers work at the bridge. An hour each makes five of the ten hours
    // on this morning, and the board says so; the other five are the work of the fourth morning
    await page.getByTestId("board-toggle").click();
    await page.getByTestId("btn-pause").click();
    await page.waitForFunction(() => window.__lantern.client.state.paused === false, undefined, { timeout: 30_000 });
    await page.waitForFunction(() => (window.__lantern.client.state.frame as unknown as Seen).board.hours.done >= 5, undefined, { timeout: 240_000, polling: 500 });
    await openBoard(page);
    const done = await frameOf(page);
    expect(done.board.hours.done).toBe(5);
    await expect(page.getByTestId("board-hours")).toHaveAttribute("data-done", "5");
    await expect(page.getByTestId("board-hours").locator(".tally")).toHaveAttribute("data-n", "5");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the evening of the fifth day: the truth is told, the table is laid, everything is done and the festival night is the task", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    const recording = recordFollower(5, 17, 40); // the truth is told at the teahouse at a quarter past five, and the table laid there
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "fifth evening", recording);
    const frame = await frameOf(page);
    expect(frame.time).toMatchObject({ day: 5, hour: 17 });
    expect(frame.tracked).toBe("t_festival_night");
    expect(frame.board.hours).toEqual({ done: 10, need: 10 });
    await expect(page.getByTestId("topbar-task-text")).toHaveText("灯会之夜");
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", "t_festival_night");
    await expect(page.getByTestId("task-window")).toHaveText("石桥，酉时 18:00 到 21:00");
    await snap(page, "fifth-evening-bar", "zh-light-1280x760");
    await openBoard(page);
    for (const tab of ["board-toggle", "board-tab-truth", "board-tab-peace"]) await expect(page.getByTestId(tab)).toHaveAttribute("data-state", "done");
    await page.getByTestId("board-tab-truth").click();
    await expect(page.getByTestId("truth-state")).toHaveAttribute("data-state", "done");
    await page.getByTestId("board-tab-peace").click();
    await expect(page.getByTestId("peace-state")).toHaveAttribute("data-state", "done");
    await page.getByTestId("board-toggle").click();
    await snapBoard(page, "fifth-evening-board", "zh-light-1280x760", { width: 1280, height: 760 });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the paper and the night, on the real core, in Chinese on the light theme", () => {
  test.use({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1280, height: 760 } });

  test("the paper of the second morning, the summary of the second night and the paper of the third morning come from the real core and hold the world", async ({ lantern }) => {
    test.setTimeout(1_500_000);
    const page = lantern.page;
    const recording = recordFollower(2, 6, 55);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "before the second morning", recording);
    expect((await frameOf(page)).time).toMatchObject({ day: 2, hour: 6, minute: 55 });
    await expect(page.getByTestId("gazette")).toHaveCount(0);
    await asPlayer(page);
    await letGo(page);

    // --- seven o'clock of the second day: the paper, with the headline of the delivery and what is on today
    const paper = page.getByTestId("gazette");
    await expect(paper).toBeVisible({ timeout: 180_000 });
    let kept = await keptOf(page);
    expect(kept.gazette?.day).toBe(2);
    expect(kept.gazette?.head.kind).toBe("delivery");
    await expect(page.getByTestId("gazette-title")).toHaveText("镇报");
    await expect(page.getByTestId("gazette-issue")).toContainText("第二日");
    await expect(page.getByTestId("gazette-head")).toHaveText(kept.gazette?.head.text.zh ?? "");
    await expect(page.getByTestId("gazette-item")).toHaveText((kept.gazette?.news ?? []).map((item) => item.text.zh));
    await expect(page.getByTestId("gazette-talk-line")).toHaveCount(kept.gazette?.talk.length ?? 0);
    expect(kept.gazette?.talk.length).toBeGreaterThanOrEqual(1);
    // what is on today is the task the top bar follows, with its time and place
    const frame = await frameOf(page);
    expect(kept.gazette?.today?.id).toBe(frame.tracked);
    await expect(page.getByTestId("gazette-today")).toHaveAttribute("data-id", frame.tracked ?? "");
    await expect(page.getByTestId("gazette-today-task")).toHaveText(await page.getByTestId("topbar-task-text").innerText());
    // the hours are in figures, and the day is not said again on the paper of that day
    await expect(page.getByTestId("gazette-today-when")).toHaveText(/(卯|辰|巳|午|未|申|酉|戌)时 \d\d:\d\d 到 \d\d:\d\d$/);
    // it holds the world: the clock stands, the bar says so, and the card stays while the frames go on
    expect(await holdOn(page)).toBe(true);
    await expect(page.getByTestId("status")).toHaveText("已暂停");
    const held = await frameOf(page);
    await page.waitForTimeout(1500);
    expect((await frameOf(page)).time).toEqual(held.time);
    await expect(paper).toBeVisible();
    await snap(page, "paper-second-morning", "zh-light-1280x760");
    await page.getByTestId("gazette-done").click();
    await expect(paper).toHaveCount(0);
    await page.waitForFunction(() => window.__lantern.client.state.paused === false, undefined, { timeout: 30_000 });

    // --- dusk of the second day: the summary of the night, which holds the world as well
    const night = page.getByTestId("night");
    await expect(night).toBeVisible({ timeout: 420_000 });
    kept = await keptOf(page);
    expect(kept.night?.day).toBe(2);
    await expect(page.getByTestId("night-issue")).toContainText("第二日");
    await expect(page.getByTestId("night-changed-text")).toHaveText(kept.night?.changed.text.zh ?? "");
    await expect(page.getByTestId("night-blocked")).toHaveAttribute("data-id", kept.night?.blocked?.id ?? "");
    await expect(page.getByTestId("night-step")).toHaveAttribute("data-id", kept.night?.step?.id ?? "");
    if (kept.night?.step?.window != null) expect(kept.night.step.window.day).toBe(3); // tomorrow
    await expect(page.getByTestId("night-blocked-text")).not.toHaveText("");
    await expect(page.getByTestId("night-step-text")).not.toHaveText("");
    expect(await holdOn(page)).toBe(true);
    await expect(page.getByTestId("status")).toHaveText("已暂停");
    await snap(page, "night-second-night", "zh-light-1280x760");
    await page.getByTestId("night-done").click();
    await expect(night).toHaveCount(0);
    await page.waitForFunction(() => window.__lantern.client.state.paused === false, undefined, { timeout: 30_000 });

    // --- seven o'clock of the third day: another paper, the issue of that day
    await expect(paper).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("gazette-issue")).toContainText("第三日");
    kept = await keptOf(page);
    expect(kept.gazette?.day).toBe(3);
    await expect(page.getByTestId("gazette-head")).toHaveText(kept.gazette?.head.text.zh ?? "");
    await expect(paper).toHaveAttribute("data-day", "3");
    await snap(page, "paper-third-morning", "zh-light-1280x760");
    await page.keyboard.press("Escape");
    await expect(paper).toHaveCount(0);
    expect(await holdOn(page)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the setting that turns the night off keeps the card from coming, and the paper of the morning still does", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    const recording = recordFollower(2, 20, 55);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "before the second night", recording);
    await asPlayer(page);
    await page.evaluate(() => window.__lantern.play.flows.setNightOn(false));
    await letGo(page);
    // the dusk of the second day goes by with no card, and the morning after has its paper
    await expect(page.getByTestId("gazette")).toBeVisible({ timeout: 300_000 });
    await expect(page.getByTestId("gazette-issue")).toContainText("第三日");
    expect((await keptOf(page)).night).toBeNull();
    await expect(page.getByTestId("night")).toHaveCount(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

