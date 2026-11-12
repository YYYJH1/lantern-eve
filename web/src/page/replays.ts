/**
 * The gallery of recordings: where they are kept, how one is named in a link, and how the page
 * finds them. A recording is a `Replay`. Two places keep them:
 *
 *   the browser   the saves in IndexedDB (a save is a replay), named `save-<n>`
 *   the server    the replays that `lantern-eve play` wrote to its runs folder, which the page lists
 *                 and reads through the read-only endpoint `api/replays` (host_server/lantern_eve/replays.py),
 *                 named by their file name without `.json`
 *
 * A link to a recording is `#replay=<id>` and, for a moment in it, `#replay=<id>&tick=<n>`. It names
 * the recording and the tick and nothing else. The page never puts a key, a provider or a path in it.
 */
import { IdbSaveStore } from "../shared/idb-saves.ts";
import type { SaveMeta } from "../shared/protocol.ts";

/** A name that may be in a link: letters and digits, then those and `._-`. No slash, no dot first. */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SAVE = /^save-(\d{1,15})$/;

export const isReplayId = (value: unknown): value is string => typeof value === "string" && ID.test(value);

export interface ReplayLink {
  id: string;
  /** The tick of the moment the link points at, or null for the recording from its start. */
  tick: number | null;
}

/** What a hash (`#replay=...&tick=...`) points at. Anything else in it is ignored, a bad name is no link. */
export function parseReplayHash(hash: string): ReplayLink | null {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const id = params.get("replay");
  if (!isReplayId(id)) return null;
  const raw = params.get("tick");
  const tick = raw !== null && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
  return { id, tick: tick !== null && Number.isSafeInteger(tick) ? tick : null };
}

/** The hash of a link: the recording, and the tick when there is one. */
export function replayHash(id: string, tick: number | null = null): string {
  const params = new URLSearchParams({ replay: id });
  if (tick !== null && Number.isSafeInteger(tick) && tick >= 0) params.set("tick", String(tick));
  return `#${params.toString()}`;
}

/** Where a recording is kept, from its name in a link. */
export type ReplayRef = { source: "browser"; save: number } | { source: "server"; name: string };

export function refOf(id: string): ReplayRef | null {
  if (!isReplayId(id)) return null;
  const save = SAVE.exec(id);
  return save === null ? { source: "server", name: id } : { source: "browser", save: Number(save[1]) };
}

export const browserId = (save: number): string => `save-${save}`;

/** One recording in the gallery. */
export interface GalleryEntry {
  /** The name that goes in a link. */
  id: string;
  source: "browser" | "server";
  /** What the recording is called: the name of a save, or the seed of a game of the server. */
  title: string;
  seed: number | null;
  scenario: string | null;
  /** The ticks in it. */
  ticks: number;
  /** When it was written, as an ISO time. */
  when: string;
  bytes: number | null;
  coreVersion: string | null;
}

export function browserEntry(save: SaveMeta): GalleryEntry {
  return { id: browserId(save.id), source: "browser", title: save.name, seed: null, scenario: null, ticks: save.tick, when: save.savedAt, bytes: null, coreVersion: null };
}

interface ServerListing {
  id: string;
  bytes: number;
  modified: string;
  seed: number;
  scenario: string;
  coreVersion: string | null;
  endTick: number;
}

/** What the endpoint of the server says, as entries. Anything that is not a recording in it is left out. */
export function serverEntries(data: unknown): GalleryEntry[] {
  const list = typeof data === "object" && data !== null ? (data as { replays?: unknown }).replays : undefined;
  if (!Array.isArray(list)) return [];
  const entries: GalleryEntry[] = [];
  for (const raw of list as Array<Partial<ServerListing> | null>) {
    if (raw === null || typeof raw !== "object" || !isReplayId(raw.id) || !Number.isSafeInteger(raw.endTick) || !Number.isSafeInteger(raw.seed)) continue;
    entries.push({
      id: raw.id,
      source: "server",
      title: String(raw.seed),
      seed: raw.seed as number,
      scenario: typeof raw.scenario === "string" ? raw.scenario : null,
      ticks: raw.endTick as number,
      when: typeof raw.modified === "string" ? raw.modified : "",
      bytes: typeof raw.bytes === "number" ? raw.bytes : null,
      coreVersion: typeof raw.coreVersion === "string" ? raw.coreVersion : null,
    });
  }
  return entries;
}

export interface Gallery {
  browser: GalleryEntry[];
  /** Null where there is no server behind the page that has any: a page on a static host. */
  server: GalleryEntry[] | null;
}

const endpoint = (path: string): URL => new URL(path, document.baseURI);

/** Every recording the page can reach, the newest first in each place. A place that cannot be read is left empty. */
export async function listGallery(): Promise<Gallery> {
  const browser = await new IdbSaveStore().list().then(
    (saves) => saves.map(browserEntry),
    () => [],
  );
  let server: GalleryEntry[] | null = null;
  try {
    const response = await fetch(endpoint("api/replays"), { cache: "no-store", credentials: "omit" });
    if (response.ok && (response.headers.get("content-type") ?? "").includes("json")) server = serverEntries(await response.json());
  } catch {
    // No server host behind this page, or no way to it: the gallery has only what the browser keeps.
  }
  return { browser, server };
}

export class ReplayLoadError extends Error {
  constructor(
    readonly code: "not_found" | "storage" | "network" | "bad_link",
    message: string,
  ) {
    super(message);
    this.name = "ReplayLoadError";
  }
}

/** A recording as it was read: what the host plays, and for a save of this browser what the save says of itself (its name and its tick). */
export interface LoadedReplay {
  replay: unknown;
  saved: SaveMeta | null;
}

/** The recording a name stands for, as the host will read it. */
export async function loadReplay(id: string): Promise<LoadedReplay> {
  const ref = refOf(id);
  if (ref === null) throw new ReplayLoadError("bad_link", "that is not the name of a recording");
  if (ref.source === "browser") {
    let found: Awaited<ReturnType<IdbSaveStore["get"]>>;
    try {
      found = await new IdbSaveStore().get(ref.save);
    } catch (err) {
      throw new ReplayLoadError("storage", String(err instanceof Error ? err.message : err));
    }
    if (found === undefined) throw new ReplayLoadError("not_found", `this browser has no save ${ref.save}`);
    return { replay: found.replay, saved: found.meta };
  }
  let response: Response;
  try {
    response = await fetch(endpoint(`api/replays/${encodeURIComponent(ref.name)}`), { cache: "no-store", credentials: "omit" });
  } catch (err) {
    throw new ReplayLoadError("network", String(err instanceof Error ? err.message : err));
  }
  if (response.status === 404) throw new ReplayLoadError("not_found", `the server has no recording ${ref.name}`);
  if (!response.ok) throw new ReplayLoadError("network", `the server answered ${response.status}`);
  try {
    return { replay: await response.json(), saved: null };
  } catch {
    throw new ReplayLoadError("network", "the server did not send a recording");
  }
}

/** A size for a list: 1.4 MB, 380 KB. */
export function sizeText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}
