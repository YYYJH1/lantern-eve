import { expect, test } from "@playwright/test";
import { diffWords, previousTelling, type Run, units } from "../../src/page/ending-diff.ts";
import type { Telling } from "../../src/page/ending.ts";

// What changed between a telling of a story and the one before it: characters in Chinese, words in English.

const marked = (runs: readonly Run[]): string[] => runs.filter((r) => r.changed).map((r) => r.text);
const whole = (runs: readonly Run[]): string => runs.map((r) => r.text).join("");

test.describe("the units of a text", () => {
  test("are the characters of a Chinese text, with the marks as units of their own, so that they put together make the text", () => {
    expect(units("桥是李二弄坏的。", "zh").map((u) => u.text)).toEqual(["桥", "是", "李", "二", "弄", "坏", "的", "。"]);
    expect(units("桥是李二弄坏的。", "zh").map((u) => u.key)).toEqual(["桥", "是", "李", "二", "弄", "坏", "的", ""]);
  });

  test("are the words of an English text, each with the space after it, compared without the marks and the capital", () => {
    const parts = units("The Li family, they said, broke it.", "en");
    expect(parts.map((u) => u.text).join("")).toBe("The Li family, they said, broke it.");
    expect(parts.map((u) => u.key)).toEqual(["the", "li", "family", "they", "said", "broke", "it"]);
  });
});

test.describe("what changed in a telling", () => {
  test("is the characters that are new in a Chinese telling, and the ones they took the place of in the one before", () => {
    const diff = diffWords("桥是李二弄坏的。", "桥是李家故意弄坏的。", "zh");
    expect(marked(diff.after)).toEqual(["家故意"]);
    expect(marked(diff.before)).toEqual(["二"]);
    expect(diff.same).toBe(false);
    expect(whole(diff.after)).toBe("桥是李家故意弄坏的。");
    expect(whole(diff.before)).toBe("桥是李二弄坏的。");
  });

  test("is what was added at the end, with the marks of punctuation never marked", () => {
    const diff = diffWords("桥坏了。", "桥坏了，是李二故意弄的。", "zh");
    expect(marked(diff.after)).toEqual(["是李二故意弄的"]);
    expect(marked(diff.before)).toEqual([]);
    expect(diff.after.find((r) => r.text.includes("，"))?.changed).toBe(false);
  });

  test("is nothing where the two say the same, even if a mark or a capital differs", () => {
    expect(diffWords("桥坏了。", "桥坏了！", "zh").same).toBe(true);
    const same = diffWords("The Li family broke the bridge.", "the Li family broke the bridge", "en");
    expect(same.same).toBe(true);
    expect(marked(same.after)).toEqual([]);
    expect(whole(same.after)).toBe("the Li family broke the bridge");
  });

  test("takes a single shared character between two changes for part of the change, so that the marks are not scattered", () => {
    // 他 is the same in both, between two characters that are not
    const diff = diffWords("甲乙丙丁", "戊己丙庚辛", "zh");
    expect(marked(diff.after)).toEqual(["戊己丙庚辛"]);
    expect(marked(diff.before)).toEqual(["甲乙丙丁"]);
    // two shared characters in a row stay plain
    const two = diffWords("甲乙丙丁戊", "己庚丙丁辛", "zh");
    expect(marked(two.after)).toEqual(["己庚", "辛"]);
  });

  test("is the words that are new in an English telling, whole words with their spaces", () => {
    const diff = diffWords("Li Er broke the bridge", "The Li family broke the bridge on purpose", "en");
    expect(marked(diff.after)).toEqual(["The ", "family ", "on purpose"]);
    expect(marked(diff.before)).toEqual(["Er "]);
    expect(whole(diff.after)).toBe("The Li family broke the bridge on purpose");
    expect(whole(diff.before)).toBe("Li Er broke the bridge");
  });

  test("is all of a telling that shares nothing with the one before it", () => {
    const diff = diffWords("A flood did it.", "Dalang kicked it.", "en");
    expect(marked(diff.after)).toEqual(["Dalang kicked "]);
    expect(diff.same).toBe(false);
    expect(marked(diffWords("洪水冲的", "大郎踢的", "zh").after)).toEqual(["大郎踢"]);
  });

  test("handles the empty text of a language the version has none in", () => {
    expect(diffWords("", "桥坏了", "zh").after).toEqual([{ text: "桥坏了", changed: true }]);
    expect(diffWords("The bridge broke", "", "en")).toEqual({ before: [{ text: "The bridge broke", changed: true }], after: [], same: false });
    expect(diffWords("", "", "zh")).toEqual({ before: [], after: [], same: true });
  });
});

const told = (id: string, from: string, to: string, prop: string, op: string, tick: number): Telling => ({ id, from, to, prop, op, tick });

test.describe("the telling before", () => {
  const chain = [
    told("c1", "li_er", "laotai", "p1", "", 18),
    told("c2", "huoji", "zhanggui", "p2", "", 27),
    told("c3", "zhanggui", "niangzi", "p3", "assimilate", 43),
    told("c4", "laotai", "xiaomei", "p1", "", 60),
    told("c6", "niangzi", "huoji", "p3", "sharpen", 80),
    told("c7", "huoji", "zhanggui", "p4", "fill", 90),
  ];

  test("is the one by which the speaker heard the story", () => {
    expect(previousTelling(chain, chain[2] as Telling)?.id).toBe("c2");
    expect(previousTelling(chain, chain[4] as Telling)?.id).toBe("c3");
    expect(previousTelling(chain, chain[3] as Telling)?.id).toBe("c1");
  });

  test("is the latest one before they said it where they were told more than once", () => {
    const more = [...chain, told("c8", "li_er", "zhanggui", "p9", "", 50)];
    // zhanggui was told by huoji at 27 and by li_er at 50, and said it to niangzi at 43: the one before is huoji's
    expect(previousTelling(more, chain[2] as Telling)?.id).toBe("c2");
    // and a telling he made at 95 follows li_er's
    expect(previousTelling([...more, told("c9", "zhanggui", "gengfu", "p9", "", 95)], told("c9", "zhanggui", "gengfu", "p9", "", 95))?.id).toBe("c7");
  });

  test("is none for someone who knew it first-hand, whose telling is where the story starts", () => {
    expect(previousTelling(chain, chain[0] as Telling)).toBeNull();
    expect(previousTelling([], chain[0] as Telling)).toBeNull();
  });

  test("never takes a telling that came after, or the telling itself", () => {
    const loop = [told("a", "x", "y", "p", "", 10), told("b", "y", "x", "p", "", 5)];
    // x heard it from y at 5, before they told y at 10; y heard it from x at 10, which is after they told x at 5
    expect(previousTelling(loop, loop[0] as Telling)?.id).toBe("b");
    expect(previousTelling(loop, loop[1] as Telling)).toBeNull();
    expect(previousTelling([loop[0] as Telling], loop[0] as Telling)).toBeNull();
  });
});
