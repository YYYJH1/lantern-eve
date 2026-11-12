import { browserEnv, type DirectorEnv } from "./director.ts";

/**
 * The clock of the shows, moved by hand, for the test build: a page opened with `?showclock=manual` plays its shows (a moment, the festival night)
 * as far as the test advances the clock and no further, so that a picture or a film of a show is made at the seconds the test chooses, whatever
 * the speed of the machine. The keyboard and the system's wish for less motion are the browser's own.
 */
export interface ShowClock {
  env: DirectorEnv;
  /** The seconds the clock has been run, as a show counts them. */
  now(): number;
  /** Runs the clock forward by `ms` milliseconds, at sixty animation frames a second: the frames and the timers that fall due on the way are run. */
  advance(ms: number): void;
}

export function manualShowClock(): ShowClock {
  let time = 1000;
  let frames: Array<() => void> = [];
  let timers: Array<{ at: number; fn: () => void }> = [];
  const real = browserEnv();
  const env: DirectorEnv = {
    now: () => time,
    later: (fn) => {
      frames.push(fn);
      return () => {
        frames = frames.filter((each) => each !== fn);
      };
    },
    after: (ms, fn) => {
      const timer = { at: time + ms, fn };
      timers.push(timer);
      return () => {
        timers = timers.filter((each) => each !== timer);
      };
    },
    keys: (fn) => real.keys(fn),
    calm: () => real.calm(),
  };
  return {
    env,
    now: () => time,
    advance(ms) {
      const end = time + ms;
      while (time < end) {
        time = Math.min(end, time + 1000 / 60);
        const due = timers.filter((timer) => timer.at <= time);
        timers = timers.filter((timer) => timer.at > time);
        for (const timer of due) timer.fn();
        const run = frames;
        frames = [];
        for (const fn of run) fn();
      }
    },
  };
}
