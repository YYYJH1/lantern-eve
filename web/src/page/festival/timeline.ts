/**
 * When things happen in the festival night, and where the camera is. The night begins with the whole town and the opening line, goes down to the
 * bridgehead and follows the head of the parade along its route to the plaza before the ancestral hall (a parade that does not walk is a tour of the
 * town's doors instead), stays there while the main lantern is lit, goes to the teahouse door for the storyteller if the ending has one, and draws
 * back to the whole town for the closing line. It is a plan in seconds from the start of the show, and has no PixiJS in it.
 *
 * The camera is a chain of anchors: a point (that may move, like the head of the parade) and how close. Each beat takes over from the one before
 * it by an eased blend, so the camera never jumps and the line of its path has no corner that the anchors do not have.
 */
import { ease } from "../director.ts";
import type { Eye } from "../map/camera.ts";
import { CELL, CELL_DEPTH } from "../map/geometry.ts";
import { anchorsOf, headAt, headArrives, type Plan, storyCentre, toWorld, WALK_PX_S } from "./plan.ts";
import type { Scene } from "../scene.ts";

/** Seconds the camera takes to settle on the whole town at the start, which the show controller does by its first stop. */
export const OPEN_TRAVEL = 1.2;
/** How long the opening line stays, from the start of the show. */
export const OPEN_UNTIL = 3.6;
/** How the camera is held while it follows the parade, in pixels behind the head, and how close it is. */
export const FOLLOW_BACK_PX = 3.4 * CELL;
/** Seconds the head of the parade is at the end of its route before the lantern is lit, and how long the lantern takes to flare. */
export const LIGHT_DELAY = 1.3;
export const FLARE_SECONDS = 1.4;

export interface Beat {
  /** The second the beat begins, and how long it takes to take the camera over from the beat before. */
  from: number;
  blend: number;
  anchor: (seconds: number) => Eye;
}

/** The words that stand over the map for a stretch of the night. */
export interface CaptionSpan {
  from: number;
  until: number;
  kind: "open" | "story" | "close";
}

export interface Timeline {
  duration: number;
  beats: Beat[];
  captions: CaptionSpan[];
  /** The second the head of the parade is at the end of its route (0 if it does not walk). */
  arrive: number;
  /** The second the main lantern begins to be lit, or null if nobody lights it. */
  lightAt: number | null;
  /** The second the storyteller's turn begins and ends, or null. */
  story: [number, number] | null;
  /** The second the camera begins to draw back to the whole town. */
  closing: number;
}

const eyeAt = (gx: number, gy: number, zoom: number): Eye => ({ ...toWorld(gx, gy), zoom });
const fixed =
  (eye: Eye) =>
  (): Eye =>
    eye;

/** An anchor that follows the head of the parade, a little behind it, with the points of the way averaged over a second and a half so that a corner is rounded. */
export function follow(plan: Plan, zoom: number): (seconds: number) => Eye {
  return (seconds) => {
    const line = plan.line;
    if (line === null) return eyeAt(0, 0, zoom);
    let x = 0;
    let y = 0;
    const samples = [-0.75, -0.375, 0, 0.375, 0.75];
    for (const dt of samples) {
      const at = line.at(Math.max(0, Math.min(line.length, headAt(plan, seconds + dt) - FOLLOW_BACK_PX)));
      x += at.x;
      y += at.y;
    }
    return { x: x / samples.length, y: y / samples.length, zoom };
  };
}

