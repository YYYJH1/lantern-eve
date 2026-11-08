/**
 * The end of the first day. Once the bamboo of the Li family has reached the bridge, the tasks of the first day are done. The page says
 * so once, in a card that holds the world until the player goes on, and the card names what the days after ask for.
 *
 * When no task is open the player is not left under a bar that says to pick one over a list with nothing in it: the bar, the task card
 * and the clan elder say that nothing is left to follow now and what the player may do while they wait, and once the festival has been
 * held, that it is over.
 *
 * This module has the rules, as functions of what the page reads of a frame: what is to be said when nothing is left to follow, and when
 * the card is due. What the card does to the page (holds the world, is put away) is in `guide.ts`. It decides nothing in
 * the game.
 */
import type { MessageKey } from "../i18n/index.ts";
import { gameMinutes } from "./hints.ts";
import { isLive, type Task, type Tasks } from "./slice.ts";

/** The hour of each morning, from the second day, at which the core makes the recap of the day before (`recap_hour` of `commitments` in the script). */
export const RECAP_HOUR = 7;

/**
 * What the page says when no task is open or blocked. `idle`: none is open now, and the festival is still to come. `over`: the festival has
 * been held. Null: something is to follow, or the frame does not list the tasks.
 */
export type Rest = "idle" | "over";

/** Which of the two it is. `ended` is whether the festival night has come and gone. */
export function restOf(tasks: Tasks | null, ended: boolean): Rest | null {
  if (tasks === null || tasks.list.some(isLive)) return null;
  return ended ? "over" : "idle";
}

/** The words of the bar, of the task card and of the clan elder (level 1 and 3; level 2 is about the notebook and has one line for all) for each rest, and for none. */
export const REST_WORDS: Readonly<Record<Rest | "pick", { bar: MessageKey; card: MessageKey; elder1: MessageKey | null; elder3: MessageKey | null }>> = {
  idle: { bar: "top.task.idle", card: "task.idle", elder1: "elder.l1.idle", elder3: "elder.l3.idle" },
  over: { bar: "top.task.over", card: "task.over", elder1: "elder.over", elder3: "elder.over" },
  pick: { bar: "top.task.pick", card: "task.none", elder1: null, elder3: null },
};

/** What the card reads of a frame. */
export interface DayFrame {
  /** The state of the task of the bamboo, or null where the frame does not list it. */
  bamboo: Task["state"] | null;
  /** The clock of the frame. */
  time: { day: number; hour: number; minute: number };
  /** Whether another card of the page is up: the paper of the morning or the recap, the summary of the night, a step of the tutorial, the elder, what the people said, the ending. */
  covered: boolean;
}

/**
 * Where the card stands. It is `watching` for the bamboo to reach the bridge, `waiting` for its turn once it has (with the day it did),
 * `up`, and then `over` for the rest of the game. A game that begins with the bamboo at the bridge is `over` from the start.
 */
export type DayState = { phase: "watching" } | { phase: "waiting"; day: number } | { phase: "up" } | { phase: "over" };

export const WATCHING: DayState = { phase: "watching" };
export const UP: DayState = { phase: "up" };
export const OVER: DayState = { phase: "over" };

/** The state at the first frame of a game, or of one that was loaded: what is true already is not news, so the bamboo at the bridge means no card. */
export function primeDay(frame: Pick<DayFrame, "bamboo">): DayState {
  return frame.bamboo === "done" ? OVER : WATCHING;
}

/**
 * Whether the recap of `day` may still be to come: the clock has not passed the hour it is made at. A frame shows the clock as it is
 * after the tick it answers, and the core makes the recap in the first tick of the hour, so the frame that has the recap reads that
 * hour, like the one before it, and a clock that reads the minute after has been through both. The count is the core's, from 06:00, so
 * that the small hours belong to the day before and the morning of a day is the first hour after its dawn.
 */
export function beforeRecap(time: DayFrame["time"], day: number): boolean {
  return gameMinutes(time.day, time.hour, time.minute) <= gameMinutes(day, RECAP_HOUR);
}

/**
 * What a frame does to the card. It is due when the task of the bamboo has turned done, no other card is up, and the clock has passed
 * the hour of the recap on the day the task was done: the bamboo of an evening promise lands at about half past six, and the recap that
 * tells of it comes at seven, so the card follows the recap. The bamboo of a promise made in the day lands after seven, and then the card
 * comes at once. `show` is true in the one frame that brings it up.
 */
export function stepDay(state: DayState, frame: DayFrame): { state: DayState; show: boolean } {
  let now = state;
  if (now.phase === "watching" && frame.bamboo === "done") now = { phase: "waiting", day: frame.time.day };
  if (now.phase === "waiting" && !frame.covered && !beforeRecap(frame.time, now.day)) return { state: UP, show: true };
  return { state: now, show: false };
}
