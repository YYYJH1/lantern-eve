"""The ten people who carry the five days: what they say by the state of the game, what each of them
wants, and what is said of each of them at the end.

``roles`` chooses, from the lists in ``content/lines``, the first entry whose conditions hold: a
greeting as a talk opens, a last word as the manager leaves, an epilogue for the ending page. The
tests below hold the lists to the terms the checker knows, play the choice (the conditions, their
order, what they read), show that the choice reads nothing of which story is true, and follow the
epilogue through every outcome and through the ending of a whole game.
"""

from __future__ import annotations

import itertools
import json
import re

import pytest
from agenda_helpers import frame_now, idle, meet, slice_game
from bridge_helpers import CLEAR, at, bridge, run_to, state_of, world_of
from player_helpers import act, beside, events, me, silence

import bots
import check_content as cc
import voice_content as vc
from lantern_core import canon
from lantern_core.api import Game, preset
from lantern_core.cognition.beliefs import Belief
from lantern_core.world.bridge import (
    agenda,
    agenda_terms,
    assembly,
    clock,
    notebook,
    notes,
    projection,
    roles,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

TEN = (
    "li_laotai",
    "li_da",
    "li_er",
    "zhou_zhanggui",
    "zhou_dalang",
    "zhou_huoji",
    "cha_laoban",
    "old_he",
    "zuzhang",
    "gengfu",
)
CLAIM = "pr_set_straight"
VARIANTS = ("v_boat", "v_flood", "v_drunk")
# words that tell which story is true: no line of the lists says one unless the truth was told
STORY = re.compile(r"撑船|船头|撞|秋汛|冲松|踢|醉|rammed|struck the rail|flood|kicked|drunk", re.I)


# ------------------------------------------------------------------------------ helpers


def env_of(game: Game, tick: int | None = None) -> agenda_terms.Env:
    """The world, its state and the clock at ``tick`` (now, by default)."""
    return agenda_terms.Env(
        world_of(game), state_of(game), clock.at(game.tick if tick is None else tick)
    )


def raise_flag(game: Game, flag: str) -> None:
    state_of(game)["goals"]["flags"][flag] = 1


def pledge(game: Game, to: str, state: str) -> None:
    """A promise of the manager to ``to`` in that state (a stall, as the offers make it)."""
    rows = me(game)["pledges"]
    rows.append(
        {
            "id": f"k{len(rows) + 1}", "to": to, "what": "stall", "item": "back", "amount": 0,
            "size": 1, "made": 0, "due": 2, "state": state, "ended": 0,
        }
    )  # fmt: skip


def hold(game: Game, person: str, prop: str, confidence: int = 90) -> None:
    belief = Belief(person, prop, "assert", confidence, "saw", None, None, 0, 0)
    notes.hold(state_of(game)["social"], belief)


def deliver(game: Game, by: str, item: str, state: str = "delivered") -> None:
    state_of(game)["commitments"]["list"].append(
        {
            "id": f"m{len(state_of(game)['commitments']['list']) + 1}", "by": by, "item": item,
            "amount": 4, "made": 0, "due": {"day": 2, "hour": 6}, "start": 0, "due_at": 0,
            "late_at": 0, "task": 0, "state": state, "reason": "", "ended": 10,
        }
    )  # fmt: skip


def pick(game: Game, person: str, kind: str, before: int | None = None, tick: int | None = None):
    return roles.pick(env_of(game, tick), person, kind, before)


def bubble(out: dict, person: str) -> dict | None:
    """The words over a head in the frame of a call, or None."""
    found = [b["text"] for b in out["frame"]["bubbles"] if b["npc"] == person and b["text"]]
    return found[-1] if found else None


def lines_of(person: str, kind: str, entry: str) -> list[dict]:
    found = roles.entry_of(person, kind, entry)
    assert found is not None, (person, kind, entry)
    return found["lines"]


def leaves(conds: list) -> list[dict]:
    return cc.condition_leaves(conds)


# ------------------------------------------------------------------------------ the lists


def test_ten_people_of_the_cast_carry_the_days_and_nobody_else():
    assert roles.people() == TEN
    assert [p for p in lore().people if p in TEN] == list(TEN)  # in the order of the cast
    for person in lore().people:
        voice = VOICES[person]
        carries = person in TEN
        assert all((kind in voice) == carries for kind in roles.LISTS), person


@pytest.mark.parametrize("person", TEN)
def test_a_list_is_tried_in_order_and_its_last_entry_always_holds(person):
    for kind in roles.LISTS:
        entries = roles.entries(person, kind)
        assert len(entries) >= 4, (person, kind)
        ids = [e["id"] for e in entries]
        assert len(set(ids)) == len(ids), (person, kind)
        assert entries[-1]["when"] == [], (person, kind)
        assert all(e["when"] for e in entries[:-1]), (person, kind)
        for entry in entries:
            assert entry["text" if kind == "epilogue" else "lines"], (person, kind, entry["id"])


@pytest.mark.parametrize("person", TEN)
def test_a_greeting_starts_with_the_first_meeting_and_ends_with_the_plain_one(person):
    entries = roles.entries(person, roles.GREET)
    assert entries[0]["id"] == "new" and entries[0]["when"] == [{"kind": "acquainted", "is": "new"}]
    assert entries[-1]["id"] == "plain" and len(entries[-1]["lines"]) >= 2
    again = [e for e in entries if e["id"] == "again"]
    assert len(again) == 1 and again[0]["when"] == [{"kind": "acquainted", "is": "today"}]


def test_the_terms_of_the_lists_are_those_of_the_checker_and_the_checker_knows_each_argument():
    assert set(roles.names()) == set(vc.ROLE_TERMS)
    assert set(vc.ROLE_AGENDA_TERMS) <= set(agenda_terms.TERMS)
    for name in vc.ROLE_AGENDA_TERMS:  # the terms of the tasks that the lists may use
        assert cc.ROLE_VOCABULARY[name] == cc.TASK_TERMS[name] == agenda_terms.spec()[name]
    assert set(cc.ROLE_VOCABULARY) == set(vc.ROLE_TERMS) | set(vc.ROLE_AGENDA_TERMS)


def test_every_condition_of_every_list_is_a_term_of_that_vocabulary():
    for person in TEN:
        for kind in roles.LISTS:
            for entry in roles.entries(person, kind):
                for leaf in leaves(entry["when"]):
                    assert leaf["kind"] in cc.ROLE_VOCABULARY, (person, kind, entry["id"], leaf)


def test_the_people_some_story_blames_are_those_the_roles_name_and_their_lists_read_no_belief():
    blamed = {assembly.culprit_of(variant["id"]) for variant in SCRIPT["variants"]}
    assert blamed - {None} == set(roles.CULPRITS) == {"old_he", "zhou_dalang"}
    for person in roles.CULPRITS:
        for kind in roles.LISTS:
            for entry in roles.entries(person, kind):
                for leaf in leaves(entry["when"]):
                    assert leaf["kind"] not in vc.BELIEF_TERMS, (person, kind, entry["id"])


def test_only_a_claim_made_in_public_is_asked_after():
    asked = {
        prop
        for person in TEN
        for kind in roles.LISTS
        for entry in roles.entries(person, kind)
        for leaf in leaves(entry["when"])
        if leaf["kind"] == "knows"
        for prop in leaf["props"]
    }
    assert asked == {CLAIM} and set(vc.KNOWABLE) == {CLAIM}


def test_only_a_greeting_asks_if_the_talk_is_a_first_one():
    for person in TEN:
        for kind in ("chat", "epilogue"):
            for entry in roles.entries(person, kind):
                assert all(leaf["kind"] != "acquainted" for leaf in leaves(entry["when"]))


def test_no_line_of_the_lists_says_which_story_is_true_unless_the_truth_was_told():
    for person in TEN:
        for kind in ("greet", "chat"):
            for entry in roles.entries(person, kind):
                for pair in entry["lines"]:
                    assert not STORY.search(pair["zh"] + pair["en"]), (person, kind, entry["id"])
        for entry in roles.entries(person, "epilogue"):
            said = entry["text"]["zh"] + entry["text"]["en"]
            if STORY.search(said):
                kinds = {leaf["kind"] for leaf in leaves(entry["when"])}
                assert "told_cause" in kinds, (person, entry["id"])


# ------------------------------------------------------------------------------ the choice


def test_the_first_entry_whose_conditions_hold_is_the_one_and_a_state_further_down_waits():
    game = slice_game()
    person, tick = "li_laotai", at(1, 8, 0)
    assert pick(game, person, "greet", 0, tick) == "new"  # the first meeting
    assert pick(game, person, "greet", 1, tick) == "again"  # a second talk the same day
    assert pick(game, person, "greet", 0, at(2, 8, 0)) == "new"  # whatever the day: never met
    hold(game, person, CLAIM)  # she knows the slander was cleared
    assert pick(game, person, "greet", 1, at(2, 8, 0)) == "cleared"
    deliver(game, "li_da", "bamboo")  # and the bamboo came: the bamboo stands before the clearing
    assert pick(game, person, "greet", 1, at(2, 8, 0)) == "bamboo"
    pledge(game, person, "kept")  # a promise to her was kept: that stands before the bamboo
    assert pick(game, person, "greet", 1, at(2, 8, 0)) == "kept"
    raise_flag(game, "truth_told")
    assert pick(game, person, "greet", 1, at(2, 8, 0)) == "truth"
    raise_flag(game, "reconcile_seen")  # the peace stands before the truth
    assert pick(game, person, "greet", 1, at(2, 8, 0)) == "peace"
    assert (
        pick(game, person, "greet", 1, at(5, 16, 0)) == "festival"
    )  # and the festival before that
    pledge(game, person, "broken")  # a broken word stands before everything but a first meeting
    assert pick(game, person, "greet", 1, at(5, 16, 0)) == "broken"
    assert pick(game, person, "greet", 0, at(5, 16, 0)) == "new"


def test_a_state_that_nothing_in_a_list_speaks_for_gets_the_plain_entry():
    game = slice_game()
    for person in TEN:
        for kind in ("greet", "chat"):
            assert pick(game, person, kind, 1, at(2, 7, 0)) == "plain", (person, kind)
        assert pick(game, person, "greet", 1, at(1, 7, 0)) == "again", person
    assert pick(game, "li_laotai", "chat", None, at(1, 9, 0)) == "plain"


def test_a_promise_is_to_one_person_and_a_kept_one_does_not_cancel_a_broken_one():
    game = slice_game()
    pledge(game, "li_da", "broken")
    assert pick(game, "li_da", "greet", 1, at(2, 8, 0)) == "broken"
    assert pick(game, "li_laotai", "greet", 1, at(2, 8, 0)) != "broken"
    pledge(game, "li_da", "kept")
    assert pick(game, "li_da", "greet", 1, at(2, 8, 0)) == "broken"


def test_the_clock_and_the_sky_are_read_from_the_time_asked_about():
    game = slice_game()
    assert pick(game, "zhou_zhanggui", "chat", None, at(5, 14, 59)) == "plain"
    assert pick(game, "zhou_zhanggui", "chat", None, at(5, 15, 0)) == "festival"
    assert pick(game, "zhou_zhanggui", "chat", None, at(4, 21, 0)) == "plain"
    state_of(game)["weather"]["kind"] = "heavy_rain"
    assert pick(game, "old_he", "greet", 1, at(2, 8, 0)) == "rain"
    state_of(game)["weather"]["kind"] = "clear"
    assert pick(game, "old_he", "greet", 1, at(2, 8, 0)) == "plain"


def test_a_head_who_stopped_accusing_in_public_says_so_and_nobody_else_does():
    game = slice_game()
    me(game)["public"]["eased"] = {"stop": ["zhou_zhanggui"]}
    assert pick(game, "zhou_zhanggui", "greet", 1, at(2, 8, 0)) == "stopped"
    assert pick(game, "li_laotai", "greet", 1, at(2, 8, 0)) != "stopped"


def test_the_rumour_is_cleared_when_somebody_took_a_clarification_in_or_the_truth_was_told():
    game, when = slice_game(), at(1, 8, 0)
    assert pick(game, "li_er", "greet", 1, when) == "again"
    me(game)["public"]["clarified"] = ["n1|n2"]
    assert pick(game, "li_er", "greet", 1, when) == "cleared"
    twin = slice_game()
    raise_flag(twin, "truth_told")
    assert pick(twin, "li_er", "greet", 1, when) == "truth"


def test_what_a_person_knows_moves_their_own_choice_and_only_theirs():
    game = slice_game()
    when = at(1, 8, 0)
    before = {p: pick(game, p, "greet", 1, when) for p in TEN}
    hold(game, "li_da", CLAIM)
    after = {p: pick(game, p, "greet", 1, when) for p in TEN}
    assert before["li_da"] == "again" and after["li_da"] == "cleared"
    assert {p for p in TEN if before[p] != after[p]} == {"li_da"}
    hold(game, "li_da", CLAIM, confidence=10)  # a claim held too weakly is not known
    assert pick(game, "li_da", "greet", 1, when) == "again"


def test_the_truth_told_names_its_cause_for_the_epilogue_and_no_greeting_asks_for_it():
    game = slice_game()
    raise_flag(game, "truth_told")
    for cause, wants in (("boat", "owned"), ("flood", "flood"), ("drunk", "drunk")):
        me(game)["public"][roles.TOLD_CAUSE] = cause
        assert pick(game, "old_he", "epilogue") == wants
    me(game)["public"].pop(roles.TOLD_CAUSE)
    assert pick(game, "old_he", "epilogue") == "busy"


# ------------------------------------------------------------------------------ the words


@pytest.mark.parametrize("person", TEN)
def test_a_greeting_is_over_the_head_as_the_talk_opens_and_a_last_word_as_the_manager_leaves(
    person,
):
    game = slice_game()
    run_to(game, at(1, 15, 0))  # the watchman is up from two, the son of the house from ten
    out = meet(game, person)
    entry = state_of(game)["player"]["line"][4]
    assert state_of(game)["player"]["line"][:4] == [
        person,
        state_of(game)["player"]["talk"]["until"],
        "role",
        "greet",
    ]
    assert entry == "new"  # the first talk of the game
    assert bubble(out, person) in lines_of(person, "greet", "new")
    assert not any(e["kind"] == "replied" for e in out["events"])  # it answers nothing
    out = act(game, "leave")
    last = state_of(game)["player"]["line"]
    assert last[0] == person and last[2:4] == ["role", "chat"]
    assert bubble(out, person) in lines_of(person, "chat", last[4])
    second = meet(game, person)
    assert state_of(game)["player"]["line"][4] == "again"
    assert bubble(second, person) in lines_of(person, "greet", "again")


def test_the_state_keeps_no_words_of_the_greeting_and_the_words_do_not_change_while_it_is_shown():
    game = slice_game()
    run_to(game, at(1, 8, 0))
    out = meet(game, "li_laotai")
    row = state_of(game)["player"]["line"]
    assert all(isinstance(part, (str, int)) for part in row) and "老婆子" not in json.dumps(row)
    said = bubble(out, "li_laotai")
    for _ in range(3):
        assert bubble(idle(game), "li_laotai") == said


def test_a_person_outside_the_ten_greets_with_nothing_and_a_declined_talk_has_the_fixed_line():
    game = slice_game()
    run_to(game, at(1, 12, 0))
    out = meet(game, "li_xiaomei")
    assert state_of(game)["player"]["line"] == []
    assert bubble(out, "li_xiaomei") is None
    out = act(game, "leave")
    assert bubble(out, "li_xiaomei") is None and state_of(game)["player"]["line"] == []


def test_a_person_who_has_to_go_says_the_fixed_line_and_no_last_word():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 11, 58))
    beside(game, "cha_laoban")
    silence(game)
    out = act(game, "talk", npc="cha_laoban")
    assert state_of(game)["player"]["line"][2:4] == ["role", "greet"]
    outs = [act(game, "ask", topic="t_rail")]
    while outs[-1]["clock"]["rate"] == list(clock.DEBT_RATE):
        outs.append(json.loads(game.step()))
    assert [e["reason"] for o in outs for e in events(o, "talk_end")] == ["timeout"]
    line = state_of(game)["player"]["line"]
    assert line[0] == "cha_laoban" and line[2:4] == ["text", "timeout"]
    assert out["frame"]["bubbles"]


