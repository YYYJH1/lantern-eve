// pixi.js/unsafe-eval swaps the parts of PixiJS that build functions at run time for versions that
// do not, so the page can run without 'unsafe-eval' in its Content Security Policy.
import "pixi.js/unsafe-eval";
import { Application, Container, Rectangle, Sprite, type Texture } from "pixi.js";
import { getLang, type Lang, pick, subscribeLang, translate } from "../../i18n/index.ts";
import type { HostClient } from "../client.ts";
import { type Bubble, type ViewFrame, readFrame } from "../frame.ts";
import { firstClause } from "../people.ts";
import { parseScene, type Scene } from "../scene.ts";
import { readSite } from "../slice.ts";
import { Sheet, loadSheetData } from "./atlas.ts";
import { paintBuildings } from "./buildings.ts";
import { Camera, type CameraPort } from "./camera.ts";
import { type Box, boxesOver, OVER_THE_MAP, stampOf } from "./clear.ts";
import type { Deck } from "./people.ts";
import { Rain, RumourDots, rainLevel, Shimmer } from "./effects.ts";
import { CELL, CELL_DEPTH, DEPTH_RATIO, faster, LIVELY, type Motion, STILL } from "./geometry.ts";
import { Lights, lightState } from "./light.ts";
import { DestinationMarker } from "./marker.ts";
import { type HeadItem, HeadLabels } from "./headlabels.ts";
import { NameTags } from "./nametag.ts";
import { Bubbles, PlaceLabels, TalkMarks } from "./overlay.ts";
import { familyColour, pieceColour } from "./palette.ts";
import { MIN_SCREEN_R, People, PLAYER_ID } from "./people.ts";
import { type Pickable, pickFront } from "./pick.ts";
import { Places } from "./places.ts";
import { cellAtWorld } from "./projection.ts";
import { RiddleLantern } from "./riddle.ts";
import { StageCamera } from "./stage-camera.ts";
import { Silhouettes } from "./silhouette-layer.ts";
import { bridgeIsWhole } from "./sprites.ts";
import { cellsOf, paintBackdrop, paintBarriers, paintGround, paintPlainBlocks, paintTrees } from "./terrain.ts";
import { glintTexture, glowTexture, rainTexture } from "./textures.ts";

const BACKGROUND = "#0f141c";

/**
 * Whether WebGL here is drawn by the CPU (SwiftShader, llvmpipe or another software rasterizer): the renderer names itself when the browser lets it,
 * and a browser that does not is taken for a graphics card. A picture of the map costs about a fifth less on such a machine without multisampling, and
 * the sprites and the picture of the ground carry edges of their own, so the town looks the same: only the thin shapes drawn in code (the rings, the
 * plates) are a little less smooth. A graphics card has multisampling for nothing.
 */
export function softwareRenderer(): boolean {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (gl === null) return false;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = info === null ? "" : String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return /swiftshader|llvmpipe|softpipe|software/i.test(name);
  } catch {
    return false;
  }
}

/** Frames a second for each kind of motion: none, the glints and the lanterns, a ring that breathes, people walking. */
const FPS: Record<Motion, number> = { 0: 0, 1: 6, 2: 12, 3: 30 };
const LIVELY_FPS = FPS[LIVELY];
/** A frame is asked for this long before it is due, so that the display's next refresh is the one that draws it. */
const AHEAD_MS = 8;
/** The longest step of the animation, in seconds, so that a frame that comes late does not make a piece jump. */
const MAX_STEP = 0.1;
/**
 * The still parts of the town (ground, trees, buildings) are thousands of shapes. They are drawn
 * once into a picture with this many pixels to a world unit, and each frame draws the picture.
 */
const BAKE_RESOLUTION = 2;
/** Zoomed in further than this many times the picture's own fineness, the shapes are drawn instead, so that they stay sharp. */
const BAKE_SHARPNESS = 1.25;
/** How far from a figure, in pixels of the screen, a pointer still has it under it: a mouse, and a finger. */
const REACH_MOUSE = 6;
const REACH_TOUCH = 14;

/** Where the ground was clicked: the cell, and the place if the click was on a building or a name plate. */
export interface GroundHit {
  x: number;
  y: number;
  place: string | null;
}

/** What the page wants to hear from the map. */
export interface MapEvents {
  /** The pointer is over a person (or no longer), at a position in the map's own pixels. */
  hover?(id: string | null, x: number, y: number): void;
  /** A person was clicked, or the empty ground was. */
  select?(id: string | null): void;
  /** The empty ground was clicked, which is also a `select(null)`. */
  ground?(hit: GroundHit): void;
  /** The camera moved, or the map was resized. */
  camera?(): void;
  /** The riddle lantern at the door of the workshop was clicked. Returns whether the page took the click: where it did not, the click is a click on the ground. */
  riddle?(): boolean;
}

/**
 * What a show that draws on the map needs of it (`festival/stage.ts`): where to put what it draws, the atlas the town's figures come from, the deck of the
 * bridge, and a way to put away what the town draws of its own (its people, the plates with the names of places, the speech bubbles) while the show plays.
 */
export interface StageHost {
  /** The container that everything standing on the ground is sorted in, by the line of the ground it stands on. */
  readonly actors: Container;
  /** The container over the town where lights are added: it is not under the tint of the night. */
  readonly lights: Container;
  readonly sheet: Sheet | null;
  readonly deck: Deck | null;
  setStaged(on: boolean): void;
}

/** The numbers the tests read from the map, without looking at pixels. */
export interface MapStats {
  people: number;
  labels: number;
  labelsShown: number;
  bubbles: number;
  /** The markers over people who talk too far off to be heard. */
  talkers: number;
  rumours: number;
  lanterns: number;
  glints: number;
  rain: string;
  glow: number;
  daylight: number;
  /** Frames drawn since the map started. */
  frames: number;
  /** How many people are drawn as figures of the sprite kit, and how many places as sprites. */
  figures: number;
  places: number;
  willows: number;
  /** The trees that are sprites and not willows, the piles of junk at the lane, and the buildings that have lit windows (and how many of them show now). */
  trees: number;
  junk: number;
  windows: number;
  windowsLit: number;
  /** The bridge as drawn, and the pile of bamboo at it. */
  bridge: "whole" | "broken" | "none";
  pile: "small" | "large" | "none";
  /** Door lanterns that are lit as sprites. */
  lampsLit: number;
  /** People shown through a building that hides them, as shapes over it. */
  silhouettes: number;
  /** The scale of the atlas that was loaded: 0 if there is none. */
  atlas: number;
  /** Whether the picture is multisampled: it is not on a machine whose WebGL is drawn by the CPU. */
  multisampled: boolean;
  /** Whether the pixels of the atlas that picking looks into are at hand. */
  alpha: boolean;
  /** Whether the map is held for a player who asked for less motion, and whether it is held for a page that is hidden. */
  calm: boolean;
  hidden: boolean;
}

