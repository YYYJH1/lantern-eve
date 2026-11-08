"""The board: how the three jobs of the festival stand, in one key of the frame.

The key ``board`` is in every frame of the bridge world. It is made from what the manager knows or
what the town sees in public (the flags of the festival, the numbers it keeps, who joined the
call, the weather of the days that have gone, the clock, the last statement in public), and from
nothing that is true in the game: changing the variant, what a person believes or any other hidden
field changes nothing in it (``projection`` has the audit and the tests change those and compare)::

    {"helpers": [{"family": id | null, "count": int}],   the helpers who agreed, by family: the
                                                         families in the order of the cast, and
                                                         the helpers of none after them if any
     "need": int,                                        the helpers the work takes
     "both": bool,                                       both families have at least one
     "hours": {"done": int, "need": int},                work hours done and needed
     "window": {"day", "from", "to", "place"} | null,    the next time work is done at the bridge
     "stop": {"zh", "en"} | null,                        why the last work time did no work
     "deadline": {"day", "hour"},                        by when the bridge must be mended
     "needs": {item: int},                               how much of each item the bridge takes
     "statement": [{"part", "support", "against", "gap"}],   the statement card in short
     "truth": {"state": "open" | "done",
               "last": {"day", "hour", "venue", "named", "accepted", "percent",
                        "elder": "absent" | "refused" | "accepted",
                        "why": {"zh", "en"} | null} | null},
     "peace": {"state": "open" | "done", "grudge": int | null,
               "acts": [{"id", "text": {"zh", "en"}, "done": bool}], "witnessed": bool}}

*The bridge.* ``helpers``, ``need``, ``both``, ``hours``, ``window`` and ``deadline`` are the
numbers of ``goals_work`` and ``goals_call``, taken from ``agenda_facts``, the same functions that
fill the numbers in the words of the tasks of the bridge, so that the board and a task cannot say
two things. The work is done from the third day, in the morning (``goals_work.WORK_START_HOUR`` to
``WORK_END_HOUR``), and ``window`` is the next such morning, the one that is going on included
unless today's sky is a heavy rain, until the work is done, the deadline of the goal ``g_labor``
has gone or the game has ended, and then null. ``stop`` is why the last morning that is over did
no work, from the sky of that day and from who had joined by then: a heavy rain, too few helpers,
or the deadline gone. It is null if the work was done, if there was no such morning yet, and once
the work is complete. ``needs`` is the table ``goals_work.NEED``, the bamboo and the timber the
bridge takes, to be set against the pile at the bridge (``site``).

*The truth.* ``state`` is ``done`` once the flag ``truth_told`` is up. ``last`` is the last
full statement in public (``assembly.last_statement``), when it was, where, how many named
people were there and how many of them accepted, what the elder did, and in ``why`` the first
condition of the goal ``g_truth`` that it fell short of (``assembly.missed``), else null. It is
null if the manager has made none. ``statement`` is the card in short (``statement.summary``):
for each part, in order, the notes for the option chosen and against it, and whether nothing held
bears on any option of it (the counts are nothing before an option is chosen).

*The peace.* ``grudge`` is the metric of that name, the grudge between the heads of the two
families as the larger of what each holds, from 0 to 100, and the peace is done once the flag
``reconciled`` is up. ``acts`` are the deeds that move it, in the order a player does them
(``peace`` has them): a head of a family who stops accusing in public (when a clarification is
taken in, or the truth is told), the helpers of both families at work at the bridge the same
morning, and a meal for the two heads with witnesses, which takes off more once the truth is told.
No one of them makes the peace. ``witnessed`` is whether a reconciliation was seen (the flag
``reconcile_seen``).
"""

from __future__ import annotations

from typing import Any

from lantern_core.world.bridge import (
    agenda_facts,
    assembly,
    clock,
    goals,
    goals_call,
    goals_work,
    numerals,
    peace,
    statement,
    weather,
)

TRUTH_TOLD, RECONCILED, RECONCILE_SEEN = "truth_told", "reconciled", "reconcile_seen"

# why a statement in public fell short, by what assembly.missed says
SHORT = {
    "named": {
        "zh": f"在场有名有姓的人不到{numerals.zh_count(assembly.MIN_NAMED)}位",
        "en": f"Fewer than {assembly.MIN_NAMED} named people were there",
    },
    "accepted": {
        "zh": f"在场的人里接受的不到{numerals.zh_share(assembly.ACCEPT_PERCENT)}",
        "en": f"Fewer than {assembly.ACCEPT_PERCENT}% of those there accepted",
    },
    "elder_absent": {"zh": "族长不在场", "en": "The elder was not there"},
    "elder_refused": {
        "zh": "族长在场，但没有被说服",
        "en": "The elder was there but was not convinced",
    },
}

