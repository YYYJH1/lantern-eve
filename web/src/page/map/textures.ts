/**
 * Small textures drawn on a 2D canvas once, so that the page needs no image file: the soft disc of
 * a lamp, a streak of rain, a glint on the water.
 */
import { Texture } from "pixi.js";

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (context === null) throw new Error("no 2D canvas");
  return [element, context];
}

/** A white disc that fades out to nothing at its rim. Tint it and add it to light a place. */
export function glowTexture(): Texture {
  const size = 128;
  const [element, c] = canvas(size, size);
  const gradient = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.22, "rgba(255,255,255,0.72)");
  gradient.addColorStop(0.55, "rgba(255,255,255,0.26)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gradient;
  c.fillRect(0, 0, size, size);
  return Texture.from(element);
}

/** A tile of slanted streaks that repeats without a seam in both directions. */
export function rainTexture(seed: number): Texture {
  const size = 256;
  const [element, c] = canvas(size, size);
  c.strokeStyle = "rgba(235,242,250,0.55)";
  c.lineCap = "round";
  let state = seed >>> 0 || 1;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const slant = 0.2;
  for (let i = 0; i < 46; i++) {
    const x = next() * size;
    const y = next() * size;
    const length = 14 + next() * 22;
    c.lineWidth = 0.8 + next() * 1.2;
    c.globalAlpha = 0.35 + next() * 0.5;
    // Drawn at the tile and one tile over each way, so that a streak crossing the edge wraps.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        c.beginPath();
        c.moveTo(x + dx, y + dy);
        c.lineTo(x + dx - length * slant, y + dy + length);
        c.stroke();
      }
    }
  }
  return Texture.from(element);
}

/** A soft horizontal glint, brightest in the middle. */
export function glintTexture(): Texture {
  const [element, c] = canvas(64, 8);
  const gradient = c.createLinearGradient(0, 0, 64, 0);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.5, "rgba(255,255,255,1)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  c.fillStyle = gradient;
  c.beginPath();
  c.ellipse(32, 4, 32, 2.2, 0, 0, Math.PI * 2);
  c.fill();
  return Texture.from(element);
}
