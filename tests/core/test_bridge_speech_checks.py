"""The checks of a free line, each in its place: names and acts, the six classes of words, and what
a person keeps back. Also that the lists agree with the words the core itself says."""

from __future__ import annotations

from pathlib import Path

import pytest
from speech_helpers import belief, errors, hold, new_game, reply, say, unnamed
from voice_helpers import VOICED

from lantern_core import canon
from lantern_core.cognition.lexicon import CLASSES, EVENT, MOTIVE, NAME, normalise, scan
from lantern_core.world.bridge import speech
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

ROOT = Path(__file__).resolve().parents[2]
LO = lore()
SCRIPT = speech.script()
LEX = SCRIPT.lexicon
WATER = [unnamed("pr_flooded"), unnamed("pr_rail_broken")]  # the water is up, the rail is broken


@pytest.fixture
def game():
    return new_game(1)


def free(game, who, zh, en, acts=WATER, **kw):
    return say(game, who, reply(acts, zh=zh, en=en, **kw))


# ------------------------------------------------------------------------------ step 2: names


def test_what_the_acts_cover_may_be_named_in_either_language(game):
    got = free(
        game,
        "gengfu",
        "桥下涨水了，栏杆坏了。",
        "The water is up under the bridge. The rail is broken.",
    )
    assert got.ok, got.errors


def test_a_name_that_no_act_covers_is_refused_in_both_languages(game):
    got = free(game, "gengfu", "李二也在桥下。", "Li Er is under the bridge too.")
    assert errors(got) == [
        ("entity", "line.en", "name"),
        ("entity", "line.zh", "name"),
    ]
    assert "li_er" in got.errors[0].detail and "李二" in got.errors[1].detail


def test_the_speaker_the_listener_and_the_source_of_an_act_may_be_named(game):
    got = free(
        game,
        "gengfu",
        "更夫跟总管说，桥下涨水了。",
        "The watchman tells the Manager the water is up.",
    )
    assert got.ok, got.errors
    other = free(game, "gengfu", "老何跟总管说。", "Old He tells the Manager.")
    assert errors(other) == [("entity", "line.en", "name"), ("entity", "line.zh", "name")]
    hold(game, "gengfu", "pr_he_under_bridge", "heard", teller="old_he", claimed="old_he", hop=1)
    told = say(game, "gengfu", reply([belief("pr_he_under_bridge", "old_he")], zh="x", en="y"))
    assert told.ok and told.by == "core"  # a source that is named is the core's to word
    friend = say(game, "gengfu", reply(WATER, zh="听说桥下涨水了。", en="I heard it, Mr Zhou."))
    assert errors(friend) == [("entity", "line.en", "name")]
    assert "zhou" in friend.errors[0].detail.lower()


def test_other_names_of_an_entity_count_as_its_name(game):
    for zh, en in (
        ("老何说话了。", "Old He spoke."),
        ("那个船夫说话了。", "The boatman spoke."),
        ("船夫老何说话了。", "Boatman He spoke."),
    ):
        got = free(game, "gengfu", zh, en)
        assert errors(got) == [("entity", "line.en", "name"), ("entity", "line.zh", "name")], zh


def test_a_longer_name_is_read_once_and_does_not_hold_a_shorter_one(game):
    # 石桥栏杆 is the rail; the bridge inside it is not named, nor is 桥下水面 the bridge
    got = free(game, "gengfu", "石桥栏杆坏了。", "The Stone Bridge Railing is broken.")
    assert got.ok, got.errors
    got = free(game, "gengfu", "桥下水面涨水了。", "The water is up.")
    assert got.ok, got.errors


def test_an_english_name_is_a_whole_word_and_case_does_not_matter(game):
    for en in ("LI ER is here.", "li er is here.", "Li Er’s here.", "Over there is li   er."):
        got = free(game, "gengfu", "他在这儿。", en)
        assert errors(got) == [("entity", "line.en", "name")], en
    got = free(game, "gengfu", "他在这儿。", "Bridgework is no knowledge.")
    assert errors(got) == [("connective", "line.en", "negation")]  # the word 'no', not 'know'
    got = free(game, "gengfu", "他在这儿。", "Ferryman and ferrying are not the ferry.")
    assert ("entity", "line.en", "name") in errors(got)
    assert len([e for e in got.errors if e.type == "entity"]) == 2  # the ferryman, the ferry


def test_a_latin_name_in_the_chinese_line_is_found_and_chinese_in_the_english_line_is_refused(game):
    got = free(game, "gengfu", "Li Er 来了。", "He came.")
    assert ("entity", "line.zh", "name") in errors(got)
    got = free(game, "gengfu", "他来了。", "老何 came.")
    assert ("format", "line.en", "bad_line") in errors(got)


