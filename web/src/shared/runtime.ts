import { FixedStepClock } from "./clock.ts";
import { CallTracker } from "./model-calls.ts";
import { parseOutputs } from "./outputs.ts";
import {
  type CallOp,
  type CoreHeader,
  type CoreInput,
  type GameLike,
  type GameSpec,
  HOST_VERSION,
  HostError,
  type HostStats,
  type HostToPage,
  type LastModelResult,
  type LoadInfo,
  type LogRecord,
  type ModelCounters,
  type ModelRequest,
  type ModelResultBody,
  type PageNotes,
  type PageToHost,
  type PauseReason,
  type PresetGame,
  type PresetOptions,
  REPLAY_FORMAT,
  type Replay,
  type SaveMeta,
  type StepOutputs,
  type Usage,
} from "./protocol.ts";
import { ReplayError, runReplay, sortedHashes, validateReplay } from "./replay.ts";
import { describeError, redact } from "./secrets.ts";
import type { ModelCall, ModelOutcome, Transport } from "./transport.ts";

/** Calls made in one pass of the loop at most, so that messages and timers get their turn. */
const MAX_BURST = 10;
/** The pass interval while nothing is due (paused or between ticks), at most. */
const MAX_IDLE_MS = 25;
const PAUSED_POLL_MS = 50;
const STATS_EVERY_MS = 500;
/** The speed of the day that the player may ask for, as a multiple of the common pace. */
const MIN_SPEED = 0.25;
export const MAX_SPEED = 4;
/** The most a skip to the next thing may ask for (the message `speed` with `skip`): the days it passes over are waited out, not played. */
export const MAX_SKIP_SPEED = 12;

/**
 * The most the page may keep with a save, in characters of JSON: the paper of the morning and the summary of the night (a few lines), and the small
 * pictures of the moments of the game (at most three of at most 40,000 characters each). The notes are not a second save.
 */
export const MAX_PAGE_NOTES = 163_840;

/** The notes a page sent with a save if they are a plain object of a size worth keeping, else nothing. */
export function keptNotes(page: unknown): PageNotes | undefined {
  if (typeof page !== "object" || page === null || Array.isArray(page)) return undefined;
  let text: string;
  try {
    text = JSON.stringify(page);
  } catch {
    return undefined;
  }
  return text.length <= MAX_PAGE_NOTES ? (JSON.parse(text) as PageNotes) : undefined;
}

export interface SaveStore {
  put(meta: Omit<SaveMeta, "id">, replay: Replay): Promise<SaveMeta>;
  list(): Promise<SaveMeta[]>;
  get(id: number): Promise<{ meta: SaveMeta; replay: unknown } | undefined>;
  remove(id: number): Promise<void>;
}

export interface CoreInfo {
  version: string;
  format: number;
}

export interface RuntimeEnv {
  now(): number;
  wallClockIso(): string;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  yieldNow(): Promise<void>;
  post(message: HostToPage): void;
  newGame(spec: GameSpec): GameLike;
  /**
   * The seed, the scenario and the config of a named game of the core, at another seed and with another story true where the
   * options say so. It throws for a name, a seed or a story the core does not know.
   */
  preset?(name: string, options?: PresetOptions): PresetGame;
  core: CoreInfo;
  transport: Transport;
  saves: SaveStore;
  /** Test builds only. Multiplies real time before it reaches the accumulator. Otherwise 1. */
  pace: number;
  /** Test builds only. Lets a `configure` message point a provider at another base URL. */
  allowBaseUrl: boolean;
  /** Test builds only. The host pauses once, as the player would, when this many ticks are done. */
  pauseAtTick?: number;
  /** Test builds only. Keys of the config of every game the host starts (a new game keeps them). */
  gameConfig?: Record<string, number>;
  log(level: "info" | "warn" | "error", message: string): void;
  /** Test builds only. Takes the messages of type "e2e". */
  e2e?: (message: Extract<PageToHost, { type: "e2e" }>, runtime: HostRuntime) => void;
}

/** The last `capacity` samples of a number, enough for a mean, a 95th percentile and a maximum. */
class Samples {
  private readonly values: number[] = [];
  private next = 0;

  constructor(private readonly capacity = 2048) {}

  push(value: number): void {
    if (this.values.length < this.capacity) this.values.push(value);
    else this.values[this.next] = value;
    this.next = (this.next + 1) % this.capacity;
  }

