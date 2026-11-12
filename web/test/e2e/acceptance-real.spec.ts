import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "../support/fixtures.ts";
import { asPlayer, frameOf, letGo, loadMoment, recordFollower } from "../support/follower.ts";
import { fitsWidth } from "../support/slice.ts";

// The statement and the days, on frames of the real core. The page of the game the opening page starts loads a recording of the follower
// (tools/bots/follower.py), a manager who does only what the top bar says, made by the core under CPython and put into the browser as a save: the
// core in the browser (Pyodide) plays it again tick by tick and checks every hash on the way. The recording of the fourth evening is made a few
// minutes after five, when the follower is on its way to the hall where the clan has been called: the card is filled in, and the test walks the
// manager there with the button of the task and makes the full statement from the page. The real option texts are long (the English ones run to a hundred and ninety characters), so each test checks that the card, its options and the
// result panel fit the width of the page and that no text is cut. The pictures are taken when LANTERN_SHOTS_DIR names a folder.
test.use({ map: true });

const SHOTS = process.env.LANTERN_SHOTS_DIR ?? "";

let shots = 0;
const picture = (name: string, tag: string): string => path.join(SHOTS, `acceptance-${String(++shots).padStart(2, "0")}-${name}-${tag}.png`);

/** A picture of the page as it stands. `finished` lets the animations that are running come to their end first: the people who heard a statement come into the panel one after the other, seven tenths of a second apart. */
async function snap(page: Page, name: string, tag: string, finished = false): Promise<void> {
  if (SHOTS === "") return;
  mkdirSync(SHOTS, { recursive: true });
  await page.waitForTimeout(600);
  if (finished) {
    await page.evaluate(() =>
      document.getAnimations().forEach((animation) => {
        try {
          animation.finish();
        } catch {
          // an animation that never ends has no end to come to
        }
      }),
    );
    await page.waitForTimeout(300);
  }
  await page.screenshot({ path: picture(name, tag) });
}

/** Whether the text of every element of a kind stays inside the box it sits in, and the boxes inside the card, so that nothing is cut or overlaps. */
async function nothingCut(page: Page, boxSelector: string, itemSelector: string): Promise<{ cut: string[]; overlapping: number }> {
  return page.evaluate(
    ([boxSel, itemSel]) => {
      const box = document.querySelector<HTMLElement>(boxSel);
      const cut: string[] = [];
      let overlapping = 0;
      if (box === null) return { cut: [`no ${boxSel}`], overlapping };
      const frame = box.getBoundingClientRect();
      const items = [...box.querySelectorAll<HTMLElement>(itemSel)];
      const rects = items.map((el) => el.getBoundingClientRect());
      items.forEach((el, i) => {
        const r = rects[i]!;
        if (el.scrollWidth > el.clientWidth + 1) cut.push(`${el.dataset.id ?? el.className}: scroll ${el.scrollWidth} > client ${el.clientWidth}`);
        if (r.right > frame.right + 1 || r.left < frame.left - 1) cut.push(`${el.dataset.id ?? el.className}: outside the box (${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(frame.left)}..${Math.round(frame.right)})`);
        for (let j = i + 1; j < items.length; j += 1) {
          const q = rects[j]!;
          if (r.width > 0 && q.width > 0 && r.left < q.right - 1 && q.left < r.right - 1 && r.top < q.bottom - 1 && q.top < r.bottom - 1) overlapping += 1;
        }
      });
      return { cut, overlapping };
    },
    [boxSelector, itemSelector] as const,
  );
}

interface Card {
  parts: Array<{ part: string; chosen: string | null; options: Array<{ id: string; text: { zh: string; en: string } }> }>;
  can_state: boolean;
  last: { told: boolean; named: number; accepted: number; elder: string; wrong: string[] } | null;
}

const cardOf = async (page: Page): Promise<Card> => ((await frameOf(page)) as unknown as { statement: Card }).statement;

