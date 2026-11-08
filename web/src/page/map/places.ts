/**
 * The places and the props of the town that are sprites of the kit: the buildings (the teahouse,
 * the houses, the school, the hall, the temple, the tavern, the workshop, the watch post and the
 * stalls of the market), the pier and the stone bridge (whole or with its railing fallen), the
 * trees (willows by the water, the others of four kinds and heaps of stones), the pile of bamboo at
 * the bridge, the junk that closes the lane, and the lanterns at the doors. At night the windows of
 * every building are lit by a sprite of their own over it, and the lanterns by theirs. Each stands on
 * its footprint with the corner of the south-west of it at the anchor of the sprite, and is drawn in
 * the order of its south edge among the people, so that a person standing in front of a building is
 * in front of it, and one standing behind it is hidden by it.
 *
 * What the scene or the frame says that has no sprite (a building of another kind, a lantern at a
 * door that has none) is left to the shapes made in code, and the map asks here what is covered.
 */
import { Container, Sprite, type Texture } from "pixi.js";
import type { Lantern } from "../frame.ts";
import type { Scene } from "../scene.ts";
import type { Sheet } from "./atlas.ts";
import { CELL, CELL_DEPTH, type Motion, SLOW, STILL } from "./geometry.ts";
import type { SpriteDef } from "./manifest.ts";
import { alphaAtWorld, type FrameBox, type Pickable, SOLID } from "./pick.ts";
import type { Deck } from "./people.ts";
import type { Hiding } from "./silhouette.ts";
import { bambooPile, PROPS, WILLOW_REACH } from "./sprites.ts";
import { bambooSite, type PlacePlan, planPlaces, planTrees, type TreePlan, willowCells } from "./town.ts";

interface Lamp {
  place: string;
  /** The hanging point of the lantern, in the world. */
  x: number;
  y: number;
  unlit: Sprite;
  lit: Sprite;
  glow: Sprite;
  offset: { x: number; y: number };
  phase: number;
  on: boolean;
  node: Container;
}

interface Instance {
  plan: PlacePlan;
  node: Container;
  whole: Sprite;
  broken: Sprite | null;
  /** The anchor in the world: the south-west corner of the footprint. */
  x: number;
  y: number;
}

interface Prop {
  sprite: Sprite;
  def: SpriteDef;
  /** The cell that a tree or a pile of junk stands on. */
  cell?: { x: number; y: number };
}

/** The lit windows of a building at night: a sprite over it that is added to the picture, and a halo of light round each window. */
interface Windows {
  place: string;
  /** The sprite of the kit that the windows are drawn with. */
  id: string;
  sprite: Sprite;
  halos: Sprite[];
  /** How much of the light of the night the building has: 1 for all of them (every window is lit). */
  strength: number;
}

/** How bright a halo of a window is at full night, as the alpha of an added picture. */
const HALO_ALPHA = 0.55;
/** How far the halo of a window reaches beyond it, in pixels of the world: the window's size times the first, and this many more all round. */
const HALO_SCALE = 1.5;
const HALO_REACH = 34;

/** A sprite of the sorted container that can hide a person, with the picture it is drawn with, which the layer of silhouettes looks into (see silhouette-layer.ts). */
export interface Occluder extends Hiding {
  /** The sprite of the kit that it is drawn with. */
  sprite: string;
  texture: Texture;
  /** The anchor as a fraction of the frame, where it is in the world, and the size of the sprite against its own. */
  anchor: { x: number; y: number };
  x: number;
  y: number;
  scale: number;
}

/** A number from a place, for a phase that differs from lantern to lantern. */
const phaseOf = (a: number, b: number): number => (a * 7.31 + b * 3.17) % 6.28;

