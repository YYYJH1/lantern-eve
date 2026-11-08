"""The tasks of the truth and the peace, from the second day: the lead on how the bridge broke, the
obstacle of the statement in public, the peace between the families, the elder's call and the
festival night.

The tasks must never give the truth away. The game has three stories, and a task that comes, or
points somewhere, in one of them alone tells the player which it is. So each one reads only what
the manager did or holds (what they looked for, the evidence in hand, the last statement they made
in public), the flags of the festival and the hour, and the tests here play the same moves in all
three stories, change what is hidden and look again, and compare.

The route is ``truth_helpers.TruthRoute``: the first day of the slice to the clarification and Li
Da, then the days of the lead as the script's table of opportunities opens them (the rail and the
boat on the second afternoon, the water and the boy on the third, the watchman on the fourth night),
five helpers from both families at the bridge on the mornings of the third and the fourth day, and
on the fifth evening the statement at the teahouse and the table for the two heads. The people the
lead sends the manager to trust the manager as far as 40 in it (the persuasion is not under test
here, and the tests that leave it out say so).
"""

from __future__ import annotations

import json
import re

import pytest
from agenda_helpers import frame_now, idle, meet, slice_game, tasks_of
from bridge_helpers import CAST, at, run_to, state_of, world_of
from dealings_helpers import talking
from player_helpers import acks, act, me, put
from statement_helpers import bear, fill, state_it, stated
from truth_helpers import (
    CALL,
    CAUSE_ITEMS,
    TASKS,
    VARIANTS,
    AloneRoute,
    HallRoute,
    hidden_changes,
    play_route,
    told,
)

import check_content as cc
from bots.base import Obs
from lantern_core import canon
from lantern_core.api import Game, preset
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    agenda,
    agenda_terms,
    assembly,
    bonds,
    clock,
    entrust,
    goals_call,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

LEAD, TELL, PEACE, NIGHT = TASKS
BOOK = {task["id"]: task for task in SCRIPT["tasks"]}
# the options of the lists of the lead, by the step each one says, in the order of the script: the
# rail, the water, then for each of the boat owner, the watchman and the boy by the river the step
# when they turned the manager away (a talk first, a promise, a wait) and the step itself, and last
# what the days ahead hold, when nothing is to be had today
STEP = {
    "rail": 0,
    "water": 1,
    "boat_talk": 2,
    "boat_promise": 3,
    "boat_wait": 4,
    "boat": 5,
    "watch_talk": 6,
    "watch_promise": 7,
    "watch_wait": 8,
    "watch": 9,
    "river_talk": 10,
    "river_promise": 11,
    "river_wait": 12,
    "river": 13,
    "ahead2": 14,  # the water falls on the third morning, the watchman speaks on the fourth night
    "ahead3": 15,  # the water has fallen: the pier by day, the boy in the evening
    "ahead3b": 16,  # the pier is done: the boy in the evening
    "ahead4": 17,  # only the watchman is left, after dark on the fourth day
    "tonight": 18,  # it is the fourth day: the watchman, after dark
    "wait": 19,
}
# the options of the reasons and next steps of the obstacle, by what the last statement missed; the
# next steps go on with the card filled in, the evening of the fourth day come, and not yet
SHORT = {
    "parts": 0, "proof": 1, "named": 2, "accepted": 3, "elder_absent": 4, "elder_refused": 5,
    "nothing": 6,
}  # fmt: skip
SHORT_NEXT = {key: number for key, number in SHORT.items() if key != "nothing"}
NEXT_STATE = {
    "hall": 6, "ready": 7, "stated": 8, "unfilled": 9, "waiting": 10, "gathering": 11,
}  # fmt: skip
# and those of the peace: a grudge that is low and nobody saw it come down, a table that was seen
# with the truth told, seen, the truth told, the work at the bridge still to come, nothing yet
TABLE = {"unseen": 0, "seen_told": 1, "seen": 2, "told": 3, "work": 4, "neither": 5}
UNSEEN_WHY, SEEN_WHY, TOLD_WHY, NEITHER_WHY = 0, 1, 2, 3
TEAHOUSE = "p_teahouse"
EVENING = {"day": None, "from": 17, "to": 19, "place": TEAHOUSE}


def EVIDENCE_DAY(day):  # noqa: N802  (the window of the obstacle: the evening of a day)
    return {**EVENING, "day": day}


def words(task_id: str, key: str, number: int) -> str:
    """The English words of an option of ``why`` or ``next`` of a task, as the script lists them."""
    return BOOK[task_id][key][number]["en"]


def card(marks, label: str, task_id: str):
    """The card of a task at a mark of the route, or None if it has not appeared."""
    found = [c for c in marks[label]["tasks"] if c["id"] == task_id]
    return found[0] if found else None


def env_at(game: Game, tick: int) -> agenda_terms.Env:
    kernel = game._kernel
    return agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(tick))


def hold(game: Game, *items: str) -> None:
    """Set up the case: the manager holds this evidence, and the tasks look again (what the manager
    holds is a thing they look again for when an event, the hour or the cell moves)."""
    me(game)["evidence"].extend(items)
    game._kernel.state["version"] += 1
    idle(game)


def set_grudge(game: Game, value: int) -> None:
    """Set up the case: each head holds this grudge against the other (the metric follows on the
    next tick, as it does for everything that moves the bonds)."""
    social, lo = state_of(game)["social"], lore()
    first, second = goals_call.HEADS
    for holder, target in ((first, second), (second, first)):
        while (now := bonds.value(social, lo, holder, target, bonds.GRUDGE)) != value:
            bonds.nudge(social, lo, holder, target, bonds.GRUDGE, value - now)


def speak_row(game: Game, *row) -> None:
    """Set up the case: this is the only speech in public the manager made, and the tasks look
    again (a speech is an event, which is what makes them look)."""
    state_of(game)["player"]["public"]["speeches"][:] = [list(row)]
    game._kernel.state["version"] += 1
    idle(game)


# ------------------------------------------------------------------------------ the content


def strings(task: dict) -> list[str]:
    """Every word a player is told by a task, in both languages."""
    found = [task["text"]["zh"], task["text"]["en"]]
    for key in ("why", "next"):
        for option in task[key]:
            found += [option["zh"], option["en"]]
    for rule in task["blocked"]:
        found += [rule["blocker"]["zh"], rule["blocker"]["en"]]
        for key in ("why", "next"):
            for option in rule[key]:
                found += [option["zh"], option["en"]]
    return found


