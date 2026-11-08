"""The key ``board`` of the frame: how the bridge, the truth and the peace stand.

The board is made of the numbers of the festival, who joined the call, the weather of the days that
are over, the clock and the last statement the manager made in public, so most of these tests ask
``board.wire`` for the board of a state at a tick of their choice, after setting up the case in the
state. The ones at the end read real frames, change what is hidden and compare.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest
from agenda_helpers import frame_now, idle, slice_game
from bridge_helpers import CLEAR, HEAVY, at, bridge, run_to, state_of, world_of
from player_helpers import act
from truth_helpers import hidden_changes

import lantern_core.world.bridge as package
from lantern_core import canon
from lantern_core.api import Game
from lantern_core.world.bridge import (
    agenda_terms,
    assembly,
    board,
    clock,
    goals,
    order,
    peace,
    projection,
)
from lantern_core.world.bridge import statement as card

ROOT = Path(__file__).resolve().parents[2]
KEYS = {
    "helpers", "need", "both", "hours", "window", "stop", "deadline", "needs", "statement", "truth",
    "peace",
}  # fmt: skip
WINDOW = {"day": 3, "from": 8, "to": 12, "place": "p_bridge"}
LI = ("li_da", "li_laotai", "li_er", "li_xiaomei")  # the Li family, who can all help
ZHOU = ("zhou_zhanggui", "zhou_niangzi", "zhou_erlang", "zhou_huoji")
TEAHOUSE = "p_teahouse"


def made(game, tick):
    """The board of the game as it stands, at ``tick``."""
    return board.wire(world_of(game), state_of(game), tick)


def join(game, *people, tick=0):
    """Set up the case: these people have joined the call (as the rows of the call keep it)."""
    state_of(game)["goals"]["call"]["joined"] += [[who, tick, 0, "call"] for who in people]


def speech(game, *rows):
    """Set up the case: these are the speeches in public the manager made."""
    state_of(game)["player"]["public"]["speeches"][:] = [list(row) for row in rows]


# ------------------------------------------------------------------------------ the shape


def test_every_frame_has_the_board_in_the_shape_of_the_contract():
    game = slice_game()
    frame = idle(game)["frame"]  # the grudge is a metric, which the first tick sets
    assert set(frame["board"]) == KEYS
    assert frame_now(game)["board"] == frame["board"]
    one = frame["board"]
    assert one["helpers"] == [
        {"family": "fam_li", "count": 0},
        {"family": "fam_zhou", "count": 0},
    ]
    assert (one["need"], one["both"], one["hours"]) == (5, False, {"done": 0, "need": 10})
    assert one["window"] == WINDOW and one["stop"] is None
    assert one["deadline"] == {"day": 4, "hour": 18}
    assert one["statement"] == [
        {"part": part, "support": 0, "against": 0, "gap": True}
        for part in ("cause", "course", "rumour")
    ]  # the card in short: nothing is chosen, and nothing held bears on any option
    assert one["needs"] == {"bamboo": 10, "timber": 8}  # what the bridge takes of each item
    assert one["truth"] == {"state": "open", "last": None}
    peace = one["peace"]
    assert peace["state"] == "open" and peace["witnessed"] is False
    assert peace["grudge"] == state_of(game)["goals"]["metrics"]["grudge"] > 30
    assert [(a["id"], a["done"]) for a in peace["acts"]] == [
        ("stop_blaming", False),
        ("work_together", False),
        ("witnessed_meal", False),
    ]
    for entry in peace["acts"]:
        assert set(entry) == {"id", "text", "done"} and entry["text"]["zh"] and entry["text"]["en"]
    assert json.loads(canon.dumps_str(one)) == one  # plain values only
    assert projection.problems(frame) == []
    assert projection.mark_of("board.peace.acts[].text.zh") == "known"
    assert projection.mark_of("board.truth.last.why.en") == "known"


def test_a_world_whose_goals_are_not_the_festivals_has_no_board_and_no_festival_terms():
    """A test world may give the reserved section ``goals`` to a subsystem of its own. The one
    guard, ``goals.keeps_the_goals``, tells it from the festival's: such a world sends no board,
    and the terms of the tasks that read the helpers, the work or the grudge hold nothing."""
    game = slice_game()
    assert goals.keeps_the_goals(state_of(game))
    state = copy.deepcopy(state_of(game))
    state["goals"] = {"asked": 0, "landed": {}}
    assert not goals.keeps_the_goals(state)
    world = world_of(game)
    out: dict = {}
    board.frame(world, {"world": state, "tick": 0}, out)
    assert "board" not in out
    env = agenda_terms.Env(world, state, clock.at(0))
    for cond in (
        {"kind": "crew"},
        {"kind": "helpers", "at_least": 1},
        {"kind": "work", "percent": 1},
        {"kind": "grudge", "below": 100},
        {"kind": "helper_waits"},
    ):
        assert not agenda_terms.holds(env, cond), cond


def test_the_board_is_in_every_frame_of_a_town_the_manager_never_walks():
    game = bridge(2015)
    for _ in range(300):
        out = json.loads(game.step())
        assert set(out["frame"]["board"]) == KEYS
        assert out["frame"]["board"]["truth"]["last"] is None


def test_a_world_without_the_goals_of_the_festival_has_no_board(monkeypatch):
    others = tuple(m for m in order.SUBSYSTEMS if m.SECTION != "goals")
    monkeypatch.setattr(order, "SUBSYSTEMS", others)
    game = bridge(1)
    assert state_of(game)["goals"] == {}
    out = act(game, "move", place=TEAHOUSE)
    assert "board" not in out["frame"] and "tasks" in out["frame"]


def test_the_key_is_audited_and_documented_in_the_package_docstring():
    row = next(entry for entry in projection.FRAME if entry.path == "board")
    assert row.mark == "known" and set(row.fields) == KEYS
    assert '"board"' in (package.__doc__ or "")


# ------------------------------------------------------------------------------ the bridge


def test_the_helpers_are_counted_by_family_and_both_families_must_be_there():
    game = bridge(3, dev_actions=1)
    rows = [
        ("li_da", [("fam_li", 1), ("fam_zhou", 0)], False),
        ("zhou_zhanggui", [("fam_li", 1), ("fam_zhou", 1)], True),
        ("cha_laoban", [("fam_li", 1), ("fam_zhou", 1), (None, 1)], True),
        ("old_he", [("fam_li", 1), ("fam_zhou", 1), (None, 2)], True),
    ]
    for npc, helpers, both in rows:
        one = act(game, "dev_goal", op="join", npc=npc)["frame"]["board"]
        assert [(h["family"], h["count"]) for h in one["helpers"]] == helpers, npc
        assert (one["both"], one["need"]) == (both, 5)
        assert sum(h["count"] for h in one["helpers"]) == len(
            state_of(game)["goals"]["call"]["joined"]
        )


def test_the_work_hours_are_those_of_the_hud():
    game = slice_game()
    state_of(game)["goals"]["work"]["ticks"] = 3 * clock.DAY_TICKS_PER_HOUR + 50
    state_of(game)["goals"]["metrics"]["work_progress"] = 30
    frame = idle(game)["frame"]
    assert frame["board"]["hours"] == {"done": 3, "need": 10}
    assert frame["hud"]["bridge"]["hours"] == 3 and frame["hud"]["bridge"]["hours_need"] == 10


@pytest.mark.parametrize(
    ("tick", "day"),
    [
        (at(1, 6), 3),
        (at(2, 20), 3),
        (at(3, 7, 59), 3),
        (at(3, 8), 3),  # the morning that is going on is the next
        (at(3, 11, 59), 3),
        (at(3, 12), 4),
        (at(3, 20), 4),
        (at(3, 22), 4),  # the night after the third day
        (at(3, 2), 4),  # and its small hours
        (at(4, 11, 59), 4),
        (at(4, 12), None),  # the morning of the fifth day is past the deadline
        (at(5, 8), None),
    ],
)
def test_the_window_is_the_next_morning_the_helpers_work_and_none_after_the_deadline(tick, day):
    game = bridge(3, **CLEAR)
    one = made(game, tick)["window"]
    assert one == (None if day is None else {**WINDOW, "day": day})


def test_there_is_no_window_once_the_work_is_done_or_the_game_has_no_more_days():
    game = bridge(3, **CLEAR)
    state_of(game)["goals"]["done"]["g_labor"] = at(3, 10)
    assert made(game, at(3, 7))["window"] is None
    short = bridge(3, days=3, **CLEAR)
    assert made(short, at(3, 7))["window"] == WINDOW
    assert made(short, at(3, 12))["window"] is None  # there is no fourth day


def test_why_the_last_morning_did_no_work():
    game = bridge(3, **CLEAR)
    assert made(game, at(2, 20))["stop"] is None  # no morning of work has been yet
    assert made(game, at(3, 11, 59))["stop"] is None  # and the first is not over
    for tick in (at(3, 12), at(3, 20), at(4, 7)):
        assert made(game, tick)["stop"] == board.NO_HANDS
    five = (*LI[:2], *ZHOU[:2], "cha_laoban")
    join(game, *five, tick=at(3, 7))  # five, from both families, before the morning
    assert made(game, at(3, 12))["stop"] is None  # nothing stopped the work
    state_of(game)["goals"]["call"]["joined"].clear()
    join(game, *LI, "cha_laoban", tick=at(3, 7))  # five, and all of the Li family
    assert made(game, at(3, 12))["stop"] == board.NO_BOTH
    state_of(game)["goals"]["call"]["joined"].clear()
    join(game, *five, tick=at(3, 13))  # they came after the morning was over
    assert made(game, at(3, 12))["stop"] == board.NO_HANDS
    assert made(game, at(3, 14))["stop"] == board.NO_HANDS  # it is the same morning still
    assert made(game, at(4, 14))["stop"] is None  # the morning of the fourth day had them


def test_a_heavy_rain_stops_the_work_whoever_is_there_and_the_deadline_ends_it():
    game = bridge(3, **HEAVY)
    join(game, *LI[:2], *ZHOU[:2], "cha_laoban", tick=at(3, 7))
    assert made(game, at(3, 12))["stop"] == board.RAIN
    clear = bridge(3, **CLEAR)
    assert made(clear, at(5, 13))["stop"] == board.LATE  # the deadline of the work was the evening
    assert made(clear, at(5, 7))["stop"] == board.NO_HANDS  # of the fourth day: its morning is over
    state_of(clear)["goals"]["done"]["g_labor"] = at(4, 10)
    assert made(clear, at(5, 13))["stop"] is None  # the bridge is mended: nothing stopped it


def test_the_words_for_a_stop_are_in_both_languages():
    for words in (board.NO_HANDS, board.NO_BOTH, board.RAIN, board.LATE):
        assert set(words) == {"zh", "en"} and words["zh"] and words["en"]


# ------------------------------------------------------------------------------ the truth


def statement(*row, fails=()):
    """A full statement in the log: ``(named, accepted, elder, proof, told)``, as ``assembly`` keeps
    them, and the parts that did not hold."""
    return (at(4, 18), TEAHOUSE, *row, [list(fail) for fail in fails])


@pytest.mark.parametrize(
    ("row", "short"),
    [
        ((3, 3, 2, 1, 0), "named"),
        ((9, 4, 2, 1, 0), "accepted"),
        ((9, 8, 0, 1, 0), "elder_absent"),
        ((9, 8, 1, 1, 0), "elder_refused"),
        ((3, 1, 0, 1, 0), "named"),  # the first of the conditions it fell short of
        ((9, 4, 1, 1, 0), "accepted"),
        ((9, 8, 2, 1, 1), ""),
        ((3, 1, 0, 0, 0), "proof"),  # the proof first, then the three of the goal
    ],
)
def test_the_last_statement_says_which_condition_of_the_truth_it_fell_short_of(row, short):
    game = slice_game()
    speech(game, statement(*row))
    last = made(game, at(4, 19))["truth"]["last"]
    named, accepted = row[0], row[1]
    words = statement_words(game, short)
    assert last == {
        "day": 4,
        "hour": 18,
        "venue": TEAHOUSE,
        "named": named,
        "accepted": accepted,
        "percent": 100 * accepted // named,
        "elder": assembly.ELDER_WORD[row[2]],
        "why": words,
    }
    assert assembly.missed(state_of(game)) == short


def statement_words(game, short):
    """The words the board has for a shortfall: the proof, or one of the three of the goal."""
    if not short:
        return None
    return dict(card.PROOF) if short == "proof" else dict(board.SHORT[short])


def test_a_part_that_did_not_hold_comes_before_the_proof_and_the_goal_and_names_its_failure():
    game = slice_game()
    fails = [["cause", "unseen", ""], ["rumour", "contradicted", "gengfu"]]
    speech(game, statement(3, 1, 0, 0, 0, fails=fails))  # and it fell short of all the rest
    assert assembly.missed(state_of(game)) == "parts"
    why = made(game, at(4, 19))["truth"]["last"]["why"]
    assert why == {
        "zh": "成因：没有人亲眼看见。误会缘由：这和更夫亲眼所见矛盾。",
        "en": "Cause: nobody has seen this with their own eyes. "
        "How the rumour began: this contradicts what Night Watchman saw with their own eyes.",
    }
    speech(game, statement(9, 8, 2, 1, 0, fails=[["course", "unsourced", ""]]))
    assert made(game, at(4, 19))["truth"]["last"]["why"] == {
        "zh": "经过：来源对不上。",
        "en": "Course: the sources do not line up.",
    }
    speech(game, statement(9, 8, 2, 1, 1))  # the last one told it
    assert made(game, at(4, 19))["truth"]["last"]["why"] is None


def test_the_words_of_a_shortfall_are_in_both_languages_and_name_the_numbers_of_the_goal():
    assert board.SHORT["named"]["en"] == "Fewer than 5 named people were there"
    assert board.SHORT["named"]["zh"] == "在场有名有姓的人不到五位"
    assert board.SHORT["accepted"]["en"] == "Fewer than 60% of those there accepted"
    assert board.SHORT["accepted"]["zh"] == "在场的人里接受的不到六成"
    assert set(board.SHORT) == set(assembly.MISSED) - {"parts", "proof"}  # those have their own
    for words in board.SHORT.values():
        assert set(words) == {"zh", "en"} and words["zh"] and words["en"]


def test_neither_a_clarification_nor_a_showing_of_evidence_is_a_full_statement():
    game = slice_game()
    speech(game, (at(1, 18), TEAHOUSE, 9, 8, 2, 0))  # a clarification: six fields
    speech(game, (at(1, 18), TEAHOUSE, 9, 8, 2, 0), (at(2, 18), TEAHOUSE, 9, 8, 2, 1, 0))
    assert made(game, at(2, 19))["truth"]["last"] is None  # and a showing of evidence: seven
    assert assembly.last_statement(state_of(game)) is None and assembly.missed(state_of(game)) == ""
    speech(game, statement(9, 4, 2, 1, 0), (at(4, 20), TEAHOUSE, 9, 8, 2, 0))
    last = made(game, at(5, 7))["truth"]["last"]
    assert (last["day"], last["hour"], last["percent"]) == (4, 18, 44)  # not the clarification
    later = (at(5, 18), TEAHOUSE, 9, 8, 2, 1, 1, [])
    speech(game, statement(9, 4, 2, 1, 0), later, (at(5, 19), TEAHOUSE, 9, 8, 2, 1, 0))
    assert made(game, at(5, 20))["truth"]["last"]["day"] == 5  # the later full statement


def test_the_elder_who_accepted_once_counts_as_the_goal_reads_him():
    game = slice_game()
    speech(game, statement(9, 8, 0, 1, 0))
    assert made(game, at(4, 19))["truth"]["last"]["why"] == board.SHORT["elder_absent"]
    state_of(game)["goals"]["flags"]["elder_accepts"] = at(4, 10)  # he accepted in another speech
    assert made(game, at(4, 19))["truth"]["last"]["why"] is None
    assert assembly.missed(state_of(game)) == ""


def test_the_truth_is_done_with_its_flag_and_then_the_last_statement_falls_short_of_nothing():
    game = slice_game()
    speech(game, statement(9, 4, 2, 1, 0))
    assert made(game, at(4, 19))["truth"]["state"] == "open"
    state_of(game)["goals"]["flags"]["truth_told"] = at(4, 19)
    one = made(game, at(4, 20))["truth"]
    assert one["state"] == "done" and one["last"]["why"] is None and one["last"]["percent"] == 44


def test_a_full_statement_leaves_a_row_that_says_if_it_told_the_truth_and_what_did_not_hold():
    assert (assembly.EVIDENCE_ROW, assembly.STATEMENT_ROW) == (7, 8)
    game = slice_game()
    fails = [["course", "unseen", ""]]
    speech(game, (at(4, 18), TEAHOUSE, 9, 8, 2, 1, 0, fails))
    last = assembly.last_statement(state_of(game))
    assert last == {
        "tick": at(4, 18),
        "venue": TEAHOUSE,
        "named": 9,
        "accepted": 8,
        "percent": 88,
        "elder": "accepted",
        "proof": True,
        "cleared": False,
        "fails": fails,
    }


# ------------------------------------------------------------------------------ the peace


def test_the_peace_follows_the_grudge_and_the_flags_of_the_festival():
    game = slice_game()
    flags = state_of(game)["goals"]["flags"]
    state_of(game)["goals"]["metrics"]["grudge"] = 52
    peace = made(game, at(2, 7))["peace"]
    assert peace["grudge"] == 52 and peace["state"] == "open"
    flags["truth_told"] = at(2, 18)
    peace = made(game, at(2, 19))["peace"]
    assert [a["done"] for a in peace["acts"]] == [
        True,
        False,
        False,
    ]  # the truth: nobody blames now
    assert peace["witnessed"] is False
    flags["reconcile_seen"] = at(2, 19)
    state_of(game)["goals"]["metrics"]["grudge"] = 38
    peace = made(game, at(2, 20))["peace"]
    assert [a["done"] for a in peace["acts"]] == [True, False, True] and peace["witnessed"] is True
    assert peace["state"] == "open"  # seen, and the grudge is not low enough yet
    flags["reconciled"] = at(3, 18)
    state_of(game)["goals"]["metrics"]["grudge"] = 17
    peace = made(game, at(3, 19))["peace"]
    assert peace["state"] == "done" and peace["grudge"] == 17


def test_the_acts_that_move_the_peace_are_the_ones_the_core_has_with_their_numbers():
    game = slice_game()
    acts = made(game, 0)["peace"]["acts"]
    assert [a["id"] for a in acts] == ["stop_blaming", "work_together", "witnessed_meal"]
    assert str(peace.STOP_DROP) in acts[0]["text"]["en"]
    assert str(assembly.GRUDGE_DROP) in acts[0]["text"]["zh"]
    assert str(peace.WORK_DROP) in acts[1]["text"]["en"]
    assert str(assembly.MEAL_DROP) in acts[2]["text"]["en"]
    assert str(assembly.MEAL_DROP_AFTER_TRUTH) in acts[2]["text"]["zh"]
    assert (assembly.GRUDGE_DROP, assembly.MEAL_DROP, assembly.MEAL_DROP_AFTER_TRUTH) == (
        10,
        12,
        24,
    )
    assert (peace.STOP_DROP, peace.WORK_DROP, peace.WORK_MORNINGS) == (8, 10, 2)


# ------------------------------------------------------------------------------ what is hidden


@pytest.fixture(scope="module")
def evening():
    """The slice on the second evening, with a crew, a statement the elder turned down and a table
    that was seen, as a snapshot."""
    game = slice_game()
    run_to(game, at(2, 12))
    join(game, *LI[:2], *ZHOU[:2], "cha_laoban", tick=at(2, 9))
    speech(game, statement(9, 8, 1, 1, 0))
    state_of(game)["goals"]["flags"]["reconcile_seen"] = at(2, 18)
    return game.snapshot_json()


@pytest.mark.parametrize("name", list(hidden_changes()))
def test_changing_what_is_hidden_changes_nothing_the_board_says(evening, name):
    twin = Game.from_snapshot_json(evening)
    base = frame_now(twin)["board"]
    assert base["truth"]["last"] is not None and base["peace"]["witnessed"] is True
    before = canon.digest(state_of(twin))
    hidden_changes()[name](state_of(twin))
    assert canon.digest(state_of(twin)) != before  # the change was made
    assert frame_now(twin)["board"] == base
