"""The fixed-timestep accumulator: game time follows the clock, not the wake-ups."""

import random

from hypothesis import given
from hypothesis import strategies as st

from lantern_eve.clock import MAX_ELAPSED_NS, NS_PER_MS, TICK_NS, FixedStepClock


def run(clock, wakes, num=1, den=1, pace=1):
    """Feed the wake-up times (ns, increasing) to the clock and count the ticks it hands out."""
    ticks = 0
    for now in wakes:
        clock.update(now, num, den, pace)
        while clock.due() >= 1:
            clock.consume(1)
            ticks += 1
    return ticks


def test_one_tick_per_hundred_milliseconds_at_rate_one():
    clock = FixedStepClock()
    clock.reset(0)
    assert run(clock, [99 * NS_PER_MS]) == 0
    assert run(clock, [100 * NS_PER_MS]) == 1
    assert run(clock, [350 * NS_PER_MS]) == 2
    assert run(clock, [400 * NS_PER_MS]) == 1


def test_the_rate_scales_game_time_and_pace_multiplies_it():
    for num, den, pace, per_second in [(2, 1, 1, 20), (1, 2, 1, 5), (3, 2, 1, 15), (1, 1, 7, 70)]:
        clock = FixedStepClock()
        clock.reset(0)
        wakes = [i * 10 * NS_PER_MS for i in range(1, 101)]
        assert run(clock, wakes, num, den, pace) == per_second, (num, den, pace)


def test_a_stopped_rate_adds_nothing_and_reports_no_wait():
    clock = FixedStepClock()
    clock.reset(0)
    assert run(clock, [1_000 * NS_PER_MS], num=0, den=1) == 0
    assert clock.seconds_until_next(0, 1) is None
    assert clock.dropped == 0


@given(
    gaps=st.lists(st.integers(min_value=1, max_value=900 * NS_PER_MS), min_size=1, max_size=200),
    seed=st.integers(0, 2**32),
)
def test_the_ticks_owed_do_not_depend_on_how_often_the_loop_wakes(gaps, seed):
    # Cut the same stretch of time into different updates: the same number of ticks fall due.
    total = sum(gaps)
    wakes, now = [], 0
    for gap in gaps:
        now += gap
        wakes.append(now)
    coarse = FixedStepClock()
    coarse.reset(0)
    fine = FixedStepClock()
    fine.reset(0)
    rng = random.Random(seed)
    # Random cuts, plus a cut at least every 1.5 s so that no single update meets the cap.
    cuts = {rng.randrange(1, total + 1) for _ in range(50)} | {total}
    cuts |= set(range(1_500 * NS_PER_MS, total, 1_500 * NS_PER_MS))
    cuts = sorted(cuts)
    expected = total // TICK_NS
    assert run(coarse, wakes) == run(fine, cuts) == expected


def test_one_long_stall_is_capped_and_the_rest_is_dropped():
    clock = FixedStepClock()
    clock.reset(0)
    clock.update(10_000 * NS_PER_MS, 1, 1)
    assert clock.due() == MAX_ELAPSED_NS // TICK_NS
    assert clock.dropped == 8_000 * NS_PER_MS


def test_a_backlog_is_never_larger_than_the_cap():
    clock = FixedStepClock()
    clock.reset(0)
    now = 0
    for _ in range(10):
        now += 1_500 * NS_PER_MS
        clock.update(now, 1, 1)
    assert clock.due() == MAX_ELAPSED_NS // TICK_NS
    assert clock.dropped > 0


def test_reset_forgets_what_is_owed():
    clock = FixedStepClock()
    clock.reset(0)
    clock.update(900 * NS_PER_MS, 1, 1)
    clock.reset(900 * NS_PER_MS)
    assert clock.due() == 0
    clock.update(1_000 * NS_PER_MS, 1, 1)
    assert clock.due() == 1


def test_seconds_until_next():
    clock = FixedStepClock()
    clock.reset(0)
    assert clock.seconds_until_next(1, 1) == 0.1
    clock.update(40 * NS_PER_MS, 1, 1)
    assert abs(clock.seconds_until_next(1, 1) - 0.06) < 1e-9
    assert abs(clock.seconds_until_next(2, 1) - 0.03) < 1e-9
    assert abs(clock.seconds_until_next(1, 1, pace=10) - 0.006) < 1e-9
    clock.update(100 * NS_PER_MS, 1, 1)
    assert clock.due() == 1
    assert clock.seconds_until_next(1, 1) == 0.0
