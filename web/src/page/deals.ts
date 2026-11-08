/**
 * What the page says of the manager's dealings with people: the words for the reasons the core gives
 * when it refuses an action, and for the events that come of telling, entrusting, promising and
 * speaking in public (see core/lantern_core/world/bridge/speak.py, lies.py, entrust.py, pledges.py and
 * assembly.py). A reason or an event the page has no words for is left to the caller's fallback.
 */
import type { CoreEvent } from "../shared/protocol.ts";
import { hasMessage, type MessageKey, translate } from "../i18n/index.ts";
import type { Name } from "./scene.ts";
import { zhNumeral } from "./ui/format.ts";
import { countName } from "./ui/paper-text.ts";

/** The words of a note: the text of the page under `key`, and the values that go into it. */
export interface Dealing {
  /** `bad` is news that goes against the player: a lie found out, a promise that lapsed. */
  kind: "info" | "bad";
  key: MessageKey;
  values: Record<string, string | number | Name>;
}

export interface DealingContext {
  /** The name of a person, a place or a thing, in both languages. */
  nameOf(id: string): Name;
  /** The id the core gives the manager in its records of who said what. */
  playerId: string;
}

/**
 * The key of the text for a refusal: one for this action and this reason, else one for the reason
 * alone, else the general text. `speak_publicly` is `speak` under another name.
 */
export function refusalKey(type: string, reason: string): MessageKey {
  const action = type === "speak_publicly" ? "speak" : type;
  const key = [`ack.${action}.${reason}`, `ack.${reason}`].find((k): k is MessageKey => hasMessage(k));
  return key ?? "ack.other";
}

/** A value of a text that is built for both languages at once: a number or a string as it is, or a name, which has one form in each. */
type Slot = string | number | Name;
const inLanguage = (values: Record<string, Slot> | undefined, lang: "zh" | "en"): Record<string, string | number> | undefined =>
  values === undefined ? undefined : Object.fromEntries(Object.entries(values).map(([key, value]) => [key, typeof value === "object" ? value[lang] : value]));
const both = (key: MessageKey, values?: Record<string, Slot>): Name => ({ zh: translate("zh", key, inLanguage(values, "zh")), en: translate("en", key, inLanguage(values, "en")) });

/** What a promise is, in both languages: "a front-row stall", "10 coins in wages", "三十文工钱". An unknown kind is said as the core gave it. */
export function pledgeName(what: string, item: string, amount: number): Name {
  if (what === "stall" && hasMessage(`pledge.stall.${item}`)) return both(`pledge.stall.${item}` as MessageKey);
  if (what === "role" && hasMessage(`pledge.role.${item}`)) return both(`pledge.role.${item}` as MessageKey);
  if (what === "wage") return both("pledge.wage", { amount: countName(amount) });
  if (what === "slot") return both("pledge.slot", { n: slotName(item) });
  const raw = item === "" ? what : `${what} ${item}`;
  return { zh: raw, en: raw };
}

/** The place in the programme that a promise is for (the core names it by a digit), as a number in the language: 3, 三. */
const slotName = (item: string): Name => (/^\d+$/.test(item) ? dayNumber(Number(item)) : { zh: item, en: item });

/** A game day, as a number in the language: 3, 三. */
export const dayNumber = (day: number): Name => ({ zh: zhNumeral(day), en: String(day) });

/** What came of a telling, by the `outcome` of the event. */
const TOLD = new Map<string, MessageKey>([
  ["took", "note.told.took"],
  ["knew", "note.told.knew"],
  ["doubted", "note.told.doubted"],
]);

const lowered = (name: Name): Name => ({ zh: name.zh, en: name.en.toLowerCase() });

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0);

/** The note for an event of the manager's dealings, or null for an event that has none. */
export function dealingNote(event: CoreEvent, ctx: DealingContext): Dealing | null {
  const who = (id: unknown): Name => ctx.nameOf(text(id));
  switch (event.kind) {
    case "told": {
      // The town's own tellings, between neighbours, are not the manager's.
      if (event.speaker !== ctx.playerId) return null;
      const key = TOLD.get(text(event.outcome));
      // A lie that was caught has the note of the event that says so.
      return key === undefined ? null : { kind: "info", key, values: { name: who(event.listener) } };
    }
    case "lie_caught":
      return { kind: "bad", key: "note.lieCaught", values: { name: who(event.npc) } };
    case "entrusted":
      // A refusal is noted from the acknowledgement. A testimony and the call of the clan have notes of their own.
      if (event.result !== "agreed" || event.request === "testify" || event.request === "convene") return null;
      return { kind: "info", key: event.pending === true ? "note.entrust.pending" : "note.entrust.agreed", values: { name: who(event.npc) } };
    case "entrust_done":
      return event.result === "done" ? { kind: "info", key: "note.entrust.done", values: { name: who(event.npc) } } : { kind: "bad", key: "note.entrust.failed", values: { name: who(event.npc) } };
    case "entrust_withdrawn":
      return { kind: "bad", key: "note.entrust.withdrawn", values: { name: who(event.npc) } };
    case "testified": {
      const written = Array.isArray(event.entries) ? event.entries.length : 0;
      const key = written === 0 ? "note.testified.none" : written === 1 ? "note.testified.one" : "note.testified.some";
      return { kind: "info", key, values: { name: who(event.npc), n: countName(written) } };
    }
    case "convened":
      return { kind: "info", key: "note.convened", values: {} };
    case "pledged":
      return {
        kind: "info",
        key: "note.pledged",
        values: { name: who(event.npc), what: pledgeName(text(event.what), text(event.item), count(event.amount)), due: dayNumber(count(event.due)) },
      };
    case "pledge_kept":
      return { kind: "info", key: "note.pledgeKept", values: { name: who(event.npc) } };
    case "pledge_broken":
      return { kind: "bad", key: "note.pledgeBroken", values: { name: who(event.npc) } };
    case "spoke":
      return {
        kind: "info",
        key: event.cleared === true ? "note.spoke.cleared" : "note.spoke",
        values: { where: lowered(who(event.venue)), named: countName(count(event.named)), accepted: countName(count(event.accepted)) },
      };
    case "feast":
      return { kind: "info", key: "note.feast", values: { where: lowered(who(event.venue)) } };
    default:
      return null;
  }
}
