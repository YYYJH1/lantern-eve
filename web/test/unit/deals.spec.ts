import { expect, test } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { hasMessage, type MessageKey, translate } from "../../src/i18n/index.ts";
import { zh } from "../../src/i18n/zh.ts";
import { dayNumber, type DealingContext, dealingNote, pledgeName, refusalKey } from "../../src/page/deals.ts";
import type { Name } from "../../src/page/scene.ts";
import { REASONS } from "../support/reasons.ts";

test.describe("the words for a refusal", () => {
  test("every reason of every action has a text of its own or a general one, in both languages, with nothing left to fill in", () => {
    for (const [action, reasons] of Object.entries(REASONS)) {
      for (const reason of reasons) {
        const key = refusalKey(action, reason);
        expect(key, `${action}/${reason}`).not.toBe("ack.other");
        for (const table of [en, zh]) {
          const text = table[key];
          expect(text.trim(), `${action}/${reason}`).not.toBe("");
          // The only value a refusal brings is the name of the person, and only the lines about a person use it.
          expect(translate(table === en ? "en" : "zh", key, { name: "X" }), `${action}/${reason}`).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });

  test("a reason that means different things to different actions has a text for each, and the general text is for the rest", () => {
    expect(refusalKey("entrust", "said_already")).toBe("ack.entrust.said_already");
    expect(refusalKey("speak", "said_already")).toBe("ack.speak.said_already");
    expect(refusalKey("tell", "refused")).toBe("ack.tell.refused");
    expect(refusalKey("entrust", "refused")).toBe("ack.entrust.refused");
    expect(refusalKey("look", "refused")).toBe("ack.look.refused");
    expect(refusalKey("promise", "said_already")).toBe("ack.said_already");
    expect(refusalKey("move", "talking")).toBe("ack.talking");
    expect(refusalKey("speak", "talking")).toBe("ack.talking");
  });

  test("speaking in public is `speak` whichever name the core is given", () => {
    for (const reason of REASONS.speak ?? []) expect(refusalKey("speak_publicly", reason)).toBe(refusalKey("speak", reason));
  });

  test("a reason that the page does not know falls back to the general text, as does an action it does not know", () => {
    expect(refusalKey("entrust", "gremlins")).toBe("ack.other");
    expect(refusalKey("dance", "gremlins")).toBe("ack.other");
    expect(refusalKey("dance", "talking")).toBe("ack.talking");
    expect(hasMessage("ack.entrust.gremlins")).toBe(false);
  });

  test("the people's own words in the core are echoed by the page: they said it already", () => {
    // The person says 我说过了 / "I have told you already", and the note says the same of them.
    expect(zh["ack.entrust.said_already"]).toContain("答复过");
    expect(en["ack.entrust.said_already"]).toContain("told you");
  });
});

test.describe("what a promise is", () => {
  test("is said in both languages for a stall, a role, a wage and a slot", () => {
    expect(pledgeName("stall", "front", 0)).toEqual({ zh: "一个前排摊位", en: "a front-row stall" });
    expect(pledgeName("stall", "back", 0)).toEqual({ zh: "一个后排摊位", en: "a back-row stall" });
    expect(pledgeName("role", "t_honor_light", 0)).toEqual({ zh: "点主灯的体面", en: "the honour of lighting the main lantern" });
    expect(pledgeName("role", "lead_lanterns", 0).en).toBe("leading the lantern parade");
    expect(pledgeName("role", "stage_words", 0).zh).toBe("台上说吉祥话");
    expect(pledgeName("wage", "", 20)).toEqual({ zh: "二十文工钱", en: "20 coins in wages" });
    expect(pledgeName("wage", "", 2)).toEqual({ zh: "两文工钱", en: "2 coins in wages" });
    expect(pledgeName("wage", "", 120)).toEqual({ zh: "120文工钱", en: "120 coins in wages" });
    expect(pledgeName("slot", "2", 0)).toEqual({ zh: "节目单上第二位", en: "slot 2 of the programme" });
    expect(pledgeName("slot", "12", 0)).toEqual({ zh: "节目单上第十二位", en: "slot 12 of the programme" });
  });

  test("is said as the core gave it when the page has no words for it", () => {
    expect(pledgeName("gift", "", 0)).toEqual({ zh: "gift", en: "gift" });
    expect(pledgeName("role", "new_role", 0)).toEqual({ zh: "role new_role", en: "role new_role" });
  });

  test("gives a game day as a numeral in Chinese and as digits in English", () => {
    expect(dayNumber(3)).toEqual({ zh: "三", en: "3" });
    expect(dayNumber(12)).toEqual({ zh: "十二", en: "12" });
  });
});

const NAMES: Readonly<Record<string, Name>> = {
  cha: { zh: "茶馆老板娘", en: "Teahouse Keeper" },
  p_teahouse: { zh: "茶馆", en: "Teahouse" },
  p_clan_hall: { zh: "祠堂", en: "Ancestral Hall" },
};

const ctx: DealingContext = {
  nameOf: (id) => NAMES[id] ?? { zh: id, en: id },
  playerId: "player",
};

/** What a note says in a language, with the values of the dealing put in. */
const said = (lang: "zh" | "en", key: MessageKey, values: Record<string, string | number | Name>): string =>
  translate(lang, key, Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === "object" ? v[lang] : v])));