def test_a_voice_picks_a_variant_by_the_person_the_entry_and_the_tick_and_nothing_else():
    entry = roles.entry_of("li_laotai", "greet", "plain")
    assert entry is not None and len(entry["lines"]) == 2
    seen = {roles.words("li_laotai", "greet", "plain", tick)["zh"] for tick in range(0, 4000, 37)}
    assert seen == {pair["zh"] for pair in entry["lines"]}  # both are used, over the days
    assert roles.words("li_laotai", "greet", "plain", 99) == roles.words(
        "li_laotai", "greet", "plain", 99
    )
    plain = roles.words("li_laotai", "greet", "plain", 99, plain=True)
    assert plain == entry["lines"][0]


def reachable(person: str, kind: str) -> set[str]:
    """The entries of a list that some state of the game makes the first that holds: every
    combination of what the conditions of the lists read (the flags of the festival, the
    clarification, what the person knows, a promise to them, the goods, the head who stopped
    accusing, the call of the clan, the sky and the festival night, and whether the manager has
    talked with them)."""
    game = slice_game()
    state, section, found = state_of(game), me(game), set()
    flags = ("truth_told", "reconcile_seen", "bridge_fixed")
    beliefs = state["social"]["beliefs"][person]
    for mask in range(1 << len(flags)):
        state["goals"]["flags"].clear()
        state["goals"]["flags"].update({f: 1 for n, f in enumerate(flags) if mask >> n & 1})
        for clarified, knows, stopped, called, rain, festival in itertools.product(
            (0, 1), repeat=6
        ):
            section["public"]["clarified"] = ["n1|n2"] if clarified else []
            beliefs.pop(CLAIM, None)
            if knows:
                hold(game, person, CLAIM)
            section["public"]["eased"] = {"stop": [person] if stopped else []}
            section["meeting"] = (
                {"tick": 0, "until": 10**7, "day": 1, "invited": []} if called else {}
            )
            state["weather"]["kind"] = "heavy_rain" if rain else "clear"
            tick = at(5, 16, 0) if festival else at(2, 8, 0)
            for pledged, delivered in itertools.product((None, "kept", "broken"), (0, 1)):
                section["pledges"].clear()
                if pledged:
                    pledge(game, person, pledged)
                state["commitments"]["list"].clear()
                if delivered:
                    deliver(game, "li_da", "bamboo")
                    deliver(game, "zhou_zhanggui", "timber")
                for before in (0, 1, 2) if kind == "greet" else (None,):
                    day = clock.at(tick).day
                    # never met, met earlier today, met on an earlier day
                    asked = None if before is None else (0, day, day - 1)[before]
                    found.add(pick(game, person, kind, asked, tick))
    return found


