/**
 * The struck sounds: the gong, the big and the small drum, the cymbals, the bronze bell and the wooden clapper of the night watchman.
 * Each is made from sine partials that die away at their own speeds (a gong or a bell is a handful of them), from short bursts of
 * filtered noise (the stick, the mallet, the rim) and from a pitch that falls as the skin or the metal settles.
 */
import { biquad, gainNode, noiseSource, type Rig, strike, strikeEnd } from "./dsp.ts";
import { type Target, toBus } from "./mixer.ts";

/** How a hit is played: how hard, where in the stereo field, how much of it goes into the room, and how far off it is (0 near, 1 far). */
export interface Hit {
  bus: Target;
  vel?: number;
  pan?: number;
  wet?: number;
  far?: number;
}

interface Mode {
  ratio: number;
  amp: number;
  decay: number;
  attack?: number;
  /** A second partial this much higher (as a fraction), which beats against the first. */
  beat?: number;
}

/** The end of a voice: through a filter that takes the highs off with distance, a pan, and into the bus. Returns the node to feed. */
function exit(rig: Rig, hit: Hit): GainNode {
  const ctx = rig.ctx;
  const input = gainNode(ctx, hit.vel ?? 1);
  let last: AudioNode = input;
  if ((hit.far ?? 0) > 0) {
    const far = hit.far ?? 0;
    const filter = biquad(ctx, "lowpass", 9000 - 7000 * far, 0.6);
    last.connect(filter);
    last = filter;
  }
  if ((hit.pan ?? 0) !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = hit.pan ?? 0;
    last.connect(panner);
    last = panner;
  }
  toBus(rig, last, hit.bus, hit.wet ?? 0);
  return input;
}

/** A set of partials struck at once. `bend` is how far the pitch starts above where it settles (below, when it is negative), as a fraction, and `settle` how long it takes. */
function modal(rig: Rig, t: number, to: AudioNode, hz: number, modes: readonly Mode[], bend = 0, settle = 0.2): number {
  const ctx = rig.ctx;
  let end = t;
  for (const mode of modes) {
    const attack = mode.attack ?? 0.003;
    const copies = mode.beat === undefined ? [0] : [0, mode.beat];
    for (const offset of copies) {
      const osc = ctx.createOscillator();
      const f = hz * mode.ratio * (1 + offset);
      if (bend !== 0) {
        osc.frequency.setValueAtTime(f * (1 + bend), t);
        osc.frequency.exponentialRampToValueAtTime(f, t + settle);
      } else {
        osc.frequency.value = f;
      }
      const g = ctx.createGain();
      strike(g.gain, t, mode.amp * (copies.length > 1 ? 0.55 : 1), attack, mode.decay);
      osc.connect(g);
      g.connect(to);
      osc.start(t);
      const stop = strikeEnd(t, attack, mode.decay);
      osc.stop(stop);
      end = Math.max(end, stop);
    }
  }
  return end;
}

/** A short burst of noise through a band: the stick on the skin, the mallet on the metal. */
function burst(rig: Rig, t: number, to: AudioNode, type: BiquadFilterType, hz: number, q: number, peak: number, decay: number, attack = 0.001): void {
  const ctx = rig.ctx;
  const source = noiseSource(rig, t);
  const filter = biquad(ctx, type, hz, q);
  const g = ctx.createGain();
  strike(g.gain, t, peak, attack, decay);
  source.connect(filter);
  filter.connect(g);
  g.connect(to);
  source.stop(strikeEnd(t, attack, decay));
}

/**
 * A gong. The partials are not whole multiples of the lowest, and the upper ones come in after the first (a gong blooms),
 * with pairs that beat. `hz` is the lowest, `ring` how long the lowest sounds.
 */
export function gong(rig: Rig, t: number, hit: Hit, hz = 168, ring = 3.4, bend = 0.03): void {
  const to = exit(rig, hit);
  const r = [1, 1.504, 2.031, 2.762, 3.43, 4.48, 5.55];
  const amp = [1, 0.62, 0.48, 0.33, 0.21, 0.13, 0.07];
  const decay = [1, 0.8, 0.64, 0.48, 0.36, 0.25, 0.16];
  const bloom = [0.012, 0.02, 0.035, 0.05, 0.07, 0.09, 0.1];
  const modes: Mode[] = r.map((ratio, i) => ({ ratio, amp: (amp[i] ?? 0) * 0.5, decay: ring * (decay[i] ?? 0.2), attack: bloom[i], beat: 0.0035 + 0.0008 * i }));
  modal(rig, t, to, hz, modes, bend, 0.45);
  burst(rig, t, to, "lowpass", 650, 0.7, 0.35, 0.05, 0.002);
}

/** A small gong with a rising voice, like the one of the opera: higher, shorter, and its pitch swells as it sounds. */
export function smallGong(rig: Rig, t: number, hit: Hit, hz = 520, ring = 1.5): void {
  const to = exit(rig, hit);
  const r = [1, 1.58, 2.15, 2.97, 3.9];
  const amp = [1, 0.55, 0.4, 0.22, 0.12];
  const decay = [1, 0.72, 0.5, 0.34, 0.2];
  const modes: Mode[] = r.map((ratio, i) => ({ ratio, amp: (amp[i] ?? 0) * 0.45, decay: ring * (decay[i] ?? 0.2), attack: 0.004 + 0.01 * i, beat: 0.004 }));
  modal(rig, t, to, hz, modes, -0.05, 0.35);
  burst(rig, t, to, "bandpass", 1800, 1.2, 0.25, 0.03);
}

