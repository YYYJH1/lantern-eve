"""What the tasks of the bridge for the days after the first are made of: the numbers in their
words, the terms they are written in, the person the card names to ask to join, the round of a task
that opens again, and the fields of an action that the script may name.

The route that uses them all is in ``test_bridge_days``. These tests take each part by itself, on a
game set up by hand where that is the plainest way to reach it.
"""

from __future__ import annotations

import copy
import json
from typing import Any

import pytest
from agenda_helpers import frame_now, meet, slice_game, tasks_of
from bridge_helpers import at, bridge, run_to, state_of
from dealings_helpers import believe, trust
from player_helpers import acks, act, me

import check_content as cc
from lantern_core.api import Game
from lantern_core.world.bridge import (
    agenda,
    agenda_facts,
    agenda_terms,
    clarify,
    clock,
    commitments,
    goals_call,
    weather,
)
from lantern_core.world.bridge.data import SCRIPT

LI_DA, ZHOU = "li_da", "zhou_zhanggui"


def env_of(game: Game) -> agenda_terms.Env:
    kernel = game._kernel
    return agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(kernel.state["tick"]))


def holds(game: Game, **cond: Any) -> bool:
    return agenda_terms.holds(env_of(game), cond)


def facts_of(game: Game) -> agenda_facts.Facts:
    return agenda_facts.Facts(game._kernel.world, state_of(game))


def join(game: Game, *people: str) -> None:
    """People join the helpers by the test action of the game (``dev_actions``)."""
    assert game.header()["config"].get("dev_actions") == 1, "the game needs the test action"
    for who in people:
        assert acks(act(game, "dev_goal", op="join", npc=who)) == [("applied", None)]


def dev_slice() -> Game:
    return slice_game(dev_actions=1)


def win_li_da(game: Game) -> None:
    trust(game, LI_DA, 60)
    me(game)["nod"]["bamboo"] = game.tick
    believe(game, LI_DA, clarify.CLAIM, 90, "saw")


# ------------------------------------------------------------------------------ the numbers


def test_the_names_the_words_may_write_are_the_names_the_content_is_checked_against():
    assert agenda_facts.NAMES == cc.AGENDA_FACTS
    assert len(set(agenda_facts.NAMES)) == len(agenda_facts.NAMES)


def test_the_words_of_every_task_write_the_same_known_slots_in_both_languages():
    seen = set()
    for task in SCRIPT["tasks"]:
        # a title is quoted: no slots, but for the task of a promise, which names the person
        assert agenda_facts.has_slots(task["text"]) == (task.get("pledge") is not None), task["id"]
        options = [*task["why"], *task["next"]]
        if task.get("lapse") is not None:
            options.append(task["lapse"])
        if task.get("pledge") is not None:
            options.append(task["text"])
        options += [rule["blocker"] for rule in task["blocked"]]
        for rule in task["blocked"]:
            options += [*rule["why"], *rule["next"]]
        for option in options:
            zh = set(agenda_facts.SLOT.findall(option["zh"]))
            en = set(agenda_facts.SLOT.findall(option["en"]))
            assert zh == en <= set(agenda_facts.NAMES), (task["id"], option)
            assert option["zh"].count("{") == len(agenda_facts.SLOT.findall(option["zh"]))
            seen |= zh
    # the tasks of the bridge use the numbers of the bamboo, the timber and the helpers the work
    # takes, and say the work that is left in mornings (the board has the rest: the hours done,
    # needed and left, the helpers who joined and their families, the deadline and the grudge)
    assert {"bamboo_need", "bamboo_site", "bamboo_open", "timber_need", "timber_open"} <= seen
    assert {"crew", "needy", "helper", "work_mornings"} <= seen
    assert not seen & {"hours", "hours_left", "morning", "helpers", "grudge"}


