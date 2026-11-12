import { expect, test } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { type Lang, setLang, translate } from "../../src/i18n/index.ts";
import { zh } from "../../src/i18n/zh.ts";
import { readFrame } from "../../src/page/frame.ts";
import { placeTags } from "../../src/page/map/tag-layout.ts";
import { Introductions } from "../../src/page/meetings.ts";
import { readNotebook } from "../../src/page/notebook.ts";
import { firstClause, OPENING_SIX, openingSix, readStamp } from "../../src/page/people.ts";
import { knownIds, readRelations, relationRows, type Relation, WHY } from "../../src/page/relations.ts";
import { parseScene } from "../../src/page/scene.ts";
import type { Frame } from "../../src/shared/protocol.ts";
import { itemsWords, knownPeople, roleNamesFamily, stampWords, whenWords } from "../../src/page/ui/people-text.ts";
import { sourceWords } from "../../src/page/ui/source-text.ts";

const n = (zh: string, en: string) => ({ zh, en });

/** The scene of the bridge town, as far as the people book reads it: three places, two families, four small things, and the six of the opening page among the cast. */
function scene() {
  const person = (id: string, zhName: string, enName: string, role: [string, string], family: string | null, intro: [string, string]) => ({ id, zh: zhName, en: enName, role: { zh: role[0], en: role[1] }, family, intro: { zh: intro[0], en: intro[1] }, home: "p_li_house", work: "p_li_house" });
  return parseScene({
    scenario: "bridge",
    name: n("灯会七日", "Seven Days to the Lantern Festival"),
    families: [
      { id: "fam_li", zh: "李家", en: "Li Family" },
      { id: "fam_zhou", zh: "周家", en: "Zhou Family" },
    ],
    gifts: [
      { id: "tea", zh: "茶叶", en: "tea leaves" },
      { id: "pastry", zh: "点心", en: "pastries" },
    ],
    places: [
      { id: "p_li_house", kind: "house", rect: [2, 2, 13, 6], door: [7, 5], zh: "李家宅", en: "Li Family House" },
      { id: "p_teahouse", kind: "teahouse", rect: [31, 10, 7, 5], door: [34, 14], zh: "茶馆", en: "Teahouse" },
    ],
    cast: [
      person("zhou_huoji", "周家伙计", "Zhou's Clerk", ["在周家帮工", "Works for the Zhou family"], "fam_zhou", ["在周家帮工好些年。", "Has worked for the Zhou family for years."]),
      person("li_er", "李二", "Li Er", ["李家次子", "Second Li son"], "fam_li", ["李家次子，在扎灯坊帮工。", "Second Li son. Pastes lanterns."]),
      person("zuzhang", "族长", "Clan Elder", ["族长", "Elder of the clan"], null, ["澄溪镇辈分最高的长辈。", "The most senior elder in Chengxi."]),
      person("li_laotai", "李老太", "Granny Li", ["李家老太太", "Matriarch of the Li family"], "fam_li", ["李家的老太太。", "Head of the Li family."]),
      person("cha_laoban", "茶馆老板娘", "Teahouse Keeper", ["茶馆老板娘", "Keeper of the teahouse"], null, ["河边茶馆的老板娘。", "Keeper of the teahouse by the river."]),
      person("zhou_zhanggui", "周掌柜", "Shopkeeper Zhou", ["周家掌柜，管木料", "Head of the Zhou shop, keeper of the timber"], "fam_zhou", ["周家的掌柜。", "Head of the Zhou shop."]),
      person("li_da", "李大", "Li Da", ["李家长子，管竹料", "Eldest Li son, keeper of the bamboo"], "fam_li", ["李家长子。", "Eldest Li son."]),
    ],
  });
}

const row = (over: Record<string, unknown> = {}): Record<string, unknown> => ({ id: "li_da", known: true, hearts: 3, likes_known: [], gifts: 0, card: null, met: [], asked: null, ...over });
const stamp = (hour: number, minute: number, place: string | null, day = 1): Record<string, unknown> => ({ tick: (hour - 6) * 120 + minute * 2, day, hour, minute, place });

const rows = (...list: Array<Record<string, unknown>>): Relation[] => relationRows(readRelations({ people: list })) ?? [];