  mean(): number {
    if (this.values.length === 0) return 0;
    let sum = 0;
    for (const v of this.values) sum += v;
    return sum / this.values.length;
  }

  max(): number {
    let max = 0;
    for (const v of this.values) if (v > max) max = v;
    return max;
  }

  p95(): number {
    if (this.values.length === 0) return 0;
    const sorted = [...this.values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
  }
}

interface ActiveCall {
  id: string;
  call: ModelCall;
  discard: boolean;
}

type Mode = "idle" | "running" | "loading" | "failed";

/** Whether the core refused the list of inputs (InputError), which leaves the game as it was. */
function refusedByCore(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const typed = err as { type?: unknown; name?: unknown; message?: unknown };
  if (typed.type === "InputError" || typed.name === "InputError") return true;
  // Pyodide reports a Python exception with its traceback as the message. The last lines name the class.
  return typeof typed.message === "string" && /\bInputError\b/.test(typed.message.split("\n").slice(-4).join("\n"));
}

function freshCounters(): ModelCounters {
  return { started: 0, ok: 0, error: 0, timeout: 0, cancelled: 0, inflight: 0, discarded: 0, cancelUnknown: 0 };
}

/**
 * The browser host: everything the worker does that is not Pyodide, the network or IndexedDB.
 *
 * It owns one Game and drives it at 10 Hz times the rate the core reports, with a fixed-timestep
 * accumulator. It numbers every input in the order it receives it, applies the inputs it holds at
 * the next call, and records each applied input with the tick of that call. It forwards the model
 * requests of the core to the transport and the results back as inputs, aborts the requests the
 * core cancels, and keeps a replay of the whole session that it can save and rebuild.
 */
export class HostRuntime {
  private game: GameLike | null = null;
  private header: CoreHeader | null = null;
  private mode: Mode = "idle";
  /** The tick the next call applies at. */
  private nextTick = 0;
  private corePaused = false;
  private rate: [number, number] = [1, 1];
  private readonly clock = new FixedStepClock();
  private pending: CoreInput[] = [];
  private log: LogRecord[] = [];
  private checkpoints = new Map<number, string>();
  private nextSeq = 0;
  /** Why the world should be paused. It runs when this is empty. */
  private readonly reasons = new Set<PauseReason>();
  /** Whether the host has sent a pause that no resume has undone. */
  private pauseSent = false;
  /** How fast the day runs, as a multiple of the common pace: the player's choice, not the core's. */
  private speed = 1;
  private readonly calls = new Map<string, ActiveCall>();
  private timer: unknown = null;
  private lastStatsAt = Number.NEGATIVE_INFINITY;
  private callCount = 0;
  private pauseAtTick: number | undefined;
  private readonly pyMs = new Samples();
  private readonly hostMs = new Samples();
  private models: ModelCounters = freshCounters();
  private lastModel: LastModelResult | null = null;
  /** The list of model calls of the game that is running. */
  private tracker: CallTracker | null = null;

  constructor(private readonly env: RuntimeEnv) {
    this.pauseAtTick = env.pauseAtTick;
  }

  // --- Lifecycle ----------------------------------------------------------------------------

  /**
   * Starts the first game, held if the page is hidden. With `preset` the game is the core's game of that name, and the
   * result says which seed and scenario it has.
   */
  start(seed: number, scenario: string, hidden: boolean, preset?: string): { seed: number; scenario: string } {
    this.reasons.clear();
    if (hidden) this.reasons.add("hidden");
    const spec = this.specOf(seed, scenario, preset);
    this.resetSession(spec);
    return { seed: spec.seed, scenario: spec.scenario };
  }

  /**
   * The game to start: the one the core names (at the seed and with the story in `options`, if it is asked for those), or the seed and
   * scenario given, under the config of the test build.
   */
  private specOf(seed: number, scenario: string, preset?: string, options?: PresetOptions): GameSpec {
    const tests = this.env.gameConfig ?? null;
    if (preset === undefined) {
      if (options?.variant !== undefined) throw new Error("a story to be true needs a game by name");
      return { seed, scenario, config: tests };
    }
    if (this.env.preset === undefined) throw new Error(`this host cannot start the game named ${preset}`);
    const named = this.env.preset(preset, options);
    return { seed: named.seed, scenario: named.scenario, config: { ...named.config, ...tests } };
  }

