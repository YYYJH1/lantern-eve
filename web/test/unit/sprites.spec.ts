import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { DIRS, parseManifest } from "../../src/page/map/manifest.ts";
import { noise } from "../../src/page/map/palette.ts";
import { bambooPile, bridgeIsWhole, figureFor, NAMED_FIGURES, PLACE_ART, PLAYER_SPRITE, PROPS, TREE_KINDS, treeSprite, WILLOW_REACH } from "../../src/page/map/sprites.ts";
import { bambooSite, boundsOf, cellsOf, footprintsOf, planPlaces, planTrees, treeCells, treeKindAt, willowCells } from "../../src/page/map/town.ts";
import { parseScene, type Scene } from "../../src/page/scene.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO = path.resolve(WEB, "..");
const manifest = parseManifest(JSON.parse(readFileSync(path.join(WEB, "public/sprites/manifest.json"), "utf8")));
const has = (id: string): boolean => manifest.sprites.has(id);

/** The scene of the bridge town, as the core sends it, made from the compiled map and the cast file. */
function townScene(): Scene {
  const map = JSON.parse(readFileSync(path.join(REPO, "content/compiled/map_bridge_town.json"), "utf8")) as Record<string, any>;
  const cast = JSON.parse(readFileSync(path.join(REPO, "content/compiled/cast_bridge_v0.json"), "utf8")) as { people: Array<Record<string, unknown>> };
  return parseScene({
    scenario: "bridge",
    width: map.width,
    height: map.height,
    layers: {
      terrain: { rows: map.rows, legend: map.legend },
      buildings: map.places.flatMap((p: any) => (p.footprints ?? []).map((rect: number[]) => ({ rect, kind: p.kind, place: p.id }))),
      barriers: map.barriers,
    },
    places: map.places,
    cast: cast.people,
  });
}
const scene = townScene();

test.describe("who is drawn with which sprite", () => {
  test("gives each of the twenty people of the cast a figure of their own, and the player the manager", () => {
    expect(NAMED_FIGURES).toEqual({
      li_laotai: "char.li_laotai",
      li_da: "char.li_da",
      li_er: "char.li_er",
      shitou: "char.shitou",
      li_xiaomei: "char.li_xiaomei",
      zhou_zhanggui: "char.zhou_zhanggui",
      zhou_niangzi: "char.zhou_niangzi",
      zhou_dalang: "char.zhou_dalang",
      zhou_erlang: "char.zhou_erlang",
      zhou_huoji: "char.zhou_huoji",
      cha_laoban: "char.laobanniang",
      sishu_xiansheng: "char.sishu_xiansheng",
      old_he: "char.lao_he",
      zuzhang: "char.zhanglao",
      zhangfang: "char.zhangfang",
      miaozhu: "char.miaozhu",
      xiao_man: "char.xiao_man",
      gengfu: "char.gengfu",
      mujiang: "char.mujiang",
      zhadeng_shifu: "char.zhadeng_shifu",
    });
    for (const [id, sprite] of Object.entries(NAMED_FIGURES)) {
      expect(figureFor(id, has), id).toBe(sprite);
      expect(manifest.sprites.get(sprite)?.kind).toBe("character");
    }
    expect(figureFor("player", has, true)).toBe(PLAYER_SPRITE);
    expect(PLAYER_SPRITE).toBe("char.zongguan");
    // Every person of the cast file is named, and every name is a person of the cast file.
    const ids = scene.cast.map((p) => p.id);
    expect(ids).toHaveLength(20);
    expect(Object.keys(NAMED_FIGURES).sort()).toEqual([...ids].sort());
    // Nobody shares a figure: the twenty are twenty, and none is the manager's or one of the three of the town.
    const sprites = ids.map((id) => figureFor(id, has));
    expect(new Set(sprites).size).toBe(20);
    expect(sprites).not.toContain(PLAYER_SPRITE);
    for (const shared of ["char.townsman", "char.townswoman", "char.child"]) expect(sprites).not.toContain(shared);
  });

  test("bakes every figure of the twenty and of the manager with the same animations in all four directions: idle and talk on two frames, a walk of six frames with a stride", () => {
    for (const sprite of [...Object.values(NAMED_FIGURES), PLAYER_SPRITE]) {
      const def = manifest.sprites.get(sprite);
      expect(def, sprite).toBeDefined();
      for (const [name, frames] of [["idle", 2], ["walk", 6], ["talk", 2]] as const) {
        const anim = def?.anims.get(name);
        expect(anim?.frames, `${sprite} ${name}`).toBe(frames);
        for (const dir of DIRS) expect(anim?.dirs[dir], `${sprite} ${name} ${dir}`).toHaveLength(frames);
      }
      expect(def?.anims.get("walk")?.stride ?? 0, sprite).toBeGreaterThan(0);
    }
  });

  test("draws a person for whom the manifest has no figure as a piece, and so a person that the core does not name", () => {
    const ids = scene.cast.map((p) => p.id);
    for (const id of ids) expect(figureFor(id, (sprite) => sprite !== NAMED_FIGURES[id] && has(sprite)), id).toBeNull();
    expect(figureFor("stranger", has)).toBeNull();
    expect(figureFor("zuzhang", () => false)).toBeNull();
    expect(figureFor("player", () => false, true)).toBeNull();
  });

  test("lights the bridge whole only when the hud says it is mended", () => {
    expect(bridgeIsWhole({})).toBe(false);
    expect(bridgeIsWhole({ bridge: null })).toBe(false);
    expect(bridgeIsWhole({ bridge: "mended" })).toBe(false);
    for (const state of ["broken", "repairing", "detour", "", "Mended"]) expect(bridgeIsWhole({ bridge: { state } }), state).toBe(false);
    expect(bridgeIsWhole({ bridge: { state: "mended", done: 5, need: 5 } })).toBe(true);
  });

  test("piles the bamboo small for 1 to 9 and large for 10 or more, and none for none", () => {
    expect([-3, 0, 0.5].map(bambooPile)).toEqual([null, null, null]);
    expect([1, 4, 9].map(bambooPile)).toEqual([PROPS.bambooSmall, PROPS.bambooSmall, PROPS.bambooSmall]);
    expect([10, 11, 400].map(bambooPile)).toEqual([PROPS.bambooLarge, PROPS.bambooLarge, PROPS.bambooLarge]);
    expect(bambooPile(Number.NaN)).toBeNull();
  });
});