test.describe("the people of the frame", () => {
  test("are read row by row with the hearts, the tastes, the talks and the return that was asked", () => {
    const read = rows(
      row({
        id: "li_laotai",
        hearts: 7,
        likes_known: [{ item: "pastry", like: "like" }, { item: "wine", like: "dislike" }, { item: "tea", like: "neutral" }],
        gifts: 2,
        met: [stamp(8, 10, "p_li_house"), stamp(9, 0, null, 2)],
        asked: { what: n("前排摊位", "a front-row stall"), for: n("请李老太借竹料", "Ask Granny Li to lend the bamboo"), tick: 40, day: 1, hour: 8, minute: 20 },
        card: { trust: "friendly", owes_you: 2, you_owe: 1, you_promised: [{ id: "k1", what: "stall", item: "front", amount: 0, due: 3 }], promised_you: [], changes: [{ tick: 40, day: 1, hour: 8, minute: 20, delta: -2, why: "lie" }], waiting: 2 },
      }),
    );
    const [first] = read;
    expect(first).toMatchObject({ id: "li_laotai", known: true, hearts: 7, gifts: 2 });
    expect(first?.likes).toEqual([{ item: "pastry", like: "like" }, { item: "wine", like: "dislike" }, { item: "tea", like: "neutral" }]);
    expect(first?.met).toEqual([readStamp(stamp(8, 10, "p_li_house")), readStamp(stamp(9, 0, null, 2))]);
    expect(first?.met[1]?.place).toBeNull();
    expect(first?.asked).toMatchObject({ what: n("前排摊位", "a front-row stall"), forRequest: n("请李老太借竹料", "Ask Granny Li to lend the bamboo"), day: 1, hour: 8, minute: 20 });
    expect(first?.card).toMatchObject({ trust: "friendly", owesYou: 2, youOwe: 1, waiting: 2 });
    expect(first?.card?.youPromised).toEqual([{ id: "k1", what: "stall", item: "front", amount: 0, due: 3 }]);
    expect(first?.card?.changes).toEqual([{ tick: 40, day: 1, hour: 8, minute: 20, delta: -2, why: "lie" }]);
  });

  test("read what is missing or wrong as nothing, keep the hearts within ten half hearts, and tell a frame with no people from one with none known", () => {
    expect(relationRows(readRelations({}))).toBeNull();
    expect(relationRows(readRelations({ people: "none" }))).toBeNull();
    const [wild] = rows(row({ hearts: 99, card: "nothing", met: "never", asked: { what: "" }, likes_known: [{ like: "like" }, { item: "tea", like: "maybe" }] }));
    expect(wild).toMatchObject({ hearts: 10, card: null, met: [], asked: null });
    expect(wild?.likes).toEqual([]);
    expect(knownIds(readRelations({ people: [row(), row({ id: "li_er", known: false })] }))).toEqual(new Set(["li_da"]));
    expect(knownIds(new Map())).toEqual(new Set());
  });

  test("give the frame a set of the people it knows, and the person the red slip points to", () => {
    const frame = {
      npcs: [],
      time: { day: 1, hour: 8, minute: 0 },
      people: [row(), row({ id: "li_er", known: false })],
      tasks: [{ id: "t1", kind: "obstacle", job: "bridge", text: n("一", "One"), state: "open", action: { verb: "talk", npc: "li_laotai" } }],
      tracked: "t1",
    } as unknown as Frame;
    const read = readFrame(frame);
    expect([...read.acquainted]).toEqual(["li_da"]);
    expect(read.pointed).toBe("li_laotai");
    expect(readFrame({ npcs: [] } as unknown as Frame)).toMatchObject({ pointed: null });
    expect([...readFrame({ npcs: [] } as unknown as Frame).acquainted]).toEqual([]);
  });

  test("are listed in the order the player first met them, and the ones with no first talk kept come last in the order of the cast", () => {
    const list = rows(
      row({ id: "a", met: [stamp(9, 0, null)] }),
      row({ id: "b", met: [] }),
      row({ id: "c", met: [stamp(8, 0, null)] }),
      row({ id: "d", known: false, met: [] }),
      row({ id: "e", met: [] }),
    );
    expect(knownPeople(list).map((r) => r.id)).toEqual(["c", "a", "b", "e"]);
    expect(knownPeople(null)).toEqual([]);
  });
});

