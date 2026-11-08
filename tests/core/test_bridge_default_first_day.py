"""The first days of a game without the opening rumour.

The game the opening page starts has the town talking of Li Er from the first tick, and its first
day is written for that: Granny Li turns the manager down for the talk, and the cards follow the
talk back to the clerk. A game with no opening (the config names none) has no talk to follow, and
asking Granny Li about Li Er gets nothing, so the task of the bamboo would offer a button that does
nothing for the whole game. ``t_see_for_yourself`` takes its place on the top bar until her
objection is gone: it looks into how the bridge broke, as the lead of the next days does, asks the
clerk who was at the bridge that night (the third part of the statement card is then something to
choose in), goes to the night watchman in the afternoon of the fourth day, and tells Granny Li what
was cleared once the manager holds it.
"""

from __future__ import annotations

import json

import pytest
from agenda_helpers import frame_now, idle, meet, slice_game, states, tasks_of
from bridge_helpers import at, bridge, run_to, state_of
from player_helpers import acks, act, me, put

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.world.bridge import notebook
from lantern_core.world.bridge.data import SCRIPT

CARD = "t_see_for_yourself"
SEEDS = (1, 2, 3, 4)


def refused_by_granny_li(game: Game) -> None:
    """The manager asks Granny Li for the bamboo at the Li house, and she says no."""
    meet(game, "li_laotai")
    assert acks(act(game, "entrust", kind="lend", item="bamboo")) == [("rejected", "hard")]
    act(game, "leave")
    idle(game)


def after_the_refusal(seed: int = 1, hour: int = 7) -> Game:
    game = bridge(seed)
    run_to(game, at(1, hour))
    refused_by_granny_li(game)
    return game


CLERK = {"verb": "ask", "npc": "zhou_huoji", "item": "li_er"}


def asked_the_clerk(game: Game) -> None:
    """The manager has asked the clerk what he saw himself: a note of Li Er at the bridge."""
    notebook.add_seen(me(game), "pr_liner_at_bridge", game.tick)
    put(game, 42, 11)  # (the tasks are looked at again when the player's cell is another)
    idle(game)


# ---------------------------------------------------------------------------- when it comes


@pytest.mark.parametrize("seed", SEEDS)
def test_a_game_without_the_opening_starts_with_the_card_of_the_bamboo_alone(seed):
    game = bridge(seed)
    run_to(game, at(1, 9))
    frame = frame_now(game)
    assert states(frame) == {"t_bamboo_first": "open"}
    assert frame["tracked"] == "t_bamboo_first"
    assert tasks_of(frame)["t_bamboo_first"]["action"] == {
        "verb": "entrust",
        "npc": "li_laotai",
        "item": "bamboo",
    }


@pytest.mark.parametrize("seed", SEEDS)
def test_it_comes_when_granny_li_has_turned_the_manager_down_and_is_followed_from_the_morning(seed):
    game = after_the_refusal(seed)
    frame = frame_now(game)
    cards = tasks_of(frame)
    assert states(frame) == {CARD: "open", "t_bamboo_first": "blocked"}
    assert frame["tracked"] == CARD
    card = cards[CARD]
    assert (card["kind"], card["job"]) == ("obstacle", "truth")
    assert card["action"] == {"verb": "look", "item": "t_rail", "place": "p_bridge"}
    assert "bridge" in card["why"]["en"] and "桥" in card["why"]["zh"]
    assert card["window"] is None and card["blocker"] is None


def test_before_seven_it_has_nothing_to_do_and_the_hours_of_daylight_give_it_the_first_look():
    game = bridge(1)
    run_to(game, at(1, 6, 20))
    refused_by_granny_li(game)
    early = frame_now(game)
    assert states(early) == {CARD: "open", "t_bamboo_first": "blocked"}
    # it is on the bar at once, as the one to follow, and until the hour of the first look it has
    # the clerk to ask what he saw
    assert tasks_of(early)[CARD]["action"] == CLERK and early["tracked"] == CARD
    assert tasks_of(early)["t_bamboo_first"]["action"] is None
    run_to(game, at(1, 7, 5))
    later = frame_now(game)
    assert later["tracked"] == CARD
    assert tasks_of(later)[CARD]["action"]["verb"] == "look"


