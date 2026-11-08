import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { AUTOSAVES_KEPT, autosaveName, autosaveNotes, excessSaves, markOf, morningDue, newestSave, savedThrough } from "../../src/page/autosave.ts";
import { Play, SAVED_MS } from "../../src/page/play.ts";
import type { CoreEvent, SaveMeta } from "../../src/shared/protocol.ts";
import { FakeClient, feedFrame, frameAt, resetTicks } from "../support/fake-client.ts";
import * as fake from "../support/slice.ts";

// The page saves the game by itself, each morning at the hour of the recap from the second day and at the ending, keeps the last three
// of its saves apart from the player's own, and Continue loads the newest of all.

const DAY = (day: number, hour: number, minute = 0) => ({ day, hour, minute, phase: "day" as const });
const NIGHT = (day: number, hour = 22) => ({ day, hour, minute: 0, phase: "night" as const });

test.describe("when it saves", () => {
  test("at the frame that has the recap of a morning from the second day, or the first minute after the hour, once, and not before the hour or on the first day", () => {
    expect(morningDue(DAY(1, 7, 5), 0, true)).toBe(false); // the first day has no morning of its own
    expect(morningDue(DAY(1, 12), 0)).toBe(false);
    expect(morningDue(DAY(2, 6, 59), 1, true)).toBe(false);
    // The frame before the one that has the recap already reads 07:00, and the save waits for the recap, which is in the notes of the save.
    expect(morningDue(DAY(2, 7), 1)).toBe(false);
    expect(morningDue(DAY(2, 7), 1, true)).toBe(true);
    // A morning with nothing to recap (the core sends no recap) is saved from the first minute after the hour.
    expect(morningDue(DAY(2, 7, 1), 1)).toBe(true);
    expect(morningDue(DAY(2, 7, 30), 1)).toBe(true);
    expect(morningDue(DAY(2, 13), 1)).toBe(true); // the first frame past the hour, whatever it is
    expect(morningDue(DAY(2, 7), 2, true)).toBe(false); // already saved
    expect(morningDue(DAY(2, 9), 2)).toBe(false);
    expect(morningDue(DAY(3, 7), 2, true)).toBe(true);
    expect(morningDue(NIGHT(2, 23), 1, true)).toBe(false); // the core makes its recap in the day phase only
    expect(morningDue(DAY(5, 7, 2), 4)).toBe(true);
  });

  test("at the frame that has the paper of the morning, whether or not the core had anything to recap, and not a minute later", () => {
    // The paper is in the frame of the tick that made it, which reads 07:00 like the one before. It holds the world while the player reads it, so the
    // next minute may not come: the save is not for it to wait for.
    expect(morningDue(DAY(2, 7), 1, true)).toBe(true);
    expect(morningDue(DAY(2, 7), 1, false)).toBe(false);
    expect(morningDue(DAY(2, 7), 2, true)).toBe(false);
    expect(morningDue(DAY(1, 7), 0, true)).toBe(false);
    expect(morningDue(DAY(2, 6, 59), 1, true)).toBe(false);
  });

  test("a game that is seen for the first time is not news: loaded after the hour of the recap it saves at the next morning, before it at this one", () => {
    expect(savedThrough(DAY(1, 6))).toBe(0);
    expect(savedThrough(DAY(2, 6, 59))).toBe(1);
    expect(savedThrough(DAY(2, 7))).toBe(2);
    expect(savedThrough(DAY(3, 9))).toBe(3);
    expect(savedThrough(NIGHT(3))).toBe(3);
    expect(morningDue(DAY(3, 9), savedThrough(DAY(3, 9)))).toBe(false);
    expect(morningDue(DAY(4, 7, 1), savedThrough(DAY(3, 9)))).toBe(true);
    expect(morningDue(DAY(3, 7, 1), savedThrough(DAY(3, 6, 30)))).toBe(true);
  });
});

const save = (id: number, auto = false, over: Partial<SaveMeta> = {}): SaveMeta => ({
  id,
  name: auto ? `auto ${id}` : `own ${id}`,
  savedAt: "2026-11-05T00:00:00.000Z",
  tick: id,
  hash: "0".repeat(64),
  ...(auto ? { page: autosaveNotes({ kind: "morning", day: 2, hour: 7, minute: 0 }) } : {}),
  ...over,
});

