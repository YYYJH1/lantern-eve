import type { GameSpec, HostToPage, ModelRequest, Replay, SaveMeta } from "../../src/shared/protocol.ts";
import { HostRuntime, type RuntimeEnv, type SaveStore } from "../../src/shared/runtime.ts";
import type { ModelCall, ModelOutcome, StartOptions, Transport, TransportConfig } from "../../src/shared/transport.ts";
import { FakeGame, type FakeOptions } from "./fake-game.ts";

export class MemorySaveStore implements SaveStore {
  private nextId = 1;
  readonly rows = new Map<number, { meta: SaveMeta; replay: unknown }>();

  async put(meta: Omit<SaveMeta, "id">, replay: Replay): Promise<SaveMeta> {
    const full = { id: this.nextId++, ...meta };
    this.rows.set(full.id, { meta: full, replay: JSON.parse(JSON.stringify(replay)) });
    return full;
  }

  async list(): Promise<SaveMeta[]> {
    return [...this.rows.values()].map((row) => row.meta).sort((a, b) => b.id - a.id);
  }

  async get(id: number): Promise<{ meta: SaveMeta; replay: unknown } | undefined> {
    const row = this.rows.get(id);
    return row === undefined ? undefined : { meta: row.meta, replay: JSON.parse(JSON.stringify(row.replay)) };
  }

  async remove(id: number): Promise<void> {
    this.rows.delete(id);
  }
}

export interface FakeCall {
  request: ModelRequest;
  options: StartOptions | undefined;
  abortReason: "cancel" | "discard" | null;
  settle(outcome: Partial<ModelOutcome>): void;
}

/** A transport whose calls end when the test says so, or when they are aborted. */
export class FakeTransport implements Transport {
  readonly configs: TransportConfig[] = [];
  readonly calls = new Map<string, FakeCall>();
  readonly started: string[] = [];
  /** What precheck answers. Null means the call is made. */
  refuse: ModelOutcome | null = null;
  /** The model the calls are said to go to. */
  model: string | null = null;

  configure(config: TransportConfig): void {
    this.configs.push(config);
  }

  precheck(): ModelOutcome | null {
    return this.refuse;
  }

  modelOf(): string | null {
    return this.model;
  }

  start(request: ModelRequest, options?: StartOptions): ModelCall {
    let resolve!: (outcome: ModelOutcome) => void;
    const done = new Promise<ModelOutcome>((r) => {
      resolve = r;
    });
    const base: ModelOutcome = {
      status: "ok",
      text: "hello",
      usage: { input_tokens: 3, output_tokens: 2 },
      latency_ms: 42,
      usageReported: true,
    };
    const call: FakeCall = {
      request,
      options,
      abortReason: null,
      settle: (outcome) => resolve({ ...base, ...outcome }),
    };
    this.calls.set(request.request_id, call);
    this.started.push(request.request_id);
    return {
      id: request.request_id,
      abort: (reason) => {
        if (call.abortReason !== null) return;
        call.abortReason = reason;
        resolve({ ...base, status: "cancelled", text: "", usage: null, usageReported: false });
      },
      done,
    };
  }
}

interface Timer {
  id: number;
  at: number;
  fn: () => void;
}

/** A runtime on a clock that only moves when the test moves it. */
export class VirtualHost {
  nowMs = 1000;
  private timers: Timer[] = [];
  private nextTimer = 1;
  readonly posted: HostToPage[] = [];
  readonly games: FakeGame[] = [];
  /** What each game was asked to be built from. */
  readonly specs: GameSpec[] = [];
  readonly transport = new FakeTransport();
  readonly saves = new MemorySaveStore();
  readonly logs: string[] = [];
  readonly runtime: HostRuntime;
  gameOptions: FakeOptions;

  constructor(gameOptions: FakeOptions = {}, pace = 1, gameConfig?: Record<string, number>) {
    this.gameOptions = gameOptions;
    const env: RuntimeEnv = {
      now: () => this.nowMs,
      wallClockIso: () => "2026-11-01T00:00:00.000Z",
      setTimeout: (fn, ms) => {
        const id = this.nextTimer++;
        this.timers.push({ id, at: this.nowMs + Math.max(0, ms), fn });
        return id;
      },
      clearTimeout: (handle) => {
        this.timers = this.timers.filter((t) => t.id !== handle);
      },
      yieldNow: async () => undefined,
      post: (message) => this.posted.push(message),
      newGame: (spec) => {
        this.specs.push(spec);
        const game = new FakeGame(spec.seed, spec.scenario, this.gameOptions);
        this.games.push(game);
        return game;
      },
      // The core's one named game, as `lantern_core.api.preset` gives it: texts in the config as well as numbers, and the rules at another
      // seed and with another story true where it is asked for those.
      preset: (name, options) => {
        if (name !== "slice") throw new Error(`unknown bridge preset '${name}'`);
        const variant = options?.variant ?? "v_boat";
        if (!["v_boat", "v_flood", "v_drunk"].includes(variant)) throw new Error(`bridge preset variant must be one of the script's, got '${variant}'`);
        const seed = options?.seed ?? 492;
        if (!Number.isSafeInteger(seed) || seed < 0) throw new Error(`bridge preset seed must be an int, got ${seed}`);
        return { seed, scenario: "bridge", config: { variant, opening: "op_li_er_hearsay", weather_heavy: 0 } };
      },
      core: { version: "fake-1", format: 1 },
      transport: this.transport,
      saves: this.saves,
      pace,
      allowBaseUrl: false,
      gameConfig,
      log: (level, message) => this.logs.push(`${level}: ${message}`),
    };
    this.runtime = new HostRuntime(env);
  }

  /** Moves the clock forward, running every timer that falls due on the way, in order. */
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

  /** The thread was blocked for `ms`: time passes, then the timers that fell due run. */
  stall(ms: number): void {
    this.nowMs += ms;
    this.advance(0);
  }

  get game(): FakeGame {
    const game = this.games[this.games.length - 1];
    if (game === undefined) throw new Error("no game was created");
    return game;
  }

  frames(): Extract<HostToPage, { type: "frame" }>[] {
    return this.posted.filter((m): m is Extract<HostToPage, { type: "frame" }> => m.type === "frame");
  }

  /** Sends a call message and returns the reply once it has been posted. */
  async call(call: Parameters<HostRuntime["handle"]>[0] & { type: "call" }): Promise<Extract<HostToPage, { type: "reply" }>> {
    this.runtime.handle(call);
    for (let i = 0; i < 400; i++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      const reply = this.posted.find((m): m is Extract<HostToPage, { type: "reply" }> => m.type === "reply" && m.reqId === call.reqId);
      if (reply !== undefined) return reply;
    }
    throw new Error(`no reply to call ${call.reqId}`);
  }
}
