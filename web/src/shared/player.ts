import { FixedStepClock } from "./clock.ts";
import { parseOutputs } from "./outputs.ts";
import type { CallOp, CoreInput, GameLike, GameSpec, HostToPage, PageToHost, PauseReason, Replay, ReplayControl, ReplayStatus, StepOutputs } from "./protocol.ts";
import { groupByTick, ReplayError, ReplayMismatch, specOf, validateReplay } from "./replay.ts";
import { describeError, redact } from "./secrets.ts";

/** Calls made in one pass of the loop at most, so that messages and timers get their turn. */
const MAX_BURST = 10;
/** The longest wait between two passes while a tick is coming. */
const MAX_IDLE_MS = 25;
/** Calls of a seek between two turns for the worker's messages. */
const YIELD_EVERY = 200;
/** A snapshot is taken whenever the world passes a multiple of this many ticks, for the seeks that follow. */
export const SNAPSHOT_EVERY = 120;
/** The snapshots kept in all. A game of five days has about a hundred. */
const MAX_SNAPSHOTS = 400;
const STATUS_EVERY_MS = 250;
export const MAX_SPEED = 64;

export interface PlayerEnv {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  yieldNow(): Promise<void>;
  post(message: HostToPage): void;
  newGame(spec: GameSpec): GameLike;
  /** A game that continues from `GameLike.snapshotJson()`. */
  restoreGame(snapshotJson: string): GameLike;
  core: { version: string; format: number };
  log(level: "info" | "warn" | "error", message: string): void;
  /** Calls of a seek between two turns for the worker's messages. 200 unless a test says otherwise. */
  yieldEvery?: number;
  /** Test builds only. Takes the messages of type "e2e". */
  e2e?: (message: Extract<PageToHost, { type: "e2e" }>, runtime: ReplayRuntime) => void;
}

/** How a seek started: from the world as it stood, from a snapshot, or from the beginning. */
export interface SeekStart {
  target: number;
  kind: "onwards" | "snapshot" | "start";
  /** The tick the way began at. */
  from: number;
}

/** A game on its way through the recording: the tick its next call applies at, and the inputs it has had. */
interface Cursor {
  game: GameLike;
  t: number;
  /** The index of the first group of inputs the game has not had. */
  gi: number;
  last: StepOutputs | null;
}

const isTick = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The snapshots a recording carries, `[tick, text]` each. What is not that is left out. */
function readSnapshots(value: readonly unknown[], endTick: number): Map<number, string> {
  const found = new Map<number, string>();
  for (const entry of value) {
    if (Array.isArray(entry) && entry.length === 2 && isTick(entry[0]) && entry[0] <= endTick && typeof entry[1] === "string") found.set(entry[0], entry[1]);
  }
  return found;
}

/**
 * The host that plays a recording: the read-only twin of `HostRuntime`. It builds the world of a
 * recording with the core, one call for each tick with the inputs that were recorded at that tick,
 * and sends the page the frames it sends for a live game, so that the page draws the town, the
 * numbers and the ending the same way. Nothing here calls a model: the answers are in the recording.
 *
 * A position is the number of ticks simulated, from 1 to the end of the recording. It plays at 10 Hz
 * times the rate the core reports (the rate it reported when the game was played) times a speed. A
 * seek goes to a position by the shortest way: on from where the world is, or from the latest snapshot
 * before it, or from the start. The snapshots are the recording's own (the server host keeps one for
 * each game hour) and the ones this host takes on the way (the browser host keeps none), so the
 * second seek to a place is quick even in a recording that has none. Every hash the recording holds
 * is checked as the world passes it, and a recording that does not replay on this core stops with an
 * error and says where it differs.
 *
 * It takes pause and resume as the live host does (the reasons are `user` and `hidden`), the messages
 * `replay` (open, seek, speed), and the call `ending`. It takes nothing else from the page: a
 * recording is read only.
 */
export class ReplayRuntime {
  private replay: Replay | null = null;
  private groups: Array<{ tick: number; inputs: CoreInput[] }> = [];
  private expected = new Map<number, string>();
  private snapshots = new Map<number, string>();
  private endTick = 0;
  private cursor: Cursor | null = null;
  private phase: ReplayStatus["phase"] = "idle";
  private busy = false;
  private progress = 0;
  private ended = false;
  private error: ReplayStatus["error"] = null;
  private speed = 1;
  private rate: [number, number] = [1, 1];
  private readonly reasons = new Set<PauseReason>();
  private readonly clock = new FixedStepClock();
  private timer: unknown = null;
  /** Counts the seeks, so that one that is overtaken by the next lets go of its work. */
  private gen = 0;
  private lastStatusAt = Number.NEGATIVE_INFINITY;
  private contentHash = "";
  private readonly starts: SeekStart[] = [];

