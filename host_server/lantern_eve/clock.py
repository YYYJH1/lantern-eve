"""A fixed-timestep accumulator, the same one the browser host runs (web/src/shared/clock.ts).

Real time goes in through ``update``, scaled by the rate the core reports, and whole ticks come
out through ``due`` and ``consume``. Game time is the number of ticks stepped, so it follows the
accumulator and never depends on how often the event loop wakes: a loop that wakes late finds
more ticks due and runs them in a burst, a loop that wakes early finds none.

All arithmetic is exact. Time comes in as integer nanoseconds, the rate is a ratio of two ints,
and the accumulator is a ``Fraction``, so the number of ticks that fall due over a stretch of
time is the same however the stretch is cut into updates.

Two limits keep a stalled process from building a backlog it can never work off. One update adds
at most ``max_elapsed_ns`` of real time, and the accumulator never holds more than that much
game time. What is beyond the limits is dropped and counted in ``dropped``.
"""

from __future__ import annotations

from fractions import Fraction

NS_PER_MS = 1_000_000
# One tick of game time at rate 1/1, in nanoseconds: the core runs at 10 Hz times its rate.
TICK_NS = 100 * NS_PER_MS
MAX_ELAPSED_NS = 2_000 * NS_PER_MS


class FixedStepClock:
    def __init__(self, tick_ns: int = TICK_NS, max_elapsed_ns: int = MAX_ELAPSED_NS) -> None:
        if tick_ns < 1 or max_elapsed_ns < tick_ns:
            raise ValueError("tick_ns must be positive and max_elapsed_ns at least one tick")
        self.tick_ns = tick_ns
        self.max_elapsed_ns = max_elapsed_ns
        self.acc = Fraction(0)
        self.last = 0
        self.dropped = Fraction(0)
        """Game nanoseconds that the two limits dropped."""

    def reset(self, now_ns: int) -> None:
        """Forget everything owed and count from ``now_ns``. On resume nothing is caught up."""
        self.acc = Fraction(0)
        self.last = now_ns

    def update(self, now_ns: int, num: int, den: int, pace: int = 1) -> None:
        """Add the real time since the last update, at ``pace * num / den`` game time per real."""
        elapsed = now_ns - self.last
        self.last = now_ns
        if elapsed <= 0:
            return
        speed = Fraction(pace * num, den) if num > 0 and den > 0 else Fraction(0)
        if elapsed > self.max_elapsed_ns:
            self.dropped += (elapsed - self.max_elapsed_ns) * speed
            elapsed = self.max_elapsed_ns
        if speed == 0:
            return
        self.acc += elapsed * speed
        cap = self.max_elapsed_ns * speed
        if self.acc > cap:
            self.dropped += self.acc - cap
            self.acc = cap

    def due(self) -> int:
        """Whole ticks that are owed."""
        return int(self.acc // self.tick_ns)

    def consume(self, n: int = 1) -> None:
        self.acc = max(Fraction(0), self.acc - n * self.tick_ns)

    def seconds_until_next(self, num: int, den: int, pace: int = 1) -> float | None:
        """Real seconds until the next tick falls due at this speed, or None if time is stopped."""
        if not (num > 0 and den > 0):
            return None
        remaining = max(Fraction(0), self.tick_ns - self.acc)
        return float(remaining / Fraction(pace * num, den)) / 1e9