def test_the_tasks_come_in_the_kinds_and_jobs_of_the_brief_with_their_titles():
    ids = [task["id"] for task in SCRIPT["tasks"]]
    assert [i for i in ids if i in TASKS] == list(TASKS)
    assert [(BOOK[i]["kind"], BOOK[i]["job"]) for i in (*TASKS, CALL)] == [
        ("lead", "truth"),
        ("obstacle", "truth"),
        ("need", "peace"),
        ("venue", None),
        ("venue", "truth"),
    ]
    assert len({BOOK[i]["priority"] for i in ids}) == len(ids)  # no two as urgent as each other
    assert BOOK[LEAD]["text"] == {
        "zh": "桥到底是怎么坏的？",
        "en": "How did the bridge really break?",
    }
    assert BOOK[TELL]["text"] == {
        "zh": "当众把桥的事说清楚",
        "en": "Tell the town how the bridge broke",
    }
    assert BOOK[PEACE]["text"] == {"zh": "两家和解", "en": "Make peace between the families"}
    assert BOOK[NIGHT]["text"] == {"zh": "灯会之夜", "en": "Festival night"}
    assert BOOK[CALL]["text"] == {"zh": "请族长召集族人", "en": "Have the elder call the clan"}
    assert ids.index(CALL) == len(ids) - 1  # the tasks of the elder's call are a block at the end


def test_every_word_is_in_both_languages_names_nobody_by_sex_and_gives_nothing_away():
    gives_away = (
        "老何",
        "Old He",
        "Boatman",
        "撑船",
        "秋汛",
        "大郎",
        "Dalang",
        "v_boat",
        "v_flood",
        "v_drunk",
        "variant",
    )
    for task_id in (*TASKS, CALL):
        task = BOOK[task_id]
        for text in strings(task):
            assert text.strip(), task_id
            assert not re.search(r"[他她]", text), (task_id, text)
            assert not re.search(r"\b(he|she|his|her|him|hers)\b", text, re.I), (task_id, text)
            assert not any(word in text for word in gives_away), (task_id, text)
            assert not re.search(r"[;；—]", text), (task_id, text)
        for key in ("why", "next"):
            assert all(o["zh"] and o["en"] for o in task[key]), (task_id, key)
    assert len(BOOK[LEAD]["next"]) == len(STEP) and len(BOOK[TELL]["why"]) == len(SHORT)
    assert len(BOOK[TELL]["next"]) == len(SHORT) + len(NEXT_STATE) - 1
    assert len(BOOK[PEACE]["next"]) == len(TABLE) and len(BOOK[PEACE]["why"]) == 4


def test_the_actions_name_a_request_or_a_kind_only_where_the_verb_takes_one():
    seen: set[tuple] = set()
    for task_id in (*TASKS, CALL):
        options = [*BOOK[task_id]["action"]]
        for rule in BOOK[task_id]["blocked"]:
            options += rule["action"]
        for option in options:
            seen.add((option["verb"], option.get("request"), option.get("kind")))
            assert ("request" in option) <= (option["verb"] == "entrust")
            assert ("kind" in option) <= (option["verb"] == "speak")
            assert "target" not in option  # nobody is talked round
    assert seen == {
        ("look", None, None),
        ("talk", None, None),  # the first talk of a day with the person who turned the manager away
        ("promise", None, None),  # and a promise to them, before the look or the question again
        ("entrust", "testify", None),
        ("entrust", "convene", None),
        ("move", None, None),
        ("speak", None, "statement"),
        ("speak", None, "meal"),
        ("state", None, None),  # fill in the card of the statement
    }


def test_the_conditions_read_only_what_the_player_did_or_holds_and_the_flags_and_the_hour():
    safe = {"after", "hours", "looked", "evidence", "event", "refused", "told", "meeting"}
    safe |= {"flag", "clarified", "at_place", "grudge"}
    # what the manager was told by a person who turned them away, the promises left to make, the
    # talk of today and whether the evidence they hold was shown: all of it the manager's own
    safe |= {"turned_down", "can_promise", "talked_today", "fresh_proof", "window"}
    safe |= {"card_filled", "card_fillable", "stated_today"}  # the card the manager filled in
    # and what the town saw: the deeds of the peace, the helpers who agreed, the work done
    safe |= {"eased", "crew", "work", "called"}
    kinds: set[str] = set()
    for task_id in (*TASKS, CALL):
        task = BOOK[task_id]
        conds = [*task["appears"], *task["done"], *task["stale"]]
        for rule in task["blocked"]:
            conds += rule["when"]
        for key in ("why", "next", "action"):
            conds += [c for option in task[key] for c in option["when"]]
        for rule in task["blocked"]:
            for key in ("why", "next", "action"):
                conds += [c for option in rule[key] for c in option["when"]]
        kinds |= {leaf["kind"] for leaf in agenda_terms.leaves(conds)}
    assert kinds <= safe
    assert "note" not in kinds and "judged" not in kinds  # nothing of what the notebook holds


def test_the_steps_of_the_lead_are_there_in_every_story():
    """The places it sends the manager to hold evidence whichever story is true (the script lists
    them for all three), and the watchman has something to say in each of them."""
    holders = {
        "t_rail": "e_footprint",
        "p_under_bridge": "e_flood_debris",
        "t_he_boat": "e_boat_scratches",
    }
    for holder, item in holders.items():
        assert [e["id"] for e in SCRIPT["evidence"] if e["acquire"]["from"] == holder] == [item]
    for variant in VARIANTS:
        assert entrust.testimony("gengfu", variant), variant
    # and any set that tells a story apart is made of items that make the obstacle come
    for row in SCRIPT["evidence_sets"]:
        assert set(row["items"]) <= set(CAUSE_ITEMS), row["id"]
    (condition,) = BOOK[TELL]["appears"]
    assert condition["kind"] == "evidence" and set(condition["items"]) == set(CAUSE_ITEMS)


def test_the_lead_and_the_peace_come_when_the_script_says_and_the_festival_night_as_before():
    """The lead comes in the afternoon of the second day, the peace on the third morning, the call
    of the clan on the fourth, the festival night on the fifth."""
    when = {
        LEAD: [{"kind": "after", "day": 2, "hour": 12}],
        PEACE: [{"kind": "after", "day": 3, "hour": 6}],
        NIGHT: [{"kind": "after", "day": 5, "hour": 6}],
    }
    for task_id, conds in when.items():
        assert BOOK[task_id]["appears"] == conds, task_id
    assert BOOK[CALL]["appears"][0] == {"kind": "after", "day": 4, "hour": 6}


def test_the_days_of_the_lead_are_the_days_of_the_table_of_the_script():
    """What the steps of the lead say is open from which day is the table of the script: the rail
    to the second day, the water and the boy from the third, the watchman from the fourth."""
    lead = BOOK[LEAD]
    for number, day in ((STEP["water"], 3), (STEP["watch"], 4), (STEP["river"], 3)):
        conds = lead["next"][number]["when"]
        assert {"kind": "after", "day": day, "hour": 6} in conds, (number, day)
    first_day = {
        item["id"]: (item["acquire"].get("since") or 0) // 1440 + 1 for item in SCRIPT["evidence"]
    }
    assert first_day["e_flood_debris"] == 3 and first_day["e_xiaoman_testimony"] == 3
    assert first_day["e_gengfu_boat"] == first_day["e_gengfu_flood"] == 4


