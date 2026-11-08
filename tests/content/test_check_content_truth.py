"""What the content checker holds of the tasks of the truth and the peace: the request, the kind and
the target that an action may name, a window of every day, and the terms of the hour, of what the
player looked for and holds, of the last statement in public and of the clan called to the hall.

Like the other tests of the checker these edit the parsed YAML in memory and run ``validate``.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

import check_content as cc

ROOT = Path(__file__).resolve().parents[2]
BASE = cc.load_sources(ROOT)
TELL = "t_tell_town"


def check(mutate: Callable[[cc.Sources], None]) -> list[str]:
    """Apply ``mutate`` to a copy of the parsed sources and return the errors."""
    src = copy.deepcopy(BASE)
    mutate(src)
    return cc.validate(src).errors


def has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


def task(src: cc.Sources, task_id: str) -> dict[str, Any]:
    return next(t for t in src.scripts["broken_bridge"]["tasks"] if t["id"] == task_id)


def action(**fields: Any) -> Callable[[cc.Sources], None]:
    """A change that gives the obstacle one action, written as a mapping."""

    def mutate(s: cc.Sources) -> None:
        task(s, TELL)["action"] = {**fields}

    return mutate


def appears(*conditions: dict[str, Any]) -> Callable[[cc.Sources], None]:
    def mutate(s: cc.Sources) -> None:
        task(s, TELL)["appears"] = list(conditions)

    return mutate


# --- what an action may name -----------------------------------------------------------------


def test_the_request_of_an_entrust_is_one_the_core_knows_and_goes_with_that_verb_alone():
    for request in cc.REQUEST_KINDS:
        if request not in ("persuade", "material"):  # they need a target, and an item, below
            assert check(action(verb="entrust", npc="zuzhang", request=request)) == [], request
    assert has(check(action(verb="entrust", npc="zuzhang", request="flatter")), "flatter")
    assert has(
        check(action(verb="ask", npc="zuzhang", request="testify")),
        "a request is for the verb entrust",
    )
    assert has(check(action(verb="entrust", npc="zuzhang")), "needs a request, or an item")
    # with only an item it is the material
    assert check(action(verb="entrust", npc="li_da", item="bamboo")) == []
    assert check(action(verb="entrust", npc="li_da", item="bamboo", request="material")) == []
    assert has(
        check(action(verb="entrust", npc="li_da", item="bamboo", request="testify")),
        "only a request for the goods names an item",
    )
    assert has(check(action(verb="entrust", npc="li_da", request="material")), "names the item")


def test_the_kind_of_a_speak_is_one_of_the_three_and_goes_with_that_verb_alone():
    for kind in cc.SPEAK_KINDS:
        assert check(action(verb="speak", kind=kind)) == [], kind
    assert check(action(verb="speak")) == []  # as it was: the statement of evidence
    assert has(check(action(verb="speak", kind="shout")), "kind", "shout")
    assert has(
        check(action(verb="move", place="p_teahouse", kind="meal")),
        "a kind is for the verb speak",
    )


def test_a_persuasion_names_the_person_to_talk_round_and_nothing_else_does():
    persuade = {"verb": "entrust", "npc": "zuzhang", "request": "persuade"}
    assert has(check(action(**persuade)), "names the person to talk round")
    assert check(action(**persuade, target="li_laotai")) == []
    assert has(check(action(**persuade, target="nowhere")), "unknown entity")
    assert has(check(action(**persuade, target="p_teahouse")), "target")
    assert has(
        check(action(verb="entrust", npc="zuzhang", request="testify", target="li_laotai")),
        "a target is for a request to persuade",
    )


def test_the_requests_and_the_kinds_the_checker_allows_are_those_of_the_core():
    from lantern_core.world.bridge import assembly, entrust

    assert set(cc.REQUEST_KINDS) == set(entrust.KINDS)
    assert cc.SPEAK_KINDS == assembly.KINDS
    assert cc.MISSED_CODES == assembly.MISSED


# --- the window of every day -----------------------------------------------------------------


def test_a_window_may_leave_out_its_day_and_with_one_it_has_to_be_in_the_game():
    assert "day" not in task(BASE, TELL)["window"]
    window = task(BASE, TELL)["window"]
    assert check(lambda s: None) == []

    def one_day(day: int) -> Callable[[cc.Sources], None]:
        def mutate(s: cc.Sources) -> None:
            task(s, TELL)["window"].pop("days")  # a window is on a day, or on days
            task(s, TELL)["window"].update(day=day)

        return mutate

    assert has(check(one_day(6)), "after the game")
    assert has(check(one_day(0)), "window.day")
    assert check(one_day(3)) == []
    assert (window["from"], window["to"]) == (17, 19)


def test_a_window_of_every_day_may_keep_to_days_that_are_in_the_game_and_not_to_a_day_as_well():
    window = task(BASE, TELL)["window"]
    assert window["days"] == [4, 5]
    for days in ([4, 5], [5, 5], [1, 5]):
        assert check(lambda s, d=days: task(s, TELL)["window"].update(days=d)) == [], days
    for days in ([5, 4], [0, 5], [4, 6], [3]):
        errors = check(lambda s, d=days: task(s, TELL)["window"].update(days=d))
        assert errors, days  # out of order, before the game, after it, or not a pair
    both = check(lambda s: task(s, TELL)["window"].update(day=4))
    assert has(both, "a window is on a day or on days, not both")


def test_what_spends_the_time_of_a_window_is_a_list_of_the_terms_of_the_tasks():
    assert task(BASE, TELL)["window"]["unless"] == [{"kind": "stated_today"}]
    assert task(BASE, "t_work_3")["window"]["unless"] == [{"kind": "weather", "is": "heavy_rain"}]
    for unless in (
        [{"kind": "stated_today"}, {"not": {"kind": "weather", "is": "clear"}}],
        [{"any": [{"kind": "stated_today"}, {"kind": "flag", "flag": "truth_told"}]}],
        [],
    ):
        assert check(lambda s, u=unless: task(s, TELL)["window"].update(unless=u)) == [], unless
    nothing = check(lambda s: task(s, TELL)["window"].update(unless=[{"kind": "no_such_term"}]))
    assert has(nothing, "window unless", "unknown term")
    rain = check(
        lambda s: task(s, TELL)["window"].update(unless=[{"kind": "weather", "is": "fog"}])
    )
    assert has(rain, "window unless")


def test_the_compiled_tasks_keep_the_day_of_a_window_and_say_none_for_a_daily_one():
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    by_id = {t["id"]: t for t in data["tasks"]}
    assert by_id["t_tea_tonight"]["window"]["day"] == 1
    assert by_id[TELL]["window"] == {
        "day": None,
        "days": [4, 5],
        "from": 17,
        "to": 19,
        "place": "p_teahouse",
        "unless": [{"kind": "stated_today"}],
    }
    # a window that names no days and nothing that spends it compiles as it did
    assert by_id["t_clear_rumour"]["window"] == {
        "day": None,
        "from": 17,
        "to": 19,
        "place": "p_teahouse",
    }
    assert by_id["t_festival_night"]["window"] == {
        "day": 5,
        "from": 18,
        "to": 21,
        "place": "p_bridge",
    }
    for each in data["tasks"]:  # an action has the three keys only where it names something
        options = [*each["action"], *(o for rule in each["blocked"] for o in rule["action"])]
        for option in options:
            for key in cc.ACTION_EXTRAS:
                assert option.get(key, "") is not None, (each["id"], key)
    lead = by_id["t_how_broke"]["action"]
    assert [(o["verb"], o["npc"], o["place"], o["item"], o.get("request")) for o in lead] == [
        ("look", None, "p_bridge", "t_rail", None),  # a look names the place the thing lies at
        ("look", None, "p_under_bridge", None, None),
        ("talk", "old_he", None, None, None),  # and for each who turned the manager away: a talk,
        ("promise", "old_he", None, None, None),  # a promise, and the look or the question again
        ("look", None, "p_ferry", "t_he_boat", None),
        ("talk", "gengfu", None, None, None),
        ("promise", "gengfu", None, None, None),
        ("entrust", "gengfu", None, None, "testify"),
        ("talk", "xiao_man", None, None, None),
        ("promise", "xiao_man", None, None, None),
        ("entrust", "xiao_man", None, None, "testify"),
    ]
    assert [(o["verb"], o["kind"]) for o in by_id["t_make_peace"]["action"] if "kind" in o] == [
        ("speak", "meal"),
        ("speak", "meal"),
    ]


# --- the terms ---------------------------------------------------------------------------------


def test_the_terms_of_the_truth_and_the_peace_take_the_arguments_they_do():
    every = [
        {"kind": "hours", "from": 7, "to": 18},
        {"kind": "looked", "items": ["e_footprint"]},
        {"kind": "evidence", "items": ["e_footprint", "e_repair_record"]},
        {"kind": "told"},
        {"kind": "told", "missed": "named"},
        {"kind": "meeting"},
        {"not": {"kind": "meeting"}},
        {"kind": "grudge", "below": 30},
    ]
    assert check(appears(*every)) == []
    assert has(check(appears({"kind": "hours", "from": 5, "to": 18})), "hours.from")
    assert has(check(appears({"kind": "hours", "from": 7})), "term 'hours' takes")
    assert has(check(appears({"kind": "hours", "from": 7, "to": 25})), "hours.to")
    assert has(check(appears({"kind": "looked", "items": []})), "items of evidence")
    assert has(check(appears({"kind": "looked", "items": ["e_nothing"]})), "e_nothing")
    assert has(check(appears({"kind": "evidence", "items": "e_footprint"})), "items of evidence")
    assert has(
        check(appears({"kind": "told", "missed": "late"})), "expected one of parts, proof, named"
    )
    assert has(check(appears({"kind": "meeting", "place": "p_clan_hall"})), "term 'meeting' takes")
    assert has(check(appears({"kind": "grudge"})), "term 'grudge' takes")
    assert has(check(appears({"kind": "grudge", "below": 0})), "from 1 to 100")
    assert has(check(appears({"kind": "grudge", "below": 101})), "from 1 to 100")
    assert has(check(appears({"kind": "grudge", "below": "low"})), "from 1 to 100")


def test_the_core_has_the_terms_the_checker_has():
    from lantern_core.world.bridge import agenda_terms

    assert agenda_terms.spec() == cc.TASK_TERMS
    assert {"hours", "looked", "evidence", "told", "meeting", "grudge"} <= set(cc.TASK_TERMS)