@pytest.mark.parametrize("person", TEN)
def test_every_entry_of_every_list_is_the_one_chosen_in_some_state_and_none_hides_another(person):
    for kind in ("greet", "chat"):
        ids = {entry["id"] for entry in roles.entries(person, kind)}
        assert reachable(person, kind) == ids, (person, kind)


@pytest.mark.parametrize("person", TEN)
def test_every_epilogue_can_be_chosen_by_some_way_the_last_night_can_go(person):
    ids = {entry["id"] for entry in roles.entries(person, "epilogue")}
    found = set()
    flags = ("bridge_fixed", "detour_done", "truth_told", "reconciled")
    for mask in range(1 << len(flags)):
        for cause, cleared, promise, bamboo in itertools.product(
            (None, *vc.CAUSES), (False, True), (None, "kept", "broken"), (False, True)
        ):
            if cause is not None and not mask >> 2 & 1:
                continue  # a cause is told only with the truth
            chosen = outcome(
                tuple(f for n, f in enumerate(flags) if mask >> n & 1),
                cause=cause,
                broken=(person,) if promise == "broken" else (),
                kept=(person,) if promise == "kept" else (),
                clarified=cleared,
                bamboo=bamboo,
            )
            found.add(chosen[person])
    assert found == ids, person


def test_a_line_or_an_epilogue_of_an_entry_that_the_content_lost_is_silence_and_not_a_crash():
    assert roles.words("li_laotai", "greet", "no_such_entry", 99) == roles.SILENCE
    assert roles.words("li_laotai", "chat", "no_such_entry", 99, plain=True) == roles.SILENCE
    wired = roles.epilogue_wire([["li_laotai", "no_such_entry"], ["li_laotai", "apart"]])
    assert [line["id"] for line in wired] == ["apart"]


