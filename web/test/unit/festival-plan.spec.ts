import { expect, test } from "@playwright/test";
import type { Festival } from "../../src/page/ending.ts";
import { CELL, CELL_DEPTH } from "../../src/page/map/geometry.ts";
import {
  anchorsOf,
  bearerCounts,
  buildPlan,
  CAMP_GAP_PAIRS,
  districtsOf,
  headArrives,
  headAt,
  LANE_PX,
  lighterSpots,
  MAX_BEARERS,
  MEET,
  moodOf,
  nearestWalker,
  PAIR_GAP_PX,
  placeNamed,
  Polyline,
  plazaSpots,
  riverAt,
  riverBedOf,
  riverCount,
  riverLanterns,
  ROUTE_BRIDGE,
  ROUTE_LANE,
  riverSpan,
  storyCentre,
  STORY_CLEAR_CELLS,
  storyScene,
  toWorld,
  WALK_PX_S,
  walkOf,
} from "../../src/page/festival/plan.ts";
import { Rng, hashSeed } from "../../src/page/festival/rng.ts";
import { terrainAt } from "../../src/page/scene.ts";
import { TOWN_SCENE } from "../support/town-scene.ts";

// The festival night as a plan: the people of the picture, the way the parade walks, and where everybody is at a second. The plan has no PixiJS in it,
// and the scene is the real town of the bridge scenario.

const BEARERS = { p_li_house: 30, p_zhou_house: 26, p_accountant_home: 8, p_carpenter_home: 6, p_xiaoman_home: 4, p_he_home: 10 };
const NAMED = [
  { npc: "li_laotai", place: "p_li_house" },
  { npc: "li_da", place: "p_workshop" },
  { npc: "zhou_zhanggui", place: "p_zhou_house" },
  { npc: "zhou_niangzi", place: "p_zhou_house" },
  { npc: "zuzhang", place: "p_clan_hall" },
  { npc: "cha_laoban", place: "p_teahouse" },
  { npc: "old_he", place: "p_he_home" },
  { npc: "mujiang", place: "p_carpenter_home" },
];

const festival = (over: Partial<Festival> = {}): Festival => ({ route: "bridge", together: true, lighter: ["li_laotai", "zhou_zhanggui"], bearers: BEARERS, named: NAMED, ...over });

const total = (bearers: Record<string, number>): number => Object.values(bearers).reduce((sum, n) => sum + n, 0);
const SCENE = TOWN_SCENE;
/** Where a person can stand: not on the river, not in a building, not behind a wall. */
const WALKABLE = new Set(["street", "lane", "bank", "bridge", "pier", "grass"]);
const BARRIER_CELLS = new Set(SCENE.barriers.flatMap((b) => b.cells.map(([x, y]) => `${x},${y}`)));

/** Whether a point of the map is over a cell a person can stand on (a barrier of the lane is open on the night of a parade that goes round it). */
function walkable(x: number, y: number): boolean {
  const cx = Math.floor(x / CELL);
  const cy = Math.floor(y / CELL_DEPTH);
  if (BARRIER_CELLS.has(`${cx},${cy}`)) return true;
  const terrain = terrainAt(SCENE, cx, cy);
  return terrain !== null && WALKABLE.has(terrain);
}

