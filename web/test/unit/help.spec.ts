import { expect, test } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { hasMessage, setLang, translate } from "../../src/i18n/index.ts";
import { zh } from "../../src/i18n/zh.ts";
import { readHud, readVerbsOff, readVerbsOffAny } from "../../src/page/hud.ts";
import { type HintContext, HINTS, Hints } from "../../src/page/hints.ts";
import { Play } from "../../src/page/play.ts";
import type { Scene } from "../../src/page/scene.ts";
import type { Task } from "../../src/page/slice.ts";
import { actsOfAction, GIFT_FROM_DAY, liveAsks, TEACH_ACTS, TEACH_DEFS, TEACH_TARGET } from "../../src/page/teach.ts";
import { actState, MAP_ACTS, offWords } from "../../src/page/ui/map-acts.ts";
import { pairingStep } from "../../src/page/ui/pairing-text.ts";
import { crewShortfall, isCrewTask, shortfallWords } from "../../src/page/ui/slip-text.ts";
import { frameAt, feedFrame, FakeClient } from "../support/fake-client.ts";

// The help of the page, with no page: what the bridge's crew still lacks, the reasons the core gives for an act that is not on
// offer, the cards that teach an act when it first matters, and the steps of the pairing.

class MemoryStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}
const globals = globalThis as unknown as { localStorage?: MemoryStorage };
test.beforeEach(() => {
  globals.localStorage = new MemoryStorage();
});
test.afterEach(() => {
  delete globals.localStorage;
  setLang("en");
});

const name = (text: string) => ({ zh: text, en: text });
const task = (id: string, over: Partial<Task> = {}): Task => ({ id, kind: "need", job: "bridge", text: name(id), why: null, next: null, state: "open", blocker: null, action: null, window: null, expected: null, ...over });
const SCENE = { families: new Map([["fam_li", { zh: "李家", en: "Li family" }], ["fam_zhou", { zh: "周家", en: "Zhou family" }]]) } as unknown as Scene;

test.describe("what the crew of the bridge still lacks", () => {
  test("is read from the bridge of the frame: how many helpers, and which families have nobody", () => {
    const bridge = readHud({ bridge: { done: 0, need: 5, percent: 0, state: "broken", short: 5, families_missing: ["fam_li", "fam_zhou"] } }).bridge;
    expect(bridge).toMatchObject({ short: 5, familiesMissing: ["fam_li", "fam_zhou"] });
    // A frame from before it says nothing, which is not nothing missing.
    const old = readHud({ bridge: { done: 1, need: 5, percent: 20 } }).bridge;
    expect(old).toMatchObject({ short: null, familiesMissing: [] });
    expect(crewShortfall(old)).toBeNull();
    // The number is not the item the bridge lacks.
    expect(bridge?.lackingId).toBeNull();
    expect(bridge?.lacking).toBeNull();
    // A complete crew lacks nothing, and a crew that is full in number but has no one of a family still lacks that.
    expect(crewShortfall(readHud({ bridge: { short: 0, families_missing: [] } }).bridge)).toBeNull();
    expect(crewShortfall(readHud({ bridge: { short: 0, families_missing: ["fam_zhou"] } }).bridge)).toEqual({ short: 0, families: ["fam_zhou"] });
  });

  test("is said in two short sentences, with the number as the town says it and the family by its name, in both languages", () => {
    const lack = { short: 3, families: ["fam_zhou"] };
    setLang("zh");
    expect(shortfallWords("zh", SCENE, lack)).toBe("帮手还差三个。周家还没人来帮忙。");
    expect(shortfallWords("zh", SCENE, { short: 2, families: ["fam_li", "fam_zhou"] })).toBe("帮手还差两个。李家和周家还没人来帮忙。");
    expect(shortfallWords("zh", SCENE, { short: 0, families: ["fam_zhou"] })).toBe("周家还没人来帮忙。");
    setLang("en");
    expect(shortfallWords("en", SCENE, lack)).toBe("Helpers still missing: 3. Nobody from the Zhou family has come to help yet.");
    expect(shortfallWords("en", SCENE, { short: 1, families: [] })).toBe("Helpers still missing: 1.");
  });

  test("is said by the slip only where the bridge is the thing: a task about the helpers or a morning of work, not the bamboo", () => {
    expect(isCrewTask(task("t_helpers", { action: { verb: "rally", npc: null, place: null, item: null } }))).toBe(true);
    expect(isCrewTask(task("t_x", { action: { verb: "entrust", npc: "zhou_dalang", place: null, item: null, request: "join" } }))).toBe(true);
    expect(isCrewTask(task("t_y", { action: { verb: "entrust", npc: "li_xiaomei", place: null, item: null, request: "persuade", target: "zhou_erlang" } }))).toBe(true);
    expect(isCrewTask(task("t_work_3"))).toBe(true);
    expect(isCrewTask(task("t_bamboo_rest", { action: { verb: "entrust", npc: "li_da", place: null, item: "bamboo", request: "material" } }))).toBe(false);
    expect(isCrewTask(task("t_helpers", { job: "truth" }))).toBe(false);
    expect(isCrewTask(null)).toBe(false);
  });
});

