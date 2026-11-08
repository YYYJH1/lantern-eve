/**
 * The atlas of the sprite kit, loaded and put on the graphics card. The files are fetched once for
 * the page, whatever number of maps it has (the live game and a recording each have one); each map
 * makes its own textures from the decoded pictures. A map without the atlas (the files are not
 * there, or the manifest is not one the page can read) draws the shapes made in code instead.
 */
import { ImageSource, Rectangle, Texture } from "pixi.js";
import { alphaOf, AlphaPlane, type FrameBox } from "./pick.ts";
import { atlasUrl, frameRect, type Manifest, parseManifest, pickScale, type SpriteDef } from "./manifest.ts";

/** What is fetched and decoded once for the page. */
export interface SheetData {
  manifest: Manifest;
  scale: number;
  /** The decoded pages of the atlas at `scale`. */
  pages: ImageBitmap[];
}

let shared: Promise<SheetData | null> | null = null;

/** Where the manifest is, from the page. */
export function manifestUrl(): string {
  return new URL("sprites/manifest.json", document.baseURI).href;
}

async function fetchSheet(url: string, pixelRatio: number): Promise<SheetData | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const manifest = parseManifest(await response.json());
    for (const { id, reason } of manifest.rejected) console.warn(`sprite ${id} is not used: ${reason}`);
    const scale = pickScale(manifest.scales, pixelRatio);
    const pages: ImageBitmap[] = [];
    for (const page of manifest.atlases.get(scale) ?? []) {
      const picture = await fetch(atlasUrl(url, page.file));
      if (!picture.ok) throw new Error(`${page.file}: ${picture.status} ${picture.statusText}`);
      pages.push(await createImageBitmap(await picture.blob()));
    }
    return { manifest, scale, pages };
  } catch (err) {
    console.warn(`the sprites are not available, the map draws shapes instead: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** The manifest and the pictures of the atlas, fetched once. `pixelRatio` picks the atlas of the right fineness for the first map that asks. Null if they cannot be had. */
export function loadSheetData(pixelRatio: number): Promise<SheetData | null> {
  shared ??= fetchSheet(manifestUrl(), pixelRatio);
  return shared;
}

/** Forgets what was loaded, so that the next map fetches again. For the tests. */
export function forgetSheetData(): void {
  shared = null;
  planes = null;
}

// The alpha channel of the pages, which picking looks into. It is made once for the page, when the first map has its atlas.
let planes: Promise<AlphaPlane[]> | null = null;

/** The rows of an atlas that are read at a time. A strip of the 2x atlas is 4 MB of pixels, and the whole atlas is 58. */
const STRIP_ROWS = 256;

async function planesOf(data: SheetData): Promise<AlphaPlane[]> {
  const out: AlphaPlane[] = [];
  for (const bitmap of data.pages) {
    // One strip of the picture at a time goes through a canvas of the size of a strip, so that the page never holds the whole
    // picture as bytes (the decoded picture is already in memory, and a canvas of its size would be a second copy). Between two
    // strips the page is given back to the browser, so that no one task of it is long.
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = Math.min(STRIP_ROWS, bitmap.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (context === null) throw new Error("no 2D canvas");
    const alpha = new Uint8Array(bitmap.width * bitmap.height);
    for (let y = 0; y < bitmap.height; y += STRIP_ROWS) {
      const h = Math.min(STRIP_ROWS, bitmap.height - y);
      context.clearRect(0, 0, bitmap.width, canvas.height);
      context.drawImage(bitmap, 0, y, bitmap.width, h, 0, 0, bitmap.width, h);
      const strip = alphaOf(context.getImageData(0, 0, bitmap.width, h).data, bitmap.width, h);
      alpha.set(strip.data, y * bitmap.width);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    out.push(new AlphaPlane(bitmap.width, bitmap.height, alpha));
  }
  return out;
}

/** A map's own view of the atlas: its textures, and the shapes of the sprites for picking. */
export class Sheet {
  readonly manifest: Manifest;
  readonly scale: number;
  private readonly sources: ImageSource[];
  private readonly textures = new Map<string, Texture>();
  private alpha: AlphaPlane[] | null = null;

  constructor(private readonly data: SheetData) {
    this.manifest = data.manifest;
    this.scale = data.scale;
    // The pictures are laid out at `scale` pixels to a logical pixel, so that the sprites keep their size at scale 1 whichever atlas is drawn.
    this.sources = data.pages.map(
      (bitmap) => new ImageSource({ resource: bitmap, resolution: data.scale, alphaMode: "premultiply-alpha-on-upload", autoGenerateMipmaps: true, scaleMode: "linear" }),
    );
  }

  has(id: string): boolean {
    return this.manifest.sprites.has(id);
  }

  sprite(id: string): SpriteDef | undefined {
    return this.manifest.sprites.get(id);
  }

  /** The texture of frame `index` of a sprite, at the scale of the atlas that was loaded. */
  texture(sprite: SpriteDef, index: number): Texture | null {
    const key = `${sprite.id}|${index}`;
    const known = this.textures.get(key);
    if (known !== undefined) return known;
    const rect = frameRect(sprite, this.scale, index);
    const source = rect === null ? undefined : this.sources[rect.page];
    if (rect === null || source === undefined) return null;
    const texture = new Texture({ source, frame: new Rectangle(rect.x / this.scale, rect.y / this.scale, sprite.w, sprite.h) });
    this.textures.set(key, texture);
    return texture;
  }

  /** Makes the alpha planes that picking needs, if they are not made yet. Resolves when they are. */
  async prepareAlpha(): Promise<void> {
    if (this.alpha !== null) return;
    planes ??= planesOf(this.data);
    this.alpha = await planes;
  }

  /** The place of a frame in the alpha planes, once `prepareAlpha` has run. Null before that. */
  box(sprite: SpriteDef, index: number): FrameBox | null {
    const rect = frameRect(sprite, this.scale, index);
    const plane = rect === null ? undefined : this.alpha?.[rect.page];
    return rect === null || plane === undefined ? null : { plane, x: rect.x, y: rect.y, w: rect.w, h: rect.h, scale: this.scale };
  }

  get alphaReady(): boolean {
    return this.alpha !== null;
  }

  destroy(): void {
    for (const texture of this.textures.values()) texture.destroy(false);
    this.textures.clear();
    for (const source of this.sources) source.destroy();
  }
}
