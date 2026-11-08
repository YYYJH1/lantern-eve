"""The clock of the bridge world: a day of two speeds, the rate, and the dawn and dusk events."""

import pytest
from bridge_helpers import CYCLE, at, bridge, run_to, state_of, step

from lantern_core.api import Game
from lantern_core.world.bridge import clock

# ------------------------------------------------------------------------------ the arithmetic


def test_the_day_is_1800_ticks_at_120_an_hour_and_the_night_270_at_30():
    assert (clock.DAY_TICKS, clock.NIGHT_TICKS, clock.CYCLE_TICKS) == (1800, 270, 2070)
    assert (clock.DAY_TICKS_PER_HOUR, clock.NIGHT_TICKS_PER_HOUR) == (120, 30)
    assert (clock.DAWN_HOUR, clock.DUSK_HOUR) == (6, 21)
    start, last_day, first_night = clock.at(0), clock.at(1799), clock.at(1800)
    assert (start.day, start.hour, start.minute, start.phase) == (1, 6, 0, "day")
    assert (last_day.hour, last_day.minute, last_day.phase) == (20, 59, "day")
    assert (first_night.day, first_night.hour, first_night.minute) == (1, 21, 0)
    assert first_night.phase == "night" and first_night.phase_tick == 0
    last_night = clock.at(2069)
    assert (last_night.hour, last_night.minute, last_night.phase) == (5, 58, "night")
    dawn = clock.at(2070)
    assert (dawn.day, dawn.hour, dawn.minute, dawn.phase, dawn.phase_tick) == (2, 6, 0, "day", 0)


def test_every_hour_has_the_ticks_of_its_phase():
    ticks_in_hour: dict[int, int] = {}
    previous = clock.at(0)
    for tick in range(CYCLE):
        now = clock.at(tick)
        ticks_in_hour[now.hour] = ticks_in_hour.get(now.hour, 0) + 1
        assert 0 <= now.minute < 60
        assert now.cycle_tick == tick
        if tick:
            same_hour = (now.hour, now.phase) == (previous.hour, previous.phase)
            assert same_hour or now.minute == 0  # a new hour starts on the hour
            assert now.minute >= previous.minute or not same_hour
        previous = now
    for hour in range(6, 21):
        assert ticks_in_hour[hour] == 120
    for hour in (21, 22, 23, 0, 1, 2, 3, 4, 5):
        assert ticks_in_hour[hour] == 30
    assert sum(ticks_in_hour.values()) == CYCLE


def test_minutes_are_whole_numbers_two_ticks_by_day_and_one_per_two_minutes_at_night():
    assert [clock.at(t).minute for t in (0, 1, 2, 3, 119, 120)] == [0, 0, 1, 1, 59, 0]
    assert [clock.at(clock.DAY_TICKS + t).minute for t in (0, 1, 2, 29, 30)] == [0, 2, 4, 58, 0]


def test_five_days_are_10350_ticks():
    assert 5 * CYCLE == 10_350
    end = clock.at(5 * CYCLE)
    assert (end.day, end.hour, end.minute) == (6, 6, 0)
    assert clock.at(5 * CYCLE - 1).day == 5


def test_hour_start_is_where_the_clock_reaches_the_hour():
    for hour in range(24):
        tick = clock.hour_start(hour)
        now = clock.at(tick)
        assert (now.hour, now.minute) == (hour, 0), hour
        if tick:
            before = clock.at(tick - 1)
            assert before.hour == (hour - 1) % 24
    starts = [clock.hour_start(h) for h in (*range(6, 24), *range(0, 6))]
    assert starts == sorted(starts) and starts[0] == 0 and starts[-1] == 2040


def test_helper_at_agrees_with_the_clock():
    for day, hour, minute in ((1, 6, 0), (2, 17, 30), (3, 22, 0), (4, 3, 30), (5, 20, 0)):
        now = clock.at(at(day, hour, minute))
        assert (now.day, now.hour, now.minute) == (day, hour, minute)


# ------------------------------------------------------------------------------ in the game


def test_the_frame_shows_the_time_of_the_next_tick():
    game = bridge(1)
    for _ in range(2 * CYCLE + 5):
        out = step(game)
        now = clock.at(game.tick)
        assert out["frame"]["time"] == {
            "day": now.day,
            "hour": now.hour,
            "minute": now.minute,
            "phase": now.phase,
        }


def test_dawn_and_dusk_are_announced_once_each_on_the_first_tick_of_the_phase():
    game = bridge(2)
    found = []
    run_to(
        game,
        3 * CYCLE,
        lambda out: found.extend(
            (e["tick"], e["kind"], e["day"]) for e in out["events"] if e["kind"] in ("dawn", "dusk")
        ),
    )
    assert found == [
        (0, "dawn", 1),
        (1800, "dusk", 1),
        (2070, "dawn", 2),
        (3870, "dusk", 2),
        (4140, "dawn", 3),
        (5940, "dusk", 3),
    ]