/** The bronze bell of the morning paper: one strike, a clear tone with partials above it that die away quickly. */
export function bell(rig: Rig, t: number, hit: Hit, hz = 1175, ring = 2.6): void {
  const to = exit(rig, hit);
  const r = [1, 2.0, 2.76, 4.07, 5.4];
  const amp = [1, 0.5, 0.4, 0.17, 0.08];
  const decay = [1, 0.62, 0.45, 0.28, 0.16];
  const modes: Mode[] = r.map((ratio, i) => ({ ratio, amp: (amp[i] ?? 0) * 0.5, decay: ring * (decay[i] ?? 0.2), attack: 0.0015, beat: i === 0 || i === 2 ? 0.0024 : undefined }));
  modal(rig, t, to, hz, modes);
  burst(rig, t, to, "bandpass", 3200, 1.5, 0.12, 0.012);
}

/** The wooden clapper: a short hollow knock with a click on it. */
export function clapper(rig: Rig, t: number, hit: Hit, hz = 640): void {
  const to = exit(rig, hit);
  const modes: Mode[] = [
    { ratio: 0.5, amp: 0.7, decay: 0.12 },
    { ratio: 1, amp: 1, decay: 0.075 },
    { ratio: 2.31, amp: 0.55, decay: 0.045 },
    { ratio: 3.7, amp: 0.22, decay: 0.03 },
  ];
  modal(rig, t, to, hz, modes, 0.025, 0.02);
  burst(rig, t, to, "bandpass", 1900, 1.4, 0.55, 0.012);
}

/** A drum. The big one thumps low and long, the small one is higher and tighter, with the crack of the stick. */
export function drum(rig: Rig, t: number, hit: Hit, size: "big" | "small" = "big"): void {
  const ctx = rig.ctx;
  const to = exit(rig, hit);
  const big = size === "big";
  const body = ctx.createOscillator();
  body.frequency.setValueAtTime(big ? 150 : 300, t);
  body.frequency.exponentialRampToValueAtTime(big ? 70 : 168, t + (big ? 0.12 : 0.07));
  const bodyGain = ctx.createGain();
  strike(bodyGain.gain, t, big ? 0.95 : 0.8, 0.003, big ? 0.46 : 0.2);
  body.connect(bodyGain);
  bodyGain.connect(to);
  body.start(t);
  body.stop(strikeEnd(t, 0.003, big ? 0.46 : 0.2));
  const skin = ctx.createOscillator();
  skin.frequency.value = big ? 196 : 420;
  const skinGain = ctx.createGain();
  strike(skinGain.gain, t, big ? 0.3 : 0.22, 0.004, big ? 0.3 : 0.12);
  skin.connect(skinGain);
  skinGain.connect(to);
  skin.start(t);
  skin.stop(strikeEnd(t, 0.004, big ? 0.3 : 0.12));
  burst(rig, t, to, "bandpass", big ? 320 : 700, 0.9, big ? 0.5 : 0.32, big ? 0.07 : 0.045, 0.002);
  burst(rig, t, to, "bandpass", big ? 1900 : 3000, 1.1, big ? 0.2 : 0.3, big ? 0.035 : 0.04, 0.001);
}

/**
 * A pair of cymbals. A wash of noise between 2 and 8 kHz and a handful of partials that are not harmonics of anything. The
 * "soft" one is the light touch that marks a moment: smaller, with its top taken off.
 */
export function cymbal(rig: Rig, t: number, hit: Hit, kind: "clash" | "tap" | "soft" = "clash"): void {
  const ctx = rig.ctx;
  const to = exit(rig, hit);
  const decay = kind === "clash" ? 1.1 : kind === "soft" ? 1.7 : 0.35;
  const level = kind === "soft" ? 1.35 : kind === "clash" ? 0.8 : 0.6;
  const ceiling = kind === "soft" ? 5200 : 6200;
  const wash = ctx.createGain();
  wash.gain.value = 1;
  const roll = biquad(ctx, "lowpass", ceiling, 0.6);
  const roll2 = biquad(ctx, "lowpass", ceiling * 1.2, 0.6);
  wash.connect(roll);
  roll.connect(roll2);
  roll2.connect(to);
  burst(rig, t, wash, "bandpass", 4200, 0.55, 0.28 * level, decay * 0.7, 0.002);
  burst(rig, t, wash, "bandpass", 2900, 0.5, 0.2 * level, decay * 1.1, kind === "soft" ? 0.012 : 0.006);
  const partials = [1830, 2425, 3050, 3980, 4730];
  partials.forEach((hz, i) => {
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = hz;
    const g = ctx.createGain();
    const d = decay * (1 - 0.1 * i);
    strike(g.gain, t, (0.07 - 0.008 * i) * level, 0.003, d);
    osc.connect(g);
    g.connect(roll);
    osc.start(t);
    osc.stop(strikeEnd(t, 0.003, d));
  });
}