# the deeds that move the peace in this core (``peace``), in the order a player does them
ACTS = (
    {
        "id": peace.STOP,
        "text": {
            "zh": (
                f"一家的当家不再公开指控：谣言当众说清时在场的当家，和事后得知的当家，"
                f"各放下{peace.STOP_DROP}点积怨，桥的事说清之后接受的当家各放下{assembly.GRUDGE_DROP}点"
            ),
            "en": (
                f"A head of a family stops accusing in public: each head who is there when the "
                f"rumour is cleared, or comes to know of it afterwards, lets go of "
                f"{peace.STOP_DROP} points of grudge, and each who accepts the truth once the "
                f"matter of the bridge is cleared up lets go of {assembly.GRUDGE_DROP} points"
            ),
        },
    },
    {
        "id": peace.WORK,
        "text": {
            "zh": (
                f"两家的帮手同一个早上在桥边一起干活：两位当家各放下{peace.WORK_DROP}点积怨，"
                f"最多{numerals.zh_count(peace.WORK_MORNINGS)}个早上"
            ),
            "en": (
                f"Helpers of both families work at the bridge the same morning: both heads let go "
                f"of {peace.WORK_DROP} points of grudge, for up to {peace.WORK_MORNINGS} mornings"
            ),
        },
    },
    {
        "id": peace.MEAL,
        "text": {
            "zh": (
                f"两位当家同席，有人见证：积怨降{assembly.MEAL_DROP}点，"
                f"真相说清之后降{assembly.MEAL_DROP_AFTER_TRUTH}点"
            ),
            "en": (
                f"A meal for both heads with witnesses: the grudge falls by {assembly.MEAL_DROP}, "
                f"or by {assembly.MEAL_DROP_AFTER_TRUTH} once the truth is told"
            ),
        },
    },
)

# why no work was done in a morning
NO_HANDS = {
    "zh": "帮手还没凑够，没有施工",
    "en": "There were not enough helpers, so no work was done",
}
NO_BOTH = {
    "zh": "两家的人还没都在帮手里，没有施工",
    "en": "One of the families had no helper in the crew yet, so no work was done",
}
RAIN = {"zh": "下大雨，没有施工", "en": "Heavy rain: no work was done"}
LATE = {"zh": "修桥的期限已过", "en": "The time to mend the bridge has run out"}


# ---------------------------------------------------------------------------- the bridge


def _stop(world: Any, world_state: dict[str, Any], now: clock.Now) -> dict[str, str] | None:
    """Why the last morning of work that is over did no work, or None."""
    g = world_state["goals"]
    if "g_labor" in g["done"]:
        return None
    day = now.day if agenda_facts.morning_over(now, now.day) else now.day - 1
    if day < goals_work.WORK_FROM_DAY:
        return None
    start = agenda_facts.window_tick(day, goals_work.WORK_START_HOUR)
    if start > goals_work.labor_deadline():
        return dict(LATE)
    if weather.on_day(world_state, day) == weather.HEAVY_RAIN:
        return dict(RAIN)
    end = agenda_facts.window_tick(day, goals_work.WORK_END_HOUR)
    by_then = {"joined": [row for row in g["call"]["joined"] if row[1] <= end]}
    if goals_call.crew_ready(world, by_then):
        return None
    count, _ = goals_call.crew(world, by_then)
    return dict(NO_HANDS if count < goals_call.CREW else NO_BOTH)


def _helpers(world: Any, world_state: dict[str, Any]) -> tuple[list[dict[str, Any]], bool]:
    """The helpers who agreed by family, and whether both families have one."""
    count, per_family = agenda_facts.crew_counts(world, world_state)
    rows: list[dict[str, Any]] = [
        {"family": family, "count": per_family[family]} for family in goals_call.lay(world).families
    ]
    others = count - sum(per_family.values())
    if others:
        rows.append({"family": None, "count": others})
    return rows, all(n >= 1 for n in per_family.values())


# ---------------------------------------------------------------------------- truth and peace


def _last(world: Any, world_state: dict[str, Any], told: bool) -> dict[str, Any] | None:
    """The last full statement in public, as the board shows it."""
    last = assembly.last_statement(world_state)
    if last is None:
        return None
    when = clock.at(last["tick"])
    why = None if told else statement.why(world, world_state)
    return {
        "day": when.day,
        "hour": when.hour,
        "venue": last["venue"],
        "named": last["named"],
        "accepted": last["accepted"],
        "percent": last["percent"],
        "elder": last["elder"],
        "why": why,
    }


def _acts(world_state: dict[str, Any]) -> list[dict[str, Any]]:
    done = peace.done(world_state)
    return [{"id": act["id"], "text": dict(act["text"]), "done": done[act["id"]]} for act in ACTS]


# ---------------------------------------------------------------------------- the frame


def wire(world: Any, world_state: dict[str, Any], tick: int) -> dict[str, Any]:
    """The board as the frame has it, at ``tick``."""
    g = world_state["goals"]
    flags, now = g["flags"], clock.at(tick)
    helpers, both = _helpers(world, world_state)
    deadline = agenda_facts.deadline_time()
    told = TRUTH_TOLD in flags
    return {
        "helpers": helpers,
        "need": goals_call.CREW,
        "both": both,
        "hours": {"done": agenda_facts.hours_done(world_state), "need": goals_work.BRIDGE_HOURS},
        "window": agenda_facts.next_work_window(world, world_state, now),
        "stop": _stop(world, world_state, now),
        "deadline": {"day": deadline.day, "hour": deadline.hour},
        "needs": dict(goals_work.NEED),
        "statement": statement.summary(world_state),
        "truth": {"state": "done" if told else "open", "last": _last(world, world_state, told)},
        "peace": {
            "state": "done" if RECONCILED in flags else "open",
            "grudge": g["metrics"].get("grudge"),
            "acts": _acts(world_state),
            "witnessed": RECONCILE_SEEN in flags,
        },
    }


def frame(world: Any, state: dict[str, Any], out: dict[str, Any]) -> None:
    """``board``, in a world that keeps the goals of the festival."""
    if goals.keeps_the_goals(state["world"]):
        out["board"] = wire(world, state["world"], state["tick"])