/** The timeline of the night for a plan. `hidden` is whether the ending has the storyteller; `town` is the eye that shows the whole town. */
export function buildTimeline(plan: Plan, scene: Scene, hidden: boolean, town: Eye): Timeline {
  const a = anchorsOf(scene);
  const townEye = { ...town, zoom: 1 };
  const beats: Beat[] = [{ from: 0, blend: 0, anchor: fixed(townEye) }];
  const captions: CaptionSpan[] = [{ from: 0.3, until: OPEN_UNTIL, kind: "open" }];
  let clock = OPEN_UNTIL;
  let arrive = 0;
  let lightAt: number | null = null;
  const lantern = plan.lantern;
  // The camera looks between the lantern and where the crowd stands, which is the side the parade comes from.
  const crowd = plan.bearers.filter((b) => b.role === "march");
  const crowdX = crowd.length === 0 ? lantern.x : crowd.reduce((sum, b) => sum + b.spot.x, 0) / crowd.length;
  const plazaEye: Eye = { x: lantern.x + (crowdX - lantern.x) * 0.5, y: lantern.y - 0.35 * CELL_DEPTH, zoom: 2.3 };
  const broken = eyeAt(a.bridge[0] + 0.5, a.bridge[1] + 0.9, 2.4);
  // The beat that brings the camera to the plaza begins `settle` seconds before the head of the parade is there (a night with no parade has the head there when the camera is).
  const settle = 3.4;
  let plazaFrom: number;

  if (plan.route === "bridge") {
    beats.push({ from: clock, blend: 3.6, anchor: follow(plan, 2.4) });
    arrive = headArrives(plan);
    plazaFrom = arrive - settle;
  } else if (plan.route === "lane") {
    beats.push({ from: clock, blend: 2.8, anchor: fixed(broken) });
    beats.push({ from: clock + 5, blend: 4.5, anchor: follow(plan, 2.4) });
    arrive = headArrives(plan);
    plazaFrom = arrive - settle;
  } else {
    beats.push({ from: clock, blend: 2.8, anchor: fixed(broken) });
    clock += 5.9;
    beats.push({ from: clock, blend: 3.5, anchor: fixed(eyeAt(a.li[0] + 0.5, a.li[1] + 1.2, 2.4)) });
    clock += 7;
    beats.push({ from: clock, blend: 3.5, anchor: fixed(eyeAt(a.zhou[0] + 0.5, a.zhou[1] + 1.2, 2.4)) });
    clock += 7;
    plazaFrom = clock;
    arrive = plazaFrom + settle;
  }
  beats.push({ from: plazaFrom, blend: settle + 0.4, anchor: fixed(plazaEye) });
  if (plan.lighters.length > 0 && plan.route !== "none") lightAt = arrive + LIGHT_DELAY;
  let leave = arrive + 6.6;

  let story: [number, number] | null = null;
  if (hidden) {
    const yard = storyCentre(scene);
    const teahouse: Eye = { x: yard.x, y: yard.y + 0.7 * CELL_DEPTH, zoom: 3 };
    beats.push({ from: leave, blend: 4, anchor: fixed(teahouse) });
    story = [leave + 1.6, leave + 4 + 5.4];
    captions.push({ from: story[0], until: story[1], kind: "story" });
    leave = story[1];
  }
  const closing = leave;
  beats.push({ from: closing, blend: 6, anchor: fixed(townEye) });
  const end = closing + 6 + 4.8;
  captions.push({ from: closing + 1.5, until: end, kind: "close" });
  return { duration: end, beats, captions, arrive, lightAt, story, closing };
}

/** Where the camera is `seconds` into the night, as the beats take it over one from another. */
export function eyeAtTime(timeline: Timeline, seconds: number): Eye {
  let eye = (timeline.beats[0] as Beat).anchor(seconds);
  for (const beat of timeline.beats.slice(1)) {
    if (seconds < beat.from) break;
    const next = beat.anchor(seconds);
    const f = beat.blend <= 0 ? 1 : ease(Math.min(1, (seconds - beat.from) / beat.blend));
    eye = {
      x: eye.x + (next.x - eye.x) * f,
      y: eye.y + (next.y - eye.y) * f,
      zoom: Math.exp(Math.log(eye.zoom) + (Math.log(next.zoom) - Math.log(eye.zoom)) * f),
    };
  }
  return eye;
}

/** How often the camera cuts in a night for a player who asked for less motion, in seconds. */
export const CALM_STEP = 5;

/** The eye of a player who asked for less motion: the camera does not glide, it is cut to where it would be at the end of each blend, and to a new place of a moving anchor every few seconds. */
export function calmEyeAtTime(timeline: Timeline, seconds: number): Eye {
  let settled = 0;
  for (const beat of timeline.beats) if (seconds >= beat.from) settled = beat.from + beat.blend;
  return eyeAtTime(timeline, Math.max(settled, Math.floor(seconds / CALM_STEP) * CALM_STEP));
}

/** The words that are over the map at a second, or null. */
export const captionAt = (timeline: Timeline, seconds: number): CaptionSpan["kind"] | null => timeline.captions.find((c) => seconds >= c.from && seconds < c.until)?.kind ?? null;

/** The speed of the parade, in cells a second, which the tests state the pace of the night by. */
export const WALK_CELLS_S = WALK_PX_S / CELL;
