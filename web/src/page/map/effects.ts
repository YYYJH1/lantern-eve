/**
 * The things that move on the map without the core: glints on the river, rain, and the lights
 * that carry a rumour from one person to the next.
 */
import { Container, Graphics, Sprite, type Texture, TilingSprite } from "pixi.js";
import { type Dot, topicKind } from "../frame.ts";
import { CELL, CELL_DEPTH, clamp, LIVELY, lerp, type Motion, PULSE, SLOW, STILL } from "./geometry.ts";
import { noise, PAL, topicColour } from "./palette.ts";
import type { People } from "./people.ts";

interface Glint {
  sprite: Sprite;
  baseX: number;
  phase: number;
  speed: number;
}

/** A quiet shimmer: a few soft glints that brighten and fade on the water and drift a little. */
export class Shimmer {
  readonly layer = new Container();
  private glints: Glint[] = [];

  constructor(private readonly texture: Texture) {}

  build(riverCells: ReadonlyArray<readonly [number, number]>): void {
    this.layer.removeChildren().forEach((child) => child.destroy());
    this.glints = [];
    for (const [x, y] of riverCells) {
      const count = noise(x, y, 200) > 0.82 ? 2 : noise(x, y, 201) > 0.4 ? 1 : 0;
      for (let i = 0; i < count; i++) {
        const sprite = new Sprite(this.texture);
        sprite.anchor.set(0.5);
        const width = 22 + noise(x, y, 202 + i) * 22;
        sprite.width = width;
        sprite.height = 4.5;
        sprite.tint = PAL.riverLight;
        const baseX = x * CELL + 10 + noise(x, y, 204 + i) * (CELL - 20);
        sprite.position.set(baseX, y * CELL_DEPTH + 4 + noise(x, y, 206 + i) * (CELL_DEPTH - 8));
        sprite.alpha = 0;
        this.layer.addChild(sprite);
        this.glints.push({ sprite, baseX, phase: noise(x, y, 208 + i) * 6.28, speed: 0.45 + noise(x, y, 210 + i) * 0.5 });
      }
    }
  }

  get count(): number {
    return this.glints.length;
  }

  /**
   * Moves the glints to where they are at `seconds`. They never stop, but they are slow. For a
   * player who asked for less motion (`calm`) they stand still, a little lit.
   */
  update(seconds: number, calm = false): Motion {
    for (const glint of this.glints) {
      const wave = calm ? 0.35 : 0.5 + 0.5 * Math.sin(seconds * glint.speed + glint.phase);
      glint.sprite.alpha = 0.06 + 0.4 * wave * wave;
      glint.sprite.x = calm ? glint.baseX : glint.baseX + Math.sin(seconds * 0.35 + glint.phase) * 4;
    }
    return this.glints.length > 0 && !calm ? SLOW : STILL;
  }
}

export type RainLevel = "none" | "light" | "heavy";

export function rainLevel(weather: string): RainLevel {
  return weather === "heavy_rain" ? "heavy" : weather === "light_rain" ? "light" : "none";
}

/** Rain over the whole screen, in two layers that fall at different speeds. */
export class Rain {
  readonly layer = new Container();
  private readonly far: TilingSprite;
  private readonly near: TilingSprite;

  constructor(farTexture: Texture, nearTexture: Texture) {
    this.far = new TilingSprite({ texture: farTexture, width: 1, height: 1 });
    this.near = new TilingSprite({ texture: nearTexture, width: 1, height: 1 });
    this.far.tileScale.set(0.7);
    this.layer.addChild(this.far, this.near);
    this.layer.visible = false;
    this.layer.eventMode = "none";
  }

  resize(width: number, height: number): void {
    for (const sprite of [this.far, this.near]) {
      sprite.width = width;
      sprite.height = height;
    }
  }

