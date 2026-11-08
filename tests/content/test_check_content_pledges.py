"""What the content checker holds of the task that keeps the manager's promises: the template that
is made into a task for each of the first promises, the term ``pledge``, the action that keeps one,
the words about the person and the lapse.

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
KEEP = "t_keep"
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


def appears(*conditions: dict[str, Any]) -> Callable[[cc.Sources], None]:
    def mutate(s: cc.Sources) -> None:
        task(s, TELL)["appears"] = list(conditions)

    return mutate


def action(**fields: Any) -> Callable[[cc.Sources], None]:
    def mutate(s: cc.Sources) -> None:
        task(s, TELL)["action"] = {**fields}

    return mutate


def compiled() -> dict[str, dict[str, Any]]:
    data = json.loads((ROOT / "content" / "compiled" / "broken_bridge.json").read_text("utf-8"))
    return {t["id"]: t for t in data["tasks"]}


# --- the template ---------------------------------------------------------------------------


def test_the_script_writes_the_task_once_and_the_compiled_script_has_one_for_each_promise():
    assert [t["id"] for t in BASE.scripts["broken_bridge"]["tasks"] if t["id"] == KEEP] == [KEEP]
    assert task(BASE, KEEP)["per"] == "pledge"
    found = compiled()
    assert KEEP not in found
    for number in range(1, cc.PLEDGE_CARDS + 1):
        each = found[f"{KEEP}_{number}"]
        assert each["pledge"] == number and "per" not in each
        assert each["priority"] == 60 + number - 1  # no two as urgent as each other
        assert each["kind"] == "promise" and each["job"] is None
        (keep,) = each["action"]
        assert (keep["verb"], keep["npc"], keep["kind"]) == ("promise", f"$pledge{number}", "keep")
        assert {"kind": "pledge", "n": number} in each["appears"]
        assert each["done"] == [{"kind": "pledge", "n": number, "state": "kept"}]
        assert each["stale"] == [{"kind": "pledge", "n": number, "state": "broken"}]
        for words in (each["text"], each["lapse"], *each["why"], *each["next"]):
            for lang in ("zh", "en"):
                names = {n for n in cc.SLOT_NAME.findall(words[lang])}
                assert all(n.startswith(f"pledge{number}_") for n in names), (number, words)
        assert "{pledge" in each["text"]["zh"] and "{pledge" in each["lapse"]["en"]


def test_the_other_tasks_have_none_of_the_keys_of_a_promise():
    for task_id, each in compiled().items():
        if not task_id.startswith(f"{KEEP}_"):
            assert not {"per", "pledge", "lapse"} & set(each), task_id


def test_the_checker_and_the_core_agree_on_the_promises():
    from lantern_core.world.bridge import agenda_facts, agenda_terms, pledges

    assert cc.PLEDGE_CARDS == pledges.CARDS
    assert cc.PLEDGE_STATES == agenda_terms.PLEDGE_STATES
    assert cc.PLEDGE_DUE == agenda_terms.PLEDGE_DUE
    assert cc.AGENDA_FACTS == agenda_facts.NAMES
    assert cc.PLEDGE_NAME.pattern == agenda_facts.PLEDGE_SLOT.pattern.replace("(\\w+)", "\\w+")
    assert agenda_terms.spec() == cc.TASK_TERMS
    assert cc.PLEDGE == "$pledge"


def test_a_template_of_another_kind_is_refused():
    assert has(check(lambda s: task(s, KEEP).update(per="stall")), "per")


# --- the term -------------------------------------------------------------------------------


def test_the_term_of_a_promise_takes_its_number_and_perhaps_a_state_and_a_day():
    every = [
        {"kind": "pledge", "n": 1},
        {"kind": "pledge", "n": 8, "state": "open"},
        {"kind": "pledge", "n": 3, "state": "kept", "due": "ahead"},
        {"kind": "pledge", "n": 2, "state": "broken"},
        {"kind": "pledge", "n": 2, "due": "today"},
    ]
    assert check(appears(*every)) == []
    assert has(check(appears({"kind": "pledge"})), "term 'pledge' takes")
    assert has(check(appears({"kind": "pledge", "n": 0})), "pledge.n", "from 1 to 20")
    assert has(check(appears({"kind": "pledge", "n": 21})), "pledge.n", "from 1 to 20")
    assert has(check(appears({"kind": "pledge", "n": "first"})), "pledge.n")
    assert has(check(appears({"kind": "pledge", "n": 1, "state": "lost"})), "open, kept, broken")
    assert has(check(appears({"kind": "pledge", "n": 1, "due": "never"})), "today, ahead")
    assert has(check(appears({"kind": "pledge", "n": 1, "by": "li_da"})), "term 'pledge' takes")


def test_the_term_that_asks_if_the_hours_that_are_left_are_enough_takes_nothing():
    assert check(appears({"kind": "work_short"})) == []
    assert has(check(appears({"kind": "work_short", "at_least": 1})), "term 'work_short' takes")


# --- the action -----------------------------------------------------------------------------


def test_an_action_that_keeps_a_promise_is_a_promise_of_the_kind_keep_for_a_person_of_one():
    assert check(action(verb="promise", npc="$pledge1", kind="keep")) == []
    assert has(check(action(verb="promise", npc="$pledge1")), "is for a promise of the kind keep")
    assert has(
        check(action(verb="entrust", npc="$pledge1", request="join")),
        "is for a promise of the kind keep",
    )
    assert has(check(action(verb="promise", npc="li_da", kind="return")), "not one of")
    assert check(action(verb="promise", npc="li_da", kind="keep")) == []
    assert has(
        check(action(verb="move", place="p_teahouse", kind="keep")),
        "a kind is for the verb speak or promise",
    )


# --- the words ------------------------------------------------------------------------------


def test_the_title_of_a_task_has_no_slots_but_that_of_a_promise_names_the_person():
    def slotted(s: cc.Sources) -> None:
        task(s, "t_who_said")["text"]["zh"] += "{helpers}"
        task(s, "t_who_said")["text"]["en"] += "{helpers}"

    assert has(check(slotted), "the title has no slots")
    assert check(lambda s: task(s, KEEP)["text"].update(zh="兑现对{pledge_to}的许诺")) == []
    assert has(
        check(lambda s: task(s, KEEP)["text"].update(zh="兑现对{nobody}的许诺")),
        "{nobody} is not a number the words can carry",
    )
    assert has(
        check(lambda s: task(s, KEEP)["text"].update(zh="兑现对{pledge_to}的{pledge_what}")),
        "the two languages write different slots",
    )


def test_the_words_of_a_promise_are_about_that_promise_and_no_other():
    def other(s: cc.Sources) -> None:
        task(s, KEEP)["why"][0]["zh"] += "{pledge2_to}"
        task(s, KEEP)["why"][0]["en"] += "{pledge2_to}"

    assert has(check(other), "words of another promise")


def test_what_the_bar_says_of_a_lapse_is_for_the_task_of_a_promise_and_has_the_same_slots():
    words = {"zh": "你失信了", "en": "You broke your word"}
    assert has(
        check(lambda s: task(s, "t_who_said").update(lapse=words)),
        "lapse is for the task of a promise",
    )
    assert has(
        check(lambda s: task(s, KEEP)["lapse"].update(zh="你对{pledge_to}失信了")),
        "the two languages write different slots",
    )
    plain = {"zh": "你失信了", "en": "You broke your word"}
    assert check(lambda s: task(s, KEEP)["lapse"].update(plain)) == []
