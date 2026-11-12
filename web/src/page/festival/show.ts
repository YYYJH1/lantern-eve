/**
 * The show of the festival night, which plays at the ending before the ending page (`director.ts`, `registerEndingShow`). It is made from what the
 * ending says really happened (`ending.festival`, the label of the ending and its hidden tags) and is the same each time for the same ending: a game
 * played to its end, a recording that reaches it, a finished save that is loaded and a recording taken to its end all see the same night.
 *
 *   - `plan.ts` says who stands where and who walks, `timeline.ts` when each thing happens and where the camera is, `stage.ts` draws it on the map.
 *   - The show moves the camera itself, second by second, and the controller's stops only say how long it lasts and which words are over the map:
 *     the opening line, the storyteller's line for the hidden ending, and the closing line for what the night was.
 *   - It is skipped by the controller (the button in the corner, Esc), and whichever way it ends, what it drew is taken away and the town is
 *     given back as it was.
 *
 * The time the show spends in its own update of each animation frame is kept (`festivalStats`), so that a test can say how heavy the night is for the page
 * without looking at the frame rate of a browser that draws in software.
 */
import { type Caption, type EndingShowContext, registerEndingShow, type Show, type Stop } from "../director.ts";
import { lanternFestivalOn } from "../eggs.ts";
import type { FrameTime } from "../frame.ts";
import type { Name } from "../scene.ts";
import { lightState } from "../map/light.ts";
import { FestivalStage, type StageStats } from "./stage.ts";
import { buildPlan, nearestWalker, type Plan, riverBedOf } from "./plan.ts";
import { buildTimeline, calmEyeAtTime, eyeAtTime, OPEN_TRAVEL, OPEN_UNTIL, type Timeline } from "./timeline.ts";
import { closingKey, falseStory, hasStoryteller, OPENING } from "./words.ts";

/** What the page keeps of the frames of the last night it played: the milliseconds each update took, and what the stage drew last. */
export interface FestivalStats {
  frames: number;
  /** The mean, the 95th percentile and the largest of the milliseconds the show's update of a frame took. */
  mean: number;
  p95: number;
  max: number;
  samples: number[];
  /** The show that is on, or the last one: its plan, its timeline and what it drew. */
  plan: Plan | null;
  timeline: Timeline | null;
  stage: StageStats | null;
}

const NIGHT: FrameTime = { day: 5, hour: 21, minute: 0, phase: "night" };

/** What the festival night tells the sound of the page while a parade walks: that it has begun, how far the nearest of the walkers is from the camera (0 is among them) and on which side, and that it is over. */
export interface FestivalSound {
  start(): void;
  setDistance(cells: number, side: -1 | 0 | 1): void;
  stop(): void;
}

let sound: FestivalSound | null = null;

/** Gives the festival night the sound of the page, or takes it away. Without one the night is silent, as it is where the page has no sound. */
export function setFestivalSound(next: FestivalSound | null): void {
  sound = next;
}

/** How far the nearest walker is when no one is on the map yet, in cells: far enough to be a faint murmur. */
const FAR_CELLS = 60;
/** The most samples of the time of an update the page keeps. */
const MAX_SAMPLES = 6000;

let samples: number[] = [];
let last: { plan: Plan; timeline: Timeline; stage: FestivalStage } | null = null;

const percentile = (sorted: readonly number[], share: number): number => (sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))] as number));

/** The time the show took in its own update of each frame, and what it has drawn. */
export function festivalStats(): FestivalStats {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    frames: samples.length,
    mean: samples.length === 0 ? 0 : samples.reduce((sum, ms) => sum + ms, 0) / samples.length,
    p95: percentile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? 0,
    samples: [...samples],
    plan: last?.plan ?? null,
    timeline: last?.timeline ?? null,
    stage: last?.stage.describe() ?? null,
  };
}