  /** Stops the loop and ends every call. The runtime is not used again. */
  stop(): void {
    this.cancelTimer();
    this.abortAll();
    this.mode = "idle";
    this.game?.destroy();
    this.game = null;
  }

  private resetSession(spec: GameSpec): void {
    this.cancelTimer();
    this.abortAll();
    this.game?.destroy();
    this.game = null;
    this.header = null;
    this.tracker = null;
    this.nextTick = 0;
    this.corePaused = false;
    this.rate = [1, 1];
    this.pending = [];
    this.log = [];
    this.checkpoints = new Map();
    this.nextSeq = 0;
    this.pauseSent = false;
    this.callCount = 0;
    this.models = freshCounters();
    this.lastModel = null;
    try {
      this.game = this.env.newGame(spec);
      this.header = JSON.parse(this.game.headerJson()) as CoreHeader;
      this.tracker = this.newTracker(this.header);
    } catch (err) {
      this.fail("core_error", err);
      return;
    }
    this.mode = "running";
    this.postScene(this.game);
    this.postEnding(this.game);
    this.clock.reset(this.env.now());
    this.reconcilePause();
    this.postStats(true);
    if (this.mode === "running") this.schedule(MAX_IDLE_MS);
  }

  private newTracker(header: CoreHeader): CallTracker {
    return new CallTracker(header.config, (request) => this.env.transport.modelOf(request));
  }

  /** The scene of a game, for the page to draw. A game whose scene cannot be read is still played. */
  private postScene(game: GameLike): void {
    try {
      const scene = JSON.parse(game.sceneJson()) as Record<string, unknown>;
      this.env.post({ type: "scene", scene });
    } catch (err) {
      this.env.log("warn", `the scene could not be read: ${describeError(err)}`);
    }
  }

  /** The whole ending of a game, reveal included, or null before it has ended. */
  private endingOf(game: GameLike): Record<string, unknown> | null {
    return JSON.parse(game.endingJson()) as Record<string, unknown> | null;
  }

  /**
   * The ending of a game that is created or swapped in, for the page to keep. A game that was loaded
   * may be over, and the frames of a game that is over carry the ending without its reveal.
   */
  private postEnding(game: GameLike): void {
    try {
      this.env.post({ type: "ending", ending: this.endingOf(game) });
    } catch (err) {
      this.env.log("warn", `the ending could not be read: ${describeError(err)}`);
    }
  }

  // --- Messages from the page ---------------------------------------------------------------

  handle(message: PageToHost): void {
    try {
      this.dispatch(message);
    } catch (err) {
      this.fail("host_error", err);
    }
  }

  private dispatch(message: PageToHost): void {
    switch (message.type) {
      case "init":
        break;
      case "pause":
        this.reasons.add(message.reason);
        this.reconcilePause();
        break;
      case "resume":
        this.reasons.delete(message.reason);
        this.reconcilePause();
        break;
      case "player":
        if (this.mode !== "running") {
          this.env.log("warn", `player input dropped while ${this.mode}`);
          break;
        }
        this.enqueue("player", message.body);
        this.flushIfPaused();
        break;
      case "speed":
        // The pace of the clock only. The ticks the core is asked for are the same, a little sooner or later.
        this.speed = Number.isFinite(message.speed) ? Math.min(message.skip === true ? MAX_SKIP_SPEED : MAX_SPEED, Math.max(MIN_SPEED, message.speed)) : 1;
        this.postStats(true);
        break;
      case "new-game": {
        let spec: GameSpec;
        try {
          spec = this.specOf(message.seed ?? 0, message.scenario ?? this.header?.scenario ?? "m0", message.preset, {
            seed: message.seed,
            variant: message.variant,
          });
        } catch (err) {
          // A name the core does not know: the game that is running goes on.
          this.env.log("warn", `new game refused: ${describeError(err)}`);
          this.env.post({ type: "notice", code: "bad_game", message: describeError(err) });
          break;
        }
        this.env.post({ type: "reset", seed: spec.seed, scenario: spec.scenario });
        this.resetSession(spec);
        break;
      }
      case "configure":
        this.env.transport.configure({
          provider: message.provider,
          key: message.key,
          model: message.model,
          baseUrl: this.env.allowBaseUrl ? message.baseUrl : undefined,
        });
        break;
      case "call":
        void this.handleCall(message.reqId, message.call);
        break;
      case "e2e":
        this.env.e2e?.(message, this);
        break;
    }
  }

