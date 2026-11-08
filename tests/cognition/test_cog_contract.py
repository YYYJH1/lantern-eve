"""The contract of a reply, apart from any game: how the JSON is read, how a line is searched for
words, and what an act is made of."""

from __future__ import annotations

import json

import pytest

from lantern_core.cognition._fields import ShapeError
from lantern_core.cognition.contract import (
    ERROR_TYPES,
    MAX_ACTS,
    ContractError,
    Features,
    Reply,
    carried,
    line_errors,
    parse,
)
from lantern_core.cognition.lexicon import (
    CLASSES,
    NAME,
    Lexicon,
    TermSet,
    Vocabulary,
    blank,
    normalise,
    scan,
)
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge.speech_data import SPEECH

LEX = Lexicon(SPEECH)
NAMES = {
    "old_he": {"zh": "船夫老何", "en": "Boatman He"},
    "t_boat": {"zh": "老何的船", "en": "Old He's Boat"},
    "p_bridge": {"zh": "石桥", "en": "the Stone Bridge"},
    "t_rail": {"zh": "石桥栏杆", "en": "the Stone Bridge Railing"},
}


def acts(*items):
    return json.dumps({"acts": list(items)})


def codes(text: str) -> list[tuple[str, str]]:
    with pytest.raises(ContractError) as caught:
        parse(text, LEX)
    return [(e.where, e.code) for e in caught.value.errors]


# ------------------------------------------------------------------------------ the normal form


def test_a_text_is_searched_in_one_normal_form():
    assert normalise("Ｌｉ　Ｅｒ’s  “Boat”\t\nWAS Here！") == 'li er\'s "boat" was here!'
    assert normalise("  ") == ""
    assert normalise("李二，你好。") == "李二,你好。"


def test_the_text_is_read_from_the_left_and_the_longest_word_at_each_place_wins():
    terms = TermSet(
        [("石桥", "bridge", False), ("石桥栏杆", "rail", False), ("栏杆", "rail alone", False)]
    )
    assert scan("石桥栏杆和石桥", terms) == [(0, "石桥栏杆", "rail"), (5, "石桥", "bridge")]
    clash = TermSet([("坏了", "broken", False), ("弄坏", "damaged", False)])
    assert scan("弄坏了", clash) == [(0, "弄坏", "damaged")]  # 弄坏 starts first, 坏了 is not read
    assert scan("", clash) == [] and scan("没有", clash) == []


def test_an_english_word_is_found_only_as_a_whole_word():
    terms = TermSet([("no", "no", True), ("bridge", "bridge", True), ("old he", "he", True)])
    assert [h[1] for h in scan("i know. no bridgework. old he's bridge", terms)] == [
        "no",
        "old he",
        "bridge",
    ]
    assert [h[1] for h in scan("the bridge,no", terms)] == ["bridge", "no"]
    assert scan("下桥no桥", terms) == [(2, "no", "no")]  # next to Chinese letters it is a word


def test_a_chinese_word_is_found_inside_a_run_of_characters():
    terms = TermSet([("因为", "because", False)])
    assert scan("这是因为那是因为", terms) == [(2, "因为", "because"), (6, "因为", "because")]


def test_blanking_leaves_the_rest_of_the_text_where_it_was():
    text = "这不错但不对"
    masked = blank(text, scan(text, TermSet([("不错", "m", False)])))
    assert masked == "这  但不对" and len(masked) == len(text)


def test_the_same_terms_are_searched_in_the_same_order_on_every_run():
    forms = [("甲乙", 1, False), ("甲", 2, False), ("ab", 3, True), ("a", 4, True)]
    assert TermSet(forms).terms == TermSet(list(reversed(forms))).terms
    assert [t[0] for t in TermSet(forms).terms] == ["ab", "甲乙", "a", "甲"]


# ------------------------------------------------------------------------------ the lexicon


def test_the_lexicon_reads_the_compiled_document():
    assert set(LEX.classes) == set(CLASSES) == set(LEX.masks)
    assert LEX.moods["plain"] == {"zh": "", "en": ""} and "manager" in LEX.addresses
    assert LEX.events["damaged"]["zh"] and LEX.motives["spite"]["en"]
    assert "old_he" in LEX.aliases and "old_he" in LEX.secrets
    assert all(len(LEX.classes[cls]) for cls in CLASSES)


@pytest.mark.parametrize(
    "damage",
    [
        lambda d: d.pop("words"),
        lambda d: d.update(extra={}),
        lambda d: d["words"].pop("hedge"),
        lambda d: d["words"]["hedge"].pop("mask"),
        lambda d: d["words"]["hedge"].update(zh="可能"),
        lambda d: d["words"]["hedge"]["zh"].append(7),
        lambda d: d["moods"].update(sad={"zh": 1, "en": ""}),
        lambda d: d.update(aliases=[]),
    ],
)
def test_a_lexicon_of_the_wrong_shape_is_refused(damage):
    doc = json.loads(json.dumps(SPEECH))
    damage(doc)
    with pytest.raises(ShapeError):
        Lexicon(doc)