# ------------------------------------------------------------------------------ the epilogue


def outcome(
    flags: tuple[str, ...] = (),
    cause: str | None = None,
    broken: tuple[str, ...] = (),
    clarified: bool = False,
    kept: tuple[str, ...] = (),
    bamboo: bool = False,
) -> dict[str, str]:
    """The entry chosen for each of the ten in a last night with these flags, the promises kept or
    broken to some of them, and the bamboo of the Li house at the bridge or not."""
    game = slice_game()
    for flag in flags:
        raise_flag(game, flag)
    if cause is not None:
        me(game)["public"][roles.TOLD_CAUSE] = cause
    if clarified:
        me(game)["public"]["clarified"] = ["n1|n2"]
    for person in broken:
        pledge(game, person, "broken")
    for person in kept:
        pledge(game, person, "kept")
    if bamboo:
        deliver(game, "li_da", "bamboo")
    rows = roles.epilogue(world_of(game), state_of(game), clock.at(at(5, 21, 0)))
    assert [person for person, _ in rows] == list(TEN)
    return dict(rows)


FULL = ("bridge_fixed", "truth_told", "reconciled", "reconcile_seen")


def test_a_perfect_night_has_the_whole_cast_cross_together():
    chosen = outcome(FULL, cause="boat")
    assert chosen == {
        "li_laotai": "full",
        "li_da": "full",
        "li_er": "full",
        "zhou_zhanggui": "full",
        "zhou_dalang": "cleared",
        "zhou_huoji": "told",
        "cha_laoban": "full",
        "old_he": "owned",
        "zuzhang": "full",
        "gengfu": "heard",
    }


