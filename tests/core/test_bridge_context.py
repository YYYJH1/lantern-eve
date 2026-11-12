"""What a talk puts first: the request, the return a person asks, the promises to keep and the
promise to offer. The selection is read from the state and changes nothing, and every route is
still there."""

from __future__ import annotations

import json
from typing import Any

import pytest
from agenda_helpers import frame_now, idle, meet, slice_game
from bridge_helpers import at, run_to, state_of
from dealings_helpers import talking, trust
from player_helpers import acks, act, me, put, run_on, seed_of

from lantern_core.api import Game
from lantern_core.world.bridge import clock, commitments, context, entrust, offers, pledges
from lantern_core.world.bridge.data import SCRIPT

OLD_HE = "old_he"
VARIANTS = ("v_boat", "v_flood", "v_drunk")


def offer(kind: str, **body: Any) -> dict[str, Any]:
    ident = kind if "target" not in body else f"{kind}:{body['target']}"
    return {"id": ident, "label": {"zh": ident, "en": ident}, "body": {"kind": kind, **body}}


def task(task_id: str, request: str | None = None, state: str = "open", **fields: Any):
    action: dict[str, Any] = {"verb": "entrust", "npc": "li_da"}
    if request is not None:
        action["request"] = request
    action.update(fields.pop("action", {}))
    return {"id": task_id, "state": state, "action": action, "window": fields.pop("window", None)}


def requests(*offered: dict[str, Any], **status: str) -> list[dict[str, Any]]:
    return [{**o, "status": status.get(o["id"], "open")} for o in offered]


def talk_of(game) -> dict[str, Any]:
    return frame_now(game)["player"]["talk"]


# ------------------------------------------------------------------------------ the pick


def test_the_request_the_red_slip_asks_for_is_put_first_whatever_else_is_open():
    asked = requests(offer("join"), offer("material"), offer("lend"))
    out = {
        "tasks": [task("early", "join", window={"day": 1, "from": 7, "to": 9, "place": "x"}),
                  task("slip", "lend")],
        "tracked": "slip",
    }  # fmt: skip
    first, served = context.pick(out, "li_da", asked)
    assert first["id"] == "lend" and served == "slip"


def test_without_the_red_slip_the_open_task_whose_window_closes_first_is_served():
    asked = requests(offer("join"), offer("material"), offer("lend"))
    out = {
        "tasks": [
            task("late", "join", window={"day": 2, "from": 7, "to": 9, "place": "x"}),
            task("soon", "material", window={"day": 1, "from": 7, "to": 12, "place": "x"}),
            task("none", "lend"),
        ],
        "tracked": "other",
    }
    assert context.pick(out, "li_da", asked) == (asked[1], "soon")


def test_a_task_with_no_window_comes_after_the_tasks_that_have_one_then_the_order_of_the_tasks():
    asked = requests(offer("join"), offer("material"), offer("lend"))
    out = {
        "tasks": [task("a", "lend"), task("b", "material"), task("c", "join")],
        "tracked": None,
    }
    assert context.pick(out, "li_da", asked)[1] == "a"
    out["tasks"][2]["window"] = {"day": 3, "from": 7, "to": 9, "place": "x"}
    assert context.pick(out, "li_da", asked)[1] == "c"


def test_switching_the_task_that_is_followed_switches_the_request_that_is_put_first():
    asked = requests(offer("join"), offer("material"))
    out = {"tasks": [task("a", "join"), task("b", "material")], "tracked": "a"}
    assert context.pick(out, "li_da", asked)[0]["id"] == "join"
    out["tracked"] = "b"
    assert context.pick(out, "li_da", asked)[0]["id"] == "material"


@pytest.mark.parametrize("status", ["done", "waiting", "refused"])
def test_a_request_that_is_done_agreed_and_waiting_or_turned_down_today_is_not_put_first(status):
    asked = requests(offer("join"), offer("material"), material=status)
    out = {"tasks": [task("a", "material"), task("b", "join")], "tracked": "a"}
    first, served = context.pick(out, "li_da", asked)
    assert first["id"] == "join" and served == "b"  # the slip asks for it, but it is out


