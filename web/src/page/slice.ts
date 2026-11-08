/**
 * The keys of the frame beyond the map and the clock (the tables in the docstring of `lantern_core.world.bridge` list them):
 * `tasks` and `tracked`, `cards`, `judgments` and `hint`, `commitments` and `site`, `recap`, `gazette` and `night`, and the extras of
 * `player.talk` (read in frame.ts). A frame from a core that does not send a key leaves the field null,
 * and the page shows a dash or says nothing, as it does for every other number it has not been given.
 *
 * Two more keys are read by the page, and a frame may leave them out: `board` (who agreed to help by family, the work
 * hours, the next work time, the state of the truth and of the peace between the families) and `statement`
 * (the card of the full statement: its three parts, the option chosen in each, whether the statement can be made and why not). They
 * are optional, and every field of them is too: what the frame leaves out the board leaves out, or shows as a dash, and a frame with
 * no `statement` has no card.
 */
import { type Name, readName } from "./scene.ts";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const whole = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** A name that is there, or null where the key is missing or says nothing. */
function nameOrNull(value: unknown): Name | null {
  if (value === null || value === undefined) return null;
  const name = readName(value);
  return name.zh === "" && name.en === "" ? null : name;
}

// --- Tasks -------------------------------------------------------------------------------------

export type TaskState = "open" | "blocked" | "done" | "stale";
const TASK_STATES: readonly TaskState[] = ["open", "blocked", "done", "stale"];
export type TaskJob = "bridge" | "truth" | "peace";
const TASK_JOBS: readonly TaskJob[] = ["bridge", "truth", "peace"];

/** The requests a task may ask for with `entrust`: the kinds the core takes (`entrust.py`). One the page does not know is kept as it came. */
export const REQUESTS = ["material", "lend", "lane", "testify", "join", "persuade", "convene"] as const;
/** The ways a task may ask to speak in public with `speak`. */
export const SPEECHES = ["evidence", "meal", "clarify", "statement"] as const;

/** What one click on a task does: a verb, and what it is about. */
export interface TaskAction {
  verb: string;
  npc: string | null;
  place: string | null;
  item: string | null;
  /** For `entrust`: which request. Null for a request that names only an item (the bamboo of the first day), which the list of the talk offers as before. */
  request?: string | null;
  /** For `speak`: `evidence` (showing what is held), `meal`, `clarify` or `statement` (the full statement of the card). Null for speaking up as before. */
  kind?: string | null;
  /** For the request `persuade`: the person to be talked round. */
  target?: string | null;
}

/** When and where the task can be done, the hours being whole numbers. */
export interface TaskWindow {
  day: number;
  from: number;
  to: number;
  place: string;
}

/** Somebody whose routine has them at the place of a task's window, and from when to when (minutes of the day: 17:30 is 1050). */
export interface Expected {
  id: string;
  from: number;
  to: number;
}

export interface Task {
  id: string;
  /** `obstacle`, `lead`, `need`, `promise` or `venue`; a kind the page does not know is kept as it came. */
  kind: string;
  job: TaskJob | null;
  text: Name;
  why: Name | null;
  next: Name | null;
  state: TaskState;
  blocker: Name | null;
  action: TaskAction | null;
  window: TaskWindow | null;
  /** The people expected at the window, for a task of an occasion that is open or blocked. Null where the task has none. */
  expected: Expected[] | null;
}

export interface Tasks {
  list: Task[];
  /** The id of the task the player follows. It may name a task the list does not have. */
  tracked: string | null;
}

function readAction(value: unknown): TaskAction | null {
  if (!isRecord(value) || typeof value.verb !== "string" || value.verb === "") return null;
  const id = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
  return { verb: value.verb, npc: id(value.npc), place: id(value.place), item: id(value.item), request: id(value.request), kind: id(value.kind), target: id(value.target) };
}

function readWindow(value: unknown): TaskWindow | null {
  if (!isRecord(value)) return null;
  const day = whole(value.day);
  const from = whole(value.from);
  const to = whole(value.to);
  return day === null || from === null || to === null ? null : { day, from, to, place: text(value.place) };
}

