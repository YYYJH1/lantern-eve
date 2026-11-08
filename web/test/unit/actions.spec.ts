import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { parseScene } from "../../src/page/scene.ts";
import { type Task } from "../../src/page/slice.ts";
import { actionLabel } from "../../src/page/ui/actions.ts";

const person = (id: string, zh: string, en: string) => ({ id, zh, en, role: { zh, en }, token: { zh: zh.slice(0, 1), en: en.slice(0, 1) }, family: null, home: null, work: null });

const SCENE = parseScene({
  scenario: "bridge",
  name: { zh: "澄溪镇", en: "Chengxi Town" },
  width: 40,
  height: 20,
  layers: { terrain: { rows: [], legend: [] }, buildings: [], barriers: [] },
  places: [
    { id: "p_teahouse", kind: "teahouse", indoor: true, rect: [30, 5, 4, 3], door: [31, 8], stands: [], cells: [], zh: "茶馆", en: "Teahouse" },
    { id: "p_bridge", kind: "bridge", indoor: false, rect: [10, 5, 4, 3], door: [11, 8], stands: [], cells: [], zh: "石桥", en: "Stone Bridge" },
  ],
  cast: [
    person("li_da", "李大", "Li Da"),
    person("li_laotai", "李老太", "Granny Li"),
    person("zhou_zhanggui", "周掌柜", "Shopkeeper Zhou"),
    person("miaozhu", "庙祝", "Temple Keeper"),
    person("gengfu", "更夫", "Watchman"),
    person("zhou_dalang", "周家大郎", "Zhou Dalang"),
    person("zhou_erlang", "周家二郎", "Zhou Erlang"),
    person("li_xiaomei", "李小妹", "Li Xiaomei"),
    person("zuzhang", "族长", "Clan Elder"),
  ],
  items: [
    { id: "bamboo", zh: "竹料", en: "Bamboo" },
    { id: "timber", zh: "木料", en: "Timber" },
  ],
});

const task = (action: Task["action"]): Task => ({ id: "t", kind: "need", job: null, text: { zh: "甲", en: "A" }, why: null, next: null, state: "open", blocker: null, action, window: null, expected: null });
const act = (verb: string, over: Record<string, unknown> = {}): Task["action"] => ({ verb, npc: null, place: null, item: null, ...over });

const label = (action: Task["action"], lang: "en" | "zh"): string => {
  setLang(lang);
  return actionLabel(task(action), SCENE, lang);
};

test.afterEach(() => setLang("en"));

test.describe("the button of a task that asks a person for something", () => {
  const CASES: Array<[string, Task["action"], string, string]> = [
    ["material, bamboo", act("entrust", { npc: "li_da", item: "bamboo", request: "material" }), "请李大送一批竹料", "Ask Li Da to send a batch of bamboo"],
    ["material, timber", act("entrust", { npc: "zhou_zhanggui", item: "timber", request: "material" }), "请周掌柜送一批木料", "Ask Shopkeeper Zhou to send a batch of timber"],
    ["lend", act("entrust", { npc: "li_laotai", item: "bamboo", request: "lend" }), "请李老太借出竹料", "Ask Granny Li to lend the bamboo"],
    ["lane", act("entrust", { npc: "miaozhu", request: "lane" }), "请庙祝开庙后夹道", "Ask Temple Keeper to open the lane behind the temple"],
    ["testify", act("entrust", { npc: "gengfu", request: "testify" }), "请更夫说说看见了什么", "Ask Watchman to say what they saw"],
    ["join", act("entrust", { npc: "zhou_dalang", request: "join" }), "请周家大郎来帮忙", "Ask Zhou Dalang to help out"],
    ["persuade", act("entrust", { npc: "li_xiaomei", request: "persuade", target: "zhou_erlang" }), "请李小妹去劝周家二郎", "Ask Li Xiaomei to talk Zhou Erlang round"],
    ["convene", act("entrust", { npc: "zuzhang", request: "convene" }), "请族长召集族人", "Ask Clan Elder to call the clan"],
  ];

  for (const [name, action, zh, en] of CASES) {
    test(`says the ${name} request in both languages`, () => {
      expect(label(action, "zh")).toBe(zh);
      expect(label(action, "en")).toBe(en);
    });
  }

  test("says what the request is about by the target it names, and a different target is a different button", () => {
    expect(label(act("entrust", { npc: "li_xiaomei", request: "persuade", target: "zhou_dalang" }), "zh")).toBe("请李小妹去劝周家大郎");
    expect(label(act("entrust", { npc: "li_xiaomei", request: "persuade", target: "zhou_dalang" }), "en")).toBe("Ask Li Xiaomei to talk Zhou Dalang round");
  });

  test("is the plain request for a task that names no request, one the page does not know, or one that lacks what it is about", () => {
    expect(label(act("entrust", { npc: "li_laotai", item: "bamboo" }), "en")).toBe("Ask Granny Li for help");
    expect(label(act("entrust", { npc: "li_laotai", item: "bamboo" }), "zh")).toBe("请李老太帮忙");
    expect(label(act("entrust", { npc: "li_da", request: "swap" }), "zh")).toBe("请李大帮忙");
    // A delivery or a loan needs the thing, and persuading needs the person.
    expect(label(act("entrust", { npc: "li_da", request: "material" }), "en")).toBe("Ask Li Da for help");
    expect(label(act("entrust", { npc: "li_laotai", request: "lend" }), "en")).toBe("Ask Granny Li for help");
    expect(label(act("entrust", { npc: "li_xiaomei", request: "persuade" }), "zh")).toBe("请李小妹帮忙");
    // A person the scene does not name is the id; a scene without people has only ids.
    expect(label(act("entrust", { npc: "li_wu", request: "join" }), "en")).toBe("Ask li_wu to help out");
    setLang("en");
    expect(actionLabel(task(act("entrust", { npc: "li_da", item: "bamboo", request: "material" })), null, "en")).toBe("Ask li_da to send a batch of bamboo");
  });
});