/**
 * The map of the town: the scene as vector shapes, the people on it, day and night, rain.
 *
 * It is drawn when there is something new to show and while something on it moves, not at every
 * refresh of the display. A change (a frame of the game, the camera, the language) asks for one
 * frame, and the things that move by themselves keep asking for the next one at their own rate.
 * A map where nothing moves is not drawn at all, and the software renderer of a machine without
 * a graphics card would otherwise be busy with a picture that does not change.
 */
export class MapView {
  readonly camera = new Camera();
  events: MapEvents = {};
  /** Seconds, for the things that move by themselves. The tests replace it to hold the map still. */
  clock: () => number = () => performance.now() / 1000;

  private app: Application | null = null;
  /** Set when the map is taken apart, so that a mount that is still starting then goes no further. */
  private gone = false;
  private client: HostClient | null = null;
  /** The animation frame, or the timer before it, that is going to draw. A map that is still has neither. */
  private frameHandle = 0;
  private waitHandle = 0;
  /** When the next frame is wanted, on the clock of performance.now(). */
  private dueAt = Number.POSITIVE_INFINITY;
  private lastFrameAt = Number.NEGATIVE_INFINITY;
  private motion: Motion = STILL;
  private framesDrawn = 0;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeLang: (() => void) | null = null;
  private lang: Lang = getLang();
  /** Whether the tags over the heads of the people are drawn (the names and the roles). On unless the page turns them off. */
  headTags = true;
  private scene: Scene | null = null;
  private frame: ViewFrame | null = null;
  private sceneVersion = -1;
  private frameCount = -1;
  private frameTick = 0;
  private labelsStamp = "";
  private canvasStamp = "";
  /** The boxes of the page that lie over the map, in the pixels of its canvas, the stamp of them and when they were read. */
  private over: Box[] = [];
  private overStamp = "";
  private overAt = Number.NEGATIVE_INFINITY;
  private overTimer: number | null = null;
  private selectedId: string | null = null;

  private readonly world = new Container();
  private readonly tinted = new Container();
  /** Everything that stands on the ground, sorted by where it stands: the people, the places, the props. */
  private readonly actors = new Container();
  private readonly bright = new Container();
  private readonly overlay = new Container();
  private readonly glows = new Container();
  private readonly people = new People(this.actors);
  private readonly places = new Places(this.actors, this.glows);
  private readonly silhouettes = new Silhouettes(this.actors);
  private readonly nameTags = new NameTags();
  private readonly headLabels = new HeadLabels();
  private readonly groundHost = new Container();
  /** The still parts of the town, as a picture, and as the shapes they were drawn from (hidden while the picture serves). */
  private picture: Sprite | null = null;
  private shapes: Container | null = null;
  private pictureResolution = 1;
  private readonly labels = new PlaceLabels();
  private readonly bubbles = new Bubbles();
  /** What the page itself has people say over the map (`eggs.ts`): drawn like the lines of the game, on a layer of their own, and counted apart from them. */
  private readonly pageBubbles = new Bubbles();
  private pageLines: readonly Bubble[] = [];
  private readonly riddle = new RiddleLantern();
  private halo: Texture | null = null;
  private readonly talkMarks = new TalkMarks();
  private readonly marker = new DestinationMarker();
  private lights: Lights | null = null;
  private shimmer: Shimmer | null = null;
  private rain: Rain | null = null;
  private dots: RumourDots | null = null;
  private textures: Texture[] = [];
  private observer: ResizeObserver | null = null;
  private lastGlow = 0;
  private lastDaylight = 1;
  private lastRain = "none";
  private sheet: Sheet | null = null;
  /** Households whose door lantern is lit by a sprite. */
  private litHouseholds = 0;
  /** The player asked for less motion (`prefers-reduced-motion`). */
  private calm = false;
  private calmQuery: MediaQueryList | null = null;
  /** The page is hidden: nothing is drawn until it is not. */
  private hidden = false;
  private nightLabels = false;
  private showing = false;
  /** Whether the picture is multisampled: not on a machine with a software renderer (see `softwareRenderer`). */
  private multisampled = true;

  /** `off` leaves the map out: nothing is drawn and no graphics context is made. For tests of the host. */
  constructor(private readonly options: { off?: boolean } = {}) {}

  /** False when WebGL could not start; the host runs just the same. */
  get ready(): boolean {
    return this.app !== null;
  }

  /** Whether the map draws at all: it does not on a page opened with `?map=off`. */
  get drawn(): boolean {
    return this.options.off !== true;
  }

  /** Whether the map draws and has the town on it, which is when a show can move its camera. */
  get staged(): boolean {
    return this.app !== null && this.scene !== null;
  }

  /** Asks for the frame that shows where the camera is now. */
  redraw(): void {
    this.events.camera?.();
    this.request(true);
  }

  /** The camera as a show moves it (`director.ts`). */
  stageCamera(): CameraPort {
    return new StageCamera(this);
  }

  /** What a show draws on, or null where the map is not up or has no town yet. */
  stageHost(): StageHost | null {
    if (this.app === null || this.scene === null) return null;
    return { actors: this.actors, lights: this.bright, sheet: this.sheet, deck: this.places.deck(), setStaged: (on) => this.setStaged(on) };
  }

  /** Puts away what the game draws on the map of its own, or brings it back, for a show that tells the town's story in its own pictures. */
  private setStaged(on: boolean): void {
    this.people.setAway(on);
    for (const layer of [this.labels.layer, this.nameTags.layer, this.bubbles.layer, this.pageBubbles.layer, this.talkMarks.layer, this.marker.layer, this.dots?.layer ?? null]) {
      if (layer !== null) layer.visible = !on;
    }
    this.people.link.visible = !on;
    this.refresh();
  }

  /**
   * A small picture of what the map shows: the middle of it, `width` pixels across, as a JPEG data URL of the best of the `qualities` that is no longer
   * than `maxChars`, or null where there is none to be had (no map, a browser that will not give the pixels, or no quality small enough). The picture is of the
   * map and not of what the page lays over it.
   */
  pictureOf(width: number, qualities: readonly number[], maxChars: number): string | null {
    const app = this.app;
    if (app === null) return null;
    try {
      // The camera may have moved since the map last drew (a show moves it and the map draws at the next refresh of the display), so the map is brought up
      // to date first, and what is drawn is what the player sees: the stage has the backdrop of the town as well, which reaches far past the screen.
      this.step(0);
      const source = app.renderer.extract.canvas({ target: app.stage, frame: new Rectangle(0, 0, app.screen.width, app.screen.height), clearColor: BACKGROUND }) as HTMLCanvasElement;
      const wide = Math.min(source.width, Math.round(source.height * 1.6 * 0.82));
      const high = Math.round(wide / 1.6);
      const out = document.createElement("canvas");
      out.width = Math.round(width);
      out.height = Math.round(width / 1.6);
      const context = out.getContext("2d");
      if (context === null) return null;
      context.drawImage(source, Math.round((source.width - wide) / 2), Math.round((source.height - high) / 2), wide, high, 0, 0, out.width, out.height);
      // The best picture that is small enough, by the qualities in the order they are given.
      for (const quality of qualities) {
        const url = out.toDataURL("image/jpeg", quality);
        if (!url.startsWith("data:image/jpeg")) return null;
        if (url.length <= maxChars) return url;
      }
      return null;
    } catch {
      return null;
    }
  }

