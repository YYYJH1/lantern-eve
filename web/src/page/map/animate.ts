/**
 * Which frame of a character to draw: the direction it faces, the animation it is in, and the
 * frame of that animation. All of it is a function of how the person moved, so a person who is
 * standing is drawn the same way every time the map is drawn, and the tests can say what it is.
 *
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */
import { type Anim, type Dir, type SpriteDef } from "./manifest.ts";

/**
 * On a diagonal the axis of the movement changes only when the other axis is this much longer
 * than the one the person already faces along, so that a path that bends does not make the figure
 * turn back and forth.
 */
export const HYSTERESIS = 1.35;
/** A movement shorter than this, in pixels, is not a movement. */
const NO_MOVE = 1e-6;
/** A person who has less than this many pixels left to go has arrived, and stops walking. */
export const ARRIVED = 1.5;

/**
 * The direction a figure faces for a movement on the screen (pixels, down is positive): the main
 * axis of the movement, with a hysteresis on the diagonals. When there is no movement the figure
 * keeps the direction it had.
 */
export function chooseDir(vx: number, vy: number, previous: Dir, hysteresis: number = HYSTERESIS): Dir {
  const ax = Math.abs(vx);
  const ay = Math.abs(vy);
  if (ax < NO_MOVE && ay < NO_MOVE) return previous;
  const wasHorizontal = previous === "left" || previous === "right";
  const horizontal = wasHorizontal ? !(ay > ax * hysteresis) : ax > ay * hysteresis;
  if (horizontal) return vx < 0 ? "left" : vx > 0 ? "right" : previous;
  return vy < 0 ? "up" : vy > 0 ? "down" : previous;
}

/** What a person is doing, as far as the figure shows it. */
export interface Doing {
  moving: boolean;
  /** In a talk with the player, standing. */
  talking: boolean;
  /** What the person carries (an item id), or null. */
  carrying: string | null;
}

/**
 * The animation of a figure. A person on the move walks, and walks with the bamboo on the shoulder
 * if there is bamboo and the figure has that animation. A person who stands talks if they are in a
 * talk, stands with the bamboo (the first frame of the carrying walk) if they carry it, and
 * otherwise idles. An animation that the figure does not have falls back to the next.
 */
export function chooseAnim(sprite: SpriteDef, doing: Doing): string {
  const has = (name: string): boolean => sprite.anims.has(name);
  const bamboo = doing.carrying === "bamboo" && has("carry");
  if (doing.moving) return bamboo ? "carry" : has("walk") ? "walk" : has("idle") ? "idle" : firstAnim(sprite);
  if (doing.talking && has("talk")) return "talk";
  if (bamboo) return "carry";
  return has("idle") ? "idle" : firstAnim(sprite);
}

function firstAnim(sprite: SpriteDef): string {
  return sprite.anims.keys().next().value ?? "idle";
}

const wrap = (n: number, m: number): number => ((n % m) + m) % m;

/**
 * The frame of an animation, counted from its first. An animation that has a stride is driven by
 * the ground the person has walked, `floor(distance / stride * frames) % frames`, and stands on its
 * first frame when the person does not move. The others (idle, talk) run on the clock at their own
 * rate, offset by `phase` seconds so that two people do not breathe in step.
 */
export function frameOf(anim: Anim, walked: number, moving: boolean, seconds: number, phase = 0): number {
  if (anim.stride !== null) return moving ? wrap(Math.floor((walked / anim.stride) * anim.frames), anim.frames) : 0;
  return wrap(Math.floor((seconds + phase) * anim.fps), anim.frames);
}

/** What to draw for a figure: the frame of the sprite, and how it was chosen. */
export interface Pose {
  anim: string;
  dir: Dir;
  /** The frame of the animation, from 0. */
  frame: number;
  /** The frame of the sprite, which is what the atlas is indexed by. */
  index: number;
}

export interface PoseInput extends Doing {
  dir: Dir;
  /** The ground the person has walked, in pixels, since the figure was made. */
  walked: number;
  seconds: number;
  phase: number;
  /** The player asks for less motion: no cycle of the legs, and no breathing. */
  reduced: boolean;
}

/** The pose of a figure. Returns null for a sprite that has no animation to draw. */
export function poseOf(sprite: SpriteDef, input: PoseInput): Pose | null {
  const name = chooseAnim(sprite, input.reduced ? { ...input, moving: false } : input);
  const anim = sprite.anims.get(name);
  if (anim === undefined) return null;
  const frame = input.reduced ? 0 : frameOf(anim, input.walked, input.moving, input.seconds, input.phase);
  const index = anim.dirs[input.dir][frame];
  return index === undefined ? null : { anim: name, dir: input.dir, frame, index };
}

/** A fixed small number for a name, in [0, 1): the same person always gets the same phase. */
export function phaseOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}