def test_with_nothing_asked_for_nothing_is_put_first_and_the_other_cases_are_left_out():
    asked = requests(offer("join"), offer("material"))
    assert context.pick({"tasks": [], "tracked": None}, "li_da", asked) == (None, "")
    other = task("a", "join", action={"npc": "zhou_zhanggui"})  # a task about somebody else
    done = task("b", "join", state="done")  # a task that is over
    assert context.pick({"tasks": [other, done], "tracked": "a"}, "li_da", asked) == (None, "")
    no_request = task("c", None)  # an action that names no request
    assert context.pick({"tasks": [no_request], "tracked": "c"}, "li_da", asked) == (None, "")


def test_an_action_that_names_an_item_asks_for_the_goods_or_the_loan_and_a_target_for_that_person():
    asked = requests(
        offer("lend"), offer("persuade", target="li_er"), offer("persuade", target="x")
    )
    by_item = {"tasks": [task("a", None, action={"item": "bamboo"})], "tracked": "a"}
    assert context.pick(by_item, "li_da", asked)[0]["id"] == "lend"
    with_goods = requests(offer("material"), *asked)
    assert context.pick(by_item, "li_da", with_goods)[0]["id"] == "material"
    by_target = {
        "tasks": [task("a", "persuade", action={"target": "li_er"})],
        "tracked": "a",
    }
    assert context.pick(by_target, "li_da", asked)[0]["id"] == "persuade:li_er"


# ------------------------------------------------------------------------------ in a real talk


def test_in_a_talk_the_request_of_the_red_slip_is_put_first_with_the_name_of_the_person():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "li_laotai")
    talk = talk_of(game)
    assert talk["ask_for"]["id"] == "lend" and talk["ask_for"]["for"] == "t_bamboo_first"
    assert talk["ask_for"]["label"] == {
        "zh": "请李老太把竹料借出来",
        "en": "Ask Granny Li to lend the bamboo for the bridge",
    }
    assert talk["ask_for"]["status"] == "open"


def test_every_request_the_talk_can_make_is_in_the_first_or_the_others_so_every_route_stays():
    game = slice_game()
    run_to(game, at(1, 8))
    for who in ("li_laotai", "zhou_zhanggui", "zuzhang", "miaozhu", "cha_laoban"):
        meet(game, who)
        frame = frame_now(game)
        talk = frame["player"]["talk"]
        every = [o["id"] for o in frame["player"]["offers"]["entrust"]]
        shown = ([talk["ask_for"]["id"]] if talk["ask_for"] else []) + [
            o["id"] for o in talk["asks_more"]
        ]
        assert sorted(shown) == sorted(every), who
        assert talk["ask_for"] is None or talk["ask_for"]["id"] not in {
            o["id"] for o in talk["asks_more"]
        }
        by_id = {o["id"]: o["body"] for o in frame["player"]["offers"]["entrust"]}
        for found in ([talk["ask_for"]] if talk["ask_for"] else []) + talk["asks_more"]:
            assert found["body"] == by_id[found["id"]]  # the body is the one the core knows


def test_outside_a_talk_there_is_nothing_put_first_and_no_queue():
    game = slice_game()
    run_to(game, at(1, 8))
    frame = frame_now(game)
    assert frame["player"]["talk"] is None


def test_the_status_of_a_request_says_what_became_of_it():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "li_da")
    state, world, now = state_of(game), game._kernel.world, clock.at(game.tick)
    material = {"kind": "material"}
    assert context.status_of(world, state, "li_da", material, now) == "open"
    state["commitments"]["list"].append(
        {"id": "m1", "by": "li_da", "item": "bamboo", "amount": 4, "state": "promised"}
    )
    assert context.status_of(world, state, "li_da", material, now) == "waiting"
    state["commitments"]["list"].clear()
    state["tasks"]["stock"]["p_bridge"] = {"bamboo": 10}
    assert context.status_of(world, state, "li_da", material, now) == "done"
    state["tasks"]["stock"].clear()
    me(game)["said_no"] = {"li_da|material|bamboo": [now.day, "short", ""]}
    assert context.status_of(world, state, "li_da", material, now) == "refused"
    me(game)["said_no"] = {"li_da|material|bamboo": [now.day - 1, "short", ""]}
    assert context.status_of(world, state, "li_da", material, now) == "open"  # yesterday's no
    me(game)["pending"].append({"npc": "li_da", "kind": "material", "detail": "bamboo", "id": 1})
    assert context.status_of(world, state, "li_da", material, now) == "waiting"