export class Places {
  private sheet: Sheet | null = null;
  private instances: Instance[] = [];
  private lamps: Lamp[] = [];
  private willows: Prop[] = [];
  private trees: Prop[] = [];
  private junk: Prop[] = [];
  private windows: Windows[] = [];
  /** The strength of the night light that the windows were last set to, NaN when they have not been set since the sprites were made. */
  private glow = Number.NaN;
  private piles: { small: Prop | null; large: Prop | null } = { small: null, large: null };
  private bridgeWhole = false;
  private tint = 0xffffff;
  private plans: PlacePlan[] = [];
  private listed: Occluder[] | null = null;
  private listStamp = 0;

  /**
   * `host` is the container that everything on the ground is sorted in. `glowHost` is the one over
   * everything, which the glows of the lanterns are added in.
   */
  constructor(
    private readonly host: Container,
    private readonly glowHost: Container,
  ) {}

  configure(sheet: Sheet | null): void {
    this.sheet = sheet;
  }

  /** Which places have a sprite in this scene. Empty without the sheet. */
  plan(scene: Scene): PlacePlan[] {
    const sheet = this.sheet;
    return sheet === null ? [] : planPlaces(scene, (id) => sheet.sprite(id));
  }

  /** The trees that are willows: their cells as `x,y`. Empty without the willow sprite. */
  willowKeys(scene: Scene): Set<string> {
    const sheet = this.sheet;
    if (sheet === null || !sheet.has(PROPS.willow)) return new Set();
    return new Set(willowCells(scene, WILLOW_REACH).map(([x, y]) => `${x},${y}`));
  }

  /** The trees that are drawn as sprites other than the willows, as the plan has them. Empty without the sheet, and in a plain scene, whose blocked cells are slate blocks and no trees. */
  treePlans(scene: Scene): TreePlan[] {
    const sheet = this.sheet;
    return sheet === null || scene.plain ? [] : planTrees(scene, this.willowKeys(scene), (id) => sheet.sprite(id));
  }

  /** The cells of every tree that is drawn as a sprite, the willows and the others, as `x,y`: the shapes made in code leave them out. */
  treeKeys(scene: Scene): Set<string> {
    const keys = this.willowKeys(scene);
    for (const plan of this.treePlans(scene)) keys.add(`${plan.x},${plan.y}`);
    return keys;
  }

  /** Whether the junk that closes the lane is a sprite: the shape made in code for it is left out then. */
  hasJunk(): boolean {
    return this.sheet?.has(PROPS.junkPile) === true;
  }

  /** Makes the sprites of a scene. */
  build(scene: Scene): void {
    this.clear();
    const sheet = this.sheet;
    if (sheet === null) return;
    this.plans = this.plan(scene);
    for (const plan of this.plans) this.addPlace(sheet, plan);
    this.addWillows(sheet, scene);
    this.addTrees(sheet, scene);
    this.addJunk(sheet, scene);
    this.addBamboo(sheet);
    this.applyTint();
    this.setBridge(this.bridgeWhole);
    this.listChanged();
  }

  private clear(): void {
    for (const instance of this.instances) instance.node.destroy({ children: true });
    for (const lamp of this.lamps) {
      lamp.node.destroy({ children: true });
      lamp.glow.destroy();
    }
    for (const prop of [...this.willows, ...this.trees, ...this.junk]) prop.sprite.destroy();
    for (const windows of this.windows) {
      windows.sprite.destroy();
      for (const halo of windows.halos) halo.destroy();
    }
    for (const prop of [this.piles.small, this.piles.large]) prop?.sprite.destroy();
    this.instances = [];
    this.lamps = [];
    this.willows = [];
    this.trees = [];
    this.junk = [];
    this.windows = [];
    this.glow = Number.NaN;
    this.piles = { small: null, large: null };
    this.plans = [];
    this.listChanged();
  }

  private spriteOf(sheet: Sheet, def: SpriteDef, index = 0): Sprite {
    const sprite = new Sprite(sheet.texture(def, index) ?? undefined);
    sprite.anchor.set(def.ax / def.w, def.ay / def.h);
    return sprite;
  }