def test_the_numbers_of_a_new_game_are_what_the_bridge_needs_and_nobody_has_brought():
    game = slice_game()
    facts = facts_of(game)
    got = {name: facts[name] for name in agenda_facts.NAMES if not name.startswith("pledge")}
    assert got.pop("grudge") == state_of(game)["goals"]["metrics"]["grudge"]  # the bar of the board
    assert got == {
        "bamboo_site": 0,
        "bamboo_need": 10,
        "bamboo_lack": 10,
        "bamboo_open": 0,
        "bamboo_next": 4,  # the first batch of the script
        "timber_site": 0,
        "timber_need": 8,
        "timber_lack": 8,
        "timber_open": 0,
        "timber_next": 8,  # the timber is promised whole
        "helpers": 0,
        "crew": 5,
        "li_helpers": 0,
        "zhou_helpers": 0,
        "needy": {"zh": "李、周两家", "en": "both families"},
        "hours": 0,
        "hours_need": 10,
        "work_from": {"zh": "08:00", "en": "08:00"},
        "work_to": {"zh": "12:00", "en": "12:00"},
        "deadline": {"zh": "第四天18:00前", "en": "by 18:00 on day 4"},
        "helper": {"zh": "周娘子", "en": "Madam Zhou"},  # of a family with nobody, who knows most
        "hours_left": 10,
        "morning": 0,  # no crew, no work
        "work_mornings": {"zh": "几个早上", "en": "a few more mornings"},  # nor mornings to count
    }


def test_the_numbers_follow_the_pile_the_promises_the_helpers_and_the_work():
    game = dev_slice()
    run_to(game, at(1, 18, 20))
    meet(game, LI_DA)
    win_li_da(game)
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    act(game, "leave")
    facts = facts_of(game)  # a promise of four is open: the next would be for what is left
    assert (facts["bamboo_site"], facts["bamboo_open"], facts["bamboo_next"]) == (0, 4, 4)
    run_to(game, at(2, 8))
    facts = facts_of(game)
    assert (facts["bamboo_site"], facts["bamboo_lack"], facts["bamboo_open"]) == (4, 6, 0)
    assert facts["bamboo_next"] == 4
    state_of(game)["tasks"]["stock"]["p_bridge"]["bamboo"] = 8
    assert (facts_of(game)["bamboo_lack"], facts_of(game)["bamboo_next"]) == (2, 2)  # not four
    state_of(game)["tasks"]["stock"]["p_bridge"]["bamboo"] = 12
    assert (facts_of(game)["bamboo_lack"], facts_of(game)["bamboo_next"]) == (0, 0)
    join(game, "zhou_dalang", "zhou_zhanggui", "li_da")
    facts = facts_of(game)
    assert (facts["helpers"], facts["li_helpers"], facts["zhou_helpers"]) == (3, 1, 2)
    assert facts["needy"] == {"zh": "李、周两家", "en": "both families"}  # none has nobody
    state_of(game)["goals"]["work"]["ticks"] = 3 * clock.DAY_TICKS_PER_HOUR + 7
    assert facts_of(game)["hours"] == 3
    state_of(game)["goals"]["work"]["ticks"] = 99 * clock.DAY_TICKS_PER_HOUR
    assert facts_of(game)["hours"] == 10  # never more than the bridge takes


def test_a_world_whose_goals_are_not_the_festivals_has_no_helpers_and_no_hours():
    """A test world may give the reserved section ``goals`` to a subsystem of its own: the numbers
    of the card are then those of a festival nobody has begun, and nobody is named to be asked."""
    game = slice_game()
    state = copy.deepcopy(state_of(game))
    state["goals"] = {"asked": 0, "landed": {}}
    world = game._kernel.world
    facts = agenda_facts.Facts(world, state)
    assert (facts["helpers"], facts["li_helpers"], facts["zhou_helpers"], facts["hours"]) == (
        0,
        0,
        0,
        0,
    )
    assert facts["needy"] == {"zh": "李、周两家", "en": "both families"}
    assert agenda.helper(world, state) is None
    assert commitments.standing(state, LI_DA) is None


def test_the_family_with_nobody_is_named_in_each_language():
    game = dev_slice()
    join(game, "zhou_dalang")
    assert facts_of(game)["needy"] == {"zh": "李家", "en": "the Li family"}
    game = dev_slice()
    join(game, "li_da")
    assert facts_of(game)["needy"] == {"zh": "周家", "en": "the Zhou family"}


