/**
 * The two sounds of water. The river is noise that is filtered into a body, a middle and a shimmer, each swelling and ebbing at a
 * pace of its own, with the small notes of bubbles on top. The rain is a bed of noise, a rumble that comes with heavy rain, and drops.
 */
import { BaseLayer, type LayerId } from "./layer.ts";
import { biquad, gainNode, noiseSource, type Rig, strike, strikeEnd, wobble } from "./dsp.ts";
import type { Bus } from "./mixer.ts";

export class River extends BaseLayer {
  readonly id: LayerId = "river";
  private nextBubble = 0;

  constructor(rig: Rig, bus: Bus) {
    super(rig, bus, 0.08, 5200);
  }

  protected build(t: number): void {
    const ctx = this.rig.ctx;
    this.nextBubble = t + 0.2;
    for (const side of [-1, 1] as const) {
      const strand = ctx.createStereoPanner();
      strand.pan.value = side * 0.55;
      const mix = gainNode(ctx, 0.62);
      mix.connect(strand);
      strand.connect(this.out);
      const phase = side > 0 ? 0.37 : 0;

      // The body: the low rumble of a lot of water, swelling slowly.
      const body = this.keep(noiseSource(this.rig, t));
      const bodyFilter = biquad(ctx, "lowpass", 360, 0.6);
      const bodyGain = gainNode(ctx, 0.95);
      body.connect(bodyFilter);
      bodyFilter.connect(bodyGain);
      bodyGain.connect(mix);
      this.keep(wobble(ctx, bodyGain.gain, 0.071 + 0.013 * side, 0.2, t, phase));
      this.keep(wobble(ctx, bodyGain.gain, 0.19, 0.08, t, phase + 0.2));

      // The middle: the voice of the water over stones, its pitch drifting.
      const middle = this.keep(noiseSource(this.rig, t));
      const middleFilter = biquad(ctx, "bandpass", 820, 0.85);
      const middleGain = gainNode(ctx, 0.5);
      middle.connect(middleFilter);
      middleFilter.connect(middleGain);
      middleGain.connect(mix);
      this.keep(wobble(ctx, middleFilter.frequency, 0.13 + 0.021 * side, 240, t, phase));
      this.keep(wobble(ctx, middleFilter.frequency, 0.37, 110, t, phase + 0.3));
      this.keep(wobble(ctx, middleGain.gain, 0.21 + 0.03 * side, 0.2, t, phase));
      this.keep(wobble(ctx, middleGain.gain, 0.43, 0.1, t, phase + 0.1));
      // The burble: water breaks up faster than it swells, in a flicker of ten to twenty times a second.
      this.keep(wobble(ctx, middleGain.gain, 9.3 + side, 0.05, t, phase + 0.7));

      // The shimmer: the broken surface, a soft band high up that flickers.
      const shimmer = this.keep(noiseSource(this.rig, t));
      const shimmerFilter = biquad(ctx, "bandpass", 2500, 0.7);
      const shimmerRoll = biquad(ctx, "lowpass", 5200, 0.5);
      const shimmerGain = gainNode(ctx, 0.12);
      shimmer.connect(shimmerFilter);
      shimmerFilter.connect(shimmerRoll);
      shimmerRoll.connect(shimmerGain);
      shimmerGain.connect(mix);
      this.keep(wobble(ctx, shimmerGain.gain, 0.52 + 0.04 * side, 0.07, t, phase));
      this.keep(wobble(ctx, shimmerGain.gain, 1.7, 0.035, t, phase + 0.5));
      this.keep(wobble(ctx, shimmerGain.gain, 13 + 2 * side, 0.03, t, phase + 0.2));
      this.keep(wobble(ctx, shimmerGain.gain, 21, 0.02, t, phase + 0.9));
    }
  }

