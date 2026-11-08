import { readFileSync } from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";
import { frameRect, type Manifest, parseManifest } from "../../src/page/map/manifest.ts";
import { WILLOW_REACH } from "../../src/page/map/sprites.ts";
import { treeCells, willowCells } from "../../src/page/map/town.ts";
import { parseScene, type Scene, terrainAt } from "../../src/page/scene.ts";
import { WEB_DIR } from "./fixtures.ts";

/** What the tests of the sprites on the map share: the manifest as the page reads it, and ways to look at what the map drew. */

/** The manifest of the kit that the build serves, read the way the page reads it. */
export const MANIFEST: Manifest = parseManifest(JSON.parse(readFileSync(path.join(WEB_DIR, "public/sprites/manifest.json"), "utf8")));

/** The town of the bridge scenario with the world held in the morning of the first day, which every test of the sprites starts from. */
export const MORNING = "scenario=bridge&seed=7&pace=60&until=700";
/** The same held at night, with the lamps of the town lit. */
export const NIGHT = "scenario=bridge&seed=7&pace=60&until=1900";

export const drawing = (page: Page) => page.evaluate(() => window.__lantern.view.drawing());
export const mapStats = (page: Page) => page.evaluate(() => window.__lantern.view.stats());

/** Adds keys to the frame on screen, as the core does (see `inject` of the test hooks). */
export const inject = (page: Page, extras: Record<string, unknown>) => page.evaluate((e) => window.__lantern.inject(e), extras);

/** The people of the frame on screen, as the core gave them. */
export const npcsOf = (page: Page) =>
  page.evaluate(() => (window.__lantern.client.state.frame as unknown as { npcs: Array<{ id: string; x: number; y: number; activity: string; carrying: string | null; status?: string }> }).npcs);

/** Puts people on cells, as a frame of the core would, and leaves the rest where they are. Resolves when the map has them there. */
export async function stand(page: Page, where: Record<string, Partial<{ x: number; y: number; activity: string; carrying: string | null; status: string }>>, extras: Record<string, unknown> = {}): Promise<void> {
  const npcs = (await npcsOf(page)).map((n) => ({ ...n, ...(where[n.id] ?? {}) }));
  await inject(page, { npcs, ...extras });
  await page.waitForFunction(
    ({ npcs: list, player }) => {
      const view = window.__lantern.view;
      // The map has taken the frame that was put in, and drawn what it says, before it is asked where anybody is.
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="map"]');
      if (canvas === null || canvas.dataset.frame !== String(window.__lantern.client.state.frameCount)) return false;
      const all = [...list.map((n) => ({ id: n.id, x: n.x, y: n.y })), ...(player === null ? [] : [{ id: "player", x: player.x, y: player.y }])];
      return all.every((p) => {
        const at = view.screenPositionOf(p.id);
        const to = view.cellToScreen(p.x, p.y);
        return at !== null && Math.abs(at.x - to.x) < 0.01 && Math.abs(at.y - to.y) < 0.01;
      });
    },
    { npcs, player: await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { player?: { x: number; y: number } | null }).player ?? null) },
    { timeout: 20_000 },
  );
}

/** The pixel of the rendered map at a point of the map's own element. */
export const sampleAt = (page: Page, x: number, y: number) => page.evaluate(([sx, sy]) => window.__lantern.view.sample(sx as number, sy as number), [x, y]);

