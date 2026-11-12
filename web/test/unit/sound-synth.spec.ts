import { expect, test } from "@playwright/test";
import { listenerOf } from "../../src/page/audio/listener.ts";
import { PIPA, pluckSamples, ZHENG } from "../../src/page/audio/pluck.ts";
import { Rng } from "../../src/page/audio/rng.ts";
import { above, BAR, EIGHTH, festivalCutoff, festivalLevel, MELODY, patternStrikes, readToken, SLOTS, timeline, TONIC, TUNE_SECONDS, tuneVoices } from "../../src/page/audio/tune.ts";
import { midiToHz } from "../../src/page/audio/dsp.ts";

// The synthesis that needs no browser: the plucked string, the festival tune, the random numbers and where the camera looks.

/** The pitch of a sound by its autocorrelation, in Hz. */
function pitchOf(samples: Float32Array, rate: number, near: number): number {
  const from = Math.floor(rate * 0.03);
  const length = Math.floor(rate * 0.4);
  const seg = Array.from(samples.subarray(from, from + length));
  const mean = seg.reduce((a, b) => a + b, 0) / seg.length;
  const x = seg.map((v) => v - mean);
  const lo = Math.floor(rate / (near * 1.2));
  const hi = Math.ceil(rate / (near * 0.8));
  const ac = (lag: number): number => {
    let sum = 0;
    for (let i = 0; i + lag < x.length; i++) sum += (x[i] ?? 0) * (x[i + lag] ?? 0);
    return sum;
  };
  let best = lo;
  let bestValue = -Infinity;
  for (let lag = lo; lag <= hi; lag++) {
    const value = ac(lag);
    if (value > bestValue) {
      bestValue = value;
      best = lag;
    }
  }
  const a = ac(best - 1);
  const b = ac(best);
  const c = ac(best + 1);
  return rate / (best + (0.5 * (a - c)) / (a - 2 * b + c));
}

test.describe("the plucked string", () => {
  const RATE = 44100;
  const NOTES = [47, 50, 57, 62, 69, 74, 78, 83, 86];

  test("is in tune to within three cents, from the lowest note of the tune to the highest, in both styles", () => {
    for (const [name, style] of [["pipa", PIPA], ["zheng", ZHENG]] as const) {
      for (const note of NOTES) {
        const hz = midiToHz(note);
        const measured = pitchOf(pluckSamples(RATE, hz, style, 0.6, 7919 * note + 13), RATE, hz);
        const cents = 1200 * Math.log2(measured / hz);
        expect(Math.abs(cents), `${name} ${note}: ${hz.toFixed(1)} Hz measured ${measured.toFixed(1)}`).toBeLessThan(3);
      }
    }
  });

  test("is as loud at a low note as at a high one, and never louder than 0.9", () => {
    for (const note of NOTES) {
      const samples = pluckSamples(RATE, midiToHz(note), ZHENG, 0.5, 7919 * note + 13);
      let peak = 0;
      for (const v of samples) peak = Math.max(peak, Math.abs(v));
      expect(peak, `note ${note}`).toBeGreaterThan(0.85);
      expect(peak, `note ${note}`).toBeLessThanOrEqual(0.9001);
    }
  });

  test("dies away, with the highs gone first, and ends in silence", () => {
    const samples = pluckSamples(RATE, midiToHz(62), PIPA, 2, 99);
    const rms = (from: number, to: number): number => {
      let sum = 0;
      for (let i = Math.floor(from * RATE); i < Math.floor(to * RATE); i++) sum += (samples[i] ?? 0) ** 2;
      return Math.sqrt(sum / ((to - from) * RATE));
    };
    expect(rms(0.5, 0.6)).toBeLessThan(rms(0, 0.1) * 0.6);
    expect(rms(1.5, 1.6)).toBeLessThan(rms(0.5, 0.6));
    expect(Math.abs(samples[samples.length - 1] ?? 1)).toBeLessThan(1e-4);
    expect(samples.every((v) => Number.isFinite(v))).toBe(true);
  });

  test("is made the same way from the same seed, and another way from another", () => {
    const a = pluckSamples(RATE, 220, PIPA, 0.2, 5);
    const b = pluckSamples(RATE, 220, PIPA, 0.2, 5);
    const c = pluckSamples(RATE, 220, PIPA, 0.2, 6);
    expect([...a]).toEqual([...b]);
    expect([...a]).not.toEqual([...c]);
  });

  test("keeps its highs soft: little of the energy of the first moments is above six kilohertz", () => {
    for (const note of [50, 62, 69, 78]) {
      const first = pluckSamples(RATE, midiToHz(note), PIPA, 0.3, 4).subarray(0, 4096);
      let high = 0;
      let all = 0;
      for (let bin = 1; bin < 2048; bin++) {
        // The energy of one bin of a windowed transform.
        let re = 0;
        let im = 0;
        for (let n = 0; n < first.length; n++) {
          const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / first.length);
          const phase = (2 * Math.PI * bin * n) / first.length;
          re += (first[n] ?? 0) * w * Math.cos(phase);
          im -= (first[n] ?? 0) * w * Math.sin(phase);
        }
        const power = re * re + im * im;
        all += power;
        if ((bin * RATE) / first.length > 6000) high += power;
      }
      expect(10 * Math.log10(high / all), `note ${note}`).toBeLessThan(-22);
    }
  });
});

