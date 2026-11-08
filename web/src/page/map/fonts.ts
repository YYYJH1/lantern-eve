/**
 * The face of the page that the map draws its names in, and the colours of the paper tags the names are on. The map draws its text on
 * a canvas, which uses a face only once it is loaded and does not draw again when it arrives: so the tags ask for it, and are written
 * again when it is in.
 */
import { CanvasTextMetrics, type Text } from "pixi.js";

export const LABEL_FONT = '"WenKai", "LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", "Noto Serif CJK SC", serif';

/** The colours of a paper tag: the ink of the text and of the line round it, and the paper by day and by night (see tokens.css). */
export const TAG = {
  ink: 0x392f41,
  paperDay: 0xf3f9f1,
  paperNight: 0xeedeb0,
  lineNight: 0x758a99,
  rouge: 0x9d2933,
} as const;

const listeners = new Set<() => void>();
let asked = false;

function ask(): void {
  if (asked || typeof document === "undefined" || document.fonts === undefined) return;
  asked = true;
  const loaded = (): void => {
    CanvasTextMetrics.clearMetrics();
    for (const listener of [...listeners]) listener();
  };
  // Both weights the tags use. A page that has them already (the style sheet asked for them) answers at once.
  void Promise.all([document.fonts.load('400 12px "WenKai"'), document.fonts.load('500 12px "WenKai"')]).then(loaded, () => undefined);
  document.fonts.addEventListener("loadingdone", loaded);
}

/** Calls `redraw` when the face of the tags has arrived, and again if more of it arrives later. Returns a function that stops it. */
export function onLabelFont(redraw: () => void): () => void {
  listeners.add(redraw);
  ask();
  return () => listeners.delete(redraw);
}

/** Has a text draw itself again, with the metrics of the face it has now. */
export function writeAgain(text: Text): void {
  const was = text.text;
  text.text = `${was} `;
  text.text = was;
}
