"""The weather of a day: clear, light rain or heavy rain, fixed from dawn to the next dawn.

The weather of every day of the game is drawn from the core RNG when the game is made, with the
weights of the config (``weather_clear``, ``weather_light``, ``weather_heavy``), so that it
depends on the seed and on nothing the people do later. A day past the planned ones draws its
weather at its dawn. Each dawn the day's weather is announced with a ``weather`` event.

State (``state["world"]["weather"]``)::

    {"kind": "clear" | "light_rain" | "heavy_rain", "day": the day it is for,
     "plan": [the weather of day 1, day 2, ...]}

Heavy rain sends people who would be out in the open under a roof (see ``npcs``). The other
effects of weather, on the turn-out of the festival and on the pace of work, belong to the
modules that own those numbers, which read ``kind`` from here.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge.clock import DAY

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "weather"

CLEAR, LIGHT_RAIN, HEAVY_RAIN = "clear", "light_rain", "heavy_rain"
KINDS = (CLEAR, LIGHT_RAIN, HEAVY_RAIN)
WEIGHT_KEYS = ("weather_clear", "weather_light", "weather_heavy")


def draw(world: BridgeWorld, rng: Pcg32) -> str:
    """One day's weather, from one draw of ``rng``."""
    return KINDS[rng.weighted([world.config[key] for key in WEIGHT_KEYS])]


def today(world_state: dict[str, Any]) -> str:
    """The weather of the day that is going on."""
    return world_state["weather"]["kind"]


def on_day(world_state: dict[str, Any], day: int) -> str:
    """The weather of ``day``, if it is planned. A frame shows the weather of the day of its time,
    which at the last tick of a night is the day that is about to dawn."""
    section = world_state["weather"]
    plan = section["plan"]
    return plan[day - 1] if 1 <= day <= len(plan) else section["kind"]


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    plan = [draw(world, rng) for _ in range(world.config["days"])]
    return {"kind": plan[0], "day": 1, "plan": plan}


def tick(sim: Sim) -> None:
    now = sim.now
    if now.phase != DAY or now.phase_tick != 0:
        return
    section = sim.state["weather"]
    if now.day > section["day"]:
        while len(section["plan"]) < now.day:
            section["plan"].append(draw(sim.world, sim.ctx.rng))
        section["kind"] = section["plan"][now.day - 1]
        section["day"] = now.day
    sim.emit("weather", day=now.day, weather=section["kind"])
