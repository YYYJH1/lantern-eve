"""Words for what is said: templates with optional parts, the time of a span, names and frames."""

from __future__ import annotations

import pytest

from lantern_core.cognition.lines import (
    LAST_NIGHT,
    LATELY,
    THIS_MORNING,
    Lines,
    LinesError,
    capitalise,
    fill,
    frame_key,
    when_key,
)
from lantern_core.cognition.props import Entity, Prop, Registry
from lantern_core.world.bridge.sentences import SENTENCES

LINES = Lines(SENTENCES)
REGISTRY = Registry(
    [
        Entity("fam_li", "family", "李家", None, "Li Family"),
        Entity("li_er", "person", "李二", "fam_li", "Li Er"),
        Entity("old_he", "person", "船夫老何", None, "Boatman He"),
        Entity("gengfu", "person", "更夫", None, "Night Watchman"),
        Entity("stranger", "person", "外乡人", None, "The Stranger"),
        Entity("t_rail", "thing", "石桥栏杆", None, "Stone Bridge Railing"),
        Entity("t_boat", "thing", "老何的船", None, "Old He's Boat"),
        Entity("t_ledger", "thing", "账本", None, "The Accountant's Repair Ledger"),
        Entity("p_bridge", "place", "石桥", None, "Stone Bridge"),
        Entity("p_nameless", "place", "某处", None, None),
    ]
)
NAMES = LINES.names(REGISTRY)


def say(prop, modality="assert", source="unknown", speaker="gengfu", pick=0):
    return LINES.say(
        prop, NAMES, modality=modality, claimed_source=source, speaker=speaker, pick=pick
    )


AT = Prop.of("at", "at", {"who": "li_er", "where": "p_bridge"}, (-110, -80))
DAMAGED = Prop.of("dm", "damaged", {"who": "fam_li", "what": "t_rail"}, (-45, -35))


# ------------------------------------------------------------------------------ templates


def test_a_bracketed_part_stays_when_all_its_slots_have_values_and_goes_otherwise():
    assert fill("{a}[ at {b}][ {c}]", {"a": "x", "b": "y", "c": "z"}) == "x at y z"
    assert fill("{a}[ at {b}][ {c}]", {"a": "x", "b": "", "c": "z"}) == "x z"
    assert fill("{a}[ at {b}][ {c}]", {"a": "x"}) == "x"
    assert fill("{a}[{b}和{c}]了", {"a": "甲", "b": "乙", "c": ""}) == "甲了"
    assert fill("{a} {a}", {"a": "x"}) == "x x"
    assert fill("{missing}!", {}) == "!"


def test_a_span_has_words_when_it_ended_before_the_morning_of_the_first_day():
    assert when_key(None) is None
    assert when_key((-45, -35)) == LAST_NIGHT
    assert when_key((-240, -70)) == LAST_NIGHT
    assert when_key((-4320, -30)) == LATELY
    assert when_key((300, 360)) == THIS_MORNING
    assert when_key((-40, 7200)) is None  # it runs on into the game
    assert when_key((600, 700)) is None
    assert capitalise("the water") == "The water" and capitalise("") == ""


# ------------------------------------------------------------------------------ names


def test_english_names_take_the_article_an_english_sentence_wants():
    en = {i: n["en"] for i, n in NAMES.items()}
    assert en["li_er"] == "Li Er" and en["old_he"] == "Boatman He"
    assert en["gengfu"] == "the Night Watchman"  # a bare role, listed in the table
    assert en["stranger"] == "the Stranger" and en["t_ledger"] == "the Accountant's Repair Ledger"
    assert en["fam_li"] == "the Li Family"
    assert en["t_rail"] == "the Stone Bridge Railing" and en["p_bridge"] == "the Stone Bridge"
    assert en["t_boat"] == "Old He's Boat"  # a possessive takes none
    assert en["p_nameless"] == "the p_nameless"  # no English label: the id stands in
    assert NAMES["li_er"]["zh"] == "李二"


# ------------------------------------------------------------------------------ statements


