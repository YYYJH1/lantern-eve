/**
 * The words over the heads of the people on the map: the name of a person the player has talked with, and for everyone else what they
 * are (the first part of their role), on a small straight tag of paper that keeps its size when the map is zoomed. A person of one of the
 * two families has a thin line in the colour of the family round the tag, and the person the red slip points to has a small red dot
 * over it. Tags that would lie over each other are pushed up, and one that has no room left is left out.
 */
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import type { Box } from "./clear.ts";
import { LABEL_FONT, onLabelFont, TAG } from "./fonts.ts";
import { placeTags, type Want } from "./tag-layout.ts";

export interface HeadItem {
  id: string;
  /** What the tag shows, to know when it has to be written again: the person, the words, the colour of the family. */
  key: string;
  text: string;
  /** Whether the player knows the person: their name is written, in the stronger hand, where otherwise the role is. */
  known: boolean;
  /** The colour of the family, or null for a person who belongs to neither. */
  edge: number | null;
  /** Whether the red slip points to the person now. */
  dot: boolean;
  /** Where the top of the head is on the screen, in pixels. */
  x: number;
  y: number;
}

interface Tag {
  node: Container;
  plate: Graphics;
  dot: Graphics;
  text: Text;
  key: string;
  w: number;
  h: number;
  item: HeadItem | null;
}

/** The rouge of the night, the seal colour of the dark theme (tokens.css). */
const ROUGE_NIGHT = 0xdc3023;
const PAD_X = 6;

export class HeadLabels {
  readonly layer = new Container();
  private readonly pool: Tag[] = [];
  /** The tag each person has: it stays theirs for as long as they are on the map, so that nothing is written again while they walk. */
  private readonly owner = new Map<string, Tag>();
  private readonly free: Tag[] = [];
  private watching = false;

  /** The tags that are showing, for the tests: whose, the words, whether the person is known, whether they carry the dot, the colour of the family and where on the screen. */
  describe(): Array<{ id: string; text: string; known: boolean; dot: boolean; edge: number | null; x: number; y: number; w: number; h: number }> {
    return [...this.owner.values()]
      .filter((tag) => tag.node.visible && tag.item !== null)
      .map((tag) => {
        const item = tag.item as HeadItem;
        return { id: item.id, text: tag.text.text, known: item.known, dot: item.dot, edge: item.edge, x: tag.node.x, y: tag.node.y, w: tag.w, h: tag.h };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  private make(): Tag {
    const node = new Container();
    const plate = new Graphics();
    const dot = new Graphics();
    const text = new Text({ text: "", style: new TextStyle({ fontFamily: LABEL_FONT, fontSize: 12, fontWeight: "500", fill: TAG.ink }), resolution: 2.5 });
    text.anchor.set(0, 0.5);
    node.addChild(plate, text, dot);
    node.eventMode = "none";
    this.layer.addChild(node);
    const tag: Tag = { node, plate, dot, text, key: "", w: 0, h: 0, item: null };
    this.pool.push(tag);
    if (!this.watching) {
      this.watching = true;
      onLabelFont(() => {
        for (const other of this.pool) other.key = "";
      });
    }
    return tag;
  }

  /** Puts the tags for `items` where they go, and takes away the ones whose person is not in the list. The nearest to the viewer (the lowest on the screen) keep their place. */
  update(items: readonly HeadItem[], night: boolean, viewW: number, viewH: number, avoid: readonly Box[] = [], taken: readonly Box[] = []): void {
    const live = new Set(items.map((item) => item.id));
    for (const [id, tag] of this.owner) {
      if (live.has(id)) continue;
      tag.node.visible = false;
      tag.item = null;
      this.owner.delete(id);
      this.free.push(tag);
    }
    const wants: Want[] = [];
    for (const item of items) {
      let tag = this.owner.get(item.id);
      if (tag === undefined) {
        tag = this.free.pop() ?? this.make();
        this.owner.set(item.id, tag);
      }
      const key = `${item.key}|${night}|${item.dot}`;
      if (tag.key !== key) {
        tag.key = key;
        this.write(tag, item, night);
      }
      tag.item = item;
      wants.push({ id: item.id, x: item.x, y: item.y, w: tag.w, h: tag.h });
    }
    const spots = placeTags(wants, viewW, viewH, avoid, taken);
    for (const [id, spot] of spots) {
      const tag = this.owner.get(id);
      if (tag === undefined) continue;
      tag.node.position.set(spot.x, spot.y);
      tag.node.visible = spot.shown;
    }
  }

  private write(tag: Tag, item: HeadItem, night: boolean): void {
    tag.text.text = item.text;
    tag.text.style.fill = TAG.ink;
    tag.text.style.fontWeight = item.known ? "500" : "400";
    tag.text.style.fontSize = item.known ? 13 : 12;
    const w = Math.ceil(PAD_X + tag.text.width + PAD_X);
    const h = Math.ceil(tag.text.height + 4);
    tag.w = w;
    tag.h = h;
    tag.plate.clear();
    // A straight tag of paper: the line round it is ink, or the colour of the family, and fainter for a person who is not known yet.
    tag.plate.rect(0, 0, w, h).fill({ color: night ? TAG.paperNight : TAG.paperDay, alpha: item.known ? 0.96 : 0.86 });
    const line = item.edge ?? (night ? TAG.lineNight : TAG.ink);
    tag.plate.rect(0.75, 0.75, w - 1.5, h - 1.5).stroke({ width: item.edge === null ? 1 : 1.6, color: line, alpha: item.edge !== null ? 1 : item.known ? 0.85 : 0.55 });
    tag.text.position.set(PAD_X, h / 2);
    tag.dot.clear();
    tag.dot.visible = item.dot;
    if (item.dot) {
      const rouge = night ? ROUGE_NIGHT : TAG.rouge;
      tag.dot.circle(w / 2, -5.5, 4.6).fill({ color: 0xffffff, alpha: 0.95 }).circle(w / 2, -5.5, 3.5).fill(rouge);
    }
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.pool.length = 0;
  }
}
