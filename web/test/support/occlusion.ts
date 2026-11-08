import type { Page } from "@playwright/test";
import { DIRS, type SpriteDef } from "../../src/page/map/manifest.ts";
import { PAL, pieceColour } from "../../src/page/map/palette.ts";
import { alphaAtWorld, AlphaPlane, type FrameBox, SOLID } from "../../src/page/map/pick.ts";
import { CELL, CELL_DEPTH } from "../../src/page/map/projection.ts";
import type { Box } from "../../src/page/map/silhouette.ts";
import { figureFor } from "../../src/page/map/sprites.ts";
import { parseScene, type Scene } from "../../src/page/scene.ts";
import { expect, type LanternPage } from "./fixtures.ts";
import { hideTheSlip } from "./play.ts";
import { alphaOfFrame, clearStage, drawing, inject, mapStats, MANIFEST, MORNING } from "./sprites.ts";

/**
 * What the tests of the silhouettes share. A silhouette is where the body of a person who stands behind something and the body of that
 * thing meet, so the tests look for the places where that happens in the pixels of the atlas, which they decode for themselves, and in
 * the list of the things that can hide a person that the map gives (`drawing().occluders`). No test names a pixel or a cell that the
 * art decides: a bake that moves the roof of the tea house moves the places that are found.
 */

export interface Point {
  x: number;
  y: number;
}
export interface Cell {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A thing that can hide a person, as the map lists it. */
export type Occluder = Awaited<ReturnType<typeof drawing>>["occluders"][number];

export const occluders = async (page: Page): Promise<Occluder[]> => (await drawing(page)).occluders;

/** The thing with this id (a place, or the sprite of a prop), the first one if the town has several. */
export async function occluderOf(page: Page, id: string): Promise<Occluder> {
  const found = (await occluders(page)).find((o) => o.id === id);
  if (found === undefined) throw new Error(`nothing that can hide a person is called ${id}`);
  return found;
}

export const silhouettesOf = async (page: Page, person?: string) => (await drawing(page)).silhouettes.filter((s) => person === undefined || s.person === person);

// --- The page -----------------------------------------------------------------------------

/** Opens the town held at a tick and waits until the map has drawn its people and its places, and has the pixels that picking looks into. */
export async function openTown(lantern: LanternPage, query = MORNING, until = 700): Promise<void> {
  await lantern.open(query, { menu: false });
  await lantern.waitForTick(until);
  await expect.poll(() => mapStats(lantern.page).then((s) => s.people === 20 && s.alpha)).toBe(true);
  await lantern.page.waitForFunction(() => {
    const frame = window.__lantern.client.state.frame as unknown as { npcs: Array<{ id: string; x: number; y: number }> } | null;
    const view = window.__lantern.view;
    return (
      frame !== null &&
      frame.npcs.every((n) => {
        const at = view.screenPositionOf(n.id);
        const to = view.cellToScreen(n.x, n.y);
        return at !== null && Math.abs(at.x - to.x) < 0.01 && Math.abs(at.y - to.y) < 0.01;
      })
    );
  });
  // The slip lies over the top of the map: the tests that point at a figure have it taken off the page.
  await hideTheSlip(lantern.page);
}

/** Holds the map still for a player who asked for less motion, or lets it go: a figure then stands in one frame, which the tests know. */
export async function holdStill(page: Page, on: boolean): Promise<void> {
  await page.emulateMedia({ reducedMotion: on ? "reduce" : "no-preference" });
  await expect.poll(async () => (await mapStats(page)).calm).toBe(on);
}

/** The town in the light of day, held still, with everybody on the row at the south edge, where nobody is behind anything. */
export async function emptyTown(lantern: LanternPage, query = MORNING, until = 700): Promise<void> {
  await openTown(lantern, query, until);
  await inject(lantern.page, { weather: "clear" });
  await holdStill(lantern.page, true);
  await clearStage(lantern.page);
  await expect.poll(async () => (await mapStats(lantern.page)).silhouettes).toBe(0);
}

export const sceneOf = async (page: Page): Promise<Scene> => parseScene(await page.evaluate(() => window.__lantern.client.state.scene as unknown as Record<string, unknown>));

/** The colour of a person's family, which is the colour of their silhouette; the manager's is gold. */
export const colourOf = (scene: Scene, id: string): number => (id === "player" ? PAL.gold : pieceColour(id, scene.cast.find((p) => p.id === id)?.family ?? null));

/** Where a point of the world is on the map's element, and what is picked there. */
export const project = (page: Page, wx: number, wy: number) => page.evaluate(([x, y]) => window.__lantern.view.camera.project(x as number, y as number), [wx, wy]);
export const pickAt = (page: Page, x: number, y: number, reach?: number) => page.evaluate(([sx, sy, r]) => window.__lantern.view.pickAt(sx as number, sy as number, (r as number | null) ?? undefined), [x, y, reach ?? null]);
export const zoomOf = (page: Page) => page.evaluate(() => window.__lantern.view.camera.zoom);

/** How many children the sorted container of the map has: the people, the places, the props, and the silhouettes that are drawn. */
export const sortedChildren = (page: Page) => page.evaluate(() => (window.__lantern.view as unknown as { actors: { children: unknown[] } }).actors.children.length);

/** Keeps what the map says when the ground is clicked, and does not pass it on: the page would answer by walking the player there. */
export async function spyOnGround(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spy = window as unknown as { __ground: unknown[] };
    spy.__ground = [];
    const view = window.__lantern.view;
    view.events = { ...view.events, ground: (hit) => { spy.__ground.push(hit); } };
  });
}
export const grounds = (page: Page) => page.evaluate(() => (window as unknown as { __ground: Array<{ x: number; y: number; place: string | null }> }).__ground);

