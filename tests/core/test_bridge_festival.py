"""The festival of the last night as the ending tells it: the block ``festival``.

A page stages the night from what the game really came to: the way the parade goes (``route``),
whether the two families are together, who lights the main lantern, the crowd by district and where
the named people stand. The label of the ending sets only the mood, so a night that is just enough
can have the families side by side (the peace was made, the truth was not told) and one that is not
can have a mended bridge and no peace."""

from __future__ import annotations

import json

import pytest
from goals_helpers import LAST_NIGHT, Hand, body, dev, hand

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import crowd, districts, festival, goals, goals_call, projection
from lantern_core.world.bridge.world import static

TOWN, CAST = static()
LAY = districts.layout(TOWN, CAST)
KEYS = {"route", "together", "lighter", "bearers", "named"}
HEADS = list(goals_call.HEADS)
ELDER = [goals_call.ELDER]


@pytest.fixture(scope="module")
def eve():
    """The snapshot of a quiet game with a clear sky, on the eve of the last night."""
    h = hand(3)
    h.run_to(LAST_NIGHT)
    return h.game.snapshot_json()


def the_last_night(eve, flags=(), mutate=None, *actions):
    """The last night of the game in the snapshot with ``flags`` up, after ``mutate(hand)`` set up
    a case, and the player ``actions`` sent in the call that holds the ending. The hand, the
    outputs and the ending event."""
    h = Hand(Game.from_snapshot_json(eve))
    for name in flags:
        h.goals["flags"][name] = 7
    if mutate is not None:
        mutate(h)
    out = h.send(*actions)
    (event,) = [e for e in out["events"] if e["kind"] == "ending"]
    return h, out, event


# --------------------------------------------------------------------- route, peace, lighter

# (flags raised, the ending, the route, together, who lights the main lantern)
CASES = [
    (("bridge_fixed", "truth_told", "reconciled"), "ending_full", "bridge", True, HEADS),
    # the label says "just enough" and the families are side by side: the peace was made, the
    # truth was not told in public
    (("bridge_fixed", "reconciled"), "ending_barely", "bridge", True, HEADS),
    # the peace was made and only the lane is open
    (("detour_done", "reconciled", "truth_told"), "ending_barely", "lane", True, HEADS),
    # the bridge is mended and the families are not at peace
    (("bridge_fixed", "truth_told"), "ending_barely", "bridge", False, ELDER),
    (("bridge_fixed",), "ending_barely", "bridge", False, ELDER),
    (("detour_done",), "ending_barely", "lane", False, ELDER),
    # the bridge and the lane both: the bridge is the way
    (("bridge_fixed", "detour_done", "reconciled"), "ending_barely", "bridge", True, HEADS),
    # there is no way across: no parade, whatever the families did
    (("reconciled", "truth_told"), "ending_split", "none", True, []),
    ((), "ending_split", "none", False, []),
]


@pytest.mark.parametrize(("flags", "ending", "route", "together", "lighter"), CASES)
def test_the_festival_is_made_of_the_way_across_the_peace_and_who_lights(
    eve, flags, ending, route, together, lighter
):
    h, out, event = the_last_night(eve, flags)
    assert event["ending"] == ending
    block = event["festival"]
    assert set(block) == KEYS
    assert (block["route"], block["together"], block["lighter"]) == (route, together, lighter)
    assert h.goals["ending"]["festival"] == block


def test_the_peace_is_the_flag_of_the_peace_and_not_the_label(eve):
    """Two nights with the same label, a mended bridge, and the families together in one."""
    _, _, apart = the_last_night(eve, ("bridge_fixed",))
    _, _, side_by_side = the_last_night(eve, ("bridge_fixed", "reconciled"))
    assert apart["ending"] == side_by_side["ending"] == "ending_barely"
    assert (apart["festival"]["together"], side_by_side["festival"]["together"]) == (False, True)
    assert apart["festival"]["lighter"] == ELDER and side_by_side["festival"]["lighter"] == HEADS


# ------------------------------------------------------------------------------ the crowd