/** Reads from the atlas of the page, which the test decodes for itself once for the page and not once for each pixel it asks for. */
function readAtlas<T>(page: Page, file: string, read: "texel" | "alpha" | "rgba", box: [number, number, number, number]): Promise<T> {
  return page.evaluate(
    async ([url, what, x, y, w, h]) => {
      const cache = ((window as unknown as { __atlasPixels?: Map<string, Promise<CanvasRenderingContext2D>> }).__atlasPixels ??= new Map());
      let context = cache.get(url as string);
      if (context === undefined) {
        context = (async () => {
          const bitmap = await createImageBitmap(await (await fetch(url as string)).blob());
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          if (ctx === null) throw new Error("no 2D canvas");
          ctx.drawImage(bitmap, 0, 0);
          return ctx;
        })();
        cache.set(url as string, context);
      }
      const data = (await context).getImageData(x as number, y as number, w as number, h as number).data;
      if (what === "texel") return [...data.slice(0, 4)];
      if (what === "rgba") return [...data];
      const alpha: number[] = new Array((w as number) * (h as number));
      for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3] ?? 0;
      return alpha;
    },
    [`sprites/${file}`, read, ...box] as const,
  ) as Promise<T>;
}

async function frameOf(page: Page, sprite: string, index: number): Promise<{ file: string; rect: NonNullable<ReturnType<typeof frameRect>>; scale: number }> {
  const def = MANIFEST.sprites.get(sprite);
  if (def === undefined) throw new Error(`no sprite ${sprite}`);
  const scale = (await mapStats(page)).atlas;
  const rect = frameRect(def, scale, index);
  const file = rect === null ? undefined : MANIFEST.atlases.get(scale)?.[rect.page]?.file;
  if (rect === null || file === undefined) throw new Error(`no frame ${index} of ${sprite} at ${scale}x`);
  return { file, rect, scale };
}

/**
 * The colour of a pixel of a frame of a sprite as the atlas has it, which is what the map shows where the
 * sprite has a solid body and the light is full. `u` and `v` are in the pixels of the sprite at scale 1,
 * from the top left of its frame.
 */
export async function atlasTexel(page: Page, sprite: string, index: number, u: number, v: number): Promise<[number, number, number, number]> {
  const { file, rect, scale } = await frameOf(page, sprite, index);
  return readAtlas<[number, number, number, number]>(page, file, "texel", [Math.round(rect.x + u * scale), Math.round(rect.y + v * scale), 1, 1]);
}

const alphaCache = new Map<string, { w: number; h: number; scale: number; alpha: number[] }>();

/** The alpha channel of a frame of a sprite (the first, unless told), at the scale the map loaded, as the test decodes the atlas for itself. */
export async function alphaOfFrame(page: Page, sprite: string, index = 0): Promise<{ w: number; h: number; scale: number; alpha: number[] }> {
  const { file, rect, scale } = await frameOf(page, sprite, index);
  const key = `${file}|${sprite}|${index}`;
  let known = alphaCache.get(key);
  if (known === undefined) {
    known = { w: rect.w, h: rect.h, scale, alpha: await readAtlas<number[]>(page, file, "alpha", [rect.x, rect.y, rect.w, rect.h]) };
    alphaCache.set(key, known);
  }
  return known;
}

/**
 * Points of a frame of a sprite where it has a solid body (alpha 255, and 255 all round for three pixels, so that no
 * point is on an edge), in the pixels of the sprite at scale 1, spread over the frame from the top left to the bottom
 * right. `above` keeps to the points that are at least that many pixels above the anchor, which are the points that
 * nobody who stands in front of a building covers. The points are what the art has, so a bake that changes the art
 * changes them, and the tests that use them do not name a pixel.
 */
export async function solidPoints(page: Page, sprite: string, count: number, above = 0): Promise<Array<[number, number]>> {
  const def = MANIFEST.sprites.get(sprite);
  if (def === undefined) throw new Error(`no sprite ${sprite}`);
  const { w, h, scale, alpha } = await alphaOfFrame(page, sprite);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (alpha[y * w + x] ?? 0));
  const r = 3 * scale;
  const found: Array<[number, number]> = [];
  for (let v = 0; v < h; v += 2 * scale) {
    for (let u = 0; u < w; u += 2 * scale) {
      if (v / scale > def.ay - above) continue;
      if (at(u, v) === 255 && at(u - r, v) === 255 && at(u + r, v) === 255 && at(u, v - r) === 255 && at(u, v + r) === 255) found.push([u / scale, v / scale]);
    }
  }
  if (found.length <= count) return found;
  return Array.from({ length: count }, (_, i) => found[Math.floor(((i + 0.5) * found.length) / count)] as [number, number]);
}