test.describe("the festival tune", () => {
  const SCALE = new Set([0, 2, 4, 7, 9]);

  test("is sixteen bars of eight eighth notes, in tempo, and a bar and the whole are as long as they say", () => {
    expect(MELODY.length).toBe(16);
    for (const [bar, line] of MELODY.entries()) expect(line.trim().split(/\s+/).length, `bar ${bar + 1}`).toBe(SLOTS);
    expect(BAR).toBeCloseTo(EIGHTH * 8, 9);
    expect(TUNE_SECONDS).toBeCloseTo(16 * BAR, 9);
    expect(TUNE_SECONDS).toBeGreaterThan(30);
    expect(TUNE_SECONDS).toBeLessThan(45);
  });

  test("keeps to the five notes of its scale in every octave, in the melody and under it", () => {
    for (const voice of tuneVoices().filter((v) => v.pluck.kind !== "zheng" || v.at % 1 === 0)) {
      const step = (((voice.pluck.note - TONIC) % 12) + 12) % 12;
      expect(SCALE.has(step), `note ${voice.pluck.note} at eighth ${voice.at}`).toBe(true);
    }
  });

  test("reads a token as a note of the scale, an octave and a mark", () => {
    expect(readToken("1")).toEqual({ note: TONIC, slide: 0, roll: false, grace: false });
    expect(readToken("3")?.note).toBe(TONIC + 4);
    expect(readToken("5")?.note).toBe(TONIC + 7);
    expect(readToken("1'")?.note).toBe(TONIC + 12);
    expect(readToken("6,")?.note).toBe(TONIC + 9 - 12);
    expect(readToken("5~")).toEqual({ note: TONIC + 7, slide: 2, roll: false, grace: false });
    expect(readToken("1*")).toEqual({ note: TONIC, slide: 0, roll: true, grace: false });
    expect(readToken("3^")).toEqual({ note: TONIC + 4, slide: 0, roll: false, grace: true });
    for (const bad of ["4", "7", "x", "", "11", "-", "0"]) expect(readToken(bad), bad).toBeNull();
  });

  test("has grace notes from the scale just above the note they lead to", () => {
    for (const note of [TONIC - 3, TONIC, TONIC + 2, TONIC + 4, TONIC + 7, TONIC + 9, TONIC + 12, TONIC + 16]) {
      const up = above(note);
      expect(up - note, `above ${note}`).toBeGreaterThan(0);
      expect(up - note, `above ${note}`).toBeLessThanOrEqual(3);
      expect(SCALE.has((((up - TONIC) % 12) + 12) % 12), `above ${note} is ${up}`).toBe(true);
    }
    const graces = tuneVoices().filter((v) => v.pluck.hold === 0.07);
    expect(graces.length).toBe(MELODY.join(" ").split("^").length - 1);
    for (const grace of graces) expect(grace.at % 1, "a grace note comes just before a beat").toBeGreaterThan(0.5);
  });

  test("starts on the third and ends on the tonic", () => {
    expect(MELODY[0]?.split(" ")[0]).toBe("3");
    expect(MELODY[15]?.split(" ")[0]).toBe("1*");
  });

  test("has a timeline in order, that stays inside one round and has the strikes of the procession in it", () => {
    const entries = timeline();
    expect(entries.length).toBeGreaterThan(150);
    for (let i = 1; i < entries.length; i++) expect(entries[i]?.time ?? 0, `entry ${i}`).toBeGreaterThanOrEqual(entries[i - 1]?.time ?? 0);
    expect(entries[0]?.time).toBe(0);
    expect(entries[entries.length - 1]?.time ?? 0).toBeLessThan(TUNE_SECONDS);
    expect(timeline({ tune: true, strikes: false }).length).toBeLessThan(entries.length);
    expect(timeline({ tune: false, strikes: true }).length).toBeLessThan(entries.length);
    expect(timeline({ tune: true, strikes: false }).length + timeline({ tune: false, strikes: true }).length).toBe(entries.length);
    const kinds = new Set(patternStrikes().map((strike) => strike.kind));
    for (const kind of ["big", "small", "clash", "tap", "gong"]) expect(kinds.has(kind as never), kind).toBe(true);
  });
});