  /**
   * What the core says an action would ask, give and cost, or null in a game that has no previews. It only reads: the core
   * draws nothing from its RNG and writes nothing to its state, and the host logs nothing for it, so it is not in a replay.
   * An action the core cannot read (an unknown verb or person, a field of the wrong type) is the code `bad_action`.
   */
  private previewOf(game: GameLike, action: Record<string, unknown>): unknown {
    try {
      return JSON.parse(game.previewJson(JSON.stringify(action))) as unknown;
    } catch (err) {
      if (refusedByCore(err)) throw new HostError("bad_action", describeError(err));
      throw err;
    }
  }

  private async handleCall(reqId: number, call: CallOp): Promise<void> {
    try {
      let result: unknown;
      switch (call.op) {
        case "save":
          result = await this.saveGame(call.name, call.page);
          break;
        case "load":
          result = await this.loadGame(call.id);
          break;
        case "list-saves":
          result = await this.env.saves.list();
          break;
        case "delete-save":
          await this.env.saves.remove(call.id);
          result = null;
          break;
        case "export":
          result = this.buildReplay();
          break;
        case "ending":
          if (this.game === null) throw new HostError("not_started", "no game is running");
          result = this.endingOf(this.game);
          break;
        case "preview":
          if (this.game === null) throw new HostError("not_started", "no game is running");
          result = this.previewOf(this.game, call.action);
          break;
      }
      this.env.post({ type: "reply", reqId, ok: true, result });
    } catch (err) {
      const known = err instanceof HostError || err instanceof ReplayError;
      this.env.post({
        type: "reply",
        reqId,
        ok: false,
        error: { code: known ? err.code : "host_error", message: known ? redact(err.message) : describeError(err) },
      });
    }
  }

  // --- Inputs -------------------------------------------------------------------------------

  /** Numbers an input in the order it arrives. Numbers are never reused. */
  private enqueue(kind: string, body: Record<string, unknown>): CoreInput {
    const input: CoreInput = { seq: this.nextSeq++, kind, body };
    this.pending.push(input);
    return input;
  }

  /** Brings the world in line with the reasons to pause. A pause or resume is an input like any other. */
  private reconcilePause(): void {
    if (this.mode !== "running" || this.game === null) return;
    const want = this.reasons.size > 0;
    if (want === this.pauseSent) return;
    this.pauseSent = want;
    this.enqueue(want ? "pause" : "resume", {});
    if (!want) this.clock.reset(this.env.now());
    this.flush();
    this.postStats(true);
  }

  /** Inputs that arrive while the world is paused are applied at once. A paused call leaves the tick alone. */
  private flushIfPaused(): void {
    if (this.mode === "running" && this.corePaused && this.pending.length > 0) this.flush();
  }

  private flush(): void {
    if (this.mode !== "running") return;
    const inputs = this.pending;
    this.pending = [];
    this.stepOnce(inputs);
  }

  // --- The loop -----------------------------------------------------------------------------

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
    if (this.mode !== "running" || this.game === null) return;
    const now = this.env.now();
    let delay = PAUSED_POLL_MS;
    if (this.corePaused) {
      this.clock.reset(now);
      this.flushIfPaused();
    } else {
      const [num, den] = this.rate;
      this.clock.update(now, num, den, this.env.pace * this.speed);
      let done = 0;
      while (done < MAX_BURST && this.clock.due() >= 1 && this.mode === "running" && !this.corePaused) {
        this.clock.consume(1);
        this.flush();
        done++;
        if (this.pauseAtTick !== undefined && this.nextTick >= this.pauseAtTick && this.mode === "running") {
          this.pauseAtTick = undefined;
          this.reasons.add("user");
          this.reconcilePause();
        }
      }
      if (this.corePaused) this.clock.reset(now);
      if (done >= MAX_BURST && this.clock.due() >= 1) {
        delay = 0;
      } else {
        const wait = this.clock.msUntilNext(num, den, this.env.pace * this.speed);
        delay = Math.max(1, Math.min(MAX_IDLE_MS, Math.floor(Number.isFinite(wait) ? wait : MAX_IDLE_MS)));
      }
    }
    if (this.mode !== "running") return;
    if (now - this.lastStatsAt >= STATS_EVERY_MS) this.postStats(true);
    this.schedule(delay);
  };

