import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import { readFrame } from "../../src/page/frame.ts";
import { parseScene } from "../../src/page/scene.ts";
import { readBoard, readSlice } from "../../src/page/slice.ts";
import type { Frame } from "../../src/shared/protocol.ts";
import { elderText, familyName, helperTotal, helperTotalText, materialsOf, nextWindow, peaceSummary, siteText, summaryOf, truthLastText, truthNeeds, truthSummary, witnessText } from "../../src/page/ui/board-text.ts";
import { numberWord, tenthsText } from "../../src/page/ui/format.ts";
import * as fake from "../support/slice.ts";

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
  cast: [],
  families: [
    { id: "fam_li", zh: "李家", en: "Li Family" },
    { id: "fam_zhou", zh: "周家", en: "Zhou Family" },
  ],
  items: [
    { id: "bamboo", zh: "竹料", en: "Bamboo" },
    { id: "timber", zh: "木料", en: "Timber" },
  ],
});

const frameOf = (extras: Record<string, unknown>): Record<string, unknown> => ({ npcs: [], time: { day: 1, hour: 8, minute: 0, phase: "day" }, weather: "clear", hud: {}, ...extras });
const sliceOf = (extras: Record<string, unknown>) => readSlice(frameOf(extras));
const viewOf = (extras: Record<string, unknown>) => readFrame(frameOf(extras) as unknown as Frame);

// The words of the board follow the language of the page, so each test sets it and the last one puts it back.
test.afterEach(() => setLang("en"));

test.describe("the materials of the bridge", () => {
  test("add up across the promises of an item: what was promised, what came, what was not kept, and what lies at the bridge", () => {
    const slice = sliceOf({
      commitments: [
        fake.promiseOf("c1", "li_da", "bamboo", 4, { day: 2, hour: 7 }, "delivered"),
        fake.promiseOf("c2", "li_da", "bamboo", 4, { day: 3, hour: 7 }, "delivered"),
        fake.promiseOf("c3", "li_da", "bamboo", 2, { day: 4, hour: 13 }, "promised"),
        fake.promiseOf("c4", "li_da", "bamboo", 3, { day: 4, hour: 9 }, "broken", "rain"),
        fake.promiseOf("c5", "zhou_zhanggui", "timber", 8, { day: 3, hour: 7 }, "delivered"),
      ],
      site: { bamboo: 8, timber: 8 },
    });
    expect(materialsOf(slice)).toEqual([
      { item: "bamboo", promised: 10, delivered: 8, lost: 3, site: 8 },
      { item: "timber", promised: 8, delivered: 8, lost: 0, site: 8 },
    ]);
  });

  test("are an item of the pile too when nobody promised it, and nothing where the frame has neither", () => {
    expect(materialsOf(sliceOf({ site: { timber: 2 } }))).toEqual([{ item: "timber", promised: 0, delivered: 0, lost: 0, site: 2 }]);
    expect(materialsOf(sliceOf({}))).toEqual([]);
    // A promise taken back is not promised any more.
    expect(materialsOf(sliceOf({ commitments: [fake.promiseOf("c1", "li_da", "bamboo", 4, { day: 2, hour: 7 }, "broken")] }))).toEqual([{ item: "bamboo", promised: 0, delivered: 0, lost: 4, site: null }]);
  });

  test("have their pile said against what the bridge takes, only where the frame says it", () => {
    setLang("en");
    const slice = sliceOf({ site: { bamboo: 8, timber: 0 } });
    expect(siteText(slice, null, SCENE, "en")).toBe("Bamboo 8, Timber 0");
    const needs = readBoard(frameOf({ board: { needs: { bamboo: 10, timber: 8 } } }));
    expect(siteText(slice, needs, SCENE, "en")).toBe("Bamboo 8 of 10, Timber 0 of 8");
    setLang("zh");
    expect(siteText(slice, null, SCENE, "zh")).toBe("竹料 8，木料 0");
    expect(siteText(slice, needs, SCENE, "zh")).toBe("竹料 8 / 10，木料 0 / 8");
    // An item the board does not give a need for is said as it is.
    expect(siteText(slice, readBoard(frameOf({ board: { needs: { bamboo: 10 } } })), SCENE, "zh")).toBe("竹料 8 / 10，木料 0");
    expect(siteText(sliceOf({ site: {} }), null, SCENE, "zh")).toBe("还没有料");
    expect(siteText(sliceOf({}), null, SCENE, "zh")).toBeNull();
  });
});

