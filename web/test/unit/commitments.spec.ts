import { expect, test } from "@playwright/test";
import { setLang } from "../../src/i18n/index.ts";
import type { Commitment } from "../../src/page/slice.ts";
import { agreedText, dueText, dueWords, lowerFirst } from "../../src/page/ui/format.ts";
import * as fake from "../support/slice.ts";

const promise = (extra: Partial<Commitment> = {}): Commitment => ({
  id: "m1",
  by: "li_da",
  what: { zh: "把四根竹料送到石桥", en: "Bring 4 poles of bamboo to the Stone Bridge" },
  item: "bamboo",
  amount: 4,
  due: { day: 2, hour: 7 },
  state: "promised",
  reason: null,
  ...extra,
});

test.afterEach(() => setLang("en"));

test.describe("the hour a promise is for, in words", () => {
  test("says today and tomorrow with the part of the day, in English", () => {
    setLang("en");
    const by = (hour: number, day: number, today: number): string => dueWords("en", { day, hour }, today);
    expect(by(7, 2, 1)).toBe("7 tomorrow morning");
    expect(by(7, 2, 2)).toBe("7 this morning");
    expect(by(10, 1, 1)).toBe("10 this morning");
    expect(by(12, 1, 1)).toBe("noon today");
    expect(by(12, 2, 1)).toBe("noon tomorrow");
    expect(by(15, 1, 1)).toBe("3 this afternoon");
    expect(by(15, 2, 1)).toBe("3 tomorrow afternoon");
    expect(by(18, 1, 1)).toBe("6 this evening");
    expect(by(20, 2, 1)).toBe("8 tomorrow evening");
    expect(by(22, 1, 1)).toBe("10 tonight");
    expect(by(22, 2, 1)).toBe("10 tomorrow night");
  });

  test("says it in Chinese as the core's words for a promise do, with the clock time in figures after 今天, 明早 or 明天, and 中午 for noon", () => {
    setLang("zh");
    const by = (hour: number, day: number, today: number): string => dueWords("zh", { day, hour }, today);
    expect(by(7, 2, 1)).toBe("明早07:00");
    expect(by(7, 2, 2)).toBe("今天07:00");
    expect(by(10, 2, 1)).toBe("明早10:00");
    expect(by(12, 1, 1)).toBe("今天中午");
    expect(by(12, 2, 1)).toBe("明天中午");
    expect(by(15, 2, 1)).toBe("明天15:00");
    expect(by(19, 1, 1)).toBe("今天19:00");
    expect(by(22, 2, 1)).toBe("明天22:00");
  });

  test("names the day when it is not today or tomorrow, and when the frame does not say what day it is", () => {
    setLang("en");
    expect(dueWords("en", { day: 4, hour: 7 }, 1)).toBe("Day 4 07:00");
    expect(dueWords("en", { day: 1, hour: 7 }, 3)).toBe("Day 1 07:00");
    expect(dueWords("en", { day: 2, hour: 7 }, null)).toBe(dueText("en", { day: 2, hour: 7 }));
    setLang("zh");
    expect(dueWords("zh", { day: 4, hour: 7 }, 1)).toBe("第四日 07:00");
  });
});

test.describe("what a person agreed, as a sentence", () => {
  test("starts the request with a small letter after “agreed to”, and leaves a name alone", () => {
    expect(lowerFirst("Bring 4 poles of bamboo to the Stone Bridge")).toBe("bring 4 poles of bamboo to the Stone Bridge");
    expect(lowerFirst("bring it")).toBe("bring it");
    expect(lowerFirst("4 poles")).toBe("4 poles");
    expect(lowerFirst("")).toBe("");
  });

  test("is “Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 tomorrow morning” and “答应明早07:00前把四根竹料送到石桥”", () => {
    setLang("en");
    expect(agreedText("en", promise(), 1)).toBe("Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 tomorrow morning");
    expect(agreedText("en", promise(), 2)).toBe("Agreed to bring 4 poles of bamboo to the Stone Bridge by 7 this morning");
    expect(agreedText("en", promise({ due: null }), 1)).toBe("Agreed to bring 4 poles of bamboo to the Stone Bridge");
    setLang("zh");
    expect(agreedText("zh", promise(), 1)).toBe("答应明早07:00前把四根竹料送到石桥");
    expect(agreedText("zh", promise(), 2)).toBe("答应今天07:00前把四根竹料送到石桥");
    expect(agreedText("zh", promise({ due: null }), 1)).toBe("答应把四根竹料送到石桥");
  });

  test("leaves the words of the core as they are: it says the count in numerals itself, with 两 for two", () => {
    const two = promise({ what: { zh: "把两根竹料送到石桥", en: "Bring 2 poles of bamboo to the Stone Bridge" }, amount: 2 });
    setLang("en");
    expect(agreedText("en", two, 1)).toBe("Agreed to bring 2 poles of bamboo to the Stone Bridge by 7 tomorrow morning");
    setLang("zh");
    expect(agreedText("zh", two, 1)).toBe("答应明早07:00前把两根竹料送到石桥");
  });

  test("is the promise of the fake frame as the core sends it", () => {
    const [raw] = fake.commitments().commitments as Array<Record<string, unknown>>;
    expect(raw).toMatchObject({ amount: 4, due: { day: 2, hour: 7 }, reason: null });
  });
});
