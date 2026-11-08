"""Previews and submissions that can be sent twice or on an old state.

``Game.preview_json`` says what an action would ask, give and cost, and what stands in its way. It
only reads: the hash of the game is the same after ten of them as before (T01). An action that
carries the ``action_id`` of one that was applied is answered ``duplicate`` and does nothing (T02),
and one that carries the version of an older state is rejected as ``stale`` and does nothing (T03).
The preview reads the rules and what the manager knows, and not which story is true.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from agenda_helpers import meet, slice_game
from bridge_helpers import at, player, run_to, state_of, step
from dealings_helpers import believe, trust
from player_helpers import acks, act, me

from lantern_core import canon
from lantern_core.api import Game, InputError
from lantern_core.world.bridge import clarify, clock, commitments, objection, pace
from lantern_core.world.bridge.data import SCRIPT

SHAPE = {"version", "cost", "asks", "gives", "blockers", "odds", "reasons"}
PAUSE = {"seq": 0, "kind": "pause", "body": {}}


def look(game: Game, **action: Any) -> dict[str, Any]:
    return json.loads(game.preview_json(json.dumps(action)))


def without_the_look_of_the_tasks(game: Game) -> str:
    """The state of the world but for what the tasks last looked at (an event moves that) and the
    answers to the manager's actions that they keep a row of (a refusal is one)."""
    section = state_of(game)["agenda"]
    seen = [row for row in section["seen"] if row[0] != "action_ack"]
    world = {**state_of(game), "agenda": {**section, "mark": [], "seen": seen}}
    return canon.dumps_str(world)


def morning() -> Game:
    """The slice at half past six, in a talk with Granny Li."""
    game = slice_game()
    run_to(game, at(1, 6, 30))
    meet(game, "li_laotai")
    return game


def paused(game: Game) -> Game:
    """The same game with the world stopped, so that a call applies inputs and nothing else."""
    step(game, {**PAUSE, "seq": game.next_seq})
    assert game.paused
    return game


REQUESTS = [
    {"verb": "ask", "npc": "li_laotai", "topic": "li_er"},
    {"verb": "ask", "npc": "li_laotai", "topic": "p_bridge"},
    {"verb": "ask_source", "npc": "li_laotai", "entry": "n1"},
    {"verb": "tell", "npc": "li_laotai", "entry": "n1", "how": "as_seen"},
    {
        "verb": "tell",
        "npc": "li_laotai",
        "how": "fabricate",
        "pred": "damaged",
        "subject": "old_he",
        "object": "t_rail",
    },  # fmt: skip
    {"verb": "entrust", "npc": "li_laotai", "kind": "lend"},
    {"verb": "entrust", "npc": "li_laotai", "kind": "testify"},
    {
        "verb": "entrust",
        "npc": "li_laotai",
        "kind": "lend",
        "offer": {"op": "make", "what": "role", "item": "t_honor_light", "due": 3},
    },  # fmt: skip
    {"verb": "entrust", "npc": "li_da", "kind": "material"},
    {"verb": "entrust", "npc": "zhou_zhanggui", "kind": "join"},
    {
        "verb": "promise",
        "npc": "li_laotai",
        "op": "make",
        "what": "role",
        "item": "t_honor_light",
        "due": 3,
    },  # fmt: skip
    {"verb": "promise", "npc": "li_laotai", "op": "make", "what": "wage", "amount": 10, "due": 3},
    {"verb": "promise", "npc": "li_laotai", "op": "keep", "id": "k1"},
]


# ------------------------------------------------------------------------------ T01: they only read


def test_ten_previews_leave_the_state_hash_unchanged():
    game = morning()
    before_hash, before_snapshot, tick = game.hash(), game.snapshot_json(), game.tick
    for _ in range(10):
        for request in REQUESTS:
            look(game, **request)
    assert game.hash() == before_hash and game.snapshot_json() == before_snapshot
    assert game.tick == tick


def test_a_game_that_was_previewed_plays_on_as_a_game_that_was_not():
    plain, looked = morning(), morning()
    for _ in range(3):
        for request in REQUESTS:
            look(looked, **request)
    for _ in range(40):
        assert json.loads(plain.step()) == json.loads(looked.step())
    assert plain.hash() == looked.hash()


