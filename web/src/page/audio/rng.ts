/**
 * A small seeded random number generator (mulberry32). The sounds of the game use it for everything that is left to chance,
 * the gaps between the calls of the birds and the drops of the rain, so that a rendering made with a seed is the same every time.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** A number in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A number in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  /** A whole number from lo up to, and not including, hi. */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly [T, ...T[]]): T {
    return list[Math.min(list.length - 1, Math.floor(this.next() * list.length))] as T;
  }

  /** The gap to the next event of a process that has `rate` events a second on average. */
  gap(rate: number): number {
    return -Math.log(1 - this.next()) / Math.max(rate, 1e-6);
  }

  /** A number that is near 0 and mostly between -1 and 1 (the sum of three uniform numbers). */
  soft(): number {
    return (this.next() + this.next() + this.next()) * (2 / 3) - 1;
  }
}
