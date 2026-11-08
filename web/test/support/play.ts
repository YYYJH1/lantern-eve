import type { Page } from "@playwright/test";
import { expect, type LanternPage } from "./fixtures.ts";

/** What the tests of the player's side of the game do on the page, by the hooks of the test build. */

/** The numbers the map publishes as attributes of its canvas. */
export const canvasData = (page: Page) => page.getByTestId("map").evaluate((el) => ({ ...(el as HTMLCanvasElement).dataset }));

/**
 * Waits for the map to have the town on it. The map draws its first frame a moment after the host
 * sends its own, so a test that has the tick still has to wait before it asks the map where things are.
 */
export const mapDrawn = (page: Page) => page.waitForFunction(() => window.__lantern.view.stats().people > 0, undefined, { timeout: 60_000 });

/**
 * Whether every piece on the map stands on the cell its frame gave it. A piece glides there by the
 * time between the map's own frames, and a map that is slow to draw (a machine with a software
 * renderer) goes on moving for seconds after the world has stopped. A test that wants the map
 * still waits for this, and not for a fixed time.
 */
export const piecesAtRest = (page: Page) =>
  page.evaluate(() => {
    const { client, view } = window.__lantern;
    const frame = client.state.frame as { npcs: Array<{ id: string; x: number; y: number }>; player?: { x: number; y: number } | null } | null;
    if (frame === null) return false;
    const pieces = [...frame.npcs, ...(frame.player == null ? [] : [{ id: "player", x: frame.player.x, y: frame.player.y }])];
    return pieces.every((piece) => {
      const at = view.screenPositionOf(piece.id);
      const to = view.cellToScreen(piece.x, piece.y);
      return at !== null && Math.abs(at.x - to.x) < 0.01 && Math.abs(at.y - to.y) < 0.01;
    });
  });

/** Where the middle of a cell is, in the pixels of the map's own element. */
export const cellOnScreen = async (page: Page, x: number, y: number) => {
  await mapDrawn(page);
  return page.evaluate(([a, b]) => window.__lantern.view.cellToScreen(a as number, b as number), [x, y]);
};

/** The note of the slip lies over a part of the map and takes a click meant for it, as the ledger does: a test that clicks the map has them put away first. */
export async function clearTheMap(page: Page): Promise<void> {
  // The presses are the page's own (a card of the days, a recap, may lie over the slip at the moment, and the test does not mean to press through it).
  const head = page.getByTestId("slip-head");
  if ((await head.count()) > 0 && (await head.getAttribute("aria-expanded")) === "true") await head.evaluate((el) => (el as HTMLElement).click());
  const board = page.getByTestId("board");
  if ((await board.count()) > 0 && (await board.getAttribute("data-open")) === "true") await page.getByTestId("board-tabs").locator("button.is-on").evaluate((el) => (el as HTMLElement).click());
}

/**
 * For the tests of the art of the map, which point at figures and buildings anywhere on it: the slip hangs over the top of the map and
 * takes a pointer even folded, so it is taken off the page. (Its own style, set from the script, which the page's policy allows.)
 */
export async function hideTheSlip(page: Page): Promise<void> {
  await page.evaluate(() => {
    const slip = document.querySelector<HTMLElement>('[data-testid="topbar-task"]');
    if (slip !== null) slip.style.display = "none";
  });
}

/**
 * Picks a person by a click on the map at a point of their figure. Where something of the frame lies over the point (the strip at the foot of
 * the page lies over the lower left of the map, by design), the page is asked for the pick that the click would have made.
 */
export async function pickAtSpot(page: Page, spot: { x: number; y: number }, id: string): Promise<void> {
  await clearTheMap(page);
  if (await onTheMap(page, spot)) await page.getByTestId("map").click({ position: spot });
  else await page.evaluate((who) => window.__lantern.play.onFocus?.(who), id);
}

/**
 * A mouse over a point of the map's element, or a click on it, as the pointer events a mouse makes. A real mouse does not reach the map where
 * something of the page lies over the point (the strip at the foot of the page lies over the lower left, by design), and these events do: a test
 * of what the map does with a click on a building uses them to go through the whole town.
 */
export async function mouseOnMap(page: Page, spot: { x: number; y: number }, action: "hover" | "click"): Promise<void> {
  await page.evaluate(
    ({ x, y, what }) => {
      const target = document.querySelector<HTMLCanvasElement>('[data-testid="map"]');
      if (target === null) throw new Error("no map");
      const box = target.getBoundingClientRect();
      const fire = (type: string, buttons: number): void => {
        target.dispatchEvent(new PointerEvent(type, { pointerId: 1, pointerType: "mouse", isPrimary: true, button: 0, buttons, clientX: box.left + x, clientY: box.top + y, bubbles: true }));
      };
      fire("pointermove", 0);
      if (what === "click") {
        fire("pointerdown", 1);
        fire("pointerup", 0);
      }
    },
    { x: spot.x, y: spot.y, what: action },
  );
}

