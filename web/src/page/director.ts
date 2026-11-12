/**
 * The show controller. A show is a script of camera stops (a place or a point, how close, how long to get there and how long to stay) that
 * takes the camera of the map somewhere, puts words over the map while it is there, and gives the camera back. Two things play shows: the
 * moments of the festival, and the festival night at the ending. The controller decides nothing in the game.
 *
 *   - A show holds the world with a pause reason of its own, `show`, and lets go of that one reason when the last show of a run is over.
 *     The player's pause (`user`), a hidden tab and the page's own holds (`page`) are never touched, so a world the player paused stays
 *     paused when the show ends.
 *   - A moment is a thing the core made and holds the world for (`moments`, `moment_hold` of the frame; core/lantern_core/world/bridge/moments.py).
 *     When a frame carries a moment the page has not seen, its show plays (about three seconds, or until a click or Esc), and then the page
 *     lets the core go on from it with the player action `{"type": "moment", "op": "release", "kind"}`. The moments a frame already has when
 *     the page begins to look (a new game, a game that was loaded, a recording taken to a position) are not played again, and a world the
 *     core holds for one of them is let go at once. A page that plays a recording sends nothing: the release is in the recording.
 *   - A game has moments when the page says it shows them. The first frame of a game that does not carry the key `moments` is answered with
 *     `{"type": "moment", "op": "watch"}`, once.
 *   - The controller is `enabled` for the page of a player (one that began with the opening page) and for the page of a recording, and for no
 *     other, so that a page made for a test of something else is not changed by it. Where it is not enabled it says nothing, shows nothing, and
 *     lets go of a world that the core holds for a moment, which only a game that another page watched can have.
 *   - The festival night is not here. At the ending, before the ending page, the controller asks the shows that were registered
 *     (`registerEndingShow`) for one, plays it and goes on to the ending page when it ends or is skipped (the button in the corner, and Esc).
 *     Without one the ending page opens at once, as it always did. A show can move the camera by its stops, draw by its `frame` and
 *     tidy up in its `end`.
 *   - The map comes up after the page does (`expectMap` says it is on its way, `attach` that it came, `mapFailed` that it cannot), and the
 *     town is on it a moment later. An ending that comes before then is kept, and its show starts when the map has the town on it, whether or
 *     not a frame of the game comes to wake the controller (a recording that is at its end sends none). The ending page opens without the show
 *     only when the map fails, or has not the town on it within `ENDING_GRACE_MS`.
 */
import type { Frame } from "../shared/protocol.ts";
import type { CameraPort, CameraPose, Eye } from "./map/camera.ts";
import type { MapView } from "./map/map-view.ts";
import type { EndingView, Festival } from "./ending.ts";
import type { ViewFrame } from "./frame.ts";
import type { Play } from "./play.ts";
import type { Name, Scene } from "./scene.ts";
import { CELL, CELL_DEPTH } from "./map/geometry.ts";

// --- The moments ---------------------------------------------------------------------------------------------------------

