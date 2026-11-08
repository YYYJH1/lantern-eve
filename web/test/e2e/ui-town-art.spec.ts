import { CELL, CELL_DEPTH } from "../../src/page/map/projection.ts";
import { PROPS, TREE_KINDS, WILLOW_REACH } from "../../src/page/map/sprites.ts";
import { planPlaces, planTrees, willowCells } from "../../src/page/map/town.ts";
import { expect, test } from "../support/fixtures.ts";
import { emptyTown, openTown, type Occluder, occluders, project, scanNorthOf, sceneOf, silhouettesOf } from "../support/occlusion.ts";
import { atlasTexel, clearStage, drawing, inject, mapStats, MANIFEST, near, NIGHT, sampleAt, solidPoints, stand } from "../support/sprites.ts";

// This spec looks at the town that the sprites of the kit make: its buildings, its trees and its windows at night.
test.use({ map: true });

const sprite = (id: string) => MANIFEST.sprites.get(id);

test.describe("the buildings of the town are sprites of the kit", () => {
  test("draws every building from its sprite, on its footprint, at the south edge of it, and the pixels of the screen are the atlas's", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const scene = await sceneOf(page);
    const plans = planPlaces(scene, sprite);
    expect(plans).toHaveLength(21);
    expect(await mapStats(page)).toMatchObject({ places: 21, figures: 21 });
    const d = await drawing(page);
    // The bridge is broken until the hud says it is mended; the others are their one sprite, or the stall of the kind that its turn gives.
    expect(d.places.map((p) => [p.place, p.sprite, p.x, p.y])).toEqual(
      plans.map((p) => [p.place, p.place === "p_bridge" ? (p.broken?.id ?? p.whole.id) : p.whole.id, p.rect.x * CELL, (p.rect.y + p.rect.h) * CELL_DEPTH]),
    );
    // Seventeen sprites on the twenty-one footprints: the two houses of each family and the four stalls (two kinds) share theirs, and the bridge is the broken one.
    expect(new Set(d.places.map((p) => p.sprite)).size).toBe(17);

    // What is on the screen is what is in the atlas: the points of the body of each sprite, in the light of day, with nobody in front of them.
    await inject(page, { weather: "clear" });
    await clearStage(page);
    let checked = 0;
    let matched = 0;
    const missed: string[] = [];
    for (const plan of plans) {
      const points = await solidPoints(page, plan.whole.id, 3);
      expect(points.length, plan.whole.id).toBeGreaterThan(0);
      for (const [u, v] of points) {
        const spot = await project(page, plan.rect.x * CELL - plan.whole.ax * plan.scale + u * plan.scale, (plan.rect.y + plan.rect.h) * CELL_DEPTH - plan.whole.ay * plan.scale + v * plan.scale);
        const got = await sampleAt(page, spot.x, spot.y);
        const texel = await atlasTexel(page, plan.whole.id, 0, u, v);
        checked++;
        if (near(got, texel)) matched++;
        else missed.push(`${plan.place} ${u},${v}: ${String(got)} against ${texel.join(",")}`);
      }
    }
    // A tree or a roof that is drawn over another's edge covers a point now and then: nearly all of them are the atlas's own.
    expect(checked).toBeGreaterThan(45);
    expect(matched, missed.join("\n")).toBeGreaterThanOrEqual(Math.floor(checked * 0.85));
    expect(lantern.pageErrors).toEqual([]);
  });

  test("hangs the door lanterns of the households of the other houses too: two at each door, lit with the household, the tavern, which has none in the kit, excepted", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern, NIGHT, 1900);
    await inject(page, { dots: [], bubbles: [], lanterns: [], weather: "clear" });
    await clearStage(page);
    // Twelve places have a household and a door: the teahouse, the school, the hall, the temple, Old He's, the accountant's, Xiaoman's, the watch post, the carpenter's, the workshop and the two families' (two houses each).
    const d = await drawing(page);
    expect(d.lamps).toBe(28);
    const places = [...new Set(d.lampList.map((l) => l.place))].sort();
    expect(places).toEqual(["p_accountant_home", "p_carpenter_home", "p_clan_hall", "p_he_home", "p_li_house", "p_school", "p_teahouse", "p_temple", "p_watch_post", "p_workshop", "p_xiaoman_home", "p_zhou_house"]);
    for (const place of places) expect(d.lampList.filter((l) => l.place === place).length, place).toBe(place === "p_li_house" || place === "p_zhou_house" ? 4 : 2);
    // The mounts are beside the door of each: one on each side, on the front wall of the building.
    const lanterns = [
      { household: "fam_li", place: "p_li_house", x: 7, y: 5 },
      { household: "fam_zhou", place: "p_zhou_house", x: 36, y: 5 },
      { household: "tea", place: "p_teahouse", x: 34, y: 14 },
      { household: "sishu_xiansheng", place: "p_school", x: 18, y: 5 },
      { household: "zhangfang", place: "p_accountant_home", x: 18, y: 12 },
      { household: "gengfu", place: "p_watch_post", x: 22, y: 14 },
      { household: "zhadeng_shifu", place: "p_workshop", x: 5, y: 21 },
      { household: "mujiang", place: "p_carpenter_home", x: 3, y: 28 },
      { household: "xiao_man", place: "p_xiaoman_home", x: 9, y: 28 },
      { household: "old_he", place: "p_he_home", x: 34, y: 30 },
      { household: "zuzhang", place: "p_clan_hall", x: 50, y: 13 },
      { household: "miaozhu", place: "p_temple", x: 50, y: 18 },
    ];
    await inject(page, { lanterns });
    await expect.poll(async () => ({ lit: (await mapStats(page)).lampsLit, households: (await mapStats(page)).lanterns })).toEqual({ lit: 28, households: 12 });
    for (const place of places) {
      const lamps = (await drawing(page)).lampList.filter((l) => l.place === place);
      expect(lamps.every((l) => l.on), place).toBe(true);
      // One on each side of the middle of the building: they are at one height and apart.
      const house = (await drawing(page)).places.find((p) => p.place === place);
      if (house === undefined) throw new Error(place);
      const [a, b] = lamps;
      expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0)), place).toBeLessThan(0.01);
      expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0)), place).toBeGreaterThan(10);
    }
    // The household of a place that has no door lantern in the kit (the tavern) is lit with the lantern made in code at its cell, and the sprites of the others are as they are.
    await inject(page, { lanterns: [{ household: "tavern", place: "p_tavern", x: 34, y: 17 }, { household: "old_he", place: "p_he_home", x: 34, y: 30 }] });
    await expect.poll(async () => ({ lit: (await mapStats(page)).lampsLit, households: (await mapStats(page)).lanterns })).toEqual({ lit: 2, households: 2 });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the trees of the town are sprites of the kit", () => {
  test("draws a sprite for every tree: the willows by the water, and the others of four kinds and heaps of stones, by a hash of the cell", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    const scene = await sceneOf(page);
    const willows = new Set(willowCells(scene, WILLOW_REACH).map(([x, y]) => `${x},${y}`));
    const plans = planTrees(scene, willows, sprite);
    expect(plans).toHaveLength(51);
    expect(await mapStats(page)).toMatchObject({ willows: 6, trees: 51, junk: 2 });
    const d = await drawing(page);
    expect(d.trees).toBe(51);
    expect(d.treeList.map((t) => [t.x, t.y, t.sprite])).toEqual(plans.map((p) => [p.x, p.y, p.sprite.id]));
    // Every kind of the kit is in the town, and every kind of tree has its sprite in the manifest.
    expect(new Set(d.treeList.map((t) => t.sprite))).toEqual(new Set(TREE_KINDS.map((k) => k.sprite)));
    for (const kind of TREE_KINDS) expect(sprite(kind.sprite)?.kind, kind.sprite).toBe("prop");
    expect(d.junk).toBe(2);

    // A tree of each kind is drawn from its sprite at the south-west corner of its cell, a little off it by the hash: points of its body on the screen are the atlas's.
    await inject(page, { weather: "clear" });
    await clearStage(page);
    const near2 = (a: { x: number; y: number }, b: { x: number; y: number }): boolean => Math.abs(a.x - b.x) <= 2 && Math.abs(a.y - b.y) <= 2;
    for (const kind of TREE_KINDS) {
      // A tree with no other tree, willow or building within two cells.
      const alone = plans.filter((p) => p.sprite.id === kind.sprite).find((p) => !plans.some((o) => o !== p && near2(o, p)) && ![...willows].some((w) => near2({ x: Number(w.split(",")[0]), y: Number(w.split(",")[1]) }, p)));
      if (alone === undefined) continue;
      const def = alone.sprite;
      let matched = 0;
      const points = await solidPoints(page, def.id, 5);
      expect(points.length, def.id).toBeGreaterThan(0);
      for (const [u, v] of points) {
        const spot = await project(page, alone.x * CELL + alone.dx - def.ax + u, (alone.y + 1) * CELL_DEPTH + alone.dy - def.ay + v);
        if (near(await sampleAt(page, spot.x, spot.y), await atlasTexel(page, def.id, 0, u, v))) matched++;
      }
      expect(matched, `${def.id} at ${alone.x},${alone.y}`).toBeGreaterThanOrEqual(Math.ceil(points.length * 0.6));
    }

    // The same town again is the same trees: another page, the same kinds on the same cells.
    await page.reload();
    await lantern.waitForTick(700);
    await expect.poll(() => mapStats(page).then((s) => s.trees)).toBe(51);
    expect((await drawing(page)).treeList.map((t) => [t.x, t.y, t.sprite])).toEqual(plans.map((p) => [p.x, p.y, p.sprite.id]));
    expect(lantern.pageErrors).toEqual([]);
  });

  test("hides a person who stands behind a tree and shows them as a silhouette over it, and a person who stands in front of it is not covered", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    // Every tree and heap of stones, and the junk, is in the list of what can hide a person, with the sort of its south edge.
    const all = await occluders(page);
    const trees = all.filter((o) => TREE_KINDS.some((k) => k.sprite === o.sprite) || o.sprite === PROPS.junkPile);
    expect(trees).toHaveLength(53);
    for (const tree of trees) expect(tree.sort, tree.key).toBeGreaterThan(0);
    // The cell north of a round tree where most of a person is under its crown.
    const crowns = trees.filter((o) => o.sprite !== PROPS.stoneHeap && o.sprite !== PROPS.junkPile);
    expect(crowns.length).toBeGreaterThan(30);
    let best: { tree: Occluder; cell: { x: number; y: number }; share: number } | null = null;
    for (const tree of crowns) {
      for (const c of await scanNorthOf(page, "li_er", tree, 3, 1)) {
        if (best === null || c.share > best.share) best = { tree, cell: c.cell, share: c.share };
      }
      // A tree that covers most of a person is enough.
      if (best !== null && best.share > 0.6) break;
    }
    if (best === null || best.share < 0.3) throw new Error("no cell behind a tree where a person is hidden");
    await stand(page, { li_er: best.cell });
    await expect.poll(async () => (await silhouettesOf(page, "li_er")).some((s) => s.key === best?.tree.key)).toBe(true);
    // The same tree and the person one row south of it, in front: no shape of that tree on the person.
    const footprintRow = Math.round(best.tree.y / CELL_DEPTH);
    await stand(page, { li_er: { x: best.cell.x, y: footprintRow } });
    await expect.poll(async () => (await silhouettesOf(page, "li_er")).some((s) => s.key === best?.tree.key)).toBe(false);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the cost of a picture", () => {
  test("is multisampled only where WebGL is drawn by a graphics card: on a software renderer the map leaves it out, since a picture of the town costs a fifth more with it", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    // The renderer as the browser names it, which is what the map goes by.
    const name = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2");
      const info = gl?.getExtension("WEBGL_debug_renderer_info");
      return gl === null || gl === undefined || info === null || info === undefined ? "" : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    });
    const software = /swiftshader|llvmpipe|softpipe|software/i.test(name);
    expect((await mapStats(page)).multisampled, name).toBe(!software);
    // The context of the canvas has what the map asked for.
    const attributes = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="map"]');
      const gl = canvas?.getContext("webgl2") ?? null;
      return gl === null ? null : gl.getContextAttributes()?.antialias;
    });
    expect(attributes).toBe(!software);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("a kit that lacks these sprites", () => {
  test("draws shapes made in code for the buildings, the trees, the junk and the windows that its manifest has no sprite for, and the sprites for what it has", async ({ lantern }) => {
    const page = lantern.page;
    // A manifest that has only the teahouse, the two houses, the pier and the bridge, the willow, the bamboo and the lanterns, and no trees, no other buildings, no lit windows.
    const old = new Set(["place.teahouse", "place.li_house", "place.zhou_house", "place.ferry_pier", "place.bridge", "place.bridge_broken"]);
    await page.route("**/sprites/manifest.json", async (route) => {
      const raw = (await (await route.fetch()).json()) as { sprites: Record<string, Record<string, unknown>> };
      for (const id of Object.keys(raw.sprites)) {
        if ((id.startsWith("place.") && !old.has(id)) || id.startsWith("fx.windows.") || /^prop\.(tree_|stone_heap|junk_pile)/.test(id)) delete raw.sprites[id];
        else delete raw.sprites[id]?.lights;
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(raw) });
    });
    await openTown(lantern, NIGHT, 1900);
    await inject(page, { weather: "clear", dots: [], bubbles: [], lanterns: [{ household: "fam_li", place: "p_li_house", x: 7, y: 5 }, { household: "sishu_xiansheng", place: "p_school", x: 18, y: 5 }] });
    // Seven places are sprites and the rest are shapes; the willows are sprites and the other trees are shapes; no window is lit by a sprite.
    await expect.poll(() => mapStats(page)).toMatchObject({ places: 7, willows: 6, trees: 0, junk: 0, windows: 0, windowsLit: 0, figures: 21 });
    const d = await drawing(page);
    expect(d.lamps).toBe(10);
    expect(d.treeList).toEqual([]);
    // The school has no sprite and no door lanterns here: the household of its lantern is lit with the lantern made in code at its cell, and the Li house with its own.
    await expect.poll(async () => ({ lit: (await mapStats(page)).lampsLit, households: (await mapStats(page)).lanterns })).toEqual({ lit: 4, households: 2 });
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the people who stand behind the temple and the tavern are shown", () => {
  test("shows the people at the stands of the temple and of the tavern, which are on the far side of the buildings from the camera, as silhouettes over them", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    // The stands of the temple (47,18), (48,17), (52,17), (53,18), (49,17) and of the tavern (32,17), (33,17), (35,17), (36,17) are north of the footprints, behind the buildings.
    await stand(page, { miaozhu: { x: 49, y: 17 }, mujiang: { x: 52, y: 17 }, zhangfang: { x: 33, y: 17 }, gengfu: { x: 36, y: 17 } });
    await expect.poll(async () => (await mapStats(page)).silhouettes).toBeGreaterThanOrEqual(4);
    const shapes = (await drawing(page)).silhouettes;
    expect(shapes.filter((x) => x.person === "miaozhu").map((x) => x.occluder)).toContain("p_temple");
    expect(shapes.filter((x) => x.person === "mujiang").map((x) => x.occluder)).toContain("p_temple");
    expect(shapes.filter((x) => x.person === "zhangfang").map((x) => x.occluder)).toContain("p_tavern");
    expect(shapes.filter((x) => x.person === "gengfu").map((x) => x.occluder)).toContain("p_tavern");
    // One who stands at the door, in front of the temple, is not.
    await stand(page, { miaozhu: { x: 50, y: 23 } });
    await expect.poll(async () => (await silhouettesOf(page, "miaozhu")).length).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });
});