  private addPlace(sheet: Sheet, plan: PlacePlan): void {
    const x = plan.rect.x * CELL;
    const y = (plan.rect.y + plan.rect.h) * CELL_DEPTH;
    const node = new Container();
    node.position.set(x, y);
    node.scale.set(plan.scale);
    node.zIndex = y;
    const whole = this.spriteOf(sheet, plan.whole);
    const broken = plan.broken === null ? null : this.spriteOf(sheet, plan.broken);
    node.addChild(whole);
    if (broken !== null) node.addChild(broken);
    this.host.addChild(node);
    const instance = { plan, node, whole, broken, x, y };
    this.instances.push(instance);
    this.addLamps(sheet, instance);
    this.addWindows(sheet, instance);
  }

  /**
   * The lit windows of a building: the sprite that the kit made for them, over the building and added to the picture (so the night
   * does not darken it: it is its own light), and a soft halo of light round each window over the whole map, as the lamps have.
   * Every instance of a sprite has its own pair, and the sprite is the one picture that is made once for all of them.
   */
  private addWindows(sheet: Sheet, house: Instance): void {
    const def = house.plan.lights;
    if (def === null) return;
    const s = house.plan.scale;
    const sprite = this.spriteOf(sheet, def);
    sprite.position.set(house.x, house.y);
    sprite.scale.set(s);
    sprite.blendMode = "add";
    sprite.eventMode = "none";
    // Over the building and its door lanterns' nodes, and under whoever stands in front of the building.
    sprite.zIndex = house.y + 0.05;
    sprite.visible = false;
    this.host.addChild(sprite);
    const halo = sheet.sprite(PROPS.glow);
    const halos: Sprite[] = [];
    if (halo !== undefined) {
      for (const spot of def.spots ?? []) {
        const light = this.spriteOf(sheet, halo);
        light.anchor.set(0.5);
        light.position.set(house.x + spot.x * s, house.y + spot.y * s);
        light.width = (spot.w * HALO_SCALE + HALO_REACH) * s;
        light.height = (spot.h * HALO_SCALE + HALO_REACH) * s;
        light.blendMode = "add";
        light.visible = false;
        this.glowHost.addChild(light);
        halos.push(light);
      }
    }
    this.windows.push({ place: house.plan.place, id: def.id, sprite, halos, strength: 1 });
  }

  /** The two door lanterns of a house, unlit and lit, with the glow of the lit one. */
  private addLamps(sheet: Sheet, house: Instance): void {
    const mounts = house.plan.whole.mounts;
    const lit = sheet.sprite(PROPS.lanternLit);
    const unlit = sheet.sprite(PROPS.lanternUnlit);
    const glow = lit?.glow == null ? undefined : sheet.sprite(lit.glow.sprite);
    if (mounts === null || lit === undefined || unlit === undefined || glow === undefined || lit.glow === null) return;
    const s = house.plan.scale;
    for (const mount of [mounts.left, mounts.right]) {
      const x = house.x + mount.x * s;
      const y = house.y + mount.y * s;
      const node = new Container();
      node.position.set(x, y);
      node.scale.set(s);
      // After the house, and before anyone who stands in front of it.
      node.zIndex = house.y + 0.1;
      const unlitSprite = this.spriteOf(sheet, unlit);
      const litSprite = this.spriteOf(sheet, lit);
      litSprite.visible = false;
      node.addChild(unlitSprite, litSprite);
      this.host.addChild(node);
      const glowSprite = this.spriteOf(sheet, glow);
      glowSprite.blendMode = glow.blend === "add" ? "add" : "normal";
      glowSprite.scale.set(s);
      glowSprite.visible = false;
      this.glowHost.addChild(glowSprite);
      this.lamps.push({ place: house.plan.place, x, y, unlit: unlitSprite, lit: litSprite, glow: glowSprite, offset: { x: lit.glow.offset.x * s, y: lit.glow.offset.y * s }, phase: phaseOf(x, y), on: false, node });
    }
  }

