/**
 * The festival night as a plan: who stands where, who walks the parade and how, and what the river carries. Everything here is a function of the
 * `festival` block of the ending (`ending.ts`), the town's scene and the seed (the tick of the ending), so that the same ending is staged the same
 * way whether the game was played to its end, a recording reached it, a finished save was loaded or a recording was taken to its end. It draws
 * nothing and has no PixiJS in it, so that the tests can run it without a browser; `stage.ts` draws it and `timeline.ts` says when each thing happens.
 *
 * The people of the picture are the `bearers` of the ending, who live in the districts (the houses) of the town. When the parade walks (`route`
 * is the bridge or the lane) about three in four of them take part: they walk it two abreast behind a head, over the mended bridge or along the lane
 * behind the temple, to the plaza before the ancestral hall, where the main lantern stands, and spread out there, those who come first nearest the
 * lantern. The rest stay by their doors with a lantern. Where the two families are together (`together`) the people of the Li side and of the Zhou side
 * walk side by side, a pair at a time, and stand mixed in the plaza; where they are not, the Li side walks at the head and the Zhou side at the tail,
 * with a gap between, and they stand one behind the other. Where there is no parade (`none`) everybody stays at their own door. The named people stand at
 * the places the core says they are bound for. The main lantern is lit by `lighter`: both heads of the families, one on each side of it, the clan elder
 * alone, or nobody.
 *
 * The map is drawn from one side, so a building hides the ground behind it up the height of its roof: the strip of the plaza in front of the hall that is
 * not hidden by the temple's roof is about two rows deep, and it is on that strip that people stand, and the main street is walked on its upper side
 * where the tavern's roof would hide the lower.
 */
import type { Festival } from "../ending.ts";
import { chooseDir } from "../map/animate.ts";
import { CELL, CELL_DEPTH } from "../map/geometry.ts";
import type { Dir } from "../map/manifest.ts";
import { type Cell, type Place, type Scene, terrainAt } from "../scene.ts";
import { Rng } from "./rng.ts";

/** The most people the picture draws, whatever the turnout (the core caps the block of the ending at the same number). */
export const MAX_BEARERS = 120;
/** How fast the parade walks, in pixels of the map a second: a little slower than the townsfolk walk, which is how a procession goes. */
export const WALK_PX_S = 31;
/** The distance along the route between one pair of people and the next, and the distance of each of the two lanes from the middle of the way, in pixels. */
export const PAIR_GAP_PX = 31;
export const LANE_PX = 11;
/** The empty stretch between the two camps of a parade whose families are not together, in pairs. */
export const CAMP_GAP_PAIRS = 3;

export interface Pt {
  x: number;
  y: number;
}

/** A point in cells of the grid, the middle of a cell being the cell plus a half. */
export type GridPoint = readonly [number, number];

/** A point of the grid, as a point of the map: pixels at a zoom of 1. */
export const toWorld = (gx: number, gy: number): Pt => ({ x: gx * CELL, y: gy * CELL_DEPTH });

// --- The way the parade goes -------------------------------------------------------------------------------------------

/** From the far west of the main street, over the stone bridge and on along the street to the plaza before the ancestral hall. */
export const ROUTE_BRIDGE: readonly GridPoint[] = [[0.5, 15.45], [40.6, 15.45], [41.5, 14.65]];
/** From the east road, round the temple by the lane behind it, and up the east end of the main street to the plaza. */
export const ROUTE_LANE: readonly GridPoint[] = [[44.5, 32.6], [44.5, 24.5], [55.5, 24.5], [55.5, 15.4], [54.7, 14.65], [53.6, 14.5]];

/** Where the camera meets the head of the parade: a point of the route and the second the head is there. */
export const MEET = {
  bridge: { at: [24.5, 15.45] as GridPoint, seconds: 3.6 },
  lane: { at: [44.5, 24.5] as GridPoint, seconds: 11.5 },
} as const;

/** The strip of the plaza that people stand on, as the sides of a box of the map in cells: not further south than the roof of the temple hides. */
export const PLAZA_ROWS = [13.3, 14.85] as const;
/** The part of the plaza the parade comes into, by the way it goes: from the west by the main street, or from the east by the lane. */
export const PLAZA_COLUMNS = { bridge: [42.2, 48.1], lane: [52.1, 54.9] } as const;