def test_the_bridge_mended_and_the_families_at_peace_without_the_truth():
    chosen = outcome(("bridge_fixed", "reconciled", "reconcile_seen"), clarified=True)
    assert chosen["li_laotai"] == chosen["li_da"] == chosen["zhou_zhanggui"] == "bridge_peace"
    assert chosen["li_er"] == "cleared_bridge" and chosen["zhou_huoji"] == "cleared"
    assert chosen["cha_laoban"] == "peace" and chosen["zuzhang"] == "bridge"
    assert chosen["old_he"] == "idle" and chosen["gengfu"] == "bridge"
    assert chosen["zhou_dalang"] == "bridge"


def test_the_bridge_mended_and_the_truth_told_without_the_peace():
    chosen = outcome(("bridge_fixed", "truth_told"), cause="flood")
    assert chosen["zuzhang"] == "truth_bridge" and chosen["cha_laoban"] == "truth"
    assert chosen["li_laotai"] == "bridge" and chosen["li_er"] == "full"
    assert chosen["old_he"] == "flood" and chosen["zhou_dalang"] == "cleared"


def test_the_lane_in_place_of_the_bridge():
    chosen = outcome(("detour_done",), clarified=True)
    assert chosen["li_laotai"] == chosen["li_da"] == chosen["zhou_zhanggui"] == "detour"
    assert chosen["li_er"] == "cleared_detour" and chosen["zuzhang"] == "detour"
    assert chosen["gengfu"] == "detour" and chosen["zhou_dalang"] == "detour"
    assert chosen["old_he"] == "busy"


def test_no_way_across_and_nothing_done():
    chosen = outcome()
    assert chosen == {
        "li_laotai": "apart",
        "li_da": "apart",
        "li_er": "apart",
        "zhou_zhanggui": "apart",
        "zhou_dalang": "apart",
        "zhou_huoji": "hiding",
        "cha_laoban": "apart",
        "old_he": "busy",
        "zuzhang": "apart",
        "gengfu": "alone",
    }


def test_li_er_is_cleared_or_still_blamed_whatever_the_way_across():
    assert outcome(("bridge_fixed",))["li_er"] == "blamed"
    assert outcome(("detour_done",))["li_er"] == "blamed"
    assert outcome(("bridge_fixed",), clarified=True)["li_er"] == "cleared_bridge"
    assert outcome(("bridge_fixed", "truth_told"))["li_er"] == "full"
    assert outcome(clarified=True)["li_er"] == "apart"


def test_the_clerk_who_saw_is_heard_when_the_rumour_is_cleared():
    assert outcome()["zhou_huoji"] == "hiding"
    assert outcome(clarified=True)["zhou_huoji"] == "cleared"
    assert outcome(("truth_told",), cause="drunk")["zhou_huoji"] == "told"


def test_a_promise_that_was_broken_is_remembered_by_the_person_it_was_made_to():
    chosen = outcome(FULL, cause="boat", broken=("li_laotai", "zhou_huoji"))
    assert chosen["li_laotai"] == chosen["zhou_huoji"] == "word_broken"
    assert chosen["li_da"] == "full" and chosen["zhou_zhanggui"] == "full"
    only = outcome(("bridge_fixed",), broken=("zhou_zhanggui", "li_da"))
    assert only["zhou_zhanggui"] == only["li_da"] == "word_broken"


def test_a_promise_that_was_kept_is_in_the_epilogue_of_a_perfect_night_of_those_it_was_made_to():
    kept = ("li_laotai", "li_da", "zhou_zhanggui", "zuzhang", "gengfu", "li_er", "old_he")
    chosen = outcome(FULL, cause="boat", kept=kept)
    assert [chosen[p] for p in ("li_laotai", "li_da", "zhou_zhanggui", "zuzhang")] == [
        "full_kept"
    ] * 4
    assert chosen["gengfu"] == "heard_kept"
    assert (
        chosen["li_er"] == "full" and chosen["old_he"] == "owned"
    )  # whose lists keep it for the greeting
    assert outcome(FULL, cause="boat", kept=("li_da",))["li_laotai"] == "full"  # to one, not to all
    # a broken word stands before it
    both = outcome(FULL, cause="boat", kept=("li_da",), broken=("li_da",))
    assert both["li_da"] == "word_broken"


