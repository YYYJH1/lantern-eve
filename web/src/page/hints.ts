/**
 * The help the world gives without a popup. When something the player has not met yet appears, it is signalled where it
 * is: a glow on the button, a ring on the map. Each signal is one hint, and the hints that have been given are kept in a
 * small log that the player can open again. A player who is stuck can ask the clan elder, who answers in three levels,
 * and who comes by himself when nothing has moved for a while of the day the player could have used.
 *
 * Everything here is a rule of the page, worked out from what the frame shows. It calls no model and adds nothing the
 * player could not have read off the screen. The words are in the interface (`hint.*`, `elder.*`).
 */
import type { MessageKey } from "../i18n/index.ts";
import type { NotebookEntry } from "./notebook.ts";
import type { Ping } from "./play.ts";
import { type Commitment, isLive, type Judgment, type Task, type TaskWindow } from "./slice.ts";
import { examplePair, isFirstHand, isHearsay, proofAppeared, TASK } from "./tutorial.ts";

/** What a hint's rule reads of the game, once for each frame. */
export interface HintContext {
  tasks: ReadonlyMap<string, Task>;
  tracked: Task | null;
  entries: readonly NotebookEntry[];
  verbs: ReadonlySet<string>;
  /** The person the player is talking to. */
  talking: string | null;
  /** Whether the frame says when the person has to go. */
  leaves: boolean;
  /** How many things somebody promised the manager. */
  promised: number;
  /** Whether a lead was given. */
  leads: number;
}

export interface HintDef {
  id: string;
  /** The key of the element the glow goes on (`signal` in the interface). */
  target: string;
  text: MessageKey;
  /**
   * What the hint is for a player who chose the brief guidance, whose task card has no next step and no button for it: the place and the line of
   * a wording that does not point at either. A hint that has none says the same to everyone.
   */
  brief?: { target: string; text: MessageKey };
  /** Whether the thing it is about has appeared. */
  when(ctx: HintContext): boolean;
  /** A ring on the map to go with the glow. */
  ping?(ctx: HintContext): Ping | null;
}

const ring = (id: string, kind: Ping["kind"]): Ping => ({ id, kind, until: 0 });

/**
 * The hints of the first day, in the order they are looked at. Each is given once, and each is about a step of the day as the core
 * plays it: Granny Li refuses over the rumour (`blocked`), the telling is followed back to the clerk who saw it (`track`, `source`),
 * two lines are set side by side and judged (`compare`), the rumour is set straight at the teahouse in the evening (`evening`,
 * `speak`), Granny Li lets go of the bamboo (`opened`), and somebody promises it (`promised`).
 */
export const HINTS: readonly HintDef[] = [
  { id: "notebook", target: "btn-notebook", text: "hint.notebook", when: (c) => c.entries.length >= 1 },
  // Something to set side by side: the core's task of the words says so, or else a rumour and a line heard at first hand.
  { id: "compare", target: "btn-notebook", text: "hint.compare", when: (c) => proofAppeared({ tasks: c.tasks, entries: c.entries, judgments: [], verbs: c.verbs, refused: false }) },
  { id: "chips", target: "topic-chips", text: "hint.chips", when: (c) => c.talking !== null && c.verbs.has("ask") },
  { id: "leaves", target: "talk-badge", text: "hint.leaves", when: (c) => c.talking !== null && c.leaves },
  { id: "blocked", target: "task-card", text: "hint.blocked", brief: { target: "task-card", text: "hint.blocked.brief" }, when: (c) => c.tracked?.state === "blocked" },
  { id: "track", target: "task-more", text: "hint.track", when: (c) => c.verbs.has("track") },
  // The task of the question who started the talk is the one that is followed, and its button says whom to ask next.
  {
    id: "source",
    target: "task-do",
    text: "hint.source",
    brief: { target: "task-card", text: "hint.source.brief" },
    when: (c) => c.tracked?.id === TASK.who && c.tracked.state === "open" && c.tracked.action?.verb === "ask_source",
  },
  { id: "lead", target: "leads", text: "hint.lead", when: (c) => c.leads > 0 },
  {
    id: "evening",
    target: "task-card",
    text: "hint.evening",
    when: (c) => c.tasks.get(TASK.evening)?.state === "open",
    ping: (c) => {
      const place = c.tasks.get(TASK.evening)?.window?.place;
      return place === undefined ? null : ring(place, "place");
    },
  },
  { id: "speak", target: "verb-speak", text: "hint.speak", when: (c) => c.verbs.has("speak") },
  // Granny Li has let go: the task of the bamboo is open again, and the person to ask is now Li Da.
  {
    id: "opened",
    target: "task-do",
    text: "hint.opened",
    brief: { target: "task-card", text: "hint.opened.brief" },
    when: (c) => c.tracked?.id === TASK.bamboo && c.tracked.state === "open" && c.tracked.action?.npc === "li_da",
  },
  { id: "promised", target: "commitments", text: "hint.promised", when: (c) => c.promised > 0 },
];

