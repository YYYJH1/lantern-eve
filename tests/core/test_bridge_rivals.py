"""One account believed, another remembered.

A person who is told an account that excludes the one they hold keeps the firmer as their belief and
remembers the other as a rival: who told it, and when. The memory is short, it costs the belief a
little firmness (so that a torn person gives way to proof more easily), a person asked about the
bridge says both, and the card of the person shows the rival only if the person said it to the
player. These tests go through the memory, the firmness, the answer, the card and the saves.
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import CLEAR, at, bridge, run_to, state_of
from dealings_helpers import acks, act, believe, stored, talking, tell, trust
from player_helpers import beside, me, seed_of, silence
from reply_helpers import Room, say
from speech_helpers import belief as an_act
from statement_helpers import fill, state_it, stated

from lantern_core.api import Game
from lantern_core.cognition.beliefs import (
    RIVAL_DENT,
    RIVAL_DENT_CAP,
    RIVALS_MAX,
    Belief,
    Rival,
)
from lantern_core.world.bridge import (
    assembly,
    clarify,
    converse,
    goals_ending,
    notebook,
    notes,
    projection,
    social,
    telling,
    voices,
)
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.sentences import SENTENCES
from lantern_core.world.bridge.voice_data import VOICES

LO = lore()
BOOK = LO.book
BOAT, LI_ER, FLOOD, DALANG = (
    "pr_boat_damaged",
    "pr_liner_damaged",
    "pr_flood_damaged",
    "pr_dalang_damaged",
)
PLAIN_ENGLISH = "But Shopkeeper Zhou told me that Li Er broke the bridge railing last night."
PLAIN_CHINESE = "可周掌柜跟我说的是，李二昨晚把栏杆弄坏了。"


class Recorder:
    """Stands for the sim where only ``emit`` is wanted."""

    def __init__(self):
        self.events = []

    def emit(self, kind, **fields):
        self.events.append({"kind": kind, **fields})


def hear(
    game, who, prop_id, confidence, teller="zhou_zhanggui", tick=9, source="heard", claim="c1"
):
    """``who`` is told ``prop_id`` by ``teller`` (or hears it in the street, ``source="street"``),
    by the rule of the town. Returns whether they took it in."""
    section = state_of(game)["social"]
    told = source == "heard"
    belief = Belief(
        who, prop_id, "assert", confidence, source,
        teller if told else None, teller if told else None, 1, tick, claim if told else None,
    )  # fmt: skip
    return telling._hold(
        Recorder(), section, LO, social.book(section), BOOK.props[prop_id], belief, claim
    )


def rivals(game, who):
    return notes.rivals_of(state_of(game)["social"], who)


def firmness(game, who, prop_id):
    return notes.store(state_of(game)["social"], who).firmness(prop_id)


def torn(who="li_laotai", held=70, other=50, teller="zhou_zhanggui", **kwargs):
    """A conversation with a person who holds the boat account (told by the night watchman) at
    ``held`` and has been told the account of Li Er by ``teller``, which they did not take in."""
    game = talking(who, **kwargs)
    believe(game, who, BOAT, held, source="heard", teller="gengfu")
    assert not hear(game, who, LI_ER, other, teller)
    return game


# ------------------------------------------------------------------------------ the memory


def test_an_account_that_loses_is_kept_in_mind_with_who_told_it_and_when():
    game = torn()
    assert rivals(game, "li_laotai") == [Rival(LI_ER, BOAT, "zhou_zhanggui", 9, "c1")]
    assert stored(game, "li_laotai", LI_ER).confidence == 0  # set aside
    assert stored(game, "li_laotai", BOAT).confidence == 70


def test_the_one_that_is_set_aside_by_a_firmer_account_is_the_rival():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 60, source="heard", teller="gengfu")
    assert hear(game, "li_laotai", LI_ER, 61, "cha_laoban", tick=12, claim="c3")
    assert stored(game, "li_laotai", BOAT).confidence == 0
    assert rivals(game, "li_laotai") == [Rival(BOAT, LI_ER, "gengfu", 0, None)]


def test_a_tie_goes_to_what_is_held_and_the_newcomer_is_the_rival():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 60, source="heard", teller="gengfu")
    assert not hear(game, "li_laotai", LI_ER, 60)
    assert [(r.prop, r.against) for r in rivals(game, "li_laotai")] == [(LI_ER, BOAT)]


def test_a_story_that_does_not_exclude_what_is_held_is_no_rival():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 60, source="heard", teller="gengfu")
    assert hear(game, "li_laotai", "pr_liner_at_bridge", 20)
    assert rivals(game, "li_laotai") == []
    assert "rivals" not in state_of(game)["social"]  # a game with none has no section for them


def test_what_nobody_told_is_no_rival():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 60, source="heard", teller="gengfu")
    assert not hear(game, "li_laotai", LI_ER, 20, source="street")  # heard in the street, no one
    assert rivals(game, "li_laotai") == []
    other = talking("zhou_dalang", hour=11)
    state_of(other)["social"]["beliefs"]["zhou_dalang"].clear()  # (whatever they knew of the night)
    believe(other, "zhou_dalang", FLOOD, 60, source="saw")  # what they saw themselves is not told
    assert hear(other, "zhou_dalang", LI_ER, 61, "cha_laoban")
    assert rivals(other, "zhou_dalang") == []


def test_a_guess_that_loses_is_not_an_account_to_remember():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 60, source="heard", teller="gengfu")
    section = state_of(game)["social"]
    guess = Belief(
        "li_laotai", LI_ER, "speculate", 30, "heard", "cha_laoban", "cha_laoban", 1, 9, "c1"
    )
    telling._hold(Recorder(), section, LO, social.book(section), BOOK.props[LI_ER], guess, "c1")
    assert rivals(game, "li_laotai") == []


def test_the_memory_is_short_and_the_oldest_account_goes_first():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 90, source="heard", teller="gengfu")
    told = [
        (LI_ER, "zhou_zhanggui"),
        ("pr_li_damaged", "cha_laoban"),
        ("pr_li_damaged_on_purpose", "mujiang"),
        ("pr_li_damaged_jealous", "li_da"),
        ("pr_liner_damaged_on_purpose", "gengfu"),
        (FLOOD, "zhou_huoji"),
    ]
    for number, (prop, teller) in enumerate(told):
        hear(game, "li_laotai", prop, 10, teller, tick=20 + number, claim=f"c{number}")
    kept = rivals(game, "li_laotai")
    assert len(kept) == RIVALS_MAX
    assert [r.prop for r in kept] == [prop for prop, _ in told[-RIVALS_MAX:]]
    assert [r.tick for r in kept] == [20 + n for n in range(len(told) - RIVALS_MAX, len(told))]


def test_the_rivals_of_a_belief_that_is_set_aside_follow_the_one_that_replaces_it():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 50, source="heard", teller="gengfu")
    hear(game, "li_laotai", LI_ER, 20, "zhou_zhanggui")  # a rival of the boat account
    assert hear(game, "li_laotai", FLOOD, 80, "miaozhu")  # and the flood wins over the boat
    assert [(r.prop, r.against, r.teller) for r in rivals(game, "li_laotai")] == [
        (LI_ER, FLOOD, "zhou_zhanggui"),  # it excludes the flood too
        (BOAT, FLOOD, "gengfu"),
    ]


def test_a_rival_that_does_not_exclude_the_new_belief_is_forgotten_with_the_old_one():
    game = talking("zhou_dalang", hour=11)
    believe(game, "zhou_dalang", "pr_dalang_at_bridge", 50, source="heard", teller="gengfu")
    hear(game, "zhou_dalang", "pr_dalang_at_home", 20, "zhou_niangzi")
    assert [r.prop for r in rivals(game, "zhou_dalang")] == ["pr_dalang_at_home"]
    assert hear(game, "zhou_dalang", "pr_dalang_not_bridge", 80, "cha_laoban")
    # being at home does not exclude "not at the bridge"; the account that was set aside does
    assert [(r.prop, r.against) for r in rivals(game, "zhou_dalang")] == [
        ("pr_dalang_at_bridge", "pr_dalang_not_bridge")
    ]


def test_an_account_that_comes_to_be_believed_is_no_rival_any_more():
    game = torn(held=60, other=50)
    assert [r.prop for r in rivals(game, "li_laotai")] == [LI_ER]
    assert hear(game, "li_laotai", LI_ER, 95, "cha_laoban")  # told again by another, and taken in
    assert [(r.prop, r.against) for r in rivals(game, "li_laotai")] == [(BOAT, LI_ER)]


def test_the_conflict_is_the_event_it_was():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    section = state_of(game)["social"]
    belief = Belief(
        "li_laotai", LI_ER, "assert", 50, "heard", "zhou_zhanggui", "zhou_zhanggui", 1, 9, "c1"
    )
    sim = Recorder()
    telling._hold(sim, section, LO, social.book(section), BOOK.props[LI_ER], belief, "c1")
    assert sim.events == [
        {
            "kind": "conflict", "holder": "li_laotai", "new": LI_ER, "held": BOAT,
            "kept": "held", "claim": "c1",
        }
    ]  # fmt: skip
    assert section["counts"]["conflicts"] == 1


def test_a_lie_that_is_found_out_is_no_rival():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 90, source="heard", teller="gengfu")
    out = tell(game, how="fabricate", pred="damaged", subject="li_er", object="t_rail")
    assert acks(out) == [("applied", None)]
    caught = state_of(game)["player"]["caught"]
    assert caught and caught[0][1] == "li_laotai"
    assert rivals(game, "li_laotai") == []  # the manager's lie is not an account she keeps in mind


def test_the_rumour_cleared_in_public_is_no_rival_of_the_people_who_took_that_in():
    game = torn()
    sim = SimpleNamespace(state=state_of(game), ctx=SimpleNamespace(tick=30))
    clarify.take_in(sim, "li_laotai", [LI_ER])
    assert rivals(game, "li_laotai") == []


# ------------------------------------------------------------------------------ firmness


def test_a_belief_held_against_a_rival_is_less_firm_and_no_less_confident():
    game = torn(held=70)
    assert stored(game, "li_laotai", BOAT).confidence == 70
    assert firmness(game, "li_laotai", BOAT) == 70 - RIVAL_DENT


def test_a_torn_person_gives_way_to_a_newcomer_that_a_firm_one_does_not():
    firm = talking("li_laotai")
    believe(firm, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    assert not hear(firm, "li_laotai", FLOOD, 66, "miaozhu")
    unsure = torn(held=70)
    hear(unsure, "li_laotai", "pr_li_damaged", 10, "cha_laoban")  # a second rival
    assert firmness(unsure, "li_laotai", BOAT) == 70 - 2 * RIVAL_DENT
    assert hear(unsure, "li_laotai", FLOOD, 66, "miaozhu")  # 66 against a firmness of 62


def test_the_cost_of_the_rivals_has_a_cap():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 90, source="heard", teller="gengfu")
    for number, prop in enumerate(
        (LI_ER, "pr_li_damaged", "pr_li_damaged_on_purpose", "pr_li_damaged_jealous")
    ):
        hear(game, "li_laotai", prop, 10, "cha_laoban", claim=f"c{number}")
    assert len(rivals(game, "li_laotai")) == RIVALS_MAX
    assert RIVAL_DENT * RIVALS_MAX > RIVAL_DENT_CAP
    assert firmness(game, "li_laotai", BOAT) == 90 - RIVAL_DENT_CAP


def test_a_whole_proof_moves_the_elder_who_holds_another_account_more_easily_when_torn():
    game = talking("zuzhang", seed=1, hour=9)
    world = state_of(game)
    believe(game, "zuzhang", BOAT, 87, "heard", "old_he", "old_he")
    # the story is the drunken kick, so the boat account is false: 100 + 12 - 43 = 69, one short
    trust(game, "zuzhang", 24)
    assert not assembly.accepts(world, "zuzhang", "v_drunk", 100, [])
    hear(game, "zuzhang", LI_ER, 10, "cha_laoban")  # told the other account, and held to his own
    assert firmness(game, "zuzhang", BOAT) == 83
    assert assembly.accepts(world, "zuzhang", "v_drunk", 100, [])  # 100 + 12 - 41 = 71
    assert stored(game, "zuzhang", BOAT).confidence == 87  # nothing else moved


def test_the_acceptance_reads_the_firmness_of_the_beliefs_that_are_held():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 80, "heard", "old_he", "old_he")
    world = state_of(game)
    truths = goals_ending.true_conflict_props("v_drunk")
    assert assembly._beliefs_about(world, "li_laotai", truths) == ([(BOAT, 80)], False)
    hear(game, "li_laotai", LI_ER, 10, "cha_laoban")
    assert assembly._beliefs_about(world, "li_laotai", truths) == ([(BOAT, 80 - RIVAL_DENT)], False)


def test_the_manager_who_tells_the_elder_the_true_account_in_a_talk_softens_his_hold():
    game = talking("zuzhang", seed=1, hour=9)
    believe(game, "zuzhang", BOAT, 87, "heard", "old_he", "old_he")
    trust(game, "zuzhang", 40)
    belief = Belief("player", DALANG, "assert", 60, "heard", "gengfu", "gengfu", 1, 0)
    entry = notebook.add_heard(me(game), belief)[0]["id"]
    out = tell(game, entry)
    assert acks(out) == [("applied", None)]
    (told,) = [e for e in out["events"] if e["kind"] == "told"]
    assert told["outcome"] == "doubted"  # a manager at 40 does not outweigh 87
    assert [(r.prop, r.against, r.teller) for r in rivals(game, "zuzhang")] == [
        (DALANG, BOAT, "player")
    ]
    assert firmness(game, "zuzhang", BOAT) == 87 - RIVAL_DENT


# ------------------------------------------------------------------------------ saves and replays


def test_a_saved_game_keeps_the_rivals_and_goes_on_the_same():
    game = torn()
    act(game, "leave")
    restored = Game.from_snapshot_json(game.snapshot_json())
    assert state_of(restored)["social"]["rivals"] == state_of(game)["social"]["rivals"]
    assert restored.hash() == game.hash()
    run_to(game, game.tick + 120)
    run_to(restored, restored.tick + 120)
    assert restored.hash() == game.hash()
    assert rivals(restored, "li_laotai") == rivals(game, "li_laotai")


def test_the_same_inputs_make_the_same_rivals_every_time():
    first, second = torn(), torn()
    assert first.hash() == second.hash()
    assert rivals(first, "li_laotai") == rivals(second, "li_laotai")


def test_the_memory_is_in_the_state_only_when_somebody_has_a_rival():
    plain = talking("li_laotai")
    assert "rivals" not in state_of(plain)["social"] and "aloud" not in state_of(plain)["social"]
    game = torn()
    assert list(state_of(game)["social"]["rivals"]) == ["li_laotai"]
    assert state_of(game)["social"]["rivals"]["li_laotai"] == [f"{LI_ER}|{BOAT}|zhou_zhanggui|9|c1"]


# ------------------------------------------------------------------------------ the answer


def said(game, who="li_laotai"):
    """The words on show over a person, in both languages."""
    (bubble,) = [b for b in frame_now(game)["bubbles"] if b["npc"] == who]
    return bubble["text"]


def granny_says(person):
    """What Granny Li calls ``person`` when she speaks: her own name for them, else the cast's."""
    return voices.called("li_laotai", person)


