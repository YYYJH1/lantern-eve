/**
 * A person who stands behind a building is hidden by it, and the town could not tell who is at the
 * back of the tea house. Where the building's pixels cover the person's, the map draws the person
 * again as a flat shape over the building, and the pointer finds the person there. This is the
 * part of it that is a rule and not a drawing: which person is hidden by what, in what order the
 * shape is drawn, and where the pointer is on it. The drawing is silhouette-layer.ts.
 *
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */
import { type FrameBox, type Pickable, SOLID } from "./pick.ts";

/** A box of the world, in pixels at a zoom of 1. */
export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** The distance between two samples of the grid that decides whether a person is hidden, in pixels of the world. */
export const SAMPLE_STEP = 2;
/** The least number of samples that are on the person and on the building for the person to be hidden by it: about a dozen pixels, a handful. */
export const MIN_OVERLAP = 3;
/**
 * How far over the thing that hides a person their shape is drawn in the order of drawing: more than the door lanterns of a
 * house are over the house (0.1), and less than a walker on the deck of the bridge is over the bridge (0.25). The nearer of two
 * people behind the same thing has up to `SORT_SPREAD` more, so that it is drawn over the other.
 */
export const SORT_LIFT = 0.12;
export const SORT_SPREAD = 0.08;

/** The smallest box that holds the solid pixels of a frame, in pixels of the sprite from the top left of its frame. */
export interface Tight {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** The tight boxes of the frames that were asked about. A frame is looked through once, for every person who is drawn with it. */
const TIGHT = new Map<string, Tight>();

/**
 * The part of a frame that has a body. A figure's frame is much larger than the figure (it holds the soft shadow and the room for a step), and
 * the silhouette of a person and the question whether a building hides them are asked of this box and not of the frame.
 */
export function tightOf(def: { id: string; w: number; h: number }, index: number, pixels: FrameBox): Tight {
  const key = `${def.id}|${index}|${pixels.scale}`;
  let found = TIGHT.get(key);
  if (found === undefined) {
    let u0 = def.w;
    let v0 = def.h;
    let u1 = -1;
    let v1 = -1;
    for (let v = 0; v < def.h; v++) {
      for (let u = 0; u < def.w; u++) {
        if (pixels.plane.at(pixels.x + u * pixels.scale, pixels.y + v * pixels.scale) < SOLID) continue;
        if (u < u0) u0 = u;
        if (u > u1) u1 = u;
        if (v < v0) v0 = v;
        if (v > v1) v1 = v;
      }
    }
    found = u1 < 0 ? { u0: 0, v0: 0, u1: def.w, v1: def.h } : { u0, v0, u1: u1 + 1, v1: v1 + 1 };
    TIGHT.set(key, found);
  }
  return found;
}


/** A person who can be hidden: where the body is now, and which pixels of it are solid. */
export interface Hidable {
  id: string;
  /** The place of the person in the order of drawing: the ground they stand on. */
  sort: number;
  /** Where the feet are, and which frame is drawn. A person who has none of these changed has the same shapes as before. */
  x: number;
  y: number;
  frame: number;
  /** The box of the world that holds the body of the frame that is drawn: the frame itself, until the pixels are at hand to say where the body is in it. */
  box: Box;
  /** Whether the body of the frame is solid at a point of the world (the soft shadow baked under it is not). */
  covers(wx: number, wy: number): boolean;
}

/** Something that can hide a person: a sprite of the sorted container, with its body. */
export interface Hiding {
  /** What it is, for the tests: the place id, or the sprite id of a prop. */
  id: string;
  /** What tells one instance from another that has the same id. */
  key: string;
  sort: number;
  box: Box;
  /** Whether the sprite has a body at a point of the world. False before the pixels are at hand. */
  covers(wx: number, wy: number): boolean;
}

/** A person hidden by one thing. */
export interface Hidden<P extends Hidable = Hidable, H extends Hiding = Hiding> {
  person: P;
  hider: H;
}

export const boxesMeet = (a: Box, b: Box): boolean => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** A thing hides a person only if it is drawn after them. A person drawn after it is in front of it. */
export const hides = (hider: Hiding, person: Hidable): boolean => hider.sort > person.sort;

/**
 * How many samples of a grid over the two boxes are on the body of the person and on the body of the
 * thing. It stops counting at `stopAt`, since it is asked whether there are enough.
 */
export function overlapSamples(person: Hidable, hider: Hiding, stopAt: number = MIN_OVERLAP): number {
  const x0 = Math.max(person.box.x0, hider.box.x0);
  const y0 = Math.max(person.box.y0, hider.box.y0);
  const x1 = Math.min(person.box.x1, hider.box.x1);
  const y1 = Math.min(person.box.y1, hider.box.y1);
  let hits = 0;
  for (let y = y0 + SAMPLE_STEP / 2; y < y1; y += SAMPLE_STEP) {
    for (let x = x0 + SAMPLE_STEP / 2; x < x1; x += SAMPLE_STEP) {
      if (person.covers(x, y) && hider.covers(x, y)) {
        hits++;
        if (hits >= stopAt) return hits;
      }
    }
  }
  return hits;
}

/** Whether a thing hides a person, in the sense of the silhouette: it is drawn after them, and their bodies cover each other at more than a few pixels. */
export function isHidden(person: Hidable, hider: Hiding): boolean {
  return hides(hider, person) && boxesMeet(person.box, hider.box) && overlapSamples(person, hider) >= MIN_OVERLAP;
}

/**
 * The place of the shape of a person in the order of drawing: just over the thing that hides them, below everything nearer than
 * that, and above the lanterns at the doors. Of two people behind the same thing the nearer one is drawn over the other.
 */
export function silhouetteSort(hiderSort: number, personSort: number): number {
  const near = hiderSort > 0 ? Math.min(1, Math.max(0, personSort / hiderSort)) : 0;
  return hiderSort + SORT_LIFT + SORT_SPREAD * near;
}

/** Whether a point of the world is on the shape: on the body of the person and on the body of the thing over them, and nowhere else. */
export const silhouetteCovers = (person: Hidable, hider: Hiding, wx: number, wy: number): boolean => person.covers(wx, wy) && hider.covers(wx, wy);

/** The shape as a thing the pointer can be over. It is the person who is picked there, and no slack is given to the edge of the shape. */
export function silhouettePickable(person: Hidable, hider: Hiding): Pickable {
  return {
    kind: "person",
    id: person.id,
    sort: silhouetteSort(hider.sort, person.sort),
    covers: (wx: number, wy: number): boolean => silhouetteCovers(person, hider, wx, wy),
  };
}

interface Seen<H> {
  epoch: number;
  x: number;
  y: number;
  frame: number;
  sort: number;
  /** What hides the person now. */
  by: H[];
}

/**
 * Keeps who is hidden by what. A person is looked at again only when they have moved, or changed the frame they are drawn
 * with, or when the things that hide have changed; the others keep the answer they had.
 */
export class OcclusionTracker<P extends Hidable = Hidable, H extends Hiding = Hiding> {
  /** Who is hidden by what now, in the order of the people. The list is kept and rebuilt when it changes. */
  readonly pairs: Hidden<P, H>[] = [];
  private readonly seen = new Map<P, Seen<H>>();
  private readonly found: H[] = [];
  private stamp = Number.NaN;
  private ready = false;
  private epoch = 0;

