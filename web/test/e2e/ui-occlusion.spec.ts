import type { Page } from "@playwright/test";
import { PAL } from "../../src/page/map/palette.ts";
import { FILL_ALPHA } from "../../src/page/map/silhouette-layer.ts";
import { expect, LanternPage, test } from "../support/fixtures.ts";
import {
  apart,
  blend,
  boxOf,
  colourOf,
  drawnPicture,
  emptyTown,
  footprintOf,
  grounds,
  hiderPicture,
  holdStill,
  nearest,
  type Occluder,
  occluderOf,
  occluders,
  pickAt,
  project,
  rgb,
  roomiest,
  scanNorthOf,
  sceneOf,
  selectedOf,
  silhouettesOf,
  solidAt,
  sortedChildren,
  spyOnGround,
  together,
  zoomOf,
} from "../support/occlusion.ts";
import { atlasTexel, drawing, flatPoint, inject, mapStats, MANIFEST, near, NIGHT, sampleAt, stand } from "../support/sprites.ts";

// This spec looks at the map, so its pages draw it.
test.use({ map: true });

const canvasOf = (lantern: LanternPage) => lantern.page.getByTestId("map");
const FILL = FILL_ALPHA;
/** A cell on the row at the south edge of the town, where nobody is behind anything: where a person is sent to be out of the way. */
const AWAY = { x: 2, y: 33 };

/** The silhouette of a person that the tests look at: the point of it with the most room round it, in the world and on the screen, and the pictures it is made of. */
async function silhouetteSpot(page: Page, who: string, house: Occluder) {
  const { pic, at } = await drawnPicture(page, who);
  const hider = await hiderPicture(page, house);
  const spot = roomiest(boxOf(pic, at), (x, y) => solidAt(pic, at, 1, x, y) && hider.solid(x, y), 6);
  if (spot === null) throw new Error(`${who} has no body over ${house.id} to look at`);
  return { world: spot, screen: await project(page, spot.x, spot.y), pic, at, hider };
}

/**
 * The silhouette of a person over a building is the colour of their family laid over the building's own pixel at the strength of the fill, whatever
 * the light is, and is not the pixel of the person: the building hides the figure and the shape is drawn over the building. The test takes the pixel of
 * the screen inside the silhouette, then takes the person away and takes the pixel of the building as it is drawn, and compares them with the colour of
 * the family and with the texel of the atlas of the person.
 */
async function fillIsTheFamilyOverTheBuilding(page: Page, who: string, house: Occluder, away: { x: number; y: number }, colour: number): Promise<void> {
  const spot = await silhouetteSpot(page, who, house);
  const inside = await sampleAt(page, spot.screen.x, spot.screen.y);
  if (inside === null) throw new Error("no pixel");
  const own = await atlasTexel(page, spot.pic.def.id, (await drawing(page)).people.find((p) => p.id === who)?.index ?? 0, spot.world.x - spot.at.x + spot.pic.def.ax, spot.world.y - spot.at.y + spot.pic.def.ay);
  const wasHere = (await silhouettesOf(page, who)).length;
  expect(wasHere).toBeGreaterThan(0);
  // The same point of the screen with the person gone: the building as it is drawn, which is its own texel in the light of the hour.
  await stand(page, { [who]: away });
  await expect.poll(async () => (await silhouettesOf(page, who)).length).toBe(0);
  const bare = await sampleAt(page, spot.screen.x, spot.screen.y);
  if (bare === null) throw new Error("no pixel");
  const house0 = MANIFEST.sprites.get(house.sprite);
  if (house0 === undefined) throw new Error("no sprite for the building");
  const texel = await atlasTexel(page, house.sprite, 0, (spot.world.x - house.x) / house.scale + house0.ax, (spot.world.y - house.y) / house.scale + house0.ay);
  expect(near(bare, texel, 80), `the building shows ${String(bare)} where its atlas has ${texel.join(",")}`).toBe(true);
  const expected = blend(bare, colour, FILL);
  expect(apart(inside, expected), `${who}: inside the silhouette the screen has ${String(inside)}, the family laid over the building should make ${expected.map(Math.round).join(",")}`).toBeLessThanOrEqual(14);
  // It is not the building's pixel, and it is not the pixel of the person: the building hides the person, and the shape is flat.
  expect(apart(inside, bare)).toBeGreaterThan(14);
  if (apart(expected, own) > 30) expect(apart(inside, own), `the pixel of the person's own body is ${own.join(",")}`).toBeGreaterThan(14);
}

