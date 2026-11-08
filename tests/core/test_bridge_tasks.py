"""Errands in the bridge world: the planner, the runner, and the hook other subsystems call."""

import json

import pytest
from bridge_helpers import (
    CAST,
    CLEAR,
    assign_body,
    at,
    bridge,
    near,
    npc_of,
    player,
    run_to,
    seed_with_weather,
    stand,
    state_of,
    step,
    world_of,
)

from lantern_core.api import Game, InputError
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import clock, goap, tasks

DT = clock.DAY_TICKS_PER_HOUR


def post(game, **spec):
    """Queue an errand through the hook; the id of the task."""
    return tasks.assign(world_of(game), state_of(game), spec)


def run_collecting(game, tick):
    """Run to ``tick``; the events of the way, as (tick, kind, fields)."""
    events = []
    run_to(
        game,
        tick,
        lambda out: events.extend(
            (e["tick"], e["kind"], {k: v for k, v in e.items() if k not in ("tick", "kind")})
            for e in out["events"]
            if e["kind"].startswith("task_") or e["kind"] in ("taken", "delivered")
        ),
    )
    return events


def finished(game, task_id):
    return next(t for t in state_of(game)["tasks"]["done"] if t["id"] == task_id)


# ------------------------------------------------------------------------------ the planner


def goal(kind, **fields):
    return {"kind": kind, **fields}


def test_the_planner_finds_the_shortest_list_of_steps_for_every_kind_of_goal():
    assert goap.plan(goal("goto", place="B")) == [["goto", "B", "", 0]]
    assert goap.plan(goal("fetch", place="A", item="bamboo", qty=3)) == [
        ["goto", "A", "", 0],
        ["take", "A", "bamboo", 3],
    ]
    assert goap.plan(goal("deliver", place="B"), holding="bamboo") == [
        ["goto", "B", "", 0],
        ["drop", "B", "", 0],
    ]
    assert goap.plan(goal("carry", item="bamboo", qty=3, src="A", dst="B")) == [
        ["goto", "A", "", 0],
        ["take", "A", "bamboo", 3],
        ["goto", "B", "", 0],
        ["drop", "B", "bamboo", 0],
    ]
    assert goap.plan(goal("work", place="A", ticks=240)) == [
        ["goto", "A", "", 0],
        ["work", "A", "", 240],
    ]


def test_carrying_from_a_place_to_itself_needs_one_walk_not_two():
    plan = goap.plan(goal("carry", item="tools", qty=1, src="A", dst="A"))
    assert [step[0] for step in plan] == ["goto", "take", "drop"]


def test_a_goal_the_hands_rule_out_has_no_plan():
    for bad, holding in (
        (goal("deliver", place="B"), ""),  # nothing to put down
        (goal("fetch", place="A", item="bamboo", qty=1), "timber"),  # the hands are full
        (goal("carry", item="bamboo", qty=1, src="A", dst="B"), "timber"),
    ):
        with pytest.raises(goap.PlanError):
            goap.plan(bad, holding)
    with pytest.raises(goap.PlanError):
        goap.plan(goal("sing"))


def test_what_is_already_held_needs_no_steps():
    assert goap.plan(goal("fetch", place="A", item="bamboo", qty=1), "bamboo") == []


def test_a_plan_is_made_of_plain_data_and_the_same_every_time():
    spec = goal("carry", item="bamboo", qty=3, src="A", dst="B")
    first, second = goap.plan(spec), goap.plan(spec)
    assert first == second and first is not second
    assert json.loads(json.dumps(first)) == first


# ------------------------------------------------------------------------------ the runner


def test_the_stock_starts_from_the_holdings_of_the_cast():
    stock = state_of(bridge(1))["tasks"]["stock"]
    assert stock == {
        "p_li_house": {"bamboo": 30},
        "p_zhou_house": {"timber": 24},
        "p_workshop": {"tools": 3},
    }


