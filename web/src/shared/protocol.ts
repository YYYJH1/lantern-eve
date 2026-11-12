/**
 * Shapes that cross a boundary: the core boundary (JSON in, JSON out, see core/lantern_core/api.py),
 * the replay file, and the messages between the page and the host worker.
 */

export const HOST_VERSION = "0.2.0";
export const REPLAY_FORMAT = 1;

export type ProviderId = "bailian" | "deepseek" | "ollama";
/**
 * Why the world is paused. The world runs when no reason is left. `user` is the pause button, `hidden` a tab that is hidden, `page`
 * the page holding the world while a sheet of its own is up (the notebook, a card of the help), which is not a pause of the player's,
 * and `show` the page holding it while a show plays on the map (a moment of the festival, the festival night), which is let go alone
 * when the show ends.
 */
export type PauseReason = "user" | "hidden" | "page" | "show";

// --- The core boundary ----------------------------------------------------------------------

export interface CoreInput {
  seq: number;
  kind: string;
  body: Record<string, unknown>;
}

export interface Npc {
  id: string;
  x: number;
  y: number;
}

export interface Frame {
  npcs: Npc[];
  [key: string]: unknown;
}

export interface CoreEvent {
  kind: string;
  [key: string]: unknown;
}

export interface ModelRequest {
  request_id: string;
  tier: string;
  messages: unknown[];
  max_tokens: number;
  [key: string]: unknown;
}

export interface ClockOutput {
  paused: boolean;
  rate: [number, number];
}

export interface StepOutputs {
  tick: number;
  advanced: boolean;
  frame: Frame;
  events: CoreEvent[];
  requests: ModelRequest[];
  cancels: string[];
  clock: ClockOutput;
  hash?: string;
}

export type ModelStatus = "ok" | "timeout" | "cancelled" | "error";

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

/**
 * The body of a "model_result" input. `usage` is null when the host cannot know it, as after a
 * timeout or a cancel: the core then books the whole reservation of the request.
 */
export interface ModelResultBody {
  request_id: string;
  status: ModelStatus;
  text: string;
  usage: Usage | null;
  latency_ms: number;
}

/** What `Game.header()` returns: everything the core needs to build the game again from tick 0. */
export interface CoreHeader {
  format: number;
  core_version: string;
  content_hash?: string;
  scenario: string;
  /** Ints, and for the bridge two texts (`variant` and `opening`). */
  config: Record<string, number | string>;
  seed: number;
  [key: string]: unknown;
}

/** The arguments of the Game constructor. A header holds them under the same names. */
export interface GameSpec {
  seed: number;
  scenario: string;
  config: Record<string, number | string> | null;
}

/** A named game of the core (`lantern_core.api.preset`): its seed, its scenario and its config. */
export interface PresetGame {
  seed: number;
  scenario: string;
  config: Record<string, number | string>;
}

/**
 * What a named game may be asked to be besides its name: the rules of the game at another seed, and with another story true (one of
 * the ids of the variants of the script, such as `v_flood`). Without either it is the first game of the name.
 */
export interface PresetOptions {
  seed?: number;
  variant?: string;
}

/** What the host needs from a Game, whether it lives in Pyodide or is a stand-in in a test. */
export interface GameLike {
  step(inputsJson: string): string;
  hash(): string;
  readonly tick: number;
  /** `Game.header()` as canonical JSON. */
  headerJson(): string;
  /** `Game.last_inputs` as canonical JSON: the normalized records the last `step` applied. */
  lastInputsJson(): string;
  /** `Game.scene_json()`: what the client draws once and that never changes during a game. */
  sceneJson(): string;
  /** `Game.snapshot_json()`: the whole state, which `restoreGame` of the environment continues from bit for bit. */
  snapshotJson(): string;
  /** `Game.ending_json()`: the whole ending of the game with its reveal, as JSON, or `null` before the game has ended. */
  endingJson(): string;
  /**
   * `Game.preview_json(action)`: what an action would ask, give and cost, and what stands in its way, as JSON
   * (`{version, cost, asks, gives, blockers, odds, reasons}`), or `null` in a game that has no previews. It only reads.
   * An action the core cannot read throws an `InputError`.
   */
  previewJson(actionJson: string): string;
  destroy(): void;
}

