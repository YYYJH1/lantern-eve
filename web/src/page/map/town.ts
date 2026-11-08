/**
 * Where things stand in the town, read from the scene: the cells of a terrain, the trees, the
 * trees that are willows because they stand by the water, and the footprint that a place's
 * sprite goes on. All of it is in cells, with no drawing and no PixiJS, so that the tests can
 * run it without a browser.
 */
import { type Place, type Rect, type Scene, terrainAt } from "../scene.ts";
import type { SpriteDef } from "./manifest.ts";
import { noise } from "./palette.ts";
import { PLACE_ART, type PlaceArt, treeSprite } from "./sprites.ts";

/** The cells of a terrain id, in reading order. */
export function cellsOf(scene: Scene, id: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y < scene.height; y++) {
    for (let x = 0; x < scene.width; x++) if (terrainAt(scene, x, y) === id) out.push([x, y]);
  }
  return out;
}

/** The cells of the scene that are trees or walls and not part of a barrier, in reading order. */
export function treeCells(scene: Scene): Array<[number, number]> {
  const blocked = new Set<string>();
  for (const barrier of scene.barriers) for (const [x, y] of barrier.cells) blocked.add(`${x},${y}`);
  const cells = cellsOf(scene, "wall").filter(([x, y]) => !blocked.has(`${x},${y}`));
  cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return cells;
}

/** The trees that stand within `reach` cells of the river or a bank: those are willows. */
export function willowCells(scene: Scene, reach: number): Array<[number, number]> {
  const wet = (x: number, y: number): boolean => {
    const id = terrainAt(scene, x, y);
    return id === "river" || id === "bank";
  };
  return treeCells(scene).filter(([x, y]) => {
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) if (wet(x + dx, y + dy)) return true;
    }
    return false;
  });
}

/** The smallest rectangle that holds the cells, or null if there are none. */
export function boundsOf(cells: ReadonlyArray<readonly [number, number]>): Rect | null {
  if (cells.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of cells) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

const inside = (rect: Rect, x: number, y: number): boolean => x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;

/**
 * The footprints that a place's sprite is put on. A place with buildings has one for each building.
 * The bridge and the ferry landing have none: the bridge is its deck, and the pier is the planks
 * of the landing.
 */
export function footprintsOf(scene: Scene, place: Place): Rect[] {
  const own = scene.buildings.filter((b) => b.place === place.id);
  if (own.length > 0) return own.map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
  const terrain = place.kind === "bridge" ? "bridge" : place.kind === "ferry" ? "pier" : null;
  if (terrain === null) return [];
  const bounds = boundsOf(cellsOf(scene, terrain).filter(([x, y]) => inside(place.rect, x, y)));
  return bounds === null ? [] : [bounds];
}

/**
 * Where the bamboo is piled at the bridge: the footprint of a pile (`cols` by 1 cells) at the west
 * end of the deck, in the row just south of it, on the bank beside the road. Cells, from the
 * top-left of the pile.
 */
export function bambooSite(deck: Rect, cols: number): { x: number; y: number } {
  return { x: deck.x - cols, y: deck.y + deck.h };
}

/** One sprite of a place on one footprint. */
export interface PlacePlan {
  place: string;
  art: PlaceArt;
  whole: SpriteDef;
  broken: SpriteDef | null;
  /** The footprint, in cells. */
  rect: Rect;
  /** The size of the sprite against the one the kit made it at: the footprint over the sprite's own. */
  scale: number;
  /** The sprite of the lit windows of the building, which is shown over it at night, if the kit made one. */
  lights: SpriteDef | null;
}

/**
 * Which places the scene has sprites for, and where each stands. Nothing is drawn here. A place with
 * several buildings and several sprites (`others` of its art) takes them in turn, one for each building.
 */
export function planPlaces(scene: Scene, sprite: (id: string) => SpriteDef | undefined): PlacePlan[] {
  const out: PlacePlan[] = [];
  for (const place of scene.places) {
    const art = PLACE_ART[place.id];
    const first = art === undefined ? undefined : sprite(art.whole);
    if (art === undefined || first === undefined) continue;
    const broken = art.broken === undefined ? null : (sprite(art.broken) ?? null);
    const pool = [first, ...(art.others ?? []).flatMap((id) => sprite(id) ?? [])];
    footprintsOf(scene, place).forEach((rect, n) => {
      const whole = pool[n % pool.length] ?? first;
      const scale = whole.footprint !== null && whole.footprint.cols > 0 ? rect.w / whole.footprint.cols : 1;
      out.push({ place: place.id, art, whole, broken, rect, scale, lights: whole.lights === null ? null : (sprite(whole.lights) ?? null) });
    });
  }
  return out;
}

/** A tree of the town that is drawn as a sprite: its cell, the sprite, and how far it stands from the middle of the cell, in pixels. */
export interface TreePlan {
  x: number;
  y: number;
  sprite: SpriteDef;
  dx: number;
  dy: number;
}

/**
 * The kind of tree for a cell, as a sprite id: a stable hash of the cell, so that the same map always looks the same,
 * whatever else changed, and a map of the same terrain with a person on another cell is the same town.
 */
export function treeKindAt(x: number, y: number): string {
  return treeSprite(noise(x, y, 130));
}

/**
 * The trees that are drawn as sprites: every tree of the scene that is not a willow (`willows` are their cells as `x,y`) and
 * whose kind has a sprite in the manifest. A tree whose kind has none is drawn as a shape made in code. Each stands a little off the
 * middle of its cell, by a hash of the cell as well.
 */
export function planTrees(scene: Scene, willows: ReadonlySet<string>, sprite: (id: string) => SpriteDef | undefined): TreePlan[] {
  const out: TreePlan[] = [];
  for (const [x, y] of treeCells(scene)) {
    if (willows.has(`${x},${y}`)) continue;
    const def = sprite(treeKindAt(x, y));
    if (def === undefined) continue;
    out.push({ x, y, sprite: def, dx: (noise(x, y, 121) - 0.5) * 6, dy: (noise(x, y, 122) - 0.5) * 4 });
  }
  return out;
}
