/**
 * A plucked string, made the way Karplus and Strong found: a burst of noise goes round a delay line the length of one period, and each
 * time round it loses a little of its highs and its strength, so that it settles into a pitch and rings out. The loop here has the two
 * additions of the extended form, a filter whose loss can be set (a dull string or a bright one) and an all-pass that tunes the loop to
 * a fraction of a sample, without which the high notes are out of tune. The burst is shaped by where the string is plucked.
 *
 * A note is made once as a buffer, and played by a source that starts at the right time, so a tune costs nothing while it plays.
 */
import { clamp, midiToHz, type Rig } from "./dsp.ts";

export interface PluckStyle {
  /** How long the fundamental takes to fall 60 dB, in seconds, for a note of 220 Hz. Higher notes ring a little shorter. */
  ring: number;
  /** 0 is a soft, round pluck and 1 a hard, bright one. */
  bright: number;
  /** Where along the string it is plucked, from 0.05 near the bridge to 0.5 in the middle. */
  place: number;
  /** How much of the loop filter's smoothing is used: the smaller, the longer the highs live. */
  damp: number;
  /** How fast the highs die, in dB a second at 3 kHz: the bite of the pluck lasts as long as it takes the highs to fall. */
  hf: number;
}

/** The bright, quick pluck of a pipa. */
export const PIPA: PluckStyle = { ring: 1.4, bright: 0.7, place: 0.14, damp: 0.25, hf: 260 };
/** The rounder, longer ring of a zheng. */
export const ZHENG: PluckStyle = { ring: 2.6, bright: 0.45, place: 0.2, damp: 0.3, hf: 190 };
/** A low string, for the bass of the tune. */
export const BASS: PluckStyle = { ring: 2.0, bright: 0.25, place: 0.3, damp: 0.4, hf: 130 };

/** The gain of a one-pole low-pass with coefficient `c` at the angular frequency `w` (radians a sample). */
const onePoleGain = (c: number, w: number): number => c / Math.hypot(1 - (1 - c) * Math.cos(w), (1 - c) * Math.sin(w));
/** Its delay at `w`, in samples. */
const onePoleDelay = (c: number, w: number): number => Math.atan2((1 - c) * Math.sin(w), 1 - (1 - c) * Math.cos(w)) / w;
/** The gain and the delay of the two-tap smoothing filter, (1 - s) + s z^-1. */
const twoTapGain = (s: number, w: number): number => Math.hypot(1 - s + s * Math.cos(w), s * Math.sin(w));
const twoTapDelay = (s: number, w: number): number => Math.atan2(s * Math.sin(w), 1 - s + s * Math.cos(w)) / w;
/** The delay of the all-pass (a + z^-1) / (1 + a z^-1) at `w`, in samples. */
const allpassDelay = (a: number, w: number): number => (Math.atan2(Math.sin(w), a + Math.cos(w)) - Math.atan2(a * Math.sin(w), 1 + a * Math.cos(w))) / w;

