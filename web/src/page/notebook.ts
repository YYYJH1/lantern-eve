/**
 * The notebook: what the player has heard and seen, each with how it reached them and the marks
 * the notebook puts on it. The core does not send it yet. When a frame carries a `notebook` list
 * in the shape below, the panel shows it; behind the flag `?notebook=sample` (test builds) it
 * shows a few entries written for the purpose.
 */
import { type Name, readName } from "./scene.ts";

export type MarkId = "contradicts" | "unsupported" | "sourceMismatch" | "unconfirmed";
export const MARKS: readonly MarkId[] = ["contradicts", "unsupported", "sourceMismatch", "unconfirmed"];

export type NoteSource =
  | { kind: "seen" }
  | { kind: "heard"; who: Name; hand: number }
  | { kind: "unknown" };

export interface NotebookEntry {
  id: string;
  text: Name;
  source: NoteSource;
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
    const hand = typeof value.hand === "number" && Number.isFinite(value.hand) ? Math.max(1, Math.trunc(value.hand)) : 1;
    return { kind: "heard", who: readName(value.who), hand };
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
      marks: Array.isArray(item.marks) ? item.marks.filter(isMark) : [],
      chain,
    });
  }
  return entries;
}
