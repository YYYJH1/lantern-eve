/**
 * The soundscape: the one object that decides, as the game goes on, what is heard. It listens to the host the way the rest of the page
 * does (every frame and its events, through `tap`) and to the player's choices, and it asks the engine for sound. It reads and never
 * sends: nothing here is an input of the core, so the recordings and the hashes are what they were.
 *
 * Nothing is made until the player has pressed Start or Continue (`begin`), or the press that opens a recording from the gallery. The audio
 * context is made on the first `refresh` after that where the sound is on, which is inside the press, so that the browser lets it play.
 *
 * It hears one session at a time, the one that is on the screen: the live game, or a recording that is open over it (`follow`). The page
 * points it at the recording when one opens and back at the game when it is shut, and puts it away (`end`) where no sound has begun yet.
 */
import type { HostToPage } from "../../shared/protocol.ts";
import type { PageState } from "../client.ts";
import { parseScene } from "../scene.ts";
import { stoppedBy } from "../world-state.ts";
import type { EngineLike, EngineSnapshot } from "./engine.ts";
import { bindFestival } from "./festival.ts";
import { ambienceDuck, type Listener, type Mix, NO_SOURCES, planMix, SILENCE, sourcesOf, type Sources, type Stillness, volumeGain, WHOLE_TOWN } from "./plan.ts";
import { clickSound, cuesFor, readSoundFrame, type SoundFrame } from "./read.ts";
import { type SoundPrefs, soundPrefs } from "./settings.ts";

/** What the soundscape needs of the host client. */
export interface SoundHost {
  readonly state: Pick<PageState, "paused" | "stats" | "scene" | "sceneVersion"> & { readonly frame?: PageState["frame"] };
  tap(listener: (message: HostToPage) => void): () => void;
}

/** What is heard of: the host of a game or of a recording, and where the ear is in its map (null when there is no map). */
export interface SoundSession {
  host: SoundHost;
  listener: () => Listener | null;
}

/** What it needs of the document. */
export interface SoundPage {
  readonly visibilityState: string;
  addEventListener(type: string, listener: (event: Event) => void, options?: boolean | AddEventListenerOptions): void;
  removeEventListener(type: string, listener: (event: Event) => void, options?: boolean | EventListenerOptions): void;
}

export interface SoundscapeOptions {
  host: SoundHost;
  engine: EngineLike;
  prefs?: SoundPrefs;
  /** Where the camera looks, or null when there is no map. */
  listener?: () => Listener | null;
  page?: SoundPage;
  /** Calls the function every so many milliseconds; returns the function that stops it. */
  every?: (ms: number, run: () => void) => () => void;
  /** A clock in milliseconds. */
  clock?: () => number;
}

/** The time between two looks at the game, in milliseconds. */
export const REFRESH_MS = 200;
/** How long the sound has been out before the context is stopped, in milliseconds. */
const SLEEP_AFTER_MS = 1800;
/** The time constant of the volumes' glides, in seconds: a fade out takes about four of them. */
const GLIDE = 0.45;

const everyOf = (ms: number, run: () => void): (() => void) => {
  const id = setInterval(run, ms);
  return () => clearInterval(id);
};

export interface SoundscapeSnapshot {
  /** What the last mix was made from: the time of day and the weather of the frame. Null before the first mix. */
  input: { hour: number; minute: number; weather: string } | null;
  begun: boolean;
  on: boolean;
  hidden: boolean;
  stillness: Stillness;
  duck: number;
  mix: Mix;
  heard: string[];
  engine: EngineSnapshot;
}

export class Soundscape {
  private host: SoundHost;
  private readonly engine: EngineLike;
  private readonly prefs: SoundPrefs;
  private listener: () => Listener | null;
  private untap: () => void;
  private readonly page: SoundPage;
  private readonly clock: () => number;
  private readonly every: (ms: number, run: () => void) => () => void;
  private readonly undo: Array<() => void> = [];
  private begun = false;
  private frame: SoundFrame | null = null;
  private paperBefore = false;
  private readonly heard = new Set<string>();
  private sources: Sources = NO_SOURCES;
  private sceneSeen = -1;
  private stopTimer: (() => void) | null = null;
  private silentSince: number | null = null;
  private asleep = false;
  private unlockOff: (() => void) | null = null;
  private readonly lastCue = new Map<string, number>();
  private festivalWanted = false;
  private festivalRunning = false;
  private festivalAt = { distance: 0, side: 0 };
  private mix: Mix = SILENCE;
  private input: SoundscapeSnapshot["input"] = null;
  private duck = 1;
  private stillness: Stillness = "running";