def holds(text, name):
    """Whether the words hold the name of ``name`` (``{"zh", "en"}``), in either language."""
    return name["zh"] in text["zh"] or name["en"].lower() in text["en"].lower()


def test_a_torn_person_asked_about_the_bridge_says_what_they_hold_and_what_else_they_were_told():
    game = torn()
    out = act(game, "ask", topic=BOAT)
    assert acks(out) == [("applied", None)]
    words = said(game)
    zh, en = words["zh"], words["en"]
    he, shop, accused = (granny_says(p) for p in ("old_he", "zhou_zhanggui", "li_er"))
    teller, other = zh.find(shop["zh"]), zh.find(accused["zh"])
    assert -1 < zh.find(he["zh"]) < teller < other  # what they hold first, the other after it
    low = en.lower()
    assert he["en"].lower() in low and accused["en"].lower() in low
    assert low.index(he["en"].lower()) < low.index(shop["en"].lower())
    assert me(game)["twins"] == {"p1": "p2"}
    asked = [e for e in out["events"] if e["kind"] == "asked"]
    assert [(e["prop"], e["source"]) for e in asked] == [(BOAT, "gengfu")]  # the event is as it was


def test_a_torn_person_who_greeted_the_manager_answers_with_both_accounts_in_the_greetings_place():
    """Granny Li is one of the ten who greet by the state of the game (``roles``): the greeting is
    the line on show as the talk opens. Asked about the bridge she answers with both accounts, and
    that answer takes the place of the greeting on show, as any answer does. The two lines share
    nothing (the page keeps the greeting as the first row of the talk and the answer as the next
    ones), and the greeting says nothing of the rival."""
    game = torn()
    assert state_of(game)["player"]["line"][2:4] == ["role", "greet"]
    greeting = said(game)
    shop, he = granny_says("zhou_zhanggui"), granny_says("old_he")
    assert not holds(greeting, shop)
    assert acks(act(game, "ask", topic=BOAT)) == [("applied", None)]
    assert state_of(game)["player"]["line"][2] == "claim"
    answer = said(game)
    assert greeting["zh"] not in answer["zh"] and greeting["en"] not in answer["en"]
    assert shop["zh"] in answer["zh"] and shop["en"].lower() in answer["en"].lower()
    assert he["zh"] in answer["zh"] and he["en"].lower() in answer["en"].lower()


