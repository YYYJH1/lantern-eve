/**
 * A small seeded generator for the festival night. The night is staged from the ending alone, and the same ending is staged the same way each time
 * it is played, so nothing of it draws from `Math.random`: every kind of choice has a stream of its own (`salt`), made from the seed of the ending.
 */

/** A 32-bit hash of numbers and words, for seeding a stream (FNV-1a over their text). */
export function hashSeed(...parts: ReadonlyArray<string | number>): number {
  let h = 2166136261;
  for (const part of parts) {
    const text = `${part}|`;
    for (let i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

/** A stream of numbers in [0, 1) that is a function of the seed and the salt (mulberry32). */
export class Rng {
  private state: number;

  constructor(seed: number, salt = "") {
    this.state = hashSeed(seed, salt) || 1;
  }

  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let z = this.state;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number from 0 up to `n` (not including it). */
  int(n: number): number {
    return Math.min(n - 1, Math.floor(this.next() * n));
  }

  /** A number from `low` up to `high`. */
  range(low: number, high: number): number {
    return low + (high - low) * this.next();
  }

  /** One of the items, or undefined if there are none. */
  pick<T>(items: readonly T[]): T | undefined {
    return items.length === 0 ? undefined : items[this.int(items.length)];
  }

  /** The items in another order. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const keep = out[i] as T;
      out[i] = out[j] as T;
      out[j] = keep;
    }
    return out;
  }
}
