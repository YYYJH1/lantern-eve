import { createHash } from "node:crypto";
import type { CoreInput, GameLike } from "../../src/shared/protocol.ts";

/**
 * A Game that follows the host contract in core/lantern_core/api.py and nothing else: a call
 * checks its whole list first and leaves the game alone if it refuses it (InputError), applies the
 * inputs in order, simulates unless the world is paused, and reports normalized inputs.
 */
export interface FakeOptions {
  /** Emit a model request every N simulated ticks, with the id `r<tick>`. 0 for none. */
  requestEvery?: number;
  /** Cancel these request ids at these ticks: { 8: "r3" }. */
  cancelAt?: Record<number, string>;
  /** The rate the clock reports. */
  rate?: [number, number];
  /** Throw something that is not an InputError from step at this tick. */
  throwAt?: number;
  /** Report a tick that is off by one from this tick on. */
  skewFrom?: number;
  /** The whole ending the game reports from `endingJson`. Null, as before the last night, when absent. */
  ending?: Record<string, unknown> | null;
  /** Fields added to every request the game makes: `category`, `hold`, `reserve` and so on. */
  requestFields?: Record<string, unknown>;
  /** The config its header reports, such as the prices of the tiers. */
  config?: Record<string, number>;
  /** A game that has no previews, as the demo world: `previewJson` answers `null`. */
  noPreviews?: boolean;
}

interface FakeState {
  tick: number;
  paused: boolean;
  nextSeq: number;
  actions: string[];
  results: string[];
  open: string[];
  usage: number;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function inputError(message: string): Error {
  return Object.assign(new Error(`lantern_core.inputs.InputError: ${message}`), { type: "InputError" });
}

export class FakeGame implements GameLike {
  state: FakeState = { tick: 0, paused: false, nextSeq: 0, actions: [], results: [], open: [], usage: 0 };
  destroyed = false;
  calls: string[] = [];
  /** The actions `previewJson` was asked about. */
  previews: string[] = [];
  lastApplied: CoreInput[] = [];

  constructor(
    readonly seed: number,
    readonly scenario: string,
    readonly options: FakeOptions = {},
  ) {}

  get tick(): number {
    return this.state.tick;
  }

  headerJson(): string {
    return JSON.stringify({ format: 1, core_version: "fake-1", content_hash: "fakehash", scenario: this.scenario, config: this.options.config ?? {}, seed: this.seed });
  }

  lastInputsJson(): string {
    return JSON.stringify(this.lastApplied);
  }

  sceneJson(): string {
    return JSON.stringify({ scenario: this.scenario });
  }

  endingJson(): string {
    return JSON.stringify(this.options.ending ?? null);
  }

  /**
   * What `Game.preview_json` does in miniature: it reads the action, answers with the version of the state (one more than the
   * tick), the cost, and what it asked, and changes nothing. An action that is not an object with a verb is an InputError.
   */
  previewJson(actionJson: string): string {
    this.previews.push(actionJson);
    const action = JSON.parse(actionJson) as unknown;
    if (action === null || typeof action !== "object" || Array.isArray(action) || typeof (action as Record<string, unknown>).verb !== "string") {
      throw inputError("preview: the action must be an object with a verb");
    }
    if (this.options.noPreviews === true) return "null";
    const verb = String((action as Record<string, unknown>).verb);
    if (verb === "dance") throw inputError("preview: verb must be one of ask, ask_source, tell, entrust, promise");
    return JSON.stringify({ version: this.state.tick + 1, cost: 20, asks: { zh: "一件事", en: "something" }, gives: null, blockers: [], odds: "mid", reasons: [] });
  }

  /** The whole state, which `restore` continues from. */
  snapshotJson(): string {
    return JSON.stringify({ seed: this.seed, scenario: this.scenario, state: this.state });
  }

  static restore(text: string, options: FakeOptions = {}): FakeGame {
    const data = JSON.parse(text) as { seed: number; scenario: string; state: FakeState };
    const game = new FakeGame(data.seed, data.scenario, options);
    game.state = data.state;
    return game;
  }

