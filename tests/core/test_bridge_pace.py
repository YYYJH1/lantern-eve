"""The time of a conversation: the world stands still while the manager talks, an act takes the
minutes written for it, and the person goes when their routine says.

Three things are shown, each against the game as a host plays it. A host steps a held world only to
bring it an input, so a test that waits for the clock to run calls ``run_debt``, which does what a
host does with a rate it is given: one call with nothing in it for each tick, for as long as the
world runs fast. The minutes of an act are counted on the clock of the game and not on the cost
that the script says, so a wrong cost and a wrong conversion both show.
"""

from __future__ import annotations

import json

import pytest
from agenda_helpers import meet, slice_game
from bridge_helpers import CLEAR, PEOPLE, at, bridge, person, run_to, state_of, step
from bridge_helpers import player as player_record
from dealings_helpers import know, talking, trust
from player_helpers import acks, act, beside, events, me, seed_of, silence
from reply_helpers import Room, notice_act, say

from bots.base import Bot, Obs
from lantern_core import canon
from lantern_core.api import Game
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import clock, pace, player, voices
from lantern_core.world.bridge.data import SCRIPT

WHO = "cha_laoban"  # at the teahouse from seven until noon, and ten ticks late for noon
COSTS = {"ask": 10, "ask_source": 10, "tell": 15, "entrust": 20, "promise": 20}
GOOD = say("听说栏杆坏了。", "I heard the rail is broken.", notice_act())
DRUNK = seed_of("v_drunk")
KICK = ["e_gengfu_dalang"]  # the evidence the speeches of the assembly tests show


def minute_of(tick: int) -> int:
    """The minute of the day the clock reads at ``tick``."""
    then = clock.at(tick)
    return then.hour * 60 + then.minute


def open_talk(who: str = WHO, hour: int = 8, minute: int = 0, seed: int = 1, **config):
    """A game at ``hour``:``minute`` of the first day with the manager in a conversation with
    ``who``, and the outputs of the call that opened it."""
    game = bridge(seed, **{**CLEAR, **config})
    run_to(game, at(1, hour, minute))
    beside(game, who)
    silence(game)
    out = act(game, "talk", npc=who)
    assert acks(out) == [("applied", None)], acks(out)
    return game, out


def run_debt(game: Game, out: dict, each=None) -> list[dict]:
    """What a host does with the rate in ``out``: one call with nothing in it per tick for as long
    as the world runs fast. All the outputs, ``out`` first. ``each(outputs)`` sees every call."""
    outs = [out]
    if each is not None:
        each(out)
    while outs[-1]["clock"]["rate"] == list(clock.DEBT_RATE):
        assert len(outs) < 5000
        outs.append(json.loads(game.step()))
        if each is not None:
            each(outs[-1])
    return outs


def perform(game: Game, name: str) -> dict:
    """One act of the conversation with the madam, which she answers."""
    if name == "ask":
        return act(game, "ask", topic="t_rail")
    if name == "ask_source":
        entry = know(game, "pr_liner_damaged", "heard", WHO, hop=1)
        return act(game, "ask_source", entry=entry["id"])
    if name == "tell":
        entry = know(game, "pr_boat_scratched")
        return act(game, "tell", entry=entry["id"], how="faithful")
    if name == "entrust":
        trust(game, WHO, 40)
        return act(game, "entrust", kind="join")
    assert name == "promise"
    return act(game, "promise", what="stall", item="front", due=3)


def teahouse(hour: int, minute: int, seed: int = DRUNK) -> Game:
    """The manager at the teahouse on the first evening, with the kick to show."""
    game = bridge(seed, **CLEAR)
    run_to(game, at(1, hour, minute))
    beside(game, WHO)
    silence(game)
    me(game)["evidence"].extend(KICK)
    return game


# ------------------------------------------------------------------------------ what is written


def test_the_script_says_what_each_act_costs_and_the_frame_passes_it_on_with_the_time_they_go():
    assert SCRIPT["act_minutes"] == {**COSTS, "speak": 30}
    assert pace.costs() == COSTS and pace.minutes("speak") == 30
    game, out = open_talk()
    leaves = {"hour": 12, "minute": 5}  # noon, and the madam's ten ticks of lateness
    talk = out["frame"]["player"]["talk"]
    assert {k: talk[k] for k in ("npc", "costs", "leaves_at")} == {
        "npc": WHO,
        "costs": COSTS,
        "leaves_at": leaves,
    }
    (opened,) = events(out, "talk_start")
    assert opened == {"kind": "talk_start", "tick": game.tick, "npc": WHO, "leaves_at": leaves}
    assert me(game)["talk"]["until"] == at(1, 12) + 10  # the tick, which the frame does not show
    assert step(game)["frame"]["player"]["talk"]["leaves_at"] == leaves
    act(game, "leave")
    assert step(game)["frame"]["player"]["talk"] is None


