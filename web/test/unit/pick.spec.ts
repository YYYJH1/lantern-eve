import { expect, test } from "@playwright/test";
import { alphaAtWorld, alphaOf, AlphaPlane, type FrameBox, type Pickable, pickFront, SOLID } from "../../src/page/map/pick.ts";
import { CELL, CELL_DEPTH, cellAtWorld, cellToWorld } from "../../src/page/map/projection.ts";

/** A plane of 8 by 8 pixels with a solid block of 4 by 4 at (2, 2) and a soft edge of alpha 60 round it. */
function plane(scale: number): AlphaPlane {
  const size = 8 * scale;
  const data = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = x >= 2 * scale && x < 6 * scale && y >= 2 * scale && y < 6 * scale;
      const soft = x >= 1 * scale && x < 7 * scale && y >= 1 * scale && y < 7 * scale;
      data[y * size + x] = inside ? 255 : soft ? 60 : 0;
    }
  }
  return new AlphaPlane(size, size, data);
}

test.describe("the pixels of a sprite", () => {
  test("take the alpha channel of an RGBA image", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 40, 50, 60, 70, 255, 0, 0, 0, 0, 1, 2, 3, 128]);
    const p = alphaOf(rgba, 2, 2);
    expect([p.at(0, 0), p.at(1, 0), p.at(0, 1), p.at(1, 1)]).toEqual([40, 255, 0, 128]);
  });

  test("are zero outside the picture, and a fraction of a pixel is the pixel it is in", () => {
    const p = plane(1);
    expect(p.at(-1, 3)).toBe(0);
    expect(p.at(3, -0.5)).toBe(0);
    expect(p.at(8, 3)).toBe(0);
    expect(p.at(3, 8)).toBe(0);
    expect(p.at(3.9, 3.9)).toBe(255);
    expect(p.at(1.99, 3)).toBe(60);
  });

  test("are looked up at the point of the world, through the anchor and the size of the sprite", () => {
    // A frame of 8 by 8 pixels with the anchor at (4, 7): the feet, low in the frame. Drawn with the anchor at (100, 200).
    const frame: FrameBox = { plane: plane(1), x: 0, y: 0, w: 8, h: 8, scale: 1 };
    const anchor = { x: 4, y: 7 };
    const at = { x: 100, y: 200 };
    // The anchor is the pixel (4, 7), which is the soft edge: solid pixels are 2..5 across and 2..5 down, which is 2..-3 from the anchor.
    expect(alphaAtWorld(frame, anchor, at, 1, 100, 200)).toBe(0);
    expect(alphaAtWorld(frame, anchor, at, 1, 100, 196)).toBe(255);
    expect(alphaAtWorld(frame, anchor, at, 1, 98, 196)).toBe(255);
    expect(alphaAtWorld(frame, anchor, at, 1, 101.9, 197.1)).toBe(255);
    // The soft edge is the pixel before the block: 97.5 is a pixel and a half to the left of the block.
    expect(alphaAtWorld(frame, anchor, at, 1, 97.5, 197)).toBe(60);
    expect(alphaAtWorld(frame, anchor, at, 1, 96.5, 197)).toBe(0);
    // Outside the frame is nothing, to every side.
    expect(alphaAtWorld(frame, anchor, at, 1, 95.9, 196)).toBe(0);
    expect(alphaAtWorld(frame, anchor, at, 1, 100, 192.9)).toBe(0);
    expect(alphaAtWorld(frame, anchor, at, 1, 104.1, 196)).toBe(0);
    expect(alphaAtWorld(frame, anchor, at, 1, 100, 201.1)).toBe(0);
    // A sprite that is drawn twice as big has its pixels twice as far from the anchor.
    expect(alphaAtWorld(frame, anchor, at, 2, 100, 192)).toBe(255);
    expect(alphaAtWorld(frame, anchor, at, 2, 100, 196.5)).toBe(255);
    expect(alphaAtWorld(frame, anchor, at, 2, 100 + 3.5, 196)).toBe(255);
    expect(alphaAtWorld(frame, anchor, at, 2, 100 + 5, 196)).toBe(60);
    expect(alphaAtWorld(frame, anchor, at, 2, 100 + 9, 196)).toBe(0);
  });

  test("are the same at the 2x atlas as at the 1x: the frame is read at twice the pixels, the sprite stays its size", () => {
    const one: FrameBox = { plane: plane(1), x: 0, y: 0, w: 8, h: 8, scale: 1 };
    const two: FrameBox = { plane: plane(2), x: 0, y: 0, w: 16, h: 16, scale: 2 };
    const anchor = { x: 4, y: 7 };
    const at = { x: 50, y: 50 };
    for (let wx = 44; wx <= 56; wx += 0.25) {
      for (let wy = 40; wy <= 58; wy += 0.25) {
        expect(alphaAtWorld(two, anchor, at, 1, wx, wy), `${wx},${wy}`).toBe(alphaAtWorld(one, anchor, at, 1, wx, wy));
      }
    }
  });

  test("count as the body from 128 up and not the soft shadow", () => {
    expect(SOLID).toBe(128);
    const frame: FrameBox = { plane: plane(1), x: 0, y: 0, w: 8, h: 8, scale: 1 };
    expect(alphaAtWorld(frame, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 1.5, 1.5)).toBeLessThan(SOLID);
    expect(alphaAtWorld(frame, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 3, 3)).toBeGreaterThanOrEqual(SOLID);
  });

  test("are found in the frame of an atlas that has others beside it", () => {
    const big = new AlphaPlane(20, 10, new Uint8Array(200));
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) big.data[y * 20 + 10 + x] = plane(1).at(x, y);
    const frame: FrameBox = { plane: big, x: 10, y: 0, w: 8, h: 8, scale: 1 };
    expect(alphaAtWorld(frame, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 3, 3)).toBe(255);
    expect(alphaAtWorld(frame, { x: 0, y: 0 }, { x: 0, y: 0 }, 1, 8.5, 3)).toBe(0);
  });
});