@pytest.mark.parametrize("seed", SEEDS)
def test_the_card_of_the_bamboo_offers_no_button_that_does_nothing_in_such_a_game(seed):
    frame = frame_now(after_the_refusal(seed))
    bamboo = tasks_of(frame)["t_bamboo_first"]
    # it is blocked by her refusal and says so, but asking her of the talk about Li Er gets nothing
    assert bamboo["state"] == "blocked" and bamboo["blocker"]["en"].startswith("Granny Li")
    assert bamboo["action"] is None


def test_a_refusal_that_is_for_the_talk_of_li_er_does_not_bring_it():
    game = slice_game()
    run_to(game, at(1, 7))
    refused_by_granny_li(game)
    frame = frame_now(game)
    assert CARD not in states(frame)
    # there, the card of the bamboo still asks her about the talk
    assert tasks_of(frame)["t_bamboo_first"]["action"]["item"] == "li_er"


def test_it_is_a_task_of_the_script_that_no_game_with_the_opening_asks_for():
    (task,) = [t for t in SCRIPT["tasks"] if t["id"] == CARD]
    appears = json.dumps(task["appears"], sort_keys=True)
    assert "hard_hc_li_bamboo_rumour" in appears  # never for the talk she has voiced
    assert task["priority"] < 10  # it stands before the card of the bamboo on the top bar


# ---------------------------------------------------------------------------- what it says to do


def test_the_leads_of_the_first_day_are_the_rail_and_the_boat_in_the_order_of_the_hours():
    """The water under the bridge and the boy by the river are for the third day (the table of
    opportunities of the script opens them then, and before it a look or a question gets nothing),
    so the first day has the rail and then the boat."""
    game = after_the_refusal(1, 7)
    state = state_of(game)
    asked_the_clerk(game)  # (the clerk has a test of his own, below)
    assert tasks_of(frame_now(game))[CARD]["action"] == {
        "verb": "look",
        "item": "t_rail",
        "place": "p_bridge",
    }
    state["player"]["looked"].append("e_footprint")  # the rail, whatever it showed
    put(game, 40, 10)
    idle(game)
    assert tasks_of(frame_now(game))[CARD]["action"] is None  # the ferry is open from eight
    run_to(game, at(1, 8, 30))
    put(game, 40, 10)
    idle(game)
    assert tasks_of(frame_now(game))[CARD]["action"] == {
        "verb": "look",
        "item": "t_he_boat",
        "place": "p_ferry",
    }
    state["player"]["looked"].append("e_boat_scratches")  # the boat
    put(game, 41, 10)
    idle(game)
    assert tasks_of(frame_now(game))[CARD]["action"] is None  # the water and the boy are for later
    run_to(game, at(1, 17, 40))
    put(game, 40, 10)
    idle(game)
    assert tasks_of(frame_now(game))[CARD]["action"] is None  # the boy speaks from the third day


def test_the_water_by_day_and_the_boy_by_the_river_in_the_evening_are_for_the_third_day():
    game = after_the_refusal(1, 7)
    state = state_of(game)
    asked_the_clerk(game)
    state["player"]["looked"].extend(["e_footprint", "e_boat_scratches"])
    run_to(game, at(3, 7, 30))
    put(game, 40, 10)
    idle(game)
    assert tasks_of(frame_now(game))[CARD]["action"] == {"verb": "look", "place": "p_under_bridge"}
    state["player"]["looked"].append("e_flood_debris")  # the water under the bridge
    put(game, 41, 10)
    idle(game)
    assert tasks_of(frame_now(game))[CARD]["action"] is None  # Xiaoman is asked in the evening
    run_to(game, at(3, 17, 40))
    put(game, 40, 10)
    idle(game)
    card = tasks_of(frame_now(game))[CARD]
    assert card["action"] == {"verb": "entrust", "npc": "xiao_man", "request": "testify"}
    assert "Xiaoman" in card["next"]["en"]


