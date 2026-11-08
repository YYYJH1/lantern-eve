/**
 * The player's side of the game: what the page does with the actions of the festival manager and
 * with what the core answers. It sends the actions of core/lantern_core/world/bridge/player.py
 * (`move`, `talk`, `leave`, `ask`, `ask_source`, `listen`, `look`), the call for helpers (`rally`),
 * and the actions that the town offers for a choice (`tell`, `entrust`, `promise`, `speak`). It listens
 * to the events that come back with each frame: the acknowledgement of each action (a refusal is
 * shown with its reason), the walk, the talk and what was said in it, what was written into the
 * notebook, what came of the manager's dealings with people (`deals.ts`), and the ending.
 *
 * The core decides everything. The page keeps only what it needs to draw and to explain: where the
 * player was told to go, whom they are walking up to, the lines of the talk in progress, the notes
 * over the map, a reply that is slow to come, and the ending.
 *
 * The ending comes whole (with its reveal) in the `ending` event and in the frame of that call, and
 * from the host in an `ending` message when a game is created, loaded or sent in a state. The frames
 * after the call that made it carry the ending without its reveal. The page shows the first whole
 * ending it gets and keeps it, and when a frame is all it has it shows the label and the numbers and
 * asks the host for the whole.
 */
import type { CoreEvent, HostToPage, SaveMeta } from "../shared/protocol.ts";
import { type AutoMark, Autosave } from "./autosave.ts";
import type { HostClient } from "./client.ts";
import { dealingNote, refusalKey } from "./deals.ts";
import { endingFromHud, type EndingView, readEnding } from "./ending.ts";
import { Flows } from "./flows.ts";
import { type LeavesAt, readFrame, readLeavesAt, type ViewFrame } from "./frame.ts";
import { Guide } from "./guide.ts";
import { WorldHold } from "./hold.ts";
import type { MessageKey } from "../i18n/index.ts";
import { readNotebook } from "./notebook.ts";
import { failureOf, type SaveFailure, SaveNotices } from "./save-notice.ts";
import { type Name, parseScene, type Scene } from "./scene.ts";
import { Skip } from "./skip.ts";
import { EMPTY_SLICE, readSlice, type SliceFrame } from "./slice.ts";
import { countName } from "./ui/paper-text.ts";

/** How close to a person the player must stand to talk to them: the core's `TALK_RANGE`, in cells. */
export const TALK_RANGE = 2;
/** How long a note stays over the map, in milliseconds. */
export const NOTE_MS = 5200;
const MAX_NOTES = 4;
/** How long the line that says a reply is slow to come stays, if nothing ends it first, in milliseconds. */
export const THINKING_MS = 20_000;
/** How long a ring stays on the map round the person or the place it draws the eye to, in milliseconds. */
export const PING_MS = 4200;
/** An approach gives up after this many orders to walk. */
const MAX_APPROACH_ORDERS = 7;
/** The ticks between two orders of one approach. */
const APPROACH_GAP = 10;

export type NoteValues = Record<string, string | number | Name>;

export interface PlayNote {
  id: number;
  /** `refused` is the town saying no, `bad` news that goes against the player, `info` everything else. */
  kind: "refused" | "info" | "bad";
  key: MessageKey;
  values: NoteValues;
  /** For a refusal, the reason the core gave. */
  reason: string | null;
}

/** What the player does in a talk, as the lines of the talk name it. */
export type TalkAct = "ask" | "source" | "tell" | "entrust" | "promise";
export type TalkLine = { who: "you"; how: TalkAct; subject: Name } | { who: "them"; text: Name; /** The people the line sends the player to. */ points?: string[] };

/** The player's actions that are a line of a talk, and the act each is. */
const TALK_ACTS: Readonly<Record<string, TalkAct>> = { ask: "ask", ask_source: "source", tell: "tell", entrust: "entrust", promise: "promise" };

export interface Destination {
  x: number;
  y: number;
  place: string | null;
  /** True once the core has said yes. */
  walking: boolean;
}

