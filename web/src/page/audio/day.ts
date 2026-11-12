/**
 * The sounds of the day: the birds of the morning, and the chatter of the market. The birds are sine tones that slide and trill, four
 * kinds of call that answer one another. The market is a crowd made of two things, noise that is pushed through the resonances of
 * a mouth (the vowels move, so it is a murmur and says nothing), and a few voices on a pitch that come and go in short syllables,
 * with now and then a vendor crying his wares a long way off.
 */
import { BaseLayer, type LayerId } from "./layer.ts";
import { biquad, gainNode, noiseSource, type Rig, wobble } from "./dsp.ts";
import type { Bus } from "./mixer.ts";

interface Tone {
  from: number;
  to: number;
  length: number;
  peak: number;
  /** A tremble of the pitch: how fast, and how far in Hz. */
  tremble?: [number, number];
  /** Pitch slides along a curve (exponential) or in a line. */
  curve?: boolean;
}

/** A bird of the chorus: what it calls, where it is, and when it calls next. */
interface Bird {
  kind: 0 | 1 | 2 | 3;
  pan: number;
  next: number;
  /** How the bird's voice is pitched against the others'. */
  pitch: number;
  /** How readily it calls: the more of the chorus there is, the more of the birds join in. */
  join: number;
}

export class Birds extends BaseLayer {
  readonly id: LayerId = "birds";
  private flock: Bird[] = [];

  constructor(rig: Rig, bus: Bus) {
    super(rig, bus, 0.2, 6800);
  }

  protected build(t: number): void {
    const rng = this.rig.rng;
    const birds: Array<[0 | 1 | 2 | 3, number, number, number]> = [
      [0, -0.6, 1, 0],
      [2, 0.5, 1, 0.15],
      [1, -0.15, 1.02, 0.4],
      [3, 0.75, 0.97, 0.6],
    ];
    this.flock = birds.map(([kind, pan, pitch, join]) => ({ kind, pan, pitch, join, next: t + rng.range(0.1, 1.6) }));
  }

  protected override forget(): void {
    this.flock = [];
  }

  /** One sounding of a bird: a slide from one pitch to another with a hump of loudness. */
  private tone(t: number, pan: number, tone: Tone): void {
    const { ctx } = this.rig;
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(tone.from, t);
    if (tone.curve === true) osc.frequency.exponentialRampToValueAtTime(tone.to, t + tone.length);
    else osc.frequency.linearRampToValueAtTime(tone.to, t + tone.length);
    const g = ctx.createGain();
    const attack = Math.min(0.014, tone.length * 0.3);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(tone.peak, t + attack);
    g.gain.setValueAtTime(tone.peak, t + tone.length * 0.55);
    g.gain.linearRampToValueAtTime(0, t + tone.length);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(g);
    g.connect(panner);
    panner.connect(this.out);
    osc.start(t);
    osc.stop(t + tone.length + 0.04);
    if (tone.tremble !== undefined) {
      const lfo = wobble(ctx, osc.frequency, tone.tremble[0], tone.tremble[1], t);
      lfo.stop(t + tone.length + 0.04);
    }
  }

  /** A call of one of four kinds, at about the loudness of a bird a little way off. Returns how long it lasts. */
  private call(t: number, bird: Bird): number {
    const rng = this.rig.rng;
    const bend = bird.pitch * rng.range(0.95, 1.06);
    const pan = bird.pan;
    if (bird.kind === 0) {
      // A whistled pair, up and down, said two or three times.
      const times = rng.int(2, 4);
      for (let i = 0; i < times; i++) {
        const at = t + i * rng.range(0.4, 0.5);
        this.tone(at, pan, { from: 3300 * bend, to: 3950 * bend, length: 0.11, peak: 0.11, curve: true });
        this.tone(at + 0.17, pan, { from: 3000 * bend, to: 2500 * bend, length: 0.15, peak: 0.105, curve: true });
      }
      return times * 0.5;
    }
    if (bird.kind === 1) {
      // A trill: a high tone shaken fast, rising a little and falling away.
      this.tone(t, pan, { from: 3300 * bend, to: 3650 * bend, length: 0.55, peak: 0.085, tremble: [rng.range(22, 30), rng.range(380, 520)] });
      if (rng.chance(0.5)) this.tone(t + 0.75, pan, { from: 3800 * bend, to: 3200 * bend, length: 0.4, peak: 0.08, tremble: [rng.range(24, 32), 440] });
      return 1.2;
    }
    if (bird.kind === 2) {
      // A run of short chips that grow quieter, like sparrows.
      const count = rng.int(4, 8);
      const step = rng.range(0.085, 0.12);
      for (let i = 0; i < count; i++) this.tone(t + i * step, pan, { from: 2300 * bend, to: 3200 * bend, length: 0.05, peak: 0.105 * 0.88 ** i, curve: true });
      return count * step + 0.1;
    }
    // The soft call of a dove: three low notes with a waver.
    const low = 430 * bend;
    this.tone(t, pan, { from: low, to: low * 1.02, length: 0.22, peak: 0.105, tremble: [5, 7] });
    this.tone(t + 0.3, pan, { from: low * 1.2, to: low * 1.16, length: 0.38, peak: 0.13, tremble: [5.5, 9] });
    this.tone(t + 0.78, pan, { from: low * 1.03, to: low * 0.98, length: 0.34, peak: 0.105, tremble: [5, 7] });
    return 1.2;
  }

