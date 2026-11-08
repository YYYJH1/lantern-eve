/**
 * The ground of the town, drawn as flat vector shapes from the terrain rows of the scene: grass,
 * bluestone streets, lanes, gravel, pier planks, the stone bridge and the river with its banks.
 * Nothing here is an image. The painters run once per scene.
 *
 * The ground painters (`paintBackdrop`, `paintGround`, `paintPlainBlocks`) draw a flat plan in
 * which a cell is 32 by 32, and the map puts them in a container that is squashed to the depth
 * of a cell on the screen, as a ground plane seen from above at an angle is. What stands up out
 * of the ground (trees, the pile of junk) is drawn here in the pixels of the screen, with its foot
 * where its cell is.
 */
import { Graphics } from "pixi.js";
import { type Scene, terrainAt } from "../scene.ts";
import { CELL, CELL_DEPTH } from "./geometry.ts";
import { noise, PAL } from "./palette.ts";
import { cellsOf, treeCells } from "./town.ts";

export { cellsOf };

/** How far the backdrop reaches beyond the map, in cells. */
const REACH = 60;
const SHORE = 6;

type Run = { id: string; x: number; y: number; length: number };

/** The rows of the scene as runs of one terrain, to keep the number of shapes small. */
function runs(scene: Scene): Run[] {
  const out: Run[] = [];
  for (let y = 0; y < scene.height; y++) {
    let x = 0;
    while (x < scene.width) {
      const id = terrainAt(scene, x, y);
      let end = x + 1;
      while (end < scene.width && terrainAt(scene, end, y) === id) end++;
      if (id !== null) out.push({ id, x, y, length: end - x });
      x = end;
    }
  }
  return out;
}

/** What lies round the map, far past its edges, so that the night tint covers it too. */
export function paintBackdrop(scene: Scene): Graphics {
  const W = scene.width * CELL;
  const H = scene.height * CELL;
  return new Graphics().rect(-REACH * CELL, -REACH * CELL, W + 2 * REACH * CELL, H + 2 * REACH * CELL).fill(PAL.backdrop);
}

/** What the ground leaves to the sprites that are drawn over it. */
export interface GroundOptions {
  /** The bridge is a sprite: the deck is water under its arch, and street under its ends. */
  bridgeArt?: boolean;
}

/** The ground: grass, water, banks, streets, lanes, the pier and the bridge deck. */
export function paintGround(scene: Scene, options: GroundOptions = {}): Graphics {
  const g = new Graphics();
  const W = scene.width * CELL;
  const H = scene.height * CELL;

  g.rect(0, 0, W, H).fill(PAL.grass[0] ?? 0xbccaa4);

  // Patches of a slightly different green, a cell at a time, so the lawn is not one flat sheet.
  for (const [x, y] of cellsOf(scene, "grass")) {
    const n = noise(x, y, 11);
    if (n > 0.45) g.rect(x * CELL, y * CELL, CELL, CELL).fill({ color: PAL.grass[1 + Math.floor(n * 3) % 3] ?? 0xb4c49c, alpha: 0.55 });
  }

  const byId = new Map<string, Run[]>();
  for (const run of runs(scene)) {
    const list = byId.get(run.id) ?? [];
    list.push(run);
    byId.set(run.id, list);
  }
  const fillRuns = (id: string, color: number): void => {
    for (const run of byId.get(id) ?? []) g.rect(run.x * CELL, run.y * CELL, run.length * CELL, CELL).fill(color);
  };

  fillRuns("bank", PAL.bank);
  fillRuns("river", PAL.river);
  fillRuns("lane", PAL.lane);
  fillRuns("street", PAL.street);
  fillRuns("pier", PAL.pier);
  if (options.bridgeArt === true) paintBridgeBed(g, scene);
  else fillRuns("bridge", PAL.bridgeDeck);

  paintGrassDetail(g, scene);
  paintBanks(g, scene);
  paintStreets(g, scene);
  paintLanes(g, scene);
  paintRiver(g, scene);
  paintPier(g, scene);
  if (options.bridgeArt !== true) paintBridge(g, scene);

  // A thin frame, so that the town reads as a map plate.
  g.rect(0, 0, W, H).stroke({ width: 3, color: PAL.frame, alpha: 0.55, alignment: 1 });
  return g;
}