def test_every_frame_has_the_minutes_of_all_six_acts_in_a_talk_and_out_of_one():
    """The speech in public has no conversation to show its cost in, so the frame says it apart from
    ``player.talk.costs``, which keeps the five acts of a conversation as it was."""
    every = {**COSTS, "speak": 30}
    assert pace.table() == every and set(every) == {*pace.IN_TALK, pace.SPEAK}
    game = bridge(1, **CLEAR)
    for _ in range(3):
        frame = step(game)["frame"]["player"]
        assert frame["costs"] == every and frame["talk"] is None
    game, out = open_talk()
    assert out["frame"]["player"]["costs"] == every
    assert out["frame"]["player"]["talk"]["costs"] == COSTS  # not the speech: it is made outside
    assert act(game, "ask", topic="t_rail")["frame"]["player"]["costs"] == every
    act(game, "leave")
    assert step(game)["frame"]["player"]["costs"] == every


def test_the_costs_in_the_frame_are_the_minutes_the_acts_really_take():
    """Not a copy of the table: the debt the world owes after an act is what the frame shows."""
    game, out = open_talk()
    shown = out["frame"]["player"]["costs"]
    for name in ("ask", "tell"):
        before = game.tick
        outs = run_debt(game, perform(game, name))
        paid = [o for o in outs if o["advanced"]]
        assert shown[name] == COSTS[name]
        assert minute_of(game.tick) - minute_of(before) in {shown[name] - 1, shown[name]}, name
        assert paid


def test_a_person_goes_at_the_start_of_the_next_entry_of_the_routine_or_at_dusk():
    madam = person(WHO)
    assert madam.leaves_at(at(1, 8)) == at(1, 12) + 10
    assert madam.leaves_at(at(1, 12) + 10) == at(1, 13) + 10  # the entry that has started is over
    assert madam.leaves_at(at(1, 20, 30)) == at(1, 21)
    drinker = person("zhou_dalang")  # the routine says sleep at ten, and the night begins at nine
    assert drinker.leaves_at(at(1, 19)) == at(1, 21)
    watchman = person("gengfu")  # on the night shift: the routine goes on through the night
    assert watchman.leaves_at(at(1, 22)) == at(1, 23)
    assert watchman.leaves_at(at(1, 4)) == at(1, 5)
    assert madam.leaves_at(at(1, 22)) == at(1, 22) + 1  # on the way home already
    tomorrow = at(2, 6) + (10 * 7 % 30)  # the first entry of the next day, ten ticks late for her
    assert person("li_xiaomei").leaves_at(at(1, 20)) == at(1, 21)
    assert tomorrow == at(2, 6) + 10


def test_the_tick_a_person_goes_is_the_first_at_which_their_entry_changes_or_the_night_begins():
    for who in PEOPLE:
        for tick in range(2 * clock.CYCLE_TICKS):  # two days, so that the turn of the day shows
            goes = who.leaves_at(tick)
            assert goes > tick, (who.id, tick)
            cycle = tick % clock.CYCLE_TICKS
            if cycle >= clock.DAY_TICKS and not who.night_shift:
                assert goes == tick + 1  # on the way home already
                continue
            here = who.entry_at(cycle)
            assert who.entry_at((goes - 1) % clock.CYCLE_TICKS) == here, (who.id, tick)
            dusk = (goes % clock.CYCLE_TICKS) == clock.DAY_TICKS and not who.night_shift
            assert dusk or who.entry_at(goes % clock.CYCLE_TICKS) != here, (who.id, tick)


# ------------------------------------------------------------------------------ stands still


