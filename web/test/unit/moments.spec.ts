import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { readMoments } from "../../src/page/director.ts";
import {
  Album,
  cardsOf,
  MAX_PICTURES,
  NOTES_KEY,
  PICTURE_MAX_CHARS,
  PICTURE_QUALITIES,
  PICTURE_WIDTH,
  timeAtTick,
  validPicture,
} from "../../src/page/moments.ts";
import { tickText } from "../../src/page/ui/format.ts";
import { keptNotes, MAX_PAGE_NOTES } from "../../src/shared/runtime.ts";

// The moments of a game as the ending page keeps them: the time of each, the pictures taken from the map, what a save keeps, and the cards.

/** A small image as a data URL of a given length. */
const picture = (chars: number, kind: "jpeg" | "png" = "jpeg"): string => {
  const head = `data:image/${kind};base64,`;
  return head + "A".repeat(Math.max(0, chars - head.length));
};

test.describe("the game time of a tick", () => {
  // From core/lantern_core/world/bridge/clock.py `at`: tick, day, hour, minute.
  const CORE: Array<[number, number, number, number]> = [
    [0, 1, 6, 0],
    [1, 1, 6, 0],
    [59, 1, 6, 29],
    [60, 1, 6, 30],
    [119, 1, 6, 59],
    [120, 1, 7, 0],
    [1799, 1, 20, 59],
    [1800, 1, 21, 0],
    [1829, 1, 21, 58],
    [1830, 1, 22, 0],
    [2069, 1, 5, 58],
    [2070, 2, 6, 0],
    [2071, 2, 6, 0],
    [4490, 3, 8, 55],
    [5900, 3, 20, 40],
    [6000, 3, 23, 0],
    [10079, 5, 20, 59],
    [10080, 5, 21, 0],
  ];

  test("is what the clock of the core says at the same tick, in the day and at night", () => {
    for (const [tick, day, hour, minute] of CORE) expect(timeAtTick(tick), `tick ${tick}`).toEqual({ day, hour, minute });
  });

  test("puts the hours after midnight on the day that began the evening before, and holds a tick that is not a tick to the first", () => {
    expect(timeAtTick(2069)).toEqual({ day: 1, hour: 5, minute: 58 });
    expect(timeAtTick(-5)).toEqual({ day: 1, hour: 6, minute: 0 });
    expect(timeAtTick(Number.NaN)).toEqual({ day: 1, hour: 6, minute: 0 });
    expect(timeAtTick(10080.9)).toEqual({ day: 5, hour: 21, minute: 0 });
  });
});

test.describe("the time of a tick as the lists of saves and recordings say it", () => {
  test("is the day and the clock of the game in each language, with no tick in it", () => {
    for (const [lang, expected] of [
      ["en", ["Day 1 06:00", "Day 1 13:30", "Day 3 08:55", "Day 5 21:00"]],
      ["zh", ["第一天 06:00", "第一天 13:30", "第三天 08:55", "第五天 21:00"]],
    ] as const) {
      setLang(lang);
      expect([0, 900, 4490, 10080].map((tick) => tickText(lang, tick))).toEqual(expected);
    }
    setLang("en");
  });
});

test.describe("a picture the page keeps", () => {
  test("is a small image as a data URL, of at most the length a save has room for", () => {
    expect(validPicture(picture(2000))).toBe(true);
    expect(validPicture(picture(2000, "png"))).toBe(true);
    expect(validPicture(picture(PICTURE_MAX_CHARS))).toBe(true);
    expect(validPicture(picture(PICTURE_MAX_CHARS + 1))).toBe(false);
    for (const bad of ["", "https://example.com/a.jpg", "data:image/svg+xml;base64,AAAA", "data:image/jpeg;base64,not base64!", "data:text/html;base64,AAAA", 3, null, undefined, {}]) {
      expect(validPicture(bad), String(bad)).toBe(false);
    }
  });

  test("is asked of the map at a width of a small picture and a few qualities, best first", () => {
    expect(PICTURE_WIDTH).toBeLessThan(400);
    expect([...PICTURE_QUALITIES]).toEqual([...PICTURE_QUALITIES].sort((a, b) => b - a));
    expect(MAX_PICTURES).toBe(3);
  });
});