function readExpected(value: unknown): Expected[] | null {
  if (!Array.isArray(value)) return null;
  const out: Expected[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") continue;
    const from = whole(raw.from);
    const to = whole(raw.to);
    if (from !== null && to !== null) out.push({ id: raw.id, from, to });
  }
  return out.length === 0 ? null : out;
}

/** The `tasks` and `tracked` keys of a frame. Null when the frame has no `tasks` list. */
export function readTasks(frame: Record<string, unknown>): Tasks | null {
  if (!Array.isArray(frame.tasks)) return null;
  const list: Task[] = [];
  for (const raw of frame.tasks) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") continue;
    const label = readName(raw.text);
    if (label.zh === "" && label.en === "") continue;
    list.push({
      id: raw.id,
      kind: text(raw.kind),
      job: TASK_JOBS.find((job) => job === raw.job) ?? null,
      text: label,
      why: nameOrNull(raw.why),
      next: nameOrNull(raw.next),
      state: TASK_STATES.find((state) => state === raw.state) ?? "open",
      blocker: nameOrNull(raw.blocker),
      action: readAction(raw.action),
      window: readWindow(raw.window),
      expected: readExpected(raw.expected),
    });
  }
  return { list, tracked: typeof frame.tracked === "string" && frame.tracked !== "" ? frame.tracked : null };
}

/** The task the player follows, if the frame lists it. */
export function trackedTask(tasks: Tasks | null): Task | null {
  if (tasks === null || tasks.tracked === null) return null;
  return tasks.list.find((task) => task.id === tasks.tracked) ?? null;
}

/** Whether a task is still to be worked on: it is open, or blocked by something that can be cleared. A task that is done or has lapsed is settled. */
export const isLive = (task: Task): boolean => task.state === "open" || task.state === "blocked";

// --- The notebook: what the player judged ---------------------------------------------------------

/** How two lines of the notebook stand to each other, as the player judges it. */
export type Relation = "unsupported" | "contradicts" | "mismatch";
export const RELATIONS: readonly Relation[] = ["unsupported", "contradicts", "mismatch"];

export interface Judgment {
  a: string;
  b: string;
  relation: Relation;
  made: number;
}

export interface Hint {
  a: string;
  b: string;
  /** Said when the player asks a second time. */
  relation: Relation | null;
}

export const isRelation = (value: unknown): value is Relation => RELATIONS.includes(value as Relation);

export function readJudgments(frame: Record<string, unknown>): Judgment[] | null {
  if (!Array.isArray(frame.judgments)) return null;
  const out: Judgment[] = [];
  for (const raw of frame.judgments) {
    if (!isRecord(raw) || typeof raw.a !== "string" || typeof raw.b !== "string" || !isRelation(raw.relation)) continue;
    out.push({ a: raw.a, b: raw.b, relation: raw.relation, made: whole(raw.made) ?? 0 });
  }
  return out;
}

export function readHint(frame: Record<string, unknown>): Hint | null {
  const raw = frame.hint;
  if (!isRecord(raw) || typeof raw.a !== "string" || typeof raw.b !== "string") return null;
  return { a: raw.a, b: raw.b, relation: isRelation(raw.relation) ? raw.relation : null };
}

// --- Commitments and the pile at the bridge ----------------------------------------------------------

export type CommitmentState = "promised" | "delivered" | "broken" | "withdrawn";
const COMMITMENT_STATES: readonly CommitmentState[] = ["promised", "delivered", "broken", "withdrawn"];

/** Something somebody promised the manager. "Promised" and "delivered" are two states and are never merged. */
export interface Commitment {
  id: string;
  by: string;
  /** The promise as a request, in both languages: "Bring 4 poles of bamboo to the Stone Bridge". */
  what: Name;
  item: string;
  amount: number;
  due: { day: number; hour: number } | null;
  state: CommitmentState;
  /** Why a promise was not kept or was taken back, in the core's words. Null for any other. */
  reason: Name | null;
}

