import type { Page } from "@playwright/test";
import { frameRect } from "../../src/page/map/manifest.ts";
import { pieceColour } from "../../src/page/map/palette.ts";
import { CELL, CELL_DEPTH } from "../../src/page/map/projection.ts";
import { NAMED_FIGURES, PLAYER_SPRITE } from "../../src/page/map/sprites.ts";
import { expect, LanternPage, test } from "../support/fixtures.ts";
import { hideTheSlip, mouseOnMap, onTheMap } from "../support/play.ts";
import * as fake from "../support/slice.ts";
import { alphaOfFrame, atlasTexel, clearPoint, clearStage, drawing, flatPoint, inject, mapStats, MANIFEST, MORNING, near, NIGHT, sampleAt, solidPoints, spread, stand } from "../support/sprites.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

/** How far under the hanging point of a lit lantern the centre of its glow is, as the manifest says. */
const GLOW_Y = MANIFEST.sprites.get("prop.door_lantern_lit")?.glow?.offset.y ?? 0;
/** The eight people of the cast whose figures come first in the kit. */
const FIRST_EIGHT = ["zuzhang", "cha_laoban", "zhou_huoji", "li_laotai", "li_da", "li_er", "zhou_zhanggui", "old_he"];
/** The other twelve. */
const OTHER_TWELVE = Object.keys(NAMED_FIGURES).filter((id) => !FIRST_EIGHT.includes(id));

/** Opens the town held at a tick and waits until the map has drawn its people, its places and the pixels that picking looks into. */
async function openTown(lantern: LanternPage, query = MORNING, until = 700): Promise<void> {
  await lantern.open(query, { menu: false });
  await lantern.waitForTick(until);
  await expect.poll(() => mapStats(lantern.page).then((s) => s.people === 20 && s.alpha)).toBe(true);
  await lantern.page.waitForFunction(() => {
    const frame = window.__lantern.client.state.frame as unknown as { npcs: Array<{ id: string; x: number; y: number }> } | null;
    const view = window.__lantern.view;
    return frame !== null && frame.npcs.every((n) => {
      const at = view.screenPositionOf(n.id);
      const to = view.cellToScreen(n.x, n.y);
      return at !== null && Math.abs(at.x - to.x) < 0.01 && Math.abs(at.y - to.y) < 0.01;
    });
  });
  // The slip lies over the top of the map: the tests that point at the figures have it taken off the page.
  await hideTheSlip(lantern.page);
}

const canvasOf = (lantern: LanternPage) => lantern.page.getByTestId("map");
const bodyOf = (page: Page, id: string) => page.evaluate((who) => window.__lantern.view.bodyPositionOf(who), id);
const footOf = (page: Page, id: string) => page.evaluate((who) => window.__lantern.view.screenPositionOf(who), id);
/** Where a point of the world is on the map's element. */
const project = (page: Page, wx: number, wy: number) => page.evaluate(([x, y]) => window.__lantern.view.camera.project(x as number, y as number), [wx, wy]);
const pickAt = (page: Page, x: number, y: number) => page.evaluate(([sx, sy]) => window.__lantern.view.pickAt(sx as number, sy as number), [x, y]);

/**
 * Compares the pixels that picking looks into with the atlas as the test decodes it for itself: the first and the last frame of every
 * sprite of the kit, which between them lie in every strip of the atlas that has a sprite in it, at a grid of points over each frame.
 * Returns how many points it compared.
 */
async function comparePickingPixels(page: Page): Promise<number> {
  let compared = 0;
  for (const def of MANIFEST.sprites.values()) {
    const last = (def.frames.get(1)?.length ?? 1) - 1;
    for (const index of new Set([0, last])) {
      const { w, scale, alpha } = await alphaOfFrame(page, def.id, index);
      // A grid of points over the frame, in the pixels of the sprite at scale 1.
      const points: Array<[number, number]> = [];
      for (let v = 0; v < def.h; v += 3) for (let u = 0; u < def.w; u += 3) points.push([u, v]);
      const got = await page.evaluate(([id, i, list]) => (list as Array<[number, number]>).map(([u, v]) => window.__lantern.view.alphaAt(id as string, i as number, u, v)), [def.id, index, points] as const);
      const want = points.map(([u, v]) => alpha[Math.floor(v * scale) * w + Math.floor(u * scale)]);
      expect(got, `${def.id} #${index}`).toEqual(want);
      compared += points.length;
    }
  }
  return compared;
}

/**
 * Near the middle of a figure's body the pixel of the screen is the pixel of the atlas in the frame that is drawn. The test looks for the most
 * even colour near the middle of the body (a pixel on an edge is filtered, and is not the pixel of the atlas), and for the pixel of the screen
 * at the same place. The people have to stand apart, so that nobody has a neighbour over the middle of his body (see `spread`), and the map has
 * to hold the frame of a breath (the player asked for less motion), so that the frame is the same when the test looks at the atlas and at the screen.
 */
async function figureIsAtlas(page: Page, id: string): Promise<void> {
  const now = (await drawing(page)).people.find((q) => q.id === id);
  const def = MANIFEST.sprites.get(now?.sprite ?? "");
  if (now === undefined || def === undefined) throw new Error(`${id} is not a figure`);
  const [u, v] = await flatPoint(page, def.id, now.index, def.ax, def.ay - now.mid, 16);
  const got = await page.evaluate(
    ([who, du, dv, index]) => {
      const view = window.__lantern.view;
      const at = view.bodyPositionOf(who as string);
      const d = view.drawing().people.find((q) => q.id === who);
      if (at === null || d === undefined || d.index !== index) return null;
      const zoom = view.camera.zoom;
      return view.sample(at.x + (du as number) * zoom, at.y + (dv as number) * zoom);
    },
    [id, u - def.ax, v - (def.ay - now.mid), now.index] as const,
  );
  const texel = await atlasTexel(page, def.id, now.index, u, v);
  expect(near(got, texel), `${id}: the screen has ${String(got)} and the atlas ${texel.join(",")} at ${u},${v} of frame ${now.index}`).toBe(true);
}

/** Holds the map still for a player who asked for less motion, or lets it go. */
async function holdStill(page: Page, on: boolean): Promise<void> {
  await page.emulateMedia({ reducedMotion: on ? "reduce" : "no-preference" });
  await expect.poll(async () => (await mapStats(page)).calm).toBe(on);
}

/**
 * Keeps what the map says when the ground is clicked, and does not pass it on: the page would answer by
 * walking the player there, which lets the world run and takes the people away from where the test put them.
 */
async function spyOnGround(page: Page): Promise<void> {
  await page.evaluate(() => {
    const spy = window as unknown as { __ground: unknown[] };
    spy.__ground = [];
    const view = window.__lantern.view;
    view.events = { ...view.events, ground: (hit) => { spy.__ground.push(hit); } };
  });
}
const grounds = (page: Page) => page.evaluate(() => (window as unknown as { __ground: Array<{ x: number; y: number; place: string | null }> }).__ground);

