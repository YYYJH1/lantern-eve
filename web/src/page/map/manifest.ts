/**
 * The manifest of the sprite kit (`web/public/sprites/manifest.json`, made by `tools/sprite-kit`),
 * read into the shapes the map draws from. The manifest is the whole contract with the art: this
 * module knows no sprite by name, so a sprite that the next bake adds is read like the others.
 *
 * It has no PixiJS in it, so that the tests can run it without a browser.
 */
import { CELL, CELL_DEPTH, HEIGHT_PX, type Point } from "./projection.ts";

/** The four directions a character is baked in. They are separate renders and are never mirrored. */
export const DIRS = ["down", "up", "left", "right"] as const;
export type Dir = (typeof DIRS)[number];

/** The schema that this reader understands. A later bake of the same family (`@1.1`) is read too. */
export const SCHEMA = "lantern-eve/sprite-kit@1";

export interface Anim {
  name: string;
  fps: number;
  frames: number;
  /** The ground, in pixels, that one cycle of the walk covers. Null for an animation that is not driven by distance. */
  stride: number | null;
  /** For each direction, the indexes of the frames of the animation among the frames of the sprite. */
  dirs: Record<Dir, number[]>;
}

/** Where a frame is in an atlas: the page and the top-left corner, in the pixels of that scale. */
export interface FrameAt {
  page: number;
  x: number;
  y: number;
}

export interface SpriteDef {
  id: string;
  /** `character`, `place`, `prop` or `fx`. */
  kind: string;
  name: { zh: string; en: string };
  /** The size of a frame, in pixels at scale 1. */
  w: number;
  h: number;
  /** Where the sprite stands in its frame, in pixels at scale 1. It may lie outside the frame. */
  ax: number;
  ay: number;
  footprint: { cols: number; rows: number } | null;
  /** The frames at each scale, in the order the animations index them. */
  frames: Map<number, FrameAt[]>;
  anims: Map<string, Anim>;
  /** Where the door lanterns hang, from the anchor of the house, in pixels at scale 1. */
  mounts: { left: Point; right: Point } | null;
  /** The lift of a walker on the deck, from the west end to the east end of the span, in pixels at scale 1. */
  deckLift: number[] | null;
  /** The sprite of the glow of a lit lantern and where it goes from the lantern's anchor. */
  glow: { sprite: string; offset: Point } | null;
  /** `add` for a sprite that is added to the picture instead of laid over it. */
  blend: string | null;
  /** For a building: the sprite of its lit windows at night, which is anchored like the building and added to the picture over it. */
  lights: string | null;
  /** For a sprite of lit windows: where the windows are, from the anchor of that sprite, in pixels at scale 1 (y down), for a halo round each. */
  spots: Spot[] | null;
}

/** A window of a lit building: its middle, and its width and height. */
export interface Spot {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasPage {
  file: string;
  w: number;
  h: number;
}

export interface Manifest {
  schema: string;
  /** The scales of the atlases, smallest first. */
  scales: number[];
  atlases: Map<number, AtlasPage[]>;
  sprites: Map<string, SpriteDef>;
  /** The sprites the reader could not use, and why. The rest of the manifest is still good. */
  rejected: Array<{ id: string; reason: string }>;
}

/** The manifest cannot be used at all: it is not of this schema, or its camera is not the map's. */
export class ManifestError extends Error {}

type Rec = Record<string, unknown>;
const isRec = (value: unknown): value is Rec => typeof value === "object" && value !== null && !Array.isArray(value);
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const str = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);
const near = (a: unknown, b: number, tolerance: number): boolean => isNum(a) && Math.abs(a - b) <= tolerance;

function point(value: unknown): Point | null {
  return isRec(value) && isNum(value.x) && isNum(value.y) ? { x: value.x, y: value.y } : null;
}

function readSpots(value: unknown): Spot[] | null {
  if (!Array.isArray(value)) return null;
  const out: Spot[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 4 || !entry.slice(0, 4).every(isNum)) throw new Error("a window is not [x, y, w, h]");
    const [x, y, w, h] = entry as [number, number, number, number];
    out.push({ x, y, w, h });
  }
  return out;
}