def test_carrying_bamboo_to_the_bridge_moves_it_there_and_the_carrier_is_seen_with_the_load():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 7))
    task = post(
        game, npc="li_da", kind="carry", item="bamboo", qty=10, src="p_li_house", dst="p_bridge"
    )
    seen = set()
    events = []

    def watch(out):
        row = next(n for n in out["frame"]["npcs"] if n["id"] == "li_da")
        seen.add((row["activity"], row["carrying"], row.get("status")))
        events.extend(
            e
            for e in out["events"]
            if e["kind"] in ("task_start", "taken", "delivered", "task_done")
        )

    run_to(game, at(1, 10), watch)
    stock = state_of(game)["tasks"]["stock"]
    assert stock["p_li_house"]["bamboo"] == 20 and stock["p_bridge"] == {"bamboo": 10}
    assert [e["kind"] for e in events] == ["task_start", "taken", "delivered", "task_done"]
    assert [e["task"] for e in events] == [task] * 4
    taken, delivered = events[1], events[2]
    assert (taken["item"], taken["qty"], taken["place"]) == ("bamboo", 10, "p_li_house")
    assert (delivered["item"], delivered["qty"], delivered["place"]) == ("bamboo", 10, "p_bridge")
    assert delivered["tick"] > taken["tick"] + 20  # it was carried across the town
    assert ("carry", "bamboo", "load") in seen
    assert ("carry", None, None) not in seen
    li_da = npc_of(game, "li_da")
    assert li_da["carry"] is None and li_da["qty"] == 0
    assert state_of(game)["tasks"]["queue"] == []
    done = finished(game, task)
    assert (done["status"], done["reason"]) == ("done", "") and done["ended"] > done["started"] > 0


def test_fetching_leaves_the_item_in_the_hands_and_delivering_puts_it_down_somewhere_else():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 7))
    fetch = post(game, npc="zhou_huoji", kind="fetch", item="timber", place="p_zhou_house", qty=4)
    deliver = post(game, npc="zhou_huoji", kind="deliver", place="p_market")
    run_to(game, at(1, 8))
    huoji = npc_of(game, "zhou_huoji")
    assert finished(game, fetch)["status"] == "done"
    assert state_of(game)["tasks"]["stock"]["p_zhou_house"]["timber"] == 20
    run_to(game, at(1, 12))
    assert finished(game, deliver)["status"] == "done" and huoji["carry"] is None
    assert state_of(game)["tasks"]["stock"]["p_market"] == {"timber": 4}


def test_a_task_queued_behind_others_is_planned_for_the_hands_they_leave():
    game = bridge(3, **CLEAR)
    post(game, npc="li_da", kind="fetch", item="bamboo", place="p_li_house", qty=2)
    with pytest.raises(tasks.TaskError, match="no_plan"):  # the hands will be full of bamboo
        post(game, npc="li_da", kind="fetch", item="timber", place="p_zhou_house", qty=2)
    assert post(game, npc="li_da", kind="deliver", place="p_bridge") == 2
    with pytest.raises(tasks.TaskError, match="no_plan"):  # and now they will be empty
        post(game, npc="li_da", kind="deliver", place="p_bridge")
    assert post(game, npc="li_da", kind="fetch", item="bamboo", place="p_li_house", qty=1) == 3
    assert [t["id"] for t in tasks.open_tasks(state_of(game), "li_da")] == [1, 2, 3]
    assert tasks.open_tasks(state_of(game), "zhou_huoji") == []


def test_work_counts_the_ticks_spent_at_the_place_and_ends_when_the_hours_are_done():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 8))
    post(game, npc="mujiang", kind="work", place="p_bridge", hours=2)
    events = run_collecting(game, at(1, 16))
    kinds = [(t, k) for t, k, _ in events]
    assert [k for _, k in kinds] == ["task_start", "task_done"]
    assert state_of(game)["tasks"]["worked"] == {"p_bridge": 2 * DT}
    assert kinds[1][0] - kinds[0][0] >= 2 * DT
    done = state_of(game)["tasks"]["done"][0]
    assert done["progress"] == 2 * DT and done["status"] == "done"
    run_to(game, at(1, 9))  # while it is going on the carpenter is seen at work on the bridge


def test_the_carpenter_is_seen_at_work_on_the_bridge_while_the_hours_pass():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 8))
    post(game, npc="mujiang", kind="work", place="p_bridge", hours=3)
    run_to(game, at(1, 8) + 200)
    out = step(game)
    row = next(n for n in out["frame"]["npcs"] if n["id"] == "mujiang")
    assert row["activity"] == "work" and "status" not in row
    carpenter = npc_of(game, "mujiang")
    assert (carpenter["mode"], carpenter["place"]) == ("task", "p_bridge")
    assert near(carpenter, stand("mujiang", "p_bridge"))