def test_the_account_somebody_else_told_goes_into_the_notebook_as_heard_from_them():
    game = torn()
    act(game, "ask", topic=BOAT)
    entries = {e["prop"]: e for e in me(game)["notebook"]}
    assert set(entries) == {BOAT, LI_ER}
    note = notebook.belief_of(entries[LI_ER])
    assert (note.teller, note.claimed_source, note.hop) == ("li_laotai", "zhou_zhanggui", 2)
    assert entries[LI_ER]["trail"] == [["li_laotai", "zhou_zhanggui", LI_ER]]  # to be traced to him


def test_asked_about_a_subject_the_person_says_the_rival_too():
    game = torn()
    act(game, "ask", topic="t_rail")
    assert granny_says("zhou_zhanggui")["zh"] in said(game)["zh"]
    assert granny_says("li_er")["zh"] in said(game)["zh"]


def test_asked_about_an_account_they_do_not_hold_they_say_no_and_what_they_hold_and_were_told():
    game = torn()
    act(game, "ask", topic=FLOOD)
    assert me(game)["line"][4] == "not_so"
    assert granny_says("zhou_zhanggui")["zh"] in said(game)["zh"]
    assert granny_says("old_he")["zh"] in said(game)["zh"]


def test_asked_about_the_rival_account_itself_they_say_what_they_know_of_it():
    game = torn()
    act(game, "ask", topic=LI_ER)  # what Li Er was seen doing is something they know first-hand
    assert "twins" not in me(game) and granny_says("li_er")["zh"] in said(game)["zh"]


