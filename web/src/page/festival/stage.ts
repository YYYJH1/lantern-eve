/**
 * The festival night on the map: the figures of the plan (`plan.ts`) drawn from the sprite kit, with their lanterns and the light round them, the
 * main lantern before the hall, the lanterns on the river and the storyteller's listeners. It puts what the town draws of its own away while it
 * plays (the town's people, the plates with the names of places, the speech bubbles), puts its own people in their place among the buildings, so that
 * a person behind a building is hidden by it, and takes everything away again when it ends.
 *
 * Everything on screen is a function of the second of the night (`update`), so the stage can be taken to any second.
 */
import { Container, Sprite, type Texture } from "pixi.js";
import { poseOf } from "../map/animate.ts";
import type { Sheet } from "../map/atlas.ts";
import { CELL, CELL_DEPTH } from "../map/geometry.ts";
import type { Dir, SpriteDef } from "../map/manifest.ts";
import type { StageHost } from "../map/map-view.ts";
import { deckLift } from "../map/projection.ts";
import { figureFor, PLAYER_SPRITE } from "../map/sprites.ts";
import { glowTexture } from "../map/textures.ts";
import type { Scene } from "../scene.ts";
import { ART_SCALE, handLantern, LIGHT, mainLantern, MAIN_LANTERN_MIDDLE, riverLantern, spark } from "./art.ts";
import { type Bearer, type Glow, KIND_SPRITE, type Plan, type Pt, riverAt, type RiverBed, type RiverLantern, riverLanterns, riverCount, type Standing, storyScene, type StoryScene, walkOf } from "./plan.ts";
import { Rng } from "./rng.ts";
import { FLARE_SECONDS, type Timeline } from "./timeline.ts";

/** Where the hand of a figure is, from the point it stands on, for each way it faces, in pixels as shown. */
const HAND: Readonly<Record<Dir, Pt>> = { down: { x: 9, y: -11 }, up: { x: -9, y: -13 }, left: { x: -11, y: -12 }, right: { x: 11, y: -12 } };
/** How far over the hand the middle of the paper of a hand lantern is, in pixels as shown. */
const PAPER_RISE = 17.5;
/** The size of the light round a hand lantern and round the main lantern, as the share of the light's texture (128 pixels), and how bright each is at most. */
const HAND_LIGHT = { scale: 0.4, alpha: 0.4 };
const MAIN_LIGHT = { scale: 2.1, alpha: 0.85 };
/** How much of its light the lantern of a person has who stands in a crowd. */
const STANDING_LIGHT = 0.45;
const SPARKS = 20;

interface Rig {
  node: Container;
  body: Sprite;
  def: SpriteDef;
  index: number;
  /** The way the figure faces, or null before it is first put on the map. */
  dir: Dir | null;
  /** How far the figure is lifted over the ground, which is the arch of the bridge under it. */
  lift: number;
  phase: number;
  /** The hand lantern, its light, and the size it is carried at (a child carries a smaller one). */
  lantern: Sprite | null;
  light: Sprite | null;
  size: number;
  shown: boolean;
}

interface Floating {
  rig: RiverLantern;
  sprite: Sprite;
  light: Sprite;
}

/** What the tests ask of the stage. */
export interface StageStats {
  bearers: number;
  /** The figures that are on the map now, and those of them that are walking. */
  visible: number;
  walking: number;
  /** The figures by colour of lantern. */
  colours: Record<Glow, number>;
  named: number;
  lighters: string[];
  river: number;
  /** How far the main lantern is lit, from 0 to 1. */
  flare: number;
  storyteller: boolean;
  listeners: number;
  manager: boolean;
}