function paintGrassDetail(g: Graphics, scene: Scene): void {
  for (const [x, y] of cellsOf(scene, "grass")) {
    if (noise(x, y, 1) > 0.7) {
      const px = x * CELL + 6 + noise(x, y, 2) * (CELL - 12);
      const py = y * CELL + 10 + noise(x, y, 3) * (CELL - 14);
      const lean = noise(x, y, 7) > 0.5 ? 1 : -1;
      // Three blades from one root, the outer two curving away.
      g.moveTo(px, py).quadraticCurveTo(px - 1 * lean, py - 4, px - 3.4 * lean, py - 6.5);
      g.moveTo(px, py).quadraticCurveTo(px, py - 5, px + 0.4 * lean, py - 8);
      g.moveTo(px, py).quadraticCurveTo(px + 1.4 * lean, py - 3.5, px + 3.8 * lean, py - 5);
    }
  }
  g.stroke({ width: 1.1, color: PAL.tuft, alpha: 0.8, cap: "round" });
  for (const [x, y] of cellsOf(scene, "grass")) {
    const n = noise(x, y, 4);
    if (n > 0.92) {
      const px = x * CELL + 4 + noise(x, y, 5) * (CELL - 8);
      const py = y * CELL + 4 + noise(x, y, 6) * (CELL - 8);
      g.circle(px, py, 1.7).fill(PAL.flower[Math.floor(n * 100) % PAL.flower.length] ?? 0xffffff);
    }
  }
}

function paintBanks(g: Graphics, scene: Scene): void {
  for (const [x, y] of cellsOf(scene, "bank")) {
    for (let i = 0; i < 4; i++) {
      const px = x * CELL + 3 + noise(x, y, 20 + i) * (CELL - 6);
      const py = y * CELL + 3 + noise(x, y, 30 + i) * (CELL - 6);
      g.ellipse(px, py, 1.6 + noise(x, y, 40 + i) * 2.2, 1.1 + noise(x, y, 50 + i) * 1.4).fill({ color: PAL.pebble, alpha: 0.85 });
    }
  }
}

function paintStreets(g: Graphics, scene: Scene): void {
  // Slabs: two courses a cell, each joint staggered, a few slabs a little lighter.
  const half = CELL / 2;
  for (const [x, y] of cellsOf(scene, "street")) {
    const left = x * CELL;
    const top = y * CELL;
    const a = noise(x, y, 60) > 0.5 ? 0 : half;
    const b = noise(x, y, 61) > 0.5 ? 0 : half;
    g.moveTo(left, top + half).lineTo(left + CELL, top + half);
    g.moveTo(left + a, top).lineTo(left + a, top + half);
    g.moveTo(left + b, top + half).lineTo(left + b, top + CELL);
  }
  g.stroke({ width: 1, color: PAL.streetJoint, alpha: 0.5 });
  for (const [x, y] of cellsOf(scene, "street")) {
    const n = noise(x, y, 62);
    if (n > 0.62) g.rect(x * CELL + 1, y * CELL + 1, half - 2, half - 2).fill({ color: PAL.streetHi, alpha: 0.35 });
    if (n < 0.22) g.rect(x * CELL + half + 1, y * CELL + half + 1, half - 2, half - 2).fill({ color: PAL.streetJoint, alpha: 0.25 });
  }
}

function paintLanes(g: Graphics, scene: Scene): void {
  for (const [x, y] of cellsOf(scene, "lane")) {
    for (let i = 0; i < 5; i++) {
      const px = x * CELL + 3 + noise(x, y, 70 + i) * (CELL - 6);
      const py = y * CELL + 3 + noise(x, y, 80 + i) * (CELL - 6);
      g.ellipse(px, py, 2.4 + noise(x, y, 90 + i) * 1.6, 1.8 + noise(x, y, 100 + i)).fill({ color: PAL.laneJoint, alpha: 0.7 });
    }
  }
}