def test_an_event_or_a_motive_that_no_act_says_is_refused(game):
    got = free(game, "gengfu", "有人弄坏了栏杆。", "Somebody damaged the rail.")
    assert errors(got) == [("entity", "line.en", "event"), ("entity", "line.zh", "event")]
    assert "damaged" in got.errors[0].detail
    got = free(game, "gengfu", "栏杆坏了，是故意的。", "The rail is broken, deliberately.")
    assert errors(got) == [("entity", "line.en", "motive"), ("entity", "line.zh", "motive")]
    # 'broke' says broken as well as damaged, and an act says broken
    assert free(game, "gengfu", "栏杆塌了。", "The rail broke.").ok


def test_each_name_is_reported_once_for_a_line(game):
    got = free(game, "gengfu", "李二，李二，还是李二。", "Fine.")
    assert errors(got) == [("entity", "line.zh", "name")]


# ------------------------------------------------------------------------------ step 3: words

ZH_EN = {
    "connective": ("桥下涨水，所以栏杆坏了。", "The water is up, therefore the rail broke."),
    "negation": ("栏杆没有坏。", "The rail is not broken."),
    "hedge": ("栏杆也许坏了。", "The rail is perhaps broken."),
    "certain": ("栏杆一定坏了。", "The rail is definitely broken."),
    "hearsay": ("听说栏杆坏了。", "I heard the rail is broken."),
    "seen": ("我亲眼看见栏杆坏了。", "I saw the rail broken with my own eyes."),
}


@pytest.mark.parametrize("word_class", CLASSES)
def test_a_word_of_a_class_needs_an_act_that_carries_it(game, word_class):
    zh, en = ZH_EN[word_class]
    got = free(game, "gengfu", zh, en, acts=[unnamed("pr_rail_broken")])
    codes = errors(got)
    if word_class == "hearsay":  # an act that hides its source is something heard
        assert got.ok, got.errors
        got = free(game, "gengfu", zh, en, acts=[])
        codes = errors(got)
    assert ("connective", "line.zh", word_class) in codes, (word_class, codes)
    assert ("connective", "line.en", word_class) in codes, (word_class, codes)


def test_the_error_of_a_word_names_the_word_and_the_class(game):
    got = free(
        game, "gengfu", "栏杆一定坏了。", "The rail is broken.", acts=[unnamed("pr_rail_broken")]
    )
    assert [e.text() for e in got.errors] == [
        'connective at line.zh (certain): "一定" is a certain word, which no act carries'
    ]


def test_a_harmless_compound_does_not_count_for_the_word_inside_it(game):
    ok = free(
        game, "gengfu", "栏杆不错，总管，特别结实。", "The rail looks good. No problem, Manager."
    )
    assert errors(ok) == [], ok.errors
    got = free(game, "gengfu", "栏杆不是好的。", "The rail is not good.")
    assert ("connective", "line.zh", "negation") in errors(got)


def test_a_word_is_found_whatever_its_form(game):
    zh_line = "栏杆坏了，ＢＥＣＡＵＳＥ它旧了。"  # full-width letters among Chinese
    got = free(game, "gengfu", zh_line, "The rail is broken.", acts=WATER)
    assert errors(got) == [("connective", "line.zh", "connective")]
    # a curly apostrophe is an apostrophe
    got = free(game, "gengfu", "栏杆坏了。", "The rail is broken. It can’t be mended.", acts=WATER)
    assert ("connective", "line.en", "negation") in errors(got)
    got = free(game, "gengfu", "栏杆坏了，Ｌｉ　Ｅｒ来过。", "The rail is broken.", acts=WATER)
    assert ("entity", "line.zh", "name") in errors(got)
    spaced = "The rail is broken. Perhaps.   BECAUSE  of it."
    got = free(game, "gengfu", "栏杆坏了。", spaced, acts=WATER)
    assert {code for _, _, code in errors(got)} == {"hedge", "connective"}


def test_the_hedges_that_the_townsfolk_use_themselves_are_in_the_list(game):
    sentences = LO.lines._data["hedges"]
    spoken = {lang: set(sentences[lang]) for lang in ("zh", "en")}
    for voice in VOICES.values():
        for lang in ("zh", "en"):
            spoken[lang].update(voice["hedges"][lang])
    assert len(spoken["zh"]) > 30 and len(spoken["en"]) > 30
    for lang in ("zh", "en"):
        for hedge in sorted(spoken[lang]):
            text = normalise(hedge)
            assert scan(text, LEX.classes["hedge"]), (lang, hedge)


# ------------------------------------------------------------------------------ step 4: private


def test_a_person_does_not_say_the_secrets_written_for_them(game):
    got = free(game, "old_he", "那些刮痕很多。", "There are many scratches.", acts=WATER)
    assert errors(got) == [("private", "line.en", "secret"), ("private", "line.zh", "secret")]
    assert "keeps back" in got.errors[0].detail
    other = free(game, "gengfu", "那些刮痕很多。", "There are many scratches.", acts=WATER)
    assert errors(other) == [("entity", "line.en", "event"), ("entity", "line.zh", "event")]


