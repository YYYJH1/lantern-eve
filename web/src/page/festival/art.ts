/**
 * The things of the festival night that the sprite kit does not have, drawn once on a 2D canvas each: the lantern a person holds on a stick, the main
 * lantern on its post before the hall (unlit and lit), the lantern that floats on the river, and the soft light that goes round each. They are drawn at
 * twice the size they are shown at, so that they stay sharp on a screen of two pixels to a pixel.
 */
import { Texture } from "pixi.js";
import { PAL } from "../map/palette.ts";
import type { Glow } from "./plan.ts";

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement("canvas");
  element.width = width;
  element.height = height;
  const context = element.getContext("2d");
  if (context === null) throw new Error("no 2D canvas");
  return [element, context];
}

const css = (colour: number): string => `#${colour.toString(16).padStart(6, "0")}`;

/** The paper of a lantern, from its lit middle to its edge, for each colour of lantern. */
const PAPER: Readonly<Record<Glow, { middle: string; edge: string; rib: string }>> = {
  red: { middle: "#ffb089", edge: "#c2402d", rib: "#8f2c20" },
  blue: { middle: "#e2f1ff", edge: "#4a86b8", rib: "#2f5d86" },
  gold: { middle: "#fff3bd", edge: "#dfa339", rib: "#9a6b1c" },
};

/** The colour of the light that goes round a lantern. */
export const LIGHT: Readonly<Record<Glow, number>> = { red: PAL.glowRed, blue: 0x7ab8ff, gold: PAL.glowWarm };

/** How big the art is drawn compared with how big it is shown. */
export const ART_SCALE = 2;

function paperBody(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, paper: { middle: string; edge: string; rib: string }, lit: boolean): void {
  const gradient = c.createRadialGradient(cx - rx * 0.15, cy - ry * 0.2, 1, cx, cy, Math.max(rx, ry));
  gradient.addColorStop(0, lit ? paper.middle : "#8c6258");
  gradient.addColorStop(1, lit ? paper.edge : "#4a211c");
  c.fillStyle = gradient;
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = paper.rib;
  c.globalAlpha = 0.55;
  c.lineWidth = Math.max(1, rx * 0.07);
  for (const k of [-0.5, 0, 0.5]) {
    c.beginPath();
    c.ellipse(cx, cy, rx * Math.abs(1 - Math.abs(k) * 0.9), ry, 0, Math.PI * 0.5, Math.PI * 1.5, k < 0);
    c.stroke();
  }
  c.globalAlpha = 1;
  c.strokeStyle = paper.rib;
  c.lineWidth = Math.max(1, rx * 0.1);
  c.beginPath();
  c.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  c.stroke();
}

/** A lantern on a stick, as a person holds it: the stick is at the bottom, which is where the hand is, and the lantern hangs at the top of it. 14 by 26 pixels as shown. */
export function handLantern(glow: Glow): Texture {
  const [element, c] = canvas(14 * ART_SCALE, 26 * ART_SCALE);
  c.scale(ART_SCALE, ART_SCALE);
  // the stick
  c.strokeStyle = css(PAL.trunk);
  c.lineWidth = 1.6;
  c.lineCap = "round";
  c.beginPath();
  c.moveTo(7, 26);
  c.lineTo(7, 9);
  c.stroke();
  // the lantern
  paperBody(c, 7, 8.5, 5, 6, PAPER[glow], true);
  c.fillStyle = css(PAL.gold);
  c.fillRect(3.2, 1.2, 7.6, 1.8);
  c.fillRect(4, 13.6, 6, 1.6);
  c.strokeStyle = css(PAL.redDark);
  c.lineWidth = 0.8;
  c.beginPath();
  c.moveTo(7, 15);
  c.lineTo(7, 18.5);
  c.stroke();
  return Texture.from(element);
}

/** The main lantern on its post, 62 by 112 pixels as shown, with the foot of the post at the bottom middle. */
export function mainLantern(lit: boolean): Texture {
  const [element, c] = canvas(62 * ART_SCALE, 112 * ART_SCALE);
  c.scale(ART_SCALE, ART_SCALE);
  // a foot of stone, and the post
  c.fillStyle = "#6f7a80";
  c.beginPath();
  c.ellipse(31, 106, 15, 5.5, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#8a959a";
  c.fillRect(19, 98, 24, 8);
  c.fillStyle = css(PAL.trunk);
  c.fillRect(28, 8, 6, 92);
  c.fillStyle = "#4e3a2c";
  c.fillRect(31.6, 8, 2.4, 92);
  // the arm the lantern hangs from
  c.fillStyle = css(PAL.trunk);
  c.fillRect(12, 6, 38, 4.4);
  c.fillStyle = css(PAL.gold);
  c.fillRect(30, 10, 2, 5);
  // the lantern
  const paper = PAPER.red;
  paperBody(c, 31, 36, 20, 22, paper, lit);
  c.fillStyle = css(PAL.gold);
  c.fillRect(20, 12.5, 22, 4);
  c.fillRect(22, 56, 18, 3.6);
  c.strokeStyle = css(PAL.red);
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(31, 59);
  c.lineTo(31, 72);
  c.stroke();
  c.fillStyle = css(PAL.red);
  c.beginPath();
  c.ellipse(31, 75, 3, 5, 0, 0, Math.PI * 2);
  c.fill();
  if (lit) {
    // the flame behind the paper shows through the middle
    const flame = c.createRadialGradient(31, 38, 0, 31, 38, 12);
    flame.addColorStop(0, "rgba(255,250,210,0.95)");
    flame.addColorStop(1, "rgba(255,210,120,0)");
    c.fillStyle = flame;
    c.beginPath();
    c.ellipse(31, 38, 12, 14, 0, 0, Math.PI * 2);
    c.fill();
  }
  return Texture.from(element);
}

/** Where the middle of the paper of the main lantern is, from the foot of its post, in pixels as shown. */
export const MAIN_LANTERN_MIDDLE = { x: 0, y: -76 };
export const MAIN_LANTERN_SIZE = { width: 62, height: 112 };

/** A lantern on the water: a low boat of paper with a flame, 24 by 16 pixels as shown. */
export function riverLantern(glow: Glow): Texture {
  const [element, c] = canvas(24 * ART_SCALE, 16 * ART_SCALE);
  c.scale(ART_SCALE, ART_SCALE);
  const paper = PAPER[glow];
  c.fillStyle = "rgba(20,30,40,0.35)";
  c.beginPath();
  c.ellipse(12, 12.4, 10.5, 3, 0, 0, Math.PI * 2);
  c.fill();
  paperBody(c, 12, 8.6, 7.2, 5.6, paper, true);
  c.fillStyle = css(PAL.gold);
  c.fillRect(7, 12.6, 10, 1.6);
  const flame = c.createRadialGradient(12, 5.5, 0, 12, 5.5, 4);
  flame.addColorStop(0, "rgba(255,255,220,1)");
  flame.addColorStop(1, "rgba(255,200,100,0)");
  c.fillStyle = flame;
  c.beginPath();
  c.arc(12, 5.5, 4, 0, Math.PI * 2);
  c.fill();
  return Texture.from(element);
}

/** A small bright spark, for the sparks that rise from the main lantern when it is lit. */
export function spark(): Texture {
  const size = 16;
  const [element, c] = canvas(size, size);
  const gradient = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,230,1)");
  gradient.addColorStop(0.4, "rgba(255,214,120,0.7)");
  gradient.addColorStop(1, "rgba(255,160,60,0)");
  c.fillStyle = gradient;
  c.fillRect(0, 0, size, size);
  return Texture.from(element);
}
