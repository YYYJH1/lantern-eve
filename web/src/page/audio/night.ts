/**
 * The sounds of the night: three insects that call from the grass, and the wooden clapper of the night watchman on his round. The
 * insects are sine tones, each switched on and off in short pulses the way a cricket's wings are, in chirps and trills with rests
 * between. The watchman's clapper is far off: a knock, and a pair of quicker ones, every few seconds.
 */
import { clapper } from "./percussion.ts";
import { BaseLayer, type LayerId } from "./layer.ts";
import { gainNode, type Rig } from "./dsp.ts";
import type { Bus } from "./mixer.ts";

interface Caller {
  /** The tone it calls on. */
  hz: number;
  /** Pulses in a chirp, the time from one to the next, and how long each lasts (seconds). */
  pulses: number;
  period: number;
  width: number;
  /** The time from the start of one chirp to the start of the next, and how many chirps make a bout before a rest. */
  every: number;
  bout: [number, number];
  rest: [number, number];
  /** How loud, and where. */
  peak: number;
  pan: number;
}

const CALLERS: readonly Caller[] = [
  { hz: 4100, pulses: 3, period: 0.048, width: 0.03, every: 0.52, bout: [5, 12], rest: [0.7, 2.6], peak: 0.15, pan: -0.55 },
  { hz: 4700, pulses: 4, period: 0.038, width: 0.024, every: 0.66, bout: [4, 10], rest: [1.2, 3.4], peak: 0.12, pan: 0.5 },
  { hz: 3250, pulses: 22, period: 0.042, width: 0.028, every: 3.4, bout: [1, 1], rest: [0.6, 2.4], peak: 0.1, pan: 0.05 },
];

interface Voice {
  caller: Caller;
  osc: OscillatorNode;
  gate: GainNode;
  next: number;
  left: number;
}

export class Insects extends BaseLayer {
  readonly id: LayerId = "insects";
  private voices: Voice[] = [];

  constructor(rig: Rig, bus: Bus) {
    super(rig, bus, 0.06, 5400);
  }

  protected build(t: number): void {
    const { ctx, rng } = this.rig;
    this.voices = CALLERS.map((caller, i) => {
      const osc = this.keep(ctx.createOscillator());
      osc.frequency.value = caller.hz;
      const gate = gainNode(ctx, 0);
      const panner = ctx.createStereoPanner();
      panner.pan.value = caller.pan;
      osc.connect(gate);
      gate.connect(panner);
      panner.connect(this.out);
      osc.start(t);
      return { caller, osc, gate, next: t + 0.15 + 0.4 * i + rng.range(0, 0.6), left: 0 };
    });
  }

  protected override forget(): void {
    this.voices = [];
  }

  override schedule(until: number): void {
    const rng = this.rig.rng;
    for (const voice of this.voices) {
      const { caller, gate } = voice;
      while (voice.next < until) {
        const start = voice.next;
        // A chirp: a few pulses, each a quick rise and a slower fall.
        for (let p = 0; p < caller.pulses; p++) {
          const at = start + p * caller.period;
          // Each pulse starts a little sharp and settles, which makes it a tick and not a beep.
          voice.osc.frequency.setValueAtTime(caller.hz * 1.014, at);
          voice.osc.frequency.exponentialRampToValueAtTime(caller.hz, at + caller.width);
          gate.gain.setValueAtTime(0, at);
          gate.gain.linearRampToValueAtTime(caller.peak, at + 0.007);
          gate.gain.linearRampToValueAtTime(0, at + caller.width);
        }
        if (voice.left <= 0) voice.left = rng.int(caller.bout[0], caller.bout[1] + 1);
        voice.left -= 1;
        const chirp = caller.every * (1 + 0.12 * rng.soft());
        voice.next = start + (voice.left <= 0 ? chirp + rng.range(caller.rest[0], caller.rest[1]) : chirp);
      }
    }
  }
}

/** The watchman's round on the clapper: one slow knock and two quick ones, then a while of quiet. */
export class Watch extends BaseLayer {
  readonly id: LayerId = "watch";
  private next = 0;

  constructor(rig: Rig, bus: Bus) {
    super(rig, bus, 0.55);
  }

  protected build(t: number): void {
    this.next = t + 0.3;
  }

  override schedule(until: number): void {
    if (!this.active) {
      this.next = until;
      return;
    }
    const rng = this.rig.rng;
    while (this.next < until) {
      const t = this.next;
      const hit = (at: number, vel: number): void => clapper(this.rig, at, { bus: this.into, vel: vel * 0.22, far: 0.85 });
      hit(t, rng.range(0.85, 1));
      hit(t + 1.15, rng.range(0.6, 0.75));
      hit(t + 1.5, rng.range(0.55, 0.7));
      this.next = t + 5.2 + rng.range(0, 1.8);
    }
  }
}