def test_a_person_in_their_own_home_is_said_to_be_at_home_and_in_any_other_place_by_its_name():
    registry = Registry(
        [
            Entity("li_er", "person", "李二", None, "Li Er"),
            Entity("old_he", "person", "船夫老何", None, "Boatman He"),
            Entity("p_he_home", "place", "老何家", None, "Boatman He's House"),
        ]
    )
    lines = Lines(SENTENCES)
    names = lines.names(registry)
    at = {"who": "old_he", "where": "p_he_home"}
    home = Prop.of("h", "at", at, (-90, -20))
    away = Prop.of("a", "at", {"who": "li_er", "where": "p_he_home"}, (-90, -20))
    # until the lines know the homes, the place is named
    assert lines.statement(home, names)["en"] == "Boatman He was at Boatman He's House last night"
    lines.homes = {"old_he": "p_he_home"}
    assert lines.statement(home, names) == {
        "zh": "船夫老何昨晚在家",
        "en": "Boatman He was at home last night",
    }
    denial = Prop.of("n", "at", at, (-90, -20), neg=True)
    assert lines.statement(denial, names) == {
        "zh": "船夫老何昨晚没在家",
        "en": "Boatman He was not at home last night",
    }
    # the person says it of themselves, and another person at that house is at the house
    assert lines.statement(home, names, speaker="old_he") == {
        "zh": "我昨晚在家",
        "en": "I was at home last night",
    }
    assert lines.statement(away, names)["en"] == "Li Er was at Boatman He's House last night"


def test_a_statement_has_the_words_of_its_predicate_and_the_time_of_its_span():
    assert LINES.statement(AT, NAMES) == {
        "zh": "李二昨晚在桥边",
        "en": "Li Er was at the bridge last night",
    }
    assert LINES.statement(DAMAGED, NAMES) == {
        "zh": "李家昨晚把栏杆弄坏了",
        "en": "the Li Family broke the bridge railing last night",
    }


def test_a_predicate_may_say_a_place_or_a_thing_by_a_form_of_its_own():
    """Where a thing stands, the railing is on the bridge (桥上, "the railing"), while a person who
    was there was by it (桥边) and broke "the bridge railing"."""
    stands = Prop.of("st", "located", {"what": "t_rail", "where": "p_bridge"})
    assert LINES.statement(stands, NAMES) == {
        "zh": "栏杆在桥上",
        "en": "the railing is at the bridge",
    }
    assert LINES.statement(AT, NAMES)["zh"] == "李二昨晚在桥边"
    assert LINES.statement(DAMAGED, NAMES)["en"].endswith("broke the bridge railing last night")


def test_a_slot_the_prop_leaves_out_and_a_span_it_does_not_have_leave_no_gap():
    looked = Prop.of("lk", "looked_for", {"who": "li_er", "what": "t_boat"})
    assert LINES.statement(looked, NAMES) == {
        "zh": "李二找老何的船",
        "en": "Li Er was looking for Old He's Boat",
    }
    where = Prop.of("lk", "looked_for", {"who": "li_er", "what": "t_boat", "where": "p_bridge"})
    assert (
        LINES.statement(where, NAMES)["en"] == "Li Er was looking for Old He's Boat at the bridge"
    )
    assert LINES.statement(where, NAMES)["zh"] == "李二在桥边找老何的船"


def test_a_denial_uses_the_denial_of_the_predicate_and_a_motive_goes_last():
    denial = Prop.of("nb", "at", {"who": "li_er", "where": "p_bridge"}, (-110, -80), neg=True)
    assert LINES.statement(denial, NAMES) == {
        "zh": "李二昨晚没去桥边",
        "en": "Li Er did not go to the bridge last night",
    }
    jealous = Prop.of("j", "damaged", {"who": "fam_li", "what": "t_rail"}, None, motive="jealousy")
    assert LINES.statement(jealous, NAMES) == {
        "zh": "李家把栏杆弄坏了，是眼红人家出风头",
        "en": "the Li Family broke the bridge railing, out of envy",
    }


def test_a_prop_the_table_has_no_words_for_is_an_error():
    with pytest.raises(LinesError, match="no line for the predicate 'sing'"):
        LINES.statement(Prop.of("s", "sing", {"who": "li_er"}), NAMES)
    with pytest.raises(LinesError, match="no phrase for the motive 'envy'"):
        LINES.statement(
            Prop.of("e", "damaged", {"who": "li_er", "what": "t_rail"}, None, motive="envy"), NAMES
        )


# ------------------------------------------------------------------------------ frames


def test_what_is_said_is_framed_by_how_the_speaker_knows_it():
    assert say(AT, source="self_seen") == {
        "zh": "李二昨晚在桥边。",
        "en": "Li Er was at the bridge last night.",
    }
    assert say(AT, source="unknown") == {
        "zh": "听人说，李二昨晚在桥边。",
        "en": "I've heard it said that Li Er was at the bridge last night.",
    }
    assert say(AT, source="gengfu") == {
        "zh": "照我看，李二昨晚在桥边。",
        "en": "If you ask me, Li Er was at the bridge last night.",
    }
    assert say(AT, source="old_he") == {
        "zh": "船夫老何跟我说，李二昨晚在桥边。",
        "en": "Boatman He told me that Li Er was at the bridge last night.",
    }
    assert say(AT, source="gengfu", speaker="li_er")["en"].startswith("The Night Watchman told me")


