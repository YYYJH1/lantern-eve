"""The peace by deeds: what lowers the grudge between the heads of the two families, and what the
board and the card say of it.

The goal needs the grudge under thirty and a reconciliation that someone saw. The grudge falls by
deeds the town can see (``peace``): a head who stops accusing in public once a clarification is
taken in (or the truth is told), helpers of both families at work at the bridge the same morning,
and a table for both heads with witnesses. No one of them makes the peace, and a meal by itself
least of all."""

from __future__ import annotations

import json

import pytest
from agenda_helpers import frame_now, idle, slice_game
from bridge_helpers import (
    CLEAR,
    HEAVY,
    TOWN,
    assign_body,
    at,
    bridge,
    player,
    run_to,
    state_of,
    step,
)
from player_helpers import acks, act, events, put

import check_content as cc
from bots.base import Obs
from lantern_core.api import Game
from lantern_core.world.bridge import assembly, bonds, goals_call, peace
from lantern_core.world.bridge.board import ACTS
from lantern_core.world.bridge.lore import lore

LO = lore()
LI, ZHOU = goals_call.HEADS
LI_HELPERS = ("li_er", "li_xiaomei", "li_da")
ZHOU_HELPERS = ("zhou_erlang", "zhou_huoji", "zhou_niangzi")


def grudge_of(game: Game) -> tuple[int, int]:
    """What each head holds against the other, the Li head first."""
    social = state_of(game)["social"]
    return bonds.value(social, LO, LI, ZHOU, bonds.GRUDGE), bonds.value(
        social, LO, ZHOU, LI, bonds.GRUDGE
    )


def board_of(game: Game) -> dict:
    return frame_now(game)["board"]


# ---------------------------------------------------------------------------- the acts of the board


def test_the_board_lists_the_three_deeds_in_the_order_a_player_does_them():
    game = slice_game()
    idle(game)
    acts = board_of(game)["peace"]["acts"]
    assert [a["id"] for a in acts] == [peace.STOP, peace.WORK, peace.MEAL]
    assert [a["id"] for a in acts] == ["stop_blaming", "work_together", "witnessed_meal"]
    assert [a["done"] for a in acts] == [False, False, False]
    for act_ in acts:
        assert act_["text"]["zh"] and act_["text"]["en"]
        assert set(act_) == {"id", "text", "done"}  # the shape of the contract


def test_the_words_of_the_acts_carry_the_numbers_of_the_rules_and_name_nobody_by_sex():
    import re

    for item in ACTS:
        for lang in ("zh", "en"):
            text = item["text"][lang]
            assert not re.search(r"[;；—]", text), text
        assert not re.search(r"[他她]", item["text"]["zh"])
        assert not re.search(r"\b(he|she|his|her|him)\b", item["text"]["en"], re.I)
    assert (
        str(peace.STOP_DROP) in ACTS[0]["text"]["zh"]
        and str(peace.WORK_DROP) in ACTS[1]["text"]["en"]
    )
    assert str(assembly.MEAL_DROP) in ACTS[2]["text"]["zh"]
    assert str(assembly.MEAL_DROP_AFTER_TRUTH) in ACTS[2]["text"]["en"]


def test_the_deeds_of_the_board_are_the_deeds_of_the_content_check():
    assert cc.DEEDS == peace.ACTS


# ------------------------------------------------------------------------------ the table for two


def teahouse_scene(day: int = 1, hour: int = 18, minute: int = 30, **config) -> Game:
    """A game with the manager in the teahouse in the evening, where both heads are."""
    game = bridge(1, **CLEAR, dev_actions=1, **config)
    run_to(game, at(day, hour, minute))
    x, y, _, _ = TOWN.places["p_teahouse"].rect
    put(game, x, y)
    return game


def lay_a_table(game: Game):
    out = act(game, "speak", kind="meal")
    return acks(out), out


def test_a_table_for_both_heads_with_witnesses_takes_off_less_before_the_truth_than_after():
    game = teahouse_scene()
    before = grudge_of(game)
    got, out = lay_a_table(game)
    assert got == [("applied", None)]
    after = grudge_of(game)
    assert [b - a for b, a in zip(before, after, strict=True)] == [assembly.MEAL_DROP] * 2
    assert "reconcile_seen" in state_of(game)["goals"]["flags"]

    game = teahouse_scene(day=2)
    act(game, "dev_goal", op="truth")
    before = grudge_of(game)
    got, _ = lay_a_table(game)
    assert got == [("applied", None)]
    after = grudge_of(game)
    assert [b - a for b, a in zip(before, after, strict=True)] == [
        assembly.MEAL_DROP_AFTER_TRUTH
    ] * 2


