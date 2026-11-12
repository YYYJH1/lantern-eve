import { expect, test } from "@playwright/test";
import { type Box, boxesOver, slideClear, stampOf } from "../../src/page/map/clear.ts";
import { placeTags, type Spot } from "../../src/page/map/tag-layout.ts";

// The names on the map keep clear of the boxes of paper the page lays over it: the placard of the day, the key to the lights, the red slip. At 1280 by 760
// the placard covered the start of the name of the Li family's house, and the key a name that ended in "shop".

const PLACARD: Box = { x: 28, y: 23, w: 118, h: 122 };
const KEY: Box = { x: 28, y: 336, w: 142, h: 92 };

test.describe("the boxes over the map", () => {
  test("are read as boxes of the canvas, and what has no size or lies outside it is left out", () => {
    const canvas = { left: 10, top: 20, width: 1280, height: 760 };
    const boxes = boxesOver(canvas, [
      { left: 38, top: 43, width: 118, height: 122 },
      { left: 0, top: 0, width: 0, height: 40 },
      { left: 2000, top: 50, width: 30, height: 30 },
      { left: -200, top: 50, width: 100, height: 30 },
    ]);
    expect(boxes).toEqual([{ x: 28, y: 23, w: 118, h: 122 }]);
    expect(stampOf(boxes)).toBe("28,23,118,122");
    expect(stampOf([])).toBe("");
  });
});

test.describe("a name that a box would cover", () => {
  const name = (x: number, y: number, w = 143, h = 22): Box => ({ x, y, w, h });

  test("stays where it is when no box is over it", () => {
    const box = name(400, 60);
    expect(slideClear(box, 470, [PLACARD, KEY], 1280)).toBe(box);
    expect(slideClear(box, 470, [], 1280)).toBe(box);
  });

  test("slides along its line to the edge of the box, with a little air, when the place it hangs from is clear of the box", () => {
    // The name of the house starts under the placard and its place is to the right of the placard.
    const moved = slideClear(name(100, 56), 172, [PLACARD], 1280);
    expect(moved).toEqual({ x: 149, y: 56, w: 143, h: 22 });
    // On the other side of a box it goes to the left edge of it.
    const wide: Box = { x: 600, y: 20, w: 300, h: 80 };
    expect(slideClear(name(840, 50), 911, [wide], 1280)?.x).toBe(600 + 300 + 3);
    expect(slideClear(name(520, 50), 591, [wide], 1280)?.x).toBe(600 - 143 - 3);
  });

  test("is left out when its place is under the box, or when there is no room in the view to slide to", () => {
    expect(slideClear(name(60, 56), 100, [PLACARD], 1280)).toBeNull();
    // The edge of the box would put it past the edge of the view.
    expect(slideClear(name(1100, 56), 1140, [{ x: 1090, y: 20, w: 150, h: 80 }], 1280)).toBeNull();
  });

  test("is not slid under another box: with two boxes side by side it goes beyond both or nowhere", () => {
    const second: Box = { x: 149, y: 23, w: 100, h: 122 };
    expect(slideClear(name(100, 56), 172, [PLACARD, second], 1280)).toBeNull();
    expect(slideClear(name(100, 56), 270, [PLACARD, second], 1280)?.x).toBe(252);
  });
});

test.describe("the tags over the heads and the boxes over the map", () => {
  const want = (id: string, x: number, y: number, w = 60, h = 18) => ({ id, x, y, w, h });

  test("slide off a box, and are left out when the head is under it", () => {
    const placard: Box = { x: 28, y: 23, w: 118, h: 122 };
    // The head is at 150, the tag would start at 120 and lie over the placard: it moves to the right of it.
    const slid = placeTags([want("a", 150, 100)], 1000, 600, [placard]).get("a");
    expect(slid).toEqual({ x: 149, y: 77, shown: true });
    // The head is under the placard.
    expect(placeTags([want("b", 80, 100)], 1000, 600, [placard]).get("b")?.shown).toBe(false);
    // With no box over the map nothing changes.
    expect(placeTags([want("a", 150, 100)], 1000, 600, []).get("a")).toEqual({ x: 120, y: 77, shown: true });
  });

  /** The box a tag takes, from its spot (the tags of these tests are 60 by 18). */
  const box = (spot: { x: number; y: number }): Box => ({ x: spot.x, y: spot.y, w: 60, h: 18 });
  const lies = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  test("keep apart where the heads are low in the view: the place a tag ends in is the place it was tried in", () => {
    // The view is 600 high and a tag 18: the lowest a tag can stand is 578. Two heads over each other at the foot of the view, 635 and 615, would put
    // their tags at 612 and 592 and then both at 578.
    const spots = placeTags([want("low", 300, 635), want("high", 300, 615)], 1000, 600);
    const low = spots.get("low");
    const high = spots.get("high");
    expect(low).toEqual({ x: 270, y: 578, shown: true });
    expect(high?.shown).toBe(true);
    expect(high?.y).toBeLessThan(578);
    expect(lies(box(low as Spot), box(high as Spot))).toBe(false);
    // Whatever the heads, a tag that is shown is inside the view and none lies over another.
    for (const heads of [[635, 615, 600], [639, 630, 622, 610], [700, 640, 590]]) {
      const all = placeTags(
        heads.map((y, i) => want(`t${i}`, 300 + (i % 2) * 20, y)),
        1000,
        600,
      );
      const shown = [...all.values()].filter((spot) => spot.shown);
      for (const spot of shown) {
        expect(spot.y).toBeGreaterThanOrEqual(4);
        expect(spot.y).toBeLessThanOrEqual(600 - 18 - 4);
      }
      for (const [i, a] of shown.entries()) for (const b of shown.slice(i + 1)) expect(lies(box(a), box(b)), `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(false);
    }
  });

  test("keep clear of a box at the foot of the view when the foot of the view moves them up", () => {
    // The head is under the foot of the box, so the tag over it is clear of the box where it hangs (612), and the foot of the view moves it up to 578,
    // into the box: it cannot slide off the box and keep its head under it, so it is left out. A tag away from the box stays where it was.
    const corner: Box = { x: 250, y: 560, w: 120, h: 40 };
    const spots = placeTags([want("a", 300, 635), want("b", 500, 635)], 1000, 600, [corner]);
    const a = spots.get("a");
    expect(a?.shown === true && lies(box(a), corner)).toBe(false);
    expect(a?.shown).toBe(false);
    expect(spots.get("b")).toEqual({ x: 470, y: 578, shown: true });
  });

  test("are pushed up off the name of a place, which keeps its place", () => {
    const name: Box = { x: 270, y: 177, w: 60, h: 18 };
    expect(placeTags([want("a", 300, 200)], 1000, 600, [], [name]).get("a")).toEqual({ x: 270, y: 157, shown: true });
    // A name that is not in the way changes nothing.
    expect(placeTags([want("a", 300, 200)], 1000, 600, [], [{ ...name, x: 600 }]).get("a")).toEqual({ x: 270, y: 177, shown: true });
  });
});
