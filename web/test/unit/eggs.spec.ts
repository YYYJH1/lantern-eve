import { expect, test } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { translate } from "../../src/i18n/index.ts";
import { zh } from "../../src/i18n/zh.ts";
import {
  ANSWERS,
  CLICK_WINDOW_MS,
  Eggs,
  type EggHost,
  gameMinutes,
  HEARING_CELLS,
  isAct,
  isVerseHour,
  LANTERN_FESTIVAL,
  lanternFestivalOn,
  nearestSpeaker,
  Riddles,
  RIDDLE_RIGHT,
  RIDDLES,
  riddleEndingKey,
  riddleOf,
  riddleWords,
  rumourOf,
  RUMOUR_TICKS,
  spotOf,
  STILL_MINUTES,
  StillTimer,
  VERSE_TICKS,
  verseOf,
  VERSES,
} from "../../src/page/eggs.ts";
import { lookOf, STEPS } from "../../src/page/map/riddle-look.ts";
import type { Frame } from "../../src/shared/protocol.ts";
import { type ViewFrame, readFrame } from "../../src/page/frame.ts";
import type { Scene } from "../../src/page/scene.ts";
import { keptNotes, MAX_PAGE_NOTES } from "../../src/shared/runtime.ts";

// The small secrets of the town: the date table of the Lantern Festival, the riddles and what a save keeps of them, the verse of the watchman, and the manager
// who stands still. They have no browser in them.

const local = (year: number, month: number, day: number, hour = 12, minute = 0, second = 0): Date => new Date(year, month - 1, day, hour, minute, second);

