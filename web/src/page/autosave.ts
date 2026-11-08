/**
 * The page saves the game by itself, into the saves the player keeps: each morning at the hour of the recap (07:00 from the second day)
 * and when the ending comes. An autosave is a save like any other (a replay in IndexedDB, listed in the menu and in the gallery) that carries
 * a mark in the notes of the page (`page.auto`), which is how the page tells it from the player's own. The page keeps the last three
 * autosaves and deletes the one before, and never touches a save of the player's. The opening page's *Continue* loads the newest save of
 * all, whoever made it.
 *
 * This module has the rules, as functions of the clock of a frame and of the list of saves, and the class that makes the save. It decides
 * nothing in the game and reads nothing from it but the clock.
 */
import { getLang, type Lang, t } from "../i18n/index.ts";
import type { PageNotes, SaveMeta } from "../shared/protocol.ts";
import type { HostClient } from "./client.ts";
import type { FrameTime } from "./frame.ts";
import { RECAP_HOUR } from "./firstday.ts";
import { clockText, dayLabel } from "./ui/format.ts";

/** How many autosaves are kept. */
export const AUTOSAVES_KEPT = 3;

/** The first day that has a morning recap, and so a morning save. */
export const FIRST_MORNING = 2;

/** `morning` is the save at the hour of the recap, `ending` the one made when the ending came. */
export type AutosaveKind = "morning" | "ending";

/** What an autosave says of itself in the notes of the page: why it was made and the game time it was made at. */
export interface AutoMark {
  kind: AutosaveKind;
  day: number;
  hour: number;
  minute: number;
}

const KINDS: readonly AutosaveKind[] = ["morning", "ending"];

const whole = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** The mark of a save, or null for a save of the player's own (and for notes that are not a mark). */
export function markOf(save: Pick<SaveMeta, "page">): AutoMark | null {
  const raw = save.page?.auto;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const mark = raw as Record<string, unknown>;
  const kind = KINDS.find((k) => k === mark.kind);
  if (kind === undefined || !whole(mark.day) || !whole(mark.hour) || !whole(mark.minute)) return null;
  return { kind, day: mark.day, hour: mark.hour, minute: mark.minute };
}

/**
 * The day whose morning save is behind a game that is at `time` for the first time (a new game, or a game that was loaded): what is true when the
 * page begins to look is not news, so a game that is loaded after the hour of the recap does not save at once, and one loaded before it saves
 * when the hour comes.
 */
export function savedThrough(time: Pick<FrameTime, "day" | "hour" | "phase">): number {
  return time.phase === "day" && time.hour < RECAP_HOUR ? time.day - 1 : time.day;
}

/**
 * Whether the frame is the one to save the morning at: a day from the second, in the day phase, no save of that morning yet, and either the paper
 * of the morning has come in this frame (`paper`: the key `gazette` of the frame, or the event `recap`, which the core sends only when there is
 * something to recap) or the clock is past the hour of the recap. A frame shows the clock as it is after its tick, and the core makes the paper in
 * the first tick of seven, so the frame before the one that has it already reads 07:00, and so does the frame that has it. A save made at the
 * frame before would leave the paper out of its notes, which is why the save waits for the paper. It does not wait for the minute after: the
 * paper holds the world while the player reads it, and that frame can be the last one for as long as they do. The first minute after the hour is
 * for a core that sends no paper and a morning with nothing to recap, where the game is saved all the same.
 */
export function morningDue(time: Pick<FrameTime, "day" | "hour" | "minute" | "phase">, saved: number, paper = false): boolean {
  if (time.day < FIRST_MORNING || time.phase !== "day" || saved >= time.day || time.hour < RECAP_HOUR) return false;
  return paper || time.hour > RECAP_HOUR || time.minute >= 1;
}

/** The ids of the autosaves to delete once a new one is made: all but the newest `keep`, whatever else the list has. */
export function excessSaves(saves: readonly SaveMeta[], keep = AUTOSAVES_KEPT): number[] {
  return saves
    .filter((save) => markOf(save) !== null)
    .map((save) => save.id)
    .sort((a, b) => b - a)
    .slice(keep);
}

