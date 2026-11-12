/**
 * The riddle lantern at the door of the lantern workshop: a lantern of paper hung from the arm of a short post, with a strip of paper under it that has
 * writing on it. It is drawn once on a 2D canvas, unlit and lit, like the lanterns of the festival night (`festival/art.ts`), and stands among the people
 * of the map, in the order of the ground it stands on. By night it is lit and gives a soft light, and it burns brighter for each riddle that was guessed right.
 * It is picked by a click like a person is, and what a click on it means is for the page to say (`MapEvents.riddle`).
 */
import { Container, Sprite, Texture } from "pixi.js";
import type { Scene } from "../scene.ts";
import { CELL, CELL_DEPTH, type Motion, SLOW, STILL } from "./geometry.ts";
import { PAL } from "./palette.ts";
import { clamp, type RiddleLook, lookOf, STEPS } from "./riddle-look.ts";

/** The art is drawn at twice the size it is shown at, so that it stays sharp on a screen of two pixels to a pixel. */
const ART_SCALE = 2;
/** How big it is shown against the size it is drawn at, 1 being the size of the lanterns at the doors. */
const SIZE = 1.25;
/** The size of the picture as shown, and where the foot of the post is in it. */
const WIDTH = 44;
const HEIGHT = 76;
const FOOT = { x: 18, y: 73 };
/** The middle of the paper of the lantern, from the foot of the post, as drawn. */
const BODY = { x: 14, y: -45 };
/** The box of the lantern with its strip, from the foot of the post, as drawn: what a click on the lantern is on. */
const HIT = { x0: 2, y0: -62, x1: 25, y1: -12 };
/** How many cells east of the middle of the door the post stands, and how far south of the south edge of the building. */
const EAST_CELLS = 2.3;
const SOUTH_PX = 9;

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (context === null) throw new Error("no 2D canvas");
  return [element, context];
}

const css = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;

/** A few strokes of the brush that read as a character at this size: not a real one, only writing. `k` changes the strokes from one character to the next. */
function scribble(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, k: number): void {
  const j = (n: number): number => ((Math.sin(k * 12.9898 + n * 78.233) * 43758.5453) % 1) * 0.5;
  c.beginPath();
  c.moveTo(x - w / 2, y - h * 0.22 + j(1));
  c.lineTo(x + w / 2, y - h * 0.22 + j(2));
  c.moveTo(x + j(3), y - h / 2);
  c.lineTo(x + j(4) * 0.6, y + h / 2);
  c.moveTo(x - w * 0.4, y + h * 0.24 + j(5));
  c.lineTo(x + w * 0.4, y + h * 0.24 + j(6));
  c.moveTo(x + w * 0.22, y + h * 0.4);
  c.lineTo(x + w * 0.4, y + h * 0.5 + j(7));
  c.stroke();
}