export interface StageInit {
  host: StageHost;
  plan: Plan;
  scene: Scene;
  timeline: Timeline;
  /** Whether the ending has the storyteller. */
  storyteller: boolean;
  /** Whether the player asked for less motion: nobody takes a step in place, and the lights do not flicker. */
  calm: boolean;
  /** The tint of the night for the people, and how strongly the lamps are lit (1 at night). */
  light: { peopleTint: number; glow: number };
  river: RiverBed;
  /** How many times as many lanterns as the ending calls for the river carries: 2 on a Lantern Festival of the calendar, 1 on any other day. */
  riverFactor?: number;
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

export class FestivalStage {
  private readonly sheet: Sheet;
  private readonly host: StageHost;
  private readonly plan: Plan;
  private readonly timeline: Timeline;
  private readonly calm: boolean;
  private readonly glowStrength: number;
  private readonly lights = new Container();
  private readonly glow: Texture;
  private readonly textures: Texture[] = [];
  private readonly hands = new Map<Glow, Texture>();
  private readonly bearers: Array<{ who: Bearer; rig: Rig }> = [];
  private readonly standing: Array<{ who: Standing; rig: Rig; talking: boolean }> = [];
  private readonly listeners: Array<{ rig: Rig; x: number; y: number; dir: Dir }> = [];
  private readonly floating: Floating[] = [];
  private readonly sparks: Array<{ sprite: Sprite; born: number; dx: number; rise: number; sway: number }> = [];
  private readonly nodes: Container[] = [];
  private mainPost: Sprite | null = null;
  private mainLight: Sprite | null = null;
  private mainFlash: Sprite | null = null;
  private mainLit = false;
  private litTexture: Texture | null = null;
  private unlitTexture: Texture | null = null;
  private flame: Sprite | null = null;
  private flare = 0;
  private seconds = 0;
  private tellerRig: Rig | null = null;
  private managerRig: Rig | null = null;
  private readonly river: RiverBed;
  private readonly riverFactor: number;
  private gone = false;

  constructor(init: StageInit) {
    if (init.host.sheet === null) throw new Error("the festival night needs the sprites of the town");
    this.sheet = init.host.sheet;
    this.host = init.host;
    this.plan = init.plan;
    this.timeline = init.timeline;
    this.calm = init.calm;
    this.glowStrength = clamp01(init.light.glow) * init.plan.mood.glow;
    this.river = init.river;
    this.riverFactor = Math.max(1, Math.trunc(init.riverFactor ?? 1));
    const peopleTint = init.light.peopleTint;
    this.glow = this.own(glowTexture());
    this.host.lights.addChild(this.lights);

    for (const colour of ["red", "blue", "gold"] as const) this.hands.set(colour, this.own(handLantern(colour)));

    // The people of the districts.
    for (const who of this.plan.bearers) {
      const rig = this.makeRig(KIND_SPRITE[who.kind], who.phase, peopleTint, this.hands.get(who.glow) ?? null, who.glow, who.kind === "child" ? 0.82 : 1);
      if (rig !== null) this.bearers.push({ who, rig });
    }
    // The named people, the people who light the main lantern, and the manager at the bridgehead.
    for (const who of this.plan.named) this.addStanding(who, figureFor(who.id, (id) => this.sheet.has(id)), peopleTint, false);
    for (const who of this.plan.lighters) this.addStanding(who, figureFor(who.id, (id) => this.sheet.has(id)), peopleTint, false);
    const managerRig = this.makeRig(PLAYER_SPRITE, 0.31, peopleTint, null, null, 1);
    if (managerRig !== null) {
      this.managerRig = managerRig;
      this.standing.push({ who: this.plan.manager, rig: managerRig, talking: false });
    }
    if (init.storyteller) this.buildStory(storyScene(init.scene, this.plan.seed), peopleTint);

    this.buildMainLantern();
    this.buildRiver();
    this.update(0);
  }

  /** Keeps a texture to destroy when the stage is taken away. */
  private own<T extends Texture>(texture: T): T {
    this.textures.push(texture);
    return texture;
  }

  /** A figure of the kit that stands on the map among the buildings. Null if the kit has no such sprite. */
  private makeRig(spriteId: string | null, phase: number, tint: number, lantern: Texture | null, colour: Glow | null, size: number): Rig | null {
    const def = spriteId === null ? undefined : this.sheet.sprite(spriteId);
    if (def === undefined) return null;
    const node = new Container();
    node.tint = tint;
    const body = new Sprite();
    body.anchor.set(def.ax / def.w, def.ay / def.h);
    node.addChild(body);
    let held: Sprite | null = null;
    let light: Sprite | null = null;
    if (lantern !== null && colour !== null) {
      held = new Sprite(lantern);
      held.anchor.set(0.5, 1);
      held.scale.set(size / ART_SCALE);
      node.addChild(held);
      light = new Sprite(this.glow);
      light.anchor.set(0.5);
      // Many of these lie over one another in a crowd, and added they would all go to white: screened, they go no further than the brightest.
      light.blendMode = "screen";
      light.tint = LIGHT[colour];
      light.scale.set(HAND_LIGHT.scale * size);
      this.lights.addChild(light);
    }
    this.host.actors.addChild(node);
    this.nodes.push(node);
    return { node, body, def, index: -1, dir: null, lift: 0, phase, lantern: held, light, size, shown: true };
  }