test.describe("the next work time and the helpers", () => {
  const WINDOW = { day: 4, from: 13, to: 17, place: "p_bridge" };

  test("is the board's own word, else the earliest time at the bridge of a task of the bridge, and none for a task that is done, stale or somewhere else", () => {
    expect(nextWindow(sliceOf({}), readBoard(frameOf({ board: { window: WINDOW } })))).toEqual(WINDOW);
    const task = (id: string, state: string, window: unknown): Record<string, unknown> => ({ id, job: "bridge", text: { zh: id, en: id }, state, window });
    const slice = sliceOf({
      tasks: [
        task("a", "open", { day: 3, from: 9, to: 11, place: "p_bridge" }),
        task("b", "open", { day: 2, from: 15, to: 17, place: "p_bridge" }),
        task("c", "done", { day: 2, from: 6, to: 7, place: "p_bridge" }),
        task("d", "open", { day: 1, from: 8, to: 17, place: "p_li_house" }),
        task("e", "stale", { day: 1, from: 8, to: 12, place: "p_bridge" }),
      ],
    });
    expect(nextWindow(slice, null)).toEqual({ day: 2, from: 15, to: 17, place: "p_bridge" });
    expect(nextWindow(slice, readBoard(frameOf({ board: {} })))).toEqual({ day: 2, from: 15, to: 17, place: "p_bridge" });
    expect(nextWindow(sliceOf({}), null)).toBeNull();
  });

  test("count the helpers who agreed from the board, else the workers the hud counts", () => {
    expect(helperTotal(readBoard(frameOf(fake.moment("day4"))), 1)).toBe(5);
    expect(helperTotal(readBoard(frameOf({ board: { helpers: [] } })), 3)).toBe(0);
    expect(helperTotal(readBoard(frameOf({ board: {} })), 3)).toBe(3);
    expect(helperTotal(null, 3)).toBe(3);
    expect(helperTotal(null, null)).toBeNull();
  });

  test("say the count against what the work takes, and that there are enough when there are more than it takes", () => {
    setLang("zh");
    expect(helperTotalText(3, 5)).toBe("共 3 / 5 人");
    expect(helperTotalText(0, 5)).toBe("共 0 / 5 人");
    expect(helperTotalText(5, 5)).toBe("共 5 / 5 人");
    expect(helperTotalText(17, 5)).toBe("共 17 人，要 5 人，够了");
    expect(helperTotalText(6, 5)).toBe("共 6 人，要 5 人，够了");
    expect(helperTotalText(4, null)).toBe("共 4 人");
    setLang("en");
    expect(helperTotalText(3, 5)).toBe("3 of 5");
    expect(helperTotalText(5, 5)).toBe("5 of 5");
    expect(helperTotalText(17, 5)).toBe("17 in all, enough (5 needed)");
    expect(helperTotalText(4, null)).toBe("4 so far");
  });

  test("name a family by the scene, and the id where the scene does not, and a helper of none as no family", () => {
    setLang("en");
    expect(familyName(SCENE, "en", "fam_li")).toBe("Li Family");
    expect(familyName(SCENE, "zh", "fam_zhou")).toBe("周家");
    expect(familyName(SCENE, "en", "fam_wang")).toBe("fam_wang");
    expect(familyName(null, "en", "fam_li")).toBe("fam_li");
    expect(familyName(SCENE, "en", null)).toBe("Other families");
    setLang("zh");
    expect(familyName(SCENE, "zh", null)).toBe("别家");
  });
});

test.describe("the truth on the board", () => {
  test("takes five named people, six in ten who accept and the elder, in words in both languages", () => {
    setLang("en");
    expect(truthNeeds("en", null).map((need) => need.text)).toEqual(["at least five familiar faces there", "at least six in ten of them believe it", "the elder believes it"]);
    setLang("zh");
    expect(truthNeeds("zh", null).map((need) => need.text)).toEqual(["至少五个熟面孔在场", "在场的人有六成以上信", "族长也信"]);
  });

  test("says which of the three the last statement met and which it missed, and none of them before there was one", () => {
    const met = (last: Record<string, unknown> | null): Array<boolean | null> => truthNeeds("en", readBoard(frameOf({ board: { truth: { state: "open", last } } }))?.truth?.last ?? null).map((need) => need.met);
    expect(met(null)).toEqual([null, null, null]);
    expect(met(fake.FELL_SHORT)).toEqual([false, false, false]);
    expect(met(fake.CLEARED)).toEqual([true, true, true]);
    // Five named people and six in ten are enough; four, or fifty-nine, are not; an elder who refused did not accept.
    expect(met({ day: 3, hour: 18, named: 5, percent: 60, elder: "refused" })).toEqual([true, true, false]);
    expect(met({ day: 3, hour: 18, named: 4, percent: 59, elder: "accepted" })).toEqual([false, false, true]);
  });

  test("says the last statement in a line with the day, the hour and the place, and where the elder stood", () => {
    const last = readBoard(frameOf(fake.moment("day4")))?.truth?.last;
    if (last === null || last === undefined) throw new Error("no last statement");
    setLang("en");
    expect(truthLastText(last, SCENE, "en")).toBe("Day 3 18:00, Teahouse: 4 there, 2 believed it (50%)");
    expect(elderText(last)).toBe("the elder was not there");
    setLang("zh");
    expect(truthLastText(last, SCENE, "zh")).toBe("第三天 18:00在茶馆，到场四人，两人信了，占50%");
    expect(elderText(last)).toBe("族长没到场");
    // A place the scene does not know is left out, and so is an elder the frame does not place.
    expect(truthLastText({ ...last, venue: null }, SCENE, "zh")).toBe("第三天 18:00，到场四人，两人信了，占50%");
    expect(elderText({ ...last, elder: null })).toBeNull();
    setLang("en");
    expect(truthLastText({ ...last, venue: "p_nowhere" }, SCENE, "en")).toBe("Day 3 18:00: 4 there, 2 believed it (50%)");
    expect(["refused", "accepted"].map((elder) => elderText({ ...last, elder: elder as "refused" | "accepted" }))).toEqual(["the elder was not convinced", "the elder believed it"]);
  });
});