def test_a_guess_takes_the_hedge_of_the_table_and_keeps_its_source():
    assert say(AT, "speculate", source="gengfu") == {
        "zh": "我猜李二昨晚在桥边。",
        "en": "I guess Li Er was at the bridge last night.",
    }
    assert say(AT, "speculate", source="gengfu", pick=1) == {
        "zh": "怕是李二昨晚在桥边。",
        "en": "I'd say Li Er was at the bridge last night.",
    }
    assert say(AT, "speculate", source="gengfu", pick=2)["zh"].startswith("我猜")  # it wraps round
    assert say(AT, "speculate", source="unknown") == {
        "zh": "有人猜，李二昨晚在桥边。",
        "en": "Some people guess that Li Er was at the bridge last night.",
    }
    assert say(AT, "speculate", source="old_he", pick=1) == {
        "zh": "船夫老何猜，李二昨晚在桥边。",
        "en": "Boatman He guessed that Li Er was at the bridge last night.",
    }
    # a guess cannot be seen, so one that names the speaker's own eyes is the speaker's guess
    assert say(AT, "speculate", source="self_seen")["zh"] == "我猜李二昨晚在桥边。"


ENVY = Prop.of("j", "damaged", {"who": "li_er", "what": "t_rail"}, (-45, -35), motive="jealousy")


def test_a_motive_is_a_sentence_of_its_own_when_a_person_speaks_and_follows_how_they_know_it():
    assert say(ENVY, source="old_he") == {
        "zh": "船夫老何跟我说，李二昨晚把栏杆弄坏了。还说是眼红人家出风头。",
        "en": "Boatman He told me that Li Er broke the bridge railing last night. "
        "They say it was out of envy.",
    }
    assert say(ENVY, source="unknown") == {
        "zh": "听人说，李二昨晚把栏杆弄坏了。还说是眼红人家出风头。",
        "en": "I've heard it said that Li Er broke the bridge railing last night. "
        "They say it was out of envy.",
    }
    assert say(ENVY, source="self_seen") == {
        "zh": "李二昨晚把栏杆弄坏了。那是眼红人家出风头。",
        "en": "Li Er broke the bridge railing last night. That was out of envy.",
    }
    assert say(ENVY, source="gengfu")["zh"] == (
        "照我看，李二昨晚把栏杆弄坏了。那是眼红人家出风头。"
    )
    assert say(ENVY, "speculate", source="gengfu") == {
        "zh": "我猜李二昨晚把栏杆弄坏了。怕是眼红人家出风头。",
        "en": "I guess Li Er broke the bridge railing last night. I'd say it was out of envy.",
    }
    # a guess that somebody told is told: what they guessed, and what they said it was
    assert say(ENVY, "speculate", source="old_he")["zh"].endswith("。还说是眼红人家出风头。")


def test_the_motive_stays_inside_the_frame_of_the_speaker_and_a_denial_has_none():
    mine = {"zh": "我是亲眼见的：{line}。你信不信。", "en": "I saw it: {line}. Believe it or not."}
    said = LINES.say(
        ENVY, NAMES, modality="assert", claimed_source="self_seen", speaker="gengfu", frame=mine
    )
    assert said["zh"] == "我是亲眼见的：李二昨晚把栏杆弄坏了。那是眼红人家出风头。你信不信。"
    assert said["en"] == (
        "I saw it: Li Er broke the bridge railing last night. That was out of envy. "
        "Believe it or not."
    )
    denial = Prop.of(
        "nb", "damaged", {"who": "li_er", "what": "t_rail"}, None, neg=True, motive="jealousy"
    )
    assert "眼红" not in say(denial, source="old_he")["zh"]
    assert LINES.rival(ENVY, NAMES, teller="old_he", speaker="gengfu") == {
        "zh": "可船夫老何跟我说的是，李二昨晚把栏杆弄坏了。还说是眼红人家出风头。",
        "en": "But Boatman He told me that Li Er broke the bridge railing last night. "
        "They say it was out of envy.",
    }
    # the narration keeps the motive after a comma, as one clause
    assert LINES.statement(ENVY, NAMES) == {
        "zh": "李二昨晚把栏杆弄坏了，是眼红人家出风头",
        "en": "Li Er broke the bridge railing last night, out of envy",
    }
    assert LINES.statement(ENVY, NAMES, motive=False)["en"] == (
        "Li Er broke the bridge railing last night"
    )


