/**
 * The small secrets of the town. They are on the page only: nothing here is in the core, in the inputs the core takes or in a recording, so no rule, number,
 * pin or bot of the game depends on them.
 *
 *   - The riddle lantern at the door of the lantern workshop. A click on it (outside a talk) opens a slip with the riddle of the game day and three answers.
 *     One guess a day, five riddles for five days. What was guessed is kept in the notes the page gives a save.
 *   - The watchman's verse. Three clicks on the night watchman within two seconds, from 22:00 to 05:00, make the watchman say a verse that teases the manager. One verse a night.
 *   - A rumour about the manager. When the manager stands still for an hour of game time at the market or at the door of the teahouse, the nearest named person
 *     who is free says one line about it. Once in a game.
 *   - The Lantern Festival today. A table of the dates of the 15th day of the first lunar month tells whether the day of the player's computer is one.
 *
 * What is said over the map is a list of lines in the shape of a bubble of the frame, which the map draws on a layer of its own and the line of the page
 * reads for those who cannot see the map. It has no PixiJS in it, so that the tests can run it without a browser.
 */
import { hasMessage, type MessageKey, translate } from "../i18n/index.ts";
import type { PageNotes } from "../shared/protocol.ts";
import type { Bubble, FrameTime, ViewFrame } from "./frame.ts";
import type { Name, Scene } from "./scene.ts";

// --- The Lantern Festival ----------------------------------------------------------------------------------------------

/**
 * The 15th day of the first lunar month in the Gregorian calendar, as year, month and day, for the years 2027 to 2036. A date outside the table is not
 * known, and nothing happens on it.
 */
export const LANTERN_FESTIVAL: ReadonlyArray<readonly [number, number, number]> = [
  [2027, 2, 20],
  [2028, 2, 9],
  [2029, 2, 27],
  [2030, 2, 17],
  [2031, 2, 6],
  [2032, 2, 25],
  [2033, 2, 14],
  [2034, 3, 5],
  [2035, 2, 22],
  [2036, 2, 11],
];

/** Whether the day of the computer, by its own clock and zone, is a Lantern Festival of the table. */
export function lanternFestivalOn(date: Date): boolean {
  if (Number.isNaN(date.getTime())) return false;
  const [year, month, day] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  return LANTERN_FESTIVAL.some(([y, m, d]) => y === year && m === month && d === day);
}

// --- Words -------------------------------------------------------------------------------------------------------------

/** A text of the tables in both languages at once, for what the map says over a head. Empty where the key is not there. */
function both(key: string): Name {
  return hasMessage(key) ? { zh: translate("zh", key), en: translate("en", key) } : { zh: "", en: "" };
}

const text = (key: string, lang: "zh" | "en"): string => (hasMessage(key) ? translate(lang, key) : "");

// --- The riddles -------------------------------------------------------------------------------------------------------

/** How many riddles there are, and how many answers each has. */
export const RIDDLES = 5;
export const ANSWERS = 3;

/** For each riddle, which of its three answers is the right one (0 to 2). The same place in both languages. */
export const RIDDLE_RIGHT: readonly number[] = [2, 0, 1, 0, 2];

/** The riddle of a game day, counted from 0: the first day has the first. A day past the fifth begins again. */
export function riddleOf(day: number): number {
  const whole = Number.isFinite(day) ? Math.trunc(day) : 1;
  return (((whole - 1) % RIDDLES) + RIDDLES) % RIDDLES;
}

export interface RiddleWords {
  question: string;
  answers: string[];
  /** The right answer in words. */
  right: string;
}

/** The words of a riddle in a language. */
export function riddleWords(riddle: number, lang: "zh" | "en"): RiddleWords {
  const n = riddle + 1;
  const answers = Array.from({ length: ANSWERS }, (_, i) => text(`egg.riddle.${n}.a${i + 1}`, lang));
  return { question: text(`egg.riddle.${n}.q`, lang), answers, right: answers[RIDDLE_RIGHT[riddle] ?? 0] ?? "" };
}

/** The key of the notes a save keeps the riddles under. */
export const RIDDLES_KEY = "riddles";

/** What was guessed in a game: for each game day the answer that was picked, and whether the slip of the lantern was ever opened. */
export class Riddles {
  /** Whether the slip was opened at least once in this game. */
  opened = false;
  private readonly picks = new Map<number, number>();

