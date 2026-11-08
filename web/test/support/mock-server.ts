import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A stand-in for an OpenAI-compatible provider, with CORS, for the tests.
 *
 * The mode is the first path segment: `${origin}/${mode}/v1/chat/completions`. The modes:
 *   ok            200 and a stream: role chunk, content chunks, a finish chunk, a usage chunk, [DONE].
 *                 One event arrives cut in two writes, so the parser meets a split line.
 *   unauthorized  401 with a JSON error
 *   echo401       401 whose body quotes the Authorization header, as real providers do
 *   ratelimit     429 with Retry-After: 3
 *   error500      500
 *   error503      503
 *   slow          200, then one content chunk every `gap` ms (query, default 400), `chunks` times
 *                 (default 60). Honours a client that goes away.
 *   nousage       like ok, without the usage chunk
 *   surrogate     like ok, but the text ends in half of a surrogate pair
 *   hang          accepts the request and never answers
 *   truncated     200, two chunks, then the stream ends cleanly without [DONE] or a finish
 *   reset         200, two chunks, then the connection is torn down
 *   malformed     200 with a data line that is not JSON
 *   redirect      302 to the redirect target
 *   ollama        like ok, but refuses any Origin that is not on the allow list with a 403 and no
 *                 CORS headers, as OLLAMA_ORIGINS does, preflight included
 */
export type MockMode =
  | "ok"
  | "nousage"
  | "surrogate"
  | "unauthorized"
  | "echo401"
  | "ratelimit"
  | "error500"
  | "error503"
  | "slow"
  | "hang"
  | "truncated"
  | "reset"
  | "malformed"
  | "redirect"
  | "ollama";

export interface RecordedRequest {
  id: number;
  method: string;
  mode: string;
  path: string;
  origin: string | undefined;
  authorization: string | undefined;
  accessControlRequestHeaders: string | undefined;
  body: Record<string, unknown> | undefined;
  /** The client went away before the response was complete. */
  aborted: boolean;
  /** The response was written to the end. */
  completed: boolean;
  /** What the mock answered with: a status code, or 0 for no answer. */
  status: number;
}