/** A point of a frame of a sprite that is clear (alpha 0, and 0 all round for three pixels): the sky at the corner of a building. */
export async function clearPoint(page: Page, sprite: string): Promise<[number, number]> {
  const { w, h, scale, alpha } = await alphaOfFrame(page, sprite);
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (alpha[y * w + x] ?? 0));
  const r = 3 * scale;
  // From the top right corner in.
  for (let v = 2 * scale; v < h / 2; v += 2 * scale) {
    for (let u = w - 2 * scale; u > w / 2; u -= 2 * scale) {
      if (at(u, v) === 0 && at(u - r, v) === 0 && at(u + r, v) === 0 && at(u, v - r) === 0 && at(u, v + r) === 0) return [u / scale, v / scale];
    }
  }
  throw new Error(`${sprite} has no clear corner`);
}

const rgbaCache = new Map<string, { w: number; h: number; scale: number; rgba: number[] }>();

/**
 * The point of a frame of a sprite, within `reach` pixels (at scale 1) of (u0, v0), where the colour is the most even: a solid
 * body (alpha 255) with the same colour for three texels all round. A pixel of the screen at such a point is the colour of the
 * atlas there however the picture was filtered, and not the colour of an edge. Throws if there is none.
 */
export async function flatPoint(page: Page, sprite: string, index: number, u0: number, v0: number, reach = 12): Promise<[number, number]> {
  const { file, rect, scale } = await frameOf(page, sprite, index);
  const key = `${file}|${sprite}|${index}`;
  let frame = rgbaCache.get(key);
  if (frame === undefined) {
    frame = { w: rect.w, h: rect.h, scale, rgba: await readAtlas<number[]>(page, file, "rgba", [rect.x, rect.y, rect.w, rect.h]) };
    rgbaCache.set(key, frame);
  }
  const { w, h, rgba } = frame;
  const at = (x: number, y: number, c: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : (rgba[(y * w + x) * 4 + c] ?? 0));
  const r = 3 * scale;
  let best: { u: number; v: number; spread: number } | null = null;
  for (let dv = -reach; dv <= reach; dv++) {
    for (let du = -reach; du <= reach; du++) {
      const x = Math.round((u0 + du) * scale);
      const y = Math.round((v0 + dv) * scale);
      let spread = 0;
      let solid = true;
      for (let oy = -r; oy <= r && solid; oy += scale) {
        for (let ox = -r; ox <= r; ox += scale) {
          if (at(x + ox, y + oy, 3) !== 255) {
            solid = false;
            break;
          }
          for (let c = 0; c < 3; c++) spread = Math.max(spread, Math.abs(at(x + ox, y + oy, c) - at(x, y, c)));
        }
      }
      if (solid && (best === null || spread < best.spread)) best = { u: x / scale, v: y / scale, spread };
    }
  }
  if (best === null || best.spread > 40) throw new Error(`${sprite} #${index} has no even colour near ${u0},${v0}`);
  return [best.u, best.v];
}

/**
 * The cells of open ground in the south west of the town where nobody is behind anything: not a building, the water or a tree, no tree beside
 * them (two cells to a side) or south of them (three rows for a tree, six for a willow: a crown is about that tall), and no building south of them
 * within nine rows (a roof is about that tall): a tree or a building is drawn in front of whoever stands behind it and hides them. Nor is a cell
 * under a name plate. In the order of the rows from the south edge, and across from the west.
 */