export interface PlayState {
  notes: PlayNote[];
  destination: Destination | null;
  /** The person the player is walking up to, to talk to them. */
  approach: { npc: string; orders: number; lastTick: number } | null;
  talk: {
    npc: string;
    lines: TalkLine[];
    /** The time of day at which the person has to go, when the core said. */
    leavesAt: LeavesAt | null;
    /** What the person said as the talk opened (the greeting the core chose), when they said something: the log of the talk begins with it. */
    opening?: Name;
  } | null;
  /**
   * A reply the player waits for that is slow to come (the server host says so with a `thinking`
   * notice): whose it is, and the line of theirs on show when the notice came, so that a new line
   * ends it. The core's `replied` event ends it too, whether or not the line is a new one.
   */
  thinking: { npc: string; shown: string } | null;
  /** Ids of the notebook entries that were added and that the player has not seen yet. */
  fresh: string[];
  ending: EndingView | null;
  /** Whether the ending page is showing. It can be put away to look at the town. */
  endingOpen: boolean;
  /** The autosave that was made a moment ago, which the page says so for. */
  saved: AutoMark | null;
  /** The kind of the save that could not be made, which the page says so for until the player puts the notice away or a save is made. */
  saveFailed: SaveFailure | null;
  /** Somebody the page draws the eye to on the map for a few seconds: a person a reply pointed to, a person a step of the guide is about. */
  ping: Ping | null;
}

/** A ring on the map round a person or a place, until `until` on the clock of the page. */
export interface Ping {
  id: string;
  kind: "person" | "place";
  until: number;
}

export interface Sent {
  type: string;
  /** What the action was about, for the lines of a talk. */
  subject?: Name;
  npc?: string;
  /** A walk that is part of an approach. */
  approach?: boolean;
  /** The flow of the slice (a request with its preview, a judgement, a hint, a speech in public) that waits for the answer, which `Flows` takes. */
  flow?: "request" | "judge" | "hint" | "clarify" | "statement";
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const fresh = (): PlayState => ({ notes: [], destination: null, approach: null, talk: null, thinking: null, fresh: [], ending: null, endingOpen: false, saved: null, saveFailed: null, ping: null });

/** How long the line that says the game was saved by itself stays over the map, in milliseconds. */
export const SAVED_MS = 3500;

/** Chebyshev distance, as the king walks, which is how the core measures reach. */
export const cellDistance = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

export class Play {
  state: PlayState = fresh();
  /** The latest frame, read. */
  view: ViewFrame | null = null;
  /** The events of the frame being read, for what has to look at the whole of a frame. */
  frameEvents: readonly CoreEvent[] = [];
  /** The flows of the page: tasks, requests with a preview, the notebook's pairing, the recap. */
  readonly flows: Flows = new Flows(this);
  /** Why the world is held by the page: the notebook, a card of the guide. */
  readonly hold: WorldHold;
  /** The help: the tutorial of the first day, the signals of the world, the clan elder. */
  readonly guide: Guide = new Guide(this);
  /** The button that skips to the next thing: when it is offered, and the run at a high pace that it begins. */
  readonly skip: Skip = new Skip(this);
  /** The saves the page makes by itself, each morning and at the ending (`autosave.ts`). */
  readonly autosave: Autosave;
  /** What the page has said of saves that failed, which outlives a new game: the trouble is the browser's. */
  private readonly saveNotices = new SaveNotices();

  private readonly sent = new Map<string, Sent>();
  private noteId = 1;
  private knownEntries: Set<string> | null = null;
  /** Ids of the people who joined the call in the frame being read. */
  private joined: string[] = [];
  private sceneRaw: object | null = null;
  private parsed: Scene | null = null;
  private tick = 0;
  /** Counts the games the page has seen, so that the answer to a question about an earlier game is not taken for this one's. */
  private epoch = 0;
  /** Whether the host has been asked for the whole ending of this game. */
  private asked = false;
  /** Whether the cloud could be reached as of the last frame that said, to note a change. */
  private cloud: boolean | null = null;

