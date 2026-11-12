/**
 * What is drawn in screen pixels over the map and does not grow with the zoom: the names of the
 * places, the lines people say, and the marker over people who talk too far off to be heard. All of
 * it follows the world positions through the camera.
 */
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { type Lang, pick } from "../../i18n/index.ts";
import type { Bubble } from "../frame.ts";
import type { Scene } from "../scene.ts";
import type { Camera } from "./camera.ts";
import { type Box, slideClear } from "./clear.ts";
import { CELL, CELL_DEPTH, clamp } from "./geometry.ts";
import { LABEL_FONT, onLabelFont, TAG, writeAgain } from "./fonts.ts";
import { PAL } from "./palette.ts";
import { wrapChinese } from "./wrap.ts";
import { FONT_STACK, type People } from "./people.ts";

const overlaps = (a: Box, b: Box, gap = 3): boolean =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

const PRIORITY: Record<string, number> = {
  bridge: 10,
  teahouse: 10,
  hall: 9,
  temple: 9,
  workshop: 8,
  market: 8,
  tavern: 8,
  ferry: 8,
  school: 7,
  post: 6,
  house: 5,
  bank: 4,
  lane: 4,
  water: 1,
};

interface Label {
  id: string;
  kind: string;
  node: Container;
  plate: Graphics;
  text: Text;
  /** The world point the label hangs from, and whether it sits above it or on it. */
  x: number;
  y: number;
  above: boolean;
  box: Box;
  priority: number;
}

export type PlateStyle = "day" | "night";

/** The names of the places, as straight tags of paper with a line of ink round them, that keep their size when the map is zoomed. */
export class PlaceLabels {
  readonly layer = new Container();
  /** Changes when the tags are written again (the face of the page arrived), so that the map lays them out again. */
  version = 0;
  private labels: Label[] = [];
  private watching = false;
  private style: PlateStyle = "day";
  private lang: Lang = "en";
  private scene: Scene | null = null;

  /**
   * `spriteTop` says how high the sprite of a place reaches, as a point of the world, for the
   * places that have one: the plate then hangs above the roof and not on it.
   */
  build(scene: Scene, lang: Lang, spriteTop: (place: string) => number | null = () => null): void {
    this.layer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.labels = [];
    this.scene = scene;
    this.lang = lang;
    for (const place of scene.places) {
      if (place.kind === "water") continue;
      const own = scene.buildings.filter((b) => b.place === place.id);
      let x: number;
      let y: number;
      let above = true;
      if (own.length > 0) {
        const left = Math.min(...own.map((b) => b.x));
        const right = Math.max(...own.map((b) => b.x + b.w));
        const top = Math.min(...own.map((b) => b.y));
        x = ((left + right) / 2) * CELL;
        y = top * CELL_DEPTH - 0.18 * CELL_DEPTH;
      } else if (place.cells.length > 0) {
        // A lane is its own cells, and its rectangle may hold a building as well.
        x = (place.cells.reduce((sum, c) => sum + c[0], 0) / place.cells.length + 0.5) * CELL;
        y = (place.cells.reduce((sum, c) => sum + c[1], 0) / place.cells.length + 0.5) * CELL_DEPTH;
        above = false;
      } else {
        x = (place.rect.x + place.rect.w / 2) * CELL;
        y = (place.rect.y + place.rect.h / 2) * CELL_DEPTH;
        above = false;
      }
      const roof = spriteTop(place.id);
      if (roof !== null) {
        y = Math.min(y, roof - 3);
        above = true;
      }
      const text = new Text({
        text: pick(place.name, lang),
        style: new TextStyle({ fontFamily: LABEL_FONT, fontSize: 13, fontWeight: "500", fill: TAG.ink }),
        resolution: 2.5,
      });
      text.anchor.set(0.5);
      const node = new Container();
      const plate = new Graphics();
      node.addChild(plate, text);
      this.layer.addChild(node);
      this.labels.push({
        id: place.id,
        kind: place.kind,
        node,
        plate,
        text,
        x,
        y,
        above,
        box: { x: 0, y: 0, w: 0, h: 0 },
        priority: PRIORITY[place.kind] ?? 3,
      });
      this.redraw(this.labels[this.labels.length - 1] as Label);
    }
    this.labels.sort((a, b) => b.priority - a.priority);
    if (!this.watching) {
      this.watching = true;
      onLabelFont(() => this.writeAgain());
    }
  }

