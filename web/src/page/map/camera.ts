import { clamp } from "./geometry.ts";

/**
 * The camera of the map: where the world is on the screen. A world point (wx, wy) is at
 * (wx * zoom + x, wy * zoom + y) in screen pixels. The camera starts fitted to the screen and
 * keeps following the window until the player moves it. The world is a rectangle that starts at
 * the top left of the town and may reach past it, where a tall building stands at the edge.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  /** True once the player has panned or zoomed: the camera then stays where they put it. */
  moved = false;

  private viewW = 0;
  private viewH = 0;
  private worldX = 0;
  private worldY = 0;
  private worldW = 1;
  private worldH = 1;
  private fitZoom = 1;

  static readonly MARGIN = 14;
  static readonly MAX_ZOOM = 3.4;

  /** The town is `width` by `height`, and what is drawn may reach `reach` past each edge of it. */
  setWorld(width: number, height: number, reach: { top?: number; left?: number; right?: number; bottom?: number } = {}): void {
    this.worldX = -Math.max(0, reach.left ?? 0);
    this.worldY = -Math.max(0, reach.top ?? 0);
    this.worldW = Math.max(1, width + Math.max(0, reach.left ?? 0) + Math.max(0, reach.right ?? 0));
    this.worldH = Math.max(1, height + Math.max(0, reach.top ?? 0) + Math.max(0, reach.bottom ?? 0));
    this.recomputeFit();
  }

  setView(width: number, height: number): void {
    if (width === this.viewW && height === this.viewH) return;
    const first = this.viewW === 0;
    // Keep the world point in the middle of the screen where it is when the window changes.
    const centre = first ? null : this.unproject(this.viewW / 2, this.viewH / 2);
    this.viewW = width;
    this.viewH = height;
    this.recomputeFit();
    if (first || !this.moved) {
      this.fit();
    } else if (centre !== null) {
      this.zoom = clamp(this.zoom, this.minZoom, Camera.MAX_ZOOM);
      this.x = this.viewW / 2 - centre.x * this.zoom;
      this.y = this.viewH / 2 - centre.y * this.zoom;
      this.clampPan();
    }
  }

  get minZoom(): number {
    return this.fitZoom * 0.8;
  }

  get fitted(): boolean {
    return !this.moved;
  }

  private recomputeFit(): void {
    const room = Camera.MARGIN * 2;
    const zoom = Math.min((this.viewW - room) / this.worldW, (this.viewH - room) / this.worldH);
    this.fitZoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  }

  /** Shows the whole world, centred, and goes back to following the window. */
  fit(): void {
    this.zoom = this.fitZoom;
    this.x = (this.viewW - this.worldW * this.zoom) / 2 - this.worldX * this.zoom;
    this.y = (this.viewH - this.worldH * this.zoom) / 2 - this.worldY * this.zoom;
    this.moved = false;
  }

  panBy(dx: number, dy: number): void {
    this.x += dx;
    this.y += dy;
    this.moved = true;
    this.clampPan();
  }

  /** Zooms by a factor around a screen point, which stays where it is. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const next = clamp(this.zoom * factor, this.minZoom, Camera.MAX_ZOOM);
    if (next === this.zoom) return;
    const ratio = next / this.zoom;
    this.x = sx - (sx - this.x) * ratio;
    this.y = sy - (sy - this.y) * ratio;
    this.zoom = next;
    this.moved = true;
    this.clampPan();
  }

  /** Keeps a quarter of the world (or of the screen, if that is smaller) in view. */
  private clampPan(): void {
    const w = this.worldW * this.zoom;
    const h = this.worldH * this.zoom;
    const keepX = Math.min(w, this.viewW) * 0.25;
    const keepY = Math.min(h, this.viewH) * 0.25;
    const left = clamp(this.x + this.worldX * this.zoom, keepX - w, this.viewW - keepX);
    const top = clamp(this.y + this.worldY * this.zoom, keepY - h, this.viewH - keepY);
    this.x = left - this.worldX * this.zoom;
    this.y = top - this.worldY * this.zoom;
  }

  project(wx: number, wy: number): { x: number; y: number } {
    return { x: wx * this.zoom + this.x, y: wy * this.zoom + this.y };
  }

  unproject(sx: number, sy: number): { x: number; y: number } {
    return { x: (sx - this.x) / this.zoom, y: (sy - this.y) / this.zoom };
  }
}