/** A line of the map drawn as one polyline, measured in pixels of the map. */
export class Polyline {
  readonly points: readonly Pt[];
  /** Distance from the start to each point. */
  readonly cum: readonly number[];
  readonly length: number;

  constructor(grid: readonly GridPoint[]) {
    this.points = grid.map(([gx, gy]) => toWorld(gx, gy));
    const cum = [0];
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1] as Pt;
      const b = this.points[i] as Pt;
      cum.push((cum[i - 1] as number) + Math.hypot(b.x - a.x, b.y - a.y));
    }
    this.cum = cum;
    this.length = cum[cum.length - 1] ?? 0;
  }

  /** The point `u` pixels along the line (held to its ends) and the unit vector the line runs in there. */
  at(u: number): { x: number; y: number; tx: number; ty: number } {
    const last = this.points.length - 1;
    const at = Math.min(this.length, Math.max(0, u));
    let i = 1;
    while (i < last && (this.cum[i] as number) < at) i++;
    const a = this.points[i - 1] as Pt;
    const b = this.points[i] as Pt;
    const span = (this.cum[i] as number) - (this.cum[i - 1] as number);
    const f = span <= 0 ? 0 : (at - (this.cum[i - 1] as number)) / span;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const norm = Math.hypot(dx, dy) || 1;
    return { x: a.x + dx * f, y: a.y + dy * f, tx: dx / norm, ty: dy / norm };
  }

  /** How far along the line the nearest point to `p` is. */
  along(p: Pt): number {
    let best = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let i = 1; i < this.points.length; i++) {
      const a = this.points[i - 1] as Pt;
      const b = this.points[i] as Pt;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const f = len2 <= 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
      const d = Math.hypot(a.x + dx * f - p.x, a.y + dy * f - p.y);
      if (d < bestDistance) {
        bestDistance = d;
        best = (this.cum[i - 1] as number) + Math.sqrt(len2) * f;
      }
    }
    return best;
  }

  /** How far `p` is from the line. */
  distance(p: Pt): number {
    const at = this.at(this.along(p));
    return Math.hypot(at.x - p.x, at.y - p.y);
  }
}

// --- Who the people are ------------------------------------------------------------------------------------------------

/** The three passers-by of the atlas, who the people of the picture are. */
export type Kind = "townsman" | "townswoman" | "child";
export const KIND_SPRITE: Readonly<Record<Kind, string>> = { townsman: "char.townsman", townswoman: "char.townswoman", child: "char.child" };

/** The side of the two families a district is on, which decides where its people walk in a parade whose families are apart. */
export type Camp = "li" | "zhou";
/** The colour of a hand lantern: the Li family's red, the Zhou family's blue, and the warm yellow of everybody else. */
export type Glow = "red" | "blue" | "gold";

export interface District {
  id: string;
  camp: Camp;
  glow: Glow;
  door: Cell;
  stands: Cell[];
}

export const LI_HOUSE = "p_li_house";
export const ZHOU_HOUSE = "p_zhou_house";