def test_numbers_are_put_in_as_digits_in_english_and_as_characters_in_chinese():
    game = slice_game()
    facts = facts_of(game)
    words = {
        "zh": "桥要{bamboo_need}根竹料，桥边才有{bamboo_site}根。请{needy}的人答应，{deadline}",
        "en": "The bridge needs {bamboo_need} poles and has {bamboo_site}. Ask {needy}, {deadline}",
    }
    assert agenda_facts.slots(words) == {"bamboo_need", "bamboo_site", "needy", "deadline"}
    assert agenda_facts.fill(words, facts) == {
        "zh": "桥要十根竹料，桥边才有零根。请李、周两家的人答应，第四天18:00前",
        "en": "The bridge needs 10 poles and has 0. Ask both families, by 18:00 on day 4",
    }
    # a score keeps its digits in Chinese too, and a time or a name is said in each language
    score = {"zh": "积怨还有{grudge}点", "en": "The grudge stands at {grudge}"}
    grudge = facts["grudge"]
    assert agenda_facts.fill(score, facts) == {
        "zh": f"积怨还有{grudge}点",
        "en": f"The grudge stands at {grudge}",
    }
    plain = {"zh": "没有数字。", "en": "No numbers."}
    assert not agenda_facts.has_slots(plain) and agenda_facts.fill(plain, facts) == plain
    with pytest.raises(KeyError):
        agenda_facts.fill({"zh": "{nothing}", "en": "{nothing}"}, facts)


def test_a_count_is_said_in_characters_before_a_measure_word():
    counts = (0, 1, 2, 4, 5, 9, 10, 11, 12, 20, 22, 25, 99, 100, -1)
    assert [agenda_facts.zh_count(n) for n in counts] == [
        *"零一两四五九十",
        "十一",
        "十二",
        "二十",
        "二十二",
        "二十五",
        "九十九",
        "100",
        "-1",
    ]


def test_the_words_of_the_card_in_the_frame_carry_the_numbers_of_the_moment():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    meet(game, LI_DA)
    win_li_da(game)
    act(game, "entrust", kind="material")
    act(game, "leave")
    run_to(game, at(2, 7, 30))
    rest = tasks_of(frame_now(game))["t_bamboo_rest"]
    assert rest["why"] == {
        "zh": "桥要十根竹料，桥边才有四根。",
        "en": "The bridge needs 10 poles of bamboo and only 4 lie there.",
    }
    meet(game, LI_DA)
    win_li_da(game)
    act(game, "entrust", kind="material")
    act(game, "leave")
    rest = tasks_of(frame_now(game))["t_bamboo_rest"]
    assert rest["why"] == {
        "zh": "桥要十根竹料，已经到了四根。李大又答应送四根。",
        "en": "The bridge needs 10 poles of bamboo and has 4. Li Da has promised 4 more.",
    }
    assert (
        rest["action"] is None and rest["window"]["place"] == "p_bridge"
    )  # at the promise's hours
    for word in ("zh", "en"):
        assert "{" not in rest["why"][word] and "}" not in rest["why"][word]


# ------------------------------------------------------------------------------ the terms


def test_the_crew_is_five_with_one_of_each_family():
    game = dev_slice()
    assert not holds(game, kind="crew")
    join(game, "li_da", "li_laotai", "li_er", "li_xiaomei", "old_he")  # five, all of one family
    assert not holds(game, kind="crew") and holds(game, kind="helpers", at_least=5)
    join(game, "zhou_zhanggui")
    assert holds(game, kind="crew")
    assert holds(game, kind="helpers", at_least=1, family="fam_zhou")
    assert not holds(game, kind="helpers", at_least=2, family="fam_zhou")
    assert holds(game, kind="helpers", at_least=6) and not holds(game, kind="helpers", at_least=7)


def test_the_crew_term_holds_nothing_in_a_world_without_the_festival():
    env = agenda_terms.Env(None, {}, clock.at(0))
    assert not agenda_terms.holds(env, {"kind": "crew"})
    assert not agenda_terms.holds(env, {"kind": "helpers", "at_least": 1})
    assert not agenda_terms.holds(env, {"kind": "work", "percent": 1})