  /** The face of the page arrived after the names were drawn: draws them again. */
  private writeAgain(): void {
    if (this.layer.destroyed) return;
    for (const label of this.labels) {
      writeAgain(label.text);
      this.redraw(label);
    }
    this.version++;
  }

  get count(): number {
    return this.labels.length;
  }

  /** The boxes of the names that are showing, in the pixels of the screen: the tags over the heads keep off them. */
  boxes(): Box[] {
    const out: Box[] = [];
    for (const label of this.labels) {
      if (!label.node.visible) continue;
      out.push({ x: label.node.x - label.box.w / 2, y: label.node.y - label.box.h / 2, w: label.box.w, h: label.box.h });
    }
    return out;
  }

  visibleIds(): string[] {
    return this.labels.filter((l) => l.node.visible).map((l) => l.id);
  }

  /** Fades the plates that would cover a piece at a screen point, so that the piece can be seen. */
  dodge(sx: number | null, sy: number, radius: number): void {
    for (const label of this.labels) {
      const near =
        sx !== null && label.node.visible && Math.abs(sx - label.node.x) < label.box.w / 2 + radius && Math.abs(sy - label.node.y) < label.box.h / 2 + radius;
      label.node.alpha = near ? 0.2 : 1;
    }
  }

  /** The place whose plate is under a point of the map's own element, if one is showing there. */
  hit(sx: number, sy: number): string | null {
    for (const label of this.labels) {
      if (!label.node.visible) continue;
      if (Math.abs(sx - label.node.x) <= label.box.w / 2 && Math.abs(sy - label.node.y) <= label.box.h / 2) return label.id;
    }
    return null;
  }

  /** The words on the plates, by place id, whether the plate is showing or is left out for the room it would need (the language is read from them). */
  texts(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const label of this.labels) out[label.id] = label.text.text;
    return out;
  }

  setLang(lang: Lang): void {
    if (this.scene === null || lang === this.lang) return;
    this.lang = lang;
    for (const label of this.labels) {
      const place = this.scene.places.find((p) => p.id === label.id);
      if (place !== undefined) label.text.text = pick(place.name, lang);
      this.redraw(label);
    }
  }

  setStyle(style: PlateStyle): void {
    if (style === this.style) return;
    this.style = style;
    for (const label of this.labels) this.redraw(label);
  }

  private redraw(label: Label): void {
    const night = this.style === "night";
    label.text.style.fill = TAG.ink;
    const w = Math.ceil(label.text.width + 16);
    const h = Math.ceil(label.text.height + 6);
    label.plate.clear();
    // Paper with square corners and a line of ink a little inside the edge. Under a lamp the paper is the colour of lamplit paper and the line is the grey.
    label.plate.rect(-w / 2, -h / 2, w, h).fill({ color: night ? TAG.paperNight : TAG.paperDay, alpha: 0.96 });
    label.plate.rect(-w / 2 + 1.5, -h / 2 + 1.5, w - 3, h - 3).stroke({ width: 1.2, color: night ? TAG.lineNight : TAG.ink, alpha: night ? 0.95 : 0.85 });
    label.box = { x: 0, y: 0, w, h };
  }

  /**
   * Puts each label where its place is on the screen, and hides the ones that would overlap a more important one. `avoid` are the boxes of the page
   * that lie over the map: a label that one of them would cover slides along its line to the edge of the box, or is hidden when its place is under it.
   */
  layout(camera: Camera, viewW: number, viewH: number, avoid: readonly Box[] = []): void {
    const placed: Box[] = [];
    for (const label of this.labels) {
      const p = camera.project(label.x, label.y);
      const w = label.box.w;
      const h = label.box.h;
      const cy = label.above ? p.y - h / 2 - 2 : p.y;
      // A label whose place is in view but near the edge stays on the screen. One whose place is out of view is hidden.
      const inside = p.x > -w / 4 && p.x < viewW + w / 4 && cy + h / 2 > 0 && cy - h / 2 < viewH;
      const left = clamp(p.x - w / 2, 4, Math.max(4, viewW - w - 4));
      const at = inside ? slideClear({ x: left, y: cy - h / 2, w, h }, p.x, avoid, viewW) : null;
      if (at === null || placed.some((other) => overlaps(at, other))) {
        label.node.visible = false;
        continue;
      }
      label.node.visible = true;
      label.node.position.set(Math.round(at.x + w / 2), Math.round(cy));
      placed.push(at);
    }
  }
}