export function readCommitments(frame: Record<string, unknown>): Commitment[] | null {
  if (!Array.isArray(frame.commitments)) return null;
  const out: Commitment[] = [];
  for (const raw of frame.commitments) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.by !== "string") continue;
    const due = isRecord(raw.due) && whole(raw.due.day) !== null ? { day: whole(raw.due.day) ?? 0, hour: whole(raw.due.hour) ?? 0 } : null;
    out.push({
      id: raw.id,
      by: raw.by,
      what: readName(raw.what),
      item: text(raw.item),
      amount: Math.max(0, whole(raw.amount) ?? 0),
      due,
      state: COMMITMENT_STATES.find((state) => state === raw.state) ?? "promised",
      // The words, in both languages. The code of the reason that the event `commitment` carries is not words.
      reason: isRecord(raw.reason) ? nameOrNull(raw.reason) : null,
    });
  }
  return out;
}

/** What lies at the bridge: an amount for each item. */
export type Site = Record<string, number>;

export function readSite(frame: Record<string, unknown>): Site | null {
  if (!isRecord(frame.site)) return null;
  const out: Site = {};
  for (const [item, amount] of Object.entries(frame.site)) {
    const n = whole(amount);
    if (n !== null) out[item] = Math.max(0, n);
  }
  return out;
}

// --- The recap of the morning -------------------------------------------------------------------------

export interface RecapLine {
  text: Name;
  /** The sequence numbers of the events the line is about. */
  events: number[];
}

/** The lines of a recap as the frame has them, or as the page kept them with a save. At most three. Null when there are none. */
export function readRecapLines(value: unknown): RecapLine[] | null {
  if (!Array.isArray(value)) return null;
  const out: RecapLine[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const label = nameOrNull(raw.text);
    if (label === null) continue;
    out.push({ text: label, events: Array.isArray(raw.events) ? raw.events.filter((e): e is number => typeof e === "number") : [] });
  }
  return out.length === 0 ? null : out.slice(0, 3);
}

/** The `recap` of a frame: it is in the frame of the call that made it and in no other. Null in every other. */
export function readRecap(frame: Record<string, unknown>): RecapLine[] | null {
  return readRecapLines(frame.recap);
}

// --- The paper of the morning and the summary of the night ------------------------------------------------

/** One thing the paper says: what kind of thing it is (`delivery`, `truth_told`, `quiet` and the like; a kind the page does not know is kept as it came) and the words. */
export interface PaperItem {
  kind: string;
  text: Name;
}

/** A task as the paper names it: what, when and where, and the next step. */
export interface PaperTask {
  id: string;
  text: Name;
  state: TaskState;
  window: TaskWindow | null;
  next: Name | null;
}

/** The paper of a morning (`gazette` of the frame): the headline, up to two short items, what is to be done today and the other chances, and the street talk. */
export interface Gazette {
  day: number;
  head: PaperItem;
  news: PaperItem[];
  today: PaperTask | null;
  more: PaperTask[];
  talk: PaperItem[];
}

/** The summary of a night (`night` of the frame): what changed today, the most urgent task that is blocked and what blocks it, and the step for tomorrow. */
export interface Night {
  day: number;
  changed: PaperItem;
  blocked: { id: string; text: Name; blocker: Name | null } | null;
  step: { id: string; text: Name; window: TaskWindow | null } | null;
}

function readItem(value: unknown): PaperItem | null {
  if (!isRecord(value)) return null;
  const words = nameOrNull(value.text);
  return words === null ? null : { kind: text(value.kind), text: words };
}

function readItems(value: unknown): PaperItem[] {
  return (Array.isArray(value) ? value : []).flatMap((raw): PaperItem[] => {
    const item = readItem(raw);
    return item === null ? [] : [item];
  });
}

function readPaperTask(value: unknown): PaperTask | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") return null;
  const label = nameOrNull(value.text);
  if (label === null) return null;
  return { id: value.id, text: label, state: TASK_STATES.find((state) => state === value.state) ?? "open", window: readWindow(value.window), next: nameOrNull(value.next) };
}