test.describe("the reasons an act is not on offer", () => {
  test("are read as the core gives them, and a reason the page has no words for is left out", () => {
    const off = readVerbsOff({ verbs_off: { listen: "far", look: "busy", speak: "not_yet", rally: "done", gift: "gift_full", track: "mystery", leave: 3 } });
    expect([...off.entries()]).toEqual([
      ["listen", "far"],
      ["look", "busy"],
      ["speak", "not_yet"],
      ["rally", "done"],
      ["gift", "gift_full"],
    ]);
    expect(readVerbsOff({}).size).toBe(0);
    expect(readVerbsOff({ verbs_off: "far" }).size).toBe(0);
  });

  test("are kept as they are for the talk, which says a reason it has no words for in its general line", () => {
    const off = readVerbsOffAny({ verbs_off: { tell: "gremlins", gift: "gift_full", track: "", leave: 3 } });
    expect([...off.entries()]).toEqual([
      ["tell", "gremlins"],
      ["gift", "gift_full"],
    ]);
    expect(readVerbsOffAny({}).size).toBe(0);
  });

  test("give each act of the map its state: on, or off with the reason of whichever of its verbs has one", () => {
    const off = readVerbsOff({ verbs_off: { listen: "far", look: "far", rally: "talking", speak: "not_yet", speak_publicly: "not_yet" } });
    expect(MAP_ACTS).toEqual(["listen", "look", "rally", "speak"]);
    expect(actState("listen", new Set(["move"]), off)).toEqual({ on: false, reason: "far" });
    expect(actState("listen", new Set(["listen"]), off)).toEqual({ on: true, reason: null });
    // Speaking in public is one act under two names, and either name on the list is the act.
    expect(actState("speak", new Set(["speak_publicly"]), off).on).toBe(true);
    expect(actState("speak", new Set(), off)).toEqual({ on: false, reason: "not_yet" });
    // A frame that gives no reason has none to give.
    expect(actState("look", new Set(), new Map())).toEqual({ on: false, reason: null });
  });

  test("have words in both languages for every reason an act of the map can have, the act's own where it has them", () => {
    const reasons: Record<string, string[]> = { listen: ["talking", "busy", "far"], look: ["talking", "busy", "far"], rally: ["talking", "busy", "done"], speak: ["talking", "busy", "far", "night", "not_yet"] };
    for (const [act, list] of Object.entries(reasons)) {
      for (const reason of list) {
        setLang("en");
        const english = offWords(act as "listen", reason as "far");
        setLang("zh");
        const chinese = offWords(act as "listen", reason as "far");
        expect(english, `${act} ${reason}`).not.toBe("");
        expect(chinese, `${act} ${reason}`).toMatch(/[一-鿿]/);
        expect(english, `${act} ${reason}`).not.toBe(translate("en", "act.off.other"));
      }
    }
    // The same reason is said another way for an act it means another thing for.
    setLang("en");
    expect(offWords("listen", "far")).not.toBe(offWords("speak", "far"));
    expect(hasMessage("act.off.speak.far")).toBe(true);
    // A reason that has no words of its own for an act has the common ones.
    expect(offWords("look", "talking")).toBe(translate("en", "act.off.talking"));
  });
});

