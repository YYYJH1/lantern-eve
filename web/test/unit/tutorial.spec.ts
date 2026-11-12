import { expect, test } from "@playwright/test";
import type { NotebookEntry } from "../../src/page/notebook.ts";
import type { Judgment, Task } from "../../src/page/slice.ts";
import { CLERK, examplePair, judged, proofAppeared, STEPS, TASK, Tutorial, type TutorialContext } from "../../src/page/tutorial.ts";

const name = (en: string) => ({ zh: en, en });

const task = (id: string, state: Task["state"] = "open"): Task => ({ id, kind: "need", job: null, text: name(id), why: null, next: null, state, blocker: null, action: null, window: null, expected: null });

const entry = (id: string, source: NotebookEntry["source"], marks: NotebookEntry["marks"] = []): NotebookEntry => ({ id, text: name(id), source, at: null, marks, chain: [] });
/** A line heard from somebody who saw it themselves (first hand), who heard it from another (second), or who cannot say from whom (any later). */
const heard = (hand: number): NotebookEntry["source"] => ({ kind: "heard", who: name("someone"), whoId: "someone", how: hand === 1 ? "saw" : hand === 2 ? "heard" : "unsure", via: hand === 2 ? name("another") : null });

/** A snapshot of the game, with what a test says of it and nothing else. */
function game(over: { tasks?: Task[]; entries?: NotebookEntry[]; judgments?: Judgment[]; verbs?: string[]; refused?: boolean } = {}): TutorialContext {
  return {
    tasks: new Map((over.tasks ?? [task(TASK.bamboo)]).map((t) => [t.id, t])),
    entries: over.entries ?? [],
    judgments: over.judgments ?? [],
    verbs: new Set(over.verbs ?? ["move", "talk"]),
    refused: over.refused ?? false,
  };
}

const RUMOUR = entry("n1", heard(5), ["unconfirmed"]);
const SAW = entry("n2", heard(1));
const PROOF = [task(TASK.bamboo, "blocked"), task(TASK.proof)];

test.describe("the tutorial of the first day", () => {
  test("has four steps in an order, the first two of them to the two people the day is about, and does not begin by itself", () => {
    expect(STEPS).toEqual(["granny", "clerk", "compare", "evening"]);
    expect(CLERK).toBe("zhou_huoji");
    const tutorial = new Tutorial();
    expect(tutorial.phase).toBe("off");
    expect(tutorial.on).toBe(false);
    expect(tutorial.card).toBeNull();
    expect(tutorial.update(game())).toBe(false);
    expect(tutorial.phase).toBe("off");
  });

  test("goes from card to card as the game says each step is done, and never by the clock", () => {
    const tutorial = new Tutorial();
    tutorial.begin();
    expect(tutorial.card).toBe("granny");
    // The goal and the first job are on one card: the card is put away, and the step waits for the thing.
    tutorial.dismiss(game());
    expect([tutorial.phase, tutorial.step]).toEqual(["doing", "granny"]);
    // Time passes (the frames come and go), and the step waits for the thing and not for the clock.
    expect(tutorial.update(game())).toBe(false);
    expect(tutorial.phase).toBe("doing");
    // The request was turned down: the task is blocked, and the next card is the clerk's, which says what the refusal was.
    expect(tutorial.update(game({ tasks: [task(TASK.bamboo, "blocked")] }))).toBe(true);
    expect(tutorial.card).toBe("clerk");
    tutorial.dismiss(game({ tasks: [task(TASK.bamboo, "blocked")] }));
    expect([tutorial.phase, tutorial.step]).toEqual(["doing", "clerk"]);
    // The clerk's word and the rumour are both in the notebook: the task that says so appears.
    tutorial.update(game({ tasks: PROOF, entries: [RUMOUR, SAW], verbs: ["move", "judge"] }));
    expect(tutorial.card).toBe("compare");
    // With the verb to judge there is something to do. Without it, seeing it once is all.
    tutorial.dismiss(game({ tasks: PROOF, entries: [RUMOUR, SAW], verbs: ["move", "judge"] }));
    expect([tutorial.phase, tutorial.step]).toEqual(["doing", "compare"]);
    tutorial.update(game({ tasks: PROOF, entries: [RUMOUR, SAW], verbs: ["move", "judge"], judgments: [{ a: "n2", b: "n1", relation: "unsupported", made: 9 }] }));
    // The evening is due when the core lists the occasion, which it does in the afternoon, and the step waits until then.
    expect([tutorial.phase, tutorial.step]).toEqual(["waiting", "evening"]);
    tutorial.update(game({ tasks: PROOF }));
    expect(tutorial.phase).toBe("waiting");
    const evening = [...PROOF, task(TASK.evening)];
    tutorial.update(game({ tasks: evening }));
    expect(tutorial.card).toBe("evening");
    tutorial.dismiss(game({ tasks: evening }));
    expect(tutorial.phase).toBe("done");
    expect(tutorial.on).toBe(false);
    expect(tutorial.update(game())).toBe(false);
  });

  test("takes the refusal from the event too, and a request that was granted is done as well", () => {
    const refused = new Tutorial();
    refused.begin();
    refused.dismiss(game());
    refused.update(game({ refused: true }));
    expect(refused.card).toBe("clerk");
    const granted = new Tutorial();
    granted.begin();
    granted.dismiss(game({ tasks: [task(TASK.bamboo, "done")] }));
    expect(granted.card).toBe("clerk");
  });

  test("skips a step whose thing is done already, and shows the card of the next that is due", () => {
    const tutorial = new Tutorial();
    tutorial.begin();
    const late = game({ tasks: [...PROOF], entries: [RUMOUR, SAW], refused: true });
    tutorial.dismiss(late);
    // The ask is done at once, the clerk's card comes, and with the proof there the compare card follows it.
    expect(tutorial.card).toBe("clerk");
    tutorial.dismiss(late);
    expect(tutorial.card).toBe("compare");
  });

  test("leaves the evening out when the occasion was done or has gone by, and ends there", () => {
    for (const state of ["done", "stale"] as const) {
      const tutorial = new Tutorial();
      tutorial.begin();
      const late = game({ tasks: [...PROOF, task(TASK.evening, state)], entries: [RUMOUR, SAW], refused: true, verbs: ["move"] });
      for (let i = 0; i < 6 && tutorial.on; i++) tutorial.dismiss(late);
      expect(tutorial.phase, state).toBe("done");
    }
    // The same game with the occasion open shows it.
    const open = new Tutorial();
    open.begin();
    const ctx = game({ tasks: [...PROOF, task(TASK.evening)], entries: [RUMOUR, SAW], refused: true, verbs: ["move"] });
    for (let i = 0; i < 3; i++) open.dismiss(ctx);
    expect(open.card).toBe("evening");
  });

  test("ends by a skip at any step, and a new game starts it over", () => {
    const tutorial = new Tutorial();
    tutorial.begin();
    tutorial.dismiss(game());
    tutorial.skip();
    expect(tutorial.phase).toBe("skipped");
    expect(tutorial.on).toBe(false);
    expect(tutorial.update(game({ refused: true }))).toBe(false);
    tutorial.skip();
    expect(tutorial.phase).toBe("skipped");
    tutorial.reset();
    expect([tutorial.phase, tutorial.index]).toEqual(["off", 0]);
  });
});

