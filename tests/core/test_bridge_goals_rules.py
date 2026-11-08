"""The goals, flags, metrics and endings of the script, and the language of their conditions."""

import itertools

import pytest
from bridge_helpers import CYCLE, at

from lantern_core.world.bridge import clock, goals_ending, goals_rules
from lantern_core.world.bridge.data import SCRIPT

RULES = goals_rules.rules()
INPUTS = RULES.inputs


def flags_of(*names):
    return {name: 0 for name in names}


# ------------------------------------------------------------------------------ the endings


def test_the_script_names_the_four_inputs_the_three_rows_and_the_hidden_ending():
    assert INPUTS == ("bridge_fixed", "detour_done", "truth_told", "reconciled")
    assert [row.id for row in RULES.rows] == ["ending_full", "ending_barely", "ending_split"]
    assert [row.id for row in RULES.hidden] == ["hidden_legend_of_lie"]
    assert set(RULES.derived) == {"passable", "all_three"}
    assert RULES.never == (("bridge_fixed", "ending_full"),)


@pytest.mark.parametrize("bits", list(itertools.product([False, True], repeat=4)))
def test_exactly_one_row_holds_for_each_of_the_sixteen_combinations(bits):
    flags = flags_of(*[name for name, up in zip(INPUTS, bits, strict=True) if up])
    matching = [
        row.id for row in RULES.rows if goals_rules.holds(row.when, flags, {}, {}, RULES.derived)
    ]
    assert len(matching) == 1
    bridge, detour, truth, peace = bits
    passable = bridge or detour
    expected = (
        "ending_split"
        if not passable
        else "ending_full"
        if bridge and truth and peace
        else "ending_barely"
    )
    assert matching == [expected]
    base, hidden = goals_rules.ending_of(flags, {"false_belief_share": 0})
    assert base.id == expected and hidden == ()


def test_the_full_ending_never_comes_without_the_bridge():
    for flag, ending in RULES.never:
        for bits in itertools.product([False, True], repeat=len(INPUTS)):
            flags = flags_of(*[n for n, up in zip(INPUTS, bits, strict=True) if up])
            if flag not in flags:
                assert goals_rules.ending_of(flags, {"false_belief_share": 0})[0].id != ending


def test_the_hidden_ending_needs_more_than_half_to_believe_the_lie_and_goes_with_any_base():
    for bits in itertools.product([False, True], repeat=4):
        flags = flags_of(*[n for n, up in zip(INPUTS, bits, strict=True) if up])
        for share, hidden in ((0, ()), (50, ()), (51, ("hidden_legend_of_lie",))):
            base, found = goals_rules.ending_of(flags, {"false_belief_share": share})
            assert tuple(row.id for row in found) == hidden
            assert base.id == goals_rules.ending_of(flags, {"false_belief_share": 0})[0].id


def test_every_ending_has_a_name_in_both_languages():
    for row in (*RULES.rows, *RULES.hidden):
        assert row.label and goals_ending.LABELS_EN[row.id]
    assert set(goals_ending.LABELS_EN) == {r.id for r in (*RULES.rows, *RULES.hidden)}


# ------------------------------------------------------------------------------ the conditions


def test_a_condition_is_read_the_way_the_script_writes_it():
    flags, done = {"a": 1, "b": 1}, {"g": 1}
    metrics = {"m": 40}
    holds = goals_rules.holds
    assert holds({"flag": "a"}, flags, metrics, done)
    assert not holds({"flag": "c"}, flags, metrics, done)
    assert holds({"goal": "g"}, flags, metrics, done)
    assert not holds({"goal": "h"}, flags, metrics, done)
    for op, bound, expected in (
        (">=", 40, True),
        (">=", 41, False),
        (">", 39, True),
        (">", 40, False),
        ("<=", 40, True),
        ("<", 40, False),
        ("<", 41, True),
        ("==", 40, True),
        ("!=", 40, False),
    ):
        cond = {"metric": "m", "op": op, "value": bound}
        assert holds(cond, flags, metrics, done) is expected, (op, bound)
    assert holds({"all": [{"flag": "a"}, {"flag": "b"}]}, flags, metrics, done)
    assert not holds({"all": [{"flag": "a"}, {"flag": "c"}]}, flags, metrics, done)
    assert holds({"any": [{"flag": "c"}, {"flag": "b"}]}, flags, metrics, done)
    assert not holds({"any": []}, flags, metrics, done)
    assert holds({"all": []}, flags, metrics, done)
    assert holds({"not": {"flag": "c"}}, flags, metrics, done)
    assert holds("a", flags, metrics, done)  # a name that is a flag
    assert holds("both", flags, metrics, done, {"both": {"all": ["a", "b"]}})  # and a derived one


def test_a_condition_that_is_not_one_is_refused():
    with pytest.raises(ValueError, match="unknown condition"):
        goals_rules.holds({"colour": "red"}, {}, {}, {})
    with pytest.raises(ValueError, match="unknown comparison"):
        goals_rules.compare(1, "~", 2)


def test_the_goals_of_the_script_are_read_with_their_flags_and_deadlines_in_ticks():
    goals = {g.id: g for g in RULES.goals}
    assert list(goals) == [
        "g_materials",
        "g_labor",
        "g_repair",
        "g_detour",
        "g_truth",
        "g_reconcile",
    ]
    assert goals["g_repair"].sets == "bridge_fixed" and goals["g_detour"].sets == "detour_done"
    assert goals["g_truth"].sets == "truth_told" and goals["g_reconcile"].sets == "reconciled"
    assert goals["g_materials"].deadline is None and goals["g_repair"].deadline is None
    # the work is due on the evening of the day before the last, the truth on the last evening
    assert goals["g_labor"].deadline == at(4, 18) == 7650
    assert goals["g_truth"].deadline == at(5, 18) == 9720
    assert set(RULES.metrics) == {m["id"] for m in SCRIPT["metrics"]}
    assert RULES.metrics["work_progress"] == (0, 100)


def test_game_minutes_turn_into_ticks_of_the_clock_and_back():
    assert goals_rules.minute_tick(6 * 60) == 0
    assert goals_rules.minute_tick(21 * 60) == clock.DAY_TICKS
    assert goals_rules.minute_tick(24 * 60) == clock.DAY_TICKS + 3 * clock.NIGHT_TICKS_PER_HOUR
    assert goals_rules.minute_tick(24 * 60 + 6 * 60) == CYCLE  # 06:00 of day 2
    assert goals_rules.minute_tick(5 * 60) < 0  # before the game
    for tick in range(0, 5 * CYCLE, 41):
        now = clock.at(tick)
        morning_after = now.phase == clock.NIGHT and now.hour < clock.DAWN_HOUR
        day = now.day + 1 if morning_after else now.day
        minute = (day - 1) * 24 * 60 + now.hour * 60 + now.minute
        assert abs(goals_rules.minute_tick(minute) - tick) <= clock.DAY_TICKS_PER_HOUR // 60 + 1


def test_a_script_that_names_something_unknown_is_refused(monkeypatch):
    broken = dict(SCRIPT)
    broken["goals"] = [
        dict(SCRIPT["goals"][0], done_when={"flag": "nowhere"}),
        *SCRIPT["goals"][1:],
    ]
    monkeypatch.setattr(goals_rules, "SCRIPT", broken)
    goals_rules.rules.cache_clear()
    try:
        with pytest.raises(ValueError, match="unknown flag 'nowhere'"):
            goals_rules.rules()
    finally:
        monkeypatch.undo()
        goals_rules.rules.cache_clear()
    assert goals_rules.rules().flags == RULES.flags