  private addStanding(who: Standing, spriteId: string | null, tint: number, talking: boolean): void {
    const rig = this.makeRig(spriteId, (this.standing.length * 0.137) % 1, tint, null, null, 1);
    if (rig !== null) this.standing.push({ who, rig, talking });
  }

  private buildStory(scene: StoryScene, tint: number): void {
    const teller = this.makeRig(KIND_SPRITE.townsman, 0.2, tint, null, null, 1);
    if (teller !== null) {
      this.tellerRig = teller;
      this.standing.push({ who: scene.teller, rig: teller, talking: true });
    }
    for (const l of scene.listeners) {
      const rig = this.makeRig(KIND_SPRITE[l.kind], l.phase, tint, null, null, 1);
      if (rig !== null) this.listeners.push({ rig, x: l.x, y: l.y, dir: l.dir });
    }
  }

  private buildMainLantern(): void {
    this.unlitTexture = this.own(mainLantern(false));
    this.litTexture = this.own(mainLantern(true));
    const post = new Sprite(this.unlitTexture);
    post.anchor.set(0.5, 1);
    post.scale.set(1 / ART_SCALE);
    const node = new Container();
    node.position.set(this.plan.lantern.x, this.plan.lantern.y);
    node.zIndex = this.plan.lantern.y;
    node.addChild(post);
    this.host.actors.addChild(node);
    this.nodes.push(node);
    this.mainPost = post;
    post.tint = 0xa89aa8;
    const light = new Sprite(this.glow);
    light.anchor.set(0.5);
    light.blendMode = "add";
    light.tint = LIGHT.red;
    light.alpha = 0;
    light.position.set(this.plan.lantern.x + MAIN_LANTERN_MIDDLE.x, this.plan.lantern.y + MAIN_LANTERN_MIDDLE.y);
    light.scale.set(MAIN_LIGHT.scale);
    this.lights.addChild(light);
    this.mainLight = light;
    const flash = new Sprite(this.glow);
    flash.anchor.set(0.5);
    flash.blendMode = "add";
    flash.tint = 0xffe2a0;
    flash.alpha = 0;
    flash.position.copyFrom(light.position);
    this.lights.addChild(flash);
    this.mainFlash = flash;
    // the taper that the one who lights the lantern holds up
    const flame = new Sprite(this.glow);
    flame.anchor.set(0.5);
    flame.blendMode = "add";
    flame.tint = 0xffd070;
    flame.scale.set(0.22);
    flame.alpha = 0;
    this.lights.addChild(flame);
    this.flame = flame;
    const sparkTexture = this.own(spark());
    const rng = new Rng(this.plan.seed, "sparks");
    for (let i = 0; i < SPARKS; i++) {
      const sprite = new Sprite(sparkTexture);
      sprite.anchor.set(0.5);
      sprite.blendMode = "add";
      sprite.alpha = 0;
      this.lights.addChild(sprite);
      this.sparks.push({ sprite, born: (this.timeline.lightAt ?? 0) + i * 0.09, dx: rng.range(-26, 26), rise: rng.range(36, 74), sway: rng.range(0.6, 1.6) });
    }
  }

  private buildRiver(): void {
    const count = riverCount(this.plan.route, this.plan.bearers.length, this.plan.mood) * this.riverFactor;
    const textures = new Map<Glow, Texture>();
    for (const l of riverLanterns(count, this.plan.seed)) {
      let texture = textures.get(l.glow);
      if (texture === undefined) {
        texture = this.own(riverLantern(l.glow));
        textures.set(l.glow, texture);
      }
      const sprite = new Sprite(texture);
      sprite.anchor.set(0.5, 0.6);
      sprite.scale.set(l.scale / ART_SCALE);
      this.host.actors.addChild(sprite);
      this.nodes.push(sprite);
      const light = new Sprite(this.glow);
      light.anchor.set(0.5);
      light.blendMode = "add";
      light.tint = LIGHT[l.glow];
      light.blendMode = "screen";
      light.scale.set(0.3 * l.scale);
      this.lights.addChild(light);
      this.floating.push({ rig: l, sprite, light });
    }
  }

