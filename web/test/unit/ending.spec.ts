import { expect, test } from "@playwright/test";
import { buildForest, endingFromHud, fitText, layoutForest, nodeWords, pillWidth, readEnding, readEpilogue, TREE, type Telling, textWidth, type TreeNode, versionWords, wrapText } from "../../src/page/ending.ts";

const told = (id: string, from: string, to: string, prop: string, op: string, tick: number): Telling => ({ id, from, to, prop, op, tick });

/** An `ending` event as the core writes it, cut down to a few people. */
const EVENT = {
  kind: "ending",
  tick: 1800,
  ending: "ending_split",
  label: { zh: "散场：两家分开办灯", en: "Scattered: two families light their lamps apart" },
  hidden: [{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }],
  inputs: { bridge_fixed: false, detour_done: false, reconciled: false, truth_told: true },
  passage: "none",
  promised: 3,
  turnout: 2375,
  reveal: {
    truth: { variant: "v_drunk", label: "周家大郎醉酒踢的", props: ["pr_dalang_damaged"] },
    believers: { false: ["li_er"], true: ["zhou_dalang"], none: ["old_he", "gengfu"] },
    told: { total: 82, mutated: 18 },
    chains: [
      {
        id: "ch",
        label: "从「李二在桥边找灯笼」传成「李家故意毁桥」",
        planted: [["p1", null, null], ["p2", "huoji", "zhanggui"], ["p3", "zhanggui", "cha"]],
        true: ["p1", "p2"],
        told: [
          ["c2", "huoji", "zhanggui", "p2", "", 27],
          ["c1", "li_er", "laotai", "p1", "", 18],
          ["c3", "zhanggui", "niangzi", "p3", "assimilate", 43],
          ["c4", "laotai", "xiaomei", "p1", "", 60],
          ["c5", "huoji", "niangzi", "p2", "", 70],
          ["c6", "niangzi", "huoji", "p3", "sharpen", 80],
        ],
        held: [],
        reached: ["laotai", "zhanggui", "niangzi", "xiaomei", "huoji"],
      },
    ],
    player: {
      spoke: { tellings: 4, lies: 1, ways: { faithful: 3, fabricate: 1 }, told: [], reached: ["li_er", "old_he"], retold: 2, furthest: 3, caught: [["p9", "li_er", 400]] },
      said_of_me: [["c9", "zhanggui", "cha", "p9", 500], ["c10", "cha", "niangzi", "p9", 520], ["bad"]],
      texts: { p9: { zh: "总管偏袒李家。", en: "The manager sides with the Li family." } },
    },
  },
};