# ------------------------------------------------------------------------------ the route


@pytest.mark.parametrize("variant", VARIANTS)
def test_following_the_cards_by_the_days_tells_the_truth_in_public_and_makes_the_peace(variant):
    game, bot, _ = play_route(variant)
    marks = bot.marks
    assert bot.finished and bot.order[-1] == "fed"

    def lead(label, state, action, step):
        found = card(marks, label, LEAD)
        assert found is not None and found["state"] == state, (label, found)
        assert found["action"] == action, label
        if step is not None:
            assert found["next"]["en"] == words(LEAD, "next", STEP[step]), label

    # the lead comes in the afternoon of the second day, not before
    for label in ("clarified", "morning2"):
        assert card(marks, label, LEAD) is None, label
    rail = {"verb": "look", "item": "t_rail", "place": "p_bridge"}
    boat = {"verb": "look", "item": "t_he_boat", "place": "p_ferry"}
    water = {"verb": "look", "place": "p_under_bridge"}
    lead("noon2", "open", rail, "rail")
    lead("rail", "open", boat, "boat")
    lead("boat", "open", None, "ahead2")  # the water is high, the boy and the watchman not yet
    lead("night2", "open", None, "ahead2")
    lead("morning3", "open", None, "ahead3")  # the water has fallen: by day the pier
    lead("work3", "open", water, "water")
    lead("water", "open", None, "ahead3b")
    # the boy was asked: in one story he told what he saw, and in the others he had nothing to say,
    # which is the answer he gave. Either way the step is done, and the cards do not tell them apart
    lead("river", "open", None, "ahead4")
    lead("night3", "open", None, "ahead4")
    for label in ("morning4", "work4"):
        lead(label, "open", None, "tonight")
    lead("watch", "done", None, None)  # the last of the steps: asked, whatever the answer
    assert card(marks, "watch", LEAD)["next"] is None

    # the obstacle comes once evidence is in hand. While there is something to choose it opens the
    # card, and when the card is filled in on the last evening it has the manager speak
    for label in ("clarified", "morning2", "noon2"):
        assert card(marks, label, TELL) is None
    for label in bot.order:
        holds = bool(set(marks[label]["evidence"]) & set(CAUSE_ITEMS))
        assert (card(marks, label, TELL) is not None) == holds, label
    open_card = {"verb": "state"}
    first = next(label for label in bot.order if card(marks, label, TELL) is not None)
    for label in bot.order[bot.order.index(first) : bot.order.index("filled")]:
        assert card(marks, label, TELL)["action"] == open_card, label
    # until the fourth evening the card says the full statement is a long way off, and from then on,
    # with the card not filled in, to find the clues that are missing
    evening = bot.order.index("watch")
    for label in bot.order[bot.order.index(first) : evening]:
        gathering = words(TELL, "next", NEXT_STATE["gathering"])
        assert card(marks, label, TELL)["next"]["en"] == gathering, label
    for label in bot.order[evening : bot.order.index("filled")]:
        unfilled = words(TELL, "next", NEXT_STATE["unfilled"])
        assert card(marks, label, TELL)["next"]["en"] == unfilled, label
    assert card(marks, "filled", TELL)["action"] == {"verb": "speak", "kind": "statement"}
    assert card(marks, "filled", TELL)["next"]["en"] == words(TELL, "next", NEXT_STATE["ready"])
    # the statement is made from the fourth evening, so that is the evening the card names before it
    assert card(marks, "boat", TELL)["window"] == {**EVIDENCE_DAY(4)}
    assert card(marks, "night2", TELL)["window"] == {**EVIDENCE_DAY(4)}

    # the call of the clan comes on the fourth morning, and asks the elder once the lead is followed
    for label in bot.order[: bot.order.index("morning4")]:
        assert card(marks, label, CALL) is None, label
    asks = {"verb": "entrust", "npc": "zuzhang", "request": "convene"}
    for label in ("morning4", "work4"):
        found = card(marks, label, CALL)
        assert found["state"] == "open" and found["action"] is None, label
    assert card(marks, "morning5", CALL)["action"] == asks

    # the peace comes on the third morning, names the work at the bridge, then the truth and the
    # table
    for label in bot.order[: bot.order.index("morning3")]:
        assert card(marks, label, PEACE) is None, label
    found = card(marks, "morning3", PEACE)
    assert found["state"] == "open" and found["action"] is None
    assert found["next"]["en"] == words(PEACE, "next", TABLE["work"])
    assert found["why"]["en"].startswith("The grudge between the two heads stands at ")
    for label in bot.order[bot.order.index("work3") : bot.order.index("told")]:
        found = card(marks, label, PEACE)
        assert found["state"] == "open", label
        # nothing to do but be there, until the last evening: from four on the fifth day the table
        # is laid whatever came of the truth
        assert (found["action"] is None) == (label not in ("teahouse", "filled")), label
        assert found["next"]["en"] == words(PEACE, "next", TABLE["neither"]), label
    assert card(marks, "teahouse", PEACE)["action"] == {"verb": "speak", "kind": "meal"}
    table = card(marks, "told", PEACE)
    assert table["action"] == {"verb": "speak", "kind": "meal"}
    assert table["next"]["en"] == words(PEACE, "next", TABLE["told"])
    assert table["why"]["en"].startswith("The truth is out and the grudge between the two heads")
    assert (table["window"]["from"], table["window"]["to"]) == (17, 19)
    assert [card(marks, "fed", i)["state"] for i in (LEAD, TELL, PEACE)] == ["done"] * 3
    assert card(marks, "told", TELL)["state"] == "done"
    for label in bot.order[: bot.order.index("morning5")]:
        assert card(marks, label, NIGHT) is None, label  # it is not yet the fifth day

    # the board shows each step done as it is
    boards = {label: marks[label]["board"] for label in bot.order}
    for label in bot.order[: bot.order.index("told")]:
        one = boards[label]
        assert one["truth"] == {"state": "open", "last": None}, label
        assert (one["peace"]["state"], one["peace"]["witnessed"]) == ("open", False), label
    acts = {label: [a["done"] for a in boards[label]["peace"]["acts"]] for label in bot.order}
    assert acts["clarified"] == [True, False, False]  # the heads who were there stopped accusing
    assert acts["morning3"] == [True, False, False]
    assert acts["work3"] == acts["watch"] == acts["morning5"] == [True, True, False]
    one = boards["told"]
    last = one["truth"]["last"]
    assert one["truth"]["state"] == "done" and last["why"] is None
    assert (last["day"], last["hour"], last["venue"], last["elder"]) == (
        5,
        17,
        TEAHOUSE,
        "accepted",
    )
    assert last["named"] >= assembly.MIN_NAMED and last["percent"] >= assembly.ACCEPT_PERCENT
    assert last["percent"] == 100 * last["accepted"] // last["named"]
    assert acts["told"] == [True, True, False]
    assert (one["peace"]["state"], one["peace"]["witnessed"]) == ("open", False)
    one = boards["fed"]
    assert one["truth"]["state"] == "done" and one["peace"]["state"] == "done"
    assert acts["fed"] == [True, True, True]
    assert (
        one["peace"]["witnessed"] is True
        and one["peace"]["grudge"] < 30 < boards["told"]["peace"]["grudge"]
    )

    # the grudge came down by the deeds, one after the other. The town's talk can put it up by a
    # telling or two (a head is told, by a neighbour who guessed in the night, that their own family
    # is blamed): never by more than that, and the deeds are what it comes down by
    grudges = [boards[label]["peace"]["grudge"] for label in bot.order]
    assert all(
        later <= before + bonds.MAX_STEP
        for before, later in zip(grudges, grudges[1:], strict=False)
    )
    assert grudges[-1] < grudges[0] - 3 * bonds.MAX_STEP
    assert boards["morning3"]["peace"]["grudge"] > boards["work3"]["peace"]["grudge"]
    assert boards["morning4"]["peace"]["grudge"] > boards["work4"]["peace"]["grudge"]

    # and the game is as the flags say, with the rows the statement and the clarification left
    world = state_of(game)
    assert {"truth_told", "reconcile_seen", "reconciled", "elder_accepts"} <= set(
        world["goals"]["flags"]
    )
    clarification, statement = world["player"]["public"]["speeches"]
    assert len(clarification) == 6 and len(statement) == assembly.STATEMENT_ROW
    assert statement[-3:] == [1, 1, []]  # a complete set, it told the truth, every part held


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_evidence_is_complete_by_the_evening_of_the_fourth_day_and_not_before(variant):
    """What the lead gathers holds a set that tells the story apart once the watchman has spoken on
    the fourth night, and no set before it, whichever story is true."""
    game, bot, _ = play_route(variant)
    marks = bot.marks

    def complete(label):
        held = marks[label]["evidence"]
        return assembly.complete(variant, held)

    for label in bot.order[: bot.order.index("watch")]:
        assert not complete(label), label
    assert complete("watch")
    assert marks["watch"]["tick"] >= at(4, 19)
    assert marks["watch"]["tick"] < at(5, 6)


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_truth_can_be_told_at_the_hall_when_the_elder_has_called_the_clan(variant):
    """The other way the cards give: ask the elder on the fifth morning to call the clan, then speak
    at the hall, and lay the table there with the two heads among those called."""
    game, bot, _ = play_route(
        variant,
        route=HallRoute,
        trusting=("gengfu", "old_he", "xiao_man", "zuzhang"),
    )
    marks = bot.marks
    assert bot.finished and bot.order[-6:] == [
        "morning5",
        "called",
        "hall",
        "filled",
        "told",
        "fed",
    ]
    morning = card(marks, "morning5", CALL)
    assert morning["action"] == {"verb": "entrust", "npc": "zuzhang", "request": "convene"}
    assert morning["state"] == "open"
    assert card(marks, "called", CALL)["state"] in ("done", "open")
    assert card(marks, "hall", TELL)["action"] == {"verb": "state"}  # the card is not filled yet
    assert card(marks, "filled", TELL)["action"] == {"verb": "speak", "kind": "statement"}
    assert card(marks, "hall", PEACE)["action"] is None  # the truth comes first, at the hall too
    assert card(marks, "told", PEACE)["action"] == {"verb": "speak", "kind": "meal"}
    last = marks["told"]["board"]["truth"]["last"]
    assert marks["told"]["board"]["truth"]["state"] == "done" and last["why"] is None
    assert last["venue"] == "p_clan_hall" and last["named"] >= assembly.MIN_NAMED
    assert last["elder"] == "accepted" and last["percent"] >= assembly.ACCEPT_PERCENT
    fed = marks["fed"]["board"]
    assert fed["peace"]["state"] == "done" and fed["peace"]["witnessed"] is True
    assert [card(marks, "fed", i)["state"] for i in (LEAD, TELL, PEACE)] == ["done"] * 3
    assert card(marks, "fed", CALL)["state"] == "done"
    flags = state_of(game)["goals"]["flags"]
    assert {"truth_told", "reconcile_seen", "reconciled"} <= set(flags)
    # the morning of the fifth day: truth and peace on day 5
    assert clock.at(flags["reconciled"]).day == 5 and clock.at(flags["truth_told"]).day == 5