/** One hint that was given: which, and when in the game. */
export interface HintEntry {
  id: string;
  text: MessageKey;
  target: string;
  /** The tick it was given at. */
  tick: number;
  /** The game clock then. */
  at: { day: number; hour: number; minute: number };
}

/** How long a signal stays lit, in milliseconds of the page's clock, if the player does not touch what it is on. */
export const SIGNAL_MS = 9000;

/** The log of hints, and the signal that is lit now. */
export class Hints {
  readonly log: HintEntry[] = [];
  /** The hint that is lit now and the time it goes out, or null. */
  lit: { id: string; target: string; until: number } | null = null;
  private readonly given = new Set<string>();
  private readonly waiting: HintEntry[] = [];

  /**
   * Looks at the game and gives the hints that are due. Returns the hints given just now. `brief` is whether the player chose the brief guidance:
   * a hint then has the wording it has for that (`HintDef.brief`).
   */
  check(ctx: HintContext, tick: number, at: HintEntry["at"], now: number, brief = false): HintEntry[] {
    const gave: HintEntry[] = [];
    for (const def of HINTS) {
      if (this.given.has(def.id) || !def.when(ctx)) continue;
      const wording = brief && def.brief !== undefined ? def.brief : { target: def.target, text: def.text };
      this.given.add(def.id);
      const entry: HintEntry = { id: def.id, text: wording.text, target: wording.target, tick, at };
      this.log.push(entry);
      this.waiting.push(entry);
      gave.push(entry);
    }
    this.advance(now);
    return gave;
  }

  /** Lights the next hint when none is lit, and puts out the one whose time is up. */
  advance(now: number): void {
    if (this.lit !== null && now >= this.lit.until) this.lit = null;
    const next = this.lit === null ? this.waiting.shift() : undefined;
    if (next !== undefined) this.lit = { id: next.id, target: next.target, until: now + SIGNAL_MS };
  }

  /** The player touched what the signal is on, or put it away. */
  settle(target: string | null = null): void {
    if (this.lit !== null && (target === null || this.lit.target === target)) this.lit = null;
  }

  /** The rule of a hint, by its id. */
  def(id: string): HintDef | undefined {
    return HINTS.find((hint) => hint.id === id);
  }

  /** Marks the hints that are due already as given, with no signal and no line in the log: what is true is not news. */
  absorb(ctx: HintContext): void {
    for (const def of HINTS) if (def.when(ctx)) this.given.add(def.id);
  }

  /** Lights a hint of the log again, for the player who asks to see it. */
  again(id: string, now: number): void {
    const entry = this.log.find((e) => e.id === id);
    if (entry !== undefined) this.lit = { id: entry.id, target: entry.target, until: now + SIGNAL_MS };
  }

  reset(): void {
    this.log.length = 0;
    this.waiting.length = 0;
    this.given.clear();
    this.lit = null;
  }
}

// --- Nothing has moved --------------------------------------------------------------------------------------------

/**
 * How many ticks of the game the story may stand still before the elder comes by. A tick of the day is half a minute of the
 * game's clock, so this is five hours of it: a minute of real time at the common pace. Only the ticks of the game count: the world
 * held for a talk, the notebook, a card or a pause does not move the tick, and so does not move this. Nor do the ticks of the
 * night, when there is nothing to be done, the ticks of a wait for something somebody promised that is not yet due, or the ticks of a
 * game with no task left to follow (see `ticksCount`).
 */