  /** The answer picked on a game day, or null where there was no guess. */
  pickOf(day: number): number | null {
    return this.picks.get(Math.trunc(day)) ?? null;
  }

  /** Whether the answer picked on a game day was the right one. */
  rightOn(day: number): boolean {
    const pick = this.pickOf(day);
    return pick !== null && pick === RIDDLE_RIGHT[riddleOf(day)];
  }

  /** Makes a guess for a game day. A day has one guess, and an answer is one of the three. Returns whether the guess was taken. */
  guess(day: number, pick: number): boolean {
    const key = Math.trunc(day);
    if (!Number.isInteger(pick) || pick < 0 || pick >= ANSWERS || this.picks.has(key)) return false;
    this.picks.set(key, pick);
    return true;
  }

  /** How many riddles were guessed right. */
  get right(): number {
    let n = 0;
    for (const day of this.picks.keys()) if (this.rightOn(day)) n++;
    return n;
  }

  /** How many guesses were made. */
  get guessed(): number {
    return this.picks.size;
  }

  reset(): void {
    this.opened = false;
    this.picks.clear();
  }

  /** What a save keeps: whether the lantern was opened and the pick of each day. Null where there is nothing to keep. */
  keep(): PageNotes | null {
    if (!this.opened && this.picks.size === 0) return null;
    const guesses: Record<string, number> = {};
    for (const [day, pick] of [...this.picks].sort((a, b) => a[0] - b[0])) guesses[String(day)] = pick;
    return { [RIDDLES_KEY]: { opened: this.opened || this.picks.size > 0, guesses } };
  }

  /** Takes back what `keep` kept, when a save is loaded. A day that is not a day of the game and a pick that is not one of the answers are left out. */
  restore(notes: PageNotes | undefined): void {
    const kept = notes?.[RIDDLES_KEY];
    if (typeof kept !== "object" || kept === null || Array.isArray(kept)) return;
    const raw = kept as Record<string, unknown>;
    if (raw.opened === true) this.opened = true;
    const guesses = raw.guesses;
    if (typeof guesses !== "object" || guesses === null || Array.isArray(guesses)) return;
    for (const [key, pick] of Object.entries(guesses)) {
      const day = Number(key);
      if (!Number.isInteger(day) || day < 1 || day > 99 || typeof pick !== "number") continue;
      if (this.guess(day, pick)) this.opened = true;
    }
  }
}

/** The words of the one small line that the ending page says of the riddles. */
export function riddleEndingKey(guessed: number): MessageKey {
  if (guessed <= 0) return "egg.ending.riddles.none";
  return guessed >= RIDDLES ? "egg.ending.riddles.all" : "egg.ending.riddles";
}

// --- The watchman ------------------------------------------------------------------------------------------------------

/** The person the verse is the voice of. */
export const WATCHMAN = "gengfu";
/** Three clicks within this many milliseconds. */
export const CLICK_WINDOW_MS = 2000;
export const CLICKS_FOR_VERSE = 3;
/** The night, as the hours of the game clock: from 22:00 up to 05:00. */
export const NIGHT_FROM_HOUR = 22;
export const NIGHT_UNTIL_HOUR = 5;
/** The verses there are, one for each night. */
export const VERSES = 5;
/** How long a verse stays over the head of the watchman, in ticks (a line of the game stays 60). */
export const VERSE_TICKS = 90;

/** Whether an hour of the game clock is in the watchman's night. */
export const isVerseHour = (hour: number): boolean => hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;

/** The verse of a night. The hours after midnight belong to the night that began the evening before, which the frame counts as the same day. */
export function verseOf(night: number): Name {
  const whole = Number.isFinite(night) ? Math.trunc(night) : 1;
  return both(`egg.verse.${((((whole - 1) % VERSES) + VERSES) % VERSES) + 1}`);
}

// --- The manager who stands still --------------------------------------------------------------------------------------

/** How long the manager has to stand still, in minutes of game time, and how far from them the one who says it may stand, in cells. */
export const STILL_MINUTES = 60;
export const HEARING_CELLS = 12;
/** How long the line stays over the head of the one who says it, in ticks. */
export const RUMOUR_TICKS = 90;

/**
 * Minutes of game time counted from 06:00 of the first day, with no step back at midnight: the game day runs from 06:00 to 06:00 and the hours after
 * midnight (the clock says 0 to 5) belong to it.
 */
