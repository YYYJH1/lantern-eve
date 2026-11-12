/**
 * How close each person stands to the manager, as the frame shows it (`people` of the frame, one row for each person of the cast): the hearts,
 * what the manager has learned they like, how many small things they have had, and the card that says why the hearts are what they are. The
 * hearts are for showing only: no rule of the town reads them. A frame from a core that does not send the key gives no rows.
 */
import { type Asked, readAsked, readStamp, type Stamp } from "./people.ts";
import { type Name, readName } from "./scene.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const whole = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** The hearts are five, counted in halves. */
export const MAX_HEARTS = 10;

export type TrustWord = "stranger" | "acquainted" | "friendly" | "close";
const TRUST_WORDS: readonly TrustWord[] = ["stranger", "acquainted", "friendly", "close"];

/** What moved the hearts (the core's `WHY`). A cause the page does not know is `other`. */
export const WHY = ["talk", "promise", "kept", "broken", "gift", "cleared", "spoke", "meal", "statement", "overclaim", "lie", "hearsay", "blame", "other"] as const;
export type HeartWhy = (typeof WHY)[number];
export const whyOf = (value: unknown): HeartWhy => WHY.find((why) => why === value) ?? "other";

/** One change of the hearts, in half hearts (`delta` is negative for a loss). */
export interface HeartChange {
  tick: number;
  day: number;
  hour: number;
  minute: number;
  delta: number;
  why: HeartWhy;
}

/** A promise of the manager's that is not kept yet. `due` is the game day. */
export interface OpenPromise {
  id: string;
  what: string;
  item: string;
  amount: number;
  due: number | null;
}

/** A promise the person made to the manager (as the commitments of the frame). */
export interface PromisedToYou {
  id: string;
  what: Name;
  item: string;
  amount: number;
  due: { day: number; hour: number } | null;
  state: string;
  reason: Name | null;
}

/** The card that says what the hearts are made of. */
export interface HeartsCardData {
  trust: TrustWord;
  /** The favours the person owes the manager, 0 to 6. */
  owesYou: number;
  /** The favours the manager owes the person, 0 to 6. They take no heart away. */
  youOwe: number;
  youPromised: OpenPromise[];
  promisedYou: PromisedToYou[];
  /** The last changes, the oldest first. */
  changes: HeartChange[];
  /** How many acquaintances have to join the helpers before this person does. Null where it does not apply. It is 0 once they have joined, and also for one whose friends are in when the crew was full before them: `joined` says which. */
  waiting: number | null;
  /** Whether the person is among the helpers. */
  joined: boolean;
}

export type Like = "like" | "dislike" | "neutral";

/** A thing the manager has found out the person likes or does not. */
export interface Taste {
  item: string;
  like: Like;
}

/** One person, as the manager knows them. */
export interface Relation {
  id: string;
  /** Whether the manager has talked with them. */
  known: boolean;
  /** 0 to 10, in half hearts. */
  hearts: number;
  likes: Taste[];
  /** How many small things they have had, 0 to 2. */
  gifts: number;
  card: HeartsCardData | null;
  /** Where and when the talks with the person began, the last few, oldest first. */
  met: Stamp[];
  /** The return the person asked in a talk, and the request they turned down for want of weight. */
  asked: Asked | null;
}

function readChange(raw: unknown): HeartChange | null {
  if (!isRecord(raw)) return null;
  const delta = whole(raw.delta);
  if (delta === null || delta === 0) return null;
  return { tick: whole(raw.tick) ?? 0, day: whole(raw.day) ?? 1, hour: whole(raw.hour) ?? 0, minute: whole(raw.minute) ?? 0, delta, why: whyOf(raw.why) };
}

function readPromised(raw: unknown): OpenPromise | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return { id: raw.id, what: text(raw.what), item: text(raw.item), amount: Math.max(0, whole(raw.amount) ?? 0), due: whole(raw.due) };
}

function readPromisedYou(raw: unknown): PromisedToYou | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  const due = isRecord(raw.due) && whole(raw.due.day) !== null ? { day: whole(raw.due.day) ?? 0, hour: whole(raw.due.hour) ?? 0 } : null;
  const reason = isRecord(raw.reason) ? readName(raw.reason) : null;
  return {
    id: raw.id,
    what: readName(raw.what),
    item: text(raw.item),
    amount: Math.max(0, whole(raw.amount) ?? 0),
    due,
    state: text(raw.state),
    reason: reason !== null && (reason.zh !== "" || reason.en !== "") ? reason : null,
  };
}

function readCard(raw: unknown): HeartsCardData | null {
  if (!isRecord(raw)) return null;
  const list = <T>(value: unknown, read: (item: unknown) => T | null): T[] => (Array.isArray(value) ? value : []).flatMap((item): T[] => {
    const one = read(item);
    return one === null ? [] : [one];
  });
  const waiting = whole(raw.waiting);
  return {
    trust: TRUST_WORDS.find((word) => word === raw.trust) ?? "stranger",
    owesYou: Math.max(0, whole(raw.owes_you) ?? 0),
    youOwe: Math.max(0, whole(raw.you_owe) ?? 0),
    youPromised: list(raw.you_promised, readPromised),
    promisedYou: list(raw.promised_you, readPromisedYou),
    changes: list(raw.changes, readChange),
    waiting: waiting === null ? null : Math.max(0, waiting),
    joined: raw.joined === true,
  };
}

function readRelation(raw: unknown): Relation | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  const hearts = Math.min(MAX_HEARTS, Math.max(0, whole(raw.hearts) ?? 0));
  const likes: Taste[] = [];
  for (const row of Array.isArray(raw.likes_known) ? raw.likes_known : []) {
    if (!isRecord(row) || typeof row.item !== "string") continue;
    const like = row.like === "like" || row.like === "dislike" || row.like === "neutral" ? row.like : null;
    if (like !== null) likes.push({ item: row.item, like });
  }
  const met: Stamp[] = [];
  for (const stamp of Array.isArray(raw.met) ? raw.met : []) {
    const read = readStamp(stamp);
    if (read !== null) met.push(read);
  }
  return { id: raw.id, known: raw.known === true, hearts, likes, gifts: Math.max(0, whole(raw.gifts) ?? 0), card: readCard(raw.card), met, asked: readAsked(raw.asked) };
}

/** The `people` key of a frame, by person. Empty where the frame has none (a core from before it, the demo world). */
export function readRelations(frame: Record<string, unknown> | null): Map<string, Relation> {
  const out = new Map<string, Relation>();
  if (frame === null || !Array.isArray(frame.people)) return out;
  for (const raw of frame.people) {
    const row = readRelation(raw);
    if (row !== null) out.set(row.id, row);
  }
  return out;
}

/** The people of the frame as a list in the order of the cast, or null where the frame has none. */
export function relationRows(relations: ReadonlyMap<string, Relation>): Relation[] | null {
  return relations.size === 0 ? null : Array.from(relations.values());
}

/** The ids of the people the manager has talked with. */
export function knownIds(relations: ReadonlyMap<string, Relation>): ReadonlySet<string> {
  return new Set(Array.from(relations.values(), (row) => row).filter((row) => row.known).map((row) => row.id));
}

/** The hearts as a count: 7 half hearts are three whole hearts and a half. */
export function heartParts(hearts: number): { whole: number; half: boolean } {
  const v = Math.min(MAX_HEARTS, Math.max(0, Math.trunc(hearts)));
  return { whole: Math.floor(v / 2), half: v % 2 === 1 };
}
