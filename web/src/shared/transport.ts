import type { ModelRequest, ModelStatus, ProviderId, Usage } from "./protocol.ts";
import { modelFor, PROVIDERS, type ProviderSpec } from "./providers.ts";
import { registerSecret } from "./secrets.ts";
import { SseParser } from "./sse.ts";

/** How long the host waits for one model call before it reports a timeout. */
export const HOST_TIMEOUT_MS = 8000;

const ZERO_USAGE: Usage = { input_tokens: 0, output_tokens: 0 };

export interface ModelOutcome {
  status: ModelStatus;
  /** The streamed text for "ok", the short error code for "error", empty otherwise. */
  text: string;
  /**
   * What the call cost, from the last chunk of the stream. Null when the host cannot know, as
   * after a timeout, a cancel, a server error or a broken stream: the core then books the whole
   * reservation of the request. Zero when nothing was generated, as for a 4xx answer.
   */
  usage: Usage | null;
  latency_ms: number;
  /** Short code of an error: http_401, http_429, http_503, network, bad_stream, no_key, ... */
  code?: string;
  httpStatus?: number;
  retryAfterMs?: number;
  firstTokenMs?: number;
  /** False when the provider sent no usage object. */
  usageReported: boolean;
}

export interface ModelCall {
  readonly id: string;
  /** "discard" is "cancel" for a call whose result nobody will read. Either way the call ends "cancelled". */
  abort(reason: "cancel" | "discard"): void;
  readonly done: Promise<ModelOutcome>;
}

export interface TransportConfig {
  provider: ProviderId | null;
  /** Set for `provider` and kept for later. An empty string clears it. */
  key?: string;
  /** Overrides the model of both tiers. */
  model?: string;
  /** Overrides the provider's base URL. Test builds only; the worker drops it otherwise. */
  baseUrl?: string;
}

export interface StartOptions {
  timeoutMs?: number;
}

export interface Transport {
  configure(config: TransportConfig): void;
  /**
   * The outcome of a request that cannot be made at all (no provider, no key), or null. It is known
   * at once, with no I/O, so the host can hand it to the core without waiting for a promise. That
   * puts the answer at the same tick every time, which keeps a session without a model a pure
   * function of its seed and the player's inputs.
   */
  precheck(request: ModelRequest): ModelOutcome | null;
  start(request: ModelRequest, options?: StartOptions): ModelCall;
  /** The model that answers a request, for the list of calls. Null where none does (no provider). */
  modelOf(request: ModelRequest): string | null;
}

export interface TransportDeps {
  fetch?: typeof fetch;
  now?: () => number;
}

