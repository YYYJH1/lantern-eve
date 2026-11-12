"""The moments of the festival: the page says it watches, three things happen once, and the world is
held for each until the page lets it go.

A game that nobody watches has none of this: no section, no key of the frame, no hold. A watched
game has the section ``moments`` of ``goals``, the keys ``moments`` and ``moment_hold`` in its
frames, and the event ``moment`` when one comes. The moments are ``echo`` (words of the manager's
came back through at least two tellings), ``together_work`` (the first morning on which helpers of
both families finished an hour of work at the bridge) and ``both_banks`` (the first lantern on each
side of the river)."""

from __future__ import annotations

import json

import pytest
from bridge_helpers import CLEAR, HEAVY, assign_body, at, bridge, player, run_to, state_of, step
from dealings_helpers import believe, know, talking, tell, trust
from goals_helpers import Hand, body, crew_of_five, dev, hand, join_all
from player_helpers import acks, act, beside, doc_scene, events, me, silence
from reply_helpers import Room, say
from speech_helpers import unnamed

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.cognition.beliefs import Belief, Claim
from lantern_core.inputs import InputError
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    clock,
    goals_call,
    moments,
    notebook,
    notes,
    peace,
    projection,
    social,
)
from lantern_core.world.bridge import telling as retelling
from lantern_core.world.bridge.lore import PLAYER, lore
from lantern_core.world.bridge.world import PRESETS

BRIDGE_DOOR = (27, 15)


def watch(game: Game) -> None:
    """The page says that it shows the moments of this game."""
    assert acks(act(game, "moment", op="watch")) == [("applied", None)]


def release(game: Game, kind: str) -> dict:
    return act(game, "moment", op="release", kind=kind)


def lift(game: Game, out: dict, met: list[tuple[str, int]]) -> dict:
    """Let the world go on from every moment the outputs show it held for, and those that the
    letting go brings. The ``(kind, tick)`` of each moment seen is added to ``met``."""
    while True:
        met.extend((e["moment"], e["tick"]) for e in events(out, "moment"))
        held = out["frame"].get("moment_hold") or []
        if not held:
            return out
        out = release(game, held[0])


def run_lifting(game: Game, tick: int) -> list[tuple[str, int]]:
    """Run on to ``tick`` the way a page does, letting the world go on from each moment at once.
    The moments met, in order."""
    met: list[tuple[str, int]] = []
    while game.tick < tick:
        lift(game, step(game), met)
    return met


def work(game: Game, day: int, people: tuple[str, ...]) -> list[tuple[str, int]]:
    """On the morning of ``day`` these people are asked to work an hour at the bridge, and the
    game runs to noon. The moments met."""
    met = run_lifting(game, at(day, 7, 30))
    for who in people:
        body_ = assign_body(f"w{day}-{who}", who, kind="work", place="p_bridge", hours=1)
        step(game, player(game.next_seq, body_))
    return met + run_lifting(game, at(day, 12, 0))


def labour_game(**config) -> Game:
    return bridge(1, **{**CLEAR, **config}, dev_actions=1)


# ------------------------------------------------------------------------------ watching


def test_a_game_that_nobody_watches_has_no_moments_and_is_never_held():
    h = hand(3)
    join_all(h, crew_of_five())  # lanterns on both banks
    h.run_to(300)
    assert "moments" not in h.goals and h.kinds("moment") == []
    assert "moments" not in h.frame and "moment_hold" not in h.frame
    assert not h.game.paused


def test_the_page_says_once_that_it_watches_and_the_game_has_the_section_and_the_keys():
    h = hand(3)
    out = h.send(body("moment", op="watch"))
    assert h.acks(out) == [("applied", None)]
    assert h.goals["moments"] == {"list": [], "held": []}
    assert out["frame"]["moments"] == [] and out["frame"]["moment_hold"] == []
    assert h.acks(h.send(body("moment", op="watch"))) == [("rejected", "watching")]
    assert h.frame["moments"] == [] and not h.game.paused


@pytest.mark.parametrize(
    "fields",
    [
        {},
        {"op": "pause"},
        {"op": 1},
        {"op": "release"},
        {"op": "release", "kind": "festival"},
        {"op": "release", "kind": None},
    ],
)
def test_a_body_that_is_not_well_formed_is_refused_before_anything_is_applied(fields):
    game = bridge(3, **CLEAR)
    with pytest.raises(InputError):
        act(game, "moment", **fields)
    assert game.tick == 0 and game.next_seq == 0