test.describe("the button of a task that speaks in public", () => {
  test("says the statement with the evidence, the table for the two families and the clearing up of a claim, in both languages", () => {
    expect(label(act("speak", { kind: "evidence" }), "zh")).toBe("当众说清");
    expect(label(act("speak", { kind: "evidence" }), "en")).toBe("Set the record straight in public");
    expect(label(act("speak", { kind: "meal" }), "zh")).toBe("摆一桌和解饭");
    expect(label(act("speak", { kind: "meal" }), "en")).toBe("Lay a table for peace");
    expect(label(act("speak", { kind: "clarify" }), "zh")).toBe("当众澄清");
    expect(label(act("speak", { kind: "clarify" }), "en")).toBe("Clear up the claim in public");
  });

  test("is speaking up for a task that names no kind or one the page does not know", () => {
    expect(label(act("speak"), "zh")).toBe("当众说");
    expect(label(act("speak"), "en")).toBe("Speak up");
    expect(label(act("speak", { kind: "sing" }), "en")).toBe("Speak up");
  });
});

test.describe("the button of a task that keeps a promise", () => {
  test("says the promise is kept in person with the person it was made to, and a promise that is only made is the old button", () => {
    const keep = act("promise", { npc: "li_da", item: "k1", kind: "keep" });
    expect(label(keep, "zh")).toBe("兑现对李大的许诺");
    expect(label(keep, "en")).toBe("Keep your promise to Li Da");
    expect(label(act("promise", { npc: "li_da" }), "en")).toBe("Promise Li Da something");
  });
});

test.describe("the button of the other tasks", () => {
  test("says what it did before the days after: a talk, a walk to a place, a look, and the verbs of a talk", () => {
    expect(label(act("talk", { npc: "li_laotai" }), "en")).toBe("Talk to Granny Li");
    expect(label(act("move", { place: "p_teahouse" }), "zh")).toBe("去茶馆");
    expect(label(act("move", { place: "p_teahouse" }), "en")).toBe("Go to Teahouse");
    expect(label(act("look", { item: "bamboo" }), "en")).toBe("Look at Bamboo");
    expect(label(act("ask_source", { npc: "li_laotai" }), "zh")).toBe("问李老太听谁说的");
    expect(label(act("judge"), "zh")).toBe("去见闻簿里判一判");
    expect(label(act("judge"), "en")).toBe("Judge the lines in the notebook");
    expect(label(act("dance"), "en")).toBe("Do it");
    expect(actionLabel({ ...task(null) }, SCENE, "en")).toBe("");
  });
});