def test_the_work_term_reads_the_per_cent_of_the_work_done():
    game = slice_game()
    assert not holds(game, kind="work", percent=1)
    state_of(game)["goals"]["metrics"]["work_progress"] = 40
    assert holds(game, kind="work", percent=40) and not holds(game, kind="work", percent=41)
    state_of(game)["goals"]["metrics"]["work_progress"] = 100
    assert holds(game, kind="work", percent=100)


@pytest.mark.parametrize("sky", weather.KINDS)
def test_the_weather_term_reads_the_sky_of_today_and_not_the_plan(sky):
    game = slice_game()
    state_of(game)["weather"]["kind"] = sky
    for other in weather.KINDS:
        assert agenda_terms.holds(env_of(game), {"kind": "weather", "is": other}) is (other == sky)
    plan = state_of(game)["weather"]["plan"]
    state_of(game)["weather"]["plan"] = [weather.HEAVY_RAIN] * len(plan)  # tomorrow is not known
    assert agenda_terms.holds(env_of(game), {"kind": "weather", "is": sky})


def test_the_commitment_term_reads_the_newest_promise_with_latest_and_any_without():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    for until in (at(2, 8), None):  # two promises, the first kept and the second open
        meet(game, LI_DA)
        win_li_da(game)
        act(game, "entrust", kind="material")
        act(game, "leave")
        if until is not None:
            run_to(game, until)
    base = {"kind": "commitment", "by": LI_DA, "item": "bamboo"}
    states = [r["state"] for r in state_of(game)[commitments.SECTION]["list"]]
    assert states == ["delivered", "promised"]
    assert holds(game, **base, state="delivered") and holds(game, **base, state="promised")
    assert holds(game, **base, state="promised", latest=True)
    assert not holds(game, **base, state="delivered", latest=True)  # the newest is not kept yet
    assert not holds(game, **{**base, "by": ZHOU}, state="promised", latest=True)


def refuse_li_da(game: Game, how_much: int) -> list:
    meet(game, LI_DA)
    me(game)["nod"]["bamboo"] = game.tick
    believe(game, LI_DA, clarify.CLAIM, 90, "saw")
    trust(game, LI_DA, how_much)
    out = act(game, "entrust", kind="material")
    act(game, "leave")
    return acks(out)


def promise_something(game: Game, who: str) -> None:
    meet(game, who)
    assert acks(act(game, "promise", op="make", what="wage", amount=10, due=3)) == [
        ("applied", None)
    ]
    act(game, "leave")


def test_turned_down_holds_after_a_no_until_a_number_of_the_score_moves():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    turned_down = {"kind": "turned_down", "npc": LI_DA}
    assert not holds(game, **turned_down)  # nothing asked yet
    assert refuse_li_da(game, 12) == [("rejected", "refused")]
    assert holds(game, **turned_down)
    assert refuse_li_da(game, 12) == [("rejected", "said_already")]  # the same no
    assert holds(game, **turned_down)
    run_to(game, at(1, 19))  # an hour on, and nothing moved
    assert holds(game, **turned_down)
    promise_something(game, LI_DA)  # a promise moves the score: a new question
    assert not holds(game, **turned_down)
    assert refuse_li_da(game, 12) == [("applied", None)]  # and this time the answer is yes
    assert not holds(game, **turned_down)  # which is a promise of his own, the round moved on


def test_turned_down_holds_for_the_next_batch_that_is_refused_and_for_nobody_else():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    turned_down = {"kind": "turned_down", "npc": LI_DA}
    assert refuse_li_da(game, 60) == [("applied", None)]
    assert not holds(game, **turned_down)
    run_to(game, at(2, 8))  # it came
    assert not holds(game, **turned_down)  # and the old yes is no answer to a request not made yet
    assert refuse_li_da(game, 12) == [("rejected", "refused")]
    assert holds(game, **turned_down)
    assert not holds(game, kind="turned_down", npc=ZHOU)  # asked of nobody else
    assert not holds(game, kind="turned_down", npc=LI_DA, request="lane")  # he opens no lanes