def test_the_clerk_who_was_at_the_bridge_is_asked_until_the_manager_holds_a_note_of_what_he_saw():
    """Nothing of the talk about Li Er has reached the manager, so the part of the statement card
    that says where it came from has nothing to choose in until the one who started it is asked."""
    game = after_the_refusal(1, 7)
    state_of(game)["player"]["looked"].append("e_footprint")
    run_to(game, at(1, 9))
    put(game, 40, 10)
    idle(game)
    card = tasks_of(frame_now(game))[CARD]
    assert card["action"] == CLERK
    assert "Zhou's Clerk" in card["next"]["en"] and "周家伙计" in card["next"]["zh"]
    asked_the_clerk(game)
    assert tasks_of(frame_now(game))[CARD]["action"] != CLERK  # the boat is the next to look at
    assert tasks_of(frame_now(game))[CARD]["action"]["item"] == "t_he_boat"


def test_the_night_watchman_is_the_last_to_ask_and_speaks_from_the_afternoon_of_the_fourth_day():
    game = after_the_refusal(1, 7)
    state = state_of(game)
    asked_the_clerk(game)
    state["player"]["looked"].extend(["e_footprint", "e_boat_scratches", "e_flood_debris"])
    run_to(game, at(4, 14))
    put(game, 40, 10)
    idle(game)
    card = tasks_of(frame_now(game))[CARD]
    assert card["action"] is None and "afternoon" in card["next"]["en"]  # not before three
    run_to(game, at(4, 15, 20))
    put(game, 40, 10)
    idle(game)
    card = tasks_of(frame_now(game))[CARD]
    assert card["action"] == {"verb": "entrust", "npc": "gengfu", "request": "testify"}
    assert "watch post" in card["next"]["en"]


def test_the_footprint_is_left_alone_from_the_third_day():
    game = after_the_refusal(1, 7)
    state_of(game)["player"]["looked"].append("e_flood_debris")
    run_to(game, at(3, 7, 30))
    idle(game)
    frame = frame_now(game)
    assert tasks_of(frame)[CARD]["action"] is None or (
        tasks_of(frame)[CARD]["action"].get("item") != "t_rail"
    )


# ---------------------------------------------------------------------------- when it ends


def note_of_the_clearing(game: Game) -> str:
    """The note a statement in public that clears the rumour leaves in the notebook of the manager,
    as the evidence shown in the hall or at the teahouse leaves it (``clarify.seen_cleared``)."""
    notebook.add_seen(me(game), "pr_set_straight", game.tick)
    put(game, 40, 10)
    idle(game)
    return next(e["id"] for e in me(game)["notebook"] if e["prop"] == "pr_set_straight")


def test_once_the_manager_holds_the_note_of_what_was_cleared_the_card_has_them_tell_granny_li():
    game = after_the_refusal(1, 10)
    entry = note_of_the_clearing(game)
    card = tasks_of(frame_now(game))[CARD]
    assert card["action"] == {"verb": "tell", "npc": "li_laotai", "item": entry}
    assert "cleared" in card["why"]["en"] and "tell" in card["next"]["en"].lower()
    meet(game, "li_laotai")
    assert acks(act(game, "tell", entry=entry, how="faithful")) == [("applied", None)]
    act(game, "leave")
    idle(game)
    # she has been told, so the card has them ask her again, and then she no longer objects
    assert tasks_of(frame_now(game))[CARD]["action"] == {
        "verb": "entrust",
        "npc": "li_laotai",
        "request": "lend",
    }
    run_to(game, game.tick + 30)
    frame = frame_now(game)
    assert states(frame)[CARD] == "done"
    assert states(frame)["t_bamboo_first"] == "open"
    assert tasks_of(frame)["t_bamboo_first"]["action"]["npc"] == "li_da"  # the bamboo goes on
    assert frame["tracked"] == "t_bamboo_first"