def test_granny_li_is_told_of_in_the_words_of_the_bamboo_her_house_lent():
    assert outcome(("bridge_fixed",), bamboo=True)["li_laotai"] == "bridge"
    assert outcome(("detour_done",), bamboo=True)["li_laotai"] == "unused"
    assert outcome(("detour_done",))["li_laotai"] == "detour"
    assert outcome((), bamboo=True)["li_laotai"] == "lent_apart"
    assert outcome(())["li_laotai"] == "apart"
    said = roles.entry_of("li_laotai", "epilogue", "bridge")["text"]["en"]
    assert "bamboo that the Li house had lent" in said


def test_the_boatman_and_dalang_say_who_it_was_only_when_it_was_told_in_public():
    told = {c: outcome(("truth_told", "bridge_fixed"), cause=c) for c in ("boat", "flood", "drunk")}
    assert [told[c]["old_he"] for c in ("boat", "flood", "drunk")] == ["owned", "flood", "drunk"]
    assert [told[c]["zhou_dalang"] for c in ("boat", "flood", "drunk")] == [
        "cleared",
        "cleared",
        "owned",
    ]
    quiet = outcome(("bridge_fixed",))  # nothing was told: the same in every story
    assert quiet["old_he"] == "idle" and quiet["zhou_dalang"] == "bridge"


def test_the_epilogue_has_its_words_in_both_languages_and_one_or_two_sentences():
    rows = outcome(FULL, cause="boat")
    wired = roles.epilogue_wire([[p, e] for p, e in rows.items()])
    assert [w["npc"] for w in wired] == list(TEN)
    for line in wired:
        assert sorted(line) == ["id", "npc", "text"] and sorted(line["text"]) == ["en", "zh"]
        assert 1 <= len(re.findall(r"[。！？]", line["text"]["zh"])) <= 2
        assert 1 <= len(re.findall(r"[.!?]", line["text"]["en"])) <= 2


def test_the_lists_of_every_other_epilogue_say_no_he_or_she():
    for person in TEN:
        for kind in roles.LISTS:
            for entry in roles.entries(person, kind):
                pairs = entry["lines"] if kind != "epilogue" else [entry["text"]]
                for pair in pairs:
                    assert not vc.has_pronoun("zh", pair["zh"]), (person, kind, entry["id"])
                    assert not vc.has_pronoun("en", pair["en"]), (person, kind, entry["id"])


# ------------------------------------------------------------------------------ the ending


def play_to_the_end(variant: str | None = None) -> tuple[Game, dict]:
    """The follower plays the game the opening page starts to the last night; the ending event."""
    named = preset("slice", variant=variant) if variant else preset("slice")
    game = Game(named["seed"], "bridge", {"days": 5, "budget_cap": 0, **named["config"]})
    bot = bots.make("follower", json.loads(game.scene_json()), named["seed"], mode="tracked")
    obs = bots.Obs(json.loads(game.step("[]")))
    while game.tick < 5 * clock.CYCLE_TICKS + 60:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(game.step(json.dumps(records)))
        obs = bots.Obs(out)
        for event in out["events"]:
            if event["kind"] == "ending":
                return game, event
    raise AssertionError("the game did not end")


@pytest.fixture(scope="module")
def endings():
    return {v: play_to_the_end(v) for v in (None, "v_flood", "v_drunk")}


def test_the_ending_carries_an_epilogue_for_each_of_the_ten_in_both_languages(endings):
    for _, (game, event) in endings.items():
        assert event["ending"] == "ending_full"
        assert [line["npc"] for line in event["epilogue"]] == list(TEN)
        for line in event["epilogue"]:
            assert line["text"]["zh"] and line["text"]["en"]
        assert json.loads(game.ending_json())["epilogue"] == event["epilogue"]


def test_the_whole_ending_has_the_epilogue_and_the_compact_one_of_the_frames_after_it_has_not(
    endings,
):
    game, event = endings[None]
    out = json.loads(game.step())
    frame_ending = out["frame"]["ending"]
    assert "epilogue" not in frame_ending and "reveal" not in frame_ending
    assert set(event) - set(frame_ending) == {"reveal", "epilogue"}


def test_the_epilogue_is_a_part_of_the_ending_that_the_audit_marks_for_the_player(endings):
    _, event = endings[None]
    assert projection.problems({"ending": event}) == []
    assert projection.mark_of("ending.epilogue[].text.zh") == projection.KNOWN
    assert projection.mark_of("ending.epilogue[].npc") == projection.KNOWN


def test_the_boatman_and_dalang_are_told_of_in_the_words_of_the_truth_that_was_told(endings):
    ids = {
        variant: {line["npc"]: line["id"] for line in event["epilogue"]}
        for variant, (_, event) in endings.items()
    }
    assert ids[None]["old_he"] == "owned" and ids[None]["zhou_dalang"] == "cleared"
    assert ids["v_flood"]["old_he"] == "flood" and ids["v_flood"]["zhou_dalang"] == "cleared"
    assert ids["v_drunk"]["old_he"] == "drunk" and ids["v_drunk"]["zhou_dalang"] == "owned"
    for person in TEN:  # everyone else has the same part in the three stories
        if person not in ("old_he", "zhou_dalang"):
            assert ids[None][person] == ids["v_flood"][person] == ids["v_drunk"][person], person


