"""The server host while the manager is in a conversation: the world holds its own clock, and the
clock of the transport goes on, so that the mock model still answers.

The transport is told ``Session.transport_tick``. While the world runs it is the game tick. While
a conversation holds the world the game tick does not move, and the transport clock goes on from
the clock of the session, a tick for every tenth of a second, until the world runs again. It stands
still while the host has paused the world. In a game in which nothing held the world it is the game
tick throughout. The tests play the bridge town on a virtual clock, to a talk with the madam of the
teahouse on the first morning.
"""

from __future__ import annotations

import pytest
from host_helpers import drive, drive_to_tick, frames, make_session, wake_gaps

from lantern_core.replay import rebuild
from lantern_eve.transport import MockTransport

CLEAR = {"weather_clear": 1, "weather_light": 0, "weather_heavy": 0}
WHO = "cha_laoban"  # at the teahouse from seven until noon
TALK_RANGE = 2
ASK = {"action_id": "ask-1", "type": "ask", "topic": "t_rail"}
DELAY = 100  # ticks the mock model takes to answer: ten seconds at the normal rate


class Spy(MockTransport):
    """The mock model, noting the tick of every call it gets and the tick each answer lands at."""

    def __init__(self, seed: int, delay: int) -> None:
        super().__init__(
            seed, min_delay=delay, max_delay=delay, error_per_mille=0, timeout_per_mille=0
        )
        self.started: dict[str, int] = {}
        self.landed: dict[str, int] = {}

    def start(self, request, tick):
        self.started[request["request_id"]] = tick
        super().start(request, tick)

    def poll(self, tick):
        outcomes = super().poll(tick)
        for outcome in outcomes:
            self.landed.setdefault(outcome.request_id, tick)
        return outcomes


def open_talk(delay: int = DELAY, seed: int = 1, **options):
    """A bridge game at eight in the morning of the first day with the manager in a talk with the
    madam of the teahouse, and a mock model that takes ``delay`` ticks to answer. The world holds
    its clock, and the host has not paused it."""
    session, clock, out = make_session(
        seed,
        scenario="bridge",
        config=CLEAR,
        factory=lambda spec: Spy(spec.seed, delay),
        **options,
    )
    drive_to_tick(session, clock, 230)
    session.player({"action_id": "move-1", "type": "move", "place": "p_teahouse"})
    for _ in range(200):
        clock.advance_ms(100)
        session.pump()
        frame = session.last_frame["frame"]
        me = frame["player"]
        madam = next(n for n in frame["npcs"] if n["id"] == WHO)
        if max(abs(me["x"] - madam["x"]), abs(me["y"] - madam["y"])) <= TALK_RANGE:
            break
    else:
        raise AssertionError("the manager does not get to the madam")
    session.player({"action_id": "talk-1", "type": "talk", "npc": WHO})
    clock.advance_ms(100)
    session.pump()
    (ack,) = [m for m in out if m["type"] == "ack" and m["action_id"] == "talk-1"]
    assert ack["result"] == "applied", ack
    assert session.core_paused and session.reasons == []
    return session, clock, out


def ask_and_pay(session, clock) -> str:
    """Ask the madam, which puts a request in flight, and run the world until the minutes of the
    act are paid for and it holds its clock again. The id of the request."""
    before = set(session.transport.started)
    session.player(ASK)
    (request_id,) = set(session.transport.started) - before
    for _ in range(100):
        if session.core_paused:
            return request_id
        clock.advance_ms(100)
        session.pump()
    raise AssertionError("the act is not paid for")


def thinking(out) -> str | None:
    return frames(out)[-1]["frame"]["player"]["thinking"]


