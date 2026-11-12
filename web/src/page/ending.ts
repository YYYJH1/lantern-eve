/**
 * The ending of a game, as the core reports it in the `ending` event and in the `ending` key of every
 * frame after it (see core/lantern_core/world/bridge/goals.py, goals_ending.py and reveal.py), read
 * into what the ending page shows. Everything here tolerates a key that is missing or in another
 * shape: the reveal is what the modules of the core put in it, and a module may add a section of its own.
 *
 *   ending.tick     the tick the ending was made at (the festival night is seeded by it)
 *   ending.ending   id of the base ending
 *   ending.label    {zh, en}
 *   ending.hidden   [{id, label: {zh, en}}]
 *   ending.inputs   {bridge_fixed, detour_done, reconciled, truth_told: bool}
 *   ending.passage  mended | detour | none
 *   ending.promised, ending.turnout
 *   ending.festival {route: bridge | lane | none, together: bool, lighter: [person], bearers: {place: people},
 *                    named: [{npc, place}]}: what the last night is staged from (see `Festival`). In the whole ending and in the compact one.
 *   ending.epilogue [{npc, id, text: {zh, en}}]: one or two sentences about each person who carries the days, in the order of
 *                   the cast. Only the whole form of the ending has it (the compact one of the frames after it leaves it out).
 *   ending.reveal   {truth: {variant, label: {zh, en}, props}, chains: [chain],
 *                    believers: {false, true, none}, told: {total, mutated},
 *                    ...one section for each module that adds to it}
 *   chain           {id, label: {zh, en}, texts: {prop: {zh, en}}, planted: [[prop, speaker, listener]],
 *                    true: [prop], told: [[claim, speaker, listener, prop, op, tick]], held, reached: [person]}
 *   player section  {spoke: {tellings, lies, ways, told: [[claim, listener, prop, way, lie, tick]], reached,
 *                    retold, furthest, caught: [[prop, person, tick]]},
 *                    said_of_me: [[claim, speaker, listener, prop, tick]], texts: {prop: {zh, en}}, ...}
 *
 * A label that arrives as a plain string, not as a text in both languages, is kept as a Chinese text
 * with no English one, and the page falls back as `said` in the ending page does.
 */
import type { Name } from "./scene.ts";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

const int = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);

/** One telling of a story: who said it to whom, which version, and how they changed it (an operator, or ""). */
export interface Telling {
  id: string;
  from: string;
  to: string;
  prop: string;
  op: string;
  tick: number;
}

export interface RevealChain {
  id: string;
  label: Name | null;
  /** The words of every version of the story that was told, by the id of the version (a prop). */
  texts: Record<string, Name>;
  /** The versions of the story that are true in this game, as ids of props. */
  trueVersions: string[];
  told: Telling[];
  reached: string[];
  /** For each version of the story, how many people hold it at the end (`held` of the chain). A version nobody holds has no entry. */
  held: Record<string, number>;
}

/** How far the manager's own words went (`reveal.player.spoke`). */
export interface Spoke {
  tellings: number;
  lies: number;
  /** The people whose beliefs go back to something the manager told. */
  reached: string[];
  /** The claims of townsfolk that rest on one of the manager's. */
  retold: number;
  /** The most hands a telling of the manager's got to. */
  furthest: number;
  /** The lies that were caught. */
  caught: number;
}

/** One thing the manager told someone (a row of `reveal.player.spoke.told`), with the words of it. */
export interface MyTelling {
  listener: string;
  /** How it was told: faithful, as_seen, sharpen, hide_source or fabricate. */
  way: string;
  lie: boolean;
  /** Whether the listener caught the lie. */
  caught: boolean;
  tick: number;
  text: Name | null;
}

/** A claim in the town's record that is about the manager (`reveal.player.said_of_me`). */
export interface SaidOfMe {
  speaker: string;
  listener: string;
  text: Name;
}

export interface Reveal {
  truth: { variant: string; label: Name | null; props: string[] } | null;
  chains: RevealChain[];
  believers: { false: string[]; true: string[]; none: string[] } | null;
  told: { total: number; mutated: number } | null;
  /** The manager's own words: how far they went, and what was said about the manager. Null when the core leaves them out. */
  spoke: Spoke | null;
  /** What the manager told, one entry for each telling, in the order they were made. */
  tellings: MyTelling[] | null;
  saidOfMe: SaidOfMe[] | null;
  /** Sections that other modules add, by the name of the module, as they came. */
  extra: Record<string, unknown>;
}

