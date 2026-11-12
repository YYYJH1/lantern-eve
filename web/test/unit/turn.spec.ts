import { expect, test } from "@playwright/test";
import { type Part, turnOf } from "../../src/page/ui/turn.ts";

// Where the phrase that turns a page begins, from the lines and the controls of the page: its own height where nothing is cut, the top of the part that its top edge would cut in half
// where something is, and where the page that a turn brings in begins.

/** Lines of 20 px with 6 px between them, from the top of the paper: line n is at 4 + 26 n to 24 + 26 n (the sixth at 134, the seventh at 160, the tenth at 238, the eleventh at 264). */
const lines = (count: number): Part[] => Array.from({ length: count }, (_, n) => ({ top: 4 + n * 26, bottom: 24 + n * 26 }));

test.describe("where the phrase that turns a page begins", () => {
  test("keeps its own height where its top edge falls between two parts, and the next page begins at the part under it", () => {
    // the foot is at 200 and the phrase 40 tall: its top edge is at 160, where the seventh line begins
    expect(turnOf(lines(12), 200, 0, 40)).toEqual({ top: 160, next: 160 });
  });

  test("begins at the top of the line that its own top edge would cut in half", () => {
    // the foot is at 190: the phrase would begin at 150, inside the sixth line (134 to 154)
    expect(turnOf(lines(12), 190, 0, 40)).toEqual({ top: 134, next: 134 });
  });

  test("begins above every part that it would cut, among parts that lie side by side", () => {
    // the foot is at 140, so the edge would be at 100: it cuts the part at 90..115, which begins at 90; there it cuts the part at 80..98, which begins at 80; there it cuts nothing
    const parts: Part[] = [
      { top: 10, bottom: 30 },
      { top: 60, bottom: 78 },
      { top: 90, bottom: 115 },
      { top: 80, bottom: 98 },
    ];
    expect(turnOf(parts, 140, 0, 40)).toEqual({ top: 80, next: 80 });
  });

  test("does not count a part that the edge falls inside by a pixel or less: the box of a line is a little taller than its ink", () => {
    // the edge is at 100
    expect(turnOf([{ top: 50, bottom: 100.8 }, { top: 120, bottom: 140 }], 140, 0, 40).top).toBe(100);
    expect(turnOf([{ top: 10, bottom: 30 }, { top: 99.2, bottom: 130 }], 140, 0, 40).top).toBe(100);
    // two pixels and a half are a cut
    expect(turnOf([{ top: 10, bottom: 30 }, { top: 50, bottom: 102.5 }, { top: 120, bottom: 140 }], 140, 0, 40)).toEqual({ top: 50, next: 50 });
  });

  test("has no page to turn to where nothing is under the phrase", () => {
    expect(turnOf(lines(3), 200, 0, 40)).toEqual({ top: 160, next: null });
  });

  test("keeps its own height where no part is whole above it in view: one part, taller than the page, fills it", () => {
    expect(turnOf([{ top: 0, bottom: 500 }], 200, 0, 40)).toEqual({ top: 160, next: null });
    // the page is at 250 to 500: the part above its head (0..200) is not in view, and the part at 440..480 would be cut by the edge at 460, but nothing else is whole above it
    expect(turnOf([{ top: 0, bottom: 200 }, { top: 440, bottom: 480 }], 500, 250, 40)).toEqual({ top: 460, next: null });
    // with a line in view above it, the phrase begins at the part that it would cut
    expect(turnOf([{ top: 0, bottom: 200 }, { top: 300, bottom: 320 }, { top: 440, bottom: 480 }], 500, 250, 40)).toEqual({ top: 440, next: 440 });
  });

  test("works on the part of the paper that is in view when the paper is scrolled", () => {
    // the page is at 100 to 300: the edge is at 260, between the tenth line (238 to 258) and the eleventh (264 to 284)
    expect(turnOf(lines(20), 300, 100, 40)).toEqual({ top: 260, next: 264 });
    // at 100 to 310 it is at 270, inside the eleventh line, and the phrase begins at 264
    expect(turnOf(lines(20), 310, 100, 40)).toEqual({ top: 264, next: 264 });
  });
});
