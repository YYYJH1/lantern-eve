import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { atlasUrl, DIRS, frameRect, ManifestError, parseManifest, pickScale, SCHEMA } from "../../src/page/map/manifest.ts";
import { figureFor, NAMED_FIGURES } from "../../src/page/map/sprites.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RAW = JSON.parse(readFileSync(path.join(WEB, "public/sprites/manifest.json"), "utf8")) as Record<string, any>;
const clone = (): Record<string, any> => JSON.parse(JSON.stringify(RAW)) as Record<string, any>;

test.describe("the manifest of the sprite kit", () => {
  test("is read whole: every sprite of the kit, with its frames, anchors and animations", () => {
    const m = parseManifest(RAW);
    expect(m.schema).toBe(SCHEMA);
    expect(m.rejected).toEqual([]);
    expect(m.scales).toEqual([1, 2]);
    expect([...m.sprites.keys()].sort()).toEqual(Object.keys(RAW.sprites).sort());
    const zhanglao = m.sprites.get("char.zhanglao");
    expect(zhanglao).toMatchObject({ kind: "character", w: 88, h: 89, ax: 33, ay: 57 });
    expect([...(zhanglao?.anims.keys() ?? [])]).toEqual(["idle", "walk", "talk"]);
    expect(zhanglao?.anims.get("walk")).toMatchObject({ fps: 8, frames: 6, stride: RAW.sprites["char.zhanglao"].anims.walk.strideCyclePx });
    expect(zhanglao?.anims.get("idle")).toMatchObject({ fps: 2, frames: 2, stride: null });
    for (const dir of DIRS) expect(zhanglao?.anims.get("walk")?.dirs[dir]).toHaveLength(6);
    expect([...(m.sprites.get("char.li_da")?.anims.keys() ?? [])]).toEqual(["idle", "walk", "talk", "carry"]);
    // A place: its footprint, and what it needs to be put on a lawn.
    expect(m.sprites.get("place.teahouse")).toMatchObject({ kind: "place", footprint: { cols: 7, rows: 4 }, ax: 19, ay: 197 });
    expect(m.sprites.get("place.li_house")?.mounts).toEqual(RAW.sprites["place.li_house"].lanternMountsPx1x);
    expect(m.sprites.get("place.teahouse")?.mounts).toEqual(RAW.sprites["place.teahouse"].lanternMountsPx1x);
    expect(m.sprites.get("place.bridge")?.deckLift).toHaveLength(13);
    expect(m.sprites.get("place.bridge_broken")?.deckLift).toHaveLength(13);
    expect(m.sprites.get("prop.door_lantern_lit")?.glow).toEqual({ sprite: "fx.lantern_glow", offset: RAW.sprites["prop.door_lantern_lit"].glowOffsetPx });
    expect(m.sprites.get("fx.lantern_glow")?.blend).toBe("add");
    expect(m.sprites.get("prop.willow")?.footprint).toEqual({ cols: 1, rows: 1 });
  });

  test("reads the lit windows of a building: the sprite that has them, and where each window is", () => {
    const m = parseManifest(RAW);
    const tea = m.sprites.get("place.teahouse");
    expect(tea?.lights).toBe("fx.windows.teahouse");
    expect(tea?.spots).toBeNull();
    const lights = m.sprites.get("fx.windows.teahouse");
    expect(lights).toMatchObject({ kind: "fx", blend: "add", lights: null });
    expect(lights?.spots).toEqual((RAW.sprites["fx.windows.teahouse"].spots as number[][]).map(([x, y, w, h]) => ({ x, y, w, h })));
    expect(lights?.spots?.length).toBeGreaterThanOrEqual(2);
    // The bridge, the pier and the stalls have no windows.
    for (const id of ["place.bridge", "place.ferry_pier", "place.market_stall"]) expect(m.sprites.get(id)?.lights, id).toBeNull();
    // Every building that names lit windows names a sprite that is there and says where its windows are, and it is small beside the building.
    let named = 0;
    for (const def of m.sprites.values()) {
      if (def.lights === null) continue;
      named++;
      const own = m.sprites.get(def.lights);
      expect(own?.spots?.length, def.id).toBeGreaterThan(0);
      expect(own?.blend, def.id).toBe("add");
      expect((own?.w ?? 0) * (own?.h ?? 0), def.id).toBeLessThan(def.w * def.h * 0.15);
    }
    expect(named).toBe(13);
    // A window that is not four numbers leaves that sprite out, and the others are read.
    const raw = clone();
    raw.sprites["fx.windows.teahouse"].spots[0] = [1, 2, 3];
    const bad = parseManifest(raw);
    expect(bad.rejected.map((r) => r.id)).toEqual(["fx.windows.teahouse"]);
    expect(bad.sprites.has("place.teahouse")).toBe(true);
  });

  test("has the things of the corner of the page: the elder's seal, the notebook, and the incense burner unlit and lit", () => {
    const m = parseManifest(RAW);
    const things = {
      "prop.elder_seal": { zh: "族长印", en: "Clan elder's seal" },
      "prop.notebook": { zh: "见闻簿", en: "Notebook, thread-bound" },
      "prop.incense_unlit": { zh: "香炉（未点）", en: "Incense burner, unlit" },
      "prop.incense_lit": { zh: "香炉（点燃）", en: "Incense burner, lit" },
    };
    for (const [id, name] of Object.entries(things)) {
      const sprite = m.sprites.get(id);
      expect(sprite, id).toBeDefined();
      if (sprite === undefined) continue;
      expect(sprite.kind, id).toBe("prop");
      expect(sprite.name, id).toEqual(name);
      // They stand on one point and are drawn in the page, not on the map: no footprint, no animation, no lamp, no light.
      expect(sprite.footprint, id).toBeNull();
      expect(sprite.anims.size, id).toBe(0);
      expect([sprite.mounts, sprite.deckLift, sprite.glow, sprite.blend, sprite.lights, sprite.spots], id).toEqual([null, null, null, null, null, null]);
      // About 56 to 72 pixels tall at 1x, the anchor on the frame, and the 2x frame is twice the size.
      expect(sprite.h, id).toBeGreaterThanOrEqual(56);
      expect(sprite.h, id).toBeLessThanOrEqual(72);
      expect(sprite.w, id).toBeLessThanOrEqual(80);
      expect(sprite.ax, id).toBeGreaterThan(0);
      expect(sprite.ax, id).toBeLessThan(sprite.w);
      expect(sprite.ay, id).toBeGreaterThan(0);
      expect(sprite.ay, id).toBeLessThan(sprite.h);
      expect(sprite.frames.get(1), id).toHaveLength(1);
      expect(frameRect(sprite, 2, 0), id).toMatchObject({ w: 2 * sprite.w, h: 2 * sprite.h });
    }
    // The two burners are one model. The page swaps them, so they stand on the same point: the same anchor from the left, the same
    // room under the anchor for the bowl and its shadow, and the lit one is taller above it by the smoke.
    const unlit = m.sprites.get("prop.incense_unlit");
    const lit = m.sprites.get("prop.incense_lit");
    expect(lit?.ax).toBe(unlit?.ax);
    expect((lit?.h ?? 0) - (lit?.ay ?? 0)).toBe((unlit?.h ?? 0) - (unlit?.ay ?? 0));
    expect(lit?.ay).toBeGreaterThan(unlit?.ay ?? Infinity);
    // The map does not draw them: nobody on the map is drawn with one, and no building names one.
    for (const def of m.sprites.values()) {
      if (def.glow !== null) expect(Object.keys(things)).not.toContain(def.glow.sprite);
      if (def.lights !== null) expect(Object.keys(things)).not.toContain(def.lights);
    }
    for (const sprite of Object.values(NAMED_FIGURES)) expect(Object.keys(things)).not.toContain(sprite);
  });

  test("has no path of a machine in it, and every file it names is in the folder of the manifest", () => {
    const text = readFileSync(path.join(WEB, "public/sprites/manifest.json"), "utf8");
    expect(text).not.toMatch(/\/(home|data|tmp|Users)\/|[A-Za-z]:\\/);
    for (const pages of Object.values(RAW.atlases as Record<string, Array<{ file: string }>>)) {
      for (const page of pages) {
        expect(page.file).toMatch(/^atlas-[0-9]x(-[0-9]+)?\.webp$/);
        expect(() => readFileSync(path.join(WEB, "public/sprites", page.file))).not.toThrow();
      }
    }
  });

  test("puts every frame inside its atlas, at both scales, and the 2x atlas holds the frames at twice the size", () => {
    const m = parseManifest(RAW);
    let frames = 0;
    for (const sprite of m.sprites.values()) {
      for (const scale of m.scales) {
        const pages = m.atlases.get(scale) ?? [];
        const list = sprite.frames.get(scale) ?? [];
        expect(list.length, `${sprite.id} at ${scale}x`).toBe(sprite.frames.get(1)?.length);
        for (let i = 0; i < list.length; i++) {
          const rect = frameRect(sprite, scale, i);
          expect(rect, `${sprite.id} #${i}`).not.toBeNull();
          if (rect === null) continue;
          const page = pages[rect.page];
          expect(page).toBeDefined();
          expect(rect.x + rect.w).toBeLessThanOrEqual(page?.w ?? 0);
          expect(rect.y + rect.h).toBeLessThanOrEqual(page?.h ?? 0);
          expect(rect.w).toBe(sprite.w * scale);
          expect(rect.h).toBe(sprite.h * scale);
          if (scale === 1) frames++;
        }
      }
      // Every frame of every animation exists.
      for (const anim of sprite.anims.values()) {
        for (const dir of DIRS) for (const index of anim.dirs[dir]) expect(frameRect(sprite, 1, index), `${sprite.id} ${anim.name} ${dir}`).not.toBeNull();
      }
    }
    expect(frames).toBe(RAW.sprites ? Object.values(RAW.sprites as Record<string, any>).reduce((n, s) => n + s.frames["1"].length, 0) : 0);
    expect(frameRect(m.sprites.get("char.li_da")!, 1, 10_000)).toBeNull();
  });

  test("names the files of the atlas, and says where they are from where the manifest is", () => {
    const m = parseManifest(RAW);
    // An atlas of one page is `atlas-1x.webp`, one of several is `atlas-2x-1.webp`, `atlas-2x-2.webp`, and so on; no page is larger than 4096 pixels each way, which every graphics card holds.
    for (const scale of m.scales) {
      const pages = m.atlases.get(scale) ?? [];
      expect(pages.map((p) => p.file), `${scale}x`).toEqual(pages.length === 1 ? [`atlas-${scale}x.webp`] : pages.map((_, i) => `atlas-${scale}x-${i + 1}.webp`));
      for (const page of pages) {
        expect(page.w).toBeLessThanOrEqual(4096);
        expect(page.h).toBeLessThanOrEqual(4096);
      }
    }
    expect(m.atlases.get(1)).toHaveLength(1);
    expect(atlasUrl("http://127.0.0.1:5000/sprites/manifest.json", "atlas-2x.webp")).toBe("http://127.0.0.1:5000/sprites/atlas-2x.webp");
    expect(atlasUrl("http://x.test/play/sprites/manifest.json", "atlas-1x-2.webp")).toBe("http://x.test/play/sprites/atlas-1x-2.webp");
  });

  test("draws from the 2x atlas on a screen of high pixel density, else from the 1x", () => {
    expect([1, 1.1, 1.25].map((r) => pickScale([1, 2], r))).toEqual([1, 1, 1]);
    expect([1.5, 1.75, 2, 3].map((r) => pickScale([1, 2], r))).toEqual([2, 2, 2, 2]);
    expect(pickScale([2, 1], 1)).toBe(1);
    expect(pickScale([1], 2)).toBe(1);
  });

  test("refuses a manifest that is not of this schema or was baked with another camera, since every anchor would be wrong", () => {
    expect(() => parseManifest(null)).toThrow(ManifestError);
    expect(() => parseManifest({})).toThrow(ManifestError);
    const other = clone();
    other.schema = "lantern-eve/sprite-kit@2";
    expect(() => parseManifest(other)).toThrow(/schema/);
    const later = clone();
    later.schema = "lantern-eve/sprite-kit@1.1";
    expect(() => parseManifest(later)).not.toThrow();
    for (const [key, value] of [
      ["cellPx", 40],
      ["cellDepthPx1x", 28],
      ["heightPxPerUnit1x", 40],
    ] as const) {
      const bad = clone();
      bad.units[key] = value;
      expect(() => parseManifest(bad), key).toThrow(/baked for a cell/);
    }
    const noAtlas = clone();
    noAtlas.atlases = {};
    expect(() => parseManifest(noAtlas)).toThrow(ManifestError);
    const noSprites = clone();
    delete noSprites.sprites;
    expect(() => parseManifest(noSprites)).toThrow(ManifestError);
  });

  test("leaves out a sprite that is broken and uses the rest", () => {
    const raw = clone();
    raw.sprites["char.broken_frame"] = { ...raw.sprites["char.li_er"], frames: { "1": [[0, 99999, 0]], "2": [[0, 0, 0]] } };
    raw.sprites["char.no_anchor"] = { ...raw.sprites["char.li_er"], anchor: undefined };
    raw.sprites["char.bad_index"] = JSON.parse(JSON.stringify(raw.sprites["char.li_er"]));
    raw.sprites["char.bad_index"].anims.idle.dirs.down = [0, 9999];
    raw.sprites["char.page"] = JSON.parse(JSON.stringify(raw.sprites["char.li_er"]));
    raw.sprites["char.page"].frames["1"][0] = [3, 0, 0];
    raw.sprites["char.lopsided"] = JSON.parse(JSON.stringify(raw.sprites["char.li_er"]));
    raw.sprites["char.lopsided"].frames["2"].pop();
    raw.sprites["char.string"] = "not a sprite";
    const m = parseManifest(raw);
    expect(m.rejected.map((r) => r.id).sort()).toEqual(["char.broken_frame", "char.bad_index", "char.lopsided", "char.no_anchor", "char.page", "char.string"].sort());
    expect(m.rejected.every((r) => r.reason !== "")).toBe(true);
    expect(m.sprites.has("char.li_er")).toBe(true);
    expect(m.sprites.size).toBe(Object.keys(RAW.sprites).length);
  });

  test("draws each person of the cast with the figure of their own, and as a piece when the manifest has none", () => {
    const withThem = parseManifest(RAW);
    const has = (m: typeof withThem) => (id: string) => m.sprites.has(id);
    for (const [id, sprite] of Object.entries(NAMED_FIGURES)) {
      expect(withThem.sprites.get(sprite)?.kind, sprite).toBe("character");
      expect(figureFor(id, has(withThem)), id).toBe(sprite);
    }
    expect(figureFor("gengfu", has(withThem))).toBe("char.gengfu");
    expect(figureFor("zhou_niangzi", has(withThem))).toBe("char.zhou_niangzi");
    expect(figureFor("xiao_man", has(withThem))).toBe("char.xiao_man");
    // A kit that lacks the figure of one person leaves that person a piece, and the others have theirs.
    const raw = clone();
    delete raw.sprites["char.mujiang"];
    const without = parseManifest(raw);
    expect(without.rejected).toEqual([]);
    expect(figureFor("mujiang", has(without))).toBeNull();
    for (const [id, sprite] of Object.entries(NAMED_FIGURES)) if (id !== "mujiang") expect(figureFor(id, has(without)), id).toBe(sprite);
  });

  test("takes a sprite that a later bake adds without a change of code: named for a person, it is theirs", () => {
    const raw = clone();
    raw.sprites["char.stranger"] = raw.sprites["char.li_er"];
    const m = parseManifest(raw);
    expect(m.rejected).toEqual([]);
    const has = (id: string) => m.sprites.has(id);
    expect(figureFor("stranger", has)).toBe("char.stranger");
    // The people of the cast are as they were.
    expect(figureFor("xiao_man", has)).toBe("char.xiao_man");
    expect(figureFor("zuzhang", has)).toBe("char.zhanglao");
  });
});