/** The person who is picked, as the canvas says. */
export const selectedOf = async (page: Page): Promise<string> => (await page.getByTestId("map").evaluate((el) => (el as HTMLCanvasElement).dataset.selected)) ?? "";

// --- Colours ------------------------------------------------------------------------------

/** What a pixel that was `under` becomes when a flat colour of this alpha is laid over it: the fill of a silhouette. */
export const blend = (under: readonly number[], colour: number, alpha: number): number[] => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255].map((c, i) => c * alpha + (under[i] ?? 0) * (1 - alpha));
export const rgb = (colour: number): number[] => [(colour >> 16) & 255, (colour >> 8) & 255, colour & 255];
/** The largest difference of one channel between two colours. */
export const apart = (a: readonly number[], b: readonly number[]): number => Math.max(...[0, 1, 2].map((i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0))));

// --- The pictures -------------------------------------------------------------------------

/** A frame of a sprite as the test decodes it from the atlas: what is solid in it. */
export interface Picture {
  def: SpriteDef;
  frame: FrameBox;
  anchor: Point;
}

export async function pictureOf(page: Page, sprite: string, index = 0): Promise<Picture> {
  const def = MANIFEST.sprites.get(sprite);
  if (def === undefined) throw new Error(`no sprite ${sprite}`);
  const { w, h, scale, alpha } = await alphaOfFrame(page, sprite, index);
  return { def, frame: { plane: new AlphaPlane(w, h, Uint8Array.from(alpha)), x: 0, y: 0, w, h, scale }, anchor: { x: def.ax, y: def.ay } };
}

/** Whether the picture has a body at a point of the world, drawn with its anchor at `at` and `size` times its own size. */
export const solidAt = (pic: Picture, at: Point, size: number, wx: number, wy: number): boolean => alphaAtWorld(pic.frame, pic.anchor, at, size, wx, wy) >= SOLID;

export function boxOf(pic: Picture, at: Point, size = 1): Box {
  const x0 = at.x - pic.def.ax * size;
  const y0 = at.y - pic.def.ay * size;
  return { x0, y0, x1: x0 + pic.def.w * size, y1: y0 + pic.def.h * size };
}

/** The picture of a thing that can hide a person, and where it is: what is solid in it, and what is air inside its box (not a pixel of it has any alpha). */
export async function hiderPicture(page: Page, hider: Occluder): Promise<{ pic: Picture; at: Point; size: number; solid: (wx: number, wy: number) => boolean; air: (wx: number, wy: number) => boolean }> {
  const pic = await pictureOf(page, hider.sprite, 0);
  const at = { x: hider.x, y: hider.y };
  const box = boxOf(pic, at, hider.scale);
  return {
    pic,
    at,
    size: hider.scale,
    solid: (wx, wy) => solidAt(pic, at, hider.scale, wx, wy),
    air: (wx, wy) => wx >= box.x0 && wx < box.x1 && wy >= box.y0 && wy < box.y1 && alphaAtWorld(pic.frame, pic.anchor, at, hider.scale, wx, wy) === 0,
  };
}

