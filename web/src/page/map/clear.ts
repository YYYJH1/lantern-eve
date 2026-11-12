/**
 * What lies over the map, and where a name of the map goes so that none of it covers the name. The page lays boxes of paper over the canvas (the
 * placard of the day, the red slip, the buttons of the camera, the key to the lights, the strip of the acts, the bookmarks of the ledger), and a
 * name that the canvas draws under one of them would show half of itself. It has no PixiJS in it, so that the tests can run it without a browser.
 */

/** A box in the pixels of the canvas. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The boxes of paper that lie over the map, as the page marks them with their classes. */
export const OVER_THE_MAP = ".placard, .slip, .map-tools, .map-legend, .side, .marks";

/** The space left between a name and the box it was moved clear of, in pixels. */
const AIR = 3;

/** What `getBoundingClientRect` gives, as far as this module reads it. */
export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The boxes of the page as boxes of the canvas: what has no size, or lies outside the canvas altogether, is left out. */
export function boxesOver(canvas: Rect, rects: Iterable<Rect>): Box[] {
  const out: Box[] = [];
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const box: Box = { x: rect.left - canvas.left, y: rect.top - canvas.top, w: rect.width, h: rect.height };
    if (box.x >= canvas.width || box.y >= canvas.height || box.x + box.w <= 0 || box.y + box.h <= 0) continue;
    out.push(box);
  }
  return out;
}

/** Writes the boxes as one string, for a stamp that changes when they do. */
export function stampOf(boxes: readonly Box[]): string {
  return boxes.map((b) => `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`).join(";");
}

const covers = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Where a name goes that has none of `avoid` over it. A name that is clear stays where it is. One that is not slides along its line to the edge
 * of the box on either side, the nearer edge first, as long as the point it hangs from (`anchorX`) is still over the name and the name stays in
 * the view, and it is left out (null) where it cannot: its place is under the box.
 */
export function slideClear(box: Box, anchorX: number, avoid: readonly Box[], viewW: number): Box | null {
  if (!avoid.some((other) => covers(box, other))) return box;
  const spots: number[] = [];
  for (const other of avoid) spots.push(other.x + other.w + AIR, other.x - box.w - AIR);
  spots.sort((a, b) => Math.abs(a - box.x) - Math.abs(b - box.x));
  for (const x of spots) {
    if (x < 4 || x + box.w > viewW - 4) continue;
    if (anchorX < x || anchorX > x + box.w) continue;
    const moved: Box = { ...box, x };
    if (!avoid.some((other) => covers(moved, other))) return moved;
  }
  return null;
}