  private addWillows(sheet: Sheet, scene: Scene): void {
    const def = sheet.sprite(PROPS.willow);
    if (def === undefined) return;
    for (const key of this.willowKeys(scene)) {
      const [cx, cy] = key.split(",").map(Number) as [number, number];
      const sprite = this.spriteOf(sheet, def);
      sprite.position.set(cx * CELL, (cy + 1) * CELL_DEPTH);
      sprite.zIndex = (cy + 1) * CELL_DEPTH;
      this.host.addChild(sprite);
      this.willows.push({ sprite, def });
    }
  }

  /** The trees that are not willows: a sprite for each, of a kind picked from a hash of its cell (see `planTrees`). */
  private addTrees(sheet: Sheet, scene: Scene): void {
    for (const plan of this.treePlans(scene)) {
      const sprite = this.spriteOf(sheet, plan.sprite);
      sprite.position.set(plan.x * CELL + plan.dx, (plan.y + 1) * CELL_DEPTH + plan.dy);
      sprite.zIndex = (plan.y + 1) * CELL_DEPTH + plan.dy;
      this.host.addChild(sprite);
      this.trees.push({ sprite, def: plan.sprite, cell: { x: plan.x, y: plan.y } });
    }
  }

  /** The junk that closes the lane behind the temple: a pile on each cell of a barrier. */
  private addJunk(sheet: Sheet, scene: Scene): void {
    const def = sheet.sprite(PROPS.junkPile);
    if (def === undefined) return;
    for (const barrier of scene.barriers) {
      for (const [x, y] of barrier.cells) {
        const sprite = this.spriteOf(sheet, def);
        sprite.position.set(x * CELL, (y + 1) * CELL_DEPTH);
        sprite.zIndex = (y + 1) * CELL_DEPTH;
        this.host.addChild(sprite);
        this.junk.push({ sprite, def, cell: { x, y } });
      }
    }
  }

  /** The two piles of bamboo at the bridge, one of which shows. */
  private addBamboo(sheet: Sheet): void {
    const deck = this.instances.find((i) => i.plan.art.broken !== undefined);
    if (deck === undefined) return;
    for (const [name, id] of [["small", PROPS.bambooSmall], ["large", PROPS.bambooLarge]] as const) {
      const def = sheet.sprite(id);
      if (def === undefined) continue;
      const at = bambooSite(deck.plan.rect, def.footprint?.cols ?? 2);
      const sprite = this.spriteOf(sheet, def);
      sprite.position.set(at.x * CELL, (at.y + 1) * CELL_DEPTH);
      sprite.zIndex = (at.y + 1) * CELL_DEPTH;
      sprite.visible = false;
      this.host.addChild(sprite);
      this.piles[name] = { sprite, def };
    }
  }

  // --- State --------------------------------------------------------------------------------

  /** The bridge is whole once it is mended, and has its railing down until then. */
  setBridge(whole: boolean): void {
    this.bridgeWhole = whole;
    for (const instance of this.instances) {
      if (instance.broken === null) continue;
      if (instance.whole.visible !== whole) this.listChanged();
      instance.whole.visible = whole;
      instance.broken.visible = !whole;
    }
  }

  get bridge(): "whole" | "broken" | null {
    return this.instances.some((i) => i.broken !== null) ? (this.bridgeWhole ? "whole" : "broken") : null;
  }

  /** How much bamboo lies at the bridge: a small pile for 1 to 9 poles, a large one for 10 or more. */
  setSite(bamboo: number): void {
    const wanted = bambooPile(bamboo);
    const before = this.pile;
    if (this.piles.small !== null) this.piles.small.sprite.visible = wanted === PROPS.bambooSmall;
    if (this.piles.large !== null) this.piles.large.sprite.visible = wanted === PROPS.bambooLarge;
    if (this.pile !== before) this.listChanged();
  }

  get pile(): "small" | "large" | null {
    if (this.piles.large?.sprite.visible === true) return "large";
    if (this.piles.small?.sprite.visible === true) return "small";
    return null;
  }