@pytest.fixture(scope="module")
def routes():
    """The route in the three stories, with the marks."""
    return {variant: play_route(variant)[1].marks for variant in VARIANTS}


def test_the_same_moves_give_the_same_cards_in_the_three_stories_but_where_the_evidence_differs(
    routes,
):
    """Whichever story is true the lead, the peace, the call and the festival night read the same,
    and the obstacle is there exactly when the manager holds evidence that bears on how the rail
    broke. The lead is the same even where the manager holds the boy's word, which one story has: in
    the others he had nothing to say, which he said, and the step is done all the same."""
    order = list(routes["v_boat"])
    assert all(list(marks) == order for marks in routes.values())
    # From the afternoon of the fourth day the manager has told people what the story gave them and
    # the town carries it on, so a head can hear that their own family is blamed and the grudge,
    # which the card of the peace and the board carry, moves with it: the numbers are left out.
    late = order.index("watch")

    def unnumbered(found):
        """The same with the numbers of the words left out (a grudge, a count of hours)."""
        if isinstance(found, str):
            return re.sub(r"\d+", "#", found)
        if isinstance(found, list):
            return [unnumbered(item) for item in found]
        if isinstance(found, dict):
            return {key: unnumbered(item) for key, item in found.items()}
        return found

    for label in order:
        held = {v: routes[v][label]["evidence"] for v in VARIANTS}
        for task_id in (PEACE, NIGHT):
            cards = [card(routes[v], label, task_id) for v in VARIANTS]
            if order.index(label) >= late:
                cards = [unnumbered(found) for found in cards]
            assert cards[0] == cards[1] == cards[2], (label, task_id)
        leads = [card(routes[v], label, LEAD) for v in VARIANTS]
        if label == "river":  # the evidence differs, and the card does not: the boy was asked
            differs = ["e_xiaoman_testimony" in held[v] for v in VARIANTS]
            assert differs == [True, False, False]
        assert leads[0] == leads[1] == leads[2], label
        tells = [card(routes[v], label, TELL) for v in VARIANTS]
        for variant, found in zip(VARIANTS, tells, strict=True):
            assert (found is not None) == bool(set(held[variant]) & set(CAUSE_ITEMS)), label
        present = [found for found in tells if found is not None]
        assert all(found == present[0] for found in present), label
        calls = [card(routes[v], label, CALL) for v in VARIANTS]
        present = [found for found in calls if found is not None]
        assert len(present) in (0, 3) and all(found == present[0] for found in present), label
        # nor does the board say more than the manager did: it is the same until a statement is made
        if label in ("told", "fed"):
            continue
        # (the card in short counts the notes the manager has, which differ where the evidence does)
        boards = [
            {key: one for key, one in routes[v][label]["board"].items() if key != "statement"}
            for v in VARIANTS
        ]
        if order.index(label) >= late:
            boards = [
                unnumbered({**board, "peace": {**board["peace"], "grudge": 0}}) for board in boards
            ]
        assert boards[0] == boards[1] == boards[2], label


