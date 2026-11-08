import { expect, test } from "@playwright/test";
import { type Point, stitchPath, stitchPoints } from "../../src/page/ui/stitch.ts";

/** The distance of a point from the line through two points, measured at right angles to it. */
function fromLine(p: Point, a: Point, b: Point): number {
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y);
}

// the cloth of a bookmark in each of its two sizes, closed and open, with the V and the stitch that the style sheet gives it
const CLOTHS = [
  { name: "closed", width: 46, height: 112, cut: 14, sew: 4 },
  { name: "open", width: 64, height: 112, cut: 14, sew: 4 },
];

for (const cloth of CLOTHS) {
  test.describe(`the stitch of a bookmark, ${cloth.name}`, () => {
    const { width, height, cut, sew } = cloth;
    const points = stitchPoints(width, height, cut, sew);
    // the outline of the cloth: the left foot corner, the point of the V and the right foot corner are the edges of the V
    const left = { x: 0, y: height };
    const apex = { x: width / 2, y: height - cut };
    const right = { x: width, y: height };

    test("has five corners: the two on the left and the two on the right of the sides, and the point of the V", () => {
      expect(points).toHaveLength(5);
      const [footLeft, topLeft, topRight, footRight, point] = points as [Point, Point, Point, Point, Point];
      expect(topLeft).toEqual({ x: sew, y: sew });
      expect(topRight).toEqual({ x: width - sew, y: sew });
      expect(footLeft.x).toBe(sew);
      expect(footRight.x).toBe(width - sew);
      expect(footLeft.y).toBeCloseTo(footRight.y, 9);
      expect(point.x).toBeCloseTo(width / 2, 9);
    });

    test("runs `sew` inside the sides and the top, and `sew` inside both edges of the V, measured at right angles", () => {
      const [footLeft, , , footRight, point] = points as [Point, Point, Point, Point, Point];
      // each of the three corners on the V is `sew` from the edge of the V it lies by (the point of the V is by both)
      expect(fromLine(footLeft, left, apex)).toBeCloseTo(sew, 9);
      expect(fromLine(footRight, apex, right)).toBeCloseTo(sew, 9);
      expect(fromLine(point, left, apex)).toBeCloseTo(sew, 9);
      expect(fromLine(point, apex, right)).toBeCloseTo(sew, 9);
      // and the line between two corners on one edge of the V is as far from that edge all along
      expect(fromLine(footLeft, left, apex)).toBeCloseTo(fromLine(point, left, apex), 9);
      expect(fromLine(footRight, apex, right)).toBeCloseTo(fromLine(point, apex, right), 9);
    });

    test("lies on the cloth, above the V and in from every edge of it", () => {
      for (const p of points) {
        expect(p.x).toBeGreaterThanOrEqual(sew - 1e-9);
        expect(p.x).toBeLessThanOrEqual(width - sew + 1e-9);
        expect(p.y).toBeGreaterThanOrEqual(sew - 1e-9);
        // above the edges of the V: the edge is at its own height at that place, and the stitch is higher than it by more than `sew`
        const edge = p.x <= width / 2 ? height - (cut * p.x) / (width / 2) : height - (cut * (width - p.x)) / (width / 2);
        expect(edge - p.y).toBeGreaterThanOrEqual(sew - 1e-9);
      }
    });

    test("is the same as the path that the page draws, with five corners and a close", () => {
      const d = stitchPath(width, height, cut, sew);
      expect(d).toMatch(/^M[\d.]+ [\d.]+(L[\d.]+ [\d.]+){4}Z$/);
      const numbers = (d.match(/[\d.]+/g) ?? []).map(Number);
      expect(numbers).toHaveLength(10);
      points.forEach((p, i) => {
        expect(numbers[2 * i]).toBeCloseTo(p.x, 2);
        expect(numbers[2 * i + 1]).toBeCloseTo(p.y, 2);
      });
    });
  });
}
