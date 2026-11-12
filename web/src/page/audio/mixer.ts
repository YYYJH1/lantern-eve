/**
 * The three buses the sounds go through, and the master after them. The ambience, the music and the effects have a level of their own
 * (the three volumes of the menu), and each has a send to a room, a convolution reverb made from noise that dies away. The master
 * ends in a limiter, so that nothing the voices add up to can clip.
 */
import { biquad, dbToGain, gainNode, type Rig } from "./dsp.ts";

/** Where a voice sends its sound: the dry signal, and (for a voice that has a room) what goes into the room. */
export interface Target {
  readonly dry: AudioNode;
  readonly send: AudioNode | null;
}

export interface Bus extends Target {
  /** The dry signal of a voice goes here. */
  readonly dry: GainNode;
  /** What a voice wants in the room goes here. */
  readonly send: GainNode;
  /** The level of the bus: the player's volume, and whatever the game lowers it by. */
  readonly level: GainNode;
}

export interface Mixer {
  readonly master: GainNode;
  readonly limiter: DynamicsCompressorNode;
  readonly ambience: Bus;
  readonly music: Bus;
  readonly effects: Bus;
}

export type BusId = "ambience" | "music" | "effects";

/** The room: stereo noise that dies away, darker as it goes, with a short gap before it begins. */
export function roomImpulse(ctx: BaseAudioContext, rig: Rig, seconds: number, decayDb = 60, brightness = 0.55): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  const gap = Math.floor(ctx.sampleRate * 0.018);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    let low = 0;
    for (let i = gap; i < length; i++) {
      const t = (i - gap) / ctx.sampleRate;
      const envelope = 10 ** ((-decayDb * (t / seconds)) / 20);
      // The tail loses its highs faster than its lows: a one-pole filter that closes as time goes on.
      const open = brightness * Math.exp(-t * 1.6) + 0.06;
      low += (rig.rng.next() * 2 - 1 - low) * open;
      data[i] = low * envelope;
    }
  }
  // Level the room so that a signal through it keeps about the energy it went in with.
  let energy = 0;
  const left = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) energy += (left[i] ?? 0) ** 2;
  const scale = 1 / Math.sqrt(Math.max(energy, 1e-9));
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++) data[i] = (data[i] ?? 0) * scale * 0.8;
  }
  return buffer;
}

function makeBus(rig: Rig, master: AudioNode, room: { seconds: number; brightness: number }, wetLevel: number): Bus {
  const ctx = rig.ctx;
  const level = gainNode(ctx, 1);
  const dry = gainNode(ctx, 1);
  const send = gainNode(ctx, 1);
  const convolver = ctx.createConvolver();
  convolver.normalize = false;
  convolver.buffer = roomImpulse(ctx, rig, room.seconds, 60, room.brightness);
  const wet = gainNode(ctx, wetLevel);
  dry.connect(level);
  send.connect(convolver);
  convolver.connect(wet);
  wet.connect(level);
  level.connect(master);
  return { dry, send, level };
}

export function buildMixer(rig: Rig): Mixer {
  const ctx = rig.ctx;
  const master = gainNode(ctx, 1);
  // A limiter and nothing more: it stays out of the way until the sum of the voices comes near the top.
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -4;
  limiter.knee.value = 2;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.12;
  const trim = gainNode(ctx, dbToGain(-1.5));
  // A roll-off of the top, so that no voice can be harsh whatever it is made of.
  const soften = biquad(ctx, "lowpass", 9500, 0.62);
  const soften2 = biquad(ctx, "lowpass", 11500, 0.62);
  master.connect(soften);
  soften.connect(soften2);
  soften2.connect(limiter);
  limiter.connect(trim);
  trim.connect(ctx.destination);
  return {
    master,
    limiter,
    ambience: makeBus(rig, master, { seconds: 1.6, brightness: 0.4 }, 0.55),
    music: makeBus(rig, master, { seconds: 2.2, brightness: 0.5 }, 0.42),
    effects: makeBus(rig, master, { seconds: 1.4, brightness: 0.45 }, 0.4),
  };
}

/** Connects a voice to a bus (or to a layer in front of one): the dry signal, and `wet` of it into the room where there is one. */
export function toBus(rig: Rig, from: AudioNode, target: Target, wet = 0): void {
  from.connect(target.dry);
  if (wet > 0 && target.send !== null) {
    const send = gainNode(rig.ctx, wet);
    from.connect(send);
    send.connect(target.send);
  }
}