def test_a_person_with_no_rival_answers_as_ever():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    act(game, "ask", topic=BOAT)
    assert "twins" not in me(game)
    assert len(me(game)["notebook"]) == 1
    zh = said(game)["zh"]  # one account, whatever the number of sentences its frame has
    assert (
        granny_says("zhou_zhanggui")["zh"] not in zh and zh.count(granny_says("old_he")["zh"]) == 1
    )


def test_asked_who_told_them_the_answer_is_the_source_alone():
    game = torn()
    act(game, "ask", topic=BOAT)
    act(game, "ask_source", entry="n1")
    assert granny_says("zhou_zhanggui")["zh"] not in said(game)["zh"]
    assert me(game)["twins"] == {"p1": "p2"}  # only the first answer had a rival


def test_an_account_the_manager_told_is_not_said_back_to_the_manager():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    assert not hear(game, "li_laotai", LI_ER, 50, "player")
    assert [r.teller for r in rivals(game, "li_laotai")] == ["player"]
    act(game, "ask", topic=BOAT)
    assert "twins" not in me(game) and len(me(game)["notebook"]) == 1
    assert firmness(game, "li_laotai", BOAT) == 70 - RIVAL_DENT  # ... but it counts


def test_what_a_person_keeps_back_is_not_said_as_their_rival():
    game = talking("old_he")
    believe(game, "old_he", FLOOD, 70, source="heard", teller="gengfu")
    assert LO.guards("old_he", BOOK.props[BOAT])  # an account that blames him is one he keeps back
    assert not hear(game, "old_he", BOAT, 50, "zhou_zhanggui")
    assert [r.prop for r in rivals(game, "old_he")] == [BOAT]
    act(game, "ask", topic=FLOOD)
    assert "twins" not in me(game)


