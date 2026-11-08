"""A small town for the cognition tests: tables, entities and props written the way the content
compiler writes them, so that the tests also go through ``from_canon``."""

from lantern_core.cognition.props import ExclusiveGroups, PropBook, Registry, Tables
from lantern_core.cognition.rules import LieEnvelope, SpecRule

NIGHT = (-180, 300)  # 21:00 the night before to 05:00 on day 1, in game minutes
EVENING = (-180, -60)
LATE = (600, 720)  # 10:00 to 12:00 on day 1


def _slots(*specs):
    return [{"name": n, "type": t, "required": r} for n, t, r in specs]


_ACTOR = ["person", "family"]  # a person, or the family they stand for
_ACT = (("who", _ACTOR, True), ("what", "thing", True), ("where", "place", False))

TABLES = Tables.from_canon(
    {
        "predicates": [
            {
                "id": "at",
                "label": "在",
                "slots": _slots(("who", "person", True), ("where", "place", True)),
            },
            {
                "id": "looked_for",
                "label": "寻找",
                "level_to": "at",
                "slots": _slots(
                    ("who", "person", True), ("what", "thing", True), ("where", "place", False)
                ),
            },
            {"id": "damaged", "label": "碰坏了", "heavier": "broke", "slots": _slots(*_ACT)},
            {"id": "broke", "label": "弄坏了", "slots": _slots(*_ACT)},
            {"id": "broken", "label": "坏了", "slots": _slots(("what", "thing", True))},
            {
                "id": "located",
                "label": "位于",
                "slots": _slots(("what", "thing", True), ("where", "place", True)),
            },
            {
                "id": "owns",
                "label": "属于",
                "slots": _slots(("family", "family", True), ("thing", "thing", True)),
            },
        ],
        "motives": [
            {"id": "revenge", "label": "报复"},
            {"id": "jealousy", "label": "嫉妒"},
            {"id": "accident", "label": "意外"},
            {"id": "on_purpose", "label": "故意"},
            {"id": "showoff", "label": "出风头"},
        ],
    }
)

REGISTRY = Registry.from_canon(
    [
        {"id": "fam_li", "type": "family", "label": "李家"},
        {"id": "fam_he", "type": "family", "label": "何家"},
        {"id": "li2", "type": "person", "label": "李二", "family": "fam_li"},
        {"id": "li3", "type": "person", "label": "李三", "family": "fam_li"},
        {"id": "he", "type": "person", "label": "老何", "family": "fam_he"},
        {"id": "zhou", "type": "person", "label": "周掌柜", "family": None},
        {"id": "clerk", "type": "person", "label": "伙计", "family": None},
        {"id": "wang", "type": "person", "label": "王婶", "family": None},
        {"id": "liu", "type": "person", "label": "刘四", "family": None},
        {"id": "player", "type": "person", "label": "你", "family": None},
        {"id": "rail", "type": "thing", "label": "桥栏"},
        {"id": "boat", "type": "thing", "label": "乌篷船"},
        {"id": "bridge_side", "type": "place", "label": "桥边"},
        {"id": "under_bridge", "type": "place", "label": "桥下"},
        {"id": "home_he", "type": "place", "label": "老何家"},
        {"id": "market", "type": "place", "label": "集市"},
    ]
)