/** Where the river meets a bank, a street, grass or the pier: a strip of the shore and a line of foam. */
function paintRiver(g: Graphics, scene: Scene): void {
  const SIDES: Array<[number, number]> = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ];
  for (const [x, y] of cellsOf(scene, "river")) {
    const left = x * CELL;
    const top = y * CELL;
    // Slow darker streaks in the middle of the stream, like the pull of the current.
    if (terrainAt(scene, x - 1, y) === "river" && terrainAt(scene, x + 1, y) === "river" && noise(x, y, 110) > 0.35) {
      const sx = left + 6 + noise(x, y, 111) * (CELL - 12);
      g.ellipse(sx, top + 6 + noise(x, y, 112) * (CELL - 12), 5 + noise(x, y, 113) * 9, 2 + noise(x, y, 114) * 2).fill({ color: PAL.riverDeep, alpha: 0.5 });
    }
    for (const [dx, dy] of SIDES) {
      const other = terrainAt(scene, x + dx, y + dy);
      if (other === null || other === "river" || other === "bridge") continue;
      const color = other === "grass" ? PAL.shoreGrass : other === "bank" ? PAL.bank : PAL.shoreStone;
      let sx = left;
      let sy = top;
      let sw = CELL;
      let sh = CELL;
      let fx = left;
      let fy = top;
      let fw = CELL;
      let fh = CELL;
      if (dx !== 0) {
        sw = SHORE;
        fw = 1.6;
        sx = dx < 0 ? left : left + CELL - SHORE;
        fx = dx < 0 ? left + SHORE : left + CELL - SHORE - fw;
      } else {
        sh = SHORE;
        fh = 1.6;
        sy = dy < 0 ? top : top + CELL - SHORE;
        fy = dy < 0 ? top + SHORE : top + CELL - SHORE - fh;
      }
      g.rect(sx, sy, sw, sh).fill(color);
      g.rect(fx, fy, fw, fh).fill({ color: PAL.foam, alpha: 0.6 });
      if (color === PAL.shoreStone) {
        // Joints of the embankment stones.
        if (dx !== 0) for (let k = 1; k < 2; k++) g.moveTo(sx, sy + k * (CELL / 2)).lineTo(sx + sw, sy + k * (CELL / 2));
        else for (let k = 1; k < 2; k++) g.moveTo(sx + k * (CELL / 2), sy).lineTo(sx + k * (CELL / 2), sy + sh);
        g.stroke({ width: 1, color: PAL.streetJoint, alpha: 0.5 });
      }
    }
  }
}

function paintPier(g: Graphics, scene: Scene): void {
  for (const [x, y] of cellsOf(scene, "pier")) {
    for (let k = 1; k < 4; k++) g.moveTo(x * CELL, y * CELL + k * (CELL / 4)).lineTo(x * CELL + CELL, y * CELL + k * (CELL / 4));
  }
  g.stroke({ width: 1.2, color: PAL.pierPlank, alpha: 0.7 });
  for (const [x, y] of cellsOf(scene, "pier")) {
    g.circle(x * CELL + 4, y * CELL + 4, 2).fill(PAL.pierPlank);
    g.circle(x * CELL + CELL - 4, y * CELL + CELL - 4, 2).fill(PAL.pierPlank);
  }
}

/**
 * What lies under the sprite of the bridge: the river runs under the arch, and the two ends of the
 * span rest on the street. The span of a row of deck cells is the cells from its first to its last,
 * and the water is the cells between the ends.
 */