  get canvas(): HTMLCanvasElement | null {
    return this.app?.canvas ?? null;
  }

  async mount(parent: HTMLElement, client: HostClient): Promise<void> {
    if (this.options.off === true) return;
    // The atlas is fetched once for the page, while the graphics context starts.
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const sheetData = loadSheetData(pixelRatio);
    const app = new Application();
    this.multisampled = !softwareRenderer();
    await app.init({
      background: BACKGROUND,
      resizeTo: parent,
      antialias: this.multisampled,
      preference: "webgl",
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      // The map draws when it has a reason to, which this class decides, not at every refresh.
      autoStart: false,
    });
    if (this.gone) {
      app.destroy({ removeView: true });
      return;
    }
    if (app.renderer.name === "canvas") {
      // Without WebGL PixiJS falls back to the 2D canvas, which cannot draw the tint, the glows or the rain.
      app.destroy({ removeView: true });
      throw new Error("WebGL is not available");
    }
    const data = await sheetData;
    if (this.gone) {
      app.destroy({ removeView: true });
      return;
    }
    this.sheet = data === null ? null : new Sheet(data);
    this.people.configure(this.sheet, app.renderer.resolution);
    this.places.configure(this.sheet);
    // Picking looks into the pixels of the atlas; they are made now, while the town is still being set up. A town that stands still is drawn again once they are there, for the people it hides.
    void this.sheet?.prepareAlpha().then(() => this.refresh(), () => undefined);
    this.client = client;
    const canvas = app.canvas;
    canvas.dataset.testid = "map";
    canvas.setAttribute("role", "img");
    canvas.tabIndex = 0;
    canvas.classList.add("map-canvas");
    parent.appendChild(canvas);

    const glow = glowTexture();
    this.halo = glow;
    const glint = glintTexture();
    const farRain = rainTexture(7);
    const nearRain = rainTexture(19);
    this.textures = [glow, glint, farRain, nearRain];
    this.lights = new Lights(glow);
    this.shimmer = new Shimmer(glint);
    this.dots = new RumourDots(glow);
    this.rain = new Rain(farRain, nearRain);

    this.tinted.addChild(this.groundHost, this.shimmer.layer);
    this.actors.sortableChildren = true;
    this.bright.addChild(this.marker.layer, this.dots.layer, this.lights.layer, this.glows, this.people.link);
    this.world.addChild(this.tinted, this.actors, this.bright);
    this.overlay.addChild(this.rain.layer, this.labels.layer, this.headLabels.layer, this.nameTags.layer, this.bubbles.layer, this.pageBubbles.layer, this.talkMarks.layer);
    app.stage.addChild(this.world, this.overlay);
    this.app = app;

    this.camera.setView(app.screen.width, app.screen.height);
    this.rain.resize(app.screen.width, app.screen.height);
    this.attachInput(canvas);
    this.observer = new ResizeObserver(() => {
      app.resize();
      this.request(true);
    });
    this.observer.observe(parent);
    this.unsubscribe = client.subscribe(() => this.onClient());
    // The words on the map change with the switch itself, in the same moment as the words of the page.
    this.unsubscribeLang = subscribeLang(() => this.setLang(getLang()));
    // A page that is hidden is not drawn, and a player who asked the system for less motion gets a map that holds still.
    this.hidden = document.visibilityState === "hidden";
    document.addEventListener("visibilitychange", this.onVisibility);
    this.calmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.calmQuery.addEventListener("change", this.onCalm);
    this.setCalm(this.calmQuery.matches);
    this.setLang(this.lang);
    // A sheet that opens over the map is no event of the map: the boxes are looked at a few times a second, and a picture is asked for when they moved.
    this.overTimer = window.setInterval(() => {
      if (this.app !== null && !this.gone && !this.hidden && this.sampleOver(this.app.canvas, true)) this.request(true);
    }, 300);
    this.request(true);
  }

  private readonly onVisibility = (): void => {
    this.hidden = document.visibilityState === "hidden";
    if (this.hidden) {
      this.cancelFrame();
    } else {
      this.motion = STILL;
      this.request(true);
    }
  };

  private readonly onCalm = (event: MediaQueryListEvent): void => this.setCalm(event.matches);

  /** Holds the map still for a player who asked for less motion: no steps, no breathing, no swaying, no rain falling. */
  setCalm(calm: boolean): void {
    this.calm = calm;
    this.people.setCalm(calm);
    this.refresh();
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.app?.canvas.setAttribute("aria-label", translate(lang, "map.label"));
    this.people.setLang(lang);
    this.labels.setLang(lang);
    this.labelsStamp = "";
    this.refresh();
  }

  /** Marks a person as the one the player has picked. */
  select(id: string | null): void {
    this.selectedId = id;
    this.people.selected = id;
    this.refresh();
  }

  /** Marks the cell the player was told to walk to, or takes the mark away. */
  setDestination(cell: { x: number; y: number } | null): void {
    this.marker.set(cell);
    this.refresh();
  }

  /** Puts a halo round the person the player is talking to. */
  setTalking(id: string | null): void {
    this.people.talking = id;
    this.refresh();
  }

  /** A show is on the map (a moment of the festival, the festival night): the tags over the heads, which the game keeps over the map, are put away for it. */
  setShowing(on: boolean): void {
    if (this.showing === on) return;
    this.showing = on;
    this.refresh();
  }

  /** Where a cell is on the screen, at its middle on the ground, in the pixels of the map's own element. */
  cellToScreen(x: number, y: number): { x: number; y: number } {
    return this.camera.project((x + 0.5) * CELL, (y + 0.5) * CELL_DEPTH);
  }

  /** The grid cell on the ground under a point of the map's own element. A tall building covers cells behind it: for what is under the pointer, see `pickAt`. */
  cellAt(sx: number, sy: number): { x: number; y: number } {
    const w = this.camera.unproject(sx, sy);
    return cellAtWorld(w.x, w.y);
  }

