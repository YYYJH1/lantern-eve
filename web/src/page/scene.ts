/**
 * The scene: what the core says once about the world the client draws (`Game.scene_json()`).
 *
 * The bridge scenario describes a town with layers, places and a cast with names in Chinese and
 * English. The m0 demo world describes a plain grid with a few labelled rectangles. Both are read
 * into the same shape here, so the map has one way to draw them.
 */

export interface Name {
  zh: string;
  en: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Cell = readonly [number, number];

export interface BuildingRect extends Rect {
  kind: string;
  place: string;
}

export interface Place {
  id: string;
  kind: string;
  indoor: boolean;
  rect: Rect;
  door: Cell | null;
  stands: Cell[];
  cells: Cell[];
  name: Name;
}

export interface Barrier {
  id: string;
  place: string;
  cells: Cell[];
  closed: string;
  open: string;
  name: Name;
}

export interface Person {
  id: string;
  name: Name;
  role: Name;
  /** What the town says of the person, two sentences. Static, like the name: it is in the scene and in no frame. Empty where the scene has none. */
  bio: Name;
  /** The line the town says of who the person is: public, the same in every game and for someone the player has not met. Empty where the scene has none. */
  intro: Name;
  /** The character drawn on the piece: the surname in Chinese, an initial in English. */
  token: Name;
  family: string | null;
  home: string | null;
  work: string | null;
}

/** A thing of the story that a question or a look can be about. */
export interface Thing {
  id: string;
  name: Name;
}

/** The festival manager: who the player is, where they start and the things of the story. */
export interface PlayerInfo {
  id: string;
  name: Name;
  role: Name;
  /** The character drawn on the piece, like those of the cast. */
  token: Name;
  start: Cell | null;
  things: Thing[];
}

export interface Scene {
  scenario: string;
  name: Name;
  width: number;
  height: number;
  rows: string[];
  /** The terrain id of each character of the rows. */
  legend: ReadonlyMap<string, string>;
  buildings: BuildingRect[];
  barriers: Barrier[];
  places: Place[];
  cast: Person[];
  /** The player of the bridge town. The demo world has none. */
  player: PlayerInfo | null;
  families: Map<string, Name>;
  /** The small things of the day that can be given to a person, by id. */
  gifts: Map<string, Name>;
  items: Map<string, Name>;
  activities: Map<string, Name>;
  weather: Map<string, Name>;
  days: number;
  /** True when the scene has no town layers: the map falls back to a plain grid. */
  plain: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asInt = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;

const asString = (value: unknown, fallback = ""): string => (typeof value === "string" ? value : fallback);

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A name written as {zh, en}, as one string, or not at all. A missing language borrows the other. */
export function readName(value: unknown, fallback = ""): Name {
  if (typeof value === "string") return { zh: value, en: value };
  if (isRecord(value)) {
    const zh = asString(value.zh);
    const en = asString(value.en);
    if (zh !== "" || en !== "") return { zh: zh || en, en: en || zh };
  }
  return { zh: fallback, en: fallback };
}

function readCell(value: unknown): Cell | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = value[0];
  const y = value[1];
  return typeof x === "number" && typeof y === "number" ? [x, y] : null;
}

function readCells(value: unknown): Cell[] {
  const out: Cell[] = [];
  for (const raw of asList(value)) {
    const cell = readCell(raw);
    if (cell !== null) out.push(cell);
  }
  return out;
}

function readRectList(value: unknown): Rect | null {
  if (!Array.isArray(value) || value.length < 4) return null;
  const [x, y, w, h] = value as unknown[];
  if (typeof x !== "number" || typeof y !== "number" || typeof w !== "number" || typeof h !== "number") return null;
  return { x, y, w, h };
}

/** The m0 demo world names its terrain differently from the bridge scenario. */
const M0_TERRAIN: Record<string, string> = { blocked: "wall", road: "street" };

function readLegend(value: unknown): Map<string, string> {
  const legend = new Map<string, string>();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (isRecord(entry) && typeof entry.char === "string" && typeof entry.id === "string") {
        legend.set(entry.char, entry.id);
      }
    }
  } else if (isRecord(value)) {
    for (const [char, id] of Object.entries(value)) {
      if (typeof id === "string") legend.set(char, M0_TERRAIN[id] ?? id);
    }
  }
  return legend;
}

function nameMap(value: unknown): Map<string, Name> {
  const out = new Map<string, Name>();
  for (const entry of asList(value)) {
    if (isRecord(entry) && typeof entry.id === "string") out.set(entry.id, readName(entry, entry.id));
  }
  return out;
}

