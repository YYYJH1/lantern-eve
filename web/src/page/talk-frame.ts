/**
 * What the frame says of a talk besides who is talking: the one request put forward (`ask_for`) and the others (`asks_more`), what the
 * person asks in return (`wants`), the promise that can be kept now (`keep`), what can be promised (`give`) and the order the page
 * shows them in (`queue`), and, in the `hud`, the small things of the day (`gift`) and the reason an act is not on offer (`verbs_off`).
 * The core chooses and the page shows: nothing here decides whether a request is granted. A frame from a core that does not send a key
 * leaves it out, and the reader answers null.
 *
 * It also holds the one rule the page makes for itself in a talk: which topics to ask about come first (`rankTopics`).
 */
import type { AskKind, Offer, Topic } from "./frame.ts";
import type { NotebookEntry } from "./notebook.ts";
import { type Name, readName } from "./scene.ts";
import { isLive, type SliceFrame, type Task } from "./slice.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const whole = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);

// --- A talk -----------------------------------------------------------------------------------------

/** How far a request stands: `open` (not asked yet), `done`, `waiting` (agreed, to be delivered) or `refused` (turned down today). */
export type AskStatus = "open" | "done" | "waiting" | "refused";
const ASK_STATUSES: readonly AskStatus[] = ["open", "done", "waiting", "refused"];

/** A request that can be made to the person: the words, the fields of the action and where it stands. */
export interface AskItem extends Offer {
  status: AskStatus;
  /** The id of the task the request is for, when the core says. */
  task: string | null;
}

/** What the person asks in return for a request they turned down for want of weight. */
export interface Wants {
  /** The proposal, which stays the same while the state does. */
  key: string;
  token: string;
  /** The request that was turned down, in words. */
  asks: Name;
  request: AskItem;
  /** The promise they ask for. */
  offer: Offer;
}

/**
 * How the page tells a proposal it has put aside from the next one: by the request it is for and the token the core gave it, together. Two
 * requests weighed alike have one token, and a request weighed again has a new one.
 */
export const proposalId = (wants: Pick<Wants, "key" | "token">): string => `${wants.key}#${wants.token}`;

/** A promise of the manager's that can be kept to the person now. */
export interface Keeping {
  pledge: string;
  /** The game day it falls due, where the core says. */
  due: number | null;
  /** Whether it is kept before its day. */
  early: boolean;
  what: Name;
  offer: Offer;
}

/** The ways out when nothing is left to promise. */
export type GiveWay = "clear_truth" | "gift" | "ask_others";
const GIVE_WAYS: readonly GiveWay[] = ["clear_truth", "gift", "ask_others"];

export interface Give {
  /** The one the person wants. */
  preferred: Offer | null;
  /** The others that can still be promised. */
  more: Offer[];
  ways: GiveWay[];
}

/** The things the talk puts forward, in the order the core gives: an answer awaited, promises to keep, and a promise to make. */
export type QueueItem = { kind: "answer"; key: string; token: string } | { kind: "keep"; keep: Keeping } | { kind: "give" };

export interface TalkMore {
  askFor: AskItem | null;
  asksMore: AskItem[];
  wants: Wants | null;
  keep: Keeping | null;
  give: Give;
  queue: QueueItem[];
}

function offerOf(raw: unknown): Offer | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") return null;
  return { id: raw.id, name: readName(isRecord(raw.label) ? raw.label : raw, raw.id), body: isRecord(raw.body) ? raw.body : null };
}

function askOf(raw: unknown): AskItem | null {
  const offer = offerOf(raw);
  if (offer === null || !isRecord(raw)) return null;
  const status = ASK_STATUSES.find((s) => s === raw.status) ?? "open";
  return { ...offer, status, task: typeof raw.for === "string" && raw.for !== "" ? raw.for : null };
}

function keepOf(raw: unknown): Keeping | null {
  if (!isRecord(raw)) return null;
  const offer = offerOf(raw.offer);
  const pledge = text(raw.pledge);
  if (offer === null || pledge === "") return null;
  return { pledge, due: whole(raw.due), early: raw.early === true, what: readName(raw.what), offer };
}

function wantsOf(raw: unknown): Wants | null {
  if (!isRecord(raw)) return null;
  const request = askOf(raw.request);
  const offer = offerOf(raw.offer);
  if (request === null || offer === null) return null;
  return { key: text(raw.key), token: text(raw.token), asks: readName(raw.asks), request, offer };
}