  override schedule(until: number): void {
    if (!this.active) {
      this.nextBubble = until;
      return;
    }
    const { ctx, rng } = this.rig;
    while (this.nextBubble < until) {
      const t = this.nextBubble;
      this.nextBubble += rng.gap(2.6);
      // A bubble: a small note that slides up as it rises.
      const start = rng.range(240, 560);
      const length = rng.range(0.05, 0.11);
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(start, t);
      osc.frequency.exponentialRampToValueAtTime(start * rng.range(1.4, 1.9), t + length);
      const g = ctx.createGain();
      strike(g.gain, t, rng.range(0.012, 0.04), 0.008, length);
      const panner = ctx.createStereoPanner();
      panner.pan.value = rng.range(-0.8, 0.8);
      osc.connect(g);
      g.connect(panner);
      panner.connect(this.out);
      osc.start(t);
      osc.stop(strikeEnd(t, 0.008, length));
    }
  }
}

export class Rain extends BaseLayer {
  readonly id: LayerId = "rain";
  private nextDrop = 0;
  private rumbles: GainNode[] = [];

  constructor(rig: Rig, bus: Bus) {
    super(rig, bus, 0.1, 5600);
  }

  protected build(t: number): void {
    const ctx = this.rig.ctx;
    this.nextDrop = t + 0.1;
    for (const side of [-1, 1] as const) {
      const strand = ctx.createStereoPanner();
      strand.pan.value = side * 0.6;
      strand.connect(this.out);
      // The bed: a wide hush between 600 Hz and 4 kHz, the sound of a lot of small drops at once.
      const bed = this.keep(noiseSource(this.rig, t));
      const high = biquad(ctx, "highpass", 600, 0.5);
      const band = biquad(ctx, "bandpass", 2300, 0.4);
      const roll = biquad(ctx, "lowpass", 4200, 0.5);
      const bedGain = gainNode(ctx, 0.34);
      bed.connect(high);
      high.connect(band);
      band.connect(roll);
      roll.connect(bedGain);
      bedGain.connect(strand);
      this.keep(wobble(ctx, bedGain.gain, 0.23 + 0.05 * side, 0.05, t));
      // The patter on the roofs: lower, in uneven gusts.
      const roof = this.keep(noiseSource(this.rig, t));
      const roofBand = biquad(ctx, "bandpass", 1300, 0.6);
      const roofGain = gainNode(ctx, 0.22);
      roof.connect(roofBand);
      roofBand.connect(roofGain);
      roofGain.connect(strand);
      this.keep(wobble(ctx, roofGain.gain, 0.37 + 0.07 * side, 0.09, t));
      this.keep(wobble(ctx, roofGain.gain, 1.3, 0.04, t, 0.3));
      // The rumble of heavy rain, which swells with the level.
      const low = this.keep(noiseSource(this.rig, t));
      const lowFilter = biquad(ctx, "lowpass", 260, 0.5);
      const lowGain = gainNode(ctx, 0);
      low.connect(lowFilter);
      lowFilter.connect(lowGain);
      lowGain.connect(strand);
      this.rumbles.push(lowGain);
    }
  }

  protected override shape(level: number, t: number, timeConstant: number): void {
    const target = 0.55 * level * level;
    for (const rumble of this.rumbles) {
      if (timeConstant <= 0) rumble.gain.setValueAtTime(target, t);
      else rumble.gain.setTargetAtTime(target, t, timeConstant);
    }
  }

  protected override forget(): void {
    this.rumbles = [];
  }

  override schedule(until: number): void {
    if (!this.active) {
      this.nextDrop = until;
      return;
    }
    const { ctx, rng } = this.rig;
    // A light rain has a few drops in a second that can be told apart, a heavy rain so many that they run together.
    const rate = 5 + 38 * this.level;
    while (this.nextDrop < until) {
      const t = this.nextDrop;
      this.nextDrop += rng.gap(rate);
      const source = noiseSource(this.rig, t);
      const filter = biquad(ctx, "bandpass", rng.range(1400, 4200), 2.2);
      const g = ctx.createGain();
      const decay = rng.range(0.012, 0.034);
      strike(g.gain, t, rng.range(0.04, 0.12), 0.0015, decay);
      const panner = ctx.createStereoPanner();
      panner.pan.value = rng.range(-0.85, 0.85);
      source.connect(filter);
      filter.connect(g);
      g.connect(panner);
      panner.connect(this.out);
      source.stop(strikeEnd(t, 0.0015, decay));
    }
  }
}