def test_in_a_talk_the_world_stands_still_for_whatever_is_read_or_waited_for():
    game, out = open_talk()
    assert out["advanced"] is False and out["clock"] == {"paused": True, "rate": [1, 1]}
    assert game.paused and not game._kernel.state["paused"]  # the host did not pause it
    tick, snapshot = game.tick, game.snapshot_json()
    # everything a page or a host can ask of a game, the notebook and a preview included
    reads = (game.hash, game.scene_json, game.ledger_json, game.ending_json, game.in_flight)
    for read in reads:
        read()
    assert game.header()["seed"] == 1 and json.loads(game.snapshot_json())["tick"] == tick
    frame = out["frame"]
    assert frame["notebook"] == [] and frame["player"]["talk"]["npc"] == WHO
    for _ in range(50):  # a host that polls the core
        again = step(game)
        assert again["advanced"] is False and again["clock"]["paused"] is True
        assert again["frame"]["time"] == out["frame"]["time"]
    assert game.tick == tick and game.snapshot_json() == snapshot


def test_a_request_in_flight_does_not_move_the_tick_and_its_result_lands_in_the_held_world():
    room = Room(WHO)
    out = room.act("ask", topic="t_rail")
    (request,) = out["requests"]
    while not out["clock"]["paused"]:  # the act is paid for
        out = room.step()
    tick = room.game.tick
    assert room.thinking(out) == WHO and [r["request_id"] for r in room.flying] == [
        request["request_id"]
    ]
    for _ in range(30):  # the model is slow
        out = room.step()
        assert out["advanced"] is False and room.thinking(out) == WHO
    assert room.game.tick == tick and len(room.flying) == 1
    out = room.result(request, "ok", GOOD)
    assert out["advanced"] is False and room.game.tick == tick  # the result landed, in no time
    assert room.answered(out) and room.thinking(out) is None and room.flying == []
    assert out["clock"]["paused"] is True


def test_the_hold_is_the_worlds_and_the_hosts_pause_is_the_hosts():
    game, _ = open_talk()
    tick, snapshot = game.tick, game.snapshot_json()
    paused = step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})
    assert paused["advanced"] is False and paused["clock"]["paused"] is True
    resumed = step(game, {"seq": game.next_seq, "kind": "resume", "body": {}})
    # the host let go of its pause, and the conversation still holds the clock
    assert resumed["advanced"] is False and resumed["clock"]["paused"] is True
    assert game.tick == tick and game.paused
    state = json.loads(game.snapshot_json())
    assert state["paused"] is False and state["next_seq"] == json.loads(snapshot)["next_seq"] + 2
    out = act(game, "ask", topic="t_rail")  # and an act still starts the world
    assert out["advanced"] is True and out["clock"] == {"paused": False, "rate": [20, 1]}


def test_the_hosts_pause_stops_the_payment_and_a_resume_goes_on_with_it():
    game, _ = open_talk()
    start = game.tick
    out = act(game, "ask", topic="t_rail")
    for _ in range(6):
        out = step(game)
    owed = state_of(game)["clock"]["debt"]
    tick = game.tick
    out = step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})
    assert out["advanced"] is False and out["clock"]["paused"] is True
    for _ in range(10):
        assert step(game)["advanced"] is False
    assert game.tick == tick and state_of(game)["clock"]["debt"] == owed  # not a second paid
    # the player still acts in a paused world, and the minutes of it are owed on top
    out = act(game, "ask", topic="p_bridge")
    assert out["advanced"] is False and state_of(game)["clock"]["debt"] == owed + 600
    out = step(game, {"seq": game.next_seq, "kind": "resume", "body": {}})
    assert out["advanced"] is True and out["clock"]["rate"] == [20, 1]
    outs = run_debt(game, out)
    assert game.tick - start == 40 and outs[-1]["clock"]["paused"] is True
    assert "debt" not in state_of(game)["clock"]


# ------------------------------------------------------------------------------ what an act costs


@pytest.mark.parametrize(("name", "minutes"), sorted(COSTS.items()))
def test_each_act_of_a_talk_runs_the_world_for_exactly_its_minutes_and_holds_it_again(
    name, minutes
):
    game, _ = open_talk()
    start = game.tick
    out = perform(game, name)
    # the rules answer first, in the very call that carried the act, and the world runs fast
    assert [e["kind"] for e in out["events"]].count("replied") == 1
    assert out["clock"] == {"paused": False, "rate": [20, 1]} and out["advanced"] is True
    outs = run_debt(game, out)
    assert game.tick - start == 2 * minutes  # a tick of the day is half a minute
    assert minute_of(game.tick) - minute_of(start) == minutes
    assert all(o["advanced"] for o in outs) and len(outs) == 2 * minutes
    assert all(o["clock"] == {"paused": False, "rate": [20, 1]} for o in outs[:-1])
    assert outs[-1]["clock"] == {"paused": True, "rate": [1, 1]} and game.paused
    assert "debt" not in state_of(game)["clock"] and me(game)["talk"]["npc"] == WHO
    assert step(game)["advanced"] is False  # held again
    assert game.tick - start == 2 * minutes


