import { expect, test } from "@playwright/test";
import { pickScale } from "../../src/page/map/manifest.ts";

// Which atlas the map is drawn from: the 2x one on a screen of a high pixel ratio, and the 1x one below.

const SCALES = [1, 2];

test.describe("the atlas that the map is drawn from", () => {
  test("is the 2x atlas on a screen of pixel ratio 1.5 or more, and the 1x atlas below", () => {
    expect([1, 1.25].map((ratio) => pickScale(SCALES, ratio))).toEqual([1, 1]);
    expect([1.5, 1.75, 2].map((ratio) => pickScale(SCALES, ratio))).toEqual([2, 2, 2]);
  });

  test("a manifest with one atlas is drawn from the one it has, at any ratio", () => {
    expect(pickScale([2], 1)).toBe(2);
    expect(pickScale([1], 3)).toBe(1);
  });
});
