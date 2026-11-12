"""The hearts: how close each person stands to the manager, shown and read by nothing.

The formula (``hearts.count``), the event that says a heart moved and why, the log of the last
changes on the card of a person, and the facts of the card. Nothing in the town reads the hearts: a
request is weighed by the trust and the favours as it ever was.
"""

from __future__ import annotations

import json

import pytest
from bridge_helpers import CAST, CLEAR, at, bridge, run_to, state_of
from dealings_helpers import believe, talking, tell, told_event, trust
from player_helpers import acks, act, beside, events, me, silence

from lantern_core.world.bridge import hearts, persuade, pledges, repute

NEW_KEYS = ("hearts", "warm", "why", "said_no", "gifted", "tastes")


def frame_of(game):
    kernel = game._kernel
    return kernel.world.frame(kernel.state)


def person_row(game, who):
    return next(p for p in frame_of(game)["people"] if p["id"] == who)


def meet(game, who):
    beside(game, who)
    silence(game)
    return act(game, "talk", npc=who)


# ------------------------------------------------------------------------------ the formula


def test_a_stranger_has_no_heart_and_the_first_talk_of_a_day_earns_the_half_heart():
    assert hearts.count(repute.STRANGER, 0) == 0
    assert hearts.count(repute.STRANGER + 3, 0) == 1  # the first talk of a day earns three points
    assert hearts.count(repute.STRANGER + 2, 0) == 0


def test_a_half_heart_is_six_points_of_trust_and_a_favour_owed_is_four_points():
    assert [hearts.count(10 + 6 * n, 0) for n in range(0, 11)] == [
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]  # fmt: skip
    assert hearts.count(10, 1) == hearts.count(14, 0) == 1  # (4 + 3) // 6
    assert hearts.count(10, 6) == hearts.count(34, 0) == 4


def test_the_hearts_stop_at_five_whole_hearts_and_never_go_below_none():
    assert hearts.count(100, 6) == hearts.MAX_HEARTS == 10
    assert hearts.count(0, 0) == 0


def test_what_the_manager_owes_a_person_takes_no_heart_away():
    section = state_of(bridge(1))["player"]
    section["deeds"]["asked:x"] = ["li_da", 2, -1, 0]  # the manager owes Li Da a favour
    section["trust"][CAST.index["li_da"]] = 40
    owed = hearts.owed_to(section)
    assert owed[CAST.index["li_da"]] == 0
    assert hearts.now(section)[CAST.index["li_da"]] == hearts.count(40, 0)


def test_a_favour_owed_to_the_manager_counts_and_is_held_to_the_ledger_ceiling():
    section = state_of(bridge(1))["player"]
    index = CAST.index["li_da"]
    section["deeds"]["kept:k1"] = ["li_da", 3, 1, 0]
    section["deeds"]["kept:k2"] = ["li_da", 3, 1, 0]
    section["deeds"]["kept:k3"] = ["li_da", 3, 1, 0]  # 9 favours: the ledger holds 6
    assert hearts.owed_to(section)[index] == pledges.MAX_BALANCE


# ------------------------------------------------------------------------------ nothing reads them


def test_a_fresh_game_has_none_of_the_keys_the_hearts_add_to_the_state():
    section = state_of(bridge(1))["player"]
    for key in NEW_KEYS:
        assert key not in section, key
    game = bridge(2)
    run_to(game, 300)
    assert all(key not in me(game) for key in NEW_KEYS)


def test_no_rule_reads_the_hearts_a_request_is_weighed_by_trust_and_favours():
    game = talking("li_da")
    state = state_of(game)
    world = game._kernel.world
    before = persuade.weigh(world, state, "li_da", "material")
    me(game)["hearts"] = [10] * len(CAST.people)
    me(game)["warm"] = {"li_da": [[1, 3, "gift"]]}
    assert persuade.weigh(world, state, "li_da", "material") == before


# ------------------------------------------------------------------------------ the event


def test_the_first_talk_of_a_day_moves_a_heart_and_says_why():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 8))
    out = meet(game, "li_laotai")
    (moved,) = events(out, "hearts")
    assert moved["npc"] == "li_laotai" and moved["delta"] == 1 and moved["hearts"] == 1
    assert moved["why"] == "talk"
    assert person_row(game, "li_laotai")["hearts"] == 1
    again = act(game, "leave")
    assert events(again, "hearts") == []
    assert acks(meet(game, "li_laotai")) == [("applied", None)]
    assert events(act(game, "leave"), "hearts") == []  # the second talk of the day earns nothing


