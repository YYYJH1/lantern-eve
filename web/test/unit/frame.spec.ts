import { expect, test } from "@playwright/test";
import { pick } from "../../src/i18n/index.ts";
import { daylight, dayPart, NIGHT_LIGHT, readFrame, shichen, topicKind } from "../../src/page/frame.ts";
import { wrapChinese } from "../../src/page/map/wrap.ts";
import { readHud, readVerbs } from "../../src/page/hud.ts";
import { readNotebook } from "../../src/page/notebook.ts";
import { sampleNotebook } from "../../src/page/notebook-sample.ts";
import { parseScene, readName, terrainAt } from "../../src/page/scene.ts";
import { microText } from "../../src/page/ui/format.ts";
import type { Frame } from "../../src/shared/protocol.ts";

test.describe("the clock of the interface", () => {
  test("names the double hour of the Chinese day", () => {
    expect([23, 0, 1, 5, 6, 7, 15, 16, 17, 21, 22].map(shichen)).toEqual(["子", "子", "丑", "卯", "卯", "辰", "申", "申", "酉", "亥", "亥"]);
  });

  test("names the part of the day", () => {
    expect([5, 6, 8, 11, 12, 14, 17, 20, 21, 23, 2, 4].map(dayPart)).toEqual(["dawn", "dawn", "morning", "noon", "noon", "afternoon", "evening", "evening", "night", "night", "night", "night"]);
  });

  test("gives full light from morning to late afternoon, a dusk, a night and a dawn", () => {
    expect(daylight(6, 0)).toBe(1);
    expect(daylight(12, 30)).toBe(1);
    expect(daylight(17, 29)).toBe(1);
    const dusk = [18, 19, 20].map((h) => daylight(h, 0));
    expect(dusk[0]).toBeLessThan(1);
    expect(dusk[0]).toBeGreaterThan(dusk[1] ?? 0);
    expect(dusk[1]).toBeGreaterThan(dusk[2] ?? 0);
    expect(daylight(21, 0)).toBeCloseTo(NIGHT_LIGHT, 2);
    expect(daylight(2, 0)).toBe(NIGHT_LIGHT);
    expect(daylight(4, 30)).toBe(NIGHT_LIGHT);
    expect(daylight(5, 15)).toBeGreaterThan(NIGHT_LIGHT);
    expect(daylight(5, 15)).toBeLessThan(1);
    expect(daylight(6, 0)).toBe(1);
    // A rise that never goes back down in the morning, a fall that never goes back up in the evening.
    let last = 0;
    for (let m = 4 * 60; m <= 6 * 60; m += 5) {
      const now = daylight(Math.floor(m / 60), m % 60);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
    for (let m = 17 * 60; m <= 21 * 60; m += 5) {
      const now = daylight(Math.floor(m / 60), m % 60);
      if (m > 17 * 60) expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
  });
});

test.describe("rumours", () => {
  test("have the three topics the core sends, each its own colour class", () => {
    // `Lore.topic` of the core: blame for a claim that someone broke or took something, clear for a denial or a cause nobody is to blame for, else other.
    expect(["blame", "clear", "other"].map(topicKind)).toEqual(["blame", "clear", "other"]);
  });

  test("are red when they blame, blue when they clear, and neutral otherwise", () => {
    expect(topicKind("blame_li_er")).toBe("blame");
    expect(topicKind("accuse")).toBe("blame");
    expect(topicKind("who wrecked the bridge")).toBe("blame");
    expect(topicKind("clear_li_er")).toBe("clear");
    expect(topicKind("exculpate")).toBe("clear");
    expect(topicKind("innocent")).toBe("clear");
    expect(topicKind("澄清")).toBe("clear");
    expect(topicKind("weather")).toBe("other");
    expect(topicKind("")).toBe("other");
  });
});

test.describe("the frame as the page reads it", () => {
  test("takes the bridge frame as it is", () => {
    const frame: Frame = {
      npcs: [
        { id: "a", x: 3, y: 4, activity: "walk", carrying: "bamboo", status: "load" } as unknown as Frame["npcs"][number],
        { id: "b", x: 5, y: 6 },
      ],
      time: { day: 2, hour: 15, minute: 40, phase: "day" },
      weather: "light_rain",
      bubbles: [{ npc: "a", until: 90, text: { zh: "你好", en: "Hello" } }],
      dots: [{ id: "d", from: "a", to: "b", topic: "blame_x", progress: 400 }],
      lanterns: [{ household: "h", place: "p", x: 1, y: 2 }],
      hud: { promised: 3 },
    };
    const read = readFrame(frame);
    expect(read.people[0]).toEqual({ id: "a", x: 3, y: 4, activity: "walk", carrying: "bamboo", status: "load" });
    expect(read.people[1]).toEqual({ id: "b", x: 5, y: 6, activity: "", carrying: null, status: null });
    expect(read.time).toEqual({ day: 2, hour: 15, minute: 40, phase: "day" });
    expect(read.weather).toBe("light_rain");
    expect(read.bubbles).toEqual([{ npc: "a", until: 90, text: { zh: "你好", en: "Hello" } }]);
    expect(read.dots).toEqual([{ id: "d", from: "a", to: "b", topic: "blame_x", progress: 400 }]);
    expect(read.lanterns).toEqual([{ household: "h", place: "p", x: 1, y: 2 }]);
    expect(read.hud).toEqual({ promised: 3 });
  });

  test("takes the demo frame, which has no phase, no weather and none of the lists", () => {
    const read = readFrame({ npcs: [{ id: "n", x: 1, y: 1 }], time: { day: 1, hour: 22, minute: 5 } } as Frame);
    expect(read.time.phase).toBe("night");
    expect(read.weather).toBe("clear");
    expect(read.bubbles).toEqual([]);
    expect(read.dots).toEqual([]);
    expect(read.lanterns).toEqual([]);
    expect(read.hud).toEqual({});
  });

  test("drops what is malformed and keeps a line that is a plain string", () => {
    const read = readFrame({
      npcs: [],
      bubbles: [{ npc: "a", until: 5, text: "just text" }, { npc: 7 }, "x", { npc: "b", text: { zh: "", en: "" } }],
      dots: [{ from: "a" }, { from: "a", to: "b", topic: "t", progress: 5000 }],
      lanterns: [{ x: "1", y: 2 }, { x: 1, y: 2 }],
    } as unknown as Frame);
    expect(read.bubbles).toHaveLength(1);
    expect(read.bubbles[0]?.text).toEqual({ zh: "just text", en: "just text" });
    // The frame has no list of the people a line sends the player to, and a key like that is not read: the event of the answer says it.
    const pointed = readFrame({ npcs: [], bubbles: [{ npc: "a", text: "ask him", points: ["b", "c"] }] } as unknown as Frame);
    expect(pointed.bubbles).toEqual([{ npc: "a", until: Number.POSITIVE_INFINITY, text: { zh: "ask him", en: "ask him" } }]);
    expect(read.dots).toHaveLength(1);
    expect(read.dots[0]?.progress).toBe(1000);
    expect(read.lanterns).toHaveLength(1);
  });

  test("reads people who talk beyond hearing as talkers, with no words to show, and nothing else without words", () => {
    // The core says that they talk and not what about: `text` is null and `talking` is true.
    const read = readFrame({
      npcs: [],
      bubbles: [
        { npc: "a", until: 9, text: { zh: "你好", en: "Hello" } },
        { npc: "b", until: 9, text: null, talking: true },
        { npc: "b", until: 12, text: null, talking: true },
        { npc: "c", until: 9, text: null },
        { npc: "d", until: 9, text: { zh: "", en: "" }, talking: false },
      ],
    } as unknown as Frame);
    expect(read.bubbles.map((b) => b.npc)).toEqual(["a"]);
    expect(read.talkers).toEqual(["b"]);
    expect(readFrame({ npcs: [] } as unknown as Frame).talkers).toEqual([]);
  });

  test("never takes the words of a bubble that has `talking`: it is a marker over the speaker and no line", () => {
    const read = readFrame({
      npcs: [],
      bubbles: [
        { npc: "a", until: 9, text: { zh: "不该听见", en: "Not for your ears" }, talking: true },
        { npc: "b", until: 9, text: { zh: "你好", en: "Hello" } },
      ],
    } as unknown as Frame);
    expect(read.talkers).toEqual(["a"]);
    expect(read.bubbles).toEqual([{ npc: "b", until: 9, text: { zh: "你好", en: "Hello" } }]);
    expect(JSON.stringify(read.bubbles)).not.toContain("Not for your ears");
  });
});

test.describe("the player in the frame", () => {
  test("is where they stand, what they do, the talk they are in, what they can look at and what the core offers", () => {
    const read = readFrame({
      npcs: [],
      player: {
        x: 27,
        y: 15,
        activity: "chat",
        talk: { npc: "cha_laoban" },
        look: ["t_rail", 3],
        offers: { tell: [{ id: "n1", zh: "甲", en: "A", body: { entry: "n1", how: "plain" } }, { id: "n2", label: { zh: "乙", en: "B" } }, { zh: "no id" }], promise: "nope" },
      },
    } as unknown as Frame);
    expect(read.player).toEqual({
      x: 27,
      y: 15,
      activity: "chat",
      // A frame that says nothing of what each act costs or when the person leaves reads as none.
      talk: { npc: "cha_laoban", costs: null, leavesAt: null, more: null },
      costs: null,
      look: ["t_rail"],
      offers: {
        tell: [
          { id: "n1", name: { zh: "甲", en: "A" }, body: { entry: "n1", how: "plain" } },
          { id: "n2", name: { zh: "乙", en: "B" }, body: null },
        ],
        promise: [],
      },
      topics: [],
    });
  });

  test("is none in the demo frame, and one that stands still has no talk and nothing to look at", () => {
    expect(readFrame({ npcs: [] }).player).toBeNull();
    expect(readFrame({ npcs: [], player: { x: "1", y: 2 } } as unknown as Frame).player).toBeNull();
    expect(readFrame({ npcs: [], player: { x: 1, y: 2, activity: "rest", talk: null, look: [] } } as unknown as Frame).player).toEqual({ x: 1, y: 2, activity: "rest", talk: null, costs: null, look: [], offers: {}, topics: [] });
  });
});

test.describe("the numbers of the side panel", () => {
  test("are empty until the core sends them", () => {
    expect(readHud({})).toEqual({
      promised: null,
      turnout: null,
      bridge: null,
      reputation: null,
      cost: null,
      cap: null,
      stage: null,
      spentMicro: null,
      heldMicro: null,
      capMicro: null,
      cloud: null,
      local: null,
      pledges: null,
      resources: null,
    });
    expect(readVerbs({})).toEqual(new Set());
  });

  test("are read under their names and under the aliases", () => {
    const hud = readHud({
      promises: 23,
      expected_turnout: 1800,
      bridge: { workers: 3, required: 5, missing: "bamboo", state: "repairing" },
      standing: 2,
      spent: 310_000,
    });
    expect(hud.promised).toBe(23);
    expect(hud.turnout).toBe(1800);
    expect(hud.bridge).toMatchObject({ done: 3, need: 5, lackingId: "bamboo", lacking: null, state: "repairing" });
    expect(hud.reputation).toBe(2);
    expect(hud.cost).toBeCloseTo(0.31, 6);
  });

  test("take the budget gate's own keys for the cost, the cap and the stage", () => {
    const hud = readHud({ spent: 310_000, held: 20_000, cap: 3_000_000, stage: 1, cloud: true, local: false, keen: 57 });
    expect(hud.cost).toBeCloseTo(0.31, 6);
    expect(hud.cap).toBe(3);
    expect(hud.stage).toBe(1);
    expect(readHud({ cap: 0 }).cap).toBeNull();
    // The same money as the core counts it, in millionths of a yuan, and what the host last said.
    expect(hud).toMatchObject({ spentMicro: 310_000, heldMicro: 20_000, capMicro: 3_000_000, cloud: true, local: false });
    expect(readHud({ cloud: "yes", local: 1 })).toMatchObject({ cloud: null, local: null });
  });

  test("read the work on the bridge: the percent, and the work hours done of those it takes", () => {
    expect(readHud({ bridge: { done: 3, need: 5, percent: 40, hours: 4, hours_need: 10, state: "repairing" } }).bridge).toMatchObject({ done: 3, need: 5, percent: 40, hours: 4, hoursNeed: 10, state: "repairing" });
    expect(readHud({ bridge: { done: 3, need: 5, percent: 400 } }).bridge?.percent).toBe(100);
    expect(readHud({ bridge: { done: 3, need: 5 } }).bridge).toMatchObject({ percent: null, hours: null, hoursNeed: null });
  });

  test("read a bridge given as a percent, a named missing item, and a reputation given as a percent", () => {
    expect(readHud({ bridge: 40 }).bridge).toMatchObject({ percent: 40, done: null });
    expect(readHud({ bridge: { done: 1, need: 2, lacking: { zh: "竹料", en: "bamboo" } } }).bridge?.lacking).toEqual({ zh: "竹料", en: "bamboo" });
    expect(readHud({ reputation: 100 }).reputation).toBe(3);
    expect(readHud({ reputation: 50 }).reputation).toBe(2);
    expect(readHud({ reputation: -4 }).reputation).toBe(0);
  });

  test("offer the verbs that the frame lists", () => {
    expect(readVerbs({ verbs: ["ask", "tell", 4] })).toEqual(new Set(["ask", "tell"]));
  });
});

test.describe("the notebook", () => {
  test("is read from the frame when the frame has one", () => {
    expect(readNotebook({})).toBeNull();
    const entries = readNotebook({
      notebook: [
        { id: "a", text: { zh: "甲", en: "A" }, source: { kind: "heard", who: { zh: "乙", en: "B", id: "b" }, how: "heard", via: { zh: "丙", en: "C" } }, at: { tick: 40, day: 1, hour: 8, minute: 20, place: "p_teahouse" }, marks: ["unconfirmed", "nonsense"], chain: [{ zh: "乙", en: "B" }, null] },
        { id: "b", text: "plain", source: { kind: "seen" } },
        { text: "no id" },
      ],
    });
    expect(entries).toHaveLength(2);
    expect(entries?.[0]).toMatchObject({ id: "a", marks: ["unconfirmed"], source: { kind: "heard", whoId: "b", how: "heard", via: { zh: "丙", en: "C" } }, at: { tick: 40, day: 1, hour: 8, minute: 20, place: "p_teahouse" }, chain: [{ zh: "乙", en: "B" }, null] });
    expect(entries?.[1]).toMatchObject({ id: "b", text: { zh: "plain", en: "plain" }, source: { kind: "seen" }, marks: [], chain: [] });
  });

  test("has sample entries with every mark, a seen entry and a heard one, in both languages", () => {
    const sample = sampleNotebook();
    expect(new Set(sample.flatMap((e) => e.marks))).toEqual(new Set(["contradicts", "unsupported", "sourceMismatch", "unconfirmed"]));
    expect(sample.some((e) => e.source.kind === "seen")).toBe(true);
    expect(sample.some((e) => e.source.kind === "heard")).toBe(true);
    for (const e of sample) {
      expect(e.text.zh).not.toBe("");
      expect(e.text.en).not.toBe("");
    }
  });
});

test.describe("the scene", () => {
  test("reads the bridge scene: layers, places with names in two languages, a cast with tokens", () => {
    const scene = parseScene({
      scenario: "bridge",
      name: { zh: "澄溪镇", en: "Chengxi Town" },
      width: 4,
      height: 2,
      layers: {
        terrain: { rows: ["~.,=", "##H:"], legend: [{ char: "~", id: "river" }, { char: ".", id: "grass" }, { char: ",", id: "street" }, { char: "=", id: "bridge" }, { char: "#", id: "wall" }, { char: "H", id: "building" }, { char: ":", id: "lane" }] },
        buildings: [{ kind: "house", place: "p1", rect: [2, 1, 1, 1] }],
        barriers: [{ id: "b", place: "p1", cells: [[3, 1]], closed: "#", open: ":", zh: "路障", en: "Barrier" }],
      },
      places: [{ id: "p1", kind: "house", indoor: true, rect: [0, 0, 2, 2], door: [1, 1], stands: [[0, 1]], cells: [], zh: "宅", en: "House" }],
      cast: [{ id: "c1", zh: "李老太", en: "Granny Li", role: { zh: "老太太", en: "Matriarch" }, token: { zh: "李", en: "L" }, family: "fam_li", home: "p1", work: "p1" }],
      families: [{ id: "fam_li", zh: "李家", en: "Li Family" }],
      items: [{ id: "bamboo", zh: "竹料", en: "Bamboo" }],
      activities: [{ id: "walk", zh: "赶路", en: "Walking", system: true }],
      weather: [{ id: "clear", zh: "晴", en: "Clear" }],
      time: { days: 5 },
    });
    expect(scene.plain).toBe(false);
    expect(scene.name).toEqual({ zh: "澄溪镇", en: "Chengxi Town" });
    expect(terrainAt(scene, 0, 0)).toBe("river");
    expect(terrainAt(scene, 3, 0)).toBe("bridge");
    expect(terrainAt(scene, 9, 9)).toBeNull();
    expect(scene.places[0]).toMatchObject({ id: "p1", kind: "house", door: [1, 1], rect: { x: 0, y: 0, w: 2, h: 2 }, name: { zh: "宅", en: "House" } });
    expect(scene.cast[0]).toMatchObject({ id: "c1", name: { zh: "李老太", en: "Granny Li" }, token: { zh: "李", en: "L" }, family: "fam_li" });
    expect(scene.buildings).toEqual([{ kind: "house", place: "p1", x: 2, y: 1, w: 1, h: 1 }]);
    expect(scene.barriers[0]?.cells).toEqual([[3, 1]]);
    expect(scene.families.get("fam_li")?.en).toBe("Li Family");
    expect(scene.days).toBe(5);
  });

  test("reads what the town says of each person in two languages, and nothing where the scene has none", () => {
    const bio = { zh: "李老太守寡多年。李家的大事，最后都要她点头。", en: "Granny Li has been a widow for many years. Nothing large is decided in the Li house until she nods." };
    const scene = parseScene({
      scenario: "bridge",
      cast: [
        { id: "li_laotai", zh: "李老太", en: "Granny Li", role: { zh: "李家老太太", en: "Matriarch" }, bio, token: { zh: "李", en: "L" }, family: "fam_li", home: null, work: null },
        { id: "li_da", zh: "李大", en: "Li Da", role: { zh: "李家长子", en: "Eldest son" }, token: { zh: "李", en: "L" }, family: "fam_li", home: null, work: null },
        { id: "zuzhang", zh: "族长", en: "Clan Elder", role: { zh: "族长", en: "Elder" }, bio: { en: "Only the English." }, token: { zh: "族", en: "C" }, family: null, home: null, work: null },
        { id: "odd", zh: "怪", en: "Odd", bio: 7 },
      ],
    });
    expect(scene.cast[0]?.bio).toEqual(bio);
    // A scene without one gives an empty bio, which the card leaves out, and a language that is missing borrows the other.
    expect(scene.cast[1]?.bio).toEqual({ zh: "", en: "" });
    expect(scene.cast[2]?.bio).toEqual({ zh: "Only the English.", en: "Only the English." });
    expect(scene.cast[3]?.bio).toEqual({ zh: "", en: "" });
    expect(pick(scene.cast[0]?.bio, "zh")).toBe(bio.zh);
    expect(pick(scene.cast[0]?.bio, "en")).toBe(bio.en);
    expect(pick(scene.cast[1]?.bio, "en")).toBe("");
    // The demo world has none either.
    expect(parseScene({ npcs: [{ id: "npc00", name: "阿明", role: "船夫" }] }).cast[0]?.bio).toEqual({ zh: "", en: "" });
  });

  test("reads the player of the bridge scene: a name in two languages, a token, where they start, and the things of the story", () => {
    const scene = parseScene({
      scenario: "bridge",
      player: {
        id: "player",
        zh: "总管",
        en: "Festival Manager",
        role: { zh: "灯会总管", en: "Manager of the lantern festival" },
        token: { zh: "总", en: "M" },
        start: [27, 15],
        things: [{ id: "t_rail", zh: "石桥栏杆", en: "Stone Bridge Railing" }, { zh: "no id" }],
      },
    });
    expect(scene.player).toEqual({
      id: "player",
      name: { zh: "总管", en: "Festival Manager" },
      role: { zh: "灯会总管", en: "Manager of the lantern festival" },
      token: { zh: "总", en: "M" },
      start: [27, 15],
      things: [{ id: "t_rail", name: { zh: "石桥栏杆", en: "Stone Bridge Railing" } }],
    });
    expect(parseScene({ scenario: "m0" }).player).toBeNull();
  });

  test("reads the demo scene as a plain grid, with its terrain named as the town names it", () => {
    const scene = parseScene({
      width: 3,
      height: 1,
      rows: [".,#"],
      legend: { "#": "blocked", ",": "road", ".": "grass" },
      places: [{ id: "teahouse", x: 1, y: 0, w: 2, h: 1 }],
      npcs: [{ id: "npc00", name: "阿明", role: "船夫" }],
    });
    expect(scene.plain).toBe(true);
    expect(terrainAt(scene, 1, 0)).toBe("street");
    expect(terrainAt(scene, 2, 0)).toBe("wall");
    expect(scene.places[0]).toMatchObject({ id: "teahouse", rect: { x: 1, y: 0, w: 2, h: 1 }, name: { zh: "teahouse", en: "teahouse" } });
    expect(scene.cast[0]).toMatchObject({ id: "npc00", token: { zh: "阿", en: "阿" } });
  });

  test("survives a scene with nothing in it", () => {
    const scene = parseScene({ scenario: "x" });
    expect(scene.width).toBe(0);
    expect(scene.places).toEqual([]);
    expect(scene.cast).toEqual([]);
    expect(readName(undefined, "?")).toEqual({ zh: "?", en: "?" });
  });
});

test.describe("the lines in a speech bubble", () => {
  // Every character is 10 px wide, and a line holds at most 80 px, that is eight characters.
  const wide = (): number => 10;

  test("break between any two Chinese characters, at the width", () => {
    expect(wrapChinese("一二三四五六七八九十", 80, wide)).toBe("一二三四五六七八\n九十");
    expect(wrapChinese("一二三四", 80, wide)).toBe("一二三四");
    expect(wrapChinese("", 80, wide)).toBe("");
  });

  test("never start a line with a closing mark, so a full stop is not left alone", () => {
    expect(wrapChinese("一二三四五六七八。", 80, wide)).toBe("一二三四五六七八。");
    expect(wrapChinese("一二三四五六七八」，九", 80, wide)).toBe("一二三四五六七八」，\n九");
  });

  test("never end a line with an opening mark", () => {
    expect(wrapChinese("一二三四五六七「八九", 80, wide)).toBe("一二三四五六七\n「八九");
  });
});

test.describe("the topics of a question", () => {
  const player = (topics: unknown) => ({ npcs: [], player: { x: 1, y: 2, activity: "chat", talk: { npc: "cha" }, look: [], offers: {}, topics } }) as unknown as Frame;

  test("are what the core lists, in its order, each with its name in both languages and its kind", () => {
    const read = readFrame(
      player([
        { id: "n1", kind: "entry", label: { zh: "渡船是老何的。", en: "The boat belongs to Boatman He." } },
        { id: "t_rail", kind: "thing", label: { zh: "石桥栏杆", en: "Stone Bridge Railing" } },
        { id: "p_bridge", kind: "place", label: { zh: "石桥", en: "Stone Bridge" } },
        { id: "li_er", kind: "person", label: { zh: "李二", en: "Li Er" } },
      ]),
    ).player;
    expect(read?.topics).toEqual([
      { id: "n1", kind: "entry", name: { zh: "渡船是老何的。", en: "The boat belongs to Boatman He." } },
      { id: "t_rail", kind: "thing", name: { zh: "石桥栏杆", en: "Stone Bridge Railing" } },
      { id: "p_bridge", kind: "place", name: { zh: "石桥", en: "Stone Bridge" } },
      { id: "li_er", kind: "person", name: { zh: "李二", en: "Li Er" } },
    ]);
  });

  test("leave out a topic of a kind that the page has no group for, or without an id, and are none when the frame has none", () => {
    expect(readFrame(player([{ id: "x", kind: "rumour", label: "x" }, { kind: "thing", label: "no id" }, "nope", { id: "a", kind: "thing", label: "plain" }])).player?.topics).toEqual([{ id: "a", kind: "thing", name: { zh: "plain", en: "plain" } }]);
    expect(readFrame(player([])).player?.topics).toEqual([]);
    expect(readFrame(player(undefined)).player?.topics).toEqual([]);
    expect(readFrame(player("nope")).player?.topics).toEqual([]);
  });
});

test.describe("the ending in the frame", () => {
  test("is the object the core puts in every frame after the last night, and none before", () => {
    expect(readFrame({ npcs: [] }).ending).toBeNull();
    expect(readFrame({ npcs: [], ending: null } as unknown as Frame).ending).toBeNull();
    expect(readFrame({ npcs: [], ending: "ending_full" } as unknown as Frame).ending).toBeNull();
    const ending = { kind: "ending", ending: "ending_full", label: { zh: "圆满", en: "A perfect night" } };
    expect(readFrame({ npcs: [], ending } as unknown as Frame).ending).toEqual(ending);
  });
});

test.describe("the promises in the numbers of the side panel", () => {
  test("are the open promises with whom they were made to, what, and by which day, and what is left to promise", () => {
    const hud = readHud({
      pledges: [
        { id: "k1", to: { zh: "茶馆老板娘", en: "Teahouse Keeper", id: "cha_laoban" }, what: "stall", item: "front", amount: 0, due: 3 },
        { id: "k2", to: { zh: "老何", en: "Boatman He", id: "old_he" }, what: "wage", item: "", amount: 20, due: 4 },
        { to: "no id" },
      ],
      resources: { stall_front: 1, stall_back: 4, roles: ["t_honor_light", 3], slots: ["1", "2"], purse: 40 },
    });
    expect(hud.pledges).toEqual([
      { id: "k1", to: { zh: "茶馆老板娘", en: "Teahouse Keeper" }, what: "stall", item: "front", amount: 0, due: 3 },
      { id: "k2", to: { zh: "老何", en: "Boatman He" }, what: "wage", item: "", amount: 20, due: 4 },
    ]);
    expect(hud.resources).toEqual({ stallFront: 1, stallBack: 4, roles: ["t_honor_light"], slots: ["1", "2"], purse: 40 });
  });

  test("are none until the frame says, and an empty list is not the same as none", () => {
    expect(readHud({}).pledges).toBeNull();
    expect(readHud({}).resources).toBeNull();
    expect(readHud({ pledges: [], resources: {} }).pledges).toEqual([]);
    expect(readHud({ resources: {} }).resources).toEqual({ stallFront: 0, stallBack: 0, roles: [], slots: [], purse: 0 });
    expect(readHud({ pledges: "nope", resources: 3 }).pledges).toBeNull();
    expect(readHud({ pledges: "nope", resources: 3 }).resources).toBeNull();
  });
});

test.describe("money in micro-yuan", () => {
  test("is written whole, down to the last micro-yuan, without the zeros at the end", () => {
    const cases: Array<[number, string]> = [
      [0, "¥0"],
      [1, "¥0.000001"],
      [70, "¥0.00007"],
      [196, "¥0.000196"],
      [980, "¥0.00098"],
      [30_000, "¥0.03"],
      [1_000_000, "¥1"],
      [3_000_000, "¥3"],
      [3_070_001, "¥3.070001"],
    ];
    for (const [micro, text] of cases) expect(microText(micro), String(micro)).toBe(text);
  });
});
