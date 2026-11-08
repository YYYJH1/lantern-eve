/**
 * The frame, read for drawing. The core's frame (see core/lantern_core/world/bridge/__init__.py)
 * has the keys npcs, time, weather, bubbles, dots, lanterns and hud, and for the festival manager
 * player, notebook and ending, and a client ignores the keys it does not know. Everything here
 * tolerates a key that is missing, empty or in a shorter shape, because the m0 demo world sends only
 * npcs and time.
 */
import type { Frame } from "../shared/protocol.ts";
import { type Name, readName } from "./scene.ts";

export interface FramePerson {
  id: string;
  x: number;
  y: number;
  activity: string;
  carrying: string | null;
  status: string | null;
}

export interface FrameTime {
  day: number;
  hour: number;
  minute: number;
  phase: "day" | "night";
}

export interface Bubble {
  npc: string;
  /** The first tick at which the line is gone. */
  until: number;
  text: Name;
}

export interface Dot {
  id: string;
  from: string;
  to: string;
  topic: string;
  /** Per mille of the way from `from` to `to`. */
  progress: number;
}

export interface Lantern {
  household: string;
  place: string;
  x: number;
  y: number;
}

/** A choice the core puts forward for a verb that takes one: its id, its name, and the fields it sends. */
export interface Offer {
  id: string;
  name: Name;
  /** The fields of the action when the choice is made. Without them the action carries the id as `choice`. */
  body: Record<string, unknown> | null;
}

/** What a topic of a question is: a line of the notebook, a thing of the story, a place, or a person. */
export type AskKind = "entry" | "thing" | "place" | "person";
export const ASK_KINDS: readonly AskKind[] = ["entry", "thing", "place", "person"];

/** Something the player can ask about in a talk: `player.topics` of the frame. */
export interface Topic {
  id: string;
  kind: AskKind;
  name: Name;
}

/** The game minutes each act of a talk costs (`player.talk.costs`). A cost the frame leaves out is null. */
export interface TalkCosts {
  ask: number | null;
  askSource: number | null;
  tell: number | null;
  entrust: number | null;
  promise: number | null;
}

/**
 * The game minutes of all six acts (`player.costs`, in every frame): the five of a talk and speaking in public, which is made
 * outside a talk and has none to show its cost in. A cost the frame leaves out is null.
 */
export interface ActCosts extends TalkCosts {
  speak: number | null;
}

/** The time of day at which the person of a talk has to go, which ends the talk (`player.talk.leaves_at`). */
export interface LeavesAt {
  hour: number;
  minute: number;
}

/** The talk the player is in: with whom, what each act costs and when the other has to go. */
export interface FrameTalk {
  npc: string;
  /** Null when the frame does not say. */
  costs: TalkCosts | null;
  /** Null when the frame does not say. */
  leavesAt: LeavesAt | null;
}

/** Where the player stands, what they are doing, the talk they are in and what they could look at. */
export interface FramePlayer {
  x: number;
  y: number;
  activity: string;
  talk: FrameTalk | null;
  /** What each act costs, in a talk or not. Null when the frame does not say. */
  costs: ActCosts | null;
  /** Ids of the things and places within reach that hold evidence the player has not looked for. */
  look: string[];
  /** For each verb that takes a choice, the choices the core offers now: `player.offers` of the frame. */
  offers: Record<string, Offer[]>;
  /** What the player can ask about: the whole list in a talk, none outside one. */
  topics: Topic[];
}

