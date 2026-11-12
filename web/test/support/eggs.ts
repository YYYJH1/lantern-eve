import type { Page } from "@playwright/test";
import { expect, type LanternPage } from "./fixtures.ts";
import { mouseOnMap, piecesAtRest } from "./play.ts";
import * as fake from "./slice.ts";

// What the tests of the small secrets of the town share: the people put where the test wants them, a clock for the frames, clicks of a mouse in a row, what
// the page has people say over the map, the riddle lantern, and a page that begins on a day of the calendar.

export type Cell = readonly [number, number];

/** Where everybody is when the test does not say: away from the places the secrets are at. */
export const FAR: Cell = [50, 28];

/** Puts the people of the town at the cells given (the rest far away), and waits for the pieces to stand there. */
export async function arrange(page: Page, where: Record<string, Cell> = {}, extras: Record<string, unknown> = {}): Promise<void> {
  const npcs = await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { npcs: Array<Record<string, unknown>> }).npcs);
  const moved = npcs.map((n) => {
    const at = where[String(n.id)] ?? FAR;
    return { ...n, x: at[0], y: at[1], activity: "rest" };
  });
  await fake.feedFrame(page, { npcs: moved, ...extras });
  await expect.poll(() => piecesAtRest(page), { timeout: 20_000 }).toBe(true);
  await page.evaluate(() => window.__lantern.view.pickReady());
}

/** The game time of a frame. */
export const clock = (day: number, hour: number, minute = 0): Record<string, unknown> => ({ time: { day, hour, minute, phase: hour >= 21 || hour < 6 ? "night" : "day" } });

/** `n` clicks of a mouse on one point of the map, `gap` milliseconds apart, as the pointer events a mouse makes. */
export async function clicks(page: Page, spot: { x: number; y: number }, n: number, gap = 120): Promise<void> {
  await page.evaluate(
    async ({ x, y, count, wait }) => {
      const target = document.querySelector<HTMLCanvasElement>('[data-testid="map"]');
      if (target === null) throw new Error("no map");
      const box = target.getBoundingClientRect();
      const fire = (type: string, buttons: number): void => {
        target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: box.left + x, clientY: box.top + y, bubbles: true }));
      };
      for (let i = 0; i < count; i++) {
        if (i > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        fire("pointermove", 0);
        fire("pointerdown", 1);
        fire("pointerup", 0);
      }
    },
    { x: spot.x, y: spot.y, count: n, wait: gap },
  );
}

/** What the page has people say over the map of its own, as the map shows it. */
export const said = (page: Page): Promise<string[]> => page.evaluate(() => window.__lantern.view.pageTexts());

/** Who the page has say something over the map, as the page has it at this moment (the map shows it a frame later). */
export const speakers = (page: Page): Promise<string[]> => page.evaluate(() => window.__lantern.play.eggs.lines.map((line) => line.npc));

/** The tick of the latest frame. */
export const tickOf = (page: Page): Promise<number> => page.evaluate(() => window.__lantern.play.now);

/** Where the paper of the riddle lantern is on the screen. */
export async function lanternAt(page: Page): Promise<{ x: number; y: number; level: number; lit: boolean }> {
  const at = await page.evaluate(() => window.__lantern.view.riddleLantern());
  if (at === null) throw new Error("the town has no riddle lantern");
  return at;
}

/** A click on the riddle lantern. */
export async function pressLantern(page: Page): Promise<void> {
  const at = await lanternAt(page);
  await mouseOnMap(page, { x: at.x, y: at.y }, "click");
}

/** What the page holds the world for now, as the host reports it. */
export const reasons = (page: Page): Promise<string[]> => page.evaluate(() => [...(window.__lantern.client.state.stats?.reasons ?? [])]);

/** A page that begins on a day of the calendar: `new Date()` and `Date.now()` start there and run on. */
export async function today(page: Page, local: string): Promise<void> {
  await page.addInitScript((at) => {
    const Real = Date;
    const offset = new Real(at).getTime() - Real.now();
    class Moved extends Real {
      constructor(...args: unknown[]) {
        if (args.length === 0) super(Real.now() + offset);
        else super(...(args as [number]));
      }

      static override now(): number {
        return Real.now() + offset;
      }
    }
    (globalThis as unknown as { Date: unknown }).Date = Moved;
  }, local);
}

/** Opens the page as a player does: no game named, so the opening page and the world held behind it. */
export async function openingPage(lantern: LanternPage): Promise<void> {
  await lantern.page.goto(`${lantern.servers.app.origin}/?pace=60`);
  await lantern.waitReady();
  await expect(lantern.page.getByTestId("opening-start")).toBeEnabled({ timeout: 60_000 });
}

/** What the festival night has made and drawn. */
export const festivalNight = (page: Page) =>
  page.evaluate(() => {
    const s = window.__lantern.festival.stats();
    return JSON.parse(JSON.stringify({ plan: s.plan, stage: s.stage })) as { plan: { route: string }; stage: { river: number } };
  });