test.describe("the people on the map are figures of the sprite kit", () => {
  test("have a figure of the kit: their own for each of the twenty and for the manager, drawn from the atlas that was fetched once", async ({ lantern, servers }) => {
    const page = lantern.page;
    const from = servers.app.requests.length;
    await openTown(lantern);
    // The files came once each, from the page's own origin, with the type of an image, under the policy of the page (before the test looks at the atlas for itself).
    const served = servers.app.requests.slice(from).filter((r) => r.path.startsWith("/sprites/"));
    expect(served.map((r) => [r.path, r.status, r.contentType])).toEqual([
      ["/sprites/manifest.json", 200, "application/json; charset=utf-8"],
      ["/sprites/atlas-1x.webp", 200, "image/webp"],
    ]);
    expect(served.every((r) => r.csp === servers.app.csp)).toBe(true);
    await inject(page, { weather: "clear" });
    expect(await mapStats(page)).toMatchObject({ people: 20, figures: 21, places: 21, atlas: 1 });
    const people = (await drawing(page)).people;
    expect(people).toHaveLength(21);
    const expected: Record<string, string> = { ...NAMED_FIGURES, player: PLAYER_SPRITE };
    for (const p of people) expect(p.sprite, p.id).toBe(expected[p.id]);
    // Nobody shares a figure: the twenty and the manager are twenty-one.
    expect(new Set(people.map((p) => p.sprite)).size).toBe(21);
    for (const p of people.filter((q) => q.sprite !== null)) expect(p.anim, p.id).toBe("idle");

    // What is on the screen is what is in the atlas: near the middle of each body the pixel of the screen is the pixel of the frame.
    await spread(page);
    await holdStill(page, true);
    for (const p of people.filter((q) => q.sprite !== null)) await figureIsAtlas(page, p.id);
    await holdStill(page, false);

    expect(lantern.network.filter((n) => n.origin !== servers.app.origin)).toEqual([]);
    expect((await lantern.snapshot()).cspViolations).toEqual([]);
    expect(lantern.pageErrors).toEqual([]);
    expect(lantern.consoleLines.filter((l) => /^\[(page|worker):error\]|Content Security Policy|Refused to/.test(l))).toEqual([]);
  });

  test("draw the places from their sprites, each on its footprint, in the order of its south edge", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const d = await drawing(page);
    const south = (cx: number, cy: number, rows: number) => [cx * CELL, (cy + rows) * CELL_DEPTH];
    const at = (place: string) => d.places.filter((p) => p.place === place).map((p) => [p.sprite, p.x, p.y]);
    expect(at("p_teahouse")).toEqual([["place.teahouse", ...south(31, 10, 4)]]);
    expect(at("p_li_house")).toEqual([
      ["place.li_house", ...south(2, 2, 3)],
      ["place.li_house", ...south(9, 2, 3)],
    ]);
    expect(at("p_zhou_house")).toEqual([
      ["place.zhou_house", ...south(31, 2, 3)],
      ["place.zhou_house", ...south(38, 2, 3)],
    ]);
    expect(at("p_ferry")).toEqual([["place.ferry_pier", ...south(28, 29, 1)]]);
    expect(at("p_bridge")).toEqual([["place.bridge_broken", ...south(24, 15, 2)]]);
    expect(d.willows).toBe(6);

    // The pixels are the atlas's: points on the roof and the wall of the teahouse are those of the sprite, in the light of day, with nobody standing in front of it.
    await inject(page, { weather: "clear" });
    await clearStage(page);
    const def = MANIFEST.sprites.get("place.teahouse");
    if (def === undefined) throw new Error("no teahouse");
    const points = await solidPoints(page, "place.teahouse", 4);
    expect(points.length).toBe(4);
    for (const [u, v] of points) {
      const [wx, wy] = [31 * CELL - def.ax + u, 14 * CELL_DEPTH - def.ay + v];
      const spot = await project(page, wx, wy);
      const expected = await atlasTexel(page, "place.teahouse", 0, u, v);
      expect(expected[3]).toBe(255);
      const got = await sampleAt(page, spot.x, spot.y);
      expect(near(got, expected), `${String(got)} against ${expected.join(",")} at the frame pixel ${u},${v}`).toBe(true);
    }
  });

  test("have the pixels that picking looks into from the atlas, strip by strip, and they are the atlas's own for every sprite of the kit", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    expect(await comparePickingPixels(page)).toBeGreaterThan(20_000);
    // A sprite that is not there, a frame that is not there, and a point outside the frame have no pixels.
    expect(await page.evaluate(() => window.__lantern.view.alphaAt("char.nobody", 0, 1, 1))).toBeNull();
    expect(await page.evaluate(() => window.__lantern.view.alphaAt("char.li_er", 10_000, 1, 1))).toBeNull();
    expect(await page.evaluate(() => window.__lantern.view.alphaAt("char.li_er", 0, -5, -5))).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("stand on the screen where the projection puts them: a cell is 32 wide and 25.22 deep", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const zoom = await page.evaluate(() => window.__lantern.view.camera.zoom);
    const a = await page.evaluate(() => window.__lantern.view.cellToScreen(10, 10));
    const b = await page.evaluate(() => window.__lantern.view.cellToScreen(11, 11));
    expect((b.x - a.x) / zoom).toBeCloseTo(CELL, 6);
    expect((b.y - a.y) / zoom).toBeCloseTo(CELL_DEPTH, 6);
    // A person stands on the middle of their cell, and the ground under their feet is the cell.
    for (const n of await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { npcs: Array<{ id: string; x: number; y: number }> }).npcs)) {
      const foot = await footOf(page, n.id);
      const cell = await page.evaluate(([x, y]) => window.__lantern.view.cellAt(x as number, y as number), [foot?.x ?? 0, foot?.y ?? 0]);
      expect(cell, n.id).toEqual({ x: n.x, y: n.y });
    }
  });
});