class StreamError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** The JSON body of a chat-completions request for `request` on `provider`. */
export function buildRequestBody(
  provider: ProviderSpec,
  request: ModelRequest,
  model?: string,
): Record<string, unknown> {
  return {
    ...provider.extraBody,
    model: modelFor(provider, request.tier, model),
    messages: request.messages,
    max_tokens: request.max_tokens,
    stream: true,
    stream_options: { include_usage: true },
  };
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/**
 * Streaming transport for OpenAI-compatible /chat/completions endpoints.
 *
 * A call ends in exactly one of four ways: "ok" with the streamed text and the usage from the last
 * chunk, "error" with a short code, "timeout" when the host timeout passes, or "cancelled" when
 * the caller aborts it. Error codes never contain anything from the response body, because
 * providers echo parts of the key in their error messages.
 *
 * The key is held here, per provider, and goes into the Authorization header of requests to the
 * active provider's base URL only. It is never sent to a provider that does not need one.
 */
export class StreamingTransport implements Transport {
  private active: ProviderSpec | null = null;
  private readonly keys = new Map<ProviderId, string>();
  private model: string | undefined;
  private baseUrl: string | undefined;

  constructor(private readonly deps: TransportDeps = {}) {}

  configure(config: TransportConfig): void {
    if (config.provider !== null && config.key !== undefined) {
      if (config.key === "") {
        this.keys.delete(config.provider);
      } else {
        this.keys.set(config.provider, config.key);
        registerSecret(config.key);
      }
    }
    this.active = config.provider === null ? null : PROVIDERS[config.provider];
    this.model = config.model;
    this.baseUrl = config.baseUrl;
  }

  hasKey(provider: ProviderId): boolean {
    return this.keys.has(provider);
  }

  modelOf(request: ModelRequest): string | null {
    return this.active === null ? null : modelFor(this.active, request.tier, this.model);
  }

  precheck(_request: ModelRequest): ModelOutcome | null {
    const provider = this.active;
    // Nothing leaves the host in these two cases, so the cost is known to be nothing.
    const refused = (code: string): ModelOutcome => ({
      status: "error",
      text: code,
      usage: ZERO_USAGE,
      latency_ms: 0,
      code,
      usageReported: false,
    });
    if (provider === null) return refused("no_provider");
    if (provider.needsKey && !this.keys.has(provider.id)) return refused("no_key");
    return null;
  }

  start(request: ModelRequest, options: StartOptions = {}): ModelCall {
    const now = this.deps.now ?? (() => performance.now());
    const doFetch = this.deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    const timeoutMs = options.timeoutMs ?? HOST_TIMEOUT_MS;
    const t0 = now();
    const provider = this.active;
    const model = this.model;
    const base = this.baseUrl;
    const key = provider === null ? undefined : this.keys.get(provider.id);
    const controller = new AbortController();
    let reason: "cancel" | "discard" | "timeout" | null = null;
    let settled = false;
    const abort = (why: "cancel" | "discard" | "timeout"): void => {
      if (settled || reason !== null) return;
      reason = why;
      controller.abort();
    };

    const elapsed = (): number => Math.round(now() - t0);
    const failure = (code: string, extra: Partial<ModelOutcome> = {}): ModelOutcome => ({
      status: "error",
      text: code,
      usage: null,
      latency_ms: elapsed(),
      code,
      usageReported: false,
      ...extra,
    });

    const run = async (): Promise<ModelOutcome> => {
      // Nothing leaves the host in these two cases, so the cost is known to be nothing.
      if (provider === null) return failure("no_provider", { usage: ZERO_USAGE });
      if (provider.needsKey && key === undefined) return failure("no_key", { usage: ZERO_USAGE });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        // What the official OpenAI clients send, streaming or not.
        Accept: "application/json",
      };
      if (provider.needsKey && key !== undefined) headers.Authorization = `Bearer ${key}`;
      const url = `${(base ?? provider.baseUrl).replace(/\/+$/, "")}/chat/completions`;
      const timer = setTimeout(() => abort("timeout"), timeoutMs);

      try {
        const response = await doFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(buildRequestBody(provider, request, model)),
          signal: controller.signal,
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          redirect: "error",
          referrerPolicy: "no-referrer",
        });
        if (!response.ok) {
          // The body is never read: it may quote the key.
          void response.body?.cancel().catch(() => undefined);
          return failure(`http_${response.status}`, {
            httpStatus: response.status,
            retryAfterMs: retryAfterMs(response.headers.get("retry-after")),
            // A request the provider turned away generated nothing. After a 5xx nobody knows.
            usage: response.status >= 400 && response.status < 500 ? ZERO_USAGE : null,
          });
        }
        if (response.body === null) return failure("bad_stream");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        const sse = new SseParser();
        let text = "";
        let usage: Usage | null = null;
        let sawDone = false;
        let sawFinish = false;
        let firstTokenMs: number | undefined;

        const onData = (data: string): void => {
          if (data === "[DONE]") {
            sawDone = true;
            return;
          }
          let chunk: unknown;
          try {
            chunk = JSON.parse(data);
          } catch {
            throw new StreamError("bad_stream");
          }
          if (typeof chunk !== "object" || chunk === null) throw new StreamError("bad_stream");
          const record = chunk as Record<string, unknown>;
          if (record.error !== undefined && record.error !== null) throw new StreamError("provider_error");
          const choices = record.choices;
          const choice = Array.isArray(choices) ? (choices[0] as Record<string, unknown> | undefined) : undefined;
          if (choice !== undefined && choice !== null) {
            const delta = choice.delta as Record<string, unknown> | undefined;
            const piece = delta?.content;
            if (typeof piece === "string" && piece.length > 0) {
              if (firstTokenMs === undefined) firstTokenMs = elapsed();
              text += piece;
            }
            if (choice.finish_reason !== undefined && choice.finish_reason !== null) sawFinish = true;
          }
          const u = record.usage;
          if (typeof u === "object" && u !== null) {
            const usageRecord = u as Record<string, unknown>;
            usage = {
              input_tokens: tokenCount(usageRecord.prompt_tokens),
              output_tokens: tokenCount(usageRecord.completion_tokens),
            };
          }
        };

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          sse.push(decoder.decode(value, { stream: true }), onData);
          if (sawDone) break;
        }
        if (!sawDone) {
          sse.push(decoder.decode(), onData);
          sse.end(onData);
        } else {
          void reader.cancel().catch(() => undefined);
        }
        if (!sawDone && !sawFinish) return failure("truncated");
        return {
          status: "ok",
          // The core refuses text with a lone surrogate, and a model can emit one.
          text: text.toWellFormed(),
          usage,
          latency_ms: elapsed(),
          firstTokenMs,
          usageReported: usage !== null,
        };
      } catch (err) {
        if (reason === "timeout") {
          return { status: "timeout", text: "", usage: null, latency_ms: elapsed(), usageReported: false };
        }
        if (reason === "cancel" || reason === "discard") {
          return { status: "cancelled", text: "", usage: null, latency_ms: elapsed(), usageReported: false };
        }
        if (err instanceof StreamError) return failure(err.code);
        return failure("network");
      } finally {
        clearTimeout(timer);
      }
    };

    // An abort that comes after the last byte changes nothing: the result is the real one, which the
    // core voids if it had cancelled the request and still books the tokens of.
    const done = run().then((outcome) => {
      settled = true;
      return outcome;
    });

    return {
      id: request.request_id,
      abort: (why) => abort(why),
      done,
    };
  }
}