export function gameMinutes(time: Pick<FrameTime, "day" | "hour" | "minute">): number {
  const hour = time.hour < 6 ? time.hour + 24 : time.hour;
  return (Math.max(1, time.day) - 1) * 24 * 60 + hour * 60 + time.minute;
}

/** Counts the game time for which a person has been in one place, doing nothing. */
export class StillTimer {
  private since: number | null = null;
  private cell = "";

  /**
   * One frame: `ok` is whether the person is where the count is for and at rest, `cell` where they stand, `minute` the game time. Returns whether the
   * time that was asked for has passed. A step to another cell begins the count again.
   */
  see(ok: boolean, cell: { x: number; y: number }, minute: number, minutes = STILL_MINUTES): boolean {
    const here = `${cell.x},${cell.y}`;
    if (!ok || here !== this.cell || this.since === null || minute < this.since) {
      this.cell = here;
      this.since = ok ? minute : null;
      return false;
    }
    return minute - this.since >= minutes;
  }

  /** An act, a talk or a walk: the time begins again. */
  reset(): void {
    this.since = null;
    this.cell = "";
  }
}

/** Where the manager stands, as far as the rumour is concerned: on the ground of the market, or within three cells of the door of the teahouse. */
export function spotOf(scene: Scene, at: { x: number; y: number }): "market" | "teahouse" | null {
  const market = scene.places.find((p) => p.kind === "market");
  if (market !== undefined && at.x >= market.rect.x && at.x < market.rect.x + market.rect.w && at.y >= market.rect.y && at.y < market.rect.y + market.rect.h) return "market";
  const door = scene.places.find((p) => p.kind === "teahouse")?.door ?? null;
  if (door !== null && Math.max(Math.abs(at.x - door[0]), Math.abs(at.y - door[1])) <= 3) return "teahouse";
  return null;
}

/**
 * The nearest named person of the cast who can say it: not asleep, not in a talk with somebody out of hearing, not already speaking, and within hearing of the
 * manager. Ties go to the first id. Null where there is nobody.
 */
export function nearestSpeaker(view: ViewFrame, scene: Scene, tick: number): string | null {
  const me = view.player;
  if (me === null) return null;
  const cast = new Set(scene.cast.map((p) => p.id));
  const busy = new Set<string>(view.talkers);
  for (const bubble of view.bubbles) if (tick < bubble.until) busy.add(bubble.npc);
  let best: string | null = null;
  let nearest = Number.POSITIVE_INFINITY;
  for (const person of view.people) {
    if (!cast.has(person.id) || busy.has(person.id) || person.activity === "sleep") continue;
    const cells = Math.max(Math.abs(person.x - me.x), Math.abs(person.y - me.y));
    if (cells > HEARING_CELLS) continue;
    if (cells < nearest || (cells === nearest && best !== null && person.id < best)) {
      best = person.id;
      nearest = cells;
    }
  }
  return best;
}

/** The line a person says of the manager, in that person's own voice. A person who has none of their own says the line of the street. */
export function rumourOf(npc: string): Name {
  const own = both(`egg.rumour.${npc}`);
  return own.zh === "" ? both("egg.rumour.any") : own;
}

/** The acts of the page that are not acts of the manager in the town: choosing what to follow, comparing two lines of the notebook, asking for a hint, the show controller's. */
const NOT_ACTS: ReadonlySet<string> = new Set(["track", "judge", "hint", "moment", "statement"]);

export const isAct = (type: string): boolean => !NOT_ACTS.has(type);

// --- The secrets together ----------------------------------------------------------------------------------------------

/** What the secrets need to know of the player's side of the page. */
export interface EggHost {
  /** The latest frame, read. */
  readonly view: ViewFrame | null;
  readonly scene: Scene | null;
  /** The tick of the latest frame. */
  readonly now: number;
  /** Whether there is a player to act for: not a recording, and a game that has a manager. */
  readonly playing: boolean;
  readonly state: { readonly talk: { readonly npc: string } | null; readonly ending: unknown };
  /** Tells the views that something changed. */
  touch(): void;
}

export class Eggs {
  readonly riddles = new Riddles();
  /** Whether the slip of the riddle lantern is up. */
  riddleOpen = false;
  /** What is said over the map now, which the map draws and the line of the page reads. The list is replaced when it changes and never changed in place. */
  lines: readonly Bubble[] = [];
  private readonly verses = new Set<number>();
  private clicks: number[] = [];
  private readonly still = new StillTimer();
  private told = false;