def test_the_table_is_laid_once_for_the_same_people_on_a_day_whatever_was_said_between():
    """The signature of a table is kept apart from that of a statement, so that a statement between
    two tables does not make the second one a new question."""
    game = teahouse_scene()
    assert lay_a_table(game)[0] == [("applied", None)]
    state_of(game)["player"]["public"]["seen"]["p_teahouse"] = "1|e_footprint|anyone"
    assert lay_a_table(game)[0] == [("rejected", "said_already")]


def test_the_numbers_of_the_meal_are_those_the_board_prints():
    assert (assembly.MEAL_DROP, assembly.MEAL_DROP_AFTER_TRUTH) == (12, 24)


def test_one_meal_never_makes_the_peace():
    """From the lowest start in thirty towns, a table after the truth still leaves the grudge over
    thirty: it takes the other deeds as well."""
    lowest = 100
    for seed in range(1, 31):
        game = Game(seed, "bridge")
        lowest = min(lowest, max(grudge_of(game)))
    assert lowest - assembly.MEAL_DROP_AFTER_TRUTH >= 30, lowest


# ----------------------------------------------------------------------------- working side by side


def work(game: Game, day: int, people: tuple[str, ...]) -> list[dict]:
    """On the morning of ``day`` these people are asked to work an hour at the bridge; the game runs
    to noon. The ``eased`` events seen."""
    run_to(game, at(day, 7, 30))
    for who in people:
        step(game, player(game.next_seq, assign_body(f"w{day}-{who}", who, kind="work",
                                                     place="p_bridge", hours=1)))  # fmt: skip
    found: list[dict] = []
    run_to(game, at(day, 12, 0), lambda out: found.extend(events(out, "eased")))
    return found


def labour_game(**config) -> Game:
    return bridge(1, **{**CLEAR, **config}, dev_actions=1)


def test_helpers_of_both_families_at_the_bridge_one_morning_take_off_the_grudge_of_both_heads():
    game = labour_game()
    before = grudge_of(game)
    found = work(game, 3, (LI_HELPERS[0], ZHOU_HELPERS[0]))
    assert found == [{**found[0]}] and found[0]["act"] == peace.WORK
    assert (found[0]["day"], found[0]["amount"]) == (3, peace.WORK_DROP)
    after = grudge_of(game)
    assert [b - a for b, a in zip(before, after, strict=True)] == [peace.WORK_DROP] * 2
    assert peace.eased(state_of(game))["work"] == [3]
    assert [a["done"] for a in board_of(game)["peace"]["acts"]] == [False, True, False]


def test_only_the_first_two_mornings_count_and_each_counts_once():
    game = labour_game()
    before = grudge_of(game)
    for day in (3, 4, 5):
        work(game, day, (LI_HELPERS[0], ZHOU_HELPERS[0], LI_HELPERS[1]))
    after = grudge_of(game)
    assert peace.eased(state_of(game))["work"] == [3, 4]
    assert [b - a for b, a in zip(before, after, strict=True)] == [
        peace.WORK_DROP * peace.WORK_MORNINGS
    ] * 2


@pytest.mark.parametrize("people", [LI_HELPERS[:2], ZHOU_HELPERS[:2], ()])
def test_helpers_of_one_family_alone_do_not_make_the_deed(people):
    game = labour_game()
    before = grudge_of(game)
    assert work(game, 3, people) == []
    assert grudge_of(game) == before
    assert peace.eased(state_of(game))["work"] == []


def test_the_work_of_the_first_two_days_does_not_count_for_the_peace():
    game = labour_game()
    before = grudge_of(game)
    assert work(game, 2, (LI_HELPERS[0], ZHOU_HELPERS[0])) == []
    assert grudge_of(game) == before


def test_a_morning_of_heavy_rain_has_no_work_and_so_no_deed():
    game = labour_game(**HEAVY)
    before = grudge_of(game)
    assert work(game, 3, (LI_HELPERS[0], ZHOU_HELPERS[0])) == []
    assert grudge_of(game) == before


def test_the_mornings_are_read_off_the_errands_that_are_done():
    game = labour_game()
    work(game, 3, (LI_HELPERS[0], ZHOU_HELPERS[0], "cha_laoban"))
    families = peace.side_by_side(game._kernel.world, state_of(game))
    assert families == {3: {"fam_li", "fam_zhou"}}  # the madam is of no family


# ------------------------------------------------------------------------------ the first evening


def evening_follower(until_hour: int, seed: int = 492):
    """Play the follower of the tools through the first day to ``until_hour``: the game, the frames
    seen on the way (the card of the clarification) and the events."""
    import bots
    from lantern_core.api import preset

    started = preset("slice")
    game = Game(seed, started["scenario"], {**started["config"], "days": 5, "budget_cap": 0})
    bot = bots.make("follower", json.loads(game.scene_json()), seed, mode="tracked")
    obs = Obs(json.loads(game.step("[]")))
    seen: list[dict] = []
    log: list[dict] = []
    while game.tick < at(1, until_hour):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(game.step(json.dumps(records)))
        obs = Obs(out)
        seen.append({"tick": out["tick"], "tasks": out["frame"]["tasks"]})
        log.extend(out["events"])
    return game, seen, log