  /**
   * The person or the place under a point of the map's own element: the nearest thing, by the order
   * the things are drawn in, that has a pixel of its own there. A person standing behind a building is
   * hidden by it and is not picked there, and a person in front of it is picked and the building is not.
   * `reach` is how far off the pointer may be and still be on someone (a finger is less exact than a mouse).
   */
  pickAt(sx: number, sy: number, reach: number = REACH_MOUSE): { kind: "person" | "place"; id: string } | null {
    const w = this.camera.unproject(sx, sy);
    const slack = reach / this.camera.zoom;
    // A person hidden by a building is under the pointer where the shape of them is drawn over it.
    const people = [...this.people.pickables(), ...this.silhouettes.pickables()];
    const items: Pickable[] = [...people, ...this.places.pickables()];
    // What is exactly under the pointer comes first: a finger that is a little off one person is not taken from the person it is on.
    const hit = pickFront(items, w.x, w.y, 0) ?? pickFront(items, w.x, w.y, slack);
    if (hit !== null && hit.id === PLAYER_ID) {
      // The manager cannot be picked, and does not hide anyone: a person who stands behind the manager is picked where the pointer is on both.
      const others = people.filter((p) => p.id !== PLAYER_ID);
      const behind = pickFront(others, w.x, w.y, 0) ?? pickFront(others, w.x, w.y, slack);
      if (behind !== null) return { kind: behind.kind, id: behind.id };
    }
    return hit === null ? null : { kind: hit.kind, id: hit.id };
  }

  /** The place a click would mean: the name plate under the point, else the place whose sprite is there, else the building the cell is in. */
  private placeAt(sx: number, sy: number, cell: { x: number; y: number }, hit: { kind: string; id: string } | null): string | null {
    const plate = this.labels.hit(sx, sy);
    if (plate !== null) return plate;
    if (hit !== null && hit.kind === "place") return hit.id;
    const scene = this.scene;
    if (scene === null || scene.plain) return null;
    const building = scene.buildings.find((b) => cell.x >= b.x && cell.x < b.x + b.w && cell.y >= b.y && cell.y < b.y + b.h);
    return building === undefined || building.place === "" ? null : building.place;
  }

  fit(): void {
    this.camera.fit();
    this.events.camera?.();
    this.request(true);
  }

  zoomBy(factor: number): void {
    const app = this.app;
    if (app === null) return;
    this.camera.zoomAt(app.screen.width / 2, app.screen.height / 2, factor);
    this.events.camera?.();
    this.request(true);
  }

  /** Where a person stands on the map now, on the ground under their feet, in the pixels of the map's own element. */
  screenPositionOf(id: string): { x: number; y: number } | null {
    const at = this.people.positionOf(id);
    return at === null ? null : this.camera.project(at.x, at.y);
  }

  /** The top of a person's head on the map now, which the card that follows them hangs from. */
  headPositionOf(id: string): { x: number; y: number } | null {
    const at = this.people.positionOf(id);
    return at === null ? null : this.camera.project(at.x, at.y - at.top);
  }

  /** The middle of a person's body on the map now: a point that is on them, which a pointer can be put on. */
  bodyPositionOf(id: string): { x: number; y: number } | null {
    const at = this.people.positionOf(id);
    return at === null ? null : this.camera.project(at.x, at.y - at.mid);
  }

  /** What is drawn from the sprite kit, for the tests: each person with the sprite, the animation, the direction and the frame, the places and props, and the name tags. */
  drawing(): ReturnType<Places["describe"]> & {
    people: ReturnType<People["describe"]>;
    nameTags: ReturnType<NameTags["describe"]>;
    headLabels: ReturnType<HeadLabels["describe"]>;
    silhouettes: ReturnType<Silhouettes["describe"]>;
    occluders: ReturnType<Places["describeOccluders"]>;
  } {
    return { ...this.places.describe(), people: this.people.describe(), nameTags: this.nameTags.describe(), headLabels: this.headLabels.describe(), silhouettes: this.silhouettes.describe(), occluders: this.places.describeOccluders() };
  }

  /** The colour of one pixel of the rendered map, `[r, g, b, a]`, at a point of the map's own element. For the tests. */
  sample(sx: number, sy: number): [number, number, number, number] | null {
    const app = this.app;
    if (app === null) return null;
    const { pixels } = app.renderer.extract.pixels({ target: app.stage, frame: new Rectangle(Math.round(sx), Math.round(sy), 1, 1), clearColor: BACKGROUND });
    return [pixels[0] ?? 0, pixels[1] ?? 0, pixels[2] ?? 0, pixels[3] ?? 0];
  }

  /** Resolves when the pixels that picking looks into are at hand. For the tests. */
  async pickReady(): Promise<void> {
    await this.sheet?.prepareAlpha();
  }

  /**
   * The alpha, from 0 to 255, that picking has for one pixel of a frame of a sprite: `u` and `v` are in the pixels of the sprite at
   * scale 1, from the top left of its frame. Null if there is no such sprite or the pixels are not at hand yet. For the tests.
   */
  alphaAt(sprite: string, index: number, u: number, v: number): number | null {
    const def = this.sheet?.sprite(sprite);
    const box = def === undefined ? null : (this.sheet?.box(def, index) ?? null);
    return box === null ? null : box.plane.at(box.x + u * box.scale, box.y + v * box.scale);
  }

  /** The words on the map as they are showing: the place plates by id, and the speech bubbles. */
  texts(): { labels: Record<string, string>; bubbles: string[] } {
    return { labels: this.labels.texts(), bubbles: this.bubbles.texts() };
  }

  /** The words the page has people say over the map of its own, as they are showing (`eggs.ts`). */
  pageTexts(): string[] {
    return this.pageBubbles.texts();
  }

  /** What the page has people say over the map of its own: the lines of the secrets of the town. They are read at each frame of the map and go by their ticks like the lines of the game. */
  setPageLines(lines: readonly Bubble[]): void {
    if (lines === this.pageLines) return;
    this.pageLines = lines;
    this.refresh();
  }

  /** How many riddles were guessed right, which is how bright the riddle lantern burns. */
  setRiddleLevel(level: number): void {
    if (this.riddle.brightness === level) return;
    this.riddle.setLevel(level);
    this.refresh();
  }

  /** The riddle lantern as the map has it, for the tests and for a click on it: where its paper is on the screen, how bright it burns, and whether it is lit. Null where the town has none. */
  riddleLantern(): { x: number; y: number; level: number; lit: boolean; glow: number } | null {
    const at = this.riddle.middle();
    if (at === null) return null;
    const p = this.camera.project(at.x, at.y);
    return { x: p.x, y: p.y, level: this.riddle.brightness, lit: this.riddle.lighting.lit, glow: this.riddle.lighting.glow };
  }

