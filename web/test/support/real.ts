/**
 * Playing the real game from the page: the core in the browser host (Pyodide) or in the server host, the slice of the first day, and
 * a player who walks up to people and talks to them, as a person does. The helpers wait for the game and never for the clock.
 */
import { expect, type Page } from "@playwright/test";
import type { LanternPage } from "./fixtures.ts";

/**
 * Opens the page as a player does (no game named in the address), presses Start and goes on without the tutorial, so that the world
 * runs and the hints of the world are on. `query` is the test build's own (`pace=10` makes a day of the game twenty seconds).
 */
export async function startGame(lantern: LanternPage, query = "pace=10"): Promise<void> {
  const page = lantern.page;
  await page.addInitScript(() => localStorage.setItem("lantern.tutorial", "skipped"));
  await page.goto(`${lantern.servers.app.origin}/?${query}`);
  await lantern.waitReady();
  await expect(page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
  await page.getByTestId("opening-start").click();
  await expect(page.getByTestId("status")).toHaveText("running");
}

/** The clock of the game as the frame on screen says it, in minutes of the day, with the day. */
export const clockOf = (page: Page): Promise<{ day: number; minutes: number }> =>
  page.evaluate(() => {
    const time = (window.__lantern.client.state.frame as unknown as { time: { day: number; hour: number; minute: number } }).time;
    return { day: time.day, minutes: time.hour * 60 + time.minute };
  });

/**
 * The clan elder comes by when the story has stood still for five hours of the game, and his card holds the world: a player who is
 * waiting for the day to go on puts it away, as the page asks them to.
 */
export async function closeElder(page: Page): Promise<void> {
  const close = page.getByTestId("elder-close");
  if ((await close.count()) > 0) await close.click({ timeout: 3000 }).catch(() => undefined);
}

/**
 * Every card that holds the world while a player waits for the day to go on: the elder's, the paper of the morning, the summary of the
 * night, the card that says a job is done and the result of a full statement. A test that reads one of them puts it away itself.
 */
export async function closeCards(page: Page): Promise<void> {
  await closeElder(page);
  for (const id of ["gazette-done", "night-done", "recap-done", "show-close", "clarify-done"]) {
    const close = page.getByTestId(id);
    if ((await close.count()) > 0) await close.click({ timeout: 3000 }).catch(() => undefined);
  }
}

/** Waits until the game's clock is at or past `hour`:`minute` of day `day`. */
export async function waitForClock(page: Page, hour: number, minute = 0, day = 1, timeout = 120_000): Promise<void> {
  await expect
    .poll(
      async () => {
        await closeCards(page);
        return page.evaluate(
          ([d, m]) => {
            const time = (window.__lantern.client.state.frame as unknown as { time: { day: number; hour: number; minute: number } }).time;
            return time.day > d || (time.day === d && time.hour * 60 + time.minute >= m);
          },
          [day, hour * 60 + minute] as const,
        );
      },
      { timeout, intervals: [150] },
    )
    .toBe(true);
}

/**
 * Talks to a person: the page walks up to them and talks, and asks again, not sooner than every `again` milliseconds (a few seconds), if
 * they were busy or have moved on. At the fast pace of a test a few seconds are hours of the game: a test that needs the person before they
 * go home asks again sooner.
 */
export async function talkTo(page: Page, npc: string, timeout = 120_000, again = 3000): Promise<void> {
  let lastAsk = 0;
  await expect
    .poll(
      async () => {
        await closeElder(page);
        const now = Date.now();
        const ask = now - lastAsk > again;
        const talking = await page.evaluate(
          ([id, again]) => {
            const play = window.__lantern.play;
            if (play.state.talk?.npc === id) return true;
            if (again && play.state.approach === null && play.state.talk === null) play.talkOrWalk(id);
            return false;
          },
          [npc, ask] as const,
        );
        if (ask) lastAsk = now;
        return talking;
      },
      { timeout, intervals: [300] },
    )
    .toBe(true);
}

/** Waits until the world holds its clock again: an act of the talk is paid for and nothing is owed. */
export async function untilHeld(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__lantern.client.state;
      return s.paused && s.rate[0] <= s.rate[1];
    },
    undefined,
    { timeout, polling: 25 },
  );
}

