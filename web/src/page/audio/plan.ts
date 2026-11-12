/**
 * What sounds when. This is the whole of the scheduler's judgement, and it is pure: from the time of day, the weather, where the camera
 * looks, where the night watchman is and what the player is doing, it says how loud each layer of the ambience is and where in the
 * stereo field. The camera's distance only sets the loudness and the pan, there is no room acoustics. Nothing here is heard by the
 * core and nothing in it is an input of the game.
 */
import { daylight, NIGHT_LIGHT } from "../frame.ts";
import type { Scene } from "../scene.ts";
import { clamp, smoothstep } from "./dsp.ts";
import type { LayerId } from "./layer.ts";
import { LAYER_IDS } from "./layer.ts";

/** Where the camera looks, in cells of the town, and how much of the town it shows (half the width of the picture, in cells). */
export interface Listener {
  x: number;
  y: number;
  reach: number;
}

/** The whole town in view, for a page that has no map to ask (the tests of the host). */
export const WHOLE_TOWN: Listener = { x: 28, y: 16, reach: 28 };

/** Where the sounds that belong to a place come from, read once from the scene. */
export interface Sources {
  /** The cells of the river. */
  river: ReadonlyArray<readonly [number, number]>;
  /** The market's area: the left, top, width and height in cells. */
  market: { x: number; y: number; w: number; h: number } | null;
}

export const NO_SOURCES: Sources = { river: [], market: null };

export function sourcesOf(scene: Scene | null): Sources {
  if (scene === null || scene.plain) return NO_SOURCES;
  const river: Array<readonly [number, number]> = [];
  scene.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (scene.legend.get(row.charAt(x)) === "river") river.push([x, y]);
    }
  });
  const place = scene.places.find((p) => p.kind === "market");
  return { river, market: place === undefined ? null : { ...place.rect } };
}

export interface Watchman {
  x: number;
  y: number;
  /** He is on his round. */
  patrolling: boolean;
}

export interface MixInput {
  hour: number;
  minute: number;
  weather: string;
  listener: Listener;
  watchman: Watchman | null;
  sources: Sources;
}

export interface LayerMix {
  level: number;
  pan: number;
}

export type Mix = Record<LayerId, LayerMix>;

export const SILENCE: Mix = Object.fromEntries(LAYER_IDS.map((id) => [id, { level: 0, pan: 0 }])) as Mix;

/** How near a source is, from 1 on top of it to nothing far away: half at four fifths of what the camera shows. */
export function nearness(distance: number, reach: number): number {
  const r = Math.max(reach, 4);
  return 1 / (1 + (Math.max(0, distance) / (0.8 * r)) ** 2);
}

/** Which side a source is on: -0.8 at the left edge of the picture and 0.8 at the right edge, and no further. */
export function panOf(dx: number, reach: number): number {
  return clamp(dx / Math.max(reach, 4), -1, 1) * 0.8;
}

/** How dark it is, from 0 in daylight to 1 deep in the night: the map's own light, turned over. */
export function darkness(hour: number, minute: number): number {
  return clamp((1 - daylight(hour, minute)) / (1 - NIGHT_LIGHT), 0, 1);
}

/** How hard it rains, 0 to 1, from the name of the weather the core gives. */
export function rainOf(weather: string): number {
  const w = weather.toLowerCase();
  if (/heavy|storm|downpour|大雨|暴雨/.test(w)) return 1;
  if (/rain|drizzle|shower|雨/.test(w)) return 0.5;
  return 0;
}

/** The birds of the morning: from the first light, full from about six to half past eight, gone by eleven. */
export function birdsOf(hour: number, minute: number): number {
  const h = hour + minute / 60;
  return smoothstep(4.6, 6.2, h) * (1 - smoothstep(8.5, 10.8, h));
}

