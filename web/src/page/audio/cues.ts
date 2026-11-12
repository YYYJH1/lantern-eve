/**
 * The sounds that mark something: the bronze bell of the morning paper, a short phrase for each of the three jobs when it is done,
 * the light cymbal of a moment, and the very small sounds of the page (a leaf turning, a seal pressed, a drop of ink).
 */
import { biquad, gainNode, noiseSource, type Rig, strike, strikeEnd } from "./dsp.ts";
import { type Bus, toBus } from "./mixer.ts";
import { bell, clapper, cymbal, gong } from "./percussion.ts";
import { type Pluck, pluck } from "./strings.ts";

export type CueId = "paper" | "job.bridge" | "job.truth" | "job.peace" | "moment" | "ui.page" | "ui.seal" | "ui.ink";

export const CUE_IDS: readonly CueId[] = ["paper", "job.bridge", "job.truth", "job.peace", "moment", "ui.page", "ui.seal", "ui.ink"];

/** A note of a phrase: when it sounds (seconds after the start), and how. */
interface PhraseNote extends Pluck {
  at: number;
}

const note = (at: number, midi: number, vel = 0.8, more: Partial<Pluck> = {}): PhraseNote => ({ at, note: midi, vel, kind: "zheng", wet: 0.38, ...more });

/** The bridge is mended: a quick climb of the five notes, and a firm chord at the top. */
const BRIDGE: readonly PhraseNote[] = [
  note(0, 62, 0.7, { kind: "pipa", hold: 0.3 }),
  note(0.11, 69, 0.72, { kind: "pipa", hold: 0.3 }),
  note(0.22, 74, 0.76, { kind: "pipa", hold: 0.3 }),
  note(0.33, 76, 0.78, { kind: "pipa", hold: 0.3 }),
  note(0.44, 78, 0.82, { kind: "pipa", hold: 0.35 }),
  note(0.6, 81, 0.9, { kind: "pipa", roll: 0.7 }),
  note(0.62, 74, 0.55, { hold: 1.6 }),
  note(0.62, 50, 0.7, { kind: "bass" }),
];

/** The truth is told: a question that falls, and the answer that rises to settle on the top. */
const TRUTH: readonly PhraseNote[] = [
  note(0, 78, 0.72, { kind: "pipa", hold: 0.4 }),
  note(0.26, 76, 0.7, { kind: "pipa", hold: 0.4 }),
  note(0.52, 74, 0.72, { kind: "pipa", hold: 0.5 }),
  note(1.0, 69, 0.7, { kind: "pipa", hold: 0.35 }),
  note(1.22, 74, 0.78, { kind: "pipa", hold: 0.35 }),
  note(1.46, 78, 0.9, { slide: 2 }),
  note(1.46, 62, 0.5, { kind: "bass" }),
];

/** The families are at peace: two lines that come together, and a chord that is spread like a hand across the strings. */
const PEACE: readonly PhraseNote[] = [
  note(0, 62, 0.62, { pan: -0.3 }),
  note(0, 81, 0.6, { kind: "pipa", pan: 0.3, hold: 0.45 }),
  note(0.4, 64, 0.64, { pan: -0.3 }),
  note(0.4, 78, 0.62, { kind: "pipa", pan: 0.3, hold: 0.45 }),
  note(0.8, 66, 0.66, { pan: -0.25 }),
  note(0.8, 76, 0.64, { kind: "pipa", pan: 0.25, hold: 0.45 }),
  note(1.35, 62, 0.7, { kind: "bass" }),
  note(1.4, 69, 0.66),
  note(1.5, 74, 0.68),
  note(1.6, 78, 0.7),
  note(1.7, 81, 0.62, { slide: 2 }),
];

/** How loud a phrase is against the rest of the effects: a phrase marks a moment and does not announce it. */
const PHRASE_GAIN = 0.7;

function phrase(rig: Rig, t: number, notes: readonly PhraseNote[], bus: Bus): void {
  for (const n of notes) pluck(rig, t + n.at, { ...n, vel: (n.vel ?? 0.8) * PHRASE_GAIN }, bus);
}

