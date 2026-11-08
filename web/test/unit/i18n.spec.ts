import { expect, test } from "@playwright/test";
import { en } from "../../src/i18n/en.ts";
import { detectLanguage, getLang, hasMessage, htmlLang, pick, setLang, subscribeLang, t, translate } from "../../src/i18n/index.ts";
import { zh } from "../../src/i18n/zh.ts";
import { ordinal, zhNumeral } from "../../src/page/ui/format.ts";

const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

test.describe("the two message tables", () => {
  test("have the same keys", () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort());
  });

  test("have no empty text, and the same placeholders under each key", () => {
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(en[key].trim(), `en ${key}`).not.toBe("");
      expect(zh[key].trim(), `zh ${key}`).not.toBe("");
      expect(placeholders(zh[key]), `placeholders of ${key}`).toEqual(placeholders(en[key]));
    }
  });

  test("have Chinese in the Chinese table and none in the English one, apart from the names of the languages", () => {
    const han = /[一-鿿]/;
    for (const key of Object.keys(en) as Array<keyof typeof en>) {
      expect(han.test(en[key]), `en ${key}`).toBe(false);
    }
    // A few texts are the same in both languages on purpose: a dash, a money format, a symbol.
    const same = Object.keys(en).filter((key) => en[key as keyof typeof en] === zh[key as keyof typeof zh]);
    // `note.taskChanged.reason` is the core's own words, which come in both languages already, and nothing else.
    expect(same.sort()).toEqual(["hud.none", "note.taskChanged.reason", "unit.money"]);
  });

  test("say a person in general with 对方 or they, and keep he and she for the one person a text is about", () => {
    // The cast has fixed sexes, so a text that speaks of whoever the player has picked cannot use 他 or 她 (he, she, his, her). The texts
    // that remain are about one person: Old He (the ending), and Granny Li and the teahouse keeper (the elder's cards).
    const fixed = ["ending.chain.ch_li_er_rumor", "ending.truth.v_boat", "tut.refusal.title", "tut.source.body"];
    const zhNames = (Object.keys(zh) as Array<keyof typeof zh>).filter((key) => /[他她]/.test(zh[key].replace(/其他|他人|他们/g, "")));
    expect(zhNames.filter((key) => !fixed.includes(key))).toEqual([]);
    const enNames = (Object.keys(en) as Array<keyof typeof en>).filter((key) => /\b(he|she|him|her|his|hers|himself|herself)\b/i.test(en[key]));
    expect(enNames.filter((key) => !fixed.includes(key))).toEqual([]);
    // The cards of a person say who they mean in the words themselves.
    expect(zh["person.find"]).toBe("何时何地找对方");
    expect(zh["person.favours.owed"]).toBe("你欠对方{n}份人情");
    expect(zh["person.details"]).toBe("关于对方");
    expect(en["person.find"]).toBe("Find them");
    expect(en["person.favours.owed"]).toBe("You owe them {n}");
    expect(en["person.details"]).toBe("About them");
  });

  test("keep the English strings that the host tests read", () => {
    expect(en["top.pause"]).toBe("Pause");
    expect(en["top.resume"]).toBe("Resume");
    expect(en["status.paused"]).toBe("paused");
    expect(en["status.running"]).toBe("running");
    expect(translate("en", "notice.saved", { id: 1, tick: 120 })).toBe("saved #1 at tick 120");
    expect(en["menu.keyHeld"]).toBe("key held");
    expect(en["menu.noKey"]).toBe("no key");
  });
});

test.describe("language", () => {
  test("is chosen from the first language of the browser that the page has", () => {
    expect(detectLanguage(["zh-CN", "en"])).toBe("zh");
    expect(detectLanguage(["zh"])).toBe("zh");
    expect(detectLanguage(["zh-Hant-TW", "en-US"])).toBe("zh");
    expect(detectLanguage(["en-GB", "zh-CN"])).toBe("en");
    expect(detectLanguage(["fr-FR", "zh-CN"])).toBe("zh");
    expect(detectLanguage(["fr-FR", "de"])).toBe("en");
    expect(detectLanguage([])).toBe("en");
  });

  test("fills placeholders, leaves an unknown one as it is, and follows the current language", () => {
    expect(translate("en", "hud.day", { n: 3 })).toBe("Day 3");
    expect(translate("zh", "hud.day", { n: "三" })).toBe("第三日");
    expect(translate("en", "hud.day", {})).toBe("Day {n}");
    const seen: string[] = [];
    const stop = subscribeLang(() => seen.push(getLang()));
    setLang("zh");
    expect(t("top.pause")).toBe("暂停");
    setLang("zh");
    setLang("en");
    expect(t("top.pause")).toBe("Pause");
    stop();
    setLang("zh");
    setLang("en");
    expect(seen).toEqual(["zh", "en"]);
  });

  test("gives the lang attribute of the document", () => {
    expect(htmlLang("zh")).toBe("zh-CN");
    expect(htmlLang("en")).toBe("en");
  });

  test("picks a name in the language asked for, and borrows the other when one is empty", () => {
    expect(pick({ zh: "茶馆", en: "Teahouse" }, "zh")).toBe("茶馆");
    expect(pick({ zh: "茶馆", en: "Teahouse" }, "en")).toBe("Teahouse");
    expect(pick({ zh: "茶馆", en: "" }, "en")).toBe("茶馆");
    expect(pick("Inn", "zh")).toBe("Inn");
    expect(pick(undefined, "zh")).toBe("");
  });

  test("knows which keys exist", () => {
    expect(hasMessage("notice.connection_lost")).toBe(true);
    expect(hasMessage("notice.input_refused")).toBe(false);
    expect(hasMessage("toString")).toBe(false);
  });
});

test.describe("numbers in words", () => {
  test("Chinese numerals and English ordinals", () => {
    expect([1, 3, 7, 10, 11, 20, 25, 99, 100].map(zhNumeral)).toEqual(["一", "三", "七", "十", "十一", "二十", "二十五", "九十九", "100"]);
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((n) => ordinal("en", n))).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "101st"]);
    expect(ordinal("zh", 2)).toBe("二");
  });
});
