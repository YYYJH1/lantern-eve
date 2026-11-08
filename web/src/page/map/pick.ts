/**
 * Picking on the map: which person or place is under the pointer. A figure is a picture, drawn
 * over others in the order of its anchor, and tall ones cover the cells behind them, so the
 * answer is not the cell under the pointer. It is the nearest thing, by the order they are drawn
 * in, that has a pixel of its own under the pointer.
 *
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */

/** Alpha at or above this, out of 255, is the body of a sprite. The soft shadow baked in under it is below. */
export const SOLID = 128;

/** The alpha channel of an atlas page, one byte a pixel. */
export class AlphaPlane {
  constructor(
    readonly width: number,
    readonly height: number,
    readonly data: Uint8Array,
  ) {}

  at(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (ix < 0 || iy < 0 || ix >= this.width || iy >= this.height) return 0;
    return this.data[iy * this.width + ix] ?? 0;
  }
}

/** The alpha channel of an RGBA image, as it comes out of a canvas. */
export function alphaOf(rgba: ArrayLike<number>, width: number, height: number): AlphaPlane {
  const data = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i++) data[i] = rgba[i * 4 + 3] ?? 0;
  return new AlphaPlane(width, height, data);
}

/** A frame of a sprite in an atlas, in the pixels of the scale the atlas was made at. */
export interface FrameBox {
  plane: AlphaPlane;
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

/**
 * The alpha of a sprite at a point of the world. The sprite is drawn with its anchor at `at`, at
 * its size at scale 1 times `size`, and `anchor` is where it stands in its frame in pixels at scale 1.
 */
export function alphaAtWorld(frame: FrameBox, anchor: { x: number; y: number }, at: { x: number; y: number }, size: number, wx: number, wy: number): number {
  // The point in the frame, in pixels at scale 1.
  const u = (wx - at.x) / size + anchor.x;
  const v = (wy - at.y) / size + anchor.y;
  if (u < 0 || v < 0 || u >= frame.w / frame.scale || v >= frame.h / frame.scale) return 0;
  return frame.plane.at(frame.x + u * frame.scale, frame.y + v * frame.scale);
}

/** Something that can be picked, and where it is in the order of drawing. */
export interface Pickable {
  kind: "person" | "place";
  id: string;
  /** The order of drawing: the greater, the nearer to the viewer. */
  sort: number;
  /** Whether a point of the world is on it. `slack` is how far off, in pixels of the world, a point may be and still count. */
  covers(wx: number, wy: number, slack: number): boolean;
}

/** The thing nearest to the viewer that is under a point of the world, or null if the point is on bare ground. */
export function pickFront(items: readonly Pickable[], wx: number, wy: number, slack: number): Pickable | null {
  let best: Pickable | null = null;
  for (const item of items) {
    if (best !== null && item.sort < best.sort) continue;
    if (item.covers(wx, wy, slack)) best = item;
  }
  return best;
}