  // --- A second of the night -----------------------------------------------------------------------------------------

  /** Brings everything on the map to where and how it is `seconds` into the night. */
  update(seconds: number): void {
    if (this.gone) return;
    this.seconds = seconds;
    const flicker = (phase: number): number => (this.calm ? 1 : 0.92 + 0.08 * Math.sin(seconds * 3.1 + phase * 6.28));
    const strength = this.glowStrength;
    for (const { who, rig } of this.bearers) {
      const walk = walkOf(this.plan, who, seconds);
      this.show(rig, walk.visible);
      if (!walk.visible) continue;
      this.pose(rig, walk.moving, false, walk.dir, walk.walked, seconds);
      this.place(rig, walk.x, walk.y, walk.dir);
      // People who stand in a crowd lie over one another's light, which would be too much: their lamps are a little dimmer than those of a line that walks.
      this.hold(rig, walk.x, walk.y, strength * flicker(who.phase) * (walk.moving ? 1 : STANDING_LIGHT));
    }
    for (const { who, rig, talking } of this.standing) {
      this.pose(rig, false, talking, who.dir, 0, seconds);
      this.place(rig, who.x, who.y, who.dir);
    }
    for (const l of this.listeners) {
      this.pose(l.rig, false, false, l.dir, 0, seconds);
      this.place(l.rig, l.x, l.y, l.dir);
    }
    this.updateMain(seconds, strength);
    this.updateRiver(seconds, strength);
  }

  private show(rig: Rig, visible: boolean): void {
    if (rig.shown === visible) return;
    rig.shown = visible;
    rig.node.visible = visible;
    if (rig.light !== null) rig.light.visible = visible;
  }

  private pose(rig: Rig, moving: boolean, talking: boolean, dir: Dir, walked: number, seconds: number): void {
    const pose = poseOf(rig.def, { moving, talking, carrying: null, dir, walked, seconds, phase: rig.phase, reduced: this.calm });
    if (pose === null || pose.index === rig.index) return;
    rig.index = pose.index;
    const texture = this.sheet.texture(rig.def, pose.index);
    if (texture !== null) rig.body.texture = texture;
  }

  /** Puts a figure on a point of the ground, lifted over the arch if it is on the deck of the bridge, and drawn in the order of the ground it stands on. */
  private place(rig: Rig, x: number, y: number, dir: Dir): void {
    const deck = this.host.deck;
    const gx = x / CELL;
    const gy = y / CELL_DEPTH;
    const onDeck = deck !== null && gy >= deck.top && gy <= deck.top + deck.rows && gx >= deck.left && gx <= deck.left + deck.cols;
    const lift = onDeck && deck !== null ? deckLift(deck.lifts, deck.cols, gx - deck.left) : 0;
    rig.node.position.set(x, y - lift);
    rig.node.zIndex = onDeck && deck !== null ? deck.sort + 0.25 + (gy - deck.top) * 0.01 : y;
    rig.lift = lift;
    if (rig.dir === dir) return;
    rig.dir = dir;
    if (rig.lantern === null) return;
    const hand = HAND[dir];
    rig.lantern.position.set(hand.x * rig.size, hand.y * rig.size);
    // a person facing away holds the lantern on the far side of the body
    rig.node.setChildIndex(rig.lantern, dir === "up" ? 0 : rig.node.children.length - 1);
  }

  /** The light of the lantern a person holds goes with the lantern. */
  private hold(rig: Rig, x: number, y: number, strength: number): void {
    if (rig.light === null || rig.dir === null) return;
    const hand = HAND[rig.dir];
    rig.light.position.set(x + hand.x * rig.size, y - rig.lift + (hand.y - PAPER_RISE) * rig.size);
    rig.light.alpha = HAND_LIGHT.alpha * strength;
  }