test.describe("the seeded stream", () => {
  test("is the same for the same seed and salt, and another for another", () => {
    const a = new Rng(1805, "bearers");
    const b = new Rng(1805, "bearers");
    expect(Array.from({ length: 8 }, () => a.next())).toEqual(Array.from({ length: 8 }, () => b.next()));
    expect(new Rng(1805, "river").next()).not.toBe(new Rng(1805, "bearers").next());
    expect(new Rng(1806, "bearers").next()).not.toBe(new Rng(1805, "bearers").next());
    expect(hashSeed(1, "a")).not.toBe(hashSeed(1, "b"));
  });

  test("gives numbers in range, picks and shuffles without losing anyone", () => {
    const r = new Rng(7);
    for (let i = 0; i < 200; i++) {
      const x = r.next();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(r.int(5)).toBeLessThan(5);
      expect(r.range(2, 3)).toBeGreaterThanOrEqual(2);
    }
    expect(r.pick([])).toBeUndefined();
    expect([...r.shuffle([1, 2, 3, 4, 5, 6])].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

test.describe("a line of the map", () => {
  const line = new Polyline([
    [0, 0],
    [10, 0],
    [10, 10],
  ]);

  test("is measured in pixels of the map, and has the point and the way it runs at any distance along it", () => {
    expect(line.length).toBeCloseTo(10 * CELL + 10 * CELL_DEPTH, 6);
    expect(line.at(0)).toMatchObject({ x: 0, y: 0, tx: 1, ty: 0 });
    expect(line.at(5 * CELL)).toMatchObject({ x: 5 * CELL, y: 0, tx: 1, ty: 0 });
    const corner = line.at(10 * CELL + 1);
    expect(corner.x).toBeCloseTo(10 * CELL, 6);
    expect(corner).toMatchObject({ tx: 0, ty: 1 });
    // held to its ends
    expect(line.at(-5)).toMatchObject({ x: 0, y: 0 });
    expect(line.at(1e9).y).toBeCloseTo(10 * CELL_DEPTH, 6);
  });

  test("says how far along the nearest point is and how far off the point is", () => {
    expect(line.along({ x: 3 * CELL, y: 40 })).toBeCloseTo(3 * CELL, 6);
    expect(line.distance({ x: 3 * CELL, y: 40 })).toBeCloseTo(40, 6);
    expect(line.along({ x: 12 * CELL, y: 5 * CELL_DEPTH })).toBeCloseTo(10 * CELL + 5 * CELL_DEPTH, 6);
  });
});

test.describe("the way the parade goes", () => {
  for (const [name, route] of [
    ["the bridge", ROUTE_BRIDGE],
    ["the lane", ROUTE_LANE],
  ] as const) {
    test(`over ${name} keeps to streets, the bridge, the lane and the bank from one end to the other`, () => {
      const line = new Polyline(route);
      for (let u = 0; u <= line.length; u += 6) {
        const at = line.at(u);
        expect(walkable(at.x, at.y), `${name} at ${Math.round(u)} px: ${Math.floor(at.x / CELL)},${Math.floor(at.y / CELL_DEPTH)}`).toBe(true);
      }
    });
  }

  test("is met by the camera where the head of the parade is at that second", () => {
    for (const route of ["bridge", "lane"] as const) {
      const plan = buildPlan(festival({ route }), SCENE, 11, "ending_barely");
      const line = plan.line;
      if (line === null) throw new Error("no line");
      const meet = MEET[route];
      const at = line.at(headAt(plan, meet.seconds));
      const point = toWorld(meet.at[0], meet.at[1]);
      expect(Math.hypot(at.x - point.x, at.y - point.y)).toBeLessThan(0.01);
    }
  });

  test("takes the head to the plaza in about half a minute at the pace of a procession", () => {
    for (const route of ["bridge", "lane"] as const) {
      const plan = buildPlan(festival({ route }), SCENE, 11, "ending_barely");
      const seconds = headArrives(plan);
      expect(seconds).toBeGreaterThan(20);
      expect(seconds).toBeLessThan(40);
      expect(WALK_PX_S).toBeLessThan(40);
    }
    expect(buildPlan(festival({ route: "none", lighter: [] }), SCENE, 11, "ending_split").line).toBeNull();
  });
});

test.describe("how many people are drawn, and where they live", () => {
  test("is the number the ending gives for each district, kept in the order of the ending, with a district the town does not have left out", () => {
    const known = districtsOf(festival(), SCENE).map((d) => d.id);
    expect(known).toEqual(Object.keys(BEARERS));
    expect(bearerCounts(festival(), known)).toEqual(Object.entries(BEARERS));
    expect(bearerCounts(festival({ bearers: { ...BEARERS, p_nowhere: 9 } }), districtsOf(festival({ bearers: { ...BEARERS, p_nowhere: 9 } }), SCENE).map((d) => d.id))).toEqual(Object.entries(BEARERS));
    expect(bearerCounts(festival({ bearers: {} }), [])).toEqual([]);
  });

  test("is shared down to at most 120 by the largest remainder when the ending names more", () => {
    const many = { p_li_house: 300, p_zhou_house: 200, p_accountant_home: 100, p_he_home: 1 };
    const ids = Object.keys(many);
    const counts = bearerCounts(festival({ bearers: many }), ids);
    expect(counts.reduce((sum, [, n]) => sum + n, 0)).toBe(MAX_BEARERS);
    // in proportion: 300:200:100:1 of 601
    expect(counts.find(([id]) => id === "p_li_house")?.[1]).toBe(60);
    expect(counts.find(([id]) => id === "p_zhou_house")?.[1]).toBe(40);
    const plan = buildPlan(festival({ bearers: many }), SCENE, 3, "ending_full");
    expect(plan.bearers).toHaveLength(MAX_BEARERS);
  });

  test("adds up by district to what the ending says, and no more than 120 are ever drawn", () => {
    const plan = buildPlan(festival(), SCENE, 12345, "ending_full");
    const by: Record<string, number> = {};
    for (const b of plan.bearers) by[b.district] = (by[b.district] ?? 0) + 1;
    expect(by).toEqual(BEARERS);
    expect(plan.bearers).toHaveLength(total(BEARERS));
    expect(plan.bearers.length).toBeLessThanOrEqual(MAX_BEARERS);
    expect(new Set(plan.bearers.map((b) => b.id)).size).toBe(plan.bearers.length);
  });

  test("is the same plan for the same seed, and another for another seed", () => {
    const a = buildPlan(festival(), SCENE, 4242, "ending_full");
    const b = buildPlan(festival(), SCENE, 4242, "ending_full");
    const c = buildPlan(festival(), SCENE, 4243, "ending_full");
    expect(a.bearers).toEqual(b.bearers);
    expect(a.named).toEqual(b.named);
    expect(c.bearers.map((x) => x.kind)).not.toEqual(a.bearers.map((x) => x.kind));
    expect(c.bearers.map((x) => x.spot)).not.toEqual(a.bearers.map((x) => x.spot));
    // the same people in the same places whatever the seed: the seed only changes who is a man, a woman or a child, and where in the district they stand
    expect(c.bearers.map((x) => x.district)).toEqual(a.bearers.map((x) => x.district));
  });

  test("are three kinds of passer-by, all of them in a crowd, and a family's lantern by the house the person lives in", () => {
    const plan = buildPlan(festival(), SCENE, 99, "ending_full");
    const kinds = new Set(plan.bearers.map((b) => b.kind));
    expect(kinds).toEqual(new Set(["townsman", "townswoman", "child"]));
    for (const b of plan.bearers) {
      expect(b.glow).toBe(b.district === "p_li_house" ? "red" : b.district === "p_zhou_house" ? "blue" : "gold");
      // the houses west of the river are the Li side, those east of it the Zhou side
      const west = ["p_li_house", "p_accountant_home", "p_carpenter_home", "p_xiaoman_home"].includes(b.district);
      expect(b.camp).toBe(west ? "li" : "zhou");
    }
  });
});

test.describe("who walks and who stays", () => {
  test("is most of each district walking where the parade walks, and the rest standing by their doors", () => {
    for (const route of ["bridge", "lane"] as const) {
      const plan = buildPlan(festival({ route }), SCENE, 5, "ending_full");
      const walking = plan.bearers.filter((b) => b.role === "march");
      expect(walking.length / plan.bearers.length).toBeGreaterThan(0.6);
      expect(walking.length).toBeLessThan(plan.bearers.length);
      for (const b of plan.bearers.filter((x) => x.role === "stay")) {
        const door = districtsOf(festival({ route }), SCENE).find((d) => d.id === b.district)?.door ?? [0, 0];
        // within a few cells of the door, on ground a person can stand on, and not in the way of the parade
        expect(Math.abs(b.spot.x / CELL - door[0])).toBeLessThan(6.5);
        expect(Math.abs(b.spot.y / CELL_DEPTH - door[1])).toBeLessThan(5.5);
        const terrain = terrainAt(SCENE, Math.floor(b.spot.x / CELL), Math.floor(b.spot.y / CELL_DEPTH));
        expect(["street", "lane", "bank", "grass"]).toContain(terrain);
      }
    }
  });

  test("is everybody staying where there is no parade, and the district by the door", () => {
    const plan = buildPlan(festival({ route: "none", lighter: [], together: false }), SCENE, 5, "ending_split");
    expect(plan.line).toBeNull();
    expect(plan.bearers.every((b) => b.role === "stay")).toBe(true);
    expect(plan.lighters).toEqual([]);
    for (const b of plan.bearers) expect(walkOf(plan, b, 0)).toMatchObject({ visible: true, moving: false, x: b.spot.x, y: b.spot.y });
  });

  test("has a full night walk in greater numbers than a night that is only just enough", () => {
    expect(moodOf("ending_full").march).toBeGreaterThan(moodOf("ending_barely").march);
    expect(moodOf("ending_barely").march).toBeGreaterThan(moodOf("ending_split").march);
    expect(moodOf("ending_full").glow).toBeGreaterThan(moodOf("ending_barely").glow);
    expect(moodOf("ending_barely").river).toBeGreaterThan(moodOf("ending_split").river);
    const full = buildPlan(festival(), SCENE, 5, "ending_full").bearers.filter((b) => b.role === "march").length;
    const barely = buildPlan(festival(), SCENE, 5, "ending_barely").bearers.filter((b) => b.role === "march").length;
    expect(full).toBeGreaterThan(barely);
  });
});

test.describe("the two families", () => {
  const walkers = (together: boolean) => buildPlan(festival({ together }), SCENE, 8, "ending_barely").bearers.filter((b) => b.role === "march");

  test("walk side by side where they are together: a pair is one of each, left and right, and the pairs follow one another with no gap between the camps", () => {
    const list = walkers(true);
    const slots = new Map<number, typeof list>();
    for (const b of list) slots.set(b.slot, [...(slots.get(b.slot) ?? []), b]);
    const mixed = [...slots.values()].filter((pair) => pair.length === 2 && pair[0]?.camp !== pair[1]?.camp);
    expect(mixed.length).toBeGreaterThan(8);
    for (const pair of mixed) expect(new Set(pair.map((b) => b.lane))).toEqual(new Set([-1, 1]));
    // no empty stretch in the line
    const used = [...slots.keys()].sort((a, b) => a - b);
    expect(used[0]).toBe(0);
    for (let i = 1; i < used.length; i++) expect((used[i] as number) - (used[i - 1] as number)).toBe(1);
    // nobody shares a place in the line
    expect(new Set(list.map((b) => `${b.slot}/${b.lane}`)).size).toBe(list.length);
  });

  test("walk at the two ends where they are apart: the Li side at the head, a gap, and the Zhou side behind", () => {
    const list = walkers(false);
    const li = list.filter((b) => b.camp === "li");
    const zhou = list.filter((b) => b.camp === "zhou");
    const lastLi = Math.max(...li.map((b) => b.slot));
    const firstZhou = Math.min(...zhou.map((b) => b.slot));
    expect(Math.min(...li.map((b) => b.slot))).toBe(0);
    expect(firstZhou - lastLi).toBeGreaterThan(CAMP_GAP_PAIRS);
    expect(new Set(list.map((b) => `${b.slot}/${b.lane}`)).size).toBe(list.length);
  });

  test("stand mixed in the plaza where they are together, and one camp behind the other, the head nearer the lantern, where they are not", () => {
    const near = (plan: ReturnType<typeof buildPlan>, camp: "li" | "zhou"): number => {
      const spots = plan.bearers.filter((b) => b.role === "march" && b.camp === camp).map((b) => Math.hypot(b.spot.x - plan.lantern.x, b.spot.y - plan.lantern.y));
      return spots.reduce((sum, d) => sum + d, 0) / spots.length;
    };
    const apart = buildPlan(festival({ together: false }), SCENE, 8, "ending_barely");
    // the Li side walks at the head, so it stands nearer the lantern, by a good way
    expect(near(apart, "zhou") - near(apart, "li")).toBeGreaterThan(CELL * 1.5);
    const together = buildPlan(festival({ together: true }), SCENE, 8, "ending_barely");
    expect(Math.abs(near(together, "zhou") - near(together, "li"))).toBeLessThan(CELL * 1.2);
  });
});

test.describe("the plaza before the hall", () => {
  test("has a spot for everybody who walks, none of them on the lantern or on a person who stands there, all on ground a person can stand on", () => {
    const plan = buildPlan(festival({ bearers: { p_li_house: 70, p_zhou_house: 50 } }), SCENE, 21, "ending_full");
    const spots = plan.bearers.filter((b) => b.role === "march").map((b) => b.spot);
    expect(new Set(spots.map((s) => `${s.x.toFixed(2)},${s.y.toFixed(2)}`)).size).toBe(spots.length);
    for (const s of spots) {
      expect(s.x).toBeGreaterThanOrEqual(plan.plaza.x0 - 1);
      expect(s.x).toBeLessThanOrEqual(plan.plaza.x1 + 1);
      expect(s.y).toBeGreaterThanOrEqual(plan.plaza.y0 - 1);
      expect(s.y).toBeLessThanOrEqual(plan.plaza.y1 + 1);
      expect(walkable(s.x, s.y)).toBe(true);
      expect(Math.hypot(s.x - plan.lantern.x, (s.y - plan.lantern.y) * (CELL / CELL_DEPTH))).toBeGreaterThan(0.55 * CELL);
      for (const l of plan.lighters) expect(Math.hypot(s.x - l.x, (s.y - l.y) * (CELL / CELL_DEPTH))).toBeGreaterThan(0.5 * CELL);
    }
  });

  test("gives the spots nearest the lantern first to those who come first, as many as are asked for where the box can hold them", () => {
    const rng = new Rng(1, "plaza");
    const from = toWorld(50.5, 14.6);
    const box = { x0: 40.4 * CELL, y0: 13.3 * CELL_DEPTH, x1: 49.2 * CELL, y1: 14.85 * CELL_DEPTH };
    const spots = plazaSpots(box, [from], from, rng, 30);
    expect(spots.length).toBeGreaterThanOrEqual(30);
    const near = (p: { x: number; y: number }): number => Math.hypot(p.x - from.x, p.y - from.y);
    for (let i = 1; i < spots.length; i++) expect(near(spots[i] as { x: number; y: number })).toBeGreaterThanOrEqual(near(spots[i - 1] as { x: number; y: number }) - 1e-9);
    // a crowd that the open grid cannot hold is put closer, and nobody is left without a spot
    expect(plazaSpots(box, [from], from, new Rng(1, "plaza"), 90).length).toBeGreaterThanOrEqual(90);
  });

  test("is on the side the parade comes from: the west of the lantern for the bridge, the east for the lane", () => {
    const bridge = buildPlan(festival({ route: "bridge" }), SCENE, 21, "ending_full");
    const lane = buildPlan(festival({ route: "lane" }), SCENE, 21, "ending_full");
    for (const b of bridge.bearers.filter((x) => x.role === "march")) expect(b.spot.x).toBeLessThan(bridge.lantern.x);
    for (const b of lane.bearers.filter((x) => x.role === "march")) expect(b.spot.x).toBeGreaterThan(lane.lantern.x);
  });
});

test.describe("where a person is at a second", () => {
  const plan = buildPlan(festival(), SCENE, 31, "ending_full");
  const walker = plan.bearers.filter((b) => b.role === "march").sort((a, b) => a.slot - b.slot)[0];
  if (walker === undefined) throw new Error("nobody walks");

  test("is behind the head by the place in the line, and walks along the route at the pace of the parade, facing the way it goes", () => {
    // the first pair is a little behind the head
    const a = walkOf(plan, walker, 5);
    const b = walkOf(plan, walker, 6);
    expect(a.visible && b.visible).toBe(true);
    expect(a.moving && b.moving).toBe(true);
    expect(a.dir).toBe("right");
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(WALK_PX_S, 0);
    expect(b.walked - a.walked).toBeCloseTo(WALK_PX_S, 6);
    // the lanes are on the two sides of the way, one lane's width off it
    const other = plan.bearers.find((x) => x.role === "march" && x.slot === walker.slot && x.lane !== walker.lane);
    if (other !== undefined) {
      const c = walkOf(plan, walker, 5);
      const d = walkOf(plan, other, 5);
      expect(Math.abs(c.y - d.y)).toBeGreaterThan(LANE_PX);
    }
  });

  test("is not on the map before it has come into the line, and is in front of the one behind it", () => {
    const last = plan.bearers.filter((b) => b.role === "march").sort((x, y) => y.slot - x.slot)[0];
    if (last === undefined) throw new Error("nobody walks");
    const earliest = walkOf(plan, last, 0);
    // the end of a line of this length begins off the far end of the street
    expect(earliest.visible).toBe(false);
    expect(walkOf(plan, last, 60).visible).toBe(true);
    for (let t = 0; t < 30; t += 3) {
      const front = walkOf(plan, walker, t);
      const second = plan.bearers.find((x) => x.role === "march" && x.slot === walker.slot + 3 && x.lane === walker.lane);
      if (second === undefined) continue;
      const behind = walkOf(plan, second, t);
      if (behind.visible && front.visible && front.dir === "right" && behind.dir === "right") expect(front.x).toBeGreaterThan(behind.x);
    }
  });

  test("goes up onto the deck of the bridge and over it, then on to the plaza, and stands there facing the hall", () => {
    const xs: number[] = [];
    for (let t = 0; t < 60; t += 0.5) {
      const s = walkOf(plan, walker, t);
      if (s.visible) xs.push(s.x);
    }
    expect(xs.some((x) => x > 24 * CELL && x < 30 * CELL)).toBe(true);
    const end = walkOf(plan, walker, 200);
    expect(end).toMatchObject({ visible: true, moving: false, dir: "up", x: walker.spot.x, y: walker.spot.y });
    // everybody is at their spot some time after the head arrives
    for (const b of plan.bearers) {
      const s = walkOf(plan, b, 400);
      expect(s.moving).toBe(false);
      expect(s.visible).toBe(true);
    }
  });

  test("covers the same ground whichever time it is asked for first (a function of the second, nothing kept)", () => {
    const first = [0, 7.3, 15, 22.2].map((t) => walkOf(plan, walker, t));
    const again = [22.2, 15, 7.3, 0].reverse().map((t) => walkOf(plan, walker, t));
    expect(again).toEqual(first);
    expect(PAIR_GAP_PX).toBeGreaterThan(LANE_PX);
  });

  test("goes round by the lane where the bridge is not whole, facing north on the stretch of the lane that runs up the east side of the temple", () => {
    const lane = buildPlan(festival({ route: "lane" }), SCENE, 31, "ending_barely");
    const first = lane.bearers.filter((b) => b.role === "march").sort((a, b) => a.slot - b.slot)[0];
    if (first === undefined) throw new Error("nobody walks");
    const dirs = new Set<string>();
    for (let t = 10; t < 45; t += 0.5) {
      const s = walkOf(lane, first, t);
      if (s.visible && s.moving) dirs.add(s.dir);
    }
    expect(dirs.has("up")).toBe(true);
    expect(dirs.has("right")).toBe(true);
    expect(dirs.has("left")).toBe(true);
  });
});

test.describe("the named people and the people who light the main lantern", () => {
  test("stand at the places the ending names, the k-th person of a place on the k-th of its door and stands", () => {
    const standing = placeNamed(NAMED, SCENE);
    expect(standing.map((s) => s.id)).toEqual(NAMED.map((n) => n.npc));
    const zhou = SCENE.places.find((p) => p.id === "p_zhou_house");
    if (zhou === undefined || zhou.door === null) throw new Error("no house");
    const at = (id: string) => standing.find((s) => s.id === id);
    expect(at("zhou_zhanggui")).toMatchObject({ x: (zhou.door[0] + 0.5) * CELL, y: (zhou.door[1] + 0.5) * CELL_DEPTH });
    const stand = zhou.stands[0] as readonly [number, number];
    expect(at("zhou_niangzi")).toMatchObject({ x: (stand[0] + 0.5) * CELL, y: (stand[1] + 0.5) * CELL_DEPTH });
  });

  test("leave out the people who light the lantern, who stand at it", () => {
    const standing = placeNamed(NAMED, SCENE, new Set(["li_laotai", "zhou_zhanggui"]));
    expect(standing.map((s) => s.id)).not.toContain("li_laotai");
    expect(standing.map((s) => s.id)).not.toContain("zhou_zhanggui");
    expect(standing).toHaveLength(NAMED.length - 2);
  });

  test("have the lantern lit by both heads side by side, by the elder alone, or by nobody", () => {
    const lantern = anchorsOf(SCENE).lantern;
    const both = lighterSpots(["li_laotai", "zhou_zhanggui"], lantern);
    expect(both).toHaveLength(2);
    expect(both[0]?.y).toBe(both[1]?.y);
    expect((both[0] as { x: number }).x + (both[1] as { x: number }).x).toBeCloseTo(2 * lantern.x, 6);
    expect(both[0]?.x).toBeLessThan(both[1]?.x ?? 0);
    // one on each side of the lantern, on the same ground as it, each facing it
    expect(both.map((l) => l.dir)).toEqual(["right", "left"]);
    expect(both.every((l) => l.y === lantern.y)).toBe(true);
    const one = lighterSpots(["zuzhang"], lantern);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatchObject({ id: "zuzhang", y: lantern.y, dir: "right" });
    expect(one[0]?.x).toBeLessThan(lantern.x);
    expect(lighterSpots([], lantern)).toEqual([]);
    const plan = buildPlan(festival({ lighter: ["zuzhang"], together: false }), SCENE, 1, "ending_barely");
    expect(plan.lighters.map((l) => l.id)).toEqual(["zuzhang"]);
    expect(plan.named.map((n) => n.id)).toContain("li_laotai");
  });

  test("find the lantern before the door of the hall", () => {
    const hall = SCENE.places.find((p) => p.id === "p_clan_hall");
    if (hall === undefined || hall.door === null) throw new Error("no hall");
    const lantern = anchorsOf(SCENE).lantern;
    expect(lantern.x).toBeCloseTo((hall.door[0] + 0.5) * CELL, 6);
    expect(lantern.y).toBeGreaterThan((hall.door[1] + 1) * CELL_DEPTH);
  });
});

test.describe("the storyteller's scene", () => {
  test("is on the lawn beside the teahouse and off the street the parade walks, the teller in the middle of a ring of listeners that is open at the back", () => {
    const story = storyScene(SCENE, 77);
    expect(story.listeners).toHaveLength(9);
    const centre = storyCentre(SCENE);
    expect(story.teller).toMatchObject({ x: centre.x, y: centre.y, dir: "down" });
    for (const who of [story.teller, ...story.listeners]) {
      expect(terrainAt(SCENE, Math.floor(who.x / CELL), Math.floor(who.y / CELL_DEPTH)), `${who.x},${who.y}`).toBe("grass");
      // not on the two rows of the main street, where the parade walks
      expect(who.y).toBeLessThan(15 * CELL_DEPTH);
    }
    // the ring is below the teller and not behind them: no listener is north of the teller
    for (const l of story.listeners) expect(l.y).toBeGreaterThan(centre.y);
    // the children stand at the front, where they do not hide the teller from the camera
    const front = story.listeners.filter((l) => Math.abs(l.x - centre.x) < 0.4 * CELL);
    expect(front.length).toBeGreaterThan(0);
    for (const l of front) expect(l.kind).toBe("child");
    // each listener faces the teller
    for (const l of story.listeners) expect(["up", "left", "right", "down"]).toContain(l.dir);
  });

  test("keeps the teller and the ring of listeners clear of the route of the parade, by the bridge and by the lane", () => {
    const story = storyScene(SCENE, 77);
    const apart = (px: number, py: number, route: readonly (readonly [number, number])[]): number => {
      let least = Number.POSITIVE_INFINITY;
      for (let i = 0; i + 1 < route.length; i++) {
        const [ax, ay] = route[i] as readonly [number, number];
        const [bx, by] = route[i + 1] as readonly [number, number];
        const dx = bx - ax;
        const dy = by - ay;
        const along = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        least = Math.min(least, Math.hypot(px - (ax + along * dx), py - (ay + along * dy)));
      }
      return least;
    };
    for (const route of [ROUTE_BRIDGE, ROUTE_LANE]) {
      for (const who of [story.teller, ...story.listeners]) expect(apart(who.x / CELL, who.y / CELL_DEPTH, route), `${who.x},${who.y}`).toBeGreaterThanOrEqual(STORY_CLEAR_CELLS);
    }
  });

  test("is the same for the same seed, and a different crowd for another", () => {
    expect(storyScene(SCENE, 77)).toEqual(storyScene(SCENE, 77));
    expect(storyScene(SCENE, 78).listeners.map((l) => l.kind)).not.toEqual(storyScene(SCENE, 77).listeners.map((l) => l.kind));
  });
});

test.describe("the river", () => {
  test("carries more lanterns the more people there are, a few where there is no parade, and no more than sixty", () => {
    const mood = moodOf("ending_full");
    const few = riverCount("bridge", 20, mood);
    const many = riverCount("bridge", 120, mood);
    expect(many).toBeGreaterThan(few);
    expect(riverCount("none", 120, moodOf("ending_split"))).toBeLessThan(few);
    expect(riverCount("bridge", 5000, mood)).toBeLessThanOrEqual(60);
    expect(riverCount("none", 0, moodOf("ending_split"))).toBeGreaterThanOrEqual(4);
    expect(riverLanterns(many, 3)).toHaveLength(many);
    expect(riverLanterns(many, 3)).toEqual(riverLanterns(many, 3));
  });

  test("is read row by row, because the river bends: a column further east below the bridge, and the water of the row above where the bridge crosses", () => {
    expect(riverSpan(SCENE)).toEqual([25, 29]);
    const bed = riverBedOf(SCENE);
    expect(bed).toHaveLength(SCENE.height);
    expect(bed[3]).toEqual([25, 28]);
    expect(bed[15]).toEqual(bed[14]);
    expect(bed[16]).toEqual(bed[14]);
    expect(bed[26]).toEqual([26, 29]);
  });

  test("drifts down the river and stays on the water of the row it is in, whatever the second", () => {
    const bed = riverBedOf(SCENE);
    for (const l of riverLanterns(40, 9)) {
      for (const t of [0, 5, 31, 90, 1000]) {
        const at = riverAt(l, t, bed);
        const [first, last] = bed[Math.floor(at.y / CELL_DEPTH)] as readonly [number, number];
        expect(at.x).toBeGreaterThan(first * CELL);
        expect(at.x).toBeLessThan((last + 1) * CELL);
        expect(at.y).toBeGreaterThan(0);
        expect(at.y).toBeLessThan(SCENE.height * CELL_DEPTH);
      }
      expect(riverAt(l, 10, bed).y).not.toBe(riverAt(l, 20, bed).y);
    }
  });
});

test.describe("how near the parade is, for the sound of it", () => {
  const plan = buildPlan(festival(), SCENE, 31, "ending_full");

  test("is the distance in cells to the nearest of those who walk, and on which side of the point they are", () => {
    // a second in which the line is on the street west of the bridge, with the point on the street ahead of it
    const near = nearestWalker(plan, 5, toWorld(40, 15.5));
    expect(near).not.toBeNull();
    expect(near?.cells).toBeGreaterThan(5);
    expect(near?.side).toBe(-1);
    const among = nearestWalker(plan, 5, { x: walkOf(plan, plan.bearers.find((b) => b.role === "march") as (typeof plan.bearers)[number], 5).x, y: toWorld(0, 15.5).y });
    expect(among?.cells).toBeLessThan(1.5);
    // far to the east of everybody the walkers are on the left, and far to the west of the lane's walkers, on the east road, they are on the right
    expect(nearestWalker(plan, 5, toWorld(54, 15.5))?.side).toBe(-1);
    const lane = buildPlan(festival({ route: "lane" }), SCENE, 31, "ending_barely");
    expect(nearestWalker(lane, 8, toWorld(30, 24))?.side).toBe(1);
  });

  test("is nothing where nobody walks, or nobody is on the map yet", () => {
    expect(nearestWalker(buildPlan(festival({ route: "none", lighter: [] }), SCENE, 31, "ending_split"), 5, toWorld(10, 10))).toBeNull();
    const lane = buildPlan(festival({ route: "lane" }), SCENE, 31, "ending_barely");
    // the head of the lane parade comes onto the map after four seconds
    expect(nearestWalker(lane, 0, toWorld(44, 24))).toBeNull();
    expect(nearestWalker(lane, 20, toWorld(44, 24))).not.toBeNull();
  });

  test("gets smaller as the camera goes to the walkers", () => {
    const far = nearestWalker(plan, 12, toWorld(5, 5)) as { cells: number };
    const close = nearestWalker(plan, 12, toWorld(walkOfFirst(12).x / CELL, 15.5)) as { cells: number };
    expect(close.cells).toBeLessThan(far.cells);
  });

  function walkOfFirst(seconds: number): { x: number } {
    const first = plan.bearers.filter((b) => b.role === "march").sort((a, b) => a.slot - b.slot)[0];
    if (first === undefined) throw new Error("nobody walks");
    return walkOf(plan, first, seconds);
  }
});
