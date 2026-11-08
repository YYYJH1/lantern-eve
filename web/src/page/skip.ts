/**
 * Skipping to the next thing. A player who follows the top bar has nothing left to do for a long stretch of the game: the work on the
 * bridge is done by the morning of the third day, and nothing asks for them again until the festival on the evening of the fifth, some
 * two and a half days of the game, or a night and a morning for a promise that falls due. When every task that is open or blocked
 * only waits (it has no step to take now), or none is open and the festival has not come, the task card and the top bar offer a
 * button that runs the world at the highest pace the host takes until something has to be done, and then gives the pace back.
 *
 * This module has the rules, as functions of what the page reads of a frame: when the button is offered and what time it says, and
 * the class that runs the world while a button is pressed (which ends the run, and when). The words are in `ui/skip-text.ts` and the
 * button in `ui/skip-button.tsx`. It decides nothing in the game: the core goes on as it does, a little sooner.
 */
import type { FrameTime } from "./frame.ts";
import { gameMinutes } from "./hints.ts";
import type { Play } from "./play.ts";
import { type Commitment, isLive, type SliceFrame, type Task } from "./slice.ts";
import { stoppedBy } from "./world-state.ts";

/**
 * The pace the page asks the host for while it skips, as a multiple of the common pace: the highest the browser host takes for a skip
 * (`MAX_SKIP_SPEED` of `shared/runtime.ts`; the player's own choices stay below `MAX_SPEED`, four). A test of the host keeps the two together.
 */
export const SKIP_PACE = 12;

/**
 * How early the core gives the card its step for an occasion that has a window: the button that goes to the place comes an hour before
 * the window opens, to leave the time to walk there (the conditions of the tasks in the script start at `from - 1`).
 */
export const LEAD_HOURS = 1;

/** The hour at which a day of the game begins, before which the night is. */
const DAWN = 6;

/** A moment of the clock of the game. */
export interface SkipTime {
  day: number;
  hour: number;
  minute: number;
}

/** The button is offered, and says where the run will stop when the frame tells it (null where it does not). */
export interface SkipOffer {
  until: SkipTime | null;
}

/**
 * The time of the first thing to come, from the windows still ahead of the tasks that wait: the hour the core gives the card its step,
 * which is an hour before a window opens, and the hour the window opens for a task that waits on a promise, whose window is when the
 * goods are to come and not when anybody has to do anything. A window that is open already or past is not ahead. Null where no task
 * that waits has a window ahead.
 */
export function nextStop(tasks: readonly Task[], promises: readonly Commitment[], now: Pick<FrameTime, "day" | "hour" | "minute">): SkipTime | null {
  const here = gameMinutes(now.day, now.hour, now.minute);
  let best: SkipTime | null = null;
  let bestAt = Number.POSITIVE_INFINITY;
  for (const task of tasks) {
    const win = task.window;
    if (win === null) continue;
    const opens = gameMinutes(win.day, win.from);
    if (opens <= here) continue;
    const goods = promises.some((p) => p.state === "promised" && p.due !== null && p.due.day === win.day && p.due.hour === win.to);
    // The step is an hour early, if that is by day and has not come already.
    const early = !goods && win.from - LEAD_HOURS >= DAWN && gameMinutes(win.day, win.from - LEAD_HOURS) > here;
    const hour = early ? win.from - LEAD_HOURS : win.from;
    const at = early ? gameMinutes(win.day, hour) : opens;
    if (at < bestAt) {
      bestAt = at;
      best = { day: win.day, hour, minute: 0 };
    }
  }
  return best;
}

/** What the offer reads of the page. */
export interface SkipView {
  slice: SliceFrame;
  /** The clock of the latest frame, or null before there is one. */
  time: Pick<FrameTime, "day" | "hour" | "minute"> | null;
  /** The ending is there: the festival has been held. */
  ended: boolean;
  /** The player is in a talk, in which the core holds the world. */
  talking: boolean;
  /** Whether the host takes a pace (`HostClient.paced`). The server host does not. */
  paced: boolean;
  /** The page is that of a recording, which acts for nobody and has a host that plays it at its own speed. */
  readOnly: boolean;
}

/**
 * Whether the button is offered, and the time it says. It is when every task that is open or blocked only waits, which is to say it
 * has no action to do now (its window is ahead, or it waits on a promise that is not due), or none is open or blocked and the festival
 * has not come, in a game whose frames carry the tasks and the board of the days after the first. It is not in a talk, which holds the
 * world, after the ending, on the page of a recording and with a host that keeps its own pace.
 */
