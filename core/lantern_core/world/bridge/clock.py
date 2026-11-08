"""Time in the bridge world: a day of two speeds, the time that an act owes, and the subsystem that
announces dawn and dusk.

A game day has two phases. The day runs from 06:00 to 21:00 at 120 ticks per game hour, which
is 1,800 ticks, three minutes at the normal rate of 10 ticks a second. The night runs from 21:00
to 06:00 at 30 ticks per game hour, which is 270 ticks, about half a minute. So a game day is
2,070 ticks and tick 0 is 06:00 of day 1. The night belongs to the day before it, so the
hours after midnight are still day 1 and day 2 begins at 06:00. The minute on a frame is
``tick_in_hour * 60 // ticks_per_hour``, whole numbers throughout. A tick of the day is half a
minute of game time and a tick of the night is two (``TICK_SECONDS``).

Where the clock stands is a function of the tick (``at``), so none of it is stored. What is
stored in the ``clock`` section is what can change: the ``rate``, as ``[num, den]``, and the
``debt``. The host runs ``10 * num / den`` ticks a second, and the world answers for it
(``BridgeWorld.rate``). The stored rate is ``[1, 1]`` until a package slows the world with
``set_rate``; the night is short because it has few ticks, not because the rate changes.

The debt. While the manager is in a conversation the world stands still: the tick does not move
(``BridgeWorld.halted``), so reading, looking at the notebook and waiting for a model cost nothing.
An act of the manager costs game time, and the core takes that time as a *debt* in game seconds
(``owe``): the section then holds ``"debt": seconds``, a key that is there only while something is
owed, so that a game in which nothing was done has no such key. While the debt
is positive the world is not held, whatever else is true, and runs at ``DEBT_RATE``, so that a host
burns through the hour fast and the player sees it go by. Every tick that is simulated takes the
length of that tick off the debt (``pay``, in the subsystem below, first in the tick), at the day's
half minute or the night's two, so that an hour that crosses dusk is paid in the clock's own
terms, and the tick that pays the last of it is the last: the world is held again if the manager
is still in a conversation. A tick of the night is two minutes, so an act at night may run up to
one tick over what it costs. The debt is state and is hashed, replayed and restored with the rest.
It does not know the host's own pause: a paused world simulates nothing, so it pays nothing.

The subsystem has one per-tick job besides the debt, which is to announce the phase change with a
``dawn`` or ``dusk`` event, in the first tick of the phase.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, NamedTuple

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "clock"

DAWN_HOUR = 6
DUSK_HOUR = 21
DAY, NIGHT = "day", "night"
DAY_TICKS_PER_HOUR = 120
NIGHT_TICKS_PER_HOUR = 30
TICK_SECONDS = {DAY: 3600 // DAY_TICKS_PER_HOUR, NIGHT: 3600 // NIGHT_TICKS_PER_HOUR}  # 30 and 120
DAY_HOURS = DUSK_HOUR - DAWN_HOUR
NIGHT_HOURS = 24 - DAY_HOURS
DAY_TICKS = DAY_HOURS * DAY_TICKS_PER_HOUR
NIGHT_TICKS = NIGHT_HOURS * NIGHT_TICKS_PER_HOUR
CYCLE_TICKS = DAY_TICKS + NIGHT_TICKS
MAX_RATE_TERM = 100
DEBT_RATE = (20, 1)  # the speed of the world while an act is being paid for: 200 ticks a second


class Now(NamedTuple):
    """Where the clock stands at one tick.

    ``phase_tick`` counts from the start of the phase and ``cycle_tick`` from 06:00 of the day,
    so ``cycle_tick`` is ``phase_tick`` by day and ``DAY_TICKS + phase_tick`` by night.
    """

    tick: int
    day: int
    hour: int
    minute: int
    phase: str
    phase_tick: int
    cycle_tick: int


def at(tick: int) -> Now:
    """The time at ``tick``: day 1 starts at tick 0, 06:00."""
    day_index, cycle = divmod(tick, CYCLE_TICKS)
    if cycle < DAY_TICKS:
        hour = DAWN_HOUR + cycle // DAY_TICKS_PER_HOUR
        minute = cycle % DAY_TICKS_PER_HOUR * 60 // DAY_TICKS_PER_HOUR
        return Now(tick, day_index + 1, hour, minute, DAY, cycle, cycle)
    night = cycle - DAY_TICKS
    hour = (DUSK_HOUR + night // NIGHT_TICKS_PER_HOUR) % 24
    minute = night % NIGHT_TICKS_PER_HOUR * 60 // NIGHT_TICKS_PER_HOUR
    return Now(tick, day_index + 1, hour, minute, NIGHT, night, cycle)


def hour_start(hour: int) -> int:
    """The tick of a game day (counted from 06:00) at which the clock reaches ``hour`` o'clock."""
    if DAWN_HOUR <= hour < DUSK_HOUR:
        return (hour - DAWN_HOUR) * DAY_TICKS_PER_HOUR
    return DAY_TICKS + (hour - DUSK_HOUR) % 24 * NIGHT_TICKS_PER_HOUR