def test_a_preview_asks_no_model_and_draws_nothing():
    game = morning()
    state = game._kernel.state
    rng, requests, version = dict(state["rng"]), list(state["requests"]), state["version"]
    for request in REQUESTS:
        look(game, **request)
    assert state["rng"] == rng and state["requests"] == requests and state["version"] == version
    assert game.in_flight() == []


def test_a_preview_works_outside_a_talk_and_says_that_nobody_is_talking():
    game = slice_game()
    got = look(game, verb="entrust", npc="li_laotai", kind="lend")
    assert set(got) == SHAPE
    assert any("还没有开始谈话" in b["zh"] for b in got["blockers"])
    assert got["blockers"][0]["en"].startswith("You are not talking to Granny Li")


# ------------------------------------------------------------------------------ the shape


@pytest.mark.parametrize("request_", REQUESTS, ids=lambda r: f"{r['verb']}-{r.get('kind', '')}")
def test_a_preview_has_the_shape_of_the_contract(request_):
    got = look(morning(), **request_)
    assert set(got) == SHAPE
    assert type(got["version"]) is int and got["version"] >= 1
    assert got["cost"] == pace.minutes(request_["verb"])  # the script gives every act its minutes
    assert type(got["cost"]) is int and got["cost"] > 0
    for key in ("asks",) + (("gives",) if got["gives"] is not None else ()):
        assert set(got[key]) == {"zh", "en"} and got[key]["zh"] and got[key]["en"]
    for blocker in got["blockers"]:
        assert set(blocker) == {"zh", "en"}
    assert got["odds"] in (None, "high", "mid", "low")
    for reason in got["reasons"]:
        assert set(reason) == {"sign", "text"} and reason["sign"] in (1, -1)
        assert set(reason["text"]) == {"zh", "en"}


def test_a_malformed_action_is_an_input_error():
    game = morning()
    for bad in (
        "[]",
        '{"verb": "dance", "npc": "li_laotai"}',
        '{"verb": "ask", "npc": "nobody", "topic": "li_er"}',
        '{"verb": "ask", "npc": "li_laotai"}',
        '{"verb": "entrust", "npc": "li_laotai", "kind": 3}',
        "not json",
    ):
        with pytest.raises(InputError):
            game.preview_json(bad)


def test_the_cost_is_the_minutes_the_script_gives_the_act():
    game = morning()
    wanted = {"ask": 10, "ask_source": 10, "tell": 15, "entrust": 20, "promise": 20}
    assert pace.costs() == wanted  # and the frame of a talk shows the same
    assert look(game, verb="ask", npc="li_laotai", topic="li_er")["cost"] == 10
    assert look(game, verb="ask_source", npc="li_laotai", entry="n1")["cost"] == 10
    assert look(game, verb="tell", npc="li_laotai", entry="n1", how="as_seen")["cost"] == 15
    assert look(game, verb="entrust", npc="li_laotai", kind="lend")["cost"] == 20
    assert look(game, verb="promise", npc="li_laotai", op="keep", id="k1")["cost"] == 20


def test_a_script_that_gives_an_act_other_minutes_changes_the_cost_of_the_preview(monkeypatch):
    monkeypatch.setitem(SCRIPT["act_minutes"], "ask", 25)
    game = morning()
    assert look(game, verb="ask", npc="li_laotai", topic="li_er")["cost"] == 25
    assert look(game, verb="ask_source", npc="li_laotai", entry="n1")["cost"] == 10


# ------------------------------------------------------------------------------ what it says


def test_the_first_request_for_the_bamboo_names_the_obstacle_and_gives_low_odds():
    game = morning()
    got = look(game, verb="entrust", npc="li_laotai", kind="lend")
    assert got["asks"]["en"] == "Ask Granny Li to lend the bamboo"
    assert got["gives"] is None and got["odds"] == "low"
    assert [b["en"] for b in got["blockers"]] == ["Granny Li will not give way yet"]
    # after she has said no, the preview names the obstacle the manager was told of
    assert acks(act(game, "entrust", kind="lend")) == [("rejected", "hard")]
    again = look(game, verb="entrust", npc="li_laotai", kind="lend")
    assert [b["en"] for b in again["blockers"]] == [
        "The Li family will not give the bamboo",
        "Granny Li has answered this already",
    ]
    assert again["odds"] is None