export function skipOffer(view: SkipView): SkipOffer | null {
  if (view.readOnly || !view.paced || view.ended || view.talking) return null;
  const tasks = view.slice.tasks;
  if (tasks === null || view.slice.board === null || view.time === null) return null;
  const live = tasks.list.filter(isLive);
  if (live.some((task) => task.action !== null)) return null;
  return { until: nextStop(live, view.slice.commitments ?? [], view.time) };
}

/** Why a run ended: the player pressed the button again, or paused; something is to be done, the followed task changed, a person came to talk, a card or a sheet holds the world, the ending came, or a new game or a loaded one began. */
export type SkipEnd = "pressed" | "paused" | "ready" | "task" | "talk" | "held" | "ending" | "reset";

/** What the views read of the skip: the offer, whether a run is going, and whether the button can be pressed now. */
export interface SkipState {
  offer: SkipOffer | null;
  running: boolean;
  enabled: boolean;
}

/**
 * The run. Pressing the button asks the host for `SKIP_PACE`, and every frame is looked at until something ends it: a task has a step to
 * take now (the button is not offered any longer), the task that is followed is not the one it was, a person has come to talk to the
 * manager, a card or a sheet is up, the world is held or paused, or the ending has come. The pace the player chose is then asked for
 * again. A world the player had paused is let go by the press, and is taken for paused again only once it has been seen to run.
 */
export class Skip {
  /** Whether a run is going. */
  running = false;
  /** Why the last run ended, or null before one has. */
  ended: SkipEnd | null = null;

  /** The pace the player chose, which the host runs the day at when no run is going. */
  private base = 1;
  /** Whether a frame has shown the world running since the run began. */
  private armed = false;
  /** The task that was followed when the run began. */
  private followed: string | null = null;

  constructor(private readonly play: Play) {}

  /** What the views read. */
  get state(): SkipState {
    const offer = this.offer();
    return { offer, running: this.running, enabled: this.running || (offer !== null && this.usable()) };
  }

  /** The player's choice of the pace of the day. The host runs the day at it, unless a run is going, which asks for it again when it ends. */
  choose(pace: number): void {
    this.base = pace;
    if (!this.running) this.play.hostClient.setPace(pace);
  }

  /** The button: begins a run where the button is offered and can be used, and ends the run that is going. */
  press(): void {
    if (this.running) {
      this.stop("pressed");
      return;
    }
    if (this.offer() === null || !this.usable()) return;
    const client = this.play.hostClient;
    this.running = true;
    this.ended = null;
    this.armed = stoppedBy(client.state) === null;
    this.followed = this.play.slice.tasks?.tracked ?? null;
    if (!this.armed) client.resume();
    client.setPace(SKIP_PACE, true);
    this.play.touch();
  }

  /** Looks at the frame that has come, and ends the run if something has to be done. */
  afterFrame(): void {
    if (!this.running) return;
    const why = this.whyEnd();
    if (why !== null) this.stop(why);
  }

  /** A new game or a loaded one: the run is over, and the host has the pace the player chose. */
  reset(): void {
    this.armed = false;
    if (!this.running) return;
    this.running = false;
    this.ended = "reset";
    this.play.hostClient.setPace(this.base);
  }

  private offer(): SkipOffer | null {
    const play = this.play;
    return skipOffer({
      slice: play.slice,
      time: play.view?.time ?? null,
      ended: play.state.ending !== null,
      talking: play.state.talk !== null,
      paced: play.hostClient.paced,
      readOnly: play.isReadOnly,
    });
  }

  /** Whether a press would begin a run: the host is up, the world runs or the player paused it, and no card or sheet is up. */
  private usable(): boolean {
    const play = this.play;
    const s = play.hostClient.state;
    if (s.phase !== "ready") return false;
    const by = stoppedBy(s);
    return (by === null || by === "player") && !this.covered();
  }

  /** A card of the help or a sheet of the page is up: what the elder says, a step of the tutorial, the end of the first day, the recap, what the people said. */
  private covered(): boolean {
    const flows = this.play.flows.state;
    return this.play.guide.cardUp || flows.recap !== null || flows.night !== null || flows.clarified !== null || flows.stated !== null;
  }

  private whyEnd(): SkipEnd | null {
    const play = this.play;
    if (play.state.ending !== null) return "ending";
    if (play.state.talk !== null) return "talk";
    const by = stoppedBy(play.hostClient.state);
    if (by === null) this.armed = true;
    else if (this.armed) return by === "player" ? "paused" : "held";
    if (this.covered()) return "held";
    if (this.offer() === null) return "ready";
    if ((play.slice.tasks?.tracked ?? null) !== this.followed) return "task";
    return null;
  }

  private stop(why: SkipEnd): void {
    if (!this.running) return;
    this.running = false;
    this.ended = why;
    this.play.hostClient.setPace(this.base);
    this.play.touch();
  }
}