def test_tasks_of_one_person_run_in_the_order_they_were_assigned_and_those_of_two_run_together():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 7))
    first = post(
        game, npc="li_da", kind="carry", item="bamboo", qty=5, src="p_li_house", dst="p_bridge"
    )
    second = post(game, npc="li_da", kind="work", place="p_bridge", hours=1)
    other = post(game, npc="zhadeng_shifu", kind="work", place="p_workshop", hours=1)
    events = run_collecting(game, at(1, 14))
    starts = {f["task"]: t for t, k, f in events if k == "task_start"}
    ends = {f["task"]: t for t, k, f in events if k == "task_done"}
    assert set(starts) == set(ends) == {first, second, other}
    assert starts[second] >= ends[first]  # the second waits for the first
    assert starts[other] < ends[first]  # the other person's errand does not
    assert state_of(game)["tasks"]["worked"] == {"p_bridge": DT, "p_workshop": DT}


def test_a_task_posted_at_night_starts_in_the_morning():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 23))
    post(game, npc="zhadeng_shifu", kind="work", place="p_workshop", hours=1)
    events = run_collecting(game, at(2, 12))
    assert [k for _, k, _ in events] == ["task_start", "task_done"]
    assert events[0][0] >= at(2, 6)


def test_a_task_the_stock_cannot_serve_fails_and_says_why():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 7))
    task = post(game, npc="li_er", kind="fetch", item="bamboo", place="p_li_house", qty=500)
    events = run_collecting(game, at(1, 10))
    assert [(k, f.get("reason")) for _, k, f in events] == [
        ("task_start", None),
        ("task_fail", "no_stock"),
    ]
    done = finished(game, task)
    assert (done["status"], done["reason"]) == ("failed", "no_stock")
    assert state_of(game)["tasks"]["stock"]["p_li_house"]["bamboo"] == 30
    assert npc_of(game, "li_er")["carry"] is None


def test_hands_that_are_full_when_the_take_comes_fail_the_task():
    game = bridge(3, **CLEAR)
    run_to(game, at(1, 7))
    task = post(game, npc="li_da", kind="fetch", item="bamboo", place="p_li_house", qty=1)
    npc_of(game, "li_da")["carry"] = "timber"  # something put in his hands since the plan was made
    npc_of(game, "li_da")["qty"] = 1
    events = run_collecting(game, at(1, 9))
    assert [(k, f.get("reason")) for _, k, f in events] == [
        ("task_start", None),
        ("task_fail", "hands_full"),
    ]
    assert finished(game, task)["reason"] == "hands_full"
    assert state_of(game)["tasks"]["stock"]["p_li_house"]["bamboo"] == 30


@pytest.mark.parametrize(
    "spec, code",
    [
        ({"npc": "nobody", "kind": "goto", "place": "p_bridge"}, "bad_npc"),
        ({"kind": "goto", "place": "p_bridge"}, "bad_npc"),
        ({"npc": "li_da", "kind": "dance"}, "bad_kind"),
        ({"npc": "li_da", "kind": "goto"}, "missing"),
        ({"npc": "li_da", "kind": "work", "place": "p_bridge"}, "missing"),
        ({"npc": "li_da", "kind": "goto", "place": "p_nowhere"}, "bad_place"),
        ({"npc": "li_da", "kind": "goto", "place": "p_under_bridge"}, "bad_place"),  # water
        (
            {"npc": "li_da", "kind": "fetch", "item": "gold", "place": "p_bridge", "qty": 1},
            "bad_item",
        ),
        (
            {"npc": "li_da", "kind": "fetch", "item": "bamboo", "place": "p_bridge", "qty": 0},
            "bad_qty",
        ),
        (
            {"npc": "li_da", "kind": "fetch", "item": "bamboo", "place": "p_bridge", "qty": 1.5},
            "bad_qty",
        ),
        ({"npc": "li_da", "kind": "work", "place": "p_bridge", "hours": 25}, "bad_hours"),
        ({"npc": "li_da", "kind": "deliver", "place": "p_bridge"}, "no_plan"),  # empty hands
    ],
)
def test_a_bad_request_is_refused_and_queues_nothing(spec, code):
    game = bridge(3)
    with pytest.raises(tasks.TaskError, match=code):
        tasks.assign(world_of(game), state_of(game), spec)
    assert state_of(game)["tasks"]["queue"] == [] and state_of(game)["tasks"]["next_id"] == 1