# Props as the content compiler writes them: id, pred, args, span, neg, motive (+ parent, op).
PROP_DICTS = [
    # who broke the rail: the truth variants, at most one true
    {
        "id": "li_broke",
        "pred": "broke",
        "args": {"who": "li2", "what": "rail"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "he_broke",
        "pred": "broke",
        "args": {"who": "he", "what": "rail"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "li_not_broke",
        "pred": "broke",
        "args": {"who": "li2", "what": "rail"},
        "span": list(NIGHT),
        "neg": True,
        "motive": None,
    },
    # where people were
    {
        "id": "li_at_bridge",
        "pred": "at",
        "args": {"who": "li2", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "he_home",
        "pred": "at",
        "args": {"who": "he", "where": "home_he"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "he_under_bridge",
        "pred": "at",
        "args": {"who": "he", "where": "under_bridge"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "he_market_late",
        "pred": "at",
        "args": {"who": "he", "where": "market"},
        "span": list(LATE),
        "neg": False,
        "motive": None,
    },
    {
        "id": "he_home_evening",
        "pred": "at",
        "args": {"who": "he", "where": "home_he"},
        "span": list(EVENING),
        "neg": False,
        "motive": None,
    },
    # the rumour that the three-hop test follows, and its mutations
    {
        "id": "r0_damaged",
        "pred": "damaged",
        "args": {"who": "li2", "what": "rail", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "r1_broke",
        "pred": "broke",
        "args": {"who": "li2", "what": "rail", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
        "parent": "r0_damaged",
        "op": "sharpen",
    },
    {
        "id": "r2_revenge",
        "pred": "broke",
        "args": {"who": "li2", "what": "rail", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": "revenge",
        "parent": "r1_broke",
        "op": "fill",
    },
    {
        "id": "r3_li3",
        "pred": "broke",
        "args": {"who": "li3", "what": "rail", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": "revenge",
        "parent": "r2_revenge",
        "op": "assimilate",
    },
    {
        "id": "r1_same",
        "pred": "broke",
        "args": {"who": "li2", "what": "rail", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
        "parent": "r1_broke",
        "op": "level",
    },
    {
        "id": "r2_nowhere",
        "pred": "broke",
        "args": {"who": "li2", "what": "rail"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
        "parent": "r1_broke",
        "op": "level",
    },
    # the same news made another way: a family for a person, and a predicate changed by a rule
    {
        "id": "r0_fam",
        "pred": "damaged",
        "args": {"who": "fam_li", "what": "rail", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
        "parent": "r0_damaged",
        "op": "assimilate",
    },
    {
        "id": "li_damaged_by_rule",
        "pred": "damaged",
        "args": {"who": "li2", "what": "rail"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
        "parent": "li_at_bridge",
        "op": "assimilate",
    },
    # looking for a thing, flattened to being at the place
    {
        "id": "li_looked",
        "pred": "looked_for",
        "args": {"who": "li2", "what": "boat", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
    },
    {
        "id": "li_looked_at",
        "pred": "at",
        "args": {"who": "li2", "where": "bridge_side"},
        "span": list(NIGHT),
        "neg": False,
        "motive": None,
        "parent": "li_looked",
        "op": "level",
    },
    # what the town knows, and the facts a guessing rule rests on
    {
        "id": "rail_located",
        "pred": "located",
        "args": {"what": "rail", "where": "bridge_side"},
        "span": None,
        "neg": False,
        "motive": None,
    },
    {
        "id": "rail_broken",
        "pred": "broken",
        "args": {"what": "rail"},
        "span": None,
        "neg": False,
        "motive": None,
    },
]

PROPS = PropBook.from_canon(PROP_DICTS)

GROUPS = ExclusiveGroups.from_canon([{"id": "who_broke_rail", "props": ["li_broke", "he_broke"]}])

# What the whole town knows, which a premise may rest on without anyone having told the speaker.
PUBLIC = frozenset({"rail_located", "rail_broken"})

# The relations of the game, which only the caller of ``authorize`` knows: Wang holds a grudge.
GRUDGES = frozenset({("wang", "li2")})


def has_grudge(kind, holder, target):
    return kind == "grudge" and (holder, target) in GRUDGES


def _rule(id, conclusion, min_suspicion):
    return {
        "id": id,
        "label": "在现场，桥栏坏了，说话人又对他有积怨",
        "vars": {"X": "person", "P": "place", "T": "thing"},
        "premises": [
            {"pred": "at", "args": {"who": "$X", "where": "$P"}},
            {"pred": "located", "args": {"what": "$T", "where": "$P"}},
            {"pred": "broken", "args": {"what": "$T"}},
        ],
        "relation": {"kind": "grudge", "holder": "speaker", "target": "$X"},
        "conclusion": {"pred": conclusion, "args": {"who": "$X", "what": "$T"}},
        "hedge": ["我猜", "怕是"],
        "min_suspicion": min_suspicion,
    }


# The script's guessing rules, in the shape the content compiler writes. The first concludes a
# guess, the second is the rule behind ``li_damaged_by_rule``.
RULES = {
    "grudge_at_scene": SpecRule.from_canon(_rule("grudge_at_scene", "broke", 30)),
    "scene_damage": SpecRule.from_canon(_rule("scene_damage", "damaged", 20)),
}

# The lies one character may tell, as the content writes them: an envelope with its templates.
LIES = [
    LieEnvelope.from_canon(
        {
            "holder": "he",
            "motive": "showoff",
            "preds": ["at"],
            "ignorance": ["damaged"],
            "objects": ["he", "home_he", "market"],
            "sources": ["witnessed"],
            "templates": [
                {
                    "id": "he_at_home",
                    "kind": "claim",
                    "prop": "he_home",
                    "source": {"kind": "witnessed", "from": None},
                    "about": None,
                    "source_only": False,
                },
                {
                    "id": "he_knows_nothing",
                    "kind": "feign_ignorance",
                    "prop": None,
                    "source": None,
                    "about": "damaged",
                    "source_only": False,
                },
            ],
        }
    )
]
TEMPLATES = {t.id: t for envelope in LIES for t in envelope.templates}

# A whole compiled script made of the same pieces: two ways the night may have gone, the rumour
# chains the script plants, and the lies and guessing rules above.
SCRIPT_DICT = {
    "id": "fixture",
    "label": "断桥",
    "days": 3,
    "truth_fixed_at": 0,
    "summary": "栏杆塌了，两种说法。",
    "entities": REGISTRY.to_canon(),
    "props": PROP_DICTS,
    "exclusive": GROUPS.to_canon(),
    "variants": [
        {
            "id": "v_li",
            "label": "李二弄坏的",
            "true_props": ["he_home", "li_at_bridge", "li_broke", "rail_broken", "rail_located"],
            "true_negations": [],
        },
        {
            "id": "v_he",
            "label": "老何弄坏的",
            "true_props": [
                "he_broke",
                "he_under_bridge",
                "li_at_bridge",
                "rail_broken",
                "rail_located",
            ],
            "true_negations": ["li_not_broke"],
        },
    ],
    "chains": [
        {
            "id": "ch_rumour",
            "label": "从碰坏传成故意弄坏",
            "hops": [
                {"prop": "r0_damaged", "speaker": None, "listener": None, "via": None},
                {"prop": "r1_broke", "speaker": "clerk", "listener": "zhou", "via": None},
                {"prop": "r2_revenge", "speaker": "zhou", "listener": "wang", "via": None},
                {"prop": "r3_li3", "speaker": "wang", "listener": "liu", "via": None},
            ],
        },
        {
            "id": "ch_rule",
            "label": "从在桥边传成弄坏了桥",
            "hops": [
                {"prop": "li_at_bridge", "speaker": None, "listener": None, "via": None},
                {
                    "prop": "li_damaged_by_rule",
                    "speaker": "wang",
                    "listener": "zhou",
                    "via": "scene_damage",
                },
            ],
        },
    ],
    "lies": [envelope.to_canon() for envelope in LIES],
    "speculation": [rule.to_canon() for rule in RULES.values()],
}
