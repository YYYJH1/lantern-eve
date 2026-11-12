"""The gate on a real game: the reply of each path, who writes the sentence, and what is refused."""

from __future__ import annotations

import json

import pytest
from bridge_helpers import state_of
from speech_helpers import belief, errors, hold, new_game, reply, say, unnamed

from lantern_core.cognition import contract
from lantern_core.world.bridge import bonds, speech, voices
from lantern_core.world.bridge.lore import lore

LO = lore()
PLAIN = [unnamed("pr_flooded"), unnamed("pr_rail_broken")]
PLAIN_LINE = {
    "zh": "听说桥下涨水了，栏杆也坏了。",
    "en": "I heard the water is up beneath the bridge and the rail is broken.",
}


@pytest.fixture
def game():
    return new_game(1)


def vocative(text: str, who: str) -> str:
    """What the core does to the end of a sentence for a form of address."""
    return text[:-1] + who + text[-1]


def make_grudge(game, holder: str, toward: str, amount: int = 70) -> None:
    row = state_of(game)["social"]["bonds"][holder]
    row[4 * LO.index[toward] + bonds.GRUDGE] = amount


# ------------------------------------------------------------------------------ each path


def test_plain_acts_let_the_model_write_its_line(game):
    got = say(game, "gengfu", reply(PLAIN, **{"zh": PLAIN_LINE["zh"], "en": PLAIN_LINE["en"]}))
    assert got.ok and got.by == "model" and got.errors == ()
    assert got.line == PLAIN_LINE
    assert [c.prop for c in got.claims] == ["pr_flooded", "pr_rail_broken"]
    assert (
        {c.path for c in got.claims} == {"belief"}
        and got.props == ()
        and got.paths == ("belief",) * 2
    )


def test_a_chat_with_no_act_passes_when_it_says_nothing_about_the_town(game):
    line = {"zh": "今天风很大，总管慢走。", "en": "Windy today. Mind your step, Manager."}
    got = say(game, "gengfu", reply([], **line))
    assert got.ok and got.by == "model" and got.claims == () and got.line == line


def test_a_belief_that_names_its_source_is_said_by_the_core_in_the_speakers_voice(game):
    hold(game, "gengfu", "pr_gengfu_round")
    text = reply(
        [belief("pr_gengfu_round", "self_seen")],
        zh="随便写点什么",
        en="whatever",
        mood="wary",
        address="manager",
    )
    got = say(game, "gengfu", text, pick=3)
    assert got.ok and got.by == "core" and (got.mood, got.address) == ("wary", "manager")
    said = voices.claim_words(
        LO.book.props["pr_gengfu_round"], "assert", "self_seen", "gengfu", 3, game.tick
    )
    assert got.line == {
        "zh": "嗯。" + vocative(said["zh"], "，总管"),
        "en": "Hm. " + vocative(said["en"], ", Manager"),
    }  # the model's own line is not used
    assert [(c.speaker, c.listeners, c.prop, c.claimed_source) for c in got.claims] == [
        ("gengfu", ("player",), "pr_gengfu_round", "self_seen")
    ]


def test_a_denial_is_negative_and_the_core_writes_it(game):
    hold(game, "gengfu", "pr_liner_not_bridge")
    text = reply([belief("pr_liner_not_bridge", "unknown", "deny")], zh="x", en="y")
    got = say(game, "gengfu", text)
    assert got.ok and got.by == "core"
    assert got.line is not None and "没" in got.line["zh"]


def test_a_guess_by_a_rule_is_said_by_the_core_with_a_hedge(game):
    act = {
        "path": "speculation",
        "prop": "pr_flood_damaged",
        "modality": "speculate",
        "source": "gengfu",
        "rule": "sr_flood_season",
        "premises": ["pr_flooded", "pr_rail_broken"],
    }
    got = say(game, "gengfu", reply([act]))
    assert got.ok and got.by == "core" and got.claims[0].path == "speculation"
    hedges = voices.hedges("gengfu")
    assert got.line is not None
    assert any(h in got.line["zh"] for h in hedges["zh"]) and any(
        h in got.line["en"] for h in hedges["en"]
    )


