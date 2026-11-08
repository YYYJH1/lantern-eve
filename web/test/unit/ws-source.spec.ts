import { expect, test } from "@playwright/test";
import type { HostToPage } from "../../src/shared/protocol.ts";
import { WsHostPort } from "../../src/page/ws-source.ts";

/** A WebSocket that the test talks to: what the page sends is kept, and what the server sends is fed in. */
class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = FakeSocket.OPEN;
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(readonly url: string) {
    FakeSocket.last = this;
  }
  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(text: string): void {
    this.sent.push(JSON.parse(text) as Record<string, unknown>);
  }
  hear(message: Record<string, unknown>): void {
    for (const listener of this.listeners.get("message") ?? []) listener({ data: JSON.stringify(message) });
  }
  open(): void {
    for (const listener of this.listeners.get("open") ?? []) listener({});
  }
}

const WELCOME = {
  type: "welcome",
  version: 1,
  session: "s-1",
  resumed: false,
  seed: 7,
  scenario: "bridge",
  core: { version: "0.0.1", format: 1 },
  python: "3.12",
  host: { name: "server", version: "0.0.1" },
  transport: "mock",
};
const ENDING = { kind: "ending", tick: 1800, ending: "ending_full", label: { zh: "圆满", en: "A perfect night" }, hidden: [], inputs: {}, passage: "mended", promised: 9, turnout: 1500, reveal: { truth: null, chains: [] } };
const { reveal: _reveal, ...COMPACT } = ENDING;
const STATE = { type: "state", seq: 12, tick: 1811, advanced: true, nextTick: 1812, frame: { npcs: [], ending: COMPACT }, clock: { paused: false, rate: [1, 1] }, hash: null, hashTick: null, events: [], seed: 7, scenario: "bridge", scene: { name: "town" } };

const real = globalThis.WebSocket;
test.beforeEach(() => {
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
});
test.afterEach(() => {
  globalThis.WebSocket = real;
});