def test_speaking_in_public_costs_thirty_minutes_and_the_words_of_the_elder_outlast_the_run():
    game = teahouse(18, 15)
    start = game.tick
    out = act(game, "speak")
    assert acks(out) == [("applied", None)] and events(out, "spoke")
    assert out["clock"] == {"paused": False, "rate": [20, 1]}
    outs = run_debt(game, out)
    assert game.tick - start == 60 and minute_of(game.tick) - minute_of(start) == 30
    assert outs[-1]["clock"] == {"paused": False, "rate": [1, 1]}  # nobody is in a talk: it runs on
    (elder,) = [b for b in outs[-1]["frame"]["bubbles"] if b["npc"] == "zuzhang"]
    assert elder["until"] - game.tick == player.LINE_TICKS  # still on show for the usual time
    assert "debt" not in state_of(game)["clock"] and step(game)["advanced"] is True


def test_an_act_that_was_not_carried_out_costs_nothing():
    game, _ = open_talk()
    tick = game.tick
    for name, fields, reason in (
        ("ask", {"topic": "nowhere"}, "unknown_topic"),
        ("ask_source", {"entry": "n9"}, "no_entry"),
        ("tell", {"entry": "n9", "how": "faithful"}, "no_entry"),
        ("entrust", {"kind": "teleport"}, "no_request"),
        ("promise", {"op": "keep", "id": "k9"}, "no_pledge"),
    ):
        out = act(game, name, **fields)
        assert acks(out) == [("rejected", reason)], name
        assert out["advanced"] is False and out["clock"]["paused"] is True, name
    assert game.tick == tick and "debt" not in state_of(game)["clock"]
    elsewhere = bridge(1, **CLEAR)
    assert acks(act(elsewhere, "ask", topic="t_rail")) == [("rejected", "not_talking")]
    assert acks(act(elsewhere, "speak")) == [("rejected", "no_venue")]
    assert "debt" not in state_of(elsewhere)["clock"]


def test_a_no_costs_as_much_as_a_yes_and_so_does_being_told_it_has_been_said():
    game, _ = open_talk()
    start = game.tick
    out = act(game, "entrust", kind="join")
    assert acks(out) == [("rejected", "refused")]
    run_debt(game, out)
    assert game.tick - start == 40
    out = act(game, "entrust", kind="join")  # nothing has moved: she has said it
    assert acks(out) == [("rejected", "said_already")]
    run_debt(game, out)
    assert game.tick - start == 80 and game.paused


def test_debts_add_up_while_the_first_is_being_paid():
    game, _ = open_talk()
    start = game.tick
    act(game, "ask", topic="t_rail")
    out = act(game, "ask", topic="p_bridge")  # the player does not wait for the first
    assert out["advanced"] is True and game.tick - start == 2
    assert state_of(game)["clock"]["debt"] == 2 * 600 - 2 * 30  # two acts, two ticks paid
    outs = run_debt(game, out)
    assert game.tick - start == 40 and outs[-1]["clock"]["paused"] is True


def test_leaving_does_not_let_the_time_of_the_last_act_go():
    game, _ = open_talk()
    start = game.tick
    act(game, "ask", topic="t_rail")
    out = act(game, "leave")
    assert acks(out) == [("applied", None)] and me(game)["talk"] == {}
    assert out["clock"] == {"paused": False, "rate": [20, 1]}  # the minutes were spent
    outs = run_debt(game, out)
    assert game.tick - start == 20 and outs[-1]["clock"] == {"paused": False, "rate": [1, 1]}
    assert step(game)["advanced"] is True  # and the world is not held, since nobody talks
    # leaving a conversation in which nothing is owed lets the world go on at once
    held, _ = open_talk()
    out = act(held, "leave")
    assert out["advanced"] is True and out["clock"] == {"paused": False, "rate": [1, 1]}