test.describe("which saves it keeps, and which one Continue loads", () => {
  test("keeps the newest three of its own and never counts or deletes a save of the player's", () => {
    expect(AUTOSAVES_KEPT).toBe(3);
    // Autosaves 2, 4, 5, 7, 8 with the player's 1, 3, 6, 9 among them: the two oldest autosaves go, whatever the player's saves are.
    const list = [save(9), save(8, true), save(7, true), save(6), save(5, true), save(4, true), save(3), save(2, true), save(1)];
    expect(excessSaves(list)).toEqual([4, 2]);
    expect(excessSaves(list, 5)).toEqual([]);
    expect(excessSaves([save(3, true), save(2, true), save(1, true)])).toEqual([]);
    expect(excessSaves([save(1), save(2), save(3), save(4), save(5)])).toEqual([]);
    // The order of the list does not matter.
    expect(excessSaves([...list].reverse())).toEqual([4, 2]);
  });

  test("a save is the page's only with a mark it can read: a note that is something else is the player's", () => {
    expect(markOf(save(1, true))).toEqual({ kind: "morning", day: 2, hour: 7, minute: 0 });
    expect(markOf(save(1))).toBeNull();
    for (const auto of [null, "yes", 3, [], {}, { kind: "night", day: 2, hour: 7, minute: 0 }, { kind: "morning", day: -1, hour: 7, minute: 0 }, { kind: "morning", day: 2, hour: 7.5, minute: 0 }, { kind: "morning", day: "2", hour: 7, minute: 0 }]) {
      expect(markOf({ page: { auto } }), JSON.stringify(auto)).toBeNull();
    }
    expect(markOf({ page: { recap: { key: "k", lines: [] } } })).toBeNull();
    expect(markOf({ page: { recap: { key: "k", lines: [] }, ...autosaveNotes({ kind: "ending", day: 5, hour: 21, minute: 0 }) } })).toEqual({ kind: "ending", day: 5, hour: 21, minute: 0 });
  });

  test("Continue loads the newest of all, the player's own or the page's, by the number it was saved under", () => {
    expect(newestSave([])).toBeNull();
    expect(newestSave([save(2, true), save(5), save(4, true)])?.id).toBe(5);
    expect(newestSave([save(2), save(7, true), save(4)])?.id).toBe(7);
    expect(newestSave([save(1)])?.id).toBe(1);
  });

  test("names a save by the game time it was made at, in the language the page had", () => {
    setLang("en");
    expect(autosaveName({ kind: "morning", day: 3, hour: 7, minute: 0 })).toBe("Autosave, Day 3 07:00");
    expect(autosaveName({ kind: "ending", day: 5, hour: 21, minute: 0 })).toBe("Autosave, Festival night");
    setLang("zh");
    expect(autosaveName({ kind: "morning", day: 3, hour: 7, minute: 0 })).toBe("自动存档，第三日 07:00");
    expect(autosaveName({ kind: "ending", day: 5, hour: 21, minute: 0 })).toBe("自动存档，灯会之夜");
    setLang("en");
  });
});