def test_a_mock_reply_lands_in_a_held_talk_after_its_delay_in_ticks_of_the_transport():
    session, clock, out = open_talk()
    spy = session.transport
    request_id = ask_and_pay(session, clock)
    held_at, begun = session.next_tick, session.transport_tick
    assert thinking(out) == WHO and request_id in session.calls
    due = spy.started[request_id] + DELAY
    assert begun < due - 50, "the act is paid for long before the answer is due"

    # The world stands still. The clock of the transport goes on a tick for every tenth of a second,
    # and the answer lands in the very pass of the loop that brings it to the tick it is due at.
    for step in range(1, due - begun + 1):
        assert request_id not in spy.landed
        clock.advance_ms(100)
        session.pump()
        assert session.next_tick == held_at and session.core_paused
        assert session.transport_tick == begun + step
    assert spy.landed[request_id] == due
    assert request_id not in session.calls and session.models["ok"] == 1
    # It reached the core as an input of the game, at the tick the world is held at.
    (landed,) = [r for r in session.recorder.records if r[2] == "model_result"]
    assert landed[0] == held_at and landed[3]["request_id"] == request_id

    # The words of a mock are not an answer the core can use, so it asks once more and then keeps
    # the answer of the rules. Nobody is left thinking, and the clock of the game never moved.
    for _ in range(2 * DELAY):
        clock.advance_ms(100)
        session.pump()
    assert thinking(out) is None and not session.calls
    assert session.models["ok"] == 2
    assert session.next_tick == held_at
    assert session.transport_tick == held_at + session.held_ticks
    assert session.stats()["paused"] is True and session.reasons == []


def test_the_transport_clock_never_goes_back_when_the_manager_goes_on_or_leaves():
    session, clock, out = open_talk()
    seen = [session.transport_tick]
    ask_and_pay(session, clock)
    for _ in range(30):
        clock.advance_ms(100)
        session.pump()
        seen.append(session.transport_tick)
    session.player({"action_id": "leave-1", "type": "leave"})
    held = session.held_ticks
    assert held > 0
    for _ in range(30):
        clock.advance_ms(100)
        session.pump()
        seen.append(session.transport_tick)
    assert not session.core_paused and frames(out)[-1]["clock"] == {"paused": False, "rate": [1, 1]}
    assert seen == sorted(seen) and len(set(seen)) > 30
    # The world runs again, a tick for a tick, and what the transport clock gained stays.
    assert session.held_ticks == held
    assert session.transport_tick == session.next_tick + held


def test_a_host_pause_freezes_the_mock_in_a_held_talk_and_the_time_of_it_is_not_owed():
    session, clock, out = open_talk()
    spy = session.transport
    request_id = ask_and_pay(session, clock)
    for _ in range(30):
        clock.advance_ms(100)
        session.pump()
    session.pause("user")
    frozen, held_at, held = session.transport_tick, session.next_tick, session.held_ticks
    for _ in range(300):  # thirty seconds
        clock.advance_ms(100)
        session.pump()
    assert session.transport_tick == frozen and session.held_ticks == held
    assert request_id in session.calls and not spy.landed and thinking(out) == WHO
    assert session.next_tick == held_at

    clock.advance_ms(90)  # real time since the last pass of the loop, which the pause covers
    session.resume("user")
    assert session.core_paused and session.reasons == []  # the host lets go, the talk holds
    due = spy.started[request_id] + DELAY
    left = due - frozen  # ticks of the transport clock to go, at two passes of the loop a tick
    for _ in range(2 * left - 1):
        clock.advance_ms(50)
        session.pump()
    assert request_id in session.calls, "the time of the pause, or before it, was counted"
    clock.advance_ms(50)
    session.pump()
    assert request_id not in session.calls and spy.landed[request_id] == due
    assert session.next_tick == held_at


def test_a_pause_in_the_middle_of_the_payment_holds_the_payment_and_the_clock_of_the_transport():
    session, clock, _ = open_talk()
    session.player(ASK)
    clock.advance_ms(50)
    session.pump()
    assert not session.core_paused  # the world is running fast, paying for the act
    session.pause("user")
    tick, transport = session.next_tick, session.transport_tick
    for _ in range(100):
        clock.advance_ms(100)
        session.pump()
    assert (session.next_tick, session.transport_tick) == (tick, transport)
    session.resume("user")
    for _ in range(50):
        clock.advance_ms(100)
        session.pump()
    assert session.core_paused and session.next_tick > tick  # paid, and the talk holds again