def test_a_release_needs_a_game_that_is_watched_and_a_moment_that_is_held():
    game = bridge(3, **CLEAR)
    assert acks(release(game, "echo")) == [("rejected", "not_watching")]
    watch(game)
    assert acks(release(game, "echo")) == [("rejected", "not_held")]
    assert state_of(game)["goals"]["moments"] == {"list": [], "held": []}


def test_the_kinds_and_the_reasons_are_the_ones_the_documents_list():
    assert moments.KINDS == ("echo", "together_work", "both_banks")
    assert moments.REJECTIONS == ("over", "watching", "not_watching", "not_held")


# ------------------------------------------------------------------------------ both banks


def test_both_banks_come_with_the_first_lantern_on_the_other_side_of_the_river():
    h = hand(3)
    h.send(body("moment", op="watch"))
    out = h.send(dev("join", npc="li_da"), dev("join", npc="li_er"))  # the Li house: the west bank
    assert events(out, "moment") == [] and h.frame["moments"] == []
    out = h.send(dev("join", npc="cha_laoban"))  # the teahouse: the east bank
    (event,) = events(out, "moment")
    assert event["moment"] == "both_banks" and event["kind"] == "moment"
    assert (event["place"], event["x"], event["y"]) == ("p_bridge", *BRIDGE_DOOR)
    entry = {"kind": "both_banks", "tick": event["tick"], "place": "p_bridge", "x": 27, "y": 15}
    assert out["frame"]["moments"] == [entry]
    assert out["frame"]["moment_hold"] == ["both_banks"]
    assert {*entry} == {"kind", "tick", "place", "x", "y"}


def test_one_bank_alone_is_not_both():
    west = hand(3)
    west.send(body("moment", op="watch"))
    west.send(*[dev("join", npc=who) for who in ("li_da", "zhadeng_shifu", "mujiang", "zhangfang")])
    assert west.kinds("moment") == []
    east = hand(3)
    east.send(body("moment", op="watch"))
    east.send(*[dev("join", npc=who) for who in ("zhou_erlang", "old_he", "zuzhang", "miaozhu")])
    assert east.kinds("moment") == []
    assert len(east.frame["lanterns"]) == 4 and east.frame["moments"] == []


def test_the_banks_are_told_apart_by_the_column_of_the_door():
    world = hand(3).game._kernel.world
    sides = {h.id: moments.bank_of(world.town, h.door[0]) for h in goals_call.lay(world).households}
    assert moments.river(world.town) == (25, 29)
    assert {k for k, v in sides.items() if v == "west"} == {
        "fam_li", "sishu_xiansheng", "zhangfang", "xiao_man", "gengfu", "mujiang", "zhadeng_shifu"
    }  # fmt: skip
    assert {k for k, v in sides.items() if v == "east"} == {
        "fam_zhou", "cha_laoban", "old_he", "zuzhang", "miaozhu"
    }  # fmt: skip
    assert [moments.bank_of(world.town, x) for x in (24, 25, 26, 27, 28, 29, 30)] == [
        "west", "west", "west", "east", "east", "east", "east"
    ]  # fmt: skip