export const STALL_TICKS = 600;

/** The level the elder gives at most. */
export const ELDER_LEVELS = 3;

/**
 * Watches for a story that has stood still. What has moved is a signature the caller makes of the tasks, the notebook,
 * the judgements and the promises. When it changes, the clock of the stall starts over. The clock counts the ticks of the game that
 * the player could have used, which the caller says frame by frame.
 */
export class Stall {
  private signature = "";
  /** The tick of the frame before, or null before the first. */
  private last: number | null = null;
  /** Whether the frame before was one whose ticks count. */
  private counted = false;
  /** The ticks that have counted since the story last moved. */
  private still = 0;
  /** How many times the elder has come by without anything having moved since. */
  visits = 0;

  /**
   * Takes the signature of the game at `tick`. Returns whether the story moved. The ticks since the frame before are counted
   * towards the wait only when this frame and that one both `counts`, so a frame on either side of dusk, or of the start of a wait,
   * does not count the ticks between them. The caller says `counts` is false for the night, for a wait that is not the player's
   * to shorten (the goods somebody promised, which are not yet due) and for a game with no task left to follow (`ticksCount`).
   */
  note(signature: string, tick: number, counts = true): boolean {
    const passed = this.last === null ? 0 : Math.max(0, tick - this.last);
    const both = counts && this.counted;
    this.last = tick;
    this.counted = counts;
    if (signature !== this.signature) {
      this.signature = signature;
      this.still = 0;
      this.visits = 0;
      return true;
    }
    if (both) this.still += passed;
    return false;
  }

  /** Whether the story has stood still for long enough. */
  due(): boolean {
    return this.still >= STALL_TICKS;
  }

  /** The elder came by: the wait starts over, and the next visit gives more. */
  visited(): void {
    this.still = 0;
    this.visits = Math.min(this.visits + 1, ELDER_LEVELS);
  }

  /** The level the elder gives at the next visit: 1 first, then 2, then 3. */
  get level(): number {
    return Math.min(this.visits + 1, ELDER_LEVELS);
  }

  reset(): void {
    this.signature = "";
    this.last = null;
    this.counted = false;
    this.still = 0;
    this.visits = 0;
  }
}

/** The minutes from 06:00 of the first day, as the core counts them, so that the small hours come after the evening. */
export const gameMinutes = (day: number, hour: number, minute = 0): number => (day - 1) * 1440 + ((hour * 60 + minute - 360 + 1440) % 1440);

/**
 * Whether the task that is followed is waiting for goods somebody promised the player, which are not yet due. Then there is nothing
 * to do but wait, and the player who waits is not stuck. The task is a promise somebody made, or a thing to get that has no action to
 * do (the core takes the action away while the person's promise stands); another kind of task, or a thing to get that has a step to
 * take, is not waited on. A promise is not yet due until the hour it was made for, and one with no hour on it is taken as not due.
 */
export function waitingOnPromise(task: Task | null, promises: readonly Commitment[], time: { day: number; hour: number; minute: number }): boolean {
  if (task === null || task.state !== "open") return false;
  if (task.kind !== "promise" && !(task.kind === "need" && task.action === null)) return false;
  const now = gameMinutes(time.day, time.hour, time.minute);
  return promises.some((promise) => promise.state === "promised" && (promise.due === null || now < gameMinutes(promise.due.day, promise.due.hour)));
}

/** What the stall reads of a frame to tell whether its ticks count. */
export interface StallFrame {
  time: { day: number; hour: number; minute: number; phase: string };
  /** The tasks the frame lists. */
  tasks: readonly Task[];
  /** The task that is followed. */
  tracked: Task | null;
  promises: readonly Commitment[];
}

/**
 * Whether the ticks of a frame count towards the wait before the elder comes by, which is whether the player could have used them.
 * They do not in the night, when the town sleeps and there is nothing to do; nor in a wait for goods somebody promised that are not
 * yet due (`waitingOnPromise`); nor when no task of the frame is open or blocked. A player who has done every task has nothing to follow
 * and is not stuck, and the elder who came by to say so would be holding the world for nothing.
 */