test.describe("the peace on the board", () => {
  test("says whether anybody saw it, and nothing where the frame does not say", () => {
    setLang("en");
    expect(witnessText(true)).toBe("Others saw the families make peace");
    expect(witnessText(false)).toBe("Nobody has seen the families make peace yet");
    expect(witnessText(null)).toBeNull();
    setLang("zh");
    expect(witnessText(true)).toBe("有人亲眼看见两家和好了");
    expect(witnessText(false)).toBe("还没人亲眼看见两家和好");
  });
});

test.describe("the line of the shut board", () => {
  const summary = (extras: Record<string, unknown>, lang: "en" | "zh" = "en"): string => {
    setLang(lang);
    return summaryOf(viewOf(extras), sliceOf(extras));
  };

  test("says how the three things stand at each point of the five days", () => {
    expect(summary(fake.moment("day2"))).toBe("Bridge 0%, Truth open, Peace 30%");
    expect(summary(fake.moment("day4"))).toBe("Bridge 40%, Truth open, Peace 45%");
    expect(summary(fake.moment("day5"))).toBe("Bridge 100%, Truth done, Peace done");
    expect(summary(fake.moment("day4"), "zh")).toBe("修桥 40%，说清 还没成，说和 45%");
    expect(summary(fake.moment("day5"), "zh")).toBe("修桥 100%，说清 办成了，说和 办成了");
  });

  test("shows the truth in place of the statement while the columns are not sent, and the columns when they are", () => {
    setLang("en");
    expect(truthSummary(readBoard(frameOf({ board: { truth: { state: "done", last: null } } })))).toBe("done");
    expect(truthSummary(readBoard(frameOf({ board: { truth: { state: "open", last: null } } })))).toBe("open");
    // told, it says so, whatever the columns hold: the columns are what is left to find out, and nothing is
    const columns = [{ part: "cause", support: 1, against: 0, gap: false }];
    expect(truthSummary(readBoard(frameOf({ board: { truth: { state: "done", last: null }, statement: columns } })))).toBe("done");
    expect(truthSummary(readBoard(frameOf({ board: { truth: { state: "open", last: null }, statement: columns } })))).toBe("1/1");
    expect(truthSummary(readBoard(frameOf({ board: { statement: [{ part: "cause", support: 1, against: 0, gap: false }, { part: "course", support: 0, against: 0, gap: true }] } })))).toBe("1/2");
    expect(truthSummary(readBoard(frameOf({ board: {} })))).toBe("–");
    expect(truthSummary(null)).toBe("–");
  });

  test("shows the peace as made, as the share of the grudge that is gone, or as open, and a dash only where the frame has nothing", () => {
    setLang("en");
    const peace = (value: unknown): string => peaceSummary(readBoard(frameOf({ board: { peace: value } })));
    expect(peace({ state: "done", grudge: 40, acts: [] })).toBe("done");
    expect(peace({ state: "open", grudge: 62, acts: [] })).toBe("38%");
    expect(peace({ grudge: 62, acts: [] })).toBe("38%");
    expect(peace({ state: "open", grudge: null, acts: [] })).toBe("open");
    expect(peace({ acts: [] })).toBe("–");
    expect(peaceSummary(null)).toBe("–");
    expect(peaceSummary(readBoard(frameOf({ board: {} })))).toBe("–");
  });

  test("is what the page showed before the days after for a frame with no board: the bridge as the hud has it, and dashes", () => {
    expect(summary({ hud: { bridge: { done: 1, need: 5, percent: 20 } } })).toBe("Bridge 20%, Truth –, Peace –");
    expect(summary({})).toBe("Bridge –, Truth –, Peace –");
  });
});

test.describe("numbers in words", () => {
  test("are written out up to ten in English and to ninety-nine in Chinese, and keep their digits past that", () => {
    expect([0, 1, 5, 10, 11].map((n) => numberWord("en", n))).toEqual(["zero", "one", "five", "ten", "11"]);
    expect([0, 5, 10, 11, 99, 100].map((n) => numberWord("zh", n))).toEqual(["零", "五", "十", "十一", "九十九", "100"]);
    expect(numberWord("en", -1)).toBe("-1");
    expect(numberWord("en", 2.5)).toBe("2.5");
  });

  test("say a share in tenths as a person would, and a share that is not a whole number of tenths as the percent", () => {
    expect(tenthsText("en", 60)).toBe("six in ten");
    expect(tenthsText("zh", 60)).toBe("六成");
    expect(tenthsText("zh", 10)).toBe("一成");
    expect(tenthsText("en", 90)).toBe("nine in ten");
    expect(tenthsText("en", 65)).toBe("65%");
    expect(tenthsText("zh", 100)).toBe("100%");
    expect(tenthsText("zh", 0)).toBe("0%");
  });
});
