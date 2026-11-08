import { expect, test } from "@playwright/test";
import { FixedStepClock } from "../../src/shared/clock.ts";

function run(clock: FixedStepClock, from: number, steps: number[], rate: [number, number] = [1, 1], pace = 1): number {
  let now = from;
  let ticks = 0;
  for (const dt of steps) {
    now += dt;
    clock.update(now, rate[0], rate[1], pace);
    const n = clock.due();
    clock.consume(n);
    ticks += n;
  }
  return ticks;
}

test.describe("FixedStepClock", () => {
  test("ten ticks per second at rate 1/1, however often it is asked", () => {
    for (const step of [1, 7, 16, 33, 100, 250, 999]) {
      const clock = new FixedStepClock();
      clock.reset(0);
      const steps = Array.from({ length: Math.ceil(10_000 / step) }, () => step);
      const total = steps.reduce((a, b) => a + b, 0);
      const ticks = run(clock, 0, steps);
      expect(ticks, `asked every ${step} ms`).toBe(Math.floor(total / 100));
    }
  });

  test("a timer that fires late gets the same ticks in one burst", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    expect(run(clock, 0, [1500])).toBe(15);
  });

  test("the rate scales the speed", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    expect(run(clock, 0, [1000, 1000], [1, 3])).toBe(6);
    clock.reset(0);
    expect(run(clock, 0, [1000], [3, 1])).toBe(30);
    clock.reset(0);
    expect(run(clock, 0, [1000], [0, 1])).toBe(0);
  });

  test("pace multiplies real time, for the tests", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    expect(run(clock, 0, [1000], [1, 1], 20)).toBe(200);
  });

  test("a stall longer than the cap drops the rest instead of building a backlog", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    clock.update(30_000, 1, 1);
    expect(clock.due()).toBe(20);
    expect(clock.dropped).toBe(28_000);
  });

  test("a backlog that is never worked off stops growing at the cap", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += 1000;
      clock.update(now, 1, 1); // nothing is consumed, as on a machine that cannot keep up
    }
    expect(clock.due()).toBeLessThanOrEqual(20);
  });

  test("reset forgets what was owed", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    clock.update(900, 1, 1);
    clock.reset(900);
    clock.update(950, 1, 1);
    expect(clock.due()).toBe(0);
  });

  test("a clock that goes backwards adds nothing", () => {
    const clock = new FixedStepClock();
    clock.reset(1000);
    clock.update(500, 1, 1);
    expect(clock.due()).toBe(0);
  });

  test("tells how long until the next tick", () => {
    const clock = new FixedStepClock();
    clock.reset(0);
    clock.update(30, 1, 1);
    expect(clock.msUntilNext(1, 1)).toBeCloseTo(70);
    expect(clock.msUntilNext(1, 2)).toBeCloseTo(140);
    expect(clock.msUntilNext(0, 1)).toBe(Number.POSITIVE_INFINITY);
  });
});