def test_a_judged_request_is_charged_when_the_judge_has_answered_and_not_before():
    room = Room(WHO)
    out = room.act("entrust", kind="join", words="Please, the bridge needs you.")
    (judge,) = out["requests"]
    assert judge["interaction_id"].startswith("judge:") and out["events"] == []
    assert out["advanced"] is False and out["clock"]["paused"] is True  # the act waits, in no time
    tick = room.game.tick
    for _ in range(10):
        assert room.step()["advanced"] is False
    assert room.game.tick == tick and "debt" not in state_of(room.game)["clock"]
    out = room.result(judge, "ok", '{"score": 3}')  # now she answers
    assert room.ack(out) and out["clock"] == {"paused": False, "rate": [20, 1]}
    while not out["clock"]["paused"]:
        out = room.step()
    assert room.game.tick - tick == 40


def test_the_talk_that_ends_while_a_judge_is_out_costs_nothing():
    room = Room(WHO)
    out = room.act("entrust", kind="join", words="Please, the bridge needs you.")
    (judge,) = out["requests"]
    out = room.act("leave")
    # the request that waited is answered as having no talk to be in, and the talk is over
    assert room.ack(out) == [("rejected", "not_talking"), ("applied", None)]
    assert out["cancels"] == [judge["request_id"]]
    assert out["clock"] == {"paused": False, "rate": [1, 1]}
    out = room.result(judge, "ok", '{"score": 3}')  # and the answer that comes late is voided
    assert [e["reason"] for e in out["events"]] == ["cancelled"]
    assert "debt" not in state_of(room.game)["clock"]


# ------------------------------------------------------------------------------ the clock's scale


def test_the_minutes_are_ticks_by_the_clock_of_the_hour_it_is_and_the_night_is_two_minutes_a_tick():
    assert clock.TICK_SECONDS == {"day": 30, "night": 120}
    game, _ = open_talk("gengfu", hour=22)  # the watchman is up at night
    start = game.tick
    assert clock.at(start).phase == "night"
    out = act(game, "ask", topic="t_rail")
    outs = run_debt(game, out)
    assert game.tick - start == 5 and minute_of(game.tick) - minute_of(start) == 10
    out = perform_tell(game)
    outs = run_debt(game, out)
    assert len(outs) == 8  # fifteen minutes is seven ticks and a half: the world never runs short
    assert state_of(game)["clock"] == {"rate": [1, 1]}


def perform_tell(game: Game) -> dict:
    entry = know(game, "pr_boat_scratched")
    return act(game, "tell", entry=entry["id"], how="faithful")


def test_a_debt_that_crosses_dusk_is_paid_in_the_clocks_own_terms():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 20, 55))
    start = game.tick
    clock.owe(state_of(game), 600)  # ten minutes, five of them of the day and five of the night
    assert game.tick == start and clock.owed(state_of(game)) == 600
    outs = [json.loads(game.step()) for _ in range(10)]  # the ten ticks of the day
    assert minute_of(game.tick) == 21 * 60 and clock.at(game.tick).phase == "night"
    assert all(o["clock"]["rate"] == [20, 1] for o in outs)
    assert state_of(game)["clock"]["debt"] == 300
    while clock.owed(state_of(game)):
        game.step()
    assert game.tick - start == 10 + 3 and clock.at(game.tick).minute == 6  # 21:06, a tick over
    assert json.loads(game.step())["clock"]["rate"] == [1, 1]


# ------------------------------------------------------------------------------ the person goes


def test_the_person_goes_when_the_routine_says_and_what_is_still_owed_is_let_go():
    game, out = open_talk(hour=11, minute=58)
    leaves = at(1, 12) + 10
    assert out["frame"]["player"]["talk"]["leaves_at"] == {"hour": 12, "minute": 5}
    start = game.tick
    cell = (state_of(game)["npcs"]["list"][3 + 7]["x"], state_of(game)["npcs"]["list"][10]["y"])
    out = act(game, "ask", topic="t_rail")
    outs = run_debt(game, out)
    ended = [e for o in outs for e in events(o, "talk_end")]
    assert ended == [{"kind": "talk_end", "tick": leaves - 1, "npc": WHO, "reason": "timeout"}]
    assert game.tick == leaves and game.tick - start == 14  # seven minutes of the ten
    assert events(outs[-1], "talk_end")
    assert not [e for o in outs[:-1] for e in events(o, "talk_end")]
    last = outs[-1]
    assert last["clock"] == {"paused": False, "rate": [1, 1]} and me(game)["talk"] == {}
    assert "debt" not in state_of(game)["clock"] and last["frame"]["player"]["talk"] is None
    (said,) = [b for b in last["frame"]["bubbles"] if b["npc"] == WHO]
    assert said["text"] in voices.variants(WHO, "timeout")
    assert said["until"] == leaves - 1 + player.LINE_TICKS
    npc = state_of(game)["npcs"]["list"][10]
    assert (npc["x"], npc["y"]) == cell  # they have not gone yet; the routine goes on from here
    run_to(game, game.tick + 200)
    npc = state_of(game)["npcs"]["list"][10]
    assert npc["id"] == WHO and npc["place"] != "" and npc["act"] == "work"