test.describe("a figure walks, stands, talks and carries", () => {
  test("turns the way it goes and takes a step for the ground it covers, and stands when it has arrived", async ({ lantern }) => {
    test.setTimeout(120_000);
    const page = lantern.page;
    await lantern.open("scenario=bridge&seed=7&pace=6", { menu: false });
    await expect.poll(() => mapStats(page).then((s) => s.people === 20 && s.figures === 21)).toBe(true);
    // Sample the people every 100 ms for 12 seconds, inside the page, so that the samples do not wait for the test.
    const samples = await page.evaluate(async () => {
      const view = window.__lantern.view;
      const rows: Array<Array<{ id: string; anim: string | null; dir: string; frame: number; moving: boolean; walked: number; x: number; y: number; sprite: string | null }>> = [];
      const until = performance.now() + 12_000;
      while (performance.now() < until) {
        rows.push(view.drawing().people.filter((p) => p.sprite !== null).map((p) => ({ id: p.id, anim: p.anim, dir: p.dir, frame: p.frame, moving: p.moving, walked: p.walked, x: p.x, y: p.y, sprite: p.sprite })));
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      return rows;
    });
    const movers = new Set<string>();
    let walking = 0;
    let standing = 0;
    for (const row of samples) {
      for (const p of row) {
        const def = MANIFEST.sprites.get(p.sprite ?? "");
        if (def === undefined) continue;
        if (p.moving) {
          walking++;
          movers.add(p.id);
          expect(["walk", "carry"], `${p.id} moves`).toContain(p.anim);
          // The frame is the one the ground walked says: floor(distance / stride * 6) % 6.
          const stride = def.anims.get(p.anim ?? "")?.stride ?? 0;
          expect(p.frame, `${p.id} after ${p.walked.toFixed(1)} px`).toBe(Math.floor((p.walked / stride) * 6) % 6);
        } else {
          standing++;
          expect(["idle", "talk", "carry"], `${p.id} stands`).toContain(p.anim);
          if (p.anim === "carry") expect(p.frame).toBe(0);
        }
      }
    }
    expect(walking).toBeGreaterThan(25);
    expect(standing).toBeGreaterThan(25);
    expect(movers.size).toBeGreaterThanOrEqual(4);

    // A walker faces the way it moves: when two samples show a clear step along one axis, the figure faces that way.
    let clear = 0;
    let agree = 0;
    const frames = new Map<string, Set<number>>();
    for (let i = 1; i < samples.length; i++) {
      const before = new Map((samples[i - 1] ?? []).map((p) => [p.id, p]));
      for (const p of samples[i] ?? []) {
        const q = before.get(p.id);
        if (q === undefined || !p.moving || !q.moving) continue;
        const dx = p.x - q.x;
        const dy = p.y - q.y;
        if (Math.hypot(dx, dy) < 6) continue;
        const set = frames.get(p.id) ?? new Set<number>();
        set.add(p.frame);
        frames.set(p.id, set);
        const ax = Math.abs(dx);
        const ay = Math.abs(dy) * (CELL / CELL_DEPTH);
        // A step that is clearly along an axis, in what the screen shows (a cell down is shorter than a cell across).
        if (ax < 2.2 * Math.abs(dy) && Math.abs(dy) < 2.2 * ax) continue;
        clear++;
        const faces = ax > ay ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (p.dir === faces) agree++;
      }
    }
    expect(clear).toBeGreaterThan(12);
    expect(agree / clear).toBeGreaterThan(0.9);
    // Over a walk the legs take all six frames.
    expect(Math.max(...[...frames.values()].map((s) => s.size))).toBeGreaterThanOrEqual(4);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("breathes when it stands, two frames at two a second, and no two people in step", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const seen = await page.evaluate(async () => {
      const view = window.__lantern.view;
      const frames: Record<string, number[]> = {};
      const until = performance.now() + 3_200;
      while (performance.now() < until) {
        for (const p of view.drawing().people.filter((q) => q.sprite !== null && q.anim === "idle")) (frames[p.id] ||= []).push(p.frame);
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      return frames;
    });
    const ids = Object.keys(seen);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    for (const id of ids) {
      const list = seen[id] ?? [];
      expect(new Set(list), id).toEqual(new Set([0, 1]));
      // Two frames a second: it changes a few times in three seconds, not at every sample.
      let changes = 0;
      for (let i = 1; i < list.length; i++) if (list[i] !== list[i - 1]) changes++;
      expect(changes, id).toBeGreaterThanOrEqual(3);
      expect(changes, id).toBeLessThanOrEqual(10);
    }
    // And the beat is offset from person to person.
    const first = ids.map((id) => seen[id]?.[0]);
    expect(new Set(first).size).toBeGreaterThan(0);
    const beats = new Set(ids.map((id) => (seen[id] ?? []).findIndex((f, i, all) => i > 0 && f !== all[i - 1])));
    expect(beats.size).toBeGreaterThan(1);
  });

  test("talks, facing each other, when the player is in a talk with them", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    // The player stands to the right of Li Er on the street, and a talk with him is on.
    const player = { x: 11, y: 20, activity: "chat", talk: null, look: [], offers: {}, topics: [] };
    await stand(page, { li_er: { x: 10, y: 20, activity: "chat" } }, { player });
    await page.evaluate(() => window.__lantern.view.setTalking("li_er"));
    await expect.poll(async () => (await drawing(page)).people.filter((p) => p.id === "li_er" || p.id === "player").map((p) => `${p.id} ${p.anim} ${p.dir}`).sort()).toEqual(["li_er talk right", "player talk left"]);
    expect((await drawing(page)).people.filter((p) => p.anim === "talk").map((p) => p.id).sort()).toEqual(["li_er", "player"]);
    // Talk is two frames at two a second, like idling.
    const frames = await page.evaluate(async () => {
      const seen = new Set<number>();
      const until = performance.now() + 1_600;
      while (performance.now() < until) {
        seen.add(window.__lantern.view.drawing().people.find((p) => p.id === "li_er")?.frame ?? -1);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return [...seen].sort();
    });
    expect(frames).toEqual([0, 1]);
    // They turn to face each other whichever way the other stands: the partner above, below, left and right.
    for (const [dx, dy, a, b] of [
      [0, 1, "down", "up"],
      [0, -1, "up", "down"],
      [-1, 0, "left", "right"],
    ] as const) {
      await stand(page, { li_er: { x: 10, y: 20 } }, { player: { ...player, x: 10 + dx, y: 20 + dy } });
      await expect.poll(async () => (await drawing(page)).people.filter((p) => p.id === "li_er" || p.id === "player").map((p) => `${p.id} ${p.dir}`).sort()).toEqual([`li_er ${a}`, `player ${b}`].sort());
    }
    // When the talk is over they idle again.
    await page.evaluate(() => window.__lantern.view.setTalking(null));
    await expect.poll(async () => (await drawing(page)).people.filter((p) => p.id === "li_er" || p.id === "player").map((p) => p.anim)).toEqual(["idle", "idle"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("carries the bamboo on the shoulder: 李大 with the carrying walk, its first frame when he stands, and the load over the head of everyone who carries", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    // As the core sends it: whoever carries something has `carrying` and the status `load`.
    await stand(page, {
      li_da: { x: 20, y: 21, carrying: "bamboo", activity: "carry", status: "load" },
      zuzhang: { x: 22, y: 21, carrying: "timber", activity: "carry", status: "load" },
      li_er: { x: 24, y: 21, carrying: "bamboo", activity: "carry", status: "load" },
    });
    const now = async () => new Map((await drawing(page)).people.map((p) => [p.id, p]));
    // Standing, 李大 is on the first frame of the carrying walk, in the direction he faces, and has the load icon like everyone who carries.
    const liDa = (await now()).get("li_da");
    expect(liDa).toMatchObject({ sprite: "char.li_da", anim: "carry", frame: 0, moving: false, marks: ["load"] });
    // A figure that has no carrying walk idles, with the load over its head, and so does one that carries a load that is not bamboo.
    expect((await now()).get("zuzhang")).toMatchObject({ anim: "idle", marks: ["load"] });
    expect((await now()).get("li_er")).toMatchObject({ anim: "idle", marks: ["load"] });
    // A frame that has `carrying` and no status (the core always sends both) is drawn the same.
    await stand(page, { zuzhang: { x: 22, y: 21, carrying: "tools", activity: "carry", status: undefined } });
    expect((await now()).get("zuzhang")).toMatchObject({ anim: "idle", marks: ["load"] });
    // On the move he walks with the bamboo, and the carrying walk goes by the ground like the other.
    await inject(page, { npcs: (await page.evaluate(() => (window.__lantern.client.state.frame as unknown as { npcs: unknown[] }).npcs)).map((n) => ((n as { id: string }).id === "li_da" ? { ...(n as object), x: 30, y: 21 } : n)) });
    const walking = await page.evaluate(async () => {
      const rows: Array<{ anim: string | null; frame: number; moving: boolean; dir: string; walked: number }> = [];
      const until = performance.now() + 1_200;
      while (performance.now() < until) {
        const p = window.__lantern.view.drawing().people.find((q) => q.id === "li_da");
        if (p !== undefined && p.moving) rows.push({ anim: p.anim, frame: p.frame, moving: p.moving, dir: p.dir, walked: p.walked });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return rows;
    });
    expect(walking.length).toBeGreaterThan(3);
    expect(new Set(walking.map((r) => r.anim))).toEqual(new Set(["carry"]));
    expect(new Set(walking.map((r) => r.dir))).toEqual(new Set(["right"]));
    const stride = MANIFEST.sprites.get("char.li_da")?.anims.get("carry")?.stride ?? 1;
    for (const r of walking) expect(r.frame).toBe(Math.floor((r.walked / stride) * 6) % 6);
    await expect.poll(async () => (await now()).get("li_da")).toMatchObject({ anim: "carry", frame: 0, moving: false });
    // Without the bamboo he walks and idles like the others.
    await stand(page, { li_da: { x: 30, y: 21, carrying: null, activity: "chat", status: undefined } });
    expect((await now()).get("li_da")).toMatchObject({ anim: "idle", marks: [] });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has the marks of what a person is doing over the head: asleep, an umbrella, a load", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await stand(page, { li_laotai: { x: 12, y: 20, status: "sleep", activity: "sleep" }, zhou_zhanggui: { x: 14, y: 20, status: "umbrella", activity: "shelter" }, old_he: { x: 16, y: 20, status: "load", activity: "carry" }, zuzhang: { x: 18, y: 20 } });
    const people = new Map((await drawing(page)).people.map((p) => [p.id, p]));
    expect(people.get("li_laotai")).toMatchObject({ marks: ["sleep"], anim: "idle" });
    expect(people.get("li_laotai")?.alpha).toBeCloseTo(0.82, 5);
    expect(people.get("zhou_zhanggui")).toMatchObject({ marks: ["umbrella"], alpha: 1 });
    expect(people.get("old_he")).toMatchObject({ marks: ["load"], alpha: 1 });
    expect(people.get("zuzhang")).toMatchObject({ marks: [], alpha: 1 });
    // So have the others.
    await stand(page, { shitou: { x: 12, y: 22, status: "sleep" }, xiao_man: { x: 14, y: 22, status: "umbrella" }, gengfu: { x: 16, y: 22, status: "load" } });
    const more = new Map((await drawing(page)).people.map((p) => [p.id, p]));
    expect(more.get("shitou")).toMatchObject({ sprite: "char.shitou", marks: ["sleep"] });
    expect(more.get("xiao_man")).toMatchObject({ sprite: "char.xiao_man", marks: ["umbrella"] });
    expect(more.get("gengfu")).toMatchObject({ sprite: "char.gengfu", marks: ["load"] });
    // A mark is over the head: the pixel of the screen there is not the pixel of the ground.
    const head = await page.evaluate(() => {
      const view = window.__lantern.view;
      const at = view.headPositionOf("old_he");
      return at === null ? null : { x: at.x, y: at.y };
    });
    expect(head).not.toBeNull();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lifts a walker over the arch of the bridge and draws them after the bridge", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    // Along the deck, from the west end to the east end, in the row of the north half of the deck.
    const lifts = MANIFEST.sprites.get("place.bridge")?.deckLift ?? [];
    expect(lifts).toHaveLength(13);
    const row = 15;
    const seen: number[] = [];
    for (const x of [23, 24, 25, 26, 27, 28, 29, 30]) {
      await stand(page, { li_er: { x, y: row } });
      const p = (await drawing(page)).people.find((q) => q.id === "li_er");
      seen.push(p?.lift ?? -1);
    }
    // Off the deck, on the bank, he is on the ground. On the deck he is lifted by the samples of the kit at the middle of his cell, and highest in the middle.
    expect(seen[0]).toBe(0);
    expect(seen[7]).toBe(0);
    const at = (cell: number) => lifts[Math.round((cell - 24 + 0.5) / 0.5)] ?? 0;
    for (const x of [24, 25, 26, 27, 28, 29]) expect(seen[x - 23], `x=${x}`).toBeCloseTo(at(x), 6);
    expect(Math.max(...seen)).toBeCloseTo(32.8, 6);
    // He is drawn after the bridge on the deck, so that he is seen and not hidden by the arch, and before it on the bank north of the deck.
    await stand(page, { li_er: { x: 26, y: 16 } });
    const onDeck = await page.evaluate(() => {
      const view = window.__lantern.view;
      const at = view.bodyPositionOf("li_er");
      return at === null ? null : { x: at.x, y: at.y, hit: view.pickAt(at.x, at.y) };
    });
    expect(onDeck?.hit).toEqual({ kind: "person", id: "li_er" });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a person who is picked or under the pointer is outlined and named", () => {
  for (const [lang, theme] of [["en", "light"], ["zh", "dark"], ["en", "dark"], ["zh", "light"]] as const) {
    test(`with the name tag and the badge of the family, in ${lang} on the ${theme} theme`, async ({ lantern }) => {
      const page = lantern.page;
      await openTown(lantern);
      await lantern.setLang(lang);
      await lantern.setTheme(theme);
      const names = {
        li_er: lang === "zh" ? "李二" : "Li Er",
        zhou_zhanggui: lang === "zh" ? "周掌柜" : "Shopkeeper Zhou",
        cha_laoban: lang === "zh" ? "茶馆老板娘" : "Teahouse Keeper",
        zhou_niangzi: lang === "zh" ? "周娘子" : "Madam Zhou",
      };
      const badges = { li_er: lang === "zh" ? "李" : "L", zhou_zhanggui: lang === "zh" ? "周" : "Z", cha_laoban: null, zhou_niangzi: lang === "zh" ? "周" : "Z" };
      const colours = { li_er: pieceColour("fam_li", "fam_li"), zhou_zhanggui: pieceColour("fam_zhou", "fam_zhou"), cha_laoban: null, zhou_niangzi: pieceColour("fam_zhou", "fam_zhou") };
      await expect.poll(async () => (await drawing(page)).nameTags).toEqual([]);
      expect((await drawing(page)).people.some((p) => p.outlined)).toBe(false);

      // Under the pointer: the outline and the name, and the badge of the household, for a figure and for a piece.
      for (const id of ["li_er", "zhou_zhanggui", "cha_laoban", "zhou_niangzi"] as const) {
        const spot = await bodyOf(page, id);
        if (spot === null) throw new Error(`no ${id}`);
        await canvasOf(lantern).hover({ position: spot });
        await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.badge, t.colour, t.picked])).toEqual([[names[id], badges[id], colours[id], false]]);
        expect((await drawing(page)).people.filter((p) => p.outlined).map((p) => p.id)).toEqual([id]);
        // The tag hangs under the feet, and the card of the page over the head.
        const tag = (await drawing(page)).nameTags[0];
        const foot = await footOf(page, id);
        expect(tag === undefined || foot === null ? 0 : tag.y).toBeGreaterThan(foot?.y ?? 0);
        expect(tag === undefined ? 0 : Math.abs(tag.x + tag.w / 2 - (foot?.x ?? 0))).toBeLessThan(2);
      }

      // Picked: a click, the outline and the stronger tag stay when the pointer goes away.
      const spot = await bodyOf(page, "li_er");
      if (spot === null) throw new Error("no li_er");
      await canvasOf(lantern).click({ position: spot });
      await expect.poll(async () => (await page.getByTestId("map").evaluate((el) => (el as HTMLCanvasElement).dataset.selected)) ?? "").toBe("li_er");
      await canvasOf(lantern).hover({ position: { x: 5, y: 5 } });
      await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.picked])).toEqual([[names.li_er, true]]);
      expect((await drawing(page)).people.filter((p) => p.outlined).map((p) => p.id)).toEqual(["li_er"]);
      // The picked one and the one under the pointer each have a tag. The card of the picked one lies over the lower left of the map, so the other is one who stands in the open.
      let otherId: "zhou_zhanggui" | "zhou_niangzi" | "cha_laoban" = "zhou_zhanggui";
      let other: { x: number; y: number } | null = null;
      for (const id of ["zhou_zhanggui", "zhou_niangzi", "cha_laoban"] as const) {
        const spot = await bodyOf(page, id);
        if (spot !== null && (await onTheMap(page, spot))) {
          otherId = id;
          other = spot;
          break;
        }
      }
      if (other === null) throw new Error("nobody of the four stands in the open");
      await canvasOf(lantern).hover({ position: other });
      await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.picked]).sort()).toEqual([[names.li_er, true], [names[otherId], false]].sort());
      // The empty ground takes the pick away, and the outline and the tags with it.
      await canvasOf(lantern).click({ position: { x: 5, y: 5 } });
      await expect.poll(async () => (await drawing(page)).nameTags).toEqual([]);
      expect((await drawing(page)).people.some((p) => p.outlined)).toBe(false);
      expect(lantern.pageErrors).toEqual([]);
    });
  }

  test("writes the name again in the other language the moment the language is switched", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const spot = await bodyOf(page, "li_er");
    if (spot === null) throw new Error("no li_er");
    await canvasOf(lantern).click({ position: spot });
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => t.name)).toEqual(["Li Er"]);
    await lantern.setLang("zh");
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.badge])).toEqual([["李二", "李"]]);
    await lantern.setLang("en");
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.badge])).toEqual([["Li Er", "L"]]);
  });
});