  private updateMain(seconds: number, strength: number): void {
    const lightAt = this.timeline.lightAt;
    const post = this.mainPost;
    const light = this.mainLight;
    const flash = this.mainFlash;
    if (post === null || light === null || flash === null) return;
    const lit = lightAt !== null && seconds >= lightAt + 0.35;
    if (lit !== this.mainLit) {
      this.mainLit = lit;
      const texture = lit ? this.litTexture : this.unlitTexture;
      if (texture !== null) post.texture = texture;
      // Until it is lit the lantern is dim: the lamps of the crowd round it must not make it look lit.
      post.tint = lit ? 0xffffff : 0xa89aa8;
    }
    this.flare = lightAt === null ? 0 : clamp01((seconds - lightAt) / FLARE_SECONDS);
    const f = this.flare * this.flare * (3 - 2 * this.flare);
    const flicker = this.calm ? 1 : 0.93 + 0.07 * Math.sin(seconds * 2.3);
    // Unlit, the lantern still has a little of the light of the town on it.
    light.alpha = (0.05 + (MAIN_LIGHT.alpha - 0.05) * f) * strength * flicker;
    const since = lightAt === null ? -1 : seconds - lightAt;
    flash.alpha = since >= 0 && since < 1.6 ? 0.8 * (1 - since / 1.6) ** 2 * strength : 0;
    flash.scale.set(MAIN_LIGHT.scale * (0.6 + Math.max(0, since) * 0.9));
    // the taper: lifted by the first of those who light the lantern a moment before it is lit
    const first = this.plan.lighters[0];
    const flame = this.flame;
    if (flame !== null) {
      const near = lightAt !== null && first !== undefined && seconds >= lightAt - 1.4 && seconds < lightAt + 0.5;
      flame.alpha = near ? 0.85 : 0;
      if (near && first !== undefined) flame.position.set(first.x + 7, first.y - 24);
    }
    for (const s of this.sparks) {
      const age = seconds - s.born;
      if (lightAt === null || age < 0 || age > 2.4) {
        s.sprite.alpha = 0;
        continue;
      }
      const u = age / 2.4;
      s.sprite.alpha = (1 - u) * 0.9 * strength;
      s.sprite.scale.set(0.9 - 0.45 * u);
      s.sprite.position.set(light.x + s.dx * u + Math.sin(age * s.sway * 3) * 6, light.y + 10 - s.rise * u * 1.6);
    }
  }

  private updateRiver(seconds: number, strength: number): void {
    for (const f of this.floating) {
      const at = riverAt(f.rig, seconds, this.river);
      f.sprite.position.set(at.x, at.y);
      f.sprite.zIndex = at.y;
      f.light.position.set(at.x, at.y - 4);
      f.light.alpha = 0.36 * strength * (this.calm ? 1 : 0.9 + 0.1 * Math.sin(seconds * 2.2 + f.rig.phase));
    }
  }

  // --- What the tests ask ---------------------------------------------------------------------------------------------

  describe(): StageStats {
    const colours: Record<Glow, number> = { red: 0, blue: 0, gold: 0 };
    let visible = 0;
    let walking = 0;
    for (const { who, rig } of this.bearers) {
      colours[who.glow]++;
      if (!rig.shown) continue;
      visible++;
      if (walkOf(this.plan, who, this.seconds).moving) walking++;
    }
    return {
      bearers: this.bearers.length,
      visible,
      walking,
      colours,
      named: this.plan.named.length,
      lighters: this.plan.lighters.map((l) => l.id),
      river: this.floating.length,
      flare: this.flare,
      storyteller: this.tellerRig !== null,
      listeners: this.listeners.length,
      manager: this.managerRig !== null,
    };
  }

  /** The tick of the picture: how lit the main lantern is, for a test that waits for it. */
  get lit(): boolean {
    return this.mainLit;
  }

  // --- Taking it away ---------------------------------------------------------------------------------------------------

  destroy(): void {
    if (this.gone) return;
    this.gone = true;
    try {
      for (const node of this.nodes) node.destroy({ children: true });
      this.lights.destroy({ children: true });
    } catch {
      // the map was taken apart first, and what it held is gone with it
    }
    for (const texture of this.textures) {
      try {
        texture.destroy(true);
      } catch {
        // the same
      }
    }
    this.nodes.length = 0;
    this.textures.length = 0;
    this.bearers.length = 0;
    this.standing.length = 0;
    this.listeners.length = 0;
    this.floating.length = 0;
  }
}