def test_turned_down_holds_nothing_where_the_goods_are_sent_at_once_or_the_yes_waits_on_a_lie():
    game = bridge(3, dev_actions=1)
    run_to(game, 130)
    meet(game, LI_DA)
    win_li_da(game)
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    act(game, "leave")
    assert not holds(game, kind="turned_down", npc=LI_DA)  # he is on the way
    pending = slice_game()
    run_to(pending, at(1, 18, 20))
    assert refuse_li_da(pending, 12) == [("rejected", "refused")]
    me(pending)["pending"].append(
        {
            "id": 1,
            "npc": LI_DA,
            "kind": "material",
            "detail": "bamboo",
            "strong": True,
            "due": 1,
            "via": [],
        }
    )
    assert not holds(pending, kind="turned_down", npc=LI_DA)  # not a no: it waits


# ------------------------------------------------------------------------------ whom to ask to join


def helper(game: Game) -> str | None:
    kernel = game._kernel
    return agenda.helper(kernel.world, kernel.state["world"])


def test_the_helper_to_ask_is_someone_met_of_the_family_with_nobody_who_knows_the_most_people():
    game = dev_slice()
    lay = goals_call.lay(game._kernel.world)
    people = game._kernel.world.cast.index
    # nobody met, nobody joined: a person of a family (both have nobody), the one who knows the
    # most people, and the cast order among those who know as many
    first = helper(game)
    assert lay.family[first] is not None
    kin = [p for p in lay.helpers if lay.family[p] is not None]
    assert all(
        (-len(lay.knows[first]), people[first]) <= (-len(lay.knows[p]), people[p]) for p in kin
    )
    # someone met comes before anyone who is not
    me(game)["talked"][people["gengfu"]] = 1
    assert helper(game) == "gengfu"
    me(game)["talked"][people["li_er"]] = 1  # of two met, the one of a family with nobody
    assert helper(game) == "li_er"
    # a family with nobody comes before a family with someone, among those met
    join(game, "li_da")
    me(game)["talked"][people["zhou_huoji"]] = 1
    assert helper(game) == "zhou_huoji"  # the Li family has Li Da, the Zhou family nobody
    join(game, "zhou_zhanggui")
    assert helper(game) in ("gengfu", "li_er", "zhou_huoji")  # both have someone: the rest decides


def answered_join(game: Game, who: str, result: str) -> None:
    """Put the row that the section keeps of a person's answer to a request to join."""
    fields = {"npc": who, "request": "join", "result": result, "reason": ""}
    fields["pledges"] = agenda.promised_to(state_of(game), who)
    state_of(game)["agenda"]["seen"].append(["entrusted", game.tick, fields])


def promised(game: Game, who: str) -> None:
    """Put a promise to a person among the manager's, as a case is set up."""
    me(game)["pledges"].append(
        {
            "id": f"k{len(me(game)['pledges']) + 1}",
            "to": who,
            "what": "wage",
            "item": "",
            "amount": 10,
            "size": 1,
            "made": game.tick,
            "due": 3,
            "state": "open",
            "ended": -1,
        }
    )


def test_a_person_who_answered_the_request_to_join_without_joining_stays_the_one_to_ask():
    game = dev_slice()
    first = helper(game)
    other = "li_laotai" if first != "li_laotai" else "zhou_zhanggui"
    for result in ("refused", "hard", "said_already", "agreed"):
        game = dev_slice()
        answered_join(game, other, result)
        assert helper(game) == other, result  # and not the next, who would answer the same
    game = dev_slice()
    answered_join(game, other, "refused")
    join(game, other)  # who joins is done with
    assert helper(game) not in (None, other)
    game = dev_slice()
    answered_join(game, other, "granted")  # an answer the core does not give for a request to join
    assert helper(game) == first


