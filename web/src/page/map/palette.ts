/**
 * The colours of the map, as they look by day. Night and rain are not other palettes: the map is
 * tinted by multiplying (see light.ts), and the lamps are added on top. The interface chrome has
 * its own colours in CSS; the map keeps these in both themes.
 */

export const PAL = {
  // The ground
  backdrop: 0x8ea48d,
  frame: 0x3d4a45,
  grass: [0xbccaa4, 0xb4c49c, 0xc3d0ab, 0xb9c8a0] as readonly number[],
  tuft: 0x93ab82,
  flower: [0xf6ecc4, 0xf2cfc9, 0xffffff, 0xe9d38a] as readonly number[],
  street: 0x9aa8b2,
  streetJoint: 0x8794a0,
  streetHi: 0xaab7c0,
  lane: 0xb6af9f,
  laneJoint: 0xa39c8b,
  bank: 0xd9cfb3,
  pebble: 0xbfb496,
  pier: 0xa27c54,
  pierPlank: 0x86623f,

  // The river
  river: 0x7db1b9,
  riverDeep: 0x6ba2ac,
  riverLight: 0xc4e3e6,
  shoreStone: 0xaab0b0,
  shoreGrass: 0x86a07b,
  foam: 0xe9f4f2,

  // The bridge
  bridgeDeck: 0xd2cdc0,
  bridgeSlab: 0xc3beb0,
  bridgeRail: 0xe9e5d9,
  bridgeRailShade: 0xa9a496,
  arch: 0x3e5a63,

  // Buildings
  wall: 0xf5f2ea,
  wallShade: 0xdad5c8,
  wallBase: 0xa9aaa0,
  roof: 0x414c57,
  roofRidge: 0x5c6a76,
  roofLine: 0x313b44,
  roofEdge: 0x2a323a,
  roofShadow: 0x2b3a35,
  door: 0x704a34,
  doorLit: 0xffcf7a,
  window: 0x39424d,
  windowLit: 0xffd27a,
  red: 0xc2402d,
  redDark: 0x8f2c20,
  gold: 0xe6b64a,
  cloth: 0x4a7a99,
  clothLight: 0xf0ece0,

  // Trees and props
  treeDark: 0x587f54,
  treeMid: 0x6c9a64,
  treeLight: 0x84b077,
  trunk: 0x6e5440,
  rock: 0x9aa19b,
  rockDark: 0x848c86,
  rockLight: 0xc9cec6,
  junk: 0x8a6f52,
  junkDark: 0x66503a,
  boat: 0x4d3b31,
  boatLight: 0x7a5f4a,
  bamboo: 0x8fb36a,
  timber: 0xa8805a,
  tools: 0x8b949c,

  // People and ink
  ink: 0x2c3a40,
  paper: 0xfffaf0,
  shadow: 0x1d2a2a,
  umbrella: 0xc2402d,
  sleep: 0x6b8fd6,

  // Rumours
  blame: 0xe0483e,
  clear: 0x3b82d6,
  other: 0xe9d9a6,

  // Lamps
  glowWarm: 0xffb85a,
  glowRed: 0xff6a3a,
} as const;

/** Colours for the cast. The two families get a pair of their own, the others take from the rest. */
const FAMILY_COLOURS: Record<string, number> = {
  fam_li: 0xd0593a,
  fam_zhou: 0x3f7fa6,
};

const OTHER_COLOURS = [
  0x7e5ba6, 0x5a8450, 0xb08a34, 0x3f8f8a, 0x8b6a52, 0x5f7083, 0xb55079, 0xc07a33, 0x6a8f3b, 0x8a5a8f, 0x4f7ab5, 0xa6674d,
] as const;

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable small number for a cell or a name, to vary the little things the map draws. */
export function noise(a: number, b = 0, salt = 0): number {
  let h = (Math.imul(a + 374761393, 668265263) ^ Math.imul(b + 1274126177, 2246822519) ^ Math.imul(salt + 97, 3266489917)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function pieceColour(id: string, family: string | null): number {
  if (family !== null) {
    const known = FAMILY_COLOURS[family];
    if (known !== undefined) return known;
  }
  return OTHER_COLOURS[hashString(id) % OTHER_COLOURS.length] ?? OTHER_COLOURS[0];
}

/** The colour of a rumour by topic class, as a number for PixiJS. */
export function topicColour(kind: "blame" | "clear" | "other"): number {
  return kind === "blame" ? PAL.blame : kind === "clear" ? PAL.clear : PAL.other;
}

/** Mixes two colours, `t` of the way from a to b. */
export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/** The product of two colours, channel by channel, as the map's tint multiplies them. */
export function multiply(a: number, b: number): number {
  const r = Math.round((((a >> 16) & 255) * ((b >> 16) & 255)) / 255);
  const g = Math.round((((a >> 8) & 255) * ((b >> 8) & 255)) / 255);
  const bl = Math.round(((a & 255) * (b & 255)) / 255);
  return (r << 16) | (g << 8) | bl;
}
