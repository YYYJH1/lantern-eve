import type { MessageKey } from "../../i18n/index.ts";
import type { Relation } from "../slice.ts";

/** The three answers in plain words, by the relation the core takes for each. */
export const ANSWER_KEY: Readonly<Record<Relation, MessageKey>> = {
  unsupported: "pairing.ans.unsupported",
  contradicts: "pairing.ans.contradicts",
  mismatch: "pairing.ans.mismatch",
};

/** A small example under each answer. */
export const EXAMPLE_KEY: Readonly<Record<Relation, MessageKey>> = {
  unsupported: "pairing.eg.unsupported",
  contradicts: "pairing.eg.contradicts",
  mismatch: "pairing.eg.mismatch",
};

/** What the page says when the answer was right, as one sentence that names the two lines. */
export const RIGHT_KEY: Readonly<Record<Relation, MessageKey>> = {
  unsupported: "pairing.ok.unsupported",
  contradicts: "pairing.ok.contradicts",
  mismatch: "pairing.ok.mismatch",
};

/** Which of the three things to do the pairing waits for: take a claim, show a line against it, or answer. */
export type PairingStep = "claim" | "show" | "answer";

export function pairingStep(pair: { a: string | null; b: string | null }): PairingStep {
  return pair.b === null ? "claim" : pair.a === null ? "show" : "answer";
}