def test_a_debt_that_ends_exactly_when_the_person_goes_ends_the_talk_in_its_last_tick():
    game, _ = open_talk(hour=11, minute=55)
    start = game.tick
    out = act(game, "ask", topic="t_rail")  # ten minutes, to five past noon
    outs = run_debt(game, out)
    assert game.tick == at(1, 12) + 10 == start + 20 and me(game)["talk"] == {}
    assert [bool(events(o, "talk_end")) for o in outs] == [False] * 19 + [True]
    assert outs[-1]["clock"] == {"paused": False, "rate": [1, 1]}


def test_a_person_who_is_not_asked_anything_does_not_go_and_neither_does_the_hour_pass():
    game, _ = open_talk(hour=11, minute=59)
    tick = game.tick
    for _ in range(100):
        assert step(game)["advanced"] is False
    assert game.tick == tick and me(game)["talk"]["npc"] == WHO  # it is five past noon nowhere


def test_a_person_who_goes_home_at_dusk_goes_at_dusk_and_the_rest_of_the_act_is_let_go():
    game, _ = open_talk("li_da", hour=20, minute=58)
    assert me(game)["talk"]["until"] == at(1, 21)  # the routine says nine o'clock, which is dusk
    start = game.tick
    outs = run_debt(game, act(game, "ask", topic="t_rail"))
    assert game.tick - start == 4 and me(game)["talk"] == {}  # two minutes, not ten
    assert [e["reason"] for o in outs for e in events(o, "talk_end")] == ["timeout"]
    assert outs[-1]["clock"]["rate"] == [1, 1] and clock.at(game.tick).phase == "night"


# ------------------------------------------------------------------------------ the rest of town


def test_a_talk_changes_nothing_in_the_town_but_the_person_who_is_held():
    game, _ = open_talk()
    start = game.tick
    for topic in ("t_rail", "p_bridge", "li_er"):
        run_debt(game, act(game, "ask", topic=topic))
    act(game, "leave")
    twin = bridge(1, **CLEAR)
    run_to(twin, at(1, 8))
    silence(twin)
    run_to(game, game.tick + 100)
    run_to(twin, game.tick)
    assert game.tick - start >= 160
    rest = lambda g: [n for n in state_of(g)["npcs"]["list"] if n["id"] != WHO]  # noqa: E731
    assert rest(game) == rest(twin)
    for section in ("weather", "tasks", "goals", "crowd"):
        assert state_of(game)[section] == state_of(twin)[section], section
    assert game._kernel.state["rng"] == twin._kernel.state["rng"]


def test_the_agenda_looks_again_on_the_hour_in_the_middle_of_a_debt_as_it_does_in_an_idle_game():
    game = slice_game()
    run_to(game, at(1, 14, 55))
    meet(game, WHO)
    twin = slice_game()
    run_to(twin, at(1, 15, 5))
    silence(twin)
    assert "t_tea_tonight" not in state_of(game)["agenda"]["tasks"]
    start = game.tick
    out = act(game, "ask", topic="t_rail")  # ten minutes, across three o'clock
    seen = []

    def look(outputs):
        mark = state_of(game)["agenda"]["mark"]
        assert mark == [game._kernel.state["version"], 1, clock.at(game.tick - 1).hour, *mark[3:]]
        seen.append(mark[2])

    run_debt(game, out, look)
    assert seen[0] == 14 and seen[-1] == 15 and sorted(set(seen)) == [14, 15]
    assert seen.index(15) == at(1, 15) - start  # five minutes of the ten, at two ticks a minute
    row = state_of(game)["agenda"]["tasks"]["t_tea_tonight"]
    assert row == state_of(twin)["agenda"]["tasks"]["t_tea_tonight"]
    assert row["state"] == "open" and row["since"] == at(1, 15)