def test_her_other_way_to_the_bamboo_ends_the_card_too():
    game = after_the_refusal(1, 10)
    meet(game, "li_laotai")
    spent = set()
    for _ in range(8):
        out = act(game, "entrust", kind="lend", item="bamboo")
        if acks(out) == [("applied", None)]:
            break
        offers = {o["id"]: o for o in out["frame"]["player"]["offers"]["promise"]}
        wanted = next(
            o for o in ("role:t_honor_light", "stall:front", "role:lead_lanterns") if o not in spent
        )
        spent.add(wanted)
        made = act(game, "promise", **offers[wanted]["body"])
        pledge = next(e["pledge"] for e in made["events"] if e["kind"] == "pledged")
        act(game, "promise", op="keep", id=pledge)
    else:
        pytest.fail("Granny Li never agreed to lend")
    act(game, "leave")
    idle(game)
    assert states(frame_now(game))[CARD] == "done"


def test_it_goes_stale_on_the_morning_of_the_last_day_with_the_bamboo_still_to_get():
    game = after_the_refusal(1, 7)
    state_of(game)["player"]["looked"].extend(["e_footprint", "e_flood_debris", "e_boat_scratches"])
    run_to(game, at(5, 6, 10))
    idle(game)
    assert states(frame_now(game))[CARD] == "stale"


# ---------------------------------------------------------------------------- what it may read


def default_morning(variant: str | None = None) -> Game:
    """A game with no opening, the refusal behind it, and the leads of the morning done."""
    game = bridge(2, **({} if variant is None else {"variant": variant}))  # type: ignore[arg-type]
    run_to(game, at(1, 7, 5))
    refused_by_granny_li(game)
    state_of(game)["player"]["looked"].extend(["e_footprint", "e_flood_debris"])
    put(game, 40, 10)
    idle(game)
    return game


def what_the_player_is_told(frame: dict) -> dict:
    return {key: frame[key] for key in ("tasks", "tracked", "cards", "board")}


def hidden_changes():
    def variant(to):
        return lambda s: s["social"].update(variant=to)

    def forget(person):
        return lambda s: s["social"]["beliefs"][person].clear()

    def trust(s):
        s["player"]["trust"] = [90 - n for n in range(len(s["player"]["trust"]))]

    def bonds(s):
        for person in s["social"]["bonds"]:
            s["social"]["bonds"][person] = [0] * len(s["social"]["bonds"][person])

    def street(s):
        s["crowd"]["enthusiasm"] = [0] * len(s["crowd"]["enthusiasm"])

    return {
        "the truth is the flood": variant("v_flood"),
        "the truth is the elder brother": variant("v_drunk"),
        "granny li remembers nothing": forget("li_laotai"),
        "the boatman remembers nothing": forget("old_he"),
        "nobody trusts the manager": trust,
        "nobody is fond of anyone": bonds,
        "the street is cold": street,
    }


@pytest.mark.parametrize("name", list(hidden_changes()))
def test_changing_what_is_hidden_changes_nothing_the_card_says(name):
    snapshot = default_morning().snapshot_json()
    base = what_the_player_is_told(frame_now(Game.from_snapshot_json(snapshot)))
    assert CARD in {t["id"] for t in base["tasks"]}
    twin = Game.from_snapshot_json(snapshot)
    before = canon.digest(state_of(twin))
    hidden_changes()[name](state_of(twin))
    assert canon.digest(state_of(twin)) != before
    assert what_the_player_is_told(frame_now(twin)) == base


@pytest.mark.parametrize("variant", ["v_boat", "v_flood", "v_drunk"])
def test_the_card_says_the_same_whichever_story_is_true(variant):
    said = []
    for story in ("v_boat", variant):
        game = default_morning(story)
        run_to(game, at(1, 17, 40))
        put(game, 40, 10)
        idle(game)
        said.append(what_the_player_is_told(frame_now(game)))
    assert said[0] == said[1]
    assert CARD in {t["id"] for t in said[0]["tasks"]}
