/**
 * The small tools every sound is made from: the shape of a struck sound, noise, and the shared things a rendering needs (the random
 * numbers, one stretch of noise, the notes that were made already). Nothing here knows whether the context plays to the speakers or
 * is rendered to a file.
 */
import { Rng } from "./rng.ts";

export const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** 0 below `lo`, 1 above `hi`, and a smooth rise between. */
export function smoothstep(lo: number, hi: number, x: number): number {
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

export const dbToGain = (db: number): number => 10 ** (db / 20);

/** The frequency of a MIDI note (69 is the A of 440 Hz). */
export const midiToHz = (note: number): number => 440 * 2 ** ((note - 69) / 12);

/** What the voices need to make sound: the context, the dice, a stretch of white noise and a place to keep notes that were made. */
export interface Rig {
  readonly ctx: BaseAudioContext;
  readonly rng: Rng;
  /** Twelve seconds of white noise, mono. A source that loops part of it, each a different part, is as good as new noise, and costs nothing. */
  readonly noise: AudioBuffer;
  /** Buffers made once and used again (the plucked notes). */
  readonly cache: Map<string, AudioBuffer>;
}

export function makeRig(ctx: BaseAudioContext, seed: number): Rig {
  const rng = new Rng(seed);
  return { ctx, rng, noise: whiteNoise(ctx, 12, rng), cache: new Map() };
}

export function whiteNoise(ctx: BaseAudioContext, seconds: number, rng: Rng): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = rng.next() * 2 - 1;
  return buffer;
}

/**
 * A looping source of noise. It loops a part of the stretch of a length of its own and starts at a place of its own in it, so that no
 * two of them play the same noise, and the ear does not find the repeat of one: the loops are of different lengths and meet again after
 * a very long time. White noise has no seam where it loops.
 */
export function noiseSource(rig: Rig, t: number): AudioBufferSourceNode {
  const source = rig.ctx.createBufferSource();
  source.buffer = rig.noise;
  source.loop = true;
  source.loopStart = 0;
  source.loopEnd = rig.rng.range(0.5, 1) * rig.noise.duration;
  source.start(t, rig.rng.range(0, source.loopEnd));
  return source;
}

/**
 * The gain of a struck or plucked sound: silent at `t`, up to `peak` in `attack` seconds, then an exponential fall that is 40 dB down
 * after `decay` seconds.
 */
export function strike(param: AudioParam, t: number, peak: number, attack: number, decay: number): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setTargetAtTime(0, t + attack, decay / 4.6);
}

/** When a sound shaped by `strike` can be stopped: it is more than 60 dB down by then. */
export const strikeEnd = (t: number, attack: number, decay: number): number => t + attack + decay * 1.6 + 0.05;

/** A gain that rises over `attack` seconds, holds until `t + hold` and falls over `release`: for sounds that last. */
export function swell(param: AudioParam, t: number, peak: number, attack: number, hold: number, release: number): void {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + attack + hold);
  param.linearRampToValueAtTime(0, t + attack + hold + release);
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, q = 1, gain = 0): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  filter.gain.value = gain;
  return filter;
}

export function gainNode(ctx: BaseAudioContext, value: number): GainNode {
  const node = ctx.createGain();
  node.gain.value = value;
  return node;
}

/** A slow oscillator whose output is added to `target`, `depth` times. It runs from `t`. Returns the oscillator, so it can be stopped. */
export function wobble(ctx: BaseAudioContext, target: AudioParam, rate: number, depth: number, t: number, phase = 0, shape: OscillatorType = "sine"): OscillatorNode {
  const lfo = ctx.createOscillator();
  lfo.type = shape;
  lfo.frequency.value = rate;
  const scale = gainNode(ctx, depth);
  lfo.connect(scale);
  scale.connect(target);
  // An oscillator cannot start at a phase: starting it a little early does the same for a slow one.
  lfo.start(Math.max(0, t - phase / Math.max(rate, 1e-3)));
  return lfo;
}

/** Fades a gain to a new value from now on (a glide of `time` constants of 0 is a jump). */
export function glide(param: AudioParam, value: number, t: number, timeConstant: number): void {
  if (timeConstant <= 0) param.setValueAtTime(value, t);
  else param.setTargetAtTime(value, t, timeConstant);
}
