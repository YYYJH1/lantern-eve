/**
 * The size of one grid cell in the world, which is in the pixels of the screen at a zoom of 1: a
 * cell is `CELL` wide and `CELL_DEPTH` deep (see projection.ts). The camera maps the world to the screen.
 */
export { CELL, CELL_DEPTH, DEPTH_RATIO } from "./projection.ts";

export const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * How much of the map moves by itself, which sets how often it is drawn. A map that is still is
 * not drawn again until something changes. Where only the glints on the river and the lanterns
 * stir, it is drawn a few times a second. Where a ring breathes or a rumour travels, it is drawn
 * about as often as the eye needs for that, and where people walk or rain falls, at the full rate.
 */
export type Motion = 0 | 1 | 2 | 3;
export const STILL: Motion = 0;
export const SLOW: Motion = 1;
export const PULSE: Motion = 2;
export const LIVELY: Motion = 3;

export const faster = (a: Motion, b: Motion): Motion => (a > b ? a : b);
