"""Why an act of the manager is not available: ``hud.verbs_off``, one reason for each act that
``hud.verbs`` does not list, from a closed list."""

from __future__ import annotations

import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import CAST, CLEAR, at, bridge, run_to, state_of
from player_helpers import acks, act, beside, me, put, silence

from lantern_core.world.bridge import assembly, gossip, player, unavailable
from lantern_core.world.bridge.town import Town  # noqa: F401  (the places of the town)


def hud_of(game):
    return frame_now(game)["hud"]


def off_of(game):
    return hud_of(game)["verbs_off"]


def place(game, name):
    return game._kernel.world.town.places[name]


def stand_at(game, name):
    put(game, *place(game, name).rect[:2])


# ------------------------------------------------------------------------------ the whole list


@pytest.mark.parametrize("moment", ["start", "talk", "morning_after", "night"])
def test_every_act_is_on_the_list_or_off_it_with_a_reason_of_the_closed_list(moment):
    game = slice_game()
    if moment == "talk":
        run_to(game, at(1, 9))
        meet(game, "li_da")
    elif moment == "morning_after":
        run_to(game, at(2, 8))
    elif moment == "night":
        run_to(game, at(1, 22))
    hud = hud_of(game)
    on, off = set(hud["verbs"]), set(hud["verbs_off"])
    assert on | off == set(player.VERB_ORDER) and not on & off
    assert set(hud["verbs_off"].values()) <= set(unavailable.REASONS)
    assert "gift" in player.VERB_ORDER and len(set(unavailable.REASONS)) == 9


# ------------------------------------------------------------------------------ talking and busy


def test_in_a_talk_the_acts_that_need_the_manager_free_are_off_for_talking():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    off = off_of(game)
    for verb in ("move", "talk", "look", "listen", "speak", "speak_publicly", "rally"):
        assert off[verb] == "talking", verb
    for verb in ("leave", "ask", "tell", "entrust", "promise", "gift"):
        assert verb not in off, verb


def test_while_the_manager_looks_at_something_the_acts_that_need_them_free_are_off_for_busy():
    game = slice_game()
    run_to(game, at(1, 8))
    stand_at(game, "p_bridge")
    assert acks(act(game, "look", at="t_rail")) == [("applied", None)]
    off = off_of(game)
    assert me(game)["busy"]
    for verb in ("move", "talk", "look", "listen", "speak", "rally"):
        assert off[verb] == "busy", verb


# ------------------------------------------------------------------------------ not in a talk


def test_outside_a_talk_what_is_a_part_of_one_is_off_for_not_talking():
    game = slice_game()
    off = off_of(game)
    for verb in ("leave", "ask", "ask_source", "askSource", "tell", "entrust", "promise", "gift"):
        assert off[verb] == "not_talking", verb


# ------------------------------------------------------------------------------ far


def test_with_nobody_near_there_is_nobody_to_talk_to_and_the_cell_is_off_for_far():
    game = slice_game()
    put(game, 0, 0)
    off = off_of(game)
    assert off["talk"] == "far" and off["look"] == "far" and off["listen"] == "far"
    assert off["speak"] == "far" and off["speak_publicly"] == "far"


def test_the_acts_that_are_on_where_somebody_stands_are_not_on_the_list_of_the_off():
    game = slice_game()
    run_to(game, at(1, 9))
    beside(game, "li_da")
    silence(game)
    assert "talk" in hud_of(game)["verbs"] and "talk" not in off_of(game)


# ------------------------------------------------------------------------------ night


def test_a_person_who_is_asleep_leaves_the_talk_off_for_night():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 23))
    state = state_of(game)
    sleeper = next(
        npc["id"] for npc in state["npcs"]["list"] if gossip.asleep(npc) and npc["id"] != "player"
    )
    beside(game, sleeper)
    silence(game)
    others = [
        npc for npc in state["npcs"]["list"] if player.distance(me(game), npc) <= player.TALK_RANGE
    ]
    if all(gossip.asleep(npc) for npc in others):
        assert off_of(game)["talk"] == "night"
    else:
        assert off_of(game)["talk"] in ("night", "not_yet")


def test_after_the_evening_at_the_teahouse_speaking_in_public_is_off_for_night():
    game = slice_game()
    run_to(game, at(1, 22))
    stand_at(game, "p_teahouse")
    assert off_of(game)["speak"] == "night"
    assert off_of(game)["speak_publicly"] == "night"


# ------------------------------------------------------------------------------ not yet


def test_before_the_evening_the_teahouse_is_not_yet_a_place_to_speak():
    game = slice_game()
    run_to(game, at(1, 10))
    stand_at(game, "p_teahouse")
    assert off_of(game)["speak"] == "not_yet"
    run_to(game, at(1, assembly.EVENING[0]))
    assert "speak" in hud_of(game)["verbs"] and "speak" not in off_of(game)


def test_the_hall_is_not_yet_a_place_to_speak_until_the_clan_is_called():
    game = slice_game()
    run_to(game, at(1, 10))
    stand_at(game, "p_clan_hall")
    assert off_of(game)["speak"] == "not_yet"


def test_two_notes_are_needed_to_judge_or_to_ask_for_a_hint_and_a_trail_to_ask_who_told():
    game = slice_game()
    assert off_of(game)["judge"] == "not_yet" and off_of(game)["hint"] == "not_yet"
    run_to(game, at(1, 9))
    meet(game, "cha_laoban")
    assert off_of(game)["ask_source"] == "not_yet"
    act(game, "ask", topic="li_er")
    act(game, "ask", topic="t_rail")
    hud = hud_of(game)
    assert "judge" in hud["verbs"] and "ask_source" in hud["verbs"]
    assert "judge" not in hud["verbs_off"] and "ask_source" not in hud["verbs_off"]


def test_a_person_who_is_busy_with_an_errand_leaves_the_talk_off_for_not_yet():
    game = slice_game()
    run_to(game, at(1, 9))
    state = state_of(game)
    index = CAST.index["li_da"]
    state["social"]["busy"][index] = game.tick + 1000  # telling a neighbour something
    beside(game, "li_da")
    silence(game)
    state["social"]["busy"][index] = game.tick + 1000
    near = [
        npc for npc in state["npcs"]["list"] if player.distance(me(game), npc) <= player.TALK_RANGE
    ]
    if len(near) == 1:
        assert off_of(game)["talk"] == "not_yet"


# ------------------------------------------------------------------------------ done


def test_the_call_for_helpers_is_done_once_it_is_made():
    game = slice_game()
    assert "rally" in hud_of(game)["verbs"]
    assert acks(act(game, "rally")) == [("applied", None)]
    assert off_of(game)["rally"] == "done" and "rally" not in hud_of(game)["verbs"]


def test_following_another_task_is_done_when_there_is_no_other_task():
    world = slice_game()._kernel.world
    state = state_of(slice_game())
    assert unavailable.reason_for("track", world, state, 0, []) == "done"


# ------------------------------------------------------------------------------ the gift


def test_the_gift_is_off_for_the_gift_of_the_day_and_for_two_gifts_to_a_person():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    assert "gift" in hud_of(game)["verbs"]
    act(game, "gift", item="tea")
    assert off_of(game)["gift"] == "gift_today"
    me(game)["gifted"] = [[0, "li_da", "tea", "like", 0], [0, "li_da", "wine", "like", 0]]
    assert off_of(game)["gift"] == "gift_full"


def test_the_aliases_of_a_verb_have_the_reason_of_the_verb():
    game = slice_game()
    off = off_of(game)
    assert off["ask_source"] == off["askSource"] and off["speak"] == off["speak_publicly"]