test.describe("the Lantern Festival of the calendar", () => {
  test("has a table of ten years, one date for each, in order, in the weeks where the festival falls", () => {
    expect(LANTERN_FESTIVAL).toHaveLength(10);
    expect(LANTERN_FESTIVAL.map(([year]) => year)).toEqual([2027, 2028, 2029, 2030, 2031, 2032, 2033, 2034, 2035, 2036]);
    for (const [year, month, day] of LANTERN_FESTIVAL) {
      const at = local(year, month, day);
      // The 15th day of the first lunar month is between 5 February and 5 March.
      expect(at.getTime(), `${year}`).toBeGreaterThanOrEqual(local(year, 2, 5).getTime());
      expect(at.getTime(), `${year}`).toBeLessThanOrEqual(local(year, 3, 5).getTime());
    }
  });

  test("is true on each date of the table, at any hour of the day, and false the day before and the day after", () => {
    for (const [year, month, day] of LANTERN_FESTIVAL) {
      for (const [hour, minute, second] of [[0, 0, 0], [12, 0, 0], [23, 59, 59]] as const) {
        expect(lanternFestivalOn(local(year, month, day, hour, minute, second)), `${year}-${month}-${day} ${hour}:${minute}`).toBe(true);
      }
      const before = new Date(year, month - 1, day - 1, 12);
      const after = new Date(year, month - 1, day + 1, 12);
      expect(lanternFestivalOn(before), `the day before ${year}-${month}-${day}`).toBe(false);
      expect(lanternFestivalOn(after), `the day after ${year}-${month}-${day}`).toBe(false);
    }
  });

  test("has the dates that were checked against the tables of the calendar, and nothing else", () => {
    const dates = LANTERN_FESTIVAL.map(([y, m, d]) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    expect(dates).toEqual(["2027-02-20", "2028-02-09", "2029-02-27", "2030-02-17", "2031-02-06", "2032-02-25", "2033-02-14", "2034-03-05", "2035-02-22", "2036-02-11"]);
  });

  test("is false in a year the table does not have, and on the same day of the month in another year", () => {
    // 3 March 2026 was the festival of that year, and 2037 is past the table.
    expect(lanternFestivalOn(local(2026, 3, 3))).toBe(false);
    expect(lanternFestivalOn(local(2025, 2, 12))).toBe(false);
    expect(lanternFestivalOn(local(2037, 2, 26))).toBe(false);
    expect(lanternFestivalOn(local(2037, 2, 20))).toBe(false);
    expect(lanternFestivalOn(local(2028, 2, 20))).toBe(false);
    expect(lanternFestivalOn(local(2026, 11, 8))).toBe(false);
    expect(lanternFestivalOn(new Date(Number.NaN))).toBe(false);
  });
});

test.describe("the riddles", () => {
  test("are five, one for each game day, and a day past the fifth begins again", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 10].map(riddleOf)).toEqual([0, 1, 2, 3, 4, 0, 1, 4]);
    expect([0, -1, Number.NaN].map(riddleOf)).toEqual([4, 3, 0]);
    expect(RIDDLE_RIGHT).toHaveLength(RIDDLES);
    for (const right of RIDDLE_RIGHT) expect(right).toBeGreaterThanOrEqual(0);
    for (const right of RIDDLE_RIGHT) expect(right).toBeLessThan(ANSWERS);
    // The right answer is not always in the same place.
    expect(new Set(RIDDLE_RIGHT).size).toBe(ANSWERS);
  });

  test("have a question and three answers in both languages, which end in the kind of answer asked for, and the right answer in words", () => {
    for (let riddle = 0; riddle < RIDDLES; riddle++) {
      for (const lang of ["zh", "en"] as const) {
        const words = riddleWords(riddle, lang);
        expect(words.question, `${lang} ${riddle + 1}`).not.toBe("");
        expect(words.answers, `${lang} ${riddle + 1}`).toHaveLength(ANSWERS);
        for (const answer of words.answers) expect(answer.trim(), `${lang} ${riddle + 1}`).not.toBe("");
        expect(new Set(words.answers).size, `${lang} ${riddle + 1}`).toBe(ANSWERS);
        expect(words.right).toBe(words.answers[RIDDLE_RIGHT[riddle] as number]);
        expect(words.question).toMatch(lang === "zh" ? /（打一[物人]）$/ : /\(a (thing|person)\)$/);
      }
      // The kind of the answer is the same in both languages.
      const kind = (text: string): string => (/打一人|a person/.test(text) ? "person" : "thing");
      expect(kind(riddleWords(riddle, "en").question), `riddle ${riddle + 1}`).toBe(kind(riddleWords(riddle, "zh").question));
    }
  });

  test("have words that follow the rules of the page: no he or she, no Chinese in the English, no curly quotes in the Chinese", () => {
    for (let riddle = 0; riddle < RIDDLES; riddle++) {
      const english = riddleWords(riddle, "en");
      for (const text of [english.question, ...english.answers]) {
        expect(text).not.toMatch(/[一-鿿]/);
        expect(text).not.toMatch(/\b(he|she|him|her|his|hers|sir)\b/i);
      }
      const chinese = riddleWords(riddle, "zh");
      for (const text of [chinese.question, ...chinese.answers]) expect(text).not.toMatch(/[他她“”‘’]/);
    }
  });

  test("take one guess a day, of one of the three answers, and count the right ones", () => {
    const riddles = new Riddles();
    expect(riddles.opened).toBe(false);
    expect(riddles.pickOf(1)).toBeNull();
    expect(riddles.right).toBe(0);
    // Day 1: the right answer is RIDDLE_RIGHT[0].
    expect(riddles.guess(1, RIDDLE_RIGHT[0] as number)).toBe(true);
    expect(riddles.pickOf(1)).toBe(RIDDLE_RIGHT[0]);
    expect(riddles.rightOn(1)).toBe(true);
    // A second guess on the same day is not taken, right or wrong.
    expect(riddles.guess(1, (RIDDLE_RIGHT[0] as number) === 0 ? 1 : 0)).toBe(false);
    expect(riddles.pickOf(1)).toBe(RIDDLE_RIGHT[0]);
    // Day 2: a wrong answer is taken and counted as a guess and not as right.
    const wrong = (RIDDLE_RIGHT[1] as number) === 0 ? 1 : 0;
    expect(riddles.guess(2, wrong)).toBe(true);
    expect(riddles.rightOn(2)).toBe(false);
    expect(riddles.guessed).toBe(2);
    expect(riddles.right).toBe(1);
    // Day 3 and the days after it.
    expect(riddles.guess(3, RIDDLE_RIGHT[2] as number)).toBe(true);
    expect(riddles.guess(4, RIDDLE_RIGHT[3] as number)).toBe(true);
    expect(riddles.guess(5, RIDDLE_RIGHT[4] as number)).toBe(true);
    expect(riddles.right).toBe(4);
    expect(riddles.guessed).toBe(5);
  });

  test("refuse an answer that is not one of the three", () => {
    const riddles = new Riddles();
    for (const bad of [-1, 3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) expect(riddles.guess(1, bad), `${bad}`).toBe(false);
    expect(riddles.guessed).toBe(0);
    expect(riddles.guess(1, 0)).toBe(true);
  });

  test("keep nothing for a lantern that was never opened, and what was guessed with the page notes of a save", () => {
    const riddles = new Riddles();
    expect(riddles.keep()).toBeNull();
    riddles.opened = true;
    expect(riddles.keep()).toEqual({ riddles: { opened: true, guesses: {} } });
    riddles.guess(1, 2);
    riddles.guess(3, 0);
    const kept = riddles.keep();
    expect(kept).toEqual({ riddles: { opened: true, guesses: { "1": 2, "3": 0 } } });
    // It goes through the JSON of a save, takes little room, and comes back whole.
    const text = JSON.stringify(kept);
    expect(text.length).toBeLessThan(200);
    expect(keptNotes(JSON.parse(text))).toEqual(kept);
    expect(text.length).toBeLessThan(MAX_PAGE_NOTES / 100);
    const back = new Riddles();
    back.restore(JSON.parse(text) as Record<string, unknown>);
    expect(back.opened).toBe(true);
    expect(back.pickOf(1)).toBe(2);
    expect(back.pickOf(3)).toBe(0);
    expect(back.pickOf(2)).toBeNull();
    expect(back.keep()).toEqual(kept);
    expect(back.right).toBe(riddles.right);
  });

  test("count a lantern that has a guess as opened, and take back only what is a day and an answer", () => {
    const back = new Riddles();
    back.restore({ riddles: { guesses: { "2": 1, "0": 1, "-3": 1, x: 1, "100": 1, "4": 3, "5": "1", "3": 2.5, "1": 0 } } });
    expect(back.opened).toBe(true);
    expect([1, 2, 3, 4, 5].map((day) => back.pickOf(day))).toEqual([0, 1, null, null, null]);
    for (const junk of [undefined, null, 5, "riddles", [], { riddles: 5 }, { riddles: [] }, { riddles: { guesses: [1, 2] } }, { riddles: { opened: "yes", guesses: null } }] as unknown[]) {
      const fresh = new Riddles();
      fresh.restore(junk as Record<string, unknown> | undefined);
      expect(fresh.opened, JSON.stringify(junk)).toBe(false);
      expect(fresh.guessed, JSON.stringify(junk)).toBe(0);
    }
    const only = new Riddles();
    only.restore({ riddles: { opened: true } });
    expect(only.opened).toBe(true);
    expect(only.guessed).toBe(0);
  });

  test("forget everything when a game begins", () => {
    const riddles = new Riddles();
    riddles.opened = true;
    riddles.guess(1, 1);
    riddles.reset();
    expect(riddles.opened).toBe(false);
    expect(riddles.guessed).toBe(0);
    expect(riddles.keep()).toBeNull();
  });

  test("have a line for the ending page for none, some and all", () => {
    expect([0, 1, 3, 4, 5].map(riddleEndingKey)).toEqual(["egg.ending.riddles.none", "egg.ending.riddles", "egg.ending.riddles", "egg.ending.riddles", "egg.ending.riddles.all"]);
    expect(translate("en", "egg.ending.riddles", { n: "three" })).toBe("You guessed three of the riddles.");
    expect(translate("zh", "egg.ending.riddles", { n: "三" })).toBe("灯谜猜中了三条。");
  });
});

