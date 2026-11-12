/**
 * Teaching an act when it first matters. No act is hidden by the day: each is there from the start, as the core allows it. The first time
 * an act is of use, its button glows once and a small card says what it does, and a player who uses an act before that has no need of the
 * card. What has been taught is kept per browser (`guide-prefs.ts`), so a second game does not teach it again.
 *
 * The card is a hint like the others (`hints.ts`): it is lit one at a time, kept in the list of hints in the menu, and shown again on request.
 * This module has the acts, when each is of use (a function of what the frame shows, `HintContext`) and which element each one's button is.
 */
import type { MessageKey } from "../i18n/index.ts";
import type { HintContext, HintDef } from "./hints.ts";

/**
 * The acts that are taught. `rally` is the call the manager makes in person, and `convene` is a request to the clan elder to call the
 * clan to the hall: two things, and the cards say so apart.
 */
export type TeachAct = "ask" | "ask_source" | "entrust" | "convene" | "speak" | "gift" | "rally" | "listen" | "look";
export const TEACH_ACTS: readonly TeachAct[] = ["ask", "ask_source", "entrust", "convene", "speak", "gift", "rally", "listen", "look"];

/**
 * The key (`data-sig`, see `signalClass`) of the button each act is lit on. The acts of a talk are on the strip of the talk, the acts
 * around the manager on the strip at the foot of the map.
 */
export const TEACH_TARGET: Readonly<Record<TeachAct, string>> = {
  ask: "verb-ask",
  ask_source: "verb-askSource",
  entrust: "verb-entrust",
  convene: "verb-entrust",
  speak: "verb-speak",
  gift: "verb-gift",
  rally: "verb-rally",
  listen: "verb-listen",
  look: "verb-look",
};

const WORDS: Readonly<Record<TeachAct, { title: MessageKey; text: MessageKey }>> = {
  ask: { title: "teach.ask.title", text: "teach.ask.text" },
  ask_source: { title: "teach.ask_source.title", text: "teach.ask_source.text" },
  entrust: { title: "teach.entrust.title", text: "teach.entrust.text" },
  convene: { title: "teach.convene.title", text: "teach.convene.text" },
  speak: { title: "teach.speak.title", text: "teach.speak.text" },
  gift: { title: "teach.gift.title", text: "teach.gift.text" },
  rally: { title: "teach.rally.title", text: "teach.rally.text" },
  listen: { title: "teach.listen.title", text: "teach.listen.text" },
  look: { title: "teach.look.title", text: "teach.look.text" },
};

/** The day from which the small things of the market are taught: the first talk of the game is about the bamboo, and the gift comes after it. */
export const GIFT_FROM_DAY = 2;

/** When each act is of use: the frame offers it, and there is something to do with it. */
const USEFUL: Readonly<Record<TeachAct, (ctx: HintContext) => boolean>> = {
  ask: (c) => c.talking !== null && c.verbs.has("ask"),
  // The core lists following a telling back once there is a telling to follow, anywhere. It is of use in this talk where an answer of the person can
  // be followed, which is where the phrase that asks who told them is (`TEACH_TARGET`).
  ask_source: (c) => c.talking !== null && c.verbs.has("ask_source") && c.follow,
  // The town puts a request forward for this person.
  entrust: (c) => c.talking !== null && c.verbs.has("entrust") && c.asks.size > 0,
  convene: (c) => c.talking !== null && c.asks.has("convene"),
  speak: (c) => c.verbs.has("speak") || c.verbs.has("speak_publicly"),
  gift: (c) => c.talking !== null && c.verbs.has("gift") && c.day >= GIFT_FROM_DAY,
  // A task asks for the call, so the call is what the town needs now.
  rally: (c) => c.verbs.has("rally") && c.live.has("rally"),
  listen: (c) => c.verbs.has("listen"),
  look: (c) => c.verbs.has("look"),
};

/** The cards, as hints: lit when the act is of use and has not been taught, and the first one the player uses of its kind is learned. */
export const TEACH_DEFS: readonly HintDef[] = TEACH_ACTS.map((act) => ({
  id: `teach.${act}`,
  act,
  target: TEACH_TARGET[act],
  title: WORDS[act].title,
  text: WORDS[act].text,
  when: (c: HintContext) => !c.taught.has(act) && USEFUL[act](c),
}));

/**
 * The acts that an action of the manager is: using one is learning it, and the card of it is not given after. Asking for the clan to be
 * called with `entrust` is `convene` as well as `entrust`.
 */
export function actsOfAction(body: Readonly<Record<string, unknown>>): TeachAct[] {
  const type = body.type;
  switch (type) {
    case "ask":
    case "ask_source":
    case "speak":
    case "gift":
    case "rally":
    case "listen":
    case "look":
      return [type];
    case "entrust":
      return body.kind === "convene" ? ["entrust", "convene"] : ["entrust"];
    default:
      return [];
  }
}

/** The kinds of request among the offers of `entrust` the town puts forward now, and the verbs of the tasks that are still to be done, for `HintContext`. */
export function liveAsks(tasks: Iterable<{ state: string; action: { verb: string; request?: string | null } | null }>): Set<string> {
  const out = new Set<string>();
  for (const task of tasks) {
    if (task.state !== "open" && task.state !== "blocked") continue;
    const action = task.action;
    if (action === null) continue;
    out.add(action.verb);
    if (action.verb === "entrust" && action.request != null) out.add(`entrust:${action.request}`);
  }
  return out;
}