test.describe("the album", () => {
  const map = (urls: Array<string | null | "throw">) => {
    const asked: Array<[number, readonly number[], number]> = [];
    let i = 0;
    return {
      asked,
      pictureOf(width: number, qualities: readonly number[], maxChars: number): string | null {
        asked.push([width, qualities, maxChars]);
        const next = urls[i++] ?? null;
        if (next === "throw") throw new Error("no pixels");
        return next;
      },
    };
  };

  test("takes the picture of a moment from the map once, at the width and sizes it asks for, and keeps the first", () => {
    const album = new Album();
    const m = map([picture(3000), picture(4000)]);
    expect(album.take("both_banks", m)).toBe(true);
    expect(album.get("both_banks")).toBe(picture(3000));
    expect(m.asked[0]).toEqual([PICTURE_WIDTH, PICTURE_QUALITIES, PICTURE_MAX_CHARS]);
    // a moment that has its picture is not taken again
    expect(album.take("both_banks", m)).toBe(false);
    expect(m.asked).toHaveLength(1);
    expect(album.size).toBe(1);
    expect(album.get("echo")).toBeNull();
  });

  test("keeps nothing where there is no map, where the map has no picture or gives a bad one or fails", () => {
    const album = new Album();
    expect(album.take("echo", null)).toBe(false);
    expect(album.take("echo", map([null]))).toBe(false);
    expect(album.take("echo", map([picture(PICTURE_MAX_CHARS + 10)]))).toBe(false);
    expect(album.take("echo", map(["throw"]))).toBe(false);
    expect(album.size).toBe(0);
    expect(album.keep()).toBeNull();
  });

  test("keeps no more pictures than there are kinds of moment, one for each", () => {
    const album = new Album();
    for (const kind of ["echo", "together_work", "both_banks"] as const) expect(album.put(kind, picture(1000))).toBe(true);
    expect(album.size).toBe(MAX_PICTURES);
    expect(album.put("echo", picture(1000))).toBe(false);
  });

  test("is what a save keeps with the game: the pictures by the kind of moment, each of a size a save has room for, and nothing where there are none", () => {
    const album = new Album();
    expect(album.keep()).toBeNull();
    album.put("together_work", picture(PICTURE_MAX_CHARS));
    album.put("both_banks", picture(5000));
    const notes = album.keep();
    expect(notes).toEqual({ [NOTES_KEY]: { pictures: { together_work: picture(PICTURE_MAX_CHARS), both_banks: picture(5000) } } });
    // three pictures of the most a picture may be, and the rest of a save's notes, still go through the host's limit
    const three = new Album();
    for (const kind of ["echo", "together_work", "both_banks"] as const) three.put(kind, picture(PICTURE_MAX_CHARS));
    const withRecap = { recap: { key: "r", lines: [{ text: "x".repeat(8000) }] }, ...three.keep() };
    expect(keptNotes(withRecap)).toEqual(withRecap);
    expect(MAX_PAGE_NOTES).toBeGreaterThanOrEqual(3 * PICTURE_MAX_CHARS + 16_384);
  });

  test("gets its pictures back when a save is loaded, and leaves what it does not understand", () => {
    const album = new Album();
    album.put("echo", picture(2500));
    album.put("both_banks", picture(2600));
    const notes = album.keep();
    const again = new Album();
    again.restore(notes ?? undefined);
    expect(again.get("echo")).toBe(picture(2500));
    expect(again.get("both_banks")).toBe(picture(2600));
    expect(again.get("together_work")).toBeNull();
    const odd = new Album();
    odd.restore({ [NOTES_KEY]: { pictures: { echo: "javascript:alert(1)", dance: picture(900), together_work: picture(PICTURE_MAX_CHARS + 50), both_banks: picture(900) } } });
    expect(odd.size).toBe(1);
    expect(odd.get("both_banks")).toBe(picture(900));
    for (const bad of [undefined, {}, { [NOTES_KEY]: 3 }, { [NOTES_KEY]: { pictures: [1] } }, { [NOTES_KEY]: [] }, { [NOTES_KEY]: { pictures: null } }]) {
      const none = new Album();
      none.restore(bad as never);
      expect(none.size).toBe(0);
    }
  });

  test("forgets everything for a new game or a game that is loaded", () => {
    const album = new Album();
    album.put("echo", picture(900));
    album.reset();
    expect(album.size).toBe(0);
    expect(album.get("echo")).toBeNull();
  });
});

test.describe("the cards of the moments", () => {
  const moments = readMoments([
    { kind: "both_banks", tick: 900, place: "p_bridge", x: 27, y: 15 },
    { kind: "echo", tick: 812, place: "p_zhou_house", x: 44, y: 6, prop: "pr_boat", from: "zhou_zhanggui" },
    { kind: "together_work", tick: 4490, place: "p_bridge", x: 27, y: 15, round: 3 },
  ]);

  test("are in the order the moments happened, with the time of each and the picture the album has", () => {
    const album = new Album();
    album.put("both_banks", picture(1800));
    const cards = cardsOf(moments, album);
    expect(cards.map((c) => c.kind)).toEqual(["echo", "both_banks", "together_work"]);
    expect(cards.map((c) => c.time)).toEqual([timeAtTick(812), timeAtTick(900), timeAtTick(4490)]);
    expect(cards.map((c) => c.picture)).toEqual([null, picture(1800), null]);
    expect(cards[0]).toMatchObject({ place: "p_zhou_house", from: "zhou_zhanggui", tick: 812 });
    expect(cards[2]).toMatchObject({ time: { day: 3, hour: 8, minute: 55 } });
  });

  test("are none where the game has no moments, or the page was never told to look for them", () => {
    expect(cardsOf(null, new Album())).toEqual([]);
    expect(cardsOf([], new Album())).toEqual([]);
    expect(cardsOf(readMoments(undefined), new Album())).toEqual([]);
  });
});