/** The first and the last column of the river in the scene. */
export function riverSpan(scene: Scene): [number, number] | null {
  let first = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  for (let y = 0; y < scene.rows.length; y++) {
    for (let x = 0; x < (scene.rows[y] ?? "").length; x++) {
      if (terrainAt(scene, x, y) === "river") {
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
  }
  return Number.isFinite(first) ? [first, last] : null;
}

/** The first and the last column of the water in each row of the map: the river bends, and where a bridge or a pier crosses it the row has the water of the row above. */
export type RiverBed = ReadonlyArray<readonly [number, number]>;

export function riverBedOf(scene: Scene): RiverBed {
  const bed: Array<[number, number] | null> = [];
  for (let y = 0; y < scene.height; y++) {
    let first = Number.POSITIVE_INFINITY;
    let last = Number.NEGATIVE_INFINITY;
    for (let x = 0; x < scene.width; x++) {
      if (terrainAt(scene, x, y) === "river") {
        first = Math.min(first, x);
        last = Math.max(last, x);
      }
    }
    bed.push(Number.isFinite(first) ? [first, last] : null);
  }
  const span = riverSpan(scene) ?? [0, 0];
  let before: [number, number] = bed.find((row): row is [number, number] => row !== null) ?? [span[0], span[1]];
  return bed.map((row) => {
    if (row !== null) before = row;
    return before;
  });
}

/** The districts the ending has people in, in the order the ending lists them: those that are places of the scene with a door. */
export function districtsOf(festival: Festival, scene: Scene): District[] {
  const river = riverSpan(scene);
  const out: District[] = [];
  for (const id of Object.keys(festival.bearers)) {
    const place = scene.places.find((p) => p.id === id);
    if (place === undefined || place.door === null) continue;
    const west = river === null ? place.door[0] < scene.width / 2 : place.door[0] < river[0];
    const camp: Camp = id === LI_HOUSE ? "li" : id === ZHOU_HOUSE ? "zhou" : west ? "li" : "zhou";
    out.push({ id, camp, glow: id === LI_HOUSE ? "red" : id === ZHOU_HOUSE ? "blue" : "gold", door: place.door, stands: place.stands });
  }
  return out;
}

/** The number of people for each district: the ending's, or if they add up to more than `MAX_BEARERS`, shared down to it by the largest remainder. */
export function bearerCounts(festival: Festival, known: readonly string[]): Array<[string, number]> {
  const rows = known.map((id): [string, number] => [id, Math.max(0, Math.trunc(festival.bearers[id] ?? 0))]).filter(([, n]) => n > 0);
  const total = rows.reduce((sum, [, n]) => sum + n, 0);
  if (total <= MAX_BEARERS) return rows;
  const shares = rows.map(([id, n], order) => ({ id, order, whole: Math.floor((n * MAX_BEARERS) / total), rest: (n * MAX_BEARERS) % total }));
  let left = MAX_BEARERS - shares.reduce((sum, s) => sum + s.whole, 0);
  for (const s of [...shares].sort((a, b) => b.rest - a.rest || a.order - b.order)) {
    if (left <= 0) break;
    s.whole++;
    left--;
  }
  return shares.filter((s) => s.whole > 0).map((s): [string, number] => [s.id, s.whole]);
}

// --- The mood of the ending --------------------------------------------------------------------------------------------

/** How the night feels: the share of the lights the ending has, the share of the people who walk, and how many lanterns the river carries. */
export interface Mood {
  /** How bright the lanterns are, from 0 to 1. */
  glow: number;
  /** The share of the people of each district who walk the parade, if it walks. */
  march: number;
  /** The share of the river's lanterns, from 0 to 1. */
  river: number;
}

/** The mood of an ending: a full night is bright and the people come out, a night that is just enough is a little less, a scattered one is dim. */
export function moodOf(endingId: string): Mood {
  if (endingId === "ending_full") return { glow: 1, march: 0.8, river: 1 };
  if (endingId === "ending_split") return { glow: 0.72, march: 0.6, river: 0.55 };
  return { glow: 0.88, march: 0.7, river: 0.8 };
}

// --- The people --------------------------------------------------------------------------------------------------------

export interface Bearer {
  id: number;
  district: string;
  camp: Camp;
  glow: Glow;
  kind: Kind;
  role: "march" | "stay";
  /** For a walker: the place in the line behind the head, counting pairs, and the lane (-1 on the left of the way, 1 on the right). */
  slot: number;
  lane: -1 | 1;
  /** A little of the way along, to keep the line from being a row of equals, in pixels. */
  stagger: number;
  /** Where a walker stands once it is in the plaza, or where a person who stays stands, in pixels of the map. */
  spot: Pt;
  /** The way a person who stays faces. */
  face: Dir;
  /** For the cycle of breathing and of the stride, so that two people are not in step. */
  phase: number;
}

/** A person of the cast, or the manager, standing where the plan puts them. */
export interface Standing {
  id: string;
  x: number;
  y: number;
  dir: Dir;
}

export interface Plan {
  route: Festival["route"];
  together: boolean;
  seed: number;
  /** The way the parade walks (null if it does not). */
  line: Polyline | null;
  /** Where the head of the parade is at second 0, in pixels along the line. */
  headStart: number;
  bearers: Bearer[];
  named: Standing[];
  lighters: Standing[];
  manager: Standing;
  lantern: Pt;
  /** The plaza before the hall, as a box of the map and the spots people stand on in it. */
  plaza: { x0: number; y0: number; x1: number; y1: number };
  mood: Mood;
}

const KIND_ODDS: ReadonlyArray<readonly [Kind, number]> = [
  ["townsman", 0.4],
  ["townswoman", 0.4],
  ["child", 0.2],
];

function kindFor(rng: Rng): Kind {
  let at = rng.next();
  for (const [kind, odds] of KIND_ODDS) {
    if (at < odds) return kind;
    at -= odds;
  }
  return "townsman";
}

const PLACE_FALLBACK = { bridge: [27, 15], hall: [50, 13], teahouse: [34, 14], li: [7, 5], zhou: [36, 5] } as const;

/** The door of a place of the scene, or the cell the town has had it at. */
export function doorOf(scene: Scene, id: string, fallback: GridPoint): GridPoint {
  const door = scene.places.find((p) => p.id === id)?.door ?? null;
  return door === null ? fallback : [door[0], door[1]];
}

/** The places the plan anchors on. */
export function anchorsOf(scene: Scene): { bridge: GridPoint; hall: GridPoint; teahouse: GridPoint; li: GridPoint; zhou: GridPoint; lantern: Pt } {
  const hall = doorOf(scene, "p_clan_hall", PLACE_FALLBACK.hall);
  return {
    bridge: doorOf(scene, "p_bridge", PLACE_FALLBACK.bridge),
    hall,
    teahouse: doorOf(scene, "p_teahouse", PLACE_FALLBACK.teahouse),
    li: doorOf(scene, LI_HOUSE, PLACE_FALLBACK.li),
    zhou: doorOf(scene, ZHOU_HOUSE, PLACE_FALLBACK.zhou),
    lantern: toWorld(hall[0] + 0.5, hall[1] + 1.6),
  };
}

const STREETS = new Set(["street", "lane", "bank"]);

/** The cells of the town that a person can stand on beside a door: street, lane and bank, and grass after those. */
function standable(scene: Scene, x: number, y: number): number {
  const terrain = terrainAt(scene, x, y);
  if (terrain === null) return 0;
  if (STREETS.has(terrain)) return terrain === "street" ? 3 : 2;
  return terrain === "grass" ? 1 : 0;
}

/**
 * The spots of the plaza, as many as are wanted if the box can hold them at all: a jittered grid over the box, as open as it can be and closer where there
 * are many, in the order of how near each is to `from`, nearest first, so that those who arrive first stand nearest the lantern. Spots too near a lantern or
 * a person already standing there are left out.
 */
export function plazaSpots(box: Plan["plaza"], avoid: readonly Pt[], from: Pt, rng: Rng, wanted: number): Pt[] {
  const spots: Pt[] = [];
  for (let step = 0; spots.length < wanted && step < 4; step++) {
    spots.length = 0;
    const dx = (0.62 - step * 0.1) * CELL;
    const dy = (0.5 - step * 0.08) * CELL_DEPTH;
    for (let y = box.y0 + dy / 2; y <= box.y1; y += dy) {
      for (let x = box.x0 + dx / 2; x <= box.x1; x += dx) {
        const p = {
          x: Math.min(box.x1, Math.max(box.x0, x + rng.range(-0.14, 0.14) * CELL)),
          y: Math.min(box.y1, Math.max(box.y0, y + rng.range(-0.14, 0.14) * CELL_DEPTH)),
        };
        if (avoid.some((a) => Math.hypot(a.x - p.x, (a.y - p.y) * (CELL / CELL_DEPTH)) < 0.85 * CELL)) continue;
        spots.push(p);
      }
    }
  }
  return spots.sort((a, b) => Math.hypot(a.x - from.x, a.y - from.y) - Math.hypot(b.x - from.x, b.y - from.y) || a.x - b.x || a.y - b.y);
}

/** Where a named person stands: the places they are bound for have their door and their stands, and the k-th person there takes the k-th of these. */
export function placeNamed(named: Festival["named"], scene: Scene, skip: ReadonlySet<string> = new Set()): Standing[] {
  const used = new Map<string, number>();
  const out: Standing[] = [];
  for (const { npc, place: placeId } of named) {
    if (skip.has(npc)) continue;
    const place: Place | undefined = scene.places.find((p) => p.id === placeId);
    if (place === undefined) continue;
    const cells: Cell[] = [...(place.door === null ? [] : [place.door]), ...place.stands];
    if (cells.length === 0) cells.push([place.rect.x, place.rect.y]);
    const k = used.get(placeId) ?? 0;
    used.set(placeId, k + 1);
    const cell = cells[k % cells.length] as Cell;
    // A place with more people than cells has the extra ones a little to the side of the first round.
    const round = Math.floor(k / cells.length);
    const at = toWorld(cell[0] + 0.5 + round * 0.32, cell[1] + 0.5 + round * 0.12);
    out.push({ id: npc, x: at.x, y: at.y, dir: "down" });
  }
  return out;
}

/** Where the people who light the main lantern stand: one on each side of it, facing it, or the one of them on its left. */
export function lighterSpots(lighter: readonly string[], lantern: Pt): Standing[] {
  const apart = 1.2 * CELL;
  if (lighter.length === 0) return [];
  if (lighter.length === 1) return [{ id: lighter[0] as string, x: lantern.x - apart, y: lantern.y, dir: "right" }];
  return lighter.map((id, i) => ({ id, x: lantern.x + (i - (lighter.length - 1) / 2) * 2 * apart, y: lantern.y, dir: (i < lighter.length / 2 ? "right" : "left") as Dir }));
}

/** The plan of the night for an ending. `seed` is the tick of the ending. */
export function buildPlan(festival: Festival, scene: Scene, seed: number, endingId: string): Plan {
  const mood = moodOf(endingId);
  const anchors = anchorsOf(scene);
  const route = festival.route;
  const line = route === "none" ? null : new Polyline(route === "bridge" ? ROUTE_BRIDGE : ROUTE_LANE);
  const meet = route === "bridge" ? MEET.bridge : MEET.lane;
  const headStart = line === null ? 0 : line.along(toWorld(meet.at[0], meet.at[1])) - WALK_PX_S * meet.seconds;

  const lantern = anchors.lantern;
  const lighters = lighterSpots(festival.lighter, lantern);
  const lighting = new Set(festival.lighter);
  const named = placeNamed(festival.named, scene, lighting).map((who) => {
    // Nobody stands behind the lantern or on the people who light it.
    const near = [lantern, ...lighters].some((p) => Math.hypot(p.x - who.x, (p.y - who.y) * (CELL / CELL_DEPTH)) < 1.3 * CELL);
    return near ? { ...who, x: who.x + (who.x < lantern.x ? -1.6 : 1.6) * CELL } : who;
  });
  const columns = route === "lane" ? PLAZA_COLUMNS.lane : PLAZA_COLUMNS.bridge;
  const plaza = { x0: columns[0] * CELL, y0: PLAZA_ROWS[0] * CELL_DEPTH, x1: columns[1] * CELL, y1: PLAZA_ROWS[1] * CELL_DEPTH };
  const manager: Standing = { id: "player", ...toWorld(23.4, 14.5), dir: "right" };

  const districts = districtsOf(festival, scene);
  const counts = bearerCounts(festival, districts.map((d) => d.id));
  const rng = new Rng(seed, "bearers");
  const bearers: Bearer[] = [];
  for (const [id, n] of counts) {
    const district = districts.find((d) => d.id === id) as District;
    const marching = line === null ? 0 : Math.round(n * mood.march);
    for (let k = 0; k < n; k++) {
      bearers.push({
        id: bearers.length,
        district: id,
        camp: district.camp,
        glow: district.glow,
        kind: kindFor(rng),
        role: k < marching ? "march" : "stay",
        slot: 0,
        lane: -1,
        stagger: rng.range(-0.22, 0.22) * PAIR_GAP_PX,
        spot: { x: 0, y: 0 },
        face: "down",
        phase: rng.next(),
      });
    }
  }

  // The order of the line: pairs, a camp of each side by side where the families are together, one camp then a gap and the other where they are not.
  const walkers = bearers.filter((b) => b.role === "march");
  const order = (camp: Camp): Bearer[] => walkers.filter((b) => b.camp === camp);
  const li = order("li");
  const zhou = order("zhou");
  const lane = (n: number): -1 | 1 => (n % 2 === 0 ? -1 : 1);
  if (festival.together) {
    // A pair is one of each family, left and right, until one family has no more, and then two of the other.
    let slot = 0;
    const a = [...li];
    const b = [...zhou];
    while (a.length > 0 || b.length > 0) {
      const left = a.shift();
      const right = b.shift();
      if (left !== undefined && right !== undefined) {
        left.slot = slot;
        left.lane = -1;
        right.slot = slot;
        right.lane = 1;
        slot++;
      } else {
        const rest = [left, right].filter((x): x is Bearer => x !== undefined);
        const more = a.length > 0 ? a : b;
        const second = more.shift();
        const pair = [...rest, ...(second === undefined ? [] : [second])];
        pair.forEach((who, i) => {
          who.slot = slot;
          who.lane = lane(i);
        });
        slot++;
      }
    }
  } else {
    let slot = 0;
    for (const group of [li, zhou]) {
      group.forEach((who, i) => {
        who.slot = slot + Math.floor(i / 2);
        who.lane = lane(i);
      });
      slot += Math.ceil(group.length / 2) + (group === li && zhou.length > 0 && li.length > 0 ? CAMP_GAP_PAIRS : 0);
    }
  }

  // Where the walkers stand in the plaza, and where everybody else stands by a door.
  const avoid = [lantern, ...lighters, ...named].map((p) => ({ x: p.x, y: p.y }));
  if (line !== null) {
    // Those who come first stand nearest the lantern, so where the camps are apart the camp at the head is the nearer, and where they are together the two are mixed.
    const spots = plazaSpots(plaza, avoid, lantern, new Rng(seed, "plaza"), walkers.length);
    const byArrival = [...walkers].sort((x, y) => x.slot - y.slot || x.lane - y.lane);
    byArrival.forEach((who, i) => {
      who.spot = spots[i] ?? spots[i % Math.max(1, spots.length)] ?? { x: lantern.x, y: lantern.y + 1.2 * CELL_DEPTH };
      who.face = "up";
    });
  }
  const home = new Rng(seed, "homes");
  const taken = new Set<string>();
  for (const district of districts) {
    const mine = bearers.filter((b) => b.district === district.id && b.role === "stay");
    if (mine.length === 0) continue;
    const cells: Array<{ x: number; y: number; weight: number }> = [];
    for (let y = district.door[1] - 4; y <= district.door[1] + 4; y++) {
      for (let x = district.door[0] - 5; x <= district.door[0] + 5; x++) {
        const weight = standable(scene, x, y);
        if (weight === 0) continue;
        const centre = toWorld(x + 0.5, y + 0.5);
        if (line !== null && line.distance(centre) < 0.9 * CELL_DEPTH) continue;
        cells.push({ x, y, weight });
      }
    }
    // The cells nearest the door and the street first, in an order that is shuffled within the same distance.
    const ranked = home.shuffle(cells).sort((a, b) => Math.hypot(a.x - district.door[0], a.y - district.door[1]) / a.weight - Math.hypot(b.x - district.door[0], b.y - district.door[1]) / b.weight);
    mine.forEach((who, i) => {
      const cell = ranked[i % Math.max(1, ranked.length)] ?? { x: district.door[0], y: district.door[1] + 1 };
      const key = `${cell.x},${cell.y}`;
      const crowd = taken.has(key) ? 0.28 : 0.12;
      taken.add(key);
      who.spot = toWorld(cell.x + 0.5 + home.range(-crowd, crowd) * 2, cell.y + 0.5 + home.range(-crowd, crowd) * 2);
      if (line === null) who.face = (["down", "down", "left", "right"] as const)[home.int(4)] ?? "down";
      else {
        const at = line.at(line.along(who.spot));
        who.face = chooseDir(at.x - who.spot.x, at.y - who.spot.y, "down");
      }
    });
  }
  return { route, together: festival.together, seed, line, headStart, bearers, named, lighters, manager, lantern, plaza, mood };
}

// --- Where each of them is at a time -------------------------------------------------------------------------------------

/** One person at one moment of the night. */
export interface Walk {
  /** Whether they are on the map: a walker that has not come into the line yet is not. */
  visible: boolean;
  x: number;
  y: number;
  dir: Dir;
  moving: boolean;
  /** The ground covered since they came onto the map, in pixels, which sets the frame of their stride. */
  walked: number;
}

/** Where the head of the parade is `seconds` into the night, in pixels along the line. */
export const headAt = (plan: Plan, seconds: number): number => plan.headStart + WALK_PX_S * seconds;

/** Where a person is `seconds` into the night. */
export function walkOf(plan: Plan, who: Bearer, seconds: number): Walk {
  if (who.role === "stay" || plan.line === null) return { visible: true, x: who.spot.x, y: who.spot.y, dir: who.face, moving: false, walked: 0 };
  const line = plan.line;
  const along = headAt(plan, seconds) - who.slot * PAIR_GAP_PX - who.stagger;
  if (along < 0) return { visible: false, x: 0, y: 0, dir: "right", moving: false, walked: 0 };
  const lane = who.lane * LANE_PX;
  const on = line.at(Math.min(along, line.length));
  const x = on.x - on.ty * lane;
  const y = on.y + on.tx * lane;
  if (along < line.length) {
    return { visible: true, x, y, dir: chooseDir(on.tx, on.ty, "right"), moving: true, walked: along };
  }
  // In the plaza: a straight walk from the end of the line to the spot, and then standing there.
  const to = who.spot;
  const distance = Math.hypot(to.x - x, to.y - y);
  const gone = along - line.length;
  if (gone >= distance) return { visible: true, x: to.x, y: to.y, dir: "up", moving: false, walked: along };
  const f = distance <= 0 ? 1 : gone / distance;
  return { visible: true, x: x + (to.x - x) * f, y: y + (to.y - y) * f, dir: chooseDir(to.x - x, to.y - y, "up"), moving: true, walked: along };
}

/**
 * The second at which the head of the parade has come to its place in the plaza: the first of those who walk, at the front of the line, has walked the
 * line and the way from the end of it to the spot they stand on. 0 where nobody walks. The camera comes to the plaza for it, and the lantern is lit after it.
 */
export function headArrives(plan: Plan): number {
  const line = plan.line;
  if (line === null) return 0;
  const first = plan.bearers.filter((b) => b.role === "march").sort((a, b) => a.slot - b.slot || a.lane - b.lane)[0];
  if (first === undefined) return (line.length - plan.headStart) / WALK_PX_S;
  const end = line.at(line.length);
  const lane = first.lane * LANE_PX;
  const walk = Math.hypot(first.spot.x - (end.x - end.ty * lane), first.spot.y - (end.y + end.tx * lane));
  return (line.length + walk + first.slot * PAIR_GAP_PX + first.stagger - plan.headStart) / WALK_PX_S;
}

/**
 * How far the nearest of those who walk the parade is from a point of the map, in cells, and on which side of the point (-1 on its left, 1 on its right, 0
 * where it is within a cell of it in the way across): what the sound of the parade is set by. Null where nobody walks, or nobody is on the map yet.
 */
export function nearestWalker(plan: Plan, seconds: number, at: Pt): { cells: number; side: -1 | 0 | 1 } | null {
  let best: { cells: number; side: -1 | 0 | 1 } | null = null;
  for (const who of plan.bearers) {
    if (who.role !== "march") continue;
    const walk = walkOf(plan, who, seconds);
    if (!walk.visible) continue;
    const dx = walk.x - at.x;
    const cells = Math.hypot(dx, walk.y - at.y) / CELL;
    if (best === null || cells < best.cells) best = { cells, side: dx < -CELL ? -1 : dx > CELL ? 1 : 0 };
  }
  return best;
}

// --- The river ---------------------------------------------------------------------------------------------------------

export interface RiverLantern {
  /** Across the river, from 0 (the west bank) to 4 (the east bank), and where along it the lantern is at second 0, as a share of its length. */
  across: number;
  start: number;
  /** Pixels a second downstream, and the sway across it. */
  drift: number;
  sway: number;
  phase: number;
  scale: number;
  glow: Glow;
}

/** How many lanterns the river carries: a few when there is no parade, and more with more people. */
export function riverCount(route: Festival["route"], bearers: number, mood: Mood): number {
  if (route === "none") return Math.max(4, Math.round(6 * mood.river));
  return Math.min(60, Math.round((12 + bearers * 0.4) * mood.river));
}

export function riverLanterns(count: number, seed: number): RiverLantern[] {
  const rng = new Rng(seed, "river");
  const glows: readonly Glow[] = ["gold", "gold", "red", "gold", "blue"];
  return Array.from({ length: count }, () => ({
    across: rng.range(0.4, 3.6),
    start: rng.next(),
    drift: rng.range(5, 9),
    sway: rng.range(0.15, 0.4),
    phase: rng.range(0, Math.PI * 2),
    scale: rng.range(0.85, 1.15),
    glow: rng.pick(glows) ?? "gold",
  }));
}

/** Where a lantern of the river is `seconds` into the night: in pixels of the map, over the water of the row it has come to. */
export function riverAt(l: RiverLantern, seconds: number, bed: RiverBed): Pt {
  const length = Math.max(1, (bed.length - 1.5) * CELL_DEPTH);
  const along = (((l.start * length + l.drift * seconds) % length) + length) % length;
  const y = 0.75 * CELL_DEPTH + along;
  const [first, last] = bed[Math.min(bed.length - 1, Math.max(0, Math.floor(y / CELL_DEPTH)))] ?? [0, 0];
  const width = last - first + 1;
  // the sway stays inside the water: it is at most a quarter of a cell either side of where the lantern is across
  const x = (first + (l.across / 4) * width) * CELL + Math.sin(seconds * 0.6 + l.phase) * Math.min(l.sway, 0.25) * CELL;
  return { x, y };
}

// --- The storyteller ---------------------------------------------------------------------------------------------------

export interface StoryScene {
  teller: Standing;
  listeners: Array<{ x: number; y: number; dir: Dir; kind: Kind; phase: number }>;
}

/**
 * How far from the route of the parade, in cells, the storyteller and the ring of listeners stay at least. The lawn is four cells deep between the walls
 * of the teahouse yard and the main street, and the head of the parade ends at the corner of it, so this is about as much as it can be.
 */
export const STORY_CLEAR_CELLS = 2.2;

/** Where the storyteller stands: on the lawn beside the teahouse, far enough north of the main street where the parade walks that the ring of listeners does not meet it. */
export function storyCentre(scene: Scene): Pt {
  const door = anchorsOf(scene).teahouse;
  return toWorld(door[0] + 5.8, door[1] - 2.1);
}

/**
 * The scene of the hidden ending: a storyteller on the lawn beside the teahouse and the listeners round them in a ring that is open at the back, the
 * children at the front, where they do not hide the teller from the camera.
 */
export function storyScene(scene: Scene, seed: number): StoryScene {
  const rng = new Rng(seed, "story");
  const centre = storyCentre(scene);
  const listeners: StoryScene["listeners"] = [];
  const count = 9;
  for (let i = 0; i < count; i++) {
    // A half ring from the east of the teller through the south to the west of them.
    const angle = Math.PI * (0.06 + (0.88 * i) / (count - 1)) + rng.range(-0.05, 0.05);
    const front = Math.abs(angle - Math.PI / 2) < 0.26 * Math.PI;
    const radius = (0.95 + rng.range(-0.06, 0.1) + (i % 2) * 0.12) * CELL;
    const x = centre.x + Math.cos(angle) * radius * 1.25;
    const y = centre.y + Math.sin(angle) * radius * 0.5 + 0.1 * CELL_DEPTH;
    const dir: Dir = chooseDir(centre.x - x, centre.y - y, "up");
    const adult = kindFor(rng);
    listeners.push({ x, y, dir, kind: front ? "child" : adult === "child" ? "townswoman" : adult, phase: rng.next() });
  }
  return { teller: { id: "teller", x: centre.x, y: centre.y, dir: "down" }, listeners };
}