  constructor(options: SoundscapeOptions) {
    this.host = options.host;
    this.engine = options.engine;
    this.prefs = options.prefs ?? soundPrefs();
    this.listener = options.listener ?? (() => null);
    this.page = options.page ?? document;
    this.clock = options.clock ?? (() => performance.now());
    this.every = options.every ?? everyOf;
    this.untap = this.host.tap((message) => this.onMessage(message));
    this.undo.push(this.prefs.subscribe(() => this.refresh()));
    const visibility = (): void => this.refresh();
    this.page.addEventListener("visibilitychange", visibility);
    this.undo.push(() => this.page.removeEventListener("visibilitychange", visibility));
    this.page.addEventListener("click", this.onClick, true);
    this.undo.push(() => this.page.removeEventListener("click", this.onClick, true));
    this.undo.push(
      bindFestival({
        start: () => {
          this.festivalWanted = true;
          this.refresh();
        },
        stop: () => {
          this.festivalWanted = false;
          this.refresh();
        },
        setDistance: (distance, side) => {
          this.festivalAt = { distance, side };
          if (this.engine.started && this.festivalRunning) this.engine.festivalPlace(distance, side);
        },
      }),
    );
  }

  /** The player pressed Start or Continue, or the press that opens a recording: from now on there may be sound. */
  begin(): void {
    if (this.begun) return;
    this.begun = true;
    this.stopTimer ??= this.every(REFRESH_MS, () => this.refresh());
    this.refresh();
  }

  /** The player is where no sound has begun (the opening page, with the game behind it held): it fades out until the next press that begins it. */
  end(): void {
    if (!this.begun) return;
    this.begun = false;
    this.refresh();
  }

  /**
   * Hears another session from now on, the one that is on the screen: what the one before sent is no longer heard, and the frame the new one has
   * already is the town it plans for. The same session again only changes where the ear is.
   */
  follow(session: SoundSession): void {
    this.listener = session.listener;
    if (session.host !== this.host) {
      this.untap();
      this.host = session.host;
      this.untap = this.host.tap((message) => this.onMessage(message));
      this.heard.clear();
      this.paperBefore = false;
      const frame = this.host.state.frame ?? null;
      this.frame = frame === null ? null : readSoundFrame(frame);
      this.sceneSeen = -1;
      this.sources = NO_SOURCES;
    }
    this.refresh();
  }

  /** Whether sound is being made: pressed, switched on, and the engine is there. */
  private get live(): boolean {
    return this.begun && this.prefs.value.on && this.engine.started;
  }

  private onMessage(message: HostToPage): void {
    if (message.type === "reset") {
      // Another game: its jobs are still to be done.
      this.heard.clear();
      this.paperBefore = false;
      this.frame = null;
      return;
    }
    if (message.type !== "frame") return;
    const read = readSoundFrame(message.frame);
    this.frame = read;
    const cues = cuesFor(message.events, read, this.paperBefore, this.heard);
    this.paperBefore = read.paper;
    if (this.live && !this.hidden) for (const cue of cues) this.engine.cue(cue);
  }

  private get hidden(): boolean {
    return this.page.visibilityState === "hidden";
  }

  private readonly onClick = (event: Event): void => {
    if (!this.live || this.hidden) return;
    const sound = clickSound(event.target as Element | null);
    if (sound === null) return;
    // A press that comes twice in a few moments (a click on an element in an element) is heard once.
    const now = this.clock();
    if (now - (this.lastCue.get(sound) ?? Number.NEGATIVE_INFINITY) < 80) return;
    this.lastCue.set(sound, now);
    this.engine.cue(sound);
  };

