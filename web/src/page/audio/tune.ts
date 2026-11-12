/**
 * The festival: a tune of sixteen bars in the five-note scale, played on plucked strings, with the gongs, drums and cymbals of the
 * procession under it. The tune is written as numbers (1 2 3 5 6 for the five notes, a mark after a number for the octave) and played
 * round and round. `Festival` is the one thing the show of the festival night needs: it starts, it stops, and its loudness follows how
 * far the procession is from where the camera is.
 */
import { clamp, gainNode, biquad, lerp, type Rig } from "./dsp.ts";
import { type Bus, toBus } from "./mixer.ts";
import { bell, cymbal, drum, gong, smallGong } from "./percussion.ts";
import { type Pluck, pluck, type StringKind } from "./strings.ts";

/** The tonic of the tune: the D above middle C. */
export const TONIC = 62;
/** Semitones above the tonic of the five notes. */
const DEGREE: Readonly<Record<string, number>> = { "1": 0, "2": 2, "3": 4, "5": 7, "6": 9 };

/** Beats a minute, and the number of eighth notes in a bar. */
export const TEMPO = 100;
export const SLOTS = 8;
export const EIGHTH = 60 / TEMPO / 2;
export const BAR = EIGHTH * SLOTS;

/**
 * The melody, a bar to a line, eight eighth notes to a bar. A number is a note, `'` after it is an octave up and `,` an octave
 * down, `~` presses the pitch up a tone after the pluck, `*` rolls the note, `^` plays a quick grace note from the scale just above
 * it first, `-` holds the last note on, `0` is a rest.
 */
export const MELODY: readonly string[] = [
  "3 - 5 3 2 3 5 -",
  "6 - 5 3 5~ - - -",
  "3^ 5 6 1' 6 5 3 2",
  "3 - - - 0 0 0 0",
  "3 - 5 3 2 3 5 -",
  "6 - 1' 6 5 - 3 5",
  "6^ 5 3 2 3 2 1 2",
  "1 - - - 0 0 6, 1",
  "1'^ - 2' 1' 6 - 5 6",
  "1' 2' 3' 2' 1' - 6 -",
  "5 6 1' 6 5 3 5 -",
  "6 - 5 3 2 3 5 6",
  "3^ - 5 3 2 3 5 -",
  "6 - 5 3 5 6 1'^ -",
  "6 5 3 2 3 2 1 6,",
  "1* - - - - - - -",
];

/** The note under each bar, a fifth above it is played on the third beat. */
const ROOTS: readonly number[] = [0, 0, 7, 0, 0, 9, 7, 0, 0, 2, 7, 7, 0, 0, 7, 0];

export interface Voice {
  /** Eighth notes from the start of the tune. */
  at: number;
  pluck: Pluck;
}

