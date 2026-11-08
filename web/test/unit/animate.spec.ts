import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { ARRIVED, chooseAnim, chooseDir, frameOf, HYSTERESIS, phaseOf, poseOf } from "../../src/page/map/animate.ts";
import { type Dir, type Manifest, parseManifest } from "../../src/page/map/manifest.ts";
import { CELL, CELL_DEPTH, groundDistance } from "../../src/page/map/projection.ts";

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest: Manifest = parseManifest(JSON.parse(readFileSync(path.join(WEB, "public/sprites/manifest.json"), "utf8")));
const sprite = (id: string) => {
  const found = manifest.sprites.get(id);
  if (found === undefined) throw new Error(`no sprite ${id}`);
  return found;
};

test.describe("the direction a figure faces", () => {
  test("is the main axis of the movement on the screen", () => {
    expect(chooseDir(10, 0, "down")).toBe("right");
    expect(chooseDir(-10, 0, "down")).toBe("left");
    expect(chooseDir(0, 10, "left")).toBe("down");
    expect(chooseDir(0, -10, "right")).toBe("up");
    // Down the screen is toward the viewer, and a step of one cell down is shorter on the screen than one cell across.
    expect(chooseDir(0.3, 5, "right")).toBe("down");
  });

  test("keeps the last direction when there is no movement", () => {
    for (const dir of ["down", "up", "left", "right"] as const) {
      expect(chooseDir(0, 0, dir)).toBe(dir);
      expect(chooseDir(1e-9, -1e-9, dir)).toBe(dir);
    }
  });

  test("has a hysteresis on the diagonals: the axis it faces along changes only when the other is clearly longer", () => {
    expect(HYSTERESIS).toBeGreaterThan(1);
    // A perfect diagonal keeps whatever axis there was.
    expect(chooseDir(10, 10, "right")).toBe("right");
    expect(chooseDir(10, 10, "left")).toBe("right");
    expect(chooseDir(10, 10, "down")).toBe("down");
    expect(chooseDir(-10, -10, "up")).toBe("up");
    expect(chooseDir(-10, 10, "left")).toBe("left");
    expect(chooseDir(-10, 10, "down")).toBe("down");
    // Facing right, the vertical has to be longer by the hysteresis before the figure turns to face down.
    expect(chooseDir(10, 10 * HYSTERESIS - 0.01, "right")).toBe("right");
    expect(chooseDir(10, 10 * HYSTERESIS + 0.01, "right")).toBe("down");
    // And the other way round.
    expect(chooseDir(10 * HYSTERESIS - 0.01, 10, "down")).toBe("down");
    expect(chooseDir(10 * HYSTERESIS + 0.01, 10, "down")).toBe("right");
  });

  test("turns round at once on the same axis, whatever the hysteresis", () => {
    expect(chooseDir(-10, 1, "right")).toBe("left");
    expect(chooseDir(10, 1, "left")).toBe("right");
    expect(chooseDir(1, -10, "down")).toBe("up");
    expect(chooseDir(1, 10, "up")).toBe("down");
  });

  test("does not flicker on a path that bends: a walk with a slow drift to one side never turns", () => {
    let dir: Dir = "right";
    const seen = new Set<Dir>();
    for (let i = 0; i < 100; i++) {
      // Mostly east, with a wobble in y that changes sign: the figure faces east all the way.
      dir = chooseDir(10, Math.sin(i) * 9, dir);
      seen.add(dir);
    }
    expect([...seen]).toEqual(["right"]);
  });

  test("the diagonal of a cell is a movement on the screen of 32 by 25.22, which is mostly across", () => {
    // A step to the north-east in the grid is wider than it is tall on the screen, by less than the hysteresis.
    expect(CELL / CELL_DEPTH).toBeLessThan(HYSTERESIS);
    expect(chooseDir(CELL, -CELL_DEPTH, "up")).toBe("up");
    expect(chooseDir(CELL, -CELL_DEPTH, "right")).toBe("right");
  });
});

