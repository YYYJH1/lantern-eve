import { expect, test } from "@playwright/test";
import { CELL, CELL_DEPTH, cellAtWorld, cellCentre, cellToWorld, DEPTH_RATIO, deckLift, groundDistance, HEIGHT_PX, worldToCell } from "../../src/page/map/projection.ts";

test.describe("the projection of the map", () => {
  test("is the camera of the sprite kit: a cell is 32 by 25.22 pixels and a unit of height lifts 34.48", () => {
    expect(CELL).toBe(32);
    expect(CELL_DEPTH).toBe(25.22);
    expect(HEIGHT_PX).toBe(34.48);
    // The depth is the width times the sine of 52 degrees, to the hundredth the kit gives.
    expect(CELL * Math.sin((52 * Math.PI) / 180)).toBeCloseTo(CELL_DEPTH, 2);
    expect(DEPTH_RATIO).toBeCloseTo(0.7881, 4);
  });

  test("puts a cell at x * 32 and y * 25.22 and the middle of it half a cell on", () => {
    expect(cellToWorld(0, 0)).toEqual({ x: 0, y: 0 });
    expect(cellToWorld(3, 2)).toEqual({ x: 96, y: 50.44 });
    expect(cellCentre(3, 2)).toEqual({ x: 112, y: 63.05 });
    // A footprint is cols * 32 wide and rows * 25.22 deep.
    expect(cellToWorld(7, 4).x - cellToWorld(0, 0).x).toBe(7 * 32);
    expect(cellToWorld(0, 4).y - cellToWorld(0, 0).y).toBeCloseTo(4 * 25.22, 10);
  });

  test("maps a point back to the cell it came from: the round trip is exact", () => {
    for (let gx = -3; gx <= 60; gx += 1.25) {
      for (let gy = -3; gy <= 40; gy += 0.75) {
        const w = cellToWorld(gx, gy);
        const back = worldToCell(w.x, w.y);
        expect(back.x).toBeCloseTo(gx, 9);
        expect(back.y).toBeCloseTo(gy, 9);
      }
    }
  });

  test("finds the cell under any point of a cell, and the next cell over the edge", () => {
    for (const [cx, cy] of [
      [0, 0],
      [5, 9],
      [55, 33],
    ] as const) {
      const c = cellToWorld(cx, cy);
      // The four corners (just inside) and the middle are in the cell, a hair outside is in the next.
      for (const [dx, dy] of [
        [0.001, 0.001],
        [31.999, 0.001],
        [0.001, 25.219],
        [31.999, 25.219],
        [16, 12.6],
      ] as const) {
        expect(cellAtWorld(c.x + dx, c.y + dy)).toEqual({ x: cx, y: cy });
      }
      expect(cellAtWorld(c.x + CELL + 0.001, c.y + 5)).toEqual({ x: cx + 1, y: cy });
      expect(cellAtWorld(c.x + 5, c.y + CELL_DEPTH + 0.001)).toEqual({ x: cx, y: cy + 1 });
      expect(cellAtWorld(c.x - 0.001, c.y + 5)).toEqual({ x: cx - 1, y: cy });
    }
    // The middle of a cell is not a cell above: a step down is 25.22 pixels, not 32.
    expect(cellAtWorld(10, 30)).toEqual({ x: 0, y: 1 });
  });

  test("measures a walk along the ground by what the screen shows", () => {
    expect(groundDistance(1, 0)).toBe(32);
    expect(groundDistance(0, 1)).toBe(25.22);
    expect(groundDistance(3, 4)).toBeCloseTo(Math.hypot(96, 100.88), 10);
  });
});

test.describe("the lift of a walker on the bridge", () => {
  // The kit's samples: thirteen, half a cell apart, over a span of six cells.
  const LIFTS = [0, 3.5, 11.7, 21.5, 29.6, 32.8, 32.8, 32.8, 29.6, 21.5, 11.7, 3.5, 0];

  test("is the sample where the walker is, and a straight line between two samples", () => {
    expect(deckLift(LIFTS, 6, 0)).toBe(0);
    expect(deckLift(LIFTS, 6, 0.5)).toBeCloseTo(3.5, 10);
    expect(deckLift(LIFTS, 6, 3)).toBeCloseTo(32.8, 10);
    expect(deckLift(LIFTS, 6, 6)).toBe(0);
    // A quarter of a cell is half way between the first two samples, and so on.
    expect(deckLift(LIFTS, 6, 0.25)).toBeCloseTo(1.75, 10);
    expect(deckLift(LIFTS, 6, 1.25)).toBeCloseTo((11.7 + 21.5) / 2, 10);
  });

  test("is the same from the east end as from the west end, and highest in the middle", () => {
    for (let a = 0; a <= 3; a += 0.17) expect(deckLift(LIFTS, 6, a)).toBeCloseTo(deckLift(LIFTS, 6, 6 - a), 9);
    const middle = deckLift(LIFTS, 6, 3);
    for (let a = 0; a <= 6; a += 0.1) expect(deckLift(LIFTS, 6, a)).toBeLessThanOrEqual(middle + 1e-9);
  });

  test("is nothing off the deck, or without samples", () => {
    expect(deckLift(LIFTS, 6, -0.1)).toBe(0);
    expect(deckLift(LIFTS, 6, 6.1)).toBe(0);
    expect(deckLift([], 6, 3)).toBe(0);
    expect(deckLift([5], 6, 3)).toBe(0);
    expect(deckLift(LIFTS, 0, 0)).toBe(0);
  });

  test("scales with the span, so that a bridge of another length is lifted the same way", () => {
    expect(deckLift(LIFTS, 3, 1.5)).toBeCloseTo(deckLift(LIFTS, 6, 3), 10);
    expect(deckLift(LIFTS, 12, 6)).toBeCloseTo(deckLift(LIFTS, 6, 3), 10);
  });
});