  constructor(private readonly host: EggHost) {}

  /** A new game, or one that is loaded: what was said and what was counted starts again. */
  reset(): void {
    this.riddles.reset();
    this.riddleOpen = false;
    this.lines = [];
    this.verses.clear();
    this.clicks = [];
    this.still.reset();
    this.told = false;
  }

  /** What a save keeps for the page. */
  keep(): PageNotes | null {
    return this.riddles.keep();
  }

  /** Takes back what a save kept. */
  restore(notes: PageNotes | undefined): void {
    this.riddles.restore(notes);
    this.host.touch();
  }

  // --- The riddle lantern ---

  /** The game day, from the clock of the latest frame. */
  get day(): number {
    return this.host.view?.time.day ?? 1;
  }

  /** How many riddles were guessed right: how bright the lantern burns. */
  get brightness(): number {
    return this.riddles.right;
  }

  /** Opens the slip, if the lantern may be opened now. Returns whether it was. */
  openRiddle(): boolean {
    if (!this.host.playing || this.host.state.talk !== null || this.host.state.ending !== null) return false;
    if (!this.riddleOpen) {
      this.riddleOpen = true;
      this.riddles.opened = true;
      this.host.touch();
    }
    return true;
  }

  closeRiddle(): void {
    if (!this.riddleOpen) return;
    this.riddleOpen = false;
    this.host.touch();
  }

  /** The player picks an answer for today. Returns whether it was taken: a day has one guess. */
  guess(pick: number): boolean {
    const taken = this.riddles.guess(this.day, pick);
    if (taken) this.host.touch();
    return taken;
  }

  // --- What is said over the map ---

  private say(npc: string, words: Name, ticks: number): void {
    this.lines = [...this.lines.filter((line) => line.npc !== npc), { npc, until: this.host.now + ticks, text: words }];
    this.host.touch();
  }

  /** A line of the game is on show over somebody now. */
  private speaking(npc: string): boolean {
    return this.host.view?.bubbles.some((b) => b.npc === npc && this.host.now < b.until) === true;
  }

  /** Puts away what was said: a talk begins, or the game is over. */
  hush(): void {
    this.clicks = [];
    if (this.lines.length === 0) return;
    this.lines = [];
    this.host.touch();
  }

  // --- The watchman ---

  /**
   * A click on the map: the person it was on, or null for the ground. Three clicks in a row on the watchman within two seconds, on a night of the game and
   * outside a talk, make the watchman say the verse of the night, once for each night.
   */
  pick(id: string | null, nowMs: number): void {
    if (id !== WATCHMAN) {
      this.clicks = [];
      return;
    }
    this.clicks = [...this.clicks.filter((at) => nowMs - at <= CLICK_WINDOW_MS), nowMs];
    if (this.clicks.length < CLICKS_FOR_VERSE) return;
    this.clicks = [];
    const view = this.host.view;
    if (view === null || !this.host.playing || this.host.state.talk !== null || this.host.state.ending !== null) return;
    if (!isVerseHour(view.time.hour) || this.verses.has(view.time.day) || this.speaking(WATCHMAN)) return;
    this.verses.add(view.time.day);
    this.say(WATCHMAN, verseOf(view.time.day), VERSE_TICKS);
  }

  // --- The manager who stands still ---

  /** The manager did something (walked, asked, listened): the hour of standing still begins again. */
  acted(): void {
    this.still.reset();
  }

  /** Each frame: puts away what has been said for long enough, and counts the time the manager has stood still. */
  afterFrame(view: ViewFrame): void {
    const tick = this.host.now;
    if (this.lines.some((line) => tick >= line.until)) this.lines = this.lines.filter((line) => tick < line.until);
    if (this.told) return;
    const scene = this.host.scene;
    const me = view.player;
    if (scene === null || me === null || !this.host.playing || this.host.state.talk !== null || this.host.state.ending !== null || me.talk !== null) {
      this.still.reset();
      return;
    }
    const resting = me.activity === "rest" && spotOf(scene, me) !== null;
    if (!this.still.see(resting, me, gameMinutes(view.time))) return;
    const speaker = nearestSpeaker(view, scene, tick);
    if (speaker === null) return;
    this.told = true;
    this.say(speaker, rumourOf(speaker), RUMOUR_TICKS);
  }
}