def test_a_guess_may_be_a_structured_prop_that_the_book_does_not_have(game):
    new = {"pred": "flood_damaged", "args": {"what": "t_rail"}, "span": None, "neg": False}
    act = {
        "path": "speculation",
        "prop": new,
        "modality": "speculate",
        "source": "gengfu",
        "rule": "sr_flood_season",
        "premises": ["pr_flooded", "pr_rail_broken"],
    }
    got = say(game, "gengfu", reply([act]))
    assert got.ok
    (made,) = got.props
    assert made.id == "flood_damaged__g1" and made.span is None and made.parent is None
    assert got.claims[0].prop == made.id
    assert say(game, "gengfu", reply([act])) == got  # the same guess gets the same id


def test_a_structured_prop_that_says_what_the_book_says_is_that_prop(game):
    same = {
        "pred": "flood_damaged",
        "args": {"what": "t_rail"},
        "span": [-45, -35],
        "neg": False,
    }
    act = {
        "path": "speculation",
        "prop": same,
        "modality": "speculate",
        "source": "gengfu",
        "rule": "sr_flood_season",
        "premises": ["pr_flooded", "pr_rail_broken"],
    }
    got = say(game, "gengfu", reply([act]))
    assert got.ok and got.props == () and got.claims[0].prop == "pr_flood_damaged"


def test_a_mutation_changes_a_belief_by_an_operator(game):
    hold(game, "zhou_huoji", "pr_liner_looking")
    act = {
        "path": "mutation",
        "prop": "pr_liner_at_bridge",
        "op": "level",
        "modality": "assert",
        "source": "self_seen",
    }
    got = say(game, "zhou_huoji", reply([act]))
    assert got.ok and got.by == "core" and got.claims[0].op == "level"
    structured = {
        "pred": "at",
        "args": {"who": "li_er", "where": "p_bridge"},
        "span": [-110, -80],
        "neg": False,
        "parent": "pr_liner_looking",
        "op": "level",
    }
    again = say(game, "zhou_huoji", reply([{**act, "prop": structured}]))
    assert again.ok and again.props == () and again.claims == got.claims


def test_a_mutation_that_is_new_gets_the_name_the_talk_between_neighbours_would_give_it(game):
    hold(
        game,
        "zhou_zhanggui",
        "pr_liner_damaged",
        "heard",
        teller="zhou_huoji",
        claimed="zhou_huoji",
        hop=1,
    )
    fuller = {
        "pred": "damaged",
        "args": {"what": "t_rail", "who": "li_er"},
        "span": [-110, -80],
        "neg": False,
        "motive": "jealousy",
        "parent": "pr_liner_damaged",
        "op": "fill",
    }
    act = {
        "path": "mutation",
        "prop": fuller,
        "op": "fill",
        "modality": "assert",
        "source": "zhou_huoji",
    }
    got = say(game, "zhou_zhanggui", reply([act]))
    assert got.ok, got.errors
    assert [p.id for p in got.props] == ["pr_liner_damaged__fl"]
    assert got.props[0].parent == "pr_liner_damaged" and got.props[0].op == "fill"


def test_a_mutation_that_turns_a_belief_into_a_guess_by_a_rule_needs_the_rule(game):
    hold(
        game,
        "zhou_zhanggui",
        "pr_liner_at_bridge",
        "heard",
        teller="zhou_huoji",
        claimed="zhou_huoji",
        hop=1,
    )
    make_grudge(game, "zhou_zhanggui", "li_er")
    act = {
        "path": "mutation",
        "prop": "pr_liner_damaged",
        "op": "assimilate",
        "modality": "assert",
        "source": "zhou_huoji",
        "rule": "sr_presence_grudge",
    }
    got = say(game, "zhou_zhanggui", reply([act]))
    assert got.ok and got.claims[0].rule_id == "sr_presence_grudge"
    without = say(game, "zhou_zhanggui", reply([{k: v for k, v in act.items() if k != "rule"}]))
    assert errors(without) == [("path", "acts[0]", "extras")]


def test_a_guess_from_a_grudge_needs_the_grudge_the_rule_asks_for(game):
    hold(
        game,
        "zhou_zhanggui",
        "pr_liner_at_bridge",
        "heard",
        teller="zhou_huoji",
        claimed="zhou_huoji",
        hop=1,
    )
    act = {
        "path": "speculation",
        "prop": "pr_liner_damaged",
        "modality": "speculate",
        "source": "zhou_zhanggui",
        "rule": "sr_presence_grudge",
        "premises": ["pr_liner_at_bridge", "pr_rail_located", "pr_rail_broken"],
    }
    make_grudge(game, "zhou_zhanggui", "li_er", 10)
    assert errors(say(game, "zhou_zhanggui", reply([act]))) == [("path", "acts[0]", "relation")]
    make_grudge(game, "zhou_zhanggui", "li_er", 70)
    assert say(game, "zhou_zhanggui", reply([act])).ok