test.describe("what the steps read of the game", () => {
  test("proof is the task of the slice, or else a line heard at first hand with another to set against it", () => {
    expect(proofAppeared(game({ tasks: [task(TASK.proof)] }))).toBe(true);
    expect(proofAppeared(game({ entries: [RUMOUR, SAW] }))).toBe(true);
    expect(proofAppeared(game({ entries: [RUMOUR] }))).toBe(false);
    expect(proofAppeared(game({ entries: [RUMOUR, entry("n3", heard(3))] }))).toBe(false);
  });

  test("the pair is the one the core lit, else the line seen first-hand and the rumour nobody saw", () => {
    const entries = [RUMOUR, SAW, entry("n3", heard(1))];
    expect(examplePair(entries, { a: "n3", b: "n1" })).toEqual({ a: "n3", b: "n1" });
    // A pair the notebook does not have is not taken.
    expect(examplePair(entries, { a: "n9", b: "n1" })).toEqual({ a: "n2", b: "n1" });
    expect(examplePair(entries, null)).toEqual({ a: "n2", b: "n1" });
    expect(examplePair([RUMOUR], null)).toBeNull();
    expect(examplePair([SAW, entry("n3", heard(1))], null)).toBeNull();
    // What the player saw is first-hand as well.
    expect(examplePair([RUMOUR, entry("n4", { kind: "seen" })], null)).toEqual({ a: "n4", b: "n1" });
  });

  test("the rumour is the line heard beyond the first hand when the core marks nothing as unconfirmed", () => {
    const unmarked = entry("n1", heard(2));
    expect(examplePair([unmarked, SAW], null)).toEqual({ a: "n2", b: "n1" });
    // A line heard at the first hand is not a rumour, and a line that was seen is not one either.
    expect(examplePair([SAW, entry("n3", heard(1))], null)).toBeNull();
    expect(examplePair([entry("n4", { kind: "seen" }), SAW], null)).toBeNull();
  });

  test("a judgement counts for the pair either way round, and any judgement counts where there is no pair", () => {
    const j: Judgment = { a: "n2", b: "n1", relation: "unsupported", made: 1 };
    expect(judged(game({ judgments: [j] }), { a: "n2", b: "n1" })).toBe(true);
    expect(judged(game({ judgments: [j] }), { a: "n1", b: "n2" })).toBe(true);
    expect(judged(game({ judgments: [j] }), { a: "n1", b: "n3" })).toBe(false);
    expect(judged(game({ judgments: [j] }), null)).toBe(true);
    expect(judged(game(), null)).toBe(false);
  });
});