/**
 * The extra keys of `player.talk`, or null where the talk has none of them (a core from before them, or a test frame of the older shape).
 * The queue is read as the core gives it; an item of a kind the page does not know is left out.
 */
export function readTalkMore(talk: Record<string, unknown>): TalkMore | null {
  const keys = ["ask_for", "asks_more", "wants", "keep", "give", "queue"];
  if (!keys.some((key) => key in talk)) return null;
  const queue: QueueItem[] = [];
  for (const raw of Array.isArray(talk.queue) ? talk.queue : []) {
    if (!isRecord(raw)) continue;
    if (raw.kind === "answer") queue.push({ kind: "answer", key: text(raw.key), token: text(raw.token) });
    else if (raw.kind === "keep") {
      const keep = keepOf(raw);
      if (keep !== null) queue.push({ kind: "keep", keep });
    } else if (raw.kind === "give") queue.push({ kind: "give" });
  }
  const give = isRecord(talk.give) ? talk.give : {};
  return {
    askFor: askOf(talk.ask_for),
    asksMore: (Array.isArray(talk.asks_more) ? talk.asks_more : []).flatMap((raw): AskItem[] => {
      const item = askOf(raw);
      return item === null ? [] : [item];
    }),
    wants: wantsOf(talk.wants),
    keep: keepOf(talk.keep),
    give: {
      preferred: offerOf(give.preferred),
      more: (Array.isArray(give.more) ? give.more : []).flatMap((raw): Offer[] => {
        const offer = offerOf(raw);
        return offer === null ? [] : [offer];
      }),
      ways: GIVE_WAYS.filter((way) => Array.isArray(give.ways) && give.ways.includes(way)),
    },
    queue,
  };
}

// --- The hud ---------------------------------------------------------------------------------------------

/** The small things of the day (`hud.gift`): what the market has, and whether the one gift of the day is given. */
export interface GiftHud {
  day: number;
  items: Array<{ id: string; name: Name }>;
  given: boolean;
  /** The person it was given to. */
  to: string | null;
}

export function readGiftHud(hud: Record<string, unknown>): GiftHud | null {
  const raw = hud.gift;
  if (!isRecord(raw) || !Array.isArray(raw.items)) return null;
  const items = raw.items.flatMap((item): Array<{ id: string; name: Name }> => (isRecord(item) && typeof item.id === "string" ? [{ id: item.id, name: readName(item, item.id) }] : []));
  return { day: whole(raw.day) ?? 1, items, given: raw.given === true, to: typeof raw.to === "string" && raw.to !== "" ? raw.to : null };
}

// --- Which topic to ask about first ------------------------------------------------------------------------

/** How many topics the list of questions shows before "others". */
export const TOP_TOPICS = 3;

/** What a task is about, as ids the topics can be matched with: the people, the things and the places its action and its time name. */
export function taskSubjects(task: Task): { people: string[]; things: string[]; places: string[] } {
  const action = task.action;
  const people = [action?.npc, action?.target].filter((id): id is string => typeof id === "string" && id !== "");
  const things = [action?.item].filter((id): id is string => typeof id === "string" && id !== "");
  const places = [action?.place, task.window?.place].filter((id): id is string => typeof id === "string" && id !== "");
  return { people, things, places };
}

/** Whether a task names the topic. A person's own topic is not about the person talked to. */
function names(task: Task, topic: Topic, partner: string): boolean {
  const subjects = taskSubjects(task);
  if (topic.kind === "person") return topic.id !== partner && subjects.people.includes(topic.id);
  if (topic.kind === "thing") return subjects.things.includes(topic.id);
  if (topic.kind === "place") return subjects.places.includes(topic.id);
  return false;
}

/** The order of the kinds when nothing else tells them apart: a line of the notebook, then a thing, a place, a person, and last what a person likes. */
const KIND_RANK: Readonly<Record<AskKind, number>> = { entry: 0, thing: 1, place: 2, person: 3, taste: 4 };
const kindRank = (kind: string): number => KIND_RANK[kind as AskKind] ?? 5;

export interface TopicContext {
  /** The person of the talk, who is no topic of their own talk. */
  partner: string;
  slice: SliceFrame;
  /** The notebook lines. */
  entries: readonly NotebookEntry[];
  /** The ids of the notebook lines the manager has not looked at yet. */
  fresh: readonly string[];
  /** The topics already asked of this person today. */
  asked: ReadonlySet<string>;
}

/** Whether any of these words say the name of the topic. A name of a single character is not looked for in running words. */
function mentioned(words: readonly Name[], topic: Topic): boolean {
  const zh = topic.name.zh;
  const en = topic.name.en.toLowerCase();
  return words.some((w) => (zh.length >= 2 && w.zh.includes(zh)) || (en.length >= 3 && w.en.toLowerCase().includes(en)));
}