/** Lets the saves that were asked for run: each is a few awaits of the stand-in host. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const setup = (enabled = true) => {
  resetTicks();
  setLang("en");
  const client = new FakeClient();
  const play = new Play(client.host);
  play.autosave.enabled = enabled;
  return { client, play };
};

const at = async (client: FakeClient, time: { day: number; hour: number; minute: number; phase: string }, over: Record<string, unknown> = {}, events: CoreEvent[] = []): Promise<void> => {
  feedFrame(client, frameAt(time.day, time.hour, time.minute, over, time.phase), events);
  await settle();
};

test.describe("on a page that plays", () => {
  test("saves each morning from the second day, named by the time, with its mark, and the player's own saves stay", async () => {
    const { client, play } = setup();
    const mine = client.own("before the bridge");
    await at(client, DAY(1, 6));
    await at(client, DAY(1, 12));
    await at(client, NIGHT(1));
    await at(client, DAY(2, 6, 59));
    expect(client.saved).toEqual([]);
    // The hour comes, and the save waits for the recap (or the minute after).
    await at(client, DAY(2, 7));
    expect(client.saved).toEqual([]);
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toEqual([{ name: "Autosave, Day 2 07:00", page: { auto: { kind: "morning", day: 2, hour: 7, minute: 0 } } }]);
    expect(play.state.saved).toEqual({ kind: "morning", day: 2, hour: 7, minute: 0 });
    // The same morning is saved once.
    await at(client, DAY(2, 7, 2));
    await at(client, DAY(2, 15));
    expect(client.saved).toHaveLength(1);
    await at(client, DAY(3, 7, 1));
    await at(client, DAY(4, 7, 1));
    expect(client.saved.map((s) => s.name)).toEqual(["Autosave, Day 2 07:00", "Autosave, Day 3 07:00", "Autosave, Day 4 07:00"]);
    expect(client.deleted).toEqual([]);
    // The fourth drops the first, and the player's own save, which is older than all of them, is still there.
    await at(client, DAY(5, 7, 1));
    expect(client.saved).toHaveLength(4);
    expect(client.deleted).toEqual([2]);
    expect(client.state.saves.map((s) => s.name)).toEqual(["Autosave, Day 5 07:00", "Autosave, Day 4 07:00", "Autosave, Day 3 07:00", "before the bridge"]);
    expect(client.state.saves.some((s) => s.id === mine.id)).toBe(true);
  });

  test("says that it saved for a few seconds", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    const before = client.touched;
    await at(client, DAY(2, 7, 1));
    expect(play.state.saved?.kind).toBe("morning");
    expect(client.touched).toBeGreaterThan(before);
    await new Promise<void>((resolve) => setTimeout(resolve, SAVED_MS + 100));
    expect(play.state.saved).toBeNull();
  });

  test("keeps the recap of the morning that the player has not put away with the save, beside its mark", async () => {
    const { client } = setup();
    await at(client, DAY(2, 6, 59));
    const lines = [{ text: { zh: "李大答应的四根竹料，已经送到石桥。", en: "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge." }, events: [16] }];
    // The frame before the one that has the recap reads 07:00 already, and nothing is saved there.
    await at(client, DAY(2, 7));
    expect(client.saved).toEqual([]);
    await at(client, DAY(2, 7), { recap: lines }, [{ kind: "recap", tick: 1, lines: 1 }]);
    expect(client.saved).toHaveLength(1);
    const page = client.saved[0]?.page ?? {};
    expect(Object.keys(page).sort()).toEqual(["auto", "recap"]);
    expect(page.auto).toEqual({ kind: "morning", day: 2, hour: 7, minute: 0 });
    expect(JSON.stringify(page.recap)).toContain("Li Da");
  });

  test("saves on a morning that has no recap to tell, since the hour is what counts", async () => {
    const { client } = setup();
    await at(client, DAY(2, 6, 59));
    await at(client, DAY(2, 7), { recap: null });
    expect(client.saved).toHaveLength(0);
    await at(client, DAY(2, 7, 1), { recap: null });
    expect(client.saved).toHaveLength(1);
    expect(client.saved[0]?.page).toEqual({ auto: { kind: "morning", day: 2, hour: 7, minute: 0 } });
  });

  test("saves at the frame that has the paper of a morning with nothing to recap, though the world is held there and no frame comes after it", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6, 59));
    // The core sends the paper every morning from the second, and the event `recap` only when it had something to recap. Here it had nothing. The paper
    // holds the world, so the clock stays at 07:00 for as long as the player reads: this is the last frame there is.
    const quiet = { head: { kind: "quiet", text: { zh: "昨天镇上没有什么大事。", en: "Nothing much happened in town yesterday." } }, news: [] };
    await at(client, DAY(2, 7), { gazette: fake.gazetteBody(quiet), recap: null });
    expect(client.saved.map((s) => s.name)).toEqual(["Autosave, Day 2 07:00"]);
    expect(play.state.saved).toEqual({ kind: "morning", day: 2, hour: 7, minute: 0 });
    // The paper that is on show is in the notes of the save, which is the reason to save at its frame and not at the one before.
    const notes = client.saved[0]?.page ?? {};
    expect(Object.keys(notes).sort()).toEqual(["auto", "recap"]);
    expect(JSON.stringify(notes.recap)).toContain("Nothing much happened");
    // The same morning is not saved twice.
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toHaveLength(1);
  });

  test("saves when the ending comes, and not for an ending that was already there when the game was loaded", async () => {
    const { client, play } = setup();
    await at(client, DAY(5, 20, 55));
    const ending: CoreEvent = { kind: "ending", tick: 9, ending: "ending_full", label: { zh: "圆满", en: "Fulfilled" }, hidden: [], inputs: {}, passage: "mended", promised: 3, turnout: 100, reveal: null };
    await at(client, NIGHT(5, 21), {}, [ending]);
    expect(client.saved.map((s) => s.name)).toEqual(["Autosave, Festival night"]);
    expect(client.saved[0]?.page).toEqual({ auto: { kind: "ending", day: 5, hour: 21, minute: 0 } });
    expect(play.state.saved?.kind).toBe("ending");
    // A game that was loaded, and is over: the frames say so, and nothing is saved.
    const other = setup();
    other.client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    await at(other.client, NIGHT(5, 21), { ending: { kind: "ending", ending: "ending_full", label: { zh: "圆满", en: "Fulfilled" } } });
    expect(other.client.saved).toEqual([]);
  });

  test("does not save at once for a game that was loaded, and saves at the next morning of it", async () => {
    const { client } = setup();
    await at(client, DAY(2, 7));
    expect(client.saved).toHaveLength(0); // the first frame of a game is not news, even at the hour of the recap
    client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    await at(client, DAY(3, 9));
    expect(client.saved).toHaveLength(0);
    await at(client, DAY(3, 10));
    expect(client.saved).toHaveLength(0);
    await at(client, DAY(4, 7, 1));
    expect(client.saved.map((s) => s.name)).toEqual(["Autosave, Day 4 07:00"]);
    // A game that is loaded before the hour of its morning has that morning.
    client.feed({ type: "reset", seed: 1, scenario: "bridge" });
    await at(client, DAY(3, 6, 30));
    await at(client, DAY(3, 7, 1));
    expect(client.saved.map((s) => s.name)).toEqual(["Autosave, Day 4 07:00", "Autosave, Day 3 07:00"]);
  });

  test("lets a save that cannot be made go, without an error, tells the player, and saves the next morning", async () => {
    const { client, play } = setup();
    await at(client, DAY(2, 6));
    client.failSave = true;
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toHaveLength(1);
    expect(play.state.saved).toBeNull();
    // The page says so (the words are checked in save-notice.spec.ts), and the next morning has its own save.
    expect(play.state.saveFailed).toBe("other");
    expect(client.state.saves).toEqual([]);
    client.failSave = false;
    await at(client, DAY(2, 8));
    expect(client.saved).toHaveLength(1);
    await at(client, DAY(3, 7, 1));
    expect(client.saved).toHaveLength(2);
    expect(client.state.saves.map((s) => s.name)).toEqual(["Autosave, Day 3 07:00"]);
  });

  test("saves one at a time: a second ask while one is being made waits for it", async () => {
    const { client } = setup();
    await at(client, DAY(2, 6));
    const asks: number[] = [];
    const original = client.save.bind(client);
    client.save = async (name, extra) => {
      asks.push(asks.length);
      await new Promise<void>((resolve) => setTimeout(resolve, 30));
      return original(name, extra);
    };
    feedFrame(client, frameAt(2, 7, 1));
    feedFrame(client, frameAt(3, 7, 1));
    feedFrame(client, frameAt(4, 7, 1));
    await new Promise<void>((resolve) => setTimeout(resolve, 300));
    await settle();
    // The mornings that came while a save was being made are not queued up behind it: one is made for the latest, as the page cannot know the
    // game of the earlier ones (the world has moved on).
    expect(client.saved.length).toBeGreaterThanOrEqual(1);
    expect(client.saved.length).toBeLessThanOrEqual(2);
    expect(client.saved.at(-1)?.name).toBe("Autosave, Day 4 07:00");
  });

  test("does nothing where it is not on: a page that is made for a test, a recording", async () => {
    const off = setup(false);
    await at(off.client, DAY(2, 6));
    await at(off.client, DAY(2, 7, 1));
    expect(off.client.saved).toEqual([]);
    resetTicks();
    const client = new FakeClient();
    const recording = new Play(client.host, true);
    expect(recording.autosave.enabled).toBe(false);
    await at(client, DAY(2, 6));
    await at(client, DAY(2, 7, 1));
    expect(client.saved).toEqual([]);
  });
});
