/**
 * White-walled, dark-tiled buildings, drawn from the footprint rectangles of the scene as flat
 * shapes: a roof with its ridge and tile courses, the front wall with windows and a door, and a
 * few marks for the kinds that have one (a banner at the teahouse, a flag at the tavern, striped
 * awnings over the stalls of the market). A footprint is drawn as the screen shows it, a cell
 * 32 pixels wide and 25.22 deep. The places that have a sprite (`PLACE_ART`) are not drawn here
 * when the sprites are there: `skip` lists their buildings.
 */
import { Graphics } from "pixi.js";
import type { BuildingRect, Scene } from "../scene.ts";
import { CELL, CELL_DEPTH, clamp } from "./geometry.ts";
import { mix, noise, PAL } from "./palette.ts";

export interface LitSpot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BuildingPaint {
  graphics: Graphics;
  /** Windows and doors that are lit at night, in world units. */
  lit: LitSpot[];
  /** Kinds that keep a lamp lit in the evening. */
  lamps: Array<{ x: number; y: number }>;
}

const PUBLIC = new Set(["teahouse", "tavern", "temple", "hall", "post", "workshop", "school"]);

export function paintBuildings(scene: Scene, skip: (b: BuildingRect) => boolean = () => false): BuildingPaint {
  const g = new Graphics();
  const lit: LitSpot[] = [];
  const doors = new Map<string, readonly [number, number]>();
  for (const place of scene.places) if (place.door !== null) doors.set(place.id, place.door);

  // Painter's order: the buildings further down the map are in front.
  const order = [...scene.buildings].sort((a, b) => a.y + a.h - (b.y + b.h) || a.x - b.x);
  for (const b of order) {
    if (skip(b)) continue;
    if (b.kind === "market") paintStall(g, b);
    else paintHouse(g, b, doors.get(b.place) ?? null, lit);
  }
  return { graphics: g, lit, lamps: [] };
}