def set_rate(world_state: dict[str, Any], num: int, den: int) -> None:
    """Set the speed of the clock: the host runs ``10 * num / den`` ticks a second."""
    for term in (num, den):
        if type(term) is not int or not 1 <= term <= MAX_RATE_TERM:
            raise ValueError(f"a rate is two ints in [1, {MAX_RATE_TERM}], got {num!r}/{den!r}")
    world_state["clock"]["rate"] = [num, den]


def owed(world_state: dict[str, Any]) -> int:
    """The game seconds that the world still owes for what the manager did, or 0."""
    return int(world_state["clock"].get("debt", 0))


def owe(world_state: dict[str, Any], seconds: int) -> None:
    """Add ``seconds`` of game time to what the world owes: it runs that long, at ``DEBT_RATE``."""
    if type(seconds) is not int or seconds < 1:
        raise ValueError(f"a debt is a whole number of seconds above 0, got {seconds!r}")
    section = world_state["clock"]
    section["debt"] = section.get("debt", 0) + seconds


def ticks_owed(world_state: dict[str, Any], now: Now) -> int:
    """About how many ticks it takes to pay the debt, at the pace of the phase of ``now``."""
    return -(-owed(world_state) // TICK_SECONDS[now.phase])


def after(world_state: dict[str, Any], tick: int, extra: int = 0) -> Now:
    """Where the clock stands once the world has paid what it owes and ``extra`` more game seconds,
    counting from the ``tick`` it runs next: the time at which an act is over, whatever it takes and
    whatever was owed before it. Each tick takes the length of its own phase off the debt, and the
    tick that pays the last of it is the last (``pay``)."""
    left, then = owed(world_state) + extra, tick
    while left > 0:
        left -= TICK_SECONDS[at(then).phase]
        then += 1
    return at(then)


def pay(world_state: dict[str, Any], phase: str) -> None:
    """A tick of ``phase`` goes by: its length comes off the debt, and the key goes with the last
    of it."""
    section = world_state["clock"]
    debt = section.get("debt", 0)
    if debt:
        if debt > TICK_SECONDS[phase]:
            section["debt"] = debt - TICK_SECONDS[phase]
        else:
            del section["debt"]


def rate(world_state: dict[str, Any]) -> tuple[int, int]:
    """The speed of the clock as ``(num, den)``: ``DEBT_RATE`` while the world owes time, else the
    stored rate."""
    if owed(world_state):
        return DEBT_RATE
    num, den = world_state["clock"]["rate"]
    return num, den


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    return {"rate": [1, 1]}


def tick(sim: Sim) -> None:
    now = sim.now
    if now.phase_tick == 0:
        sim.emit("dawn" if now.phase == DAY else "dusk", day=now.day)
    pay(sim.state, now.phase)