def test_the_event_is_a_signal_and_moves_neither_the_version_nor_the_hash_of_the_state():
    """The state keeps the hearts and the log, but the event counts for nothing: the version that
    previews carry is the same with the signal there or not."""
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 8))
    version = game._kernel.state["version"]
    out = meet(game, "li_laotai")
    assert events(out, "hearts")
    emitted = [e for e in out["events"] if e["kind"] != "hearts"]
    counted = [e for e in emitted if e["kind"] not in ("replied",)]
    assert game._kernel.state["version"] == version + len(counted)


def test_a_promise_made_moves_the_hearts_for_the_promise_and_a_promise_kept_for_the_keeping():
    game = talking("zhou_zhanggui", hour=9)
    made = act(game, "promise", op="make", what="stall", item="front", due=3)
    (moved,) = events(made, "hearts")
    assert moved["why"] == "promise" and moved["delta"] >= 1
    kept = act(game, "promise", op="keep", id="k1")
    (moved,) = events(kept, "hearts")
    assert moved["why"] == "kept" and moved["delta"] >= 1


def test_a_promise_that_lapses_costs_hearts_with_the_reason_broken():
    game = talking("zhou_zhanggui", hour=9)
    act(game, "promise", op="make", what="stall", item="front", due=1)
    act(game, "leave")
    seen = []
    run_to(game, at(2, 8), seen.append)
    broken = [e for out in seen for e in out["events"] if e["kind"] == "hearts"]
    assert [e["why"] for e in broken] == ["broken"] and broken[0]["delta"] < 0


def test_a_lie_that_is_caught_costs_hearts_with_the_reason_lie():
    game = talking("cha_laoban")
    trust(game, "cha_laoban", 40)
    act(game, "promise", op="make", what="stall", item="back", due=3)  # the hearts are settled
    believe(game, "cha_laoban", "pr_boat_damaged", 90, "heard", "old_he", "old_he")
    out = tell(game, how="fabricate", pred="damaged", subject="zhou_dalang", object="t_rail")
    assert told_event(out)["outcome"] == "caught"
    (moved,) = events(out, "hearts")
    assert moved["why"] == "lie" and moved["delta"] < 0 and moved["npc"] == "cha_laoban"
    assert person_row(game, "cha_laoban")["card"]["changes"][-1]["why"] == "lie"


def _ctx(game):
    from lantern_core.kernel import Ctx

    return Ctx(game._kernel)


def test_a_trust_that_moves_by_less_than_a_half_heart_says_nothing():
    game = talking("li_da")
    state = me(game)
    index = CAST.index["li_da"]
    state["trust"][index] = 16
    repute.nudge(state, index, 1, "other")
    s = _sim(game)
    hearts.sync(s)
    assert [e for e in s.ctx.events if e["kind"] == "hearts"] == []
    assert "why" not in state  # the reason is let go with the look


def _sim(game):
    from lantern_core.world.bridge.sim import Sim

    return Sim(game._kernel.world, _ctx(game))


# ------------------------------------------------------------------------------ the card


def test_the_log_of_a_person_keeps_the_last_five_changes_oldest_first():
    game = talking("li_da")
    state = me(game)
    index = CAST.index["li_da"]
    for n in range(8):
        repute.nudge(state, index, 6 if n % 2 == 0 else -6, "gift" if n % 2 == 0 else "blame")
        hearts.sync(_sim(game))
    card = person_row(game, "li_da")["card"]
    assert len(card["changes"]) == hearts.KEPT == 5
    assert [row["delta"] for row in card["changes"]] == [-1, 1, -1, 1, -1]
    assert {row["why"] for row in card["changes"]} <= set(hearts.WHY)
    assert set(card["changes"][0]) == {"tick", "day", "hour", "minute", "delta", "why"}


def test_the_card_says_how_far_the_person_trusts_the_manager_in_four_words():
    game = talking("li_da")
    index = CAST.index["li_da"]
    seen = []
    for value in (10, 14, 15, 34, 35, 59, 60, 99):
        me(game)["trust"][index] = value
        seen.append(person_row(game, "li_da")["card"]["trust"])
    assert seen == [
        "stranger",
        "stranger",
        "acquainted",
        "acquainted",
        "friendly",
        "friendly",
        "close",
        "close",
    ]


def test_the_card_has_the_favours_both_ways_the_open_promises_and_what_they_promised_back():
    game = talking("li_da", hour=9)
    state = me(game)
    state["deeds"]["asked:li_da|material|bamboo"] = ["li_da", 2, -1, 0]  # the manager owes him
    state["deeds"]["kept:k9"] = ["li_da", 1, 1, 0]  # and he owes the manager
    act(game, "promise", op="make", what="wage", amount=10, due=3)
    card = person_row(game, "li_da")["card"]
    assert (card["owes_you"], card["you_owe"]) == (1, 2)
    (promise,) = card["you_promised"]
    assert promise["what"] == "wage" and promise["amount"] == 10 and promise["due"] == 3
    assert card["promised_you"] == []
    assert person_row(game, "zhou_zhanggui")["card"] is None  # not known: no card


