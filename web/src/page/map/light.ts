/**
 * Day and night. The ground and the people are multiplied by a tint that goes from white at noon,
 * through a warm dusk, to a deep blue at night, and by a grey-blue in rain. The lamps are not under
 * that tint: windows, lanterns and a few lamp posts are added on top as soft glows, so the night
 * map is dark with only the lamps lit.
 */
import { Container, Graphics, Sprite, type Texture } from "pixi.js";
import { daylight, type FrameTime, type Lantern, NIGHT_LIGHT } from "../frame.ts";
import { type LitSpot } from "./buildings.ts";
import { CELL, CELL_DEPTH, type Motion, SLOW, STILL } from "./geometry.ts";
import { mix, multiply, PAL } from "./palette.ts";

const DAY = 0xffffff;
/** The sky tint from noon to midnight, as stops on the scale 0 (day) to 1 (night). */
const SKY: ReadonlyArray<readonly [number, number]> = [
  [0, DAY],
  [0.3, 0xffe0b8],
  [0.58, 0xdcaabb],
  [0.8, 0x8479ae],
  [1, 0x414d8a],
];

function skyTint(dark: number): number {
  for (let i = 1; i < SKY.length; i++) {
    const [at, colour] = SKY[i] as readonly [number, number];
    const [from, before] = SKY[i - 1] as readonly [number, number];
    if (dark <= at) return mix(before, colour, (dark - from) / (at - from));
  }
  return (SKY[SKY.length - 1] as readonly [number, number])[1];
}

const WEATHER_TINT: Record<string, number> = {
  clear: 0xffffff,
  light_rain: 0xdde5ec,
  heavy_rain: 0xb7c3d1,
};

export interface LightState {
  /** 1 at noon, down to NIGHT_LIGHT at midnight. */
  daylight: number;
  /** 0 by day, 1 when the lamps are fully lit. */
  glow: number;
  /** The tint that the ground is multiplied by. */
  tint: number;
  /** The same for the people, who stay a little more readable at night. */
  peopleTint: number;
}

const smooth = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

export function lightState(time: FrameTime, weather: string): LightState {
  const d = daylight(time.hour, time.minute);
  const dark = (1 - d) / (1 - NIGHT_LIGHT);
  const tint = multiply(skyTint(dark), WEATHER_TINT[weather] ?? DAY);
  return { daylight: d, glow: smooth((0.8 - d) / 0.5), tint, peopleTint: mix(tint, DAY, 0.42) };
}

interface LanternSprite {
  key: string;
  node: Container;
  glow: Sprite;
  phase: number;
}

/** Window lights, lamp posts and the lanterns of the households that promised to come. */
export class Lights {
  readonly layer = new Container();
  private readonly windows = new Container();
  private readonly lanternLayer = new Container();
  private windowGlow: Sprite[] = [];
  private windowRects: Graphics | null = null;
  private lanterns = new Map<string, LanternSprite>();

  constructor(private readonly glowTexture: Texture) {
    this.layer.addChild(this.windows, this.lanternLayer);
  }

  /** Lights the windows and doors of the buildings that stay lit at night. */
  setBuildings(lit: readonly LitSpot[]): void {
    this.windows.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.windowGlow = [];
    const rects = new Graphics();
    for (const spot of lit) rects.rect(spot.x, spot.y, spot.w, spot.h).fill(PAL.windowLit);
    rects.blendMode = "add";
    this.windowRects = rects;
    this.windows.addChild(rects);
    for (const spot of lit) {
      const glow = new Sprite(this.glowTexture);
      glow.anchor.set(0.5);
      glow.position.set(spot.x + spot.w / 2, spot.y + spot.h / 2);
      const size = Math.max(spot.w, spot.h) * 4.2 + CELL * 0.6;
      glow.width = size;
      glow.height = size;
      glow.tint = PAL.glowWarm;
      glow.blendMode = "add";
      glow.alpha = 0;
      this.windowGlow.push(glow);
      this.windows.addChild(glow);
    }
  }

  /** One lantern for each household of the frame, hung at the cell it names. */
  setLanterns(lanterns: readonly Lantern[]): void {
    const wanted = new Set<string>();
    for (const l of lanterns) {
      const key = `${l.household}@${l.x},${l.y}`;
      wanted.add(key);
      if (this.lanterns.has(key)) continue;
      const node = new Container();
      node.position.set((l.x + 0.5) * CELL, (l.y + 0.18) * CELL_DEPTH);
      const body = new Graphics();
      body.moveTo(0, -4).lineTo(0, 0).stroke({ width: 1.2, color: PAL.roofLine });
      body.roundRect(-0.2 * CELL, 0, 0.4 * CELL, 0.12 * CELL, 2).fill(PAL.gold);
      body.ellipse(0, 0.3 * CELL, 0.24 * CELL, 0.2 * CELL).fill(PAL.red);
      body.ellipse(-0.07 * CELL, 0.26 * CELL, 0.06 * CELL, 0.1 * CELL).fill({ color: 0xffffff, alpha: 0.22 });
      body.moveTo(-0.15 * CELL, 0.28 * CELL).lineTo(0.15 * CELL, 0.28 * CELL).moveTo(-0.12 * CELL, 0.38 * CELL).lineTo(0.12 * CELL, 0.38 * CELL);
      body.stroke({ width: 1, color: PAL.redDark, alpha: 0.7 });
      body.roundRect(-0.14 * CELL, 0.46 * CELL, 0.28 * CELL, 0.07 * CELL, 2).fill(PAL.gold);
      body.moveTo(0, 0.53 * CELL).lineTo(0, 0.7 * CELL).stroke({ width: 1.6, color: PAL.red });
      const glow = new Sprite(this.glowTexture);
      glow.anchor.set(0.5);
      glow.position.set(0, 0.32 * CELL);
      glow.width = CELL * 3.6;
      glow.height = CELL * 3.6;
      glow.tint = PAL.glowRed;
      glow.blendMode = "add";
      node.addChild(glow, body);
      this.lanternLayer.addChild(node);
      this.lanterns.set(key, { key, node, glow, phase: phaseOf(l.x, l.y) });
    }
    for (const [key, sprite] of this.lanterns) {
      if (wanted.has(key)) continue;
      sprite.node.destroy({ children: true });
      this.lanterns.delete(key);
    }
  }

  get lanternCount(): number {
    return this.lanterns.size;
  }

  /**
   * Lights at the strength of the hour, and sways the lanterns a little, unless the player asked
   * for less motion (`calm`): they then burn steadily.
   */
  update(glow: number, seconds: number, zoom: number, calm = false): Motion {
    // A lantern is never drawn smaller than a few pixels, so that it still reads when the map is small.
    const size = Math.min(3, Math.max(1, 11 / (CELL * 0.45 * zoom)));
    if (this.windowRects !== null) this.windowRects.alpha = glow * 0.92;
    for (const sprite of this.windowGlow) sprite.alpha = glow * 0.5;
    for (const lantern of this.lanterns.values()) {
      lantern.node.rotation = calm ? 0 : Math.sin(seconds * 1.6 + lantern.phase) * 0.07;
      lantern.node.scale.set(size);
      lantern.glow.alpha = 0.12 + glow * (calm ? 0.9 : 0.85 + 0.1 * Math.sin(seconds * 3.1 + lantern.phase));
    }
    return this.lanterns.size > 0 && !calm ? SLOW : STILL;
  }
}

/** A number from a cell, for a phase that differs from lantern to lantern. */
function phaseOf(a: number, b: number): number {
  return (a * 7.31 + b * 3.17) % 6.28;
}