test.describe("picking on the map", () => {
  test("takes the person or the place that is drawn nearest under the pointer, and a tall building covers the cells behind it", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    // Three people on the street of the teahouse: one in front of its door, one behind it, under its roof, and one beyond the roof.
    await stand(page, { cha_laoban: { x: 34, y: 14 }, li_er: { x: 34, y: 8 }, zhou_huoji: { x: 34, y: 5 } });
    await spyOnGround(page);
    const front = await bodyOf(page, "cha_laoban");
    const under = await bodyOf(page, "li_er");
    const beyond = await bodyOf(page, "zhou_huoji");
    if (front === null || under === null || beyond === null) throw new Error("people are missing");
    expect(await pickAt(page, front.x, front.y)).toEqual({ kind: "person", id: "cha_laoban" });
    expect(await pickAt(page, beyond.x, beyond.y)).toEqual({ kind: "person", id: "zhou_huoji" });
    // The man behind the building is hidden by it, and is shown through it as a silhouette (see ui-occlusion.spec.ts): where the silhouette is, he is picked. On the roof beside him, the building is.
    expect(await pickAt(page, under.x, under.y)).toEqual({ kind: "person", id: "li_er" });
    const zoom = await page.evaluate(() => window.__lantern.view.camera.zoom);
    const beside = { x: under.x + 70 * zoom, y: under.y };
    expect(await pickAt(page, beside.x, beside.y)).toEqual({ kind: "place", id: "p_teahouse" });

    // A click on the roof beside him is a click on the teahouse: the page is told the ground and the place, and the cell is the one the click was over on the ground, which is a street cell of the row where he stands.
    const canvas = canvasOf(lantern);
    await canvas.click({ position: beside });
    expect(await page.evaluate(() => (document.querySelector('[data-testid="map"]') as HTMLCanvasElement).dataset.selected)).toBe("");
    const first = (await grounds(page))[0];
    expect(first?.place).toBe("p_teahouse");
    const cellUnder = await page.evaluate(([x, y]) => window.__lantern.view.cellAt(x as number, y as number), [beside.x, beside.y]);
    expect(first).toMatchObject({ x: cellUnder.x, y: cellUnder.y });
    expect(cellUnder.y).toBeLessThan(10);
    // A click on the one in front picks him, and the click does not reach the ground.
    await canvas.click({ position: front });
    await expect.poll(async () => (await page.evaluate(() => (document.querySelector('[data-testid="map"]') as HTMLCanvasElement).dataset.selected)) ?? "").toBe("cha_laoban");
    expect(await grounds(page)).toHaveLength(1);
    await canvas.click({ position: beyond });
    await expect.poll(async () => (await page.evaluate(() => (document.querySelector('[data-testid="map"]') as HTMLCanvasElement).dataset.selected)) ?? "").toBe("zhou_huoji");
    expect(await grounds(page)).toHaveLength(1);

    // The roof is the building wherever it has a body, and the sky round its corner is not.
    const def = MANIFEST.sprites.get("place.teahouse");
    if (def === undefined) throw new Error("no teahouse");
    const frameToWorld = (u: number, v: number) => [31 * CELL - def.ax + u, 14 * CELL_DEPTH - def.ay + v] as const;
    // A point of the roof, high on the sprite where nobody stands in front of it, and a point of sky in its top right corner.
    const [roofAt] = await solidPoints(page, "place.teahouse", 1, 70);
    const skyAt = await clearPoint(page, "place.teahouse");
    if (roofAt === undefined) throw new Error("no roof");
    const roof = await project(page, ...frameToWorld(...roofAt));
    const sky = await project(page, ...frameToWorld(...skyAt));
    expect(await pickAt(page, roof.x, roof.y)).toEqual({ kind: "place", id: "p_teahouse" });
    expect(await pickAt(page, sky.x, sky.y)).toBeNull();
    // A click on the roof is the teahouse, and its cell is up the map in the street, not a cell of the teahouse.
    await canvas.click({ position: roof });
    const onRoof = (await grounds(page))[1];
    expect(onRoof?.place).toBe("p_teahouse");
    expect(onRoof?.y).toBeLessThan(10);
    // A click on bare ground is the cell, with no place.
    const lawn = await page.evaluate(() => window.__lantern.view.cellToScreen(45, 22));
    await canvas.click({ position: lawn });
    const bare = (await grounds(page))[2];
    expect(bare).toMatchObject({ x: 45, y: 22, place: null });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lets a person be picked who stands where the manager stands, and takes a click on the manager alone for the ground", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await spyOnGround(page);
    // The manager and the keeper of the teahouse on the same cell of the street, the manager drawn in front of her.
    const player = { x: 30, y: 20, activity: "chat", talk: null, look: [], offers: {}, topics: [] };
    await stand(page, { cha_laoban: { x: 30, y: 20 } }, { player });
    const foot = await footOf(page, "cha_laoban");
    const body = await bodyOf(page, "player");
    if (foot === null || body === null) throw new Error("people are missing");
    // The manager is drawn over her, and where both are under the pointer the person is picked and the manager is not in the way.
    const order = (await drawing(page)).people;
    expect(order.some((p) => p.id === "player")).toBe(true);
    expect(await pickAt(page, foot.x, foot.y)).toEqual({ kind: "person", id: "cha_laoban" });
    await canvasOf(lantern).click({ position: foot });
    await expect.poll(async () => (await page.evaluate(() => (document.querySelector('[data-testid="map"]') as HTMLCanvasElement).dataset.selected)) ?? "").toBe("cha_laoban");
    // The manager alone: the click is a click on the ground where he stands, and picks nobody.
    await stand(page, { cha_laoban: { x: 40, y: 20 } }, { player });
    const alone = await bodyOf(page, "player");
    if (alone === null) throw new Error("no manager");
    expect(await pickAt(page, alone.x, alone.y)).toEqual({ kind: "person", id: "player" });
    const before = (await grounds(page)).length;
    await canvasOf(lantern).click({ position: alone });
    await expect.poll(async () => (await grounds(page)).length).toBe(before + 1);
    expect((await grounds(page)).at(-1)).toMatchObject({ x: 30, y: 20, place: null });
    await expect.poll(async () => (await page.evaluate(() => (document.querySelector('[data-testid="map"]') as HTMLCanvasElement).dataset.selected)) ?? "").toBe("");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("picks every building that has a sprite, by its body and by the cell of its footprint", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await spyOnGround(page);
    // The cells of a footprint are the building, for the houses, the teahouse and the pier.
    const clicks: Array<[string, number, number]> = [
      ["p_li_house", 4, 3],
      ["p_li_house", 11, 3],
      ["p_zhou_house", 33, 3],
      ["p_zhou_house", 40, 3],
      ["p_teahouse", 34, 12],
      ["p_ferry", 28, 29],
    ];
    const spots: Array<[string, { x: number; y: number }]> = [];
    for (const [place, x, y] of clicks) spots.push([place, await page.evaluate(([cx, cy]) => window.__lantern.view.cellToScreen(cx as number, cy as number), [x, y])]);
    // The arch of the bridge stands over the deck: the ground of its cells is water under the arch, and the bridge is picked where the sprite has a body.
    const bridge = MANIFEST.sprites.get("place.bridge");
    if (bridge === undefined) throw new Error("no bridge");
    for (const [u, v] of await solidPoints(page, "place.bridge_broken", 3)) {
      spots.push(["p_bridge", await project(page, 24 * CELL - bridge.ax + u, 17 * CELL_DEPTH - bridge.ay + v)]);
    }
    for (const [place, spot] of spots) {
      expect(await pickAt(page, spot.x, spot.y), `${place} at ${spot.x},${spot.y}`).toEqual({ kind: "place", id: place });
      await mouseOnMap(page, spot, "click");
    }
    expect((await grounds(page)).map((g) => g.place)).toEqual(spots.map((c) => c[0]));
    // Under the arch, where the river shows through the sprite, it is the river.
    const water = await project(page, 26.5 * CELL, 16.5 * CELL_DEPTH);
    expect(await pickAt(page, water.x, water.y)).toBeNull();
    // Every other building is a sprite too, and is picked by its body at the middle of its footprint: the school, the houses, the post, a stall of the market, the workshop, the tavern, the hall and the temple.
    const others: Array<[string, number, number]> = [
      ["p_school", 19, 3],
      ["p_accountant_home", 19, 10],
      ["p_watch_post", 22, 12],
      ["p_market", 17, 19],
      ["p_workshop", 5, 19],
      ["p_carpenter_home", 3, 26],
      ["p_xiaoman_home", 9, 26],
      ["p_tavern", 34, 19],
      ["p_clan_hall", 51, 10],
      ["p_temple", 50, 20],
      ["p_he_home", 36, 30],
    ];
    const before = (await grounds(page)).length;
    for (const [place, x, y] of others) {
      const spot = await page.evaluate(([cx, cy]) => window.__lantern.view.cellToScreen(cx as number, cy as number), [x, y]);
      expect(await pickAt(page, spot.x, spot.y), `${place} at ${x},${y}`).toEqual({ kind: "place", id: place });
      await mouseOnMap(page, spot, "click");
    }
    expect((await grounds(page)).slice(before).map((g) => g.place)).toEqual(others.map((c) => c[0]));
  });

});

