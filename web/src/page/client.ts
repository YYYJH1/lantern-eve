import type {
  CallOp,
  ConfigureMessage,
  CoreEvent,
  Frame,
  HostStats,
  HostToPage,
  LoadInfo,
  PageNotes,
  PageToHost,
  PauseReason,
  ProviderId,
  ReadyInfo,
  Replay,
  ReplayStatus,
  SaveMeta,
} from "../shared/protocol.ts";
import { applyCalls, type CallLog, emptyLog } from "./calls.ts";
import { anotherVariant, randomSeed } from "./truths.ts";
import { type HostPort, serverUrlFor, WsHostPort } from "./ws-source.ts";

export interface PageState {
  phase: "boot" | "ready" | "failed";
  bootStages: Array<{ stage: string; ms: number }>;
  ready: ReadyInfo | null;
  /** Milliseconds from creating the worker to the ready message, on the page's clock. */
  readyAfterMs: number | null;
  seed: number;
  scenario: string;
  /** Tick of the call behind the latest frame, and the number of ticks simulated so far. */
  frameTick: number | null;
  /** The named game of the core that this page started (`slice`), or null for a game of a seed. A new game plays its rules in a case of its own. */
  preset: string | null;
  simTick: number;
  advanced: boolean;
  paused: boolean;
  rate: [number, number];
  frame: Frame | null;
  frameCount: number;
  /** What the game draws once: the scene of the running game, and how often it changed. */
  scene: Record<string, unknown> | null;
  sceneVersion: number;
  /** The latest hash the core reported, and the tick it belongs to. */
  hash: string | null;
  hashTick: number | null;
  events: CoreEvent[];
  /** The model calls of the running game, newest first. */
  calls: CallLog;
  stats: HostStats | null;
  loaded: LoadInfo | null;
  /** Where a host that plays a recording has got to. Null for a host that plays a game. */
  replay: ReplayStatus | null;
  lastSaved: SaveMeta | null;
  saves: SaveMeta[];
  error: { code: string; message: string } | null;
  /** Things the host handled without stopping, such as a player input the core refused. */
  notices: Array<{ code: string; message: string }>;
  cspViolations: Array<{ directive: string; blocked: string }>;
  /** The model provider the page last configured, and for which providers it holds a key. */
  model: { provider: ProviderId | null; keys: Partial<Record<ProviderId, boolean>> };
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };

export class HostCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HostCallError";
  }
}

const MAX_EVENTS = 30;

/**
 * The page's side of the host worker: sends messages, keeps the latest state the worker reported,
 * and tells listeners when it changed. It does not know what runs behind the worker.
 */
export class HostClient {
  readonly state: PageState = {
    phase: "boot",
    bootStages: [],
    ready: null,
    readyAfterMs: null,
    seed: 0,
    scenario: "m0",
    frameTick: null,
    preset: null,
    simTick: 0,
    advanced: false,
    paused: false,
    rate: [1, 1],
    frame: null,
    frameCount: 0,
    scene: null,
    sceneVersion: 0,
    hash: null,
    hashTick: null,
    events: [],
    calls: emptyLog(),
    stats: null,
    loaded: null,
    replay: null,
    lastSaved: null,
    saves: [],
    error: null,
    notices: [],
    cspViolations: [],
    model: { provider: null, keys: {} },
  };
  /** Counts changes, so that a view can tell whether anything moved. */
  version = 0;

  private readonly listeners = new Set<() => void>();
  private readonly taps = new Set<(message: HostToPage) => void>();
  private readonly pending = new Map<number, Pending>();
  private nextReq = 1;
  private startedAt = performance.now();
  private actionCounter = 0;
  private readonly session = Math.random().toString(36).slice(2, 8);
  private sceneText = "";

  private readonly port: HostPort;
  /** Whether the host runs the day at the pace the page asks for (`setPace`): a worker does, the server host keeps its own. */
  readonly paced: boolean;