def test_an_account_that_was_overwritten_since_is_not_said():
    game = torn()
    state_of(game)["social"]["beliefs"]["li_laotai"][LI_ER] = (
        "assert|0|heard|cha_laoban|cha_laoban|1|9|c1"  # told again by another, and set aside again
    )
    act(game, "ask", topic=BOAT)
    assert "twins" not in me(game)


def test_the_newest_rival_is_the_one_said():
    game = torn()
    hear(game, "li_laotai", "pr_li_damaged", 10, "cha_laoban", tick=30, claim="c2")
    act(game, "ask", topic=BOAT)
    zh = said(game)["zh"]
    assert voices.called("li_laotai", "cha_laoban")["zh"] in zh
    assert voices.called("li_laotai", "fam_li")["zh"] in zh  # 我们家, as she calls her family
    assert voices.called("li_laotai", "li_er")["zh"] not in zh


# ------------------------------------------------------------------------------ the words


def test_every_person_has_a_voice_for_the_rival_in_both_languages():
    prop = BOOK.props[LI_ER]
    said_by = {}
    for person in LO.people:
        assert len(VOICES[person]["frames"]["rival"]) >= 2
        teller, accused = voices.called(person, "zhou_zhanggui"), voices.called(person, "li_er")
        for tick in range(40):
            words = voices.rival_words(prop, "zhou_zhanggui", person, tick)
            assert set(words) == {"zh", "en"}
            assert teller["zh"] in words["zh"] and teller["en"].lower() in words["en"].lower()
            assert person == "li_er" or (  # the accused says "I" of himself
                accused["zh"] in words["zh"] and accused["en"].lower() in words["en"].lower()
            )
            assert words["en"][0].isupper() and "{" not in words["zh"] + words["en"]
            said_by.setdefault(person, set()).add(words["zh"])
    assert all(len(ways) == 2 for ways in said_by.values())  # each says it in two ways