# ------------------------------------------------------------------------------ the rate


def test_the_rate_in_the_outputs_is_the_worlds_answer():
    game = bridge(3)
    assert step(game)["clock"] == {"paused": False, "rate": [1, 1]}
    clock.set_rate(state_of(game), 1, 3)
    assert step(game)["clock"] == {"paused": False, "rate": [1, 3]}
    assert game.tick == 2  # the rate changes the pace of the host, not the time of a tick
    clock.set_rate(state_of(game), 1, 1)
    assert step(game)["clock"]["rate"] == [1, 1]


def test_the_rate_is_part_of_the_state_the_hash_and_the_snapshot():
    game = bridge(3)
    run_to(game, 40)
    before = game.hash()
    clock.set_rate(state_of(game), 1, 3)
    assert game.hash() != before
    restored = Game.from_snapshot_json(game.snapshot_json())
    assert restored.hash() == game.hash()
    assert step(restored)["clock"]["rate"] == [1, 3]
    assert clock.rate(state_of(restored)) == (1, 3)


@pytest.mark.parametrize("num, den", [(0, 3), (1, 0), (-1, 2), (1, 101), (1.0, 3), (True, 3)])
def test_a_bad_rate_is_refused(num, den):
    game = bridge(3)
    with pytest.raises(ValueError):
        clock.set_rate(state_of(game), num, den)
    assert state_of(game)["clock"]["rate"] == [1, 1]


def test_the_night_is_short_because_it_has_fewer_ticks_not_because_the_rate_changes():
    game = bridge(4)
    rates = set()
    run_to(game, CYCLE, lambda out: rates.add(tuple(out["clock"]["rate"])))
    assert rates == {(1, 1)}


def test_m0_still_runs_at_the_normal_rate():
    game = Game(1)
    assert step(game)["clock"] == {"paused": False, "rate": [1, 1]}


# ------------------------------------------------------------------------------ the debt


def test_a_debt_is_whole_seconds_that_make_the_world_run_fast_and_is_paid_by_the_tick():
    game = bridge(1)
    state = state_of(game)
    assert (
        clock.owed(state) == 0
        and clock.rate(state) == (1, 1)
        and state["clock"] == {"rate": [1, 1]}
    )
    for bad in (0, -5, 1.5, True, "60"):
        with pytest.raises(ValueError, match="whole number of seconds"):
            clock.owe(state, bad)
    clock.owe(state, 61)
    clock.owe(state, 29)
    assert clock.owed(state) == 90 and clock.rate(state) == clock.DEBT_RATE == (20, 1)
    now = clock.at(game.tick)
    assert clock.ticks_owed(state, now) == 3  # a tick of the day is half a minute
    assert clock.ticks_owed(state, clock.at(clock.DAY_TICKS)) == 1  # and one of the night two
    clock.pay(state, clock.DAY)
    clock.pay(state, clock.DAY)
    assert clock.owed(state) == 30 and state["clock"]["debt"] == 30
    clock.pay(state, clock.NIGHT)  # more than is left: it is paid, and the key is gone
    assert state["clock"] == {"rate": [1, 1]} and clock.rate(state) == (1, 1)
    clock.pay(state, clock.DAY)  # nothing to pay
    assert state["clock"] == {"rate": [1, 1]}


def test_the_stored_rate_is_for_a_package_that_slows_the_world_and_a_debt_runs_over_it():
    game = bridge(1)
    state = state_of(game)
    clock.set_rate(state, 1, 2)
    assert clock.rate(state) == (1, 2)
    clock.owe(state, 30)
    assert clock.rate(state) == clock.DEBT_RATE
    game.step()
    assert clock.owed(state) == 0 and clock.rate(state) == (1, 2)


def test_after_is_where_the_clock_stands_once_what_is_owed_and_an_act_are_paid():
    game = bridge(1)
    state = state_of(game)
    start = at(1, 10, 50)
    then = clock.after(state, start, 20 * 60)  # twenty minutes of the day: forty ticks
    assert (then.tick, then.hour, then.minute) == (start + 40, 11, 10)
    assert clock.after(state, start) == clock.at(start)  # nothing owed, nothing added
    clock.owe(state, 5 * 60)  # what was owed before counts too, the act comes on top of it
    then = clock.after(state, start, 20 * 60)
    assert (then.tick, then.hour, then.minute) == (start + 50, 11, 15)
    assert state["clock"]["debt"] == 300  # and it only reads
    # across dusk a tick is two minutes: ten minutes of the day, then twenty of the night in ten
    state["clock"].pop("debt")
    dusk = at(1, 20, 50)
    then = clock.after(state, dusk, 30 * 60)
    assert (then.hour, then.minute, then.phase) == (21, 20, "night")
    assert then.tick == dusk + 20 + 10
    # a sliver of a tick is a whole tick, as the world pays it: 45 seconds are two ticks of the day
    assert clock.after(state, start, 45).tick == start + 2
