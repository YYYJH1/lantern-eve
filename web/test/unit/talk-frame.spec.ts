import { expect, test } from "@playwright/test";
import { contextItems } from "../../src/page/context-items.ts";
import type { Topic } from "../../src/page/frame.ts";
import { readNotebook } from "../../src/page/notebook.ts";
import { heartParts, readRelations, whyOf } from "../../src/page/relations.ts";
import { readSlice } from "../../src/page/slice.ts";
import { canFollowUp, entryOfAnswer, frontierEntries, proposalId, rankTopics, readGiftHud, readTalkMore, TOP_TOPICS, type TopicContext } from "../../src/page/talk-frame.ts";
import { deltaWords, heartsWords } from "../../src/page/ui/hearts-words.ts";
import { setLang } from "../../src/i18n/index.ts";
import * as fake from "../support/slice.ts";

const n = (zh: string, en: string) => ({ zh, en });

/** The keys of `player.talk` as the core sends them after Shopkeeper Zhou turned a request down for want of weight. */
const AFTER_REFUSAL = {
  npc: "zhou_zhanggui",
  ask_for: null,
  asks_more: [
    { id: "material", label: n("请周掌柜把木料送到桥边", "Ask Shopkeeper Zhou to bring the timber to the bridge"), body: { kind: "material" }, status: "refused" },
    { id: "join", label: n("请周掌柜加入帮工", "Ask Shopkeeper Zhou to join the helpers"), body: { kind: "join" }, status: "open" },
  ],
  wants: {
    key: "zhou_zhanggui|material|timber",
    token: "572e6130",
    asks: n("请周掌柜把木料送到桥边", "Ask Shopkeeper Zhou to bring the timber to the bridge"),
    request: { id: "material", label: n("请周掌柜把木料送到桥边", "Ask Shopkeeper Zhou to bring the timber to the bridge"), body: { kind: "material" }, status: "refused" },
    offer: { id: "stall:front", label: n("许对方一个前排摊位", "Promise a front-row stall"), body: { op: "make", due: 3, what: "stall", item: "front" } },
  },
  keep: null,
  give: {
    preferred: { id: "stall:front", label: n("许对方一个前排摊位", "Promise a front-row stall"), body: { op: "make", due: 3, what: "stall", item: "front" } },
    more: [{ id: "stall:back", label: n("许对方一个后排摊位", "Promise a back-row stall"), body: { op: "make", due: 3, what: "stall", item: "back" } }],
    ways: [],
  },
  queue: [{ kind: "answer", key: "zhou_zhanggui|material|timber", token: "572e6130" }, { kind: "give" }],
};

const KEEP = {
  kind: "keep",
  pledge: "k2",
  due: 2,
  early: true,
  what: n("节目单上的第二位", "place 2 in the programme"),
  offer: { id: "keep:k2", label: n("兑现许诺 k2", "Keep promise k2"), body: { op: "keep", id: "k2" } },
};

test.describe("the keys of a talk", () => {
  test("are read as the core sends them: the request put forward, the others with their state, what is asked in return, the promises", () => {
    const more = readTalkMore({
      ...AFTER_REFUSAL,
      ask_for: { id: "lend", label: n("请李老太把竹料借给灯会", "Ask Granny Li to lend the bamboo for the bridge"), body: { kind: "lend" }, status: "open", for: "t_bamboo_first" },
    });
    expect(more).not.toBeNull();
    expect(more?.askFor).toMatchObject({ id: "lend", status: "open", task: "t_bamboo_first", body: { kind: "lend" } });
    expect(more?.askFor?.name).toEqual(n("请李老太把竹料借给灯会", "Ask Granny Li to lend the bamboo for the bridge"));
    expect(more?.asksMore.map((a) => [a.id, a.status])).toEqual([
      ["material", "refused"],
      ["join", "open"],
    ]);
    expect(more?.wants).toMatchObject({ token: "572e6130", offer: { id: "stall:front", body: { op: "make", what: "stall", item: "front" } }, request: { status: "refused" } });
    expect(more?.give.preferred?.id).toBe("stall:front");
    expect(more?.give.more.map((o) => o.id)).toEqual(["stall:back"]);
    expect(more?.queue.map((q) => q.kind)).toEqual(["answer", "give"]);
  });

  test("have none of it in a talk of an older shape, and the reader says so", () => {
    expect(readTalkMore({ npc: "li_laotai", costs: fake.COSTS, leaves_at: { hour: 15, minute: 30 } })).toBeNull();
  });

  test("keep a promise that can be kept now with the words for it, and drop an item of the queue that the page does not know", () => {
    const more = readTalkMore({ ...AFTER_REFUSAL, wants: null, keep: KEEP, queue: [KEEP, { kind: "dance" }, { kind: "give" }] });
    expect(more?.keep).toMatchObject({ pledge: "k2", due: 2, early: true, what: n("节目单上的第二位", "place 2 in the programme") });
    expect(more?.queue.map((q) => q.kind)).toEqual(["keep", "give"]);
  });

  test("say which ways are left when nothing can be promised", () => {
    const more = readTalkMore({ ...AFTER_REFUSAL, give: { preferred: null, more: [], ways: ["clear_truth", "gift", "nonsense"] }, queue: [{ kind: "give" }] });
    expect(more?.give).toEqual({ preferred: null, more: [], ways: ["clear_truth", "gift"] });
  });
});