def test_a_heavy_rain_keeps_an_errand_in_the_open_waiting_for_a_better_day():
    game = bridge(seed_with_weather(["heavy_rain", "clear"]))
    run_to(game, at(1, 8))
    post(game, npc="mujiang", kind="work", place="p_bridge", hours=1)
    run_to(game, at(1, 14))
    assert npc_of(game, "mujiang")["mode"] == "shelter"
    assert state_of(game)["tasks"]["queue"][0]["progress"] == 0
    run_to(game, at(2, 14))
    assert state_of(game)["tasks"]["worked"] == {"p_bridge": DT}


def test_an_errand_indoors_goes_on_in_a_heavy_rain():
    game = bridge(seed_with_weather(["heavy_rain", "clear"]))
    run_to(game, at(1, 8))
    post(game, npc="mujiang", kind="work", place="p_workshop", hours=1)
    run_to(game, at(1, 14))
    assert state_of(game)["tasks"]["worked"] == {"p_workshop": DT}


# ------------------------------------------------------------------------------ the player action


def test_the_assign_action_exists_only_when_the_config_turns_it_on():
    body = assign_body("a1", "li_da", kind="work", place="p_bridge", hours=1)
    with pytest.raises(InputError, match="unknown type"):
        step(bridge(1), player(0, body))
    game = bridge(1, dev_actions=1)
    out = step(game, player(0, body))
    ack = next(e for e in out["events"] if e["kind"] == "action_ack")
    assert (ack["result"], ack["reason"]) == ("applied", None)
    assert state_of(game)["tasks"]["queue"][0]["npc"] == "li_da"


def test_a_resent_action_acts_once_and_a_task_the_hands_rule_out_is_rejected_with_the_reason():
    game = bridge(1, dev_actions=1)
    body = assign_body("a1", "li_da", kind="work", place="p_bridge", hours=1)
    step(game, player(0, body))
    out = step(game, player(1, body))
    assert [e["result"] for e in out["events"] if e["kind"] == "action_ack"] == ["duplicate"]
    assert len(state_of(game)["tasks"]["queue"]) == 1
    bad = assign_body("a2", "li_da", kind="deliver", place="p_bridge")
    out = step(game, player(2, bad))
    ack = next(e for e in out["events"] if e["kind"] == "action_ack")
    assert (ack["result"], ack["reason"]) == ("rejected", "no_plan")
    assert len(state_of(game)["tasks"]["queue"]) == 1


@pytest.mark.parametrize(
    "body",
    [
        {
            "action_id": "x",
            "type": "assign",
            "npc": "nobody",
            "task": {"kind": "goto", "place": "p_bridge"},
        },
        {"action_id": "x", "type": "assign", "npc": "li_da"},
        {"action_id": "x", "type": "assign", "npc": "li_da", "task": {"kind": "dance"}},
        {"action_id": "x", "type": "assign", "npc": "li_da", "task": {"kind": "goto"}},
        {
            "action_id": "x",
            "type": "assign",
            "npc": "li_da",
            "task": {"kind": "work", "place": "p", "hours": 0},
        },
        {
            "action_id": "x",
            "type": "assign",
            "npc": "li_da",
            "task": {"kind": "work", "place": "p", "hours": "2"},
        },
        {"action_id": "x", "type": "teleport", "npc": "li_da"},
    ],
)
def test_a_malformed_assign_body_is_an_input_error(body):
    game = bridge(1, dev_actions=1)
    with pytest.raises(InputError):
        step(game, player(0, body))
    assert game.tick == 0 and game.next_seq == 0  # a refused list changes nothing


def test_a_game_with_errands_replays_exactly_from_its_recording():
    game = Game(4, "bridge", {"dev_actions": 1})
    recorder = Recorder(game)
    steps = {
        50: assign_body(
            "r1", "li_da", kind="carry", item="bamboo", qty=6, src="p_li_house", dst="p_bridge"
        ),
        400: assign_body("r2", "mujiang", kind="work", place="p_bridge", hours=1),
        900: assign_body(
            "r3",
            "zhou_zhanggui",
            kind="carry",
            item="timber",
            qty=4,
            src="p_zhou_house",
            dst="p_market",
        ),
    }
    seq = 0
    hashes = {}
    while game.tick < 3000:
        tick = game.tick
        body = steps.get(tick)
        records = [] if body is None else [player(seq, body)]
        seq += len(records)
        recorder.step(json.dumps(records))
        hashes[tick] = game.hash()
    replayed = {}
    rebuild(recorder.recording(), on_step=lambda g, tick, out: replayed.__setitem__(tick, g.hash()))
    assert replayed == hashes
    assert CAST.index["li_da"] == 1  # the errand ids above name people of the cast
