"""What the cards say to a manager who does only what the top bar says.

The terms the cards are written in for the steps the first four days leave to the manager: that a
note was passed on to a person, that a first talk was had today, that a statement of evidence would
be a new question for the town, and that a look or a request for a testimony was turned down and
asking again would be the same. And the cards that use them: the first bamboo when Li Da has not
heard that the talk was set straight, the lead on how the bridge broke when the boat owner or the
watchman will not yet, and the statement in public, which is offered only while there is something
new to say.
"""

from __future__ import annotations

from typing import Any

from agenda_helpers import frame_now, idle, meet, slice_game, tasks_of
from bridge_helpers import at, run_to, state_of
from dealings_helpers import believe, trust
from player_helpers import acks, act, me, put, run_on

from lantern_core.api import Game
from lantern_core.world.bridge import agenda, agenda_terms, assembly, clarify, clock, notebook
from lantern_core.world.bridge.data import SCRIPT

LI_DA, OLD_HE, GENGFU = "li_da", "old_he", "gengfu"
BAMBOO, BROKE, TELL = "t_bamboo_first", "t_how_broke", "t_tell_town"


def env_of(game: Game) -> agenda_terms.Env:
    kernel = game._kernel
    return agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(kernel.state["tick"]))


def holds(game: Game, **cond: Any) -> bool:
    return agenda_terms.holds(env_of(game), cond)


def card(game: Game, task_id: str) -> dict[str, Any]:
    return tasks_of(frame_now(game))[task_id]


# ------------------------------------------------------------------------------ the terms


def test_a_note_passed_on_is_in_the_log_of_the_tellings():
    game = slice_game()
    assert not holds(game, kind="passed_on", npc=LI_DA, props=[clarify.CLAIM])
    entry, _ = notebook.add_seen(me(game), clarify.CLAIM, game.tick)
    run_on(game, at(1, 9))
    meet(game, LI_DA)
    assert acks(act(game, "tell", entry=entry["id"], how="faithful")) == [("applied", None)]
    assert holds(game, kind="passed_on", npc=LI_DA, props=[clarify.CLAIM])
    assert not holds(game, kind="passed_on", npc="li_laotai", props=[clarify.CLAIM])
    assert not holds(game, kind="passed_on", npc=LI_DA, props=["pr_liner_at_bridge"])


def test_a_first_talk_is_had_once_a_day_and_the_term_knows_the_day():
    game = slice_game()
    run_on(game, at(1, 9))
    assert not holds(game, kind="talked_today", npc=LI_DA)
    meet(game, LI_DA)
    assert holds(game, kind="talked_today", npc=LI_DA)
    assert not holds(game, kind="talked_today", npc="li_laotai")
    act(game, "leave")
    run_on(game, at(2, 8))
    assert not holds(game, kind="talked_today", npc=LI_DA)  # tomorrow is another day


def test_a_statement_is_worth_making_while_the_town_has_not_heard_what_is_held():
    game = slice_game()
    place = assembly.TEAHOUSE
    assert not holds(game, kind="fresh_proof", venue=place)  # nothing is held
    section = me(game)
    section["evidence"].append("e_xiaoman_testimony")
    assert holds(game, kind="fresh_proof", venue=place)
    section["public"]["seen"][place] = "1|e_xiaoman_testimony|cha_laoban+zuzhang"
    assert not holds(game, kind="fresh_proof", venue=place)  # the same, before the same people
    assert holds(game, kind="fresh_proof", venue=assembly.HALL)  # the hall has not heard it
    section["evidence"].append("e_boat_scratches")
    assert holds(game, kind="fresh_proof", venue=place)  # something the last statement did not show
    section["public"]["seen"][place] = "1|e_boat_scratches+e_xiaoman_testimony|cha_laoban"
    assert not holds(game, kind="fresh_proof", venue=place)
    run_to(game, at(2, 8))
    assert holds(game, kind="fresh_proof", venue=place)  # a day on, the core takes it again
    section["public"]["seen"][place] = "meal|2|cha_laoban"  # a table laid there since
    assert holds(game, kind="fresh_proof", venue=place)