def test_every_motive_reads_after_the_words_that_say_it_apart_in_both_languages():
    for motive, phrase in SENTENCES["motives"].items():
        assert phrase["zh"].startswith("是"), motive  # 还说是…, 那是…, 怕是…
        prop = Prop.of("m", "damaged", {"who": "li_er", "what": "t_rail"}, None, motive=motive)
        for source in ("old_he", "self_seen"):
            said = say(prop, source=source)
            assert phrase["zh"] in said["zh"] and phrase["en"] in said["en"]
            assert said["zh"].count("。") == 2
        # a guess says the motive in the other hedge of the speaker, with 是 said once
        guessed = say(prop, "speculate", source="gengfu")
        assert guessed["en"].endswith(f"I'd say it was {phrase['en']}.")
        assert guessed["zh"].endswith("怕" + phrase["zh"] + "。")


def test_the_frame_is_named_by_how_the_speaker_knows_it_and_whether_it_is_a_guess():
    assert frame_key("assert", "self_seen", "gengfu") == "seen"
    assert frame_key("lie", "self_seen", "gengfu") == "seen"
    assert frame_key("assert", "unknown", "gengfu") == "unknown"
    assert frame_key("assert", "gengfu", "gengfu") == "own"
    assert frame_key("assert", "old_he", "gengfu") == "heard"
    assert frame_key("speculate", "self_seen", "gengfu") == "guess_own"
    assert frame_key("speculate", "gengfu", "gengfu") == "guess_own"
    assert frame_key("speculate", "unknown", "gengfu") == "guess_unknown"
    assert frame_key("speculate", "old_he", "gengfu") == "guess_heard"


def test_a_speaker_with_their_own_wording_of_the_frame_and_the_hedges_is_not_given_the_tables():
    mine = {"zh": "我这么说：{line}！", "en": "Mark you: {line}!"}
    guess = {"zh": "说不准。{hedge}{line}。", "en": "Who can say. {hedge} {line}."}
    words = {"zh": ["多半", "兴许"], "en": ["I think", "I suppose"]}
    assert LINES.say(
        AT, NAMES, modality="assert", claimed_source="self_seen", speaker="gengfu", frame=mine
    ) == {
        "zh": "我这么说：李二昨晚在桥边！",
        "en": "Mark you: Li Er was at the bridge last night!",
    }
    for pick, hedge in ((0, "I think"), (1, "I suppose"), (2, "I think")):
        said = LINES.say(
            AT, NAMES, modality="speculate", claimed_source="gengfu", speaker="gengfu",
            pick=pick, frame=guess, hedges=words,
        )  # fmt: skip
        assert said["en"] == f"Who can say. {hedge} Li Er was at the bridge last night."
        assert said["zh"].startswith("说不准。" + words["zh"][pick % 2])
    # a frame of their own and the hedges of the table, or the other way about
    assert (
        LINES.say(
            AT, NAMES, modality="speculate", claimed_source="gengfu", speaker="gengfu", frame=guess
        )["en"]
        == "Who can say. I guess Li Er was at the bridge last night."
    )
    assert (
        LINES.say(
            AT, NAMES, modality="speculate", claimed_source="gengfu", speaker="gengfu", hedges=words
        )["en"]
        == "I think Li Er was at the bridge last night."
    )
    # without either, the words are the table's, as they always were
    assert say(AT, source="self_seen")["en"] == "Li Er was at the bridge last night."


def test_a_denial_and_a_lie_are_framed_like_an_assertion():
    denial = Prop.of("nb", "at", {"who": "li_er", "where": "p_bridge"}, (-110, -80), neg=True)
    assert say(denial, "deny", source="self_seen")["zh"] == "李二昨晚没去桥边。"
    assert say(AT, "lie", source="self_seen") == say(AT, source="self_seen")


def test_a_speaker_who_is_named_in_the_prop_says_i_and_me():
    seen = say(AT, source="self_seen", speaker="li_er")
    assert seen == {
        "zh": "我昨晚在桥边。",
        "en": "I was at the bridge last night.",
    }
    owns = Prop.of("o", "owns", {"who": "li_er", "what": "t_boat"})
    assert LINES.statement(owns, NAMES, "li_er") == {
        "zh": "老何的船是我的",
        "en": "Old He's Boat belongs to me",
    }
    gave = Prop.of("g", "gave", {"who": "old_he", "whom": "li_er", "what": "t_rail"})
    assert LINES.statement(gave, NAMES, "li_er")["en"] == "Boatman He gave the bridge railing to me"
    assert LINES.statement(gave, NAMES, "old_he")["en"].startswith("I gave the bridge railing to")
    assert LINES.statement(gave, NAMES)["en"].startswith("Boatman He gave")  # nobody speaks


