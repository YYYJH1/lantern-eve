"""Whatever a model writes, the gate answers and never lets through what it should not.

Replies are made from a pool of plausible and implausible pieces: props the speaker holds and props
they do not, rules, templates, sources, names, connectives, negations, hedges and plain chat. The
gate must never raise, and when it lets a reply through, an oracle that reads the result again
without the gate's own code must agree: every claim is authorized, every act that is not plain was
written by the core, and the model's line holds no word that nothing carries and no name that
nothing covers.
"""

from __future__ import annotations

import json
from collections import ChainMap

from bridge_helpers import state_of
from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st
from speech_helpers import hold, new_game, speaker

from lantern_core.cognition import contract
from lantern_core.cognition.lexicon import CLASSES, NAME, blank, normalise, scan
from lantern_core.cognition.paths import authorize
from lantern_core.world.bridge import speech
from lantern_core.world.bridge.lore import lore

LO = lore()
SCRIPT = speech.script()
GAME = new_game(1, 50)
for prop, how in (
    ("pr_gengfu_round", {}),
    ("pr_dalang_at_bridge", {}),
    ("pr_liner_looking", {}),
    ("pr_he_under_bridge", {"source": "heard", "teller": "old_he", "claimed": "old_he", "hop": 1}),
    ("pr_dalang_drank", {"source": "heard", "teller": "gengfu", "claimed": "unknown", "hop": 1}),
    (
        "pr_liner_damaged",
        {"source": "heard", "teller": "zhou_huoji", "claimed": "zhou_huoji", "hop": 1},
    ),
):
    hold(GAME, "gengfu", prop, **how)

PROPS = [*sorted(LO.book.props), "pr_nothing"]
RULES = [*sorted(LO.book.rules), "sr_nothing"]
TEMPLATES = [*sorted(LO.book.templates), "lie_nothing"]
SOURCES = ["unknown", "self_seen", "gengfu", "old_he", "zhou_huoji", "player", "nobody"]
SHAPES = [
    {"pred": "flood_damaged", "args": {"what": "t_rail"}, "span": None, "neg": False},
    {"pred": "at", "args": {"who": "li_er", "where": "p_bridge"}, "span": [-110, -80]},
    {"pred": "sing", "args": {"what": "t_rail"}},
    {
        "pred": "damaged",
        "args": {"who": "li_er", "what": "t_rail"},
        "parent": "pr_liner_damaged",
        "op": "sharpen",
        "motive": "on_purpose",
    },
]
FRAGMENTS = [
    "桥下", "涨水了", "栏杆", "坏了", "石桥", "老何", "李二", "弄坏", "船", "刮痕", "因为", "所以",
    "因而", "没有", "不是", "也许", "怕是", "一定", "听说", "亲眼", "我看见", "总管", "，", "。",
    "今天风很大", "你好", "故意", "不错",
    "the water", "the rail", "is broken", "Li Er", "Old He", "the bridge", "because", "therefore",
    "not", "never", "maybe", "I guess", "definitely", "I heard", "I saw", "scratches", "boat",
    "Windy today", "Hello", ", ", ". ", " ",
]  # fmt: skip


def belief(prop: str, source: str, **more):
    return {"path": "belief", "prop": prop, "modality": "assert", "source": source, **more}


GUESS = {
    "path": "speculation",
    "modality": "speculate",
    "source": "gengfu",
    "rule": "sr_flood_season",
    "premises": ["pr_flooded", "pr_rail_broken"],
}
VALID = [  # acts that gengfu may make, plain ones first
    belief("pr_flooded", "unknown"),
    belief("pr_rail_broken", "unknown"),
    belief("pr_rail_located", "unknown"),
    belief("pr_rail_located", "self_seen"),
    belief("pr_gengfu_round", "self_seen"),
    belief("pr_dalang_at_bridge", "unknown"),
    belief("pr_he_under_bridge", "old_he"),
    {**GUESS, "prop": "pr_flood_damaged"},
    {**GUESS, "prop": SHAPES[0]},
    {**belief("pr_liner_at_bridge", "self_seen"), "path": "mutation", "op": "level"},
]
PERTURBATIONS = {
    "path": ["belief", "speculation", "mutation", "lie", "wish"],
    "prop": [*PROPS, *SHAPES],
    "modality": ["assert", "speculate", "deny", "lie", "maybe"],
    "source": SOURCES,
    "rule": RULES,
    "op": ["level", "sharpen", "assimilate", "fill", "polish"],
    "template": TEMPLATES,
}


@st.composite
def acts(draw):
    """Up to three acts: mostly acts the speaker may make, some with one field changed."""
    out = []
    for _ in range(draw(st.integers(0, 3))):
        one = dict(draw(st.sampled_from(VALID)))
        if draw(st.integers(0, 4)) == 0:
            field = draw(st.sampled_from(sorted(PERTURBATIONS)))
            one[field] = draw(st.sampled_from(PERTURBATIONS[field]))
        out.append(one)
    return out


CLEAN = {
    "zh": [
        "桥下", "涨水了", "栏杆", "坏了", "今天风很大", "你好", "总管", "，", "。", "不错", "听说",
    ],
    "en": [
        "the water", "is up", "under the bridge", "the rail", "is broken", "Windy today",
        "I heard", "Manager", ", ", ". ", "Hello",
    ],
}  # fmt: skip
DIRTY = {
    "zh": ["因为", "没有", "也许", "一定", "亲眼", "李二", "弄坏", "老何", "刮痕", "故意", "石桥"],
    "en": ["because", "not", "maybe", "definitely", "I saw", "Li Er", "damaged", "Old He",
           "scratches", "on purpose", "bridge"],
}  # fmt: skip