def test_a_lie_comes_only_from_the_template_written_for_the_speaker(game):
    act = {
        "path": "lie",
        "prop": "pr_he_home",
        "modality": "lie",
        "source": "self_seen",
        "template": "lie_he_home",
    }
    got = say(game, "old_he", reply([act]))
    assert got.ok and got.by == "core" and got.claims[0].path == "lie"
    assert errors(say(game, "gengfu", reply([act]))) == [("path", "acts[0]", "template_speaker")]
    assert errors(say(game, "old_he", reply([{**act, "source": "unknown"}]))) == [
        ("path", "acts[0]", "template_source")
    ]


def test_a_feigned_ignorance_is_the_fixed_words_for_not_knowing(game):
    got = say(game, "old_he", reply([{"path": "lie", "template": "lie_he_ignorant"}]))
    assert got.ok and got.by == "core" and got.claims == () and got.feigned == ("lie_he_ignorant",)
    assert got.line == dict(voices.phrase("old_he", "unknown", game.tick))
    assert errors(say(game, "gengfu", reply([{"path": "lie", "template": "lie_he_ignorant"}]))) == [
        ("path", "acts[0]", "template_speaker")
    ]
    claim_template = {"path": "lie", "template": "lie_he_home"}
    assert errors(say(game, "old_he", reply([claim_template]))) == [
        ("path", "acts[0]", "template_kind")
    ]


def test_several_acts_are_said_one_after_the_other(game):
    hold(game, "gengfu", "pr_gengfu_round")
    acts = [belief("pr_gengfu_round", "self_seen"), belief("pr_rail_located", "unknown")]
    got = say(game, "gengfu", reply(acts))
    assert got.ok and got.by == "core" and got.line is not None
    first = voices.claim_words(
        LO.book.props["pr_gengfu_round"], "assert", "self_seen", "gengfu", 0, game.tick
    )
    second = voices.claim_words(
        LO.book.props["pr_rail_located"], "assert", "unknown", "gengfu", 0, game.tick
    )
    assert got.line["zh"] == first["zh"] + second["zh"]
    assert got.line["en"] == first["en"] + " " + second["en"]


# ------------------------------------------------------------------------------ who writes it


def claim_of(prop, source="unknown", modality="assert", path="belief", **basis):
    return contract.Claim("_", "gengfu", ("player",), prop, modality, source, 0, path, **basis)


# (claim, critical, causal, negative, modal, sensitive): what an act is made of
FEATURES = [
    (claim_of("pr_rail_broken"), False, False, False, False, False),  # plain
    (claim_of("pr_rail_broken", "self_seen"), False, False, False, False, True),  # names a source
    (claim_of("pr_rail_broken", "old_he"), False, False, False, False, True),
    (claim_of("pr_he_under_bridge"), True, False, False, False, True),  # the story turns on it
    (claim_of("pr_boat_damaged"), True, True, False, False, True),  # blames someone
    (claim_of("pr_li_damaged_jealous"), True, True, False, False, True),  # has a motive
    (claim_of("pr_dalang_not_bridge", modality="deny"), True, False, True, False, True),
    (claim_of("pr_boat_scratched", modality="deny"), False, False, True, False, True),
    (
        claim_of("pr_flood_damaged", "gengfu", "speculate", "speculation", rule_id="r"),
        True,
        True,
        False,
        True,
        True,
    ),  # a guess is modal and rests on a rule
    (
        claim_of(
            "pr_liner_damaged", modality="assert", path="mutation", rule_id="r", op="assimilate"
        ),
        True,
        True,
        False,
        False,
        True,
    ),
    (claim_of("pr_liner_at_bridge", path="mutation", op="level"), True, False, False, False, True),
]