def test_the_loan_the_lane_the_testimony_and_the_call_of_the_clan_are_done_when_they_are():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "li_laotai")
    state, world, now = state_of(game), game._kernel.world, clock.at(game.tick)
    assert context.status_of(world, state, "li_laotai", {"kind": "lend"}, now) == "open"
    me(game)["nod"]["bamboo"] = 1
    assert context.status_of(world, state, "li_laotai", {"kind": "lend"}, now) == "done"
    assert context.status_of(world, state, "miaozhu", {"kind": "lane"}, now) == "open"
    state["goals"]["flags"]["lane_opened"] = 5
    assert context.status_of(world, state, "miaozhu", {"kind": "lane"}, now) == "done"
    assert context.status_of(world, state, "gengfu", {"kind": "testify"}, now) == "open"
    me(game)["evidence"].extend(
        i["id"] for i in entrust.testimony("gengfu", state["social"]["variant"])
    )
    assert context.status_of(world, state, "gengfu", {"kind": "testify"}, now) == "done"
    assert context.status_of(world, state, "zuzhang", {"kind": "convene"}, now) == "open"
    me(game)["meeting"] = {"tick": game.tick, "until": game.tick + 500, "day": 1, "invited": []}
    assert context.status_of(world, state, "zuzhang", {"kind": "convene"}, now) == "done"


@pytest.mark.parametrize("variant", VARIANTS)
def test_a_testimony_is_done_once_the_one_this_game_gives_is_in_hand(variant):
    """The watchman has three words to give and a game makes one of them real, so a game in which
    they have spoken has one of the three in hand: the request is done then, and a second ask is
    answered "said already", as the status says."""
    game = talking("gengfu", seed=seed_of(variant), hour=16, day=4)
    trust(game, "gengfu", 60)
    assert acks(act(game, "entrust", kind="testify")) == [("applied", None)]
    held = [i["id"] for i in SCRIPT["evidence"] if i["acquire"]["from"] == "gengfu"]
    assert len([i for i in held if i in me(game)["evidence"]]) == 1  # one of the three, not all
    talk = talk_of(game)
    shown = ([talk["ask_for"]] if talk["ask_for"] else []) + talk["asks_more"]
    (testify,) = [o for o in shown if o["id"] == "testify"]
    assert testify["status"] == "done"
    assert talk["ask_for"] is None or talk["ask_for"]["id"] != "testify"
    assert acks(act(game, "entrust", kind="testify")) == [("rejected", "said_already")]


def test_a_testimony_that_is_not_yet_in_hand_is_open_in_every_story():
    """The status says nothing of which word is real: before the watchman has spoken the request
    is open whichever story is true, and a story in which they have nothing to tell stays open."""
    for variant in VARIANTS:
        game = talking("gengfu", seed=seed_of(variant), hour=16, day=4)
        trust(game, "gengfu", 60)
        talk = talk_of(game)
        shown = ([talk["ask_for"]] if talk["ask_for"] else []) + talk["asks_more"]
        assert [o["status"] for o in shown if o["id"] == "testify"] == ["open"], variant


# ------------------------------------------------------------------------------ the return


def refused_by_zhou(game):
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    out = act(game, "entrust", kind="material")
    assert acks(out) == [("rejected", "refused")]
    return out


def test_a_person_who_turned_a_request_down_for_want_of_weight_asks_the_return_the_script_gives():
    game = slice_game()
    refused_by_zhou(game)
    talk = talk_of(game)
    wants = talk["wants"]
    assert wants["key"] == "zhou_zhanggui|material|timber"
    assert wants["offer"]["id"] == "stall:front"  # the Shopkeeper asks for a front stall
    assert wants["offer"]["body"] == {"op": "make", "due": 3, "what": "stall", "item": "front"}
    assert wants["asks"]["en"] == "Ask Shopkeeper Zhou to bring the timber to the bridge"
    assert wants["request"]["status"] == "refused" and len(wants["token"]) == 8
    assert [item["kind"] for item in talk["queue"]] == ["answer", "give"]
    assert talk["queue"][0] == {"kind": "answer", "key": wants["key"], "token": wants["token"]}