@pytest.mark.parametrize("variant", VARIANTS)
def test_following_the_cards_with_nobody_trusting_the_manager_stops_at_the_two_refusals(variant):
    """Without the trust that the other tests give and with nobody behind the manager, the boatman
    will not let the manager look at the boat and the watchman will not speak. The cards say so and
    what to do, and keep the steps."""
    game, bot, _ = play_route(variant, trust=None, until=at(4, 19, 50), route=AloneRoute)
    marks = bot.marks
    boat = card(marks, "boat", LEAD)
    # the owner of the boat turned the manager away: the first talk of the day earns a little trust,
    # and then the look is a new question
    assert boat["next"]["en"] == words(LEAD, "next", STEP["boat_talk"])
    assert boat["action"] == {"verb": "talk", "npc": "old_he"}
    assert "e_boat_scratches" not in marks["boat"]["evidence"]
    refused = card(marks, "watch", LEAD)
    assert refused["state"] == "open"
    assert not set(marks["watch"]["evidence"]) & {
        "e_gengfu_boat",
        "e_gengfu_flood",
        "e_gengfu_dalang",
    }
    # the watchman was talked to in asking and turned the manager away: what is left is a promise
    assert refused["next"]["en"] == words(LEAD, "next", STEP["watch_promise"])
    assert refused["action"] == {"verb": "promise", "npc": "gengfu"}


# ------------------------------------------------------------------------------ save and replay


def test_a_recording_of_the_route_is_replayed_to_the_same_game_with_the_same_board():
    """The tasks and the board are made from the state, so a game rebuilt from the inputs of the
    recording, checking every hash on the way, has them as the first one had. Nobody trusts the
    manager here, so the route has no case set up by hand, which a recording could not carry."""
    started = preset("slice")
    game = Game(started["seed"], started["scenario"], {**started["config"], "dev_actions": 1})
    recorder = Recorder(game)
    bot = AloneRoute(json.loads(game.scene_json()), started["seed"])
    obs = Obs(json.loads(recorder.step("[]")))
    while game.tick < at(4, 20):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(recorder.step(json.dumps(records))))
    assert "watch" in bot.marks  # the boat was refused, and the watchman too
    recording = canon.loads(canon.dumps_str(recorder.recording()))  # as a file would carry it
    again = rebuild(recording)
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()
    assert told(frame_now(again)) == told(frame_now(game))
    assert tasks_of(frame_now(again))[LEAD]["next"]["en"] == words(
        LEAD, "next", STEP["watch_promise"]
    )


# ------------------------------------------------------------------------------ what is hidden


def resettle(game: Game) -> None:
    """Look at the tasks again from the state, as ``agenda.settle`` does: what was open is asked
    again whether it still is, and the tasks that have not come are asked whether they do."""
    kernel = game._kernel
    section = kernel.state["world"]["agenda"]
    for row in section["tasks"].values():
        if row["state"] not in agenda.ENDED:
            row["state"] = "open"
    agenda.settle(env_at(game, kernel.state["tick"]), section, kernel.state["tick"], None)


def test_changing_what_is_hidden_changes_nothing_the_tasks_and_the_board_say_at_any_step():
    """The variant that is true, what each person believes, how they stand to each other, how far
    they trust the manager and the street: changed in the game at each step of the route, they move
    neither what the frame says nor what the tasks make of the state when they look again."""
    _, bot, snapshots = play_route("v_boat", snapshots=True)
    assert set(snapshots) == set(bot.order)
    for label in (
        "clarified",
        "noon2",
        "boat",
        "work3",
        "river",
        "watch",
        "teahouse",
        "told",
        "fed",
    ):
        plain = Game.from_snapshot_json(snapshots[label])
        base = told(frame_now(plain))
        assert base["board"] == bot.marks[label]["board"], label  # a restored game says the same
        resettle(plain)
        for name, change in hidden_changes().items():
            twin = Game.from_snapshot_json(snapshots[label])
            before = canon.digest(state_of(twin))
            change(state_of(twin))
            assert canon.digest(state_of(twin)) != before, (label, name)  # the change was made
            assert told(frame_now(twin)) == base, (label, name)
            resettle(twin)
            assert state_of(twin)["agenda"] == state_of(plain)["agenda"], (label, name)
            assert told(frame_now(twin)) == told(frame_now(plain)), (label, name)


def test_changing_what_the_player_holds_does_move_the_tasks():
    """So the comparison above is no comparison of nothing."""
    _, _, snapshots = play_route("v_boat", snapshots=True)
    game = Game.from_snapshot_json(snapshots["noon2"])
    assert tasks_of(frame_now(game))[LEAD]["next"]["en"] == words(LEAD, "next", STEP["rail"])
    assert TELL not in tasks_of(frame_now(game))
    me(game)["looked"].append("e_footprint")  # looked at the rail
    me(game)["evidence"].append("e_gengfu_dalang")  # and has the watchman's word
    resettle(game)
    after = tasks_of(frame_now(game))
    assert after[LEAD]["next"]["en"] == words(LEAD, "next", STEP["boat"])
    assert after[TELL]["state"] == "open"


# ------------------------------------------------------------------------------ the statement


def the_card_after(variant, hour, minute, evidence, picks=None, day=4):
    """A full statement of the card (the right options of the story unless ``picks`` says others)
    at the teahouse at that time of the fourth day, in the slice, with ``evidence`` in hand: the
    outputs of the speech, and the game, with the tasks looking again."""
    game = slice_game(variant=variant)
    run_to(game, at(day, hour, minute))
    me(game)["evidence"].extend(evidence)
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    fill(game, picks)
    out = state_it(game)
    idle(game)
    return game, out