def test_a_name_is_known_by_its_labels_and_its_other_names_without_the_article():
    vocab = Vocabulary(LEX, NAMES)
    forms = vocab.forms
    assert forms["old_he"]["zh"][0] == "船夫老何" and "老何" in forms["old_he"]["zh"]
    assert forms["old_he"]["en"][0] == "boatman he" and "old he" in forms["old_he"]["en"]
    assert forms["p_bridge"]["en"][0] == "stone bridge" and "bridge" in forms["p_bridge"]["en"]
    assert forms["t_boat"]["en"][0] == "old he's boat"
    assert vocab.words_of(NAME, "old_he")[0] == ("船夫老何", False)
    assert ("boatman he", True) in vocab.words_of(NAME, "old_he")
    assert vocab.words_of(NAME, "nobody") == []


def test_a_word_that_says_several_acts_stands_for_all_of_them():
    vocab = Vocabulary(LEX, NAMES)
    broke = [ids for form, ids in vocab.pred_words.items() if form == ("broke", True)]
    assert broke == [("broken", "damaged")]
    assert ("event", ("broken", "damaged")) in [payload for _, payload, _ in vocab.terms]


def test_the_terms_of_a_vocabulary_find_names_events_and_motives():
    vocab = Vocabulary(LEX, NAMES)
    found = scan(normalise("老何的船坏了，是故意的"), vocab.terms)
    assert [(form, payload) for _, form, payload in found] == [
        ("老何的船", ("name", "t_boat")),
        ("坏了", ("event", ("broken",))),
        ("故意", ("motive", ("on_purpose",))),
    ]


# ------------------------------------------------------------------------------ the shape


def test_the_object_is_found_among_other_words_and_the_first_one_is_taken():
    reply = parse('Here you go {not json} then {"acts": []} and {"acts": [1]}', LEX)
    assert reply == Reply((), None, "plain", "none", reply.fixes)
    assert parse('{"acts": []} trailing', LEX).fixes == ()
    assert parse("｛“acts”：［］｝", LEX).fixes  # full-width brackets, smart quotes


def test_what_the_forgiving_reader_repaired_is_kept():
    assert parse("{'acts': [],}", LEX).fixes == ("single_quotes", "trailing_comma")
    assert parse('{"acts": []', LEX).fixes == ("unclosed",)


def test_every_way_a_reply_breaks_the_shape_is_listed_at_once():
    got = codes(
        '{"acts": [{"path": "wish", "prop": "P"}, 5], "mood": "angry", "address": 3, "x": 1}'
    )
    assert got == [
        ("$", "unknown_key"),
        ("acts[0].path", "bad_path"),
        ("acts[0].prop", "bad_prop"),
        ("acts[0].modality", "bad_modality"),
        ("acts[0].source", "bad_source"),
        ("acts[1]", "bad_act"),
        ("mood", "bad_mood"),
        ("address", "bad_address"),
    ]


def test_an_act_and_a_prop_are_held_to_ids_and_the_closed_lists():
    ok = {"path": "belief", "prop": "pr_x", "modality": "assert", "source": "unknown"}
    assert len(parse(acts(ok), LEX).acts) == 1
    for change in (
        {"prop": ["pr_x"]},
        {"prop": "pr x"},
        {"prop": "x" * 65},
        {"source": ""},
        {"rule": "Rule"},
        {"template": 7},
        {"premises": "pr_a"},
        {"premises": ["a", "b", "c", "d", "e"]},
        {"premises": [1]},
        {"op": "polish"},
        {"modality": "believe"},
    ):
        assert codes(acts({**ok, **change})), change
    # absent or null stays absent
    assert parse(acts({**ok, "rule": None, "premises": None, "op": None, "template": None}), LEX)


def test_a_feigned_ignorance_is_a_lie_with_a_template_and_no_prop():
    reply = parse(acts({"path": "lie", "template": "lie_x"}), LEX)
    (act,) = reply.acts
    assert act.prop is None and act.template == "lie_x" and act.modality is None
    assert codes(acts({"path": "lie"})) == [("acts[0]", "no_prop")]
    assert codes(acts({"path": "belief", "template": "lie_x"})) == [("acts[0]", "no_prop")]


def test_a_structured_prop_is_read_into_a_draft_and_held_to_ints_and_ids():
    base = {"path": "mutation", "modality": "assert", "source": "unknown", "op": "level"}
    prop = {
        "pred": "at",
        "args": {"who": "li_er", "where": "p_bridge"},
        "span": [-110, -80],
        "neg": False,
        "motive": None,
        "parent": "pr_a",
        "op": "level",
    }
    (act,) = parse(acts({**base, "prop": prop}), LEX).acts
    assert isinstance(act.prop, Prop)
    assert (act.prop.id, act.prop.pred, act.prop.span, act.prop.parent) == (
        "_",
        "at",
        (-110, -80),
        "pr_a",
    )
    assert act.prop.args_dict() == {"who": "li_er", "where": "p_bridge"}
    plain = {"pred": "at", "args": {"who": "li_er"}}
    (act,) = parse(acts({**base, "prop": plain}), LEX).acts
    assert act.prop.span is None and act.prop.neg is False and act.prop.parent is None
    for bad in (
        {**plain, "span": [1.0, 2]},
        {**plain, "span": [3, 2]},
        {**plain, "span": [0, 10**7]},
        {**plain, "span": "-5..5"},
        {**plain, "neg": 1},
        {**plain, "args": {"who": 3}},
        {**plain, "args": {"Who": "li_er"}},
        {**plain, "args": {}},
        {**plain, "pred": None},
        {**plain, "motive": "Bad Motive"},
        {**plain, "oops": 1},
        "pr_a b",
    ):
        assert codes(acts({**base, "prop": bad})), bad


