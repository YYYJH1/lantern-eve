/**
 * The portraits of the people: the head and shoulders of each figure of the sprite kit, cut from the picture of the figure that stands
 * facing the front, which is the one the map draws when the person stands still. The atlas is the one the map has fetched (it is
 * loaded once for the page), so a portrait costs no more than a copy of a small part of it. A person who has no figure in the kit has
 * no portrait, and the page puts the seal of their surname in its place.
 */
import { loadSheetData, type SheetData } from "./map/atlas.ts";
import { frameRect } from "./map/manifest.ts";
import { figureFor } from "./map/sprites.ts";

/** Where the portrait of a figure is in the pages of the atlas, in the pixels of the scale that was loaded. */
interface Crop {
  page: number;
  x: number;
  y: number;
  side: number;
}

const crops = new Map<string, Crop | null>();

/** A pixel that is more opaque than this is the body of the figure and not the soft shadow it stands in. */
const SOLID = 200;
/** How much of the height of the body the portrait takes from the top: the head and the shoulders of a figure drawn from above. */
const HEAD_SHARE = 0.62;
/** How much wider than the body the portrait may be, as a share of its width. */
const WIDE_SHARE = 0.9;

/** The box of the pixels of a picture that are solid, or null if there are none. */
function solidBox(image: ImageData): { x0: number; y0: number; x1: number; y1: number } | null {
  let x0 = image.width;
  let y0 = image.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if ((image.data[(y * image.width + x) * 4 + 3] ?? 0) < SOLID) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

function cropOf(data: SheetData, spriteId: string): Crop | null {
  const known = crops.get(spriteId);
  if (known !== undefined) return known;
  let crop: Crop | null = null;
  const def = data.manifest.sprites.get(spriteId);
  if (def !== undefined) {
    const front = def.anims.get("idle")?.dirs.down[0] ?? 0;
    const rect = frameRect(def, data.scale, front);
    const page = rect === null ? undefined : data.pages[rect.page];
    if (rect !== null && page !== undefined) {
      const canvas = document.createElement("canvas");
      canvas.width = rect.w;
      canvas.height = rect.h;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context !== null) {
        context.drawImage(page, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const box = solidBox(context.getImageData(0, 0, rect.w, rect.h));
        if (box !== null) {
          const side = Math.round(Math.max((box.y1 - box.y0) * HEAD_SHARE, (box.x1 - box.x0) * WIDE_SHARE));
          const middle = Math.round((box.x0 + box.x1) / 2);
          // The cut is a square from just over the top of the head, as wide as the head and the shoulders, and it stays inside the frame.
          const left = Math.min(Math.max(0, middle - Math.round(side / 2)), Math.max(0, rect.w - side));
          const top = Math.min(Math.max(0, box.y0 - Math.round(side * 0.05)), Math.max(0, rect.h - side));
          crop = { page: rect.page, x: rect.x + left, y: rect.y + top, side };
        }
      }
    }
  }
  crops.set(spriteId, crop);
  return crop;
}

/** The pixel ratio the map loads the atlas for: the same, so that there is one atlas for the page. */
const pixelRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

/** Whether the page has the sprites at all, which is when a portrait can be drawn. */
export async function spritesAvailable(): Promise<boolean> {
  return (await loadSheetData(pixelRatio())) !== null;
}

/**
 * Draws the portrait of a person on a canvas, over the whole of it. Resolves to whether there was a portrait to draw: false where the
 * sprites are not there or the person has no figure in them.
 */
export async function drawPortrait(canvas: HTMLCanvasElement, personId: string): Promise<boolean> {
  const data = await loadSheetData(pixelRatio());
  if (data === null) return false;
  const spriteId = figureFor(personId, (id) => data.manifest.sprites.has(id));
  const crop = spriteId === null ? null : cropOf(data, spriteId);
  const page = crop === null ? undefined : data.pages[crop.page];
  const context = canvas.getContext("2d");
  if (crop === null || page === undefined || context === null) return false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(page, crop.x, crop.y, crop.side, crop.side, 0, 0, canvas.width, canvas.height);
  return true;
}