function readFrames(value: unknown, scales: readonly number[], atlases: ReadonlyMap<number, AtlasPage[]>, w: number, h: number): Map<number, FrameAt[]> {
  if (!isRec(value)) throw new Error("it has no frames");
  const out = new Map<number, FrameAt[]>();
  for (const scale of scales) {
    const list = value[String(scale)];
    if (!Array.isArray(list) || list.length === 0) throw new Error(`it has no frames at scale ${scale}`);
    const pages = atlases.get(scale) ?? [];
    const frames: FrameAt[] = [];
    for (const entry of list) {
      if (!Array.isArray(entry) || !isNum(entry[0]) || !isNum(entry[1]) || !isNum(entry[2])) throw new Error("a frame is not [page, x, y]");
      const [page, x, y] = entry as [number, number, number];
      const atlas = pages[page];
      if (atlas === undefined) throw new Error(`a frame is on page ${page}, which is not in the atlas at scale ${scale}`);
      if (x < 0 || y < 0 || x + w * scale > atlas.w || y + h * scale > atlas.h) throw new Error(`a frame at scale ${scale} reaches outside its atlas`);
      frames.push({ page, x, y });
    }
    out.set(scale, frames);
  }
  const counts = new Set([...out.values()].map((frames) => frames.length));
  if (counts.size !== 1) throw new Error("the scales have different numbers of frames");
  return out;
}

function readAnims(value: unknown, frameCount: number): Map<string, Anim> {
  const out = new Map<string, Anim>();
  if (!isRec(value)) return out;
  for (const [name, raw] of Object.entries(value)) {
    if (!isRec(raw) || !isRec(raw.dirs) || !isNum(raw.fps) || !isNum(raw.frames) || raw.fps <= 0 || raw.frames < 1) throw new Error(`the animation ${name} is not readable`);
    const dirs = {} as Record<Dir, number[]>;
    for (const dir of DIRS) {
      const list = raw.dirs[dir];
      if (!Array.isArray(list) || list.length !== raw.frames) throw new Error(`the animation ${name} has no ${raw.frames} frames facing ${dir}`);
      for (const index of list) {
        if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= frameCount) throw new Error(`the animation ${name} names a frame that is not there`);
      }
      dirs[dir] = list as number[];
    }
    out.set(name, { name, fps: raw.fps, frames: raw.frames, stride: isNum(raw.strideCyclePx) && raw.strideCyclePx > 0 ? raw.strideCyclePx : null, dirs });
  }
  return out;
}

function readSprite(id: string, raw: unknown, scales: readonly number[], atlases: ReadonlyMap<number, AtlasPage[]>): SpriteDef {
  if (!isRec(raw)) throw new Error("it is not an object");
  const frame = point({ x: isRec(raw.frame) ? raw.frame.w : null, y: isRec(raw.frame) ? raw.frame.h : null });
  const anchor = point(raw.anchor);
  if (frame === null || anchor === null || frame.x <= 0 || frame.y <= 0) throw new Error("it has no frame size or no anchor");
  const frames = readFrames(raw.frames, scales, atlases, frame.x, frame.y);
  const count = [...frames.values()][0]?.length ?? 0;
  const footprint = isRec(raw.footprint) && isNum(raw.footprint.cols) && isNum(raw.footprint.rows) ? { cols: raw.footprint.cols, rows: raw.footprint.rows } : null;
  const left = isRec(raw.lanternMountsPx1x) ? point(raw.lanternMountsPx1x.left) : null;
  const right = isRec(raw.lanternMountsPx1x) ? point(raw.lanternMountsPx1x.right) : null;
  const lift = Array.isArray(raw.deckLiftPx1x) && raw.deckLiftPx1x.length >= 2 && raw.deckLiftPx1x.every(isNum) ? (raw.deckLiftPx1x as number[]) : null;
  const glowOffset = point(raw.glowOffsetPx);
  const name = isRec(raw.name) ? { zh: str(raw.name.zh, id), en: str(raw.name.en, id) } : { zh: id, en: id };
  return {
    id,
    kind: str(raw.kind, "prop"),
    name,
    w: frame.x,
    h: frame.y,
    ax: anchor.x,
    ay: anchor.y,
    footprint,
    frames,
    anims: readAnims(raw.anims, count),
    mounts: left !== null && right !== null ? { left, right } : null,
    deckLift: lift,
    glow: typeof raw.glow === "string" ? { sprite: raw.glow, offset: glowOffset ?? { x: 0, y: 0 } } : null,
    blend: typeof raw.blend === "string" ? raw.blend : null,
    lights: typeof raw.lights === "string" ? raw.lights : null,
    spots: readSpots(raw.spots),
  };
}