/** The sprite a person is drawn with. */
export function spriteOf(id: string): string {
  const sprite = figureFor(id, (s) => MANIFEST.sprites.has(s), id === "player");
  if (sprite === null) throw new Error(`${id} has no figure in the kit`);
  return sprite;
}

/** The pictures of a figure at rest, the first frame of its idle in each of the four ways of facing: where it stands is where it was last sent, so any of them may be drawn. */
export async function restingPictures(page: Page, sprite: string): Promise<Picture[]> {
  const def = MANIFEST.sprites.get(sprite);
  const idle = def?.anims.get("idle");
  if (def === undefined || idle === undefined) throw new Error(`${sprite} has no idle`);
  const indices = [...new Set(DIRS.map((dir) => idle.dirs[dir][0] ?? 0))];
  return Promise.all(indices.map((i) => pictureOf(page, sprite, i)));
}

/** The picture a person is drawn with now, and where they stand, as the map says. */
export async function drawnPicture(page: Page, id: string): Promise<{ pic: Picture; at: Point }> {
  const now = (await drawing(page)).people.find((p) => p.id === id);
  if (now === undefined || now.sprite === null) throw new Error(`${id} is not drawn as a figure`);
  return { pic: await pictureOf(page, now.sprite, now.index), at: { x: now.x, y: now.y - now.lift } };
}

export const worldOf = (cell: Cell): Point => ({ x: (cell.x + 0.5) * CELL, y: (cell.y + 0.5) * CELL_DEPTH });

/** The cells that a thing stands on, as the manifest says its footprint is. */
export function footprintOf(hider: Occluder): Rect {
  const foot = MANIFEST.sprites.get(hider.sprite)?.footprint ?? { cols: 1, rows: 1 };
  const w = foot.cols * hider.scale;
  const h = foot.rows * hider.scale;
  return { x: Math.round((hider.x / CELL) * 100) / 100, y: Math.round((hider.y / CELL_DEPTH - h) * 100) / 100, w, h };
}

// --- Where a person is hidden -------------------------------------------------------------

/** How much of a person who stands on a cell, at rest, is under a thing, in the worst of the four ways of facing for each of the three. */
export interface Cover {
  cell: Cell;
  /** The share of the body that is under the thing: the least of the four. */
  share: number;
  /** The share of the head (the top quarter of the body) that is under it: the most of the four. */
  head: number;
  /** The share of the legs (the bottom half) that is under it: the least of the four. */
  legs: number;
  /** The share of the body that is in the air of the picture of the thing, inside its box and clear of it: the least of the four. */
  air: number;
}

const count = (area: Box, test: (wx: number, wy: number) => boolean): number => {
  let n = 0;
  for (let y = Math.floor(area.y0); y < area.y1; y++) for (let x = Math.floor(area.x0); x < area.x1; x++) if (test(x + 0.5, y + 0.5)) n++;
  return n;
};

/** The three shares for a person at rest on a cell. */
export function coverAt(pictures: readonly Picture[], hider: { solid: (wx: number, wy: number) => boolean; air?: (wx: number, wy: number) => boolean }, cell: Cell): Cover {
  const at = worldOf(cell);
  let share = 1;
  let head = 0;
  let legs = 1;
  let air = 1;
  for (const pic of pictures) {
    const area = boxOf(pic, at);
    const body = (wx: number, wy: number): boolean => solidAt(pic, at, 1, wx, wy);
    // The rows of the body, from its top to where it stands.
    let top = Number.POSITIVE_INFINITY;
    for (let y = Math.floor(area.y0); y < area.y1; y++) {
      for (let x = Math.floor(area.x0); x < area.x1; x++) {
        if (body(x + 0.5, y + 0.5)) {
          top = Math.min(top, y);
          break;
        }
      }
    }
    const height = Math.max(1, at.y - top);
    const upper = { ...area, y1: top + height * 0.25 };
    const lower = { ...area, y0: at.y - height * 0.5 };
    const total = count(area, body);
    const hid = (wx: number, wy: number): boolean => body(wx, wy) && hider.solid(wx, wy);
    share = Math.min(share, total === 0 ? 0 : count(area, hid) / total);
    const heads = count(upper, body);
    head = Math.max(head, heads === 0 ? 0 : count(upper, hid) / heads);
    const feet = count(lower, body);
    legs = Math.min(legs, feet === 0 ? 0 : count(lower, hid) / feet);
    const clear = hider.air;
    air = Math.min(air, clear === undefined || total === 0 ? 0 : count(area, (wx, wy) => body(wx, wy) && clear(wx, wy)) / total);
  }
  return { cell, share, head, legs, air };
}