/** The market's trade: it wakes at seven, is busiest about noon, and thins out towards evening. */
export function crowdOf(hour: number, minute: number): number {
  const h = hour + minute / 60;
  const open = smoothstep(6.5, 8.5, h) * (1 - smoothstep(17, 19, h));
  const busy = 0.75 + 0.25 * (1 - smoothstep(0, 5, Math.abs(h - 12)));
  return open * busy;
}

/** The nearest point of a rectangle to a point. */
function nearestIn(rect: { x: number; y: number; w: number; h: number }, x: number, y: number): { x: number; y: number } {
  return { x: clamp(x, rect.x, rect.x + rect.w), y: clamp(y, rect.y, rect.y + rect.h) };
}

function layerAt(level: number, from: { x: number; y: number }, to: Listener): LayerMix {
  const distance = Math.hypot(from.x - to.x, from.y - to.y);
  return { level: level * nearness(distance, to.reach), pan: panOf(from.x - to.x, to.reach) };
}

export function planMix(input: MixInput): Mix {
  const { hour, minute, listener, sources } = input;
  const dark = darkness(hour, minute);
  const rain = rainOf(input.weather);
  const mix: Mix = { river: { level: 0, pan: 0 }, market: { level: 0, pan: 0 }, birds: { level: 0, pan: 0 }, insects: { level: 0, pan: 0 }, rain: { level: 0, pan: 0 }, watch: { level: 0, pan: 0 } };

  // The river runs all day and all night, a little lower when the night has its own voices.
  if (sources.river.length > 0) {
    let best: readonly [number, number] | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const cell of sources.river) {
      const d = Math.hypot(cell[0] + 0.5 - listener.x, cell[1] + 0.5 - listener.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = cell;
      }
    }
    if (best !== null) mix.river = layerAt(1 - 0.3 * dark, { x: best[0] + 0.5, y: best[1] + 0.5 }, listener);
  }

  // The market is heard by day and near the market. Rain drowns it.
  const crowd = crowdOf(hour, minute);
  if (sources.market !== null && crowd > 0) {
    const area = sources.market;
    const nearest = nearestIn(area, listener.x, listener.y);
    const distance = Math.hypot(nearest.x - listener.x, nearest.y - listener.y);
    // The loudness is of the nearest edge of the market, the side of the market's middle.
    mix.market = {
      level: crowd * (1 - 0.75 * rain) * nearness(distance, listener.reach),
      pan: panOf(area.x + area.w / 2 - listener.x, listener.reach),
    };
  }

  // The birds are everywhere in the morning and are gone in rain.
  mix.birds = { level: birdsOf(hour, minute) * (1 - clamp(rain * 1.7, 0, 1)), pan: 0 };

  // The insects come with the dusk and thin out in rain.
  mix.insects = { level: smoothstep(0.12, 0.7, dark) * (1 - 0.8 * rain), pan: 0 };

  // Rain is the same everywhere in the town.
  mix.rain = { level: rain, pan: 0 };

  // The watchman's clapper is heard from far off, on his round only, and less in rain.
  if (input.watchman?.patrolling === true) {
    const w = input.watchman;
    const at = layerAt(0.9 * (1 - 0.5 * rain), { x: w.x + 0.5, y: w.y + 0.5 }, { ...listener, reach: listener.reach * 1.2 });
    mix.watch = at;
  }
  return mix;
}

/** Whether the world runs, or who stopped it: a sheet of the page (the notebook), the player's pause, or a hidden tab. */
export type Stillness = "running" | "page" | "player" | "tab";

/** What the ambience is lowered to: out when the player paused or the tab is hidden, a third while a sheet holds the world, half in a talk. */
export function ambienceDuck(talking: boolean, stillness: Stillness): number {
  if (stillness === "player" || stillness === "tab") return 0;
  let duck = talking ? 0.5 : 1;
  if (stillness === "page") duck = Math.min(duck, 0.35);
  return duck;
}

/** The loudness of a volume the player chose (0 to 1): a curve that makes the middle of the slider a middle loudness. */
export const volumeGain = (volume: number): number => clamp(volume, 0, 1) ** 2;