  stats(): MapStats {
    return {
      people: this.people.count,
      labels: this.labels.count,
      labelsShown: this.labels.visibleIds().length,
      bubbles: this.bubbles.shown,
      talkers: this.talkMarks.shown,
      rumours: this.dots?.count ?? 0,
      lanterns: this.lanternCount,
      glints: this.shimmer?.count ?? 0,
      rain: this.lastRain,
      glow: this.lastGlow,
      daylight: this.lastDaylight,
      frames: this.framesDrawn,
      figures: this.people.figures,
      places: this.places.count,
      silhouettes: this.silhouettes.count,
      willows: this.places.describe().willows,
      trees: this.places.treeCount,
      junk: this.places.junkCount,
      windows: this.places.windowCount,
      windowsLit: this.places.windowsLit,
      bridge: this.places.bridge ?? "none",
      pile: this.places.pile ?? "none",
      lampsLit: this.places.lampsLit,
      atlas: this.sheet?.scale ?? 0,
      multisampled: this.multisampled,
      alpha: this.sheet?.alphaReady ?? false,
      calm: this.calm,
      hidden: this.hidden,
    };
  }

  /** The households whose lantern is lit, whether by a sprite at a door or by the shape made in code at a cell. */
  private get lanternCount(): number {
    return this.litHouseholds + (this.lights?.lanternCount ?? 0);
  }

  // --- The frames -------------------------------------------------------------------------------

  /** The host said something. The map is drawn again only if what it draws from is new. */
  private onClient(): void {
    const state = this.client?.state;
    if (state === undefined) return;
    const newScene = state.scene !== null && state.sceneVersion !== this.sceneVersion;
    const newFrame = state.frame !== null && state.frameCount !== this.frameCount;
    const gameEnded = state.frame === null && this.frame !== null;
    if (newScene || newFrame || gameEnded) this.request(false);
  }

  /** Brings the words and the numbers of the map up to date at once, and asks for the frame that draws it. */
  private refresh(): void {
    if (this.app === null) return;
    this.step(0);
    this.request(true);
  }

  /**
   * Asks for a frame. It comes at the next refresh of the display, and, unless the player is doing
   * something (`urgent`), no sooner than the full rate allows after the last one.
   */
  private request(urgent: boolean): void {
    if (this.app === null || this.hidden) return;
    const now = performance.now();
    this.schedule(urgent ? now : Math.max(now, this.lastFrameAt + 1000 / LIVELY_FPS - AHEAD_MS));
  }

  /** Has the next frame drawn at `due`, on the clock of performance.now(), or earlier if one is due sooner already. */
  private schedule(due: number): void {
    if ((this.frameHandle !== 0 || this.waitHandle !== 0) && this.dueAt <= due) return;
    this.cancelFrame();
    this.dueAt = due;
    const wait = due - performance.now();
    if (wait > AHEAD_MS) {
      this.waitHandle = window.setTimeout(() => {
        this.waitHandle = 0;
        this.frameHandle = requestAnimationFrame(this.onFrame);
      }, wait - AHEAD_MS);
    } else {
      this.frameHandle = requestAnimationFrame(this.onFrame);
    }
  }

  private cancelFrame(): void {
    if (this.waitHandle !== 0) window.clearTimeout(this.waitHandle);
    if (this.frameHandle !== 0) cancelAnimationFrame(this.frameHandle);
    this.waitHandle = 0;
    this.frameHandle = 0;
    this.dueAt = Number.POSITIVE_INFINITY;
  }

  private readonly onFrame = (now: number): void => {
    this.frameHandle = 0;
    this.dueAt = Number.POSITIVE_INFINITY;
    const app = this.app;
    if (app === null || this.hidden) return;
    // A map that was resting changed just now, so its step is one frame long. A moving one steps by the time since its last frame.
    const dt = this.motion === LIVELY ? Math.min((now - this.lastFrameAt) / 1000, MAX_STEP) : 1 / LIVELY_FPS;
    this.lastFrameAt = now;
    this.motion = this.step(dt);
    app.render();
    this.framesDrawn++;
    if (this.motion !== STILL) this.schedule(now + 1000 / FPS[this.motion] - AHEAD_MS);
  };

  /** Brings every part of the map to where it is `dt` seconds on, and tells how much of it is moving. */
  private step(dt: number): Motion {
    const app = this.app;
    const client = this.client;
    if (app === null || client === null) return STILL;
    const seconds = this.clock();
    this.camera.setView(app.screen.width, app.screen.height);

    if (client.state.sceneVersion !== this.sceneVersion && client.state.scene !== null) {
      this.sceneVersion = client.state.sceneVersion;
      this.applyScene(parseScene(client.state.scene));
    }
    const raw = client.state.frame;
    if (raw === null && this.frame !== null) {
      // A new game, or a save that was loaded: nobody walks over from where the last game left them.
      this.frame = null;
      this.frameCount = -1;
      this.people.clear();
      this.dots?.clear();
      this.lights?.setLanterns([]);
      this.places.setLanterns([]);
      this.places.setSite(0);
      this.litHouseholds = 0;
    }
    if (client.state.frameCount !== this.frameCount && raw !== null) {
      this.frameCount = client.state.frameCount;
      this.frameTick = client.state.frameTick ?? 0;
      this.frame = readFrame(raw);
      this.takeFrame(this.frame);
    }
    const scene = this.scene;
    if (scene === null) return STILL;

    if (this.picture !== null && this.shapes !== null) {
      const sharp = this.camera.zoom * app.renderer.resolution <= this.pictureResolution * BAKE_SHARPNESS;
      this.picture.visible = sharp;
      this.shapes.visible = !sharp;
    }

    let motion = this.people.tick(dt, this.camera.zoom, seconds, MIN_SCREEN_R);
    this.silhouettes.update(this.people.bodies, this.places.occluders(), this.places.occluderStamp, this.sheet?.alphaReady ?? false, this.camera.zoom);
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    const calm = this.calm;
    motion = faster(motion, this.shimmer?.update(seconds, calm) ?? STILL);
    motion = faster(motion, this.marker.update(seconds, calm));
    motion = faster(motion, this.rain?.update(dt, rainLevel(this.frame?.weather ?? "clear"), calm) ?? STILL);
    motion = faster(motion, this.lights?.update(this.lastGlow, seconds, this.camera.zoom, calm) ?? STILL);
    motion = faster(motion, this.places.update(this.lastGlow, seconds, calm));
    motion = faster(motion, this.riddle.update(this.lastGlow, seconds, calm));
    motion = faster(motion, this.dots?.update(this.frame?.dots ?? [], this.people, this.camera.zoom, seconds, calm) ?? STILL);

    this.sampleOver(app.canvas);
    const stamp = `${this.camera.x.toFixed(1)},${this.camera.y.toFixed(1)},${this.camera.zoom.toFixed(4)},${app.screen.width},${app.screen.height},${this.lang},${this.labels.version},${this.overStamp}`;
    if (stamp !== this.labelsStamp) {
      this.labelsStamp = stamp;
      this.labels.layout(this.camera, app.screen.width, app.screen.height, this.over);
      this.rain?.resize(app.screen.width, app.screen.height);
      this.events.camera?.();
    }
    const you = this.people.positionOf(PLAYER_ID);
    const youAt = you === null ? null : this.camera.project(you.x, you.y - you.mid);
    this.labels.dodge(youAt === null ? null : youAt.x, youAt === null ? 0 : youAt.y, you === null ? 0 : Math.max(you.radius, you.mid) * this.camera.zoom);
    this.bubbles.update(this.frame?.bubbles ?? [], this.frameTick, this.lang, this.people, this.camera, app.screen.width, app.screen.height);
    // The lines of the page keep clear of the lines of the game and of the acts that hang over the manager's piece (the chips), which are boxes of the page.
    this.pageBubbles.update(this.pageLines, this.frameTick, this.lang, this.people, this.camera, app.screen.width, app.screen.height, this.pageLines.length === 0 ? [] : [...this.bubbles.boxes, ...this.chipBoxes(app.canvas)]);
    this.talkMarks.update(this.frame?.talkers ?? [], this.people, this.camera, app.screen.width, app.screen.height);
    this.nameTags.update(this.tagItems(scene), this.nightLabels, app.screen.width, app.screen.height);
    this.headLabels.update(this.headItems(), this.nightLabels, app.screen.width, app.screen.height, this.over, this.labels.boxes());
    this.publish(app.canvas);
    return motion;
  }