/** What became of one of the people who carry the days, in one or two sentences (`ending.epilogue`). */
export interface Epilogue {
  /** The id of the person. */
  npc: string;
  /** The id of the entry of their list that the last night chose. */
  id: string;
  text: Name;
}

/** The way the parade of the last night goes: over the mended bridge, along the lane behind the temple, or nowhere. */
export type FestivalRoute = "bridge" | "lane" | "none";

/**
 * What the core says the last night is to be staged from (`ending.festival`): the way the parade goes, whether the two families are
 * together (the peace was made), who lights the main lantern (both family heads, the elder alone, or nobody), the people of the picture by
 * the district they live in (the sum is the turnout, or 120 if that is more), and the place each named person is bound for.
 */
export interface Festival {
  route: FestivalRoute;
  together: boolean;
  lighter: string[];
  bearers: Record<string, number>;
  named: Array<{ npc: string; place: string }>;
}

export interface EndingView {
  /** The tick the ending was made at, which is what the festival night is seeded by. Null where the ending comes from the numbers of a frame only. */
  tick: number | null;
  /** The id of the base ending. */
  id: string;
  label: Name | null;
  hidden: Array<{ id: string; label: Name | null }>;
  inputs: Record<string, boolean>;
  passage: string | null;
  promised: number | null;
  turnout: number | null;
  /** Null when the page knows the ending from the numbers only (a frame that carries no ending). */
  reveal: Reveal | null;
  /** What became of the people who carry the days. Null where the ending is the compact form or has none. */
  epilogue: Epilogue[] | null;
  /** What the last night is staged from. Null where the ending comes from the numbers of a frame only, or from a core from before it. */
  festival: Festival | null;
}

/** A label that comes as {zh, en}, or as one string. */
export function readLabel(value: unknown): Name | null {
  if (typeof value === "string") return value === "" ? null : { zh: value, en: "" };
  if (isRecord(value)) {
    const zh = typeof value.zh === "string" ? value.zh : "";
    const en = typeof value.en === "string" ? value.en : "";
    if (zh !== "" || en !== "") return { zh, en };
  }
  return null;
}

function readTexts(value: unknown): Record<string, Name> {
  const out: Record<string, Name> = {};
  if (!isRecord(value)) return out;
  for (const [prop, words] of Object.entries(value)) {
    const name = readLabel(words);
    if (name !== null) out[prop] = name;
  }
  return out;
}

function readTellings(value: unknown): Telling[] {
  const out: Telling[] = [];
  for (const row of Array.isArray(value) ? value : []) {
    if (!Array.isArray(row)) continue;
    const [id, from, to, prop, op, tick] = row as unknown[];
    if (typeof from !== "string" || typeof to !== "string" || typeof prop !== "string") continue;
    out.push({ id: typeof id === "string" ? id : `${from}>${to}`, from, to, prop, op: typeof op === "string" ? op : "", tick: int(tick) ?? 0 });
  }
  return out;
}

function readChain(raw: unknown): RevealChain | null {
  if (!isRecord(raw) || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    label: readLabel(raw.label),
    texts: readTexts(raw.texts),
    trueVersions: strings(raw.true),
    told: readTellings(raw.told).sort((a, b) => a.tick - b.tick),
    reached: strings(raw.reached),
    held: readHeld(raw.held),
  };
}

/** `held` of a chain, `[[version, [[person, ...], ...]], ...]`, as the number of people for each version. */
function readHeld(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of Array.isArray(value) ? value : []) {
    if (!Array.isArray(row) || typeof row[0] !== "string" || !Array.isArray(row[1]) || row[1].length === 0) continue;
    out[row[0]] = row[1].length;
  }
  return out;
}

function readReveal(raw: unknown): Reveal | null {
  if (!isRecord(raw)) return null;
  const truth = isRecord(raw.truth) ? { variant: typeof raw.truth.variant === "string" ? raw.truth.variant : "", label: readLabel(raw.truth.label), props: strings(raw.truth.props) } : null;
  const chains = (Array.isArray(raw.chains) ? raw.chains : []).map(readChain).filter((c): c is RevealChain => c !== null);
  const believers = isRecord(raw.believers) ? { false: strings(raw.believers.false), true: strings(raw.believers.true), none: strings(raw.believers.none) } : null;
  const told = isRecord(raw.told) && int(raw.told.total) !== null ? { total: int(raw.told.total) ?? 0, mutated: int(raw.told.mutated) ?? 0 } : null;
  const known = new Set(["truth", "chains", "believers", "told"]);
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) if (!known.has(key)) extra[key] = value;
  const mine = isRecord(raw.player) ? raw.player : null;
  return { truth, chains, believers, told, spoke: readSpoke(mine?.spoke), tellings: readMyTellings(mine), saidOfMe: readSaid(mine), extra };
}