def test_the_card_goes_on_with_the_next_person_after_three_promises_or_when_none_is_left(
    monkeypatch,
):
    game = dev_slice()
    answered_join(game, "li_laotai", "agreed")
    for _ in range(agenda.PROMISE_LIMIT - 1):
        promised(game, "li_laotai")
        assert helper(game) == "li_laotai"
    promised(game, "li_laotai")  # the third since they answered
    assert helper(game) != "li_laotai"
    game = dev_slice()
    promised(game, "li_laotai")  # a promise from before they were asked does not count
    answered_join(game, "li_laotai", "refused")
    for _ in range(agenda.PROMISE_LIMIT - 1):
        promised(game, "li_laotai")
    assert helper(game) == "li_laotai"
    game = dev_slice()
    answered_join(game, "li_laotai", "refused")
    assert helper(game) == "li_laotai" and agenda.something_to_promise(state_of(game))
    monkeypatch.setattr(agenda, "something_to_promise", lambda world_state: False)
    assert helper(game) != "li_laotai"  # nothing to promise: the card cannot ask for a promise


def test_something_is_left_to_promise_until_every_stall_role_place_and_coin_is_spent():
    game = dev_slice()
    assert agenda.something_to_promise(state_of(game))
    spent = {"stall_front": 0, "stall_back": 0, "roles": [], "slots": [], "purse": 0}
    assert agenda.pledges.left(state_of(game)["player"]) != spent
    state_of(game)["player"]["pledges"] += [
        {
            "id": f"k{n}",
            "to": "old_he",
            "what": what,
            "item": item,
            "amount": amount,
            "size": 1,
            "made": 0,
            "due": 3,
            "state": "kept",
            "ended": 1,
        }
        for n, (what, item, amount) in enumerate(
            [("stall", "front", 0)] * 2
            + [("stall", "back", 0)] * 4
            + [("role", r, 0) for r in agenda.pledges.ROLES]
            + [("slot", str(n), 0) for n in range(1, agenda.pledges.SLOTS + 1)]
            + [("wage", "", agenda.pledges.PURSE)],
            1,
        )
    ]
    assert agenda.pledges.left(state_of(game)["player"]) == spent
    assert not agenda.something_to_promise(state_of(game))


def test_the_card_waits_for_a_promise_until_one_more_has_been_made_to_the_person():
    game = dev_slice()
    assert not holds(game, kind="helper_waits")
    answered_join(game, "li_da", "refused")  # with none promised to him
    assert holds(game, kind="helper_waits")
    promised(game, "li_da")  # now the request can be put again
    assert not holds(game, kind="helper_waits")
    answered_join(game, "li_da", "agreed")  # a yes that waits for friends to go first
    assert holds(game, kind="helper_waits")
    promised(game, "li_da")
    assert not holds(game, kind="helper_waits")
    join(game, "li_da")  # joined: nothing is waited for
    answered_join(game, "li_da", "agreed")
    assert not holds(game, kind="helper_waits")


def test_the_rows_of_a_request_to_join_say_how_many_promises_were_made_to_the_person():
    game = dev_slice()
    run_to(game, at(2, 7, 30))
    meet(game, "li_da")
    trust(game, "li_da", 0)
    assert acks(act(game, "entrust", kind="join")) == [("rejected", "refused")]
    rows = [r for r in state_of(game)["agenda"]["seen"] if r[2].get("request") == "join"]
    assert [(r[2]["npc"], r[2]["result"], r[2]["pledges"]) for r in rows] == [
        ("li_da", "refused", 0)
    ]
    act(game, "promise", op="make", what="wage", amount=10, due=3)
    assert acks(act(game, "entrust", kind="join")) in (
        [("applied", None)],
        [("rejected", "refused")],
    )
    rows = [r for r in state_of(game)["agenda"]["seen"] if r[2].get("request") == "join"]
    assert rows[-1][2]["pledges"] == 1  # the next answer is another row: one more promise
    other = [
        r for r in state_of(game)["agenda"]["seen"] if r[2].get("request") not in (None, "join")
    ]
    assert all("pledges" not in r[2] for r in other)  # and no other kind of request has the field