/** A leaf of paper turned: a breath of noise that rises through the band where paper whispers, and a small flutter after it. */
function page(rig: Rig, t: number, bus: Bus): void {
  const ctx = rig.ctx;
  const sweep = (at: number, from: number, to: number, peak: number, length: number): void => {
    const source = noiseSource(rig, at);
    const filter = biquad(ctx, "bandpass", from, 1.1);
    filter.frequency.setValueAtTime(from, at);
    filter.frequency.exponentialRampToValueAtTime(to, at + length);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + length * 0.4);
    g.gain.linearRampToValueAtTime(0, at + length);
    source.connect(filter);
    filter.connect(g);
    toBus(rig, g, bus, 0.15);
    source.stop(at + length + 0.02);
  };
  sweep(t, 1500, 3800, 0.2, 0.15);
  sweep(t + 0.085, 2600, 3400, 0.1, 0.07);
}

/** A seal pressed on paper: a soft thud with a little wood in it. */
function seal(rig: Rig, t: number, bus: Bus): void {
  const ctx = rig.ctx;
  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(200, t);
  body.frequency.exponentialRampToValueAtTime(105, t + 0.07);
  const g = ctx.createGain();
  strike(g.gain, t, 0.3, 0.003, 0.13);
  body.connect(g);
  toBus(rig, g, bus, 0.12);
  body.start(t);
  body.stop(strikeEnd(t, 0.003, 0.13));
  const press = noiseSource(rig, t);
  const filter = biquad(ctx, "lowpass", 900, 0.6);
  const pg = ctx.createGain();
  strike(pg.gain, t, 0.12, 0.002, 0.04);
  press.connect(filter);
  filter.connect(pg);
  toBus(rig, pg, bus, 0);
  press.stop(strikeEnd(t, 0.002, 0.04));
  const knock = ctx.createOscillator();
  knock.frequency.value = 520;
  const kg = gainNode(ctx, 0);
  strike(kg.gain, t, 0.05, 0.002, 0.06);
  knock.connect(kg);
  toBus(rig, kg, bus, 0.1);
  knock.start(t);
  knock.stop(strikeEnd(t, 0.002, 0.06));
}

/** A drop of ink: a small tick that falls a little in pitch, like a brush touching the stone. */
function ink(rig: Rig, t: number, bus: Bus): void {
  const ctx = rig.ctx;
  const osc = ctx.createOscillator();
  osc.frequency.setValueAtTime(780, t);
  osc.frequency.exponentialRampToValueAtTime(500, t + 0.05);
  const g = ctx.createGain();
  strike(g.gain, t, 0.22, 0.002, 0.08);
  osc.connect(g);
  toBus(rig, g, bus, 0.12);
  osc.start(t);
  osc.stop(strikeEnd(t, 0.002, 0.08));
  const tick = noiseSource(rig, t);
  const filter = biquad(ctx, "bandpass", 3000, 1.4);
  const tg = ctx.createGain();
  strike(tg.gain, t, 0.08, 0.001, 0.015);
  tick.connect(filter);
  filter.connect(tg);
  toBus(rig, tg, bus, 0);
  tick.stop(strikeEnd(t, 0.001, 0.015));
}

/** How long each cue lasts, in seconds: what a render needs to know when it is over. */
export const CUE_SECONDS: Readonly<Record<CueId, number>> = {
  paper: 3.2,
  "job.bridge": 3.2,
  "job.truth": 3.6,
  "job.peace": 4.4,
  moment: 2.4,
  "ui.page": 0.4,
  "ui.seal": 0.5,
  "ui.ink": 0.3,
};

/** Plays a cue on the effects bus at time `t`. */
export function playCue(rig: Rig, bus: Bus, id: CueId, t: number): void {
  switch (id) {
    case "paper":
      bell(rig, t, { bus, vel: 0.75, wet: 0.3 });
      break;
    case "job.bridge":
      seal(rig, t, bus);
      clapper(rig, t + 0.02, { bus, vel: 0.5, wet: 0.25 });
      phrase(rig, t + 0.14, BRIDGE, bus);
      break;
    case "job.truth":
      seal(rig, t, bus);
      phrase(rig, t + 0.14, TRUTH, bus);
      bell(rig, t + 1.6, { bus, vel: 0.28, wet: 0.4 }, 1568, 1.6);
      break;
    case "job.peace":
      seal(rig, t, bus);
      phrase(rig, t + 0.14, PEACE, bus);
      gong(rig, t + 1.5, { bus, vel: 0.32, wet: 0.45 }, 130, 3, 0.02);
      break;
    case "moment":
      cymbal(rig, t, { bus, vel: 0.7, wet: 0.35 }, "soft");
      break;
    case "ui.page":
      page(rig, t, bus);
      break;
    case "ui.seal":
      seal(rig, t, bus);
      break;
    case "ui.ink":
      ink(rig, t, bus);
      break;
  }
}