function paintBridgeBed(g: Graphics, scene: Scene): void {
  for (const [x, y] of cellsOf(scene, "bridge")) {
    const end = terrainAt(scene, x - 1, y) !== "bridge" || terrainAt(scene, x + 1, y) !== "bridge";
    g.rect(x * CELL, y * CELL, CELL, CELL).fill(end ? PAL.street : PAL.river);
    if (!end) {
      // The streaks of the current go on under the arch.
      g.ellipse(x * CELL + CELL / 2, y * CELL + 6 + noise(x, y, 112) * (CELL - 12), 5 + noise(x, y, 113) * 9, 2 + noise(x, y, 114) * 2).fill({ color: PAL.riverDeep, alpha: 0.5 });
    }
  }
}

/** The stone bridge: slabs, parapets with posts, and the dark mouth of the arch on the water. */
function paintBridge(g: Graphics, scene: Scene): void {
  const deck = cellsOf(scene, "bridge");
  if (deck.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y] of deck) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  const left = minX * CELL;
  const right = (maxX + 1) * CELL;
  const top = minY * CELL;
  const bottom = (maxY + 1) * CELL;

  // The arch below the deck, on the water side.
  const waterLeft = (minX + 1) * CELL + 4;
  const waterRight = maxX * CELL - 4;
  g.moveTo(waterLeft, bottom)
    .bezierCurveTo(waterLeft + 6, bottom + CELL * 0.95, waterRight - 6, bottom + CELL * 0.95, waterRight, bottom)
    .closePath()
    .fill({ color: PAL.arch, alpha: 0.38 });
  g.moveTo(waterLeft + 10, bottom)
    .bezierCurveTo(waterLeft + 14, bottom + CELL * 0.6, waterRight - 14, bottom + CELL * 0.6, waterRight - 10, bottom)
    .closePath()
    .fill({ color: PAL.arch, alpha: 0.3 });

  for (const [x, y] of deck) {
    g.moveTo(x * CELL, y * CELL).lineTo(x * CELL, y * CELL + CELL);
    g.moveTo(x * CELL + CELL / 2, y * CELL).lineTo(x * CELL + CELL / 2, y * CELL + CELL / 2);
  }
  g.stroke({ width: 1, color: PAL.bridgeSlab, alpha: 0.9 });

  // Parapets along both long edges.
  const rail = 7;
  g.rect(left, top - 1, right - left, rail).fill(PAL.bridgeRail);
  g.rect(left, bottom - rail + 1, right - left, rail).fill(PAL.bridgeRail);
  g.rect(left, top + rail - 2, right - left, 2).fill({ color: PAL.bridgeRailShade, alpha: 0.8 });
  g.rect(left, bottom - rail - 1, right - left, 2).fill({ color: PAL.bridgeRailShade, alpha: 0.8 });
  for (let x = minX; x <= maxX + 1; x++) {
    g.rect(x * CELL - 3, top - 3, 6, rail + 3).fill(PAL.bridgeRail);
    g.rect(x * CELL - 3, bottom - rail, 6, rail + 3).fill(PAL.bridgeRail);
  }
  g.stroke({ width: 1, color: PAL.bridgeRailShade, alpha: 0.6 });
}