export function ticksCount(frame: StallFrame): boolean {
  if (frame.time.phase === "night") return false;
  if (!frame.tasks.some(isLive)) return false;
  return !waitingOnPromise(frame.tracked, frame.promises, frame.time);
}

// --- Asking the elder ---------------------------------------------------------------------------------------------

/** What the elder says at each level, as data the interface puts into words. */
export type ElderAnswer =
  | { level: 1; next: Task["next"]; task: Task | null }
  | { level: 2; pair: { a: NotebookEntry; b: NotebookEntry } | null; relation: string | null; from: "core" | "page" | "judged" }
  | { level: 3; task: Task | null; window: TaskWindow | null };

/** What the elder reads of the game. */
export interface ElderContext {
  tracked: Task | null;
  entries: readonly NotebookEntry[];
  hint: { a: string; b: string; relation: string | null } | null;
  /** What the player judged right, and the tasks the frame lists (for the hour of a place the followed task goes to). */
  judgments?: readonly Judgment[];
  tasks?: readonly Task[];
}

/**
 * The hour of the occasion the followed task goes to. A task that sends the player to the teahouse has no hour of its own, and the
 * occasion at the teahouse (`t_tea_tonight`) is the task that has: its window is when to go. Speaking up has no place of its own
 * either, and is done at the occasion that is open. An occasion is a task of the kind `venue`: the other tasks that have a window
 * have the time and place of a promise or of the person they send the player to, which is not the hour of a place.
 */
export function occasionWindow(task: Task | null, tasks: readonly Task[]): TaskWindow | null {
  if (task === null) return null;
  if (task.window !== null) return task.window;
  const place = task.action?.place ?? null;
  const occasion = (other: Task): boolean => other.id !== task.id && other.kind === "venue" && other.window !== null && (other.state === "open" || other.state === "blocked");
  if (place === null) return task.action?.verb === "speak" ? (tasks.find(occasion)?.window ?? null) : null;
  return tasks.find((other) => occasion(other) && other.window?.place === place)?.window ?? null;
}

/**
 * The answer at a level. Level 1 turns the player's mind to the way: the `next` of the task they follow. Level 2 points at
 * two lines worth setting side by side: the pair the core lit (`hint`), or where the core has no hint, the pair the
 * notebook itself marks. When the task that is followed is to set the rumour straight, the lines have been set side by side
 * already, and it is the pair the player judged that they are reminded of, the first-hand line against the rumour (else the
 * last pair judged): it is what to say in public. Level 3 spells out the next step: the action of the task, and where and when.
 */
export function elderAnswer(level: number, ctx: ElderContext): ElderAnswer {
  if (level <= 1) return { level: 1, next: ctx.tracked?.next ?? null, task: ctx.tracked };
  const find = (id: string): NotebookEntry | undefined => ctx.entries.find((e) => e.id === id);
  if (level === 2) {
    if (ctx.tracked?.id === TASK.clear) {
      const done = (ctx.judgments ?? []).filter((j) => find(j.a) !== undefined && find(j.b) !== undefined);
      const judged = done.find((j) => isFirstHand(find(j.a) as NotebookEntry) && isHearsay(find(j.b) as NotebookEntry)) ?? done.at(-1);
      const ja = judged === undefined ? undefined : find(judged.a);
      const jb = judged === undefined ? undefined : find(judged.b);
      if (judged !== undefined && ja !== undefined && jb !== undefined) return { level: 2, pair: { a: ja, b: jb }, relation: judged.relation, from: "judged" };
    }
    const hint = ctx.hint;
    const core = hint !== null && ctx.entries.some((e) => e.id === hint.a) && ctx.entries.some((e) => e.id === hint.b);
    const pair = examplePair(ctx.entries, hint);
    const a = pair === null ? undefined : find(pair.a);
    const b = pair === null ? undefined : find(pair.b);
    return { level: 2, pair: a === undefined || b === undefined ? null : { a, b }, relation: core ? (ctx.hint?.relation ?? null) : null, from: core ? "core" : "page" };
  }
  return { level: 3, task: ctx.tracked, window: occasionWindow(ctx.tracked, ctx.tasks ?? []) };
}
