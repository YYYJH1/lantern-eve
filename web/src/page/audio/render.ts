/**
 * The sounds of the game rendered to a file, for listening to them one by one. A rendering runs the very code the game runs, on an
 * offline context in place of the speakers: each layer on its own, the festival, each cue, and a few moments of the day put together by
 * the same plan the game follows. Nothing here is used while the game is played.
 */
import { CUE_SECONDS, type CueId, playCue } from "./cues.ts";
import { makeRig, type Rig } from "./dsp.ts";
import type { LayerId } from "./layer.ts";
import { makeLayers } from "./layers.ts";
import { buildMixer, type Mixer } from "./mixer.ts";
import { type MixInput, planMix, type Sources, volumeGain } from "./plan.ts";
import { DEFAULT_SETTINGS } from "./settings.ts";
import { Festival, TUNE_SECONDS } from "./tune.ts";

export interface ClipDef {
  id: string;
  seconds: number;
  /** What it should sound like. */
  what: string;
  make(rig: Rig, mixer: Mixer, sources: Sources, seconds: number): void;
}

export interface Rendered {
  id: string;
  sampleRate: number;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  /** The highest sample, as a fraction of full scale, and the average power in dB below full scale. */
  peak: number;
  rmsDb: number;
}

/** One layer, alone, at full level in the middle. */
function layerClip(id: string, layer: LayerId, level: number, what: string, seconds = 15): ClipDef {
  return {
    id,
    seconds,
    what,
    make(rig, mixer, _sources, length) {
      const found = makeLayers(rig, mixer.ambience).find((l) => l.id === layer);
      if (found === undefined) return;
      found.set(level, 0, 0, 0);
      found.schedule(length);
    },
  };
}

function cueClip(id: CueId, what: string): ClipDef {
  return {
    id: `cue-${id.replace(".", "-")}`,
    seconds: CUE_SECONDS[id],
    what,
    make(rig, mixer) {
      playCue(rig, mixer.effects, id, 0.05);
    },
  };
}

/** A moment of the day: the plan gives each layer its level and place, and the layers are made the way the game makes them. */
function momentClip(id: string, what: string, input: Omit<MixInput, "sources">, seconds = 20): ClipDef {
  return {
    id,
    seconds,
    what,
    make(rig, mixer, sources, length) {
      const mix = planMix({ ...input, sources });
      for (const layer of makeLayers(rig, mixer.ambience)) {
        layer.set(mix[layer.id].level, mix[layer.id].pan, 0, 0);
        layer.schedule(length);
      }
    },
  };
}

/** A whole day in a minute, from five in the morning to midnight, with a spell of rain after noon: the layers rise and fall as the plan says. */
function timelapseClip(seconds: number): ClipDef {
  return {
    id: "mix-day-timelapse",
    seconds,
    what: "A day in a minute, from five in the morning to midnight: the birds at dawn, the market by day with a spell of rain after noon that covers it, the insects at dusk and the watchman's clapper in the night.",
    make(rig, mixer, sources, length) {
      const layers = makeLayers(rig, mixer.ambience);
      const step = 0.25;
      for (let t = 0; t < length; t += step) {
        const h = 5 + (t / seconds) * 19;
        const rain = h >= 14.5 && h < 15.5 ? "heavy_rain" : h >= 13 && h < 16 ? "light_rain" : "clear";
        const mix = planMix({
          hour: Math.floor(h) % 24,
          minute: Math.floor((h % 1) * 60),
          weather: rain,
          listener: { x: 24, y: 17, reach: 14 },
          watchman: { x: 31, y: 14, patrolling: h >= 21 },
          sources,
        });
        for (const layer of layers) {
          layer.set(mix[layer.id].level, mix[layer.id].pan, t, t === 0 ? 0 : 0.35);
          layer.schedule(t + step + 0.6);
        }
      }
    },
  };
}

function festivalClip(id: string, seconds: number, what: string, parts: { tune: boolean; strikes: boolean }, path?: Array<[number, number, number]>): ClipDef {
  return {
    id,
    seconds,
    what,
    make(rig, mixer, _sources, length) {
      const festival = new Festival(rig, mixer.music, parts);
      const first = path?.[0];
      festival.place(first?.[1] ?? 0, first?.[2] ?? 0, 0, 0);
      festival.start(0);
      // The procession comes closer: the places the show would give, one after the other.
      for (const [at, distance, side] of path?.slice(1) ?? []) festival.place(distance, side, at, 1.2);
      festival.schedule(length);
    },
  };
}

const BY_THE_RIVER = { x: 24.5, y: 15.5, reach: 10 };
const IN_THE_MARKET = { x: 19.5, y: 20.5, reach: 8 };
const ON_THE_BRIDGE = { x: 27, y: 15.5, reach: 12 };