function readSpoke(raw: unknown): Spoke | null {
  if (!isRecord(raw) || int(raw.tellings) === null) return null;
  return {
    tellings: int(raw.tellings) ?? 0,
    lies: int(raw.lies) ?? 0,
    reached: strings(raw.reached),
    retold: int(raw.retold) ?? 0,
    furthest: int(raw.furthest) ?? 0,
    caught: Array.isArray(raw.caught) ? raw.caught.length : 0,
  };
}

/** The words of a prop in the texts of the player's section, or null when the reveal has none for it. */
function wordsIn(texts: unknown, prop: string): Name | null {
  return isRecord(texts) ? readLabel(texts[prop]) : null;
}

/** What the manager told, with the words of each telling and whether the listener caught it as a lie. */
function readMyTellings(mine: Record<string, unknown> | null): MyTelling[] | null {
  const spoke = mine !== null && isRecord(mine.spoke) ? mine.spoke : null;
  if (spoke === null || !Array.isArray(spoke.told)) return null;
  const caught = new Set<string>();
  for (const row of Array.isArray(spoke.caught) ? spoke.caught : []) {
    if (Array.isArray(row) && typeof row[0] === "string" && typeof row[1] === "string") caught.add(`${row[0]}|${row[1]}`);
  }
  const out: MyTelling[] = [];
  for (const row of spoke.told) {
    if (!Array.isArray(row)) continue;
    const [, listener, prop, way, lie, tick] = row as unknown[];
    if (typeof listener !== "string" || typeof prop !== "string") continue;
    const wasLie = lie === 1 || lie === true;
    out.push({
      listener,
      way: typeof way === "string" ? way : "",
      lie: wasLie,
      caught: wasLie && caught.has(`${prop}|${listener}`),
      tick: int(tick) ?? 0,
      text: wordsIn(mine?.texts, prop),
    });
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/** The claims about the manager, with what each says in both languages when the reveal has the texts. */
function readSaid(mine: Record<string, unknown> | null): SaidOfMe[] | null {
  if (mine === null || !Array.isArray(mine.said_of_me)) return null;
  const out: SaidOfMe[] = [];
  for (const row of mine.said_of_me) {
    if (!Array.isArray(row)) continue;
    const [, speaker, listener, prop] = row as unknown[];
    if (typeof speaker !== "string" || typeof listener !== "string" || typeof prop !== "string") continue;
    const said = wordsIn(mine.texts, prop);
    out.push({ speaker, listener, text: said === null ? { zh: prop, en: prop } : { zh: said.zh || prop, en: said.en || prop } });
  }
  return out;
}

/** The epilogue of the ending: a line for each person that has words in either language, in the order the core gave them. */
export function readEpilogue(raw: unknown): Epilogue[] | null {
  if (!Array.isArray(raw)) return null;
  const out: Epilogue[] = [];
  for (const row of raw) {
    if (!isRecord(row) || typeof row.npc !== "string") continue;
    const text = readLabel(row.text);
    if (text !== null) out.push({ npc: row.npc, id: typeof row.id === "string" ? row.id : "", text });
  }
  return out;
}

const ROUTES: readonly FestivalRoute[] = ["bridge", "lane", "none"];

/** The `festival` of an ending, or null where it is not one the page can stage. */
export function readFestival(raw: unknown): Festival | null {
  if (!isRecord(raw) || typeof raw.route !== "string" || !ROUTES.includes(raw.route as FestivalRoute)) return null;
  const bearers: Record<string, number> = {};
  if (isRecord(raw.bearers)) {
    for (const [place, count] of Object.entries(raw.bearers)) {
      const n = int(count);
      if (n !== null && n > 0) bearers[place] = n;
    }
  }
  const named: Festival["named"] = [];
  for (const row of Array.isArray(raw.named) ? raw.named : []) {
    if (isRecord(row) && typeof row.npc === "string" && typeof row.place === "string") named.push({ npc: row.npc, place: row.place });
  }
  return { route: raw.route as FestivalRoute, together: raw.together === true, lighter: strings(raw.lighter), bearers, named };
}

/** The ending the `ending` event reports, or the `ending` key of a frame, which is the same object. */
export function readEnding(event: Record<string, unknown>): EndingView {
  const hidden: EndingView["hidden"] = [];
  for (const row of Array.isArray(event.hidden) ? event.hidden : []) {
    if (isRecord(row) && typeof row.id === "string") hidden.push({ id: row.id, label: readLabel(row.label) });
  }
  const inputs: Record<string, boolean> = {};
  if (isRecord(event.inputs)) for (const [key, value] of Object.entries(event.inputs)) if (typeof value === "boolean") inputs[key] = value;
  return {
    tick: int(event.tick),
    id: typeof event.ending === "string" ? event.ending : "",
    label: readLabel(event.label),
    hidden,
    inputs,
    passage: typeof event.passage === "string" ? event.passage : null,
    promised: int(event.promised),
    turnout: int(event.turnout),
    reveal: readReveal(event.reveal),
    epilogue: readEpilogue(event.epilogue),
    festival: readFestival(event.festival),
  };
}

/** The ending as far as the numbers of a frame say it: the id and the numbers, with no reveal. For a recording whose frames carry no `ending`. */
export function endingFromHud(id: string, hud: Record<string, unknown>): EndingView {
  return { tick: null, id, label: null, hidden: [], inputs: {}, passage: null, promised: int(hud.promised), turnout: int(hud.turnout), reveal: null, epilogue: null, festival: null };
}

// --- The words of a story ----------------------------------------------------------------------

/** The words of one version of a story, in the language asked for. Empty when the chain has none for it. */
export function versionWords(chain: Pick<RevealChain, "texts">, prop: string, lang: "zh" | "en"): string {
  const words = chain.texts[prop];
  if (words === undefined) return "";
  return words[lang] || words[lang === "zh" ? "en" : "zh"];
}

// --- The tree of a story --------------------------------------------------------------------

export interface TreeNode {
  person: string;
  /** How this person came to know the story: null for the ones who knew it first-hand. */
  heard: Telling | null;
  children: TreeNode[];
}

/**
 * Who told whom. A person is a node where they first hear the story, under the one who told them,
 * and someone who was not told by anyone in the chain stands at the root. Later tellings to a person
 * who knows already are left out.
 */
export function buildForest(told: readonly Telling[]): TreeNode[] {
  const nodes = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  const nodeOf = (person: string): TreeNode => {
    let node = nodes.get(person);
    if (node === undefined) {
      node = { person, heard: null, children: [] };
      nodes.set(person, node);
      roots.push(node);
    }
    return node;
  };
  for (const telling of told) {
    const speaker = nodeOf(telling.from);
    if (nodes.has(telling.to)) continue;
    const listener: TreeNode = { person: telling.to, heard: telling, children: [] };
    nodes.set(telling.to, listener);
    speaker.children.push(listener);
  }
  return roots;
}

/**
 * The words written under a person in the tree: what they said, in the first telling they made to
 * someone new, or, for a person who passed the story on to nobody, what they were told.
 */
export function nodeWords(node: TreeNode): { prop: string; said: boolean } | null {
  const said = node.children[0]?.heard;
  if (said !== null && said !== undefined) return { prop: said.prop, said: true };
  if (node.heard !== null) return { prop: node.heard.prop, said: false };
  return null;
}

export interface PlacedNode {
  node: TreeNode;
  x: number;
  y: number;
  /** The width of the pill with the name. */
  w: number;
  /** The width of the column the node stands in, which is as much as the words under the pill may take. */
  col: number;
}

export interface PlacedEdge {
  telling: Telling;
  from: PlacedNode;
  to: PlacedNode;
}

export interface Layout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

/**
 * `row` is the distance between two rows, `height` the pill, `words` the room under it for the lines of
 * words (`lines` of them, `line` apart), `column` the narrowest column and `size` the size of the words. `air` is the room that a column keeps
 * to the right of its widest name: a line that changed the story has its number in a circle in the middle of the gap, and a line that leaves a
 * name as wide as its column has no more than the gap to run in, which the circle takes most of. With `air` there is a run of line between the
 * name and the circle that is long enough to show three dashes of a dashed line (6 and 4 in ending.css).
 */
export const TREE = { row: 60, pad: 8, gap: 34, height: 24, words: 28, column: 130, air: 20, lines: 2, line: 13, size: 11 } as const;

const WIDE = /[⺀-鿿＀-￯]/;

/** The width of a name on its pill, in pixels, by the count of wide and narrow characters. */
export function pillWidth(text: string): number {
  let width = 22;
  for (const char of text) width += WIDE.test(char) ? 13.5 : 7.1;
  return Math.ceil(width);
}

/** The width of a line of words at `size` pixels, by the count of wide and narrow characters. */
export function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) width += WIDE.test(char) ? size : char === " " ? size * 0.32 : size * 0.58;
  return width;
}