  /**
   * Reads the boxes of the page that lie over the map, a few times a second, since they change with the window and with the sheets that come and
   * go. The names of the places and the tags over the heads keep clear of them.
   */
  private sampleOver(canvas: HTMLCanvasElement, force = false): boolean {
    const now = performance.now();
    if (!force && now - this.overAt < 200) return false;
    this.overAt = now;
    const boxes = boxesOver(canvas.getBoundingClientRect(), Array.from(document.querySelectorAll(OVER_THE_MAP), (element) => element.getBoundingClientRect()));
    const stamp = stampOf(boxes);
    if (stamp === this.overStamp) return false;
    this.overStamp = stamp;
    this.over = boxes;
    return true;
  }

  /** The boxes of the acts that hang over the map (`.map-chip`), in the pixels of the canvas. */
  private chipBoxes(canvas: HTMLCanvasElement): Box[] {
    return boxesOver(canvas.getBoundingClientRect(), Array.from(document.querySelectorAll(".map-chip"), (element) => element.getBoundingClientRect()));
  }

  /** What the name tags say: the people who are picked or under the pointer, with their names and the badges of their families. */
  private tagItems(scene: Scene): Array<{ key: string; name: string; badge: { char: string; colour: number } | null; x: number; y: number; picked: boolean }> {
    return this.people.marked().map((m) => {
      const family = m.person.family;
      const familyName = family === null ? undefined : scene.families.get(family);
      const char = familyName === undefined ? undefined : Array.from(pick(familyName, this.lang))[0];
      const at = this.camera.project(m.x, m.y);
      return {
        key: `${m.id}|${this.lang}`,
        name: pick(m.person.name, this.lang),
        badge: family === null || char === undefined ? null : { char, colour: pieceColour(family, family) },
        x: at.x,
        y: at.y,
        picked: m.picked,
      };
    });
  }

  /**
   * What the tags over the heads say: the name of each person the player has talked with and the role of everyone else, with the colour of the family
   * and the dot of the red slip. A person who is speaking has their words over their head, and one who is picked or under the pointer has the tag under
   * their feet, so neither has this one.
   */
  private headItems(): HeadItem[] {
    const frame = this.frame;
    if (frame === null || !this.headTags || this.showing) return [];
    const quiet = new Set<string>(frame.talkers);
    for (const bubble of frame.bubbles) if (this.frameTick < bubble.until) quiet.add(bubble.npc);
    for (const line of this.pageLines) if (this.frameTick < line.until) quiet.add(line.npc);
    for (const marked of this.people.marked()) quiet.add(marked.id);
    const out: HeadItem[] = [];
    for (const head of this.people.heads()) {
      if (quiet.has(head.id)) continue;
      const known = frame.acquainted.has(head.id);
      const role = pick(firstClause(head.person.role), this.lang);
      const text = known || role === "" ? pick(head.person.name, this.lang) : role;
      const at = this.camera.project(head.x, head.y);
      const edge = familyColour(head.person.family);
      out.push({
        id: head.id,
        key: `${head.id}|${this.lang}|${text}|${known}|${edge ?? ""}`,
        text,
        known,
        edge,
        dot: frame.pointed === head.id && this.people.talking !== head.id,
        x: at.x,
        y: at.y,
      });
    }
    return out;
  }

  private applyScene(scene: Scene): void {
    this.scene = scene;
    const old = this.groundHost.removeChildren();
    for (const child of old) child.destroy({ children: true, texture: true, textureSource: true });
    this.picture = null;
    this.shapes = null;
    this.people.clear();
    this.marker.set(null);
    this.frameCount = -1;

    // What has a sprite is left out of the shapes: the places of `PLACE_ART`, the trees (the willows and the others), the junk at the lane, and the deck of the bridge, which the sprite stands over the river.
    const plans = scene.plain ? [] : this.places.plan(scene);
    const covered = new Set(plans.map((plan) => plan.place));
    const bridgeArt = plans.some((plan) => plan.art.broken !== undefined);
    const trees = scene.plain ? new Set<string>() : this.places.treeKeys(scene);

    // The ground is a plan in which a cell is a square. On the screen a cell is 25.22 deep and 32 wide, so the plan is squashed.
    const plan = new Container();
    plan.scale.y = DEPTH_RATIO;
    plan.addChild(paintGround(scene, { bridgeArt }));
    const town = new Container();
    town.addChild(plan);
    this.shimmer?.build(cellsOf(scene, "river"));
    if (scene.plain) {
      plan.addChild(paintPlainBlocks(scene));
    } else {
      town.addChild(paintTrees(scene, trees));
      if (!this.places.hasJunk()) town.addChild(paintBarriers(scene));
      const paint = paintBuildings(scene, (b) => covered.has(b.place));
      town.addChild(paint.graphics);
      this.lights?.setBuildings(paint.lit);
    }
    const backdrop = new Container();
    backdrop.scale.y = DEPTH_RATIO;
    backdrop.addChild(paintBackdrop(scene));
    this.groundHost.addChild(backdrop);
    this.bake(town);

    this.places.build(scene);
    if (this.halo !== null) this.riddle.build(scene, this.actors, this.glows, this.halo);
    this.people.setDeck(this.places.deck());
    const tops = new Map<string, number>();
    for (const item of plans) {
      const top = (item.rect.y + item.rect.h) * CELL_DEPTH - item.whole.ay * item.scale;
      tops.set(item.place, Math.min(tops.get(item.place) ?? Number.POSITIVE_INFINITY, top));
    }
    this.labels.build(scene, this.lang, (place) => tops.get(place) ?? null);
    const width = scene.width * CELL;
    const height = scene.height * CELL_DEPTH;
    const reach = this.places.extent();
    this.camera.setWorld(width, height, reach === null ? {} : { left: -reach.x0, top: -reach.y0, right: reach.x1 - width, bottom: reach.y1 - height });
    this.camera.fit();
    this.labelsStamp = "";
    this.events.camera?.();
  }