@pytest.fixture(scope="module")
def first_evening():
    return evening_follower(19)


def test_the_card_has_the_manager_speak_to_the_crowd_at_six_and_not_at_five(first_evening):
    """The people whose word counts are in the room by six. Before it the card has nothing to do at
    the teahouse, once the manager is there."""
    _, seen, _ = first_evening
    for row in seen:
        now = row["tick"]
        card = next((t for t in row["tasks"] if t["id"] == "t_clear_rumour"), None)
        if card is None or card["state"] != "open" or card["action"] is None:
            continue
        if card["action"] == {"verb": "speak", "kind": "clarify"}:
            assert now >= at(1, 18), now
    assert any(
        (card := next((t for t in row["tasks"] if t["id"] == "t_clear_rumour"), None))
        and card["action"] == {"verb": "speak", "kind": "clarify"}
        for row in seen
    )


def test_the_clarification_of_the_evening_is_heard_by_li_da_the_zhou_head_the_clerk_and_the_elder(
    first_evening,
):
    game, _, log = first_evening
    (clarified,) = [e for e in log if e["kind"] == "clarified"]
    stand = {h["npc"]: h["after"] for h in clarified["audience"]}
    for who in ("li_da", "li_laotai", "zhou_zhanggui", "zhou_huoji", "zuzhang"):
        assert who in stand, who
    assert stand["li_da"] == "for" and stand["zhou_huoji"] == "for"
    from lantern_core.world.bridge import clarify

    assert clarify.knows_claim(state_of(game), "li_da")


def test_li_da_promises_the_bamboo_without_being_told_what_was_cleared(first_evening):
    """He was in the room, so the card for the bamboo has no gap to fill: no one tells him, and the
    answer ``unaware`` is not heard once on the first day."""
    _, seen, log = first_evening
    assert not [e for e in log if e["kind"] == "action_ack" and e.get("reason") == "unaware"]
    assert not [e for e in log if e["kind"] == "told" and e.get("npc") == "li_da"]
    promised = [e for e in log if e["kind"] == "commitment" or e["kind"] == "entrusted"]
    assert any(
        e["kind"] == "entrusted" and e["npc"] == "li_da" and e["result"] == "agreed"
        for e in promised
    )


def test_both_heads_who_were_there_stop_accusing_when_the_clarification_is_taken_in(first_evening):
    game, _, log = first_evening
    eased = [e for e in log if e["kind"] == "eased"]
    assert [(e["act"], e["npc"], e["amount"]) for e in eased] == [
        (peace.STOP, LI, peace.STOP_DROP),
        (peace.STOP, ZHOU, peace.STOP_DROP),
    ]
    assert peace.eased(state_of(game))["stop"] == [LI, ZHOU]
    acts = board_of(game)["peace"]["acts"]
    assert [a["done"] for a in acts] == [True, False, False]
    # the bar fell by the deed in the head who held the larger grudge
    assert state_of(game)["goals"]["metrics"]["grudge"] == 67 - peace.STOP_DROP


# ---------------------------------------------------------------------------- the deeds, one by one


def clarify_at(hour: int, minute: int = 0):
    """The manager clarifies the rumour at the teahouse at this time of the first evening, with the
    first day's notes as the slice's route takes them. The game."""
    import slice_driver

    class Early(slice_driver.Evening):
        name = "early"

        def play(self):
            yield from self.wait_until(1, 6, 30)
            if (yield from self.meet("zhou_huoji")):
                yield from self.act("ask", topic="li_er")
                yield from self.act("ask_source", entry=self.o.notebook[0]["id"])
                for _ in range(3):
                    yield from self.act("ask", topic="li_er")
                yield from self.leave()
            if (yield from self.meet("cha_laoban")):
                yield from self.act("ask", topic="li_er")
                yield from self.act("ask_source", entry=self.o.notebook[0]["id"])
                yield from self.leave()
            yield from self.wait_until(1, hour - 1, 40 + minute)
            yield from self.goto("p_teahouse")
            yield from self.wait_until(1, hour, minute)
            return

    started = slice_driver.preset("slice")
    game = Game(started["seed"], started["scenario"], started["config"])
    bot = Early(json.loads(game.scene_json()), started["seed"])
    bot.stay = bot.held = bot.speech = -1
    obs = Obs(json.loads(game.step("[]")))
    return game, bot, obs