/** The words cut short with an ellipsis so that they fit in `width` pixels at `size` pixels. */
export function fitText(text: string, width: number, size: number): string {
  if (textWidth(text, size) <= width) return text;
  const room = width - textWidth("…", size);
  let out = "";
  let used = 0;
  for (const char of text) {
    const next = textWidth(char, size);
    if (used + next > room) break;
    out += char;
    used += next;
  }
  return `${out.trimEnd()}…`;
}

/** Characters that do not begin a line: the closing marks of Chinese and the stops of both languages. */
const NO_LINE_START = "。，、；：？！）」』”’…,.;:?!)";

/** The words of a text as pieces to break between: an English word with the space after it, a Chinese character. */
function pieces(text: string): string[] {
  const out: string[] = [];
  let word = "";
  const flush = (): void => {
    if (word !== "") out.push(word);
    word = "";
  };
  for (const char of text) {
    if (WIDE.test(char)) {
      flush();
      // A closing mark stays with the character before it.
      if (NO_LINE_START.includes(char) && out.length > 0) out[out.length - 1] += char;
      else out.push(char);
    } else {
      word += char;
      if (char === " ") flush();
    }
  }
  flush();
  return out;
}

/**
 * The words broken into at most `maxLines` lines that fit in `width` pixels at `size` pixels. What does not
 * fit is cut off at the end of the last line with an ellipsis.
 */
