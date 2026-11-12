/**
 * The tutorial of the first day: the clan elder walks the player through the first round, and the player does each thing
 * in the game itself. Four steps, each a card that holds the world while it is up and then a line of what to do until the
 * thing is done. A step is done when the game says it is (a task that is blocked, a task that appeared, a judgement the
 * core accepted), never when time has passed. The first two lead to the two people the first day is about, and each rings the
 * person on the map.
 *
 *   granny    the goal of the five days, and go to Granny Li and ask her for bamboo (her refusal is what ends the step)
 *   clerk     her refusal and why, and go to Zhou's Clerk to ask where the talk came from
 *   compare   the notebook: "he was at the bridge" against "he broke the rail", and how they stand (shown once)
 *   evening   the teahouse in the evening (shown when the core lists the occasion, and left out if it has gone by)
 *
 * This module has the order of the steps and when each is shown and done, as a function of a snapshot of the game. The
 * words are in the interface, and what a card does to the page (opens the notebook, rings a person on the map) is in
 * `guide.ts`.
 */
import type { NotebookEntry } from "./notebook.ts";
import type { Judgment, Task } from "./slice.ts";

export type StepId = "granny" | "clerk" | "compare" | "evening";
export const STEPS: readonly StepId[] = ["granny", "clerk", "compare", "evening"];

/** The clerk of the Zhou family, whom the second step leads to. */
export const CLERK = "zhou_huoji";

/**
 * The tasks of the slice that the steps and the hints read, by the ids the core gives them: the bamboo of the Li family, the
 * question who started the talk, the words to set side by side, the rumour to set straight in public and the evening at the
 * teahouse. A game without them does not have the tutorial.
 */
export const TASK = { bamboo: "t_bamboo_first", who: "t_who_said", proof: "t_what_proves", clear: "t_clear_rumour", evening: "t_tea_tonight" } as const;

/** What the tutorial reads of the game, once for each frame. */
export interface TutorialContext {
  /** The tasks the frame lists, by id. */
  tasks: ReadonlyMap<string, Task>;
  entries: readonly NotebookEntry[];
  judgments: readonly Judgment[];
  /** The verbs the world offers now. */
  verbs: ReadonlySet<string>;
  /** Whether Granny Li has turned the request down (the event `entrusted` with a result that is not a yes). */
  refused: boolean;
}

/**
 * `off` before it begins, `card` while the card of a step is up, `doing` while the step waits for the player to do it,
 * `waiting` between steps while the next one is not due, and `done` or `skipped` at the end.
 */
export type TutorialPhase = "off" | "card" | "doing" | "waiting" | "done" | "skipped";

const stateOf = (ctx: TutorialContext, id: string): Task["state"] | null => ctx.tasks.get(id)?.state ?? null;

/** The task that says the player has what they need to compare two lines: a rumour and a first-hand word from the clerk. */
export function proofAppeared(ctx: TutorialContext): boolean {
  if (ctx.tasks.has(TASK.proof)) return true;
  // A game whose tasks do not have it: a line a teller says they saw themselves, and another to set it against.
  return ctx.entries.length >= 2 && ctx.entries.some((e) => e.source.kind === "heard" && e.source.how === "saw");
}

/** Whether a line was seen, or heard from someone who says they saw it and not marked unconfirmed: what a claim is set against. */
export const isFirstHand = (e: NotebookEntry): boolean => e.source.kind === "seen" || (e.source.kind === "heard" && e.source.how === "saw" && !e.marks.includes("unconfirmed"));

/** Whether a line is a rumour: marked unconfirmed, or heard from someone who did not see it (a core that marks only what the player judged sends no `unconfirmed`). */
export const isHearsay = (e: NotebookEntry): boolean => e.marks.includes("unconfirmed") || (e.source.kind === "heard" && e.source.how !== "saw");

/** The pair the tutorial shows: the line that was seen, or heard at first hand, and the rumour that goes beyond it. */
export function examplePair(entries: readonly NotebookEntry[], hint: { a: string; b: string } | null): { a: string; b: string } | null {
  // The core says which two are worth setting side by side, when it does.
  if (hint !== null && entries.some((e) => e.id === hint.a) && entries.some((e) => e.id === hint.b)) return { a: hint.a, b: hint.b };
  const claim = entries.find((e) => isHearsay(e) && !isFirstHand(e));
  if (claim === undefined) return null;
  const evidence = entries.find((e) => e.id !== claim.id && isFirstHand(e));
  return evidence === undefined ? null : { a: evidence.id, b: claim.id };
}