def test_the_agenda_ends_a_task_at_seven_in_the_middle_of_a_debt_as_it_does_in_an_idle_game():
    game = slice_game()
    run_to(game, at(1, 18, 55))
    meet(game, WHO)
    twin = slice_game()
    run_to(twin, at(1, 19, 5))
    assert state_of(game)["agenda"]["tasks"]["t_tea_tonight"]["state"] == "open"
    run_debt(game, act(game, "ask", topic="p_bridge"))
    stale = state_of(game)["agenda"]["tasks"]["t_tea_tonight"]
    assert stale == state_of(twin)["agenda"]["tasks"]["t_tea_tonight"]
    assert stale["state"] == "stale" and stale["since"] == at(1, 19)


def test_the_agenda_follows_the_events_and_the_cell_of_the_player_through_a_debt():
    game = slice_game()
    run_to(game, at(1, 20, 55))
    silence(game)
    clock.owe(state_of(game), 600)  # a debt that crosses dusk, which is an event
    seen = []

    def look(outputs):
        mark = state_of(game)["agenda"]["mark"]
        assert mark[0] == game._kernel.state["version"], game.tick
        assert mark[3:] == [me(game)["x"], me(game)["y"]]
        seen.append((mark[0], events(outputs, "dusk") != []))

    look(json.loads(game.step()))
    start = (me(game)["x"], me(game)["y"])
    act(game, "move", place="p_teahouse")  # the player walks while the world runs fast
    while clock.owed(state_of(game)):
        look(json.loads(game.step()))
    versions = [version for version, _ in seen]
    assert versions == sorted(versions) and versions[-1] > versions[0]  # the dusk was an event
    assert any(dusk for _, dusk in seen)
    assert (me(game)["x"], me(game)["y"]) != start  # and the cell moved with the clock


def test_a_talk_across_five_in_the_evening_opens_the_teahouse_and_changes_no_story():
    game = slice_game()
    run_to(game, at(1, 16, 45))
    meet(game, "li_laotai")  # she is at the teahouse from three until seven
    twin = slice_game()
    run_to(twin, at(1, 17, 15))
    before = state_of(twin)["social"]["beliefs"]
    for _ in range(3):
        out = act(game, "ask", topic="li_er")
        run_debt(game, out)
    assert minute_of(game.tick) == 17 * 60 + 15 and me(game)["talk"]["npc"] == "li_laotai"
    assert game.tick == twin.tick
    act(game, "leave")
    verbs = step(game)["frame"]["hud"]["verbs"]
    assert "speak" in verbs  # it is evening, and the manager stands at the teahouse
    assert state_of(game)["social"]["beliefs"] == before  # no story was told on the way


def test_a_request_has_the_same_id_whether_a_held_tick_had_one_call_or_several():
    """The judge of an entrust is asked, its answer lands in the held world, and the reply is asked:
    three events at one tick, in two calls. A replay makes one call of them, so the ids of the
    requests must not depend on how the calls were made."""
    game = talking(WHO)
    recorder = Recorder(game)
    tick = game.tick

    def send(*records):
        return json.loads(recorder.step(json.dumps(list(records))))

    entrust = {"action_id": "e1", "type": "entrust", "kind": "join", "words": "Come and help."}
    out = send(player_record(game.next_seq, entrust))
    (judge,) = out["requests"]
    assert out["advanced"] is False and judge["request_id"] == f"r{tick}-0"
    assert game._kernel.state["issued"] == [tick, 1]  # kept while the tick is not over
    usage = {"input_tokens": 50, "output_tokens": 5}
    body = {"request_id": judge["request_id"], "status": "ok", "text": '{"score": 3}'}
    out = send({"seq": game.next_seq, "kind": "model_result", "body": body | {"usage": usage}})
    (reply,) = out["requests"]
    assert out["advanced"] is True and "issued" not in game._kernel.state  # the entrust is paid for
    assert reply["request_id"] == f"r{tick}-1"  # and not the id of the judge, which is settled
    again = rebuild(recorder.recording())
    assert again.snapshot_json() == game.snapshot_json()


# ------------------------------------------------------------------------------ save and replay