  /**
   * `readOnly` is for the page that plays a recording: nothing it does is sent, and no game is played
   * (`playing` is false), so that a click on the map or on a person is a look and no more.
   */
  constructor(
    private readonly client: HostClient,
    private readonly readOnly = false,
  ) {
    this.hold = new WorldHold(client);
    this.autosave = new Autosave(client);
    this.autosave.onSaved = (mark) => this.noteSaved(mark);
    this.autosave.onFailed = (err) => this.noteSaveFailed(err);
    client.tap((message) => this.onMessage(message));
    // A save keeps what the page has that the core does not: the paper or the recap of the morning and the summary of the night, until the player puts them away.
    if (!readOnly) client.pageNotes = () => this.flows.keep();
  }

  /** Whether this is the page of a recording, which acts for nobody. */
  get isReadOnly(): boolean {
    return this.readOnly;
  }

  /** The scene of the running game, read once for each time it changes. */
  get scene(): Scene | null {
    const raw = this.client.state.scene;
    if (raw !== this.sceneRaw) {
      this.sceneRaw = raw;
      this.parsed = raw === null ? null : parseScene(raw);
    }
    return this.parsed;
  }

  /** The tick of the latest frame. */
  get now(): number {
    return this.tick;
  }

  /** The host client behind this player's side. */
  get hostClient(): HostClient {
    return this.client;
  }

  private sliceRaw: object | null = null;
  private sliceRead: SliceFrame = EMPTY_SLICE;

  /** What the latest frame says of the slice (tasks, commitments, the recap), read once for each frame. */
  get slice(): SliceFrame {
    const raw = this.view?.raw ?? null;
    if (raw !== this.sliceRaw) {
      this.sliceRaw = raw;
      this.sliceRead = raw === null ? EMPTY_SLICE : readSlice(raw);
    }
    return this.sliceRead;
  }

  /** Tells the views that something on the player's side changed. */
  touch(): void {
    this.client.touch();
  }

  /** Set by the page: brings a person into view, which is to pick them on the map and show their card. */
  onFocus: ((id: string) => void) | null = null;

  /** Draws the eye to a person or a place on the map with a ring, for a few seconds. */
  ping(id: string, kind: Ping["kind"] = "person", ms = PING_MS): void {
    const ping: Ping = { id, kind, until: performance.now() + ms };
    this.state.ping = ping;
    this.client.touch();
    setTimeout(() => {
      if (this.state.ping !== ping) return;
      this.state.ping = null;
      this.client.touch();
    }, ms);
  }

  /** A reply has sent the player to somebody: they are brought into view, ringed on the map, and become a lead. */
  pointTo(npc: string, from: string): void {
    if (this.readOnly) return;
    this.flows.addLead(npc, from);
    this.ping(npc);
    this.onFocus?.(npc);
    this.client.touch();
  }

  /** Whether this game has a player to act for: the bridge town does, the demo world does not. */
  get playing(): boolean {
    return !this.readOnly && this.scene?.player != null && this.view?.player != null;
  }

  // --- Actions ----------------------------------------------------------------------------

  /**
   * Whether the world is running fast to pay for an act of the talk: a talk is open, the clock is not held, and it runs faster
   * than the common pace (the core's `[20, 1]`). The badge says that time is passing meanwhile.
   */
  get paying(): boolean {
    const s = this.client.state;
    return this.state.talk !== null && !s.paused && s.rate[0] > s.rate[1];
  }

  /**
   * Whether an act of the talk is still to be paid for: a talk is open and the clock runs faster than the common pace, held by the
   * player's pause or not. Another act would pile up on it, so the acts wait until the world stands still again. Leaving does not
   * wait.
   */
  get owing(): boolean {
    const s = this.client.state;
    return this.state.talk !== null && s.rate[0] > s.rate[1];
  }