test.describe("the town as it is told by the frame", () => {
  test("has the bridge broken until the hud says it is mended", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const bridge = async () => ({ stats: (await mapStats(page)).bridge, data: await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.bridge), sprite: (await drawing(page)).places.find((p) => p.place === "p_bridge")?.sprite });
    // A frame with no word of the bridge: it is broken, as it is when the game starts.
    await inject(page, { hud: {} });
    await expect.poll(bridge).toEqual({ stats: "broken", data: "broken", sprite: "place.bridge_broken" });
    for (const state of ["broken", "repairing", "detour"]) {
      await inject(page, { hud: { bridge: { state, done: 2, need: 5 } } });
      await expect.poll(bridge, state).toEqual({ stats: "broken", data: "broken", sprite: "place.bridge_broken" });
    }
    await inject(page, { hud: { bridge: { state: "mended", done: 5, need: 5 } } });
    await expect.poll(bridge).toEqual({ stats: "whole", data: "whole", sprite: "place.bridge" });
    // The whole bridge has its railing: the pixels of the map are not those of the broken one, and are those of the sprite.
    const def = MANIFEST.sprites.get("place.bridge");
    if (def === undefined) throw new Error("no bridge");
    await inject(page, { weather: "clear" });
    await clearStage(page);
    const points = await solidPoints(page, "place.bridge", 4);
    expect(points.length).toBe(4);
    for (const [u, v] of points) {
      const expected = await atlasTexel(page, "place.bridge", 0, u, v);
      const spot = await project(page, 24 * CELL - def.ax + u, 17 * CELL_DEPTH - def.ay + v);
      expect(near(await sampleAt(page, spot.x, spot.y), expected), `${u},${v}`).toBe(true);
    }
    // And it goes back to broken with a new game.
    await inject(page, { hud: { bridge: { state: "broken" } } });
    await expect.poll(bridge).toEqual({ stats: "broken", data: "broken", sprite: "place.bridge_broken" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("piles the bamboo at the bridge from the site: a small pile for 1 to 9 and a large one for 10 or more", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const pile = async () => ({ stats: (await mapStats(page)).pile, data: await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.pile) });
    // No site in the frame, and a site with no bamboo: no pile.
    await inject(page, { site: null });
    await expect.poll(pile).toEqual({ stats: "none", data: "none" });
    for (const [bamboo, kind] of [[0, "none"], [1, "small"], [4, "small"], [9, "small"], [10, "large"], [11, "large"], [400, "large"], [0, "none"]] as const) {
      await inject(page, { site: { bamboo, timber: 3 } });
      await expect.poll(pile, `${bamboo}`).toEqual({ stats: kind, data: kind });
    }
    // The pile is at the west end of the bridge, on the bank south of the deck, on the screen and in the pixels.
    await inject(page, { site: { bamboo: 12 }, weather: "clear" });
    await clearStage(page);
    const def = MANIFEST.sprites.get("prop.bamboo_large");
    if (def === undefined) throw new Error("no bamboo");
    const points = await solidPoints(page, "prop.bamboo_large", 4);
    expect(points.length).toBeGreaterThan(0);
    for (const [u, v] of points) {
      const expected = await atlasTexel(page, "prop.bamboo_large", 0, u, v);
      const spot = await project(page, 22 * CELL - def.ax + u, 18 * CELL_DEPTH - def.ay + v);
      expect(near(await sampleAt(page, spot.x, spot.y), expected), `${u},${v}`).toBe(true);
    }
    // The small pile has its own sprite, and a frame that takes the site away takes the pile away.
    await inject(page, { site: { bamboo: 4 } });
    await expect.poll(async () => (await drawing(page)).pile).toBe("small");
    await inject(page, { site: {} });
    await expect.poll(async () => (await drawing(page)).pile).toBeNull();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("piles the bamboo from the `site` that the core sends, which is the number the board shows: no pile while the promise is open, a small one when the first four poles are in", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await page.getByTestId("board-toggle").click();
    // The evening of the first day: Li Da has promised four poles, and nothing lies at the bridge.
    await fake.feedFrame(page, fake.commitments("promised"));
    await expect.poll(async () => (await mapStats(page)).pile).toBe("none");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "0");
    // The morning after he has carried them: the same four are in the board, and are a small pile on the map.
    await fake.feedFrame(page, fake.commitments("delivered"), [{ kind: "delivered", tick: 800, id: "c_li_da_bamboo", npc: "li_da", item: "bamboo", amount: 4, qty: 4, place: "p_bridge", task: 1 }]);
    await expect.poll(async () => (await mapStats(page)).pile).toBe("small");
    await expect(page.getByTestId("board-site")).toHaveAttribute("data-bamboo", "4");
    // The rest of the ten the bridge takes makes it a large one. Timber lies at the bridge as well and is not a pile of bamboo.
    await fake.feedFrame(page, { site: { bamboo: 10, timber: 8 } });
    await expect.poll(async () => (await mapStats(page)).pile).toBe("large");
    await fake.feedFrame(page, { site: { bamboo: 0, timber: 8 } });
    await expect.poll(async () => (await mapStats(page)).pile).toBe("none");
    // A frame from a core that sends no `site` draws no pile, and a key that is not the core's is not read for one.
    await fake.feedFrame(page, { site: undefined, hud: { bamboo: 9 }, pile: 9, stock: { bamboo: 9 } });
    await expect.poll(async () => (await mapStats(page)).pile).toBe("none");
    expect(lantern.pageErrors).toEqual([]);
  });

  test("lights the lanterns at the doors of the households of the frame, and the glow grows with the night", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern, NIGHT, 1900);
    await inject(page, { dots: [], bubbles: [], lanterns: [], weather: "clear" });
    await clearStage(page);
    expect((await mapStats(page)).glow).toBeGreaterThan(0.95);
    const lamps = async () => ({ lit: (await mapStats(page)).lampsLit, households: (await mapStats(page)).lanterns, data: await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.lanterns) });
    // Twenty-eight lanterns hang at the doors of the houses, unlit: two for each house, the Li house and the Zhou house being two, and the school, the hall, the temple, the watch post, the workshop and the four small houses one each, with the teahouse.
    expect((await drawing(page)).lamps).toBe(28);
    await expect.poll(lamps).toEqual({ lit: 0, households: 0, data: "0" });
    // The glow at the lantern is the night: look at the screen at one of the lanterns of the Zhou house, before and after it is lit.
    const lampList = (await drawing(page)).lampList.filter((l) => l.place === "p_zhou_house");
    expect(lampList).toHaveLength(4);
    // The halo round the lantern: the screen at points round the middle of the glow (over and under the body, and to its side), before and after it is lit.
    const halo = async (): Promise<number[][]> => {
      const out: number[][] = [];
      for (const [dx, dy] of [[0, -10], [0, -20], [0, -30], [10, 0], [22, 0], [30, 0], [0, 20]] as const) {
        const at = await project(page, (lampList[0]?.x ?? 0) + dx, (lampList[0]?.y ?? 0) + GLOW_Y + dy);
        out.push((await sampleAt(page, at.x, at.y)) ?? [0, 0, 0, 0]);
      }
      return out;
    };
    const dark = await halo();
    await inject(page, { lanterns: [{ household: "fam_li", place: "p_li_house", x: 7, y: 5 }, { household: "fam_zhou", place: "p_zhou_house", x: 36, y: 5 }, { household: "tea", place: "p_teahouse", x: 34, y: 14 }] });
    await expect.poll(lamps).toEqual({ lit: 10, households: 3, data: "3" });
    const lit = await halo();
    const sum = (rows: number[][], c: number): number => rows.reduce((n, row) => n + (row[c] ?? 0), 0);
    // The glow is added to the night, and it is orange: red over green over blue, and every point round the lantern is at least as bright.
    expect(sum(lit, 0)).toBeGreaterThan(sum(dark, 0) * 1.8 + 100);
    expect(sum(lit, 0)).toBeGreaterThan(sum(lit, 1));
    expect(sum(lit, 1)).toBeGreaterThan(sum(lit, 2) * 0.8);
    for (let i = 0; i < lit.length; i++) expect((lit[i]?.[0] ?? 0) + 1, `point ${i}`).toBeGreaterThanOrEqual(dark[i]?.[0] ?? 0);
    // One household lights its house, and a household of a place that has no door lanterns in the kit (nobody lives at the tavern) is lit with the lantern made in code at its cell.
    await inject(page, { lanterns: [{ household: "fam_zhou", place: "p_zhou_house", x: 36, y: 5 }, { household: "tavern", place: "p_tavern", x: 34, y: 17 }] });
    await expect.poll(lamps).toEqual({ lit: 4, households: 2, data: "2" });
    expect((await drawing(page)).lampList.filter((l) => l.on).map((l) => l.place)).toEqual(["p_zhou_house", "p_zhou_house", "p_zhou_house", "p_zhou_house"]);
    // Two households that hang their lanterns at one house: the lanterns of the frame are two, and the four lamps of the house are lit.
    await inject(page, { lanterns: [{ household: "fam_zhou", place: "p_zhou_house", x: 36, y: 5 }, { household: "zhou_guest", place: "p_zhou_house", x: 37, y: 5 }] });
    await expect.poll(lamps).toEqual({ lit: 4, households: 2, data: "2" });
    // No lantern, no glow.
    await inject(page, { lanterns: [] });
    await expect.poll(lamps).toEqual({ lit: 0, households: 0, data: "0" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("shows a lit lantern by day too, but with hardly a glow", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await inject(page, { dots: [], bubbles: [], weather: "clear", lanterns: [] });
    // The lantern sways a little: held still, it is where the test looks for it.
    await holdStill(page, true);
    const lamp = (await drawing(page)).lampList.find((l) => l.place === "p_teahouse");
    if (lamp === undefined) throw new Error("no lamp");
    // The halo of the lantern, beside its body, over the wall and over the ground.
    const halo = async (): Promise<number[]> => {
      const out: number[] = [];
      for (const [dx, dy] of [[22, 0], [30, 0], [0, 20], [-22, 0]] as const) {
        const spot = await project(page, lamp.x + dx, lamp.y + GLOW_Y + dy);
        out.push((await sampleAt(page, spot.x, spot.y))?.[0] ?? 0);
      }
      return out;
    };
    const before = await halo();
    await inject(page, { lanterns: [{ household: "tea", place: "p_teahouse", x: 34, y: 14 }] });
    await expect.poll(async () => (await mapStats(page)).lampsLit).toBe(2);
    const after = await halo();
    // The lit lantern is there, and in the daylight its glow is a tenth of what the night has: round its body the picture hardly changes.
    for (let i = 0; i < before.length; i++) expect((after[i] ?? 0) - (before[i] ?? 0), `point ${i}`).toBeLessThan(45);
    expect((await mapStats(page)).glow).toBe(0);
  });

  test("draws the willows where the trees are by the water, and the other trees as sprites of their own (see ui-town-art.spec.ts)", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const d = await drawing(page);
    expect(d.willows).toBe(6);
    expect((await mapStats(page)).willows).toBe(6);
    // A willow is drawn from its sprite at the south-west corner of its cell: the pixel of its trunk.
    await inject(page, { weather: "clear" });
    await clearStage(page);
    const def = MANIFEST.sprites.get("prop.willow");
    if (def === undefined) throw new Error("no willow");
    let tested = 0;
    const points = await solidPoints(page, "prop.willow", 5);
    for (const [cx, cy] of [[24, 4], [17, 25], [17, 26]] as const) {
      for (const [u, v] of points) {
        const expected = await atlasTexel(page, "prop.willow", 0, u, v);
        const spot = await project(page, cx * CELL - def.ax + u, (cy + 1) * CELL_DEPTH - def.ay + v);
        const got = await sampleAt(page, spot.x, spot.y);
        // Another willow in front of it can cover it: a willow is only checked where no later one is drawn over it.
        if (near(got, expected)) tested++;
      }
    }
    expect(tested).toBeGreaterThan(5);
  });
});