function readPlaces(value: unknown): Place[] {
  const places: Place[] = [];
  for (const raw of asList(value)) {
    if (!isRecord(raw) || typeof raw.id !== "string") continue;
    // The bridge scene gives a rectangle as [x, y, w, h]. The m0 demo gives x, y, w, h as fields.
    const rect =
      readRectList(raw.rect) ??
      (typeof raw.x === "number" && typeof raw.y === "number"
        ? { x: raw.x, y: raw.y, w: asInt(raw.w, 1), h: asInt(raw.h, 1) }
        : null);
    if (rect === null) continue;
    places.push({
      id: raw.id,
      kind: asString(raw.kind, raw.id),
      indoor: raw.indoor === true,
      rect,
      door: readCell(raw.door),
      stands: readCells(raw.stands),
      cells: readCells(raw.cells),
      name: readName(raw, raw.id),
    });
  }
  return places;
}

function readCast(raw: Record<string, unknown>): Person[] {
  const people: Person[] = [];
  const list = asList(raw.cast).length > 0 ? asList(raw.cast) : asList(raw.npcs);
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    // The bridge scene gives a name as the fields zh and en of the person, the demo world as `name`.
    const name = entry.name === undefined ? readName(entry, entry.id) : readName(entry.name, entry.id);
    const first = Array.from(name.zh)[0] ?? entry.id;
    const token = isRecord(entry.token) ? readName(entry.token, first) : { zh: first, en: first };
    people.push({
      id: entry.id,
      name,
      role: readName(entry.role),
      bio: readName(entry.bio),
      intro: readName(entry.intro),
      token,
      family: typeof entry.family === "string" ? entry.family : null,
      home: typeof entry.home === "string" ? entry.home : null,
      work: typeof entry.work === "string" ? entry.work : null,
    });
  }
  return people;
}

function readPlayer(value: unknown): PlayerInfo | null {
  if (!isRecord(value) || typeof value.id !== "string") return null;
  const name = readName(value, value.id);
  const first = Array.from(name.zh)[0] ?? value.id;
  const things: Thing[] = [];
  for (const entry of asList(value.things)) {
    if (isRecord(entry) && typeof entry.id === "string") things.push({ id: entry.id, name: readName(entry, entry.id) });
  }
  return {
    id: value.id,
    name,
    role: readName(value.role),
    token: isRecord(value.token) ? readName(value.token, first) : { zh: first, en: first },
    start: readCell(value.start),
    things,
  };
}

function readBuildings(value: unknown): BuildingRect[] {
  const out: BuildingRect[] = [];
  for (const entry of asList(value)) {
    if (!isRecord(entry)) continue;
    const rect = readRectList(entry.rect);
    if (rect !== null) out.push({ ...rect, kind: asString(entry.kind, "house"), place: asString(entry.place) });
  }
  return out;
}

function readBarriers(value: unknown): Barrier[] {
  const out: Barrier[] = [];
  for (const entry of asList(value)) {
    if (!isRecord(entry) || typeof entry.id !== "string") continue;
    out.push({
      id: entry.id,
      place: asString(entry.place),
      cells: readCells(entry.cells),
      closed: asString(entry.closed, "#"),
      open: asString(entry.open, ":"),
      name: readName(entry, entry.id),
    });
  }
  return out;
}

/** Reads the raw scene of either scenario. Anything it does not know is left out. */
export function parseScene(raw: Record<string, unknown>): Scene {
  const layers = isRecord(raw.layers) ? raw.layers : {};
  const terrain = isRecord(layers.terrain) ? layers.terrain : {};
  // The bridge scene keeps its rows under layers.terrain, the m0 demo at the top.
  const rowSource = Array.isArray(terrain.rows) ? terrain.rows : raw.rows;
  const rows = asList(rowSource).filter((row): row is string => typeof row === "string");
  const legend = readLegend(terrain.legend ?? raw.legend);
  const width = asInt(raw.width, rows.reduce((most, row) => Math.max(most, row.length), 0));
  const height = asInt(raw.height, rows.length);
  const time = isRecord(raw.time) ? raw.time : {};
  const families = new Map<string, Name>();
  for (const [id, name] of nameMap(raw.families)) families.set(id, name);
  return {
    scenario: asString(raw.scenario),
    name: readName(raw.name),
    width,
    height,
    rows,
    legend,
    buildings: readBuildings(layers.buildings),
    barriers: readBarriers(layers.barriers),
    places: readPlaces(raw.places),
    cast: readCast(raw),
    player: readPlayer(raw.player),
    families,
    gifts: nameMap(raw.gifts),
    items: nameMap(raw.items),
    activities: nameMap(raw.activities),
    weather: nameMap(raw.weather),
    days: asInt(time.days, 5),
    plain: !Array.isArray(terrain.rows),
  };
}

/** The terrain id at a cell, or null outside the map. */
export function terrainAt(scene: Scene, x: number, y: number): string | null {
  const row = scene.rows[y];
  if (row === undefined || x < 0 || x >= row.length) return null;
  const char = row.charAt(x);
  return scene.legend.get(char) ?? null;
}