test.describe("the cards that teach an act", () => {
  const idle = (over: Partial<HintContext> = {}): HintContext => ({ tasks: new Map(), tracked: null, entries: [], verbs: new Set(), talking: null, follow: false, leaves: false, promised: 0, leads: 0, day: 1, taught: new Set(), asks: new Set(), live: new Set(), ...over });
  const given = (ctx: HintContext): string[] => new Hints().check(ctx, 1, { day: 1, hour: 8, minute: 0 }, 0).map((entry) => entry.id);

  test("are one for each act, with the button it lights, in both languages", () => {
    expect(TEACH_ACTS).toEqual(["ask", "ask_source", "entrust", "convene", "speak", "gift", "rally", "listen", "look"]);
    expect(TEACH_DEFS.map((def) => def.act)).toEqual([...TEACH_ACTS]);
    for (const def of TEACH_DEFS) {
      expect(def.target, def.id).toBe(TEACH_TARGET[def.act as keyof typeof TEACH_TARGET]);
      expect(def.title, def.id).toBeDefined();
      for (const key of [def.title, def.text]) {
        expect(key !== undefined && hasMessage(key), `${def.id} ${String(key)}`).toBe(true);
      }
      // The card is part of the hints, so the menu lists it and lights it again.
      expect(HINTS).toContain(def);
    }
    // The call for helpers and the request to the elder are two cards, each of which says it is not the other.
    expect(zh["teach.rally.text"]).toContain("请族长召集族人");
    expect(zh["teach.convene.text"]).toContain("召集帮手");
    expect(en["teach.rally.text"]).toContain("asking the elder");
    expect(en["teach.convene.text"]).toContain("Call for helpers");
  });

  test("come when the act first matters and not before: the acts of a talk in a talk, the others where the frame offers them", () => {
    expect(given(idle())).toEqual([]);
    expect(given(idle({ talking: "li_da", verbs: new Set(["ask"]) }))).toEqual(["teach.ask"]);
    expect(given(idle({ verbs: new Set(["ask"]) }))).toEqual([]);
    // Following a telling back is offered only once there is a telling to follow.
    expect(given(idle({ talking: "li_da", verbs: new Set(["ask_source"]), follow: true }))).toEqual(["teach.ask_source"]);
    // The core lists the act wherever there is a telling to follow; with no answer to follow in this talk there is no phrase to point at.
    expect(given(idle({ talking: "li_da", verbs: new Set(["ask_source"]) }))).toEqual([]);
    // A request is taught where the town puts one forward for this person, and the elder's call as its own card.
    expect(given(idle({ talking: "li_da", verbs: new Set(["entrust"]) }))).toEqual([]);
    expect(given(idle({ talking: "li_da", verbs: new Set(["entrust"]), asks: new Set(["material"]) }))).toEqual(["teach.entrust"]);
    expect(given(idle({ talking: "zuzhang", verbs: new Set(["entrust"]), asks: new Set(["convene"]) }))).toEqual(["teach.entrust", "teach.convene"]);
    expect(given(idle({ verbs: new Set(["speak_publicly"]) }))).toEqual(["teach.speak"]);
    expect(given(idle({ verbs: new Set(["listen"]) }))).toEqual(["teach.listen"]);
    expect(given(idle({ verbs: new Set(["look"]) }))).toEqual(["teach.look"]);
  });

  test("read which acts an action of the manager is: the acts that have a card, and the request to the elder as two", () => {
    expect(actsOfAction({ type: "ask", topic: "li_er" })).toEqual(["ask"]);
    expect(actsOfAction({ type: "ask_source", entry: "n1" })).toEqual(["ask_source"]);
    expect(actsOfAction({ type: "entrust", kind: "material" })).toEqual(["entrust"]);
    expect(actsOfAction({ type: "entrust", kind: "convene" })).toEqual(["entrust", "convene"]);
    expect(actsOfAction({ type: "rally" })).toEqual(["rally"]);
    expect(actsOfAction({ type: "speak", kind: "meal" })).toEqual(["speak"]);
    // The others have no card: moving, talking, telling, promising.
    for (const type of ["move", "talk", "leave", "tell", "promise", "judge"]) expect(actsOfAction({ type }), type).toEqual([]);
  });

  test("teach the gift from the second day, and the call for helpers once a task asks for it", () => {
    const talk = { talking: "li_da", verbs: new Set(["gift"]) };
    expect(GIFT_FROM_DAY).toBe(2);
    expect(given(idle({ ...talk, day: 1 }))).toEqual([]);
    expect(given(idle({ ...talk, day: 2 }))).toEqual(["teach.gift"]);
    // The call is there from the start, and is taught when the tasks of the day ask for it.
    expect(given(idle({ verbs: new Set(["rally"]) }))).toEqual([]);
    const live = liveAsks([task("t_helpers", { action: { verb: "rally", npc: null, place: null, item: null } })]);
    expect([...live]).toEqual(["rally"]);
    expect(given(idle({ verbs: new Set(["rally"]), live }))).toEqual(["teach.rally"]);
    // A task that is done asks for nothing, and a request is told by its kind.
    expect([...liveAsks([task("t_a", { state: "done", action: { verb: "rally", npc: null, place: null, item: null } })])]).toEqual([]);
    expect([...liveAsks([task("t_b", { action: { verb: "entrust", npc: "zuzhang", place: null, item: null, request: "convene" } })])]).toEqual(["entrust", "entrust:convene"]);
  });

  test("are not given for an act that was taught or used, and each is given once", () => {
    const ctx = idle({ talking: "li_da", verbs: new Set(["ask", "ask_source"]), follow: true, taught: new Set(["ask"]) });
    expect(given(ctx)).toEqual(["teach.ask_source"]);
    const hints = new Hints();
    expect(hints.check(ctx, 1, { day: 1, hour: 8, minute: 0 }, 0).map((g) => [g.id, g.act, g.title])).toEqual([["teach.ask_source", "ask_source", "teach.ask_source.title"]]);
    expect(hints.check(ctx, 2, { day: 1, hour: 8, minute: 0 }, 0)).toEqual([]);
    // What is true when the game begins is not news: the card of an act that is of use then waits for the next time it is, and teaches nothing yet.
    const early = new Hints();
    early.absorb(idle({ verbs: new Set(["look", "listen"]) }));
    expect(early.check(idle({ verbs: new Set(["look", "listen"]) }), 1, { day: 1, hour: 8, minute: 0 }, 0)).toEqual([]);
    expect(early.check(idle({ verbs: new Set(["look"]) }), 2, { day: 1, hour: 8, minute: 0 }, 0)).toEqual([]);
    expect(early.check(idle({ verbs: new Set(["look", "listen"]) }), 3, { day: 1, hour: 8, minute: 0 }, 0).map((g) => g.id)).toEqual(["teach.listen"]);
  });

  test("learn an act from its use, keep what was taught per browser, and show it all again when the tutorial is asked for again", () => {
    const client = new FakeClient();
    const play = new Play(client.host);
    play.guide.enabled = true;
    // Using an act is learning it, and the request to the elder to call the clan is two acts.
    play.send({ type: "ask", topic: "li_er" });
    play.send({ type: "entrust", kind: "convene" });
    play.send({ type: "move", x: 1, y: 2 });
    expect([...play.guide.taught].sort()).toEqual(["ask", "convene", "entrust"]);
    expect(globals.localStorage?.getItem("lantern.taught")).toBe("ask,convene,entrust");
    // Another page of the same browser starts with them.
    const next = new Play(new FakeClient().host);
    expect([...next.guide.taught].sort()).toEqual(["ask", "convene", "entrust"]);
    // The page of a recording acts for nobody, and learns nothing.
    const recording = new Play(new FakeClient().host, true);
    recording.guide.noteUsed({ type: "look", at: "t_rail" });
    expect(recording.guide.taught.has("look")).toBe(false);
    // The help asked for again is all of it.
    play.guide.restartWithTutorial(() => undefined);
    expect(play.guide.taught.size).toBe(0);
    expect(globals.localStorage?.getItem("lantern.taught")).toBe("");
  });

  test("are given by the frame, one at a time, once, and a card of the story is not taught", () => {
    const client = new FakeClient();
    client.state.scene = null;
    const play = new Play(client.host);
    play.guide.enabled = true;
    // The first frame is not news: what is true already is taken as given.
    feedFrame(client, frameAt(1, 8, 0, { hud: { verbs: ["move"] } }));
    // A pair that talks within hearing: the card of listening in is lit, and what it teaches is learned the moment it is given.
    feedFrame(client, frameAt(1, 8, 1, { hud: { verbs: ["move", "listen"] } }));
    expect(play.guide.hints.log.map((entry) => entry.id)).toEqual(["teach.listen"]);
    expect(play.guide.hints.lit).toMatchObject({ id: "teach.listen", target: "verb-listen" });
    expect(play.guide.taught.has("listen")).toBe(true);
    feedFrame(client, frameAt(1, 8, 2, { hud: { verbs: ["move", "listen"] } }));
    expect(play.guide.hints.log).toHaveLength(1);
    // The cards are off with the hints.
    const quiet = new Play(new FakeClient().host);
    quiet.guide.enabled = true;
    quiet.guide.setHintsOn(false);
    expect(quiet.guide.hintsOn).toBe(false);
  });
});