// --- The replay -----------------------------------------------------------------------------

/** One logged input: the tick of the call that applied it, its seq, its kind and its body. */
export type LogRecord = [tick: number, seq: number, kind: string, body: Record<string, unknown>];
/** The state hash the core reported for a tick it simulated: [tick, hash]. */
export type HashRecord = [tick: number, hash: string];

/**
 * A replay is the recording that `lantern_core.replay` defines, so that `lantern_core.replay.rebuild`
 * under CPython rebuilds it as it stands, plus two keys of the host's own:
 *
 *   header      what Game.header() returned
 *   base        null: a browser session always starts at tick 0
 *   records     every input the core applied, normalized by the core, with the tick of its call
 *   hashes      the hash of every simulated tick that is a multiple of 100
 *   snapshots   empty: the browser keeps no snapshots, loading replays from tick 0
 *   end_tick    the tick the next call applies at
 *   host        which host wrote it
 *   final       end_tick and the state hash at that moment ("" for a session that stopped on an error)
 */
export interface Replay {
  header: CoreHeader;
  base: null;
  records: LogRecord[];
  hashes: HashRecord[];
  snapshots: unknown[];
  end_tick: number;
  host: { name: string; version: string; replayFormat: number };
  final: { tick: number; hash: string };
}

/**
 * What the page keeps with a save: a small object of its own, such as the recap or the paper of the morning and the summary of the night that the player has not put away.
 * The host stores it with the save and hands it back when the save is loaded, and reads none of it.
 */
export type PageNotes = Record<string, unknown>;

export interface SaveMeta {
  id: number;
  name: string;
  savedAt: string;
  tick: number;
  hash: string;
  page?: PageNotes;
}

// --- The model calls, as the page lists them -------------------------------------------------

/** How a model call stands: in flight, one of the four outcomes, or `template` (the gate never let it out). */
export type CallStatus = "pending" | ModelStatus | "template";

/**
 * One model request of the core, from the moment it goes out to the moment the core books its
 * result (`CallTracker` in model-calls.ts, and `calls.py` on the server). Money is in micro-yuan.
 */
export interface ModelCallRecord {
  /** The request id the core gave, `r<tick>-<n>`. */
  id: string;
  /** The tick of the call of the core that made the request. */
  tick: number;
  /** What the answer is for (`reply`, `prefetch`, `director`, `paper`, `reflection`), if the core says. */
  category: string | null;
  /** The tier the world asked for and the tier the request went out on. `template` is no tier: the line came from the script. */
  asked: string;
  tier: string;
  /** Why the budget gate moved it down: `budget`, `cloud_down` or `local_down`. */
  reason: string | null;
  /** The model that answered, when the host knows it. */
  model: string | null;
  /** The money held for it while it is in flight. */
  hold: number | null;
  status: CallStatus;
  /** For an `error`, its short code (`http_429`, `network`, `no_key`, ...). */
  code: string | null;
  latency_ms: number | null;
  /** The tokens the provider reported. Null where nobody knows them (a timeout, a cancel). */
  usage: Usage | null;
  /** What the core booked when it settled the request. Null while it is in flight, and for a game with no prices. */
  cost: number | null;
  /** The tick of the call of the core that applied the result. */
  settled: number | null;
  /** An answer that came after the core had settled the request, which the core booked to nobody. */
  late: boolean;
  /** The core threw the answer away: `cancelled`, `invalid`. */
  voided: string | null;
}

// --- Host statistics, as shown in the client -------------------------------------------------

export interface ModelCounters {
  started: number;
  ok: number;
  error: number;
  timeout: number;
  cancelled: number;
  inflight: number;
  discarded: number;
  cancelUnknown: number;
}