/** A thing that is under the pointer in a box of the world. */
const thing = (kind: "person" | "place", id: string, sort: number, box: [number, number, number, number]): Pickable => ({
  kind,
  id,
  sort,
  covers: (wx, wy, slack) => wx >= box[0] - slack && wx <= box[2] + slack && wy >= box[1] - slack && wy <= box[3] + slack,
});

test.describe("what is under the pointer", () => {
  // A house whose roof covers the cells behind it, and a person who stands in front of it and one who stands behind it.
  const house = thing("place", "p_house", 300, [100, 100, 300, 300]);
  const before = thing("person", "front", 310, [180, 250, 220, 330]);
  const behind = thing("person", "back", 280, [180, 180, 220, 220]);

  test("is the nearest thing by the order of drawing: a person in front of a building, and the building over a person behind it", () => {
    const all = [house, before, behind];
    expect(pickFront(all, 200, 280, 0)?.id).toBe("front");
    expect(pickFront(all, 200, 200, 0)?.id).toBe("p_house");
    // The order of the list does not matter, the order of drawing does.
    expect(pickFront([behind, house, before], 200, 200, 0)?.id).toBe("p_house");
    expect(pickFront([before, behind, house], 200, 280, 0)?.id).toBe("front");
    expect(pickFront(all, 120, 120, 0)).toMatchObject({ kind: "place", id: "p_house" });
  });

  test("is nothing on bare ground, and a thing is picked a little off its edge only by the slack", () => {
    const all = [house, before, behind];
    expect(pickFront(all, 50, 50, 0)).toBeNull();
    expect(pickFront(all, 320, 200, 0)).toBeNull();
    expect(pickFront(all, 305, 200, 0)).toBeNull();
    expect(pickFront(all, 305, 200, 6)?.id).toBe("p_house");
    expect(pickFront([], 0, 0, 10)).toBeNull();
  });

  test("takes the later of two things that are drawn at the same place", () => {
    const a = thing("person", "a", 5, [0, 0, 10, 10]);
    const b = thing("person", "b", 5, [0, 0, 10, 10]);
    expect(pickFront([a, b], 5, 5, 0)?.id).toBe("b");
    expect(pickFront([b, a], 5, 5, 0)?.id).toBe("a");
  });
});

test.describe("the inverse mapping of the pointer", () => {
  test("gives back the cell that a click on the middle of a cell of the ground was made on, for every cell of the town", () => {
    for (let cy = 0; cy < 34; cy++) {
      for (let cx = 0; cx < 56; cx++) {
        const middle = cellToWorld(cx + 0.5, cy + 0.5);
        expect(cellAtWorld(middle.x, middle.y)).toEqual({ x: cx, y: cy });
      }
    }
    // The cell behind a tall building, 100 pixels above its front, is a cell further up the map: a step of 25.22, not 32.
    const front = cellToWorld(33, 14);
    expect(cellAtWorld(front.x + CELL / 2, front.y - 100)).toEqual({ x: 33, y: 14 - Math.ceil(100 / CELL_DEPTH) });
  });
});