export interface ViewFrame {
  people: FramePerson[];
  /** The player of the bridge town. The frame of the demo world has none. */
  player: FramePlayer | null;
  time: FrameTime;
  weather: string;
  bubbles: Bubble[];
  /**
   * The people who are talking beyond the hearing of the player: a bubble whose `talking` is true (its `text` is null) says that
   * they talk and not what about. They have no words to show, so they are not in `bubbles`, and the map draws a marker over each.
   */
  talkers: string[];
  dots: Dot[];
  lanterns: Lantern[];
  hud: Record<string, unknown>;
  /** The ending as the `ending` event carried it, in every frame after the last night. Null before, and in a frame from a core that does not send it. */
  ending: Record<string, unknown> | null;
  /** Anything else the frame carries, for the readers that know a key of their own. */
  raw: Frame;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

function readOffers(value: unknown): Record<string, Offer[]> {
  const out: Record<string, Offer[]> = {};
  if (!isRecord(value)) return out;
  for (const [verb, list] of Object.entries(value)) {
    const offers: Offer[] = [];
    for (const raw of Array.isArray(list) ? list : []) {
      if (!isRecord(raw) || typeof raw.id !== "string") continue;
      offers.push({ id: raw.id, name: readName(isRecord(raw.label) ? raw.label : raw, raw.id), body: isRecord(raw.body) ? raw.body : null });
    }
    out[verb] = offers;
  }
  return out;
}

/** The topics the core lists, in its order. A topic of a kind the page has no group for is left out. */
function readTopics(value: unknown): Topic[] {
  const out: Topic[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    const kind = ASK_KINDS.find((k) => k === raw.kind);
    if (kind === undefined) continue;
    out.push({ id: raw.id, kind, name: readName(raw.label, raw.id) });
  }
  return out;
}

const minutes = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null);

function readCosts(value: unknown): TalkCosts | null {
  if (!isRecord(value)) return null;
  return { ask: minutes(value.ask), askSource: minutes(value.ask_source), tell: minutes(value.tell), entrust: minutes(value.entrust), promise: minutes(value.promise) };
}

function readActCosts(value: unknown): ActCosts | null {
  const talk = readCosts(value);
  return talk === null || !isRecord(value) ? null : { ...talk, speak: minutes(value.speak) };
}

/** The time of day in `player.talk.leaves_at`, and in the event `talk_start`. */
export function readLeavesAt(value: unknown): LeavesAt | null {
  if (!isRecord(value) || typeof value.hour !== "number") return null;
  return { hour: Math.trunc(value.hour), minute: Math.trunc(num(value.minute, 0)) };
}

function readTalk(value: unknown): FrameTalk | null {
  if (!isRecord(value) || typeof value.npc !== "string") return null;
  return { npc: value.npc, costs: readCosts(value.costs), leavesAt: readLeavesAt(value.leaves_at) };
}

function readPlayer(value: unknown): FramePlayer | null {
  if (!isRecord(value) || typeof value.x !== "number" || typeof value.y !== "number") return null;
  const talk = readTalk(value.talk);
  return {
    x: value.x,
    y: value.y,
    activity: str(value.activity),
    talk,
    costs: readActCosts(value.costs),
    look: Array.isArray(value.look) ? value.look.filter((id): id is string => typeof id === "string") : [],
    offers: readOffers(value.offers),
    topics: readTopics(value.topics),
  };
}

/** Night hours are 21 to 24 and 0 to 6. Without a phase in the frame (m0), the hour decides. */
function readTime(value: unknown): FrameTime {
  const time = isRecord(value) ? value : {};
  const hour = num(time.hour, 6);
  const phase = time.phase === "day" || time.phase === "night" ? time.phase : hour >= 21 || hour < 6 ? "night" : "day";
  return { day: Math.max(1, Math.trunc(num(time.day, 1))), hour, minute: num(time.minute, 0), phase };
}