  constructor(private readonly env: PlayerEnv) {}

  /** Starts with nothing open. A page that is hidden holds the recording once it is open. */
  start(hidden: boolean): void {
    this.reasons.clear();
    if (hidden) this.reasons.add("hidden");
    this.postStatus(true);
  }

  stop(): void {
    this.gen++;
    this.cancelTimer();
    this.cursor?.game.destroy();
    this.cursor = null;
    this.phase = "idle";
  }

  // --- Messages from the page ---------------------------------------------------------------

  handle(message: PageToHost): void {
    switch (message.type) {
      case "pause":
        this.reasons.add(message.reason);
        this.reconcile();
        break;
      case "resume": {
        // Play at the end of a recording plays it again.
        const again = this.ended && this.phase === "ready" && message.reason === "user";
        this.reasons.delete(message.reason);
        if (again && !this.busy) {
          this.ended = false;
          void this.goTo(1);
        } else {
          this.reconcile();
        }
        break;
      }
      case "replay":
        this.control(message.control);
        break;
      case "call":
        this.answer(message.reqId, message.call);
        break;
      case "e2e":
        this.env.e2e?.(message, this);
        break;
      default:
        // The page's actions, a new game, a provider: a recording takes none of them.
        break;
    }
  }

  private control(control: ReplayControl): void {
    switch (control.op) {
      case "open":
        void this.open(control);
        break;
      case "seek":
        if (this.replay !== null && this.phase !== "failed" && isTick(control.tick)) {
          this.ended = false;
          void this.goTo(this.clamp(control.tick));
        }
        break;
      case "speed":
        if (Number.isFinite(control.speed) && control.speed > 0 && control.speed <= MAX_SPEED) {
          this.speed = control.speed;
          this.postStatus(true);
        }
        break;
    }
  }

  private answer(reqId: number, call: CallOp): void {
    if (call.op === "ending") {
      const game = this.cursor?.game;
      const result = game === undefined ? null : (JSON.parse(game.endingJson()) as Record<string, unknown> | null);
      this.env.post({ type: "reply", reqId, ok: true, result });
    } else if (call.op === "list-saves") {
      this.env.post({ type: "reply", reqId, ok: true, result: [] });
    } else {
      this.env.post({ type: "reply", reqId, ok: false, error: { code: "unsupported", message: "a recording is read only" } });
    }
  }

  // --- Opening and seeking ------------------------------------------------------------------

  private async open(control: Extract<ReplayControl, { op: "open" }>): Promise<void> {
    try {
      const replay = validateReplay(control.replay);
      if (replay.header.format !== this.env.core.format) {
        throw new ReplayError("unsupported_format", `the recording was written by core format ${replay.header.format}, this one is ${this.env.core.format}`);
      }
      if (replay.end_tick < 1) throw new ReplayError("empty_replay", "the recording has no ticks to play");
      this.gen++;
      this.cancelTimer();
      this.cursor?.game.destroy();
      this.cursor = null;
      this.replay = replay;
      this.contentHash = "";
      this.groups = groupByTick(replay.records);
      this.expected = new Map(replay.hashes);
      this.endTick = replay.end_tick;
      this.snapshots = readSnapshots(replay.snapshots, replay.end_tick);
      this.ended = false;
      this.error = null;
      this.phase = "loading";
      if (control.play === false) this.reasons.add("user");
      else this.reasons.delete("user");
      await this.goTo(this.clamp(control.tick ?? 1));
    } catch (err) {
      this.fail(err);
    }
  }

  private clamp(tick: number): number {
    return Math.min(this.endTick, Math.max(1, Math.trunc(tick)));
  }

  /** The start of the shortest way to a position: the latest snapshot before it, or the beginning. */
  private startFor(target: number): { tick: number; snapshot: string | null } {
    let best = 0;
    for (const tick of this.snapshots.keys()) if (tick < target && tick > best) best = tick;
    return { tick: best, snapshot: best === 0 ? null : (this.snapshots.get(best) ?? null) };
  }

  private firstGroupFrom(tick: number): number {
    const at = this.groups.findIndex((group) => group.tick >= tick);
    return at < 0 ? this.groups.length : at;
  }