/** The `gazette` of a frame: it is in the frame of the call that made it and in no other. Null in every other. */
export function readGazette(frame: Record<string, unknown>): Gazette | null {
  const raw = frame.gazette;
  if (!isRecord(raw)) return null;
  const head = readItem(raw.head);
  const day = whole(raw.day);
  if (head === null || day === null) return null;
  return {
    day,
    head,
    news: readItems(raw.news).slice(0, 2),
    today: readPaperTask(raw.today),
    more: (Array.isArray(raw.more) ? raw.more : []).flatMap((row): PaperTask[] => {
      const task = readPaperTask(row);
      return task === null ? [] : [task];
    }).slice(0, 2),
    talk: readItems(raw.talk).slice(0, 2),
  };
}

/** The `night` of a frame: in the frame of the call that made it and in no other. */
export function readNight(frame: Record<string, unknown>): Night | null {
  const raw = frame.night;
  if (!isRecord(raw)) return null;
  const changed = readItem(raw.changed);
  const day = whole(raw.day);
  if (changed === null || day === null) return null;
  const blocked = isRecord(raw.blocked) && typeof raw.blocked.id === "string" && nameOrNull(raw.blocked.text) !== null ? { id: raw.blocked.id, text: readName(raw.blocked.text), blocker: nameOrNull(raw.blocked.blocker) } : null;
  const step = isRecord(raw.step) && typeof raw.step.id === "string" && nameOrNull(raw.step.text) !== null ? { id: raw.step.id, text: readName(raw.step.text), window: readWindow(raw.step.window) } : null;
  return { day, changed, blocked, step };
}

// --- The preparation board ----------------------------------------------------------------------------

export type StatementPart = "cause" | "course" | "rumour";
export const STATEMENT_PARTS: readonly StatementPart[] = ["cause", "course", "rumour"];

export interface StatementColumn {
  part: StatementPart;
  support: number;
  against: number;
  /** Whether something is still missing in this column. */
  gap: boolean;
}

export interface PeaceAct {
  id: string;
  text: Name;
  done: boolean;
}

/** Where the elder stood at the last public statement: not there, there and not convinced, or convinced. */
export type ElderStand = "absent" | "refused" | "accepted";
const ELDER_STANDS: readonly ElderStand[] = ["absent", "refused", "accepted"];

/** The last public statement of the manager: when and where, how many named people were there, how many of them accepted, and the condition it missed. */
export interface TruthLast {
  day: number;
  hour: number;
  venue: string | null;
  /** The people with a name who were there. */
  named: number;
  accepted: number;
  /** Of those there, in percent. */
  percent: number;
  elder: ElderStand | null;
  /** In the core's words, which condition it missed (fewer than five named people there, too few accepted, the elder absent or not convinced). Null when it missed none. */
  why: Name | null;
}

export interface Board {
  /** How many helpers agreed, by family (the family id may be null for a helper of none). */
  helpers: Array<{ family: string | null; count: number }> | null;
  /** How many helpers the work takes. */
  need: number | null;
  /** Whether both families have at least one helper. */
  both: boolean | null;
  /** The work hours done at the bridge and the hours it takes. */
  hours: { done: number; need: number } | null;
  /** The next time work is done at the bridge. */
  window: TaskWindow | null;
  /** Why the last work time did no work, in the core's words, if it did none. */
  stop: Name | null;
  /** By when the bridge must be mended. */
  deadline: { day: number; hour: number } | null;
  /** How much of each item the bridge takes. A core does not send it yet; where it does, the pile at the bridge is shown against it. */
  needs: Record<string, number> | null;
  /** The three columns of the statement, which a later core sends. Null before that, and the board shows the state of the truth in its place. */
  statement: StatementColumn[] | null;
  truth: { state: "open" | "done"; last: TruthLast | null } | null;
  peace: { state: "open" | "done" | null; grudge: number | null; acts: PeaceAct[]; witnessed: boolean | null } | null;
}

const openOrDone = (value: unknown): "open" | "done" | null => (value === "open" || value === "done" ? value : null);