/** Finds `x` in [lo, hi] where a function that falls as x grows is `target`, by halving. */
function solveFalling(f: (x: number) => number, target: number, lo: number, hi: number): number {
  for (let i = 0; i < 48; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** The samples of one plucked note. `seconds` is as long as the buffer is, the note is faded out at the end if it still rings. */
export function pluckSamples(sampleRate: number, hz: number, style: PluckStyle, seconds: number, seed: number): Float32Array<ArrayBuffer> {
  const total = Math.floor(sampleRate * seconds);
  const out = new Float32Array(total);
  const s = clamp(style.damp, 0.05, 0.5);
  const w0 = (2 * Math.PI * hz) / sampleRate;

  // The one-pole low-pass in the loop is set so that 3 kHz loses `hf` dB a second: a low note goes round many times in a second and
  // so has less to lose each time round than a high one.
  const w3 = (2 * Math.PI * 3000) / sampleRate;
  const wanted3 = 10 ** (-style.hf / (20 * hz));
  // The gain at 3 kHz grows with c, from nothing to its value for no filter at all (the gain of the two-tap filter alone).
  const c = wanted3 >= twoTapGain(s, w3) * 0.9995 ? 1 : solveFalling((x) => -onePoleGain(x, w3) * twoTapGain(s, w3), -wanted3, 0.04, 1);

  // The loop is the delay line, the two filters and the all-pass, which brings the whole round to exactly one period at the pitch.
  const period = sampleRate / hz;
  const filters = twoTapDelay(s, w0) + onePoleDelay(c, w0);
  const whole = Math.max(2, Math.floor(period - filters - 0.5));
  const rest = clamp(period - filters - whole, 0.5, 1.5);
  const a = solveFalling((x) => allpassDelay(x, w0), rest, -0.9, 0.9);
  const line = new Float32Array(whole);

  // The burst: noise, rounded by a one-pole low-pass for a soft pluck, with a comb in it for the place.
  let state = (seed >>> 0) || 1;
  const random = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const round = 0.07 + 0.45 * style.bright ** 2;
  let low = 0;
  for (let i = 0; i < whole; i++) {
    low += (random() * 2 - 1 - low) * round;
    line[i] = low;
  }
  const shift = Math.max(1, Math.round(style.place * whole));
  const combed = new Float32Array(whole);
  for (let i = 0; i < whole; i++) combed[i] = (line[i] ?? 0) - (i >= shift ? (line[i - shift] ?? 0) : 0);
  let mean = 0;
  for (let i = 0; i < whole; i++) mean += combed[i] ?? 0;
  mean /= whole;
  let power = 0;
  for (let i = 0; i < whole; i++) {
    const v = (combed[i] ?? 0) - mean;
    line[i] = v;
    power += v * v;
  }
  const level = 1 / Math.sqrt(Math.max(power / whole, 1e-12));
  for (let i = 0; i < whole; i++) line[i] = (line[i] ?? 0) * level * 0.5;

  // The loop gain that makes the fundamental fall 60 dB in `ring` seconds, allowing for what the two filters take of it. It cannot be
  // more than 1, or the lows, which the filters pass whole, would grow.
  const ring = style.ring * clamp((220 / hz) ** 0.3, 0.45, 1.6);
  const filterGain = twoTapGain(s, w0) * onePoleGain(c, w0);
  const loop = clamp(10 ** (-3 / (hz * ring)) / filterGain, 0, 0.99999);

  let index = 0;
  let previous = 0;
  let smooth = 0;
  let allpassIn = 0;
  let allpassOut = 0;
  for (let n = 0; n < total; n++) {
    const v = line[index] ?? 0;
    out[n] = v;
    const averaged = (1 - s) * v + s * previous;
    previous = v;
    smooth += c * (averaged - smooth);
    const filtered = loop * smooth;
    const y = a * filtered + allpassIn - a * allpassOut;
    allpassIn = filtered;
    allpassOut = y;
    line[index] = y;
    index = index + 1 >= whole ? 0 : index + 1;
  }

  // Level the note by its first moments, so that low and high notes are as loud as each other, and fade the end.
  const probe = Math.min(total, Math.floor(sampleRate * 0.08));
  let peak = 1e-9;
  for (let n = 0; n < probe; n++) peak = Math.max(peak, Math.abs(out[n] ?? 0));
  const gain = 0.9 / peak;
  const fadeFrom = Math.max(0, total - Math.floor(sampleRate * 0.06));
  for (let n = 0; n < total; n++) {
    const fade = n < fadeFrom ? 1 : 0.5 + 0.5 * Math.cos(Math.PI * ((n - fadeFrom) / Math.max(1, total - fadeFrom)));
    out[n] = (out[n] ?? 0) * gain * fade;
  }
  return out;
}

/** A plucked note as an audio buffer, made once for each pitch and style. */
export function pluckBuffer(rig: Rig, note: number, style: PluckStyle, seconds: number, name: string): AudioBuffer {
  const key = `pluck:${name}:${note}:${seconds}`;
  const known = rig.cache.get(key);
  if (known !== undefined) return known;
  const rate = rig.ctx.sampleRate;
  const samples = pluckSamples(rate, midiToHz(note), style, seconds, 7919 * note + 13);
  const buffer = rig.ctx.createBuffer(1, samples.length, rate);
  buffer.copyToChannel(samples, 0);
  rig.cache.set(key, buffer);
  return buffer;
}