  /**
   * Takes the world to the position `target`. It goes on from where the world stands if that is not
   * farther than the latest snapshot, and otherwise builds a world on the side, from the snapshot or
   * from the start, and swaps it in when it has got there. The page is sent a new game (`reset`, the
   * scene, the ending if there is one) and the picture of the position, with none of the events on
   * the way: a seek is a jump, and what happened on the way is not told.
   */
  private async goTo(target: number): Promise<void> {
    const replay = this.replay;
    if (replay === null) return;
    const gen = ++this.gen;
    this.cancelTimer();
    this.busy = true;
    this.progress = 0;
    this.phase = this.cursor === null ? "loading" : "ready";
    this.postStatus(true);

    const start = this.startFor(target);
    const current = this.cursor;
    const onwards = current !== null && current.t <= target && current.t >= start.tick;
    this.starts.push({ target, kind: onwards ? "onwards" : start.snapshot === null ? "start" : "snapshot", from: onwards ? current.t : start.tick });
    let work: Cursor | null = onwards ? current : null;
    try {
      if (work === null) {
        const game = start.snapshot === null ? this.env.newGame(specOf(replay)) : this.env.restoreGame(start.snapshot);
        if (game.tick !== start.tick) {
          game.destroy();
          throw new ReplayError("bad_snapshot", `the snapshot of tick ${start.tick} puts the world at tick ${game.tick}`);
        }
        work = { game, t: start.tick, gi: this.firstGroupFrom(start.tick), last: null };
      }
      if (this.contentHash === "") this.contentHash = String((JSON.parse(work.game.headerJson()) as { content_hash?: string }).content_hash ?? "");
      const from = work.t;
      let calls = 0;
      while (work.t < target) {
        this.callOnce(work);
        calls++;
        if (calls % (this.env.yieldEvery ?? YIELD_EVERY) === 0) {
          this.progress = target === from ? 1 : (work.t - from) / (target - from);
          this.postStatus(true);
          await this.env.yieldNow();
          if (gen !== this.gen) {
            // Another seek has taken over. What this one built is of no use.
            if (!onwards) work.game.destroy();
            return;
          }
        }
      }
    } catch (err) {
      // A world built here that did not get there is let go of. The one the page is looking at is not touched.
      if (work !== null && work !== current) work.game.destroy();
      if (gen === this.gen) this.fail(this.explain(err));
      return;
    }
    if (!onwards) {
      const old = this.cursor;
      this.cursor = work;
      old?.game.destroy();
    }
    this.busy = false;
    this.progress = 1;
    this.phase = "ready";
    this.ended = work.t >= this.endTick;
    this.show(work);
    this.reconcile();
  }

  /** Tells the page of a world it has not seen: a new game, its scene and ending, and the picture of where it stands. */
  private show(work: Cursor): void {
    const replay = this.replay;
    const last = work.last;
    if (replay === null || last === null) return;
    this.rate = last.clock.rate;
    this.env.post({ type: "reset", seed: replay.header.seed, scenario: replay.header.scenario });
    try {
      this.env.post({ type: "scene", scene: JSON.parse(work.game.sceneJson()) as Record<string, unknown> });
      this.env.post({ type: "ending", ending: JSON.parse(work.game.endingJson()) as Record<string, unknown> | null });
    } catch (err) {
      this.env.log("warn", `the scene or the ending could not be read: ${describeError(err)}`);
    }
    this.env.post({ type: "frame", tick: last.tick, advanced: last.advanced, frame: last.frame, events: [], clock: { paused: !this.playing(), rate: last.clock.rate }, hash: last.hash });
  }

  // --- One call of the core -----------------------------------------------------------------

  /** One call with the inputs recorded at this tick, checked against the hashes the recording holds. */
  private callOnce(work: Cursor): StepOutputs {
    const group = this.groups[work.gi];
    let inputs: CoreInput[] = [];
    if (group !== undefined && group.tick === work.t) {
      inputs = group.inputs;
      work.gi++;
    } else if (group !== undefined && group.tick < work.t) {
      throw new ReplayError("bad_log", `inputs at tick ${group.tick} come after the world reached tick ${work.t}`);
    }
    const out = parseOutputs(work.game.step(JSON.stringify(inputs)));
    if (out.tick !== work.t) throw new ReplayError("tick_mismatch", `the core applied a call at tick ${out.tick}, expected ${work.t}`);
    if (out.advanced) {
      if (out.hash !== undefined) {
        const want = this.expected.get(out.tick);
        if (want !== undefined && want !== out.hash) throw new ReplayMismatch(out.tick, want, out.hash, "checkpoint");
      }
      work.t = out.tick + 1;
      if (work.t % SNAPSHOT_EVERY === 0 && !this.snapshots.has(work.t) && this.snapshots.size < MAX_SNAPSHOTS) {
        this.snapshots.set(work.t, work.game.snapshotJson());
      }
    } else if (work.t < this.endTick) {
      // All the inputs of a tick are one group, so a world that is held after them stays held.
      throw new ReplayError("bad_log", `the world is held at tick ${work.t} and nothing in the recording lets it go on`);
    }
    work.last = out;
    return out;
  }