test.describe("the steps of the pairing", () => {
  test("wait first for a claim, then for a line shown against it, then for the answer", () => {
    expect(pairingStep({ a: null, b: null })).toBe("claim");
    expect(pairingStep({ a: "n1", b: null })).toBe("claim");
    expect(pairingStep({ a: null, b: "n2" })).toBe("show");
    expect(pairingStep({ a: "n1", b: "n2" })).toBe("answer");
  });

  test("have the words of the three answers, and a small example under each, with no he or she and no word of the game's grammar", () => {
    for (const relation of ["unsupported", "contradicts", "mismatch"]) {
      for (const key of [`pairing.ans.${relation}`, `pairing.eg.${relation}`, `pairing.ok.${relation}`] as const) {
        expect(hasMessage(key), key).toBe(true);
      }
    }
    expect(zh["pairing.ans.unsupported"]).toBe("撑不起这句话");
    expect(zh["pairing.ans.contradicts"]).toBe("和这句话相反");
    expect(zh["pairing.ans.mismatch"]).toBe("传走样了");
    expect(zh["pairing.wrong"]).toBe("不对。再想想，这两句能不能都对？");
    // Nothing the player reads in the pairing speaks of hands, chains of sources, propositions or grasp.
    for (const key of Object.keys(zh).filter((k) => /^(pairing|tut\.(granny|clerk|pair)|teach|cue|act|crew|blank)\./.test(k))) {
      expect(zh[key as keyof typeof zh], key).not.toMatch(/见闻(?!簿)|命题|第几手|[一二三四]手|来源链|把握/);
    }
  });
});