  /** Sends an action of the manager and remembers what it was about, to read the core's answer by. */
  send(body: Record<string, unknown>, extra: Omit<Sent, "type"> = {}): string {
    if (this.readOnly) return "";
    const id = this.client.player(body);
    this.sent.set(id, { type: String(body.type), ...extra });
    if (this.sent.size > 40) {
      const oldest = this.sent.keys().next();
      if (oldest.done !== true) this.sent.delete(oldest.value);
    }
    return id;
  }

  /** A click on the ground: walk to the place if it was on one, else to the cell. */
  goTo(hit: { x: number; y: number; place: string | null }): void {
    if (!this.playing) return;
    this.state.approach = null;
    const place = hit.place === null ? undefined : this.scene?.places.find((p) => p.id === hit.place);
    if (place !== undefined) {
      const door = place.door;
      this.state.destination = door === null ? null : { x: door[0], y: door[1], place: place.id, walking: false };
      this.send({ type: "move", place: place.id });
    } else {
      this.state.destination = { x: hit.x, y: hit.y, place: null, walking: false };
      this.send({ type: "move", x: hit.x, y: hit.y });
    }
    this.client.touch();
  }

  /** Talks to a person now if they are within reach, and walks up to them first if they are not. */
  talkOrWalk(npc: string): void {
    const view = this.view;
    const me = view?.player;
    const them = view?.people.find((p) => p.id === npc);
    if (me == null || them === undefined || !this.playing) return;
    if (cellDistance(me, them) <= TALK_RANGE) this.talk(npc);
    else this.walkUpTo(npc);
  }

  talk(npc: string): void {
    if (!this.playing) return;
    this.state.approach = null;
    this.send({ type: "talk", npc }, { npc });
  }

  /** Orders a walk to where the person stands, and talks to them when the player is close enough. */
  walkUpTo(npc: string): void {
    const them = this.view?.people.find((p) => p.id === npc);
    if (them === undefined || !this.playing) return;
    this.state.approach = { npc, orders: 0, lastTick: this.tick };
    this.orderApproach(them.x, them.y);
    this.client.touch();
  }

  private orderApproach(x: number, y: number): void {
    const approach = this.state.approach;
    if (approach === null) return;
    approach.orders++;
    approach.lastTick = this.tick;
    this.state.destination = { x, y, place: null, walking: false };
    this.send({ type: "move", x, y }, { approach: true });
  }

  leave(): void {
    this.send({ type: "leave" });
  }

  ask(topic: string, subject: Name): void {
    this.send({ type: "ask", topic }, { subject });
  }

  askSource(entry: string, subject: Name): void {
    this.send({ type: "ask_source", entry }, { subject });
  }

  listen(): void {
    this.send({ type: "listen" });
  }

  look(at: string): void {
    this.send({ type: "look", at });
  }

  rally(): void {
    this.send({ type: "rally" });
  }

  /**
   * An action that the town offers as a choice (telling, entrusting, promising, speaking): the fields
   * of its body are the town's own, and `subject` names it for the lines of the talk.
   */
  other(verb: string, fields: Record<string, unknown>, subject?: Name): void {
    this.send({ ...fields, type: verb }, subject === undefined ? {} : { subject });
  }

  // --- The page ---------------------------------------------------------------------------

  /** The player has looked at the notebook: what was new in it is not new any more. */
  markSeen(): void {
    if (this.state.fresh.length === 0) return;
    this.state.fresh = [];
    this.client.touch();
  }

  showEnding(open: boolean): void {
    this.state.endingOpen = open;
    this.client.touch();
  }

  dismissNote(id: number): void {
    this.state.notes = this.state.notes.filter((n) => n.id !== id);
    this.client.touch();
  }

  note(kind: PlayNote["kind"], key: MessageKey, values: NoteValues = {}, reason: string | null = null): void {
    const id = this.noteId++;
    this.state.notes.push({ id, kind, key, values, reason });
    if (this.state.notes.length > MAX_NOTES) this.state.notes.shift();
    setTimeout(() => {
      if (!this.state.notes.some((n) => n.id === id)) return;
      this.state.notes = this.state.notes.filter((n) => n.id !== id);
      this.client.touch();
    }, NOTE_MS);
  }

