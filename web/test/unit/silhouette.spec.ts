import { expect, test } from "@playwright/test";
import { alphaAtWorld, AlphaPlane, type FrameBox, type Pickable, pickFront, SOLID } from "../../src/page/map/pick.ts";
import { CELL_DEPTH } from "../../src/page/map/projection.ts";
import {
  type Box,
  boxesMeet,
  type Hidable,
  type Hiding,
  hides,
  isHidden,
  MIN_OVERLAP,
  OcclusionTracker,
  overlapSamples,
  SAMPLE_STEP,
  SORT_LIFT,
  SORT_SPREAD,
  silhouetteCovers,
  silhouettePickable,
  silhouetteSort,
  tightOf,
} from "../../src/page/map/silhouette.ts";

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1 });
const inside = (b: Box, x: number, y: number): boolean => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;

/** A person whose body is solid in `body` (the whole of the box they are in by default, wherever it moves), and who counts how often their pixels are asked for. */
function person(id: string, sort: number, at: Box, body?: Box): Hidable & { asked: number } {
  const p: Hidable & { asked: number } = {
    id,
    sort,
    x: (at.x0 + at.x1) / 2,
    y: at.y1,
    frame: 0,
    box: at,
    asked: 0,
    covers(wx: number, wy: number): boolean {
      p.asked++;
      return inside(body ?? p.box, wx, wy);
    },
  };
  return p;
}

/** A thing that hides people, solid in `body` (the whole of its box by default). */
function thing(id: string, sort: number, at: Box, body: Box = at): Hiding & { asked: number } {
  const h: Hiding & { asked: number } = {
    id,
    key: `${id}#0`,
    sort,
    box: at,
    asked: 0,
    covers(wx: number, wy: number): boolean {
      h.asked++;
      return inside(body, wx, wy);
    },
  };
  return h;
}

/** The pixels of a sprite as picking has them: a block of 4 by 4 at (2, 2) of an 8 by 8 frame, solid inside and soft (alpha 60) in the pixel round it. */
function frame(): FrameBox {
  const data = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) data[y * 8 + x] = x >= 2 && x < 6 && y >= 2 && y < 6 ? 255 : x >= 1 && x < 7 && y >= 1 && y < 7 ? 60 : 0;
  }
  return { plane: new AlphaPlane(8, 8, data), x: 0, y: 0, w: 8, h: 8, scale: 1 };
}

