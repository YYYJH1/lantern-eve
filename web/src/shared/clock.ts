/** Length of one tick in game milliseconds: the core runs at 10 Hz times its rate. */
export const TICK_MS = 100;

/**
 * A fixed-timestep accumulator.
 *
 * Real time goes in through update(), scaled by the core's rate, and whole ticks come out through
 * due() and consume(). Game time is the number of ticks stepped, so it follows the accumulator and
 * never depends on how often a timer fires: a timer that fires late finds more ticks due and runs
 * them in a burst, a timer that fires early finds none.
 *
 * Two limits keep a slow or stalled worker from building up a backlog it can never work off. One
 * update adds at most maxElapsedMs of real time, and the accumulator never holds more than
 * maxElapsedMs worth of game time. Time beyond that is dropped and counted in `dropped`.
 */
export class FixedStepClock {
  private acc = 0;
  private last = 0;
  /** Game milliseconds that were dropped by the two limits. */
  dropped = 0;

  constructor(
    private readonly tickMs: number = TICK_MS,
    private readonly maxElapsedMs: number = 2000,
  ) {}

  /** Forget everything owed and start counting from `now`. Used on resume, so nothing is caught up. */
  reset(now: number): void {
    this.acc = 0;
    this.last = now;
  }

  update(now: number, num: number, den: number, pace = 1): void {
    let elapsed = now - this.last;
    this.last = now;
    if (!(elapsed > 0)) return;
    // Game milliseconds per real millisecond.
    const speed = num > 0 && den > 0 ? (pace * num) / den : 0;
    if (elapsed > this.maxElapsedMs) {
      this.dropped += (elapsed - this.maxElapsedMs) * speed;
      elapsed = this.maxElapsedMs;
    }
    if (speed === 0) return;
    this.acc += elapsed * speed;
    const cap = this.maxElapsedMs * speed;
    if (this.acc > cap) {
      this.dropped += this.acc - cap;
      this.acc = cap;
    }
  }

  /** Whole ticks that are owed. */
  due(): number {
    return Math.floor(this.acc / this.tickMs + 1e-9);
  }

  consume(n = 1): void {
    this.acc = Math.max(0, this.acc - n * this.tickMs);
  }

  /** Real milliseconds until the next tick falls due at the given speed. */
  msUntilNext(num: number, den: number, pace = 1): number {
    if (!(num > 0 && den > 0)) return Infinity;
    const remaining = Math.max(0, this.tickMs - this.acc);
    return remaining / ((pace * num) / den);
  }
}