  /**
   * Lights the door lanterns of the households that are in `lanterns`, at the houses of their
   * places (all the lanterns of a place light together, whoever of its households is in the frame).
   * Gives back the lanterns that have no house with lanterns, for the drawing made in code to hang, and how
   * many of the lanterns of the frame were lit here.
   */
  setLanterns(lanterns: readonly Lantern[]): { rest: Lantern[]; lit: number } {
    const have = new Set(this.lamps.map((l) => l.place));
    const lit = new Set<string>();
    // The lanterns of the frame that hang at a house of the sprites, one for each household and cell, which is how the others are told apart too.
    const hung = new Set<string>();
    const rest: Lantern[] = [];
    for (const lantern of lanterns) {
      if (have.has(lantern.place)) {
        lit.add(lantern.place);
        hung.add(`${lantern.household}@${lantern.x},${lantern.y}`);
      } else {
        rest.push(lantern);
      }
    }
    for (const lamp of this.lamps) {
      lamp.on = lit.has(lamp.place);
      lamp.unlit.visible = !lamp.on;
      lamp.lit.visible = lamp.on;
      lamp.glow.visible = lamp.on;
    }
    return { rest, lit: hung.size };
  }

  /** Lanterns that are lit at the houses, as bodies (two to a house). */
  get lampsLit(): number {
    return this.lamps.filter((lamp) => lamp.on).length;
  }

  /** The colour that the places and the props are multiplied by. A lit lantern is its own light and is not. */
  setTint(tint: number): void {
    this.tint = tint;
    this.applyTint();
  }

  private applyTint(): void {
    for (const instance of this.instances) instance.node.tint = this.tint;
    for (const prop of [...this.willows, ...this.trees, ...this.junk]) prop.sprite.tint = this.tint;
    for (const prop of [this.piles.small, this.piles.large]) if (prop !== null) prop.sprite.tint = this.tint;
    for (const lamp of this.lamps) lamp.unlit.tint = this.tint;
  }

  /** Lights the lanterns at the strength of the hour, and sways them a little unless the player asked for less motion (`calm`). */
  update(light: number, seconds: number, calm = false): Motion {
    this.lightWindows(light);
    let any = false;
    for (const lamp of this.lamps) {
      if (!lamp.on) continue;
      any = true;
      const angle = calm ? 0 : Math.sin(seconds * 1.6 + lamp.phase) * 0.07;
      lamp.lit.rotation = angle;
      // The glow hangs from the lantern: it goes where the body of the lantern is as it swings.
      lamp.glow.position.set(lamp.x - Math.sin(angle) * lamp.offset.y + Math.cos(angle) * lamp.offset.x, lamp.y + Math.cos(angle) * lamp.offset.y + Math.sin(angle) * lamp.offset.x);
      lamp.glow.alpha = 0.12 + light * (calm ? 0.9 : 0.85 + 0.1 * Math.sin(seconds * 3.1 + lamp.phase));
    }
    return any && !calm ? SLOW : STILL;
  }

  /** Lights the windows of the buildings at the strength of the hour: nothing is drawn of them by day. */
  private lightWindows(light: number): void {
    if (light === this.glow) return;
    this.glow = light;
    for (const windows of this.windows) {
      const alpha = Math.min(1, Math.max(0, light)) * windows.strength;
      windows.sprite.alpha = alpha;
      windows.sprite.visible = alpha > 0.01;
      for (const halo of windows.halos) {
        halo.alpha = alpha * HALO_ALPHA;
        halo.visible = alpha > 0.01;
      }
    }
  }

  // --- Asking about them --------------------------------------------------------------------

  /** The deck of the bridge, for the walkers to be lifted on, or null if the bridge is not a sprite. */
  deck(): Deck | null {
    const bridge = this.instances.find((i) => i.plan.whole.deckLift !== null);
    const lifts = bridge?.plan.whole.deckLift;
    if (bridge === undefined || lifts == null) return null;
    const { rect, scale } = bridge.plan;
    return { left: rect.x, top: rect.y, cols: rect.w, rows: rect.h, lifts: lifts.map((v) => v * scale), sort: bridge.y };
  }