/** A port that has said hello and been welcomed, with the messages it hands to the page collected. */
function connected(): { port: WsHostPort; socket: FakeSocket; got: HostToPage[] } {
  const port = new WsHostPort("ws://127.0.0.1:1/ws");
  const got: HostToPage[] = [];
  port.addEventListener("message", (event) => got.push(event.data));
  port.postMessage({ type: "init", pyodideBase: "", coreBase: "", seed: 7, scenario: "bridge", hidden: false });
  const socket = FakeSocket.last;
  if (socket === null) throw new Error("the port made no socket");
  socket.open();
  socket.hear(WELCOME);
  return { port, socket, got };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const types = (got: HostToPage[]): string[] => got.map((m) => m.type);

test.describe("the state of the server host", () => {
  test("hands the page the scene, then the whole ending, then the frame, so that the reveal is there when the frame is read", async () => {
    const { socket, got } = connected();
    socket.hear({ ...STATE, ending: ENDING });
    await flush();
    const from = types(got).indexOf("scene");
    expect(types(got).slice(from)).toEqual(["scene", "ending", "frame"]);
    expect(got.find((m) => m.type === "ending")).toEqual({ type: "ending", ending: ENDING });
    // The frame is the server's last one, which has the ending without the reveal.
    expect(got.find((m) => m.type === "frame")).toMatchObject({ tick: 1811, frame: { ending: COMPACT } });
  });

  test("says that a game that has not ended has no ending, and says nothing of a server that does not know the key", async () => {
    const { socket, got } = connected();
    socket.hear({ ...STATE, ending: null });
    await flush();
    expect(got.filter((m) => m.type === "ending")).toEqual([{ type: "ending", ending: null }]);
    const old = connected();
    old.socket.hear(STATE);
    await flush();
    expect(types(old.got)).not.toContain("ending");
    const odd = connected();
    odd.socket.hear({ ...STATE, ending: "ending_full" });
    await flush();
    expect(types(odd.got)).not.toContain("ending");
  });

  test("sends the call for the ending to the server as it is, and hands the answer to the page", async () => {
    const { port, socket, got } = connected();
    expect(socket.sent[0]).toMatchObject({ type: "hello", version: 1, scenario: "bridge" });
    port.postMessage({ type: "call", reqId: 4, call: { op: "ending" } });
    expect(socket.sent.at(-1)).toEqual({ type: "call", reqId: 4, call: { op: "ending" } });
    socket.hear({ type: "reply", reqId: 4, ok: true, result: ENDING });
    await flush();
    expect(got.find((m) => m.type === "reply")).toEqual({ type: "reply", reqId: 4, ok: true, result: ENDING });
  });
});

const CALL = { id: "r7-0", tick: 7, category: "reply", asked: "strong", tier: "cheap", reason: "budget", model: "qwen-flash", hold: 26, status: "pending", code: null, latency_ms: null, usage: null, cost: null, settled: null, late: false, voided: null };

test.describe("the model calls of the server host", () => {
  test("hands the page the list that comes with the state as the whole list, before the frame that shows its money", async () => {
    const { socket, got } = connected();
    socket.hear({ ...STATE, ending: null, calls: [CALL] });
    await flush();
    const from = types(got).indexOf("scene");
    expect(types(got).slice(from)).toEqual(["scene", "ending", "model-calls", "frame"]);
    expect(got.find((m) => m.type === "model-calls")).toEqual({ type: "model-calls", replace: true, calls: [CALL] });
    const old = connected();
    old.socket.hear(STATE);
    await flush();
    expect(types(old.got)).not.toContain("model-calls");
  });

  test("passes the calls that change in a frame on, and drops them while it waits for a state that holds them", async () => {
    const { socket, got } = connected();
    socket.hear(STATE);
    const frame = (seq: number): Record<string, unknown> => ({ type: "frame", seq, tick: 1811 + seq, advanced: true, frame: { npcs: [] }, events: [], clock: { paused: false, rate: [1, 1] } });
    socket.hear({ type: "model-calls", replace: false, calls: [CALL] });
    socket.hear(frame(13));
    await flush();
    expect(got.filter((m) => m.type === "model-calls")).toEqual([{ type: "model-calls", replace: false, calls: [CALL] }]);
    // A frame is missing: the page asks for the whole state, and what comes before it is covered by it.
    socket.hear(frame(15));
    socket.hear({ type: "model-calls", replace: false, calls: [{ ...CALL, id: "r8-0" }] });
    await flush();
    expect(socket.sent.at(-1)).toMatchObject({ type: "resync" });
    expect(got.filter((m) => m.type === "model-calls")).toHaveLength(1);
    socket.hear({ ...STATE, seq: 16, calls: [CALL, { ...CALL, id: "r8-0" }] });
    await flush();
    expect(got.filter((m) => m.type === "model-calls").map((m) => (m as { replace: boolean }).replace)).toEqual([false, true]);
  });
});

test.describe("the calls of the page", () => {
  test("go to the server as they are, with their ids, and the replies come back to the page: the preview of a request is one of them", async () => {
    const { port, socket, got } = connected();
    const action = { verb: "entrust", npc: "li_laotai", kind: "lend", offer: { what: "role", item: "t_honor_light", amount: 0, due: 3 } };
    port.postMessage({ type: "call", reqId: 41, call: { op: "preview", action } });
    expect(socket.sent.at(-1)).toEqual({ type: "call", reqId: 41, call: { op: "preview", action } });
    port.postMessage({ type: "call", reqId: 42, call: { op: "ending" } });
    expect(socket.sent.at(-1)).toMatchObject({ type: "call", reqId: 42, call: { op: "ending" } });
    const answer = { version: 77, cost: 20, asks: { zh: "请李老太借竹料", en: "Ask Granny Li to lend the bamboo" }, gives: null, blockers: [], odds: "mid", reasons: [] };
    socket.hear({ type: "reply", reqId: 41, ok: true, result: answer });
    socket.hear({ type: "reply", reqId: 43, ok: false, error: { code: "bad_action", message: "preview: verb must be one of ask, ask_source, tell, entrust, promise" } });
    await flush();
    const replies = got.filter((m) => m.type === "reply");
    expect(replies).toEqual([
      { type: "reply", reqId: 41, ok: true, result: answer },
      { type: "reply", reqId: 43, ok: false, error: { code: "bad_action", message: expect.any(String) } },
    ]);
  });

  test("wait for a session when there is none yet, and go out in the order they were made", async () => {
    const port = new WsHostPort("ws://127.0.0.1:1/ws");
    port.postMessage({ type: "init", pyodideBase: "", coreBase: "", seed: 7, scenario: "bridge", hidden: false });
    const socket = FakeSocket.last;
    if (socket === null) throw new Error("the port made no socket");
    socket.open();
    port.postMessage({ type: "call", reqId: 1, call: { op: "preview", action: { verb: "ask", npc: "cha_laoban", topic: "t_rail" } } });
    port.postMessage({ type: "call", reqId: 2, call: { op: "ending" } });
    expect(socket.sent.filter((m) => m.type === "call")).toEqual([]);
    socket.hear(WELCOME);
    expect(socket.sent.filter((m) => m.type === "call").map((m) => m.reqId)).toEqual([1, 2]);
  });

  test("do not carry the speed of the day, which is the page's own and the server keeps its pace", () => {
    const { port, socket } = connected();
    const count = socket.sent.length;
    port.postMessage({ type: "speed", speed: 0.75 });
    expect(socket.sent).toHaveLength(count);
  });
});

test.describe("a new game over the socket", () => {
  test("goes to the server with the seed and the story it asks for, as a game of a seed does with its seed", () => {
    const { port, socket } = connected();
    port.postMessage({ type: "new-game", preset: "slice", seed: 7, variant: "v_flood" });
    port.postMessage({ type: "new-game", preset: "slice" });
    port.postMessage({ type: "new-game", seed: 9 });
    const sent = socket.sent.filter((m) => m.type === "new-game");
    expect(sent).toEqual([
      { type: "new-game", preset: "slice", seed: 7, variant: "v_flood" },
      { type: "new-game", preset: "slice" },
      { type: "new-game", seed: 9 },
    ]);
    // JSON leaves out what is not set, so the server sees no scenario, seed or story it was not given.
    expect(Object.keys(sent[1] ?? {}).sort()).toEqual(["preset", "type"]);
  });
});