test.describe("the notebook as the core sends it", () => {
  test("has the source as who told it and how they know it, and no hands", () => {
    const read = readNotebook({
      notebook: [
        { id: "n1", text: n("桥墩上有刮痕。", "Scrapes."), source: { kind: "seen" }, at: stamp(8, 10, "p_li_house"), marks: [], chain: [] },
        { id: "n2", text: n("李二在桥边。", "Li Er was at the bridge."), source: { kind: "heard", who: { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }, how: "saw" }, at: null, marks: [], chain: [] },
        { id: "n3", text: n("李二昨晚把栏杆弄坏了。", "Li Er broke the Stone Bridge Railing last night."), source: { kind: "heard", who: { ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" }, how: "heard", via: { ...n("周掌柜", "Shopkeeper Zhou"), id: "zhou_zhanggui" } }, marks: [], chain: [] },
        { id: "n4", text: n("老何在桥下。", "Boatman He was under the bridge."), source: { kind: "heard", who: n("更夫", "Night Watchman"), how: "unsure", via: { ...n("没有", "None") } }, marks: [], chain: [] },
        { id: "n5", text: n("别的。", "Other."), source: { kind: "heard", who: n("某人", "Someone") }, marks: [], chain: [] },
      ],
    });
    expect(read?.map((e) => e.source)).toEqual([
      { kind: "seen" },
      { kind: "heard", who: n("周家伙计", "Zhou's Clerk"), whoId: "zhou_huoji", how: "saw", via: null },
      { kind: "heard", who: n("茶馆老板娘", "Teahouse Keeper"), whoId: "cha_laoban", how: "heard", via: n("周掌柜", "Shopkeeper Zhou") },
      { kind: "heard", who: n("更夫", "Night Watchman"), whoId: "", how: "unsure", via: null },
      { kind: "heard", who: n("某人", "Someone"), whoId: "", how: "unsure", via: null },
    ]);
    expect(read?.[0]?.at).toMatchObject({ day: 1, hour: 8, minute: 10, place: "p_li_house" });
    expect(read?.[1]?.at).toBeNull();
    expect(JSON.stringify(read)).not.toMatch(/"hand"/);
  });

  test("says where each line came from the way a person says it, in both languages, and never by a number of hands", () => {
    const heard = (how: "saw" | "heard" | "unsure", via: ReturnType<typeof n> | null) => ({ kind: "heard" as const, who: n("周家伙计", "Zhou's Clerk"), whoId: "zhou_huoji", how, via });
    const lines: Array<[string, string, string]> = [
      ["saw", "周家伙计说，是亲眼看见的", "Zhou's Clerk says they saw it"],
      ["heard", "周家伙计说，是听茶馆老板娘说的", "Zhou's Clerk says they heard it from Teahouse Keeper"],
      ["unsure", "周家伙计说，记不清是听谁说的", "Zhou's Clerk cannot say who told them"],
    ];
    for (const [how, zhLine, enLine] of lines) {
      const source = heard(how as "saw" | "heard" | "unsure", how === "heard" ? n("茶馆老板娘", "Teahouse Keeper") : null);
      setLang("zh");
      expect(sourceWords(source, "zh")).toBe(zhLine);
      setLang("en");
      expect(sourceWords(source, "en")).toBe(enLine);
      expect(zhLine).not.toMatch(/手|[他她]/);
      expect(enLine).not.toMatch(/\bhands?\b|\b(he|she)\b/i);
    }
    // A teller who says they heard it but names nobody is one who cannot say from whom.
    expect(sourceWords({ kind: "heard", who: n("周家伙计", "Zhou's Clerk"), whoId: "", how: "heard", via: null }, "en")).toBe("Zhou's Clerk cannot say who told them");
    setLang("zh");
    expect(sourceWords({ kind: "seen" }, "zh")).toBe("你亲眼看见的");
    setLang("en");
    expect(sourceWords({ kind: "unknown" }, "en")).toBe("Nobody can say who said it");
  });
});

test.describe("first meetings", () => {
  const meet = (tracker: Introductions, known: string[], partner: string | null): string | null => tracker.update(rows(...["li_da", "li_er", "zhou_huoji"].map((id) => row({ id, known: known.includes(id) }))), partner);

  test("belong to the talk in which a person becomes known, for as long as it lasts", () => {
    const tracker = new Introductions();
    expect(meet(tracker, [], null)).toBeNull();
    expect(meet(tracker, ["li_da"], "li_da")).toBe("li_da");
    expect(meet(tracker, ["li_da"], "li_da")).toBe("li_da"); // the same frame again says the same
    expect(meet(tracker, ["li_da"], null)).toBeNull(); // the talk is over
    expect(meet(tracker, ["li_da"], "li_da")).toBeNull(); // a second talk with the same person is not a first
    expect(meet(tracker, ["li_da", "li_er"], "li_er")).toBe("li_er");
  });

  test("are not for a person who was known when the page first looked, as in a game that was loaded", () => {
    const tracker = new Introductions();
    expect(meet(tracker, ["li_da"], "li_da")).toBeNull();
    expect(meet(tracker, ["li_da", "li_er"], "li_er")).toBe("li_er");
  });

  test("start again with a game that is started over, and with a frame that has no people", () => {
    const tracker = new Introductions();
    expect(meet(tracker, ["li_da"], "li_da")).toBeNull();
    expect(meet(tracker, [], null)).toBeNull(); // another game: nobody is known
    expect(meet(tracker, ["li_da"], "li_da")).toBe("li_da");
    expect(tracker.update(null, "li_da")).toBeNull();
    expect(meet(tracker, ["li_da"], "li_da")).toBeNull(); // looked at afresh: li_da was known already
  });

  test("are not made by a person the player is not talking with becoming known", () => {
    const tracker = new Introductions();
    meet(tracker, [], null);
    expect(meet(tracker, ["li_da"], "li_er")).toBeNull();
    expect(meet(tracker, ["li_da"], "li_da")).toBeNull();
  });
});

test.describe("the page of the first six", () => {
  test("shows the six in the order of the design, as many of them as the scene has", () => {
    expect(OPENING_SIX).toEqual(["zuzhang", "li_laotai", "li_er", "li_da", "zhou_zhanggui", "zhou_huoji"]);
    const six = openingSix(scene());
    expect(six.map((p) => p.id)).toEqual(OPENING_SIX);
    expect(six.every((p) => p.intro.zh !== "" && p.intro.en !== "")).toBe(true);
    expect(openingSix(null)).toEqual([]);
    expect(openingSix(parseScene({ scenario: "m0", npcs: [{ id: "n0", x: 1, y: 1 }] }))).toEqual([]);
  });

  test("reads the line the town says of each person, and the small things of the day, from the scene", () => {
    const s = scene();
    expect(s.cast.find((p) => p.id === "li_er")?.intro).toEqual(n("李家次子，在扎灯坊帮工。", "Second Li son. Pastes lanterns."));
    expect(s.gifts.get("tea")).toEqual(n("茶叶", "tea leaves"));
    expect(parseScene({ cast: [{ id: "x", zh: "某", en: "X" }] }).cast[0]?.intro).toEqual(n("", ""));
  });
});

test.describe("what the book says", () => {
  test("names a moment and a place the way the paper does, and the street when it is at no place", () => {
    setLang("zh");
    expect(whenWords("zh", { day: 1, hour: 9, minute: 5 })).toBe("第一天 09:05");
    const s = scene();
    expect(stampWords(s, "zh", readStamp(stamp(8, 10, "p_li_house")) as never)).toBe("第一天 08:10，在李家宅");
    expect(stampWords(s, "zh", readStamp(stamp(8, 50, null)) as never)).toBe("第一天 08:50，在街上");
    setLang("en");
    expect(stampWords(s, "en", readStamp(stamp(8, 24, "p_teahouse", 2)) as never)).toBe("Day 2 08:24, at Teahouse");
    expect(stampWords(s, "en", readStamp(stamp(8, 50, null)) as never)).toBe("Day 1 08:50, in the street");
    // A place the scene does not have is the street too.
    expect(stampWords(s, "en", readStamp(stamp(8, 50, "p_nowhere")) as never)).toBe("Day 1 08:50, in the street");
    setLang("en");
  });

  test("names the small things in the order the core gives, and by their id where the scene does not name them", () => {
    const s = scene();
    expect(itemsWords(s, "zh", ["pastry", "tea"])).toBe("点心、茶叶");
    expect(itemsWords(s, "en", ["pastry", "tea", "wine"])).toBe("pastries, tea leaves, wine");
    expect(itemsWords(null, "en", [])).toBe("");
  });

  test("says the family beside a role only where the role does not name it already", () => {
    const li = n("李家", "Li Family");
    const zhou = n("周家", "Zhou Family");
    expect(roleNamesFamily("李家老太太 Matriarch of the Li family", li)).toBe(true);
    expect(roleNamesFamily("在周家帮工 Works for the Zhou family", zhou)).toBe(true);
    expect(roleNamesFamily("周家掌柜，管木料 Head of the Zhou shop, keeper of the timber", zhou)).toBe(true);
    expect(roleNamesFamily("茶馆老板娘 Keeper of the teahouse", li)).toBe(false);
    expect(roleNamesFamily("Child of the Chen family", li)).toBe(false);
    expect(roleNamesFamily("", n("", ""))).toBe(false);
  });

  test("takes the first part of a role, up to the comma", () => {
    expect(firstClause(n("周家掌柜，管木料", "Head of the Zhou shop, keeper of the timber"))).toEqual(n("周家掌柜", "Head of the Zhou shop"));
    expect(firstClause(n("族长", "Elder of the clan"))).toEqual(n("族长", "Elder of the clan"));
    expect(firstClause(n("", ""))).toEqual(n("", ""));
  });
});

test.describe("the hearts", () => {
  test("have a reason in words, in both languages, for every one the core gives", () => {
    for (const why of WHY) {
      const key = `hearts.why.${why}` as keyof typeof en;
      expect(en[key], why).toBeTruthy();
      expect(zh[key], why).toBeTruthy();
    }
  });
});

test.describe("the tags over the heads", () => {
  const want = (id: string, x: number, y: number, w = 60, h = 18) => ({ id, x, y, w, h });

  test("hang over the head, centred, with a small space between", () => {
    const spots = placeTags([want("a", 300, 200)], 1000, 600);
    expect(spots.get("a")).toEqual({ x: 270, y: 200 - 5 - 18, shown: true });
  });

  test("keep the place of the one nearest the viewer and push the ones that would lie over it up", () => {
    const spots = placeTags([want("far", 300, 190), want("near", 310, 200)], 1000, 600);
    expect(spots.get("near")?.y).toBe(177);
    const far = spots.get("far");
    expect(far?.shown).toBe(true);
    expect((far?.y ?? 0) + 18).toBeLessThanOrEqual(177 - 1);
    // Beside each other they are both where they hang.
    const apart = placeTags([want("a", 100, 200), want("b", 400, 200)], 1000, 600);
    expect([apart.get("a")?.y, apart.get("b")?.y]).toEqual([177, 177]);
  });

  test("leave a tag out when there is no room even pushed up, and one whose head is far off the screen", () => {
    const crowd = Array.from({ length: 8 }, (_, i) => want(`p${i}`, 300 + i, 300 + i));
    const spots = placeTags(crowd, 1000, 600);
    const shown = [...spots.values()].filter((s) => s.shown).length;
    expect(shown).toBe(4);
    const boxes = [...spots.values()].filter((s) => s.shown);
    for (const a of boxes) for (const b of boxes) if (a !== b) expect(Math.abs(a.y - b.y) >= 18 || Math.abs(a.x - b.x) >= 60).toBe(true);
    expect(placeTags([want("gone", 300, -400)], 1000, 600).get("gone")?.shown).toBe(false);
    expect(placeTags([want("gone", 5000, 100)], 1000, 600).get("gone")?.shown).toBe(false);
  });

  test("stay inside the view", () => {
    const left = placeTags([want("l", 2, 300)], 1000, 600).get("l");
    expect(left?.x).toBe(4);
    const right = placeTags([want("r", 998, 300)], 1000, 600).get("r");
    expect(right?.x).toBe(1000 - 60 - 4);
    const top = placeTags([want("t", 500, 10)], 1000, 600).get("t");
    expect(top?.y).toBe(4);
  });

  test("do not depend on the order they are given in", () => {
    const list = [want("a", 300, 200), want("b", 320, 205), want("c", 340, 190)];
    const one = placeTags(list, 1000, 600);
    const two = placeTags([...list].reverse(), 1000, 600);
    for (const id of ["a", "b", "c"]) expect(two.get(id)).toEqual(one.get(id));
  });
});

test.describe("the words of the people", () => {
  const LANGS: Lang[] = ["zh", "en"];
  const KEYS = Object.keys(en).filter((key) => key.startsWith("people.") || key.startsWith("source.told.")) as Array<keyof typeof en>;

  test("are in both languages with the same places for the values, and none of them speaks of a hand or of a person as he or she", () => {
    expect(KEYS.length).toBeGreaterThan(20);
    for (const key of KEYS) {
      for (const lang of LANGS) {
        const text = translate(lang, key);
        expect(text.trim(), `${lang} ${key}`).not.toBe("");
        expect(text, `${lang} ${key}`).not.toMatch(/[他她]|第[一二三四五六七八九\d]+手|\b(he|she|him|her|his|hers)\b|\bhands?\b/i);
        expect(text, `${lang} ${key}`).not.toMatch(/[；;—]| · |→|见闻|命题|来源链|把握/);
      }
      expect([...zh[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), key).toEqual([...en[key].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort());
    }
  });

  test("have the six people and the more to meet on the page of the first six", () => {
    expect(zh["people.opening.more"]).toBe("镇上还有十来位，见了面再认识。");
    expect(zh["people.opening.title"]).toBe("这几个人");
    expect(en["people.opening.title"]).toBe("Six people to know");
  });
});