  /** How far the sprites reach, in the world: the left, top, right and bottom edges. Null if there are none. */
  extent(): { x0: number; y0: number; x1: number; y1: number } | null {
    let box: { x0: number; y0: number; x1: number; y1: number } | null = null;
    const take = (def: SpriteDef, x: number, y: number, scale: number): void => {
      const x0 = x - def.ax * scale;
      const y0 = y - def.ay * scale;
      box = box === null ? { x0, y0, x1: x0 + def.w * scale, y1: y0 + def.h * scale } : { x0: Math.min(box.x0, x0), y0: Math.min(box.y0, y0), x1: Math.max(box.x1, x0 + def.w * scale), y1: Math.max(box.y1, y0 + def.h * scale) };
    };
    for (const instance of this.instances) {
      take(instance.plan.whole, instance.x, instance.y, instance.plan.scale);
      if (instance.plan.broken !== null) take(instance.plan.broken, instance.x, instance.y, instance.plan.scale);
    }
    for (const prop of [...this.willows, ...this.trees, ...this.junk]) take(prop.def, prop.sprite.x, prop.sprite.y, 1);
    return box;
  }

  /**
   * What can hide a person, as the sprites are drawn now: the places (the bridge as it shows), the willows and the pile of bamboo that shows.
   * The list is kept until something in it changes, and `occluderStamp` changes with it.
   */
  occluders(): readonly Occluder[] {
    this.listed ??= this.listOccluders();
    return this.listed;
  }

  get occluderStamp(): number {
    return this.listStamp;
  }

  /** What can hide a person, for the tests: the thing, the sprite it is drawn with, where its anchor is, and its place in the order of drawing. */
  describeOccluders(): Array<{ id: string; key: string; sprite: string; sort: number; x: number; y: number; scale: number }> {
    return this.occluders().map(({ id, key, sprite, sort, x, y, scale }) => ({ id, key, sprite, sort, x, y, scale }));
  }

  private listChanged(): void {
    this.listed = null;
    this.listStamp++;
  }

  private listOccluders(): Occluder[] {
    const sheet = this.sheet;
    const out: Occluder[] = [];
    if (sheet === null) return out;
    this.instances.forEach((instance, n) => {
      const broken = instance.broken?.visible === true ? instance.broken : null;
      const sprite = broken ?? instance.whole;
      const def = (broken === null ? null : instance.plan.broken) ?? instance.plan.whole;
      out.push(this.occluder(sheet, instance.plan.place, `${instance.plan.place}#${n}`, def, sprite, instance.x, instance.y, instance.plan.scale, instance.node.zIndex));
    });
    for (const [list, name] of [[this.willows, "willow"], [this.trees, "tree"], [this.junk, "junk"]] as const) {
      list.forEach((prop, n) => out.push(this.occluder(sheet, prop.def.id, `${prop.def.id}#${name}${n}`, prop.def, prop.sprite, prop.sprite.x, prop.sprite.y, 1, prop.sprite.zIndex)));
    }
    for (const prop of [this.piles.small, this.piles.large]) {
      if (prop !== null && prop.sprite.visible) out.push(this.occluder(sheet, prop.def.id, prop.def.id, prop.def, prop.sprite, prop.sprite.x, prop.sprite.y, 1, prop.sprite.zIndex));
    }
    return out;
  }