def test_the_size_of_a_reply_is_bounded():
    ok = {"path": "belief", "prop": "pr_x", "modality": "assert", "source": "unknown"}
    assert len(parse(acts(*[ok] * MAX_ACTS), LEX).acts) == MAX_ACTS
    assert codes(acts(*[ok] * (MAX_ACTS + 1))) == [("acts", "too_many_acts")]
    assert codes("x" * 30_000) == [("$", "bad_text")]
    assert codes(None) == [("$", "bad_text")]  # type: ignore[arg-type]
    assert codes("{" * 100) in ([("$", "no_object")], [("acts", "bad_acts")])


def test_a_line_is_a_pair_of_texts_that_may_be_left_out():
    for text in ('{"acts": []}', '{"acts": [], "line": null}', '{"acts": [], "line": {}}'):
        assert parse(text, LEX).line is None
    assert parse('{"acts": [], "line": {"zh": "  ", "en": ""}}', LEX).line is None
    got = parse('{"acts": [], "line": {"zh": " 你好。 ", "en": "Hi. "}}', LEX).line
    assert got == {"zh": "你好。", "en": "Hi."}
    for bad in (
        '"hi"',
        '{"zh": "你好"}',
        '{"zh": "你好", "en": "hi", "fr": "salut"}',
        '{"zh": 1, "en": 2}',
    ):
        assert codes(f'{{"acts": [], "line": {bad}}}') == [("line", "bad_line")], bad


def test_the_words_of_a_line_are_judged_when_it_is_used():
    assert line_errors({"zh": "你好。", "en": "Hello."}) == []
    where = lambda line: [(e.where, e.code) for e in line_errors(line)]  # noqa: E731
    assert where({"zh": "hello", "en": "Hello."}) == [("line.zh", "bad_line")]
    assert where({"zh": "你好。", "en": "你好"}) == [("line.en", "bad_line")]
    assert where({"zh": "你好。", "en": "，"}) == [("line.en", "bad_line")]
    assert where({"zh": "你\x00好。", "en": "Hi."}) == [("line.zh", "bad_line")]
    assert where({"zh": "好" * 241, "en": "Hi."}) == [("line.zh", "bad_line")]
    assert where({"zh": "你好。", "en": ""}) == [("line.en", "bad_line")]


# ------------------------------------------------------------------------------ what an act is


def test_what_carries_each_class_of_word():
    plain = Features(False, False, False, False, "unknown")
    cause = Features(False, True, False, False, "x")
    denial = Features(False, False, True, False, "unknown")
    guess = Features(False, True, False, True, "gengfu")
    seen = Features(True, False, False, False, "self_seen")
    told = Features(False, False, False, False, "old_he")
    pretence = Features(False, False, True, False, None)
    assert [plain.sensitive, cause.sensitive, denial.sensitive, guess.sensitive] == [
        False,
        True,
        True,
        True,
    ]
    assert seen.sensitive and told.sensitive and pretence.sensitive
    assert carried("connective", [cause], "me") and not carried("connective", [plain, denial], "me")
    assert carried("negation", [denial], "me") and not carried("negation", [plain, cause], "me")
    assert carried("hedge", [guess], "me") and not carried("hedge", [plain, seen], "me")
    assert carried("hearsay", [plain], "me") and carried("hearsay", [told], "me")
    assert not carried("hearsay", [seen, pretence], "me")
    assert carried("seen", [seen], "me") and not carried("seen", [plain, told], "me")
    assert not any(carried("certain", [plain, cause, denial, guess, seen, told], "me") for _ in "x")
    assert carried("anything else", [plain], "me") is False and not carried("hedge", [], "me")


def test_the_types_of_error_are_the_five_in_the_order_of_the_steps():
    assert ERROR_TYPES == ("format", "path", "entity", "connective", "private")


@pytest.mark.parametrize(
    "text",
    [
        "{" * 20_000,
        '{"' * 9_000,
        '{"acts": ' + "[" * 5_000 + "]" * 5_000 + "}",
        '{"acts": [' + ",".join(["{}"] * 4_000) + "]}",
        "{'a': “x”, " * 1_500,
        "{" + ",".join(f'"k{i}": 1' for i in range(1_500)) + "}",
        '\ufeff{"acts": []}',
    ],
)
def test_text_made_to_stall_a_reader_is_refused_or_read_and_nothing_else(text):
    try:
        parse(text, LEX)
    except ContractError as caught:
        assert caught.errors and all(e.type == "format" for e in caught.errors)
