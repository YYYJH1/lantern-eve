import { parseOutputs } from "./outputs.ts";
import type {
  CoreInput,
  GameLike,
  GameSpec,
  HashRecord,
  LogRecord,
  ModelRequest,
  Replay,
  StepOutputs,
} from "./protocol.ts";
import { REPLAY_FORMAT } from "./protocol.ts";

export class ReplayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

/** The rebuilt world disagrees with a recorded hash. */
export class ReplayMismatch extends ReplayError {
  constructor(
    readonly tick: number,
    readonly expected: string,
    readonly actual: string,
    readonly where: "checkpoint" | "final",
  ) {
    super(
      "hash_mismatch",
      `${where} hash differs at tick ${tick}: recorded ${expected.slice(0, 12)}, rebuilt ${actual.slice(0, 12)}`,
    );
    this.name = "ReplayMismatch";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTick(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Checks the shape of a replay that came from outside (a save, a file) and returns it typed. A
 * recording written by lantern_core.replay.Recorder passes too: the host's own keys are optional.
 */
export function validateReplay(value: unknown): Replay {
  const bad = (what: string): never => {
    throw new ReplayError("bad_replay", `replay is malformed: ${what}`);
  };
  if (!isRecord(value)) return bad("not an object");
  const { header, records, hashes, base } = value;
  if (!isRecord(header)) return bad("no header");
  if (!Number.isSafeInteger(header.format)) bad("header.format");
  if (!Number.isSafeInteger(header.seed)) bad("header.seed");
  if (typeof header.scenario !== "string") bad("header.scenario");
  if (header.config !== undefined && header.config !== null && !isRecord(header.config)) bad("header.config");
  if (base !== null && base !== undefined) {
    throw new ReplayError("unsupported_format", "a recording that starts from a snapshot is not supported");
  }
  if (isRecord(value.host) && value.host.replayFormat !== REPLAY_FORMAT) {
    throw new ReplayError("unsupported_format", `replay format ${String(value.host.replayFormat)} is not supported`);
  }
  if (!Array.isArray(records)) return bad("records");
  records.forEach((rec: unknown, i: number) => {
    if (!Array.isArray(rec) || rec.length !== 4 || !isTick(rec[0]) || !isTick(rec[1]) || typeof rec[2] !== "string" || !isRecord(rec[3])) {
      bad(`records[${i}]`);
    }
  });
  if (!Array.isArray(hashes)) return bad("hashes");
  hashes.forEach((h: unknown, i: number) => {
    if (!Array.isArray(h) || h.length !== 2 || !isTick(h[0]) || typeof h[1] !== "string") bad(`hashes[${i}]`);
  });
  if (!isTick(value.end_tick)) return bad("end_tick");
  if (value.final !== undefined) {
    const final = value.final;
    if (!isRecord(final) || !isTick(final.tick) || typeof final.hash !== "string") return bad("final");
    if (final.tick !== value.end_tick) return bad("final.tick differs from end_tick");
  }
  // A recording from the server has no `final`: its end hash is simply not checked.
  return {
    header: header as unknown as Replay["header"],
    base: null,
    records: records as LogRecord[],
    hashes: hashes as HashRecord[],
    snapshots: Array.isArray(value.snapshots) ? value.snapshots : [],
    end_tick: value.end_tick,
    host: isRecord(value.host) ? (value.host as Replay["host"]) : { name: "unknown", version: "", replayFormat: REPLAY_FORMAT },
    final: isRecord(value.final) ? (value.final as Replay["final"]) : { tick: value.end_tick, hash: "" },
  };
}

/** The arguments of the Game constructor, as a header holds them. */
export function specOf(replay: Replay): GameSpec {
  const config = replay.header.config;
  return {
    seed: replay.header.seed,
    scenario: replay.header.scenario,
    config: isRecord(config) ? (config as Record<string, number | string>) : null,
  };
}

/**
 * Groups a log by tick, in order. Each group is what one call applies. Inputs that were applied
 * by several calls at the same tick (calls while paused leave the tick where it is) end up in one
 * group, which is what the core promises to treat the same.
 */
export function groupByTick(records: readonly LogRecord[]): Array<{ tick: number; inputs: CoreInput[] }> {
  const groups: Array<{ tick: number; inputs: CoreInput[] }> = [];
  let lastSeq = -1;
  let lastTick = 0;
  for (const [tick, seq, kind, body] of records) {
    if (!(seq > lastSeq)) {
      throw new ReplayError("bad_log", `input seq ${seq} does not increase after ${lastSeq}`);
    }
    if (tick < lastTick) {
      throw new ReplayError("bad_log", `input seq ${seq} is at tick ${tick}, before tick ${lastTick}`);
    }
    lastSeq = seq;
    lastTick = tick;
    const last = groups[groups.length - 1];
    const input: CoreInput = { seq, kind, body };
    if (last !== undefined && last.tick === tick) last.inputs.push(input);
    else groups.push({ tick, inputs: [input] });
  }
  return groups;
}

export interface ReplayRunResult {
  game: GameLike;
  /** The tick the next call applies at. Equals replay.end_tick. */
  nextTick: number;
  /** Hash of the rebuilt state, equal to replay.final.hash when that is not empty. */
  hash: string;
  lastOutputs: StepOutputs | null;
  corePaused: boolean;
  rate: [number, number];
  hashesChecked: number;
  /** Requests the core emitted that no result and no cancel had settled by the end. */
  openRequests: ModelRequest[];
  /** Requests whose cancel the core had asked for but whose cancelled result was not logged. */
  cancelledOpen: string[];
}

export interface ReplayOptions {
  /** Called every `yieldEvery` calls so a long replay does not starve the worker's event loop. */
  yieldNow?: () => Promise<void>;
  yieldEvery?: number;
  onProgress?: (tick: number, endTick: number) => void;
}

/**
 * Rebuilds the world of a replay: one call per tick, with the inputs recorded at that tick. The
 * model is never called. Every hash the log holds is compared on the way, and the hash at the end
 * is compared last. Throws a ReplayError on any disagreement and leaves no game behind.
 */
export async function runReplay(
  newGame: (spec: GameSpec) => GameLike,
  replay: Replay,
  options: ReplayOptions = {},
): Promise<ReplayRunResult> {
  const groups = groupByTick(replay.records);
  const expected = new Map<number, string>();
  for (const [tick, hash] of replay.hashes) expected.set(tick, hash);
  const checked = new Set<number>();
  const open = new Map<string, ModelRequest>();
  const cancelRequested = new Set<string>();
  const yieldEvery = options.yieldEvery ?? 250;
  const endTick = replay.end_tick;

  const game = newGame(specOf(replay));
  try {
    let t = 0;
    let calls = 0;
    let last: StepOutputs | null = null;

    const call = async (inputs: CoreInput[]): Promise<void> => {
      const out = parseOutputs(game.step(JSON.stringify(inputs)));
      if (out.tick !== t) {
        throw new ReplayError("tick_mismatch", `the core applied a call at tick ${out.tick}, expected ${t}`);
      }
      for (const input of inputs) {
        if (input.kind === "model_result" && typeof input.body.request_id === "string") {
          open.delete(input.body.request_id);
        }
      }
      for (const request of out.requests) open.set(request.request_id, request);
      for (const id of out.cancels) cancelRequested.add(id);
      if (out.advanced) {
        if (out.hash !== undefined) {
          const want = expected.get(out.tick);
          if (want !== undefined) {
            if (want !== out.hash) throw new ReplayMismatch(out.tick, want, out.hash, "checkpoint");
            checked.add(out.tick);
          }
        }
        t = out.tick + 1;
      }
      last = out;
      calls++;
      if (options.yieldNow !== undefined && calls % yieldEvery === 0) {
        options.onProgress?.(t, endTick);
        await options.yieldNow();
      }
    };

    const advanceTo = async (target: number): Promise<void> => {
      while (t < target) {
        const before = t;
        await call([]);
        if (t === before) {
          throw new ReplayError("bad_log", `the world is paused at tick ${t} but the log runs on to tick ${target}`);
        }
      }
    };

    for (const group of groups) {
      if (group.tick < t) {
        throw new ReplayError("bad_log", `inputs at tick ${group.tick} come after the world reached tick ${t}`);
      }
      await advanceTo(group.tick);
      await call(group.inputs);
    }
    await advanceTo(endTick);

    if (t !== endTick) {
      throw new ReplayError("bad_log", `the log ends at tick ${t}, the replay says ${endTick}`);
    }
    for (const tick of expected.keys()) {
      if (tick < endTick && !checked.has(tick)) {
        throw new ReplayMismatch(tick, expected.get(tick) ?? "", "(no hash)", "checkpoint");
      }
    }
    const hash = game.hash();
    if (replay.final.hash !== "" && hash !== replay.final.hash) {
      throw new ReplayMismatch(endTick, replay.final.hash, hash, "final");
    }
    const lastOutputs = last as StepOutputs | null;
    const cancelledOpen: string[] = [];
    const openRequests: ModelRequest[] = [];
    for (const [id, request] of open) {
      if (cancelRequested.has(id)) cancelledOpen.push(id);
      else openRequests.push(request);
    }
    return {
      game,
      nextTick: t,
      hash,
      lastOutputs,
      corePaused: lastOutputs?.clock.paused ?? false,
      rate: lastOutputs?.clock.rate ?? [1, 1],
      hashesChecked: checked.size,
      openRequests,
      cancelledOpen,
    };
  } catch (err) {
    try {
      game.destroy();
    } catch {
      // Nothing more can be done for a game that did not even destroy cleanly.
    }
    throw err;
  }
}

export function sortedHashes(checkpoints: ReadonlyMap<number, string>): HashRecord[] {
  return [...checkpoints.entries()].sort((a, b) => a[0] - b[0]).map(([tick, hash]) => [tick, hash]);
}