def idle_end(variant: str) -> dict:
    """A game nobody plays, to the last night."""
    game = Game(3, "bridge", {"variant": variant})
    while game.tick < 5 * clock.CYCLE_TICKS + 60:
        out = json.loads(game.step())
        for event in out["events"]:
            if event["kind"] == "ending":
                return event
    raise AssertionError("the game did not end")


def test_a_game_that_told_nothing_has_the_same_epilogue_in_every_story():
    said = {v: idle_end(v)["epilogue"] for v in VARIANTS}
    assert said["v_boat"] == said["v_flood"] == said["v_drunk"]
    assert {line["id"] for line in said["v_boat"]} <= {
        "apart",
        "busy",
        "hiding",
        "alone",
        "detour",
        "bridge",
        "idle",
    }
    for line in said["v_boat"]:
        assert not STORY.search(line["text"]["zh"] + line["text"]["en"]), line


# ------------------------------------------------------------------------------ what is hidden


def hidden_changes():
    """What the game knows and the manager does not, as functions of the world state."""

    def variant(to):
        return lambda s: s["social"].update(variant=to)

    def forget(person):
        return lambda s: s["social"]["beliefs"][person].clear()

    def swap(a, b):
        def go(s):
            beliefs = s["social"]["beliefs"]
            beliefs[a], beliefs[b] = beliefs[b], beliefs[a]

        return go

    def trust(s):
        s["player"]["trust"] = [90 - n for n in range(len(s["player"]["trust"]))]

    def bonds(s):
        for person in s["social"]["bonds"]:
            s["social"]["bonds"][person] = [0] * len(s["social"]["bonds"][person])

    def street(s):
        s["crowd"]["enthusiasm"] = [0] * len(s["crowd"]["enthusiasm"])

    def nobody_believes_the_rumour(s):
        for person in ("zhou_zhanggui", "zhou_erlang", "cha_laoban", "zhou_huoji"):
            for prop in list(s["social"]["beliefs"][person]):
                if prop.startswith("pr_li"):
                    del s["social"]["beliefs"][person][prop]

    return {
        "the truth is the flood": variant("v_flood"),
        "the truth is the elder brother": variant("v_drunk"),
        "the boatman remembers nothing": forget("old_he"),
        "the shopkeeper remembers nothing": forget("zhou_zhanggui"),
        "the watchman remembers nothing": forget("gengfu"),
        "the boatman and the madam trade their minds": swap("old_he", "cha_laoban"),
        "nobody believes the rumour": nobody_believes_the_rumour,
        "nobody trusts the manager": trust,
        "nobody is fond of anyone": bonds,
        "the street is cold": street,
    }


def the_choices(game: Game) -> dict:
    """What every list of every one of the ten says in this state, at two hours."""
    out = {}
    for person in TEN:
        for kind in ("greet", "chat"):
            for tick in (at(2, 8, 0), at(5, 16, 0)):
                out[(person, kind, tick)] = pick(game, person, kind, 1, tick)
        out[(person, "epilogue")] = pick(game, person, "epilogue")
    return out


@pytest.fixture(scope="module")
def played():
    """A game with the clarification taken in, the bamboo brought, a promise kept: a snapshot."""
    game = slice_game()
    hold(game, "li_laotai", CLAIM)
    hold(game, "li_da", CLAIM)
    hold(game, "zhou_huoji", CLAIM)
    me(game)["public"]["clarified"] = ["n1|n2"]
    deliver(game, "li_da", "bamboo")
    pledge(game, "zhou_zhanggui", "kept")
    raise_flag(game, "reconcile_seen")
    return game.snapshot_json()


@pytest.mark.parametrize("name", list(hidden_changes()))
def test_changing_what_is_hidden_changes_no_line_of_the_ten(played, name):
    base = the_choices(Game.from_snapshot_json(played))
    assert len(set(base.values())) > 6  # the states are not all the same plain one
    twin = Game.from_snapshot_json(played)
    before = canon.digest(state_of(twin))
    hidden_changes()[name](state_of(twin))
    assert canon.digest(state_of(twin)) != before  # the change was made
    assert the_choices(twin) == base


def test_the_test_would_notice_if_a_list_did_read_what_a_person_knows_or_was_promised():
    """What a person holds, and what was promised to them, are read, and moving either moves the
    choice of that person, so the comparisons above are no comparisons of nothing."""
    game = slice_game()
    hold(game, "li_laotai", CLAIM)
    pledge(game, "zhou_zhanggui", "kept")
    base = the_choices(game)
    assert base[("li_laotai", "greet", at(2, 8, 0))] == "cleared"
    assert base[("zhou_zhanggui", "greet", at(2, 8, 0))] == "kept"
    forgot = Game.from_snapshot_json(game.snapshot_json())
    state_of(forgot)["social"]["beliefs"]["li_laotai"].clear()  # what she knows is her own
    moved = the_choices(forgot)
    assert {k[0] for k in moved if moved[k] != base[k]} == {"li_laotai"}
    broken = Game.from_snapshot_json(game.snapshot_json())
    state_of(broken)["player"]["pledges"].clear()
    moved = the_choices(broken)
    assert {k[0] for k in moved if moved[k] != base[k]} == {"zhou_zhanggui"}