  /** A mismatch between the recording and this core, with what each was made by if they differ. */
  private explain(err: unknown): unknown {
    const replay = this.replay;
    if (!(err instanceof ReplayMismatch) || replay === null) return err;
    const saved = `${replay.header.core_version} / ${String(replay.header.content_hash ?? "?").slice(0, 8)}`;
    const here = `${this.env.core.version} / ${this.contentHash.slice(0, 8) || "?"}`;
    return saved === here ? err : new ReplayError(err.code, `${err.message} (recorded by core ${saved}, this one is ${here})`);
  }

  // --- Playing ------------------------------------------------------------------------------

  private playing(): boolean {
    return this.phase === "ready" && !this.busy && !this.ended && this.reasons.size === 0;
  }

  /** Brings the loop in line with the reasons to hold: running while there is none, still while there is one. */
  private reconcile(): void {
    this.cancelTimer();
    if (this.playing()) {
      this.clock.reset(this.env.now());
      this.schedule(0);
    }
    this.postStatus(true);
  }

  private schedule(delayMs: number): void {
    this.cancelTimer();
    this.timer = this.env.setTimeout(this.pump, delayMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.env.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private readonly pump = (): void => {
    this.timer = null;
    const cursor = this.cursor;
    if (cursor === null || !this.playing()) return;
    const now = this.env.now();
    const [num, den] = this.rate;
    this.clock.update(now, num, den, this.speed);
    let done = 0;
    try {
      while (done < MAX_BURST && this.clock.due() >= 1 && cursor.t < this.endTick) {
        this.clock.consume(1);
        const out = this.callOnce(cursor);
        this.rate = out.clock.rate;
        this.env.post({ type: "frame", tick: out.tick, advanced: out.advanced, frame: out.frame, events: out.events, clock: { paused: false, rate: out.clock.rate }, hash: out.hash });
        done++;
      }
    } catch (err) {
      this.fail(this.explain(err));
      return;
    }
    if (cursor.t >= this.endTick) {
      this.ended = true;
      // The picture of the last tick is there. If the game was over by then the page is told the whole ending.
      try {
        this.env.post({ type: "ending", ending: JSON.parse(cursor.game.endingJson()) as Record<string, unknown> | null });
      } catch (err) {
        this.env.log("warn", `the ending could not be read: ${describeError(err)}`);
      }
      this.postStatus(true);
      return;
    }
    if (now - this.lastStatusAt >= STATUS_EVERY_MS) this.postStatus(true);
    if (!this.playing()) return;
    const wait = done >= MAX_BURST && this.clock.due() >= 1 ? 0 : this.clock.msUntilNext(num, den, this.speed);
    this.schedule(Math.max(wait === 0 ? 0 : 1, Math.min(MAX_IDLE_MS, Math.floor(Number.isFinite(wait) ? wait : MAX_IDLE_MS))));
  };

  // --- Failure and status -------------------------------------------------------------------

  private fail(err: unknown): void {
    this.gen++;
    this.cancelTimer();
    const known = err instanceof ReplayError;
    this.error = { code: known ? err.code : "replay_failed", message: known ? redact(err.message) : describeError(err) };
    this.phase = "failed";
    this.busy = false;
    this.env.log("error", `${this.error.code}: ${this.error.message}`);
    this.env.post({ type: "fatal", code: this.error.code, message: this.error.message });
    this.postStatus(true);
  }

  status(): ReplayStatus {
    const replay = this.replay;
    return {
      phase: this.phase,
      tick: this.cursor?.t ?? 0,
      endTick: this.endTick,
      playing: this.playing(),
      speed: this.speed,
      busy: this.busy,
      progress: this.progress,
      ended: this.ended,
      snapshots: this.snapshots.size,
      seed: replay?.header.seed ?? 0,
      scenario: replay?.header.scenario ?? "",
      coreVersion: replay?.header.core_version ?? "",
      host: replay?.host.name ?? "",
      error: this.error,
    };
  }

  private postStatus(force = false): void {
    const now = this.env.now();
    if (!force && now - this.lastStatusAt < STATUS_EVERY_MS) return;
    this.lastStatusAt = now;
    this.env.post({ type: "replay", status: this.status() });
  }

  /** For the test hooks: a few internals that the status does not carry. */
  debugState(): { snapshotTicks: number[]; reasons: PauseReason[]; position: number; starts: SeekStart[] } {
    return {
      snapshotTicks: [...this.snapshots.keys()].sort((a, b) => a - b),
      reasons: [...this.reasons],
      position: this.cursor?.t ?? 0,
      starts: [...this.starts],
    };
  }
}