function readTruthLast(value: unknown): TruthLast | null {
  if (!isRecord(value)) return null;
  const day = whole(value.day);
  const hour = whole(value.hour);
  if (day === null || hour === null) return null;
  return {
    day,
    hour,
    venue: typeof value.venue === "string" && value.venue !== "" ? value.venue : null,
    named: Math.max(0, whole(value.named) ?? 0),
    accepted: Math.max(0, whole(value.accepted) ?? 0),
    percent: Math.min(100, Math.max(0, whole(value.percent) ?? 0)),
    elder: ELDER_STANDS.find((stand) => stand === value.elder) ?? null,
    why: nameOrNull(value.why),
  };
}

function readNeeds(value: unknown): Record<string, number> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, number> = {};
  for (const [item, amount] of Object.entries(value)) {
    const n = whole(amount);
    if (n !== null && n > 0) out[item] = n;
  }
  return Object.keys(out).length === 0 ? null : out;
}

export function readBoard(frame: Record<string, unknown>): Board | null {
  const raw = frame.board;
  if (!isRecord(raw)) return null;
  const helpers = Array.isArray(raw.helpers)
    ? raw.helpers
        .filter(isRecord)
        .map((h) => ({ family: typeof h.family === "string" ? h.family : null, count: Math.max(0, whole(h.count) ?? 0) }))
    : null;
  const columns = Array.isArray(raw.statement)
    ? raw.statement.filter(isRecord).flatMap((c): StatementColumn[] => {
        const part = STATEMENT_PARTS.find((p) => p === c.part);
        return part === undefined ? [] : [{ part, support: Math.max(0, whole(c.support) ?? 0), against: Math.max(0, whole(c.against) ?? 0), gap: c.gap !== false }];
      })
    : null;
  const hours = isRecord(raw.hours) && whole(raw.hours.done) !== null && whole(raw.hours.need) !== null ? { done: Math.max(0, whole(raw.hours.done) ?? 0), need: Math.max(0, whole(raw.hours.need) ?? 0) } : null;
  const deadline = isRecord(raw.deadline) && whole(raw.deadline.day) !== null && whole(raw.deadline.hour) !== null ? { day: whole(raw.deadline.day) ?? 0, hour: whole(raw.deadline.hour) ?? 0 } : null;
  const truthState = isRecord(raw.truth) ? openOrDone(raw.truth.state) : null;
  const truth = isRecord(raw.truth) && truthState !== null ? { state: truthState, last: readTruthLast(raw.truth.last) } : null;
  const peace = isRecord(raw.peace)
    ? {
        state: openOrDone(raw.peace.state),
        grudge: whole(raw.peace.grudge) === null ? null : Math.min(100, Math.max(0, whole(raw.peace.grudge) ?? 0)),
        acts: (Array.isArray(raw.peace.acts) ? raw.peace.acts : []).filter(isRecord).flatMap((a): PeaceAct[] => (typeof a.id === "string" ? [{ id: a.id, text: readName(a.text), done: a.done === true }] : [])),
        witnessed: typeof raw.peace.witnessed === "boolean" ? raw.peace.witnessed : null,
      }
    : null;
  return {
    helpers,
    need: whole(raw.need),
    both: typeof raw.both === "boolean" ? raw.both : null,
    hours,
    window: readWindow(raw.window),
    stop: isRecord(raw.stop) ? nameOrNull(raw.stop) : null,
    deadline,
    needs: readNeeds(raw.needs),
    statement: columns,
    truth,
    peace,
  };
}

// --- The statement card -------------------------------------------------------------------------------

/**
 * One thing the manager can say about a part of the matter, with how many of the notes they hold bear on it: `support` for it,
 * `against` it. `entries` are the ids of the notes behind the two numbers.
 */
export interface StatementOption {
  id: string;
  text: Name;
  support: number;
  against: number;
  entries: string[];
}

/** A part of the statement (the cause, the course, how the rumour began), its options, and the one the manager chose. */
export interface StatementPartCard {
  part: StatementPart;
  /** The core's name for the part. Null where the frame leaves it out, and the page has its own words. */
  title: Name | null;
  options: StatementOption[];
  /** The id of the option chosen. It may name an option the list does not show. */
  chosen: string | null;
  /** Nothing the manager holds bears on any option of this part. */
  gap: boolean;
}

