/**
 * The style sheets of the page, read into rules, for the tests that check the look of the page by what its style sheets say (the colours,
 * the corners, the shadows, the contrast of the text). A rule is a selector with its declarations, and the at-rule it sits in if it sits in one.
 * The reader knows the CSS of this page and no more: no nesting, comments are dropped, and a `;` or a `:` inside a string or a
 * parenthesis (a data URI) does not split a declaration.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const STYLE_DIR = path.resolve(HERE, "../../src/page/style");
export const SRC_DIR = path.resolve(HERE, "../../src");

export interface Decl {
  prop: string;
  value: string;
}

export interface Rule {
  file: string;
  selector: string;
  decls: Decl[];
  /** The at-rule the rule sits in ("@media (max-width: 1180px)"), or null. */
  at: string | null;
}

/** The style sheets of the frame of the page: the tokens, the faces, the controls, the shape of the page with its roof line, slip, ledger and corner, and what lies over the map. */
export const FRAME_CSS = ["tokens.css", "fonts.css", "base.css", "layout.css", "cards.css"] as const;

export const cssFiles = (): string[] =>
  readdirSync(STYLE_DIR)
    .filter((name) => name.endsWith(".css"))
    .sort();

export const readCss = (file: string): string => readFileSync(path.join(STYLE_DIR, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Splits at `sep` outside strings and parentheses. */
function splitTop(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote = "";
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function declsOf(body: string): Decl[] {
  const out: Decl[] = [];
  for (const part of splitTop(body, ";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const prop = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    if (prop !== "" && value !== "") out.push({ prop, value });
  }
  return out;
}

/** The index of the brace that closes the one at `open`. */
function closeOf(text: string, open: number): number {
  let depth = 0;
  let quote = "";
  for (let i = open; i < text.length; i++) {
    const c = text.charAt(i);
    if (quote !== "") {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error("a brace is not closed");
}

function parse(file: string, text: string, at: string | null, out: Rule[]): void {
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    // A statement at the top that has no block (an @import) ends in a semicolon before the next block.
    const head = text.slice(i, open);
    const selector = (head.includes(";") ? head.slice(head.lastIndexOf(";") + 1) : head).trim();
    const close = closeOf(text, open);
    const body = text.slice(open + 1, close);
    if (selector.startsWith("@media") || selector.startsWith("@supports")) parse(file, body, selector, out);
    else if (selector.startsWith("@keyframes")) out.push({ file, selector, decls: [], at });
    else out.push({ file, selector, decls: declsOf(body), at });
    i = close + 1;
  }
}

/** The rules of a style sheet, with the rules of its media queries flattened in, in the order they are written. */
export function rulesOf(file: string): Rule[] {
  const out: Rule[] = [];
  parse(file, readCss(file), null, out);
  return out;
}

export const rulesOfAll = (files: readonly string[]): Rule[] => files.flatMap((file) => rulesOf(file));

/** The value of a property in a rule, or undefined. The last declaration of the property wins. */
export function valueOf(rule: Rule, prop: string): string | undefined {
  return rule.decls.filter((d) => d.prop === prop).at(-1)?.value;
}

// --- Colours ---------------------------------------------------------------------------------------------------------

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHex(hex: string): Rgb {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return { r: Number.parseInt(h.slice(0, 2), 16), g: Number.parseInt(h.slice(2, 4), 16), b: Number.parseInt(h.slice(4, 6), 16) };
}

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

export const luminance = ({ r, g, b }: Rgb): number => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

/** The WCAG contrast ratio of two colours. */
export function contrastOf(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Hue in degrees, saturation and lightness (0 to 1) of a colour. */
export function hslOf({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255] as const;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** The colour literals in a value: hex, rgb(), rgba(), hsl(), hsla(), and the keywords white and black. */
export function colourLiterals(value: string): string[] {
  return value.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\b(?:white|black)\b/g) ?? [];
}

export function rgbOfLiteral(literal: string): Rgb | null {
  if (literal.startsWith("#")) return parseHex(literal);
  const nums = literal.match(/[\d.]+/g)?.map(Number);
  if (literal.startsWith("rgb") && nums !== undefined && nums.length >= 3) return { r: nums[0] ?? 0, g: nums[1] ?? 0, b: nums[2] ?? 0 };
  if (literal === "white") return { r: 255, g: 255, b: 255 };
  if (literal === "black") return { r: 0, g: 0, b: 0 };
  return null;
}