  /**
   * One call to Game.step with the given inputs. What the core applied is logged only if the call
   * succeeds, so the log only ever holds inputs the core accepted, in the form it normalized them to.
   *
   * A list the core refuses (InputError) leaves the game as it was. If it holds player actions, the
   * actions are dropped with a notice and the call is made again without them: a malformed action
   * must not end the session. Anything else the core throws is fatal.
   */
  private stepOnce(inputs: CoreInput[]): StepOutputs | null {
    const game = this.game;
    if (game === null) return null;
    const started = this.env.now();
    let applied = inputs;
    let out: StepOutputs;
    for (let attempt = 0; ; attempt++) {
      try {
        const json = JSON.stringify(applied);
        const t0 = this.env.now();
        const raw = game.step(json);
        this.pyMs.push(this.env.now() - t0);
        out = parseOutputs(raw);
        break;
      } catch (err) {
        if (attempt === 0 && refusedByCore(err) && applied.some((input) => input.kind === "player")) {
          const dropped = applied.filter((input) => input.kind === "player").length;
          applied = applied.filter((input) => input.kind !== "player");
          const reason = describeError(err).split("\n").slice(-2).join(" ").slice(0, 300);
          this.env.post({
            type: "notice",
            code: "input_refused",
            message: `the core refused ${dropped} player input${dropped === 1 ? "" : "s"}: ${reason}`,
          });
          continue;
        }
        this.fail("core_error", err);
        return null;
      }
    }
    if (out.tick !== this.nextTick) {
      this.fail("tick_mismatch", new Error(`the core applied a call at tick ${out.tick}, expected ${this.nextTick}`));
      return null;
    }
    let normalized: CoreInput[] = [];
    if (applied.length > 0) {
      try {
        normalized = JSON.parse(game.lastInputsJson()) as CoreInput[];
      } catch (err) {
        this.fail("core_error", err);
        return null;
      }
      for (const record of normalized) this.log.push([out.tick, record.seq, record.kind, record.body]);
    }
    this.nextTick = out.advanced ? out.tick + 1 : out.tick;
    if (out.advanced && out.hash !== undefined) this.checkpoints.set(out.tick, out.hash);
    this.corePaused = out.clock.paused;
    this.rate = out.clock.rate;
    this.callCount++;
    // The calls come before the frame, so that the money in the list is there when the frame says what was spent.
    const changed = this.tracker?.observe(out, normalized) ?? [];
    if (changed.length > 0) this.env.post({ type: "model-calls", replace: false, calls: changed });
    this.env.post({
      type: "frame",
      tick: out.tick,
      advanced: out.advanced,
      frame: out.frame,
      events: out.events,
      clock: out.clock,
      hash: out.hash,
    });
    for (const request of out.requests) this.submitRequest(request);
    this.cancelRequests(out.cancels);
    this.hostMs.push(this.env.now() - started);
    return out;
  }

  // --- Model calls --------------------------------------------------------------------------

  /** Starts the call for a request the core emitted. */
  submitRequest(request: ModelRequest): void {
    const id = request.request_id;
    if (this.calls.has(id)) return;
    // A request that came with a call of the core is listed already. Others (a test hook, a request taken up again after a load) are listed now.
    const listed = this.tracker?.track(request, this.nextTick) ?? null;
    if (listed !== null) this.env.post({ type: "model-calls", replace: false, calls: [listed] });
    const refused = this.env.transport.precheck(request);
    if (refused !== null) {
      // No call is made. The answer is queued now and goes to the core with the next call.
      this.models.started++;
      this.recordResult(id, refused);
      return;
    }
    const call = this.env.transport.start(request);
    const active: ActiveCall = { id, call, discard: false };
    this.calls.set(id, active);
    this.models.started++;
    this.models.inflight = this.calls.size;
    call.done.then(
      (outcome) => this.finishCall(active, outcome),
      (err) => this.fail("host_error", err),
    );
  }

  /**
   * Aborts the calls the core cancelled. A call that is still running ends as "cancelled" and is
   * reported so. A call that had already finished is not touched: its real result goes to the core,
   * which voids it and still books its tokens.
   */
  cancelRequests(ids: readonly string[]): void {
    for (const id of ids) {
      const active = this.calls.get(id);
      if (active !== undefined) active.call.abort("cancel");
      else if (!this.pending.some((p) => p.kind === "model_result" && p.body.request_id === id)) {
        this.models.cancelUnknown++;
      }
    }
  }