/** Where the whole of a night's controller stops fall, from the captions of its timeline: the words over the map, and nothing between. */
export function stopsOf(timeline: Timeline, captions: Record<"open" | "story" | "close", Caption>): Stop[] {
  const stops: Stop[] = [];
  // The opening line is there from the first moment, while the camera settles on the whole town, and stays to the end of its span.
  stops.push({ at: "town", zoom: 1, travel: OPEN_TRAVEL * 1000, hold: Math.max(0, (OPEN_UNTIL - OPEN_TRAVEL) * 1000), caption: captions.open });
  let at = OPEN_UNTIL;
  for (const span of timeline.captions.filter((c) => c.kind !== "open").sort((a, b) => a.from - b.from)) {
    if (span.from > at) stops.push({ at: "town", zoom: 1, travel: 0, hold: (span.from - at) * 1000, caption: null });
    stops.push({ at: "town", zoom: 1, travel: 0, hold: (span.until - span.from) * 1000, caption: captions[span.kind] });
    at = span.until;
  }
  if (timeline.duration > at) stops.push({ at: "town", zoom: 1, travel: 0, hold: (timeline.duration - at) * 1000, caption: null });
  return stops;
}

/** Makes the show of the night for an ending, or null where the map has no sprites to stage it with. */
export function festivalShow(context: EndingShowContext): Show | null {
  const { ending, festival, scene, map, port, calm } = context;
  if (scene === null || scene.plain || map === null) return null;
  const host = map.stageHost();
  if (host === null || host.sheet === null) return null;
  const seed = ending.tick ?? 0;
  const plan = buildPlan(festival, scene, seed, ending.id);
  const storyteller = hasStoryteller(ending);
  const timeline = buildTimeline(plan, scene, storyteller, port.town());
  const time = context.frame?.time ?? NIGHT;
  const light = context.frame === null ? { peopleTint: 0xaab0d0, glow: 1 } : lightState(time, context.frame.weather);
  let stage: FestivalStage;
  try {
    // On a Lantern Festival of the calendar (by the day of the player's computer) the river carries twice the lanterns.
    stage = new FestivalStage({ host, plan, scene, timeline, storyteller, calm, light: { peopleTint: light.peopleTint, glow: light.glow }, river: riverBedOf(scene), riverFactor: lanternFestivalOn(new Date()) ? 2 : 1 });
  } catch (err) {
    console.warn(`the festival night could not be staged: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
  samples = [];
  last = { plan, timeline, stage };
  host.setStaged(true);
  // The drums and the tune are for a parade that walks.
  const music = plan.line === null ? null : sound;
  music?.start();

  // The words are read when they are drawn: the storyteller's line comes from the whole ending, which can arrive a moment after the show has begun.
  const story: Caption = {
    get key() {
      return falseStory(context.latest().reveal) === null ? "festival.storyPlain" : "festival.story";
    },
    get quotes(): Record<string, Name> {
      const said = falseStory(context.latest().reveal);
      return said === null ? {} : { story: said };
    },
  };
  const captions = { open: { key: OPENING, style: "title" as const }, story, close: { key: closingKey(festival, ending.id) } };

  let ended = false;
  return {
    id: "festival",
    skippable: true,
    stops: stopsOf(timeline, captions),
    duration: timeline.duration * 1000,
    frame(elapsed: number): void {
      if (ended) return;
      const begun = performance.now();
      const seconds = elapsed / 1000;
      stage.update(seconds);
      // The controller brings the camera to the whole town in the first moments; from then on the show moves it.
      const eye = seconds >= OPEN_TRAVEL ? (calm ? calmEyeAtTime(timeline, seconds) : eyeAtTime(timeline, seconds)) : port.eye();
      if (seconds >= OPEN_TRAVEL) port.look(eye);
      if (music !== null) {
        const near = nearestWalker(plan, seconds, eye);
        music.setDistance(near === null ? FAR_CELLS : near.cells, near === null ? 0 : near.side);
      }
      samples.push(performance.now() - begun);
      if (samples.length > MAX_SAMPLES) samples.shift();
    },
    end(): void {
      if (ended) return;
      ended = true;
      music?.stop();
      stage.destroy();
      try {
        host.setStaged(false);
      } catch {
        // the map was taken apart, and what it put away is gone with it
      }
    },
  };
}

/** Registers the show of the festival night with the controller. Returns what takes it away again. */
export const registerFestivalShow = (): (() => void) => registerEndingShow(festivalShow);