/** From the recording of the fourth evening: the card is filled in with the right option in each part, the manager walks to the hall by the button of the task, the notebook is turned to the card, and the full statement is made from it. */
async function statementFromTheCard(page: Page, tag: string, lang: "zh" | "en", heldAt: number): Promise<void> {
  const frame = await frameOf(page);
  expect(frame.time).toMatchObject({ day: 4, hour: 17 });
  let card = await cardOf(page);
  // the follower filled it in on the first days, one option in each part, and nothing has been stated yet
  expect(card.parts.map((p) => p.chosen)).not.toContain(null);
  expect(card.last).toBeNull();
  // the clan was called in the afternoon and the hall is open: the task says to go there, and the button walks the manager to it
  expect(frame.tracked).toBe("t_tell_town");
  await expect(page.getByTestId("task-do")).toHaveCount(1);
  await page.getByTestId("task-do").click();
  await page.getByTestId("btn-pause").click(); // a game that is loaded is held: this lets it go
  // The clan stands at the hall from 17:15 to 18:12, which is 114 ticks and about four seconds at the pace of this page, so a test that watches the card and then pauses the
  // world comes too late on a slow machine. The host holds the world itself at `heldAt`, with the manager at the hall and the clan there, as it is for a player who reads the card.
  await page.waitForFunction((tick) => window.__lantern.client.state.paused && window.__lantern.client.state.simTick >= tick, heldAt, { timeout: 240_000 });
  expect((await cardOf(page)).can_state).toBe(true);

  await page.getByTestId("btn-notebook").click();
  // the card is the right page of the book
  await page.getByTestId("workspace-tab-statement").click();
  const sheet = page.getByTestId("statement-card");
  await expect(sheet).toBeVisible();
  await expect(page.getByTestId("statement-part")).toHaveCount(3);
  await expect(page.locator('[data-testid="statement-option"][data-chosen="true"]')).toHaveCount(3);
  // the long texts of the options: the real ones, in the language of the page
  const chosen = page.locator('[data-testid="statement-option"][data-chosen="true"] [data-testid="statement-pick"]');
  const texts = await chosen.allInnerTexts();
  const wanted = card.parts.map((p) => p.options.find((o) => o.id === p.chosen)?.text[lang] ?? "");
  texts.forEach((text, i) => expect(text).toContain(wanted[i]));
  expect(Math.max(...wanted.map((w) => w.length))).toBeGreaterThan(lang === "en" ? 90 : 30);
  const fit = await nothingCut(page, '[data-testid="statement-card"]', '[data-testid="statement-option"]');
  expect(fit).toEqual({ cut: [], overlapping: 0 });
  expect(await fitsWidth(page)).toBe(true);
  await snap(page, "statement-card", tag);

  // the button asks first; the statement is made on the second press
  await page.getByTestId("statement-state").click();
  await expect(page.getByTestId("statement-confirm-box")).toBeVisible();
  expect(await fitsWidth(page)).toBe(true);
  await snap(page, "statement-confirm", tag);
  await page.getByTestId("statement-confirm").click();

  // the result: who accepted and why, in the panel, with the world held until it is put away
  const result = page.getByTestId("clarify");
  await expect(result).toBeVisible({ timeout: 240_000 });
  await expect(result).toHaveAttribute("data-kind", "statement");
  card = await cardOf(page);
  expect(card.last).toMatchObject({ told: true, wrong: [], elder: "accepted" });
  expect(card.last?.accepted).toBeGreaterThanOrEqual(5);
  await expect(page.getByTestId("stated-result")).toHaveClass(/is-told/);
  await expect(page.getByTestId("stated-line")).toHaveAttribute("data-accepted", String(card.last?.accepted));
  await expect(result.getByTestId("hearer")).toHaveCount(card.last?.named ?? 0);
  const heard = await nothingCut(page, '[data-testid="clarify"]', '[data-testid="hearer"]');
  expect(heard).toEqual({ cut: [], overlapping: 0 });
  expect(await fitsWidth(page)).toBe(true);
  await snap(page, "statement-result", tag, true);
  // they come into the panel one after the other, seven tenths of a second apart: all of them are there in the end
  await expect
    .poll(() => result.getByTestId("hearer").evaluateAll((rows) => rows.filter((row) => Number(getComputedStyle(row).opacity) > 0.99).length), { timeout: 15_000 })
    .toBe(card.last?.named);
}