def test_a_return_that_is_counted_for_nothing_until_it_is_promised_then_the_numbers_move():
    game = slice_game()
    refused_by_zhou(game)
    wants = talk_of(game)["wants"]
    before = json.loads(
        game.preview_json(json.dumps({"verb": "entrust", "npc": "zhou_zhanggui", "kind": "material",
                                      "offer": wants["offer"]["body"]}))
    )  # fmt: skip
    assert before["blockers"] and before["blockers"][-1]["en"].endswith("has answered this already")
    assert acks(act(game, "promise", **wants["offer"]["body"])) == [("applied", None)]
    talk = talk_of(game)
    assert talk["wants"] is None and [q["kind"] for q in talk["queue"]] == ["keep"]
    after = json.loads(
        game.preview_json(
            json.dumps({"verb": "entrust", "npc": "zhou_zhanggui", "kind": "material"})
        )
    )
    assert not any("answered this already" in b["en"] for b in after["blockers"])
    assert any(r["sign"] == 1 and "weighs with them" in r["text"]["en"] for r in after["reasons"])
    assert after["odds"] in ("mid", "low", "high")


def test_the_same_request_turned_down_again_asks_the_return_again_with_a_new_token():
    game = slice_game()
    refused_by_zhou(game)
    first = talk_of(game)["wants"]["token"]
    act(game, "promise", **talk_of(game)["wants"]["offer"]["body"])
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    again = talk_of(game)["wants"]
    assert again["key"] == "zhou_zhanggui|material|timber" and again["token"] != first


def test_the_request_turned_down_last_is_the_one_whose_return_is_asked():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    assert acks(act(game, "entrust", kind="join")) == [("rejected", "refused")]
    assert talk_of(game)["wants"]["key"] == "zhou_zhanggui|join|"
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    talk = talk_of(game)
    wants = talk["wants"]
    assert wants["key"] == "zhou_zhanggui|material|timber"
    assert wants["asks"]["en"] == "Ask Shopkeeper Zhou to bring the timber to the bridge"
    assert talk["queue"][0] == {"kind": "answer", "key": wants["key"], "token": wants["token"]}
    assert acks(act(game, "entrust", kind="join")) == [("rejected", "said_already")]
    assert talk_of(game)["wants"]["key"] == "zhou_zhanggui|material|timber"  # no new refusal


def test_when_the_request_turned_down_last_no_longer_stands_the_one_before_it_asks():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    act(game, "entrust", kind="join")
    act(game, "entrust", kind="material")
    me(game)["said_no"]["zhou_zhanggui|material|timber"][2] = "moved"  # what weighed has moved
    assert talk_of(game)["wants"]["key"] == "zhou_zhanggui|join|"
    me(game)["said_no"]["zhou_zhanggui|join|"][2] = "moved"
    assert talk_of(game)["wants"] is None


def test_which_refusal_is_the_newest_is_kept_by_a_save_and_a_row_from_an_older_game_is_the_oldest():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    act(game, "entrust", kind="join")
    act(game, "entrust", kind="material")
    restored = Game.from_snapshot_json(game.snapshot_json())  # the saved state has its keys sorted
    assert talk_of(restored)["wants"]["key"] == "zhou_zhanggui|material|timber"
    rows = me(game)["said_no"]
    assert [len(row) for row in rows.values()] == [4, 4]
    del rows["zhou_zhanggui|material|timber"][3]  # a game from before the number was kept
    assert talk_of(game)["wants"]["key"] == "zhou_zhanggui|join|"


def test_a_person_with_no_return_free_asks_nothing_and_the_others_are_still_there_to_promise():
    game = slice_game()
    refused_by_zhou(game)
    for number in range(2):  # both front stalls go
        assert acks(act(game, "promise", op="make", what="stall", item="front", due=3)) == [
            ("applied", None)
        ], number
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    talk = talk_of(game)
    assert talk["wants"] is None  # the stall they ask for is gone
    assert talk["give"]["preferred"] is None
    assert {o["id"] for o in talk["give"]["more"]} >= {"stall:back", "wage:10", "wage:20"}
    assert [q["kind"] for q in talk["queue"]][-1] == "give"


def test_a_return_asked_yesterday_is_not_waited_for_today():
    game = slice_game()
    refused_by_zhou(game)
    act(game, "leave")
    run_on(game, at(2, 9))
    meet(game, "zhou_zhanggui")
    assert talk_of(game)["wants"] is None


