/**
 * The mark on the map for where the player was told to walk: a ring that breathes, with four small
 * ticks pointing in and a dot in the middle. It is drawn above the ground and outside the tint, so
 * that it can be found at night too.
 */
import { Container, Graphics } from "pixi.js";
import { CELL, CELL_DEPTH, DEPTH_RATIO, type Motion, PULSE, STILL } from "./geometry.ts";
import { PAL } from "./palette.ts";

export class DestinationMarker {
  readonly layer = new Container();
  private readonly mark = new Graphics();
  private cell: { x: number; y: number } | null = null;

  constructor() {
    const r = CELL * 0.46;
    this.mark
      .circle(0, 0, r)
      .stroke({ width: 2.4, color: 0xffffff, alpha: 0.95 })
      .circle(0, 0, r + 2.2)
      .stroke({ width: 1.6, color: PAL.red, alpha: 0.95 })
      .circle(0, 0, 3.2)
      .fill({ color: PAL.red, alpha: 0.95 });
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      this.mark.moveTo(cos * (r + 9), sin * (r + 9)).lineTo(cos * (r + 3.5), sin * (r + 3.5)).stroke({ width: 2.2, color: PAL.red, alpha: 0.95, cap: "round" });
    }
    this.layer.addChild(this.mark);
    this.layer.visible = false;
    this.layer.eventMode = "none";
  }

  /** The cell now marked, or null when there is none. */
  get at(): { x: number; y: number } | null {
    return this.cell;
  }

  set(cell: { x: number; y: number } | null): void {
    this.cell = cell;
    this.layer.visible = cell !== null;
    if (cell !== null) this.mark.position.set((cell.x + 0.5) * CELL, (cell.y + 0.5) * CELL_DEPTH);
    // A ring on the ground is an ellipse on the screen.
    this.mark.scale.set(1, DEPTH_RATIO);
  }

  /** Lets the ring breathe, for as long as there is a ring, unless the player asked for less motion (`calm`). */
  update(seconds: number, calm = false): Motion {
    if (this.cell === null) return STILL;
    const breath = calm ? 1 : 1 + 0.09 * Math.sin(seconds * 5);
    this.mark.scale.set(breath, breath * DEPTH_RATIO);
    this.mark.alpha = calm ? 0.9 : 0.82 + 0.18 * Math.sin(seconds * 5 + 1);
    return calm ? STILL : PULSE;
  }
}
