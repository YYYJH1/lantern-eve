/**
 * A show when a job is done. The festival asks three things of the manager, and when one is done the page says so, once, in a short card over
 * the map, with a light on the map where it happened, and holds the world until the player puts the card away. The bridge is mended (the flag
 * `bridge_fixed`), the truth is told in public and taken (`truth_told`), the families are at peace (`reconciled`). The core raises each flag once
 * and says so in the event `flag`, which is what the page reads.
 *
 * This module has the rules, as functions of the events and frames the page sees: which job a flag is, which jobs a frame says are done already,
 * and the queue of cards (each job once in a game, a card that waits behind any other card that is up, and what is true at the first frame is not
 * news). What the card does to the page (holds the world, is put away, lights the map) is in `guide.ts`. It decides nothing in the game.
 */
import type { CoreEvent } from "../shared/protocol.ts";
import { readHud } from "./hud.ts";
import type { Board } from "./slice.ts";

export type Job = "bridge" | "truth" | "peace";

export const JOBS: readonly Job[] = ["bridge", "truth", "peace"];

/** The flags of the core that say a job is done, and the job of each. */
export const JOB_FLAGS: Readonly<Record<string, Job>> = { bridge_fixed: "bridge", truth_told: "truth", reconciled: "peace" };

/** The job that an event says is done, or null for any other event and any other flag. */
export function jobOf(event: CoreEvent): Job | null {
  if (event.kind !== "flag" || typeof event.flag !== "string") return null;
  return Object.hasOwn(JOB_FLAGS, event.flag) ? (JOB_FLAGS[event.flag] ?? null) : null;
}

/**
 * The jobs a frame says are done: the bridge is mended where `hud.bridge.state` says so (a detour is a way across and not a mended bridge), the truth and
 * the peace where the board says so. A frame that does not have a key says nothing of its job.
 */
export function jobsDone(hud: Record<string, unknown>, board: Pick<Board, "truth" | "peace"> | null): Job[] {
  const done: Job[] = [];
  if (readHud(hud).bridge?.state === "mended") done.push("bridge");
  if (board?.truth?.state === "done") done.push("truth");
  if (board?.peace?.state === "done") done.push("peace");
  return done;
}

export class Shows {
  /** The job whose card is up, or null. */
  up: Job | null = null;
  /** The jobs that were told of, or that were done when the page began to look: none is told twice. */
  private readonly seen = new Set<Job>();
  private queue: Job[] = [];

  /** The first frame of a game, or of one that was loaded: what is done already is not news. */
  prime(done: readonly Job[]): void {
    for (const job of done) this.seen.add(job);
    this.queue = this.queue.filter((job) => !done.includes(job));
  }

  /** The core says a job is done. It waits its turn, and a job that was told of is not told again. */
  note(job: Job): void {
    if (this.seen.has(job)) return;
    this.seen.add(job);
    this.queue.push(job);
  }

  /**
   * Brings up the card of the next job that is waiting, unless another card is up (`covered`, which the caller works out: the recap, a step of the
   * tutorial, the elder, what the people said, the card of the first day) or one of these is. Returns whether a card came up just now. Once the
   * ending is there (`over`) the ending page tells everything, and what is waiting is let go.
   */
  step(covered: boolean, over: boolean): boolean {
    if (over) this.queue = [];
    if (this.up !== null || covered) return false;
    const next = this.queue.shift();
    if (next === undefined) return false;
    this.up = next;
    return true;
  }

  /** The player put the card away. */
  close(): Job | null {
    const was = this.up;
    this.up = null;
    return was;
  }

  /** A new game. */
  reset(): void {
    this.up = null;
    this.seen.clear();
    this.queue = [];
  }
}