test.describe("the ending event", () => {
  test("is read: the label and the hidden tags in both languages, the numbers, and what the game was built from", () => {
    const ending = readEnding(EVENT);
    expect(ending.id).toBe("ending_split");
    expect(ending.label).toEqual({ zh: "散场：两家分开办灯", en: "Scattered: two families light their lamps apart" });
    expect(ending.hidden).toEqual([{ id: "hidden_legend_of_lie", label: { zh: "谎话成了传说", en: "The lie became a legend" } }]);
    expect(ending.inputs).toEqual({ bridge_fixed: false, detour_done: false, reconciled: false, truth_told: true });
    expect(ending.passage).toBe("none");
    expect(ending.promised).toBe(3);
    expect(ending.turnout).toBe(2375);
  });

  test("keeps a label that the core gives in one language as that language only", () => {
    const reveal = readEnding(EVENT).reveal;
    expect(reveal?.truth).toEqual({ variant: "v_drunk", label: { zh: "周家大郎醉酒踢的", en: "" }, props: ["pr_dalang_damaged"] });
    expect(reveal?.chains[0]?.label?.zh).toContain("李二");
    expect(reveal?.chains[0]?.label?.en).toBe("");
  });

  test("reads the chains, the believers and the counts, and keeps the sections that other modules add", () => {
    const reveal = readEnding(EVENT).reveal;
    expect(reveal?.believers).toEqual({ false: ["li_er"], true: ["zhou_dalang"], none: ["old_he", "gengfu"] });
    expect(reveal?.told).toEqual({ total: 82, mutated: 18 });
    expect(Object.keys(reveal?.extra ?? {})).toEqual(["player"]);
    const chain = reveal?.chains[0];
    expect(chain?.trueVersions).toEqual(["p1", "p2"]);
    // The tellings come in the order they were made.
    expect(chain?.told.map((t) => t.id)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
    expect(chain?.told[2]).toEqual({ id: "c3", from: "zhanggui", to: "niangzi", prop: "p3", op: "assimilate", tick: 43 });
  });

  test("reads how far the manager's words went and what was said of them, with the text of each claim in both languages", () => {
    const reveal = readEnding(EVENT).reveal;
    expect(reveal?.spoke).toEqual({ tellings: 4, lies: 1, reached: ["li_er", "old_he"], retold: 2, furthest: 3, caught: 1 });
    expect(reveal?.saidOfMe).toEqual([
      { speaker: "zhanggui", listener: "cha", text: { zh: "总管偏袒李家。", en: "The manager sides with the Li family." } },
      { speaker: "cha", listener: "niangzi", text: { zh: "总管偏袒李家。", en: "The manager sides with the Li family." } },
    ]);
    // A reveal without the section has neither.
    const bare = readEnding({ kind: "ending", tick: 1, reveal: { truth: null, chains: [] } }).reveal;
    expect(bare?.spoke).toBeNull();
    expect(bare?.saidOfMe).toBeNull();
    // A claim whose text is not in the reveal is shown by its id.
    const odd = readEnding({ kind: "ending", tick: 1, reveal: { player: { said_of_me: [["c", "a", "b", "px", 1]] } } }).reveal;
    expect(odd?.saidOfMe).toEqual([{ speaker: "a", listener: "b", text: { zh: "px", en: "px" } }]);
  });

  test("reads an event with nothing in it, and an ending known from the numbers alone", () => {
    const bare = readEnding({ kind: "ending", tick: 1 });
    expect(bare).toMatchObject({ id: "", label: null, hidden: [], inputs: {}, passage: null, promised: null, turnout: null, reveal: null });
    expect(endingFromHud("ending_full", { promised: 12, turnout: 900 })).toEqual({
      id: "ending_full",
      label: null,
      hidden: [],
      inputs: {},
      passage: null,
      promised: 12,
      turnout: 900,
      reveal: null,
      epilogue: null,
    });
  });

  test("takes a label that is {zh, en} with one of them empty", () => {
    const ending = readEnding({ kind: "ending", tick: 1, label: { zh: "圆满", en: "" } });
    expect(ending.label).toEqual({ zh: "圆满", en: "" });
    expect(readEnding({ kind: "ending", tick: 1, label: { zh: "", en: "" } }).label).toBeNull();
  });
});

test.describe("the epilogue of the people who carry the days", () => {
  const LINES = [
    { npc: "li_laotai", id: "full", text: { zh: "李老太拄着拐杖，慢慢走过了石桥。", en: "Granny Li crossed the Stone Bridge with a stick in hand." } },
    { npc: "old_he", id: "owned", text: { zh: "船夫老何在祠堂里开了口。", en: "Boatman He spoke up in the hall." } },
  ];

  test("is read as a line for each person with words, in the order the core gave them, in both languages", () => {
    const ending = readEnding({ ...EVENT, epilogue: LINES });
    expect(ending.epilogue).toEqual(LINES);
    expect(readEpilogue(LINES)).toEqual(LINES);
  });

  test("is null where the core sends none (the compact ending) and not a list there", () => {
    expect(readEnding(EVENT).epilogue).toBeNull();
    expect(readEnding({ ...EVENT, epilogue: "no" }).epilogue).toBeNull();
    expect(readEnding({ ...EVENT, epilogue: null }).epilogue).toBeNull();
    expect(readEpilogue(undefined)).toBeNull();
  });

  test("leaves out a row with no person or no words, keeps a row with words in one language, and an empty list is a list", () => {
    const odd = readEpilogue([{ npc: "a", id: "x", text: { zh: "只有中文", en: "" } }, { id: "y", text: { zh: "没有人", en: "No one" } }, { npc: "b", id: "z" }, { npc: "c", text: { zh: "", en: "" } }, "row", 7, null]);
    expect(odd).toEqual([{ npc: "a", id: "x", text: { zh: "只有中文", en: "" } }]);
    expect(readEpilogue([])).toEqual([]);
    expect(readEpilogue([{ npc: "a", text: "一句" }])).toEqual([{ npc: "a", id: "", text: { zh: "一句", en: "" } }]);
  });
});

test.describe("the tree of a story", () => {
  const chain = readEnding(EVENT).reveal?.chains[0]?.told ?? [];

  test("puts each person where they first heard it, under the one who told them", () => {
    const forest = buildForest(chain);
    // Two people knew it first-hand and stand at the roots: the one who saw Li Er, and Li Er.
    expect(forest.map((n) => n.person).sort()).toEqual(["huoji", "li_er"]);
    const huoji = forest.find((n) => n.person === "huoji");
    expect(huoji?.heard).toBeNull();
    expect(huoji?.children.map((n) => n.person)).toEqual(["zhanggui"]);
    const zhanggui = huoji?.children[0];
    expect(zhanggui?.children.map((n) => [n.person, n.heard?.op])).toEqual([["niangzi", "assimilate"]]);
    // A person told again is left where they first heard it: huoji told niangzi later (c5), and niangzi told huoji (c6).
    const all: string[] = [];
    const walk = (nodes: typeof forest): void => nodes.forEach((n) => (all.push(n.person), walk(n.children)));
    walk(forest);
    expect(all.filter((p) => p === "niangzi")).toHaveLength(1);
    expect(all.filter((p) => p === "huoji")).toHaveLength(1);
  });

  test("lays it out left to right, a column for each step, with the parents between their children", () => {
    const layout = layoutForest(buildForest(chain), (id) => id);
    expect(layout.nodes).toHaveLength(6);
    expect(layout.edges).toHaveLength(4);
    const at = (id: string) => layout.nodes.find((n) => n.node.person === id);
    expect(at("li_er")?.x).toBe(at("huoji")?.x);
    expect(at("laotai")?.x ?? 0).toBeGreaterThan(at("li_er")?.x ?? 0);
    expect(at("niangzi")?.x ?? 0).toBeGreaterThan(at("zhanggui")?.x ?? 0);
    // A node with one child sits at the child's height.
    expect(at("zhanggui")?.y).toBe(at("niangzi")?.y);
    // No two nodes in a column overlap.
    for (const a of layout.nodes) {
      for (const b of layout.nodes) {
        if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(TREE.row - 1);
      }
    }
    for (const n of layout.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(layout.width);
      expect(n.y + TREE.height).toBeLessThanOrEqual(layout.height);
    }
  });

  test("has a width for a name that counts a Chinese character wider than a Latin one", () => {
    expect(pillWidth("李二")).toBeGreaterThan(pillWidth("Li"));
    expect(pillWidth("Shopkeeper Zhou")).toBeGreaterThan(pillWidth("李二"));
  });

  test("is empty for a story nobody told, and a single pill for one telling to nobody new", () => {
    expect(buildForest([])).toEqual([]);
    expect(layoutForest([], (id) => id).nodes).toEqual([]);
    const once = buildForest([told("c", "a", "b", "p", "", 1), told("d", "a", "b", "p", "", 2)]);
    expect(once).toHaveLength(1);
    expect(once[0]?.children).toHaveLength(1);
  });
});

/** The words of the versions of a story, as the core writes them in the `texts` of a chain. */
const WORDS = {
  looking: { zh: "李二昨夜在石桥找李二掉进水里的灯笼。", en: "Li Er was looking for Li Er's Lost Lantern at the Stone Bridge last night." },
  atBridge: { zh: "李二昨夜在石桥。", en: "Li Er was at the Stone Bridge last night." },
  damaged: { zh: "李二昨夜弄坏了石桥栏杆。", en: "Li Er damaged the Stone Bridge Railing last night." },
  onPurpose: { zh: "李家昨夜弄坏了石桥栏杆，是故意的。", en: "The Li Family damaged the Stone Bridge Railing last night, on purpose." },
} as const;

/** An ending as the core writes it now: every label in both languages, the words of every version in the chain, and the manager's part. */
const LIVE = {
  kind: "ending",
  tick: 1800,
  ending: "ending_barely",
  label: { zh: "勉强", en: "Just enough" },
  hidden: [],
  inputs: { bridge_fixed: true, detour_done: false, reconciled: false, truth_told: false },
  passage: "mended",
  promised: 9,
  turnout: 1500,
  reveal: {
    truth: { variant: "v_boat", label: { zh: "船夫老何夜里撑船撞断了栏杆。", en: "Boatman He rammed the Stone Bridge Railing with his boat at night." }, props: ["pr_he_damaged"] },
    chains: [
      {
        id: "ch_li_er_rumor",
        label: { zh: "从「李二在桥边找灯笼」传成「李家故意毁桥」", en: "From “Li Er was looking for his lantern” to “the Li family wrecked the bridge on purpose”" },
        texts: { p1: WORDS.looking, p2: WORDS.atBridge, p3: WORDS.damaged, p4: WORDS.onPurpose },
        planted: [["p1", null, null], ["p2", "huoji", "zhanggui"], ["p3", "zhanggui", "cha"], ["p4", "cha", "mujiang"]],
        true: ["p1", "p2"],
        told: [
          ["c1", "li_er", "laotai", "p1", "", 18],
          ["c2", "huoji", "zhanggui", "p2", "", 27],
          ["c3", "zhanggui", "cha", "p3", "assimilate", 43],
          ["c4", "cha", "mujiang", "p4", "sharpen", 60],
          ["c5", "player", "cha", "p3", "", 80],
        ],
        held: [],
        reached: ["laotai", "zhanggui", "cha", "mujiang"],
      },
    ],
    believers: { false: ["cha"], true: [], none: ["laotai"] },
    told: { total: 5, mutated: 2 },
    player: {
      entries: [],
      spoke: {
        tellings: 3,
        lies: 2,
        ways: { faithful: 1, fabricate: 1, as_seen: 1 },
        told: [["c9", "cha", "p3", "fabricate", 1, 400], ["c5", "cha", "p3", "faithful", 0, 80], ["c11", "mujiang", "p2", "as_seen", 1, 520]],
        reached: ["cha", "mujiang"],
        retold: 1,
        furthest: 2,
        caught: [["p3", "cha", 450]],
      },
      said_of_me: [],
      pledges: [],
      trust: [],
      stars: 1,
      texts: { p2: WORDS.atBridge, p3: WORDS.damaged },
    },
  },
};

test.describe("the ending as the core writes it now", () => {
  test("is read with every label in both languages, so that nothing is left to the page's own texts", () => {
    const ending = readEnding(LIVE);
    expect(ending.label).toEqual({ zh: "勉强", en: "Just enough" });
    expect(ending.reveal?.truth?.label).toEqual(LIVE.reveal.truth.label);
    expect(ending.reveal?.chains[0]?.label?.en).toContain("the Li family wrecked the bridge");
    expect(ending.reveal?.chains[0]?.label?.zh).toContain("李家故意毁桥");
  });

  test("is the same object in the event and in the frame, and reads the same", () => {
    // The key `ending` of a frame is the event as it was emitted, so one reader serves both.
    const fromEvent = readEnding({ ...LIVE });
    const fromFrame = readEnding(JSON.parse(JSON.stringify(LIVE)) as Record<string, unknown>);
    expect(fromFrame).toEqual(fromEvent);
  });

  test("keeps the words of every version of a story, by the id of the version, in both languages", () => {
    const chain = readEnding(LIVE).reveal?.chains[0];
    expect(Object.keys(chain?.texts ?? {})).toEqual(["p1", "p2", "p3", "p4"]);
    expect(chain?.texts.p3).toEqual(WORDS.damaged);
    expect(versionWords(chain ?? { texts: {} }, "p4", "en")).toBe(WORDS.onPurpose.en);
    expect(versionWords(chain ?? { texts: {} }, "p4", "zh")).toBe(WORDS.onPurpose.zh);
    // A version the chain has no words for says nothing, and one in a single language is given in that one.
    expect(versionWords({ texts: {} }, "px", "en")).toBe("");
    expect(versionWords({ texts: { px: { zh: "只有中文", en: "" } } }, "px", "en")).toBe("只有中文");
  });

  test("puts under each person what they said, and under one who told nobody what they were told", () => {
    const chain = readEnding(LIVE).reveal?.chains[0];
    const forest = buildForest(chain?.told ?? []);
    const search = (person: string, nodes: TreeNode[]): TreeNode | undefined => {
      for (const node of nodes) {
        if (node.person === person) return node;
        const inside = search(person, node.children);
        if (inside !== undefined) return inside;
      }
      return undefined;
    };
    const find = (person: string): TreeNode => {
      const node = search(person, forest);
      if (node === undefined) throw new Error(`${person} is not in the tree`);
      return node;
    };
    // Someone who knew the story first-hand and told it on: what they said first.
    expect(nodeWords(find("li_er"))).toEqual({ prop: "p1", said: true });
    expect(nodeWords(find("huoji"))).toEqual({ prop: "p2", said: true });
    // Shopkeeper Zhou was told the second version and passed the third on.
    expect(nodeWords(find("zhanggui"))).toEqual({ prop: "p3", said: true });
    // The carpenter and Granny Li told nobody: what they were told.
    expect(nodeWords(find("mujiang"))).toEqual({ prop: "p4", said: false });
    expect(nodeWords(find("laotai"))).toEqual({ prop: "p1", said: false });
    // Nobody in the chain said or heard anything: nothing to write.
    expect(nodeWords({ person: "x", heard: null, children: [] })).toBeNull();
  });

  test("reads what the manager told, each with its words, its way, whether it was a lie and whether it was caught, in the order told", () => {
    const told = readEnding(LIVE).reveal?.tellings;
    expect(told?.map((t) => [t.listener, t.way, t.lie, t.caught, t.tick])).toEqual([
      ["cha", "faithful", false, false, 80],
      ["cha", "fabricate", true, true, 400],
      ["mujiang", "as_seen", true, false, 520],
    ]);
    expect(told?.[0]?.text).toEqual(WORDS.damaged);
    // The words of a telling the section has no text for are left out.
    const bare = readEnding({ kind: "ending", reveal: { player: { spoke: { tellings: 1, told: [["c", "x", "pz", "faithful", 0, 1]], caught: [] }, texts: {} } } }).reveal?.tellings;
    expect(bare?.[0]?.text).toBeNull();
    // Without the section, or without its list, there is nothing to show.
    expect(readEnding({ kind: "ending", reveal: {} }).reveal?.tellings).toBeNull();
    expect(readEnding({ kind: "ending", reveal: { player: { spoke: { tellings: 0 } } } }).reveal?.tellings).toBeNull();
  });
});

test.describe("words under a name", () => {
  test("have a width by the count of wide and narrow characters, and are cut short with an ellipsis to fit", () => {
    expect(textWidth("李二", 11)).toBe(22);
    expect(textWidth("ab", 10)).toBeCloseTo(11.6, 5);
    expect(fitText("short", 200, 11)).toBe("short");
    const cut = fitText(WORDS.looking.en, 100, 11);
    expect(cut.endsWith("…")).toBe(true);
    expect(textWidth(cut, 11)).toBeLessThanOrEqual(100);
    expect(cut.length).toBeLessThan(WORDS.looking.en.length);
    const wide = fitText(WORDS.looking.zh, 66, 11);
    expect(wide).toBe("李二昨夜在…");
    expect(textWidth(wide, 11)).toBeLessThanOrEqual(66);
  });

  test("are broken between English words and between Chinese characters, and a closing mark never begins a line", () => {
    const en = wrapText(WORDS.atBridge.en, 130, 11, 3);
    expect(en.join(" ")).toBe(WORDS.atBridge.en);
    for (const line of en) expect(textWidth(line, 11)).toBeLessThanOrEqual(130);
    expect(en.length).toBeGreaterThan(1);
    const zh = wrapText("李家昨夜弄坏了石桥栏杆，是故意的。", 66, 11, 4);
    expect(zh.join("")).toBe("李家昨夜弄坏了石桥栏杆，是故意的。");
    for (const line of zh) expect("。，".includes(line[0] ?? "")).toBe(false);
  });

  test("stop at the number of lines asked for, the last of which ends with an ellipsis", () => {
    const lines = wrapText(WORDS.onPurpose.en, 130, 11, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]?.endsWith("…")).toBe(true);
    for (const line of lines) expect(textWidth(line, 11)).toBeLessThanOrEqual(130);
    // Words that fit in the lines are not marked as cut.
    expect(wrapText("Li Er was at the bridge.", 130, 11, 2).join(" ")).not.toContain("…");
    expect(wrapText("anything", 100, 11, 0)).toEqual([]);
    expect(wrapText("", 100, 11, 2)).toEqual([]);
  });

  test("leave room in the layout: a column is as wide as the words need and a row has the lines under the pill", () => {
    const forest = buildForest(readEnding(LIVE).reveal?.chains[0]?.told ?? []);
    const layout = layoutForest(forest, () => "Li");
    for (const node of layout.nodes) expect(node.col).toBeGreaterThanOrEqual(TREE.column);
    for (const a of layout.nodes) for (const b of layout.nodes) if (a !== b && a.x === b.x) expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(TREE.height + TREE.words);
    const lowest = Math.max(...layout.nodes.map((n) => n.y));
    expect(layout.height).toBeGreaterThanOrEqual(lowest + TREE.height + TREE.words);
    // The lines that fit under a pill fit in the room the layout gives them.
    expect(TREE.lines * TREE.line + 2).toBeLessThanOrEqual(TREE.words);
  });
});