def test_the_full_statement_waits_for_enough_people_and_the_card_says_so_instead_of_wasting_it():
    game = slice_game(variant="v_boat")
    run_to(game, at(4, 20, 30))
    me(game)["evidence"].extend(["e_boat_scratches", "e_gengfu_boat"])
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    fill(game)
    card_now = frame_now(game)["statement"]
    assert card_now["can_state"] is False and card_now["why_not"]["en"] == (
        "Fewer than five named people are here"
    )
    assert acks(state_it(game)) == [("rejected", "few_present")]  # and nothing was spent
    assert frame_now(game)["statement"]["used_today"] is False


def test_a_statement_with_the_parts_right_and_too_little_proof_says_so_and_asks_for_more():
    for variant, evidence in (
        ("v_boat", ["e_boat_scratches"]),
        ("v_flood", ["e_flood_debris"]),
        ("v_drunk", ["e_footprint"]),
    ):
        game, out = the_card_after(variant, 18, 5, evidence)
        event = stated(out)
        assert event["wrong"] == [] and event["proof"] is False and event["told"] is False
        found = tasks_of(frame_now(game))[TELL]
        assert found["why"]["en"] == words(TELL, "why", SHORT["proof"])
        assert found["next"]["en"] == words(TELL, "next", SHORT_NEXT["proof"])
        last = frame_now(game)["board"]["truth"]["last"]
        assert last["why"] == {
            "zh": "每一栏都对得上，可手里的凭据还分不出是哪一种说法",
            "en": "Every part holds, but what you hold cannot tell one story from the others",
        }
        assert assembly.missed(state_of(game)) == "proof"


def test_a_part_that_did_not_hold_is_named_with_the_kind_of_its_failure_and_asked_again():
    game, out = the_card_after(
        "v_boat",
        18,
        5,
        ["e_boat_scratches", "e_gengfu_boat"],
        picks={"cause": "flood", "course": "boat_night", "rumour": "grew"},
    )
    event = stated(out)
    assert event["wrong"] == ["cause"] and event["proof"] is True and event["told"] is False
    found = tasks_of(frame_now(game))[TELL]
    assert found["why"]["en"] == words(TELL, "why", SHORT["parts"])
    assert found["next"]["en"] == words(TELL, "next", SHORT_NEXT["parts"])
    last = frame_now(game)["statement"]["last"]
    assert last["wrong"] == ["cause"] and last["told"] is False
    assert last["why"]["en"].startswith("Cause: ")
    assert frame_now(game)["board"]["truth"]["last"]["why"] == last["why"]


@pytest.mark.parametrize(
    ("short", "row"),
    [
        ("parts", (9, 8, 2, 1, 0, [["cause", "unseen", ""]])),
        ("proof", (9, 8, 2, 0, 0, [])),
        ("elder_absent", (9, 8, 0, 1, 0, [])),
        ("elder_refused", (9, 8, 1, 1, 0, [])),
        ("named", (4, 4, 2, 1, 0, [])),
        ("accepted", (9, 5, 2, 1, 0, [])),
    ],
)
def test_the_obstacle_says_what_the_last_statement_fell_short_of_in_the_order_of_the_goal(
    short, row
):
    game = slice_game()
    run_to(game, at(4, 18))
    me(game)["evidence"].append("e_footprint")
    speak_row(game, at(4, 17, 40), TEAHOUSE, *row)
    found = tasks_of(frame_now(game))[TELL]
    assert found["why"]["en"] == words(TELL, "why", SHORT[short])
    assert found["next"]["en"] == words(TELL, "next", SHORT_NEXT[short])
    assert found["state"] == "open"


def test_after_the_elder_refused_a_whole_proof_the_card_has_the_manager_win_him_first():
    """The parts held and the proof was whole, five named people were there and enough accepted,
    and the elder was there and did not nod: he holds another account, or does not trust the
    manager enough. The card says so and has the manager talk with him, then promise him
    something."""
    game = slice_game()
    run_to(game, at(4, 18))
    me(game)["evidence"].append("e_footprint")
    speak_row(game, at(4, 17, 40), TEAHOUSE, 9, 8, 1, 1, 0, [])
    found = tasks_of(frame_now(game))[TELL]
    assert "did not nod" in found["why"]["en"] and "another account" in found["why"]["en"]
    assert "trust" in found["next"]["en"] and "refutes the other account" in found["next"]["en"]
    assert "没点头" in found["why"]["zh"]
    assert found["action"] == {"verb": "talk", "npc": "zuzhang"}
    # once they have talked that day, the next thing to do is the promise, where one can be made
    meet(game, "zuzhang")
    act(game, "leave")
    idle(game)
    found = tasks_of(frame_now(game))[TELL]
    assert found["action"] in (None, {"verb": "promise", "npc": "zuzhang"})


def test_the_obstacle_walks_through_the_days_to_the_statement():
    """Before the evening of the fourth day it is about the clues and the card, then about the
    evening, then about what was stated today."""
    game = slice_game(variant="v_drunk")
    hold(game, "e_footprint")
    found = tasks_of(frame_now(game))[TELL]
    assert found["next"]["en"] == words(TELL, "next", NEXT_STATE["gathering"])
    assert found["action"] is None  # no note yet bears on any option: there is nothing to choose
    bear(game, "drunk")
    game._kernel.state["version"] += 1  # a note is an event, which makes the tasks look again
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["action"] == {"verb": "state"}  # and now there is
    fill(game)
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["next"]["en"] == words(TELL, "next", NEXT_STATE["waiting"])
    assert found["action"] is None  # filled in, and the evening is a long way off
    run_to(game, at(4, 15, 59))
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["next"]["en"] == words(TELL, "next", NEXT_STATE["waiting"])
    assert found["action"] is None  # until four o'clock the walk to the teahouse is not offered
    run_to(game, at(4, 16, 1))
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["action"] == {"verb": "move", "place": TEAHOUSE}
    run_to(game, at(4, 17, 1))
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["next"]["en"] == words(TELL, "next", NEXT_STATE["ready"])
    run_to(game, at(4, 18, 5))
    put(game, *world_of(game).town.places[TEAHOUSE].door)
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["action"] == {"verb": "speak", "kind": "statement"}
    state_it(game)
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["action"] is None  # one a day: nothing is offered for the rest of it
    assert found["next"]["en"] != words(TELL, "next", NEXT_STATE["ready"])


def test_the_obstacle_is_done_with_the_truth_and_stale_when_the_time_for_it_is_gone():
    game = slice_game()
    hold(game, "e_footprint")
    assert tasks_of(frame_now(game))[TELL]["state"] == "open"
    state_of(game)["goals"]["flags"]["truth_told"] = 5
    game._kernel.state["version"] += 1
    found = tasks_of(idle(game)["frame"])[TELL]
    assert (found["state"], found["why"], found["next"], found["action"]) == (
        "done",
        None,
        None,
        None,
    )
    late = slice_game()
    hold(late, "e_footprint")
    run_to(late, at(5, 17, 59))  # the goal's deadline is six on the last evening
    assert tasks_of(idle(late)["frame"])[TELL]["state"] == "open"
    run_to(late, at(5, 18))
    assert tasks_of(idle(late)["frame"])[TELL]["state"] == "stale"