/** The statement the manager made last: where it stood, which parts did not hold, and why in the core's words. */
export interface StatementLast extends TruthLast {
  /** Whether it told the truth in public: every part held, the evidence was enough and the people there accepted. */
  told: boolean;
  wrong: StatementPart[];
}

/** The `statement` key of a frame: the card the manager fills in, and whether and why a full statement can be made now. */
export interface StatementCard {
  parts: StatementPartCard[];
  /** A full statement can be made here and now. */
  canState: boolean;
  /** Why not, in the core's words, when it cannot. */
  whyNot: Name | null;
  /** The statement of the day has been made. */
  usedToday: boolean;
  last: StatementLast | null;
}

const count = (value: unknown): number => Math.max(0, whole(value) ?? 0);

const idList = (value: unknown): string[] => [...new Set((Array.isArray(value) ? value : []).filter((id): id is string => typeof id === "string" && id !== ""))];

function readOption(value: unknown): StatementOption | null {
  if (!isRecord(value) || typeof value.id !== "string" || value.id === "") return null;
  const label = nameOrNull(value.text);
  if (label === null) return null;
  return { id: value.id, text: label, support: count(value.support), against: count(value.against), entries: idList(value.entries) };
}

function readPartCard(value: unknown): StatementPartCard | null {
  if (!isRecord(value)) return null;
  const part = STATEMENT_PARTS.find((p) => p === value.part);
  if (part === undefined) return null;
  const options: StatementOption[] = [];
  for (const raw of Array.isArray(value.options) ? value.options : []) {
    const option = readOption(raw);
    if (option !== null && !options.some((o) => o.id === option.id)) options.push(option);
  }
  return {
    part,
    title: nameOrNull(value.title),
    options,
    chosen: typeof value.chosen === "string" && value.chosen !== "" ? value.chosen : null,
    // A frame that does not say has a gap where no option has a note behind it.
    gap: typeof value.gap === "boolean" ? value.gap : !options.some((o) => o.support + o.against > 0),
  };
}

function readStatementLast(value: unknown): StatementLast | null {
  const base = readTruthLast(value);
  if (base === null || !isRecord(value)) return null;
  const wrong = STATEMENT_PARTS.filter((p) => Array.isArray(value.wrong) && value.wrong.includes(p));
  return { ...base, told: value.told === true, wrong };
}

/**
 * The `statement` key of a frame, or null where the frame has none. The parts come in the order
 * cause, course, rumour whatever order the frame gave them, and a part the frame leaves out is left out here.
 */
export function readStatement(frame: Record<string, unknown>): StatementCard | null {
  const raw = frame.statement;
  if (!isRecord(raw)) return null;
  const parts: StatementPartCard[] = [];
  for (const wanted of STATEMENT_PARTS) {
    for (const item of Array.isArray(raw.parts) ? raw.parts : []) {
      if (!isRecord(item) || item.part !== wanted) continue;
      const found = readPartCard(item);
      if (found !== null) {
        parts.push(found);
        break;
      }
    }
  }
  return {
    parts,
    canState: raw.can_state === true,
    whyNot: isRecord(raw.why_not) ? nameOrNull(raw.why_not) : null,
    usedToday: raw.used_today === true,
    last: readStatementLast(raw.last),
  };
}

// --- The card of a person -----------------------------------------------------------------------------

/** Where the routine of a person puts them: the entry in force (`now`) and the ones after it, `from` in minutes of the day. */
export interface FindEntry {
  from: number;
  place: string;
  act: string;
  now: boolean;
  /** The routine has come round to the start of the next day. */
  tomorrow: boolean;
}

/** The account somebody else told a person and they did not take in, as they said it to the player in the same answer. */
export interface CardRival {
  /** What the other account says. */
  text: Name;
  /** Who they say told them. */
  who: Name;
}

/** The latest thing a person said about who broke the rail, as the player knows it. */
export interface CardStance {
  text: Name;
  tick: number;
  at: { day: number; hour: number; minute: number };
  /** How the player learned it, in words ("They told you themselves"). */
  how: Name | null;
  /** `told` (to the player) or `overheard`; a kind the page does not know is kept as it came. */
  kind: string;
  /** The notebook entry that holds the words, if any. */
  entry: string | null;
  /** The other account they said with it, if they did: null where the key is missing (it is there only then). */
  rival: CardRival | null;
}