def test_what_a_request_gives_is_the_promise_the_page_offers_and_counts_for_nothing():
    game = morning()
    bare = look(game, verb="entrust", npc="li_laotai", kind="lend")
    offered = look(
        game,
        verb="entrust",
        npc="li_laotai",
        kind="lend",
        offer={"op": "make", "what": "role", "item": "t_honor_light", "due": 3},
    )
    assert offered["gives"]["en"] == "the role of honour of lighting the main lantern"
    assert (offered["odds"], offered["blockers"], offered["reasons"]) == (
        bare["odds"],
        bare["blockers"],
        bare["reasons"],
    )


def test_the_odds_follow_the_score_the_person_weighs_the_request_by():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    me(game)["trust"][5] = 10  # a stranger
    low = look(game, verb="entrust", npc="zhou_zhanggui", kind="join")
    assert acks(act(game, "entrust", kind="join")) == [("rejected", "refused")]
    me(game)["asked"].clear()
    me(game)["trust"][5] = 45
    mid = look(game, verb="entrust", npc="zhou_zhanggui", kind="join")
    me(game)["trust"][5] = 95
    high = look(game, verb="entrust", npc="zhou_zhanggui", kind="join")
    assert (low["odds"], mid["odds"], high["odds"]) == ("low", "mid", "high")
    assert low["reasons"][0]["sign"] == -1 and high["reasons"][0]["sign"] == 1
    assert any("等熟人先来" in r["text"]["zh"] for r in mid["reasons"])
    # and the preview is the verdict: the person agrees where the odds are high, and not where low
    me(game)["trust"][5] = 95
    assert acks(act(game, "entrust", kind="join")) == [("applied", None)]


def test_a_promise_the_manager_cannot_keep_is_an_empty_one_and_a_promise_held_is_not():
    game = morning()
    held = look(game, verb="promise", npc="li_laotai", op="make", what="stall", item="front")
    assert held["blockers"] == [] and held["odds"] is None and held["reasons"][0]["sign"] == 1
    empty = look(game, verb="promise", npc="li_laotai", op="make", what="wage", amount=999)
    assert [b["en"] for b in empty["blockers"]] == ["You hold nothing like that to promise"]
    kept = look(game, verb="promise", npc="li_laotai", op="keep", id="k9")
    assert [b["en"] for b in kept["blockers"]] == ["There is no such promise"]


def test_telling_it_as_seen_warns_of_the_lie_and_what_the_manager_saw_does_not():
    game = morning()
    act(game, "ask", topic="li_er")
    heard = look(game, verb="tell", npc="li_laotai", entry="n1", how="as_seen")
    assert [r["sign"] for r in heard["reasons"]][:2] == [1, -1]
    assert "撒谎" in heard["reasons"][1]["text"]["zh"]
    assert (
        "家里人的不是" in heard["reasons"][2]["text"]["zh"]
    )  # and it is Granny Li's own it blames
    me(game)["notebook"][0]["note"] = "assert|95|saw|||0|0|"  # as if the manager had seen it
    seen = look(game, verb="tell", npc="li_laotai", entry="n1", how="as_seen")
    assert [r["sign"] for r in seen["reasons"]][:1] == [1] and len(seen["reasons"]) == 2
    assert look(game, verb="tell", npc="li_laotai", entry="n9", how="faithful")["blockers"]


# ------------------------------------------------------------------------------ nothing hidden


def hidden_changes():
    """Ways to change what the game knows and the manager does not: the story that is true, what
    people believe, how they stand toward each other, and the street."""

    def variant(to):
        return lambda s: s["social"].update(variant=to)

    def forget(person):
        return lambda s: s["social"]["beliefs"][person].clear()

    def swap(a, b):
        def go(s):
            beliefs = s["social"]["beliefs"]
            beliefs[a], beliefs[b] = beliefs[b], beliefs[a]

        return go

    def bonds(s):
        for person in s["social"]["bonds"]:
            s["social"]["bonds"][person] = [0] * len(s["social"]["bonds"][person])

    def street(s):
        s["crowd"]["enthusiasm"] = [0] * len(s["crowd"]["enthusiasm"])

    return {
        "the truth is the flood": variant("v_flood"),
        "the truth is the elder brother": variant("v_drunk"),
        "the boatman remembers nothing": forget("old_he"),
        "granny remembers nothing": forget("li_laotai"),
        "the boatman and the madam trade their minds": swap("old_he", "cha_laoban"),
        "nobody is fond of anyone": bonds,
        "the street is cold": street,
    }