def test_the_world_is_held_at_the_moment_and_goes_on_when_the_page_lets_it():
    h = hand(3)
    h.send(body("moment", op="watch"))
    out = h.send(dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    held_at = h.game.tick
    assert out["clock"]["paused"] and h.game.paused and not out["advanced"]
    for _ in range(5):  # a host that calls a held world gets the same frame and no tick
        again = h.send()
        assert not again["advanced"] and h.game.tick == held_at
        assert again["frame"]["moments"] == out["frame"]["moments"]
        assert again["frame"]["moment_hold"] == ["both_banks"] and again["clock"]["paused"]
    back = h.send(body("moment", op="release", kind="both_banks"))
    assert h.acks(back) == [("applied", None)]
    assert back["advanced"] and h.game.tick == held_at + 1 and not h.game.paused
    assert (
        back["frame"]["moment_hold"] == [] and back["frame"]["moments"] == out["frame"]["moments"]
    )
    assert not back["clock"]["paused"]
    assert h.acks(h.send(body("moment", op="release", kind="both_banks"))) == [
        ("rejected", "not_held")
    ]


def test_a_moment_comes_once_whatever_happens_after_it():
    h = hand(3)
    h.send(body("moment", op="watch"))
    h.send(dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    h.send(body("moment", op="release", kind="both_banks"))
    h.send(*[dev("join", npc=who) for who in ("zhou_erlang", "old_he", "zuzhang", "mujiang")])
    met = run_lifting(h.game, 600)
    assert met == [] and len(h.goals["moments"]["list"]) == 1 and h.goals["moments"]["held"] == []


def test_a_moment_that_comes_in_a_tick_is_the_last_call_that_simulates():
    """The call that makes it is the frame the page has: no tick is simulated after it."""
    game = labour_game()
    watch(game)
    met = run_lifting(game, at(3, 7, 30))
    for who in ("li_er", "zhou_erlang"):
        body_ = assign_body(f"w-{who}", who, kind="work", place="p_bridge", hours=1)
        step(game, player(game.next_seq, body_))
    while not game.paused:
        out = step(game)
    assert met == [] and out["advanced"] and out["frame"]["moment_hold"] == ["together_work"]
    (moment,) = out["frame"]["moments"]
    assert moment["tick"] == out["tick"] and game.tick == out["tick"] + 1
    assert [e["moment"] for e in events(out, "moment")] == ["together_work"]
    after = step(game)  # held: the same tick, the same frame
    assert not after["advanced"] and after["tick"] == game.tick == out["tick"] + 1
    assert after["frame"]["moments"] == out["frame"]["moments"]


# ------------------------------------------------------------------------------ together work


def test_the_first_morning_of_work_by_both_families_is_a_moment_with_its_day():
    game = labour_game()
    watch(game)
    met = work(game, 3, ("li_er", "zhou_erlang"))
    assert [kind for kind, _ in met] == ["together_work"]
    tick = met[0][1]
    assert at(3, 8, 0) < tick < at(3, 12, 0) and tick % peace.WATCH_STRIDE == 0
    (entry,) = state_of(game)["goals"]["moments"]["list"]
    assert entry == {
        "kind": "together_work", "tick": tick, "place": "p_bridge", "x": 27, "y": 15, "round": 3
    }  # fmt: skip
    assert peace.eased(state_of(game))["work"] == [3]


def test_it_comes_once_the_second_counted_morning_makes_no_other():
    game = labour_game()
    watch(game)
    met = []
    for day in (3, 4, 5):
        met += work(game, day, ("li_er", "zhou_erlang", "li_xiaomei"))
    assert [kind for kind, _ in met] == ["together_work"]
    assert peace.eased(state_of(game))["work"] == [3, 4]


@pytest.mark.parametrize(
    "people",
    [("li_er", "li_xiaomei"), ("zhou_erlang", "zhou_huoji"), ()],
    ids=["li", "zhou", "none"],
)
def test_helpers_of_one_family_alone_make_no_such_morning(people):
    game = labour_game()
    watch(game)
    assert work(game, 3, people) == []
    assert state_of(game)["goals"]["moments"]["list"] == []


def test_the_work_of_the_second_day_and_a_morning_of_heavy_rain_make_none():
    early = labour_game()
    watch(early)
    assert work(early, 2, ("li_er", "zhou_erlang")) == []
    rain = labour_game(**HEAVY)
    watch(rain)
    assert work(rain, 3, ("li_er", "zhou_erlang")) == []


def test_a_page_that_begins_to_watch_late_still_sees_the_morning_that_comes_after():
    game = labour_game()
    run_to(game, at(2, 12, 0))
    assert "moments" not in state_of(game)["goals"]
    watch(game)
    met = work(game, 3, ("li_er", "zhou_erlang"))
    assert [kind for kind, _ in met] == ["together_work"]


# ------------------------------------------------------------------------------ the echo

PROP = "pr_boat_scratched"
CHA = "cha_laoban"


def telling(game: Game, claim_id: str, speaker: str, listener: str, source: str, hop: int) -> None:
    """``speaker`` told ``listener`` the prop: a claim in the record of the town, and the belief it
    gave the listener, who names ``source`` as where it came from."""
    social = state_of(game)["social"]
    social["seq"] = max(social["seq"], int(claim_id[1:]) + 1)
    claim = Claim(claim_id, speaker, (listener,), PROP, "assert", source, game.tick, "belief")
    social["claims"][claim_id] = notes.encode_claim(claim)
    belief = Belief(
        listener, PROP, "assert", 70, "heard", speaker, source, hop, game.tick, claim_id
    )
    notes.hold(social, belief)


def the_manager_told_cha() -> Game:
    """A conversation with the madam of the teahouse, in which the manager tells her what they
    saw. The game is watched."""
    game = talking(CHA, seed=1)
    watch(game)
    trust(game, CHA, 40)
    entry = know(game, PROP, "saw")
    assert acks(tell(game, entry["id"], "faithful")) == [("applied", None)]
    return game


def talk_to(game: Game, who: str) -> None:
    if state_of(game)["player"]["talk"]:
        assert acks(act(game, "leave")) == [("applied", None)]
    silence(game)
    beside(game, who)
    assert acks(act(game, "talk", npc=who)) == [("applied", None)]


def test_words_of_the_manager_that_come_back_through_two_tellings_are_an_echo():
    game = the_manager_told_cha()
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    talk_to(game, "zhou_zhanggui")
    out = act(game, "ask", topic=PROP)
    (asked,) = events(out, "asked")
    assert asked["npc"] == "zhou_zhanggui" and asked["prop"] == PROP
    (event,) = events(out, "moment")
    assert event["moment"] == "echo" and event["prop"] == PROP
    assert event["from"] == "zhou_zhanggui"
    assert "hops" not in event  # who brought it back is said, and never how far it went
    me = state_of(game)["player"]
    assert (event["x"], event["y"]) == (me["x"], me["y"])
    assert event["place"] == "p_zhou_house"  # where the speaker is, as the map draws them
    (entry,) = out["frame"]["moments"]
    assert entry == {k: v for k, v in event.items() if k != "moment"} | {"kind": "echo"}
    assert set(entry) == {"kind", "tick", "place", "x", "y", "prop", "from"}
    assert set(state_of(game)["goals"]["moments"]["list"][0]) == set(entry)
    assert out["frame"]["moment_hold"] == ["echo"] and out["clock"]["paused"]


def test_the_person_the_manager_told_saying_it_back_is_not_an_echo():
    game = the_manager_told_cha()
    out = act(game, "ask", topic=PROP)  # she answers what the manager told her
    assert [e["answer"] for e in events(out, "asked")] == ["claim"]
    assert events(out, "moment") == [] and out["frame"]["moment_hold"] == []


def test_a_telling_the_manager_has_no_part_in_is_not_an_echo():
    game = talking(CHA, seed=1)
    watch(game)
    social = state_of(game)["social"]
    notes.hold(social, Belief(CHA, PROP, "assert", 90, "saw", None, None, 0, 0))
    telling(game, "c900", CHA, "zhou_zhanggui", "self_seen", 1)
    talk_to(game, "zhou_zhanggui")
    out = act(game, "ask", topic=PROP)
    assert [e["answer"] for e in events(out, "asked")] == ["claim"]
    assert events(out, "moment") == []


def test_a_longer_way_round_is_counted_in_tellings_and_not_shown():
    game = the_manager_told_cha()
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    telling(game, "c901", "zhou_zhanggui", "zhou_niangzi", CHA, 3)
    world = state_of(game)
    assert moments.tellings_since(world, "zhou_niangzi", PROP) == 3
    assert moments.tellings_since(world, "zhou_zhanggui", PROP) == 2
    assert moments.tellings_since(world, CHA, PROP) == 1
    assert moments.tellings_since(world, "li_da", PROP) == 0  # nobody told them
    talk_to(game, "zhou_niangzi")
    out = act(game, "ask", topic=PROP)
    (event,) = events(out, "moment")
    assert event["from"] == "zhou_niangzi" and "hops" not in event


def test_the_echo_comes_once():
    game = the_manager_told_cha()
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    talk_to(game, "zhou_zhanggui")
    out = act(game, "ask", topic=PROP)
    assert [e["moment"] for e in events(out, "moment")] == ["echo"]
    release(game, "echo")
    telling(game, "c901", CHA, "zhou_niangzi", PLAYER, 2)
    talk_to(game, "zhou_niangzi")
    out = act(game, "ask", topic=PROP)
    assert events(out, "moment") == [] and out["frame"]["moment_hold"] == []
    assert len(state_of(game)["goals"]["moments"]["list"]) == 1


def test_what_the_manager_overhears_counts_too():
    """The shopkeeper says in the teahouse that Li Er broke the rail, a retelling of what the clerk
    said, and the clerk had it from the manager: the manager listens and hears it come back."""
    game = doc_scene()
    watch(game)
    social = state_of(game)["social"]
    social["seq"] = 905
    first = Claim(
        "c903", PLAYER, ("zhou_huoji",), "pr_liner_at_bridge", "assert", "self_seen", 20, "belief"
    )
    social["claims"]["c903"] = notes.encode_claim(first)
    clerk = Belief(
        "zhou_huoji",
        "pr_liner_at_bridge",
        "assert",
        70,
        "heard",
        PLAYER,
        "self_seen",
        1,
        20,
        "c903",
    )
    notes.hold(social, clerk)
    out = act(game, "listen")
    assert acks(out) == [("applied", None)]
    (heard,) = events(out, "heard")
    assert heard["speaker"] == "zhou_zhanggui"
    (event,) = events(out, "moment")
    assert event["moment"] == "echo" and event["from"] == "zhou_zhanggui"
    assert event["prop"] == heard["prop"] and "hops" not in event
    # three tellings: the shopkeeper, the clerk, and back to the manager
    assert moments.tellings_since(state_of(game), "zhou_zhanggui", heard["prop"]) == 3


BOAT, LI_ER, REPAIRED = "pr_boat_damaged", "pr_liner_damaged", "pr_he_repaired"


class Quiet:
    """Stands for the sim where only ``emit`` is wanted."""

    def emit(self, kind, **fields):
        pass


def told_on(game: Game, via: str, to: str, prop: str, source: str = PLAYER) -> None:
    """``via`` told ``to`` the prop, in the claim ``c900`` of the town's record, and ``to`` holds
    or sets aside what they were told by the rule of the town (a rival if it clashes)."""
    section = state_of(game)["social"]
    claim = Claim("c900", via, (to,), prop, "assert", source, game.tick, "belief")
    section["claims"]["c900"] = notes.encode_claim(claim)
    section["seq"] = max(section["seq"], 901)
    heard = Belief(to, prop, "assert", 50, "heard", via, source, 2, game.tick, "c900")
    props = lore().book.props
    retelling.hold(Quiet(), section, lore(), social.book(section), props[prop], heard, "c900")


def the_manager_told(who: str, prop: str, seed: int = 1) -> Game:
    """A conversation with ``who`` in which the manager tells them what they saw (``prop``). The
    game is watched."""
    game = talking(who, seed=seed)
    watch(game)
    trust(game, who, 40)
    entry = know(game, prop, "saw")
    assert acks(tell(game, entry["id"], "faithful")) == [("applied", None)]
    return game


def test_the_second_account_a_person_says_comes_back_to_the_manager_as_an_echo_too():
    """A person who holds one account and keeps another in mind says both when asked. The second
    is a telling the manager hears, and it can be words of the manager's come back."""
    game = the_manager_told(CHA, LI_ER)  # the manager tells the teahouse that Li Er broke the rail
    talk_to(game, "li_laotai")
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    told_on(game, CHA, "li_laotai", LI_ER)  # the teahouse tells Granny Li, who holds the boat
    out = act(game, "ask", topic=BOAT)
    assert me(game)["twins"] == {"p1": "p2"}  # the account she holds, and the other she was told
    (asked,) = events(out, "asked")
    assert asked["prop"] == BOAT  # the event names the first
    (event,) = events(out, "moment")
    assert event["moment"] == "echo" and event["prop"] == LI_ER and event["from"] == "li_laotai"
    assert out["frame"]["moment_hold"] == ["echo"]


def test_a_second_account_the_manager_has_no_part_in_is_not_an_echo():
    game = talking(CHA, seed=1)
    watch(game)
    talk_to(game, "li_laotai")
    believe(game, "li_laotai", BOAT, 70, source="heard", teller="gengfu")
    told_on(game, "zhou_zhanggui", "li_laotai", LI_ER, source="self_seen")
    out = act(game, "ask", topic=BOAT)
    assert me(game)["twins"] == {"p1": "p2"}  # the second account is said all the same
    assert events(out, "moment") == [] and out["frame"]["moment_hold"] == []


def held_back_by_the_rules(room: Room) -> dict:
    """Zhou, in a talk, who was told by the teahouse what the manager told the teahouse (that the
    boat was scratched) and who repaired the boat as they saw: asked about the boat the rules have
    them say the repair, which weighs more, and the scratches are for the words to add."""
    game = room.game
    assert acks(room.act("moment", op="watch")) == [("applied", None)]
    trust(game, CHA, 40)
    entry = know(game, PROP, "saw")
    assert acks(tell(game, entry["id"], "faithful")) == [("applied", None)]
    talk_to(game, "zhou_zhanggui")
    believe(game, "zhou_zhanggui", REPAIRED, 80, source="saw")
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    return room.act("ask", topic="t_he_boat")


SCRATCHES = say("听说船有划痕。", "The boat was scratched.", unnamed(PROP))


def test_a_new_answer_the_model_gives_is_an_echo_when_it_is_words_of_the_manager_come_back():
    """The rules answer with one account, and the words the model writes for the person say
    another that they hold, which came back to the manager through two tellings."""
    room = Room(CHA, seed=1)
    out = held_back_by_the_rules(room)
    (asked,) = events(out, "asked")
    assert asked["prop"] == REPAIRED and events(out, "moment") == []  # nothing came back yet
    (request,) = out["requests"]
    out = room.result(request, "ok", SCRATCHES)
    (done,) = room.answered(out)
    assert done["result"] == "line" and len(done["claims"]) == 1
    claim = notebook.answer(me(room.game), done["claims"][0])
    assert (claim.speaker, claim.prop) == ("zhou_zhanggui", PROP)
    (event,) = events(out, "moment")
    assert event["moment"] == "echo" and event["prop"] == PROP and event["from"] == "zhou_zhanggui"
    assert out["frame"]["moment_hold"] == ["echo"] and out["clock"]["paused"]


def test_a_new_answer_the_model_gives_is_no_echo_in_a_game_that_nobody_watches():
    room = Room(CHA, seed=1)
    state_of(room.game)["goals"].pop("moments", None)
    game = room.game
    trust(game, CHA, 40)
    entry = know(game, PROP, "saw")
    assert acks(tell(game, entry["id"], "faithful")) == [("applied", None)]
    talk_to(game, "zhou_zhanggui")
    believe(game, "zhou_zhanggui", REPAIRED, 80, source="saw")
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    (request,) = room.act("ask", topic="t_he_boat")["requests"]
    out = room.result(request, "ok", SCRATCHES)
    (done,) = room.answered(out)
    assert len(done["claims"]) == 1
    assert events(out, "moment") == [] and "moments" not in out["frame"]
    assert "moments" not in state_of(game)["goals"]


def test_the_chain_is_read_one_claim_at_a_time(monkeypatch):
    """The way back does not decode the record of the town: it reads the beliefs and claims it
    passes. (Listing every claim of a game of five days for each question would be slow.)"""
    game = the_manager_told_cha()
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    reads: list[str] = []
    real = notes.decode_claim

    def counting(claim_id, note):
        reads.append(claim_id)
        return real(claim_id, note)

    monkeypatch.setattr(notes, "decode_claim", counting)
    assert moments.tellings_since(state_of(game), "zhou_zhanggui", PROP) == 2
    assert 0 < len(reads) <= 3 < len(state_of(game)["social"]["claims"])


# ------------------------------------------------------------------------------ held with a debt


def test_a_moment_in_an_act_that_is_being_paid_for_stops_the_run_and_the_debt_is_kept():
    game = the_manager_told_cha()
    telling(game, "c900", CHA, "zhou_zhanggui", PLAYER, 2)
    talk_to(game, "zhou_zhanggui")
    out = act(game, "ask", topic=PROP)
    assert clock.owed(state_of(game)) > 0 and out["clock"]["paused"]  # held, though time is owed
    owed = clock.owed(state_of(game))
    tick = game.tick
    for _ in range(3):
        assert not step(game)["advanced"] and clock.owed(state_of(game)) == owed
    back = release(game, "echo")
    assert back["advanced"] and game.tick == tick + 1 and clock.owed(state_of(game)) < owed
    while not game.paused:
        step(game)  # the run goes on at the pace of the debt until it is paid
    assert clock.owed(state_of(game)) == 0 and state_of(game)["player"]["talk"]  # held by the talk


# ------------------------------------------------------------------------------ more than one


def test_two_moments_of_one_tick_wait_together_and_are_lifted_in_any_order():
    h = hand(3)
    h.send(body("moment", op="watch"))
    h.send(dev("join", npc="li_da"))
    h.send(dev("join", npc="cha_laoban"))
    h.send(body("moment", op="release", kind="both_banks"))
    # set the case up again: the lanterns are up, and a morning of work by both families is on
    # the record, so that the next tick brings both
    h.goals["moments"] = {"list": [], "held": []}
    h.state["player"]["public"]["eased"] = {"stop": [], "work": [3]}
    out = h.send()
    kinds = [e["moment"] for e in events(out, "moment")]
    assert kinds == ["together_work", "both_banks"]
    assert out["frame"]["moment_hold"] == ["together_work", "both_banks"]
    assert [m["kind"] for m in out["frame"]["moments"]] == kinds and h.game.paused
    out = h.send(body("moment", op="release", kind="both_banks"))
    assert (
        out["frame"]["moment_hold"] == ["together_work"] and h.game.paused and not out["advanced"]
    )
    out = h.send(body("moment", op="release", kind="together_work"))
    assert out["frame"]["moment_hold"] == [] and out["advanced"] and not h.game.paused


# ------------------------------------------------------------------------------ the end


def test_the_festival_that_is_held_has_no_moments_and_cannot_be_watched():
    h = hand(3)
    h.send(body("moment", op="watch"))
    h.run_to(4 * clock.CYCLE_TICKS + clock.DAY_TICKS)
    out = h.send()
    assert [e["kind"] for e in out["events"] if e["kind"] == "ending"] == ["ending"]
    h.send(dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    assert h.kinds("moment") == [] and h.frame["moment_hold"] == []
    assert h.acks(h.send(body("moment", op="release", kind="echo"))) == [("rejected", "over")]
    late = hand(3)
    late.run_to(4 * clock.CYCLE_TICKS + clock.DAY_TICKS)
    late.send()
    assert late.acks(late.send(body("moment", op="watch"))) == [("rejected", "over")]
    assert "moments" not in late.goals


# ------------------------------------------------------------------------------ record and replay


def host(game: Game):
    """A recording of a watched game that is played the way a page plays it: every moment is lifted
    by the next call."""
    recorder = Recorder(game)

    def send(*bodies: dict) -> dict:
        seq = game.next_seq
        records = [
            {"seq": seq + i, "kind": "player", "body": {"action_id": f"r{seq + i}", **body}}
            for i, body in enumerate(bodies)
        ]
        return json.loads(recorder.step(json.dumps(records)))

    return recorder, send


def test_a_recording_of_a_watched_game_rebuilds_the_game_with_its_moments_and_holds():
    game = labour_game()
    recorder, send = host(game)
    send(body("moment", op="watch"))
    for who in crew_of_five():
        send(dev("join", npc=who))
    seen: dict[int, tuple] = {}

    def run(tick: int) -> None:
        while game.tick < tick:
            out = send()
            seen[out["tick"]] = (
                out["frame"]["moments"],
                out["frame"]["moment_hold"],
                out["advanced"],
            )
            for kind in out["frame"].get("moment_hold") or []:
                send(body("moment", op="release", kind=kind))

    run(at(3, 7, 30))
    for who in ("li_er", "zhou_erlang"):
        send(body("assign", npc=who, task={"kind": "work", "place": "p_bridge", "hours": 1}))
    run(at(3, 12, 0))
    assert [m["kind"] for m in state_of(game)["goals"]["moments"]["list"]] == [
        "both_banks", "together_work"
    ]  # fmt: skip
    live = recorder.recording()
    replayed: dict[int, tuple] = {}

    def watching(twin: Game, tick: int, outputs: str) -> None:
        out = json.loads(outputs)
        replayed[out["tick"]] = (
            out["frame"]["moments"],
            out["frame"]["moment_hold"],
            out["advanced"],
        )

    twin = rebuild(live, on_step=watching)
    assert twin.hash() == game.hash() and twin.snapshot_json() == game.snapshot_json()
    # the page's letting go is a recorded input: a replay lifts each hold in the call that has it
    assert any(held == [] for _, held, _ in replayed.values())
    assert replayed[max(replayed)][0] == seen[max(seen)][0]
    sought = rebuild(live, seek=True)
    assert sought.snapshot_json() == game.snapshot_json()


def test_a_game_restored_from_a_snapshot_while_it_is_held_is_held_and_lets_go():
    h = hand(3)
    h.send(body("moment", op="watch"))
    h.send(dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    twin = Hand(Game.from_snapshot_json(h.game.snapshot_json()))
    assert twin.game.paused and twin.send().get("advanced") is False
    assert twin.frame["moment_hold"] == ["both_banks"] and len(twin.frame["moments"]) == 1
    out = twin.send(body("moment", op="release", kind="both_banks"))
    assert out["advanced"] and twin.frame["moment_hold"] == [] and len(twin.frame["moments"]) == 1


def test_the_frame_of_a_watched_game_is_all_marked_in_the_audit():
    h = hand(3)
    h.send(body("moment", op="watch"))
    out = h.send(dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    assert out["frame"]["moments"] and projection.problems(out["frame"]) == []
    assert projection.mark_of("moments[].from") == "known"
    (row,) = [entry for entry in projection.FRAME if entry.path == "moments[]"]
    assert "hops" not in row.fields  # no count of hands is in a frame
    assert projection.mark_of("moment_hold") == "known"
    assert projection.visible({"kind": "moment", "tick": 1})
    assert canon.loads(canon.dumps_str(out["frame"])) == out["frame"]


def test_nothing_the_state_keeps_is_a_float_a_set_or_a_tuple():
    from player_helpers import plain

    h = hand(3)
    h.send(body("moment", op="watch"))
    h.send(dev("join", npc="li_da"), dev("join", npc="cha_laoban"))
    plain(json.loads(h.game.snapshot_json()))


# ------------------------------------------------------------------------------ the follower


def play_the_follower(watched: bool):
    """The follower plays the preset ``slice`` to the end. A watched game has the moments, and the
    follower lets the world go on from each one in the same call as its next act."""
    import bots

    named = PRESETS["slice"]
    game = Game(named["seed"], "bridge", {"days": 5, "budget_cap": 0, **named["config"]})
    bot = bots.make("follower", json.loads(game.scene_json()), named["seed"], mode="tracked")
    out = json.loads(game.step("[]"))
    obs = bots.Obs(out)
    met: list[tuple[str, int]] = []
    seen: list[tuple] = []
    first = True
    while game.tick < 5 * 2070 + 60 and not any(e["kind"] == "ending" for e in out["events"]):
        action = bot.decide(obs)
        bodies = []
        if watched:
            if first:
                bodies.append({"action_id": "watch", "type": "moment", "op": "watch"})
            held = obs.frame.get("moment_hold") or []
            bodies += [
                {"action_id": f"release-{kind}", "type": "moment", "op": "release", "kind": kind}
                for kind in held
            ]
        first = False
        if action is not None:
            bodies.append(action)
        records = [
            {"seq": game.next_seq + i, "kind": "player", "body": b} for i, b in enumerate(bodies)
        ]
        out = json.loads(game.step(json.dumps(records)))
        obs = bots.Obs(out)
        for event in out["events"]:
            if event["kind"] == "moment":
                met.append((event["moment"], event["tick"]))
            if event["kind"] in ("flag", "joined", "ending", "eased", "agreed", "promised"):
                seen.append(
                    (
                        event["tick"],
                        event["kind"],
                        event.get("flag") or event.get("npc") or event.get("act") or "",
                    )
                )
    return bot, out, met, seen


def test_the_follower_plays_the_same_game_watched_and_not_and_lets_a_moment_go_in_its_next_call():
    """A held world changes nothing about the game: the follower, which acts every call, lets a
    moment go in the call of its next act, and the flags it raises, the people who join, the
    deeds and the ending come at the same ticks."""
    bare, bare_out, none, bare_seen = play_the_follower(False)
    watched, out, met, seen = play_the_follower(True)
    assert none == [] and [kind for kind, _ in met] == ["both_banks", "together_work"]
    assert seen == bare_seen and watched.flags == bare.flags
    ending = next(e for e in out["events"] if e["kind"] == "ending")
    plain_ending = next(e for e in bare_out["events"] if e["kind"] == "ending")
    assert ending["ending"] == plain_ending["ending"] == "ending_full"
    assert {k: ending[k] for k in ("inputs", "passage", "promised", "turnout", "festival")} == {
        k: plain_ending[k] for k in ("inputs", "passage", "promised", "turnout", "festival")
    }