test.describe("who is hidden by what", () => {
  let house = thing("p_house", 300, box(100, 100, 300, 300));
  test.beforeEach(() => {
    house = thing("p_house", 300, box(100, 100, 300, 300));
  });

  test("is the person who is drawn before a thing and whose body is under its body", () => {
    expect(isHidden(person("back", 250, box(180, 200, 220, 250)), house)).toBe(true);
  });

  test("is not a person who is drawn after the thing, however much of them is over it: the one in front is not hidden", () => {
    const front = person("front", 310, box(180, 200, 220, 250));
    expect(hides(house, front)).toBe(false);
    expect(isHidden(front, house)).toBe(false);
    // Drawn at the same place in the order is not behind.
    expect(hides(house, person("same", 300, box(180, 200, 220, 250)))).toBe(false);
    expect(hides(house, person("just behind", 299.99, box(180, 200, 220, 250)))).toBe(true);
  });

  test("looks at the boxes first, and at no pixel of a person whose box does not meet the thing's", () => {
    const far = person("far", 250, box(400, 200, 440, 250));
    expect(boxesMeet(far.box, house.box)).toBe(false);
    expect(isHidden(far, house)).toBe(false);
    expect(far.asked + house.asked).toBe(0);
    // Boxes that only touch do not meet.
    expect(boxesMeet(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBe(false);
    expect(boxesMeet(box(0, 0, 10, 10), box(9.9, 0, 20, 10))).toBe(true);
  });

  test("is not a person whose box meets the thing's but whose body does not meet its body", () => {
    const ring = thing("ring", 300, box(100, 100, 300, 300), box(100, 100, 150, 300));
    expect(isHidden(person("beside", 250, box(180, 200, 220, 250)), ring)).toBe(false);
  });

  test("is a person who is under the body by at least MIN_OVERLAP samples of a grid, and not by fewer", () => {
    // A person who is one row of samples tall, and a thing whose body is `n` samples wide over that row.
    const row = (n: number) => isHidden(person("p", 5, box(0, 0, 20, 20), box(0, 0, 20, SAMPLE_STEP)), thing("t", 9, box(0, 0, 20, 20), box(0, 0, n * SAMPLE_STEP, 20)));
    expect(MIN_OVERLAP).toBeGreaterThan(1);
    expect(row(MIN_OVERLAP - 1)).toBe(false);
    expect(row(MIN_OVERLAP)).toBe(true);
    expect(row(MIN_OVERLAP + 4)).toBe(true);
    expect(overlapSamples(person("p", 5, box(0, 0, 20, 20), box(0, 0, 20, SAMPLE_STEP)), thing("t", 9, box(0, 0, 20, 20), box(0, 0, 4 * SAMPLE_STEP, 20)), 100)).toBe(4);
  });

  test("stops counting when it has enough", () => {
    const p = person("p", 5, box(0, 0, 40, 40));
    const t = thing("t", 9, box(0, 0, 40, 40));
    expect(isHidden(p, t)).toBe(true);
    // 20 by 20 samples are on the grid, and no more than MIN_OVERLAP of them were asked for.
    expect(p.asked).toBe(MIN_OVERLAP);
    expect(t.asked).toBe(MIN_OVERLAP);
  });

  test("counts the body of the picture and not the soft shadow baked under it: a sliver of shadow over the building hides nobody", () => {
    // Two 8 by 8 pictures of the same kind drawn at the same place: all of their bodies overlap. Moved by 4 pixels, the block of one meets the soft edge of the other.
    const picture = frame();
    const anchor = { x: 4, y: 7 };
    const bodyAt = (at: { x: number; y: number }) => (wx: number, wy: number): boolean => alphaAtWorld(picture, anchor, at, 1, wx, wy) >= SOLID;
    const make = (at: { x: number; y: number }): { box: Box; covers: (wx: number, wy: number) => boolean } => ({ box: box(at.x - 4, at.y - 7, at.x + 4, at.y + 1), covers: bodyAt(at) });
    const near = make({ x: 100, y: 100 });
    const same = make({ x: 100, y: 100 });
    const beside = make({ x: 105, y: 100 });
    const p = (c: { box: Box; covers: (wx: number, wy: number) => boolean }): Hidable => ({ id: "p", sort: 1, x: 0, y: 0, frame: 0, ...c });
    const t = (c: { box: Box; covers: (wx: number, wy: number) => boolean }): Hiding => ({ id: "t", key: "t#0", sort: 2, ...c });
    expect(isHidden(p(near), t(same))).toBe(true);
    // The solid blocks are 4 wide and 5 apart: no body is over a body, though the boxes and the soft pixels do meet.
    expect(boxesMeet(near.box, beside.box)).toBe(true);
    expect(isHidden(p(near), t(beside))).toBe(false);
  });
});

test.describe("where the body of a figure is in its frame", () => {
  test("is the smallest box of the solid pixels, and not the soft shadow round them", () => {
    // The frame has a block of 4 by 4 at (2, 2), solid, and a soft edge of 60 round it: the box is the block, from its first pixel to the one after its last.
    expect(tightOf({ id: "a", w: 8, h: 8 }, 0, frame())).toEqual({ u0: 2, v0: 2, u1: 6, v1: 6 });
  });

  test("is read at the scale of the atlas: a frame at 2x is a frame at 1x", () => {
    const data = new Uint8Array(16 * 16);
    for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) data[y * 16 + x] = 255;
    const twice: FrameBox = { plane: new AlphaPlane(16, 16, data), x: 0, y: 0, w: 16, h: 16, scale: 2 };
    expect(tightOf({ id: "b", w: 8, h: 8 }, 0, twice)).toEqual({ u0: 2, v0: 2, u1: 6, v1: 6 });
  });

  test("is the whole frame when nothing in it is solid, is found in a frame that is not at the corner of its page, and is kept for the next ask", () => {
    const bare: FrameBox = { plane: new AlphaPlane(8, 8, new Uint8Array(64)), x: 0, y: 0, w: 8, h: 8, scale: 1 };
    expect(tightOf({ id: "c", w: 8, h: 8 }, 0, bare)).toEqual({ u0: 0, v0: 0, u1: 8, v1: 8 });
    // A frame of 8 by 8 at (4, 4) of a page of 16 by 16, with a solid pixel at (3, 5) of the frame.
    const data = new Uint8Array(16 * 16);
    data[(4 + 5) * 16 + (4 + 3)] = 255;
    const moved: FrameBox = { plane: new AlphaPlane(16, 16, data), x: 4, y: 4, w: 8, h: 8, scale: 1 };
    const first = tightOf({ id: "d", w: 8, h: 8 }, 3, moved);
    expect(first).toEqual({ u0: 3, v0: 5, u1: 4, v1: 6 });
    expect(tightOf({ id: "d", w: 8, h: 8 }, 3, moved)).toBe(first);
    // Another frame of the same sprite, and the same frame at another scale, are asked about for themselves.
    expect(tightOf({ id: "d", w: 8, h: 8 }, 4, bare)).toEqual({ u0: 0, v0: 0, u1: 8, v1: 8 });
  });
});

test.describe("where the shape is drawn in the order of drawing", () => {
  test("is just over the thing that hides the person: over the lanterns at the door of a house (0.1 over it), under a walker on the deck of the bridge (0.25 over it)", () => {
    for (const hider of [300, 353.08, 428.92, 756.8]) {
      for (const personSort of [10, hider / 2, hider - 12.6, hider - 0.01]) {
        const sort = silhouetteSort(hider, personSort);
        expect(sort, `${hider} ${personSort}`).toBeGreaterThan(hider + 0.1);
        expect(sort, `${hider} ${personSort}`).toBeLessThan(hider + 0.25);
      }
    }
    expect(SORT_LIFT).toBeGreaterThan(0.1);
    expect(SORT_LIFT + SORT_SPREAD).toBeLessThan(0.25);
  });

  test("is under everybody who stands in front of the thing, who is half a cell or more from its south edge", () => {
    const south = 353.08;
    for (const personSort of [10, 200, south - 0.5, south - 12.6]) {
      expect(silhouetteSort(south, personSort)).toBeLessThan(south + CELL_DEPTH / 2);
    }
  });

  test("puts the shape of the nearer of two people behind the same thing over the other's", () => {
    expect(silhouetteSort(353.08, 340)).toBeGreaterThan(silhouetteSort(353.08, 250));
    expect(silhouetteSort(353.08, 250)).toBeGreaterThan(silhouetteSort(353.08, 100));
  });

  test("is over the thing in the order even when it is drawn at 0 or below it", () => {
    expect(silhouetteSort(0, 5)).toBeGreaterThan(0);
    expect(silhouetteSort(-10, 5)).toBeGreaterThan(-10);
  });
});

test.describe("where the pointer is on the shape", () => {
  let house = thing("p_house", 300, box(100, 100, 300, 300));
  let back = person("back", 250, box(180, 180, 220, 230));
  test.beforeEach(() => {
    house = thing("p_house", 300, box(100, 100, 300, 300));
    back = person("back", 250, box(180, 180, 220, 230));
  });

  test("is on the body of the person and on the body of the thing over them, and nowhere else", () => {
    // The thing has a hole at (160..170, 190..200) where the sky shows through it.
    const holed: Hiding = { ...house, covers: (wx, wy) => house.covers(wx, wy) && !(wx >= 160 && wx < 170 && wy >= 190 && wy < 200) };
    const shape = silhouettePickable(back, holed);
    expect(shape.kind).toBe("person");
    expect(shape.id).toBe("back");
    expect(shape.covers(200, 200, 0)).toBe(true);
    // On the person but not on the thing: the person's head over the roof line, where the thing has no body.
    const low = thing("low", 300, box(100, 210, 300, 300));
    expect(silhouetteCovers(back, low, 200, 190)).toBe(false);
    expect(silhouetteCovers(back, low, 200, 220)).toBe(true);
    // On the thing but not on the person.
    expect(shape.covers(250, 200, 0)).toBe(false);
    // Outside both.
    expect(shape.covers(50, 50, 0)).toBe(false);
    // On the person, where the thing has a hole.
    const holedBack = person("holed", 250, box(150, 180, 180, 230));
    expect(silhouettePickable(holedBack, holed).covers(165, 195, 0)).toBe(false);
    expect(silhouettePickable(holedBack, holed).covers(155, 195, 0)).toBe(true);
  });

  test("gives its edge no slack: a point a few pixels off the shape is not on it, however much the pointer is allowed", () => {
    const shape = silhouettePickable(back, house);
    expect(shape.covers(178, 200, 0)).toBe(false);
    expect(shape.covers(178, 200, 6)).toBe(false);
    expect(shape.covers(178, 200, 14)).toBe(false);
    expect(shape.covers(180, 200, 14)).toBe(true);
  });

  test("is in the order of drawing where the shape is: over the thing, under the people in front of it", () => {
    const shape = silhouettePickable(back, house);
    expect(shape.sort).toBe(silhouetteSort(house.sort, back.sort));
    expect(shape.sort).toBeGreaterThan(house.sort);
  });

  /** What the pointer finds in a town of one house, with the people behind it and in front of it. */
  const town = (people: Hidable[]): Pickable[] => {
    const items: Pickable[] = [];
    items.push({ kind: "place", id: house.id, sort: house.sort, covers: (wx, wy) => house.covers(wx, wy) });
    for (const p of people) {
      items.push({ kind: "person", id: p.id, sort: p.sort, covers: (wx, wy, slack) => p.covers(wx, wy) || (wx >= p.box.x0 - slack && wx < p.box.x1 + slack && wy >= p.box.y1 - 4 - slack && wy < p.box.y1 + slack) });
      for (const hider of [house]) if (isHidden(p, hider)) items.push(silhouettePickable(p, hider));
    }
    return items;
  };

  test("finds the person where the shape is, and the building elsewhere on its body, and the nearest of them as before", () => {
    const front = person("front", 320, box(185, 260, 215, 310));
    const items = town([back, front]);
    // Where the shape of the person behind is: the person, and not the building that hides them.
    expect(pickFront(items, 200, 200, 0)).toMatchObject({ kind: "person", id: "back" });
    // On the building where there is no shape: the building.
    expect(pickFront(items, 250, 200, 0)).toMatchObject({ kind: "place", id: "p_house" });
    expect(pickFront(items, 200, 150, 0)).toMatchObject({ kind: "place", id: "p_house" });
    // The one in front of the building is picked where he is, whatever is behind.
    expect(pickFront(items, 200, 280, 0)).toMatchObject({ kind: "person", id: "front" });
    // A person in front, over the shape of the person behind, is picked and not the shape.
    const over = town([back, person("over", 320, box(185, 190, 215, 240))]);
    expect(pickFront(over, 200, 200, 0)).toMatchObject({ kind: "person", id: "over" });
    // Nobody and nothing on bare ground.
    expect(pickFront(items, 20, 20, 0)).toBeNull();
  });

  test("leaves a person who is not hidden with what they had: their own body, and nothing over the building", () => {
    const items = town([person("front", 320, box(185, 260, 215, 310))]);
    expect(items.map((i) => i.id)).toEqual(["p_house", "front"]);
    // He stands in front, and the building is not picked where he is not.
    expect(pickFront(items, 200, 200, 0)).toMatchObject({ kind: "place", id: "p_house" });
  });

  test("finds the nearer of two people who are hidden at the same point, as the shapes are drawn", () => {
    const farther = person("farther", 240, box(180, 180, 220, 230));
    const nearer = person("nearer", 260, box(180, 180, 220, 230));
    const items = town([farther, nearer]);
    expect(pickFront(items, 200, 200, 0)).toMatchObject({ id: "nearer" });
    expect(pickFront(town([nearer, farther]), 200, 200, 0)).toMatchObject({ id: "nearer" });
  });

  test("is the person with the id of the manager for the manager, whose shape is drawn the same and who is held to the rules of the page", () => {
    const manager = person("player", 250.5, box(180, 180, 220, 230));
    expect(isHidden(manager, house)).toBe(true);
    expect(silhouettePickable(manager, house)).toMatchObject({ kind: "person", id: "player" });
    // Drawn over the others who stand on the same line: half a pixel after them.
    expect(hides(house, manager)).toBe(true);
    expect(silhouetteSort(house.sort, manager.sort)).toBeGreaterThan(silhouetteSort(house.sort, back.sort));
  });
});

test.describe("who is looked at again", () => {
  let house = thing("p_house", 300, box(100, 100, 300, 300));
  let wall = thing("p_wall", 280, box(100, 100, 300, 300));
  test.beforeEach(() => {
    house = thing("p_house", 300, box(100, 100, 300, 300));
    wall = thing("p_wall", 280, box(100, 100, 300, 300));
  });

  /** Moves a person: the tracker reads where the feet are and which frame is drawn, and the box goes with them. */
  const move = (p: Hidable, dx: number, dy: number): void => {
    p.x += dx;
    p.y += dy;
    p.box = box(p.box.x0 + dx, p.box.y0 + dy, p.box.x1 + dx, p.box.y1 + dy);
  };

  test("is nobody before the pixels are at hand, and the people who are hidden once they are", () => {
    const back = person("back", 250, box(180, 180, 220, 230));
    const tracker = new OcclusionTracker();
    expect(tracker.update([back], [house], 1, false)).toBe(false);
    expect(tracker.pairs).toEqual([]);
    expect(back.asked).toBe(0);
    expect(tracker.update([back], [house], 1, true)).toBe(true);
    expect(tracker.pairs).toEqual([{ person: back, hider: house }]);
  });

  test("is a person who has moved, or has another frame, and nobody else; the others keep what they had", () => {
    const back = person("back", 250, box(180, 180, 220, 230));
    const free = person("free", 250, box(600, 180, 640, 230));
    const tracker = new OcclusionTracker();
    expect(tracker.update([back, free], [house], 1, true)).toBe(true);
    const asked = () => back.asked + house.asked;
    const before = asked();
    // Nothing changed: nothing is looked at, and nothing is new.
    expect(tracker.update([back, free], [house], 1, true)).toBe(false);
    expect(asked()).toBe(before);
    // The other one moves, and does not meet anything: the first is not looked at.
    move(free, 1, 0);
    expect(tracker.update([back, free], [house], 1, true)).toBe(false);
    expect(asked()).toBe(before);
    // He moves himself, a little, and stays behind the house: looked at, and the same pair.
    move(back, 3, 0);
    expect(tracker.update([back, free], [house], 1, true)).toBe(false);
    expect(asked()).toBeGreaterThan(before);
    expect(tracker.pairs).toHaveLength(1);
    // Another frame of the same picture is looked at, too.
    const mid = asked();
    back.frame = 1;
    tracker.update([back, free], [house], 1, true);
    expect(asked()).toBeGreaterThan(mid);
  });

  test("lets the shape go at once when the person walks out from behind the thing, and brings it back when they return", () => {
    const back = person("back", 250, box(180, 180, 220, 230));
    const tracker = new OcclusionTracker();
    tracker.update([back], [house], 1, true);
    expect(tracker.pairs).toHaveLength(1);
    // Out to the right of the house, in one step.
    move(back, 200, 0);
    expect(tracker.update([back], [house], 1, true)).toBe(true);
    expect(tracker.pairs).toEqual([]);
    move(back, -200, 0);
    expect(tracker.update([back], [house], 1, true)).toBe(true);
    expect(tracker.pairs).toHaveLength(1);
    // Past the south edge of the house, into the front of it: it is drawn after the house, and hides nobody.
    back.sort = 301;
    expect(tracker.update([back], [house], 1, true)).toBe(true);
    expect(tracker.pairs).toEqual([]);
  });

  test("looks at everybody again when the things that hide have changed", () => {
    const back = person("back", 250, box(180, 180, 220, 230));
    const free = person("free", 250, box(600, 180, 640, 230));
    const tracker = new OcclusionTracker();
    tracker.update([back, free], [house], 1, true);
    const before = house.asked;
    // The same list under the same stamp is not looked at.
    tracker.update([back, free], [house], 1, true);
    expect(house.asked).toBe(before);
    // Another thing (the bridge is mended, a willow is gone) under another stamp is, and the pair that was has a new thing in it.
    const mended = thing("p_house", 300, box(100, 100, 300, 300));
    expect(tracker.update([back, free], [mended], 2, true)).toBe(true);
    expect(tracker.pairs).toEqual([{ person: back, hider: mended }]);
  });

  test("has a person who is hidden by more than one thing in more than one pair, in the order of the things", () => {
    const back = person("back", 250, box(180, 180, 220, 230));
    const tracker = new OcclusionTracker();
    tracker.update([back], [house, wall], 1, true);
    expect(tracker.pairs.map((p) => p.hider.id)).toEqual(["p_house", "p_wall"]);
    // A thing that is drawn before the person is not among them.
    const behind = thing("p_behind", 200, box(100, 100, 300, 300));
    tracker.update([back], [house, behind, wall], 2, true);
    expect(tracker.pairs.map((p) => p.hider.id)).toEqual(["p_house", "p_wall"]);
  });

  test("forgets the people who are gone, and the shapes of two people stay in the order of the people", () => {
    const a = person("a", 250, box(180, 180, 220, 230));
    const b = person("b", 240, box(120, 180, 160, 230));
    const tracker = new OcclusionTracker();
    tracker.update([a, b], [house], 1, true);
    expect(tracker.pairs.map((p) => p.person.id)).toEqual(["a", "b"]);
    expect(tracker.update([a], [house], 1, true)).toBe(true);
    expect(tracker.pairs.map((p) => p.person.id)).toEqual(["a"]);
    // The one who left is not hidden for good: when he is made again he is looked at.
    expect(tracker.update([a, b], [house], 1, true)).toBe(true);
    expect(tracker.pairs.map((p) => p.person.id)).toEqual(["a", "b"]);
    // Nobody left: nothing, and no thing is asked.
    const before = house.asked;
    expect(tracker.update([], [house], 1, true)).toBe(true);
    expect(tracker.pairs).toEqual([]);
    expect(house.asked).toBe(before);
  });

  test("does nothing for a map where nobody is hidden: no pixel is asked for, over any number of steps", () => {
    const people = Array.from({ length: 20 }, (_, i) => person(`p${i}`, 250, box(500 + 40 * i, 180, 530 + 40 * i, 230)));
    const tracker = new OcclusionTracker();
    tracker.update(people, [house, wall], 1, true);
    const asked = (): number => people.reduce((sum, p) => sum + p.asked, house.asked + wall.asked);
    expect(asked()).toBe(0);
    for (let step = 0; step < 50; step++) {
      for (const p of people) move(p, 1, 0);
      expect(tracker.update(people, [house, wall], 1, true)).toBe(false);
    }
    expect(asked()).toBe(0);
    expect(tracker.pairs).toEqual([]);
  });
});
