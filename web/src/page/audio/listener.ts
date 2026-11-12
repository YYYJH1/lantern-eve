/**
 * Where the camera looks, as the sounds want it: the cell in the middle of the picture, and half the width of the picture in cells.
 * A map that is not drawn (a page opened with ?map=off) has no camera, and the whole town is taken to be in view.
 */
import type { Listener } from "./plan.ts";

/** What of a map the sounds ask: its drawing surface, and which cell lies under a point of it. */
export interface Lookout {
  readonly canvas: HTMLCanvasElement | null;
  cellAt(sx: number, sy: number): { x: number; y: number };
}

export function listenerOf(view: Lookout): Listener | null {
  const canvas = view.canvas;
  if (canvas === null) return null;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!(width > 0) || !(height > 0)) return null;
  const middle = view.cellAt(width / 2, height / 2);
  const left = view.cellAt(0, height / 2);
  const right = view.cellAt(width, height / 2);
  return { x: middle.x + 0.5, y: middle.y + 0.5, reach: Math.max(4, Math.abs(right.x - left.x) / 2) };
}