test.describe("what the page shows besides the four acts", () => {
  test("is the first item of the queue, in the order of the core, with the rest counted", () => {
    const more = readTalkMore({ ...AFTER_REFUSAL, keep: KEEP, queue: [{ kind: "answer", key: "zhou_zhanggui|material|timber", token: "572e6130" }, KEEP, { kind: "give" }] });
    expect(contextItems(more, []).map((i) => i.kind)).toEqual(["answer", "keep", "give"]);
  });

  test("leaves out a proposal that the player turned down, until the core gives it another token", () => {
    const more = readTalkMore(AFTER_REFUSAL);
    const key = "zhou_zhanggui|material|timber";
    expect(contextItems(more, [proposalId({ key, token: "572e6130" })]).map((i) => i.kind)).toEqual(["give"]);
    expect(contextItems(more, [proposalId({ key, token: "other" })]).map((i) => i.kind)).toEqual(["answer", "give"]);
    // The same token under another request is another proposal.
    expect(contextItems(more, [proposalId({ key: "zhou_zhanggui|join|", token: "572e6130" })]).map((i) => i.kind)).toEqual(["answer", "give"]);
  });

  test("leaves out the promise to make where there is nothing to promise and no way left", () => {
    const more = readTalkMore({ ...AFTER_REFUSAL, wants: null, give: { preferred: null, more: [], ways: [] }, queue: [{ kind: "give" }] });
    expect(contextItems(more, [])).toEqual([]);
    expect(contextItems(null, [])).toEqual([]);
  });
});

test.describe("the hud of a talk", () => {
  test("has the small things of the day and says whether the one gift of the day is given", () => {
    const gift = readGiftHud({ gift: { day: 1, items: fake.GIFT_ITEMS, given: true, to: "zhou_zhanggui" } });
    expect(gift?.items.map((i) => i.id)).toEqual(["tea", "pastry", "lantern_paper", "wine"]);
    expect(gift).toMatchObject({ day: 1, given: true, to: "zhou_zhanggui" });
    expect(readGiftHud({})).toBeNull();
  });
});