export interface LastModelResult {
  request_id: string;
  status: ModelStatus;
  code?: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
}

export interface HostStats {
  nextTick: number;
  calls: number;
  /** Time inside Game.step, including the JSON that goes in and comes out. */
  pyMeanMs: number;
  pyP95Ms: number;
  pyMaxMs: number;
  /** Everything the host does for one call: step, parsing, logging, posting the frame. */
  hostMeanMs: number;
  hostMaxMs: number;
  /** Game time the accumulator dropped because the worker fell too far behind. */
  droppedMs: number;
  inputsLogged: number;
  pending: number;
  paused: boolean;
  reasons: PauseReason[];
  rate: [number, number];
  models: ModelCounters;
  lastModel: LastModelResult | null;
}

// --- Messages: page to worker ---------------------------------------------------------------

export interface InitMessage {
  type: "init";
  /** `play` (the default) starts a game. `replay` starts a host that plays a recording and nothing else. */
  mode?: "play" | "replay";
  /** Absolute URL of the directory that holds the Pyodide runtime files. */
  pyodideBase: string;
  /** Absolute URL of the directory that holds the core wheel and its manifest. */
  coreBase: string;
  seed: number;
  scenario: string;
  /**
   * The name of a game of the core, such as `slice`. The host asks the core for its seed, scenario and config (some of
   * which are texts that a page cannot know of), and plays that game: `seed` and `scenario` are then not read.
   */
  preset?: string;
  hidden: boolean;
  /** Test builds only: multiplies real time before it reaches the accumulator. */
  pace?: number;
  /** Test builds only: pause once, as the player would, when this many ticks have been simulated. */
  pauseAtTick?: number;
  /** Test builds only: keys of the game's config, such as `days` and `dev_actions`. */
  config?: Record<string, number>;
}

export interface ConfigureMessage {
  type: "configure";
  provider: ProviderId | null;
  /** Set for this provider and kept in worker memory. An empty string clears it. */
  key?: string;
  /** Ollama only: the local model name. */
  model?: string;
  /** Test builds only. */
  baseUrl?: string;
}

export type CallOp =
  | { op: "save"; name?: string; page?: PageNotes }
  | { op: "load"; id: number }
  | { op: "list-saves" }
  | { op: "delete-save"; id: number }
  | { op: "export" }
  /** The whole ending of the running game with its reveal, or null before it has ended. */
  | { op: "ending" }
  /**
   * What an action would ask, give and cost, and what stands in its way, as the core would settle it now:
   * `{version, cost, asks, gives, blockers, odds, reasons}`, or null in a game that has no previews. The action is
   * `{verb, npc, ...}` with the fields of the action to come (`verb` being the `type` it will have). It reads the world
   * and changes nothing: it is not an input of the core and is not in a recording. An action the core cannot read
   * fails with the code `bad_action`.
   */
  | { op: "preview"; action: Record<string, unknown> };

/** What the page asks of a host that plays a recording (see player.ts). */
export type ReplayControl =
  /** Takes a recording (a `Replay`, checked here) and goes to `tick`, which is the first one by default. It plays at once unless `play` is false. */
  | { op: "open"; replay: unknown; tick?: number; play?: boolean }
  /** Goes to the world as it stood when `tick` ticks had been simulated. */
  | { op: "seek"; tick: number }
  | { op: "speed"; speed: number };

export type PageToHost =
  | InitMessage
  | { type: "replay"; control: ReplayControl }
  | { type: "pause"; reason: PauseReason }
  | { type: "resume"; reason: PauseReason }
  | { type: "player"; body: Record<string, unknown> }
  /**
   * How fast the clock of the day runs, as a multiple of the common pace (the player's "speed" in the top bar). It
   * changes how many ticks a second the host asks of the core, and nothing the core does, so it is not in a replay.
   * `skip` says the pace is that of a skip to the next thing, for which the host takes a higher pace than for the
   * player's choice.
   */
  | { type: "speed"; speed: number; skip?: boolean }
  /**
   * Starts another game. With a `preset` it is the game of the core by that name, and `seed` and `variant` (the story that is true) say
   * which case of its rules it is; without either it is the first game of the name. Without a `preset` it is a game of `seed`.
   */
  | { type: "new-game"; seed?: number; scenario?: string; preset?: string; variant?: string }
  | ConfigureMessage
  | { type: "call"; reqId: number; call: CallOp }
  | { type: "e2e"; reqId: number; op: string; args?: unknown };