  private resultBody(
    id: string,
    status: ModelResultBody["status"],
    text: string,
    usage: Usage | null,
    latency: number,
  ): Record<string, unknown> {
    const body: ModelResultBody = {
      request_id: id,
      status,
      text,
      usage: usage === null ? null : { ...usage },
      latency_ms: latency,
    };
    return { ...body };
  }

  private finishCall(active: ActiveCall, outcome: ModelOutcome): void {
    if (this.calls.get(active.id) !== active) return;
    this.calls.delete(active.id);
    this.models.inflight = this.calls.size;
    if (active.discard) {
      this.models.discarded++;
      return;
    }
    this.recordResult(active.id, outcome);
    this.flushIfPaused();
    this.postStats(true);
  }

  /** Counts a finished call and queues its result as an input. */
  private recordResult(id: string, outcome: ModelOutcome): void {
    this.models[outcome.status]++;
    this.lastModel = {
      request_id: id,
      status: outcome.status,
      code: outcome.code,
      latency_ms: outcome.latency_ms,
      input_tokens: outcome.usage?.input_tokens ?? 0,
      output_tokens: outcome.usage?.output_tokens ?? 0,
    };
    this.enqueue("model_result", this.resultBody(id, outcome.status, outcome.text, outcome.usage, outcome.latency_ms));
  }

  /** Ends every call without reporting it: the world the calls belonged to is gone. */
  private abortAll(): void {
    for (const active of this.calls.values()) {
      active.discard = true;
      active.call.abort("discard");
    }
    this.calls.clear();
    this.models.inflight = 0;
  }

  // --- Saves --------------------------------------------------------------------------------

  /** The replay of the session so far. */
  buildReplay(): Replay {
    const game = this.game;
    const header = this.header;
    if (game === null || header === null) throw new HostError("not_started", "no game is running");
    return {
      header,
      base: null,
      records: this.log.map(([tick, seq, kind, body]): LogRecord => [tick, seq, kind, body]),
      hashes: sortedHashes(this.checkpoints),
      snapshots: [],
      end_tick: this.nextTick,
      host: { name: "browser", version: HOST_VERSION, replayFormat: REPLAY_FORMAT },
      final: { tick: this.nextTick, hash: this.mode === "failed" ? "" : game.hash() },
    };
  }

  private async saveGame(name?: string, page?: PageNotes): Promise<SaveMeta> {
    if (this.mode === "failed") throw new HostError("failed", "the session stopped on an error and cannot be saved");
    if (this.mode === "loading") throw new HostError("busy", "a load is running");
    const replay = this.buildReplay();
    const label = name === undefined ? "" : name.trim();
    const notes = keptNotes(page);
    return this.env.saves.put(
      { name: label, savedAt: this.env.wallClockIso(), tick: replay.final.tick, hash: replay.final.hash, ...(notes === undefined ? {} : { page: notes }) },
      replay,
    );
  }

