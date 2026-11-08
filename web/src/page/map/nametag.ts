/**
 * The name tag of a person who is picked or under the pointer: their name in the language of the
 * page, with the badge of their family (the surname in the colour of the household) at its left,
 * under their feet. It is drawn in the pixels of the screen, so it keeps its size when the map is
 * zoomed, and it is not under the tint of the night.
 */
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { LABEL_FONT, onLabelFont, TAG } from "./fonts.ts";
import { clamp } from "./geometry.ts";

export interface TagItem {
  /** What the tag shows, to know when it has to be written again: the person, the name, the badge. */
  key: string;
  name: string;
  /** The surname character and the colour of the household, or null for someone with no family. */
  badge: { char: string; colour: number } | null;
  /** Where the person's feet are on the screen. */
  x: number;
  y: number;
  /** A picked person's tag is a little stronger than one for the pointer. */
  picked: boolean;
}

interface Tag {
  node: Container;
  plate: Graphics;
  badge: Graphics;
  badgeText: Text;
  text: Text;
  key: string;
  w: number;
  h: number;
  /** What it was written from, for the tests. */
  item: TagItem | null;
}

const GAP = 7;

export class NameTags {
  readonly layer = new Container();
  private readonly pool: Tag[] = [];
  private active = 0;
  private watching = false;

  /** The names that are showing now. */
  texts(): string[] {
    return this.pool.slice(0, this.active).filter((tag) => tag.node.visible).map((tag) => tag.text.text);
  }

  /** The tags that are showing: the name, the character of the family badge (or null), whether the person is picked, and where the tag is on the screen. For the tests. */
  describe(): Array<{ name: string; badge: string | null; colour: number | null; picked: boolean; x: number; y: number; w: number; h: number }> {
    return this.pool
      .slice(0, this.active)
      .filter((tag) => tag.node.visible && tag.item !== null)
      .map((tag) => ({ name: tag.text.text, badge: tag.item?.badge?.char ?? null, colour: tag.item?.badge?.colour ?? null, picked: tag.item?.picked ?? false, x: tag.node.x, y: tag.node.y, w: tag.w, h: tag.h }));
  }

  private make(): Tag {
    const node = new Container();
    const plate = new Graphics();
    const badge = new Graphics();
    const badgeText = new Text({
      text: "",
      style: new TextStyle({ fontFamily: LABEL_FONT, fontSize: 12, fontWeight: "500", fill: TAG.paperDay }),
      resolution: 3,
    });
    badgeText.anchor.set(0.5, 0.52);
    const text = new Text({ text: "", style: new TextStyle({ fontFamily: LABEL_FONT, fontSize: 13, fontWeight: "500", fill: TAG.ink }), resolution: 2.5 });
    text.anchor.set(0, 0.5);
    node.addChild(plate, badge, badgeText, text);
    node.eventMode = "none";
    this.layer.addChild(node);
    const tag: Tag = { node, plate, badge, badgeText, text, key: "", w: 0, h: 0, item: null };
    this.pool.push(tag);
    if (!this.watching) {
      this.watching = true;
      // The face of the page arrived after a name was written: every tag is written again the next time it is shown.
      onLabelFont(() => {
        for (const other of this.pool) other.key = "";
      });
    }
    return tag;
  }

  /** Puts the tags for `items` where they go, and hides the ones that are left over. */
  update(items: readonly TagItem[], night: boolean, viewW: number, viewH: number): void {
    let used = 0;
    for (const item of items) {
      const tag = this.pool[used] ?? this.make();
      const key = `${item.key}|${night}|${item.picked}`;
      if (tag.key !== key) {
        tag.key = key;
        this.write(tag, item, night);
      }
      tag.item = item;
      const left = clamp(item.x - tag.w / 2, 4, Math.max(4, viewW - tag.w - 4));
      const top = clamp(item.y + GAP, 4, Math.max(4, viewH - tag.h - 4));
      tag.node.position.set(Math.round(left), Math.round(top));
      tag.node.visible = item.x > -tag.w && item.x < viewW + tag.w && item.y > -40 && item.y < viewH + 40;
      used++;
    }
    for (let i = used; i < this.pool.length; i++) (this.pool[i] as Tag).node.visible = false;
    this.active = used;
  }

  private write(tag: Tag, item: TagItem, night: boolean): void {
    const pad = 6;
    const r = 8;
    tag.text.text = item.name;
    tag.text.style.fill = TAG.ink;
    const badgeW = item.badge === null ? 0 : r * 2 + 4;
    const w = Math.ceil(pad + badgeW + tag.text.width + pad);
    const h = Math.ceil(Math.max(tag.text.height, r * 2) + 8);
    tag.w = w;
    tag.h = h;
    tag.plate.clear();
    // A straight tag of paper. The person who is picked has it ringed in rouge, the manager's own red pen.
    tag.plate.rect(0, 0, w, h).fill({ color: night ? TAG.paperNight : TAG.paperDay, alpha: 0.96 });
    tag.plate.rect(1.5, 1.5, w - 3, h - 3).stroke({ width: item.picked ? 1.8 : 1.2, color: item.picked ? TAG.rouge : night ? TAG.lineNight : TAG.ink, alpha: item.picked ? 1 : night ? 0.95 : 0.85 });
    tag.badge.clear();
    if (item.badge === null) {
      tag.badgeText.visible = false;
    } else {
      // The surname on a small square of the colour of the household, like a seal.
      tag.badge.rect(pad, h / 2 - r, r * 2, r * 2).fill(item.badge.colour);
      tag.badgeText.text = item.badge.char;
      tag.badgeText.position.set(pad + r, h / 2);
      tag.badgeText.visible = true;
    }
    tag.text.position.set(pad + badgeW, h / 2);
  }

  destroy(): void {
    this.layer.destroy({ children: true });
    this.pool.length = 0;
  }
}