// --- Messages: worker to page ---------------------------------------------------------------

export interface ReadyInfo {
  timings: {
    /** Fetching and starting the Pyodide runtime. */
    pyodideMs: number;
    /** Fetching, checking and unpacking the wheel. */
    wheelMs: number;
    /** Importing the core and constructing the first Game. */
    coreMs: number;
    /** From the start of boot to ready. */
    totalMs: number;
  };
  coreVersion: string;
  coreFormat: number;
  pyodideVersion: string;
  pythonVersion: string;
  wheel: { name: string; bytes: number; sha256: string };
  seed: number;
  scenario: string;
}

export interface LoadInfo {
  id: number;
  name: string;
  tick: number;
  /** The hash of the rebuilt state, taken before the hold that follows a load. */
  hash: string;
  /** The hash recorded when the save was made. */
  savedHash: string;
  match: boolean;
  hashesChecked: number;
  reissued: number;
  cancelledOpen: number;
  /** What the page kept with the save, if it kept anything. */
  page?: PageNotes;
}

/** Where a host that plays a recording has got to. */
export interface ReplayStatus {
  /** `loading` until the first picture is there, `ready` while there is one, `failed` when the recording does not replay. */
  phase: "idle" | "loading" | "ready" | "failed";
  /** The ticks simulated so far, which is the tick the next call applies at. */
  tick: number;
  /** The ticks in the recording. */
  endTick: number;
  playing: boolean;
  /** Times the pace of the recorded game. */
  speed: number;
  /** A build or a seek is running, and how far it has got, from 0 to 1. */
  busy: boolean;
  progress: number;
  /** The recording has been played to its end. */
  ended: boolean;
  /** The ticks that have a snapshot to start from: the recording's own and the ones taken on the way. */
  snapshots: number;
  seed: number;
  scenario: string;
  coreVersion: string;
  host: string;
  error: { code: string; message: string } | null;
}

export type HostToPage =
  | { type: "boot"; stage: string; ms: number }
  | { type: "replay"; status: ReplayStatus }
  | ({ type: "ready" } & ReadyInfo)
  | {
      type: "frame";
      tick: number;
      advanced: boolean;
      frame: Frame;
      events: CoreEvent[];
      clock: ClockOutput;
      hash?: string;
    }
  | { type: "stats"; stats: HostStats }
  | { type: "reset"; seed: number; scenario: string }
  /** The scene of the game that is running now, sent whenever a game is created or swapped in. */
  | { type: "scene"; scene: Record<string, unknown> }
  /**
   * The whole ending of the game that is running now, reveal included (`Game.ending_json()`), or null
   * before it has ended. It follows the scene whenever a game is created or swapped in, and the server
   * host puts it in its `state`. The frames of a game that is over carry the ending without its reveal.
   */
  | { type: "ending"; ending: Record<string, unknown> | null }
  /**
   * The model calls that changed in a call of the core, listed before the frame that carries the money
   * they booked. `replace` is true for the whole list (a page that comes to a game that is running).
   */
  | { type: "model-calls"; replace: boolean; calls: ModelCallRecord[] }
  | { type: "loaded"; info: LoadInfo }
  | { type: "reply"; reqId: number; ok: true; result: unknown }
  | { type: "reply"; reqId: number; ok: false; error: { code: string; message: string } }
  | { type: "fatal"; code: string; message: string }
  | { type: "csp-violation"; directive: string; blocked: string }
  | { type: "notice"; code: string; message: string };

export class HostError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HostError";
  }
}