def test_a_game_saved_in_the_middle_of_a_debt_goes_on_exactly():
    game, _ = open_talk()
    start = game.tick
    act(game, "ask", topic="t_rail")
    for _ in range(7):
        step(game)
    owed = state_of(game)["clock"]["debt"]
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert owed == 12 * 30 and state_of(twin)["clock"]["debt"] == owed
    assert twin.hash() == game.hash() and twin.paused is False
    while True:
        a, b = step(game), step(twin)
        assert a == b and game.hash() == twin.hash()
        if a["clock"]["paused"]:
            break
    assert game.tick == twin.tick == start + 20
    assert twin.paused and step(twin)["advanced"] is False  # and the restored game is held too


def test_a_game_saved_while_held_is_held_and_acts_as_the_original_does():
    game, _ = open_talk()
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert twin.paused and twin.tick == game.tick
    assert step(twin)["advanced"] is False
    assert act(game, "ask", topic="t_rail") == act(twin, "ask", topic="t_rail")
    while True:
        a, b = step(game), step(twin)
        assert a == b
        if a["clock"]["paused"]:
            break
    assert game.hash() == twin.hash()


def test_a_game_saved_with_the_host_paused_in_a_debt_resumes_where_it_was():
    game, _ = open_talk()
    start = game.tick
    act(game, "ask", topic="t_rail")
    for _ in range(4):
        step(game)
    step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert twin.paused and twin.hash() == game.hash()
    for each in (game, twin):
        out = step(each, {"seq": each.next_seq, "kind": "resume", "body": {}})
        assert out["advanced"] is True and out["clock"]["rate"] == [20, 1]
        while not out["clock"]["paused"]:
            out = step(each)
    assert game.hash() == twin.hash() and game.tick == twin.tick == start + 20


class Chatter(Bot):
    """The manager who asks the madam three things in the morning and the clerk two at noon."""

    name = "chatter"

    def play(self):
        yield from self.wait_until(1, 7, 40)
        if (yield from self.meet("cha_laoban")):
            yield from self.act("ask", topic="li_er")
            yield from self.act("ask", topic="p_bridge")
            yield from self.act("entrust", kind="join")
            yield from self.leave()
        yield from self.wait_until(1, 12, 20)
        if (yield from self.meet("zhou_huoji")):
            yield from self.act("ask", topic="li_er")
            yield from self.act("ask_source", entry=self.o.notebook[0]["id"])
            yield from self.leave()
        while True:
            yield None


def played_with_pauses(until: int):
    """The slice played by ``Chatter`` through a recorder, with the host pausing in the middle of a
    debt and in a held conversation. The game, the recorder and the ticks it paused at."""
    started = slice_game()
    recorder = Recorder(started)
    bot = Chatter(json.loads(started.scene_json()), started.header()["seed"])
    obs = Obs(json.loads(recorder.step("[]")))
    paused_at: list[int] = []
    while started.tick < until:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": started.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(recorder.step(json.dumps(records)))
        obs = Obs(out)
        owing = clock.owed(state_of(started)) > 0
        held = started.paused and not started._kernel.state["paused"]
        if (owing or held) and len(paused_at) < 6 and started.tick % 7 == 0:
            for kind in ("pause", "resume"):
                recorder.step(json.dumps([{"seq": started.next_seq, "kind": kind, "body": {}}]))
            paused_at.append(started.tick)
    return started, recorder, paused_at


def test_a_recording_of_a_game_with_talks_and_pauses_in_them_is_replayed_to_the_same_game():
    game, recorder, paused_at = played_with_pauses(at(1, 13, 0))
    assert len(paused_at) == 6
    recording = canon.loads(canon.dumps_str(recorder.recording()))  # as a file would carry it
    kinds = [row[2] for row in recording["records"]]
    assert kinds.count("pause") == kinds.count("resume") == 6 and kinds.count("player") > 8
    again = rebuild(recording)  # it checks every hash on the way
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()
    assert again.tick == game.tick and again.paused == game.paused
    # a seek starts from the latest snapshot at or before the target, which can be in a debt
    owing = [
        tick
        for tick, text in recording["snapshots"]
        if "debt" in json.loads(text)["world"]["clock"]
    ]
    target = at(1, 12, 40)
    sought = rebuild(recording, until=target, seek=True)
    plain = rebuild(recording, until=target)
    assert sought.tick == plain.tick == target and sought.hash() == plain.hash()
    assert isinstance(owing, list)