export const CLIPS: readonly ClipDef[] = [
  layerClip("layer-river", "river", 1, "A broad, slow river close by: a soft rumble with a flowing hush over it that swells and ebbs, and now and then a small bubble."),
  layerClip("layer-market", "market", 1, "A market crowd a little way off: a warm murmur of voices with no words in it, and a vendor's long cry from far off now and then."),
  layerClip("layer-birds", "birds", 1, "Morning birds: whistles, trills, runs of chips and the low coo of a dove, calling and answering across the stereo field."),
  layerClip("layer-insects", "insects", 1, "A summer night in the grass: two crickets that chirp in short bouts and a long trill of a katydid, high and thin, all soft."),
  layerClip("layer-rain-light", "rain", 0.5, "A light rain: a quiet hiss on roofs and leaves with single drops that can be told apart."),
  layerClip("layer-rain-heavy", "rain", 1, "A heavy rain: a dense roar of water on tiles with a low rumble under it, the drops running together."),
  layerClip("layer-watchman", "watch", 0.9, "The night watchman's wooden clapper, far off across the water: one knock and two quicker, every few seconds."),
  festivalClip("festival-drums", 15, "The procession's drums, gongs and cymbals alone: a big drum on the beat, a small one between, a clash of cymbals and a deep gong.", { tune: false, strikes: true }),
  festivalClip("festival-tune", TUNE_SECONDS + 3, "The festival tune once through, on plucked strings alone: sixteen bars in the five-note scale, a bright melody over a soft bass.", { tune: true, strikes: false }),
  festivalClip("festival-full", TUNE_SECONDS + 3, "The festival once through, the tune and the procession's drums, gongs and cymbals together.", { tune: true, strikes: true }),
  festivalClip(
    "festival-approach",
    24,
    "The procession coming closer: a faint low thump from far off that gains its drums, then its strings, then its brightness, and passes from the left to the middle.",
    { tune: true, strikes: true },
    [
      [0, 60, -1],
      [6, 32, -0.8],
      [11, 16, -0.4],
      [16, 6, -0.1],
      [20, 0, 0],
    ],
  ),
  cueClip("paper", "The bronze bell of the morning paper: one clear strike that rings out."),
  cueClip("job.bridge", "The bridge is mended: a press of the seal, a knock of wood, a quick climb of plucked notes and a firm chord at the top."),
  cueClip("job.truth", "The truth is told: a question that falls, then the answer rising to settle on the top, with a small bell."),
  cueClip("job.peace", "The families are at peace: two lines of notes that come together, a chord spread across the strings, and a low soft gong."),
  cueClip("moment", "The light cymbal of a moment: a soft shimmer that fades."),
  cueClip("ui.page", "A leaf of paper turned: a light rustle."),
  cueClip("ui.seal", "A seal pressed on the page: a soft thud."),
  cueClip("ui.ink", "A word of ink touched: a tiny tick."),
  momentClip("mix-dawn-river", "Dawn on the bank, 06:30: the river close, the birds in full chorus, the market not yet up.", { hour: 6, minute: 30, weather: "clear", listener: BY_THE_RIVER, watchman: null }),
  momentClip("mix-noon-market", "Noon at the market, 12:00: the crowd in front and the river behind it, no birds.", { hour: 12, minute: 0, weather: "clear", listener: IN_THE_MARKET, watchman: null }),
  momentClip("mix-dusk", "Dusk, 19:30: the market is quiet, the insects are coming in and the river carries on.", { hour: 19, minute: 30, weather: "clear", listener: BY_THE_RIVER, watchman: null }),
  momentClip("mix-night-watch", "Midnight by the bridge, 23:30: crickets, the river and the watchman's clapper not far off.", { hour: 23, minute: 30, weather: "clear", listener: ON_THE_BRIDGE, watchman: { x: 31, y: 14, patrolling: true } }),
  timelapseClip(60),
  momentClip("mix-rain-market", "A heavy rain at the market, 14:00: the rain over everything, the crowd and the birds hushed.", { hour: 14, minute: 0, weather: "heavy_rain", listener: IN_THE_MARKET, watchman: null }),
];

export const clipIds = (): string[] => CLIPS.map((clip) => clip.id);

/** Renders a clip, with the volumes the game starts with, at the sample rate given. */
export async function renderClip(id: string, sources: Sources, options: { sampleRate?: number; seed?: number; seconds?: number } = {}): Promise<Rendered> {
  const clip = CLIPS.find((c) => c.id === id);
  if (clip === undefined) throw new Error(`there is no clip called ${id}`);
  const sampleRate = options.sampleRate ?? 44100;
  // A test can ask for the first moments of a clip only.
  const seconds = Math.min(clip.seconds, options.seconds ?? clip.seconds);
  const length = Math.ceil(sampleRate * seconds);
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  const rig = makeRig(ctx, options.seed ?? 20261108);
  const mixer = buildMixer(rig);
  mixer.ambience.level.gain.value = volumeGain(DEFAULT_SETTINGS.ambience);
  mixer.music.level.gain.value = volumeGain(DEFAULT_SETTINGS.music);
  mixer.effects.level.gain.value = volumeGain(DEFAULT_SETTINGS.effects);
  clip.make(rig, mixer, sources, seconds);
  const buffer = await ctx.startRendering();
  const left = new Float32Array(buffer.getChannelData(0));
  const right = new Float32Array(buffer.getChannelData(1));
  let peak = 0;
  let power = 0;
  for (let i = 0; i < length; i++) {
    peak = Math.max(peak, Math.abs(left[i] ?? 0), Math.abs(right[i] ?? 0));
    power += (left[i] ?? 0) ** 2 + (right[i] ?? 0) ** 2;
  }
  const rmsDb = 10 * Math.log10(Math.max(power / (2 * length), 1e-20));
  return { id, sampleRate, left, right, peak, rmsDb };
}

