/**
 * The moments of a game as the ending page keeps them: a row of small pictures, one for each moment of the festival that happened, in the order they
 * happened. The core says which moments there were and when (`moments` of the frame); the picture of each is taken by the page from the map while the
 * show of the moment plays (`director.ts`), and kept here. A game that is loaded has the pictures its save kept with it, if the save had room for them
 * (at most three, each of at most 40,000 characters as a data URL), and a moment without one is shown as a small card with the place, the time and the
 * words. Nothing here is in the core, and nothing of it is in a recording.
 *
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */
import type { PageNotes } from "../shared/protocol.ts";
import { MOMENT_KINDS, type Moment, type MomentKind } from "./director.ts";

/** How wide a picture is made, and the qualities of JPEG it is tried at, best first, until it is small enough. */
export const PICTURE_WIDTH = 288;
export const PICTURE_QUALITIES: readonly number[] = [0.74, 0.62, 0.5, 0.4];
/** The most characters a picture may be as a data URL, which is about 30 KB of image: a save keeps pictures no bigger. */
export const PICTURE_MAX_CHARS = 40_000;
/** The most pictures a game keeps: one for each kind of moment. */
export const MAX_PICTURES = MOMENT_KINDS.length;

/** The key of the notes a save keeps for the page. */
export const NOTES_KEY = "moments";

/** A time of the game: the day, and the clock the placard of the page shows. */
export interface GameTime {
  day: number;
  hour: number;
  minute: number;
}

/** A game day is 1,800 ticks of the day at 120 an hour from 06:00, and 270 of the night at 30 an hour from 21:00 (core/lantern_core/world/bridge/clock.py). */
const DAWN = 6;
const DUSK = 21;
const DAY_TICKS_PER_HOUR = 120;
const NIGHT_TICKS_PER_HOUR = 30;
const DAY_TICKS = (DUSK - DAWN) * DAY_TICKS_PER_HOUR;
const CYCLE_TICKS = DAY_TICKS + (24 - (DUSK - DAWN)) * NIGHT_TICKS_PER_HOUR;

/** The game time at a tick: tick 0 is 06:00 of the first day, and the hours after midnight belong to the day that began the evening before. */
export function timeAtTick(tick: number): GameTime {
  const t = Math.max(0, Math.trunc(Number.isFinite(tick) ? tick : 0));
  const day = Math.floor(t / CYCLE_TICKS) + 1;
  const cycle = t % CYCLE_TICKS;
  if (cycle < DAY_TICKS) return { day, hour: DAWN + Math.floor(cycle / DAY_TICKS_PER_HOUR), minute: Math.floor(((cycle % DAY_TICKS_PER_HOUR) * 60) / DAY_TICKS_PER_HOUR) };
  const night = cycle - DAY_TICKS;
  return { day, hour: (DUSK + Math.floor(night / NIGHT_TICKS_PER_HOUR)) % 24, minute: Math.floor(((night % NIGHT_TICKS_PER_HOUR) * 60) / NIGHT_TICKS_PER_HOUR) };
}

/** Whether something is a picture the page keeps: a small image as a data URL. */
export function validPicture(value: unknown): value is string {
  return typeof value === "string" && value.length <= PICTURE_MAX_CHARS && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

const isKind = (value: string): value is MomentKind => (MOMENT_KINDS as readonly string[]).includes(value);

/** What a picture is taken from: the map, which can say what it shows as a data URL. */
export interface Camera {
  pictureOf(width: number, qualities: readonly number[], maxChars: number): string | null;
}

/** The pictures of the moments of the game that is on, kept in the page and, if the save has room, with the save. */
export class Album {
  private readonly pictures = new Map<MomentKind, string>();

  get size(): number {
    return this.pictures.size;
  }

  get(kind: MomentKind): string | null {
    return this.pictures.get(kind) ?? null;
  }

  /** Takes the picture of a moment from the map, if there is none of it yet. Returns whether one was taken. */
  take(kind: MomentKind, map: Camera | null): boolean {
    if (map === null || this.pictures.has(kind)) return false;
    let url: string | null = null;
    try {
      url = map.pictureOf(PICTURE_WIDTH, PICTURE_QUALITIES, PICTURE_MAX_CHARS);
    } catch {
      url = null;
    }
    return this.put(kind, url);
  }

  /** Keeps a picture of a moment, if it is one the page keeps. */
  put(kind: MomentKind, url: string | null): boolean {
    if (!validPicture(url) || this.pictures.has(kind) || this.pictures.size >= MAX_PICTURES) return false;
    this.pictures.set(kind, url);
    return true;
  }

  /** A new game, a game that was loaded: nothing is kept. */
  reset(): void {
    this.pictures.clear();
  }

  /** What a save keeps for the page: the pictures, each of them within the size a save has room for. Null where there are none. */
  keep(): PageNotes | null {
    const pictures: Record<string, string> = {};
    for (const [kind, url] of this.pictures) if (validPicture(url)) pictures[kind] = url;
    return Object.keys(pictures).length === 0 ? null : { [NOTES_KEY]: { pictures } };
  }

  /** Takes back what `keep` kept, when a save is loaded. Anything that is not a picture of a known moment is left. */
  restore(notes: PageNotes | undefined): void {
    const kept = notes?.[NOTES_KEY];
    if (typeof kept !== "object" || kept === null || Array.isArray(kept)) return;
    const pictures = (kept as Record<string, unknown>).pictures;
    if (typeof pictures !== "object" || pictures === null || Array.isArray(pictures)) return;
    for (const [kind, url] of Object.entries(pictures)) if (isKind(kind)) this.put(kind, typeof url === "string" ? url : null);
  }
}

/** One moment of the row at the foot of the ending page: when and where it was, who brought the story back (for an echo), and its picture if the page has one. */
export interface MomentCard {
  kind: MomentKind;
  tick: number;
  place: string;
  from: string | null;
  time: GameTime;
  picture: string | null;
}

/** The cards of the moments of a game, in the order they happened, with the picture the album has of each. Nothing where the game has no moments. */
export function cardsOf(moments: readonly Moment[] | null, album: Album): MomentCard[] {
  return [...(moments ?? [])]
    .sort((a, b) => a.tick - b.tick)
    .map((m) => ({ kind: m.kind, tick: m.tick, place: m.place, from: m.from, time: timeAtTick(m.tick), picture: album.get(m.kind) }));
}