  /**
   * Rebuilds a saved session on the side and swaps it in only when every hash matched, so a bad
   * save changes nothing. The world is held (paused) afterwards. Requests that were still open at
   * the end of the saved session are sent again, or reported cancelled if the core had cancelled them.
   */
  private async loadGame(id: number): Promise<LoadInfo> {
    if (this.mode === "loading") throw new HostError("busy", "a load is already running");
    const record = await this.env.saves.get(id);
    if (record === undefined) throw new HostError("not_found", `there is no save ${id}`);
    const replay = validateReplay(record.replay);
    if (replay.header.format !== this.env.core.format) {
      throw new ReplayError(
        "unsupported_format",
        `the save was written by core format ${replay.header.format}, this one is ${this.env.core.format}`,
      );
    }
    const previous = this.mode;
    this.mode = "loading";
    this.cancelTimer();
    let rebuilt: Awaited<ReturnType<typeof runReplay>>;
    try {
      rebuilt = await runReplay((spec) => this.env.newGame(spec), replay, {
        yieldNow: () => this.env.yieldNow(),
      });
    } catch (err) {
      this.mode = previous;
      if (previous === "running") {
        this.clock.reset(this.env.now());
        // A pause or resume that arrived during the rebuild is still owed to the core.
        this.reconcilePause();
        this.schedule(0);
      }
      if (!(err instanceof ReplayError)) {
        // The core itself refused something while the save was replayed.
        throw new ReplayError("replay_failed", `the save could not be replayed: ${describeError(err).split("\n").slice(-2).join(" ")}`);
      }
      if (err.code === "hash_mismatch") {
        const saved = `${replay.header.core_version} / ${String(replay.header.content_hash ?? "?").slice(0, 8)}`;
        const here = `${this.env.core.version} / ${String(this.header?.content_hash ?? "?").slice(0, 8)}`;
        if (saved !== here) {
          throw new ReplayError(err.code, `${err.message} (saved by core ${saved}, running ${here})`);
        }
      }
      throw err;
    }

    this.abortAll();
    const old = this.game;
    this.game = rebuilt.game;
    old?.destroy();
    this.header = JSON.parse(rebuilt.game.headerJson()) as CoreHeader;
    this.tracker = this.newTracker(this.header);
    this.nextTick = rebuilt.nextTick;
    this.corePaused = rebuilt.corePaused;
    this.rate = rebuilt.rate;
    this.log = replay.records.map(([tick, seq, kind, body]): LogRecord => [tick, seq, kind, body]);
    this.checkpoints = new Map(replay.hashes);
    const lastRecord = this.log[this.log.length - 1];
    this.nextSeq = lastRecord === undefined ? 0 : lastRecord[1] + 1;
    this.pending = [];
    this.pauseSent = rebuilt.corePaused;
    this.callCount = 0;
    this.lastModel = null;
    this.reasons.add("user");
    this.mode = "running";
    this.clock.reset(this.env.now());

    const info: LoadInfo = {
      id,
      name: record.meta.name,
      tick: rebuilt.nextTick,
      hash: rebuilt.hash,
      savedHash: replay.final.hash,
      match: rebuilt.hash === replay.final.hash,
      hashesChecked: rebuilt.hashesChecked,
      reissued: rebuilt.openRequests.length,
      cancelledOpen: rebuilt.cancelledOpen.length,
      ...(record.meta.page === undefined ? {} : { page: record.meta.page }),
    };
    this.env.post({ type: "reset", seed: this.header.seed, scenario: this.header.scenario });
    this.postScene(rebuilt.game);
    this.postEnding(rebuilt.game);
    this.env.post({ type: "model-calls", replace: true, calls: [] });
    const last = rebuilt.lastOutputs;
    if (last !== null) {
      this.env.post({
        type: "frame",
        tick: last.tick,
        advanced: last.advanced,
        frame: last.frame,
        events: [],
        clock: last.clock,
        hash: last.hash,
      });
    }
    this.env.post({ type: "loaded", info });
    this.reconcilePause();
    for (const requestId of rebuilt.cancelledOpen) {
      this.enqueue("model_result", this.resultBody(requestId, "cancelled", "", null, 0));
    }
    this.flushIfPaused();
    for (const request of rebuilt.openRequests) this.submitRequest(request);
    this.postStats(true);
    this.schedule(0);
    return info;
  }

  // --- Failure and statistics ---------------------------------------------------------------

  private fail(code: string, err: unknown): void {
    const message = describeError(err);
    this.env.log("error", `${code}: ${message}`);
    this.mode = "failed";
    this.cancelTimer();
    this.abortAll();
    this.env.post({ type: "fatal", code, message });
    this.postStats(true);
  }

  stats(): HostStats {
    return {
      nextTick: this.nextTick,
      calls: this.callCount,
      pyMeanMs: this.pyMs.mean(),
      pyP95Ms: this.pyMs.p95(),
      pyMaxMs: this.pyMs.max(),
      hostMeanMs: this.hostMs.mean(),
      hostMaxMs: this.hostMs.max(),
      droppedMs: Math.round(this.clock.dropped),
      inputsLogged: this.log.length,
      pending: this.pending.length,
      paused: this.corePaused,
      reasons: [...this.reasons],
      rate: this.rate,
      models: { ...this.models },
      lastModel: this.lastModel,
    };
  }

  private postStats(force = false): void {
    const now = this.env.now();
    if (!force && now - this.lastStatsAt < STATS_EVERY_MS) return;
    this.lastStatsAt = now;
    this.env.post({ type: "stats", stats: this.stats() });
  }

  /** For the test hooks: a few internals that the stats do not carry. */
  debugState(): { mode: Mode; nextTick: number; pending: number; calls: number; corePaused: boolean } {
    return {
      mode: this.mode,
      nextTick: this.nextTick,
      pending: this.pending.length,
      calls: this.calls.size,
      corePaused: this.corePaused,
    };
  }
}