export function wrapText(text: string, width: number, size: number, maxLines: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const piece of pieces(text)) {
    if (line !== "" && textWidth((line + piece).trimEnd(), size) > width) {
      lines.push(line.trimEnd());
      line = "";
    }
    line += piece;
  }
  if (line !== "") lines.push(line.trimEnd());
  if (maxLines < 1) return [];
  if (lines.length <= maxLines) return lines.map((each) => fitText(each, width, size));
  const kept = lines.slice(0, maxLines).map((each) => fitText(each, width, size));
  kept[maxLines - 1] = fitText(`${lines[maxLines - 1] ?? ""}…`, width, size);
  return kept;
}

/** A tree laid out left to right: a column for each step of the story, a row for each last person. */
export function layoutForest(roots: readonly TreeNode[], nameOf: (person: string) => string): Layout {
  const depthWidths: number[] = [];
  const widthOf = (node: TreeNode): number => pillWidth(nameOf(node.person));
  const measure = (node: TreeNode, depth: number): void => {
    depthWidths[depth] = Math.max(depthWidths[depth] ?? 0, widthOf(node));
    for (const child of node.children) measure(child, depth + 1);
  };
  for (const root of roots) measure(root, 0);
  const columns: number[] = [];
  const widths = depthWidths.map((width) => Math.max(width + TREE.air, TREE.column));
  let at = TREE.pad;
  for (const width of widths) {
    columns.push(at);
    at += width + TREE.gap;
  }

  const placed = new Map<TreeNode, PlacedNode>();
  const nodes: PlacedNode[] = [];
  const edges: PlacedEdge[] = [];
  let row = 0;
  let bottom = 0;
  const place = (node: TreeNode, depth: number): PlacedNode => {
    const children = node.children.map((child) => place(child, depth + 1));
    const y =
      children.length === 0
        ? TREE.pad + row++ * TREE.row
        : ((children[0] as PlacedNode).y + (children[children.length - 1] as PlacedNode).y) / 2;
    bottom = Math.max(bottom, y);
    const out: PlacedNode = { node, x: columns[depth] ?? TREE.pad, y, w: widthOf(node), col: widths[depth] ?? TREE.column };
    placed.set(node, out);
    nodes.push(out);
    for (const child of children) edges.push({ telling: (child.node.heard as Telling), from: out, to: child });
    return out;
  };
  for (const root of roots) {
    place(root, 0);
    row += 0.5; // a little air between two trees
  }
  const width = Math.max(1, at - TREE.gap + TREE.pad);
  const height = bottom + TREE.height + TREE.words + TREE.pad;
  return { nodes, edges, width, height };
}