interface BubbleSprite {
  node: Container;
  bg: Graphics;
  text: Text;
  key: string;
  /** The line as the game wrote it, before it was broken into lines for the bubble. */
  said: string;
  w: number;
  h: number;
}

const MAX_BUBBLES = 5;
const BUBBLE_WRAP = 190;

let ruler: CanvasRenderingContext2D | null = null;
const widths = new Map<string, number>();

/** The width of one character in the font of the bubbles, in pixels. */
function widthOf(char: string): number {
  const known = widths.get(char);
  if (known !== undefined) return known;
  if (ruler === null) {
    ruler = document.createElement("canvas").getContext("2d");
    if (ruler !== null) ruler.font = `12.5px ${FONT_STACK}`;
  }
  const width = ruler === null ? 12.5 : ruler.measureText(char).width;
  widths.set(char, width);
  return width;
}


/** Speech bubbles: the lines that people are saying now, over their heads. */
export class Bubbles {
  readonly layer = new Container();
  private readonly pool: BubbleSprite[] = [];
  private active = 0;
  private placed: Box[] = [];

  /** The boxes the bubbles of the last update stand in, on the screen, for a layer of bubbles drawn after this one to keep clear of. */
  get boxes(): readonly Box[] {
    return this.placed;
  }

  get shown(): number {
    return this.active;
  }

  /** The lines that are showing, from the lowest on the screen up. */
  texts(): string[] {
    return this.pool.slice(0, this.active).filter((b) => b.node.visible).map((b) => b.said);
  }

  private make(): BubbleSprite {
    const node = new Container();
    const bg = new Graphics();
    const text = new Text({
      text: "",
      style: new TextStyle({
        fontFamily: FONT_STACK,
        fontSize: 12.5,
        fill: PAL.ink,
        wordWrap: true,
        wordWrapWidth: BUBBLE_WRAP,
        breakWords: true,
        lineHeight: 17,
      }),
      resolution: 2.5,
    });
    text.position.set(9, 6);
    node.addChild(bg, text);
    this.layer.addChild(node);
    const sprite = { node, bg, text, key: "", said: "", w: 0, h: 0 };
    this.pool.push(sprite);
    return sprite;
  }

  update(bubbles: readonly Bubble[], tick: number, lang: Lang, people: People, camera: Camera, viewW: number, viewH: number, avoid: readonly Box[] = []): void {
    const live: Array<{ bubble: Bubble; sx: number; sy: number; fade: number }> = [];
    for (const bubble of bubbles) {
      if (tick >= bubble.until) continue;
      const at = people.positionOf(bubble.npc);
      if (at === null) continue;
      const p = camera.project(at.x, at.y);
      const fade = Number.isFinite(bubble.until) ? clamp((bubble.until - tick) / 8, 0, 1) : 1;
      live.push({ bubble, sx: p.x, sy: p.y - at.top * camera.zoom, fade });
    }
    // The ones lowest on the screen first, so that each bubble can be pushed up off the one below.
    live.sort((a, b) => b.sy - a.sy);
    const placed: Box[] = [...avoid];
    const mine: Box[] = [];
    let used = 0;
    for (const item of live) {
      if (used >= MAX_BUBBLES) break;
      const sprite = this.pool[used] ?? this.make();
      const text = item.bubble.text[lang] || item.bubble.text[lang === "zh" ? "en" : "zh"];
      const key = `${item.bubble.npc}|${lang}|${text}`;
      if (sprite.key !== key) {
        sprite.key = key;
        sprite.said = text;
        sprite.text.text = lang === "zh" ? wrapChinese(text, BUBBLE_WRAP - 4, widthOf) : text;
        const w = Math.ceil(sprite.text.width) + 18;
        const h = Math.ceil(sprite.text.height) + 12;
        sprite.w = w;
        sprite.h = h;
        sprite.bg.clear();
        sprite.bg.roundRect(0, 0, w, h, 9).fill({ color: PAL.paper, alpha: 0.96 }).stroke({ width: 1, color: PAL.ink, alpha: 0.35 });
        sprite.bg.poly([w / 2 - 6, h - 0.5, w / 2 + 6, h - 0.5, w / 2, h + 7]).fill({ color: PAL.paper, alpha: 0.96 });
        sprite.bg.moveTo(w / 2 - 6, h).lineTo(w / 2, h + 7).lineTo(w / 2 + 6, h).stroke({ width: 1, color: PAL.ink, alpha: 0.35 });
      }
      let x = clamp(item.sx - sprite.w / 2, 6, Math.max(6, viewW - sprite.w - 6));
      let y = item.sy - sprite.h - 8;
      let box: Box = { x, y, w: sprite.w, h: sprite.h + 8 };
      let guard = 0;
      while (placed.some((other) => overlaps(box, other, 2)) && guard++ < 8) {
        y -= sprite.h + 10;
        box = { x, y, w: sprite.w, h: sprite.h + 8 };
      }
      y = Math.max(4, y);
      x = Math.round(x);
      sprite.node.position.set(x, Math.round(y));
      sprite.node.alpha = item.fade;
      sprite.node.visible = item.sx > -40 && item.sx < viewW + 40 && item.sy > -40 && item.sy < viewH + 60;
      placed.push(box);
      mine.push(box);
      used++;
    }
    for (let i = used; i < this.pool.length; i++) (this.pool[i] as BubbleSprite).node.visible = false;
    this.active = used;
    this.placed = mine;
  }
}