test.describe("how far off the festival is", () => {
  test("it is loud when the procession is at the camera and falls away with distance, to a murmur", () => {
    expect(festivalLevel(0)).toBe(1);
    expect(festivalLevel(14)).toBeCloseTo(0.5, 1);
    for (let d = 1; d < 80; d += 3) expect(festivalLevel(d)).toBeLessThanOrEqual(festivalLevel(d - 1));
    expect(festivalLevel(40)).toBeLessThan(0.15);
    expect(festivalLevel(1000)).toBeGreaterThan(0);
    expect(festivalLevel(-5)).toBe(1);
  });

  test("far off only the low sounds carry: the cutoff rises with the level", () => {
    expect(festivalCutoff(0)).toBeLessThan(800);
    expect(festivalCutoff(1)).toBeGreaterThan(8000);
    expect(festivalCutoff(0.5)).toBeGreaterThan(festivalCutoff(0.2));
  });
});

test.describe("the random numbers", () => {
  test("are the same for the same seed, in [0, 1), and spread", () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const seen: number[] = [];
    let same = true;
    for (let i = 0; i < 2000; i++) {
      const v = a.next();
      same &&= v === b.next();
      seen.push(v);
    }
    expect(same).toBe(true);
    expect(Math.min(...seen)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...seen)).toBeLessThan(1);
    const mean = seen.reduce((x, y) => x + y, 0) / seen.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(new Rng(43).next()).not.toBe(new Rng(42).next());
  });

  test("give a whole number in a range, a pick from a list, and gaps that average to the rate", () => {
    const rng = new Rng(7);
    const ints = new Set<number>();
    const picks = new Set<string>();
    let low = 1;
    let high = -1;
    for (let i = 0; i < 500; i++) {
      ints.add(rng.int(2, 5));
      picks.add(rng.pick(["a", "b", "c"]));
      const r = rng.range(-1, 1);
      low = Math.min(low, r);
      high = Math.max(high, r);
    }
    expect([...ints].sort()).toEqual([2, 3, 4]);
    expect([...picks].sort()).toEqual(["a", "b", "c"]);
    expect(low).toBeGreaterThanOrEqual(-1);
    expect(high).toBeLessThan(1);
    let total = 0;
    for (let i = 0; i < 5000; i++) total += rng.gap(4);
    expect(total / 5000).toBeGreaterThan(0.22);
    expect(total / 5000).toBeLessThan(0.28);
  });
});

test.describe("where the camera looks", () => {
  const view = (width: number, height: number) => ({
    canvas: { clientWidth: width, clientHeight: height } as HTMLCanvasElement,
    cellAt: (sx: number, sy: number) => ({ x: Math.floor(sx / 20), y: Math.floor(sy / 16) }),
  });

  test("is the cell in the middle of the picture, and half the width of it in cells", () => {
    expect(listenerOf(view(1000, 640))).toEqual({ x: 25.5, y: 20.5, reach: 25 });
  });

  test("is not known without a map, or before the map has a size", () => {
    expect(listenerOf({ canvas: null, cellAt: () => ({ x: 0, y: 0 }) })).toBeNull();
    expect(listenerOf(view(0, 0))).toBeNull();
  });

  test("never has a reach under four cells", () => {
    expect(listenerOf(view(60, 60))?.reach).toBe(4);
  });
});