@pytest.mark.parametrize("case", FEATURES, ids=lambda case: f"{case[0].prop}-{case[0].path}")
def test_the_features_of_an_act_decide_who_writes_the_sentence(case):
    claim, critical, causal, negative, modal, sensitive = case
    f = contract.features(claim, LO.book.props[claim.prop], speech.script())
    assert (f.critical, f.causal, f.negative, f.modal, f.sensitive) == (
        critical,
        causal,
        negative,
        modal,
        sensitive,
    )
    assert f.source == claim.claimed_source


def test_a_feigned_ignorance_is_negative_and_has_no_source():
    f = contract.FEIGNED
    assert (f.negative, f.sensitive, f.source) == (True, True, None)


def test_a_prop_with_a_motive_or_a_blaming_predicate_is_causal():
    sc = speech.script()
    for prop, causal in (
        ("pr_li_damaged_jealous", True),  # a motive
        ("pr_flood_damaged", True),  # the flood is the cause
        ("pr_rail_broken", False),
        ("pr_flooded", False),
    ):
        got = contract.features(claim_of(prop), LO.book.props[prop], sc)
        assert got.causal is causal, prop


def test_the_story_turns_on_what_is_contested_or_blames_someone():
    expected = {
        "pr_boat_damaged": True,
        "pr_he_under_bridge": True,
        "pr_he_home": True,
        "pr_dalang_drank": True,
        "pr_liner_damaged": True,
        "pr_rail_broken": False,
        "pr_flooded": False,
        "pr_he_owns_boat": False,
        "pr_boat_scratched": False,
    }
    for prop, critical in expected.items():
        assert speech.plot_critical(LO, LO.book.props[prop]) is critical, prop


# ------------------------------------------------------------------------------ the splice


def test_a_connective_that_joins_two_legal_acts_is_refused_when_the_model_writes_it(game):
    line = {
        "zh": "桥下涨水了，因而栏杆坏了。",
        "en": "The water is up beneath the bridge, therefore the rail broke.",
    }
    got = say(game, "gengfu", reply(PLAIN, **line))
    assert not got.ok
    assert errors(got) == [
        ("connective", "line.en", "connective"),
        ("connective", "line.zh", "connective"),
    ]
    assert "因而" in got.errors[1].detail


def test_a_connective_that_splices_two_facts_in_a_model_line_is_refused_by_both_steps(game):
    acts = [unnamed("pr_he_owns_boat"), unnamed("pr_rail_located"), unnamed("pr_rail_broken")]
    zh, en = (
        "老何撑船经过桥，因而栏杆塌了。",
        "Old He poled his boat past the bridge, so the rail fell.",
    )
    got = say(game, "gengfu", reply(acts, zh=zh, en=en))
    assert not got.ok
    assert errors(got) == [
        ("entity", "line.zh", "event"),  # 经过 says that he was somewhere, which no act says
        ("connective", "line.en", "connective"),
        ("connective", "line.zh", "connective"),
    ]
    assert "at" in got.errors[0].detail and "因而" in got.errors[2].detail
    # the same line without the link and without the passing is what the acts do cover
    ok = say(
        game,
        "gengfu",
        reply(
            acts,
            zh="老何的船在桥边，栏杆塌了。",
            en="Old He's boat is by the bridge. The rail fell.",
        ),
    )
    assert ok.ok, ok.errors


def test_the_core_says_a_splice_of_two_facts_without_the_connective(game):
    hold(game, "gengfu", "pr_he_under_bridge", "heard", teller="old_he", claimed="old_he", hop=1)
    acts = [belief("pr_he_under_bridge", "old_he"), belief("pr_rail_broken", "unknown")]
    zh, en = "老何撑船经过桥，因而栏杆塌了。", "Old He poled past the bridge, so the rail fell."
    got = say(game, "gengfu", reply(acts, zh=zh, en=en))
    assert got.ok and got.by == "core"
    assert got.line is not None
    for text in got.line.values():
        assert "因而" not in text and "so the rail" not in text
    assert zh not in got.line["zh"]


# ------------------------------------------------------------------------------ what is refused


@pytest.mark.parametrize(
    ("act", "code"),
    [
        (belief("pr_nothing", "unknown"), "unknown_prop"),
        (belief("pr_boat_scratched", "unknown"), "no_belief"),
        (belief("pr_rail_broken", "unknown", "speculate"), "modality"),
        (belief("pr_rail_broken", "old_he"), "source"),
        (belief("pr_rail_broken", "unknown", "deny"), "deny_needs_negation"),
        (belief("pr_rail_broken", "unknown", rule="sr_flood_season"), "extras"),
    ],
)
def test_the_belief_path_is_refused_with_the_code_of_authorize(game, act, code):
    got = say(game, "gengfu", reply([act], zh="嗯。", en="Hm."))
    assert ("path", "acts[0]", code) in errors(got)
    assert not got.ok


