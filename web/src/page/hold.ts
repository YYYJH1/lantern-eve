/**
 * Why the page holds the world. The notebook holds it while it is open, and the guide holds it while a card of the tutorial
 * or the clan elder is up. The world goes on when the last of them lets go, if it was going before. A world the player
 * paused with the button is left paused. A world that the core holds for a talk is not that: the page pauses it on top,
 * and lets go of its own pause without undoing the core's. The page's pause has a reason of its own (`page`), so that it
 * is not taken for the player's: the bar still says that the time is held while the notebook is open in a talk.
 */
import type { PauseReason } from "../shared/protocol.ts";
import { type Standing, stoppedBy } from "./world-state.ts";

/**
 * What the hold needs of the host client: to pause and resume the world, and to know whether the player paused it. The core
 * stops the clock itself while the player talks, which is a world that stands still and not a pause of the player's, and
 * `stoppedBy` (`world-state.ts`) tells which it is from the reasons the host reports.
 */
export interface Pausable {
  pause(reason?: PauseReason): void;
  resume(reason?: PauseReason): void;
  readonly state: Standing;
}

export class WorldHold {
  private readonly reasons = new Set<string>();
  /** Whether the page paused the world, so that it owes a resume. */
  private owed = false;

  constructor(private readonly client: Pausable) {}

  /** Whether any reason holds the world now. */
  get active(): boolean {
    return this.reasons.size > 0;
  }

  /** Takes the reason on or lets it go. */
  set(reason: string, on: boolean): void {
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.apply();
  }

  /**
   * Holds the world now whatever its state, and owes the resume. For the moment a game begins behind the opening page,
   * when the world is held by the page being closed to it and a card must be up before it is let go.
   */
  take(reason: string): void {
    this.reasons.add(reason);
    if (!this.owed) {
      this.client.pause("page");
      this.owed = true;
    }
  }

  /** Whether the player pressed pause, which the page leaves alone. */
  private pausedByPlayer(): boolean {
    return stoppedBy(this.client.state) === "player";
  }

  private apply(): void {
    if (this.reasons.size > 0) {
      if (!this.owed && !this.pausedByPlayer()) {
        this.client.pause("page");
        this.owed = true;
      }
    } else if (this.owed) {
      this.owed = false;
      this.client.resume("page");
    }
  }

  /** The player pressed resume while only the page held the world: they let it go, and the page gives up its pause. */
  letGo(): void {
    if (!this.owed) return;
    this.owed = false;
    this.client.resume("page");
  }

  /** A new game starts over. */
  reset(): void {
    this.reasons.clear();
    this.owed = false;
  }
}