test.describe("the windows of the buildings are lit at night", () => {
  test("shows nothing of the lit windows by day, and by night a sprite over each of the fifteen buildings that have windows, with a halo round each window", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await inject(page, { weather: "clear" });
    const day = await drawing(page);
    expect(day.windows).toHaveLength(15);
    expect((await mapStats(page)).windowsLit).toBe(0);
    expect(day.windows.every((w) => !w.visible && w.alpha === 0)).toBe(true);
    expect(day.windows.map((w) => w.place).sort()).toEqual([
      "p_accountant_home",
      "p_carpenter_home",
      "p_clan_hall",
      "p_he_home",
      "p_li_house",
      "p_li_house",
      "p_school",
      "p_tavern",
      "p_teahouse",
      "p_temple",
      "p_watch_post",
      "p_workshop",
      "p_xiaoman_home",
      "p_zhou_house",
      "p_zhou_house",
    ]);
  });

  test("lights every window at the strength of the night, and the sprite of the lights of a building is the one that its sprite names, a few small shapes and not another building", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern, NIGHT, 1900);
    await inject(page, { dots: [], bubbles: [], lanterns: [], weather: "clear" });
    await clearStage(page);
    await expect.poll(() => mapStats(page).then((s) => s.windowsLit)).toBe(15);
    const d = await drawing(page);
    expect(d.windows.every((w) => w.visible && w.alpha > 0.95)).toBe(true);
    for (const w of d.windows) {
      const lights = sprite(w.sprite);
      expect(lights?.kind, w.sprite).toBe("fx");
      expect(w.halos, w.place).toBe(lights?.spots?.length);
      expect(w.halos, w.place).toBeGreaterThanOrEqual(2);
    }
    // The lights of a building are a small part of it: a strip of windows, which is why they are one sprite made once and not a second copy of the building.
    for (const def of MANIFEST.sprites.values()) {
      if (def.lights === null) continue;
      const lights = sprite(def.lights);
      expect(lights, def.id).toBeDefined();
      expect((lights?.w ?? 0) * (lights?.h ?? 0), def.id).toBeLessThan(def.w * def.h * 0.15);
    }
  });

  test("makes the windows warm and bright on the screen at night where they are dim by day, in every building that has lit windows", async ({ lantern }) => {
    const page = lantern.page;
    await openTown(lantern);
    await inject(page, { weather: "clear" });
    await clearStage(page);
    const scene = await sceneOf(page);
    const plans = planPlaces(scene, sprite).filter((p) => p.lights !== null);
    expect(plans).toHaveLength(15);
    // The middle of each window on the screen, as the manifest says where it is, from the anchor of the building.
    const spots = plans.flatMap((plan) => (plan.lights?.spots ?? []).slice(0, 1).map((s) => ({ place: plan.place, x: plan.rect.x * CELL + s.x * plan.scale, y: (plan.rect.y + plan.rect.h) * CELL_DEPTH + s.y * plan.scale })));
    // Nine points round the middle of each window, three pixels of the screen apart (the middle itself may be a bar of the lattice), read by day and again by night.
    const read = async (): Promise<Array<Array<number[] | null>>> => {
      const out: Array<Array<number[] | null>> = [];
      for (const spot of spots) {
        const at = await project(page, spot.x, spot.y);
        const row: Array<number[] | null> = [];
        for (const dx of [-3, 0, 3]) for (const dy of [-3, 0, 3]) row.push(await sampleAt(page, at.x + dx, at.y + dy));
        out.push(row);
      }
      return out;
    };
    const byDay = await read();
    // The same town at night: the world is held at 19:00 and the map is told it is clear.
    await lantern.open(NIGHT, { menu: false });
    await lantern.waitForTick(1900);
    await expect.poll(() => mapStats(page).then((s) => s.windowsLit)).toBe(15);
    await inject(page, { weather: "clear", dots: [], bubbles: [], lanterns: [] });
    await clearStage(page);
    const byNight = await read();
    let lit = 0;
    spots.forEach((spot, i) => {
      const night = byNight[i] ?? [];
      // The point of the nine where the window is brightest at night, and the same point by day.
      let k = 0;
      night.forEach((px, j) => {
        if ((px?.[0] ?? 0) > (night[k]?.[0] ?? 0)) k = j;
      });
      const n = night[k] ?? [0, 0, 0, 0];
      const d = byDay[i]?.[k] ?? [0, 0, 0, 0];
      // Lit: warm (red over blue by a good margin), bright, and much redder than the same point was by day, in a night that is darker than the day everywhere else.
      if ((n[0] ?? 0) > 120 && (n[0] ?? 0) > (n[2] ?? 0) + 35 && (n[0] ?? 0) > (d[0] ?? 0) + 25) lit++;
      else console.log(`window of ${spot.place}: day ${String(d)} night ${String(n)}`);
    });
    // The windows are lit on the screen: nearly all of the fifteen buildings show a warm point at the middle of their windows (a nine-point sample can fall on the lattice).
    expect(lit).toBeGreaterThanOrEqual(Math.floor(spots.length * 0.8));
    expect(lantern.pageErrors).toEqual([]);
  });
});