  /** Draws the still parts of the town once into a picture, which is what the frames of the map show. */
  private bake(town: Container): void {
    const app = this.app;
    if (app === null) return;
    const bounds = town.getLocalBounds();
    const frame = new Rectangle(Math.floor(bounds.x) - 1, Math.floor(bounds.y) - 1, Math.ceil(bounds.width) + 3, Math.ceil(bounds.height) + 3);
    const gl = (app.renderer as { gl?: WebGLRenderingContext }).gl;
    const largest = gl === undefined ? 4096 : (gl.getParameter(gl.MAX_TEXTURE_SIZE) as number);
    const resolution = Math.min(BAKE_RESOLUTION, largest / Math.max(frame.width, frame.height));
    let texture: Texture;
    try {
      texture = app.renderer.generateTexture({ target: town, frame, resolution, antialias: true, textureSourceOptions: { autoGenerateMipmaps: true } });
    } catch (err) {
      // A graphics card that cannot make a picture that large still draws the shapes.
      console.warn(`the town could not be drawn into a picture: ${err instanceof Error ? err.message : String(err)}`);
      this.groundHost.addChild(town);
      return;
    }
    const picture = new Sprite(texture);
    picture.position.set(frame.x, frame.y);
    town.visible = false;
    this.groundHost.addChild(picture, town);
    this.picture = picture;
    this.shapes = town;
    this.pictureResolution = resolution;
  }

  private takeFrame(frame: ViewFrame): void {
    const scene = this.scene;
    if (scene === null) return;
    this.people.sync(frame, scene);
    // The lanterns at the doors of the houses that have sprites are lit as sprites. The rest hang at the cell the frame names.
    const lit = this.places.setLanterns(frame.lanterns);
    this.litHouseholds = lit.lit;
    this.lights?.setLanterns(lit.rest);
    this.places.setBridge(bridgeIsWhole(frame.hud));
    this.places.setSite(readSite(frame.raw as unknown as Record<string, unknown>)?.bamboo ?? 0);
    const light = lightState(frame.time, frame.weather);
    this.tinted.tint = light.tint;
    this.people.setTint(light.peopleTint);
    this.places.setTint(light.tint);
    this.riddle.setTint(light.tint);
    this.lastGlow = light.glow;
    this.lastDaylight = light.daylight;
    this.lastRain = rainLevel(frame.weather);
    this.nightLabels = light.daylight < 0.55;
    this.labels.setStyle(this.nightLabels ? "night" : "day");
  }

  /** The numbers of the map as attributes of its canvas, which is how the tests read them. */
  private publish(canvas: HTMLCanvasElement): void {
    const frame = this.frame;
    const stamp = [
      this.people.count,
      this.frameCount,
      this.camera.zoom.toFixed(3),
      Math.round(this.camera.x),
      Math.round(this.camera.y),
      this.camera.fitted,
      this.lastRain,
      this.lastGlow.toFixed(2),
      frame?.bubbles.length ?? 0,
      frame?.talkers.length ?? 0,
      frame?.dots.length ?? 0,
      this.lanternCount,
      this.places.bridge ?? "",
      this.places.pile ?? "",
      this.people.figures,
      this.silhouettes.count,
      this.calm,
      this.selectedId ?? "",
      this.people.playerCell?.x ?? "",
      this.people.playerCell?.y ?? "",
      this.people.talking ?? "",
      this.marker.at?.x ?? "",
      this.marker.at?.y ?? "",
    ].join("|");
    if (stamp === this.canvasStamp) return;
    this.canvasStamp = stamp;
    const data = canvas.dataset;
    data.dots = String(this.people.count);
    data.frame = String(this.frameCount);
    data.zoom = this.camera.zoom.toFixed(3);
    data.panX = String(Math.round(this.camera.x));
    data.panY = String(Math.round(this.camera.y));
    data.fitted = String(this.camera.fitted);
    data.rain = this.lastRain;
    data.glow = this.lastGlow.toFixed(2);
    data.bubbles = String(frame?.bubbles.length ?? 0);
    data.talkers = String(this.talkMarks.shown);
    data.rumours = String(frame?.dots.length ?? 0);
    data.lanterns = String(this.lanternCount);
    data.figures = String(this.people.figures);
    data.silhouettes = String(this.silhouettes.count);
    data.places = String(this.places.count);
    data.bridge = this.places.bridge ?? "none";
    data.pile = this.places.pile ?? "none";
    data.atlas = String(this.sheet?.scale ?? 0);
    data.calm = String(this.calm);
    data.selected = this.selectedId ?? "";
    const you = this.people.playerCell;
    data.player = you === null ? "" : `${you.x},${you.y}`;
    data.talking = this.people.talking ?? "";
    data.destination = this.marker.at === null ? "" : `${this.marker.at.x},${this.marker.at.y}`;
  }

  // --- The pointer ------------------------------------------------------------------------------

  /** Whether a point of the map's own element is on the riddle lantern, which nothing but the town is over: not while a show is on the map. */
  private onRiddle(at: { x: number; y: number }, reach: number): boolean {
    if (this.showing || this.app === null) return false;
    const w = this.camera.unproject(at.x, at.y);
    return this.riddle.hits(w.x, w.y, reach / this.camera.zoom);
  }

  private attachInput(canvas: HTMLCanvasElement): void {
    const pointers = new Map<number, { x: number; y: number }>();
    let moved = false;
    let pinch: { distance: number } | null = null;
    let downAt = { x: 0, y: 0 };

    const local = (event: MouseEvent): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };
    // A finger is less exact than a mouse.
    let reach = REACH_MOUSE;
    const personAt = (p: { x: number; y: number }): string | null => {
      const hit = this.pickAt(p.x, p.y, reach);
      return hit !== null && hit.kind === "person" && hit.id !== PLAYER_ID ? hit.id : null;
    };