@pytest.mark.parametrize("name", list(hidden_changes()))
def test_a_preview_says_the_same_whatever_the_game_knows_that_the_manager_does_not(name):
    game = morning()
    twin = Game.from_snapshot_json(game.snapshot_json())
    hidden_changes()[name](state_of(twin))
    assert canon.digest(state_of(twin)) != canon.digest(state_of(game))  # it was changed
    for request in REQUESTS:
        assert look(twin, **request) == look(game, **request), (name, request)


@pytest.mark.parametrize("variant", ["v_boat", "v_flood", "v_drunk"])
def test_a_request_to_testify_is_previewed_from_the_script_and_not_from_what_is_real(variant):
    """Whether the child saw the boat is for the child to say. The preview of asking him is the
    same whichever story is true, and what happens when the manager asks is not."""
    game = slice_game()
    run_to(game, at(3, 18))  # he is at home, awake, and what he could tell is to be had until nine
    meet(game, "xiao_man")
    base = look(game, verb="entrust", npc="xiao_man", kind="testify")
    assert base["blockers"] == []
    other = Game.from_snapshot_json(game.snapshot_json())
    state_of(other)["social"]["variant"] = variant
    assert look(other, verb="entrust", npc="xiao_man", kind="testify") == base
    (result, reason) = acks(act(other, "entrust", kind="testify"))[0]
    assert (reason == "nothing_to_say") == (variant != "v_boat"), (result, reason)


def test_a_scenario_without_previews_answers_null():
    assert Game(1, "m0").preview_json('{"verb": "ask", "npc": "npc01"}') == "null"


# ------------------------------------------------------------------------------ T02: sent twice


def first_try(game: Game, kind: str) -> dict[str, Any]:
    """A request of ``kind`` to the person of the talk, as a page sends it."""
    return {
        "ask": {"topic": "li_er"},
        "ask_source": {"entry": "n1"},
        "tell": {"entry": "n1", "how": "hide_source"},
        "entrust": {"kind": "lend"},
        "promise": {"op": "make", "what": "wage", "amount": 10, "due": 3},
    }[kind]


@pytest.mark.parametrize("kind", ["ask", "ask_source", "tell", "entrust", "promise"])
def test_the_same_action_id_again_is_a_duplicate_and_does_nothing(kind):
    game = morning()
    act(game, "ask", topic="li_er")  # so that the notebook has an entry for the others
    paused(game)
    body = {"action_id": "page-1", "type": kind, **first_try(game, kind)}
    first = step(game, player(game.next_seq, body))
    assert acks(first)[0][0] in ("applied", "rejected")
    world = canon.dumps_str(state_of(game))
    second = step(game, player(game.next_seq, body))
    assert [(e["result"], e["reason"]) for e in second["events"] if e["kind"] == "action_ack"] == [
        ("duplicate", None)
    ]
    assert [e["kind"] for e in second["events"]] == ["action_ack"]
    assert canon.dumps_str(state_of(game)) == world  # nothing in the town moved


def test_a_duplicate_with_a_version_is_still_a_duplicate_and_not_a_stale_action():
    game = paused(morning())
    version = look(game, verb="promise", npc="li_laotai", op="make", what="wage", amount=10)[
        "version"
    ]
    body = {
        "action_id": "page-2", "type": "promise", "op": "make", "what": "wage", "amount": 10,
        "due": 3, "version": version,
    }  # fmt: skip
    assert acks(step(game, player(game.next_seq, body))) == [("applied", None)]
    assert acks(step(game, player(game.next_seq, body))) == [("duplicate", None)]
    assert len(me(game)["pledges"]) == 1


# ------------------------------------------------------------------------------ T03: an old state


def test_an_action_with_the_version_of_the_preview_is_applied():
    game = paused(morning())
    got = look(game, verb="ask", npc="li_laotai", topic="li_er")
    out = act(game, "ask", topic="li_er", version=got["version"])
    assert acks(out) == [("applied", None)]