@st.composite
def lines(draw):
    out = {}
    for lang, head in (("zh", "今天"), ("en", "Hello ")):
        pool = CLEAN[lang] if draw(st.integers(0, 3)) else [*CLEAN[lang], *DIRTY[lang]]
        out[lang] = head + "".join(draw(st.lists(st.sampled_from(pool), max_size=6)))
    return out


junk_act = st.fixed_dictionaries(
    {
        "path": st.sampled_from(PERTURBATIONS["path"]),
        "prop": st.one_of(st.sampled_from(PROPS), st.sampled_from(SHAPES), st.none()),
        "modality": st.sampled_from(PERTURBATIONS["modality"]),
        "source": st.sampled_from(SOURCES),
    },
    optional={
        "rule": st.sampled_from(RULES),
        "premises": st.lists(st.sampled_from(PROPS), max_size=4),
        "op": st.sampled_from(PERTURBATIONS["op"]),
        "template": st.sampled_from(TEMPLATES),
    },
)
junk = st.lists(st.sampled_from(FRAGMENTS), min_size=1, max_size=8).map("".join)
MOODS = ["plain", "wary", "sad", "curt", "warm", "eager"]
ADDRESSES = ["none", "manager", "friend"]
mostly_right = st.fixed_dictionaries(
    {
        "acts": acts(),
        "line": st.one_of(*[lines()] * 9, st.none()),
        "mood": st.sampled_from([*MOODS, *MOODS, *MOODS, "angry"]),
        "address": st.sampled_from([*ADDRESSES, *ADDRESSES, *ADDRESSES, "sire"]),
    }
)
anything = st.fixed_dictionaries(
    {"acts": st.lists(junk_act, max_size=4)},
    optional={
        "line": st.one_of(st.fixed_dictionaries({"zh": junk, "en": junk}), st.none()),
        "mood": st.sampled_from([*MOODS, "angry"]),
        "address": st.sampled_from([*ADDRESSES, "sire"]),
        "extra": st.integers(),
    },
)
reply = st.one_of(*[mostly_right] * 5, anything)


def agrees(got: contract.Gated) -> None:
    """Read a reply that passed again, without the gate's own steps."""
    sp = speaker(GAME, "gengfu")
    book = ChainMap({p.id: p for p in got.props}, sp.book)
    for claim in got.claims:
        ok, why = authorize(
            claim,
            sp.store,
            book,
            tables=SCRIPT.tables,
            registry=SCRIPT.registry,
            rules=SCRIPT.rules,
            templates=SCRIPT.templates,
            suspicion=sp.suspicion,
            relation=sp.relation,
            public=SCRIPT.public,
        )
        assert ok, (claim, why)
        assert not sp.guards(book[claim.prop])
    assert got.line is not None and set(got.line) == {"zh", "en"}
    sensitive = any(
        contract.features(c, book[c.prop], SCRIPT).sensitive for c in got.claims
    ) or bool(got.feigned)
    assert (got.by == "core") == sensitive
    if got.by == "model":
        clean(got, sp, book)


def clean(got: contract.Gated, sp: contract.Speaker, book) -> None:
    """A line the model wrote holds only names the acts cover and words that something carries."""
    props = [book[c.prop] for c in got.claims]
    covered = {sp.id, *sp.listeners} | {e for p in props for _, e in p.args}
    hearsay = any(c.claimed_source == "unknown" for c in got.claims)
    for lang in ("zh", "en"):
        text = normalise(got.line[lang])
        for _, form, (kind, ident) in scan(text, SCRIPT.vocabulary.terms):
            if kind == NAME:
                assert ident in covered, (lang, form)
            else:
                preds = {p.pred for p in props} | {p.motive for p in props}
                assert any(i in preds for i in ident), (lang, form)
        for word_class in CLASSES:
            masked = blank(text, scan(text, SCRIPT.lexicon.masks[word_class]))
            hits = scan(masked, SCRIPT.lexicon.classes[word_class])
            assert not hits or (word_class == "hearsay" and hearsay), (lang, word_class, hits)


@settings(max_examples=400, deadline=None, suppress_health_check=[HealthCheck.too_slow])
@given(reply)
def test_whatever_is_written_the_gate_answers_and_what_it_lets_through_is_clean(body):
    got = contract.gate(json.dumps(body, ensure_ascii=False), speaker(GAME, "gengfu"), SCRIPT)
    assert isinstance(got, contract.Gated)
    assert got.ok == (got.errors == ())
    if got.ok:
        agrees(got)
    else:
        assert got.line is None and got.claims == () and got.types
        assert all(e.type in contract.ERROR_TYPES for e in got.errors)
    assert state_of(GAME)[speech.SECTION] == speech.fresh()


@settings(max_examples=200, deadline=None)
@given(st.text(max_size=300))
def test_any_text_at_all_gets_an_answer(text):
    got = contract.gate(text, speaker(GAME, "gengfu"), SCRIPT)
    assert not got.ok and got.types == ("format",)