test.describe("the people of the frame", () => {
  test("give the hearts, the tastes found out and the card, for the people the frame has a row for", () => {
    const rows = readRelations({
      people: [
        { id: "li_laotai", known: false, hearts: 0, likes_known: [], gifts: 0, card: null },
        fake.relationRow("zhou_zhanggui", {
          hearts: 7,
          likes_known: [
            { item: "tea", like: "like" },
            { item: "wine", like: "sour" },
          ],
          gifts: 1,
          card: {
            trust: "friendly",
            owes_you: 2,
            you_owe: 1,
            you_promised: [{ id: "k1", what: "wage", item: "", amount: 10, due: 3 }],
            promised_you: [{ id: "c1", by: "zhou_zhanggui", to: "player", what: n("把八根木料送到石桥", "Bring 8 poles of timber"), item: "timber", amount: 8, due: { day: 3, hour: 7 }, state: "promised", reason: null }],
            changes: [
              { tick: 360, day: 1, hour: 9, minute: 0, delta: 1, why: "talk" },
              { tick: 361, day: 1, hour: 9, minute: 0, delta: 0, why: "gift" },
              { tick: 362, day: 1, hour: 9, minute: 0, delta: -2, why: "nonsense" },
            ],
            waiting: 2,
          },
        }),
      ],
    });
    expect([...rows.keys()]).toEqual(["li_laotai", "zhou_zhanggui"]);
    expect(rows.get("li_laotai")).toMatchObject({ known: false, hearts: 0, card: null });
    const zhou = rows.get("zhou_zhanggui");
    expect(zhou).toMatchObject({ known: true, hearts: 7, gifts: 1 });
    // A taste the page does not know is left out, and a change of no hearts is not one.
    expect(zhou?.likes).toEqual([{ item: "tea", like: "like" }]);
    expect(zhou?.card).toMatchObject({ trust: "friendly", owesYou: 2, youOwe: 1, waiting: 2 });
    expect(zhou?.card?.youPromised).toEqual([{ id: "k1", what: "wage", item: "", amount: 10, due: 3 }]);
    expect(zhou?.card?.promisedYou[0]).toMatchObject({ id: "c1", due: { day: 3, hour: 7 }, state: "promised" });
    expect(zhou?.card?.changes.map((c) => [c.delta, c.why])).toEqual([
      [1, "talk"],
      [-2, "other"],
    ]);
  });

  test("have no rows where the frame has no key, and keep the hearts within five", () => {
    expect(readRelations(null).size).toBe(0);
    expect(readRelations({}).size).toBe(0);
    expect(readRelations({ people: [{ id: "x", hearts: 99 }] }).get("x")?.hearts).toBe(10);
    expect(readRelations({ people: [{ id: "x", hearts: -4 }] }).get("x")?.hearts).toBe(0);
    expect(whyOf("kept")).toBe("kept");
    expect(whyOf("gremlins")).toBe("other");
  });

  test("count the hearts in halves: 7 half hearts are three whole ones and a half", () => {
    expect([0, 1, 2, 7, 10].map((v) => heartParts(v))).toEqual([
      { whole: 0, half: false },
      { whole: 0, half: true },
      { whole: 1, half: false },
      { whole: 3, half: true },
      { whole: 5, half: false },
    ]);
  });

  test("say the hearts and a change of them in words, in both languages", () => {
    setLang("en");
    expect([0, 1, 2, 3, 6, 10].map((v) => heartsWords("en", v))).toEqual(["none", "half a heart", "1", "1 and a half", "3", "5"]);
    expect([1, 2, 3, 4].map((v) => deltaWords("en", v))).toEqual(["half a heart", "a heart", "a heart and a half", "2 hearts"]);
    setLang("zh");
    expect([0, 1, 2, 3, 4, 7, 10].map((v) => heartsWords("zh", v))).toEqual(["一颗也没有", "半颗", "一颗", "一颗半", "两颗", "三颗半", "五颗"]);
    expect([1, 2, 3, 4, 5].map((v) => deltaWords("zh", v))).toEqual(["半颗心", "一颗心", "一颗半心", "两颗心", "两颗半心"]);
    setLang("en");
  });
});

// --- Which topic to ask about first ------------------------------------------------------------------------

const topic = (id: string, kind: Topic["kind"], zh: string, en: string = zh): Topic => ({ id, kind, name: n(zh, en) });

const TOPICS: Topic[] = [
  topic("t_rail", "thing", "石桥栏杆", "Stone Bridge Railing"),
  topic("t_he_boat", "thing", "老何的船", "Boatman He's Boat"),
  topic("p_bridge", "place", "石桥", "Stone Bridge"),
  topic("li_laotai", "person", "李老太", "Granny Li"),
  topic("li_da", "person", "李大", "Li Da"),
  topic("li_er", "person", "李二", "Li Er"),
  topic("zhou_huoji", "person", "周家伙计", "Zhou's Clerk"),
  topic("likes:li_da", "taste", "李大爱什么", "What Li Da likes"),
];

const context = (over: Partial<TopicContext> = {}): TopicContext => ({ partner: "li_laotai", slice: readSlice(null), entries: [], fresh: [], asked: new Set(), ...over });
const ids = (list: readonly Topic[]): string[] => list.map((t) => t.id);