function paintHouse(g: Graphics, b: BuildingRect, door: readonly [number, number] | null, lit: LitSpot[]): void {
  const X = b.x * CELL;
  const Y = b.y * CELL_DEPTH;
  const W = b.w * CELL;
  const H = b.h * CELL_DEPTH;
  const wallH = clamp(H * 0.36, 0.8 * CELL, 1.02 * CELL);
  const overhang = b.kind === "hall" || b.kind === "temple" ? 0.22 * CELL : 0.14 * CELL;
  const wallTop = Y + H - wallH;
  const roofLeft = X - overhang;
  const roofWidth = W + 2 * overhang;
  const roofTop = Y - 0.1 * CELL;
  const roofBottom = wallTop + 0.16 * CELL;
  const roofHeight = roofBottom - roofTop;
  const temple = b.kind === "temple";
  const wallColor = temple ? mix(PAL.red, PAL.wall, 0.12) : PAL.wall;
  const roofColor = mix(PAL.roof, 0x2f3a45, noise(b.x, b.y, 140) * 0.55);

  // Shadow on the ground, in two soft steps.
  g.rect(X + 0.1 * CELL, Y + 0.14 * CELL, W + 0.16 * CELL, H + 0.12 * CELL).fill({ color: PAL.shadow, alpha: 0.1 });
  g.rect(X + 0.04 * CELL, Y + 0.08 * CELL, W + 0.1 * CELL, H + 0.06 * CELL).fill({ color: PAL.shadow, alpha: 0.12 });

  // The front wall.
  g.rect(X, wallTop, W, wallH).fill(wallColor);
  g.rect(X, Y + H - 0.16 * CELL, W, 0.16 * CELL).fill(temple ? PAL.redDark : PAL.wallBase);
  g.rect(X, wallTop + 0.14 * CELL, W, 0.18 * CELL).fill({ color: PAL.roofShadow, alpha: 0.2 });
  g.rect(X + W - 0.18 * CELL, wallTop, 0.18 * CELL, wallH).fill({ color: PAL.wallShade, alpha: temple ? 0.2 : 0.8 });

  // The door goes where the place's own door is when that is within the wall, else in the middle.
  let doorX = X + W / 2;
  if (door !== null && door[0] * CELL >= X && (door[0] + 1) * CELL <= X + W) doorX = (door[0] + 0.5) * CELL;
  const doorW = 0.46 * CELL;
  const doorH = Math.min(0.7 * CELL, wallH - 0.2 * CELL);
  const doorColor = b.kind === "hall" || temple ? 0xa8362a : PAL.door;
  g.rect(doorX - doorW / 2, Y + H - 0.16 * CELL - doorH + 0.1 * CELL, doorW, doorH).fill(doorColor);
  g.rect(doorX - doorW / 2 - 2, Y + H - 0.16 * CELL - doorH + 0.1 * CELL - 2, doorW + 4, 3).fill(PAL.roofLine);
  g.circle(doorX + 0.08 * CELL, Y + H - 0.16 * CELL - doorH * 0.45 + 0.1 * CELL, 1.2).fill(PAL.gold);
  if (PUBLIC.has(b.kind)) {
    lit.push({ x: doorX - doorW / 2, y: Y + H - 0.16 * CELL - doorH + 0.1 * CELL, w: doorW, h: doorH });
  }

  // Windows, in the wall between the door and the ends.
  const count = Math.max(1, Math.floor(W / (2.1 * CELL)));
  for (let i = 0; i < count; i++) {
    const cx = X + (W * (i + 0.5)) / count;
    const cx2 = Math.abs(cx - doorX) < 0.55 * CELL ? cx + (cx < doorX ? -1 : 1) * 0.55 * CELL : cx;
    if (cx2 < X + 0.3 * CELL || cx2 > X + W - 0.3 * CELL) continue;
    const ww = 0.38 * CELL;
    const wh = 0.3 * CELL;
    const wy = wallTop + 0.34 * CELL;
    g.rect(cx2 - ww / 2, wy, ww, wh).fill(PAL.window);
    g.moveTo(cx2, wy).lineTo(cx2, wy + wh).moveTo(cx2 - ww / 2, wy + wh / 2).lineTo(cx2 + ww / 2, wy + wh / 2);
    g.stroke({ width: 1, color: PAL.wall, alpha: 0.5 });
    if (PUBLIC.has(b.kind) || noise(b.x, b.y, 150 + i) > 0.7) lit.push({ x: cx2 - ww / 2, y: wy, w: ww, h: wh });
  }

  // The roof: the ridge in the middle, courses of tiles, a dark edge along the eave.
  g.roundRect(roofLeft, roofTop, roofWidth, roofHeight, 3).fill(roofColor);
  const courses = Math.max(2, Math.floor(roofHeight / 7));
  for (let i = 1; i <= courses; i++) {
    const cy = roofTop + (roofHeight * i) / (courses + 1);
    g.moveTo(roofLeft + 2, cy).lineTo(roofLeft + roofWidth - 2, cy);
  }
  g.stroke({ width: 1, color: PAL.roofLine, alpha: 0.5 });
  const ridgeY = roofTop + roofHeight * 0.34;
  g.rect(roofLeft + 3, ridgeY - 2, roofWidth - 6, 4).fill(temple ? PAL.gold : PAL.roofRidge);
  g.rect(roofLeft, roofBottom - 3, roofWidth, 3).fill(PAL.roofEdge);
  g.rect(roofLeft, roofTop, roofWidth, 2).fill({ color: PAL.roofRidge, alpha: 0.7 });
  if (b.kind === "hall" || temple) {
    g.circle(roofLeft + 5, ridgeY, 3.2).fill(PAL.gold);
    g.circle(roofLeft + roofWidth - 5, ridgeY, 3.2).fill(PAL.gold);
  }
  // The stepped gable ends of the old river towns: a dark cap at each end of the roof.
  if (b.kind === "house" || b.kind === "school") {
    for (const side of [-1, 1]) {
      const ex = side < 0 ? roofLeft : roofLeft + roofWidth;
      const inward = -side;
      g.poly([ex, roofTop + 9, ex, roofTop - 4, ex + inward * 5, roofTop - 4, ex + inward * 5, roofTop, ex + inward * 9, roofTop, ex + inward * 9, roofTop + 9]).fill(PAL.roofEdge);
    }
  }

  paintMarks(g, b, X, Y, W, H, roofLeft, roofWidth, roofBottom);
}