def test_nobody_says_the_rival_in_the_words_of_somebody_else_or_of_the_plain_voice():
    plain = SENTENCES["frames"]["rival"]
    owners = {}
    for person in LO.people:
        for variant in VOICES[person]["frames"]["rival"]:
            assert variant != plain
            owners.setdefault(variant["zh"], set()).add(person)
    assert all(len(people) == 1 for people in owners.values())
    said = LO.lines.rival(BOOK.props[LI_ER], LO.names, teller="zhou_zhanggui", speaker="li_laotai")
    assert said == {"zh": PLAIN_CHINESE, "en": PLAIN_ENGLISH}


def test_a_person_who_is_blamed_in_the_account_says_i_and_not_their_name():
    words = voices.rival_words(BOOK.props[BOAT], "zhou_zhanggui", "old_he", 3)
    assert "老何" not in words["zh"] and "我" in words["zh"]
    assert "Boatman He" not in words["en"] and " I broke" in words["en"]


def test_the_plain_words_are_what_a_model_is_given():
    game = torn()
    act(game, "ask", topic=BOAT)
    world = state_of(game)
    line = world["player"]["line"]
    plain, voiced = converse.words(world, line, plain=True), converse.words(world, line)
    assert plain != voiced
    assert plain["en"].endswith(PLAIN_ENGLISH) and plain["zh"].endswith(PLAIN_CHINESE)


# ------------------------------------------------------------------------------ the card


def card_of(game, who="li_laotai"):
    return {c["id"]: c for c in frame_now(game)["cards"]}[who]


def test_the_card_shows_the_rival_when_the_person_said_it_to_the_player():
    game = torn()
    assert card_of(game)["stance"] is None  # held and not said
    act(game, "ask", topic=BOAT)
    stance = card_of(game)["stance"]
    assert stance["text"]["zh"].startswith("船夫老何")
    assert stance["rival"] == {
        "text": {
            "zh": "李二昨晚把栏杆弄坏了。",
            "en": "Li Er broke the bridge railing last night.",
        },
        "who": {"zh": "周掌柜", "en": "Shopkeeper Zhou", "id": "zhou_zhanggui"},
    }
    assert stance["kind"] == "told" and stance["entry"] == "n1"  # the stance is the belief


def test_the_card_has_no_rival_for_a_person_who_did_not_say_one():
    game = torn()
    assert "rival" not in json.dumps(card_of(game))
    other = talking("cha_laoban")
    believe(other, "cha_laoban", BOAT, 70, source="heard", teller="gengfu")
    hear(other, "cha_laoban", LI_ER, 50)
    act(other, "ask", topic="t_li_er_lantern")  # about something else
    assert card_of(other, "cha_laoban")["stance"] is None  # she keeps a rival and has not said so


def test_the_card_keeps_the_rival_while_a_later_answer_about_the_same_belief_has_none():
    game = torn()
    act(game, "ask", topic=BOAT)
    first = card_of(game)["stance"]
    assert "rival" in first
    act(game, "ask_source", entry="n1")  # who told them: the answer has no rival, the card does
    del state_of(game)["social"]["rivals"]  # and the person has let go of it since
    act(game, "ask", topic=BOAT)
    stance = card_of(game)["stance"]
    assert stance["rival"] == first["rival"] and stance["tick"] > first["tick"]
    assert stance["text"]["zh"].startswith("船夫老何")