def test_an_action_on_an_old_version_is_rejected_as_stale_and_the_page_previews_again():
    game = paused(morning())
    got = look(game, verb="entrust", npc="li_laotai", kind="lend")
    # something else happens first: the manager asks about Li Er
    assert acks(act(game, "ask", topic="li_er")) == [("applied", None)]
    world = without_the_look_of_the_tasks(game)
    out = act(game, "entrust", kind="lend", version=got["version"])
    assert acks(out) == [("rejected", "stale")]
    assert [e["kind"] for e in out["events"]] == ["action_ack"]
    assert without_the_look_of_the_tasks(game) == world  # and the request was not made
    fresh = look(game, verb="entrust", npc="li_laotai", kind="lend")
    assert fresh["version"] != got["version"]
    assert acks(act(game, "entrust", kind="lend", version=fresh["version"])) == [
        ("rejected", "hard")
    ]  # now it is made, and Granny says no


def test_time_passing_makes_a_preview_stale_too():
    game = slice_game()  # nobody is in a conversation: the world runs
    got = look(game, verb="ask", npc="li_laotai", topic="li_er")
    game.step()
    assert look(game, verb="ask", npc="li_laotai", topic="li_er")["version"] != got["version"]
    assert acks(act(game, "ask", topic="li_er", version=got["version"])) == [("rejected", "stale")]


def test_a_conversation_holds_the_world_and_so_a_preview_made_in_it_stays_good():
    game = morning()
    got = look(game, verb="ask", npc="li_laotai", topic="li_er")
    for _ in range(5):
        game.step()  # the world is held: no tick is simulated and nothing happens
    assert look(game, verb="ask", npc="li_laotai", topic="li_er") == got
    assert acks(act(game, "ask", topic="li_er", version=got["version"])) == [("applied", None)]
    # the act takes its ten minutes and the world runs: the preview is old now
    assert acks(act(game, "ask", topic="li_er", version=got["version"])) == [("rejected", "stale")]


def test_an_action_rejected_as_stale_owes_no_time():
    game = morning()
    got = look(game, verb="ask", npc="li_laotai", topic="li_er")
    assert acks(act(game, "ask", topic="li_er")) == [("applied", None)]  # ten minutes are owed now
    while clock.owed(state_of(game)):
        game.step()  # and paid, in the conversation, which holds the world again
    tick = game.tick
    out = act(game, "ask", topic="li_er", version=got["version"])
    assert acks(out) == [("rejected", "stale")] and out["advanced"] is False
    assert game.tick == tick and "debt" not in state_of(game)["clock"]


@pytest.mark.parametrize("version", [None, 0])
def test_a_missing_version_or_the_zero_of_a_page_that_made_the_preview_itself_is_not_checked(
    version,
):
    game = morning()
    fields = {} if version is None else {"version": version}
    game.step()
    assert acks(act(game, "ask", topic="li_er", **fields)) == [("applied", None)]


def test_the_version_is_an_int_and_the_other_verbs_ignore_it():
    game = morning()
    with pytest.raises(InputError, match="version"):
        act(game, "ask", topic="li_er", version="x")
    with pytest.raises(InputError, match="version"):
        act(game, "entrust", kind="lend", version=-1)
    # the verbs that are not previewed do not read it
    assert acks(act(game, "track", task="t_bamboo_first", version=7)) == [("applied", None)]


def test_the_version_is_part_of_the_normalized_action_that_a_recording_keeps():
    game = morning()
    body = {"action_id": "stale-1", "type": "ask", "topic": "li_er", "version": 5, "junk": 1}
    out = step(game, player(game.next_seq, body))
    assert acks(out) == [("rejected", "stale")]
    (kept,) = [r for r in game.last_inputs if r["kind"] == "player"]
    assert kept["body"] == {"action_id": "stale-1", "type": "ask", "topic": "li_er", "version": 5}


# ------------------------------------------------------------------------------ Li Da's bamboo

LI_DA_MATERIAL = {"verb": "entrust", "npc": "li_da", "kind": "material"}
GAPS_EN = {
    "needs_nod": "Li Da will not move until his mother no longer stands in the way",
    "unaware": "Li Da has not heard that it was cleared up in public, and has to be told",
    "distrust": "Li Da does not trust you enough to be asked yet",
}
ASKS_EN = "Ask Li Da to bring the bamboo to the bridge"