/** Reads one token of the melody: the MIDI note and how it is played. */
export function readToken(token: string): { note: number; slide: number; roll: boolean; grace: boolean } | null {
  const match = /^([12356])([',]*)([~*^]*)$/.exec(token);
  if (match === null) return null;
  const degree = DEGREE[match[1] ?? ""];
  if (degree === undefined) return null;
  const marks = match[2] ?? "";
  const octave = [...marks].reduce((sum, mark) => sum + (mark === "'" ? 1 : mark === "," ? -1 : 0), 0);
  const tail = match[3] ?? "";
  return { note: TONIC + degree + 12 * octave, slide: tail.includes("~") ? 2 : 0, roll: tail.includes("*"), grace: tail.includes("^") };
}

/** The note of the scale just above a note of it. */
export function above(note: number): number {
  for (let step = 1; step <= 4; step++) {
    const rel = (((note + step - TONIC) % 12) + 12) % 12;
    if (rel === 0 || rel === 2 || rel === 4 || rel === 7 || rel === 9) return note + step;
  }
  return note + 2;
}

/** The strings of the tune: the melody on the bright string, the bass and the fifth under it on the round one. */
export function tuneVoices(): Voice[] {
  const voices: Voice[] = [];
  MELODY.forEach((line, bar) => {
    const tokens = line.split(/\s+/);
    for (let slot = 0; slot < SLOTS; slot++) {
      const token = tokens[slot];
      if (token === undefined || token === "-" || token === "0") continue;
      const read = readToken(token);
      if (read === null) continue;
      // How long the note is: up to the next note or rest.
      let length = 1;
      while (tokens[slot + length] === "-") length++;
      const at = bar * SLOTS + slot;
      if (read.grace) {
        // The grace note comes a hair before the beat, from the scale just above, and is let go at once.
        voices.push({ at: at - 0.22, pluck: { note: above(read.note), kind: "pipa", vel: 0.62, hold: 0.07, pan: 0.1, wet: 0.3 } });
      }
      voices.push({
        at,
        pluck: {
          note: read.note,
          kind: read.roll ? "zheng" : "pipa",
          vel: read.roll ? 0.8 : slot % 4 === 0 ? 1.05 : 0.88,
          slide: read.slide || undefined,
          roll: read.roll ? length * EIGHTH : undefined,
          hold: length > 2 ? undefined : Math.max(0.28, length * EIGHTH * 1.7),
          pan: 0.1,
          wet: 0.32,
        },
      });
    }
    const root = TONIC - 12 + (ROOTS[bar] ?? 0);
    const accompaniment: Array<[number, number, number, StringKind]> = [
      [0, root, 0.78, "bass"],
      [2, root + 12 + 7, 0.4, "zheng"],
      [4, root + 7, 0.6, "bass"],
      [6, root + 12 + 12, 0.36, "zheng"],
    ];
    for (const [slot, note, vel, kind] of accompaniment) {
      voices.push({ at: bar * SLOTS + slot, pluck: { note, kind, vel, hold: kind === "zheng" ? 0.6 : undefined, pan: -0.25, wet: 0.35 } });
    }
  });
  // A sweep across the strings before the tune goes round again, and one to close the first half.
  const sweep = (bar: number, slot: number): void => {
    [0, 2, 4, 7, 9, 12, 14, 16, 19].forEach((step, i) => {
      voices.push({ at: bar * SLOTS + slot + i * 0.2, pluck: { note: TONIC - 5 + step, kind: "zheng", vel: 0.3 + 0.03 * i, hold: 0.25, pan: -0.1 + 0.03 * i, wet: 0.4 } });
    });
  };
  sweep(7, 5.2);
  sweep(15, 6);
  return voices;
}

type Strike = { at: number; kind: "big" | "small" | "clash" | "tap" | "gong" | "little" | "bell"; vel: number };

/** The procession's drums, cymbals and gongs, as a pattern over the same sixteen bars. */
export function patternStrikes(): Strike[] {
  const strikes: Strike[] = [];
  for (let bar = 0; bar < 16; bar++) {
    const base = bar * SLOTS;
    const fill = bar % 4 === 3;
    const lift = bar >= 8 && bar < 12;
    strikes.push({ at: base, kind: "big", vel: 0.95 });
    strikes.push({ at: base + 4, kind: "big", vel: 0.8 });
    if (!fill) strikes.push({ at: base + 6, kind: "big", vel: 0.45 });
    strikes.push({ at: base + 2, kind: "small", vel: 0.5 });
    strikes.push({ at: base + 6, kind: "small", vel: 0.55 });
    if (fill) {
      for (const slot of [5, 5.5, 6, 6.5, 7, 7.5]) strikes.push({ at: base + slot, kind: "small", vel: 0.35 + 0.05 * (slot - 5) });
    }
    if (lift) {
      for (const slot of [2, 6]) strikes.push({ at: base + slot, kind: "tap", vel: 0.55 });
    }
    if (bar % 4 === 0) strikes.push({ at: base, kind: "clash", vel: bar === 0 || bar === 8 ? 0.8 : 0.5 });
    if (bar === 0 || bar === 8) strikes.push({ at: base, kind: "gong", vel: 0.8 });
    if (bar === 15) strikes.push({ at: base + 6, kind: "little", vel: 0.7 });
    if (bar === 7) strikes.push({ at: base + 7, kind: "little", vel: 0.55 });
  }
  return strikes;
}

/** The length of the tune in seconds. */
export const TUNE_SECONDS = 16 * BAR;

interface Entry {
  time: number;
  play: (rig: Rig, t: number, into: { dry: GainNode; send: null }) => void;
}

/** Which of the two the festival plays: the strings of the tune, the strikes of the procession. */
export interface Parts {
  tune: boolean;
  strikes: boolean;
}

/** Everything that sounds in one round of the tune, sorted by time. */
export function timeline(parts: Parts = { tune: true, strikes: true }): Entry[] {
  const entries: Entry[] = [];
  for (const voice of parts.tune ? tuneVoices() : []) {
    entries.push({
      time: voice.at * EIGHTH,
      play: (rig, t, into) => {
        pluck(rig, t, voice.pluck, into);
      },
    });
  }
  for (const strike of parts.strikes ? patternStrikes() : []) {
    entries.push({
      time: strike.at * EIGHTH,
      play: (rig, t, into) => {
        const hit = { bus: into, vel: strike.vel * 0.5, wet: 0.22 };
        if (strike.kind === "big") drum(rig, t, hit, "big");
        else if (strike.kind === "small") drum(rig, t, { ...hit, pan: 0.25 }, "small");
        else if (strike.kind === "clash") cymbal(rig, t, { ...hit, vel: strike.vel * 0.8, pan: -0.2 }, "clash");
        else if (strike.kind === "tap") cymbal(rig, t, { ...hit, vel: strike.vel * 0.7, pan: 0.3 }, "tap");
        else if (strike.kind === "gong") gong(rig, t, { ...hit, vel: strike.vel * 0.9, wet: 0.35 }, 150, 3.6);
        else if (strike.kind === "little") smallGong(rig, t, { ...hit, vel: strike.vel * 0.7, pan: 0.2, wet: 0.3 });
        else bell(rig, t, hit);
      },
    });
  }
  return entries.sort((a, b) => a.time - b.time);
}

/** How loud the festival is, 0 to 1, at a distance from the camera in cells. */
export function festivalLevel(distance: number): number {
  const d = Math.max(0, distance);
  return clamp(1 / (1 + (d / 14) ** 1.7), 0, 1);
}

/** The top of the festival's sound at that level: far off only the low drums and the gong carry. */
export function festivalCutoff(level: number): number {
  return lerp(650, 9000, clamp(level, 0, 1) ** 1.4);
}

/**
 * The music of the festival night. It plays the tune and the procession's strikes round and round from `start`, until `stop`.
 * `place` sets how far off it is (and on which side), and its loudness and brightness follow.
 */
export class Festival {
  private readonly entries: Entry[];
  private readonly level: GainNode;
  private readonly roll: BiquadFilterNode;
  private readonly panner: StereoPannerNode;
  private readonly into: { dry: GainNode; send: null };
  private origin = 0;
  private index = 0;
  private round = 0;
  private running = false;
  private lastLevel = -1;

  constructor(
    private readonly rig: Rig,
    bus: Bus,
    parts: Parts = { tune: true, strikes: true },
  ) {
    const ctx = rig.ctx;
    this.entries = timeline(parts);
    this.level = gainNode(ctx, 0);
    this.roll = biquad(ctx, "lowpass", 9000, 0.5);
    this.panner = ctx.createStereoPanner();
    this.level.connect(this.roll);
    this.roll.connect(this.panner);
    toBus(rig, this.panner, bus, 0.2);
    this.into = { dry: this.level, send: null };
  }

  get active(): boolean {
    return this.running;
  }

  /** Begins the tune at time `t`, with the level where `place` last put it. */
  start(t: number): void {
    if (this.running) return;
    this.running = true;
    this.origin = t + 0.05;
    this.index = 0;
    this.round = 0;
    this.lastLevel = -1;
  }

  /** Ends the festival: what is playing is faded out over a second. */
  stop(t: number): void {
    if (!this.running) return;
    this.running = false;
    this.level.gain.cancelScheduledValues(t);
    this.level.gain.setTargetAtTime(0, t, 0.3);
  }

  /** Sets how far off the procession is, in map cells, and on which side (-1 left, 1 right). */
  place(distance: number, side: number, t: number, timeConstant = 0.4): void {
    const level = festivalLevel(distance);
    if (Math.abs(level - this.lastLevel) < 0.002 && timeConstant > 0) return;
    this.lastLevel = level;
    const set = (param: AudioParam, value: number): void => {
      if (timeConstant <= 0) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, timeConstant);
    };
    // The festival is never louder than its place in the mix: the volume of the music is the player's.
    set(this.level.gain, level);
    set(this.roll.frequency, festivalCutoff(level));
    set(this.panner.pan, clamp(side, -1, 1) * 0.6 * (1 - 0.5 * level));
  }

  /** Makes the strikes and notes that fall before `until`. */
  schedule(until: number): void {
    if (!this.running || this.entries.length === 0) return;
    for (;;) {
      const entry = this.entries[this.index];
      if (entry === undefined) {
        this.index = 0;
        this.round += 1;
        continue;
      }
      const t = this.origin + this.round * TUNE_SECONDS + entry.time;
      if (t >= until) return;
      this.index += 1;
      // A moment that has gone by (the page was busy) is not played late.
      if (t >= this.rig.ctx.currentTime - 0.02) entry.play(this.rig, t, this.into);
    }
  }
}