export const MOMENT_KINDS = ["echo", "together_work", "both_banks"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

/** A moment of the festival, as the frame lists it (`moments`). */
export interface Moment {
  kind: MomentKind;
  tick: number;
  /** Where it is shown: the place, and the cell. */
  place: string;
  x: number;
  y: number;
  /** For an echo: what came back to the manager, and who said it to them. */
  prop: string | null;
  from: string | null;
  /** For the first morning of work by both families: the day. */
  round: number | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const int = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);
const isKind = (value: unknown): value is MomentKind => typeof value === "string" && (MOMENT_KINDS as readonly string[]).includes(value);

/** The moments of a frame, in the order they happened, or null where the frame has no key `moments` (a game the page does not watch yet). */
export function readMoments(raw: unknown): Moment[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Moment[] = [];
  for (const row of raw) {
    if (!isRecord(row) || !isKind(row.kind)) continue;
    const x = int(row.x);
    const y = int(row.y);
    if (x === null || y === null) continue;
    out.push({
      kind: row.kind,
      tick: int(row.tick) ?? 0,
      place: typeof row.place === "string" ? row.place : "",
      x,
      y,
      prop: typeof row.prop === "string" ? row.prop : null,
      from: typeof row.from === "string" ? row.from : null,
      round: int(row.round),
    });
  }
  return out;
}

/** The kinds of moment the world is held for (`moment_hold`), oldest first. */
export function readHold(raw: unknown): MomentKind[] {
  return Array.isArray(raw) ? raw.filter(isKind) : [];
}

// --- Camera stops ------------------------------------------------------------------------------------------------------

/** Where a stop looks: a cell, a place (at its door), or the whole town. */
export type StopAt = { cell: readonly [number, number] } | { place: string } | "town";

/**
 * Words that stay over the map while a stop is on: the key of a text of the page, and what goes into it. A name of the game (a person) is
 * given in both languages under `names` and put into the text in the language of the page at the time it is drawn.
 */
export interface Caption {
  readonly key: string;
  readonly values?: Readonly<Record<string, string | number>>;
  readonly names?: Readonly<Record<string, Name>>;
  /** Words of the game that go between quotation marks in the text, in the language of the page. */
  readonly quotes?: Readonly<Record<string, Name>>;
  /** How it is put over the map: on a slip at the foot of it (the default), or as a title in the middle. */
  readonly style?: "slip" | "title";
}

export interface Stop {
  at: StopAt;
  /** How close, as a multiple of the zoom that shows the whole town (1 shows all of it). */
  zoom: number;
  /** Milliseconds to get there from where the camera was, with the pace easing in and out. */
  travel: number;
  /** Milliseconds to stay once there. */
  hold: number;
  caption?: Caption | null;
}

export type EndReason = "done" | "skip" | "interrupt";

export interface Show {
  /** What it is: the kind of a moment, or `festival`. It is on the page as `data-show`. */
  readonly id: string;
  readonly stops: readonly Stop[];
  /** How long it lasts, in milliseconds, if that is more than its stops take. */
  readonly duration?: number;
  /** Whether the player can end it with the button in the corner and Esc. A moment goes on at a click. */
  readonly skippable: boolean;
  /** Called every animation frame while it plays, with the milliseconds since it began and the stop that is on. */
  frame?(elapsed: number, stop: number): void;
  /** Called once when it is over, however it ended. */
  end?(reason: EndReason): void;
}

/** One stop worked out: where the camera is to look, and when the stop begins on the clock of the show. */
export interface Leg {
  to: Eye;
  start: number;
  travel: number;
  hold: number;
  caption: Caption | null;
}

const sameEye = (a: Eye | null, b: Eye): boolean => a !== null && a.x === b.x && a.y === b.y && a.zoom === b.zoom;

/** The pace of a move: slow at both ends. */
export const ease = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** The world point at the middle of a cell. */
export const worldOfCell = (x: number, y: number): { x: number; y: number } => ({ x: (x + 0.5) * CELL, y: (y + 0.5) * CELL_DEPTH });

/**
 * The legs of a script: each stop that `where` can place, one after the other. A stop it cannot place (a place the town does not have)
 * is left out.
 */
export function plan(stops: readonly Stop[], where: (at: StopAt, zoom: number) => Eye | null): Leg[] {
  const legs: Leg[] = [];
  let start = 0;
  for (const stop of stops) {
    const to = where(stop.at, stop.zoom);
    if (to === null) continue;
    const travel = Math.max(0, stop.travel);
    const hold = Math.max(0, stop.hold);
    legs.push({ to, start, travel, hold, caption: stop.caption ?? null });
    start += travel + hold;
  }
  return legs;
}

/** How long the legs take, from the first to the last. */
export const lengthOf = (legs: readonly Leg[]): number => {
  const last = legs[legs.length - 1];
  return last === undefined ? 0 : last.start + last.travel + last.hold;
};

/** Where the camera looks `elapsed` milliseconds into the legs, which stop is on, and whether they are over. The zoom is moved in its logarithm. */
export function eyeAt(from: Eye, legs: readonly Leg[], elapsed: number): { eye: Eye; stop: number; over: boolean } {
  let before = from;
  for (const [i, leg] of legs.entries()) {
    if (elapsed < leg.start + leg.travel) {
      const t = leg.travel <= 0 ? 1 : ease(Math.max(0, (elapsed - leg.start) / leg.travel));
      return {
        eye: { x: before.x + (leg.to.x - before.x) * t, y: before.y + (leg.to.y - before.y) * t, zoom: Math.exp(Math.log(before.zoom) + (Math.log(leg.to.zoom) - Math.log(before.zoom)) * t) },
        stop: i,
        over: false,
      };
    }
    if (elapsed < leg.start + leg.travel + leg.hold) return { eye: leg.to, stop: i, over: false };
    before = leg.to;
  }
  return { eye: before, stop: Math.max(0, legs.length - 1), over: true };
}

// --- The shows of the moments --------------------------------------------------------------------------------------

/** Milliseconds a moment takes to get its camera there, and to stay. About three seconds in all. */
export const MOMENT_TRAVEL_MS = 800;
export const MOMENT_HOLD_MS = 2200;
/** How close each moment looks: the words that came back, close; the work, nearer the bridge; the lanterns on both banks, wide. */
export const MOMENT_ZOOM: Readonly<Record<MomentKind, number>> = { echo: 2.6, together_work: 2.2, both_banks: 1.6 };

/** Milliseconds into the show of a moment at which the page takes its picture of the map: the camera has got there and has been still a moment. */
export const MOMENT_PICTURE_MS = MOMENT_TRAVEL_MS + 400;

/** The key of the words a moment shows over the map. An echo whose teller is not known says only that it came back. */
export const momentCaption = (kind: MomentKind, named = true): string => (kind === "echo" && !named ? "moment.echoPlain" : `moment.${kind}`);

/**
 * The show of a moment: the camera goes to where it happened and stays, with its words over the map. The words of an echo say who brought
 * the story back, by the name `nameOf` gives for that person.
 */
export function momentShow(moment: Moment, nameOf: (id: string) => Name | null = () => null): Show {
  const from = moment.kind === "echo" && moment.from !== null ? (nameOf(moment.from) ?? { zh: moment.from, en: moment.from }) : null;
  const caption: Caption = from === null ? { key: momentCaption(moment.kind, moment.kind !== "echo") } : { key: momentCaption(moment.kind), names: { from } };
  return {
    id: moment.kind,
    skippable: false,
    stops: [{ at: { cell: [moment.x, moment.y] }, zoom: MOMENT_ZOOM[moment.kind], travel: MOMENT_TRAVEL_MS, hold: MOMENT_HOLD_MS, caption }],
  };
}

// --- The festival night --------------------------------------------------------------------------------------------

/** What a show of the ending is made from. */
export interface EndingShowContext {
  ending: EndingView;
  festival: Festival;
  scene: Scene | null;
  /** The latest frame of the game, if there is one. */
  frame: ViewFrame | null;
  /** The map, to draw on, and the camera port the controller moves. */
  map: MapView | null;
  port: CameraPort;
  /** Whether the player asked the system for less motion. */
  calm: boolean;
  /** The ending as the page has it now, which may be the whole one where `ending` was the compact one (the reveal comes from the host a moment after the frame). */
  latest(): EndingView;
}

/** Makes the show of an ending, or null if it has none for it. */
export type EndingShowFactory = (context: EndingShowContext) => Show | null;

const registry: EndingShowFactory[] = [];

/** Registers a maker of the show that plays at the ending, before the ending page. Returns a function that takes it away again. */
export function registerEndingShow(factory: EndingShowFactory): () => void {
  registry.push(factory);
  return () => {
    const at = registry.indexOf(factory);
    if (at >= 0) registry.splice(at, 1);
  };
}

/** How many makers are registered, for the tests. */
export const endingShowCount = (): number => registry.length;

// --- The controller ----------------------------------------------------------------------------------------------------------

/** What the controller needs of the clock and the keyboard, so that a test can drive it by hand. */
export interface DirectorEnv {
  now(): number;
  /** Calls `fn` at the next animation frame (or soon, in a tab that is hidden). Returns a function that cancels the call. */
  later(fn: () => void): () => void;
  /** Calls `fn` after `ms`. Returns a function that cancels the call. */
  after(ms: number, fn: () => void): () => void;
  /** Calls `fn` for each key pressed, before anything else sees it; `fn` says whether it took the key. Returns a function that stops it. */
  keys(fn: (key: string) => boolean): () => void;
  /** Whether the player asked the system for less motion: the camera then goes to a stop at once and does not glide. */
  calm(): boolean;
}

/** What the controllers of the page's shows are made with where nothing else is given: the browser's own, unless a test build puts a clock of its own in the place of it (`show-clock.ts`). */
let envFactory: (() => DirectorEnv) | null = null;

/** Puts another clock under the shows of every page that is made after this, for the test build. */
export function overrideDirectorEnv(factory: (() => DirectorEnv) | null): void {
  envFactory = factory;
}

export function browserEnv(): DirectorEnv {
  return {
    now: () => performance.now(),
    later: (fn) => {
      if (typeof requestAnimationFrame === "function" && typeof document !== "undefined" && document.visibilityState === "visible") {
        const handle = requestAnimationFrame(() => fn());
        return () => cancelAnimationFrame(handle);
      }
      const handle = setTimeout(fn, 100);
      return () => clearTimeout(handle);
    },
    after: (ms, fn) => {
      const handle = setTimeout(fn, ms);
      return () => clearTimeout(handle);
    },
    keys: (fn) => {
      const listener = (event: KeyboardEvent): void => {
        if (fn(event.key)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      };
      window.addEventListener("keydown", listener, true);
      return () => window.removeEventListener("keydown", listener, true);
    },
    calm: () => {
      try {
        return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch {
        return false;
      }
    },
  };
}

/** How long the ending page waits for a show that cannot start (the map has not come up), in milliseconds. */
export const ENDING_GRACE_MS = 4000;
/** How often the controller looks at the map while an ending waits for it to have the town on it, in milliseconds. */
export const ENDING_POLL_MS = 100;

/** What is on show now, for the views. */
export interface Playing {
  show: Show;
  moment: Moment | null;
  ending: EndingView | null;
  /** The stop that is on (an index of the stops of the show), and its words. */
  stop: number;
  caption: Caption | null;
}

interface Item {
  show: Show;
  moment: Moment | null;
  ending: EndingView | null;
  /** Whether the core holds the world for it, and the page has to let it go. */
  release: boolean;
  /** Whether the picture of the moment has been taken for the album of the page (the show of an ending has none to take). */
  pictured: boolean;
}

export class Director {
  /** Whether this page shows the moments and the festival night (see the head of this file). */
  enabled = false;
  /** The camera of the map, once the map is up (`attach`). Without it no show plays, and the world is not held for one. */
  port: CameraPort | null = null;
  /** The map, for the shows that draw on it. */
  map: MapView | null = null;
  /** What is on show, or null. */
  current: Playing | null = null;

  private queue: Item[] = [];
  /** The item that is on show, which `current` is the view of. */
  private item: Item | null = null;
  private legs: Leg[] = [];
  private from: Eye = { x: 0, y: 0, zoom: 1 };
  /** Where the camera was last put by the show that is on. */
  private looked: Eye | null = null;
  private startedAt = 0;
  private length = 0;
  /** The camera as the player left it, while a run of shows holds the world. */
  private saved: CameraPose | null = null;
  /** Whether the controller holds the world with the reason `show`. */
  private paused = false;
  private stopLoop: (() => void) | null = null;
  private stopKeys: (() => void) | null = null;
  /** The kinds of moment the page has seen in this game. */
  private readonly seen = new Set<MomentKind>();
  /** Whether the first frame of this game has been looked at, which the moments in it are not news to. */
  private primed = false;
  /** Whether the page has said that it shows the moments of this game. */
  private watching = false;
  /** The ending that waits for its show to start (the map has to be there), the timer that gives up on it and the one that looks at the map. */
  private waiting: EndingView | null = null;
  private giveUp: (() => void) | null = null;
  private polling: (() => void) | null = null;
  /** Whether a map is on its way to the page: it is being brought up (`expectMap`) and has neither come (`attach`) nor failed (`mapFailed`). */
  private mapComing = false;
  /** Whether the show of the ending was begun for this game. */
  private begun = false;
  /** The kinds of moment a page that is not enabled has let go of, so that it asks once. */
  private readonly letGo = new Set<MomentKind>();

  constructor(
    private readonly play: Play,
    private readonly env: DirectorEnv = (envFactory ?? browserEnv)(),
  ) {}

  // --- What the page tells it ----------------------------------------------------------------------------------------

  /** The page is bringing a map up: an ending that comes before it is there waits for it. */
  expectMap(): void {
    this.mapComing = true;
  }

  /** The map cannot come up: an ending that waited for it opens its page without the show, and so will the ones that come. */
  mapFailed(): void {
    this.mapComing = false;
    if (this.waiting === null) return;
    this.waiting = null;
    this.cancelGiveUp();
    this.cancelPoll();
    this.play.showEnding(true);
  }

  /** The map is up: its camera can be moved. */
  attach(map: MapView): void {
    this.mapComing = false;
    this.map = map;
    this.port = map.stageCamera();
    this.pump();
    this.pollMap();
  }

  /** The map is gone (or never came up). */
  detach(): void {
    if (this.current !== null) this.finish("interrupt");
    this.port = null;
    this.map = null;
    this.mapComing = false;
  }

  /** A new game, a game that was loaded, a recording taken to a position: what was on show is over, and the moments the next frame has are no news. */
  reset(): void {
    this.queue = [];
    if (this.current !== null) {
      const now = this.current;
      this.cancelLoop();
      this.current = null;
      this.item = null;
      now.show.end?.("interrupt");
    }
    this.settle();
    this.waiting = null;
    this.cancelGiveUp();
    this.cancelPoll();
    this.seen.clear();
    this.primed = false;
    this.watching = false;
    this.begun = false;
    this.letGo.clear();
    this.play.touch();
  }

  /** A frame of the game: the moments it carries that the page has not seen are shown, one after the other. */
  afterFrame(frame: Frame): void {
    const moments = readMoments(frame.moments);
    const hold = readHold(frame.moment_hold);
    if (!this.enabled) {
      for (const kind of hold) if (!this.letGo.has(kind)) {
        this.letGo.add(kind);
        this.release(kind);
      }
      return;
    }
    if (!this.primed) {
      // The first frame of a game, or of one that was loaded: what it has was shown before, and a world held for it has nobody to show it.
      this.primed = true;
      for (const moment of moments ?? []) this.seen.add(moment.kind);
      for (const kind of hold) this.release(kind);
      this.watch(moments);
      this.pump();
      return;
    }
    this.watch(moments);
    for (const moment of moments ?? []) {
      if (this.seen.has(moment.kind)) continue;
      this.seen.add(moment.kind);
      this.queue.push({ show: momentShow(moment, (id) => this.play.nameOf(id)), moment, ending: null, release: hold.includes(moment.kind), pictured: false });
    }
    this.pump();
  }

  /**
   * The ending is known (a game that was played to the end, or a game that is over and was loaded or taken to its end). Returns whether the ending
   * page is to wait for a show: there is a map to play it on, a show was registered, and the ending has what it is made from. The page opens the
   * ending page itself when this says no, and the controller opens it when the show ends.
   */
  beginEnding(ending: EndingView): boolean {
    if (!this.enabled || this.begun) return false;
    if (registry.length === 0 || ending.festival === null) return false;
    // A page with no map, or one whose map has failed, has nothing to play it on; one whose map is on its way keeps the ending for it.
    if (this.port === null && !this.mapComing) return false;
    this.begun = true;
    this.waiting = ending;
    this.cancelGiveUp();
    this.giveUp = this.env.after(ENDING_GRACE_MS, () => {
      this.giveUp = null;
      if (this.waiting !== null) {
        this.waiting = null;
        this.cancelPoll();
        this.play.showEnding(true);
      }
    });
    this.pump();
    this.pollMap();
    return true;
  }

  /** The player asked for the show to end: the button in the corner, Esc, or a click on a moment. */
  skip(): void {
    if (this.current !== null) this.finish("skip");
  }

  /** Whether a show is on. */
  get active(): boolean {
    return this.current !== null;
  }

  /** Whether a show is on or is about to be: one waits in the queue, or the ending page waits for the show of the ending. */
  get busy(): boolean {
    return this.current !== null || this.queue.length > 0 || this.waiting !== null;
  }

  // --- Playing -------------------------------------------------------------------------------------------------------------

  /** Starts the next show if none is on and the map can play it. A moment the map cannot play is let go of without one. */
  private pump(): void {
    if (this.current !== null) return;
    const port = this.port;
    if (this.waiting !== null && port !== null && port.ready() && this.primed && this.play.view !== null) {
      const ending = this.waiting;
      this.waiting = null;
      this.cancelGiveUp();
      this.cancelPoll();
      const show = this.makeEnding(ending, port);
      if (show === null) this.play.showEnding(true);
      else this.queue.push({ show, moment: null, ending, release: false, pictured: true });
    }
    for (;;) {
      const next = this.queue[0];
      if (next === undefined) break;
      if (port === null || !port.ready()) {
        // Nothing to play it on: a moment has to be let go of all the same, and an ending has to be shown.
        this.queue.shift();
        if (next.moment !== null) this.release(next.moment.kind);
        else if (next.ending !== null) this.play.showEnding(true);
        continue;
      }
      this.queue.shift();
      this.start(next, port);
      return;
    }
    this.settle();
  }

  private makeEnding(ending: EndingView, port: CameraPort): Show | null {
    const festival = ending.festival;
    if (festival === null) return null;
    const context: EndingShowContext = { ending, festival, scene: this.play.scene, frame: this.play.view, map: this.map, port, calm: this.env.calm(), latest: () => this.play.state.ending ?? ending };
    for (const factory of registry) {
      const show = factory(context);
      if (show !== null) return show;
    }
    return null;
  }

  private start(item: Item, port: CameraPort): void {
    if (!this.paused) {
      this.paused = true;
      this.saved = port.pose();
      this.play.hostClient.pause("show");
    }
    this.stopKeys ??= this.env.keys((key) => this.onKey(key));
    const scene = this.play.scene;
    this.from = port.eye();
    this.looked = null;
    const calm = this.env.calm();
    this.legs = plan(calm ? item.show.stops.map((stop) => ({ ...stop, travel: 0 })) : item.show.stops, (at, zoom) => this.eyeOf(at, zoom, port, scene));
    this.length = Math.max(lengthOf(this.legs), item.show.duration ?? 0);
    this.startedAt = this.env.now();
    const first = this.legs[0];
    this.item = item;
    this.current = { show: item.show, moment: item.moment, ending: item.ending, stop: 0, caption: first === undefined ? null : first.caption };
    this.play.touch();
    this.step();
  }

  private eyeOf(at: StopAt, zoom: number, port: CameraPort, scene: Scene | null): Eye | null {
    if (at === "town") return { ...port.town(), zoom };
    if ("cell" in at) return { ...worldOfCell(at.cell[0], at.cell[1]), zoom };
    const door = scene?.places.find((p) => p.id === at.place)?.door ?? null;
    return door === null ? null : { ...worldOfCell(door[0], door[1]), zoom };
  }

  private cancelLoop(): void {
    this.stopLoop?.();
    this.stopLoop = null;
  }

  /** One animation frame of the show that is on. */
  private step = (): void => {
    this.stopLoop = null;
    const now = this.current;
    const port = this.port;
    if (now === null || port === null) return;
    const elapsed = this.env.now() - this.startedAt;
    const at = eyeAt(this.from, this.legs, elapsed);
    // The map is drawn again only when the camera has moved: a stop that is being held leaves it still.
    if (this.legs.length > 0 && !sameEye(this.looked, at.eye)) {
      this.looked = at.eye;
      port.look(at.eye);
    }
    now.show.frame?.(elapsed, at.stop);
    // The picture of a moment for the ending page is taken from the map once the camera is there.
    const item = this.item;
    if (item !== null && item.moment !== null && !item.pictured && elapsed >= MOMENT_PICTURE_MS) {
      item.pictured = true;
      this.play.album.take(item.moment.kind, this.map);
    }
    const caption = this.legs[at.stop]?.caption ?? null;
    if (at.stop !== now.stop || caption !== now.caption) {
      now.stop = at.stop;
      now.caption = caption;
      this.play.touch();
    }
    if (elapsed >= this.length && at.over) {
      this.finish("done");
      return;
    }
    this.stopLoop = this.env.later(this.step);
  };

  /** The show that is on is over. The next one goes on at once, and when none is left the camera goes back and the world is let go. */
  private finish(reason: EndReason): void {
    const now = this.current;
    if (now === null) return;
    this.cancelLoop();
    this.current = null;
    const item = this.item;
    this.item = null;
    now.show.end?.(reason);
    if (item?.moment != null && item.release) this.release(item.moment.kind);
    if (item?.ending != null) this.play.showEnding(true);
    this.play.touch();
    this.pump();
  }

  /** No show is left to play: the camera is given back and the reason `show` is let go. */
  private settle(): void {
    this.stopKeys?.();
    this.stopKeys = null;
    if (this.paused) {
      this.paused = false;
      const saved = this.saved;
      this.saved = null;
      if (saved !== null) this.port?.restore(saved);
      this.play.hostClient.resume("show");
    }
  }

  /** Lets the core go on from a moment. A page that plays a recording sends nothing: the recording has the release. */
  private release(kind: MomentKind): void {
    if (this.play.isReadOnly) return;
    this.play.send({ type: "moment", op: "release", kind }, { silent: true });
  }

  /** Says, once, that the page shows the moments of this game, if the frame does not have them yet. */
  private watch(moments: Moment[] | null): void {
    if (moments !== null) this.watching = true;
    if (this.watching || this.play.isReadOnly || !this.play.playing) return;
    this.watching = true;
    this.play.send({ type: "moment", op: "watch" }, { silent: true });
  }

  /** Esc ends the show that is on; a key that is not Esc is left to the page. */
  private onKey(key: string): boolean {
    if (key !== "Escape" || this.current === null) return false;
    this.skip();
    return true;
  }

  private cancelGiveUp(): void {
    this.giveUp?.();
    this.giveUp = null;
  }

  /**
   * While an ending waits, looks at the map every `ENDING_POLL_MS`: nothing tells the controller that the map has the town on it, and the frames
   * of the game, which are the other thing that wake it, may not come.
   */
  private pollMap(): void {
    this.cancelPoll();
    if (this.waiting === null) return;
    this.polling = this.env.after(ENDING_POLL_MS, () => {
      this.polling = null;
      this.pump();
      this.pollMap();
    });
  }

  private cancelPoll(): void {
    this.polling?.();
    this.polling = null;
  }
}