/** What a task says in words: what it is, why, the next step and what stands in the way. */
const wordsOf = (task: Task): Name[] => [task.text, task.why, task.next, task.blocker].filter((w): w is Name => w !== null);

/**
 * The topics in the order to show them: the first three are the list, the rest are "others".
 *
 * The rule, in this order of weight:
 * 1. a topic not yet asked of this person today comes before one already asked, since the answer would be the same;
 * 2. among those, the need of the day: a topic that the task in hand (the red slip) names by its action comes first, then one its words
 *    speak of, then one that another open task names or speaks of, or that a line of the notebook not yet looked at speaks of, then the rest;
 * 3. then a line of the notebook comes before a thing, a thing before a place, a place before a person, and a person before a taste, and a
 *    line not yet looked at before the others;
 * 4. what remains keeps the order the core gave.
 */
export function rankTopics(topics: readonly Topic[], context: TopicContext): Topic[] {
  const { partner, slice, entries, fresh, asked } = context;
  const followed = slice.tasks?.list.find((task) => task.id === slice.tasks?.tracked && isLive(task)) ?? null;
  const others = (slice.tasks?.list ?? []).filter((task) => task !== followed && isLive(task));
  const hint = slice.hint;
  const news = entries.filter((entry) => fresh.includes(entry.id)).map((entry) => entry.text);
  const need = (topic: Topic): number => {
    if (followed !== null && names(followed, topic, partner)) return 3;
    if (topic.kind === "entry" && hint !== null && (hint.a === topic.id || hint.b === topic.id)) return 3;
    if (followed !== null && mentioned(wordsOf(followed), topic)) return 2;
    if (others.some((task) => names(task, topic, partner) || mentioned(wordsOf(task), topic))) return 1;
    return topic.kind !== "entry" && mentioned(news, topic) ? 1 : 0;
  };
  const rows = topics
    .filter((topic) => !(topic.kind === "person" && topic.id === partner))
    .map((topic, index) => ({ topic, key: [asked.has(topic.id) ? 1 : 0, -need(topic), kindRank(topic.kind), topic.kind === "entry" && fresh.includes(topic.id) ? 0 : 1, index] }));
  rows.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const d = (a.key[i] ?? 0) - (b.key[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  });
  return rows.map((row) => row.topic);
}

/** The entry of a notebook line that an answer wrote, for the follow-up "who told you?": null where the answer wrote none. */
export function entryOfAnswer(events: ReadonlyArray<Record<string, unknown>>, partner: string): string | null {
  const asked = events.find((e) => e.kind === "asked" && e.npc === partner);
  return asked !== undefined && typeof asked.entry === "string" && asked.entry !== "" ? asked.entry : null;
}

/**
 * Whether the answer that wrote a line of the notebook can be followed by asking who told them: they passed it on (they heard it, or cannot say
 * from whom). A line the teller saw themselves, or the manager saw, has no one behind it.
 */
export function canFollowUp(entry: NotebookEntry | undefined): boolean {
  return entry !== undefined && entry.source.kind === "heard" && entry.source.how !== "saw";
}

/**
 * The line of the notebook that a line of the talk can be followed back with, by the phrase beside it that asks who told them: an answer of the
 * person that wrote a line of the notebook, which was passed on to them. Null for any other line.
 */
export function followedEntry(line: { who: string; entry?: string }, entries: readonly NotebookEntry[]): NotebookEntry | null {
  if (line.who !== "them" || line.entry === undefined) return null;
  const entry = entries.find((e) => e.id === line.entry);
  return canFollowUp(entry) ? (entry ?? null) : null;
}

/**
 * The lines of the notebook whose trail ends at this person: someone told the manager of it and named them, and they have not been asked yet.
 * Asking them who told them is the next step of the trail. Read from the notebook of the frame, whose chain names each person with an id.
 */
export function frontierEntries(notebook: unknown, person: string): string[] {
  if (!Array.isArray(notebook)) return [];
  const out: string[] = [];
  for (const raw of notebook) {
    if (!isRecord(raw) || typeof raw.id !== "string" || !Array.isArray(raw.chain) || raw.chain.length < 2) continue;
    const chain = raw.chain;
    if (chain[chain.length - 1] !== null) continue;
    const last = chain[chain.length - 2];
    if (isRecord(last) && last.id === person) out.push(raw.id);
  }
  return out;
}