test.describe("where the sprites of the places stand", () => {
  test("puts every building, the pier and the bridge on footprints the size of their own, each sprite on each building of its place", () => {
    const plans = planPlaces(scene, (id) => manifest.sprites.get(id));
    const expected = [
      "p_accountant_home",
      "p_bridge",
      "p_carpenter_home",
      "p_clan_hall",
      "p_ferry",
      "p_he_home",
      "p_li_house",
      "p_li_house",
      "p_market",
      "p_market",
      "p_market",
      "p_market",
      "p_school",
      "p_tavern",
      "p_teahouse",
      "p_temple",
      "p_watch_post",
      "p_workshop",
      "p_xiaoman_home",
      "p_zhou_house",
      "p_zhou_house",
    ];
    expect(plans.map((p) => p.place).sort()).toEqual(expected);
    for (const plan of plans) {
      // The footprint is the size that the sprite was baked for: no stretching.
      expect(plan.rect.w, plan.place).toBe(plan.whole.footprint?.cols);
      expect(plan.rect.h, plan.place).toBe(plan.whole.footprint?.rows);
      expect(plan.scale, plan.place).toBe(1);
    }
    const at = (place: string) => plans.filter((p) => p.place === place).map((p) => [p.rect.x, p.rect.y]);
    expect(at("p_teahouse")).toEqual([[31, 10]]);
    expect(at("p_li_house").sort()).toEqual([[2, 2], [9, 2]]);
    expect(at("p_zhou_house").sort()).toEqual([[31, 2], [38, 2]]);
    expect(at("p_ferry")).toEqual([[28, 29]]);
    expect(at("p_bridge")).toEqual([[24, 15]]);
    expect(at("p_school")).toEqual([[16, 2]]);
    expect(at("p_accountant_home")).toEqual([[17, 9]]);
    expect(at("p_watch_post")).toEqual([[21, 12]]);
    expect(at("p_workshop")).toEqual([[2, 18]]);
    expect(at("p_carpenter_home")).toEqual([[2, 25]]);
    expect(at("p_xiaoman_home")).toEqual([[8, 25]]);
    expect(at("p_tavern")).toEqual([[32, 18]]);
    expect(at("p_clan_hall")).toEqual([[47, 9]]);
    expect(at("p_temple")).toEqual([[47, 19]]);
    expect(at("p_he_home")).toEqual([[35, 29]]);
    expect(plans.find((p) => p.place === "p_bridge")?.broken?.id).toBe("place.bridge_broken");
    expect(plans.find((p) => p.place === "p_teahouse")?.broken).toBeNull();
    // The art is named by the id of the place.
    expect(Object.keys(PLACE_ART).sort()).toEqual([...new Set(expected)].sort());
    // Every sprite that the art names is in the manifest, and is a place.
    for (const art of Object.values(PLACE_ART)) for (const id of [art.whole, art.broken, ...(art.others ?? [])]) if (id !== undefined) expect(manifest.sprites.get(id)?.kind, id).toBe("place");
  });

  test("gives the four stalls of the market the two kinds of awning in turn, and the other places the one sprite they have", () => {
    const plans = planPlaces(scene, (id) => manifest.sprites.get(id));
    const stalls = plans.filter((p) => p.place === "p_market");
    expect(stalls.map((p) => [p.rect.x, p.rect.y, p.rect.w, p.rect.h])).toEqual([[16, 19, 2, 1], [20, 19, 2, 1], [16, 22, 2, 1], [20, 22, 2, 1]]);
    expect(stalls.map((p) => p.whole.id)).toEqual(["place.market_stall", "place.market_stall_blue", "place.market_stall", "place.market_stall_blue"]);
    // Both kinds fit the footprint of a stall, and neither has windows to light.
    expect(stalls.every((p) => p.scale === 1 && p.lights === null)).toBe(true);
    for (const plan of plans.filter((p) => p.place !== "p_market")) expect(plan.whole.id, plan.place).toBe(plan.art.whole);
    // A kit that has only the first kind of stall uses it for all four: the others are left out, not missing.
    const one = planPlaces(scene, (id) => (id === "place.market_stall_blue" ? undefined : manifest.sprites.get(id))).filter((p) => p.place === "p_market");
    expect(one.map((p) => p.whole.id)).toEqual(Array(4).fill("place.market_stall"));
  });

  test("gives every building with windows the sprite of its lit windows, which sits where the building does, and nothing else has one", () => {
    const plans = planPlaces(scene, (id) => manifest.sprites.get(id));
    const lit = plans.filter((p) => p.lights !== null).map((p) => p.place).sort();
    expect(lit).toEqual(["p_accountant_home", "p_carpenter_home", "p_clan_hall", "p_he_home", "p_li_house", "p_li_house", "p_school", "p_tavern", "p_teahouse", "p_temple", "p_watch_post", "p_workshop", "p_xiaoman_home", "p_zhou_house", "p_zhou_house"]);
    for (const plan of plans) {
      const lights = plan.lights;
      if (lights === null) continue;
      // It is a sprite of the kit that is added to the picture, and it names where its windows are, inside the house's own width.
      expect(lights.kind, plan.place).toBe("fx");
      expect(lights.blend, plan.place).toBe("add");
      expect(plan.whole.lights, plan.place).toBe(lights.id);
      expect(lights.spots?.length ?? 0, plan.place).toBeGreaterThanOrEqual(2);
      for (const spot of lights.spots ?? []) {
        expect(spot.w).toBeGreaterThan(0);
        expect(spot.h).toBeGreaterThan(0);
        // From the anchor of the building (which is the anchor of the lights): up, and within the width of the building and its roof.
        expect(spot.y, plan.place).toBeLessThan(0);
        expect(spot.x, plan.place).toBeGreaterThan(-20);
        expect(spot.x, plan.place).toBeLessThan(plan.whole.w);
      }
    }
    // A kit without the lights of a building draws it as it always did.
    const bare = planPlaces(scene, (id) => (id.startsWith("fx.windows.") ? undefined : manifest.sprites.get(id)));
    expect(bare.every((p) => p.lights === null)).toBe(true);
    expect(bare).toHaveLength(plans.length);
  });

  test("sizes a sprite to a footprint that is not the one it was baked for, by its width", () => {
    const wide = parseScene({
      width: 20,
      height: 20,
      layers: { terrain: { rows: Array.from({ length: 20 }, () => ".".repeat(20)), legend: [{ char: ".", id: "grass" }] }, buildings: [{ rect: [3, 3, 10, 6], kind: "teahouse", place: "p_teahouse" }] },
      places: [{ id: "p_teahouse", kind: "teahouse", rect: [3, 3, 10, 7], zh: "茶馆", en: "Teahouse" }],
    });
    const plans = planPlaces(wide, (id) => manifest.sprites.get(id));
    expect(plans).toHaveLength(1);
    expect(plans[0]?.scale).toBeCloseTo(10 / 7, 10);
  });

  test("has no plan for a place that has no sprite in the manifest, or none in the table", () => {
    expect(planPlaces(scene, () => undefined)).toEqual([]);
    const noBridge = planPlaces(scene, (id) => (id === "place.bridge" || id === "place.bridge_broken" ? undefined : manifest.sprites.get(id)));
    expect(noBridge.some((p) => p.place === "p_bridge")).toBe(false);
    expect(noBridge.some((p) => p.place === "p_teahouse")).toBe(true);
  });

  test("finds the footprint of a place: its buildings, else the deck of the bridge, else the planks of the pier", () => {
    const place = (id: string) => {
      const found = scene.places.find((p) => p.id === id);
      if (found === undefined) throw new Error(id);
      return found;
    };
    expect(footprintsOf(scene, place("p_teahouse"))).toEqual([{ x: 31, y: 10, w: 7, h: 4 }]);
    expect(footprintsOf(scene, place("p_li_house"))).toEqual([{ x: 2, y: 2, w: 5, h: 3 }, { x: 9, y: 2, w: 5, h: 3 }]);
    expect(footprintsOf(scene, place("p_bridge"))).toEqual([{ x: 24, y: 15, w: 6, h: 2 }]);
    expect(footprintsOf(scene, place("p_ferry"))).toEqual([{ x: 28, y: 29, w: 2, h: 1 }]);
    expect(footprintsOf(scene, place("p_under_bridge"))).toEqual([]);
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([[3, 4], [5, 2]])).toEqual({ x: 3, y: 2, w: 3, h: 3 });
  });

  test("makes willows of the trees that stand by the water, and leaves the other trees alone", () => {
    expect(WILLOW_REACH).toBe(3);
    const trees = treeCells(scene);
    // The map has 59 cells of wall or tree and two of them are the junk that closes the lane.
    expect(trees).toHaveLength(57);
    const willows = willowCells(scene, WILLOW_REACH);
    expect(willows).toEqual([[24, 4], [22, 6], [23, 7], [23, 8], [17, 25], [17, 26]]);
    // Every willow is a tree, within three cells of the river or a bank, and no other tree is.
    const wet = new Set([...cellsOf(scene, "river"), ...cellsOf(scene, "bank")].map(([x, y]) => `${x},${y}`));
    const near = (x: number, y: number, r: number): boolean => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (wet.has(`${x + dx},${y + dy}`)) return true;
      return false;
    };
    for (const [x, y] of trees) expect(willows.some(([wx, wy]) => wx === x && wy === y), `${x},${y}`).toBe(near(x, y, 3));
    expect(willowCells(scene, 1)).toEqual([[24, 4]]);
    expect(willowCells(scene, 0)).toEqual([]);
  });

  test("picks the kind of a tree from a hash of its cell: the same for the same cell, whatever else there is, and all the kinds of the kit are used", () => {
    expect(TREE_KINDS.reduce((sum, kind) => sum + kind.share, 0)).toBeCloseTo(1, 10);
    expect(TREE_KINDS.map((k) => k.sprite)).toEqual([PROPS.treeRound, PROPS.treeUmbrella, PROPS.treeCypress, PROPS.treeBamboo, PROPS.stoneHeap]);
    // The kinds in turn, each as long as its share.
    expect(treeSprite(0)).toBe(PROPS.treeRound);
    expect(treeSprite(0.279)).toBe(PROPS.treeRound);
    expect(treeSprite(0.281)).toBe(PROPS.treeUmbrella);
    expect(treeSprite(0.47)).toBe(PROPS.treeCypress);
    expect(treeSprite(0.67)).toBe(PROPS.treeBamboo);
    expect(treeSprite(0.83)).toBe(PROPS.stoneHeap);
    expect(treeSprite(0.9999)).toBe(PROPS.stoneHeap);
    expect(treeSprite(1)).toBe(PROPS.stoneHeap);
    // The kind of a cell is the hash of the cell and of nothing else.
    for (const [x, y] of treeCells(scene)) {
      expect(treeKindAt(x, y), `${x},${y}`).toBe(treeSprite(noise(x, y, 130)));
      expect(treeKindAt(x, y)).toBe(treeKindAt(x, y));
    }
    // A few cells of the map, so that a change of the hash (the town would look different) is seen: the kinds of the trees of the first rows.
    const first = treeCells(scene).slice(0, 8).map(([x, y]) => treeKindAt(x, y).replace("prop.", ""));
    expect(first).toEqual(["stone_heap", "tree_cypress", "tree_cypress", "tree_round", "tree_bamboo", "stone_heap", "tree_umbrella", "tree_round"]);
    // The trees of the town are of every kind, and none is far from its share.
    const kinds = new Map<string, number>();
    for (const [x, y] of treeCells(scene)) kinds.set(treeKindAt(x, y), (kinds.get(treeKindAt(x, y)) ?? 0) + 1);
    for (const kind of TREE_KINDS) expect(kinds.get(kind.sprite) ?? 0, kind.sprite).toBeGreaterThanOrEqual(3);
  });

  test("makes sprites of the trees that are not willows, one for each cell, a little off its middle, and leaves out a tree whose kind the kit has not", () => {
    const sprite = (id: string) => manifest.sprites.get(id);
    const willows = new Set(willowCells(scene, WILLOW_REACH).map(([x, y]) => `${x},${y}`));
    const plans = planTrees(scene, willows, sprite);
    // 57 cells of trees, 6 of them willows.
    expect(plans).toHaveLength(treeCells(scene).length - willows.size);
    expect(plans).toHaveLength(51);
    const cells = new Set(plans.map((p) => `${p.x},${p.y}`));
    expect(cells.size).toBe(plans.length);
    for (const key of willows) expect(cells.has(key), key).toBe(false);
    // The junk that closes the lane is no tree.
    for (const barrier of scene.barriers) for (const [x, y] of barrier.cells) expect(cells.has(`${x},${y}`)).toBe(false);
    for (const plan of plans) {
      expect(plan.sprite.id).toBe(treeKindAt(plan.x, plan.y));
      expect(Math.abs(plan.dx)).toBeLessThanOrEqual(3);
      expect(Math.abs(plan.dy)).toBeLessThanOrEqual(2);
    }
    // The same plan twice, and the same when asked in another order of the cells of the willows.
    expect(planTrees(scene, willows, sprite).map((p) => [p.x, p.y, p.sprite.id, p.dx, p.dy])).toEqual(plans.map((p) => [p.x, p.y, p.sprite.id, p.dx, p.dy]));
    // A kit that has not the bamboo draws the clumps as shapes made in code: they are not in the plan, and the others are.
    const noBamboo = planTrees(scene, willows, (id) => (id === PROPS.treeBamboo ? undefined : sprite(id)));
    expect(noBamboo).toHaveLength(plans.length - plans.filter((p) => p.sprite.id === PROPS.treeBamboo).length);
    expect(planTrees(scene, willows, () => undefined)).toEqual([]);
    // Without willows every tree is a plan.
    expect(planTrees(scene, new Set(), sprite)).toHaveLength(57);
  });

  test("piles the bamboo beside the west end of the deck, on the bank south of it", () => {
    expect(bambooSite({ x: 24, y: 15, w: 6, h: 2 }, 2)).toEqual({ x: 22, y: 17 });
    const cell = scene.rows[17]?.charAt(22);
    expect(scene.legend.get(cell ?? "")).toBe("street");
  });
});