def with_li_da(hour: int = 18, minute: int = 20, **config: Any) -> Game:
    """The slice at that time of the first day, in a talk with Li Da, who does not trust the manager
    at all, whose mother has not let go and who has not heard of any clarification."""
    game = slice_game(**config)
    run_to(game, at(1, hour, minute))
    meet(game, "li_da")
    trust(game, "li_da", 0)
    return game


def let_li_da_be_asked(game: Game) -> None:
    """What the manager wins before the bamboo can be asked of him: his mother's nod, his knowing of
    the clarification and his trust."""
    me(game)["nod"]["bamboo"] = game.tick
    believe(game, "li_da", clarify.CLAIM, 90, "saw")
    trust(game, "li_da", 60)  # more than the gate asks, so that his yes is sure


def blockers_of(game: Game) -> list[str]:
    """The blockers of the preview of the bamboo, in English, with the game left as it was."""
    before, snapshot = game.hash(), game.snapshot_json()
    got = look(game, **LI_DA_MATERIAL)
    assert game.hash() == before and game.snapshot_json() == snapshot  # it only read
    assert all(b["zh"] for b in got["blockers"])  # and each is said in Chinese too
    return [b["en"] for b in got["blockers"]]


def test_the_preview_of_the_bamboo_lists_all_that_stands_between_the_manager_and_li_das_yes():
    game = with_li_da()
    assert blockers_of(game) == [GAPS_EN[gap] for gap in objection.GAPS]
    me(game)["nod"]["bamboo"] = game.tick  # his mother has let go
    assert blockers_of(game) == [GAPS_EN["unaware"], GAPS_EN["distrust"]]
    believe(game, "li_da", clarify.CLAIM, 90, "saw")  # he heard it cleared up
    assert blockers_of(game) == [GAPS_EN["distrust"]]
    trust(game, "li_da", objection.TRUST_MIN)
    assert blockers_of(game) == [] and objection.gaps(state_of(game)) == []


def test_the_first_blocker_of_the_preview_is_the_reason_the_request_is_turned_down_for():
    game = with_li_da()
    for win in (lambda: None, lambda: me(game)["nod"].update(bamboo=game.tick)):
        win()
        gap = objection.gate(state_of(game))
        assert blockers_of(game)[0] == GAPS_EN[gap]
        twin = Game.from_snapshot_json(game.snapshot_json())  # the real request, on a copy
        assert acks(act(twin, "entrust", kind="material")) == [("rejected", gap)]
    believe(game, "li_da", clarify.CLAIM, 90, "saw")
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert blockers_of(game) == [GAPS_EN["distrust"]]
    assert acks(act(twin, "entrust", kind="material")) == [("rejected", "distrust")]


def test_the_preview_of_the_bamboo_says_when_it_would_come_when_the_goods_are_promised():
    game = with_li_da()
    assert look(game, **LI_DA_MATERIAL)["asks"]["en"] == ASKS_EN  # nothing to promise while blocked
    let_li_da_be_asked(game)
    before, snapshot = game.hash(), game.snapshot_json()
    got = look(game, **LI_DA_MATERIAL)
    assert got["asks"] == {
        "zh": "请李大把竹料送到桥边（李大应下的话：先送四根，明早07:00前）",
        "en": f"{ASKS_EN} (if Li Da agrees: 4 poles, by 7 tomorrow morning)",
    }
    assert game.hash() == before and game.snapshot_json() == snapshot  # it only read
    # what it says is what the yes makes: the batch the script gives, due at seven the next morning
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    (row,) = state_of(game)[commitments.SECTION]["list"]
    assert (row["amount"], row["due"]) == (4, {"day": 2, "hour": 7})
    # once he has promised, a request says what he promised and by when, and not more of the batch
    again = look(game, **LI_DA_MATERIAL)
    assert again["asks"]["en"] == ASKS_EN
    assert again["blockers"] == [
        {
            "zh": "李大已经答应了：四根竹料，明早07:00前",
            "en": "Li Da has promised already: 4 poles of bamboo, by 7 tomorrow morning",
        }
    ]


