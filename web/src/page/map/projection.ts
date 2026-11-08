/**
 * The projection of the map: a front-facing three-quarter camera looking north, 52 degrees down,
 * which is the camera of every sprite of the kit (`tools/sprite-kit`). Ground is foreshortened by
 * the sine of that angle, so a grid cell is 32 pixels wide and 25.22 pixels deep on the screen,
 * and height lifts a point by 34.48 pixels for each world unit. Everything in the map's world
 * is in these pixels, at a zoom of 1: a cell (gx, gy) is at (gx * 32, gy * 25.22), and the camera
 * only scales and moves that picture.
 *
 * This module has no PixiJS in it, so that the tests can run it without a browser.
 */

/** The width of a grid cell on the screen, in pixels at a zoom of 1. */
export const CELL = 32;
/** The depth of a grid cell on the screen: the width times the sine of the camera's pitch. */
export const CELL_DEPTH = 25.22;
/** How far a world unit of height lifts a point on the screen. */
export const HEIGHT_PX = 34.48;
/** The camera's pitch, in degrees. The manifest of the kit says which one it was baked with. */
export const PITCH_DEG = 52;
/** What a vertical length of the flat plan (a cell is 32 by 32 there) becomes on the screen. */
export const DEPTH_RATIO = CELL_DEPTH / CELL;

export interface Point {
  x: number;
  y: number;
}

/** Where a point of the ground is in the world of the map. The cell numbers may be fractions: (2.5, 3.5) is the middle of cell (2, 3). */
export function cellToWorld(gx: number, gy: number): Point {
  return { x: gx * CELL, y: gy * CELL_DEPTH };
}

/** The middle of a cell, on the ground. */
export function cellCentre(cx: number, cy: number): Point {
  return cellToWorld(cx + 0.5, cy + 0.5);
}

/** The ground point under a point of the world, in fractions of a cell. The inverse of `cellToWorld`. */
export function worldToCell(wx: number, wy: number): Point {
  return { x: wx / CELL, y: wy / CELL_DEPTH };
}

/** The cell that a point of the world is over, if the point is taken for one of the ground. */
export function cellAtWorld(wx: number, wy: number): { x: number; y: number } {
  const at = worldToCell(wx, wy);
  return { x: Math.floor(at.x), y: Math.floor(at.y) };
}

/** A length measured along the ground, from a step in cells, in screen pixels. A step of one cell down is 25.22 pixels, not 32. */
export function groundDistance(dxCells: number, dyCells: number): number {
  return Math.hypot(dxCells * CELL, dyCells * CELL_DEPTH);
}

/**
 * How far a walker on the deck of the bridge is lifted, in pixels. `lifts` are samples spaced
 * evenly from the west end of the span to the east end (the kit gives thirteen, half a cell
 * apart, for a span of six cells), and `along` is how far from the west end the walker is, in
 * cells. A walker beyond either end is on the ground.
 */
export function deckLift(lifts: readonly number[], span: number, along: number): number {
  const last = lifts.length - 1;
  if (last < 1 || !(span > 0) || along < 0 || along > span) return 0;
  const at = (along / span) * last;
  const i = Math.min(last - 1, Math.floor(at));
  const a = lifts[i] ?? 0;
  const b = lifts[i + 1] ?? a;
  return a + (b - a) * (at - i);
}