# ------------------------------------------------------------------------------ keeping


def test_the_promises_to_keep_are_listed_by_the_day_they_are_due_and_early_ones_are_marked():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    act(game, "promise", op="make", what="wage", amount=10, due=3)
    act(game, "promise", op="make", what="stall", item="back", due=2)
    act(game, "promise", op="make", what="slot", item="2", due=2)
    talk = talk_of(game)
    keeps = [q for q in talk["queue"] if q["kind"] == "keep"]
    assert [(q["pledge"], q["due"]) for q in keeps] == [("k2", 2), ("k3", 2), ("k1", 3)]
    assert all(q["early"] for q in keeps)  # all are kept before their day
    assert talk["keep"] == keeps[0] and keeps[0]["offer"]["id"] == "keep:k2"
    assert keeps[0]["what"]["en"] and keeps[0]["what"]["zh"]
    assert acks(act(game, "promise", **keeps[0]["offer"]["body"])) == [("applied", None)]
    after = talk_of(game)
    assert [q["pledge"] for q in after["queue"] if q["kind"] == "keep"] == ["k3", "k1"]
    assert after["keep"]["pledge"] == "k3"


def test_a_promise_to_somebody_else_or_a_promise_kept_or_lapsed_is_not_in_the_queue():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    act(game, "promise", op="make", what="wage", amount=10, due=3)
    act(game, "leave")
    meet(game, "li_laotai")
    assert talk_of(game)["keep"] is None and talk_of(game)["queue"] == []
    assert pledges.OPEN == "open"


def test_on_the_day_it_is_due_the_promise_is_not_early():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    act(game, "promise", op="make", what="wage", amount=10, due=2)
    act(game, "leave")
    run_on(game, at(2, 9))
    meet(game, "li_da")
    assert talk_of(game)["keep"]["early"] is False


def test_the_queue_has_the_answer_first_then_the_promises_by_their_day_then_the_promise_to_offer():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    assert acks(act(game, "promise", op="make", what="wage", amount=10, due=3)) == [
        ("applied", None)
    ]
    assert acks(act(game, "promise", op="make", what="slot", item="2", due=2)) == [
        ("applied", None)
    ]
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    talk = talk_of(game)
    assert [q["kind"] for q in talk["queue"]] == ["answer", "keep", "keep", "give"]
    assert [q["due"] for q in talk["queue"] if q["kind"] == "keep"] == [2, 3]
    assert talk["queue"][0]["key"] == talk["wants"]["key"] and talk["keep"] == talk["queue"][1]


# ------------------------------------------------------------------------------ promising


def turned_away_from_the_boat(game):
    run_on(game, at(2, 13, 0))
    me(game)["looked"].extend(["e_footprint", "e_flood_debris"])
    idle(game)
    put(game, *game._kernel.world.town.places["p_ferry"].rect[:2])
    assert acks(act(game, "look", at="t_he_boat")) == [("rejected", "refused")]
    idle(game)


def test_after_a_look_was_turned_away_the_talk_offers_to_promise_the_preferred_thing_first():
    game = slice_game()
    turned_away_from_the_boat(game)
    meet(game, OLD_HE)
    act(game, "leave")  # a first talk of the day moves the trust: the look is a new question
    idle(game)
    put(game, *game._kernel.world.town.places["p_ferry"].rect[:2])
    assert acks(act(game, "look", at="t_he_boat")) == [("rejected", "refused")]
    idle(game)
    meet(game, OLD_HE)
    talk = talk_of(game)
    assert [q["kind"] for q in talk["queue"]] == ["give"]
    give = talk["give"]
    assert give["preferred"]["id"] == "wage:10" and give["ways"] == []
    assert "wage:10" not in {o["id"] for o in give["more"]}
    assert {"stall:front", "stall:back"} <= {o["id"] for o in give["more"]}
    assert not any(o["id"].startswith("keep:") for o in give["more"])
    assert acks(act(game, "promise", **give["preferred"]["body"])) == [("applied", None)]
    assert [q["kind"] for q in talk_of(game)["queue"]] == ["keep"]  # the promise moved the trust