  /** What the core's own validation does, in miniature. */
  private normalize(records: unknown): CoreInput[] {
    if (!Array.isArray(records)) throw inputError("inputs must be a JSON list");
    let expected = this.state.nextSeq;
    return records.map((raw: Record<string, unknown>) => {
      const seq = raw.seq;
      if (typeof seq !== "number" || !Number.isInteger(seq) || seq < expected) throw inputError(`seq ${String(seq)} must be at least ${expected}`);
      expected = seq + 1;
      const kind = raw.kind;
      if (kind !== "pause" && kind !== "resume" && kind !== "player" && kind !== "model_result") throw inputError(`unknown kind ${String(kind)}`);
      const body = (raw.body ?? {}) as Record<string, unknown>;
      if (kind === "player") {
        if (typeof body.action_id !== "string" || body.type === "bad") throw inputError("bad player action");
        return { seq, kind, body: { action_id: body.action_id, ...(body.type === undefined ? {} : { type: body.type }) } };
      }
      if (kind === "model_result") {
        const usage = body.usage as { input_tokens: number; output_tokens: number } | null | undefined;
        if (typeof body.text === "string" && /[\ud800-\udfff]/.test(body.text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ""))) {
          throw inputError("text holds a lone surrogate");
        }
        return {
          seq,
          kind,
          body: {
            request_id: String(body.request_id),
            status: String(body.status),
            text: typeof body.text === "string" ? body.text : "",
            usage: usage === undefined ? null : usage,
            latency_ms: typeof body.latency_ms === "number" ? body.latency_ms : 0,
          },
        };
      }
      return { seq, kind, body: {} };
    });
  }

  step(inputsJson: string): string {
    this.calls.push(inputsJson);
    const applied = this.normalize(JSON.parse(inputsJson));
    const s = this.state;
    for (const rec of applied) {
      s.nextSeq = rec.seq + 1;
      if (rec.kind === "pause") s.paused = true;
      else if (rec.kind === "resume") s.paused = false;
      else if (rec.kind === "player") {
        const id = String(rec.body.action_id);
        if (!s.actions.includes(id)) s.actions.push(id);
      } else if (rec.kind === "model_result") {
        const id = String(rec.body.request_id);
        s.results.push(`${id}:${String(rec.body.status)}`);
        s.open = s.open.filter((o) => o !== id);
        const usage = rec.body.usage as { input_tokens: number; output_tokens: number } | null;
        s.usage += usage === null ? 100 : usage.input_tokens + usage.output_tokens;
      }
    }
    this.lastApplied = applied;
    const tick = s.tick;
    if (this.options.throwAt === tick) throw new Error("the fake world broke");
    const advanced = !s.paused;
    const requests: unknown[] = [];
    const cancels: string[] = [];
    if (advanced) {
      s.tick = tick + 1;
      const every = this.options.requestEvery ?? 0;
      if (every > 0 && tick % every === 0 && tick > 0) {
        const id = `r${tick}`;
        s.open.push(id);
        requests.push({
          request_id: id,
          tier: "cheap",
          messages: [{ role: "user", content: `hi ${tick}` }],
          max_tokens: 16,
          secret: "core-private",
          issued_tick: tick,
          ...this.options.requestFields,
        });
      }
      const cancel = this.options.cancelAt?.[tick];
      if (cancel !== undefined) cancels.push(cancel);
    }
    const reported = this.options.skewFrom !== undefined && tick >= this.options.skewFrom ? tick + 1 : tick;
    const out: Record<string, unknown> = {
      tick: reported,
      advanced,
      frame: { npcs: [{ id: "n0", x: tick % 8, y: 1 }] },
      events: advanced && tick % 50 === 0 ? [{ kind: "tock", tick }] : [],
      requests,
      cancels,
      clock: { paused: s.paused, rate: this.options.rate ?? [1, 1] },
    };
    if (advanced && tick % 100 === 0) out.hash = this.hash();
    return JSON.stringify(out);
  }

  hash(): string {
    return createHash("sha256").update(canonical(this.state)).digest("hex");
  }

  destroy(): void {
    this.destroyed = true;
  }
}