  /**
   * Takes the people and the things that hide as they are now. `stamp` changes when the things that hide have, and `ready` is
   * whether the pixels are at hand: nobody is hidden before. Tells whether the list of pairs is another one.
   */
  update(people: readonly P[], hiders: readonly H[], stamp: number, ready: boolean): boolean {
    const force = stamp !== this.stamp || ready !== this.ready;
    this.stamp = stamp;
    this.ready = ready;
    this.epoch++;
    let changed = false;
    for (const person of people) {
      let seen = this.seen.get(person);
      if (seen === undefined) {
        seen = { epoch: this.epoch, x: Number.NaN, y: Number.NaN, frame: Number.NaN, sort: Number.NaN, by: [] };
        this.seen.set(person, seen);
      }
      seen.epoch = this.epoch;
      if (!force && seen.x === person.x && seen.y === person.y && seen.frame === person.frame && seen.sort === person.sort) continue;
      seen.x = person.x;
      seen.y = person.y;
      seen.frame = person.frame;
      seen.sort = person.sort;
      if (this.look(person, seen, hiders)) changed = true;
    }
    // Everyone who is in the list has been seen just now, so a map that holds more has someone who is gone.
    if (this.seen.size > people.length) {
      for (const [person, seen] of this.seen) {
        if (seen.epoch === this.epoch) continue;
        if (seen.by.length > 0) changed = true;
        this.seen.delete(person);
      }
    }
    if (changed) {
      this.pairs.length = 0;
      for (const person of people) {
        const by = this.seen.get(person)?.by ?? [];
        for (const hider of by) this.pairs.push({ person, hider });
      }
    }
    return changed;
  }

  /** Finds what hides a person now. Tells whether it is another set from the one they had. */
  private look(person: P, seen: Seen<H>, hiders: readonly H[]): boolean {
    const found = this.found;
    found.length = 0;
    if (this.ready) for (const hider of hiders) if (isHidden(person, hider)) found.push(hider);
    let same = found.length === seen.by.length;
    for (let i = 0; same && i < found.length; i++) same = found[i] === seen.by[i];
    if (same) return false;
    seen.by.length = 0;
    for (const hider of found) seen.by.push(hider);
    return true;
  }
}