  /** Lets the rain fall for `dt` seconds. Falling rain needs the full rate, unless the player asked for less motion (`calm`): the rain then hangs in the air. */
  update(dt: number, level: RainLevel, calm = false): Motion {
    this.layer.visible = level !== "none";
    if (level === "none") return STILL;
    const heavy = level === "heavy";
    const speed = heavy ? 900 : 560;
    this.far.alpha = heavy ? 0.5 : 0.28;
    this.near.alpha = heavy ? 0.8 : 0.45;
    if (calm) return STILL;
    this.far.tilePosition.x -= 0.2 * speed * 0.7 * dt;
    this.far.tilePosition.y += speed * 0.7 * dt;
    this.near.tilePosition.x -= 0.2 * speed * dt;
    this.near.tilePosition.y += speed * dt;
    return LIVELY;
  }
}

interface DotSprite {
  node: Container;
  halo: Sprite;
  core: Graphics;
  trail: Graphics[];
  colour: number;
}

/**
 * A rumour on its way: a small light that travels along the straight line from the person who
 * says it to the one who hears it, red if it blames someone, blue if it clears someone, pale
 * otherwise, with a short tail behind it.
 */
export class RumourDots {
  readonly layer = new Container();
  private readonly sprites = new Map<string, DotSprite>();

  constructor(private readonly glow: Texture) {}

  get count(): number {
    return this.sprites.size;
  }

  clear(): void {
    for (const dot of this.sprites.values()) dot.node.destroy({ children: true });
    this.sprites.clear();
  }

  /**
   * Puts each light where its rumour is now: on the line between the middles of the two people. A
   * light travelling has a halo that pulses, unless the player asked for less motion (`calm`).
   */
  update(dots: readonly Dot[], people: People, zoom: number, seconds: number, calm = false): Motion {
    const live = new Set<string>();
    const scale = clamp(5.5 / (CELL * 0.2 * zoom), 1, 4);
    for (const dot of dots) {
      const at = (id: string): { x: number; y: number } | null => {
        const where = people.positionOf(id);
        return where === null ? null : { x: where.x, y: where.y - where.mid };
      };
      const from = at(dot.from);
      const to = at(dot.to);
      if (from === null || to === null) continue;
      live.add(dot.id);
      const colour = topicColour(topicKind(dot.topic));
      let sprite = this.sprites.get(dot.id);
      if (sprite === undefined || sprite.colour !== colour) {
        sprite?.node.destroy({ children: true });
        sprite = this.make(colour);
        this.sprites.set(dot.id, sprite);
        this.layer.addChild(sprite.node);
      }
      const t = dot.progress / 1000;
      const along = (u: number): { x: number; y: number } => ({
        x: lerp(from.x, to.x, clamp(u, 0, 1)),
        y: lerp(from.y, to.y, clamp(u, 0, 1)),
      });
      const head = along(t);
      sprite.node.position.set(head.x, head.y);
      sprite.node.scale.set(scale);
      // The tail lies on the same line, behind the head, in world units scaled with the dot.
      const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
      const ux = (to.x - from.x) / length;
      const uy = (to.y - from.y) / length;
      sprite.trail.forEach((piece, i) => {
        const back = (i + 1) * 8 * scale;
        piece.position.set(-ux * back, -uy * back);
        piece.alpha = 0.55 - i * 0.17;
        piece.scale.set(1 - i * 0.18);
      });
      sprite.halo.alpha = calm ? 0.6 : 0.55 + 0.25 * Math.sin(seconds * 6 + t * 12);
    }
    for (const [id, sprite] of this.sprites) {
      if (live.has(id)) continue;
      sprite.node.destroy({ children: true });
      this.sprites.delete(id);
    }
    return this.sprites.size > 0 && !calm ? PULSE : STILL;
  }

  private make(colour: number): DotSprite {
    const node = new Container();
    const halo = new Sprite(this.glow);
    halo.anchor.set(0.5);
    halo.width = CELL * 1.5;
    halo.height = CELL * 1.5;
    halo.tint = colour;
    halo.blendMode = "add";
    const trail: Graphics[] = [];
    for (let i = 0; i < 3; i++) {
      const piece = new Graphics().circle(0, 0, CELL * 0.11).fill(colour);
      trail.push(piece);
    }
    const core = new Graphics().circle(0, 0, CELL * 0.2).fill(0xffffff).circle(0, 0, CELL * 0.2).stroke({ width: 2.4, color: colour });
    node.addChild(halo, ...trail, core);
    return { node, halo, core, trail, colour };
  }
}