def test_before_three_o_clock_the_goods_would_come_the_same_day():
    game = with_li_da(10, 20)
    let_li_da_be_asked(game)
    got = look(game, **LI_DA_MATERIAL)
    assert got["asks"]["en"] == f"{ASKS_EN} (if Li Da agrees: 4 poles, by 13:00 today)"
    assert got["asks"]["zh"] == "请李大把竹料送到桥边（李大应下的话：先送四根，今天13:00前）"


def test_the_goods_would_come_counting_from_the_end_of_the_act_and_so_the_promise_does():
    """At ten to eleven the request, which takes twenty minutes, is over at ten past, and "two hours
    later on the hour" is 14:00. Counted from the start of the act it would say 13:00."""
    game = with_li_da(10, 50)
    let_li_da_be_asked(game)
    now = clock.at(game.tick)
    assert (now.hour, now.minute // 10) == (10, 5) and commitments.due_of(now) == (1, 13)
    got = look(game, **LI_DA_MATERIAL)
    assert got["asks"]["en"] == f"{ASKS_EN} (if Li Da agrees: 4 poles, by 14:00 today)"
    assert got["asks"]["zh"] == "请李大把竹料送到桥边（李大应下的话：先送四根，今天14:00前）"
    before, snapshot = game.hash(), game.snapshot_json()
    look(game, **LI_DA_MATERIAL)
    assert game.hash() == before and game.snapshot_json() == snapshot  # it only read
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    (row,) = state_of(game)[commitments.SECTION]["list"]
    assert row["due"] == {"day": 1, "hour": 14}  # what the preview said
    assert row["start"] == row["made"] + 2 * pace.minutes("entrust")  # and he sets out then


def test_a_request_that_is_over_after_three_o_clock_would_bring_the_goods_the_next_morning():
    game = with_li_da(14, 50)
    let_li_da_be_asked(game)
    now = clock.at(game.tick)
    assert (now.hour, now.minute // 10) == (14, 5) and commitments.due_of(now) == (1, 17)
    got = look(game, **LI_DA_MATERIAL)
    assert got["asks"]["en"] == f"{ASKS_EN} (if Li Da agrees: 4 poles, by 7 tomorrow morning)"
    assert got["asks"]["zh"] == "请李大把竹料送到桥边（李大应下的话：先送四根，明早07:00前）"
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    (row,) = state_of(game)[commitments.SECTION]["list"]
    assert row["due"] == {"day": 2, "hour": 7}


def test_what_is_still_owed_counts_too_when_the_goods_are_asked_for_while_it_is_paid():
    """The world pays for the earlier acts before this one can end. At half past ten two questions
    owe twenty minutes, and the request takes twenty more: it is over at ten past eleven and the
    goods are due at 14:00, where counted from the end of the request alone it would be 13:00."""
    game = with_li_da(10, 30)
    let_li_da_be_asked(game)
    for _ in range(2):
        assert acks(act(game, "ask", topic="li_er")) == [("applied", None)]
    assert clock.owed(state_of(game)) > 18 * 60  # about twenty minutes are owed still
    alone = clock.at(game.tick + 2 * pace.minutes("entrust"))
    assert commitments.due_of(alone) == (1, 13)
    got = look(game, **LI_DA_MATERIAL)
    assert got["asks"]["en"].endswith("by 14:00 today)")
    assert acks(act(game, "entrust", kind="material")) == [("applied", None)]
    (row,) = state_of(game)[commitments.SECTION]["list"]
    assert row["due"] == {"day": 1, "hour": 14}


def test_in_a_game_that_carries_its_goods_at_once_the_preview_says_nothing_of_a_time():
    game = with_li_da(goods="at_once")
    let_li_da_be_asked(game)
    got = look(game, **LI_DA_MATERIAL)
    assert got["asks"]["en"] == ASKS_EN and got["blockers"] == []
    lend = look(game, verb="entrust", npc="li_laotai", kind="lend")  # which promises nothing at all
    assert "poles" not in lend["asks"]["en"]


def test_the_timber_is_promised_whole_and_the_preview_of_it_says_so():
    game = slice_game()
    run_to(game, at(1, 18, 20))
    meet(game, "zhou_zhanggui")
    got = look(game, verb="entrust", npc="zhou_zhanggui", kind="material")
    assert got["asks"]["en"].endswith("agrees: 8 poles, by 7 tomorrow morning)")