function openCells(scene: Scene): Array<[number, number]> {
  const trees = treeCells(scene);
  const willows = new Set(willowCells(scene, WILLOW_REACH).map(([x, y]) => `${x},${y}`));
  const out: Array<[number, number]> = [];
  for (let y = scene.height - 1; y >= 24; y--) {
    for (let x = 0; x <= 24; x++) {
      const terrain = terrainAt(scene, x, y);
      if (terrain === null || ["wall", "building", "river", "pier", "bridge"].includes(terrain)) continue;
      const hidden = trees.some(([tx, ty]) => {
        const big = willows.has(`${tx},${ty}`);
        return Math.abs(tx - x) <= (big ? 3 : 2) && ty - y >= 0 && ty - y <= (big ? 6 : 3);
      });
      const behind = scene.buildings.some((b) => x >= b.x - 1 && x <= b.x + b.w && y < b.y + b.h && y >= b.y + b.h - 9);
      // The name plate of a place that is no building (the riverbank) is at the middle of its rectangle, about three cells wide and a row tall.
      const plate = scene.places.some((q) => q.kind !== "water" && q.cells.length === 0 && !scene.buildings.some((b) => b.place === q.id) && Math.abs(x + 0.5 - (q.rect.x + q.rect.w / 2)) <= 3 && Math.abs(y + 0.5 - (q.rect.y + q.rect.h / 2)) <= 1.6);
      if (!hidden && !behind && !plate) out.push([x, y]);
    }
  }
  return out;
}

const sceneOfPage = async (page: Page): Promise<Scene> => parseScene(await page.evaluate(() => window.__lantern.client.state.scene as unknown as Record<string, unknown>));

/**
 * Puts the people and the player on the open ground at the south west of the town, two cells apart across or two down,
 * where there is no building, no tree and no name plate over them, so that no figure covers another and the pixel at the middle of
 * each body is the figure's own. Resolves when the map has them there.
 */
export async function spread(page: Page): Promise<void> {
  const npcs = await npcsOf(page);
  const scene = await sceneOfPage(page);
  const chosen: Array<[number, number]> = [];
  for (const [x, y] of openCells(scene)) {
    if (chosen.every(([cx, cy]) => Math.abs(cx - x) >= 2 || Math.abs(cy - y) >= 2)) chosen.push([x, y]);
  }
  if (chosen.length < npcs.length + 1) throw new Error(`only ${chosen.length} cells of open ground for ${npcs.length + 1} people`);
  const where: Record<string, { x: number; y: number }> = {};
  npcs.forEach((n, i) => (where[n.id] = { x: (chosen[i] as [number, number])[0], y: (chosen[i] as [number, number])[1] }));
  const player = await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { player?: Record<string, unknown> | null }).player ?? null);
  const last = chosen[npcs.length] as [number, number];
  await stand(page, where, player === null ? {} : { player: { ...player, x: last[0], y: last[1] } });
}

/** Puts the people and the player on the open ground at the south edge of the town, away from every sprite that a test looks at the pixels of, and from every tree that would hide them. */
export async function clearStage(page: Page): Promise<void> {
  const npcs = await npcsOf(page);
  const scene = await sceneOfPage(page);
  const cells = openCells(scene);
  if (cells.length < npcs.length) throw new Error(`only ${cells.length} cells of open ground for ${npcs.length} people`);
  const where: Record<string, { x: number; y: number }> = {};
  npcs.forEach((n, i) => (where[n.id] = { x: (cells[i] as [number, number])[0], y: (cells[i] as [number, number])[1] }));
  const player = await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { player?: Record<string, unknown> | null }).player ?? null);
  await stand(page, where, player === null ? {} : { player: { ...player, x: 26, y: 33 } });
}

/** Whether two colours are the same to within `tolerance` in each channel. */
export const near = (a: readonly number[] | null, b: readonly number[], tolerance = 45): boolean => a !== null && [0, 1, 2].every((i) => Math.abs((a[i] ?? 0) - (b[i] ?? 0)) <= tolerance);
