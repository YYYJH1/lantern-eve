/**
 * The townsfolk. A person who has a figure in the sprite kit is drawn as that figure: it faces the
 * way it walks, takes a step for the ground it covers, stands and breathes, talks, carries the
 * bamboo, and is lifted over the arch of the bridge. A person without one is drawn as a round piece
 * with a surname on it, like a piece on a board, which is also what every person is when the sprites
 * are not there. Both have the marks for what the person is doing (asleep, a load, an umbrella)
 * over the head, and a person who is picked or under the pointer is outlined. A piece moves
 * smoothly towards the cell the core reports. The player is one more figure, the festival manager,
 * who is not counted among the people.
 */
import { Container, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { Lang } from "../../i18n/index.ts";
import type { FramePerson, FramePlayer, ViewFrame } from "../frame.ts";
import type { Person, PlayerInfo, Scene } from "../scene.ts";
import { ARRIVED, chooseDir, phaseOf, type Pose, poseOf } from "./animate.ts";
import type { Sheet } from "./atlas.ts";
import { CELL, CELL_DEPTH, clamp, DEPTH_RATIO, LIVELY, type Motion, PULSE, STILL } from "./geometry.ts";
import type { Dir, SpriteDef } from "./manifest.ts";
import { OutlineFilter } from "./outline.ts";
import { familyColour, mix, PAL, pieceColour } from "./palette.ts";
import { alphaAtWorld, type FrameBox, type Pickable, SOLID } from "./pick.ts";
import { deckLift } from "./projection.ts";
import { type Box, type Hidable, type Tight, tightOf } from "./silhouette.ts";
import { figureFor } from "./sprites.ts";

export const FONT_STACK =
  '"PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif';

/** The id the player's piece answers to in `positionOf`. It is the id the core gives the player. */
export const PLAYER_ID = "player";
/** The radius of a piece in world units. */
export const PIECE_R = CELL * 0.42;
/** A piece is never drawn smaller than this on screen, in pixels, so that its name stays readable. */
export const MIN_SCREEN_R = 9.5;
/** Seconds in which a piece closes most of its distance to the cell it is walking to. */
const GLIDE = 0.1;
/** A piece this close to its cell, in pixels, is on it. */
const SNAP = 0.25;
/** The size of the marks over a figure's head, in world pixels at a zoom of 1. */
const MARK_R = 11;
/** The colour of the outline of a person who is picked or under the pointer. */
const OUTLINE = 0xfff0b0;

/** The bridge deck: where it is, and how a walker on it is lifted. */
export interface Deck {
  /** The cell of its west end and its north edge. */
  left: number;
  top: number;
  cols: number;
  rows: number;
  /** The lift of a walker, from the west end to the east end of the span, in pixels. */
  lifts: readonly number[];
  /** The sort key of the bridge sprite, which a walker on the deck is drawn after. */
  sort: number;
}

/** Where a person is, for the things that follow them: speech bubbles, rumours, the name tag. All in the world, in pixels at a zoom of 1. */
export interface Where {
  /** The ground under the feet, with the lift of the bridge taken off. */
  x: number;
  y: number;
  /** Half the width of the body. */
  radius: number;
  /** How far over the feet the top of the head is, and the middle of the body. */
  top: number;
  mid: number;
}

/** A figure as the silhouettes see it (see silhouette.ts): where it is, which pixels of its frame are solid, and the sprite and the colour to draw it again with. */
export interface Figure extends Hidable {
  /** The colour of the person's family, which is the colour of their silhouette: the player's is gold. */
  colour: number;
  /** The sprite that draws the figure: its texture is the frame that is drawn. */
  sprite: Sprite;
}

class FigureBody implements Figure {
  sort = 0;
  x = 0;
  y = 0;
  frame = -1;
  readonly box: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  /** The pixels of the frame that is drawn, once they are at hand, and the box that holds the body in them. */
  pixels: FrameBox | null = null;
  tight: Tight | null = null;

  constructor(
    readonly id: string,
    readonly colour: number,
    readonly sprite: Sprite,
    private readonly anchor: { x: number; y: number },
  ) {}

  covers(wx: number, wy: number): boolean {
    return this.pixels !== null && alphaAtWorld(this.pixels, this.anchor, this, 1, wx, wy) >= SOLID;
  }
}

interface Piece {
  id: string;
  person: Person;
  you: boolean;
  node: Container;
  /** The figure, or null for a piece. */
  def: SpriteDef | null;
  body: Sprite | null;
  token: Text | null;
  /** The shapes that go over the head: asleep, an umbrella, a load. */
  sleep: Graphics;
  umbrella: Graphics;
  load: Graphics;
  marks: Container;
  /** A piece's ring when it is picked, and the halo of the person who is talked to. */
  ring: Graphics | null;
  halo: Graphics;
  x: number;
  y: number;
  tx: number;
  ty: number;
  dir: Dir;
  walked: number;
  moving: boolean;
  pose: Pose | null;
  lift: number;
  /** Whether the person is on the deck of the bridge. */
  onDeck: boolean;
  status: string | null;
  carrying: string | null;
  activity: string;
  scale: number;
  phase: number;
  /** The height of the head and of the middle of the body over the feet, and half the width. */
  top: number;
  mid: number;
  radius: number;
  outlined: boolean;
  /** Whether the ring of the halo on the ground is drawn. */
  haloDrawn: boolean;
  /** What the silhouettes look at, for a figure. */
  figure: FigureBody | null;
}

function loadColour(item: string | null): number {
  if (item === "bamboo") return PAL.bamboo;
  if (item === "timber") return PAL.timber;
  if (item === "tools") return PAL.tools;
  return PAL.timber;
}

export class People {
  private readonly pieces = new Map<string, Piece>();
  private you: Piece | null = null;
  /** The dotted thread from the player to the person they talk to. It is drawn over everything, with the lights. */
  readonly link = new Graphics();
  private lang: Lang = "en";
  private sheet: Sheet | null = null;
  private outline: OutlineFilter | null = null;
  private deck: Deck | null = null;
  private calm = false;
  /** Whether the people are put away, as they are while the festival night plays (they are not drawn, and nobody is hidden behind a building). */
  private away = false;
  private tint = 0xffffff;
  /** The figures as of the last tick, for the silhouettes. The list is kept and filled again at every tick. */
  private readonly drawn: Figure[] = [];
  selected: string | null = null;
  hover: string | null = null;
  /** The person the player is talking to: a halo round them and a thread to the player. */
  talking: string | null = null;
  /** Whether the thread to the talk partner is on the screen, so that it is cleared once and not every frame. */
  private linked = false;

  /** `host` is the container that everything on the ground is sorted in, and the people are put into it. */
  constructor(private readonly host: Container) {}

  /** The sprites to draw people with (none: pieces), and the pixel ratio of the screen, for the outline. */
  configure(sheet: Sheet | null, pixelRatio: number): void {
    this.sheet = sheet;
    this.outline?.destroy();
    this.outline = sheet === null ? null : new OutlineFilter(OUTLINE, 2, pixelRatio);
  }

  /** Where the bridge deck is, so that a walker on it is lifted. */
  setDeck(deck: Deck | null): void {
    this.deck = deck;
  }

  /** Whether the player asked for less motion: pieces then jump to their cells and stand in one pose. */
  setCalm(calm: boolean): void {
    this.calm = calm;
  }

  /** Puts the people away, or brings them back. A person put away is not drawn and is not behind anything. */
  setAway(away: boolean): void {
    this.away = away;
    for (const piece of this.all()) piece.node.visible = !away;
  }

  clear(): void {
    for (const piece of this.pieces.values()) piece.node.destroy({ children: true });
    this.pieces.clear();
    this.drawn.length = 0;
    this.dropPlayer();
    this.link.clear();
    this.linked = false;
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    for (const piece of this.all()) if (piece.token !== null) piece.token.text = piece.person.token[lang];
  }

  /** The colour that the people are multiplied by now: the tint of the light, a little lighter at night. */
  setTint(tint: number): void {
    this.tint = tint;
    for (const piece of this.all()) piece.node.tint = tint;
  }

  private all(): Piece[] {
    return this.you === null ? [...this.pieces.values()] : [...this.pieces.values(), this.you];
  }

  private dropPlayer(): void {
    if (this.you === null) return;
    this.you.node.destroy({ children: true });
    this.you = null;
  }

  get count(): number {
    return this.pieces.size;
  }

  /** Takes the people of a new frame: makes the pieces that are new, and sets where each goes. */
  sync(frame: ViewFrame, scene: Scene): void {
    const seen = new Set<string>();
    const cast = new Map(scene.cast.map((p) => [p.id, p]));
    for (const entry of frame.people) {
      seen.add(entry.id);
      let piece = this.pieces.get(entry.id);
      if (piece === undefined) {
        const person: Person = cast.get(entry.id) ?? {
          id: entry.id,
          name: { zh: entry.id, en: entry.id },
          role: { zh: "", en: "" },
          bio: { zh: "", en: "" },
          intro: { zh: "", en: "" },
          token: { zh: entry.id.slice(-1), en: entry.id.slice(-1) },
          family: null,
          home: null,
          work: null,
        };
        piece = this.make(person, entry);
        this.pieces.set(entry.id, piece);
        this.host.addChild(piece.node);
      }
      this.aim(piece, entry);
    }
    for (const [id, piece] of this.pieces) {
      if (seen.has(id)) continue;
      piece.node.destroy({ children: true });
      this.pieces.delete(id);
    }
    this.syncPlayer(frame.player, scene.player);
  }

  /** The player's piece: made when the frame first shows the player, and moved like the others. */
  private syncPlayer(at: FramePlayer | null, info: PlayerInfo | null): void {
    if (at === null || info === null) {
      this.dropPlayer();
      return;
    }
    const entry: FramePerson = { id: info.id, x: at.x, y: at.y, activity: at.activity, carrying: null, status: null };
    if (this.you === null) {
      const person: Person = { id: info.id, name: info.name, role: info.role, bio: { zh: "", en: "" }, intro: { zh: "", en: "" }, token: info.token, family: null, home: null, work: null };
      this.you = this.make(person, entry, true);
      this.host.addChild(this.you.node);
    }
    this.aim(this.you, entry);
  }

  // --- Making a person ----------------------------------------------------------------------

  private make(person: Person, entry: FramePerson, you = false): Piece {
    const sheet = this.sheet;
    const spriteId = sheet === null ? null : figureFor(person.id, (id) => sheet.has(id), you);
    const def = sheet === null || spriteId === null ? null : (sheet.sprite(spriteId) ?? null);
    const node = new Container();
    const x = (entry.x + 0.5) * CELL;
    const y = (entry.y + 0.5) * CELL_DEPTH;
    node.position.set(x, y);
    node.tint = this.tint;
    node.visible = !this.away;
    // The halo of the person who is being talked to: a gold ring on the ground.
    const halo = new Graphics();
    halo.visible = false;
    const base: Piece = {
      id: person.id,
      person,
      you,
      node,
      def,
      body: null,
      token: null,
      sleep: new Graphics(),
      umbrella: new Graphics(),
      load: new Graphics(),
      marks: new Container(),
      ring: null,
      halo,
      x,
      y,
      tx: x,
      ty: y,
      dir: "down",
      walked: 0,
      moving: false,
      pose: null,
      lift: 0,
      onDeck: false,
      status: null,
      carrying: null,
      activity: "",
      scale: 1,
      phase: phaseOf(person.id),
      top: PIECE_R * 1.55,
      mid: PIECE_R * 0.55,
      radius: PIECE_R,
      outlined: false,
      haloDrawn: false,
      figure: null,
    };
    if (def === null) this.makeToken(base);
    else this.makeFigure(base, def);
    return base;
  }

  /** The marks over a head, drawn small and centred on the point over the head where they hang. */
  private makeMarks(piece: Piece, hang: number): void {
    const R = MARK_R;
    const { sleep, umbrella, load, marks } = piece;
    sleep.circle(R * 0.9, -R * 0.2, R * 0.62).fill({ color: 0xffffff, alpha: 0.94 }).stroke({ width: 1.2, color: PAL.sleep });
    sleep
      .moveTo(R * 0.62, -R * 0.42)
      .lineTo(R * 1.14, -R * 0.42)
      .lineTo(R * 0.62, 0.02 * R)
      .lineTo(R * 1.14, 0.02 * R)
      .stroke({ width: 1.7, color: PAL.sleep, cap: "round", join: "round" });
    sleep.visible = false;
    umbrella.moveTo(-R * 1.05, 0).arc(0, 0, R * 1.05, Math.PI, 0).closePath().fill(PAL.umbrella);
    umbrella.moveTo(-R * 0.35, 0).arc(0, 0, R * 1.05, Math.PI * 1.34, Math.PI * 1.66).lineTo(0, 0).closePath().fill({ color: 0xffffff, alpha: 0.22 });
    umbrella.moveTo(0, 0).lineTo(0, R * 0.9).stroke({ width: 1.8, color: PAL.roofLine });
    umbrella.moveTo(-R * 1.05, 0).lineTo(R * 1.05, 0).stroke({ width: 1.4, color: PAL.redDark });
    umbrella.visible = false;
    this.drawLoad(load, R, null);
    load.visible = false;
    marks.addChild(sleep, umbrella, load);
    marks.position.set(0, hang);
  }

  private drawLoad(g: Graphics, R: number, item: string | null): void {
    g.clear();
    g.roundRect(-R * 0.62, -R * 0.62, R * 1.24, R * 0.9, 2).fill(loadColour(item)).stroke({ width: 1, color: PAL.junkDark });
    g.moveTo(-R * 0.62, -R * 0.2).lineTo(R * 0.62, -R * 0.2).stroke({ width: 1.2, color: PAL.junkDark });
  }

  private makeFigure(piece: Piece, def: SpriteDef): void {
    const body = new Sprite();
    body.anchor.set(def.ax / def.w, def.ay / def.h);
    piece.body = body;
    piece.top = Math.max(16, def.ay - 6);
    piece.mid = piece.top * 0.5;
    piece.radius = Math.max(8, Math.min(def.w, def.h) * 0.2);
    piece.figure = new FigureBody(piece.id, piece.you ? PAL.gold : pieceColour(piece.id, piece.person.family), body, { x: def.ax, y: def.ay });
    this.makeMarks(piece, -piece.top - 4);
    // A person of one of the two families stands in a thin ring on the ground in the colour of the family.
    const rim = piece.you ? null : familyColour(piece.person.family);
    if (rim === null) {
      piece.node.addChild(piece.halo, body, piece.marks);
    } else {
      const ring = new Graphics().ellipse(0, 0, CELL * 0.36, CELL * 0.36 * DEPTH_RATIO).stroke({ width: 2, color: rim, alpha: 0.95 });
      piece.node.addChild(piece.halo, ring, body, piece.marks);
    }
    this.drawPose(piece, 0);
  }

  /** The plain piece: a disc with the surname on it, standing on a shadow. */
  private makeToken(piece: Piece): void {
    const { person, you } = piece;
    const colour = you ? PAL.gold : pieceColour(person.id, person.family);
    const dark = you ? 0x6b4a14 : mix(colour, 0x101820, 0.45);
    const upper = new Container();
    upper.position.set(0, -PIECE_R * 0.6);

    const shadow = new Graphics().ellipse(0, 0, PIECE_R * 0.92, PIECE_R * 0.34).fill({ color: PAL.shadow, alpha: 0.28 });
    const body = new Graphics()
      .circle(0, 0, PIECE_R)
      .fill(colour)
      .circle(0, 0, PIECE_R - 1)
      .stroke({ width: 2.4, color: dark, alignment: 1 })
      .ellipse(-PIECE_R * 0.28, -PIECE_R * 0.42, PIECE_R * 0.5, PIECE_R * 0.26)
      .fill({ color: 0xffffff, alpha: 0.2 });
    if (you) {
      // The manager wears a second ring of paper white inside the gold, and a small red lantern on a cord.
      body.circle(0, 0, PIECE_R - 4.2).stroke({ width: 1.6, color: PAL.paper, alpha: 0.9 });
      body.moveTo(PIECE_R * 0.62, -PIECE_R * 0.72).lineTo(PIECE_R * 0.9, -PIECE_R * 1.28).stroke({ width: 1.2, color: dark });
      body.roundRect(PIECE_R * 0.7, -PIECE_R * 1.74, PIECE_R * 0.52, PIECE_R * 0.62, 3).fill(PAL.red).stroke({ width: 1, color: PAL.redDark });
      body.moveTo(PIECE_R * 0.7, -PIECE_R * 1.43).lineTo(PIECE_R * 1.22, -PIECE_R * 1.43).stroke({ width: 0.9, color: PAL.redDark });
    }
    const token = new Text({
      text: person.token[this.lang],
      style: new TextStyle({
        fontFamily: FONT_STACK,
        fontSize: 16,
        fontWeight: "700",
        fill: you ? PAL.ink : PAL.paper,
        stroke: you ? { color: PAL.paper, width: 2, join: "round" } : { color: dark, width: 3, join: "round" },
      }),
      resolution: 3,
    });
    token.anchor.set(0.5, 0.52);
    piece.token = token;

    const ring = new Graphics().circle(0, 0, PIECE_R + 4).stroke({ width: 2.2, color: 0xffffff, alpha: 0.95 }).circle(0, 0, PIECE_R + 6.4).stroke({ width: 1.2, color: PAL.gold, alpha: 0.9 });
    ring.visible = false;
    piece.ring = ring;
    // The halo of the person who is being talked to: a soft gold glow with a ring outside it.
    piece.halo
      .circle(0, 0, PIECE_R + 11)
      .fill({ color: PAL.gold, alpha: 0.2 })
      .circle(0, 0, PIECE_R + 11)
      .stroke({ width: 2.6, color: PAL.gold, alpha: 0.95 })
      .circle(0, 0, PIECE_R + 15.5)
      .stroke({ width: 1.2, color: 0xffffff, alpha: 0.75 });
    piece.haloDrawn = true;

    // The marks hang on the piece itself: asleep to its upper right, an umbrella over it, a load at its side.
    this.makeMarks(piece, 0);
    piece.sleep.position.set(0, -PIECE_R * 0.6);
    piece.umbrella.position.set(0, -PIECE_R * 1.18);
    piece.load.position.set(PIECE_R * 0.95, 0);
    upper.addChild(piece.halo, ring, body, token, piece.marks);
    piece.node.addChild(shadow, upper);
  }

  private aim(piece: Piece, entry: FramePerson): void {
    piece.tx = (entry.x + 0.5) * CELL;
    piece.ty = (entry.y + 0.5) * CELL_DEPTH;
    piece.activity = entry.activity;
    if (piece.status !== entry.status || piece.carrying !== entry.carrying) {
      piece.status = entry.status;
      piece.carrying = entry.carrying;
      piece.sleep.visible = entry.status === "sleep";
      piece.umbrella.visible = entry.status === "umbrella";
      // A person who carries something has the load over the head, as the core says it (`status: "load"` goes with `carrying`). 李大 has the
      // bamboo on his shoulder as well, which is the figure's, and the icon is the one every other person who carries something has.
      const loaded = entry.status === "load" || entry.carrying !== null;
      piece.load.visible = loaded;
      if (loaded) this.drawLoad(piece.load, MARK_R, entry.carrying);
      piece.node.alpha = entry.status === "sleep" ? 0.82 : 1;
    }
  }

  // --- Moving them --------------------------------------------------------------------------

  /**
   * Moves every piece a little way towards its cell, turns it the way it goes, picks its frame, and
   * sizes it for the zoom. Tells how much is going on: lively while a piece is still on its way, a
   * pulse while a ring or a halo breathes.
   */
  tick(dt: number, zoom: number, seconds: number, minRadius = MIN_SCREEN_R): Motion {
    const glide = this.calm ? 1 : 1 - Math.exp(-dt / GLIDE);
    const tokenScale = clamp(minRadius / (PIECE_R * zoom), 1, 5);
    const markScale = clamp(0.85 / zoom, 0.55, 2);
    let motion: Motion = STILL;
    this.drawn.length = 0;
    for (const piece of this.all()) {
      const ax = piece.tx - piece.x;
      const ay = piece.ty - piece.y;
      const away = Math.hypot(ax, ay) > ARRIVED;
      // A person who has less than a pixel and a half to go has arrived, and stands. A player who asked for less motion sees no steps, but the figure still turns.
      piece.moving = away && !this.calm;
      if (away) piece.dir = chooseDir(ax, ay, piece.dir);
      const nx = Math.abs(ax) < SNAP ? piece.tx : piece.x + ax * glide;
      const ny = Math.abs(ay) < SNAP ? piece.ty : piece.y + ay * glide;
      piece.walked += Math.hypot(nx - piece.x, ny - piece.y);
      piece.x = nx;
      piece.y = ny;
      if (piece.x !== piece.tx || piece.y !== piece.ty) motion = LIVELY;
      piece.lift = this.liftOf(piece);
      piece.onDeck = this.onDeck(piece);

      const partner = this.partnerOf(piece);
      if (partner !== null && !piece.moving) piece.dir = chooseDir(partner.x - piece.x, partner.y - piece.y, piece.dir);

      piece.node.position.set(piece.x, piece.y - piece.lift);
      // The player's figure is drawn over the others standing on the same line. A walker on the bridge is drawn after the bridge.
      piece.node.zIndex = this.sortOf(piece) + (piece.you ? 0.5 : 0);

      if (piece.def === null) {
        piece.scale = piece.you ? tokenScale * 1.14 : tokenScale;
        piece.node.scale.set(piece.scale);
        this.markToken(piece, seconds);
        if (piece.id === this.selected && !this.calm && motion < PULSE) motion = PULSE;
      } else {
        piece.scale = 1;
        piece.marks.scale.set(markScale);
        this.drawPose(piece, seconds);
        if (!this.away) this.follow(piece);
        const marked = piece.id === this.selected || piece.id === this.hover;
        this.outlineFigure(piece, marked);
      }
      const talked = piece.id === this.talking;
      piece.halo.visible = talked;
      if (talked) {
        const breath = this.calm ? 0.9 : 0.78 + 0.22 * Math.sin(seconds * 2.4);
        piece.halo.alpha = breath;
        if (piece.def !== null) this.drawGroundHalo(piece);
        if (!this.calm && motion < PULSE) motion = PULSE;
      }
    }
    this.drawLink(seconds);
    return motion;
  }

  /** Brings what the silhouettes look at for a figure to where it is now, and takes the figure into the list of them. */
  private follow(piece: Piece): void {
    const figure = piece.figure;
    const def = piece.def;
    if (figure === null || def === null) return;
    figure.sort = piece.node.zIndex;
    figure.x = piece.x;
    figure.y = piece.y - piece.lift;
    const index = piece.pose?.index ?? -1;
    if (index !== figure.frame || figure.pixels === null) {
      figure.frame = index;
      figure.pixels = this.sheet === null || index < 0 ? null : this.sheet.box(def, index);
      figure.tight = figure.pixels === null ? null : tightOf(def, index, figure.pixels);
    }
    // The box of the body: the frame, until the pixels are at hand to say where the body is in it.
    const tight = figure.tight;
    figure.box.x0 = figure.x - def.ax + (tight?.u0 ?? 0);
    figure.box.y0 = figure.y - def.ay + (tight?.v0 ?? 0);
    figure.box.x1 = figure.x - def.ax + (tight?.u1 ?? def.w);
    figure.box.y1 = figure.y - def.ay + (tight?.v1 ?? def.h);
    this.drawn.push(figure);
  }

  /** The figures that were drawn at the last tick, the player's among them. They can be hidden by what stands in front of them. */
  get bodies(): readonly Figure[] {
    return this.drawn;
  }

  /** The ring of a piece that is picked or under the pointer. */
  private markToken(piece: Piece, seconds: number): void {
    const marked = piece.id === this.selected || piece.id === this.hover;
    if (piece.ring === null) return;
    piece.ring.visible = marked;
    if (marked) piece.ring.alpha = piece.id === this.selected && !this.calm ? 0.8 + 0.2 * Math.sin(seconds * 4) : 0.7;
  }

  /** The outline on a figure: a filter, put on while it is marked and taken off after. */
  private outlineFigure(piece: Piece, marked: boolean): void {
    if (piece.body === null || marked === piece.outlined) return;
    piece.outlined = marked;
    piece.body.filters = marked && this.outline !== null ? [this.outline] : null;
  }

  private drawGroundHalo(piece: Piece): void {
    if (piece.haloDrawn) return;
    piece.haloDrawn = true;
    const r = CELL * 0.62;
    piece.halo
      .ellipse(0, 0, r, r * DEPTH_RATIO)
      .fill({ color: PAL.gold, alpha: 0.25 })
      .ellipse(0, 0, r, r * DEPTH_RATIO)
      .stroke({ width: 2.4, color: PAL.gold, alpha: 0.95 })
      .ellipse(0, 0, r + 4.5, (r + 4.5) * DEPTH_RATIO)
      .stroke({ width: 1.2, color: 0xffffff, alpha: 0.75 });
  }

  /** The pose of a figure at this moment, and its texture. */
  private drawPose(piece: Piece, seconds: number): void {
    const def = piece.def;
    const sheet = this.sheet;
    if (def === null || sheet === null || piece.body === null) return;
    const partner = this.partnerOf(piece);
    const pose = poseOf(def, {
      moving: piece.moving,
      talking: partner !== null && !piece.moving,
      carrying: piece.carrying,
      dir: piece.dir,
      walked: piece.walked,
      seconds,
      phase: piece.phase,
      reduced: this.calm,
    });
    if (pose === null) return;
    if (piece.pose !== null && piece.pose.index === pose.index) {
      piece.pose = pose;
      return;
    }
    piece.pose = pose;
    const texture = sheet.texture(def, pose.index);
    if (texture !== null) piece.body.texture = texture;
  }

  /** The person this one faces: the player and the person they talk to face each other. */
  private partnerOf(piece: Piece): Piece | null {
    if (this.talking === null || this.you === null) return null;
    if (piece.you) return this.pieces.get(this.talking) ?? null;
    return piece.id === this.talking ? this.you : null;
  }

  /** Whether a figure stands on the deck of the bridge. */
  private onDeck(piece: Piece): boolean {
    const deck = this.deck;
    if (deck === null || piece.def === null) return false;
    const gx = piece.x / CELL;
    const gy = piece.y / CELL_DEPTH;
    return gy >= deck.top && gy <= deck.top + deck.rows && gx >= deck.left && gx <= deck.left + deck.cols;
  }

  /** How far a walker on the deck of the bridge is lifted over the ground, in pixels. */
  private liftOf(piece: Piece): number {
    const deck = this.deck;
    return deck === null || !this.onDeck(piece) ? 0 : deckLift(deck.lifts, deck.cols, piece.x / CELL - deck.left);
  }

  /** The order a person is drawn in: by the ground they stand on, and after the bridge when they are on its deck. */
  private sortOf(piece: Piece): number {
    const deck = this.deck;
    if (deck !== null && piece.onDeck) return deck.sort + 0.25 + (piece.y / CELL_DEPTH - deck.top) * 0.01;
    return piece.y;
  }

  /** A dotted thread from the player to the person they are talking to. */
  private drawLink(seconds: number): void {
    const link = this.link;
    if (!this.linked && this.talking === null) return;
    link.clear();
    this.linked = false;
    const partner = this.talking === null ? undefined : this.pieces.get(this.talking);
    if (this.you === null || partner === undefined) return;
    const a = { x: this.you.x, y: this.you.y - this.you.lift - this.you.mid };
    const b = { x: partner.x, y: partner.y - partner.lift - partner.mid };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length < PIECE_R * 2.4) return;
    const steps = Math.max(2, Math.floor(length / 9));
    const shift = this.calm ? 0 : (seconds * 0.8) % 1;
    for (let i = 0; i < steps; i++) {
      const t = (i + shift) / steps;
      if (t > 0.97) continue;
      link.circle(a.x + dx * t, a.y + dy * t, 1.9).fill({ color: PAL.gold, alpha: 0.9 });
    }
    this.linked = true;
  }

  // --- Asking about them --------------------------------------------------------------------

  /** Where a person is on the map now. For the speech bubbles, the rumours and the name tag. */
  positionOf(id: string): Where | null {
    const piece = id === PLAYER_ID ? this.you : this.pieces.get(id);
    if (piece === undefined || piece === null) return null;
    return { x: piece.x, y: piece.y, radius: piece.radius * piece.scale, top: piece.top * piece.scale + piece.lift, mid: piece.mid * piece.scale + piece.lift };
  }

  /** The people of the cast (not the player) with where the top of their head is in the world, for the tags over their heads. */
  heads(): Array<{ id: string; person: Person; x: number; y: number }> {
    const out: Array<{ id: string; person: Person; x: number; y: number }> = [];
    for (const piece of this.pieces.values()) {
      const at = this.positionOf(piece.id);
      if (at !== null) out.push({ id: piece.id, person: piece.person, x: at.x, y: at.y - at.top });
    }
    return out;
  }

  /** The cell the player's piece is heading for, or null before the first frame. */
  get playerCell(): { x: number; y: number } | null {
    return this.you === null ? null : { x: Math.floor(this.you.tx / CELL), y: Math.floor(this.you.ty / CELL_DEPTH) };
  }

  /** The people (and the player) who are picked or under the pointer, with what the name tag needs. */
  marked(): Array<{ id: string; person: Person; you: boolean; x: number; y: number; picked: boolean }> {
    const out: Array<{ id: string; person: Person; you: boolean; x: number; y: number; picked: boolean }> = [];
    for (const piece of this.all()) {
      const picked = piece.id === this.selected;
      if (!picked && piece.id !== this.hover) continue;
      out.push({ id: piece.id, person: piece.person, you: piece.you, x: piece.x, y: piece.y - piece.lift, picked });
    }
    return out;
  }

  /** What each person is drawn as, for the tests: the sprite, the animation, the direction and the frame. */
  describe(): Array<{ id: string; sprite: string | null; anim: string | null; dir: Dir; frame: number; index: number; moving: boolean; lift: number; outlined: boolean; mid: number; top: number; marks: string[]; alpha: number; x: number; y: number; walked: number }> {
    return this.all().map((piece) => ({
      id: piece.id,
      sprite: piece.def?.id ?? null,
      anim: piece.pose?.anim ?? null,
      dir: piece.dir,
      frame: piece.pose?.frame ?? 0,
      index: piece.pose?.index ?? -1,
      moving: piece.moving,
      lift: piece.lift,
      outlined: piece.outlined || (piece.ring?.visible ?? false),
      mid: piece.mid,
      top: piece.top,
      marks: [piece.sleep.visible ? "sleep" : "", piece.umbrella.visible ? "umbrella" : "", piece.load.visible ? "load" : ""].filter((m) => m !== ""),
      alpha: piece.node.alpha,
      x: piece.x,
      y: piece.y,
      walked: piece.walked,
    }));
  }

  /** How many of the people are drawn as figures. */
  get figures(): number {
    return this.all().filter((piece) => piece.def !== null).length;
  }

  /**
   * The people as things the pointer can be over, each with its place in the order of drawing. A
   * person is under the pointer on their body (the pixels of the sprite), and on the ground
   * where they stand, a little more than the feet, so that a small figure is not a hard target.
   */
  pickables(): Pickable[] {
    return this.all().map((piece) => ({
      kind: "person" as const,
      id: piece.id,
      sort: piece.node.zIndex,
      covers: (wx: number, wy: number, slack: number): boolean => this.covers(piece, wx, wy, slack),
    }));
  }

  private covers(piece: Piece, wx: number, wy: number, slack: number): boolean {
    const fx = piece.x;
    const fy = piece.y - piece.lift;
    if (piece.def === null) {
      // A piece is a disc over its shadow.
      const reach = PIECE_R * piece.scale + slack;
      return Math.hypot(wx - fx, wy - (fy - PIECE_R * 0.6 * piece.scale)) <= reach || Math.hypot(wx - fx, (wy - fy) / DEPTH_RATIO) <= PIECE_R * piece.scale * 0.9 + slack;
    }
    const rx = CELL * 0.42 + slack;
    const ry = CELL_DEPTH * 0.42 + slack;
    if (((wx - fx) / rx) ** 2 + ((wy - fy) / ry) ** 2 <= 1) return true;
    const sheet = this.sheet;
    const pose = piece.pose;
    if (sheet === null || pose === null) return false;
    const box = sheet.box(piece.def, pose.index);
    if (box !== null) return alphaAtWorld(box, { x: piece.def.ax, y: piece.def.ay }, { x: fx, y: fy }, 1, wx, wy) >= SOLID;
    // Before the pixels are at hand, the body is the ellipse that it mostly fills.
    return ((wx - fx) / (piece.radius + slack)) ** 2 + ((wy - (fy - piece.mid)) / (piece.mid + slack)) ** 2 <= 1;
  }
}