  /** A sprite of the sorted container that has its body where the alpha of its picture is solid, the way picking has it. */
  private occluder(sheet: Sheet, id: string, key: string, def: SpriteDef, sprite: Sprite, x: number, y: number, scale: number, sort: number): Occluder {
    const anchor = { x: def.ax, y: def.ay };
    const at = { x, y };
    let frame: FrameBox | null = null;
    const x0 = x - def.ax * scale;
    const y0 = y - def.ay * scale;
    return {
      id,
      key,
      sort,
      sprite: def.id,
      texture: sprite.texture,
      anchor: { x: def.ax / def.w, y: def.ay / def.h },
      x,
      y,
      scale,
      box: { x0, y0, x1: x0 + def.w * scale, y1: y0 + def.h * scale },
      covers: (wx: number, wy: number): boolean => {
        frame ??= sheet.box(def, 0);
        return frame !== null && alphaAtWorld(frame, anchor, at, scale, wx, wy) >= SOLID;
      },
    };
  }

  /** The places as things the pointer can be over. A place is under the pointer where its sprite has a body, and on its footprint before the pixels are at hand. */
  pickables(): Pickable[] {
    const sheet = this.sheet;
    return this.instances.map((instance) => ({
      kind: "place" as const,
      id: instance.plan.place,
      sort: instance.node.zIndex,
      covers: (wx: number, wy: number): boolean => {
        const def = instance.broken !== null && instance.broken.visible ? instance.plan.broken : instance.plan.whole;
        const box = sheet === null || def === null ? null : sheet.box(def, 0);
        if (box !== null && def !== null) return alphaAtWorld(box, { x: def.ax, y: def.ay }, { x: instance.x, y: instance.y }, instance.plan.scale, wx, wy) >= SOLID;
        const { rect } = instance.plan;
        return wx >= rect.x * CELL && wx < (rect.x + rect.w) * CELL && wy >= rect.y * CELL_DEPTH && wy < (rect.y + rect.h) * CELL_DEPTH;
      },
    }));
  }

  /** What is drawn, for the tests. */
  describe(): {
    places: Array<{ place: string; sprite: string; x: number; y: number }>;
    willows: number;
    /** The trees that are sprites and not willows: how many, and each with its cell and its sprite. */
    trees: number;
    treeList: Array<{ x: number; y: number; sprite: string }>;
    /** The piles of junk that close the lane. */
    junk: number;
    /** The lit windows: for each building that has them, how bright they are now (0 by day), and how many windows have a halo. */
    windows: Array<{ place: string; sprite: string; alpha: number; visible: boolean; halos: number }>;
    pile: "small" | "large" | null;
    bridge: "whole" | "broken" | null;
    lamps: number;
    lampsLit: number;
    /** Where each door lantern hangs, in the world, and whether it is lit. */
    lampList: Array<{ place: string; x: number; y: number; on: boolean }>;
  } {
    return {
      places: this.instances.map((i) => ({ place: i.plan.place, sprite: i.broken !== null && i.broken.visible ? (i.plan.broken?.id ?? i.plan.whole.id) : i.plan.whole.id, x: i.x, y: i.y })),
      willows: this.willows.length,
      trees: this.trees.length,
      treeList: this.trees.map((t) => ({ x: t.cell?.x ?? -1, y: t.cell?.y ?? -1, sprite: t.def.id })),
      junk: this.junk.length,
      windows: this.windows.map((w) => ({ place: w.place, sprite: w.id, alpha: w.sprite.alpha, visible: w.sprite.visible, halos: w.halos.length })),
      pile: this.pile,
      bridge: this.bridge,
      lamps: this.lamps.length,
      lampsLit: this.lampsLit,
      lampList: this.lamps.map((l) => ({ place: l.place, x: l.x, y: l.y, on: l.on })),
    };
  }

  get count(): number {
    return this.instances.length;
  }

  /** How many trees other than willows are sprites, how many piles of junk, how many buildings have lit windows to show, and how many of those show now. */
  get treeCount(): number {
    return this.trees.length;
  }

  get junkCount(): number {
    return this.junk.length;
  }

  get windowCount(): number {
    return this.windows.length;
  }

  get windowsLit(): number {
    return this.windows.filter((w) => w.sprite.visible).length;
  }

  destroy(): void {
    this.clear();
  }
}
