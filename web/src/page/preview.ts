/**
 * The preview of a request: what it asks, what it gives, what it costs in game minutes, what stands in its way, the chance
 * and the reasons for it, read from the core before the player commits (the call `preview`, which both hosts answer from
 * `Game.preview_json`). The call only reads. The core is the only source: when the host cannot answer, the page has no
 * preview to show, and says so.
 */
import type { HostClient } from "./client.ts";
import { type Name, readName } from "./scene.ts";

export type Odds = "high" | "mid" | "low";

export interface Reason {
  sign: 1 | -1;
  text: Name;
}

export interface Preview {
  /** The version of the state the preview was made on. A request carries it, and the core turns it down (`stale`) if it moved. */
  version: number;
  /** Game minutes. Null where nobody knows. */
  cost: number | null;
  asks: Name;
  gives: Name | null;
  blockers: Name[];
  odds: Odds | null;
  reasons: Reason[];
}

/** The verbs that have a preview here: the ones that ask something of a person or promise them something. */
export type PreviewVerb = "entrust" | "promise";

/** The action a preview is asked for: the fields of the action to come, and `verb` in place of `type`. */
export interface PreviewAction {
  verb: PreviewVerb;
  npc: string;
  [field: string]: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const whole = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null);

function nameOrNull(value: unknown): Name | null {
  const name = readName(value);
  return name.zh === "" && name.en === "" ? null : name;
}

/** A preview as the core sends it, or null where the answer is not one. */
export function readPreview(raw: unknown): Preview | null {
  if (!isRecord(raw)) return null;
  const version = whole(raw.version);
  const asks = nameOrNull(raw.asks);
  if (version === null || asks === null) return null;
  const odds = raw.odds === "high" || raw.odds === "mid" || raw.odds === "low" ? raw.odds : null;
  const reasons: Reason[] = [];
  for (const item of Array.isArray(raw.reasons) ? raw.reasons : []) {
    const text = isRecord(item) ? nameOrNull(item.text) : null;
    if (isRecord(item) && text !== null) reasons.push({ sign: item.sign === -1 ? -1 : 1, text });
  }
  const blockers: Name[] = [];
  for (const item of Array.isArray(raw.blockers) ? raw.blockers : []) {
    const name = nameOrNull(item);
    if (name !== null) blockers.push(name);
  }
  const cost = whole(raw.cost);
  return { version, cost: cost === null ? null : Math.max(0, cost), asks, gives: nameOrNull(raw.gives), blockers, odds, reasons };
}

/** Why the page has no preview: the host did not answer in time, refused the call, or has no previews. */
export class PreviewUnavailable extends Error {
  constructor(
    readonly why: "silent" | "refused" | "none",
    message: string,
  ) {
    super(message);
    this.name = "PreviewUnavailable";
  }
}

/** How long the page waits for the host, in milliseconds. */
export const PREVIEW_WAIT_MS = 10_000;

/** Rejects after `ms` milliseconds, so that a host that never answers does not leave the player waiting. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PreviewUnavailable("silent", "the host did not answer the preview")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(new PreviewUnavailable("refused", err instanceof Error ? err.message : String(err)));
      },
    );
  });
}

/** Asks the host for the preview. It rejects with `PreviewUnavailable` when the host cannot give one. */
export async function askPreview(client: Pick<HostClient, "call">, action: PreviewAction, waitMs = PREVIEW_WAIT_MS): Promise<Preview> {
  const answer = await within(client.call<unknown>({ op: "preview", action }), waitMs);
  const preview = readPreview(answer);
  if (preview === null) throw new PreviewUnavailable("none", "the host answered with no preview");
  return preview;
}
