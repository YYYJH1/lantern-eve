import { type Lang, pick, t } from "../i18n/index.ts";
import { type Give, type Keeping, proposalId, type TalkMore, type Wants } from "./talk-frame.ts";

/**
 * The one thing the talk puts forward besides its four acts, and the things queued behind it. The core gives the order (`queue`): an answer
 * the person is waiting for, then the promises that can be kept now, and last a promise to make. The page shows the first and counts the rest.
 */
export type ContextItem = { kind: "answer"; wants: Wants } | { kind: "keep"; keep: Keeping } | { kind: "give"; give: Give };

/**
 * The items to show, in the core's order. A proposal the player turned down (`declined` has its `proposalId`) is not shown again while it stays
 * the same (the core goes on listing it and gives it a new token when the state moves); the proposal of another request is a new one even with
 * the same token. A promise to make is shown only where there is something to promise or a way out to say.
 */
export function contextItems(more: TalkMore | null, declined: readonly string[]): ContextItem[] {
  if (more === null) return [];
  const out: ContextItem[] = [];
  for (const item of more.queue) {
    if (item.kind === "answer") {
      const wants = more.wants;
      if (wants !== null && wants.key === item.key && wants.token === item.token && !declined.includes(proposalId(wants))) out.push({ kind: "answer", wants });
    } else if (item.kind === "keep") {
      out.push({ kind: "keep", keep: item.keep });
    } else if (more.give.preferred !== null || more.give.more.length > 0 || more.give.ways.length > 0) {
      out.push({ kind: "give", give: more.give });
    }
  }
  return out;
}

/** What a button for an item says. */
export function contextLabel(item: ContextItem, name: string, lang: Lang): string {
  if (item.kind === "keep") return t(item.keep.early ? "context.keep.early" : "context.keep", { name, what: pick(item.keep.what, lang) });
  if (item.kind === "give") return t("context.give", { name });
  return t("context.answer", { name });
}
