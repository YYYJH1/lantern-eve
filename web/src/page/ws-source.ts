import type {
  ClockOutput,
  CoreEvent,
  Frame,
  HostToPage,
  ModelCallRecord,
  PageToHost,
  ReadyInfo,
} from "../shared/protocol.ts";

/**
 * The page's view source for a server host: the WebSocket protocol of
 * host_server/lantern_eve/protocol.py behind the surface of a Worker, so that HostClient drives the
 * server with the messages it sends a worker.
 *
 * Messages that exist on this transport only are handled here and never reach the client: `hello`
 * and `welcome` (the handshake), `state` (the whole state, handed on as a frame), `ack` (to know
 * which actions need no resend) and `resync`. A key never leaves the page: a `configure` message is
 * answered here with a notice and is not sent.
 *
 * The connection is kept. A page that loses it asks again for its session, and the server, which
 * held the world meanwhile, sends the state. A gap in the frame numbers is answered with `resync`.
 * Actions the server has not acknowledged are sent again after a reconnect, and the core acts on
 * each action id once.
 */
export interface HostPort {
  postMessage(message: PageToHost): void;
  addEventListener(type: "message", listener: (event: MessageEvent<HostToPage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
}

export const WS_PROTOCOL_VERSION = 1;
/** Close codes of the server (host_server/lantern_eve/protocol.py). */
const CLOSE_REPLACED = 4000;
const CLOSE_BAD_HELLO = 4001;
const RETRY_FIRST_MS = 250;
const RETRY_MAX_MS = 5000;

interface Welcome {
  type: "welcome";
  version: number;
  session: string;
  resumed: boolean;
  seed: number;
  scenario: string;
  core: { version: string; format: number };
  python: string;
  host: { name: string; version: string };
  transport: string;
}

interface State {
  type: "state";
  seq: number;
  tick: number | null;
  advanced: boolean;
  nextTick: number;
  frame: Frame | null;
  /** The whole ending of the game, reveal included, or null before it has ended. */
  ending?: Record<string, unknown> | null;
  /** The model calls of the game so far, oldest first. */
  calls?: ModelCallRecord[];
  clock: ClockOutput;
  hash: string | null;
  hashTick: number | null;
  events: CoreEvent[];
  seed: number;
  scenario: string;
  scene?: Record<string, unknown>;
}

type WsFrame = Extract<HostToPage, { type: "frame" }> & { seq: number };

interface Ack {
  type: "ack";
  action_id: string | null;
  result: string;
}

type PassedOn = Extract<HostToPage, { type: "stats" | "reset" | "reply" | "notice" | "fatal" | "model-calls" }>;
type Incoming = Welcome | State | WsFrame | Ack | PassedOn;

const PASSED_ON = new Set(["stats", "reset", "reply", "notice", "fatal", "model-calls"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The URL of the server host named by `?host=`: `ws` means the WebSocket of the server that served
 * this page, and a `ws:` or `wss:` URL means that one. Anything else means the worker, so null.
 */
export function serverUrlFor(
  search: string,
  location: Pick<Location, "protocol" | "host">,
): string | null {
  const wanted = new URLSearchParams(search).get("host");
  if (wanted === "ws") {
    return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
  }
  if (wanted !== null && /^wss?:\/\//.test(wanted)) return wanted;
  return null;
}

interface Unacked {
  body: Record<string, unknown>;
  /** Whether it went out on some connection. One that did not is in the outbox. */
  sent: boolean;
}

export class WsHostPort implements HostPort {
  private readonly target = new EventTarget();
  private ws: WebSocket | null = null;
  private attempt = 0;
  private init: Extract<PageToHost, { type: "init" }> | null = null;
  private startedAt = performance.now();
  private session: string | null = null;
  private everReady = false;
  private stopped = false;
  /** The `seq` of the last frame or state applied. The next frame is expected to be one more. */
  private lastSeq = 0;
  private awaitingState = false;
  private retryMs = RETRY_FIRST_MS;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Messages posted while no session is attached, in order. They go out after the next welcome. */
  private outbox: Record<string, unknown>[] = [];
  private readonly unacked = new Map<string, Unacked>();
  /** True between a welcome and the loss of the connection. */
  private ready = false;

  constructor(private readonly url: string) {}

  addEventListener(type: "message", listener: (event: MessageEvent<HostToPage>) => void): void;
  addEventListener(type: "error", listener: (event: ErrorEvent) => void): void;
  addEventListener(type: string, listener: (event: never) => void): void {
    this.target.addEventListener(type, listener as unknown as EventListener);
  }

  postMessage(message: PageToHost): void {
    switch (message.type) {
      case "init":
        if (this.init === null) {
          this.init = message;
          this.startedAt = performance.now();
          this.connect();
        }
        break;
      case "pause":
      case "resume":
        this.send({ type: message.type, reason: message.reason });
        break;
      case "player": {
        const id = message.body.action_id;
        if (typeof id === "string") this.unacked.set(id, { body: message.body, sent: false });
        this.send({ type: "player", body: message.body });
        break;
      }
      case "speed":
        // The server host keeps its own pace.
        break;
      case "new-game":
        this.send({ type: "new-game", seed: message.seed, scenario: message.scenario, preset: message.preset, variant: message.variant });
        break;
      case "configure":
        // The provider is the server's business, and the page keeps its key to itself.
        this.local({
          type: "notice",
          code: "server_model",
          message: "the model provider is set on the server, not by the page",
        });
        break;
      case "call":
        // Every call goes to the server as it is, the preview of an action with the rest: the server answers each with a reply of the same `reqId`.
        this.send({ type: "call", reqId: message.reqId, call: message.call });
        break;
      case "e2e":
        this.local({
          type: "reply",
          reqId: message.reqId,
          ok: false,
          error: { code: "unsupported", message: "test hooks belong to the browser host" },
        });
        break;
    }
  }

  // --- Connection ---------------------------------------------------------------------------

  private connect(): void {
    const init = this.init;
    if (init === null || this.stopped) return;
    const attempt = ++this.attempt;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.stopped = true;
      this.target.dispatchEvent(new ErrorEvent("error", { message: `cannot connect to ${this.url}: ${String(err)}` }));
      return;
    }
    this.ws = ws;
    ws.addEventListener("open", () => {
      if (attempt !== this.attempt) return;
      this.retryMs = RETRY_FIRST_MS;
      this.awaitingState = false;
      this.ready = false;
      // The first hello reports how the page started, a later one how it is now.
      const hidden = this.session === null ? init.hidden : this.hiddenNow();
      const resume = this.session === null ? {} : { session: this.session, since: this.lastSeq };
      ws.send(
        JSON.stringify({
          type: "hello",
          version: WS_PROTOCOL_VERSION,
          ...resume,
          seed: init.seed,
          scenario: init.scenario,
          ...(init.preset === undefined ? {} : { preset: init.preset }),
          hidden,
        }),
      );
    });
    ws.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (attempt === this.attempt && typeof event.data === "string") this.receive(event.data);
    });
    ws.addEventListener("close", (event: CloseEvent) => {
      if (attempt === this.attempt) this.lost(event.code);
    });
    // A failed connection is followed by a close event, and that retries.
  }

  private hiddenNow(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
  }

  private lost(code: number): void {
    this.ws = null;
    this.ready = false;
    if (this.stopped) return;
    if (code === CLOSE_REPLACED || code === CLOSE_BAD_HELLO) {
      // Another page took the game over, or the server refused us. Neither gets better by asking again.
      this.stopped = true;
      if (code === CLOSE_REPLACED) {
        this.local({ type: "fatal", code: "replaced", message: "another page took this game over" });
      }
      return;
    }
    if (this.everReady) {
      this.local({
        type: "notice",
        code: "connection_lost",
        message: "the connection to the server was lost, trying again",
      });
    } else {
      this.local({ type: "boot", stage: "retry", ms: performance.now() - this.startedAt });
    }
    const wait = this.retryMs;
    this.retryMs = Math.min(this.retryMs * 2, RETRY_MAX_MS);
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  /** Sends a message when a session is attached, and otherwise keeps it for the next welcome. */
  private send(message: Record<string, unknown>): void {
    const ws = this.ws;
    if (ws !== null && ws.readyState === WebSocket.OPEN && this.ready) {
      this.transmit(ws, message);
    } else {
      this.outbox.push(message);
    }
  }

  private transmit(ws: WebSocket, message: Record<string, unknown>): void {
    ws.send(JSON.stringify(message));
    if (message.type === "player" && isRecord(message.body)) {
      const entry = this.unacked.get(String(message.body.action_id));
      if (entry !== undefined) entry.sent = true;
    }
  }

  // --- Messages from the server -------------------------------------------------------------

  private receive(text: string): void {
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(message) || typeof message.type !== "string") return;
    const incoming = message as unknown as Incoming;
    switch (incoming.type) {
      case "welcome":
        this.onWelcome(incoming);
        break;
      case "state":
        this.onState(incoming);
        break;
      case "frame":
        this.onFrame(incoming);
        break;
      case "ack":
        if (incoming.action_id !== null) this.unacked.delete(incoming.action_id);
        break;
      default:
        if (PASSED_ON.has(incoming.type)) this.onPassedOn(incoming);
    }
  }

  private onWelcome(welcome: Welcome): void {
    const ws = this.ws;
    if (ws === null) return;
    if (welcome.version !== WS_PROTOCOL_VERSION) {
      this.stopped = true;
      this.local({ type: "fatal", code: "bad_version", message: `the server speaks protocol ${welcome.version}` });
      return;
    }
    if (this.session !== null && !welcome.resumed) {
      // The server does not know our session any more: this is a new game on the same page.
      this.lastSeq = 0;
      this.outbox = this.outbox.filter((m) => m.type === "call");
      this.unacked.clear();
      this.local({ type: "reset", seed: welcome.seed, scenario: welcome.scenario });
    }
    this.session = welcome.session;
    this.ready = true;
    if (!this.everReady) {
      this.everReady = true;
      const total = performance.now() - this.startedAt;
      this.local({ type: "boot", stage: "connect", ms: total });
      const ready: ReadyInfo = {
        timings: { pyodideMs: 0, wheelMs: 0, coreMs: 0, totalMs: total },
        coreVersion: welcome.core.version,
        coreFormat: welcome.core.format,
        pyodideVersion: "none (server host)",
        pythonVersion: `${welcome.python} (${welcome.host.name} ${welcome.host.version}, ${welcome.transport} model)`,
        wheel: { name: "server", bytes: 0, sha256: "" },
        seed: welcome.seed,
        scenario: welcome.scenario,
      };
      this.local({ type: "ready", ...ready });
    }
    // Actions that went out and were never confirmed are sent again, the core acts on each id
    // once. Then everything that waited, in the order it was posted.
    for (const entry of this.unacked.values()) {
      if (entry.sent) ws.send(JSON.stringify({ type: "player", body: entry.body }));
    }
    const waiting = this.outbox;
    this.outbox = [];
    for (const message of waiting) this.transmit(ws, message);
  }

  private onState(state: State): void {
    this.lastSeq = state.seq;
    this.awaitingState = false;
    if (isRecord(state.scene)) this.local({ type: "scene", scene: state.scene });
    // Before the frame, so that a page that comes to a game that is over has the reveal when it reads the frame.
    if (state.ending === null || isRecord(state.ending)) this.local({ type: "ending", ending: state.ending });
    // The list of calls is the server's, whole, and replaces what the page held.
    if (Array.isArray(state.calls)) this.local({ type: "model-calls", replace: true, calls: state.calls });
    if (state.frame === null || state.tick === null) return;
    this.local({
      type: "frame",
      tick: state.tick,
      advanced: state.advanced,
      frame: state.frame,
      events: state.events,
      clock: state.clock,
      // The hash belongs to this frame only if it is the tick that was hashed.
      hash: state.hashTick === state.tick && state.hash !== null ? state.hash : undefined,
    });
  }

  private onFrame(frame: WsFrame): void {
    if (this.awaitingState || frame.seq <= this.lastSeq) return;
    if (frame.seq !== this.lastSeq + 1) {
      // A frame is missing. Ask for the whole state, and ignore frames until it comes.
      this.awaitingState = true;
      this.ws?.send(JSON.stringify({ type: "resync", since: this.lastSeq }));
      return;
    }
    this.lastSeq = frame.seq;
    const { seq: _seq, ...message } = frame;
    this.local(message);
  }

  private onPassedOn(message: PassedOn): void {
    if (message.type === "reset") {
      this.lastSeq = 0;
      this.awaitingState = false;
      this.unacked.clear();
    } else if (message.type === "fatal") {
      this.stopped = true;
    } else if (message.type === "model-calls" && this.awaitingState) {
      // The state that is on its way carries the whole list.
      return;
    }
    this.local(message);
  }

  /** Hands a message to the client the way a worker would, on a later turn of the event loop. */
  private local(message: HostToPage): void {
    queueMicrotask(() => this.target.dispatchEvent(new MessageEvent("message", { data: message })));
  }
}