/** Whether a point of the map is the map's own, with nothing of the page lying over it. */
export const onTheMap = (page: Page, spot: { x: number; y: number }): Promise<boolean> =>
  page.evaluate(({ x, y }) => {
    const map = document.querySelector('[data-testid="map"]');
    if (map === null) return false;
    const box = map.getBoundingClientRect();
    return document.elementFromPoint(box.left + x, box.top + y) === map;
  }, spot);

/** Opens the note of the slip where a talk, the ledger or the notebook folded it, for a test that reads what is in it. */
export async function openTheNote(page: Page): Promise<void> {
  const head = page.getByTestId("slip-head");
  // The page folds the note a moment after a talk begins, which a test that has just started one can be ahead of: it looks again after a moment.
  await expect(async () => {
    if ((await head.getAttribute("aria-expanded")) === "false") await head.click({ timeout: 2_000 });
    await page.waitForTimeout(250);
    expect(await head.getAttribute("aria-expanded")).toBe("true");
  }).toPass({ timeout: 15_000 });
}

/**
 * A click on a point of the map. The note of the slip and the ledger are put away first. Where something else of the page still lies over the point
 * (the strip of a talk and the lists over it, the note of a picked person), a mouse cannot be brought through paper: the click is sent to the map as
 * the events it hears, which is a click on what lies under the paper.
 */
export async function clickMap(page: Page, position: { x: number; y: number }): Promise<void> {
  await clearTheMap(page);
  if (await onTheMap(page, position)) await page.getByTestId("map").click({ position });
  else await mouseOnMap(page, position, "click");
}

export const clickCell = async (page: Page, x: number, y: number): Promise<void> => clickMap(page, await cellOnScreen(page, x, y));

/** The notes the town puts over the map. */
export const notes = (page: Page) => page.getByTestId("game-note");

/** Lets the world run, and holds it, as the pause button does. */
export const run = (page: Page) => page.evaluate(() => window.__lantern.client.resume());
export const hold = (page: Page) => page.evaluate(() => window.__lantern.client.pause());

/** Waits for the player's piece to be at a cell. */
export const arrive = (page: Page, x: number, y: number) =>
  page.waitForFunction(([a, b]) => window.__lantern.play.view?.player?.x === a && window.__lantern.play.view?.player?.y === b, [x, y], { timeout: 30_000 });

/** A cell of the river, from the terrain of the scene: a few rows below its top, where the slip hangs over the map and takes a click. */
export const riverCell = (page: Page) =>
  page.evaluate(() => {
    const scene = window.__lantern.play.scene;
    if (scene === null) throw new Error("no scene");
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < scene.rows.length; y++) {
      for (let x = 0; x < (scene.rows[y]?.length ?? 0); x++) if (scene.legend.get(scene.rows[y]?.charAt(x) ?? "") === "river") cells.push({ x, y });
    }
    const top = cells[0];
    if (top === undefined) throw new Error("no river");
    return cells.find((cell) => cell.y >= top.y + 6) ?? top;
  });

/** Walks the player to the door of the teahouse and holds the world there, with the keeper of the teahouse beside them. */
export async function atTheTeahouse(lantern: LanternPage): Promise<void> {
  const page = lantern.page;
  const building = await page.evaluate(() => window.__lantern.play.scene?.buildings.find((b) => b.place === "p_teahouse"));
  if (building === undefined) throw new Error("no teahouse");
  await clickCell(page, building.x + Math.floor(building.w / 2), building.y + Math.floor(building.h / 2));
  await run(page);
  const door = await page.evaluate(() => window.__lantern.play.scene?.places.find((p) => p.id === "p_teahouse")?.door);
  if (door == null) throw new Error("no door");
  await arrive(page, door[0], door[1]);
  await hold(page);
  await expect.poll(() => page.evaluate(() => window.__lantern.client.state.paused)).toBe(true);
}

/** Picks the keeper of the teahouse on the map and starts a talk with her from the card. The player is beside her. */
export async function talkToTheKeeper(lantern: LanternPage): Promise<void> {
  const page = lantern.page;
  await mapDrawn(page);
  await clearTheMap(page);
  const spot = await page.evaluate(() => window.__lantern.view.screenPositionOf("cha_laoban"));
  if (spot === null) throw new Error("no keeper");
  await clickMap(page, spot);
  await page.getByTestId("card-talk").click();
  await expect(page.getByTestId("talk-badge")).toBeVisible();
}