def test_the_card_has_no_rival_for_another_belief_that_was_said_without_one():
    game = torn()
    act(game, "ask", topic=BOAT)
    assert "rival" in card_of(game)["stance"]
    believe(game, "li_laotai", FLOOD, 90, source="heard", teller="miaozhu")  # another account now
    act(game, "ask", topic=FLOOD)
    stance = card_of(game)["stance"]
    assert stance["text"]["zh"].startswith("栏杆是秋汛冲坏的") and "rival" not in stance


def test_the_account_said_after_the_belief_is_not_the_stance():
    game = torn()
    act(game, "ask", topic=BOAT)
    stance = card_of(game)["stance"]
    assert stance["text"]["zh"].startswith("船夫老何")  # not the rival, though it is the newer note
    assert stance["entry"] == "n1"


def test_the_card_is_a_record_of_what_was_said_and_the_hidden_state_does_not_change_it():
    game = torn()
    act(game, "ask", topic=BOAT)
    base = card_of(game)["stance"]

    def forget(s):
        s["social"]["beliefs"]["li_laotai"].clear()

    def other_story(s):
        s["social"].update(variant="v_flood")

    def no_rivals(s):
        s["social"].pop("rivals", None)

    def nobody_trusts_the_manager(s):
        s["player"]["trust"] = [0] * len(s["player"]["trust"])

    for change in (forget, other_story, no_rivals, nobody_trusts_the_manager):
        twin = Game.from_snapshot_json(game.snapshot_json())
        change(state_of(twin))
        assert card_of(twin)["stance"] == base, change.__name__


def test_the_card_names_the_teller_as_the_cast_does():
    game = talking("li_laotai")
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    hear(game, "li_laotai", LI_ER, 50, "cha_laoban")
    act(game, "ask", topic=BOAT)
    assert card_of(game)["stance"]["rival"]["who"] == {
        "zh": "茶馆老板娘",
        "en": "Teahouse Keeper",
        "id": "cha_laoban",
    }


def test_the_rows_of_the_audit_speak_for_the_new_fields():
    for path in (
        "cards[].stance.rival",
        "cards[].stance.rival.text.zh",
        "cards[].stance.rival.who.id",
    ):
        assert projection.mark_of(path) == "known", path


def a_torn_person_in_the_slice(variant: str) -> tuple:
    """The slice under a story, the same things done: Granny Li holds the boat account (told by the
    night watchman) and was told the account of Li Er by the shopkeeper, and the manager asks."""
    game = slice_game(variant=variant)
    run_to(game, at(1, 8, 0))
    meet(game, "li_laotai")
    silence(game)
    state_of(game)["social"]["beliefs"]["li_laotai"].clear()  # (not what the opening told her)
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    hear(game, "li_laotai", LI_ER, 50, "zhou_zhanggui")
    return game, act(game, "ask", topic=BOAT)


@pytest.mark.parametrize("variant", ["v_flood", "v_drunk"])
def test_the_same_doings_tell_the_same_of_a_torn_person_whichever_story_is_true(variant):
    base_game, base_out = a_torn_person_in_the_slice("v_boat")
    game, out = a_torn_person_in_the_slice(variant)
    assert base_game.tick == game.tick
    assert card_of(game)["stance"] == card_of(base_game)["stance"]
    assert said(game) == said(base_game)
    assert out["frame"]["notebook"] == base_out["frame"]["notebook"]


# ------------------------------------------------------------------------------ a model's words


def torn_room(who="li_laotai") -> Room:
    """A room with the manager in a talk with a person who holds the boat account and was told the
    account of Li Er by the shopkeeper, the model's words being asked for."""
    room = Room(who, hour=8)
    believe(room.game, who, BOAT, 70, source="heard", teller="gengfu")
    assert not hear(room.game, who, LI_ER, 50, "zhou_zhanggui")
    return room


def test_the_model_is_asked_for_both_accounts_and_the_plain_words_say_both():
    room = torn_room()
    out = room.act("ask", topic=BOAT)
    (request,) = out["requests"]
    user = request["messages"][1]["content"]
    assert PLAIN_ENGLISH in user and PLAIN_CHINESE in user  # the words the rules would have said
    first = {"path": "belief", "prop": BOAT, "modality": "assert", "source": "gengfu"}
    second = {"path": "belief", "prop": LI_ER, "modality": "assert", "source": "zhou_zhanggui"}
    assert f'"acts": {json.dumps([first, second])}' in user


def test_the_answer_of_the_rules_stays_with_both_accounts_when_the_model_does_not_answer():
    room = torn_room()
    out = room.act("ask", topic=BOAT)
    line = room.line()
    room.result(out["requests"][0], "error", "http_500")
    assert room.line() == line and me(room.game)["twins"] == {"p1": "p2"}