def test_a_person_the_manager_has_not_talked_to_has_no_card():
    game = bridge(1)
    rows = frame_of(game)["people"]
    assert [p["id"] for p in rows] == [p.id for p in CAST.people]
    assert all(p["card"] is None and not p["known"] and p["hearts"] == 0 for p in rows)


def test_waiting_is_null_before_the_call_and_for_a_child_and_zero_once_a_helper_joined():
    game = talking("li_da", hour=9, dev_actions=1)
    assert person_row(game, "li_da")["card"]["waiting"] is None  # nobody is called yet
    act(game, "rally")
    waiting = person_row(game, "li_da")["card"]["waiting"]
    assert isinstance(waiting, int) and waiting >= 0
    act(game, "dev_goal", op="join", npc="li_da")
    assert person_row(game, "li_da")["card"]["waiting"] == 0
    child = talking("shitou", hour=9, dev_actions=1)
    act(child, "rally")
    assert person_row(child, "shitou")["card"]["waiting"] is None  # a child cannot help


def test_the_card_tells_a_helper_from_one_the_call_left_out_whose_friends_are_all_in():
    """The call is for the crew and no more: the rest have their thresholds met, so they wait for
    nobody, as a helper does. Only ``joined`` tells them from a helper."""
    from goals_helpers import HELPERS, hand, rally

    from lantern_core.world.bridge import goals, goals_call

    h = hand(3)
    call = h.goals["call"]
    for person in HELPERS:  # everyone would come as soon as one friend has
        call["base"][person], call["shift"][person] = 0, 0
    h.send(rally())
    joined = goals.joined(h.state)
    left = [p for p in HELPERS if p not in joined]
    assert len(joined) == goals_call.CREW and left
    for person in HELPERS:
        h.state["player"]["talked"][CAST.index[person]] = 1  # the manager knows them all
    rows = {row["id"]: row["card"] for row in frame_of(h.game)["people"]}
    assert {rows[person]["waiting"] for person in HELPERS} == {0}  # nobody waits for anybody
    assert [rows[person]["joined"] for person in joined] == [True] * len(joined)
    assert [rows[person]["joined"] for person in left] == [False] * len(left)


def test_joined_is_false_before_the_call_and_for_a_child_and_true_once_a_helper_joined():
    game = talking("li_da", hour=9, dev_actions=1)
    assert person_row(game, "li_da")["card"]["joined"] is False  # nobody is called yet
    act(game, "rally")
    act(game, "dev_goal", op="join", npc="li_da")
    assert person_row(game, "li_da")["card"]["joined"] is True
    child = talking("shitou", hour=9, dev_actions=1)
    act(child, "rally")
    assert person_row(child, "shitou")["card"]["joined"] is False  # a child cannot help


def test_what_a_person_still_waits_for_is_what_the_call_says_of_them():
    from lantern_core.world.bridge import goals_call

    game = talking("zhou_zhanggui", hour=9)
    act(game, "rally")
    world, state = game._kernel.world, state_of(game)
    waiting = person_row(game, "zhou_zhanggui")["card"]["waiting"]
    assert waiting == goals_call.waiting_for(world, state, "zhou_zhanggui")


def test_the_frame_of_the_people_is_json_with_the_cast_in_order_and_nothing_hidden():
    game = talking("li_laotai")
    text = json.dumps(frame_of(game)["people"], ensure_ascii=False)
    for secret in ("v_boat", "v_flood", "v_drunk", "variant", "believes"):
        assert secret not in text


@pytest.mark.parametrize("day", [1, 2])
def test_the_hearts_of_the_frame_are_the_ones_the_events_told(day):
    """The page keeps a count from the events and shows the frame: they agree."""
    game = bridge(1, **CLEAR)
    run_to(game, at(day, 9))
    counted = {p.id: 0 for p in CAST.people}
    for who in ("li_laotai", "li_da"):
        out = meet(game, who)
        for e in events(out, "hearts"):
            counted[e["npc"]] += e["delta"]
        out = act(game, "promise", op="make", what="wage", amount=10, due=day + 2)
        for e in events(out, "hearts"):
            counted[e["npc"]] += e["delta"]
        act(game, "leave")
    for row in frame_of(game)["people"]:
        assert row["hearts"] == counted[row["id"]], row["id"]