export function readFrame(frame: Frame): ViewFrame {
  const people: FramePerson[] = [];
  for (const npc of frame.npcs) {
    const extra = npc as unknown as Record<string, unknown>;
    people.push({
      id: npc.id,
      x: npc.x,
      y: npc.y,
      activity: str(extra.activity),
      carrying: typeof extra.carrying === "string" ? extra.carrying : null,
      status: typeof extra.status === "string" ? extra.status : null,
    });
  }

  const bubbles: Bubble[] = [];
  const talkers: string[] = [];
  for (const raw of Array.isArray(frame.bubbles) ? frame.bubbles : []) {
    if (!isRecord(raw) || typeof raw.npc !== "string") continue;
    // A telling beyond hearing says that people talk and not what about: the speaker gets a marker and no words, whatever else the bubble has.
    if (raw.talking === true) {
      if (!talkers.includes(raw.npc)) talkers.push(raw.npc);
      continue;
    }
    const text = readName(raw.text);
    if (text.zh === "" && text.en === "") continue;
    bubbles.push({ npc: raw.npc, until: num(raw.until, Number.POSITIVE_INFINITY), text });
  }

  const dots: Dot[] = [];
  for (const raw of Array.isArray(frame.dots) ? frame.dots : []) {
    if (!isRecord(raw) || typeof raw.from !== "string" || typeof raw.to !== "string") continue;
    dots.push({
      id: str(raw.id, `${raw.from}>${raw.to}`),
      from: raw.from,
      to: raw.to,
      topic: str(raw.topic),
      progress: Math.min(1000, Math.max(0, num(raw.progress, 0))),
    });
  }

  const lanterns: Lantern[] = [];
  for (const raw of Array.isArray(frame.lanterns) ? frame.lanterns : []) {
    if (!isRecord(raw) || typeof raw.x !== "number" || typeof raw.y !== "number") continue;
    lanterns.push({ household: str(raw.household), place: str(raw.place), x: raw.x, y: raw.y });
  }

  return {
    people,
    player: readPlayer(frame.player),
    time: readTime(frame.time),
    weather: typeof frame.weather === "string" ? frame.weather : "clear",
    bubbles,
    talkers,
    dots,
    lanterns,
    hud: isRecord(frame.hud) ? frame.hud : {},
    ending: isRecord(frame.ending) ? frame.ending : null,
    raw: frame,
  };
}

// --- The clock ---------------------------------------------------------------------------------

/**
 * Whether an act of `minutes` runs to the hour the person of the talk has to go (`player.talk.leaves_at`), which ends the talk
 * once the act is said: the clock is read to the minute, so it never says no when it is yes. The hour they go can be after
 * midnight of the clock on show, and then it is the next day's.
 */
export function runsPastLeaving(time: Pick<FrameTime, "hour" | "minute">, leavesAt: LeavesAt | null, minutes: number | null): boolean {
  if (leavesAt === null || minutes === null) return false;
  const now = time.hour * 60 + time.minute;
  let leaves = leavesAt.hour * 60 + leavesAt.minute;
  if (leaves < now) leaves += 24 * 60;
  return now + minutes >= leaves;
}

/** The twelve double hours of the old Chinese day, from 23:00. */
const SHICHEN = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"] as const;

/** The double hour that contains a clock hour: 申 for 15:00 to 17:00. */
export function shichen(hour: number): string {
  const index = Math.floor((((hour + 1) % 24) + 24) % 24 / 2);
  return SHICHEN[index] ?? SHICHEN[0];
}

export type DayPart = "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night";

/** A word for the time of day, for the interface in English. */
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 11) return "morning";
  if (hour >= 11 && hour < 13) return "noon";
  if (hour >= 13 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night";
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/**
 * How much daylight the map gets, from 1 (full day) to a floor at night. The core's phases change
 * at 21:00 and 06:00, and the light runs ahead of them: dusk from 17:30, dawn from 04:30.
 */
export const NIGHT_LIGHT = 0.16;
export function daylight(hour: number, minute: number): number {
  const h = (((hour + minute / 60) % 24) + 24) % 24;
  if (h >= 6 && h < 17.5) return 1;
  if (h >= 17.5 && h < 21) return 1 - (1 - NIGHT_LIGHT) * smooth((h - 17.5) / 3.5);
  if (h >= 4.5 && h < 6) return NIGHT_LIGHT + (1 - NIGHT_LIGHT) * smooth((h - 4.5) / 1.5);
  return NIGHT_LIGHT;
}

// --- Rumours -----------------------------------------------------------------------------------

export type TopicKind = "blame" | "clear" | "other";

/**
 * The colour class of a rumour. The core sends one of three topics, made from what the telling says: `blame` for the claim that
 * someone broke or took something (red), `clear` for a denial or a cause that is nobody's doing, such as the flood (blue), and
 * `other` for anything else (neutral). A topic the page does not know is sorted by its words.
 */
export function topicKind(topic: string): TopicKind {
  const t = topic.toLowerCase();
  if (t === "blame" || t === "clear" || t === "other") return t;
  if (/blame|accus|fault|guilt|culprit|sabotag|wreck|destroy|ruin|damage|怪|责|毁|破坏/.test(t)) return "blame";
  if (/clear|exculpat|innocen|vindicat|truth|proof|澄清|清白|无辜/.test(t)) return "clear";
  return "other";
}