const playerOf = (page: Page) => page.evaluate(() => (window.__lantern.client.state.frame as unknown as { player: Record<string, unknown> }).player);

test.describe("a person who stands behind a building is shown through it", () => {
  test("is a silhouette over the tea house in the colour of the person's family, where the body of the person and the body of the building meet", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const scene = await sceneOf(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    // Nobody is behind anything to start with: the people are on the south edge of the town.
    expect(await silhouettesOf(page)).toEqual([]);
    expect(await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.silhouettes)).toBe("0");
    // A cell north of the footprint where all of the body is under the roof, in whichever way he faces.
    const cell = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.share >= 0.9);
    expect(cell.y).toBeLessThan(rect.y);
    await stand(page, { li_er: cell });
    const colour = colourOf(scene, "li_er");
    await expect.poll(() => silhouettesOf(page)).toEqual([expect.objectContaining({ person: "li_er", occluder: "p_teahouse", colour })]);
    const [one] = await silhouettesOf(page);
    // It is drawn just over the building, over the lanterns at its door (0.1 over it), and under everybody who stands in front of it (half a cell, 12 pixels, or more).
    expect(one?.sort ?? 0).toBeGreaterThan(house.sort + 0.1);
    expect(one?.sort ?? 0).toBeLessThan(house.sort + 0.25);
    expect(await mapStats(page)).toMatchObject({ silhouettes: 1, figures: 21 });
    expect(await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.silhouettes)).toBe("1");
    // The pixel of the screen inside it.
    await fillIsTheFamilyOverTheBuilding(page, "li_er", house, AWAY, colour);
    expect(lantern.pageErrors).toEqual([]);
    expect(lantern.consoleLines.filter((l) => /^\[(page|worker):error\]|Content Security Policy|Refused to/.test(l))).toEqual([]);
  });

  test("is not darkened by the night: the colour of the family over the dark roof is as bright as it is by day", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern, NIGHT, 1900);
    const scene = await sceneOf(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const cell = nearest(await scanNorthOf(page, "zhou_huoji", house), rect, (c) => c.share >= 0.9);
    await stand(page, { zhou_huoji: cell });
    await expect.poll(async () => (await silhouettesOf(page, "zhou_huoji")).length).toBe(1);
    const night = await page.evaluate(() => window.__lantern.view.stats().daylight);
    expect(night).toBeLessThan(0.3);
    await fillIsTheFamilyOverTheBuilding(page, "zhou_huoji", house, AWAY, colourOf(scene, "zhou_huoji"));
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is picked where the silhouette is, with the name and the outline on the pointer and a click that picks them, and the building is picked on the rest of its body", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    await spyOnGround(page);
    const house = await occluderOf(page, "p_teahouse");
    const cell = nearest(await scanNorthOf(page, "li_er", house), footprintOf(house), (c) => c.share >= 0.9);
    await stand(page, { li_er: cell });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(1);
    const spot = await silhouetteSpot(page, "li_er", house);
    // Where the silhouette is: the person, and not the building that hides them. The place under it is the building.
    expect(await pickAt(page, spot.screen.x, spot.screen.y)).toEqual({ kind: "person", id: "li_er" });
    await canvasOf(lantern).hover({ position: spot.screen });
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => [t.name, t.badge, t.picked])).toEqual([["Li Er", "L", false]]);
    expect((await drawing(page)).people.filter((p) => p.outlined).map((p) => p.id)).toEqual(["li_er"]);
    // A click on it is a click on the person, as it is on a person who is not hidden: they are picked, and the click is not on the ground.
    await canvasOf(lantern).click({ position: spot.screen });
    await expect.poll(() => selectedOf(page)).toBe("li_er");
    expect(await grounds(page)).toEqual([]);
    // On the building where the silhouette is not, a few pixels from the person's body: the building, and a click on it is the ground at the building and the pick is gone.
    const { pic, at } = await drawnPicture(page, "li_er");
    const beside = roomiest({ x0: at.x - 70, y0: at.y - 90, x1: at.x + 70, y1: at.y + 6 }, (x, y) => spot.hider.solid(x, y) && !solidAt(pic, at, 1, x, y), 5);
    if (beside === null) throw new Error("no building beside the person");
    const there = await project(page, beside.x, beside.y);
    expect(await pickAt(page, there.x, there.y)).toEqual({ kind: "place", id: "p_teahouse" });
    await canvasOf(lantern).click({ position: there });
    await expect.poll(async () => (await grounds(page)).length).toBe(1);
    expect((await grounds(page))[0]?.place).toBe("p_teahouse");
    expect(await selectedOf(page)).toBe("");
    // Bare ground is nobody, as before.
    expect(await pickAt(page, 2, 2)).toBeNull();
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is not drawn for a person in front of the building, who is picked ahead of the silhouette of a person behind them", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const middle = Math.round(rect.x + rect.w / 2 - 0.5);
    const south = Math.round(rect.y + rect.h);
    // Alone in front of the building, one cell south of it: nothing is drawn, and she is picked on her body.
    await stand(page, { cha_laoban: { x: middle, y: south } });
    expect(await silhouettesOf(page)).toEqual([]);
    expect((await mapStats(page)).silhouettes).toBe(0);
    const front = await page.evaluate(() => window.__lantern.view.bodyPositionOf("cha_laoban"));
    if (front === null) throw new Error("no cha_laoban");
    expect(await pickAt(page, front.x, front.y)).toEqual({ kind: "person", id: "cha_laoban" });
    // A person who stands in the last row of the footprint is behind its south edge, and is hidden by the foot of the building: the keeper is in front of him.
    // Of the cells in front of that row the one where the two bodies and the building all have a pixel is the one to stand on.
    let met: { world: { x: number; y: number }; screen: { x: number; y: number } } | null = null;
    for (const dx of [0, -1, 1, -2, 2]) {
      await stand(page, { li_er: { x: middle + dx, y: south - 1 }, cha_laoban: { x: middle + dx, y: south } });
      const back = await drawnPicture(page, "li_er");
      const keeper = await drawnPicture(page, "cha_laoban");
      const hider = await hiderPicture(page, house);
      const world = roomiest(together(boxOf(back.pic, back.at), boxOf(keeper.pic, keeper.at)), (x, y) => solidAt(back.pic, back.at, 1, x, y) && solidAt(keeper.pic, keeper.at, 1, x, y) && hider.solid(x, y), 4);
      if (world !== null) {
        met = { world, screen: await project(page, world.x, world.y) };
        break;
      }
    }
    if (met === null) throw new Error("no point where both people and the building have a pixel");
    // He is hidden, and the keeper in front of him is not.
    expect((await silhouettesOf(page)).map((s) => [s.person, s.occluder])).toEqual([["li_er", "p_teahouse"]]);
    // Where the keeper's body is over the silhouette of the other, the keeper is picked, and she is drawn over the silhouette.
    expect(await pickAt(page, met.screen.x, met.screen.y)).toEqual({ kind: "person", id: "cha_laoban" });
    const both = await sampleAt(page, met.screen.x, met.screen.y);
    await stand(page, { li_er: AWAY });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(0);
    const alone = await sampleAt(page, met.screen.x, met.screen.y);
    if (both === null || alone === null) throw new Error("no pixel");
    expect(apart(both, alone), `the keeper over the silhouette is ${String(both)}, the keeper alone is ${String(alone)}`).toBeLessThanOrEqual(8);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes at once when the person leaves from behind the building, comes back with them, and leaves no node behind", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const cell = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.share >= 0.9);
    const base = await sortedChildren(page);
    // Behind and out, again and again: one node while he is behind, and the same number of nodes of the map as before when he is not.
    for (let round = 0; round < 4; round++) {
      await stand(page, { li_er: cell });
      await expect.poll(async () => (await silhouettesOf(page, "li_er")).length).toBe(1);
      expect(await sortedChildren(page)).toBe(base + 1);
      expect((await mapStats(page)).silhouettes).toBe(1);
      await stand(page, { li_er: AWAY });
      await expect.poll(async () => (await silhouettesOf(page)).length).toBe(0);
      expect(await sortedChildren(page)).toBe(base);
      expect((await mapStats(page)).silhouettes).toBe(0);
      expect(await canvasOf(lantern).evaluate((el) => (el as HTMLCanvasElement).dataset.silhouettes)).toBe("0");
    }
    // The map hands out no pick for him there either: the building is picked where he was.
    const spot = await (async () => {
      await stand(page, { li_er: cell });
      return silhouetteSpot(page, "li_er", house);
    })();
    await stand(page, { li_er: AWAY });
    expect(await pickAt(page, spot.screen.x, spot.screen.y)).toEqual({ kind: "place", id: "p_teahouse" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("goes when the person walks out of the shadow of the building, step after step, and is there once for each person at every step", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    // The person walks, so the map is not held still.
    await holdStill(page, false);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const cell = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.share >= 0.9);
    await stand(page, { li_er: cell });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(1);
    // He is sent a long way, straight south through the row of the building and out in front of it, and the map follows him: no step of the way has more than one silhouette, and at the end there is none.
    await page.evaluate(() => {
      const watch = window as unknown as { __seen: number[] };
      watch.__seen = [];
      const view = window.__lantern.view;
      const timer = window.setInterval(() => watch.__seen.push(view.stats().silhouettes), 16);
      (window as unknown as { __timer: number }).__timer = timer;
    });
    await stand(page, { li_er: { x: cell.x, y: AWAY.y } });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(0);
    await page.evaluate(() => window.clearInterval((window as unknown as { __timer: number }).__timer));
    const seen = await page.evaluate(() => (window as unknown as { __seen: number[] }).__seen);
    expect(seen.length).toBeGreaterThan(3);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1);
    expect(seen.at(-1)).toBe(0);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is drawn for two people at once, each in the colour of their own family, and each is picked where their own silhouette is", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const scene = await sceneOf(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const first = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.share >= 0.9);
    // The second at least three cells from the first, so that the two bodies do not meet on the screen.
    const second = nearest(await scanNorthOf(page, "zhou_zhanggui", house), { ...rect, x: rect.x + (first.x > rect.x + rect.w / 2 ? -2 : 2) }, (c) => c.share >= 0.9 && Math.abs(c.cell.x - first.x) >= 3);
    await stand(page, { li_er: first, zhou_zhanggui: second });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(2);
    const now = await silhouettesOf(page);
    expect(now.map((s) => [s.person, s.occluder, s.colour]).sort()).toEqual(
      [
        ["li_er", "p_teahouse", colourOf(scene, "li_er")],
        ["zhou_zhanggui", "p_teahouse", colourOf(scene, "zhou_zhanggui")],
      ].sort(),
    );
    expect(colourOf(scene, "li_er")).not.toBe(colourOf(scene, "zhou_zhanggui"));
    for (const id of ["li_er", "zhou_zhanggui"]) {
      const spot = await silhouetteSpot(page, id, house);
      expect(await pickAt(page, spot.screen.x, spot.screen.y), id).toEqual({ kind: "person", id });
    }
    expect(await mapStats(page)).toMatchObject({ silhouettes: 2 });
    // Each pixel is the colour of the person's own family over the building, and not the other's: the first is taken away to look at the second.
    await fillIsTheFamilyOverTheBuilding(page, "li_er", house, AWAY, colourOf(scene, "li_er"));
    await fillIsTheFamilyOverTheBuilding(page, "zhou_zhanggui", house, { ...AWAY, x: AWAY.x + 2 }, colourOf(scene, "zhou_zhanggui"));
    expect(lantern.pageErrors).toEqual([]);
  });

  test("leaves the part of a person who is above the roof line to be picked as before, and shows the rest as a silhouette", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    await spyOnGround(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    // A cell where the head is clear of the roof and the legs are under it.
    const cell = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.head <= 0.05 && c.legs >= 0.6 && c.share >= 0.3 && c.share <= 0.85);
    await stand(page, { li_er: cell });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(1);
    const { pic, at } = await drawnPicture(page, "li_er");
    const hider = await hiderPicture(page, house);
    const body = (x: number, y: number): boolean => solidAt(pic, at, 1, x, y);
    const area = boxOf(pic, at);
    const head = roomiest(area, (x, y) => body(x, y) && !hider.solid(x, y), 2);
    const under = roomiest(area, (x, y) => body(x, y) && hider.solid(x, y), 2);
    if (head === null || under === null) throw new Error("the person is not part in and part out");
    const screenHead = await project(page, head.x, head.y);
    const screenUnder = await project(page, under.x, under.y);
    // The head is a person as it was before, drawn as the figure and not as a silhouette: its pixel is the pixel of the atlas, at the most even colour near it that has no roof within reach.
    const frame = (await drawing(page)).people.find((p) => p.id === "li_er");
    const free = roomiest(area, (x, y) => body(x, y) && !hider.solid(x, y) && !hider.solid(x, y - 6) && !hider.solid(x, y + 6) && !hider.solid(x - 6, y) && !hider.solid(x + 6, y), 4);
    if (frame === undefined || frame.sprite === null || free === null) throw new Error("no head clear of the roof");
    const [fu, fv] = await flatPoint(page, frame.sprite, frame.index, free.x - at.x + pic.def.ax, free.y - at.y + pic.def.ay, 3);
    const flat = await project(page, at.x + fu - pic.def.ax, at.y + fv - pic.def.ay);
    expect(near(await sampleAt(page, flat.x, flat.y), await atlasTexel(page, frame.sprite, frame.index, fu, fv)), "the head is drawn as the figure").toBe(true);
    expect(await pickAt(page, screenHead.x, screenHead.y)).toEqual({ kind: "person", id: "li_er" });
    expect(await pickAt(page, screenUnder.x, screenUnder.y)).toEqual({ kind: "person", id: "li_er" });
    await canvasOf(lantern).hover({ position: screenHead });
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => t.name)).toEqual(["Li Er"]);
    await canvasOf(lantern).click({ position: screenHead });
    await expect.poll(() => selectedOf(page)).toBe("li_er");
    // The roof beside him is the building.
    const beside = roomiest({ x0: at.x - 70, y0: at.y - 90, x1: at.x + 70, y1: at.y + 6 }, (x, y) => hider.solid(x, y) && !body(x, y), 5);
    if (beside === null) throw new Error("no roof beside the person");
    const there = await project(page, beside.x, beside.y);
    expect(await pickAt(page, there.x, there.y)).toEqual({ kind: "place", id: "p_teahouse" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is drawn for the manager too, in gold, who is not picked: a click on the silhouette is a click on the ground where he stands", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    await spyOnGround(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const cell = nearest(await scanNorthOf(page, "player", house), rect, (c) => c.share >= 0.9);
    await stand(page, {}, { player: { ...(await playerOf(page)), x: cell.x, y: cell.y } });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(1);
    expect((await silhouettesOf(page))[0]).toMatchObject({ person: "player", occluder: "p_teahouse", colour: PAL.gold });
    const spot = await silhouetteSpot(page, "player", house);
    // The map says the manager is under the pointer there, and the page does not take him for a person to pick.
    expect(await pickAt(page, spot.screen.x, spot.screen.y)).toEqual({ kind: "person", id: "player" });
    await canvasOf(lantern).hover({ position: spot.screen });
    await page.waitForTimeout(100);
    expect((await drawing(page)).nameTags).toEqual([]);
    await canvasOf(lantern).click({ position: spot.screen });
    await expect.poll(async () => (await grounds(page)).length).toBe(1);
    expect((await grounds(page))[0]).toMatchObject({ x: cell.x, y: cell.y, place: null });
    expect(await selectedOf(page)).toBe("");
    // A person who stands behind the building on the same cell is picked where the pointer is on both of them, and the manager is not in the way.
    await stand(page, { li_er: cell });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(2);
    const manager = await drawnPicture(page, "player");
    const other = await drawnPicture(page, "li_er");
    const both = roomiest(together(boxOf(manager.pic, manager.at), boxOf(other.pic, other.at)), (x, y) => solidAt(manager.pic, manager.at, 1, x, y) && solidAt(other.pic, other.at, 1, x, y) && spot.hider.solid(x, y), 4);
    if (both === null) throw new Error("the manager and the person do not meet");
    const meet = await project(page, both.x, both.y);
    expect(await pickAt(page, meet.x, meet.y)).toEqual({ kind: "person", id: "li_er" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is drawn for a person behind a willow, and the willow's pixels are not a building to pick", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const willows = (await occluders(page)).filter((o) => o.id === "prop.willow");
    expect(willows.length).toBeGreaterThan(0);
    // The willow and the cell where most of a person is under its crown.
    let best: { willow: Occluder; cell: { x: number; y: number }; share: number } | null = null;
    for (const willow of willows) {
      for (const c of await scanNorthOf(page, "li_er", willow, 8, 3)) {
        if (best === null || c.share > best.share) best = { willow, cell: c.cell, share: c.share };
      }
    }
    if (best === null || best.share < 0.3) throw new Error("no cell behind a willow where a person is hidden");
    await stand(page, { li_er: best.cell });
    await expect.poll(async () => (await silhouettesOf(page, "li_er")).some((s) => s.occluder === "prop.willow")).toBe(true);
    const scene = await sceneOf(page);
    expect((await silhouettesOf(page, "li_er")).filter((s) => s.occluder === "prop.willow").every((s) => s.colour === colourOf(scene, "li_er"))).toBe(true);
    // Where the crown and the body meet: the person.
    const hider = await hiderPicture(page, best.willow);
    const { pic, at } = await drawnPicture(page, "li_er");
    const spot = roomiest(boxOf(pic, at), (x, y) => solidAt(pic, at, 1, x, y) && hider.solid(x, y), 2);
    if (spot === null) throw new Error("no silhouette over the willow to look at");
    const screen = await project(page, spot.x, spot.y);
    expect(await pickAt(page, screen.x, screen.y)).toEqual({ kind: "person", id: "li_er" });
    await canvasOf(lantern).hover({ position: screen });
    await expect.poll(async () => (await drawing(page)).nameTags.map((t) => t.name)).toEqual(["Li Er"]);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("has a line of the family's colour round the shape, about two pixels of the screen thick: opaque next to the body, and nothing four pixels off", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const scene = await sceneOf(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    const cell = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.share >= 0.9);
    await stand(page, { li_er: cell });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(1);
    const zoom = await zoomOf(page);
    const { pic, at } = await drawnPicture(page, "li_er");
    const hider = await hiderPicture(page, house);
    // A point of the building that is `px` pixels of the screen from the body of the person, with the building all round it.
    const ringAt = async (px: number): Promise<{ x: number; y: number }> => {
      const away = px / zoom;
      const reach = Math.ceil(away) + 1;
      const area = boxOf(pic, at);
      let best: { x: number; y: number; gap: number } | null = null;
      for (let y = Math.floor(area.y0) - reach; y < area.y1 + reach; y++) {
        for (let x = Math.floor(area.x0) - reach; x < area.x1 + reach; x++) {
          const wx = x + 0.5;
          const wy = y + 0.5;
          if (solidAt(pic, at, 1, wx, wy) || !hider.solid(wx, wy)) continue;
          if (![[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => hider.solid(wx + (dx ?? 0) * (reach + 2), wy + (dy ?? 0) * (reach + 2)))) continue;
          let gap = Number.POSITIVE_INFINITY;
          for (let v = -reach; v <= reach; v++) for (let u = -reach; u <= reach; u++) if (solidAt(pic, at, 1, wx + u, wy + v)) gap = Math.min(gap, Math.hypot(u, v));
          if (Math.abs(gap - away) < 0.35 / zoom && (best === null || Math.abs(gap - away) < Math.abs(best.gap - away))) best = { x: wx, y: wy, gap };
        }
      }
      if (best === null) throw new Error(`no point of the building ${px} pixels from the person`);
      return project(page, best.x, best.y);
    };
    const near1 = await ringAt(1);
    const far4 = await ringAt(4.5);
    const line = await sampleAt(page, near1.x, near1.y);
    const off = await sampleAt(page, far4.x, far4.y);
    await stand(page, { li_er: AWAY });
    await expect.poll(async () => (await silhouettesOf(page)).length).toBe(0);
    const bareOff = await sampleAt(page, far4.x, far4.y);
    const colour = colourOf(scene, "li_er");
    expect(apart(line ?? [0, 0, 0], rgb(colour)), `next to the body the screen has ${String(line)}, the line is ${rgb(colour).join(",")}`).toBeLessThanOrEqual(24);
    expect(apart(off ?? [0, 0, 0], bareOff ?? [255, 255, 255]), `four pixels off the screen has ${String(off)}, the building is ${String(bareOff)}`).toBeLessThanOrEqual(14);
    expect(lantern.pageErrors).toEqual([]);
  });

  test("stays over the bridge when it is mended: the thing that hides is the picture that shows, and the shape is drawn once", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const scene = await sceneOf(page);
    const broken = await occluderOf(page, "p_bridge");
    expect(broken.sprite).toBe("place.bridge_broken");
    const rect = footprintOf(broken);
    // A cell north of the deck where most of a person is behind the railing of the bridge.
    const cell = nearest(await scanNorthOf(page, "li_er", broken, 6, 2), rect, (c) => c.share >= 0.5);
    const base = await sortedChildren(page);
    await stand(page, { li_er: cell });
    await expect.poll(async () => (await silhouettesOf(page, "li_er")).map((s) => s.occluder)).toEqual(["p_bridge"]);
    await fillIsTheFamilyOverTheBuilding(page, "li_er", broken, AWAY, colourOf(scene, "li_er"));
    expect(await sortedChildren(page)).toBe(base);
    // The bridge is mended: the picture that hides him is the whole bridge, and he is still one silhouette over it.
    await stand(page, { li_er: cell });
    await inject(page, { hud: { bridge: { state: "mended", done: 5, need: 5 } } });
    await expect.poll(async () => (await occluderOf(page, "p_bridge")).sprite).toBe("place.bridge");
    await expect.poll(async () => (await silhouettesOf(page, "li_er")).map((s) => s.occluder)).toEqual(["p_bridge"]);
    expect(await sortedChildren(page)).toBe(base + 1);
    const whole = await occluderOf(page, "p_bridge");
    expect(whole.key).toBe(broken.key);
    await fillIsTheFamilyOverTheBuilding(page, "li_er", whole, AWAY, colourOf(scene, "li_er"));
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is clipped to the body of the building and not to its picture: where the picture has only air, the person is the figure itself", async ({ lantern }) => {
    const page = lantern.page;
    await emptyTown(lantern);
    const scene = await sceneOf(page);
    const house = await occluderOf(page, "p_teahouse");
    const rect = footprintOf(house);
    // A cell where the roof hides part of the person and the air of the picture (above the eaves, between the roof and the flag) has the rest.
    const cell = nearest(await scanNorthOf(page, "zhou_huoji", house, 12, 3), rect, (c) => c.share >= 0.2 && c.share <= 0.8 && c.air >= 0.2);
    await stand(page, { zhou_huoji: cell });
    await expect.poll(async () => (await silhouettesOf(page, "zhou_huoji")).map((s) => s.occluder)).toEqual(["p_teahouse"]);
    const { pic, at } = await drawnPicture(page, "zhou_huoji");
    const index = (await drawing(page)).people.find((p) => p.id === "zhou_huoji")?.index ?? 0;
    const hider = await hiderPicture(page, house);
    // A point of the body in the air of the picture, with air all round it, where the figure has one flat colour.
    const area = boxOf(pic, at);
    const inAir = (x: number, y: number): boolean => solidAt(pic, at, 1, x, y) && hider.air(x, y);
    let found: { x: number; y: number; texel: [number, number, number, number] } | null = null;
    for (let y = Math.floor(area.y0); y < area.y1 && found === null; y += 2) {
      for (let x = Math.floor(area.x0); x < area.x1 && found === null; x += 2) {
        if (![[0, 0], [2, 0], [-2, 0], [0, 2], [0, -2]].every(([dx, dy]) => inAir(x + 0.5 + (dx ?? 0), y + 0.5 + (dy ?? 0)))) continue;
        try {
          const [u, v] = await flatPoint(page, pic.def.id, index, x + 0.5 - at.x + pic.def.ax, y + 0.5 - at.y + pic.def.ay, 3);
          const world = { x: at.x + u - pic.def.ax, y: at.y + v - pic.def.ay };
          if (inAir(world.x, world.y)) found = { ...world, texel: await atlasTexel(page, pic.def.id, index, u, v) };
        } catch {
          // Not one colour near here: the next point.
        }
      }
    }
    if (found === null) throw new Error("no flat colour of the figure in the air of the picture");
    const spot = await project(page, found.x, found.y);
    const pixel = await sampleAt(page, spot.x, spot.y);
    expect(near(pixel, found.texel, 30), `in the air of the picture the screen has ${String(pixel)}, the figure's texel is ${found.texel.join(",")}`).toBe(true);
    // A silhouette would be the family's colour over the figure, and here it is not.
    const laid = blend(found.texel, colourOf(scene, "zhou_huoji"), FILL);
    if (apart(laid, found.texel) > 30) expect(apart(pixel ?? [0, 0, 0], laid)).toBeGreaterThan(14);
    expect(await pickAt(page, spot.x, spot.y)).toEqual({ kind: "person", id: "zhou_huoji" });
    expect(lantern.pageErrors).toEqual([]);
  });

  test("is drawn from the 2x atlas on a screen of high pixel density, with the same fill and the same pick", async ({ browser, servers }) => {
    const context = await browser.newContext({ deviceScaleFactor: 2, viewport: { width: 1100, height: 700 } });
    const lantern = new LanternPage(await context.newPage(), servers, true);
    try {
      await emptyTown(lantern);
      const page = lantern.page;
      expect(await mapStats(page)).toMatchObject({ atlas: 2 });
      const scene = await sceneOf(page);
      const house = await occluderOf(page, "p_teahouse");
      const rect = footprintOf(house);
      const cell = nearest(await scanNorthOf(page, "li_er", house), rect, (c) => c.share >= 0.9);
      await stand(page, { li_er: cell });
      await expect.poll(async () => (await silhouettesOf(page)).length).toBe(1);
      const spot = await silhouetteSpot(page, "li_er", house);
      expect(await pickAt(page, spot.screen.x, spot.screen.y)).toEqual({ kind: "person", id: "li_er" });
      await fillIsTheFamilyOverTheBuilding(page, "li_er", house, AWAY, colourOf(scene, "li_er"));
      expect(lantern.pageErrors).toEqual([]);
      expect(lantern.consoleLines.filter((l) => /^\[(page|worker):error\]|Content Security Policy|Refused to/.test(l))).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
