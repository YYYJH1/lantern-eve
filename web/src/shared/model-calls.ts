import type { CoreInput, ModelCallRecord, ModelRequest, ModelStatus, StepOutputs, Usage } from "./protocol.ts";

/** How many calls the tracker, and the page's list, keep. The oldest go first. */
export const MAX_CALLS = 200;

/** The config keys that price each cloud tier, in micro-yuan per million tokens: (input, output). */
const PRICE_KEYS: Readonly<Record<string, readonly [string, string]>> = {
  cheap: ["price_cheap_in", "price_cheap_out"],
  strong: ["price_strong_in", "price_strong_out"],
};
const MICRO = 1_000_000n;
const STATUSES: readonly ModelStatus[] = ["ok", "timeout", "cancelled", "error"];

/**
 * What a call on `tier` that used `tokens` costs, in micro-yuan, worked out the way
 * core/lantern_core/world/bridge/pricing.py does it: each of the two parts is rounded up to a whole
 * micro-yuan, and a tier without a price (the local one) is free. Null where the game has no prices
 * at all, as the demo world has none.
 */
export function callCost(config: Readonly<Record<string, unknown>>, tier: string, tokens: Usage): number | null {
  if (!Object.hasOwn(PRICE_KEYS, tier)) return 0;
  const keys = PRICE_KEYS[tier] as readonly [string, string];
  const priceIn = config[keys[0]];
  const priceOut = config[keys[1]];
  if (!Number.isSafeInteger(priceIn) || !Number.isSafeInteger(priceOut)) return null;
  const part = (count: number, price: number): bigint => (BigInt(count) * BigInt(price) + MICRO - 1n) / MICRO;
  return Number(part(tokens.input_tokens, priceIn as number) + part(tokens.output_tokens, priceOut as number));
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function readUsage(value: unknown): Usage | null {
  if (!isRecord(value)) return null;
  return { input_tokens: count(value.input_tokens), output_tokens: count(value.output_tokens) };
}

interface Moved {
  asked: string;
  reason: string | null;
  tier: string;
  category: string | null;
}

/**
 * The model calls of a game as the page lists them: one record for each request the core made,
 * from the moment it goes out to the moment the core books its result.
 *
 * It works from what the core reports, so that a replay of the game lists the same calls: the
 * `requests` of a call (the tier the request goes out on, its category, the money held for it),
 * the `downgrade` events (the tier it was asked on and why it moved, and the requests the gate
 * turned into script lines, which never go out), the `model_result` inputs the call applied (the
 * outcome, the latency, the tokens) and the `void` events (an answer the core threw away).
 *
 * The cost is what the core booked when it settled the request: the tokens the result reports, or
 * the whole reservation where they are unknown, at the prices of the game's config. A result for a
 * request that is not in flight any more (an answer that comes after a timeout) is booked by
 * nobody, and the record only says it was late. The sum of `cost` over every call is therefore the
 * `spent` of the budget in the frame.
 */
export class CallTracker {
  private readonly records = new Map<string, ModelCallRecord>();
  private readonly reserves = new Map<string, Usage>();

  constructor(
    private readonly config: Readonly<Record<string, unknown>>,
    private readonly modelOf: (request: ModelRequest) => string | null = () => null,
  ) {}

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** The records, oldest first, as copies. */
  snapshot(): ModelCallRecord[] {
    return [...this.records.values()].map(copy);
  }

  /**
   * Takes in one call of the core: the results it applied settle the requests they answer, the
   * requests the gate turned away are listed, and the requests that went out are opened. Returns
   * the records that changed, as copies.
   */
  observe(out: StepOutputs, applied: readonly CoreInput[]): ModelCallRecord[] {
    const changed = new Map<string, ModelCallRecord>();
    const moved = new Map<string, Moved>();
    const voids = new Map<string, string>();
    for (const event of out.events) {
      const id = event.request_id;
      if (typeof id !== "string") continue;
      if (event.kind === "downgrade") {
        moved.set(id, {
          asked: typeof event.asked === "string" ? event.asked : String(event.tier),
          reason: typeof event.reason === "string" ? event.reason : null,
          tier: String(event.tier),
          category: typeof event.category === "string" ? event.category : null,
        });
      } else if (event.kind === "void" && typeof event.reason === "string") {
        voids.set(id, event.reason);
      }
    }

    for (const input of applied) {
      if (input.kind !== "model_result" || typeof input.body.request_id !== "string") continue;
      const id = input.body.request_id;
      const record = this.records.get(id);
      if (record === undefined) continue;
      if (record.status !== "pending" || voids.get(id) === "unknown_request") {
        if (!record.late) {
          record.late = true;
          changed.set(id, record);
        }
        continue;
      }
      this.settle(record, input.body, out.tick);
      const why = voids.get(id);
      if (why === "cancelled" || why === "invalid") record.voided = why;
      changed.set(id, record);
    }

    for (const [id, move] of moved) {
      if (move.tier !== "template" || this.records.has(id)) continue;
      const record: ModelCallRecord = {
        id,
        tick: out.tick,
        category: move.category,
        asked: move.asked,
        tier: "template",
        reason: move.reason,
        model: null,
        hold: 0,
        status: "template",
        code: null,
        latency_ms: null,
        usage: null,
        cost: 0,
        settled: out.tick,
        late: false,
        voided: voids.get(id) === "invalid" ? "invalid" : null,
      };
      this.put(record);
      changed.set(id, record);
    }

    for (const request of out.requests) {
      const record = this.open(request, moved.get(request.request_id));
      if (record !== null) changed.set(record.id, record);
    }
    return [...changed.values()].filter((r) => this.records.get(r.id) === r).map(copy);
  }

  /** Opens a request that did not come with a call of the core (a test hook). Null if it is listed already. */
  track(request: ModelRequest, tick: number): ModelCallRecord | null {
    const record = this.open({ ...request, issued_tick: request.issued_tick ?? tick }, undefined);
    return record === null ? null : copy(record);
  }

  private open(request: ModelRequest, move: Moved | undefined): ModelCallRecord | null {
    const id = request.request_id;
    if (this.records.has(id)) return null;
    this.reserves.set(id, readUsage(request.reserve) ?? { input_tokens: 0, output_tokens: count(request.max_tokens) });
    const record: ModelCallRecord = {
      id,
      tick: count(request.issued_tick),
      category: typeof request.category === "string" ? request.category : (move?.category ?? null),
      asked: move?.asked ?? request.tier,
      tier: request.tier,
      reason: move?.reason ?? null,
      model: this.modelOf(request),
      hold: typeof request.hold === "number" ? count(request.hold) : null,
      status: "pending",
      code: null,
      latency_ms: null,
      usage: null,
      cost: null,
      settled: null,
      late: false,
      voided: null,
    };
    this.put(record);
    return record;
  }

  private settle(record: ModelCallRecord, body: Record<string, unknown>, tick: number): void {
    const status = STATUSES.find((s) => s === body.status) ?? "error";
    const usage = readUsage(body.usage);
    const tokens = usage ?? this.reserves.get(record.id) ?? { input_tokens: 0, output_tokens: 0 };
    record.status = status;
    record.code = status === "error" && typeof body.text === "string" && body.text !== "" ? body.text.slice(0, 40) : null;
    record.latency_ms = count(body.latency_ms);
    record.usage = usage;
    record.cost = callCost(this.config, record.tier, tokens);
    record.settled = tick;
    this.reserves.delete(record.id);
  }

  private put(record: ModelCallRecord): void {
    this.records.set(record.id, record);
    while (this.records.size > MAX_CALLS) {
      const oldest = this.records.keys().next();
      if (oldest.done === true) break;
      this.records.delete(oldest.value);
      this.reserves.delete(oldest.value);
    }
  }
}

function copy(record: ModelCallRecord): ModelCallRecord {
  return { ...record, usage: record.usage === null ? null : { ...record.usage } };
}