def test_the_card_sends_the_manager_to_the_hall_while_the_clan_is_called_and_back_to_the_teahouse():
    game = talking("zuzhang", seed=1, hour=9, day=5, dev_actions=1)
    for index in range(len(CAST.index)):
        me(game)["trust"][index] = 50
    me(game)["evidence"].append("e_footprint")
    assert acks(act(game, "entrust", kind="convene")) == [("applied", None)]
    act(game, "leave")
    meeting = state_of(game)["player"]["meeting"]
    assert meeting["tick"] > game.tick  # the clan is on its way
    assert not agenda_terms.holds(env_at(game, game.tick), {"kind": "meeting"})
    run_to(game, meeting["tick"])
    hold(game, "e_footprint")
    fill(game, {"cause": "drunk", "course": "drunk_night", "rumour": "grew"})
    assert agenda_terms.holds(env_at(game, game.tick), {"kind": "meeting"})
    hall = world_of(game).town.places["p_clan_hall"].door
    put(game, *world_of(game).town.places["p_bridge"].cells[0])
    found = tasks_of(idle(game)["frame"])[TELL]
    assert found["action"] == {"verb": "move", "place": "p_clan_hall"}
    assert found["next"]["en"] == words(TELL, "next", NEXT_STATE["hall"])
    assert "hall is open" in found["next"]["en"] and "祠堂开着" in found["next"]["zh"]
    put(game, *hall)
    assert tasks_of(idle(game)["frame"])[TELL]["action"] == {"verb": "speak", "kind": "statement"}
    until = me(game)["meeting"]["until"]
    assert not agenda_terms.holds(env_at(game, until + 1), {"kind": "meeting"})
    assert agenda_terms.holds(env_at(game, until), {"kind": "meeting"})


def test_a_refusal_of_the_elder_leaves_the_manager_the_teahouse_for_the_evening():
    game = talking("zuzhang", seed=1, hour=9, day=5, dev_actions=1)
    me(game)["evidence"].append("e_footprint")
    out = act(game, "entrust", kind="convene")  # a stranger's word is not enough: the elder says no
    assert acks(out) == [("rejected", "refused")]
    act(game, "leave")
    hold(game)
    fill(game, {"cause": "drunk", "course": "drunk_night", "rumour": "grew"})
    found = tasks_of(frame_now(game))[TELL]
    assert found["action"] is None  # in the morning there is nothing to do but wait for the evening
    assert found["window"]["place"] == TEAHOUSE and (
        found["window"]["from"],
        found["window"]["to"],
    ) == (17, 19)
    run_to(game, at(5, 16))  # and from four the walk there is offered
    assert tasks_of(idle(game)["frame"])[TELL]["action"] == {"verb": "move", "place": TEAHOUSE}


# ------------------------------------------------------------------------------ the peace


def test_a_table_laid_before_the_truth_is_seen_and_the_peace_asks_for_the_truth_and_another_table():
    game, _, _ = play_route(
        "v_drunk", until=at(3, 16, 5)
    )  # to the third afternoon: no statement yet
    state_of(game)["goals"]["flags"]["reconcile_seen"] = at(2, 15)
    game._kernel.state["version"] += 1
    found = tasks_of(idle(game)["frame"])[PEACE]
    assert found["why"]["en"] == words(PEACE, "why", SEEN_WHY)
    assert found["next"]["en"] == words(PEACE, "next", TABLE["seen"])
    state_of(game)["goals"]["flags"]["truth_told"] = at(2, 15)
    game._kernel.state["version"] += 1
    found = tasks_of(idle(game)["frame"])[PEACE]
    assert found["why"]["en"] == words(PEACE, "why", SEEN_WHY)
    assert found["next"]["en"] == words(PEACE, "next", TABLE["seen_told"])
    assert found["action"] is not None  # the truth is told: lay the table when it is time


def test_a_low_grudge_that_nobody_saw_come_down_asks_for_the_table_all_the_same():
    """The goal wants the grudge under thirty and a reconciliation that was seen. The grudge may
    come down by other means, and then only the sight of it is missing."""
    (goal,) = [g for g in SCRIPT["goals"] if g["id"] == "g_reconcile"]
    line = [c for c in goal["done_when"]["all"] if "metric" in c]
    assert line == [{"metric": "grudge", "op": "<", "value": 30}]
    lines = {
        cond["below"]
        for key in ("why", "next", "action")
        for option in BOOK[PEACE][key]
        for cond in agenda_terms.leaves(option["when"])
        if cond["kind"] == "grudge"
    }
    assert lines == {30}  # the line the script draws
    game, _, _ = play_route("v_drunk", until=at(3, 16, 5))
    set_grudge(game, 30)
    game._kernel.state["version"] += (
        1  # the tasks look again when an event, the hour or a move says so
    )
    found = tasks_of(idle(game)["frame"])[PEACE]
    assert found["why"]["en"] == words(PEACE, "why", NEITHER_WHY).format(grudge=30)
    assert found["action"] is None
    set_grudge(game, 29)
    idle(game)  # the metric follows the bonds on this tick
    game._kernel.state["version"] += 1
    found = tasks_of(idle(game)["frame"])[PEACE]
    assert found["why"]["en"] == words(PEACE, "why", UNSEEN_WHY)
    assert found["next"]["en"] == words(PEACE, "next", TABLE["unseen"])
    assert found["action"] == {"verb": "move", "place": TEAHOUSE}  # it is four in the afternoon
    state_of(game)["goals"]["flags"]["reconcile_seen"] = at(2, 15)  # and now it was seen
    found = tasks_of(idle(game)["frame"])[PEACE]
    assert found["state"] == "done"
    assert "reconciled" in state_of(game)["goals"]["flags"]


def test_the_table_is_laid_on_the_last_day_whatever_came_of_the_truth():
    game = slice_game()
    early = slice_game()
    run_to(early, at(4, 17, 30))
    assert tasks_of(idle(early)["frame"])[PEACE]["action"] is None  # the truth comes first
    run_to(game, at(5, 9))
    assert tasks_of(idle(game)["frame"])[PEACE]["action"] is None  # not in the morning either
    run_to(game, at(5, 17, 30))
    found = tasks_of(idle(game)["frame"])[PEACE]
    assert found["state"] == "open"
    assert found["action"] == {"verb": "move", "place": TEAHOUSE}


