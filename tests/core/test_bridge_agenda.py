"""The tasks of the slice: what the player is told to do, which of them they follow, and the events
when the one they follow changes.

The game is the slice (``api.preset("slice")``). A route plays it the way the first day goes:
Granny Li at half past six turns the manager down and names the rumour, the madam is asked who told
Granny Li, the clerk is asked who told the madam, and the clerk says what he saw himself. At each
step the tasks are read from the frame, which is all a page has.
"""

from __future__ import annotations

import json

import pytest
from agenda_helpers import (
    changed,
    frame_now,
    idle,
    meet,
    pause,
    slice_game,
    states,
    tasks_of,
    without,
    zh,
)
from bridge_helpers import at, bridge, player, state_of, step
from player_helpers import ack, acks, act, me, plain, put, run_on

import check_content as cc
from bots.base import Bot, Obs
from lantern_core import canon
from lantern_core.api import Game
from lantern_core.inputs import InputError
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import agenda, agenda_terms, clock, order
from lantern_core.world.bridge.data import SCRIPT

WHO_SAID, PROVES = "t_who_said", "t_what_proves"
BAMBOO, TEAHOUSE = "t_bamboo_first", "t_tea_tonight"
LATER = ("t_clear_rumour", "t_li_da_promise")  # they wait for a judgement and for a promise
# the tasks of the bridge for the days after the first: the rest of the bamboo, the timber, the
# helpers, the work of the third and the fourth morning, and the detour
BRIDGE_DAYS_2_TO_5 = (
    "t_bamboo_rest",
    "t_timber",
    "t_helpers",
    "t_work_3",
    "t_work_4",
    "t_detour",
)
# the tasks of the truth and the peace: the lead on how the bridge broke, the statement in public,
# the peace between the families and the festival night
TRUTH_DAYS_2_TO_5 = ("t_how_broke", "t_tell_town", "t_make_peace", "t_festival_night")
# the tasks that keep the manager's promises, one for each of the first twenty
KEEP_PROMISES = tuple(f"t_keep_{n}" for n in range(1, 21))
NO_OPENING = "t_see_for_yourself"  # the first days of a game with no opening rumour
CALL = "t_call_clan"  # and the elder's call, a block of its own at the end of the script


def refuse(game: Game) -> dict:
    """At half past six Granny Li is asked for the bamboo and says no, naming the rumour."""
    run_on(game, at(1, 6, 30))
    meet(game, "li_laotai")
    out = act(game, "entrust", kind="lend")
    assert acks(out) == [("rejected", "hard")]
    return out