# ------------------------------------------------------------------ how a person says it in Chinese

OWNS = Prop.of("o", "owns", {"who": "old_he", "what": "t_boat"}, None)


def test_a_line_with_its_own_shi_drops_the_shi_of_the_frame_and_of_the_hedge():
    """说是 + 渡船是老何的 is said 说渡船是老何的, 八成是 + it 八成渡船是…, and a hedge of two
    characters takes its whole form (怕是 → 恐怕)."""
    said = LINES.say(
        OWNS,
        NAMES,
        modality="assert",
        claimed_source="old_he",
        speaker="gengfu",
        frame={"zh": "{teller}跟我讲过。说是{line}。", "en": "{teller} told me that {line}."},
    )
    assert said["zh"] == "船夫老何跟我讲过。说老何的船是自己的。"
    hedged = {"zh": ["八成是", "怕是"], "en": ["I reckon", "I'd say"]}
    first = say(OWNS, "speculate", source="gengfu")
    assert first["zh"] == "我猜老何的船是船夫老何的。"
    for pick, word in ((0, "八成老何的船"), (1, "恐怕老何的船")):
        zh = LINES.say(
            OWNS,
            NAMES,
            modality="speculate",
            claimed_source="gengfu",
            speaker="gengfu",
            pick=pick,
            hedges=hedged,
        )["zh"]
        assert zh.startswith(word) and zh.count("是") == 1, zh
    # a line without a 是 of its own keeps them
    plain = LINES.say(
        AT, NAMES, modality="speculate", claimed_source="gengfu", speaker="gengfu", hedges=hedged
    )
    assert plain["zh"] == "八成是李二昨晚在桥边。"


def test_the_one_who_told_it_is_themself_in_what_they_told():
    """船夫老何跟我说，自己昨晚在桥边: the teller is not named twice, in English "they" with
    the verb that goes with it; a guess the speaker hedges is the speaker's own and names them."""
    there = Prop.of("h", "at", {"who": "old_he", "where": "p_bridge"}, (-110, -80))
    assert say(there, source="old_he") == {
        "zh": "船夫老何跟我说，自己昨晚在桥边。",
        "en": "Boatman He told me that they were at the bridge last night.",
    }
    assert LINES.rival(there, NAMES, teller="old_he", speaker="gengfu")["zh"] == (
        "可船夫老何跟我说的是，自己昨晚在桥边。"
    )
    assert say(there, "speculate", source="old_he")["zh"] == "船夫老何猜，自己昨晚在桥边。"
    mine = {
        "zh": "{teller}提过一句。{hedge}{line}。",
        "en": "{teller} said a word. {hedge} {line}.",
    }
    hedged = LINES.say(
        there, NAMES, modality="speculate", claimed_source="old_he", speaker="gengfu", frame=mine
    )
    assert hedged["zh"] == "船夫老何提过一句。我猜船夫老何昨晚在桥边。"


def test_a_guessed_motive_is_said_in_the_other_hedge_of_the_speaker():
    words = {"zh": ["多半是", "我寻思"], "en": ["I'd say", "I suspect"]}
    for pick, (line, motive) in enumerate((("多半是", "我寻思是"), ("我寻思", "多半是"))):
        said = LINES.say(
            ENVY,
            NAMES,
            modality="speculate",
            claimed_source="gengfu",
            speaker="gengfu",
            pick=pick,
            hedges=words,
        )
        assert said["zh"] == f"{line}李二昨晚把栏杆弄坏了。{motive}眼红人家出风头。"
    said = LINES.say(
        ENVY, NAMES, modality="speculate", claimed_source="gengfu", speaker="gengfu", hedges=words
    )
    assert said["en"] == (
        "I'd say Li Er broke the bridge railing last night. I suspect it was out of envy."
    )


def test_what_the_whole_town_knows_is_said_as_that_and_not_as_a_thing_seen():
    assert frame_key("assert", "self_seen", "gengfu", known=True) == "known"
    assert frame_key("speculate", "self_seen", "gengfu", known=True) == "guess_own"
    assert LINES.is_known(OWNS) and not LINES.is_known(AT)
    assert say(OWNS, source="self_seen") == {
        "zh": "老何的船是船夫老何的，镇上谁都知道。",
        "en": "Old He's Boat belongs to Boatman He. Everyone in town knows that.",
    }
    assert say(AT, source="self_seen")["zh"] == "李二昨晚在桥边。"