@pytest.fixture
def keen(monkeypatch):
    """The keen townsfolk by home district as the ending sees them (``festival.bearers`` is
    called in the tick of the ending, before the crowd moves on)."""
    seen: dict[str, int] = {}
    real = festival.bearers

    def spy(world, world_state, turnout):
        section = world_state["crowd"]
        for k, enthusiasm in enumerate(section["enthusiasm"]):
            if enthusiasm >= crowd.KEEN_LINE:
                place = LAY.places[section["home"][k]]
                seen[place] = seen.get(place, 0) + 1
        return real(world, world_state, turnout)

    monkeypatch.setattr(festival, "bearers", spy)
    return seen


def test_the_bearers_are_the_keen_townsfolk_by_home_district_scaled_to_the_turnout(eve, keen):
    _, _, event = the_last_night(eve, ("bridge_fixed",))
    bearers, turnout = event["festival"]["bearers"], event["turnout"]
    assert sum(keen.values()) > 0
    assert sum(bearers.values()) == min(festival.MAX_BEARERS, turnout) == 120 < turnout
    assert set(bearers) <= set(keen)
    assert all(place in LAY.places and LAY.kinds[LAY.index[place]] == "house" for place in bearers)
    # in proportion: a district's share is within one person of its share of the keen
    total = sum(keen.values())
    for place, count in keen.items():
        assert abs(bearers.get(place, 0) - count * 120 / total) < 1, place


def test_a_small_turnout_is_the_sum_and_not_the_cap(eve):
    def few(h: Hand) -> None:
        enthusiasm = h.state["crowd"]["enthusiasm"]
        for k in range(len(enthusiasm)):
            enthusiasm[k] = 100 if k < 3 else 0

    h, _, event = the_last_night(eve, (), few)
    assert event["turnout"] < festival.MAX_BEARERS
    assert sum(event["festival"]["bearers"].values()) == event["turnout"]


def test_the_cap_is_for_the_picture_and_the_real_turnout_stays_in_the_ending(eve):
    def everyone(h: Hand) -> None:
        enthusiasm = h.state["crowd"]["enthusiasm"]
        for k in range(len(enthusiasm)):
            enthusiasm[k] = 100

    _, out, event = the_last_night(eve, ("bridge_fixed",), everyone)
    assert event["turnout"] >= 4_000
    assert sum(event["festival"]["bearers"].values()) == 120
    assert out["frame"]["hud"]["turnout"] == event["turnout"]