const MAX_TALK_MARKS = 8;
/** The size of the marker over a person who talks beyond hearing, in screen pixels. */
const MARK_W = 30;
const MARK_H = 18;

/**
 * A small speech marker ("…") over each person who is talking too far from the player to be heard. The frame says only that they
 * talk (`talking`, with no `text`), so the marker has no words in it and cannot have any: the notebook and listening are for what
 * was said. It is drawn like a speech bubble, smaller, with three dots in it.
 */
export class TalkMarks {
  readonly layer = new Container();
  private readonly pool: Container[] = [];
  private active = 0;

  /** How many markers are showing. */
  get shown(): number {
    return this.active;
  }

  private make(): Container {
    const node = new Container();
    const bg = new Graphics();
    bg.roundRect(0, 0, MARK_W, MARK_H, 9).fill({ color: PAL.paper, alpha: 0.9 }).stroke({ width: 1, color: PAL.ink, alpha: 0.35 });
    bg.poly([MARK_W / 2 - 5, MARK_H - 0.5, MARK_W / 2 + 5, MARK_H - 0.5, MARK_W / 2, MARK_H + 6]).fill({ color: PAL.paper, alpha: 0.9 });
    bg.moveTo(MARK_W / 2 - 5, MARK_H).lineTo(MARK_W / 2, MARK_H + 6).lineTo(MARK_W / 2 + 5, MARK_H).stroke({ width: 1, color: PAL.ink, alpha: 0.35 });
    const dots = new Graphics();
    for (const dx of [-7, 0, 7]) dots.circle(MARK_W / 2 + dx, MARK_H / 2, 1.9).fill({ color: PAL.ink, alpha: 0.75 });
    node.addChild(bg, dots);
    this.layer.addChild(node);
    this.pool.push(node);
    return node;
  }

  update(talkers: readonly string[], people: People, camera: Camera, viewW: number, viewH: number): void {
    let used = 0;
    for (const id of talkers) {
      if (used >= MAX_TALK_MARKS) break;
      const at = people.positionOf(id);
      if (at === null) continue;
      const p = camera.project(at.x, at.y);
      const sx = p.x;
      const sy = p.y - at.top * camera.zoom;
      const node = this.pool[used] ?? this.make();
      node.position.set(Math.round(clamp(sx - MARK_W / 2, 6, Math.max(6, viewW - MARK_W - 6))), Math.round(Math.max(4, sy - MARK_H - 8)));
      node.visible = sx > -40 && sx < viewW + 40 && sy > -40 && sy < viewH + 60;
      used++;
    }
    for (let i = used; i < this.pool.length; i++) (this.pool[i] as Container).visible = false;
    this.active = this.pool.slice(0, used).filter((node) => node.visible).length;
  }
}