def test_the_replay_of_a_game_with_a_held_talk_plays_back_to_the_same_world():
    session, clock, out = open_talk()
    request_id = ask_and_pay(session, clock)
    for _ in range(3 * DELAY):
        clock.advance_ms(100)
        session.pump()
    assert request_id in session.transport.landed
    session.player({"action_id": "leave-1", "type": "leave"})
    drive_to_tick(session, clock, session.next_tick + 40)
    replay = session.replay()
    assert replay["end_tick"] == session.next_tick
    assert rebuild(replay).hash() == session.game.hash() == replay["final"]["hash"]
    assert rebuild(replay, seek=True).hash() == session.game.hash()


def test_a_new_game_starts_the_transport_clock_over():
    session, clock, _ = open_talk()
    ask_and_pay(session, clock)
    for _ in range(20):
        clock.advance_ms(100)
        session.pump()
    assert session.held_ticks > 0
    session.new_game(2, "bridge")
    assert session.held_ticks == 0 and session.transport_tick == session.next_tick == 0


class Told(MockTransport):
    """The mock model, noting for every call it gets the tick it is told and the game tick."""

    def __init__(self, seed: int) -> None:
        super().__init__(seed)
        self.session = None
        self.told: list[tuple[str, int, int]] = []

    def note(self, kind: str, tick: int) -> None:
        self.told.append((kind, tick, self.session.next_tick))

    def start(self, request, tick):
        self.note("start", tick)
        super().start(request, tick)

    def cancel(self, request_id, tick):
        self.note("cancel", tick)
        super().cancel(request_id, tick)

    def poll(self, tick):
        self.note("poll", tick)
        return super().poll(tick)

    def host_events(self, tick):
        self.note("host_events", tick)
        return super().host_events(tick)


def told_run(seed: int, ticks: int, *, pause: bool = False):
    """Play the demo world in real time on an irregular clock, with a pause of the host in the
    middle if asked to. Every call the transport got is in ``transport.told``."""
    session, clock, _ = make_session(seed, factory=lambda spec: Told(spec.seed))
    session.transport.session = session
    gaps = wake_gaps(ticks * 100, seed=11)
    half = len(gaps) // 2
    drive(session, clock, gaps[:half])
    if pause:
        session.pause("user")
        drive(session, clock, [100] * 40)
        session.resume("user")
    drive(session, clock, gaps[half:])
    assert session.next_tick == ticks
    return session


def test_a_run_with_no_talk_tells_the_transport_the_game_tick_and_is_the_game_of_a_lockstep_run():
    # Nothing holds the world, so the clock of the transport is the game tick at every call it
    # gets (as it was before it had a clock of its own), also across a pause of the host.
    ticks = 1500
    live = told_run(7, ticks)
    told = live.transport.told
    assert {kind for kind, _, _ in told} == {"start", "cancel", "poll", "host_events"}
    assert all(sent == game for _, sent, game in told)
    assert live.held_ticks == 0

    lock, _, _ = make_session(7)
    lock.run_lockstep(ticks)
    assert lock.transport_tick == lock.next_tick == ticks and lock.held_ticks == 0
    assert live.game.hash() == lock.game.hash()
    assert live.recorder.hashes == lock.recorder.hashes
    assert live.recorder.records == lock.recorder.records
    assert live.transport.counts["ok"] > 10

    paused = told_run(7, ticks, pause=True)
    assert all(sent == game for _, sent, game in paused.transport.told)
    assert paused.held_ticks == 0


@pytest.mark.parametrize("held", [False, True], ids=["paused by the host", "held by a talk"])
def test_a_lockstep_run_that_meets_a_stopped_world_says_it_has_nobody_to_start_it(held):
    if held:
        session, _, _ = open_talk()
    else:
        session, _, _ = make_session(3, hidden=True)
    with pytest.raises(
        RuntimeError, match=r"stopped.*paused by the host or held by a conversation"
    ):
        session.run_lockstep(session.next_tick + 5)