  // --- What comes back --------------------------------------------------------------------

  private onMessage(message: HostToPage): void {
    if (message.type === "reset") {
      this.state = fresh();
      this.flows.reset();
      this.guide.reset();
      this.skip.reset();
      this.autosave.reset();
      this.frameEvents = [];
      this.view = null;
      this.knownEntries = null;
      this.sent.clear();
      this.epoch++;
      this.asked = false;
      this.cloud = null;
      return;
    }
    if (message.type === "loaded") {
      // The game was rebuilt from a save, and the frame of its last tick has come. What the page kept with the save comes back.
      this.flows.restore(message.info.page);
      this.skip.reset();
      return;
    }
    if (message.type === "ending") {
      if (message.ending !== null) this.takeEnding(message.ending);
      return;
    }
    if (message.type === "notice") {
      if (message.code === "thinking") this.onThinking();
      return;
    }
    if (message.type !== "frame") return;
    const view = readFrame(message.frame);
    this.view = view;
    this.tick = message.tick;
    this.frameEvents = message.events;
    const declined = new Set<string>();
    for (const event of message.events) this.onEvent(event, view, declined);
    this.afterFrame(view, message.tick);
  }

  /** The line of the person that is on show over their head, as a value to tell a new line from it. */
  private lineOf(npc: string): string {
    const said = this.view?.bubbles.find((b) => b.npc === npc && this.tick < b.until);
    return said === undefined ? "" : JSON.stringify(said.text);
  }

  /** A reply is slow to come: say so while the talk lasts, until the person speaks or a few seconds have gone. */
  private onThinking(): void {
    const talk = this.state.talk;
    if (talk === null) return;
    const thinking = { npc: talk.npc, shown: this.lineOf(talk.npc) };
    this.state.thinking = thinking;
    this.client.touch();
    setTimeout(() => {
      if (this.state.thinking !== thinking) return;
      this.state.thinking = null;
      this.client.touch();
    }, THINKING_MS);
  }

  /**
   * Takes in an ending that the host sent. A whole one (with a reveal) is shown and kept, and replaces the
   * compact one the page has shown from a frame. The page does not hold the world for it: that is for an
   * ending that comes as an event.
   */
  private takeEnding(raw: Record<string, unknown>): void {
    const ending = readEnding(raw);
    if (ending.id === "") return;
    const had = this.state.ending;
    if (had !== null && (had.reveal !== null || ending.reveal === null)) return;
    this.state.ending = ending;
    if (had === null) this.state.endingOpen = true;
    this.client.touch();
  }

  /** Asks the host, once for each game, for the whole ending when the page has seen only the frame's. */
  private askForEnding(): void {
    if (this.asked) return;
    this.asked = true;
    const epoch = this.epoch;
    this.client.call<unknown>({ op: "ending" }).then(
      (ending) => {
        if (epoch === this.epoch && isRecord(ending)) this.takeEnding(ending);
      },
      () => undefined, // the host cannot say, and the page keeps the label and the numbers it has
    );
  }

  nameOf(id: string): Name {
    const scene = this.scene;
    const person = scene?.cast.find((p) => p.id === id);
    if (person !== undefined) return person.name;
    if (scene?.player?.id === id) return scene.player.name;
    const place = scene?.places.find((p) => p.id === id);
    if (place !== undefined) return place.name;
    const thing = scene?.player?.things.find((t) => t.id === id);
    if (thing !== undefined) return thing.name;
    return { zh: id, en: id };
  }

