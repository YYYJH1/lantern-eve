/**
 * The notebook: what the player has heard and seen, each with how it reached them, when and where, and the marks the notebook puts
 * on it. When a frame carries a `notebook` list in the shape below, the panel shows it; behind the flag `?notebook=sample` (test
 * builds) it shows a few entries written for the purpose.
 */
import { readStamp, type Stamp } from "./people.ts";
import { type Name, readName } from "./scene.ts";

export type MarkId = "contradicts" | "unsupported" | "sourceMismatch" | "unconfirmed";
export const MARKS: readonly MarkId[] = ["contradicts", "unsupported", "sourceMismatch", "unconfirmed"];

/** What a teller said of how they came to know it: they saw it themselves, they heard it from a person they named, or they cannot say from whom. */
export type Telling = "saw" | "heard" | "unsure";
const TELLINGS: readonly Telling[] = ["saw", "heard", "unsure"];

export type NoteSource =
  | { kind: "seen" }
  /** `who` is the person who told the player, `how` what they said of how they know it, and `via` the person they named when they heard it. */
  | { kind: "heard"; who: Name; whoId: string; how: Telling; via: Name | null }
  | { kind: "unknown" };

export interface NotebookEntry {
  id: string;
  text: Name;
  source: NoteSource;
  /** When and where the player learned it. Null for an entry the core wrote down before it kept the places. */
  at: Stamp | null;
  marks: MarkId[];
  /** From the one who told the player back towards where it began. A null is a hop not asked yet. */
  chain: Array<Name | null>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isMark = (value: unknown): value is MarkId => MARKS.includes(value as MarkId);

function readSource(value: unknown): NoteSource {
  if (!isRecord(value)) return { kind: "unknown" };
  if (value.kind === "seen") return { kind: "seen" };
  if (value.kind === "heard") {
    const who = readName(value.who);
    const how = TELLINGS.find((t) => t === value.how) ?? "unsure";
    const via = how === "heard" && isRecord(value.via) ? readName(value.via) : null;
    return { kind: "heard", who, whoId: isRecord(value.who) && typeof value.who.id === "string" ? value.who.id : "", how, via };
  }
  return { kind: "unknown" };
}

/** Reads the `notebook` key of a frame. Null when there is none, so that the sample can stand in. */
export function readNotebook(frame: Record<string, unknown>): NotebookEntry[] | null {
  const raw = frame.notebook;
  if (!Array.isArray(raw)) return null;
  const entries: NotebookEntry[] = [];
  for (const item of raw) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    const chain = Array.isArray(item.chain) ? item.chain.map((hop) => (hop === null ? null : readName(hop))) : [];
    entries.push({
      id: item.id,
      text: readName(item.text),
      source: readSource(item.source),
      at: readStamp(item.at),
      marks: Array.isArray(item.marks) ? item.marks.filter(isMark) : [],
      chain,
    });
  }
  return entries;
}