/** Trees and shrubs, one for each cell that the scene marks as wall or tree and that is no barrier, except the cells in `skip` (drawn some other way). */
export function paintTrees(scene: Scene, skip: ReadonlySet<string> = new Set()): Graphics {
  const g = new Graphics();
  for (const [x, y] of treeCells(scene)) {
    if (skip.has(`${x},${y}`)) continue;
    const n = noise(x, y, 120);
    const cx = (x + 0.5) * CELL + (noise(x, y, 121) - 0.5) * 6;
    const cy = (y + 0.55) * CELL_DEPTH + (noise(x, y, 122) - 0.5) * 4;
    const r = CELL * (0.46 + n * 0.14);
    if (noise(x, y, 130) > 0.76) {
      // Some of the cells are a heap of stones with moss on it, which is what a wall in the grass looks like.
      g.ellipse(cx + 2, cy + r * 0.62, r * 1.0, r * 0.34).fill({ color: PAL.shadow, alpha: 0.22 });
      g.ellipse(cx - r * 0.25, cy + r * 0.12, r * 0.62, r * 0.46).fill(PAL.rock);
      g.ellipse(cx + r * 0.32, cy + r * 0.22, r * 0.5, r * 0.36).fill(PAL.rockDark);
      g.ellipse(cx - r * 0.32, cy - r * 0.02, r * 0.3, r * 0.17).fill({ color: PAL.rockLight, alpha: 0.85 });
      g.ellipse(cx + r * 0.08, cy + r * 0.0, r * 0.32, r * 0.12).fill({ color: PAL.treeMid, alpha: 0.75 });
      continue;
    }
    g.ellipse(cx + 3, cy + r * 0.62, r * 0.95, r * 0.42).fill({ color: PAL.shadow, alpha: 0.22 });
    g.rect(cx - 2, cy + r * 0.2, 4, r * 0.55).fill(PAL.trunk);
    g.circle(cx - r * 0.28, cy + r * 0.12, r * 0.72).fill(PAL.treeDark);
    g.circle(cx + r * 0.32, cy + r * 0.08, r * 0.7).fill(PAL.treeDark);
    g.circle(cx, cy - r * 0.2, r * 0.82).fill(PAL.treeMid);
    g.circle(cx - r * 0.22, cy - r * 0.42, r * 0.42).fill({ color: PAL.treeLight, alpha: 0.9 });
  }
  return g;
}

/** The pile of junk that closes the lane behind the temple. */
export function paintBarriers(scene: Scene): Graphics {
  const g = new Graphics();
  for (const barrier of scene.barriers) {
    for (const [x, y] of barrier.cells) {
      const left = x * CELL;
      const top = y * CELL_DEPTH;
      g.ellipse(left + CELL * 0.5, top + CELL_DEPTH * 0.86, CELL * 0.48, CELL_DEPTH * 0.14).fill({ color: PAL.shadow, alpha: 0.22 });
      g.rect(left + 3, top + 12, 14, 14).fill(PAL.junk).stroke({ width: 1, color: PAL.junkDark });
      g.rect(left + 15, top + 16, 13, 11).fill(PAL.junk).stroke({ width: 1, color: PAL.junkDark });
      g.moveTo(left + 3, top + 12).lineTo(left + 17, top + 26).moveTo(left + 17, top + 12).lineTo(left + 3, top + 26);
      g.stroke({ width: 1, color: PAL.junkDark, alpha: 0.7 });
      g.moveTo(left + 2, top + 24).lineTo(left + 30, top + 7).stroke({ width: 3, color: PAL.timber, cap: "round" });
      g.moveTo(left + 5, top + 6).lineTo(left + 24, top + 20).stroke({ width: 2.4, color: PAL.junkDark, cap: "round" });
    }
  }
  return g;
}

/** The blocked cells of a plain scene (the demo world), as slate blocks with a lighter top. */
export function paintPlainBlocks(scene: Scene): Graphics {
  const g = new Graphics();
  for (const [x, y] of cellsOf(scene, "wall")) {
    g.roundRect(x * CELL + 1, y * CELL + 1, CELL - 2, CELL - 2, 4).fill(PAL.roof).stroke({ width: 1, color: PAL.roofEdge });
    g.roundRect(x * CELL + 4, y * CELL + 4, CELL - 8, CELL * 0.4, 3).fill({ color: PAL.roofRidge, alpha: 0.7 });
  }
  for (const place of scene.places) {
    const r = place.rect;
    g.roundRect(r.x * CELL + 2, r.y * CELL + 2, r.w * CELL - 4, r.h * CELL - 4, 6).stroke({ width: 2, color: PAL.ink, alpha: 0.45 });
    g.roundRect(r.x * CELL + 2, r.y * CELL + 2, r.w * CELL - 4, r.h * CELL - 4, 6).fill({ color: PAL.paper, alpha: 0.18 });
  }
  return g;
}