  private onEvent(event: CoreEvent, view: ViewFrame, declined: Set<string>): void {
    switch (event.kind) {
      case "action_ack":
        this.onAck(event, view, declined);
        break;
      case "talk_start":
        if (typeof event.npc === "string") {
          // Whoever the player was sent to, they have come to them: the lead is followed.
          this.flows.dropLead(event.npc);
          // The words the person has on show as the talk opens are their greeting. The bar says them too.
          const greeting = view.bubbles.find((b) => b.npc === event.npc && this.tick < b.until);
          this.state.talk = { npc: event.npc, lines: [], leavesAt: readLeavesAt(event.leaves_at), ...(greeting === undefined ? {} : { opening: greeting.text }) };
        }
        break;
      case "replied":
        // The person has said the line the player was waiting for. It ends the wait even if the line is the one they said before.
        if (this.state.thinking !== null && this.state.thinking.npc === event.npc) this.state.thinking = null;
        break;
      case "talk_end":
        this.state.talk = null;
        this.state.thinking = null;
        if (event.reason === "timeout" && typeof event.npc === "string") this.note("info", "note.talkTimeout", { name: this.nameOf(event.npc) });
        break;
      case "declined":
        if (typeof event.npc === "string") {
          declined.add(event.npc);
          const reason = event.reason === "asleep" ? "asleep" : "busy";
          this.note("refused", reason === "asleep" ? "ack.talk.asleep" : "ack.talk.busy", { name: this.nameOf(event.npc) }, reason);
        }
        break;
      case "arrived": {
        const d = this.state.destination;
        if (d !== null && d.x === event.x && d.y === event.y) this.state.destination = null;
        break;
      }
      case "look_start":
        if (typeof event.at === "string") this.note("info", "note.looking", { what: this.nameOf(event.at) });
        break;
      case "inspected": {
        const written = Array.isArray(event.entries) ? event.entries.length : 0;
        this.note("info", written > 0 ? "note.inspected.some" : "note.inspected.none", { n: countName(written) });
        break;
      }
      case "heard":
        if (typeof event.speaker === "string" && typeof event.listener === "string") {
          this.note("info", event.new === true ? "note.heard.new" : "note.heard.old", { speaker: this.nameOf(event.speaker), listener: this.nameOf(event.listener) });
        }
        break;
      case "rally":
        this.note("info", "note.rally");
        break;
      case "budget_stage":
        // The budget crossed a limit, up or down: say what the gate does now.
        if (event.stage === 0 || event.stage === 1 || event.stage === 2) {
          this.note(event.stage === 0 ? "info" : "bad", `note.budget.${event.stage}` as const);
        }
        break;
      case "joined":
        this.joined.push(typeof event.npc === "string" ? event.npc : "");
        break;
      case "ending":
        this.state.ending = readEnding(event);
        this.state.endingOpen = true;
        this.state.talk = null;
        this.state.thinking = null;
        this.state.approach = null;
        this.state.destination = null;
        // The story is over. The town stays as it was until the player starts another game.
        this.client.pause();
        this.autosave.ending(view.time);
        break;
      default: {
        // What came of telling, entrusting, promising and speaking in public.
        const dealing = dealingNote(event, { nameOf: (id) => this.nameOf(id), playerId: this.scene?.player?.id ?? "player" });
        if (dealing !== null) this.note(dealing.kind, dealing.key, dealing.values);
        // The events of the slice: a clarification, a task that changed, a promise, a delivery, the recap.
        this.flows.onEvent(event);
        this.guide.onEvent(event);
      }
    }
  }

  private onAck(event: CoreEvent, view: ViewFrame, declined: Set<string>): void {
    const id = typeof event.action_id === "string" ? event.action_id : null;
    const meta = id === null ? undefined : this.sent.get(id);
    if (meta === undefined || event.result === "duplicate") return;
    if (id !== null) this.sent.delete(id);
    const reason = typeof event.reason === "string" ? event.reason : null;
    if (event.result === "rejected") {
      // A request with a preview and a judgement show the answer where they were made, and not in a note over the map.
      if (meta.flow !== undefined && id !== null) this.flows.onRejected(meta.flow, id, reason);
      else this.refused(meta, reason, declined);
      return;
    }
    if (meta.type === "move" && this.state.destination !== null) this.state.destination.walking = true;
    const act = TALK_ACTS[meta.type];
    if (act !== undefined && this.state.talk !== null && meta.subject !== undefined) {
      const talk = this.state.talk;
      talk.lines.push({ who: "you", how: act, subject: meta.subject });
      const said = view.bubbles.find((b) => b.npc === talk.npc && this.tick < b.until);
      if (said !== undefined) {
        const pointer = this.pointerOf(talk.npc);
        talk.lines.push(pointer === null ? { who: "them", text: said.text } : { who: "them", text: said.text, points: [pointer] });
      }
    }
    if (meta.flow !== undefined && id !== null) this.flows.onApplied(meta.flow, id);
  }