  /**
   * Who is holding the world still: the player, a hidden tab, a sheet of the page, or nobody (the core's own hold for a talk is a talk). A show
   * on the map (a moment of the festival, the festival night) holds the world too, and it is not a sheet laid over the page: the town sounds as it does.
   */
  private standing(): Stillness {
    const reasons = this.host.state.stats?.reasons ?? [];
    if (reasons.length > 0 && reasons.every((reason) => reason === "show")) return "running";
    const by = stoppedBy(this.host.state);
    return by === null || by === "core" ? "running" : by;
  }

  private sourcesNow(): Sources {
    const state = this.host.state;
    if (state.sceneVersion !== this.sceneSeen) {
      this.sceneSeen = state.sceneVersion;
      this.sources = state.scene === null ? NO_SOURCES : sourcesOf(parseScene(state.scene));
    }
    return this.sources;
  }

  /**
   * Looks at the game and the choices and brings the sound to match: makes the engine when it is wanted for the first time, sets the
   * volumes, applies the mix, starts or stops the festival, and stops the context when nothing can be heard.
   */
  refresh(): void {
    const prefs = this.prefs.value;
    const wanted = this.begun && prefs.on;
    if (wanted && !this.engine.started) {
      this.engine.start();
      this.watchForUnlock();
    }
    if (!this.engine.started) return;

    const audible = wanted && !this.hidden;
    const now = this.clock();
    if (!audible) {
      this.silentSince ??= now;
      if (this.asleep) return;
      this.engine.setVolumes({ master: 0, ambience: 0, music: 0, effects: 0 }, GLIDE / 2);
      if (now - this.silentSince > SLEEP_AFTER_MS) {
        this.engine.suspend();
        this.asleep = true;
      }
      return;
    }
    this.silentSince = null;
    if (this.asleep) {
      this.engine.resume();
      this.asleep = false;
    }

    const frame = this.frame;
    this.stillness = this.standing();
    this.duck = ambienceDuck(frame?.talking === true, this.stillness);
    this.engine.setVolumes({ master: 1, ambience: volumeGain(prefs.ambience) * this.duck, music: volumeGain(prefs.music), effects: volumeGain(prefs.effects) }, GLIDE);

    // The festival's music is the show's, whatever the world is doing.
    if (this.festivalWanted && !this.festivalRunning) {
      this.festivalRunning = true;
      this.engine.festivalPlace(this.festivalAt.distance, this.festivalAt.side);
      this.engine.festivalStart();
    } else if (!this.festivalWanted && this.festivalRunning) {
      this.festivalRunning = false;
      this.engine.festivalStop();
    }

    // A world that the player has paused, or a page that is hidden, has no ambience to plan: the layers are let go.
    if (frame === null || this.duck === 0) {
      this.mix = SILENCE;
      this.input = null;
    } else {
      this.input = { hour: frame.hour, minute: frame.minute, weather: frame.weather };
      this.mix = planMix({ hour: frame.hour, minute: frame.minute, weather: frame.weather, listener: this.listener() ?? WHOLE_TOWN, watchman: frame.watchman, sources: this.sourcesNow() });
    }
    this.engine.apply(this.mix);
  }

  /** A browser may hold the sound back until the next press: the first press or key after that lets it go. */
  private watchForUnlock(): void {
    if (this.unlockOff !== null || this.engine.state === "running") return;
    const types = ["pointerdown", "keydown", "touchend"];
    const release = (): void => {
      if (this.engine.state === "running") {
        off();
        return;
      }
      this.engine.resume();
      this.refresh();
    };
    const off = (): void => {
      for (const type of types) this.page.removeEventListener(type, release, true);
      this.unlockOff = null;
    };
    for (const type of types) this.page.addEventListener(type, release, true);
    this.unlockOff = off;
  }

  snapshot(): SoundscapeSnapshot {
    return {
      input: this.input,
      begun: this.begun,
      on: this.prefs.value.on,
      hidden: this.hidden,
      stillness: this.stillness,
      duck: this.duck,
      mix: this.mix,
      heard: [...this.heard],
      engine: this.engine.snapshot(),
    };
  }

  dispose(): void {
    this.untap();
    this.stopTimer?.();
    this.stopTimer = null;
    this.unlockOff?.();
    for (const undo of this.undo.splice(0)) undo();
    this.engine.dispose();
  }
}