/** The card of a person the player has met or heard of (`cards` of the frame), with only what the player has been shown. */
export interface CardNotes {
  id: string;
  name: Name | null;
  role: Name | null;
  family: string | null;
  /** Whether the player has talked with them. */
  met: boolean;
  /** Null for a person who was not met: their routine is not known. */
  find: FindEntry[] | null;
  wants: Array<{ id: string; text: Name }>;
  /** More than 0: they owe the player. Less than 0: the player owes them. */
  favours: number | null;
  stance: CardStance | null;
  /** The ids of the commitments the person made to the player. */
  agreed: string[];
}

function readFind(value: unknown): FindEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: FindEntry[] = [];
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const from = whole(raw.from);
    if (from === null || typeof raw.place !== "string") continue;
    out.push({ from, place: raw.place, act: text(raw.act), now: raw.now === true, tomorrow: raw.tomorrow === true });
  }
  return out;
}

/** The other account of a stance. One with no words, or no one who told it, is not one: the line says who told them. */
function readRival(value: unknown): CardRival | null {
  if (!isRecord(value)) return null;
  const words = nameOrNull(value.text);
  const who = nameOrNull(value.who);
  return words === null || who === null ? null : { text: words, who };
}

function readStance(value: unknown): CardStance | null {
  if (!isRecord(value)) return null;
  const words = nameOrNull(value.text);
  if (words === null) return null;
  const at = isRecord(value.at) ? value.at : {};
  return {
    text: words,
    tick: whole(value.tick) ?? 0,
    at: { day: Math.max(1, whole(at.day) ?? 1), hour: whole(at.hour) ?? 0, minute: whole(at.minute) ?? 0 },
    how: nameOrNull(value.how),
    kind: text(value.kind),
    entry: typeof value.entry === "string" && value.entry !== "" ? value.entry : null,
    rival: readRival(value.rival),
  };
}

/** The `cards` key of a frame, by person. Null when the frame has none. */
export function readCards(frame: Record<string, unknown>): Map<string, CardNotes> | null {
  if (!Array.isArray(frame.cards)) return null;
  const out = new Map<string, CardNotes>();
  for (const raw of frame.cards) {
    if (!isRecord(raw) || typeof raw.id !== "string" || raw.id === "") continue;
    out.set(raw.id, {
      id: raw.id,
      name: nameOrNull(raw.name),
      role: nameOrNull(raw.role),
      family: typeof raw.family === "string" && raw.family !== "" ? raw.family : null,
      met: raw.met === true,
      find: readFind(raw.find),
      wants: (Array.isArray(raw.wants) ? raw.wants : []).filter(isRecord).flatMap((w): Array<{ id: string; text: Name }> => {
        const words = nameOrNull(w.text);
        return typeof w.id === "string" && words !== null ? [{ id: w.id, text: words }] : [];
      }),
      favours: whole(raw.favours),
      stance: readStance(raw.stance),
      agreed: (Array.isArray(raw.agreed) ? raw.agreed : []).filter((id): id is string => typeof id === "string"),
    });
  }
  return out;
}

// --- All of it ----------------------------------------------------------------------------------------

/** Everything the slice adds to a frame, each part null where the frame leaves it out. */
export interface SliceFrame {
  tasks: Tasks | null;
  judgments: Judgment[] | null;
  hint: Hint | null;
  commitments: Commitment[] | null;
  site: Site | null;
  recap: RecapLine[] | null;
  gazette: Gazette | null;
  night: Night | null;
  board: Board | null;
  cards: Map<string, CardNotes> | null;
  /** The statement card the manager fills in. Null from a core that does not send it. */
  statement: StatementCard | null;
}

export const EMPTY_SLICE: SliceFrame = { tasks: null, judgments: null, hint: null, commitments: null, site: null, recap: null, gazette: null, night: null, board: null, cards: null, statement: null };