test.describe("the words for what came of a dealing", () => {
  const event = (kind: string, rest: Record<string, unknown> = {}) => ({ kind, tick: 1, ...rest });

  test("a telling is noted by what the listener made of it, and a lie that was caught by the event that says so", () => {
    expect(dealingNote(event("told", { speaker: "player", listener: "cha", outcome: "took" }), ctx)).toMatchObject({ kind: "info", key: "note.told.took", values: { name: NAMES.cha } });
    expect(dealingNote(event("told", { speaker: "player", listener: "cha", outcome: "knew" }), ctx)?.key).toBe("note.told.knew");
    expect(dealingNote(event("told", { speaker: "player", listener: "cha", outcome: "doubted" }), ctx)?.key).toBe("note.told.doubted");
    expect(dealingNote(event("told", { speaker: "player", listener: "cha", outcome: "caught" }), ctx)).toBeNull();
    expect(dealingNote(event("lie_caught", { npc: "cha", prop: "p", trust: 4 }), ctx)).toMatchObject({ kind: "bad", key: "note.lieCaught", values: { name: NAMES.cha } });
  });

  test("the town's own tellings between neighbours are not the manager's", () => {
    expect(dealingNote(event("told", { speaker: "cha", listener: "he", outcome: "took" }), ctx)).toBeNull();
  });

  test("an entrusting is noted when the person agrees, once, and later when it is done, failed or taken back", () => {
    expect(dealingNote(event("entrusted", { npc: "cha", request: "lane", result: "agreed", pending: false }), ctx)?.key).toBe("note.entrust.agreed");
    expect(dealingNote(event("entrusted", { npc: "cha", request: "join", result: "agreed", pending: true }), ctx)?.key).toBe("note.entrust.pending");
    // A refusal is noted from the acknowledgement, and a testimony and the call of the clan have their own events.
    for (const result of ["refused", "hard", "said_already", "cannot"]) expect(dealingNote(event("entrusted", { npc: "cha", request: "lane", result }), ctx)).toBeNull();
    for (const request of ["testify", "convene"]) expect(dealingNote(event("entrusted", { npc: "cha", request, result: "agreed" }), ctx)).toBeNull();
    expect(dealingNote(event("entrust_done", { npc: "cha", request: "lane", result: "done" }), ctx)).toMatchObject({ kind: "info", key: "note.entrust.done" });
    expect(dealingNote(event("entrust_done", { npc: "cha", request: "lane", result: "cannot" }), ctx)).toMatchObject({ kind: "bad", key: "note.entrust.failed" });
    expect(dealingNote(event("entrust_withdrawn", { npc: "cha", request: "lane" }), ctx)).toMatchObject({ kind: "bad", key: "note.entrust.withdrawn" });
  });

  test("a testimony says how many things went into the notebook, and the call of the clan says the elder is on it", () => {
    expect(dealingNote(event("testified", { npc: "cha", items: ["e1"], entries: ["n3", "n4"] }), ctx)).toMatchObject({ key: "note.testified.some", values: { n: { zh: "两", en: "2" } } });
    expect(dealingNote(event("testified", { npc: "cha", items: ["e1"], entries: ["n3"] }), ctx)?.key).toBe("note.testified.one");
    expect(dealingNote(event("testified", { npc: "cha", items: ["e1"], entries: [] }), ctx)?.key).toBe("note.testified.none");
    expect(dealingNote(event("convened", { invited: ["zuzhang"] }), ctx)).toEqual({ kind: "info", key: "note.convened", values: {} });
  });

  test("a promise is noted with what it is and by which day, a wage with the coins the event carries, and its keeping or breaking", () => {
    const pledged = dealingNote(event("pledged", { npc: "cha", pledge: "k1", what: "stall", item: "front", amount: 0, due: 3 }), ctx);
    expect(pledged).toMatchObject({ kind: "info", key: "note.pledged", values: { name: NAMES.cha, what: { en: "a front-row stall" }, due: { zh: "三", en: "3" } } });
    const wage = dealingNote(event("pledged", { npc: "cha", pledge: "k2", what: "wage", item: "", amount: 20, due: 3 }), ctx);
    expect((wage?.values.what as Name).en).toBe("20 coins in wages");
    // An event with no amount has none to give, and the note still says what kind of promise it is.
    expect((dealingNote(event("pledged", { npc: "cha", pledge: "k9", what: "wage", due: 3 }), ctx)?.values.what as Name).en).toBe("0 coins in wages");
    expect(dealingNote(event("pledge_kept", { npc: "cha", pledge: "k1", what: "stall" }), ctx)).toMatchObject({ kind: "info", key: "note.pledgeKept" });
    expect(dealingNote(event("pledge_broken", { npc: "cha", pledge: "k1", what: "stall" }), ctx)).toMatchObject({ kind: "bad", key: "note.pledgeBroken" });
    // An empty promise is noted from the refusal that comes with it.
    expect(dealingNote(event("pledge_empty", { npc: "cha", what: "stall", item: "front", amount: 0 }), ctx)).toBeNull();
  });

  test("a speech names the place and how many took it in, and says when the truth is out; a table names the place", () => {
    expect(dealingNote(event("spoke", { venue: "p_teahouse", named: 7, accepted: 4, percent: 57, elder: 0, complete: false, cleared: false }), ctx)).toMatchObject({
      key: "note.spoke",
      values: { where: { zh: "茶馆", en: "teahouse" }, named: { zh: "七", en: "7" }, accepted: { zh: "四", en: "4" } },
    });
    expect(dealingNote(event("spoke", { venue: "p_clan_hall", named: 9, accepted: 8, cleared: true }), ctx)).toMatchObject({ key: "note.spoke.cleared", values: { where: { zh: "祠堂", en: "ancestral hall" } } });
    expect(dealingNote(event("feast", { venue: "p_teahouse", named: 6 }), ctx)).toMatchObject({ key: "note.feast", values: { where: { en: "teahouse" } } });
  });

  test("an event that is not a dealing has no note here", () => {
    for (const kind of ["dawn", "weather", "task_start", "flag", "goal", "agreed", "asked", "heard"]) expect(dealingNote(event(kind), ctx)).toBeNull();
  });

  test("every note has all of its values in both languages, so that no text is left with a gap in it", () => {
    const all = [
      event("told", { speaker: "player", listener: "cha", outcome: "took" }),
      event("told", { speaker: "player", listener: "cha", outcome: "knew" }),
      event("told", { speaker: "player", listener: "cha", outcome: "doubted" }),
      event("lie_caught", { npc: "cha" }),
      event("entrusted", { npc: "cha", request: "lane", result: "agreed", pending: false }),
      event("entrusted", { npc: "cha", request: "lane", result: "agreed", pending: true }),
      event("entrust_done", { npc: "cha", result: "done" }),
      event("entrust_done", { npc: "cha", result: "cannot" }),
      event("entrust_withdrawn", { npc: "cha" }),
      event("testified", { npc: "cha", entries: ["a", "b"] }),
      event("testified", { npc: "cha", entries: ["a"] }),
      event("testified", { npc: "cha", entries: [] }),
      event("convened", {}),
      event("pledged", { npc: "cha", pledge: "k1", what: "role", item: "lead_lanterns", amount: 0, due: 4 }),
      event("pledged", { npc: "cha", pledge: "k1", what: "slot", item: "3", amount: 0, due: 4 }),
      event("pledged", { npc: "cha", pledge: "k2", what: "wage", item: "", amount: 20, due: 4 }),
      event("pledge_kept", { npc: "cha" }),
      event("pledge_broken", { npc: "cha" }),
      event("spoke", { venue: "p_teahouse", named: 5, accepted: 3, cleared: false }),
      event("spoke", { venue: "p_teahouse", named: 5, accepted: 5, cleared: true }),
      event("feast", { venue: "p_clan_hall", named: 5 }),
    ];
    for (const one of all) {
      const note = dealingNote(one, ctx);
      expect(note, JSON.stringify(one)).not.toBeNull();
      if (note === null) continue;
      for (const lang of ["zh", "en"] as const) expect(said(lang, note.key, note.values), `${lang} ${note.key}`).not.toMatch(/\{\w+\}/);
    }
  });

  test("the notes read well: a few of them, in both languages", () => {
    const pledged = dealingNote(event("pledged", { npc: "cha", pledge: "k1", what: "stall", item: "front", amount: 0, due: 3 }), ctx);
    expect(pledged && said("en", pledged.key, pledged.values)).toBe("You promised Teahouse Keeper a front-row stall, by day 3.");
    expect(pledged && said("zh", pledged.key, pledged.values)).toBe("你许了茶馆老板娘一个前排摊位，第三日前兑现。");
    const spoke = dealingNote(event("spoke", { venue: "p_clan_hall", named: 9, accepted: 8, cleared: true }), ctx);
    expect(spoke && said("en", spoke.key, spoke.values)).toBe("You spoke at the ancestral hall. 8 of the 9 there took it in, and the truth is out.");
    expect(spoke && said("zh", spoke.key, spoke.values)).toBe("你在祠堂当众说了一番，在场九人里有八人听进去了，真相说清了。");
    const caught = dealingNote(event("lie_caught", { npc: "cha" }), ctx);
    expect(caught && said("en", caught.key, caught.values)).toBe("Teahouse Keeper caught you in a lie.");
    expect(caught && said("zh", caught.key, caught.values)).toBe("茶馆老板娘拆穿了你的谎话。");
  });
});
