import { clamp } from "./geometry.ts";

/** Where a camera stands: its place on the screen, its zoom, and whether the player (or a show) moved it from the fit. */
export interface CameraPose {
  x: number;
  y: number;
  zoom: number;
  moved: boolean;
}

/**
 * Where a show looks: the world point in the middle of the view, and the zoom as a multiple of the zoom that shows the whole
 * town (1 is the whole town, 2 is twice as close).
 */
export interface Eye {
  x: number;
  y: number;
  zoom: number;
}

/**
 * What a show needs of the map to move its camera (`director.ts`), and what the map gives it (`stage-camera.ts`). A show is not
 * played on a map that cannot draw (a page opened with `?map=off`, a browser without WebGL), and the page goes on without it.
 */
export interface CameraPort {
  /** Whether a map is there to be moved: it draws, and the town is on it. */
  ready(): boolean;
  /** Where the camera stands, to give it back as it was. */
  pose(): CameraPose;
  /** Puts the camera back as it was. */
  restore(pose: CameraPose): void;
  /** Where the camera looks now. */
  eye(): Eye;
  /** Where the camera looks when the whole town is shown. */
  town(): Eye;
  /** Moves the camera to look there, and has the map drawn. */
  look(eye: Eye): void;
}

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

  /** The zoom that shows the whole world, which a multiple of the fit is counted from. */
  get fitScale(): number {
    return this.fitZoom;
  }

  /** The size of the view in pixels, as `setView` last had it. */
  get size(): { width: number; height: number } {
    return { width: this.viewW, height: this.viewH };
  }

  /** The world point in the middle of the view. */
  get centre(): { x: number; y: number } {
    return this.unproject(this.viewW / 2, this.viewH / 2);
  }

  /** The world point in the middle of the view when the whole world is shown. */
  get townCentre(): { x: number; y: number } {
    return { x: this.worldX + this.worldW / 2, y: this.worldY + this.worldH / 2 };
  }

  /**
   * Puts the world point (wx, wy) in the middle of the view at this zoom (held between the least and the most the camera allows),
   * and counts the camera as moved, so that it stays where it is put. It is how a show moves the camera.
   */
  lookAt(wx: number, wy: number, zoom: number): void {
    this.zoom = clamp(zoom, this.minZoom, Camera.MAX_ZOOM);
    this.x = this.viewW / 2 - wx * this.zoom;
    this.y = this.viewH / 2 - wy * this.zoom;
    this.moved = true;
    this.clampPan();
  }

  /** Where the camera stands, to put it back with `restore`. */
  pose(): CameraPose {
    return { x: this.x, y: this.y, zoom: this.zoom, moved: this.moved };
  }

  /** Puts the camera back where `pose` had it: a camera that followed the window goes on following it. */
  restore(pose: CameraPose): void {
    if (!pose.moved) {
      this.fit();
      return;
    }
    this.zoom = clamp(pose.zoom, this.minZoom, Camera.MAX_ZOOM);
    this.x = pose.x;
    this.y = pose.y;
    this.moved = true;
    this.clampPan();
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
