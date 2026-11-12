import { expect, test } from "@playwright/test";
import { clickSound, cuesFor, readSoundFrame, WATCHMAN } from "../../src/page/audio/read.ts";
import type { CoreEvent, Frame } from "../../src/shared/protocol.ts";
import { frameAt } from "../support/fake-client.ts";
import { element } from "../support/sound.ts";

// What the sounds read of the game: a few things in each frame, the cues that its events call for, and what a click on the page sounds like.

const flag = (name: string): CoreEvent => ({ kind: "flag", tick: 1, flag: name });
const read = (frame: Frame) => readSoundFrame(frame);

test.describe("what a frame says to the sounds", () => {
  test("the hour, the minute and the weather", () => {
    const frame = readSoundFrame(frameAt(2, 7, 45, { weather: "light_rain" }));
    expect(frame).toMatchObject({ hour: 7, minute: 45, weather: "light_rain", watchman: null, talking: false, paper: false });
  });

  test("a frame that has only the people and the time (the demo world) is read as clear noon, with nobody about", () => {
    const frame = readSoundFrame({ npcs: [], time: { hour: 9, minute: 5 } } as unknown as Frame);
    expect(frame).toMatchObject({ hour: 9, minute: 5, weather: "clear", watchman: null, talking: false, paper: false });
    const bare = readSoundFrame({ npcs: [] } as unknown as Frame);
    expect(bare).toMatchObject({ hour: 12, minute: 0, weather: "clear" });
  });

  test("the night watchman is on his round when his activity is patrol, wherever he is", () => {
    const people = (activity: string) => [{ id: "li_da", x: 1, y: 1, activity: "walk" }, { id: WATCHMAN, x: 31, y: 14, activity }];
    expect(read(frameAt(1, 23, 0, { npcs: people("patrol") })).watchman).toEqual({ x: 31, y: 14, patrolling: true });
    expect(read(frameAt(1, 20, 0, { npcs: people("rest") })).watchman).toEqual({ x: 31, y: 14, patrolling: false });
    expect(read(frameAt(1, 23, 0, { npcs: [{ id: "li_da", x: 1, y: 1 }] })).watchman).toBeNull();
  });

  test("the player is in a talk when the frame has a talk for them", () => {
    expect(read(frameAt(1, 10, 0, { player: { x: 1, y: 1, activity: "talk", talk: { npc: "li_da" }, look: [] } })).talking).toBe(true);
    expect(read(frameAt(1, 10, 0)).talking).toBe(false);
    expect(read(frameAt(1, 10, 0, { player: null })).talking).toBe(false);
  });

  test("the paper of the morning is in the frame of the call that made it, or its recap in a core from before the paper", () => {
    expect(read(frameAt(2, 6, 0, { gazette: { day: 2 } })).paper).toBe(true);
    expect(read(frameAt(2, 6, 0, { recap: [{ text: { zh: "a", en: "a" }, events: [] }] })).paper).toBe(true);
    expect(read(frameAt(2, 6, 0, { gazette: null, recap: null })).paper).toBe(false);
    expect(read(frameAt(2, 6, 0, { recap: [] })).paper).toBe(false);
  });
});

test.describe("the cues the events call for", () => {
  const quiet = readSoundFrame(frameAt(1, 10, 0));
  const paper = readSoundFrame(frameAt(2, 6, 0, { gazette: { day: 2 } }));

  test("the bell of the paper rings once for each paper: when the frame has it and the frame before did not", () => {
    expect(cuesFor([], paper, false, new Set())).toEqual(["paper"]);
    expect(cuesFor([], paper, true, new Set())).toEqual([]);
    expect(cuesFor([], quiet, false, new Set())).toEqual([]);
  });

  test("a job done has its phrase, once in a game, whatever order the three come in", () => {
    const heard = new Set<string>();
    expect(cuesFor([flag("truth_told")], quiet, false, heard)).toEqual(["job.truth"]);
    expect(cuesFor([flag("truth_told")], quiet, false, heard)).toEqual([]);
    expect(cuesFor([flag("bridge_fixed"), flag("reconciled")], quiet, false, heard)).toEqual(["job.bridge", "job.peace"]);
    expect([...heard].sort()).toEqual(["bridge", "peace", "truth"]);
  });

  test("another flag of the core is not a job and makes no sound", () => {
    for (const name of ["bamboo_delivered", "lane_opened", "lamps_hung", "elder_accepts", "constructor"]) expect(cuesFor([flag(name)], quiet, false, new Set()), name).toEqual([]);
  });

  test("a moment has its light cymbal, a promise that came has its seal, and any other event nothing", () => {
    expect(cuesFor([{ kind: "moment", tick: 3 }], quiet, false, new Set())).toEqual(["moment"]);
    expect(cuesFor([{ kind: "delivered", tick: 3 }], quiet, false, new Set())).toEqual(["ui.seal"]);
    for (const kind of ["talk_start", "action_ack", "arrived", "heard", "ending", "budget_stage"]) expect(cuesFor([{ kind }], quiet, false, new Set()), kind).toEqual([]);
  });

  test("a frame can have the paper and a job together, and they are all heard", () => {
    expect(cuesFor([flag("bridge_fixed")], paper, false, new Set())).toEqual(["paper", "job.bridge"]);
  });
});

test.describe("what a click on the page sounds like", () => {
  test("a leaf is turned by a bookmark, the notebook on the corner and the phrase at the foot of a paper", () => {
    expect(clickSound(element(["nav.marks button"]))).toBe("ui.page");
    expect(clickSound(element(['[data-testid="btn-notebook"]']))).toBe("ui.page");
    // The phrase that turns a paper is itself a word of ink, and the leaf comes first.
    expect(clickSound(element([".turn-bar button", ".ink-act"]))).toBe("ui.page");
  });

  test("a word of ink that is touched is a drop of ink", () => {
    expect(clickSound(element([".ink-act"]))).toBe("ui.ink");
    expect(clickSound(element([".ink-frame"]))).toBe("ui.ink");
  });

  test("nothing else makes a sound, and a click that is on nothing is none", () => {
    expect(clickSound(element([".btn", ".seg-btn", ".glyph-btn"]))).toBeNull();
    expect(clickSound(null)).toBeNull();
    expect(clickSound({} as Element)).toBeNull();
  });
});