/**
 * Waits until what an act set going is over: the world holds again, or the talk has ended, which it does when the person has to go
 * as the act is said (the world then runs at its own pace and does not hold).
 */
export async function untilSettled(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const s = window.__lantern.client.state;
      return window.__lantern.play.state.talk === null || (s.paused && s.rate[0] <= s.rate[1]);
    },
    undefined,
    { timeout, polling: 25 },
  );
}

/** Whether the player is in a talk with this person. */
export const talkingTo = (page: Page, npc: string): Promise<boolean> => page.evaluate((id) => window.__lantern.play.state.talk?.npc === id, npc);

/** The number of lines in the notebook of the frame on screen. */
export const notebookCount = (page: Page): Promise<number> =>
  page.evaluate(() => ((window.__lantern.client.state.frame as unknown as { notebook?: unknown[] } | null)?.notebook ?? []).length);

/**
 * Ends the talk with the button, as a person does, if it is still on: a person who had to go has ended it already, and the button
 * may be gone as it is pressed.
 */
export async function leaveTalk(page: Page): Promise<void> {
  await closeElder(page);
  if ((await page.getByTestId("verb-leave").count()) > 0) await page.getByTestId("verb-leave").click({ timeout: 4000 }).catch(() => undefined);
  await expect(page.getByTestId("talk-area")).toHaveCount(0);
}

/**
 * Asks about a topic with its tag in the talk area, and waits until the answer is in and what the act set going is over. The talk
 * may end as the act is said (the person had to go), and then the answer is in the notebook and the talk is gone. Returns false,
 * and asks nothing, when the tag is not there to press: the talk is over, or the person has nothing to say of the topic.
 */
export async function askByTag(page: Page, topic: string): Promise<boolean> {
  await closeElder(page);
  const before = await page.evaluate(() => window.__lantern.play.state.talk?.lines.length ?? 0);
  try {
    await page.locator(`[data-testid="topic-chip"][data-id="${topic}"]`).click({ timeout: 8000 });
  } catch {
    return false;
  }
  await page.waitForFunction((n) => (window.__lantern.play.state.talk?.lines.length ?? n + 2) >= n + 2, before, { timeout: 30_000 });
  await untilSettled(page);
  return true;
}

/**
 * Asks a person about a topic until the notebook holds `count` lines, talking to them again when the talk ended because they had to
 * go. The people of the town are where their routines put them, so this takes as many talks as the day allows.
 */
export async function askUntilNoted(page: Page, npc: string, topic: string, count: number): Promise<void> {
  let asked = 0;
  for (let tries = 0; tries < 8 && (await notebookCount(page)) < count; tries++) {
    if (!(await talkingTo(page, npc))) await talkTo(page, npc, 90_000);
    await untilHeld(page);
    if (await askByTag(page, topic)) asked++;
  }
  expect(await notebookCount(page), `the notebook after ${asked} questions to ${npc} about ${topic}`).toBeGreaterThanOrEqual(count);
}

/** The events of the last frames that have this kind, as the page keeps them. */
export const eventsOf = (page: Page, kind: string): Promise<Array<Record<string, unknown>>> =>
  page.evaluate((k) => window.__lantern.client.state.events.filter((e) => e.kind === k) as Array<Record<string, unknown>>, kind);

/** Every player action the host has applied, as the replay records it. */
export async function appliedActions(lantern: LanternPage): Promise<Array<Record<string, unknown>>> {
  const replay = await lantern.exportReplay();
  return replay.records.filter((r) => r[2] === "player").map((r) => r[3]);
}