def test_when_nothing_is_left_to_promise_the_talk_says_which_other_ways_are_open():
    game = slice_game()
    turned_away_from_the_boat(game)
    meet(game, OLD_HE)
    section = me(game)
    for what, item, amount in (
        ("stall", "front", 0), ("stall", "front", 0), ("stall", "back", 0), ("stall", "back", 0),
        ("stall", "back", 0), ("stall", "back", 0), ("role", "t_honor_light", 0),
        ("role", "lead_lanterns", 0), ("role", "stage_words", 0), ("slot", "1", 0),
        ("slot", "2", 0), ("slot", "3", 0), ("slot", "4", 0), ("slot", "5", 0),
        ("wage", "", 20), ("wage", "", 20), ("wage", "", 20),
    ):  # fmt: skip
        number = section["pseq"]
        section["pseq"] += 1
        section["pledges"].append(
            {"id": f"k{number}", "to": "li_er", "what": what, "item": item, "amount": amount,
             "size": 1, "made": 0, "due": 5, "state": "open", "ended": -1}
        )  # fmt: skip
    give = talk_of(game)["give"]
    assert give["preferred"] is None and give["more"] == []
    assert give["ways"] == ["clear_truth", "gift", "ask_others"]
    assert pledges.left(section)["purse"] == 0


def test_the_ways_are_the_truth_a_gift_and_somebody_who_knows_them_and_only_while_they_are_open():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    world, state = game._kernel.world, state_of(game)
    assert context.ways(world, state, "zhou_zhanggui", 1) == ["clear_truth", "gift", "ask_others"]
    state["goals"]["flags"]["truth_told"] = 1
    me(game)["gifted"] = [[1, "li_da", "tea", "like", 0]]
    assert context.ways(world, state, "zhou_zhanggui", 1) == ["ask_others"]
    state["goals"]["call"]["joined"].append(["zhou_zhanggui", 0, 0, "dev"])
    assert context.ways(world, state, "zhou_zhanggui", 1) == []


# ------------------------------------------------------------------------------ nothing is changed


def test_putting_things_first_reads_and_changes_nothing_of_the_state():
    game = slice_game()
    refused_by_zhou(game)
    before = game.snapshot_json()
    for _ in range(3):
        frame_now(game)
    assert game.snapshot_json() == before


def test_a_refusal_is_kept_for_the_day_and_a_yes_forgets_it():
    section: dict[str, Any] = {}
    entrust.remember_no(section, "a|material|bamboo", 2, entrust.SCORE_SHORT, "x")
    assert section["said_no"] == {"a|material|bamboo": [2, "short", "x", 1]}
    entrust.remember_no(section, "a|join|", 2, entrust.SCORE_SHORT, "y")
    entrust.remember_no(section, "a|material|bamboo", 2, entrust.SCORE_SHORT, "z")  # again
    assert section["said_no"] == {
        "a|join|": [2, "short", "y", 2],
        "a|material|bamboo": [2, "short", "z", 3],
    }  # the number counts up with the refusals that are kept
    entrust.forget_no(section, "a|join|")
    entrust.remember_no(section, "a|lane|", 2, entrust.SCORE_SHORT, "w")
    assert section["said_no"]["a|lane|"][3] == 4
    entrust.forget_no(section, "a|lane|")
    entrust.forget_no(section, "a|material|bamboo")
    assert "said_no" not in section
    entrust.remember_no(section, "a|material|bamboo", 2, entrust.SCORE_SHORT, "x")
    assert section["said_no"] == {"a|material|bamboo": [2, "short", "x", 1]}
    entrust.forget_no(section, "a|material|bamboo")
    assert "said_no" not in section
    entrust.forget_no(section, "a|material|bamboo")  # and nothing is there to forget


def test_the_named_words_of_the_requests_say_who_and_what():
    words = offers.request_label("li_da", {"kind": "material"})
    assert words == {
        "zh": "请李大把竹料送到桥边",
        "en": "Ask Li Da to bring the bamboo to the bridge",
    }
    assert offers.request_label("zuzhang", {"kind": "convene"})["en"] == (
        "Ask the Clan Elder to call the clan to the hall"
    )
    assert offers.request_label("li_laotai", {"kind": "persuade", "target": "li_er"})["zh"] == (
        "请李老太去劝李二"
    )
    assert commitments.OPEN == "promised"