/**
 * The cells north of a footprint, where a person is behind it: `north` rows of them, and `margin` cells more than the footprint is wide on each side.
 * A cell where a thing of another kind that is drawn after the person would hide them too is left out, so that what is looked for there is the one kind of thing.
 */
export async function cellsNorthOf(page: Page, target: Occluder, who: string, north = 12, margin = 1): Promise<Cell[]> {
  const scene = await sceneOf(page);
  const rect = footprintOf(target);
  const pictures = await restingPictures(page, spriteOf(who));
  const others = (await occluders(page)).filter((o) => o.id !== target.id);
  const out: Cell[] = [];
  for (let y = Math.max(1, Math.floor(rect.y) - north); y < Math.floor(rect.y); y++) {
    for (let x = Math.max(1, Math.floor(rect.x) - margin); x <= Math.min(scene.width - 2, Math.ceil(rect.x + rect.w) + margin - 1); x++) {
      const at = worldOf({ x, y });
      const crowded = others.some((o) => {
        if (o.sort <= at.y) return false;
        const pic = MANIFEST.sprites.get(o.sprite);
        if (pic === undefined) return false;
        const hb = { x0: o.x - pic.ax * o.scale, y0: o.y - pic.ay * o.scale, x1: o.x - pic.ax * o.scale + pic.w * o.scale, y1: o.y - pic.ay * o.scale + pic.h * o.scale };
        return pictures.some((p) => {
          const pb = boxOf(p, at);
          return pb.x0 < hb.x1 && hb.x0 < pb.x1 && pb.y0 < hb.y1 && hb.y0 < pb.y1;
        });
      });
      if (!crowded) out.push({ x, y });
    }
  }
  return out;
}

/** The covers of a person on the cells north of a thing. */
export async function scanNorthOf(page: Page, who: string, target: Occluder, north = 12, margin = 1): Promise<Cover[]> {
  const hider = await hiderPicture(page, target);
  const pictures = await restingPictures(page, spriteOf(who));
  return (await cellsNorthOf(page, target, who, north, margin)).map((cell) => coverAt(pictures, hider, cell));
}

/** The cell, of those that suit, that is nearest to the middle of the footprint and to the row three north of it. */
export function nearest(covers: readonly Cover[], rect: Rect, suits: (c: Cover) => boolean): Cell {
  const found = covers.filter(suits).sort((a, b) => score(a, rect) - score(b, rect))[0];
  if (found === undefined) throw new Error(`no cell near ${JSON.stringify(rect)} where a person is hidden in the way the test wants`);
  return found.cell;
}
const score = (c: Cover, rect: Rect): number => Math.abs(c.cell.x - (rect.x + rect.w / 2 - 0.5)) + 0.5 * Math.abs(c.cell.y - (rect.y - 3));

// --- Points -------------------------------------------------------------------------------

/**
 * The point of the world with the most room round it, up to `reach` pixels, among those of `area` where `inside` holds: the point and eight others at that
 * distance round it are all inside. Null if there is no point with room of 1. A screen pixel at such a point is not on an edge, however the picture was scaled.
 */
export function roomiest(area: Box, inside: (wx: number, wy: number) => boolean, reach = 6): (Point & { room: number }) | null {
  for (let room = reach; room >= 1; room--) {
    const found: Point[] = [];
    for (let y = Math.floor(area.y0) + room; y < area.y1 - room; y++) {
      for (let x = Math.floor(area.x0) + room; x < area.x1 - room; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        if (!inside(px, py)) continue;
        let all = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]] as const) {
          if (!inside(px + dx * room, py + dy * room)) {
            all = false;
            break;
          }
        }
        if (all) found.push({ x: px, y: py });
      }
    }
    if (found.length === 0) continue;
    // Of the points with that much room, the one nearest the middle of all of them.
    const mx = found.reduce((s, p) => s + p.x, 0) / found.length;
    const my = found.reduce((s, p) => s + p.y, 0) / found.length;
    const best = found.sort((a, b) => Math.hypot(a.x - mx, a.y - my) - Math.hypot(b.x - mx, b.y - my))[0] as Point;
    return { ...best, room };
  }
  return null;
}

/** The union of two boxes. */
export const together = (a: Box, b: Box): Box => ({ x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) });