  /**
   * The person a reply sends the player to ("I don't know, but I heard Zhou Erlang speak of it. Go and ask."): the id that the
   * event `asked` of the answer carries as `pointer`, only for an answer that points the way. The line itself names the person in
   * words and is never read for it.
   */
  private pointerOf(partner: string): string | null {
    const asked = this.frameEvents.find((e) => e.kind === "asked" && e.npc === partner);
    return asked !== undefined && typeof asked.pointer === "string" && asked.pointer !== "" ? asked.pointer : null;
  }

  private refused(meta: Sent, reason: string | null, declined: Set<string>): void {
    if (meta.type === "move") {
      this.state.destination = null;
      if (meta.approach === true) this.state.approach = null;
    }
    const why = reason ?? "unknown";
    // A person who will not talk has been noted already, from the event that says so.
    if (meta.type === "talk" && meta.npc !== undefined && declined.has(meta.npc)) return;
    const values: NoteValues = { reason: why };
    if (meta.npc !== undefined) values.name = this.nameOf(meta.npc);
    this.note("refused", refusalKey(meta.type, why), values, why);
  }

  private afterFrame(view: ViewFrame, tick: number): void {
    const state = this.state;
    const me = view.player;

    // The notebook: what is new in it since the last frame.
    const entries = readNotebook(view.raw);
    this.flows.afterFrame(entries === null ? null : new Set(entries.map((e) => e.id)));
    this.guide.afterFrame(view, tick);
    if (entries !== null) {
      const ids = entries.map((e) => e.id);
      if (this.knownEntries !== null) {
        const added = ids.filter((id) => !this.knownEntries?.has(id) && !state.fresh.includes(id));
        if (added.length > 0) state.fresh.push(...added);
      }
      this.knownEntries = new Set(ids);
    }

    // The cloud: said once when the host says it cannot be reached, and once when it can be again.
    const cloud = view.hud.cloud;
    if (typeof cloud === "boolean") {
      if (this.cloud !== null && cloud !== this.cloud) this.note(cloud ? "info" : "bad", cloud ? "note.cloudUp" : "note.cloudDown");
      this.cloud = cloud;
    }

    // The festival: those who joined in this frame, in one line.
    if (this.joined.length > 0) {
      const names = this.joined.filter((id) => id !== "").map((id) => this.nameOf(id));
      this.joined = [];
      const shown = names.slice(0, 2);
      if (shown.length > 0) {
        const rest = names.length - shown.length;
        const list: Name = { zh: shown.map((n) => n.zh).join("、"), en: shown.map((n) => n.en).join(", ") };
        this.note("info", rest > 0 ? "note.joinedMore" : "note.joined", { names: list, n: countName(rest) });
      }
    }

    // The talk the frame says is on.
    if (me?.talk != null) {
      if (state.talk === null || state.talk.npc !== me.talk.npc) state.talk = { npc: me.talk.npc, lines: [], leavesAt: me.talk.leavesAt };
      // The hour at which the person has to go is the frame's to say, in each frame.
      else state.talk.leavesAt = me.talk.leavesAt;
    } else if (state.talk !== null) {
      state.talk = null;
    }

    // The walk: done when the player is where they were sent, or has stopped.
    const dest = state.destination;
    if (dest !== null && me != null && ((me.x === dest.x && me.y === dest.y) || (dest.walking && me.activity !== "walk"))) state.destination = null;

    // Walking up to someone: talk when close enough, and walk on when they have moved away.
    const approach = state.approach;
    if (approach !== null) {
      const them = view.people.find((p) => p.id === approach.npc);
      if (me == null || them === undefined || me.talk != null) {
        state.approach = null;
      } else if (cellDistance(me, them) <= TALK_RANGE) {
        state.approach = null;
        this.send({ type: "talk", npc: approach.npc }, { npc: approach.npc });
      } else if (me.activity !== "walk" && tick - approach.lastTick >= APPROACH_GAP) {
        if (approach.orders >= MAX_APPROACH_ORDERS) state.approach = null;
        else this.orderApproach(them.x, them.y);
      }
    }

    // The line that says a reply is slow ends when the person speaks again or the talk is over.
    if (state.thinking !== null && (state.talk?.npc !== state.thinking.npc || this.lineOf(state.thinking.npc) !== state.thinking.shown)) state.thinking = null;

    // A game that ended before the page was watching (a game that was loaded, a connection that came back):
    // the host has sent the whole ending, and if it has not come yet the frame has the ending without its
    // reveal, which says how the night went, and the host is asked for the rest. A frame that carries no
    // ending has the id in the numbers only.
    if (state.ending === null) {
      const known = view.ending;
      const id = view.hud.ending;
      if (known !== null && typeof known.ending === "string" && known.ending !== "") {
        state.ending = readEnding(known);
        state.endingOpen = true;
        if (state.ending.reveal === null) this.askForEnding();
      } else if (typeof id === "string" && id !== "") {
        state.ending = endingFromHud(id, view.hud);
        state.endingOpen = true;
      }
    }

    // A run that skips to the next thing ends when there is something to do.
    this.skip.afterFrame();
    // The morning (at its paper), or the ending that came in this frame: the game is saved, now that the frame has been read whole (the paper is kept with the save).
    // The paper is in the frame of the call that made it, whether or not the core had anything to recap (the event `recap` says it did).
    this.autosave.afterFrame(
      view.time,
      this.slice.gazette !== null || this.frameEvents.some((event) => event.kind === "recap"),
    );
    void this.autosave.flush();
  }