def test_the_helper_is_never_a_child_nor_someone_who_has_joined_and_none_is_left_at_the_end():
    game = dev_slice()
    lay = goals_call.lay(game._kernel.world)
    chosen = set()
    for _ in range(len(lay.helpers)):
        who = helper(game)
        assert who is not None and who in lay.helpers and who not in ("shitou", "xiao_man")
        assert who not in chosen
        chosen.add(who)
        join(game, who)
    assert chosen == set(lay.helpers) and helper(game) is None


def test_someone_who_was_asked_to_join_and_has_not_comes_after_everyone_who_was_not_asked():
    game = dev_slice()
    first = helper(game)
    me(game)["asked"][f"{first}|join|"] = "a=1|30|-||"  # asked, and the answer was not yes
    second = helper(game)
    assert second not in (None, first)
    lay = goals_call.lay(game._kernel.world)
    for who in lay.helpers:  # asked all of them
        me(game)["asked"][f"{who}|join|"] = "a=1|30|-||"
    assert helper(game) == first  # nobody left who was not asked: the order of before


def test_the_helper_is_named_in_the_frame_and_the_task_is_done_when_nobody_is_left():
    game = dev_slice()
    run_to(game, at(2, 13, 30))  # the helpers are asked for from the afternoon
    task = tasks_of(frame_now(game))["t_helpers"]
    assert task["action"] == {"verb": "rally"}
    act(game, "rally")
    task = tasks_of(frame_now(game))["t_helpers"]
    assert task["action"] == {"verb": "entrust", "npc": helper(game), "request": "join"}
    assert task["window"] is not None  # when and where to find that person
    while (who := helper(game)) is not None:  # the call is out: one who joins brings others
        join(game, who)
    assert tasks_of(frame_now(game))["t_helpers"]["state"] == "done"


# ------------------------------------------------------------------------- a task that opens again


def toy(**fields: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": "t_toy",
        "kind": "need",
        "job": "bridge",
        "priority": 5,
        "text": {"zh": "玩具", "en": "Toy"},
        "why": [],
        "next": [],
        "action": [],
        "window": None,
        "expected": None,
        "appears": [],
        "blocked": [],
        "done": [],
        "stale": [],
    }
    return {**base, **fields}


@pytest.fixture
def toys(monkeypatch):
    """A game whose script has only the toy tasks named."""

    def use(*tasks: dict[str, Any]) -> None:
        monkeypatch.setattr(agenda, "SCRIPT", {**SCRIPT, "tasks": list(tasks)})
        agenda.book.cache_clear()

    yield use
    monkeypatch.undo()
    agenda.book.cache_clear()


def flag(name: str) -> dict[str, str]:
    return {"kind": "flag", "flag": name}


def look(game: Game) -> None:
    kernel = game._kernel
    env = agenda_terms.Env(kernel.world, kernel.state["world"], clock.at(kernel.state["tick"]))
    agenda.settle(env, kernel.state["world"]["agenda"], kernel.state["tick"], None)


def toy_state(game: Game) -> str | None:
    row = state_of(game)["agenda"]["tasks"].get("t_toy")
    return None if row is None else row["state"]


def test_a_task_that_opens_again_is_a_new_round_when_its_appearance_holds_once_more(toys):
    toys(toy(appears=[flag("lane_opened")], done=[flag("lamps_hung")], again=True))
    game = slice_game()
    flags = state_of(game)["goals"]["flags"]
    look(game)
    assert toy_state(game) is None
    flags["lane_opened"] = 1
    look(game)
    assert toy_state(game) == "open"
    flags["lamps_hung"] = 2
    look(game)
    assert toy_state(game) == "done"
    flags.pop("lane_opened"), flags.pop("lamps_hung")
    look(game)
    assert toy_state(game) == "done"  # it stays done while the new round has not begun
    flags["lane_opened"] = 3
    look(game)
    assert toy_state(game) == "open"  # and it begins
    assert state_of(game)["agenda"]["tasks"]["t_toy"]["since"] == game.tick


def test_a_task_that_does_not_open_again_stays_done(toys):
    toys(toy(appears=[flag("lane_opened")], done=[flag("lamps_hung")]))
    game = slice_game()
    flags = state_of(game)["goals"]["flags"]
    flags["lane_opened"], flags["lamps_hung"] = 1, 2
    look(game)
    assert toy_state(game) == "done"
    flags.pop("lane_opened"), flags.pop("lamps_hung")
    look(game)
    flags["lane_opened"] = 3
    look(game)
    assert toy_state(game) == "done"