def trace(game: Game) -> dict:
    """The rest of the morning: Granny Li is asked about Li Er and the manager follows the lead, the
    madam is asked who told Granny Li, and the clerk says what he saw himself. The last outputs."""
    act(game, "ask", topic="li_er")
    act(game, "track", task=WHO_SAID)
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")
    act(game, "ask_source", entry="n1")
    run_on(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    return act(game, "ask_source", entry="n1")


@pytest.fixture
def small(monkeypatch):
    """Play the game on a script that has only the tasks named."""

    def use(*ids: str) -> None:
        tasks = [task for task in SCRIPT["tasks"] if task["id"] in ids]
        monkeypatch.setattr(agenda, "SCRIPT", {**SCRIPT, "tasks": tasks})
        agenda.book.cache_clear()

    yield use
    monkeypatch.undo()
    agenda.book.cache_clear()


# ------------------------------------------------------------------------------ the content


def test_the_vocabulary_of_the_core_is_the_vocabulary_the_content_is_checked_against():
    assert agenda_terms.spec() == cc.TASK_TERMS
    assert {k: t.later for k, t in agenda_terms.TERMS.items() if t.later} == cc.TASK_TERMS_LATER
    assert cc.TASK_TERMS_LATER == {}  # the judgments, commitments and clarification are read now


def test_the_script_has_the_tasks_of_the_slice_in_the_kinds_of_the_contract():
    tasks = {task["id"]: task for task in SCRIPT["tasks"]}
    assert list(tasks) == [
        BAMBOO,
        WHO_SAID,
        PROVES,
        "t_clear_rumour",
        TEAHOUSE,
        "t_li_da_promise",
        *BRIDGE_DAYS_2_TO_5,
        *TRUTH_DAYS_2_TO_5,
        *KEEP_PROMISES,
        NO_OPENING,
        CALL,
    ]
    assert {t["kind"] for t in tasks.values()} == {"obstacle", "lead", "need", "promise", "venue"}
    assert {t["job"] for t in tasks.values()} <= {"bridge", "truth", "peace", None}
    for task in tasks.values():  # every text is in both languages
        assert task["text"]["zh"] and task["text"]["en"]
        for name in ("why", "next"):
            assert all(option["zh"] and option["en"] for option in task[name])
    assert [w["id"] for w in SCRIPT["wants"]] == [
        "w_elder_lantern",
        "w_li_laotai_public",
        # the people who carry the days (``roles``): what each wants
        "w_li_da_nod",
        "w_li_er_name",
        "w_zhou_ledger",
        "w_zhou_huoji_blame",
        "w_zhou_dalang_peace",
        "w_cha_laoban_house",
        "w_gengfu_heard",
        "w_old_he_quiet",
    ]


def test_the_book_keeps_what_the_content_asks_about_and_orders_the_tasks_by_urgency():
    book = agenda.book()
    assert book.record == {
        "action_ack": ("reason",),
        "agreed": ("npc", "what"),
        "clarified": ("accepted", "prop"),
        "commitment": ("id",),
        "entrusted": ("npc", "pledges", "reason", "request", "result"),
        "look_refused": ("npc", "pledges", "talked"),
        "objection_withdrawn": ("npc",),
        "rally": (),
        "spoke": ("venue",),
        "talk_start": ("npc",),  # the first talk with a person tells the player what they want
    }
    assert book.order == (
        NO_OPENING,
        BAMBOO,
        "t_bamboo_rest",
        "t_li_da_promise",
        "t_timber",
        "t_helpers",
        "t_work_3",
        "t_work_4",
        "t_detour",
        WHO_SAID,
        PROVES,
        "t_clear_rumour",
        TEAHOUSE,
        "t_how_broke",
        CALL,
        "t_tell_town",
        "t_make_peace",
        *KEEP_PROMISES,
        "t_festival_night",
    )
    priorities = [book.by_id[task_id]["priority"] for task_id in book.order]
    assert priorities == sorted(priorities)


# ------------------------------------------------------------------------------ the first moment


def test_the_game_starts_following_the_first_task_and_says_nothing_about_it():
    game = slice_game()
    frame = frame_now(game)  # before a single tick
    assert states(frame) == {BAMBOO: "open"} and frame["tracked"] == BAMBOO
    out = idle(game)
    assert out["frame"]["tracked"] == BAMBOO and changed(out) == []
    task = tasks_of(out["frame"])[BAMBOO]
    assert (task["kind"], task["job"], task["blocker"]) == ("need", "bridge", None)
    # it has no window of its own, so its window is where and when to find the person its button
    # goes to: Granny Li is at home until she goes to the temple at seven
    assert task["window"] == {"day": 1, "from": 6, "to": 7, "place": "p_li_house"}
    assert zh(task["text"]) == "取得李家的第一批竹料"
    assert zh(task["why"]) == "修桥要竹料，竹料在李家。"
    assert zh(task["next"]) == "去李家，请李老太借竹料。"
    assert task["action"] == {"verb": "entrust", "npc": "li_laotai", "item": "bamboo"}
    assert state_of(game)["agenda"]["tracked"] == BAMBOO
    assert "track" not in out["frame"]["hud"]["verbs"]  # there is nothing else to follow yet


def test_a_game_of_the_bridge_without_the_opening_has_the_first_task_too():
    game = bridge(1)
    run_on(game, 100)
    assert states(frame_now(game)) == {BAMBOO: "open"} and frame_now(game)["tracked"] == BAMBOO


# ------------------------------------------------------------------------------ the route


def test_after_the_refusal_the_bamboo_is_blocked_with_her_reason_and_a_next_step():
    game = slice_game()
    out = refuse(game)
    frame = out["frame"]
    assert states(frame) == {BAMBOO: "blocked", WHO_SAID: "open"}  # what waits for later is not in
    bamboo = tasks_of(frame)[BAMBOO]
    assert zh(bamboo["blocker"]) == "李家不肯给竹料"
    assert bamboo["blocker"]["en"] == "The Li family will not give the bamboo"
    assert zh(bamboo["why"]) == "李老太说镇上都传她家老二毁了桥，你却一声不吭。"
    assert (
        bamboo["why"]["en"]
        == "Granny Li says the town blames her second son, and you said nothing."
    )
    assert zh(bamboo["next"]) == "问清这话是从哪里传出来的。"
    assert bamboo["next"]["en"] == "Find out where that talk came from."
    # nobody has been asked yet: the button asks her about the second son, on whom the rumour hangs
    assert bamboo["action"] == {"verb": "ask", "npc": "li_laotai", "item": "li_er"}
    assert frame["tracked"] == BAMBOO  # a task that is blocked is still the one followed
    assert changed(out) == []
    lead = tasks_of(frame)[WHO_SAID]
    assert lead["kind"] == "lead" and lead["job"] == "truth" and lead["blocker"] is None
    assert zh(lead["text"]) == "李二毁桥这话是谁传的？"
    assert zh(lead["next"]) == "问问周围的人，这话是听谁说的？"
    assert "track" in frame["hud"]["verbs"]  # now there is something else to follow


def test_the_tasks_are_listed_with_the_most_urgent_first():
    game = slice_game()
    assert [t["id"] for t in refuse(game)["frame"]["tasks"]] == [BAMBOO, WHO_SAID]
    run_on(game, at(1, 15, 0))
    assert [t["id"] for t in idle(game)["frame"]["tasks"]] == [BAMBOO, WHO_SAID, TEAHOUSE]


def test_asking_about_the_rumour_points_the_way_back_along_the_trail():
    game = slice_game()
    refuse(game)
    out = act(game, "ask", topic="li_er")
    tasks = tasks_of(out["frame"])
    assert zh(tasks[WHO_SAID]["next"]) == "顺着传话的人往回问：你是听谁说的？"
    assert tasks[WHO_SAID]["action"] == {"verb": "ask_source", "npc": "cha_laoban"}
    assert tasks[BAMBOO]["action"] == {"verb": "ask_source", "npc": "cha_laoban"}
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")
    out = act(game, "ask_source", entry="n1")
    assert tasks_of(out["frame"])[WHO_SAID]["action"] == {"verb": "ask_source", "npc": "zhou_huoji"}
    assert states(out["frame"]) == {BAMBOO: "blocked", WHO_SAID: "open"}  # not yet at the clerk


def test_following_a_task_is_a_choice_of_the_player_and_the_event_says_so():
    game = slice_game()
    refuse(game)
    out = act(game, "track", task=WHO_SAID)
    assert ack(out) == ("applied", None)
    assert out["frame"]["tracked"] == WHO_SAID and state_of(game)["agenda"]["tracked"] == WHO_SAID
    (event,) = changed(out)
    assert (event["from"], event["to"], event["cause"]) == (BAMBOO, WHO_SAID, "chosen")
    assert event["reason"] == {
        "zh": "你改为追踪「李二毁桥这话是谁传的？」",
        "en": "You now follow “Who started the talk that Li Er wrecked the bridge?”",
    }
    again = act(game, "track", task=WHO_SAID)  # the one that is followed: nothing changes
    assert ack(again) == ("applied", None) and changed(again) == []


def test_when_the_clerk_says_what_he_saw_the_lead_is_done_and_the_next_one_is_followed():
    game = slice_game()
    refuse(game)
    act(game, "ask", topic="li_er")
    act(game, "track", task=WHO_SAID)
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")
    act(game, "ask_source", entry="n1")
    run_on(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    assert states(idle(game)["frame"]) == {BAMBOO: "blocked", WHO_SAID: "open"}
    out = act(game, "ask_source", entry="n1")  # he says he saw Li Er at the bridge himself
    assert states(out["frame"]) == {BAMBOO: "blocked", WHO_SAID: "done", PROVES: "open"}
    (event,) = changed(out)
    assert (event["from"], event["to"], event["cause"]) == (WHO_SAID, PROVES, "done")
    assert (
        event["reason"]["zh"] == "「李二毁桥这话是谁传的？」办成了，接着追踪「这些话能证明什么？」"
    )
    assert event["reason"]["en"] == (
        "“Who started the talk that Li Er wrecked the bridge?” is done. "
        "Now following “What do these words prove?”"
    )
    assert out["frame"]["tracked"] == PROVES
    done = tasks_of(out["frame"])[WHO_SAID]  # a task that is done says nothing more
    assert (done["why"], done["next"], done["action"], done["blocker"]) == (None, None, None, None)
    proves = tasks_of(out["frame"])[PROVES]
    assert zh(proves["next"]) == "把原话摆在一起比一比，看它们是什么关系。"
    assert proves["why"]["en"].startswith("What the clerk saw himself")
    assert proves["action"] == {"verb": "judge"}  # the lines are set side by side in the notebook
    assert state_of(game)["agenda"]["tasks"][WHO_SAID]["since"] == out["tick"]
    assert not set(states(out["frame"])) & {"t_clear_rumour", "t_li_da_promise"}


def test_the_lead_is_done_by_the_clerks_own_words_whether_or_not_the_trail_was_walked():
    game = slice_game()
    refuse(game)
    act(game, "leave")
    run_on(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    first = act(game, "ask", topic="li_er")  # what he heard from the second son: a rumour
    assert states(first["frame"]) == {BAMBOO: "blocked", WHO_SAID: "open", PROVES: "open"} or (
        states(first["frame"]) == {BAMBOO: "blocked", WHO_SAID: "open"}
    )
    second = act(game, "ask", topic="li_er")  # and what he saw himself
    assert states(second["frame"]) == {BAMBOO: "blocked", WHO_SAID: "done", PROVES: "open"}
    assert second["frame"]["tracked"] == BAMBOO and changed(second) == []  # not the one followed


def test_the_teahouse_comes_in_the_afternoon_with_its_window_and_the_people_expected():
    game = slice_game()
    run_on(game, at(1, 14, 59))
    assert TEAHOUSE not in states(idle(game)["frame"])
    run_on(game, at(1, 15, 0))
    frame = idle(game)["frame"]
    venue = tasks_of(frame)[TEAHOUSE]
    assert (venue["kind"], venue["job"], venue["state"]) == ("venue", "truth", "open")
    assert venue["window"] == {"day": 1, "from": 17, "to": 19, "place": "p_teahouse"}
    assert venue["action"] is None  # the walk is offered from four, an hour before the window
    run_on(game, at(1, 16, 0))
    assert tasks_of(idle(game)["frame"])[TEAHOUSE]["action"] == {
        "verb": "move",
        "place": "p_teahouse",
    }
    assert zh(venue["text"]) == "今晚茶馆" and venue["text"]["en"] == "The teahouse tonight"
    assert all(set(p) == {"id", "from", "to"} for p in venue["expected"])
    expected = {p["id"]: p for p in venue["expected"]}
    for who in ("zuzhang", "cha_laoban", "zhou_huoji", "li_laotai", "li_da"):  # the five
        assert (expected[who]["from"], expected[who]["to"]) == (17 * 60 + 30, 19 * 60)
    assert expected["sishu_xiansheng"]["to"] == 18 * 60 + 8  # he goes to his books
    assert expected["old_he"]["from"] == 18 * 60 + 12  # and the boatman comes late
    assert "li_er" not in expected and "gengfu" not in expected
    cast = [p["id"] for p in json.loads(game.scene_json())["cast"]]
    assert list(expected) == sorted(expected, key=cast.index)  # in the order of the cast


def test_the_evening_passes_and_the_teahouse_goes_stale_unused():
    game = slice_game()
    run_on(game, at(1, 18, 59))
    assert states(idle(game)["frame"])[TEAHOUSE] == "open"
    assert frame_now(game)["tracked"] == TEAHOUSE  # its window has been open since five
    run_on(game, at(1, 19, 0))
    out = idle(game)
    assert states(out["frame"])[TEAHOUSE] == "stale"
    (event,) = changed(out)  # it was the one followed, in its window: the first task is again
    assert (event["from"], event["to"], event["cause"]) == (TEAHOUSE, BAMBOO, "stale")
    assert tasks_of(out["frame"])[TEAHOUSE]["next"] is None


def test_a_followed_task_that_goes_stale_hands_over_to_the_most_urgent_open_one():
    game = slice_game()
    run_on(game, at(1, 16, 0))
    assert act(game, "track", task=TEAHOUSE)["frame"]["tracked"] == TEAHOUSE
    seen = []
    while game.tick < at(1, 19, 2):
        seen += changed(idle(game))
    (event,) = seen
    assert (event["from"], event["to"], event["cause"]) == (TEAHOUSE, BAMBOO, "stale")
    assert event["reason"]["zh"] == "「今晚茶馆」已经过期，改追踪「取得李家的第一批竹料」"
    assert event["reason"]["en"] == (
        "“The teahouse tonight” has lapsed. Now following “Get the first bamboo from the Li family”"
    )
    assert state_of(game)["agenda"]["tracked"] == BAMBOO


def test_when_the_one_followed_ends_a_blocked_task_is_followed_if_none_is_open():
    game = slice_game()
    refuse(game)  # the bamboo is blocked, the lead is open
    run_on(game, at(1, 16, 0))
    assert act(game, "track", task=TEAHOUSE)["frame"]["tracked"] == TEAHOUSE
    state_of(game)["agenda"]["tasks"][WHO_SAID]["state"] = "done"  # a case set up by hand
    seen = []
    while game.tick < at(1, 19, 2):
        seen += changed(idle(game))
    (event,) = seen
    assert (event["from"], event["to"], event["cause"]) == (TEAHOUSE, BAMBOO, "stale")
    assert tasks_of(frame_now(game))[BAMBOO]["state"] == "blocked"


def test_nothing_is_followed_when_nothing_is_left_and_the_next_task_to_open_is(small):
    small(TEAHOUSE)
    game = slice_game()
    assert frame_now(game)["tasks"] == [] and frame_now(game)["tracked"] is None
    run_on(game, at(1, 14, 59))
    assert idle(game)["frame"]["tracked"] is None
    run_on(game, at(1, 15, 0))
    out = idle(game)
    (event,) = changed(out)
    assert (event["from"], event["to"], event["cause"]) == (None, TEAHOUSE, "new")
    assert event["reason"] == {
        "zh": "有了新的事项：「今晚茶馆」",
        "en": "A new task: “The teahouse tonight”",
    }
    assert out["frame"]["tracked"] == TEAHOUSE
    seen = []
    while game.tick < at(1, 19, 2):
        seen += changed(idle(game))
    (event,) = seen
    assert (event["from"], event["to"], event["cause"]) == (TEAHOUSE, None, "stale")
    assert event["reason"] == {
        "zh": "「今晚茶馆」已经过期，眼下没有别的事项",
        "en": "“The teahouse tonight” has lapsed. There is nothing else to follow for now",
    }
    out = idle(game)
    assert out["frame"]["tracked"] is None and state_of(game)["agenda"]["tracked"] == ""
    assert "track" not in out["frame"]["hud"]["verbs"]


# ------------------------------------------------------------------------------ no time


def test_following_a_task_costs_no_time_in_a_paused_world():
    game = slice_game()
    refuse(game)
    pause(game)
    tick, before = game.tick, without(game, "agenda")
    seq = game.next_seq
    out = act(game, "track", task=WHO_SAID)
    assert out["advanced"] is False and game.tick == tick and game.paused
    assert changed(out)[0]["to"] == WHO_SAID and state_of(game)["agenda"]["tracked"] == WHO_SAID
    assert without(game, "agenda") == before  # nothing in the town moved, nothing was drawn
    assert game.next_seq == seq + 1


def test_following_a_task_changes_nothing_but_which_task_is_followed():
    twin = slice_game()
    game = slice_game()
    for each in (twin, game):
        refuse(each)
    assert twin.tick == game.tick
    idle(twin)
    act(game, "track", task=WHO_SAID)  # it is one call, like the one that carries nothing
    assert twin.tick == game.tick
    assert without(game, "agenda") == without(twin, "agenda")
    assert game._kernel.state["rng"] == twin._kernel.state["rng"]
    assert state_of(game)["agenda"]["tracked"] == WHO_SAID
    assert state_of(twin)["agenda"]["tracked"] == BAMBOO


def test_an_action_id_that_was_seen_follows_once():
    game = slice_game()
    refuse(game)
    body = {"action_id": "follow-1", "type": "track", "task": WHO_SAID}
    first = step(game, player(game.next_seq, body))
    again = step(game, player(game.next_seq, body))
    assert len(changed(first)) == 1 and changed(again) == []
    assert [e["result"] for e in again["events"] if e["kind"] == "action_ack"] == ["duplicate"]


def test_a_task_that_is_not_there_or_has_ended_cannot_be_followed():
    game = slice_game()
    refuse(game)
    assert acks(act(game, "track", task="t_nowhere")) == [("rejected", "unknown_task")]
    for waiting in (
        "t_clear_rumour",
        "t_li_da_promise",
    ):  # not in, because their terms hold nothing
        assert acks(act(game, "track", task=waiting)) == [("rejected", "unknown_task")]
    assert acks(act(game, "track", task=TEAHOUSE)) == [
        ("rejected", "unknown_task")
    ]  # not yet 15:00
    run_on(game, at(1, 19, 1))
    assert acks(act(game, "track", task=TEAHOUSE)) == [("rejected", "not_open")]  # it has lapsed
    assert state_of(game)["agenda"]["tracked"] == BAMBOO
    for body in ({}, {"task": ""}, {"task": 5}, {"task": "x" * 65}):
        with pytest.raises(InputError, match="task"):
            step(game, player(game.next_seq, {"action_id": "bad", "type": "track", **body}))


def test_track_is_a_verb_whenever_there_is_another_task_to_follow_even_in_a_talk():
    game = slice_game()
    assert "track" not in idle(game)["frame"]["hud"]["verbs"]
    refuse(game)  # in a talk, with two tasks
    verbs = idle(game)["frame"]["hud"]["verbs"]
    assert "track" in verbs and "leave" in verbs and verbs[-1] == "track"
    act(game, "leave")
    assert "track" in idle(game)["frame"]["hud"]["verbs"]
    out = act(game, "track", task=WHO_SAID)  # the other one is the first now: still something
    assert "track" in out["frame"]["hud"]["verbs"]
    state_of(game)["agenda"]["tasks"][BAMBOO]["state"] = "done"  # the only other has ended
    assert "track" not in idle(game)["frame"]["hud"]["verbs"]


# ------------------------------------------------------------------------------ the state


def test_the_section_is_in_the_hash_and_holds_plain_values_only():
    assert "agenda" in order.SECTIONS and order.SUBSYSTEMS[-2].SECTION == "agenda"
    game = slice_game()
    refuse(game)
    trace(game)
    plain(game._kernel.state)
    assert json.loads(game.snapshot_json()) == game._kernel.state
    base = game.hash()
    for change in (
        lambda s: s["agenda"].update(tracked=BAMBOO),
        lambda s: s["agenda"]["tasks"][BAMBOO].update(since=1),
        lambda s: s["agenda"]["wants"].update(w_li_laotai_public=0),
    ):
        before = json.loads(game.snapshot_json())
        change(state_of(game))
        assert game.hash() != base
        state_of(game).clear()
        state_of(game).update(before["world"])
        assert game.hash() == base


def test_the_events_it_keeps_are_the_ones_the_content_asks_about_and_each_once():
    game = slice_game()
    refuse(game)
    rows = state_of(game)["agenda"]["seen"]
    assert rows == [
        ["talk_start", rows[0][1], {"npc": "li_laotai"}],  # the talk opens (and she greets)
        ["action_ack", rows[1][1], {"reason": None}],  # the ack of her talk opening
        [
            "entrusted",
            rows[2][1],
            {
                "npc": "li_laotai",
                "request": "lend",
                "result": "hard",
                "reason": "hard_hc_li_bamboo_rumour",
                "pledges": 0,  # what the manager had promised her when she answered
            },
        ],
        ["action_ack", rows[3][1], {"reason": "hard"}],  # and the ack of the refusal
    ]
    act(game, "entrust", kind="lend")  # asked again, with nothing changed: she says it again
    run_on(game, at(1, 12, 0))
    kinds = {row[0] for row in state_of(game)["agenda"]["seen"]}
    assert kinds <= {"action_ack", "entrusted", "objection_withdrawn", "spoke", "talk_start"}
    rows = state_of(game)["agenda"]["seen"]
    assert len({json.dumps(row[2:], sort_keys=True) + row[0] for row in rows}) == len(rows)
    results = [row[2]["result"] for row in rows if row[0] == "entrusted"]
    assert results == ["hard", "said_already"]  # her answer once, and "said already" once


# ------------------------------------------------------------------------------ save and replay


def test_what_is_followed_survives_a_save_and_a_restore_and_the_games_stay_one():
    game = slice_game()
    refuse(game)
    act(game, "ask", topic="li_er")
    act(game, "track", task=WHO_SAID)
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert twin.hash() == game.hash()
    assert state_of(twin)["agenda"] == state_of(game)["agenda"]
    assert frame_now(twin)["tracked"] == WHO_SAID
    assert frame_now(twin)["tasks"] == frame_now(game)["tasks"]
    twin_events, game_events = [], []
    for each, seen in ((twin, twin_events), (game, game_events)):
        act(each, "leave")
        run_on(each, at(1, 8, 0))
        meet(each, "cha_laoban")
        act(each, "ask_source", entry="n1")
        run_on(each, at(1, 12, 20))
        meet(each, "zhou_huoji")
        seen += changed(act(each, "ask_source", entry="n1"))
    assert twin_events == game_events and twin_events[0]["cause"] == "done"
    assert twin.hash() == game.hash() and frame_now(twin)["tracked"] == PROVES


def test_a_restored_game_does_not_say_again_what_the_first_one_said():
    game = slice_game()
    refuse(game)
    trace(game)
    twin = Game.from_snapshot_json(game.snapshot_json())
    for _ in range(20):
        a, b = idle(game), idle(twin)
        assert a == b and changed(a) == []
    assert twin.hash() == game.hash()


class Follower(Bot):
    """Granny Li at half past six, then the clerk at noon, following a lead on the way."""

    name = "follower"

    def play(self):
        if (yield from self.meet("li_laotai")):
            yield from self.entrust("lend")
            yield from self.act("ask", topic="li_er")
            yield from self.act("track", task=WHO_SAID)
            yield from self.leave()
        yield from self.wait_until(1, 12, 20)
        if (yield from self.meet("zhou_huoji")):
            for _ in range(3):
                yield from self.act("ask", topic="li_er")
            yield from self.leave()
        while True:
            yield None


def test_a_recording_with_the_manager_following_tasks_replays_to_the_same_game():
    game = slice_game()
    recorder = Recorder(game)
    bot = Follower(json.loads(game.scene_json()), 492)
    obs = Obs(json.loads(recorder.step("[]")))
    kinds = []
    while game.tick < at(1, 13, 30):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(recorder.step(json.dumps(records)))
        kinds += [(e["cause"], e["to"]) for e in changed(out)]
        obs = Obs(out)
    # the lead is done and the bamboo, blocked with a trail still to walk, is the most urgent
    assert kinds == [("chosen", WHO_SAID), ("done", BAMBOO)]
    recording = canon.loads(canon.dumps_str(recorder.recording()))  # as a file would carry it
    assert any(row[2] == "player" and row[3].get("type") == "track" for row in recording["records"])
    again = rebuild(recording)  # it checks every hash on the way
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()
    assert frame_now(again)["tracked"] == BAMBOO


# ------------------------------------------------------------------------------ the terms


def env_at(game: Game, tick: int) -> agenda_terms.Env:
    kernel = game._kernel
    return agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(tick))


def test_a_window_and_a_moment_are_read_off_the_clock_and_the_small_hours_come_after_the_evening():
    game = slice_game()
    window = {"kind": "window", "day": 1, "from": 17, "to": 19}
    ticks = {
        at(1, 16, 59): False,
        at(1, 17, 0): True,
        at(1, 18, 59): True,
        at(1, 19, 0): False,
        at(2, 17, 30): False,
    }
    for tick, wanted in ticks.items():
        assert agenda_terms.holds(env_at(game, tick), window) is wanted, clock.at(tick)
    late = {"kind": "window", "day": 1, "from": 21, "to": 24}
    assert agenda_terms.holds(env_at(game, at(1, 23, 30)), late)
    assert not agenda_terms.holds(env_at(game, at(1, 2, 0)), late)  # two in the morning: later
    midnight = {"kind": "after", "day": 1, "hour": 24}
    assert not agenda_terms.holds(env_at(game, at(1, 23, 59)), midnight)
    assert agenda_terms.holds(env_at(game, at(1, 2, 0)), midnight)
    assert agenda_terms.holds(env_at(game, at(2, 6, 0)), midnight)
    evening = {"kind": "after", "day": 1, "hour": 21}
    assert agenda_terms.holds(env_at(game, at(1, 2, 0)), evening)
    assert not agenda_terms.holds(env_at(game, at(1, 20, 59)), evening)


def test_the_combinators_and_the_empty_list():
    env = env_at(slice_game(), 0)
    yes, no = {"kind": "after", "day": 1, "hour": 6}, {"kind": "after", "day": 2, "hour": 6}
    assert agenda_terms.holds(env, {"all": [yes, yes]}) and not agenda_terms.holds(
        env, {"all": [yes, no]}
    )
    assert agenda_terms.holds(env, {"any": [no, yes]}) and not agenda_terms.holds(
        env, {"any": [no, no]}
    )
    assert agenda_terms.holds(env, {"not": no}) and not agenda_terms.holds(env, {"not": yes})
    assert agenda_terms.holds_all(env, []) and agenda_terms.holds_all(env, [yes])
    assert not agenda_terms.holds_all(env, [yes, no])
    nested = [{"any": [{"not": yes}, {"all": [yes, {"kind": "judged"}]}]}]
    assert [leaf["kind"] for leaf in agenda_terms.leaves(nested)] == ["after", "after", "judged"]


def test_events_are_matched_on_the_fields_asked_for_and_a_refusal_on_its_reason():
    game = slice_game()
    refuse(game)
    env = env_at(game, game.tick)
    reason = "hard_hc_li_bamboo_rumour"
    assert agenda_terms.holds(env, {"kind": "refused", "npc": "li_laotai"})
    assert agenda_terms.holds(env, {"kind": "refused", "npc": "li_laotai", "reason": reason})
    assert not agenda_terms.holds(
        env, {"kind": "refused", "npc": "li_laotai", "reason": "hard_other"}
    )
    assert not agenda_terms.holds(env, {"kind": "refused", "npc": "li_da"})
    entrusted = {"kind": "event", "event": "entrusted"}
    assert agenda_terms.holds(env, entrusted)  # any field
    assert agenda_terms.holds(env, {**entrusted, "where": {"npc": "li_laotai", "result": "hard"}})
    assert not agenda_terms.holds(
        env, {**entrusted, "where": {"npc": "li_laotai", "result": "agreed"}}
    )
    assert not agenda_terms.holds(env, {"kind": "event", "event": "spoke"})


def test_a_note_is_held_by_its_prop_and_first_hand_by_who_says_they_saw_it():
    game = slice_game()
    refuse(game)
    rumour = {"kind": "note", "props": ["pr_liner_damaged_jealous", "pr_liner_damaged"]}
    seen = {
        "kind": "note_first_hand",
        "props": ["pr_liner_at_bridge", "pr_liner_looking"],
        "by": "zhou_huoji",
    }
    assert not agenda_terms.holds(env_at(game, game.tick), rumour)
    act(game, "ask", topic="li_er")
    env = env_at(game, game.tick)
    assert agenda_terms.holds(env, rumour) and not agenda_terms.holds(env, seen)
    run_on(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    act(game, "ask", topic="li_er")  # what he heard from the second son: not what he saw
    assert not agenda_terms.holds(env_at(game, game.tick), seen)
    act(game, "ask", topic="li_er")  # now what he saw
    assert agenda_terms.holds(env_at(game, game.tick), seen)
    other = {**seen, "by": "cha_laoban"}
    assert not agenda_terms.holds(env_at(game, game.tick), other)


def test_the_player_is_at_a_place_when_they_stand_within_reach_of_it():
    game = slice_game()  # the manager starts on the bridge
    assert agenda_terms.holds(env_at(game, 0), {"kind": "at_place", "place": "p_bridge"})
    assert not agenda_terms.holds(env_at(game, 0), {"kind": "at_place", "place": "p_teahouse"})


def test_a_flag_is_up_when_the_festival_raised_it():
    game = slice_game()
    flag = {"kind": "flag", "flag": "bamboo_delivered"}
    assert not agenda_terms.holds(env_at(game, 0), flag)
    state_of(game)["goals"]["flags"]["bamboo_delivered"] = 5
    assert agenda_terms.holds(env_at(game, 0), flag)
    state_of(game)["goals"] = {}  # a world whose section is not the festival's
    assert not agenda_terms.holds(env_at(game, 0), flag)


# ------------------------------------------------------------------------------ terms read later


def test_terms_that_read_a_judgement_a_clarification_or_a_promise_hold_nothing_before_any_is_made():
    game = slice_game()
    refuse(game)
    trace(game)
    env = env_at(game, game.tick)
    waiting = [
        {"kind": "clarified"},
        {"kind": "clarified", "props": ["pr_li_damaged"]},
        {"kind": "commitment", "by": "li_da", "item": "bamboo", "state": "promised"},
    ]
    assert not any(agenda_terms.holds(env, cond) for cond in waiting)
    frame = frame_now(game)
    assert not set(states(frame)) & set(LATER)
    assert states(frame)[PROVES] == "open"  # it is done on a judgment, which nobody has made yet


def test_a_subsystem_that_says_what_its_term_reads_makes_the_tasks_react(monkeypatch):
    game = slice_game()
    refuse(game)
    trace(game)
    assert states(frame_now(game))[PROVES] == "open"

    def read(env, cond):
        return bool(env.state["player"].get("judgments"))

    old = agenda_terms.TERMS["judged"]
    monkeypatch.setitem(
        agenda_terms.TERMS, "judged", agenda_terms.Term(old.spec, read, old.records, later="")
    )
    agenda.book.cache_clear()
    try:
        out = idle(game)  # nothing is judged yet
        assert states(out["frame"])[PROVES] == "open" and "t_clear_rumour" not in states(
            out["frame"]
        )
        me(game)["judgments"] = [["n1", "n2", "unsupported", game.tick]]  # as the package will
        game._kernel.state["version"] += 1  # and it makes an event when it does
        out = idle(game)
        assert states(out["frame"])[PROVES] == "done"
        assert states(out["frame"])["t_clear_rumour"] == "open"
        (event,) = changed(out)  # the lead that was followed is done: the next one is followed
        assert (event["from"], event["cause"]) == (PROVES, "done")
        assert event["to"] == "t_clear_rumour"
        clear = tasks_of(out["frame"])["t_clear_rumour"]
        assert clear["kind"] == "obstacle" and zh(clear["next"]).startswith("用你判对了的两句话")
        # the card says the evening at the teahouse for its window, every day, and has no button yet
        assert clear["action"] is None
        assert clear["window"] == {"day": 1, "from": 17, "to": 19, "place": "p_teahouse"}
        put(game, *json.loads(game.scene_json())["player"]["start"])  # on the bridge
        run_on(game, at(1, 16, 0))
        away = tasks_of(idle(game)["frame"])["t_clear_rumour"]
        assert away["action"] == {"verb": "move", "place": "p_teahouse"}  # from four it walks there
        run_on(game, at(1, 17, 0))
        assert tasks_of(idle(game)["frame"])["t_clear_rumour"]["action"]["verb"] == "move"
        put(game, *game._kernel.world.town.places["p_teahouse"].rect[:2])
        assert (
            tasks_of(idle(game)["frame"])["t_clear_rumour"]["action"] is None
        )  # by six they are all there
        run_on(game, at(1, 18, 0))
        speak = tasks_of(idle(game)["frame"])["t_clear_rumour"]["action"]
        assert speak == {"verb": "speak", "kind": "clarify"}
    finally:
        monkeypatch.undo()
        agenda.book.cache_clear()


# ------------------------------------------------------------------------------ a world without it


def test_a_world_that_has_not_the_subsystem_plays_as_it_did_and_has_no_task_to_follow(monkeypatch):
    others = tuple(m for m in order.SUBSYSTEMS if m.SECTION != "agenda")
    monkeypatch.setattr(order, "SUBSYSTEMS", others)
    game = bridge(1)
    assert state_of(game)["agenda"] == {}
    out = act(game, "move", place="p_teahouse")  # an action: nothing looks at the tasks after it
    assert acks(out) == [("applied", None)]
    assert not {"tasks", "tracked", "cards"} & set(out["frame"])
    assert "track" not in out["frame"]["hud"]["verbs"]
    with pytest.raises(InputError, match="unknown type"):
        act(game, "track", task=BAMBOO)
    run_on(game, 300)
    assert state_of(game)["agenda"] == {}