def test_an_act_before_its_belief_is_premature(game):
    hold(game, "gengfu", "pr_boat_scratched", tick=500)
    got = say(game, "gengfu", reply([belief("pr_boat_scratched", "self_seen")]), tick=100)
    assert errors(got) == [("path", "acts[0]", "premature")]


@pytest.mark.parametrize(
    ("change", "code"),
    [
        ({"rule": "sr_nothing"}, "unknown_rule"),
        ({"premises": ["pr_flooded"]}, "premises"),
        ({"premises": ["pr_rail_broken", "pr_flooded"]}, "premises"),
        ({"modality": "assert"}, "modality"),
        ({"source": "unknown"}, "source"),
        ({"prop": "pr_dalang_damaged"}, "conclusion"),
        ({"rule": "sr_presence_grudge"}, "premises"),
    ],
)
def test_a_guess_must_follow_a_rule_of_the_script(game, change, code):
    act = {
        "path": "speculation",
        "prop": "pr_flood_damaged",
        "modality": "speculate",
        "source": "gengfu",
        "rule": "sr_flood_season",
        "premises": ["pr_flooded", "pr_rail_broken"],
        **change,
    }
    assert errors(say(game, "gengfu", reply([act]))) == [("path", "acts[0]", code)]


def test_a_guess_needs_a_suspicious_enough_speaker(game):
    act = {
        "path": "speculation",
        "prop": "pr_dalang_damaged",
        "modality": "speculate",
        "source": "shitou",
        "rule": "sr_drunk_reckless",
        "premises": ["pr_dalang_drank", "pr_rail_broken"],
    }
    hold(game, "shitou", "pr_dalang_drank")  # suspicion 15, the rule asks for 40
    assert errors(say(game, "shitou", reply([act]))) == [("path", "acts[0]", "suspicion")]
    hold(game, "zhou_zhanggui", "pr_dalang_drank")
    assert say(game, "zhou_zhanggui", reply([{**act, "source": "zhou_zhanggui"}])).ok


def test_a_structured_prop_outside_the_tables_is_refused(game):
    def guess(**change):
        new = {"pred": "flood_damaged", "args": {"what": "t_rail"}, "span": None, "neg": False}
        new.update(change)
        return {
            "path": "speculation",
            "prop": new,
            "modality": "speculate",
            "source": "gengfu",
            "rule": "sr_flood_season",
            "premises": ["pr_flooded", "pr_rail_broken"],
        }

    for change in (
        {"pred": "sing"},
        {"args": {"what": "nothing"}},
        {"args": {"what": "li_er"}},
        {"args": {"what": "t_rail", "who": "li_er"}},
        {"motive": "boredom"},
        {"parent": "pr_flooded"},
    ):
        got = say(game, "gengfu", reply([guess(**change)]))
        assert errors(got) == [("path", "acts[0]", "bad_prop")], change


def test_a_mutation_must_be_one_step_of_its_operator(game):
    hold(game, "zhou_huoji", "pr_liner_looking")
    wrong = {
        "pred": "at",
        "args": {"who": "zhou_dalang", "where": "p_bridge"},
        "span": [-110, -80],
        "neg": False,
        "parent": "pr_liner_looking",
        "op": "level",
    }
    act = {
        "path": "mutation",
        "prop": wrong,
        "op": "level",
        "modality": "assert",
        "source": "self_seen",
    }
    got = say(game, "zhou_huoji", reply([act]))
    assert not got.ok and errors(got)[0][:2] == ("path", "acts[0]")


# ------------------------------------------------------------------------------ the shape


def test_a_reply_that_is_not_an_object_is_refused():
    game = new_game(1)
    for text, code in (
        ("", "no_object"),
        ("no json here", "no_object"),
        ("[1, 2]", "no_object"),
        ("null", "no_object"),
        ("{", "bad_acts"),  # read as an empty object, which has no acts
    ):
        got = say(game, "gengfu", text)
        assert not got.ok and got.types == ("format",), text
        assert got.errors[0].code == code, text