  constructor(worker: Worker, options: { allowServer?: boolean } = {}) {
    // ?host=ws drives the page from the server host over a WebSocket. The worker that main.tsx made
    // has not been sent `init`, so it has loaded nothing, and it is ended here. A client that plays a
    // recording always has its own worker: the server host has no part in it.
    const serverUrl = options.allowServer === false ? null : serverUrlFor(location.search, location);
    if (serverUrl !== null) worker.terminate();
    this.paced = serverUrl === null;
    this.port = serverUrl === null ? worker : new WsHostPort(serverUrl);
    this.port.addEventListener("message", (event) => this.onMessage(event.data));
    this.port.addEventListener("error", (event) => {
      this.state.phase = "failed";
      this.state.error = { code: "worker_error", message: event.message || "the host worker failed to start" };
      this.changed();
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Calls the listener with every message from the host, after the state has taken it in and
   * before the views are told. For what has to see each message and not only the latest state.
   */
  tap(listener: (message: HostToPage) => void): () => void {
    this.taps.add(listener);
    return () => this.taps.delete(listener);
  }

  /** Tells the views that something outside the host state changed. */
  touch(): void {
    this.changed();
  }

  private changed(): void {
    this.version++;
    for (const listener of this.listeners) listener();
  }

  private send(message: PageToHost): void {
    this.port.postMessage(message);
  }

  start(options: {
    seed: number;
    scenario: string;
    hidden: boolean;
    mode?: "play" | "replay";
    /** A named game of the core. The host plays it, whatever `seed` and `scenario` say. */
    preset?: string;
    pace?: number;
    pauseAtTick?: number;
    config?: Record<string, number>;
  }): void {
    this.state.seed = options.seed;
    this.state.scenario = options.scenario;
    this.state.preset = options.preset ?? null;
    this.startedAt = performance.now();
    this.send({
      type: "init",
      mode: options.mode,
      pyodideBase: new URL("pyodide/", document.baseURI).href,
      coreBase: new URL("core/", document.baseURI).href,
      seed: options.seed,
      scenario: options.scenario,
      preset: options.preset,
      hidden: options.hidden,
      pace: options.pace,
      pauseAtTick: options.pauseAtTick,
      config: options.config,
    });
  }

  setHidden(hidden: boolean): void {
    this.send({ type: hidden ? "pause" : "resume", reason: "hidden" });
  }

  /** The player's pause by default. The page holds the world for its own sheets with the reason `page` (`hold.ts`). */
  pause(reason: PauseReason = "user"): void {
    this.send({ type: "pause", reason });
  }

  resume(reason: PauseReason = "user"): void {
    this.send({ type: "resume", reason });
  }

  /** A fresh id for a player action. The core settles an action once for each id, so a request sent again with its id changes nothing. */
  newActionId(): string {
    return `${this.session}-${this.actionCounter++}`;
  }

  /** Sends a player action and returns its id, which the core's acknowledgement carries. An id is added when the body has none. */
  player(body: Record<string, unknown>): string {
    const withId = typeof body.action_id === "string" ? body : { ...body, action_id: this.newActionId() };
    this.send({ type: "player", body: withId });
    return withId.action_id as string;
  }

  /**
   * Asks the host to run the day at `speed` times the common pace. `skip` says it is the pace of a skip to the next thing, for which the
   * host takes more than for the player's choice. A server host keeps its own pace and ignores it.
   */
  setPace(speed: number, skip = false): void {
    this.send(skip ? { type: "speed", speed, skip: true } : { type: "speed", speed });
  }

  /**
   * Starts another game, and not the one that was played: a seed at random, and for the named game this page started (`slice`) a story
   * at random too, which the page does not say. `avoid` is the story of the game just played where the page knows it (the ending says
   * it), so that "another truth" is one.
   */
  newGame(avoid?: string | null): void {
    const preset = this.state.preset;
    const seed = randomSeed();
    this.send(preset === null ? { type: "new-game", seed } : { type: "new-game", preset, seed, variant: anotherVariant(avoid) });
  }

  /** Starts the first game of the named game this page started again: the one the opening page begins with, which the tutorial is of. */
  firstGame(): void {
    const preset = this.state.preset;
    this.send(preset === null ? { type: "new-game", seed: randomSeed() } : { type: "new-game", preset });
  }

  /** For a host that plays a recording: opens one, at a tick, playing or held. */
  openReplay(replay: unknown, options: { tick?: number; play?: boolean } = {}): void {
    this.send({ type: "replay", control: { op: "open", replay, ...options } });
  }

  /** Goes to the world as it stood when `tick` ticks had been simulated. */
  seek(tick: number): void {
    this.send({ type: "replay", control: { op: "seek", tick } });
  }

  setSpeed(speed: number): void {
    this.send({ type: "replay", control: { op: "speed", speed } });
  }

  /** Ends the worker behind this client. The client is not used again. */
  dispose(): void {
    (this.port as { terminate?: () => void }).terminate?.();
    this.listeners.clear();
    this.taps.clear();
  }

  configure(config: Omit<ConfigureMessage, "type">): void {
    this.state.model.provider = config.provider;
    if (config.provider !== null && config.key !== undefined) this.state.model.keys[config.provider] = config.key !== "";
    this.send({ type: "configure", ...config });
    this.changed();
  }

  call<T>(call: CallOp): Promise<T> {
    return this.request<T>((reqId) => ({ type: "call", reqId, call }));
  }

  e2e<T>(op: string, args?: unknown): Promise<T> {
    return this.request<T>((reqId) => ({ type: "e2e", reqId, op, args }));
  }

  private request<T>(build: (reqId: number) => PageToHost): Promise<T> {
    const reqId = this.nextReq++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (value: unknown) => void, reject });
      this.send(build(reqId));
    });
  }

  async refreshSaves(): Promise<SaveMeta[]> {
    this.state.saves = await this.call<SaveMeta[]>({ op: "list-saves" });
    this.changed();
    return this.state.saves;
  }

  /**
   * Set by the player's side of the page: what it keeps with a save (the recap or the paper of the morning and the summary of the
   * night that the player has not put away), or null where there is nothing. The host stores it with the save and sends it back when the save is loaded.
   */
  pageNotes: (() => PageNotes | null) | null = null;

  /** Saves the game. `extra` is more for the notes the page keeps with the save, over what `pageNotes` gives (the page marks an autosave so). */
  async save(name?: string, extra?: PageNotes): Promise<SaveMeta> {
    const notes = { ...(this.pageNotes?.() ?? {}), ...(extra ?? {}) };
    const meta = await this.call<SaveMeta>({ op: "save", name, ...(Object.keys(notes).length === 0 ? {} : { page: notes }) });
    this.state.lastSaved = meta;
    await this.refreshSaves();
    return meta;
  }

  async load(id: number): Promise<LoadInfo> {
    return this.call<LoadInfo>({ op: "load", id });
  }

  async deleteSave(id: number): Promise<void> {
    await this.call<null>({ op: "delete-save", id });
    await this.refreshSaves();
  }

  exportReplay(): Promise<Replay> {
    return this.call<Replay>({ op: "export" });
  }

  private onMessage(message: HostToPage): void {
    const s = this.state;
    switch (message.type) {
      case "boot":
        s.bootStages.push({ stage: message.stage, ms: message.ms });
        break;
      case "ready": {
        const { type: _type, ...info } = message;
        s.phase = "ready";
        s.ready = info;
        // A game the host named by a preset has its seed from the core, which the page learns here.
        s.seed = info.seed;
        s.scenario = info.scenario;
        s.readyAfterMs = performance.now() - this.startedAt;
        break;
      }
      case "frame":
        s.frame = message.frame;
        s.frameCount++;
        s.frameTick = message.tick;
        s.advanced = message.advanced;
        s.simTick = message.advanced ? message.tick + 1 : message.tick;
        s.paused = message.clock.paused;
        s.rate = message.clock.rate;
        if (message.advanced && message.hash !== undefined) {
          s.hash = message.hash;
          s.hashTick = message.tick;
        }
        if (message.events.length > 0) {
          s.events.push(...message.events);
          if (s.events.length > MAX_EVENTS) s.events.splice(0, s.events.length - MAX_EVENTS);
        }
        break;
      case "scene": {
        // A game that is created again, or a page that asks for the whole state, sends the same
        // scene once more. The view only needs to know when it really changed.
        const text = JSON.stringify(message.scene);
        if (text !== this.sceneText) {
          this.sceneText = text;
          s.scene = message.scene;
          s.sceneVersion++;
        }
        break;
      }
      case "model-calls":
        applyCalls(s.calls, message.replace, message.calls);
        break;
      case "replay":
        s.replay = message.status;
        break;
      case "stats":
        s.stats = message.stats;
        break;
      case "reset":
        s.seed = message.seed;
        s.scenario = message.scenario;
        s.frame = null;
        s.frameTick = null;
        s.simTick = 0;
        s.advanced = false;
        s.hash = null;
        s.hashTick = null;
        s.events = [];
        s.calls = emptyLog();
        s.loaded = null;
        break;
      case "loaded":
        s.loaded = message.info;
        break;
      case "reply": {
        const waiting = this.pending.get(message.reqId);
        if (waiting === undefined) break;
        this.pending.delete(message.reqId);
        if (message.ok) waiting.resolve(message.result);
        else waiting.reject(new HostCallError(message.error.code, message.error.message));
        break;
      }
      case "fatal":
        s.phase = "failed";
        s.error = { code: message.code, message: message.message };
        break;
      case "csp-violation":
        s.cspViolations.push({ directive: message.directive, blocked: message.blocked });
        break;
      case "notice":
        // A reply that is slow to come is not something to read in a list of what the host handled. The
        // player's side shows it as a line in the talk (see play.ts).
        if (message.code === "thinking") break;
        s.notices.push({ code: message.code, message: message.message });
        if (s.notices.length > 10) s.notices.shift();
        break;
    }
    for (const tap of this.taps) tap(message);
    this.changed();
  }
}