/** The save that *Continue* loads: the newest of all, the player's own and the page's, which is the one with the highest number. Null where there is none. */
export function newestSave<T extends Pick<SaveMeta, "id">>(saves: readonly T[]): T | null {
  let newest: T | null = null;
  for (const save of saves) if (newest === null || save.id > newest.id) newest = save;
  return newest;
}

/** "Day 3 07:00" for a morning, "the festival night" for the ending. */
export function autosaveWhen(mark: AutoMark, lang: Lang): string {
  return mark.kind === "ending" ? t("autosave.when.ending") : `${dayLabel(lang, mark.day)} ${clockText(mark.hour, mark.minute)}`;
}

/** What the save is called: it is shown in the menu and in the gallery, in the language the page had when it was made. */
export function autosaveName(mark: AutoMark, lang: Lang = getLang()): string {
  return t("autosave.name", { when: autosaveWhen(mark, lang) });
}

/** The mark of a save made now, at the clock of a frame. */
const markAt = (kind: AutosaveKind, time: Pick<FrameTime, "day" | "hour" | "minute">): AutoMark => ({ kind, day: Math.floor(time.day), hour: Math.floor(time.hour), minute: Math.floor(time.minute) });

/** The notes the page keeps with an autosave, besides the recap that it keeps with every save. */
export const autosaveNotes = (mark: AutoMark): PageNotes => ({ auto: mark });

/** What the player's side asks of the host to save, which is a part of the host client. */
export type SaveHost = Pick<HostClient, "save" | "deleteSave" | "state">;

export class Autosave {
  /** Whether this page saves by itself: the page of a player, on a host that keeps saves. A recording, a test page and the server host do not. */
  enabled = false;
  /** Told when a save was made, for the page to say so. */
  onSaved: ((mark: AutoMark) => void) | null = null;
  /** Told when a save could not be made, with what the host answered or the store threw, for the page to say so. */
  onFailed: ((err: unknown) => void) | null = null;
  /** The day whose morning is saved or passed, or null before the first frame of a game. */
  private saved: number | null = null;
  private pending: AutoMark | null = null;
  private running = false;

  constructor(private readonly host: SaveHost) {}

  /** A new game, or a game that was loaded: nothing is known of it until its first frame. */
  reset(): void {
    this.saved = null;
    this.pending = null;
  }

  /** Looks at the clock of a frame, and at whether it has the paper of the morning, and asks for a morning save when the morning is due. */
  afterFrame(time: Pick<FrameTime, "day" | "hour" | "minute" | "phase">, paper = false): void {
    if (this.saved === null) {
      this.saved = savedThrough(time);
      return;
    }
    if (!morningDue(time, this.saved, paper)) return;
    this.saved = time.day;
    // The save is of the morning, which is called by the hour of its recap whichever frame it was made at.
    if (this.enabled) this.pending = markAt("morning", { day: time.day, hour: RECAP_HOUR, minute: 0 });
  }

  /** The ending came: it is saved, over a morning save that has not been made yet. */
  ending(time: Pick<FrameTime, "day" | "hour" | "minute">): void {
    if (this.enabled) this.pending = markAt("ending", time);
  }

  /**
   * Makes the save that was asked for, after the frame has been read whole (so that the notes the page keeps with every save, the paper of the
   * morning, are the morning's). A save that cannot be made is let go, and the page is told so (`onFailed`): the next morning has its own.
   * Resolves when nothing is left to save.
   */
  flush(): Promise<void> {
    return this.running || this.pending === null ? Promise.resolve() : this.run();
  }

  private async run(): Promise<void> {
    this.running = true;
    try {
      for (let mark = this.pending; mark !== null; mark = this.pending) {
        this.pending = null;
        await this.make(mark);
      }
    } finally {
      this.running = false;
    }
  }

  private async make(mark: AutoMark): Promise<void> {
    try {
      await this.host.save(autosaveName(mark), autosaveNotes(mark));
    } catch (err) {
      console.warn(`the game was not saved by itself: ${err instanceof Error ? err.message : String(err)}`);
      this.onFailed?.(err);
      return;
    }
    this.onSaved?.(mark);
    try {
      for (const id of excessSaves(this.host.state.saves)) await this.host.deleteSave(id);
    } catch (err) {
      console.warn(`an old autosave was not deleted: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