def route(variant: str) -> list[tuple]:
    """What the ten say over a head on a fixed route through the days, with that story true."""
    game = Game(3, "bridge", {**CLEAR, "variant": variant, "dev_actions": 1})
    said: list[tuple] = []
    plan = (
        (at(1, 8, 0), "li_laotai"), (at(1, 9, 0), "cha_laoban"), (at(1, 12, 20), "zhou_huoji"),
        (at(1, 13, 0), "zhou_zhanggui"), (at(1, 14, 0), "li_er"), (at(1, 15, 0), "old_he"),
        (at(1, 16, 0), "zuzhang"), (at(1, 17, 0), "zhou_dalang"), (at(1, 18, 0), "li_da"),
        (at(2, 8, 0), "li_laotai"), (at(2, 16, 0), "gengfu"), (at(2, 17, 0), "li_da"),
        (at(3, 8, 0), "zhou_zhanggui"), (at(3, 9, 0), "old_he"), (at(3, 10, 0), "li_laotai"),
        (at(4, 8, 0), "cha_laoban"), (at(4, 10, 30), "zhou_dalang"), (at(4, 11, 0), "li_er"),
        (at(5, 8, 0), "zuzhang"), (at(5, 15, 30), "old_he"), (at(5, 16, 0), "gengfu"),
    )  # fmt: skip
    for tick, person in plan:
        if game.tick < tick:
            if me(game)["talk"]:
                act(game, "leave")
            while game.tick < tick:
                json.loads(game.step())
        out = meet(game, person)
        say = bubble(out, person)
        out = act(game, "leave")
        said.append((game.tick, person, say, bubble(out, person)))
        if person == "li_da" and len(said) == 9:
            act(game, "dev_goal", op="truth")  # the town hears it (a flag, the same in every story)
    return said


def test_the_same_words_are_said_in_every_story_along_the_same_route():
    boat = route("v_boat")
    assert len(boat) == 21 and all(say is not None and last for _, _, say, last in boat)
    assert len({(person, say["zh"]) for _, person, say, _ in boat}) > 12  # the states move
    for variant in ("v_flood", "v_drunk"):
        assert route(variant) == boat


# ------------------------------------------------------------------------------ the wants


def wants_of(person: str) -> list[dict]:
    return [w for w in agenda.book().wants if w["person"] == person]


@pytest.mark.parametrize("person", TEN)
def test_each_of_the_ten_wants_something_the_player_can_learn(person):
    wants = wants_of(person)
    assert wants, person
    for want in wants:
        assert want["text"]["zh"] and want["text"]["en"]
        assert not vc.has_pronoun("zh", want["text"]["zh"])
        assert not vc.has_pronoun("en", want["text"]["en"])
        assert not STORY.search(want["text"]["zh"] + want["text"]["en"])
        assert all(leaf["kind"] in cc.TASK_TERMS for leaf in leaves(want["learned"]))


def learned(game: Game) -> set[str]:
    return set(state_of(game)["agenda"]["wants"])


@pytest.mark.parametrize(
    ("person", "want"),
    [
        ("li_da", "w_li_da_nod"),
        ("zhou_zhanggui", "w_zhou_ledger"),
        ("zhou_dalang", "w_zhou_dalang_peace"),
        ("cha_laoban", "w_cha_laoban_house"),
        ("gengfu", "w_gengfu_heard"),
        ("old_he", "w_old_he_quiet"),
    ],
)
def test_a_want_is_learned_in_the_first_talk_with_the_person_and_not_before(person, want):
    game = slice_game()
    run_to(game, at(1, 15, 0))  # everybody is up
    assert want not in learned(game)
    meet(game, person)
    idle(game)
    assert want in learned(game)
    card = {c["id"]: c for c in frame_now(game)["cards"]}[person]
    assert [w["id"] for w in card["wants"]] == [want]
    assert card["wants"][0]["text"] == agenda.words(
        next(w for w in agenda.book().wants if w["id"] == want)["text"]
    )


def test_what_li_er_wants_is_learned_with_the_note_of_his_lantern():
    game = slice_game()
    run_to(game, at(1, 15, 0))
    meet(game, "li_er")
    idle(game)
    assert "w_li_er_name" not in learned(game)  # a talk is not enough
    notebook.add_seen(me(game), "pr_liner_looking", game.tick)
    act(game, "leave")  # the agenda looks again when something happens: the talk ends
    idle(game)
    assert "w_li_er_name" in learned(game)


def test_what_the_clerk_wants_is_learned_when_he_says_he_saw_it_and_not_before():
    game = slice_game()
    run_to(game, at(1, 15, 0))
    meet(game, "zhou_huoji")
    idle(game)
    assert "w_zhou_huoji_blame" not in learned(game)
    for _ in range(3):
        act(game, "ask", topic="li_er")
    idle(game)
    assert "w_zhou_huoji_blame" in learned(game)


def test_the_wants_of_the_two_who_had_one_are_as_they_were():
    assert [w["id"] for w in wants_of("zuzhang")] == ["w_elder_lantern"]
    assert [w["id"] for w in wants_of("li_laotai")] == ["w_li_laotai_public"]
    ids = [w["id"] for w in agenda.book().wants]
    assert ids[:2] == ["w_elder_lantern", "w_li_laotai_public"] and len(ids) == 10


def test_a_want_says_the_same_in_every_story():
    texts = {
        v: [(w["id"], w["text"]) for w in agenda.book().wants] for v in VARIANTS
    }  # the book is the script's, not the game's
    assert texts["v_boat"] == texts["v_flood"] == texts["v_drunk"]
