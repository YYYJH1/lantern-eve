import type { GameSpec, HostToPage, PageToHost, Replay, ReplayControl, ReplayStatus } from "../../src/shared/protocol.ts";
import { ReplayRuntime } from "../../src/shared/player.ts";
import { groupByTick } from "../../src/shared/replay.ts";
import { FakeGame, type FakeOptions } from "./fake-game.ts";
import { VirtualHost } from "./virtual-env.ts";

export const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

/**
 * A recording of a game of the stand-in world, made by the browser host itself: a game of `ticks` ticks
 * in which `script` may press pause and resume and send actions at chosen ticks. With `snapshotEvery`
 * the recording carries a snapshot for every that many ticks, as the server host's do.
 */
export async function recordGame(options: FakeOptions = {}, ticks = 600, script: Record<number, PageToHost[]> = {}, snapshotEvery = 0): Promise<Replay> {
  const host = new VirtualHost(options);
  host.runtime.start(42, "bridge", false);
  for (let tick = 0; tick < ticks; tick++) {
    for (const message of script[tick] ?? []) host.runtime.handle(message);
    host.advance(100);
  }
  const replay = host.runtime.buildReplay();
  if (snapshotEvery > 0) {
    const game = new FakeGame(replay.header.seed, replay.header.scenario, options);
    const groups = groupByTick(replay.records);
    let gi = 0;
    let t = 0;
    const snapshots: Array<[number, string]> = [];
    while (t < replay.end_tick) {
      const group = groups[gi];
      let inputs: unknown[] = [];
      if (group !== undefined && group.tick === t) {
        inputs = group.inputs;
        gi++;
      }
      const out = JSON.parse(game.step(JSON.stringify(inputs))) as { advanced: boolean; tick: number };
      if (out.advanced) {
        t = out.tick + 1;
        if (t % snapshotEvery === 0) snapshots.push([t, game.snapshotJson()]);
      }
    }
    replay.snapshots = snapshots;
  }
  return replay;
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** The host that plays a recording, on a clock that only moves when the test moves it. */
export class VirtualPlayer {
  nowMs = 1000;
  private timers: Timer[] = [];
  private nextTimer = 1;
  readonly posted: HostToPage[] = [];
  readonly games: FakeGame[] = [];
  /** What each game was made from: a spec for one built from the start, a snapshot for one that continued from one. */
  readonly made: Array<GameSpec | { snapshotTick: number }> = [];
  readonly logs: string[] = [];
  readonly runtime: ReplayRuntime;
  /** The calls to yield to the worker's message loop, which a test can count or hold. */
  yields = 0;
  /** What a call to `yieldNow` does besides returning. */
  onYield: (() => void) | null = null;

  constructor(
    readonly options: FakeOptions = {},
    hidden = false,
    yieldEvery?: number,
  ) {
    this.runtime = new ReplayRuntime({
      now: () => this.nowMs,
      setTimeout: (fn, ms) => {
        const id = this.nextTimer++;
        this.timers.push({ id, at: this.nowMs + Math.max(0, ms), fn });
        return id;
      },
      clearTimeout: (handle) => {
        this.timers = this.timers.filter((t) => t.id !== handle);
      },
      yieldNow: async () => {
        this.yields++;
        this.onYield?.();
      },
      post: (message) => this.posted.push(message),
      newGame: (spec) => {
        this.made.push(spec);
        const game = new FakeGame(spec.seed, spec.scenario, this.options);
        this.games.push(game);
        return game;
      },
      restoreGame: (text) => {
        const game = FakeGame.restore(text, this.options);
        this.made.push({ snapshotTick: game.tick });
        this.games.push(game);
        return game;
      },
      core: { version: "fake-1", format: 1 },
      log: (level, message) => this.logs.push(`${level}: ${message}`),
      yieldEvery,
    });
    this.runtime.start(hidden);
  }

  advance(ms: number): void {
    const target = this.nowMs + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.nowMs = Math.max(this.nowMs, due.at);
      due.fn();
    }
    this.nowMs = target;
  }

  control(control: ReplayControl): void {
    this.runtime.handle({ type: "replay", control });
  }

  async open(replay: unknown, extra: { tick?: number; play?: boolean } = {}): Promise<void> {
    this.control({ op: "open", replay, ...extra });
    await flush();
  }

  async seek(tick: number): Promise<void> {
    this.control({ op: "seek", tick });
    await flush();
  }

  get game(): FakeGame {
    const game = this.games[this.games.length - 1];
    if (game === undefined) throw new Error("no game was made");
    return game;
  }

  frames(): Array<Extract<HostToPage, { type: "frame" }>> {
    return this.posted.filter((m): m is Extract<HostToPage, { type: "frame" }> => m.type === "frame");
  }

  /** The status that was posted last. */
  get status(): ReplayStatus {
    const found = [...this.posted].reverse().find((m): m is Extract<HostToPage, { type: "replay" }> => m.type === "replay");
    if (found === undefined) throw new Error("no status was posted");
    return found.status;
  }

  types(): string[] {
    return this.posted.map((m) => m.type);
  }
}