  override schedule(until: number): void {
    if (!this.active) {
      for (const bird of this.flock) bird.next = until;
      return;
    }
    const rng = this.rig.rng;
    // The fuller the chorus, the more of the birds call, and the oftener.
    const fullness = this.level;
    for (const bird of this.flock) {
      while (bird.next < until) {
        const t = bird.next;
        if (fullness < bird.join * 0.7 || rng.next() > 0.3 + 0.7 * fullness) {
          bird.next = t + rng.range(0.8, 2);
          continue;
        }
        const length = this.call(t, bird);
        bird.next = t + length + rng.range(0.8, 3.4) / (0.5 + fullness);
      }
    }
  }
}

type Formants = readonly [number, number, number];

/** The resonances of the mouth for five vowels (F1, F2, F3 in Hz). */
const VOWELS: Readonly<Record<string, Formants>> = {
  a: [800, 1250, 2550],
  o: [500, 900, 2450],
  e: [450, 1900, 2600],
  i: [330, 2150, 2900],
  u: [360, 720, 2400],
};
const VOWEL_KEYS = ["a", "o", "e", "i", "u", "a", "o"] as const;

interface Speaker {
  osc: OscillatorNode;
  filters: [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
  gate: GainNode;
  base: number;
  next: number;
}

export class Market extends BaseLayer {
  readonly id: LayerId = "market";
  private speakers: Speaker[] = [];
  private nextCry = 0;

  constructor(rig: Rig, bus: Bus) {
    super(rig, bus, 0.1, 4600);
  }

  protected build(t: number): void {
    const ctx = this.rig.ctx;
    this.nextCry = t + this.rig.rng.range(2, 5);
    // The murmur: four copies of noise pushed through moving resonances, each swelling at its own pace.
    const pans = [-0.7, -0.25, 0.25, 0.7];
    pans.forEach((pan, k) => {
      const source = this.keep(noiseSource(this.rig, t));
      const copy = gainNode(ctx, 0.5);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      copy.connect(panner);
      panner.connect(this.out);
      const bands: Array<[number, number, number, number, number]> = [
        [430 + 90 * k, 3.6, 0.8, 170, 0.29 + 0.09 * k],
        [1400 + 160 * k, 4.2, 0.5, 480, 0.21 + 0.06 * k],
        [2500 + 100 * k, 5.5, 0.18, 250, 0.37 + 0.05 * k],
      ];
      for (const [hz, q, level, depth, rate] of bands) {
        const filter = biquad(ctx, "bandpass", hz, q);
        const g = gainNode(ctx, level);
        source.connect(filter);
        filter.connect(g);
        g.connect(copy);
        this.keep(wobble(ctx, filter.frequency, rate, depth, t, k * 0.21));
      }
      // The ebb and swell of talk: syllables a few times a second, and phrases over several seconds.
      this.keep(wobble(ctx, copy.gain, 2.7 + 0.9 * k, 0.22, t, k * 0.13));
      this.keep(wobble(ctx, copy.gain, 0.31 + 0.08 * k, 0.3, t, k * 0.31));
    });
    // The voices: a buzz on a pitch through the same resonances, gated in syllables.
    const voices: Array<[number, number]> = [
      [112, -0.5],
      [141, 0.3],
      [188, 0.6],
    ];
    this.speakers = voices.map(([base, pan], v) => {
      const osc = this.keep(ctx.createOscillator());
      osc.type = "sawtooth";
      osc.frequency.value = base;
      osc.start(t);
      this.keep(wobble(ctx, osc.detune, 5.1 + 0.6 * v, 24, t, v * 0.3));
      this.keep(wobble(ctx, osc.frequency, 0.27 + 0.1 * v, base * 0.05, t, v * 0.4));
      const gate = gainNode(ctx, 0);
      const mix = gainNode(ctx, 1.3);
      const filters = [0, 1, 2].map((i) => {
        const filter = biquad(ctx, "bandpass", (VOWELS.a as Formants)[i] ?? 800, 5 + i);
        const g = gainNode(ctx, [1, 0.7, 0.3][i] ?? 0.3);
        osc.connect(filter);
        filter.connect(g);
        g.connect(mix);
        return filter;
      }) as [BiquadFilterNode, BiquadFilterNode, BiquadFilterNode];
      const soften = biquad(ctx, "lowpass", 3200, 0.5);
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      mix.connect(gate);
      gate.connect(soften);
      soften.connect(panner);
      panner.connect(this.out);
      return { osc, filters, gate, base, next: t + 0.2 + 0.35 * v };
    });
  }

