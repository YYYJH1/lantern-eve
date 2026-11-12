/**
 * Where the tags over the heads of the people go on the screen. It has no PixiJS in it, so that the tests can run it without a browser.
 */
import { type Box, slideClear } from "./clear.ts";
import { clamp } from "./geometry.ts";

/** What one tag asks of the layout: whose it is, where the top of the head is on the screen, and how big the tag is. */
export interface Want {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a tag goes on the screen: its top left corner, and whether it is shown. */
export interface Spot {
  x: number;
  y: number;
  shown: boolean;
}

/** The space between the head and the tag over it, in pixels. */
export const GAP = 5;
/** The space between a tag and the one that is pushed up over it. */
const STACK = 2;
/** How many times a tag may be pushed up over the ones in front before it is left out. */
export const MAX_PUSH = 3;

const overlaps = (a: Box, b: Box): boolean => a.x < b.x + b.w + 2 && b.x < a.x + a.w + 2 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;

/**
 * Lays the tags out. Each hangs over its head, and the ones nearest the viewer (lowest on the screen) keep their place: a tag that would lie over
 * one that is placed is pushed up by its own height, up to `MAX_PUSH` times, and is left out if there is no room even then. A tag stays inside
 * the view, and one whose head is far outside it is left out. Every place a tag is tried in is inside the view (the tag of a head below the foot
 * of the view hangs at the foot of it), so that what is checked against the other tags and the boxes is where the tag ends. `avoid` are the boxes
 * of the page that lie over the map: a tag that one of them would cover slides along its line to the edge of the box, and is left out when its
 * head is under it. `taken` are the boxes of the names of the places, which keep their place: a tag that would lie over one is pushed up as it
 * is for another tag.
 */
export function placeTags(wants: readonly Want[], viewW: number, viewH: number, avoid: readonly Box[] = [], taken: readonly Box[] = []): Map<string, Spot> {
  const ordered = [...wants].sort((a, b) => b.y - a.y || (a.id < b.id ? -1 : 1));
  const placed: Box[] = [...taken];
  const spots = new Map<string, Spot>();
  for (const want of ordered) {
    const left = clamp(Math.round(want.x - want.w / 2), 4, Math.max(4, viewW - want.w - 4));
    const foot = Math.max(4, viewH - want.h - 4);
    const top = Math.round(want.y - GAP - want.h);
    let at: Box | null = null;
    for (let push = 0; push <= MAX_PUSH && at === null; push++) {
      const box = slideClear({ x: left, y: clamp(top - push * (want.h + STACK), 4, foot), w: want.w, h: want.h }, want.x, avoid, viewW);
      if (box !== null && !placed.some((other) => overlaps(box, other))) at = box;
    }
    if (at !== null) placed.push(at);
    const inView = want.x > -want.w && want.x < viewW + want.w && want.y > -20 && want.y < viewH + 40;
    spots.set(want.id, { x: at?.x ?? left, y: at?.y ?? clamp(top, 4, foot), shown: at !== null && inView });
  }
  return spots;
}