export interface MockServer {
  origin: string;
  /** Base URL for a mode. Parameters ride in the path segment: `/slow~gap=300~chunks=10/v1`. */
  baseUrl(mode: MockMode, params?: Record<string, string | number>): string;
  readonly requests: RecordedRequest[];
  posts(): RecordedRequest[];
  preflights(): RecordedRequest[];
  allowOllamaOrigins(origins: readonly string[]): void;
  setRedirectTarget(url: string): void;
  reset(): void;
  close(): Promise<void>;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export async function startMockServer(): Promise<MockServer> {
  const requests: RecordedRequest[] = [];
  let nextId = 1;
  let ollamaOrigins = new Set<string>();
  let redirectTarget = "";

  const corsHeaders = (origin: string | undefined): Record<string, string> => ({
    "Access-Control-Allow-Origin": origin ?? "*",
    "Access-Control-Expose-Headers": "retry-after",
    Vary: "Origin",
  });

  const chunk = (model: string, delta: Record<string, unknown>, finish: string | null): string =>
    `data: ${JSON.stringify({
      id: "mock-1",
      object: "chat.completion.chunk",
      created: 0,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock");
    const [, segment = "", ...rest] = url.pathname.split("/");
    const [mode = "", ...pairs] = segment.split("~");
    const params = new Map(pairs.map((pair) => pair.split("=") as [string, string]));
    const record: RecordedRequest = {
      id: nextId++,
      method: req.method ?? "GET",
      mode,
      path: url.pathname,
      origin: req.headers.origin,
      authorization: req.headers.authorization,
      accessControlRequestHeaders: req.headers["access-control-request-headers"] as string | undefined,
      body: undefined,
      aborted: false,
      completed: false,
      status: 0,
    };
    requests.push(record);
    res.on("close", () => {
      if (!res.writableEnded) record.aborted = true;
    });
    const finish = (status: number, headers: Record<string, string> = {}, body?: string): void => {
      record.status = status;
      res.writeHead(status, headers);
      res.end(body);
      record.completed = true;
    };

    if (mode === "ollama" && record.origin !== undefined && !ollamaOrigins.has(record.origin)) {
      finish(403);
      return;
    }

    if (req.method === "OPTIONS") {
      finish(204, {
        ...corsHeaders(record.origin),
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "authorization, content-type, accept",
        "Access-Control-Max-Age": "600",
      });
      return;
    }

    if (req.method !== "POST" || rest.join("/") !== "v1/chat/completions") {
      finish(404, corsHeaders(record.origin), "not found");
      return;
    }

    let raw = "";
    req.setEncoding("utf8");
    req.on("data", (piece: string) => {
      raw += piece;
    });
    req.on("end", () => {
      try {
        record.body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        record.body = undefined;
      }
      void respond(mode, record, params, res, finish).catch(() => {
        if (!res.writableEnded) res.destroy();
      });
    });
  });

  const respond = async (
    mode: string,
    record: RecordedRequest,
    params: Map<string, string>,
    res: http.ServerResponse,
    finish: (status: number, headers?: Record<string, string>, body?: string) => void,
  ): Promise<void> => {
    const cors = corsHeaders(record.origin);
    const model = typeof record.body?.model === "string" ? record.body.model : "mock-model";
    const json = { ...cors, "Content-Type": "application/json" };
    switch (mode) {
      case "unauthorized":
        finish(401, json, JSON.stringify({ error: { message: "Incorrect API key provided.", code: "invalid_api_key" } }));
        return;
      case "echo401":
        finish(
          401,
          json,
          JSON.stringify({ error: { message: `Incorrect API key provided: ${record.authorization ?? ""}`, code: "invalid_api_key" } }),
        );
        return;
      case "ratelimit":
        finish(429, { ...json, "Retry-After": "3" }, JSON.stringify({ error: { message: "Rate limit reached." } }));
        return;
      case "error500":
        finish(500, json, JSON.stringify({ error: { message: "Internal error." } }));
        return;
      case "error503":
        finish(503, json, JSON.stringify({ error: { message: "Overloaded." } }));
        return;
      case "redirect":
        finish(302, { ...cors, Location: `${redirectTarget}/ok/v1/chat/completions` });
        return;
      case "hang":
        return;
      case "malformed":
        record.status = 200;
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
        res.write("data: this is not json\n\n");
        res.end();
        record.completed = true;
        return;
      case "truncated":
      case "reset":
        record.status = 200;
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
        res.write(chunk(model, { role: "assistant", content: "" }, null));
        await sleep(10);
        res.write(chunk(model, { content: "Hel" }, null));
        await sleep(10);
        if (mode === "reset") {
          res.destroy();
        } else {
          res.end();
          record.completed = true;
        }
        return;
      case "slow": {
        record.status = 200;
        const gap = Number(params.get("gap") ?? 400);
        const count = Number(params.get("chunks") ?? 60);
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
        res.write(chunk(model, { role: "assistant", content: "" }, null));
        for (let i = 0; i < count; i++) {
          await sleep(gap);
          if (res.destroyed || res.writableEnded) return;
          res.write(chunk(model, { content: `w${i} ` }, null));
        }
        res.write(chunk(model, {}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
        record.completed = true;
        return;
      }
      case "surrogate": {
        record.status = 200;
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream" });
        res.write(chunk(model, { content: "ok \ud83d" }, null));
        res.write(chunk(model, {}, "stop"));
        res.write("data: [DONE]\n\n");
        res.end();
        record.completed = true;
        return;
      }
      case "ok":
      case "nousage":
      case "ollama": {
        record.status = 200;
        res.writeHead(200, { ...cors, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        res.write(": keep-alive\n\n");
        res.write(chunk(model, { role: "assistant", content: "" }, null));
        for (const piece of ["Hello", " from", " the", " mock", "."]) {
          await sleep(5);
          res.write(chunk(model, { content: piece }, null));
        }
        res.write(chunk(model, {}, "stop"));
        if (mode === "nousage") {
          res.write("data: [DONE]\n\n");
          res.end();
          record.completed = true;
          return;
        }
        // A usage chunk that arrives in two writes, so that the parser has to join them.
        const usage = `data: ${JSON.stringify({
          id: "mock-1",
          object: "chat.completion.chunk",
          created: 0,
          model,
          choices: [],
          usage: { prompt_tokens: 11, completion_tokens: 5, total_tokens: 16 },
        })}\n\n`;
        const cut = Math.floor(usage.length / 2);
        res.write(usage.slice(0, cut));
        await sleep(15);
        res.write(usage.slice(cut));
        res.write("data: [DONE]\n\n");
        res.end();
        record.completed = true;
        return;
      }
      default:
        finish(404, cors, "unknown mode");
    }
  };

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;

  return {
    origin,
    baseUrl(mode, params) {
      const suffix = params === undefined ? "" : Object.entries(params).map(([k, v]) => `~${k}=${v}`).join("");
      return `${origin}/${mode}${suffix}/v1`;
    },
    requests,
    posts: () => requests.filter((r) => r.method === "POST"),
    preflights: () => requests.filter((r) => r.method === "OPTIONS"),
    allowOllamaOrigins(origins) {
      ollamaOrigins = new Set(origins);
    },
    setRedirectTarget(target) {
      redirectTarget = target;
    },
    reset() {
      requests.length = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
