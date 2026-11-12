/**
 * Playing the plucked strings: a note is a buffer that was made once (`pluck.ts`) and a source that starts it at the right time, with
 * a slide of pitch for the notes the left hand presses after the pluck, and a roll (a tremolo, the quick repeated plucking of a pipa)
 * for the long ones.
 */
import { biquad, midiToHz, type Rig, strikeEnd } from "./dsp.ts";
import type { Target } from "./mixer.ts";
import { toBus } from "./mixer.ts";
import { BASS, PIPA, pluckBuffer, type PluckStyle, ZHENG } from "./pluck.ts";

export type StringKind = "pipa" | "zheng" | "bass";

const STYLES: Readonly<Record<StringKind, { style: PluckStyle; seconds: number }>> = {
  pipa: { style: PIPA, seconds: 1.9 },
  zheng: { style: ZHENG, seconds: 2.8 },
  bass: { style: BASS, seconds: 2.4 },
};

export interface Pluck {
  /** The MIDI note. */
  note: number;
  /** How hard, 0 to 1. */
  vel?: number;
  kind?: StringKind;
  /** The pitch is pressed up by this many semitones after the pluck. */
  slide?: number;
  /** The note is rolled for this long (seconds). */
  roll?: number;
  /** The note is let go after this long (seconds): a short note, so that the notes of a run do not pile up. */
  hold?: number;
  pan?: number;
  /** How much goes into the room. */
  wet?: number;
}

/** Plucks a string at time `t`. Returns when the sound is over. */
export function pluck(rig: Rig, t: number, p: Pluck, to: Target): number {
  const { ctx } = rig;
  const kind = p.kind ?? "zheng";
  const { style, seconds } = STYLES[kind];
  const buffer = pluckBuffer(rig, p.note, style, seconds, kind);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const g = ctx.createGain();
  const vel = p.vel ?? 0.8;
  g.gain.setValueAtTime(vel, t);
  let end = t + buffer.duration;
  if (p.hold !== undefined) {
    // Let go: the fall is quick, so the note ends where the player's hand stopped it.
    g.gain.setValueAtTime(vel, t + p.hold);
    g.gain.setTargetAtTime(0, t + p.hold, 0.05);
    end = Math.min(end, strikeEnd(t + p.hold, 0, 0.3));
  }
  if (p.slide !== undefined && p.slide !== 0) {
    source.playbackRate.setValueAtTime(1, t + 0.04);
    source.playbackRate.linearRampToValueAtTime(2 ** (p.slide / 12), t + 0.04 + 0.13);
  }
  source.connect(g);
  // The bite of the pluck has a little of the top in it, which is rolled off, so that no note is harsh.
  const soften = biquad(ctx, "lowpass", 6500, 0.6);
  g.connect(soften);
  let last: AudioNode = soften;
  if ((p.pan ?? 0) !== 0) {
    const panner = ctx.createStereoPanner();
    panner.pan.value = p.pan ?? 0;
    soften.connect(panner);
    last = panner;
  }
  toBus(rig, last, to, p.wet ?? 0.3);
  source.start(t);
  source.stop(end);
  // The roll: quick repeated pluckings of the same string that grow weaker.
  if (p.roll !== undefined && p.roll > 0.12) {
    const step = 0.075;
    const count = Math.floor(p.roll / step);
    for (let i = 1; i < count; i++) {
      pluck(rig, t + i * step, { ...p, roll: undefined, vel: vel * (0.7 - 0.28 * (i / count)), hold: 0.16, slide: undefined }, to);
    }
  }
  return end;
}

/** The pitch of a note of the scale, in Hz: here for the tests and the notes of the tune. */
export const noteHz = midiToHz;