/**
 * Reads the manifest. Throws a `ManifestError` when it is not of the schema the page knows or was
 * baked with another camera than the map's, since every anchor would be wrong. A sprite that is
 * broken is left out and listed in `rejected`, and the others are used.
 */
export function parseManifest(raw: unknown): Manifest {
  if (!isRec(raw)) throw new ManifestError("the manifest is not an object");
  const schema = str(raw.schema);
  if (schema !== SCHEMA && !schema.startsWith(`${SCHEMA}.`)) throw new ManifestError(`the manifest has the schema "${schema}" and the page reads "${SCHEMA}"`);
  const units = isRec(raw.units) ? raw.units : {};
  if (!near(units.cellPx, CELL, 0.01) || !near(units.cellDepthPx1x, CELL_DEPTH, 0.01) || !near(units.heightPxPerUnit1x, HEIGHT_PX, 0.01)) {
    throw new ManifestError(`the manifest was baked for a cell of ${String(units.cellPx)} by ${String(units.cellDepthPx1x)} pixels and a height of ${String(units.heightPxPerUnit1x)} pixels a unit, and the map uses ${CELL} by ${CELL_DEPTH} and ${HEIGHT_PX}`);
  }
  const atlases = new Map<number, AtlasPage[]>();
  if (!isRec(raw.atlases)) throw new ManifestError("the manifest names no atlas");
  for (const [key, list] of Object.entries(raw.atlases)) {
    const scale = Number(key);
    if (!(scale >= 1) || !Array.isArray(list) || list.length === 0) throw new ManifestError(`the atlas at scale ${key} is not readable`);
    const pages: AtlasPage[] = [];
    for (const page of list) {
      if (!isRec(page) || typeof page.file !== "string" || !isNum(page.w) || !isNum(page.h)) throw new ManifestError(`a page of the atlas at scale ${key} is not readable`);
      pages.push({ file: page.file, w: page.w, h: page.h });
    }
    atlases.set(scale, pages);
  }
  const scales = [...atlases.keys()].sort((a, b) => a - b);
  if (scales.length === 0) throw new ManifestError("the manifest names no atlas");
  if (!isRec(raw.sprites)) throw new ManifestError("the manifest has no sprites");
  const sprites = new Map<string, SpriteDef>();
  const rejected: Array<{ id: string; reason: string }> = [];
  for (const [id, entry] of Object.entries(raw.sprites)) {
    try {
      sprites.set(id, readSprite(id, entry, scales, atlases));
    } catch (err) {
      rejected.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { schema, scales, atlases, sprites, rejected };
}

/** The scale of atlas to draw from on a screen of this pixel ratio: the smallest that is not much coarser than the screen, else the finest. */
export function pickScale(scales: readonly number[], pixelRatio: number): number {
  const sorted = [...scales].sort((a, b) => a - b);
  return sorted.find((scale) => scale >= pixelRatio - 0.25) ?? sorted[sorted.length - 1] ?? 1;
}

/** Where the file of an atlas page is, from where the manifest is. */
export function atlasUrl(manifestUrl: string, file: string): string {
  return new URL(file, manifestUrl).href;
}

/** The place of a frame in its atlas, in the pixels of that scale. */
export function frameRect(sprite: SpriteDef, scale: number, index: number): { page: number; x: number; y: number; w: number; h: number } | null {
  const at = sprite.frames.get(scale)?.[index];
  return at === undefined ? null : { page: at.page, x: at.x, y: at.y, w: sprite.w * scale, h: sprite.h * scale };
}