# ------------------------------------------------------------------------------ the festival night


def test_the_festival_night_comes_on_the_fifth_day_and_goes_when_the_lanterns_cross():
    game = slice_game()
    run_to(game, at(4, 20))
    assert NIGHT not in tasks_of(idle(game)["frame"])
    run_to(game, at(5, 6))
    found = tasks_of(idle(game)["frame"])[NIGHT]
    assert (found["kind"], found["job"], found["state"]) == ("venue", None, "open")
    assert found["window"] == {"day": 5, "from": 18, "to": 21, "place": "p_bridge"}
    assert found["action"] is None  # the walk to the bridge is offered from five in the afternoon
    run_to(game, at(5, 17))
    assert tasks_of(idle(game)["frame"])[NIGHT]["action"] == {"verb": "move", "place": "p_bridge"}
    assert found["text"] == {"zh": "灯会之夜", "en": "Festival night"}
    assert "three jobs" in found["why"]["en"]
    run_to(game, at(5, 20, 59))
    assert tasks_of(idle(game)["frame"])[NIGHT]["state"] == "open"
    run_to(game, at(5, 21, 5))
    assert tasks_of(idle(game)["frame"])[NIGHT]["state"] == "stale"


# ------------------------------------------------------------------------------ the windows


def test_a_window_without_a_day_is_the_next_time_of_those_hours():
    world = world_of(slice_game())
    window = {"from": 17, "to": 19, "place": TEAHOUSE}
    for tick, day in (
        (at(1, 6), 1),
        (at(2, 18, 59), 2),
        (at(2, 19), 3),
        (at(2, 22), 3),  # the night
        (at(2, 3), 3),  # the small hours belong to the day before, whose evening is over
        (at(5, 18, 59), 5),
        (at(5, 19), None),  # there is no sixth day
    ):
        assert agenda.next_day(world, window, tick) == day, clock.at(tick)


def test_the_frame_shows_the_next_time_it_can_be_used_and_a_window_with_a_day_is_not_moved():
    game = slice_game()
    hold(game, "e_footprint")
    run_to(game, at(2, 12))
    found = tasks_of(idle(game)["frame"])[TELL]
    # the statement is made from the fourth evening: that is the evening the card names before it
    assert found["window"] == {"day": 4, "from": 17, "to": 19, "place": TEAHOUSE}
    assert found["expected"] and {p["id"] for p in found["expected"]} >= {"zuzhang", "li_laotai"}
    run_to(game, at(2, 19, 30))
    assert tasks_of(idle(game)["frame"])[TELL]["window"]["day"] == 4
    run_to(game, at(4, 19, 30))  # and when the fourth evening is over, the fifth
    assert tasks_of(idle(game)["frame"])[TELL]["window"]["day"] == 5
    assert BOOK["t_tea_tonight"]["window"]["day"] == 1  # the evening of the first day stays so


# ------------------------------------------------------------------------------ the terms


def test_the_hour_is_read_off_the_clock_on_any_day():
    game = slice_game()
    window = {"kind": "hours", "from": 8, "to": 12}
    for tick, wanted in (
        (at(1, 7, 59), False),
        (at(1, 8), True),
        (at(3, 11, 59), True),
        (at(4, 12), False),
        (at(2, 22), False),
        (at(2, 3), False),
    ):
        assert agenda_terms.holds(env_at(game, tick), window) is wanted, clock.at(tick)
    late = {"kind": "hours", "from": 19, "to": 24}
    assert agenda_terms.holds(env_at(game, at(2, 23, 30)), late)
    assert not agenda_terms.holds(env_at(game, at(2, 2)), late)


def test_what_was_looked_for_and_what_is_held_are_read_from_the_manager():
    game = slice_game()
    looked = {"kind": "looked", "items": ["e_footprint", "e_flood_debris"]}
    held = {"kind": "evidence", "items": ["e_footprint", "e_flood_debris"]}
    env = env_at(game, 0)
    assert not agenda_terms.holds(env, looked) and not agenda_terms.holds(env, held)
    me(game)["looked"].append("e_flood_debris")  # looked for, and nothing found
    assert agenda_terms.holds(env, looked) and not agenda_terms.holds(env, held)
    me(game)["evidence"].append("e_footprint")
    assert agenda_terms.holds(env, held)
    other = {"kind": "evidence", "items": ["e_gengfu_dalang"]}
    assert not agenda_terms.holds(env, other)


def test_the_last_statement_is_read_for_what_it_fell_short_of_and_a_clarification_is_none():
    game = slice_game()
    env = env_at(game, 0)
    anything, named = {"kind": "told"}, {"kind": "told", "missed": "named"}
    assert not agenda_terms.holds(env, anything)
    state_of(game)["player"]["public"]["speeches"][:] = [[5, TEAHOUSE, 9, 8, 2, 0]]
    assert not agenda_terms.holds(env, anything)  # a clarification
    state_of(game)["player"]["public"]["speeches"].append([7, TEAHOUSE, 9, 8, 2, 1, 0])
    assert not agenda_terms.holds(env, anything)  # a showing of evidence
    state_of(game)["player"]["public"]["speeches"].append([9, TEAHOUSE, 3, 3, 2, 1, 0, []])
    assert agenda_terms.holds(env, anything) and agenda_terms.holds(env, named)
    for other in ("accepted", "elder_absent", "elder_refused"):
        assert not agenda_terms.holds(env, {"kind": "told", "missed": other})
    state_of(game)["player"]["public"]["speeches"].append([12, TEAHOUSE, 9, 9, 2, 1, 1, []])
    assert agenda_terms.holds(env, anything) and not agenda_terms.holds(env, named)


def test_the_grudge_is_read_off_the_metric_of_the_festival():
    game = slice_game()
    env = env_at(game, 0)
    line = {"kind": "grudge", "below": 30}
    metrics = state_of(game)["goals"]["metrics"]
    metrics["grudge"] = 67
    assert not agenda_terms.holds(env, line)
    metrics["grudge"] = 30
    assert not agenda_terms.holds(env, line)  # the goal says under thirty
    metrics["grudge"] = 29
    assert agenda_terms.holds(env, line)
    state_of(game)["goals"] = {}  # a world whose section is not the festival's
    assert not agenda_terms.holds(env, line)


def test_the_vocabulary_the_content_is_checked_against_has_the_new_terms():
    assert agenda_terms.spec() == cc.TASK_TERMS
    for name in ("hours", "looked", "evidence", "told", "meeting", "grudge", "eased", "called"):
        assert name in agenda_terms.TERMS and agenda_terms.TERMS[name].later == ""
    assert cc.MISSED_CODES == assembly.MISSED
    assert set(cc.REQUEST_KINDS) == set(entrust.KINDS) and cc.SPEAK_KINDS == assembly.KINDS