test.describe("which topic comes first", () => {
  test("with nothing to go by it is a line of the notebook, a thing, a place, a person and a taste, in the order of the core, and not the person talked to", () => {
    const entry = topic("n_clerk", "entry", "李二昨晚在石桥。");
    const order = ids(rankTopics([...TOPICS, entry], context()));
    expect(order).toEqual(["n_clerk", "t_rail", "t_he_boat", "p_bridge", "li_da", "li_er", "zhou_huoji", "likes:li_da"]);
    expect(TOP_TOPICS).toBe(3);
  });

  test("a topic the task in hand names (the red slip) is first, by what its action and its time name: a person, a place, a thing", () => {
    const task = (action: Record<string, unknown>, window: Record<string, unknown> | null = null) => ({
      tracked: "t1",
      tasks: [{ id: "t1", kind: "need", job: "bridge", text: n("某事", "Something"), why: null, next: null, state: "open", blocker: null, action, window }],
    });
    // A task that asks Zhou's Clerk who told him names the clerk.
    expect(ids(rankTopics(TOPICS, context({ slice: readSlice(task({ verb: "ask_source", npc: "zhou_huoji" })) })))[0]).toBe("zhou_huoji");
    // A task to be done at the bridge names the place by its window.
    expect(ids(rankTopics(TOPICS, context({ slice: readSlice(task({ verb: "move", place: "p_bridge" }, { day: 1, from: 8, to: 12, place: "p_bridge" })) })))[0]).toBe("p_bridge");
    // A thing and a person named together: the thing comes first by the order of the kinds.
    expect(ids(rankTopics(TOPICS, context({ slice: readSlice(task({ verb: "entrust", npc: "li_da", item: "t_he_boat" })) }))).slice(0, 2)).toEqual(["t_he_boat", "li_da"]);
    // A task that is done is not the need of the day.
    const done = { ...task({ verb: "ask_source", npc: "zhou_huoji" }), tasks: [{ ...task({ verb: "ask_source", npc: "zhou_huoji" }).tasks[0], state: "done" }] };
    expect(ids(rankTopics(TOPICS, context({ slice: readSlice(done) })))[0]).toBe("t_rail");
  });

  test("a topic the words of the task in hand speak of comes before one another task speaks of, and that before the rest", () => {
    // The task in hand is about the bamboo that Granny Li will not give "over the talk that Li Er broke the bridge".
    const slice = readSlice(fake.tasks("t_bamboo_first"));
    const order = ids(rankTopics(TOPICS, context({ slice })));
    expect(order.indexOf("li_er")).toBeLessThan(order.indexOf("t_rail"));
    expect(order[0]).toBe("li_er");
  });

  test("a topic already asked of this person today goes after those that were not, whatever its weight", () => {
    const slice = readSlice(fake.tasks("t_bamboo_first"));
    const order = ids(rankTopics(TOPICS, context({ slice, asked: new Set(["li_er"]) })));
    expect(order[order.length - 1]).toBe("li_er");
    expect(order[0]).not.toBe("li_er");
  });

  test("a line of the notebook not looked at yet comes before the other lines", () => {
    const a = topic("n_a", "entry", "甲");
    const b = topic("n_b", "entry", "乙");
    expect(ids(rankTopics([a, b], context({ fresh: ["n_b"] })))).toEqual(["n_b", "n_a"]);
  });

  test("keeps the order of the core where nothing tells two topics apart, and drops the person talked to", () => {
    const people = [topic("li_da", "person", "李大"), topic("li_laotai", "person", "李老太"), topic("li_er", "person", "李二")];
    expect(ids(rankTopics(people, context()))).toEqual(["li_da", "li_er"]);
    expect(ids(rankTopics(people, context({ partner: "zhou_huoji" })))).toEqual(["li_da", "li_laotai", "li_er"]);
  });
});

// --- The follow-up -------------------------------------------------------------------------------------------

test.describe("asking who told them", () => {
  const notebook = [
    { id: "n_scrape", text: n("老何的船身上有新刮痕。", "Scratches."), source: { kind: "seen" }, marks: [], chain: [] },
    {
      id: "n1",
      text: n("李二弄坏了栏杆。", "Li Er broke the rail."),
      source: { kind: "heard", who: { ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" }, how: "heard", via: { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" } },
      marks: [],
      chain: [{ ...n("茶馆老板娘", "Teahouse Keeper"), id: "cha_laoban" }, { ...n("周家伙计", "Zhou's Clerk"), id: "zhou_huoji" }, null],
    },
    {
      id: "n2",
      text: n("栏杆朝河那边断了。", "The rail broke on the river side."),
      source: { kind: "heard", who: { ...n("老何", "Boatman He"), id: "old_he" }, how: "saw" },
      marks: [],
      chain: [{ ...n("老何", "Boatman He"), id: "old_he" }],
    },
  ];

  test("is for a line that was passed on to the teller, and not for one they saw or the manager saw", () => {
    const entries = readNotebook({ notebook }) ?? [];
    expect(entries.map((e) => [e.id, canFollowUp(e)])).toEqual([
      ["n_scrape", false],
      ["n1", true],
      ["n2", false],
    ]);
    expect(canFollowUp(undefined)).toBe(false);
  });

  test("finds the lines whose trail ends at the person talked to: they were named and have not been asked", () => {
    expect(frontierEntries(notebook, "zhou_huoji")).toEqual(["n1"]);
    expect(frontierEntries(notebook, "cha_laoban")).toEqual([]);
    expect(frontierEntries(null, "zhou_huoji")).toEqual([]);
  });

  test("names the line an answer wrote, from the event of the answer", () => {
    expect(entryOfAnswer([{ kind: "asked", npc: "cha_laoban", entry: "n1" }], "cha_laoban")).toBe("n1");
    expect(entryOfAnswer([{ kind: "asked", npc: "cha_laoban", entry: null }], "cha_laoban")).toBeNull();
    expect(entryOfAnswer([{ kind: "asked", npc: "someone_else", entry: "n1" }], "cha_laoban")).toBeNull();
  });
});