def test_a_person_does_not_say_the_words_of_what_they_guard(game):
    zh, en = (
        "听说桥下涨水了，栏杆被人弄坏了。",
        "I heard the water is up and someone damaged the rail.",
    )
    got = free(game, "old_he", zh, en, acts=WATER)
    assert errors(got) == [("private", "line.en", "guarded"), ("private", "line.zh", "guarded")]
    assert "damaged" in got.errors[0].detail
    other = free(game, "gengfu", zh, en, acts=WATER)
    assert errors(other) == [("entity", "line.en", "event"), ("entity", "line.zh", "event")]


def test_what_the_town_knows_and_what_an_act_covers_is_not_kept_back(game):
    hold(game, "old_he", "pr_he_under_bridge")
    acts = [unnamed("pr_flooded")]
    # the place is named by a prop he guards, and by a prop of the town, which is not his to hide
    got = free(game, "old_he", "桥下涨水了。", "The water is up under the bridge.", acts=acts)
    assert got.ok, got.errors
    # his own name is his to say
    got = free(
        game, "old_he", "船夫老何听说桥下涨水了。", "Boatman He heard the water is up.", acts=acts
    )
    assert got.ok, got.errors


def test_an_act_on_what_the_speaker_guards_is_refused_even_when_it_is_a_belief_they_hold(game):
    hold(game, "old_he", "pr_he_under_bridge")
    assert LO.guards("old_he", LO.book.props["pr_he_under_bridge"])
    got = say(game, "old_he", reply([belief("pr_he_under_bridge", "self_seen")]))
    assert errors(got) == [("private", "acts[0]", "guarded")]
    ok = say(game, "zhou_zhanggui", reply([belief("pr_rail_located", "self_seen")]))
    assert ok.ok
    hold(game, "zhou_zhanggui", "pr_he_under_bridge")
    assert say(game, "zhou_zhanggui", reply([belief("pr_he_under_bridge", "self_seen")])).ok


def test_a_secret_is_reported_as_private_and_not_again_as_an_entity(game):
    got = free(game, "old_he", "刮痕多得很。", "Many scratches.", acts=WATER)
    kinds = {e.type for e in got.errors}
    assert "private" in kinds and "entity" not in kinds


# ------------------------------------------------------------------------------ the lists


def test_the_core_names_every_prop_of_the_script_in_words_that_its_own_prop_covers():
    """The sentence the core says for a prop passes the check of names for an act on that prop."""
    vocab = SCRIPT.vocabulary
    for pid in LO.book.props:
        prop = LO.book.props[pid]
        said = LO.lines.statement(prop, LO.names)
        entities = {entity for _, entity in prop.args}
        for lang, text in said.items():
            for _, form, (kind, ident) in scan(normalise(text), vocab.terms):
                if kind == NAME:
                    assert ident in entities, (pid, lang, form)
                elif kind == EVENT:
                    assert prop.pred in ident, (pid, lang, form)
                else:
                    assert kind == MOTIVE and prop.motive in ident, (pid, lang, form)


def test_the_core_names_every_entity_it_can_say_by_its_label_in_both_languages():
    vocab = SCRIPT.vocabulary
    for eid, names in LO.names.items():
        for lang in ("zh", "en"):
            hits = scan(normalise(names[lang]), vocab.terms)
            assert hits, (eid, lang)
            assert all(kind == NAME and ident == eid for _, _, (kind, ident) in hits), (
                eid,
                lang,
                hits,
            )


def test_every_word_of_every_class_is_found_where_it_is_written():
    for word_class in CLASSES:
        for form, payload, _ in LEX.classes[word_class]:
            assert payload == word_class
            found = [f for _, f, _ in scan(normalise(f"x {form} y"), LEX.classes[word_class])]
            assert form in found, (word_class, form, found)


def test_the_secrets_and_the_aliases_name_people_and_entities_of_the_town():
    entities = canon.loads((ROOT / "content" / "compiled" / "entities.json").read_bytes())
    ids = {e["id"] for e in entities["entities"]}
    assert set(LEX.aliases) <= ids | {"player"}
    assert set(LEX.secrets) <= set(LO.people)
    assert {"old_he", "t_rail", "p_bridge", "player"} <= set(LEX.aliases)
    assert set(LO.names) <= set(SCRIPT.vocabulary.forms)  # every name the town says is known


def test_every_person_of_the_cast_can_chat_through_the_gate(game):
    for who in VOICED:
        got = say(game, who, reply([], zh="今天风很大。", en="Windy today."))
        assert got.ok, (who, got.errors)