def test_a_task_that_opens_again_does_not_flap_while_it_would_end_at_once(toys):
    toys(toy(appears=[flag("lane_opened")], done=[flag("lamps_hung")], again=True))
    game = slice_game()
    flags = state_of(game)["goals"]["flags"]
    flags["lane_opened"], flags["lamps_hung"] = 1, 2
    look(game)
    assert toy_state(game) == "done"
    since = state_of(game)["agenda"]["tasks"]["t_toy"]["since"]
    game._kernel.state["tick"] += 50
    look(game)
    assert (
        toy_state(game) == "done"
    )  # the appearance holds, and the end holds with it: no new round
    assert state_of(game)["agenda"]["tasks"]["t_toy"]["since"] == since


# ------------------------------------------------------------------------- the fields of an action


def option(**fields: Any) -> dict[str, Any]:
    base = {"verb": "entrust", "npc": None, "place": None, "item": None, "follow": [], "when": []}
    return {**base, **fields}


def test_an_action_passes_on_the_request_the_kind_and_the_target_of_the_script_as_they_are():
    game = slice_game()
    world, state = game._kernel.world, state_of(game)
    assert agenda.action_of(world, state, option(npc="miaozhu", request="lane")) == {
        "verb": "entrust",
        "npc": "miaozhu",
        "request": "lane",
    }
    assert agenda.action_of(world, state, option(npc="li_da", item="bamboo")) == {
        "verb": "entrust",
        "npc": "li_da",
        "item": "bamboo",
    }  # the goods, as before: no request in the frame
    assert agenda.action_of(
        world, state, option(npc="li_da", request="material", item="bamboo")
    ) == {
        "verb": "entrust",
        "npc": "li_da",
        "item": "bamboo",
        "request": "material",
    }
    assert agenda.action_of(
        world, state, option(npc="zuzhang", request="persuade", target="li_laotai")
    ) == {"verb": "entrust", "npc": "zuzhang", "request": "persuade", "target": "li_laotai"}
    assert agenda.action_of(world, state, option(verb="speak", kind="meal")) == {
        "verb": "speak",
        "kind": "meal",
    }
    assert agenda.action_of(world, state, option(verb="speak")) == {"verb": "speak"}


def test_an_action_that_names_no_extra_field_is_compiled_without_one():
    for task in SCRIPT["tasks"]:
        for action in task["action"]:
            assert set(action) - {"verb", "npc", "place", "item", "follow", "when"} <= {
                "request",
                "kind",
                "target",
            }
    first = next(t for t in SCRIPT["tasks"] if t["id"] == "t_bamboo_first")
    assert all(
        set(a) == {"verb", "npc", "place", "item", "follow", "when"} for a in first["action"]
    )
    assert all("again" not in task for task in SCRIPT["tasks"] if task["id"] == "t_bamboo_first")
    assert next(t for t in SCRIPT["tasks"] if t["id"] == "t_li_da_promise")["again"] is True


def test_the_frame_of_the_route_has_the_request_of_a_join_and_of_a_lane():
    game = slice_game()
    run_to(game, at(4, 8) + 2)
    detour = tasks_of(frame_now(game))["t_detour"]
    assert detour["action"] == {"verb": "entrust", "npc": "miaozhu", "request": "lane"}
    json.dumps(frame_now(game))  # plain values, all of it


def test_a_content_with_a_slot_the_core_does_not_fill_is_refused_by_the_checker():
    src = copy.deepcopy(cc.load_sources(cc.ROOT))
    task = next(t for t in src.scripts["broken_bridge"]["tasks"] if t["id"] == "t_timber")
    task["why"][1]["zh"] = "修桥要{planks}根木料"
    errors = cc.validate(src).errors
    assert any("{planks} is not a number the words can carry" in e for e in errors), errors
    assert any("the two languages write different slots" in e for e in errors), errors