def test_with_nobody_keen_the_crowd_is_the_households_that_promised_one_share_each(eve):
    def nobody_keen(h: Hand) -> None:
        enthusiasm = h.state["crowd"]["enthusiasm"]
        for k in range(len(enthusiasm)):
            enthusiasm[k] = 0

    joins = (dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    h, _, event = the_last_night(eve, ("bridge_fixed",), nobody_keen, *joins)
    assert event["promised"] == 2 and h.frame["hud"]["keen"] == 0
    bearers = event["festival"]["bearers"]
    assert set(bearers) == {"p_li_house", "p_teahouse"}
    assert sum(bearers.values()) == event["turnout"] == 8  # four people to a household


def test_with_nobody_keen_and_nobody_promised_there_is_no_crowd(eve):
    def nobody(h: Hand) -> None:
        enthusiasm = h.state["crowd"]["enthusiasm"]
        for k in range(len(enthusiasm)):
            enthusiasm[k] = 0

    _, _, event = the_last_night(eve, ("bridge_fixed",), nobody)
    assert event["turnout"] == 0 and event["festival"]["bearers"] == {}


def test_a_share_is_the_largest_remainder_and_a_tie_goes_to_the_first_place_of_the_map():
    order = ("a", "b", "c", "d")
    assert festival.scale({"a": 1, "b": 1, "c": 1}, 10, order) == {"a": 4, "b": 3, "c": 3}
    assert festival.scale({"c": 1, "b": 1, "a": 1}, 10, order) == {"a": 4, "b": 3, "c": 3}
    assert festival.scale({"a": 5, "b": 3, "d": 2}, 7, order) == {"a": 4, "b": 2, "d": 1}
    assert festival.scale({"a": 3}, 120, order) == {"a": 120}
    assert festival.scale({"a": 1, "b": 0}, 5, order) == {
        "a": 5
    }  # nothing for a place with nothing
    assert festival.scale({}, 5, order) == {} and festival.scale({"a": 1}, 0, order) == {}
    big = {name: weight for name, weight in zip("abcd", (97, 31, 13, 59), strict=True)}
    shared = festival.scale(big, 120, order)
    assert sum(shared.values()) == 120 and list(shared) == sorted(shared)
    assert all(abs(shared[k] - big[k] * 120 / sum(big.values())) < 1 for k in big)


# ------------------------------------------------------------------------------ the named


def test_the_named_are_the_twenty_of_the_cast_with_the_place_each_is_bound_for(eve):
    h, _, event = the_last_night(eve, ("bridge_fixed",))
    named = event["festival"]["named"]
    assert [row["npc"] for row in named] == [person.id for person in CAST.people]
    assert all(set(row) == {"npc", "place"} and row["place"] in TOWN.places for row in named)
    assert [row["place"] for row in named] == [npc["place"] for npc in h.state["npcs"]["list"]]


# ------------------------------------------------------------------------------ the outputs


def test_the_event_the_frames_and_the_game_all_carry_the_same_festival(eve):
    h, out, event = the_last_night(eve, ("bridge_fixed", "reconciled"))
    block = event["festival"]
    assert out["frame"]["ending"]["festival"] == block  # the whole form, in the call that made it
    for _ in range(3):
        frame = h.send()["frame"]
        assert "reveal" not in frame["ending"] and frame["ending"]["festival"] == block  # compact
    assert json.loads(h.game.ending_json())["festival"] == block
    assert goals.ending(h.state)["festival"] == block
    assert goals.ending(h.state, compact=True)["festival"] == block
    assert canon.loads(canon.dumps_str(block)) == block


def test_nothing_that_a_person_believes_changes_the_festival(eve):
    def forget(h: Hand) -> None:
        for held in h.state["social"]["beliefs"].values():
            held.clear()

    _, _, plain = the_last_night(eve, ("bridge_fixed", "reconciled"))
    _, _, forgotten = the_last_night(eve, ("bridge_fixed", "reconciled"), forget)
    assert plain["festival"] == forgotten["festival"]
    assert projection.mark_of("ending.festival") == "known"


def test_the_event_keeps_the_festival_whatever_the_page_does_after(eve):
    h, _, event = the_last_night(eve, ("bridge_fixed",))
    seq = h.game.next_seq
    paused = json.loads(h.game.step(json.dumps([{"seq": seq, "kind": "pause", "body": {}}])))
    assert paused["frame"]["ending"]["festival"] == event["festival"]


# ------------------------------------------------------------------------------ loaded and sought


def test_a_game_loaded_at_its_end_and_a_replay_sought_to_it_give_the_same_festival_and_moments():
    game = Game(
        3, "bridge", {"dev_actions": 1, "weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
    )
    recorder = Recorder(game)

    def send(*bodies: dict) -> dict:
        seq = game.next_seq
        records = [
            {"seq": seq + i, "kind": "player", "body": {"action_id": f"r{seq + i}", **b}}
            for i, b in enumerate(bodies)
        ]
        return json.loads(recorder.step(json.dumps(records)))

    send(body("moment", op="watch"), dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    assert game.paused
    send(body("moment", op="release", kind="both_banks"))
    send(dev("reconcile"), dev("truth"))
    while game.tick < LAST_NIGHT:
        send()
    ending = None
    for _ in range(3):
        out = send()
        ending = ending or next((e for e in out["events"] if e["kind"] == "ending"), None)
    assert ending is not None and ending["festival"]["route"] == "none"
    live = {
        "moments": out["frame"]["moments"],
        "festival": json.loads(game.ending_json())["festival"],
    }
    assert [m["kind"] for m in live["moments"]] == ["both_banks"]

    loaded = Game.from_snapshot_json(game.snapshot_json())
    sought = rebuild(recorder.recording(), seek=True)
    for twin in (loaded, sought):
        frame = json.loads(twin.step("[]"))["frame"]
        assert frame["moments"] == live["moments"] and frame["moment_hold"] == []
        assert json.loads(twin.ending_json())["festival"] == live["festival"] == ending["festival"]
        assert frame["ending"]["festival"] == live["festival"]