/** The summary of a night and the paper of the morning after it, on the recording of the follower at five to nine of the evening: the world is let go, and the cards come as the core makes them. */
async function theNightAndThePaper(page: Page, tag: string, lang: "zh" | "en", day: number): Promise<void> {
  expect((await frameOf(page)).time).toMatchObject({ day, hour: 20, minute: 55 });
  const dayWords = (n: number): string => (lang === "zh" ? `第${"零一二三四五"[n]}天` : `Day ${n}`);
  await asPlayer(page);
  await letGo(page);
  // dusk of the second day: the summary of the night holds the world until it is put away
  const night = page.getByTestId("night");
  await expect(night).toBeVisible({ timeout: 420_000 });
  await expect(page.getByTestId("night-issue")).toContainText(dayWords(day));
  await expect(page.getByTestId("night-changed-text")).not.toHaveText("");
  await expect(page.getByTestId("night-blocked-text")).not.toHaveText("");
  await expect(page.getByTestId("night-step-text")).not.toHaveText("");
  expect(await fitsWidth(page)).toBe(true);
  expect(await page.evaluate(() => window.__lantern.play.hold.active)).toBe(true);
  await expect(page.getByTestId("night-done")).toBeInViewport();
  await snap(page, `night-night-${day}`, tag);
  await page.getByTestId("night-done").click();
  await expect(night).toHaveCount(0);
  await page.waitForFunction(() => window.__lantern.client.state.paused === false, undefined, { timeout: 30_000 });
  // seven in the morning of the next day: the paper
  const paper = page.getByTestId("gazette");
  await expect(paper).toBeVisible({ timeout: 420_000 });
  await expect(paper).toHaveAttribute("data-day", String(day + 1));
  await expect(page.getByTestId("gazette-head")).not.toHaveText("");
  await expect(page.getByTestId("gazette-today-task")).not.toHaveText("");
  expect(await fitsWidth(page)).toBe(true);
  await expect(page.getByTestId("gazette-done")).toBeInViewport();
  await snap(page, `paper-morning-${day + 1}`, tag);
  await page.getByTestId("gazette-done").click();
  await expect(paper).toHaveCount(0);
}

test.describe("the full statement on the fourth evening, on the real core, in Chinese on the light theme", () => {
  test.use({ locale: "zh-CN", colorScheme: "light", viewport: { width: 1280, height: 760 } });

  test("the card is filled in and the full statement is made at the hall from it: the result says who accepted", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    const recording = recordFollower(4, 17, 10);
    // The manager is at the hall with the clan from about 11 to 125 ticks after the recording (17:15 to 18:12), and the host holds the world 60 ticks after it.
    const heldAt = recording.tick + 60;
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "fourth evening", recording, heldAt);
    await statementFromTheCard(page, "zh-light-1280x760", "zh", heldAt);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the summary of the second night and the paper of the third morning, after a day of doing what the bar says", async ({ lantern }) => {
    test.setTimeout(1_200_000);
    const page = lantern.page;
    const recording = recordFollower(2, 20, 55);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "second evening", recording);
    await theNightAndThePaper(page, "zh-light-1280x760", "zh", 2);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the summary of the fourth night and the paper of the fifth morning: what the town saw of the truth and the peace", async ({ lantern }) => {
    test.setTimeout(1_200_000);
    const page = lantern.page;
    const recording = recordFollower(4, 20, 55);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "fourth evening late", recording);
    const frame = await frameOf(page);
    expect(frame.board.truth.state).toBe("done"); // the follower told it at the hall a little after five, and laid the table
    expect(frame.board.peace.state).toBe("done");
    await theNightAndThePaper(page, "zh-light-1280x760", "zh", 4);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("the morning of the fourth day: a promise falls due and its card has the button, and the board says the bridge is nearly done", async ({ lantern }) => {
    test.setTimeout(900_000);
    const page = lantern.page;
    const recording = recordFollower(4, 6, 40);
    await loadMoment(page, () => lantern.waitReady(), lantern.servers.app.origin, "fourth morning", recording);
    const frame = await frameOf(page);
    expect(frame.time).toMatchObject({ day: 4, hour: 6 });
    // the follower kept the first promise at 06:34, and the next that falls due this morning is the task that is followed, with its button
    expect(frame.tracked).toMatch(/^t_keep_\d+$/);
    const keep = frame.tasks.find((t) => t.id === frame.tracked);
    expect(keep).toMatchObject({ state: "open", action: { verb: "promise" } });
    await expect(page.getByTestId("task-card")).toHaveAttribute("data-id", frame.tracked ?? "");
    await expect(page.getByTestId("task-do")).toHaveCount(1);
    await expect(page.getByTestId("task-do")).toContainText("兑现");
    expect(await fitsWidth(page)).toBe(true);
    await snap(page, "promise-due-day", "zh-light-1280x760");
    await page.getByTestId("board-toggle").click();
    await expect(page.getByTestId("board-bridge")).toBeVisible();
    await page.getByTestId("board").evaluate((el) => el.scrollIntoView({ block: "start" }));
    await snap(page, "fourth-morning-board", "zh-light-1280x760");
    expect(lantern.pageErrors).toEqual([]);
  });
});