def test_worth_saying_reads_the_signature_the_core_keeps_for_the_same_evidence_and_people():
    game = slice_game()
    state = state_of(game)
    state["player"]["evidence"].extend(["e_he_lamp", "e_footprint"])
    place = assembly.TEAHOUSE
    sign = f"2|{'+'.join(sorted(['e_he_lamp', 'e_footprint']))}|li_da"
    state["player"]["public"]["seen"][place] = sign
    assert assembly.worth_saying(state, place, 2) is False
    assert assembly.worth_saying(state, place, 3) is True


# ------------------------------------------------------------------------------ the first bamboo


def no_objection(game: Game) -> None:
    """Granny Li no longer stands in the way: the event the card reads for it."""
    state_of(game)["agenda"]["seen"].append(
        ["objection_withdrawn", game.tick, {"npc": "li_laotai"}]
    )
    me(game)["nod"]["bamboo"] = game.tick


def ready_for_li_da(game: Game) -> dict[str, Any]:
    """Granny Li has nodded, Li Da trusts the manager, and the manager has the note of the
    clarification in the notebook: all that is missing is that Li Da has not heard of it."""
    no_objection(game)
    trust(game, LI_DA, 40)
    entry, _ = notebook.add_seen(me(game), clarify.CLAIM, game.tick)
    return entry


def test_li_da_who_has_not_heard_that_the_talk_was_set_straight_is_told_by_the_card():
    game = slice_game()
    run_on(game, at(1, 18, 0))
    entry = ready_for_li_da(game)
    idle(game)
    assert card(game, BAMBOO)["action"] == {"verb": "entrust", "npc": LI_DA, "item": "bamboo"}
    meet(game, LI_DA)
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "unaware")]
    idle(game)
    blocked = card(game, BAMBOO)
    assert blocked["state"] == "blocked"
    assert blocked["blocker"] == {
        "zh": "李大还不知道谣言已经说清了",
        "en": "Li Da has not heard that the talk was set straight",
    }
    assert blocked["next"] == {
        "zh": "告诉李大谣言已经说清了，再请李大送竹料。",
        "en": "Tell Li Da the talk was set straight, then ask Li Da for the bamboo.",
    }
    # the card names the note by its entry in the notebook, which the script names by its prop
    assert blocked["action"] == {"verb": "tell", "npc": LI_DA, "item": entry["id"]}
    told = act(game, "tell", entry=blocked["action"]["item"], how="faithful")
    assert acks(told) == [("applied", None)]
    idle(game)
    asked_again = card(game, BAMBOO)
    assert asked_again["state"] == "open"  # told: the same request is asked again
    assert asked_again["action"] == {"verb": "entrust", "npc": LI_DA, "item": "bamboo"}


def test_a_tell_card_has_no_action_while_the_note_is_not_in_the_notebook():
    game = slice_game()
    run_on(game, at(1, 18, 0))
    no_objection(game)
    trust(game, LI_DA, 40)
    meet(game, LI_DA)
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "unaware")]
    idle(game)
    blocked = card(game, BAMBOO)
    assert blocked["state"] == "blocked" and blocked["action"] is None


def test_li_da_who_weighed_the_request_and_said_no_is_given_a_promise_and_asked_again():
    game = slice_game()
    run_on(game, at(1, 18, 0))
    no_objection(game)
    believe(game, LI_DA, clarify.CLAIM, 90, "saw")  # he has heard
    trust(
        game, LI_DA, 9
    )  # and, with the first talk of the day, trusts the manager enough to weigh it
    meet(game, LI_DA)
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    idle(game)
    blocked = card(game, BAMBOO)
    assert blocked["state"] == "blocked"
    assert blocked["blocker"] == {
        "zh": "李大这回不肯送竹料",
        "en": "Li Da will not send the bamboo yet",
    }
    assert blocked["next"]["en"] == "Promise Li Da something, then ask again."
    assert blocked["action"] == {"verb": "promise", "npc": LI_DA}
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "said_already")]
    made = act(game, "promise", op="make", what="stall", item="front", due=3)
    assert acks(made) == [("applied", None)]  # a number of his score moved
    idle(game)
    assert card(game, BAMBOO)["action"] == {"verb": "entrust", "npc": LI_DA, "item": "bamboo"}