def test_the_deed_is_the_clarification_not_the_hour(first_evening):
    """A head who is not in the room when the clarification is made does not stop accusing by it."""
    game, _, log = first_evening
    heads_there = {h["npc"] for e in log if e["kind"] == "clarified" for h in e["audience"]} & set(
        goals_call.HEADS
    )
    assert heads_there == set(goals_call.HEADS)  # at six both are there
    assert peace.stop_blaming  # the function itself is unit-tested below


def test_stopping_the_accusation_is_once_for_each_head_and_only_for_the_heads_there():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 18, 30))
    sim_state = state_of(game)
    assert peace.eased(sim_state) == {"stop": [], "work": []}

    # a head who was not there is not touched
    class Fake:
        def __init__(self, state):
            self.state = state
            self.emitted = []

        def emit(self, kind, **fields):
            self.emitted.append((kind, fields))

    before = grudge_of(game)
    fake = Fake(sim_state)
    assert peace.stop_blaming(fake, [LI, "li_da"]) == [LI]
    assert [kind for kind, _ in fake.emitted] == ["eased"]
    assert peace.stop_blaming(fake, [LI, ZHOU]) == [ZHOU]  # the Li head has stopped already
    assert peace.stop_blaming(fake, [LI, ZHOU]) == []
    after = grudge_of(game)
    assert before[0] - after[0] == peace.STOP_DROP and before[1] - after[1] == peace.STOP_DROP
    assert peace.eased(sim_state)["stop"] == [LI, ZHOU]


def test_a_head_who_was_not_there_and_comes_to_know_of_the_clarification_stops_accusing_too():
    """The Zhou head is not at the teahouse when the talk is set straight, and the town carries it
    to him: once he holds what was cleared (the clerk only saw Li Er looking for his lantern) he
    stops accusing in public as the Li head did, once, a few ticks later."""
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 18, 30))
    state = state_of(game)

    class Fake:
        def __init__(self, state):
            self.state = state
            self.emitted = []

        def emit(self, kind, **fields):
            self.emitted.append((kind, fields))

    fake = Fake(state)
    assert peace.stop_blaming(fake, [LI]) == [LI]  # only the Li head was there
    assert peace.hear_of_it(fake) == []  # and the Zhou head knows nothing of it yet
    before = grudge_of(game)
    social = state["social"]
    from lantern_core.cognition.beliefs import SELF_SEEN, Belief
    from lantern_core.world.bridge import clarify, notes

    belief = Belief(
        ZHOU, clarify.CLAIM, "assert", clarify.KNOWS_AT, "heard", "li_da", SELF_SEEN, 1, game.tick
    )
    notes.hold(social, belief)
    assert peace.hear_of_it(fake) == [ZHOU]
    assert peace.hear_of_it(fake) == []  # once
    after = grudge_of(game)
    assert before[0] - after[0] == 0 and before[1] - after[1] == peace.STOP_DROP
    assert peace.eased(state)["stop"] == [LI, ZHOU]
    assert [kind for kind, _ in fake.emitted] == ["eased", "eased"]


# ------------------------------------------------------------------------------ the peace itself


def test_the_peace_comes_with_the_deeds_and_not_with_a_table_alone():
    """From the start of the slice's town, 67: the clarification, two mornings of work and a table
    after the truth bring it to 15. Without the work the table leaves it at 33."""
    start, line = 67, 30  # the grudge of the town of the slice, and the line the goal draws
    stop, work, meal = peace.STOP_DROP, peace.WORK_DROP, assembly.MEAL_DROP_AFTER_TRUTH
    mornings = peace.WORK_MORNINGS
    assert start - (stop + work * mornings + meal) < line  # all the deeds: 15
    assert start - (stop + work + meal) < line  # one morning of work will do: 25
    assert start - meal >= line  # a table after the truth by itself: 43
    assert start - assembly.MEAL_DROP >= line  # and before it: 55
    assert start - (stop + meal) >= line  # the clarification and the table, with no work: 35


def test_the_peace_is_reconciled_when_the_bar_is_under_thirty_and_a_table_was_seen():
    game = teahouse_scene(day=2)
    act(game, "dev_goal", op="truth")
    act(game, "dev_goal", op="grudge", value=40)
    assert lay_a_table(game)[0] == [("applied", None)]
    for _ in range(3):
        idle(game)
    assert "reconciled" in state_of(game)["goals"]["flags"]
    assert board_of(game)["peace"]["state"] == "done"
    assert [a["done"] for a in board_of(game)["peace"]["acts"]][-1] is True


def test_the_cards_name_the_next_deed(first_evening):
    """The card of the peace is not there before the third day; the third morning names the work."""
    _, seen, _ = first_evening
    assert all(
        all(t["id"] != "t_make_peace" for t in row["tasks"]) for row in seen
    )  # nothing of it on the first day