test.describe("the animation and the frame of a figure", () => {
  test("a person who has arrived stands: idle, or talk in a talk, and with bamboo the first frame of the carrying walk", () => {
    const liDa = sprite("char.li_da");
    expect(chooseAnim(liDa, { moving: false, talking: false, carrying: null })).toBe("idle");
    expect(chooseAnim(liDa, { moving: false, talking: true, carrying: null })).toBe("talk");
    expect(chooseAnim(liDa, { moving: false, talking: false, carrying: "bamboo" })).toBe("carry");
    expect(chooseAnim(liDa, { moving: true, talking: false, carrying: null })).toBe("walk");
    expect(chooseAnim(liDa, { moving: true, talking: false, carrying: "bamboo" })).toBe("carry");
    // Other loads are not the bamboo on the shoulder.
    expect(chooseAnim(liDa, { moving: true, talking: false, carrying: "timber" })).toBe("walk");
    expect(chooseAnim(liDa, { moving: false, talking: false, carrying: "tools" })).toBe("idle");
    // A figure without the carrying walk walks and stands as it does without a load.
    const zhanglao = sprite("char.zhanglao");
    expect(zhanglao.anims.has("carry")).toBe(false);
    expect(chooseAnim(zhanglao, { moving: true, talking: false, carrying: "bamboo" })).toBe("walk");
    expect(chooseAnim(zhanglao, { moving: false, talking: false, carrying: "bamboo" })).toBe("idle");
  });

  test("idle and talk run on the clock at 2 frames a second, and two people are not in step", () => {
    const idle = sprite("char.li_er").anims.get("idle");
    expect(idle?.fps).toBe(2);
    expect(idle?.frames).toBe(2);
    if (idle === undefined) return;
    const frames = [0, 0.25, 0.49, 0.5, 0.75, 0.99, 1, 1.5, 2].map((t) => frameOf(idle, 0, false, t));
    expect(frames).toEqual([0, 0, 0, 1, 1, 1, 0, 1, 0]);
    // A phase of a quarter of a second shifts the beat.
    expect(frameOf(idle, 0, false, 0.3, 0.25)).toBe(1);
    expect(frameOf(idle, 0, false, 0.3, 0)).toBe(0);
    // The phase of a name is the same every time, and between 0 and 1.
    expect(phaseOf("li_er")).toBe(phaseOf("li_er"));
    for (const id of ["li_er", "zuzhang", "player", "x"]) expect(phaseOf(id)).toBeGreaterThanOrEqual(0);
    for (const id of ["li_er", "zuzhang", "player", "x"]) expect(phaseOf(id)).toBeLessThan(1);
    expect(new Set(["li_er", "zuzhang", "cha_laoban", "old_he", "li_da"].map(phaseOf)).size).toBeGreaterThan(1);
  });

  test("a walk takes a frame for the ground walked: floor(distance / stride * 6) % 6", () => {
    const walk = sprite("char.zhanglao").anims.get("walk");
    // Each figure has the stride the kit measured for it: a child takes shorter steps than a man.
    expect(walk?.stride).toBeGreaterThan(10);
    expect(sprite("char.child").anims.get("walk")?.stride).toBeLessThan(walk?.stride ?? 0);
    expect(new Set([...manifest.sprites.values()].filter((d) => d.kind === "character").map((d) => d.anims.get("walk")?.stride)).size).toBeGreaterThan(2);
    expect(walk?.frames).toBe(6);
    if (walk === undefined || walk.stride === null) return;
    const stride = walk.stride;
    const at = (d: number) => frameOf(walk, d, true, 0);
    expect(at(0)).toBe(0);
    expect(at(stride / 6 - 0.001)).toBe(0);
    expect(at(stride / 6)).toBe(1);
    expect(at((stride * 5) / 6)).toBe(5);
    expect(at(stride - 0.001)).toBe(5);
    // A whole stride is back at the first frame, and it goes on round.
    expect(at(stride)).toBe(0);
    expect(at(stride * 2.5)).toBe(3);
    const seen = new Set<number>();
    for (let d = 0; d < stride; d += stride / 60) seen.add(at(d));
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5]);
    // Standing still, the walk is on its first frame, whatever has been walked.
    expect(frameOf(walk, 123.4, false, 9)).toBe(0);
    // The ground is measured as the screen shows it.
    expect(frameOf(walk, groundDistance(0, 1), true, 0)).toBe(Math.floor((25.22 / stride) * 6) % 6);
  });

  test("picks the frame of the sprite from the direction: four directions, each its own render", () => {
    const liEr = sprite("char.li_er");
    const base = { talking: false, carrying: null, walked: 0, seconds: 0, phase: 0, reduced: false } as const;
    const seen = new Set<number>();
    for (const dir of ["down", "up", "left", "right"] as const) {
      const pose = poseOf(liEr, { ...base, moving: false, dir });
      expect(pose).toMatchObject({ anim: "idle", dir, frame: 0 });
      expect(pose?.index).toBe(liEr.anims.get("idle")?.dirs[dir][0]);
      seen.add(pose?.index ?? -1);
    }
    expect(seen.size).toBe(4);
    // Left and right are not a mirror of each other: different frames in the atlas.
    expect(liEr.anims.get("walk")?.dirs.left[0]).not.toBe(liEr.anims.get("walk")?.dirs.right[0]);
    const walking = poseOf(liEr, { ...base, moving: true, dir: "left", walked: 100 });
    expect(walking?.anim).toBe("walk");
    expect(walking?.index).toBe(liEr.anims.get("walk")?.dirs.left[walking?.frame ?? 0]);
  });

  test("with less motion asked for, the figure stands on one frame, facing the way it goes", () => {
    const liDa = sprite("char.li_da");
    const base = { talking: false, walked: 80, seconds: 3.7, phase: 0.3, reduced: true } as const;
    const walking = poseOf(liDa, { ...base, moving: true, carrying: null, dir: "up" });
    expect(walking).toMatchObject({ anim: "idle", dir: "up", frame: 0 });
    const carrying = poseOf(liDa, { ...base, moving: true, carrying: "bamboo", dir: "left" });
    expect(carrying).toMatchObject({ anim: "carry", dir: "left", frame: 0 });
    const talking = poseOf(liDa, { ...base, moving: false, talking: true, carrying: null, dir: "right" });
    expect(talking).toMatchObject({ anim: "talk", dir: "right", frame: 0 });
    // The same at any time.
    expect(poseOf(liDa, { ...base, seconds: 99, moving: false, carrying: null, dir: "down" })?.frame).toBe(0);
  });

  test("a person with less than a pixel and a half to go has arrived", () => {
    expect(ARRIVED).toBe(1.5);
  });
});