  protected override forget(): void {
    this.speakers = [];
  }

  /** A vendor's cry from far off: two syllables on a rising and then a falling pitch. */
  private cry(t: number): void {
    const { ctx, rng } = this.rig;
    const start = rng.range(190, 250);
    const length = rng.range(1.0, 1.5);
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(start, t);
    osc.frequency.linearRampToValueAtTime(start * 1.26, t + length * 0.35);
    osc.frequency.setValueAtTime(start * 1.26, t + length * 0.4);
    osc.frequency.linearRampToValueAtTime(start * 0.88, t + length);
    const mix = gainNode(ctx, 1.5);
    const first = VOWELS.a as Formants;
    const second = VOWELS.o as Formants;
    [0, 1, 2].forEach((i) => {
      const filter = biquad(ctx, "bandpass", first[i] ?? 800, 5 + i);
      filter.frequency.setValueAtTime(first[i] ?? 800, t);
      filter.frequency.setValueAtTime(first[i] ?? 800, t + length * 0.38);
      filter.frequency.linearRampToValueAtTime(second[i] ?? 500, t + length * 0.55);
      const g = gainNode(ctx, [1, 0.7, 0.3][i] ?? 0.3);
      osc.connect(filter);
      filter.connect(g);
      g.connect(mix);
    });
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.07);
    g.gain.setValueAtTime(0.16, t + length * 0.33);
    g.gain.linearRampToValueAtTime(0.05, t + length * 0.4);
    g.gain.linearRampToValueAtTime(0.14, t + length * 0.5);
    g.gain.linearRampToValueAtTime(0, t + length);
    const far = biquad(ctx, "lowpass", 2400, 0.5);
    const panner = ctx.createStereoPanner();
    panner.pan.value = rng.range(-0.7, 0.7);
    mix.connect(g);
    g.connect(far);
    far.connect(panner);
    panner.connect(this.out);
    osc.start(t);
    osc.stop(t + length + 0.05);
  }

  override schedule(until: number): void {
    if (!this.active) {
      for (const speaker of this.speakers) speaker.next = until;
      this.nextCry = until;
      return;
    }
    const rng = this.rig.rng;
    for (const speaker of this.speakers) {
      while (speaker.next < until) {
        const t = speaker.next;
        const length = rng.range(0.1, 0.26);
        const peak = rng.range(0.05, 0.14);
        const vowel = VOWELS[rng.pick(VOWEL_KEYS)] as Formants;
        speaker.filters.forEach((filter, i) => filter.frequency.setTargetAtTime(vowel[i] ?? 800, t, 0.03));
        speaker.osc.frequency.setTargetAtTime(speaker.base * 2 ** (rng.soft() * 0.2), t, 0.04);
        speaker.gate.gain.setValueAtTime(0, t);
        speaker.gate.gain.linearRampToValueAtTime(peak, t + 0.025);
        speaker.gate.gain.setValueAtTime(peak * 0.8, t + length * 0.6);
        speaker.gate.gain.linearRampToValueAtTime(0, t + length);
        // Mostly the next syllable follows at once; now and then the speaker stops for breath.
        speaker.next = t + length + (rng.chance(0.2) ? rng.range(0.7, 2.2) : rng.range(0.04, 0.3));
      }
    }
    while (this.nextCry < until) {
      this.cry(this.nextCry);
      this.nextCry += rng.range(7, 15);
    }
  }
}