# ------------------------------------------------------------------------------ the judging card


def test_the_card_of_the_judgement_is_a_button_for_the_notebook():
    script = {task["id"]: task for task in SCRIPT["tasks"]}
    (option,) = script["t_what_proves"]["action"]
    assert option["verb"] == "judge" and option["npc"] is None and option["place"] is None


def test_every_look_of_the_lead_names_the_place_it_is_done_at():
    options = [
        o for o in {t["id"]: t for t in SCRIPT["tasks"]}[BROKE]["action"] if o["verb"] == "look"
    ]
    assert {(o["item"], o["place"]) for o in options} == {
        ("t_rail", "p_bridge"),
        (None, "p_under_bridge"),
        ("t_he_boat", "p_ferry"),
    }


# ------------------------------------------------------------------------------ the lead


def at_the_ferry(game: Game) -> None:
    put(game, *game._kernel.world.town.places["p_ferry"].rect[:2])


def test_a_look_that_was_turned_away_is_asked_again_after_a_talk_or_a_promise_and_not_before():
    game = slice_game()
    run_on(game, at(2, 13, 0))  # the lead comes in the afternoon of the second day
    me(game)["looked"].extend(["e_footprint", "e_flood_debris"])  # the rail and the water are done
    idle(game)
    assert card(game, BROKE)["action"] == {"verb": "look", "item": "t_he_boat", "place": "p_ferry"}
    at_the_ferry(game)
    assert acks(act(game, "look", at="t_he_boat")) == [("rejected", "refused")]
    idle(game)
    assert holds(game, kind="turned_down", npc=OLD_HE, request="look")
    shut = card(game, BROKE)
    assert shut["action"] == {"verb": "talk", "npc": OLD_HE}
    assert shut["next"]["zh"] == "船主还不让你看船，先去和船主聊几句。"
    # the first talk of the day earns a little trust: the look is a new question
    meet(game, OLD_HE)
    act(game, "leave")
    idle(game)
    assert holds(game, kind="talked_today", npc=OLD_HE)
    assert not holds(game, kind="turned_down", npc=OLD_HE, request="look")
    assert card(game, BROKE)["action"]["verb"] == "look"
    # turned away again (13 is short of 15): talked already today, so the card says to promise
    at_the_ferry(game)
    assert acks(act(game, "look", at="t_he_boat")) == [("rejected", "refused")]
    idle(game)
    assert holds(game, kind="turned_down", npc=OLD_HE, request="look")
    promise = card(game, BROKE)
    assert promise["action"] == {"verb": "promise", "npc": OLD_HE}
    assert promise["next"]["en"] == (
        "The boat's owner will not let you look yet, so promise the owner something and come back."
    )
    meet(game, OLD_HE)
    assert acks(act(game, "promise", op="make", what="stall", item="front", due=3)) == [
        ("applied", None)
    ]
    act(game, "leave")
    idle(game)
    assert not holds(game, kind="turned_down", npc=OLD_HE, request="look")  # a promise moved it
    assert card(game, BROKE)["action"]["verb"] == "look"


def test_a_testimony_that_was_turned_down_is_a_request_that_would_only_be_said_already():
    game = slice_game()
    run_on(game, at(4, 19, 30))  # the watchman speaks from the fourth night
    meet(game, GENGFU)
    assert acks(act(game, "entrust", kind="testify")) == [("rejected", "refused")]
    idle(game)
    assert holds(game, kind="turned_down", npc=GENGFU, request="testify")
    assert acks(act(game, "entrust", kind="testify")) == [("rejected", "said_already")]


def test_the_steps_of_the_lead_have_a_card_for_each_refusal():
    script = {task["id"]: task for task in SCRIPT["tasks"]}
    kinds = [(o["verb"], o["npc"]) for o in script[BROKE]["action"]]
    for person in (OLD_HE, GENGFU, "xiao_man"):
        assert ("talk", person) in kinds and ("promise", person) in kinds
    assert agenda.book().by_id[BROKE] is script[BROKE]