def test_the_json_is_read_forgivingly_and_judged_strictly(game):
    wrapped = (
        "Sure! Here you go:\n```json\n{'acts': [], 'line': {'zh': '今天风很大。', "
        "'en': 'Windy today.',},}\n```\nAnything else?"
    )
    got = say(game, "gengfu", wrapped)
    assert got.ok and got.by == "model" and got.line == {"zh": "今天风很大。", "en": "Windy today."}
    assert got.fixes == ("single_quotes", "trailing_comma")
    for strict in (
        {"acts": [], "line": {"zh": "今天风很大。", "en": "Windy today."}, "extra": 1},
        {"acts": "none"},
        {"line": {"zh": "今天风很大。", "en": "Windy today."}},
        {"acts": [{"path": "belief"}]},
        {"acts": [belief("pr_rail_broken", "unknown", extra=1)]},
        {"acts": [belief("PR_RAIL", "unknown")]},
        {"acts": [belief("pr_rail_broken", "x" * 65)]},
        {"acts": [belief("pr_rail_broken", "unknown", "maybe")]},
        {"acts": [{**belief("pr_rail_broken", "unknown"), "path": "wish"}]},
        {"acts": [], "mood": "furious"},
        {"acts": [], "address": "your majesty"},
        {"acts": [], "line": "hello"},
        {"acts": [], "line": {"zh": "你好。"}},
        {"acts": [], "line": {"zh": 1, "en": 2}},
        {"acts": [belief("pr_rail_broken", "unknown")] * 4},
    ):
        got = say(game, "gengfu", json.dumps(strict, ensure_ascii=False))
        assert not got.ok and "format" in got.types, strict


def test_a_structured_prop_is_held_to_ints_and_ids(game):
    base = {"pred": "flood_damaged", "args": {"what": "t_rail"}, "span": None, "neg": False}
    for bad in (
        {**base, "span": [1.5, 2]},
        {**base, "span": [5, 1]},
        {**base, "span": [0, 10**7]},
        {**base, "span": [True, 2]},
        {**base, "neg": "no"},
        {**base, "args": {}},
        {**base, "args": {"what": "T_RAIL"}},
        {**base, "args": {f"s{i}": "t_rail" for i in range(7)}},
        {**base, "extra": 1},
        {**base, "op": "wish"},
    ):
        act = {"path": "speculation", "prop": bad, "modality": "speculate", "source": "gengfu"}
        got = say(game, "gengfu", reply([act]))
        assert not got.ok and got.types == ("format",), bad


def test_the_words_of_a_line_are_judged_only_when_it_is_the_one_used(game):
    hold(game, "gengfu", "pr_gengfu_round")
    sourced = [belief("pr_gengfu_round", "self_seen")]
    assert say(game, "gengfu", reply(sourced, zh="x", en="y")).ok  # the core writes the sentence
    for zh, en, where in (
        ("hello", "Hello.", "line.zh"),
        ("你好。", "你好。", "line.en"),
        ("你好。", "1234", "line.en"),
        ("你\n好。", "Hello.", "line.zh"),
        ("你好" * 200, "Hello.", "line.zh"),
    ):
        got = say(game, "gengfu", reply(PLAIN, zh=zh, en=en))
        assert ("format", where, "bad_line") in errors(got), (zh, en)
    no_line = say(game, "gengfu", reply(PLAIN))
    assert errors(no_line) == [("format", "line", "no_line")]
    empty = say(game, "gengfu", reply(PLAIN, zh="", en=""))
    assert errors(empty) == [("format", "line", "no_line")]
    half = say(game, "gengfu", reply(PLAIN, zh="今天风很大。", en=""))
    assert ("format", "line.en", "bad_line") in errors(half)


# ------------------------------------------------------------------------------ pure and the same


def test_the_gate_changes_nothing_and_gives_the_same_answer_every_time(game):
    before = game.snapshot_json()
    texts = [
        reply(PLAIN, **PLAIN_LINE),
        reply([belief("pr_rail_located", "self_seen")], mood="sad", address="manager"),
        reply(PLAIN, zh="没有人知道。", en="Nobody knows."),
        "garbage",
    ]
    first = [say(game, "gengfu", text) for text in texts]
    assert [say(game, "gengfu", text) for text in texts] == first
    assert game.snapshot_json() == before
    assert state_of(game)[speech.SECTION] == speech.fresh()  # and nothing is counted