// --- The watchman and the manager who stands still ------------------------------------------------------------------------------------------------------

/** A scene with the market and the teahouse where the map of the town has them, and a cast of a few. */
const SCENE = {
  places: [
    { id: "p_market", kind: "market", rect: { x: 15, y: 17, w: 9, h: 7 }, door: [19, 20] },
    { id: "p_teahouse", kind: "teahouse", rect: { x: 31, y: 10, w: 7, h: 5 }, door: [34, 14] },
    { id: "p_workshop", kind: "workshop", rect: { x: 2, y: 18, w: 7, h: 5 }, door: [5, 21] },
  ],
  cast: ["li_er", "li_laotai", "gengfu", "cha_laoban", "xiao_man"].map((id) => ({ id })),
} as unknown as Scene;

interface Spec {
  day?: number;
  hour?: number;
  minute?: number;
  me?: { x: number; y: number; activity?: string; talk?: string | null };
  people?: Array<{ id: string; x: number; y: number; activity?: string }>;
  bubbles?: Array<{ npc: string; until: number }>;
  talkers?: string[];
}

/** A frame as the core sends it, read. */
function frameOf(spec: Spec = {}): ViewFrame {
  const hour = spec.hour ?? 9;
  const raw = {
    npcs: (spec.people ?? []).map((p) => ({ id: p.id, x: p.x, y: p.y, activity: p.activity ?? "work" })),
    time: { day: spec.day ?? 1, hour, minute: spec.minute ?? 0, phase: hour >= 21 || hour < 6 ? "night" : "day" },
    weather: "clear",
    bubbles: [
      ...(spec.bubbles ?? []).map((b) => ({ npc: b.npc, until: b.until, text: { zh: "好", en: "OK" } })),
      ...(spec.talkers ?? []).map((id) => ({ npc: id, until: 999, talking: true, text: null })),
    ],
    player: spec.me === undefined ? undefined : { x: spec.me.x, y: spec.me.y, activity: spec.me.activity ?? "rest", talk: spec.me.talk == null ? null : { npc: spec.me.talk } },
  };
  return readFrame(raw as unknown as Frame);
}

/** A player's side of the page that the secrets can read, with a clock of its own. */
class Side implements EggHost {
  view: ViewFrame | null = null;
  scene: Scene | null = SCENE;
  now = 0;
  playing = true;
  state: { talk: { npc: string } | null; ending: unknown } = { talk: null, ending: null };
  touched = 0;
  touch(): void {
    this.touched++;
  }
  /** A frame comes: the page reads it, and the secrets look at it. */
  feed(view: ViewFrame, tick = this.now + 1): void {
    this.view = view;
    this.now = tick;
    eggs.afterFrame(view);
  }
}

let side = new Side();
let eggs = new Eggs(side);

test.beforeEach(() => {
  side = new Side();
  eggs = new Eggs(side);
});

test.describe("the hours of the watchman", () => {
  test("are the night from 22:00 up to 05:00 of the game clock, past midnight too", () => {
    expect([21, 22, 23, 0, 1, 2, 3, 4, 5, 6, 12].map(isVerseHour)).toEqual([false, true, true, true, true, true, true, true, false, false, false]);
  });

  test("have five verses in both languages, one for each night, and a night past the fifth begins again", () => {
    expect(VERSES).toBe(5);
    const seen = new Set<string>();
    for (let night = 1; night <= VERSES; night++) {
      const verse = verseOf(night);
      expect(verse.zh, `night ${night}`).not.toBe("");
      expect(verse.en, `night ${night}`).not.toBe("");
      seen.add(verse.zh);
      seen.add(verse.en);
    }
    expect(seen.size).toBe(2 * VERSES);
    expect(verseOf(6)).toEqual(verseOf(1));
    expect(verseOf(0)).toEqual(verseOf(5));
    expect(verseOf(1).zh).toBe(zh["egg.verse.1"]);
    expect(verseOf(2).zh).not.toMatch(/[他她]/);
  });
});

