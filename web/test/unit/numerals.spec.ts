import { expect, test } from "@playwright/test";
import { translate } from "../../src/i18n/index.ts";
import { zh } from "../../src/i18n/zh.ts";
import { count, countName } from "../../src/page/ui/paper-text.ts";
import { rulesOf, valueOf } from "../support/css-rules.ts";

/**
 * The numbers of the town on the page. In Chinese a quantity of the town is said in characters before its measure word (四根, 五人, 两个早上);
 * a clock time is in figures, and so are a score, the developer screens, the step counter of the tutorial and the figures that sit
 * beside a stroke. English keeps its digits. The core says its own counts in characters (tests/core/test_bridge_numerals.py); the
 * words here are the page's.
 */

const said = (lang: "zh" | "en", key: keyof typeof zh, values: Record<string, string | number>): string => translate(lang, key, values);

test.describe("a count of the town", () => {
  test("is a numeral in Chinese, with 两 for two, and digits in English", () => {
    expect([0, 1, 2, 4, 10, 12, 20, 22, 99].map((n) => count("zh", n))).toEqual(["零", "一", "两", "四", "十", "十二", "二十", "二十二", "九十九"]);
    expect([0, 1, 2, 4, 10, 12, 99].map((n) => count("en", n))).toEqual(["0", "1", "2", "4", "10", "12", "99"]);
  });

  test("keeps its digits past 99, grouped in thousands as each language does", () => {
    expect(count("zh", 100)).toBe("100");
    expect(count("zh", 1800)).toBe("1,800");
    expect(count("en", 1800)).toBe("1,800");
    expect(count("zh", -1)).toBe("-1");
  });

  test("is one value in both languages for the words that are made for both at once", () => {
    expect(countName(2)).toEqual({ zh: "两", en: "2" });
    expect(countName(30)).toEqual({ zh: "三十", en: "30" });
  });
});

test.describe("the Chinese words that carry a count", () => {
  const zhOf = (key: keyof typeof zh, n: number, extra: Record<string, string | number> = {}): string => said("zh", key, { n: count("zh", n), ...extra });
  const enOf = (key: keyof typeof zh, n: number, extra: Record<string, string | number> = {}): string => said("en", key, { n: count("en", n), ...extra });

  test("read as a person says them, with no space between the numeral and its measure word", () => {
    expect(zhOf("unit.households", 23)).toBe("二十三户");
    expect(zhOf("unit.people", 2)).toBe("两人");
    expect(zhOf("unit.coins", 40)).toBe("四十文");
    expect(zhOf("slip.more", 3)).toBe("还有三件");
    expect(zhOf("note.inspected.some", 3)).toBe("见闻簿里新记了三条。");
    expect(zhOf("note.joinedMore", 1, { names: "老何、李大" })).toBe("老何、李大和另外一个人答应来帮忙。");
    expect(zhOf("note.testified.some", 2, { name: "老何" })).toBe("老何把亲眼看见的跟你讲了。你记下了两条。");
    expect(zhOf("task.expected.more", 2)).toBe("还有两人");
    expect(zhOf("person.favours.owes", 2)).toBe("欠你两份人情");
    expect(zhOf("person.favours.owed", 3, { name: "李大" })).toBe("你欠李大三份人情");
    expect(zhOf("request.spent", 20)).toBe("花了二十分钟。");
    expect(zhOf("request.spent", 15)).toBe("花了十五分钟。");
    expect(zhOf("board.statement.judged", 3)).toBe("已经比过三对。");
  });

  test("read the same way when two counts stand in one sentence", () => {
    const two = { named: count("zh", 9), accepted: count("zh", 8), where: "祠堂" };
    // The note over the map says what was done, and the ledger keeps how many took it in.
    expect(said("zh", "note.spoke", two)).toBe("你在祠堂当众拿出了凭据，在场的人都听见了。");
    expect(said("zh", "note.spoke.cleared", two)).toBe("你在祠堂当众把真相讲明白了。");
    expect(said("zh", "clarify.sum", { n: count("zh", 9), changed: count("zh", 8) })).toBe("九个人里，八个改了主意。");
    expect(said("zh", "ending.told", { total: count("zh", 12), mutated: count("zh", 5) })).toBe("一共传了十二回，其中五回把话说走了样。");
    const last = { when: "第三天 18:00", where: "茶馆", named: count("zh", 4), accepted: count("zh", 2), percent: 50 };
    expect(said("zh", "board.truth.lastLine", last)).toBe("第三天 18:00在茶馆，到场四人，两人信了，占50%");
    expect(said("zh", "board.statement.counts", { support: count("zh", 3), against: count("zh", 0) })).toBe("三条对得上，零条对不上");
  });

  test("put the measure word of the pole on the ledger's three counts, and leave English alone", () => {
    const pole = (lang: "zh" | "en", n: number): string => said(lang, "ledger.pole", { n: count(lang, n) });
    expect(said("zh", "board.promised", { n: pole("zh", 4) })).toBe("答应四根");
    expect(said("zh", "board.delivered", { n: pole("zh", 2) })).toBe("送到两根");
    expect(said("zh", "board.lost", { n: pole("zh", 10) })).toBe("失约十根");
    expect(said("en", "board.promised", { n: pole("en", 4) })).toBe("promised 4");
    expect(said("en", "board.lost", { n: pole("en", 10) })).toBe("not kept 10");
  });

  test("leave the English words as they were", () => {
    expect(enOf("unit.people", 23)).toBe("23 people");
    expect(enOf("unit.coins", 40)).toBe("40 coins");
    expect(enOf("person.favours.owes", 2)).toBe("Owes you 2");
    expect(enOf("request.spent", 20)).toBe("That took 20 minutes.");
    expect(enOf("request.spent", 15)).toBe("That took 15 minutes.");
    expect(enOf("slip.more", 3)).toBe("3 more");
    expect(enOf("task.expected.more", 2)).toBe("and 2 more");
  });

  test("have no space between a placeholder and its measure word, except where the figures are meant to stay", () => {
    const measure = /\{\w+\} (人|条|个|份|户|回|文|次|位|根|分钟|钟头|星|拍|毫秒|步|对|句|场|天|日|成|家|批)/;
    // Digits stay on the developer screens (budget, the list of calls, the cost of a tick),
    // in the step counter of the tutorial, in the stars of the manager's name (a score), and in three words of the board that no view
    // writes any more (their counts are said by `ledger.*`).
    const keepFigures = [
      "board.helpers.enough",
      "board.helpers.of",
      "board.helpers.total",
      "budget.moved",
      "calls.cap",
      "calls.latency",
      "calls.tick",
      "tick.step",
      "tick.value",
      "tut.step",
      "unit.stars",
    ];
    const spaced = (Object.keys(zh) as Array<keyof typeof zh>).filter((key) => measure.test(zh[key]));
    expect(spaced.sort()).toEqual(keepFigures);
  });
});

test.describe("the lines of the night summary", () => {
  test("avoid an orphan, so that a count in characters, which is wider than its digits were, does not leave a character of a place name and its stop alone on a second line", () => {
    const rule = rulesOf("sheets.css").find((r) => r.selector === ".night-text" && r.at === null);
    expect(rule && valueOf(rule, "text-wrap")).toBe("pretty");
  });
});