  /** Says for a few seconds that the game was saved by itself. */
  private noteSaved(mark: AutoMark): void {
    this.saveMade();
    this.state.saved = mark;
    this.client.touch();
    setTimeout(() => {
      if (this.state.saved !== mark) return;
      this.state.saved = null;
      this.client.touch();
    }, SAVED_MS);
  }

  /** A save was made, by the page or by the player: a notice of a save that failed is over, and the next failure is news again. */
  private saveMade(): void {
    this.saveNotices.made();
    if (this.state.saveFailed === null) return;
    this.state.saveFailed = null;
    this.client.touch();
  }

  /**
   * A save of the page's own could not be made. The notice goes over the map for each kind of failure until a save is made. It may have to wait behind a
   * card, and a game that is begun or loaded while it waits takes it away: a kind counts as told only when the notice was on screen (`saveFailureTold`),
   * so what nobody saw is told when it comes again.
   */
  private noteSaveFailed(err: unknown): void {
    const kind = failureOf(err);
    if (!this.saveNotices.due(kind)) return;
    this.state.saveFailed = kind;
    this.client.touch();
  }

  /**
   * The notice of a failed save was on screen, over the map or in the open menu, which says what came of a save the player asked for: the player was
   * told, and the same kind is not told again until a save has been made.
   */
  saveFailureTold(kind: SaveFailure): void {
    this.saveNotices.told(kind);
  }

  /** The player puts the notice of a failed save away, which they could do only with it on screen. The same kind does not come back until a save has been made. */
  dismissSaveFailure(): void {
    if (this.state.saveFailed === null) return;
    this.saveNotices.told(this.state.saveFailed);
    this.state.saveFailed = null;
    this.client.touch();
  }

  /** The player saves the game from the menu. A save that cannot be made is thrown, for the menu to say so where it says what came of a save. */
  async saveByHand(name?: string): Promise<SaveMeta> {
    const meta = await this.client.save(name);
    this.saveMade();
    return meta;
  }
}