    canvas.addEventListener("pointerdown", (event) => {
      reach = event.pointerType === "touch" ? REACH_TOUCH : REACH_MOUSE;
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch {
        // A pointer that is already gone, or one made by a script, cannot be captured.
      }
      const p = local(event);
      pointers.set(event.pointerId, p);
      if (pointers.size === 1) {
        moved = false;
        downAt = p;
        pinch = null;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) };
        moved = true;
      }
      canvas.classList.add("is-dragging");
    });

    canvas.addEventListener("pointermove", (event) => {
      const p = local(event);
      const previous = pointers.get(event.pointerId);
      if (previous === undefined) {
        // No button held: only the hover changes.
        reach = event.pointerType === "touch" ? REACH_TOUCH : REACH_MOUSE;
        const id = personAt(p);
        if (id !== this.people.hover) this.request(true);
        this.people.hover = id;
        canvas.style.cursor = id === null && !this.onRiddle(p, reach) ? "" : "pointer";
        this.events.hover?.(id, p.x, p.y);
        return;
      }
      if (pointers.size === 1) {
        // A press that has not moved four pixels is still a click, and the first four pixels count once it is a drag.
        if (!moved && Math.hypot(p.x - downAt.x, p.y - downAt.y) < 4) return;
        moved = true;
        pointers.set(event.pointerId, p);
        this.people.hover = null;
        this.events.hover?.(null, p.x, p.y);
        this.camera.panBy(p.x - previous.x, p.y - previous.y);
        this.events.camera?.();
        this.request(true);
        return;
      }
      pointers.set(event.pointerId, p);
      if (pointers.size === 2 && pinch !== null) {
        const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinch.distance > 0 && distance > 0) this.camera.zoomAt(middle.x, middle.y, distance / pinch.distance);
        // The middle moves with the fingers: the part of the pointers that moved is pan.
        this.camera.panBy((p.x - previous.x) / 2, (p.y - previous.y) / 2);
        pinch = { distance };
        this.events.camera?.();
        this.request(true);
      }
    });

    const end = (event: PointerEvent): void => {
      const p = local(event);
      const wasDown = pointers.delete(event.pointerId);
      if (pointers.size === 0) canvas.classList.remove("is-dragging");
      if (wasDown && pointers.size === 0 && !moved && event.type === "pointerup") {
        const hit = this.pickAt(p.x, p.y, reach);
        const id = hit !== null && hit.kind === "person" && hit.id !== PLAYER_ID ? hit.id : null;
        // The riddle lantern hangs in front of the workshop. A person who stands in front of it is the one who is picked, and the page says whether the lantern opens.
        const lantern = id === null && this.onRiddle(p, reach) && this.events.riddle?.() === true;
        if (!lantern) this.select(id);
        if (!lantern) this.events.select?.(id);
        if (id === null && !lantern) {
          // A click on the player's own figure is a click on the ground where they stand.
          const own = hit !== null && hit.id === PLAYER_ID ? this.people.playerCell : null;
          const cell = own ?? this.cellAt(p.x, p.y);
          this.events.ground?.({ x: cell.x, y: cell.y, place: own === null ? this.placeAt(p.x, p.y, cell, hit) : null });
        }
      }
      if (pointers.size < 2) pinch = null;
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", () => {
      if (pointers.size > 0) return;
      if (this.people.hover !== null) this.request(true);
      this.people.hover = null;
      canvas.style.cursor = "";
      this.events.hover?.(null, 0, 0);
    });

    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
        // A pinch on a trackpad arrives as a wheel with ctrl held, and in smaller steps.
        const speed = event.ctrlKey ? 0.01 : 0.0016;
        const p = local(event);
        this.camera.zoomAt(p.x, p.y, Math.exp(-event.deltaY * unit * speed));
        this.events.camera?.();
        this.request(true);
      },
      { passive: false },
    );

    canvas.addEventListener("dblclick", (event) => {
      const p = local(event);
      this.camera.zoomAt(p.x, p.y, 1.7);
      this.events.camera?.();
      this.request(true);
    });

    canvas.addEventListener("keydown", (event) => {
      const step = 60;
      const app = this.app;
      if (app === null) return;
      let handled = true;
      switch (event.key) {
        case "ArrowLeft":
          this.camera.panBy(step, 0);
          break;
        case "ArrowRight":
          this.camera.panBy(-step, 0);
          break;
        case "ArrowUp":
          this.camera.panBy(0, step);
          break;
        case "ArrowDown":
          this.camera.panBy(0, -step);
          break;
        case "+":
        case "=":
          this.camera.zoomAt(app.screen.width / 2, app.screen.height / 2, 1.25);
          break;
        case "-":
        case "_":
          this.camera.zoomAt(app.screen.width / 2, app.screen.height / 2, 0.8);
          break;
        case "0":
          this.camera.fit();
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        this.events.camera?.();
        this.request(true);
      }
    });
  }

  /** Takes the map apart: for a page that goes away, and for the tests. */
  destroy(): void {
    this.gone = true;
    this.cancelFrame();
    if (this.overTimer !== null) window.clearInterval(this.overTimer);
    this.overTimer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeLang?.();
    this.unsubscribeLang = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.calmQuery?.removeEventListener("change", this.onCalm);
    this.calmQuery = null;
    this.observer?.disconnect();
    this.observer = null;
    this.riddle.destroy();
    for (const texture of this.textures) texture.destroy(true);
    this.textures = [];
    this.people.clear();
    this.people.configure(null, 1);
    this.silhouettes.destroy();
    this.places.destroy();
    this.nameTags.destroy();
    this.headLabels.destroy();
    this.app?.destroy({ removeView: true }, { children: true });
    this.app = null;
    this.sheet?.destroy();
    this.sheet = null;
  }

  // --- For the tests -----------------------------------------------------------------------------

  /** The colour that the ground is multiplied by now, as hexadecimal. For the tests. */
  tint(): string {
    return this.tinted.tint.toString(16).padStart(6, "0");
  }

  /** A hash of the pixels of the rendered map, to tell whether two renderings are the same picture. */
  async pixelHash(): Promise<string> {
    const app = this.app;
    if (app === null) return "";
    const { pixels } = app.renderer.extract.pixels({ target: app.stage, clearColor: BACKGROUND });
    let hash = 2166136261;
    for (let i = 0; i < pixels.length; i++) {
      hash ^= pixels[i] ?? 0;
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  }

  /** How many pixels of the rendered map differ from the background colour. */
  async litPixels(): Promise<{ width: number; height: number; lit: number }> {
    const app = this.app;
    if (app === null) return { width: 0, height: 0, lit: 0 };
    const { pixels, width, height } = app.renderer.extract.pixels({ target: app.stage, clearColor: BACKGROUND });
    const bg = [0x0f, 0x14, 0x1c];
    let lit = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const dr = Math.abs((pixels[i] ?? 0) - (bg[0] ?? 0));
      const dg = Math.abs((pixels[i + 1] ?? 0) - (bg[1] ?? 0));
      const db = Math.abs((pixels[i + 2] ?? 0) - (bg[2] ?? 0));
      if (dr + dg + db > 90) lit++;
    }
    return { width, height, lit };
  }
}