/** Whether the player has judged a pair of these two lines (either way round), as the core kept it. */
export function judged(ctx: TutorialContext, pair: { a: string; b: string } | null): boolean {
  if (pair === null) return ctx.judgments.length > 0;
  return ctx.judgments.some((j) => (j.a === pair.a && j.b === pair.b) || (j.a === pair.b && j.b === pair.a));
}

interface StepRule {
  /** Whether the card of the step is due. */
  due(ctx: TutorialContext): boolean;
  /** Whether the step is left out because what it is about has gone by. Without it a step is never left out. */
  skip?(ctx: TutorialContext): boolean;
  /** Whether the thing the step asks is done, after the card was put away. A step that asks nothing is always done. */
  done(ctx: TutorialContext): boolean;
}

const RULES: Readonly<Record<StepId, StepRule>> = {
  granny: {
    due: () => true,
    done: (ctx) => ctx.refused || stateOf(ctx, TASK.bamboo) === "blocked" || stateOf(ctx, TASK.bamboo) === "done",
  },
  clerk: { due: () => true, done: (ctx) => proofAppeared(ctx) },
  compare: {
    due: (ctx) => proofAppeared(ctx),
    // The core takes judgements where it lists the verb. Where it does not, seeing it once is all there is to do.
    done: (ctx) => !ctx.verbs.has("judge") || ctx.judgments.length > 0,
  },
  // The occasion is what the card is about, so it is shown when the core lists it as one to go to (it comes in the afternoon), and
  // not before: a card that holds the world cannot wait for a task that only a running world adds. An occasion that was done or has gone by
  // is no longer one to go to.
  evening: {
    due: (ctx) => stateOf(ctx, TASK.evening) === "open" || stateOf(ctx, TASK.evening) === "blocked",
    skip: (ctx) => stateOf(ctx, TASK.evening) === "done" || stateOf(ctx, TASK.evening) === "stale",
    done: () => true,
  },
};

export class Tutorial {
  phase: TutorialPhase = "off";
  /** The index in `STEPS` of the step that is on, or the one that comes next. */
  index = 0;

  get on(): boolean {
    return this.phase === "card" || this.phase === "doing" || this.phase === "waiting";
  }

  /** The step whose card is up. */
  get card(): StepId | null {
    return this.phase === "card" ? (STEPS[this.index] ?? null) : null;
  }

  /** The step the player is working on, or the one that comes next. */
  get step(): StepId | null {
    return this.on ? (STEPS[this.index] ?? null) : null;
  }

  begin(): void {
    this.phase = "card";
    this.index = 0;
  }

  /** Back to before it began: a new game. */
  reset(): void {
    this.phase = "off";
    this.index = 0;
  }

  skip(): void {
    if (this.on) this.phase = "skipped";
  }

  /** Puts the card away. The step is done at once where it asks nothing, else the player has the thing to do. */
  dismiss(ctx: TutorialContext): void {
    if (this.phase !== "card") return;
    this.phase = "doing";
    this.settle(ctx);
  }

  /** Looks at the game after a frame. Returns whether the tutorial moved. */
  update(ctx: TutorialContext): boolean {
    const before = `${this.phase}:${this.index}`;
    this.settle(ctx);
    return before !== `${this.phase}:${this.index}`;
  }

  private settle(ctx: TutorialContext): void {
    // A step that is done hands over to the next, whose card comes when it is due. A card that is up stays up.
    for (let guard = 0; guard < STEPS.length + 1; guard++) {
      const step = STEPS[this.index];
      if (step === undefined) {
        this.phase = "done";
        return;
      }
      if (this.phase === "doing" && RULES[step].done(ctx)) {
        this.index++;
        this.phase = "waiting";
        continue;
      }
      if (this.phase === "waiting") {
        const next = STEPS[this.index];
        if (next === undefined) {
          this.phase = "done";
          return;
        }
        if (RULES[next].skip?.(ctx) === true) {
          this.index++;
          continue;
        }
        if (RULES[next].due(ctx)) {
          this.phase = "card";
        }
      }
      return;
    }
  }
}