test.describe("the map keeps its manners", () => {
  test("draws nothing, and fetches nothing, when the page is hidden, and goes on when it is shown", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const frames = () => mapStats(page).then((s) => s.frames);
    // Something is stirring (the glints on the river), so the map is being drawn.
    const a = await frames();
    await page.waitForTimeout(900);
    expect(await frames()).toBeGreaterThan(a);
    await lantern.setVisibility("hidden");
    await expect.poll(async () => (await mapStats(page)).hidden).toBe(true);
    const held = await frames();
    await page.waitForTimeout(1_600);
    expect(await frames()).toBe(held);
    // A change of the world while it is hidden is not drawn either: it is drawn when the page is shown.
    await inject(page, { weather: "light_rain" });
    await page.waitForTimeout(600);
    expect(await frames()).toBe(held);
    await lantern.setVisibility("visible");
    await expect.poll(frames).toBeGreaterThan(held);
    expect((await mapStats(page)).hidden).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("holds still for a player who asked the system for less motion: no steps, no breathing, no glints, no sway, no rain falling", async ({ lantern }) => {
    const page = lantern.page;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openTown(lantern, NIGHT, 1900);
    await inject(page, { dots: [], bubbles: [], weather: "heavy_rain", lanterns: [{ household: "fam_zhou", place: "p_zhou_house", x: 36, y: 5 }, { household: "tavern", place: "p_tavern", x: 34, y: 17 }] });
    await expect.poll(async () => (await mapStats(page)).calm).toBe(true);
    expect(await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.calm)).toBe("true");
    await expect.poll(async () => (await mapStats(page)).lampsLit).toBe(4);
    // With the rain, the lanterns and the river, nothing is drawn again and again: the map is a picture until something changes.
    await page.waitForTimeout(800);
    const a = await mapStats(page);
    await page.waitForTimeout(2_000);
    const b = await mapStats(page);
    expect(b.frames - a.frames).toBeLessThanOrEqual(1);
    // Nobody is on a step of a walk or on the second frame of a breath.
    for (const p of (await drawing(page)).people.filter((q) => q.sprite !== null)) {
      expect(p.frame, p.id).toBe(0);
      expect(["idle", "talk", "carry"], p.id).toContain(p.anim);
    }
    // A person who is sent somewhere is there at once, facing the way they went, standing.
    await stand(page, { li_er: { x: 20, y: 21 } });
    await stand(page, { li_er: { x: 28, y: 21 } });
    const liEr = (await drawing(page)).people.find((p) => p.id === "li_er");
    expect(liEr).toMatchObject({ anim: "idle", frame: 0, dir: "right", moving: false });
    // When the player lets motion back, the map is alive again.
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(async () => (await mapStats(page)).calm).toBe(false);
    const c = await mapStats(page);
    await page.waitForTimeout(1_500);
    expect((await mapStats(page)).frames - c.frames).toBeGreaterThan(3);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not fetched at all on a page opened with ?map=off", async ({ lantern, servers }) => {
    const page = lantern.page;
    const from = servers.app.requests.length;
    await lantern.open("scenario=bridge&seed=7&pace=40&until=200", { menu: false, map: false });
    await lantern.waitForTick(200);
    expect(servers.app.requests.slice(from).filter((r) => r.path.startsWith("/sprites/"))).toEqual([]);
    expect(lantern.network.filter((n) => n.url.includes("/sprites/"))).toEqual([]);
    expect(await page.evaluate(() => window.__lantern.view.ready)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes on with shapes where the sprites cannot be had: the files are gone, or the manifest is of another camera", async ({ lantern }) => {
    for (const how of ["missing", "camera", "schema", "not json"] as const) {
      const page = lantern.page;
      await page.route("**/sprites/manifest.json", async (route) => {
        if (how === "missing") return route.fulfill({ status: 404, body: "not found" });
        if (how === "not json") return route.fulfill({ status: 200, contentType: "application/json", body: "{ not json" });
        const raw = (await (await route.fetch()).json()) as Record<string, any>;
        if (how === "camera") raw.units.cellDepthPx1x = 30;
        else raw.schema = "something-else@3";
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(raw) });
      });
      await lantern.open("scenario=bridge&seed=7&pace=60&until=300", { menu: false });
      await lantern.waitForTick(300);
      await expect.poll(() => mapStats(page).then((s) => s.people), how).toBe(20);
      // Everyone is a piece, every building a shape, and the town is as it was: no error, a word in the console about the sprites.
      expect(await mapStats(page), how).toMatchObject({ figures: 0, places: 0, willows: 0, atlas: 0, bridge: "none", pile: "none", lampsLit: 0 });
      expect((await drawing(page)).people.every((p) => p.sprite === null)).toBe(true);
      expect(lantern.consoleLines.some((l) => /the sprites are not available/.test(l)), how).toBe(true);
      expect(lantern.pageErrors, how).toEqual([]);
      // The lantern made in code hangs at the cell, and the plain piece of the person can be picked.
      await inject(page, { lanterns: [{ household: "fam_li", place: "p_li_house", x: 7, y: 5 }] });
      await expect.poll(async () => (await mapStats(page)).lanterns, how).toBe(1);
      const spot = await bodyOf(page, "cha_laoban");
      expect(await pickAt(page, spot?.x ?? 0, spot?.y ?? 0), how).toEqual({ kind: "person", id: "cha_laoban" });
      await page.unroute("**/sprites/manifest.json");
      lantern.consoleLines.length = 0;
    }
  });

  test("draws the other twelve people of the cast with a figure of their own each, and picks them", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    expect(await mapStats(page)).toMatchObject({ people: 20, figures: 21 });
    const people = new Map((await drawing(page)).people.map((p) => [p.id, p]));
    expect(OTHER_TWELVE).toHaveLength(12);
    for (const id of OTHER_TWELVE) expect(people.get(id)?.sprite, id).toBe(`char.${id}`);
    expect(people.get("gengfu")?.sprite).toBe("char.gengfu");
    expect(people.get("zhou_niangzi")?.sprite).toBe("char.zhou_niangzi");
    expect(people.get("xiao_man")?.sprite).toBe("char.xiao_man");
    for (const [id, sprite] of Object.entries(NAMED_FIGURES)) expect(people.get(id)?.sprite, id).toBe(sprite);
    // They are picked, outlined and named like the others.
    for (const id of ["gengfu", "zhou_niangzi", "xiao_man"]) {
      const spot = await bodyOf(page, id);
      expect(await pickAt(page, spot?.x ?? 0, spot?.y ?? 0), id).toEqual({ kind: "person", id });
    }
    const spot = await bodyOf(page, "zhou_niangzi");
    await canvasOf(lantern).click({ position: spot ?? { x: 0, y: 0 } });
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.badge, t.picked])).toEqual([["Madam Zhou", "Z", true]]);
    expect((await drawing(page)).people.filter((p) => p.outlined).map((p) => p.id)).toEqual(["zhou_niangzi"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("leaves a person as a piece where the manifest has no figure for them, and takes a sprite that a later bake names for one of them without a change of code", async ({ lantern }) => {
    const page = lantern.page;
    // A kit with the figures of the first eight only, and then a bake that has a figure for one of the others.
    await page.route("**/sprites/manifest.json", async (route) => {
      const raw = (await (await route.fetch()).json()) as { sprites: Record<string, unknown> };
      for (const id of OTHER_TWELVE) delete raw.sprites[`char.${id}`];
      raw.sprites["char.shitou"] = raw.sprites["char.zhou_huoji"];
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(raw) });
    });
    await openTown(lantern);
    // Eight of the cast, the manager, and the one child who has a sprite named for them.
    expect(await mapStats(page)).toMatchObject({ people: 20, figures: 10 });
    const people = new Map((await drawing(page)).people.map((p) => [p.id, p]));
    for (const id of OTHER_TWELVE) expect(people.get(id)?.sprite, id).toBe(id === "shitou" ? "char.shitou" : null);
    for (const id of FIRST_EIGHT) expect(people.get(id)?.sprite, id).toBe(NAMED_FIGURES[id]);
    // A piece has the marks over its head, is outlined and named with the badge of its family, and is picked, as it always was.
    await stand(page, { xiao_man: { x: 14, y: 22, status: "umbrella" }, zhou_niangzi: { x: 12, y: 22, status: "sleep" } });
    const marks = new Map((await drawing(page)).people.map((p) => [p.id, p]));
    expect(marks.get("xiao_man")).toMatchObject({ sprite: null, marks: ["umbrella"] });
    expect(marks.get("zhou_niangzi")).toMatchObject({ sprite: null, marks: ["sleep"], alpha: 0.82 });
    const spot = await bodyOf(page, "zhou_niangzi");
    expect(await pickAt(page, spot?.x ?? 0, spot?.y ?? 0)).toEqual({ kind: "person", id: "zhou_niangzi" });
    await canvasOf(lantern).hover({ position: spot ?? { x: 0, y: 0 } });
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.badge, t.picked])).toEqual([["Madam Zhou", "Z", false]]);
    expect((await drawing(page)).people.filter((p) => p.outlined).map((p) => p.id)).toEqual(["zhou_niangzi"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("draws the 2x atlas on a screen of high pixel density and the same figures at the same size", async ({ browser, servers }) => {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1100, height: 700 } });
    const lantern = new LanternPage(await context.newPage(), servers, true);
    try {
      const from = servers.app.requests.length;
      await openTown(lantern);
      expect(await mapStats(lantern.page)).toMatchObject({ people: 20, figures: 21, places: 21, atlas: 2 });
      // The page fetched the manifest and the pages of the 2x atlas, once each (before the test looks at the atlas for itself).
      const served = servers.app.requests.slice(from).filter((r) => r.path.startsWith("/sprites/")).map((r) => r.path);
      expect(served).toEqual(["/sprites/manifest.json", ...(MANIFEST.atlases.get(2) ?? []).map((page) => `/sprites/${page.file}`)]);
      // The pixels that picking looks into are those of the 2x atlas, which has more strips and a last strip of another height.
      expect(await comparePickingPixels(lantern.page)).toBeGreaterThan(20_000);
      // The pixels are the atlas's at that scale, and the figure is the size it is at scale 1: a frame is as wide in the world as at 1x.
      await inject(lantern.page, { weather: "clear" });
      await spread(lantern.page);
      await holdStill(lantern.page, true);
      for (const id of ["cha_laoban", "li_da", "zhou_niangzi", "player"]) await figureIsAtlas(lantern.page, id);
      const def = MANIFEST.sprites.get("char.laobanniang");
      if (def === undefined) throw new Error("no keeper");
      expect(frameRect(def, 2, 0)?.w).toBe(def.w * 2);
      expect(lantern.pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