/** The marks that tell the kinds apart: a blue banner for tea, a red flag for wine, bamboo at the workshop. */
function paintMarks(g: Graphics, b: BuildingRect, X: number, Y: number, W: number, H: number, roofLeft: number, roofWidth: number, roofBottom: number): void {
  if (b.kind === "teahouse") {
    const bx = X + W - 0.62 * CELL;
    g.rect(bx - 1, roofBottom - 2, 2, 1.25 * CELL).fill(PAL.door);
    g.rect(bx, roofBottom, 0.42 * CELL, 1.05 * CELL).fill(PAL.cloth);
    g.rect(bx, roofBottom + 0.12 * CELL, 0.42 * CELL, 3).fill(PAL.clothLight);
    g.rect(bx, roofBottom + 0.82 * CELL, 0.42 * CELL, 3).fill(PAL.clothLight);
  } else if (b.kind === "tavern") {
    const bx = roofLeft + 0.32 * CELL;
    g.rect(bx - 1, roofBottom - 2, 2, 1.2 * CELL).fill(PAL.door);
    g.poly([bx, roofBottom, bx + 0.4 * CELL, roofBottom, bx + 0.4 * CELL, roofBottom + 1.05 * CELL, bx + 0.2 * CELL, roofBottom + 0.9 * CELL, bx, roofBottom + 1.05 * CELL]).fill(PAL.red);
  } else if (b.kind === "workshop") {
    // A rack of bamboo poles against the end wall.
    for (let i = 0; i < 5; i++) {
      const px = roofLeft + roofWidth + 4 + i * 4;
      g.moveTo(px, Y + H - 0.1 * CELL).lineTo(px - 2 + i * 0.6, Y - 0.2 * CELL);
    }
    g.stroke({ width: 2.4, color: PAL.bamboo, cap: "round" });
    g.moveTo(roofLeft + roofWidth + 2, Y + 0.5 * CELL).lineTo(roofLeft + roofWidth + 24, Y + 0.45 * CELL).stroke({ width: 1.5, color: PAL.junkDark });
  } else if (b.kind === "school") {
    g.rect(X + W / 2 - 0.34 * CELL, roofBottom + 0.02 * CELL, 0.68 * CELL, 0.2 * CELL).fill(PAL.red).stroke({ width: 1, color: PAL.gold });
  }
}

/** A market stall: a striped awning over a counter with goods on it. */
function paintStall(g: Graphics, b: BuildingRect): void {
  const X = b.x * CELL;
  const Y = b.y * CELL_DEPTH;
  const W = b.w * CELL;
  const H = b.h * CELL_DEPTH;
  g.rect(X + 3, Y + 5, W, H).fill({ color: PAL.shadow, alpha: 0.14 });
  g.rect(X + 2, Y + 0.58 * CELL, W - 4, H - 0.58 * CELL - 1).fill(PAL.timber);
  g.rect(X + 2, Y + 0.58 * CELL, W - 4, 3).fill({ color: PAL.junkDark, alpha: 0.5 });
  const stripe = 8;
  const count = Math.floor(W / stripe);
  const warm = noise(b.x, b.y, 160) > 0.5;
  for (let i = 0; i < count; i++) {
    const color = i % 2 === 0 ? (warm ? PAL.red : PAL.cloth) : PAL.clothLight;
    g.rect(X + i * stripe, Y + 2, stripe, 0.52 * CELL).fill(color);
    g.moveTo(X + i * stripe, Y + 0.52 * CELL + 2).arc(X + i * stripe + stripe / 2, Y + 0.52 * CELL + 2, stripe / 2, Math.PI, 0, true).closePath().fill(color);
  }
  g.rect(X, Y, W, 3).fill(PAL.roofEdge);
  for (let i = 0; i < 4; i++) {
    const gx = X + 8 + i * ((W - 16) / 3);
    g.circle(gx, Y + 0.76 * CELL, 3.2).fill([PAL.red, PAL.gold, PAL.bamboo, PAL.clothLight][i % 4] ?? PAL.gold);
  }
}
