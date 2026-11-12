/**
 * What the sounds read of the game: the few things in a frame (the hour, the weather, the watchman, whether the player is in a talk, whether
 * the paper of the morning is in it) and the cues that its events call for. Everything here only reads.
 */
import type { CoreEvent, Frame } from "../../shared/protocol.ts";
import { jobOf } from "../shows.ts";
import type { CueId } from "./cues.ts";
import type { Watchman } from "./plan.ts";

/** The id of the night watchman in the cast of the town. */
export const WATCHMAN = "gengfu";

export interface SoundFrame {
  hour: number;
  minute: number;
  weather: string;
  watchman: Watchman | null;
  /** The player is in a talk. */
  talking: boolean;
  /** The frame carries the paper of the morning (or, in an older core, its recap). */
  paper: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const number = (value: unknown, fallback: number): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** The parts of a frame the sounds use. A key a frame lacks (the demo world sends only the people and the time) gives the quiet default. */
export function readSoundFrame(frame: Frame): SoundFrame {
  const time = isRecord(frame.time) ? frame.time : {};
  let watchman: Watchman | null = null;
  const npcs = Array.isArray(frame.npcs) ? frame.npcs : [];
  for (const npc of npcs) {
    if (npc.id !== WATCHMAN) continue;
    const extra = npc as unknown as Record<string, unknown>;
    watchman = { x: number(npc.x, 0), y: number(npc.y, 0), patrolling: extra.activity === "patrol" };
    break;
  }
  const player = isRecord(frame.player) ? frame.player : null;
  return {
    hour: number(time.hour, 12),
    minute: number(time.minute, 0),
    weather: typeof frame.weather === "string" ? frame.weather : "clear",
    watchman,
    talking: player !== null && isRecord(player.talk),
    paper: isRecord(frame.gazette) || (Array.isArray(frame.recap) && frame.recap.length > 0),
  };
}

/**
 * The cues a frame's events call for. A job's phrase is played once for a game (`heard` keeps the jobs it was played for), the bell
 * of the paper once for each paper, and a moment's cymbal once for each moment. `paperBefore` says whether the frame before had the paper.
 */
export function cuesFor(events: readonly CoreEvent[], now: SoundFrame, paperBefore: boolean, heard: Set<string>): CueId[] {
  const cues: CueId[] = [];
  if (now.paper && !paperBefore) cues.push("paper");
  for (const event of events) {
    const job = jobOf(event);
    if (job !== null) {
      if (heard.has(job)) continue;
      heard.add(job);
      cues.push(`job.${job}`);
      continue;
    }
    if (event.kind === "moment") cues.push("moment");
    else if (event.kind === "delivered") cues.push("ui.seal");
  }
  return cues;
}

/** The sound a click on the page makes, from what was clicked: a leaf turned, a word of ink touched, or none. */
export type ClickSound = "ui.page" | "ui.ink";

const PAGE_TURNS = ["nav.marks button", '[data-testid="btn-notebook"]', ".turn-bar button"];
const INK_WORDS = [".ink-act", ".ink-frame"];

/** `target` is where the click landed. A page turn is looked for first, as the turn bar is itself a word of ink. */
export function clickSound(target: Element | null): ClickSound | null {
  if (target === null || typeof target.closest !== "function") return null;
  for (const selector of PAGE_TURNS) if (target.closest(selector) !== null) return "ui.page";
  for (const selector of INK_WORDS) if (target.closest(selector) !== null) return "ui.ink";
  return null;
}