/** The picture of the lantern: the post, the arm, the lantern, the strip of paper with its writing, and a tassel. Lit, the paper shines from within. */
function paint(lit: boolean): Texture {
  const [element, c] = canvas(WIDTH * ART_SCALE, HEIGHT * ART_SCALE);
  c.scale(ART_SCALE, ART_SCALE);
  const hangX = FOOT.x + BODY.x;
  // the shadow, a foot of stone and the post with its arm
  c.fillStyle = "rgba(20,30,40,0.3)";
  c.beginPath();
  c.ellipse(FOOT.x, FOOT.y - 1, 8.5, 2.5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#8a959a";
  c.fillRect(FOOT.x - 5, FOOT.y - 5, 10, 5);
  c.fillStyle = "#6f7a80";
  c.fillRect(FOOT.x - 5, FOOT.y - 2, 10, 2);
  c.fillStyle = css(PAL.trunk);
  c.fillRect(FOOT.x - 1.8, 11, 3.6, FOOT.y - 16);
  c.fillStyle = "#4e3a2c";
  c.fillRect(FOOT.x + 0.4, 11, 1.4, FOOT.y - 16);
  c.fillStyle = css(PAL.trunk);
  c.fillRect(FOOT.x - 3, 9, hangX - FOOT.x + 8, 3.2);
  c.fillStyle = css(PAL.gold);
  c.fillRect(hangX - 1, 12, 2, 4.5);
  // the lantern: paper over ribs, with a cap and a base of gold, and writing down the middle of it
  const rx = 9.5;
  const ry = 11;
  const cy = FOOT.y + BODY.y;
  const middle = lit ? "#ffe9a0" : "#d7c48d";
  const edge = lit ? "#d98a2b" : "#8b6b33";
  const gradient = c.createRadialGradient(hangX - rx * 0.15, cy - ry * 0.2, 1, hangX, cy, Math.max(rx, ry));
  gradient.addColorStop(0, middle);
  gradient.addColorStop(1, edge);
  c.fillStyle = gradient;
  c.beginPath();
  c.ellipse(hangX, cy, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = lit ? "#9a6b1c" : "#5e4a26";
  c.globalAlpha = 0.55;
  c.lineWidth = 0.8;
  for (const k of [-0.5, 0, 0.5]) {
    c.beginPath();
    c.ellipse(hangX, cy, rx * Math.abs(1 - Math.abs(k) * 0.9), ry, 0, Math.PI * 0.5, Math.PI * 1.5, k < 0);
    c.stroke();
  }
  c.globalAlpha = 1;
  c.lineWidth = 1.1;
  c.beginPath();
  c.ellipse(hangX, cy, rx, ry, 0, 0, Math.PI * 2);
  c.stroke();
  if (lit) {
    const flame = c.createRadialGradient(hangX, cy + 1, 0, hangX, cy + 1, 7.5);
    flame.addColorStop(0, "rgba(255,246,200,0.6)");
    flame.addColorStop(1, "rgba(255,230,150,0)");
    c.fillStyle = flame;
    c.beginPath();
    c.ellipse(hangX, cy + 1, 7.5, 9, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = css(PAL.gold);
  c.fillRect(hangX - 6, cy - ry - 2.2, 12, 2.6);
  c.fillRect(hangX - 5, cy + ry - 0.4, 10, 2.2);
  c.strokeStyle = css(PAL.ink);
  c.globalAlpha = 0.78;
  c.lineWidth = 0.9;
  c.lineCap = "round";
  scribble(c, hangX, cy - 4.2, 5.4, 6.2, 1);
  scribble(c, hangX, cy + 4.6, 5.4, 6.2, 2);
  c.globalAlpha = 1;
  // the strip of paper that the riddle is written on, with a cord and a red tassel
  const top = cy + ry + 2.6;
  c.strokeStyle = css(PAL.roofLine);
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(hangX, cy + ry + 1.4);
  c.lineTo(hangX, top);
  c.stroke();
  c.fillStyle = css(PAL.paper);
  c.fillRect(hangX - 4, top, 8, 17);
  c.strokeStyle = css(PAL.ink);
  c.globalAlpha = 0.5;
  c.lineWidth = 0.7;
  c.strokeRect(hangX - 4, top, 8, 17);
  c.globalAlpha = 0.8;
  c.lineWidth = 0.8;
  for (const [i, k] of [3, 4, 5].entries()) scribble(c, hangX, top + 3.2 + i * 5.1, 3.8, 3.9, k);
  c.globalAlpha = 1;
  c.strokeStyle = css(PAL.red);
  c.lineWidth = 1.4;
  c.beginPath();
  c.moveTo(hangX, top + 17);
  c.lineTo(hangX, top + 21);
  c.stroke();
  c.fillStyle = css(PAL.red);
  c.beginPath();
  c.ellipse(hangX, top + 22.6, 1.7, 2.6, 0, 0, Math.PI * 2);
  c.fill();
  return Texture.from(element);
}

export class RiddleLantern {
  private node: Container | null = null;
  private body: Sprite | null = null;
  private glow: Sprite | null = null;
  private unlit: Texture | null = null;
  private litTexture: Texture | null = null;
  private x = 0;
  private y = 0;
  private level = 0;
  private tint = 0xffffff;
  private look: RiddleLook = lookOf(0, 0);

  /** Whether the lantern is there: the town has a lantern workshop with a door. */
  get present(): boolean {
    return this.node !== null;
  }

  /** How many riddles were guessed right, as the lantern was last told. */
  get brightness(): number {
    return this.level;
  }

  /** Whether the lantern is drawn lit now, and how strong its light is. */
  get lighting(): RiddleLook {
    return this.look;
  }

  /** Hangs the lantern at the door of the workshop of the scene, among the figures of `actors` and with its light in `glows`. A town that has no workshop has no lantern. */
  build(scene: Scene, actors: Container, glows: Container, halo: Texture): void {
    this.clear();
    const door = scene.plain ? null : (scene.places.find((p) => p.kind === "workshop")?.door ?? null);
    if (door === null) return;
    this.x = (door[0] + 0.5 + EAST_CELLS) * CELL;
    this.y = door[1] * CELL_DEPTH + SOUTH_PX;
    this.unlit = paint(false);
    this.litTexture = paint(true);
    const node = new Container();
    node.position.set(this.x, this.y);
    node.zIndex = this.y;
    const body = new Sprite(this.unlit);
    body.anchor.set(FOOT.x / WIDTH, FOOT.y / HEIGHT);
    body.scale.set(SIZE / ART_SCALE);
    node.addChild(body);
    actors.addChild(node);
    const glow = new Sprite(halo);
    glow.anchor.set(0.5);
    glow.blendMode = "add";
    glow.tint = PAL.glowWarm;
    glow.position.set(this.x + BODY.x * SIZE, this.y + BODY.y * SIZE);
    glow.visible = false;
    glows.addChild(glow);
    this.node = node;
    this.body = body;
    this.glow = glow;
    this.apply(0);
  }

  clear(): void {
    this.node?.destroy({ children: true });
    this.glow?.destroy();
    this.unlit?.destroy(true);
    this.litTexture?.destroy(true);
    this.node = null;
    this.body = null;
    this.glow = null;
    this.unlit = null;
    this.litTexture = null;
  }

  destroy(): void {
    this.clear();
  }

  /** Tells the lantern how many riddles were guessed right. */
  setLevel(level: number): void {
    this.level = clamp(Math.trunc(level), 0, STEPS);
  }

  /** The colour that the lantern is multiplied by while it is unlit: the tint of the ground. */
  setTint(tint: number): void {
    this.tint = tint;
    if (this.body !== null && !this.look.lit) this.body.tint = tint;
  }

  private apply(light: number): void {
    const look = lookOf(light, this.level);
    this.look = look;
    if (this.body === null || this.glow === null) return;
    this.body.texture = look.lit ? (this.litTexture ?? this.body.texture) : (this.unlit ?? this.body.texture);
    this.body.tint = look.lit ? 0xffffff : this.tint;
    this.glow.visible = look.lit;
    this.glow.width = CELL * 2.2 * look.size;
    this.glow.height = CELL * 2.2 * look.size;
  }

  /** Lights the lantern at the strength of the hour, and lets its light breathe a little unless the player asked for less motion (`calm`). */
  update(light: number, seconds: number, calm = false): Motion {
    this.apply(light);
    if (this.glow === null || !this.look.lit) return STILL;
    this.glow.alpha = this.look.glow * (calm ? 0.92 : 0.9 + 0.08 * Math.sin(seconds * 2.7 + 1.3));
    return calm ? STILL : SLOW;
  }

  /** The middle of the paper of the lantern in the world, or null where there is no lantern. */
  middle(): { x: number; y: number } | null {
    return this.node === null ? null : { x: this.x + BODY.x * SIZE, y: this.y + BODY.y * SIZE };
  }

  /** Whether a point of the world, with `slack` pixels to spare, is on the lantern and its strip. */
  hits(wx: number, wy: number, slack: number): boolean {
    if (this.node === null) return false;
    return wx >= this.x + HIT.x0 * SIZE - slack && wx <= this.x + HIT.x1 * SIZE + slack && wy >= this.y + HIT.y0 * SIZE - slack && wy <= this.y + HIT.y1 * SIZE + slack;
  }
}