export function readSlice(frame: Record<string, unknown> | null): SliceFrame {
  if (frame === null) return EMPTY_SLICE;
  return {
    tasks: readTasks(frame),
    judgments: readJudgments(frame),
    hint: readHint(frame),
    commitments: readCommitments(frame),
    site: readSite(frame),
    recap: readRecap(frame),
    gazette: readGazette(frame),
    night: readNight(frame),
    board: readBoard(frame),
    cards: readCards(frame),
    statement: readStatement(frame),
  };
}

// --- Small things the views share --------------------------------------------------------------------------

/** The days left before the festival night: 0 on the last day. */
export function daysLeft(day: number, days: number): number {
  return Math.max(0, days - day);
}

/** The commitments of one person, in the order the frame lists them: those they made, and those their card says they agreed. */
export function commitmentsOf(slice: SliceFrame, npc: string): Commitment[] {
  const agreed = new Set(slice.cards?.get(npc)?.agreed ?? []);
  return (slice.commitments ?? []).filter((c) => c.by === npc || agreed.has(c.id));
}

/** Open tasks whose click is about this person. */
export function tasksAbout(slice: SliceFrame, npc: string): Task[] {
  return (slice.tasks?.list ?? []).filter((task) => task.action?.npc === npc && task.state !== "done" && task.state !== "stale");
}

/**
 * The tasks of a person's card that get a button, one for each thing they send the player to do. Two tasks can ask for the same thing
 * of the same person (the first bamboo and the talk that blames Li Er both end in asking Granny Li), and the card shows it once, for the
 * task that comes first in the list.
 */
export function buttonTasks(tasks: readonly Task[]): Task[] {
  const seen = new Set<string>();
  return tasks.filter((task) => {
    const action = task.action;
    if (action === null) return false;
    const key = [action.verb, action.npc, action.place, action.item, action.request, action.kind, action.target].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The latest window of a person in the tasks: where and when to find them. */
export function windowOf(slice: SliceFrame, npc: string): TaskWindow | null {
  const found = tasksAbout(slice, npc).find((task) => task.window !== null);
  return found?.window ?? null;
}

/**
 * Where a person stands on the accusation a clarification is about: `against` the clarification (they hold the accusation),
 * `unsure`, or `for` it (they take in that the claim goes beyond what the witness saw). The core words it so (`clarify.py`).
 */
export type Stance = "against" | "unsure" | "for";
export const STANCES: readonly Stance[] = ["against", "unsure", "for"];

/** A stance as the core words it. A word that is not one of the three is not guessed at: it is null. */
export const stanceOf = (value: unknown): Stance | null => STANCES.find((stance) => stance === value) ?? null;

/** One person of the audience of a clarification: where they stood, where they stand, and what they say in public. */
export interface Hearer {
  npc: string;
  before: Stance | null;
  after: Stance | null;
  reason: Name | null;
}

/** What the people who were there made of a clarification (the event `clarified`). */
export interface Clarified {
  /** The tick the event came in, to tell one clarification from the next. */
  key: string;
  /** The place it was made at. */
  venue: string | null;
  /** The entry of the notebook that was said to go beyond the evidence, and the entries it was held against. */
  claim: string | null;
  basis: string[];
  /** How many of those there took it in. */
  accepted: number | null;
  audience: Hearer[];
}

export function readClarified(event: Record<string, unknown>, key: string): Clarified | null {
  if (!Array.isArray(event.audience)) return null;
  const audience: Hearer[] = [];
  for (const raw of event.audience) {
    if (!isRecord(raw) || typeof raw.npc !== "string") continue;
    audience.push({ npc: raw.npc, before: stanceOf(raw.before), after: stanceOf(raw.after), reason: nameOrNull(raw.reason) });
  }
  return {
    key,
    venue: typeof event.venue === "string" && event.venue !== "" ? event.venue : null,
    claim: typeof event.claim === "string" ? event.claim : null,
    basis: (Array.isArray(event.basis) ? event.basis : []).filter((id): id is string => typeof id === "string"),
    accepted: whole(event.accepted),
    audience,
  };
}

/** Whether a hearer changed their stand. A stand the page cannot read is not a change. */
export const changed = (hearer: Hearer): boolean => hearer.before !== null && hearer.after !== null && hearer.before !== hearer.after;