test.describe("three clicks on the watchman", () => {
  const night = (extra: Spec = {}): ViewFrame => frameOf({ hour: 23, me: { x: 30, y: 20 }, people: [{ id: "gengfu", x: 30, y: 22 }], ...extra });

  test("within two seconds, at night, make him say the verse of the night over his head, for the time a verse stays", () => {
    side.feed(night(), 100);
    eggs.pick("gengfu", 10_000);
    eggs.pick("gengfu", 10_300);
    expect(eggs.lines).toEqual([]);
    eggs.pick("gengfu", 10_900);
    expect(eggs.lines).toHaveLength(1);
    const [line] = eggs.lines;
    expect(line?.npc).toBe("gengfu");
    expect(line?.text).toEqual(verseOf(1));
    expect(line?.until).toBe(100 + VERSE_TICKS);
  });

  test("are counted in a window of two seconds: the first of three clicks that is older than that is not one of them", () => {
    side.feed(night(), 100);
    eggs.pick("gengfu", 0);
    eggs.pick("gengfu", 1_100);
    eggs.pick("gengfu", CLICK_WINDOW_MS + 500);
    // the first has gone, so the clicks of the second and the third wait for one more
    expect(eggs.lines).toEqual([]);
    eggs.pick("gengfu", CLICK_WINDOW_MS + 900);
    expect(eggs.lines).toHaveLength(1);
  });

  test("take exactly two seconds: the third click at 2,000 ms after the first counts, and one at 2,001 does not", () => {
    side.feed(night(), 100);
    eggs.pick("gengfu", 50_000);
    eggs.pick("gengfu", 50_800);
    eggs.pick("gengfu", 52_000);
    expect(eggs.lines).toHaveLength(1);
    // the next night, so that it is the window and not the night's one verse that holds it back
    side.feed(night({ day: 2 }), 3_000);
    eggs.pick("gengfu", 60_000);
    eggs.pick("gengfu", 60_800);
    eggs.pick("gengfu", 62_001);
    expect(eggs.lines).toEqual([]);
  });

  test("are three in a row: a click on somebody else or on the ground between them starts the count again", () => {
    side.feed(night(), 100);
    eggs.pick("gengfu", 1_000);
    eggs.pick("gengfu", 1_200);
    eggs.pick("li_er", 1_300);
    eggs.pick("gengfu", 1_400);
    expect(eggs.lines).toEqual([]);
    eggs.pick("gengfu", 1_500);
    eggs.pick(null, 1_600);
    eggs.pick("gengfu", 1_700);
    expect(eggs.lines).toEqual([]);
    for (const at of [2_000, 2_100, 2_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toHaveLength(1);
  });

  test("do nothing by day, nor before 22:00 nor from 05:00, and the first click of them is as any click", () => {
    for (const hour of [6, 12, 17, 21, 5]) {
      const fresh = new Eggs(side);
      side.feed(night({ hour }), 100);
      side.view = night({ hour });
      for (const at of [1_000, 1_100, 1_200]) fresh.pick("gengfu", at);
      expect(fresh.lines, `${hour}:00`).toEqual([]);
    }
    for (const hour of [22, 23, 0, 4]) {
      const fresh = new Eggs(side);
      side.view = night({ hour });
      for (const at of [1_000, 1_100, 1_200]) fresh.pick("gengfu", at);
      expect(fresh.lines, `${hour}:00`).toHaveLength(1);
    }
  });

  test("do nothing while the manager is in a talk, or for a recording, or once the ending has come", () => {
    side.feed(night(), 100);
    side.state.talk = { npc: "li_laotai" };
    for (const at of [1_000, 1_100, 1_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toEqual([]);
    side.state.talk = null;
    side.playing = false;
    for (const at of [2_000, 2_100, 2_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toEqual([]);
    side.playing = true;
    side.state.ending = {};
    for (const at of [3_000, 3_100, 3_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toEqual([]);
  });

  test("say one verse a night: not a second the same night, the next one the next night, and the same night after a game that is loaded", () => {
    side.feed(night({ day: 1 }), 100);
    for (const at of [1_000, 1_100, 1_200]) eggs.pick("gengfu", at);
    expect(eggs.lines[0]?.text).toEqual(verseOf(1));
    // the same night, after the first has gone, and past midnight (the clock says 01:00 of the same day)
    side.feed(night({ day: 1, hour: 23 }), 100 + VERSE_TICKS + 1);
    expect(eggs.lines).toEqual([]);
    for (const at of [20_000, 20_100, 20_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toEqual([]);
    side.feed(night({ day: 1, hour: 1 }), 400);
    for (const at of [30_000, 30_100, 30_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toEqual([]);
    // the next night has its own verse
    side.feed(night({ day: 2 }), 2_500);
    for (const at of [40_000, 40_100, 40_200]) eggs.pick("gengfu", at);
    expect(eggs.lines[0]?.text).toEqual(verseOf(2));
    // a game that is loaded starts the nights again
    eggs.reset();
    side.feed(night({ day: 2 }), 2_600);
    for (const at of [50_000, 50_100, 50_200]) eggs.pick("gengfu", at);
    expect(eggs.lines[0]?.text).toEqual(verseOf(2));
  });

  test("leave the watchman alone while a line of the game is over his head", () => {
    side.feed(night({ bubbles: [{ npc: "gengfu", until: 500 }] }), 100);
    for (const at of [1_000, 1_100, 1_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toEqual([]);
    // the count started again, and a verse that waited is not spent
    side.feed(night({ bubbles: [{ npc: "gengfu", until: 50 }] }), 120);
    for (const at of [5_000, 5_100, 5_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toHaveLength(1);
  });

  test("are put away when a talk begins, and when their time is up", () => {
    side.feed(night(), 100);
    for (const at of [1_000, 1_100, 1_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toHaveLength(1);
    side.feed(night(), 100 + VERSE_TICKS - 1);
    expect(eggs.lines).toHaveLength(1);
    side.feed(night(), 100 + VERSE_TICKS);
    expect(eggs.lines).toEqual([]);
    for (const at of [10_000, 10_100, 10_200]) eggs.pick("gengfu", at);
    side.feed(night({ day: 2 }), 5_000);
    for (const at of [20_000, 20_100, 20_200]) eggs.pick("gengfu", at);
    expect(eggs.lines).toHaveLength(1);
    eggs.hush();
    expect(eggs.lines).toEqual([]);
  });
});

test.describe("the time the manager stands still", () => {
  test("is counted in minutes of the game clock, with no step back at midnight or at dawn", () => {
    const at = (day: number, hour: number, minute = 0): number => gameMinutes({ day, hour, minute });
    expect(at(1, 6)).toBe(360);
    expect(at(1, 21)).toBe(21 * 60);
    expect(at(1, 23, 59)).toBe(24 * 60 - 1);
    expect(at(1, 0)).toBe(24 * 60);
    expect(at(1, 5, 59)).toBe(30 * 60 - 1);
    expect(at(2, 6)).toBe(30 * 60);
    expect(at(2, 6) - at(1, 5, 59)).toBe(1);
    expect(at(5, 20, 59)).toBeGreaterThan(at(5, 20, 58));
  });

  test("passes an hour for a person who stays in one cell at rest, and not before", () => {
    const timer = new StillTimer();
    const cell = { x: 19, y: 20 };
    expect(timer.see(true, cell, 540)).toBe(false);
    expect(timer.see(true, cell, 570)).toBe(false);
    expect(timer.see(true, cell, 540 + STILL_MINUTES - 1)).toBe(false);
    expect(timer.see(true, cell, 540 + STILL_MINUTES)).toBe(true);
    expect(timer.see(true, cell, 540 + STILL_MINUTES + 30)).toBe(true);
  });

  test("begins again for a step to another cell, for a time away from the spot, for an act, and for a clock that goes back", () => {
    const timer = new StillTimer();
    const cell = { x: 19, y: 20 };
    timer.see(true, cell, 540);
    expect(timer.see(true, { x: 20, y: 20 }, 590)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 649)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 650)).toBe(true);
    expect(timer.see(false, { x: 20, y: 20 }, 660)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 661)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 720)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 721)).toBe(true);
    timer.reset();
    expect(timer.see(true, { x: 20, y: 20 }, 800)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 859)).toBe(false);
    // a clock that went back (a game that was loaded) is a new count
    expect(timer.see(true, { x: 20, y: 20 }, 100)).toBe(false);
    expect(timer.see(true, { x: 20, y: 20 }, 160)).toBe(true);
  });

  test("is not an hour for a world that is held: the same minute, asked again and again, does not pass", () => {
    const timer = new StillTimer();
    for (let i = 0; i < 50; i++) expect(timer.see(true, { x: 1, y: 1 }, 600)).toBe(false);
  });

  test("passes the midnight of the game clock", () => {
    const timer = new StillTimer();
    const cell = { x: 19, y: 20 };
    timer.see(true, cell, gameMinutes({ day: 1, hour: 23, minute: 30 }));
    expect(timer.see(true, cell, gameMinutes({ day: 1, hour: 0, minute: 20 }))).toBe(false);
    expect(timer.see(true, cell, gameMinutes({ day: 1, hour: 0, minute: 30 }))).toBe(true);
  });
});

test.describe("where the manager stands", () => {
  test("is the market, which is its ground, or the door of the teahouse, within three cells of it", () => {
    expect(spotOf(SCENE, { x: 19, y: 20 })).toBe("market");
    expect(spotOf(SCENE, { x: 15, y: 17 })).toBe("market");
    expect(spotOf(SCENE, { x: 23, y: 23 })).toBe("market");
    expect(spotOf(SCENE, { x: 24, y: 23 })).toBeNull();
    expect(spotOf(SCENE, { x: 19, y: 24 })).toBeNull();
    expect(spotOf(SCENE, { x: 34, y: 14 })).toBe("teahouse");
    expect(spotOf(SCENE, { x: 31, y: 14 })).toBe("teahouse");
    expect(spotOf(SCENE, { x: 37, y: 14 })).toBe("teahouse");
    expect(spotOf(SCENE, { x: 34, y: 17 })).toBe("teahouse");
    expect(spotOf(SCENE, { x: 38, y: 14 })).toBeNull();
    expect(spotOf(SCENE, { x: 34, y: 18 })).toBeNull();
    expect(spotOf(SCENE, { x: 5, y: 21 })).toBeNull();
    expect(spotOf({ places: [] } as unknown as Scene, { x: 19, y: 20 })).toBeNull();
  });
});

test.describe("the person who says it", () => {
  const people = [
    { id: "li_er", x: 22, y: 20 },
    { id: "li_laotai", x: 16, y: 20 },
    { id: "gengfu", x: 19, y: 23 },
    { id: "cha_laoban", x: 19, y: 10 },
  ];
  const me = { x: 19, y: 20 };

  test("is the nearest of the cast, as the king walks, and the first id where two are as near", () => {
    expect(nearestSpeaker(frameOf({ me, people }), SCENE, 0)).toBe("gengfu");
    expect(nearestSpeaker(frameOf({ me, people: people.filter((p) => p.id !== "gengfu") }), SCENE, 0)).toBe("li_er");
    expect(nearestSpeaker(frameOf({ me, people: [{ id: "li_laotai", x: 16, y: 20 }, { id: "li_er", x: 22, y: 20 }] }), SCENE, 0)).toBe("li_er");
    expect(nearestSpeaker(frameOf({ me, people: [{ id: "li_laotai", x: 17, y: 20 }, { id: "li_er", x: 22, y: 20 }] }), SCENE, 0)).toBe("li_laotai");
  });

  test("is not somebody asleep, nor somebody who talks beyond hearing, nor somebody who is saying something now", () => {
    const asleep = people.map((p) => (p.id === "gengfu" ? { ...p, activity: "sleep" } : p));
    expect(nearestSpeaker(frameOf({ me, people: asleep }), SCENE, 0)).toBe("li_er");
    expect(nearestSpeaker(frameOf({ me, people, talkers: ["gengfu"] }), SCENE, 0)).toBe("li_er");
    expect(nearestSpeaker(frameOf({ me, people, bubbles: [{ npc: "gengfu", until: 50 }] }), SCENE, 10)).toBe("li_er");
    // a line that is over by this tick is not saying something
    expect(nearestSpeaker(frameOf({ me, people, bubbles: [{ npc: "gengfu", until: 50 }] }), SCENE, 50)).toBe("gengfu");
  });

  test("is of the cast, within hearing, and nobody where there is nobody", () => {
    expect(nearestSpeaker(frameOf({ me, people: [{ id: "stranger", x: 19, y: 21 }] }), SCENE, 0)).toBeNull();
    expect(nearestSpeaker(frameOf({ me, people: [{ id: "li_er", x: 19 + HEARING_CELLS, y: 20 }] }), SCENE, 0)).toBe("li_er");
    expect(nearestSpeaker(frameOf({ me, people: [{ id: "li_er", x: 19 + HEARING_CELLS + 1, y: 20 }] }), SCENE, 0)).toBeNull();
    expect(nearestSpeaker(frameOf({ people }), SCENE, 0)).toBeNull();
  });

  test("has a line of their own in both languages, and the line of the street for somebody who has none", () => {
    for (const id of SCENE.cast.map((p) => p.id)) {
      const line = rumourOf(id);
      expect(line.zh, id).not.toBe("");
      expect(line.en, id).not.toBe("");
    }
    expect(rumourOf("a_stranger")).toEqual(rumourOf("also_a_stranger"));
    expect(rumourOf("li_er")).not.toEqual(rumourOf("a_stranger"));
  });
});

test.describe("the manager who stands still at the market", () => {
  const me = { x: 19, y: 20 };
  const people = [
    { id: "li_er", x: 21, y: 20 },
    { id: "li_laotai", x: 25, y: 18 },
  ];
  /** A frame at a time of day, with the manager at the market at rest. */
  const at = (hour: number, minute: number, extra: Spec = {}): ViewFrame => frameOf({ hour, minute, me, people, ...extra });

  test("has the nearest person say a line of street talk after an hour of game time, over their head, and once", () => {
    side.feed(at(9, 0), 100);
    side.feed(at(9, 30), 160);
    side.feed(at(9, 59), 200);
    expect(eggs.lines).toEqual([]);
    side.feed(at(10, 0), 210);
    expect(eggs.lines).toHaveLength(1);
    const [line] = eggs.lines;
    expect(line?.npc).toBe("li_er");
    expect(line?.text).toEqual(rumourOf("li_er"));
    expect(line?.until).toBe(210 + RUMOUR_TICKS);
    // once in a game: not again, however long the manager stands there
    side.feed(at(11, 0), 210 + RUMOUR_TICKS + 5);
    side.feed(at(14, 0), 900);
    side.feed(at(17, 0), 1_500);
    expect(eggs.lines).toEqual([]);
  });

  test("is the same at the door of the teahouse, and is not for anywhere else", () => {
    const door = { x: 34, y: 14 };
    side.feed(frameOf({ hour: 15, minute: 0, me: door, people: [{ id: "cha_laoban", x: 33, y: 14 }] }), 100);
    side.feed(frameOf({ hour: 16, minute: 0, me: door, people: [{ id: "cha_laoban", x: 33, y: 14 }] }), 200);
    expect(eggs.lines[0]?.npc).toBe("cha_laoban");
    const other = new Side();
    const elsewhere = new Eggs(other);
    for (const [hour, tick] of [[9, 1], [10, 2], [12, 3]] as const) {
      other.view = frameOf({ hour, me: { x: 5, y: 21 }, people: [{ id: "li_er", x: 6, y: 21 }] });
      other.now = tick;
      elsewhere.afterFrame(other.view);
    }
    expect(elsewhere.lines).toEqual([]);
  });

  test("begins again for a step, for an act of the manager and for a person who is not at rest", () => {
    side.feed(at(9, 0), 100);
    side.feed(at(9, 40), 150);
    // a step to the next cell
    side.feed(frameOf({ hour: 9, minute: 50, me: { x: 20, y: 20 }, people }), 160);
    side.feed(at(10, 40), 200);
    expect(eggs.lines).toEqual([]);
    // an act: looking, asking, listening
    eggs.acted();
    side.feed(frameOf({ hour: 10, minute: 50, me: { x: 20, y: 20 }, people }), 210);
    side.feed(frameOf({ hour: 11, minute: 40, me: { x: 20, y: 20 }, people }), 240);
    expect(eggs.lines).toEqual([]);
    // walking is not rest
    side.feed(frameOf({ hour: 11, minute: 50, me: { x: 20, y: 20, activity: "walk" }, people }), 250);
    side.feed(frameOf({ hour: 12, minute: 55, me: { x: 20, y: 20, activity: "walk" }, people }), 260);
    expect(eggs.lines).toEqual([]);
    // and then an hour of rest does it
    side.feed(frameOf({ hour: 13, minute: 0, me: { x: 20, y: 20 }, people }), 270);
    side.feed(frameOf({ hour: 14, minute: 0, me: { x: 20, y: 20 }, people }), 280);
    expect(eggs.lines).toHaveLength(1);
  });

  test("is for the manager outside a talk, and a talk that is on begins the count again", () => {
    side.feed(at(9, 0), 100);
    side.state.talk = { npc: "li_er" };
    side.feed(at(9, 30), 120);
    side.feed(at(10, 30), 130);
    expect(eggs.lines).toEqual([]);
    side.state.talk = null;
    side.feed(at(10, 31), 140);
    side.feed(at(11, 20), 150);
    expect(eggs.lines).toEqual([]);
    side.feed(at(11, 31), 160);
    expect(eggs.lines).toHaveLength(1);
    // the frame can say it as well
    const frame = new Eggs(side);
    side.now = 200;
    frame.afterFrame(frameOf({ hour: 12, minute: 0, me: { ...me, talk: "li_er" }, people }));
    side.now = 210;
    frame.afterFrame(frameOf({ hour: 13, minute: 30, me: { ...me, talk: "li_er" }, people }));
    expect(frame.lines).toEqual([]);
  });

  test("waits for somebody to say it: with nobody near the line is not spent", () => {
    side.feed(frameOf({ hour: 9, minute: 0, me, people: [] }), 100);
    side.feed(frameOf({ hour: 10, minute: 30, me, people: [] }), 200);
    expect(eggs.lines).toEqual([]);
    side.feed(frameOf({ hour: 10, minute: 31, me, people: [{ id: "xiao_man", x: 20, y: 21 }] }), 210);
    expect(eggs.lines[0]?.npc).toBe("xiao_man");
  });

  test("starts again with a game that is loaded, and keeps nothing for a save", () => {
    side.feed(at(9, 0), 100);
    side.feed(at(10, 0), 200);
    expect(eggs.lines).toHaveLength(1);
    expect(eggs.keep()).toBeNull();
    eggs.reset();
    expect(eggs.lines).toEqual([]);
    side.feed(at(9, 0), 300);
    side.feed(at(10, 0), 400);
    expect(eggs.lines).toHaveLength(1);
    // a recording has no player to stand still
    side.playing = false;
    eggs.reset();
    side.feed(at(9, 0), 500);
    side.feed(at(10, 0), 600);
    expect(eggs.lines).toEqual([]);
  });

  test("is put away for a talk, and says nothing in the ending", () => {
    side.feed(at(9, 0), 100);
    side.feed(at(10, 0), 200);
    expect(eggs.lines).toHaveLength(1);
    eggs.hush();
    expect(eggs.lines).toEqual([]);
    eggs.reset();
    side.state.ending = {};
    side.feed(at(11, 0), 300);
    side.feed(at(12, 30), 400);
    expect(eggs.lines).toEqual([]);
  });
});

test.describe("the slip of the riddle lantern", () => {
  test("opens for a player outside a talk and a game that is on, and counts a lantern that was opened", () => {
    side.feed(frameOf({ day: 3, me: { x: 5, y: 22 } }), 100);
    expect(eggs.riddleOpen).toBe(false);
    expect(eggs.openRiddle()).toBe(true);
    expect(eggs.riddleOpen).toBe(true);
    expect(eggs.riddles.opened).toBe(true);
    expect(eggs.day).toBe(3);
    eggs.closeRiddle();
    expect(eggs.riddleOpen).toBe(false);
    expect(eggs.riddles.opened).toBe(true);
  });

  test("does not open in a talk, nor for a recording, nor in the ending", () => {
    side.feed(frameOf({ me: { x: 5, y: 22 } }), 100);
    side.state.talk = { npc: "li_er" };
    expect(eggs.openRiddle()).toBe(false);
    side.state.talk = null;
    side.playing = false;
    expect(eggs.openRiddle()).toBe(false);
    side.playing = true;
    side.state.ending = {};
    expect(eggs.openRiddle()).toBe(false);
    expect(eggs.riddles.opened).toBe(false);
    expect(eggs.riddleOpen).toBe(false);
  });

  test("takes one guess for the day of the clock and keeps it for a save, and a game that is loaded gets it back", () => {
    side.feed(frameOf({ day: 2 }), 100);
    eggs.openRiddle();
    const right = RIDDLE_RIGHT[1] as number;
    expect(eggs.guess(right)).toBe(true);
    expect(eggs.guess(right)).toBe(false);
    expect(eggs.brightness).toBe(1);
    side.feed(frameOf({ day: 3 }), 200);
    expect(eggs.guess(0)).toBe(true);
    const notes = JSON.parse(JSON.stringify(eggs.keep())) as Record<string, unknown>;
    expect(notes).toEqual({ riddles: { opened: true, guesses: { "2": right, "3": 0 } } });
    const fresh = new Eggs(new Side());
    fresh.restore(notes);
    expect(fresh.riddles.opened).toBe(true);
    expect(fresh.riddles.pickOf(2)).toBe(right);
    expect(fresh.brightness).toBe(1);
  });

  test("is put away with a call, which can be made again and does no harm", () => {
    side.feed(frameOf({ me: { x: 5, y: 22 } }), 100);
    eggs.openRiddle();
    expect(eggs.riddleOpen).toBe(true);
    eggs.closeRiddle();
    eggs.closeRiddle();
    expect(eggs.riddleOpen).toBe(false);
    // a game that begins puts the slip away too
    eggs.openRiddle();
    eggs.reset();
    expect(eggs.riddleOpen).toBe(false);
    expect(eggs.riddles.opened).toBe(false);
  });
});

test.describe("the light of the riddle lantern", () => {
  test("is out by day, lit by night, and a little brighter and wider for each riddle that was guessed right, by day too", () => {
    expect(lookOf(0, 0)).toEqual({ lit: false, glow: 0, size: 1 });
    expect(lookOf(1, 0).lit).toBe(true);
    const glows = Array.from({ length: STEPS + 1 }, (_, n) => lookOf(1, n).glow);
    const sizes = Array.from({ length: STEPS + 1 }, (_, n) => lookOf(1, n).size);
    for (let n = 1; n <= STEPS; n++) {
      expect(glows[n] as number, `${n}`).toBeGreaterThan(glows[n - 1] as number);
      expect(sizes[n] as number, `${n}`).toBeGreaterThan(sizes[n - 1] as number);
    }
    expect(Math.max(...glows)).toBeLessThanOrEqual(0.95);
    // a right answer is seen in the daylight as well
    expect(lookOf(0, 1).lit).toBe(true);
    expect(lookOf(0, 1).glow).toBeGreaterThan(lookOf(0, 0).glow);
    // the day's light has gone out of it before the lantern is called lit
    expect(lookOf(0.1, 0).lit).toBe(false);
    expect(lookOf(0.2, 0).lit).toBe(true);
  });

  test("holds to the steps it has: no more than five, no fewer than none", () => {
    expect(lookOf(1, 9)).toEqual(lookOf(1, STEPS));
    expect(lookOf(1, -3)).toEqual(lookOf(1, 0));
    expect(lookOf(1, 2.9)).toEqual(lookOf(1, 2));
  });
});

test.describe("what the manager does", () => {
  test("is every act of the town and none of what the page does for itself", () => {
    for (const act of ["move", "talk", "leave", "ask", "ask_source", "listen", "look", "rally", "tell", "entrust", "promise", "speak", "gift"]) expect(isAct(act), act).toBe(true);
    for (const page of ["track", "judge", "hint", "moment", "statement"]) expect(isAct(page), page).toBe(false);
  });
});

test.describe("the words of the secrets", () => {
  const keys = (table: Record<string, string>): string[] => Object.keys(table).filter((key) => key.startsWith("egg."));

  test("are the same keys in both languages, and say each person's line in a voice of their own", () => {
    expect(keys(zh).sort()).toEqual(keys(en).sort());
    const rumours = keys(en).filter((key) => key.startsWith("egg.rumour."));
    // twenty people and the line of the street
    expect(rumours).toHaveLength(21);
    expect(new Set(rumours.map((key) => en[key as keyof typeof en])).size).toBe(21);
    expect(new Set(rumours.map((key) => zh[key as keyof typeof zh])).size).toBe(21);
  });

  test("say the manager and nobody by he or she, in either language", () => {
    for (const key of keys(en)) {
      expect(en[key as keyof typeof en], key).not.toMatch(/\b(he|she|him|her|his|hers|himself|herself|sir)\b/i);
      expect(zh[key as keyof typeof zh].replace(/其他|他人|他们/g, ""), key).not.toMatch(/[他她]/);
    }
  });

  test("have lines that are short enough for a bubble over the map", () => {
    for (const key of keys(en).filter((k) => /^egg\.(rumour|verse)\./.test(k))) {
      expect(zh[key as keyof typeof zh].length, key).toBeLessThanOrEqual(32);
      expect(en[key as keyof typeof en].length, key).toBeLessThanOrEqual(100);
    }
  });
});
