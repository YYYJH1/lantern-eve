/**
 * A layer of the ambience: one kind of sound (the river, the market, the birds) with a level and a place in the stereo field that the
 * game sets as often as it likes. A layer that is not heard makes no sound and costs nothing: its sources are made when it is first wanted
 * and let go when it has been quiet for a while.
 */
import { biquad, glide, gainNode, type Rig } from "./dsp.ts";
import { type Bus, type Target, toBus } from "./mixer.ts";

export type LayerId = "river" | "market" | "birds" | "insects" | "rain" | "watch";

export const LAYER_IDS: readonly LayerId[] = ["river", "market", "birds", "insects", "rain", "watch"];

/** Under this a layer is taken to be silent. */
export const AUDIBLE = 0.004;
/** A layer that has been silent this long (seconds) lets go of its sources. */
const LET_GO_AFTER = 6;

export interface Layer {
  readonly id: LayerId;
  /** Sets how loud the layer is, 0 to 1, and where, -1 left to 1 right, gliding there with the time constant `glide` (0 is a jump). */
  set(level: number, pan: number, t: number, glide: number): void;
  /** Makes the events that fall before `until`: the call of a bird, a drop of rain. */
  schedule(until: number): void;
  /** Stops everything. */
  stop(t: number): void;
  /** Whether the layer has sources running. */
  readonly active: boolean;
  /** The level it was last set to. */
  readonly level: number;
}

export abstract class BaseLayer implements Layer {
  abstract readonly id: LayerId;
  /** What the sounds of the layer are sent to: the level of the layer. */
  protected readonly into: Target;
  protected readonly out: GainNode;
  private readonly panner: StereoPannerNode;
  private built = false;
  private lastLevel = -1;
  private lastPan = 2;
  private quietSince: number | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  level = 0;

  /** `wet` is how much of the layer goes into the room, `ceiling` the frequency above which it is rolled off (0 for no roll-off). */
  constructor(
    protected readonly rig: Rig,
    bus: Bus,
    wet = 0,
    ceiling = 0,
  ) {
    const ctx = rig.ctx;
    this.out = gainNode(ctx, 0);
    this.panner = ctx.createStereoPanner();
    if (ceiling > 0) {
      // Two stages, so that nothing of the layer is harsh whatever it is made of.
      const first = biquad(ctx, "lowpass", ceiling, 0.6);
      const second = biquad(ctx, "lowpass", ceiling * 1.25, 0.6);
      this.out.connect(first);
      first.connect(second);
      second.connect(this.panner);
    } else {
      this.out.connect(this.panner);
    }
    toBus(rig, this.panner, bus, wet);
    this.into = { dry: this.out, send: null };
  }

  get active(): boolean {
    return this.built;
  }

  /** Makes the sources of the layer. They run until `release` is called. */
  protected abstract build(t: number): void;

  /** Takes a hand in the level before it is set: the rain makes its rumble swell with the level. */
  protected shape(_level: number, _t: number, _glide: number): void {}

  /** Keeps a source, so that it is stopped when the layer is let go. */
  protected keep<T extends AudioScheduledSourceNode>(source: T): T {
    this.sources.push(source);
    return source;
  }

  /** Called when the layer is let go of, to forget what `build` made. */
  protected forget(): void {}

  set(level: number, pan: number, t: number, timeConstant: number): void {
    this.level = level;
    if (level > AUDIBLE) {
      this.quietSince = null;
      if (!this.built) {
        this.built = true;
        this.build(t);
      }
    } else if (this.built) {
      this.quietSince ??= t;
      if (t - this.quietSince > LET_GO_AFTER) this.release(t);
    }
    if (Math.abs(level - this.lastLevel) > 0.0015 || timeConstant <= 0) {
      glide(this.out.gain, level, t, timeConstant);
      this.shape(level, t, timeConstant);
      this.lastLevel = level;
    }
    if (Math.abs(pan - this.lastPan) > 0.01 || timeConstant <= 0) {
      glide(this.panner.pan, pan, t, timeConstant);
      this.lastPan = pan;
    }
  }

  schedule(_until: number): void {}

  private release(t: number): void {
    for (const source of this.sources) {
      try {
        source.stop(t + 0.05);
      } catch {
        // Stopped already.
      }
    }
    this.sources = [];
    this.built = false;
    this.forget();
  }

  stop(t: number): void {
    this.release(t);
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(0, t);
  }
}