def test_a_line_the_model_wrote_with_both_acts_keeps_the_rival_on_the_card():
    room = torn_room()
    out = room.act("ask", topic=BOAT)
    both = say(
        "更夫说是老何。周掌柜说是李二。", "The watchman says Old He. Zhou says Li Er.",
        an_act(BOAT, "gengfu"), an_act(LI_ER, "zhou_zhanggui"),
    )  # fmt: skip
    room.result(out["requests"][0], "ok", both)
    assert room.line()[2] == "said" and me(room.game)["twins"] == {"p1": "p2"}
    assert "rival" in card_of(room.game)["stance"]


def test_a_line_the_model_wrote_without_the_rival_leaves_it_off_the_card():
    room = torn_room()
    out = room.act("ask", topic=BOAT)
    only = say("更夫说是老何。", "The watchman says Old He.", an_act(BOAT, "gengfu"))
    room.result(out["requests"][0], "ok", only)
    assert room.line()[2] == "said"
    assert "twins" not in me(room.game)  # the player was not told it in the words that are on show
    assert "rival" not in card_of(room.game)["stance"]


# ------------------------------------------------------------------------------ the elder's case


def the_teahouse_with_the_elder(torn_elder: bool):
    """The first evening at the teahouse with the card filled in right (the story is the drunken
    kick), everyone there sure of the truth but the elder, who holds the account of Li Er at 87
    and trusts the manager at 24: a whole proof is 69 to him, one short of the price. With
    ``torn_elder`` he was told another account too (by the madam), which he did not take in."""
    game = bridge(seed_of("v_drunk"), **CLEAR)
    run_to(game, at(1, 18, 15))
    beside(game, "cha_laoban")
    silence(game)
    me(game)["evidence"].extend(["e_gengfu_dalang"])  # alone it tells the drunken kick apart
    assert state_of(game)["social"]["variant"] == "v_drunk"
    here = assembly.audience(state_of(game), "p_teahouse")
    assert "zuzhang" in here and len(here) >= assembly.MIN_NAMED
    for person in here:
        if person != "zuzhang":
            believe(game, person, DALANG, 90, "saw")
    believe(game, "zuzhang", LI_ER, 87, "heard", "zhou_huoji", "zhou_huoji")
    trust(game, "zuzhang", 24)
    if torn_elder:
        assert not hear(game, "zuzhang", BOAT, 10, "cha_laoban")
    fill(game)
    return game


@pytest.mark.usefixtures("the_meeting_is_open")
def test_a_whole_proof_in_public_is_taken_by_the_torn_elder_and_not_by_the_firm_one():
    firm = stated(state_it(the_teahouse_with_the_elder(torn_elder=False)))
    assert (firm["elder"], firm["proof"], firm["told"]) == (1, True, False)
    torn_ = the_teahouse_with_the_elder(torn_elder=True)
    assert firmness(torn_, "zuzhang", LI_ER) == 87 - RIVAL_DENT
    event = stated(state_it(torn_))
    assert (event["elder"], event["proof"], event["wrong"], event["told"]) == (2, True, [], True)
    assert "elder_accepts" in state_of(torn_)["goals"]["flags"]


# ------------------------------------------------------------------------------ a played game


def test_a_game_played_by_a_bot_with_rivals_is_rebuilt_from_its_record_with_the_same_rivals():
    """The follower plays the slice to the morning of the fifth day, in which the statement of the
    fourth evening has left rivals behind it in the heads of the people who took the truth in. The
    game made again from its record, checking every hash on the way, has them all."""
    from bots import Obs, make
    from lantern_core.api import preset
    from lantern_core.replay import Recorder, rebuild

    config = {"budget_cap": 0, **preset("slice")["config"]}
    game = Game(preset("slice")["seed"], "bridge", config)
    recorder = Recorder(game)
    bot = make("follower", json.loads(game.scene_json()), 492)
    obs = Obs(json.loads(recorder.step("[]")))
    while game.tick < at(5, 7):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(recorder.step(json.dumps(records))))
    held = state_of(game)["social"].get("rivals", {})
    assert len(held) >= 5 and all(1 <= len(notes_) <= RIVALS_MAX for notes_ in held.values())
    again = rebuild(recorder.recording())
    assert again.hash() == game.hash()
    assert state_of(again)["social"]["rivals"] == held
    assert state_of(again)["social"].get("aloud") == state_of(game)["social"].get("aloud")
