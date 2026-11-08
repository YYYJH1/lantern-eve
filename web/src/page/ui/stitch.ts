/**
 * The stitch round the inside of the cloth of a bookmark: a closed line `sew` pixels inside the outline of the cloth everywhere (measured at right angles to
 * each edge), which goes down the left side, across the top, down the right side and along both edges of the V that is cut into the foot.
 *
 * The cloth is `width` by `height` with a V of depth `cut` in its foot: its corners are (0, 0), (width, 0), (width, height), (width / 2, height - cut) and
 * (0, height). The stitch has the same five corners moved in: the two top corners by `sew` from both of their edges, the two foot corners where the line
 * `sew` inside a side meets the line `sew` inside an edge of the V, and the point of the V where the lines inside its two edges meet.
 */
export interface Point {
  x: number;
  y: number;
}

export function stitchPoints(width: number, height: number, cut: number, sew: number): Point[] {
  const half = width / 2;
  // An edge of the V runs from a foot corner to the point of the V, (half, -cut) long. The line `sew` inside it (up and to the side that the cloth is on)
  // is the edge moved by `sew` along its unit normal (-cut, -half) / edge.
  const edge = Math.hypot(half, cut);
  const lift = (sew * half) / edge;
  const along = (sew * cut) / edge;
  const heightAt = (x: number): number => height - lift - (cut * (x + along)) / half;
  return [
    { x: sew, y: heightAt(sew) },
    { x: sew, y: sew },
    { x: width - sew, y: sew },
    { x: width - sew, y: heightAt(sew) },
    { x: half, y: heightAt(half) },
  ];
}

/** The same corners as the path of an SVG: a closed line with five corners. */
export function stitchPath(width: number, height: number, cut: number, sew: number): string {
  const round = (n: number): string => String(Math.round(n * 100) / 100);
  const points = stitchPoints(width, height, cut, sew);
  return `${points.map((p, i) => `${i === 0 ? "M" : "L"}${round(p.x)} ${round(p.y)}`).join("")}Z`;
}
