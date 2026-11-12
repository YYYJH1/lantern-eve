"""``BridgeWorld``: the scenario ``bridge`` as the kernel's ``World``. See the package docstring."""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any

from lantern_core import canon
from lantern_core.inputs import InputError
from lantern_core.world.bridge import (
    agenda,
    budget,
    clock,
    commitments,
    context,
    gazette,
    gifts,
    goals,
    hearts,
    moments,
    order,
    preview,
    roster,
    unavailable,
    weather,
)
from lantern_core.world.bridge.data import CAST, SCRIPT, TABLES, TOWN
from lantern_core.world.bridge.people import Cast
from lantern_core.world.bridge.prompt_data import PROMPTS
from lantern_core.world.bridge.sentences import SENTENCES
from lantern_core.world.bridge.sim import Sim
from lantern_core.world.bridge.speech_data import SPEECH
from lantern_core.world.bridge.town import Town

if TYPE_CHECKING:
    from lantern_core.kernel import Ctx
    from lantern_core.rng import Pcg32
    from lantern_core.world.grid import Grid

DEFAULT_CONFIG: dict[str, int] = {
    "days": 5,
    "move_day": 2,
    "move_night": 1,
    "fidget_per_mille": 40,
    "weather_clear": 50,
    "weather_light": 30,
    "weather_heavy": 20,
    "dev_actions": 0,
    "reflect": 1,
    "budget_cap": 3_000_000,
    "price_cheap_in": 150_000,
    "price_cheap_out": 1_500_000,
    "price_strong_in": 800_000,
    "price_strong_out": 8_000_000,
}
_CONFIG_RANGES = {
    "days": (1, 30),
    "move_day": (1, 20),
    "move_night": (1, 20),
    "fidget_per_mille": (0, 1000),
    "weather_clear": (0, 1000),
    "weather_light": (0, 1000),
    "weather_heavy": (0, 1000),
    "dev_actions": (0, 1),
    "reflect": (0, 1),
    "budget_cap": (0, 10**10),
    "price_cheap_in": (0, 10**9),
    "price_cheap_out": (0, 10**9),
    "price_strong_in": (0, 10**9),
    "price_strong_out": (0, 10**9),
}
# Keys that a game has only if it was given them, each one of a closed list of ids of the script:
# ``variant`` forces the variant of the script that is true (the seed draws it otherwise), and
# ``opening`` starts the game from an opening of the script, the hearsay that is going round when
# the clock starts (see ``opening``). ``goods`` is how the goods a person agrees to bring come:
# ``at_once`` (carried at once, which a game with no key has) or ``promised`` for a time (see
# ``commitments``). A game without them has none of these keys.
CHOICE_CONFIG: dict[str, tuple[str, ...]] = {
    "variant": tuple(v["id"] for v in SCRIPT["variants"]),
    "opening": tuple(o["id"] for o in SCRIPT["openings"]),
    "goods": commitments.GOODS,
}

# Named games: a seed and the config that goes with it. ``slice`` is the game the opening page
# starts, five days long: the seed whose town the script is written for, the boatman as the truth,
# and no heavy rain (the bamboo is carried on the second morning), and the goods that a person
# agrees to bring promised for a time.
PRESETS: dict[str, dict[str, Any]] = {
    "slice": {
        "seed": 492,
        "config": {
            "variant": "v_boat",
            "opening": "op_li_er_hearsay",
            "weather_heavy": 0,
            "goods": "promised",
        },
    },
}
FRAME_KEYS = ("npcs", "time", "weather", "bubbles", "dots", "lanterns", "hud")


def preset(
    name: str, seed: int | None = None, variant: str | None = None
) -> tuple[int, dict[str, Any]]:
    """The seed and the config of the named game (see ``PRESETS``), the config as a copy.

    The rules of the preset can be played at another seed (``seed``) and with another story true
    (``variant``, one of the ids of the variants of the script): the game is the preset's, with
    the town and the weather its seed makes and the truth the variant says. A game without either
    is the first game of the name.
    """
    try:
        found = PRESETS[name]
    except (KeyError, TypeError):
        raise ValueError(f"unknown bridge preset {name!r}") from None
    config = dict(found["config"])
    if seed is not None and (type(seed) is not int or not 0 <= seed <= canon.JS_SAFE_INT):
        raise ValueError(f"bridge preset seed must be an int in [0, 2**53 - 1], got {seed!r}")
    if variant is not None:
        if variant not in CHOICE_CONFIG["variant"]:
            raise ValueError(
                f"bridge preset variant must be one of {list(CHOICE_CONFIG['variant'])}, "
                f"got {variant!r}"
            )
        config["variant"] = variant
    return (found["seed"] if seed is None else seed), config


@functools.cache
def static() -> tuple[Town, Cast]:
    """The town and the cast, built once per process and shared by every game."""
    town, cast = Town(TOWN), Cast(CAST)
    assert tuple(w["id"] for w in TOWN["weather"]) == weather.KINDS
    assert tuple(p["id"] for p in TOWN["phases"]) == (clock.DAY, clock.NIGHT)
    for person in cast.people:
        assert person.home in town.places and person.work in town.places
    return town, cast


class BridgeWorld:
    """The scenario for a given config (see ``DEFAULT_CONFIG``)."""

    name = "bridge"
    ticks_per_hour = clock.DAY_TICKS_PER_HOUR

    def __init__(self, config: dict[str, Any] | None = None) -> None:
        merged: dict[str, Any] = dict(DEFAULT_CONFIG)
        for key, value in (config or {}).items():
            if key not in DEFAULT_CONFIG and key not in CHOICE_CONFIG:
                raise ValueError(f"unknown bridge config key {key!r}")
            merged[key] = value
        for key, (low, high) in _CONFIG_RANGES.items():
            if type(merged[key]) is not int or not low <= merged[key] <= high:
                raise ValueError(f"bridge config {key} must be an int in [{low}, {high}]")
        for key, choices in CHOICE_CONFIG.items():
            if key in merged and merged[key] not in choices:
                raise ValueError(f"bridge config {key} must be one of {list(choices)}")
        if not any(merged[key] for key in weather.WEIGHT_KEYS):
            raise ValueError("bridge config: the weather weights cannot all be zero")
        self.config = merged
        self.move_day, self.move_night = merged["move_day"], merged["move_night"]
        self.town, self.cast = static()
        self.subsystems = order.SUBSYSTEMS
        self._content_hash: str | None = None
        self._prepare()

    def _prepare(self) -> None:
        """Collect what the subsystems offer: their actions, conditions, results and hooks."""
        sections = [m.SECTION for m in self.subsystems]
        if len(set(sections)) != len(sections) or not set(sections) <= set(order.SECTIONS):
            raise ValueError(f"subsystem sections {sections} are not distinct state sections")
        self.actions: dict[str, Any] = {}
        self.conditions: dict[str, Any] = {}
        self.results: dict[str, Any] = {}
        for module in self.subsystems:
            for table, name in (
                (self.actions, "ACTIONS"),
                (self.conditions, "CONDITIONS"),
                (self.results, "RESULTS"),
            ):
                for key, handler in getattr(module, name, {}).items():
                    if key in table:
                        raise ValueError(f"{name} {key!r} is offered twice")
                    table[key] = handler
        self._scene_hooks = tuple(m.scene for m in self.subsystems if hasattr(m, "scene"))
        self._frame_hooks = tuple(m.frame for m in self.subsystems if hasattr(m, "frame"))

    # ------------------------------------------------------------------ static content

    def content(self) -> dict[str, Any]:
        """Everything about the scenario that does not depend on the config or the seed.

        It includes what the prompts of a model are made from (``prompts``: the templates and the
        note on how each person speaks, ``sentences`` and ``speech``: the statements and the closed
        lists they quote), since a request is part of the state and so is what it says.
        """
        return {
            "scenario": self.name,
            "town": self.town.data,
            "cast": self.cast.data,
            "cognition": {"tables": TABLES, "script": SCRIPT},
            "prompts": PROMPTS,
            "sentences": SENTENCES,
            "speech": SPEECH,
            "clock": [
                clock.DAWN_HOUR,
                clock.DUSK_HOUR,
                clock.DAY_TICKS_PER_HOUR,
                clock.NIGHT_TICKS_PER_HOUR,
            ],
        }

    def content_hash(self) -> str:
        if self._content_hash is None:
            self._content_hash = canon.digest(self.content())
        return self._content_hash

    def scene(self) -> dict[str, Any]:
        """What a client needs to draw the town once: the map layers, the places, the cast."""
        town, cast = self.town.data, self.cast.data
        buildings = [
            {"place": p["id"], "kind": p["kind"], "rect": list(fp)}
            for p in town["places"]
            for fp in p["footprints"]
        ]
        scene: dict[str, Any] = {
            "scenario": self.name,
            "name": {"zh": town["zh"], "en": town["en"]},
            "width": town["width"],
            "height": town["height"],
            "layers": {
                "terrain": {"rows": list(town["rows"]), "legend": list(town["legend"])},
                "buildings": buildings,
                "barriers": list(town["barriers"]),
            },
            "places": [
                {key: p[key] for key in ("id", "zh", "en", "kind", "indoor", "rect", "door")}
                | {"stands": list(p["stands"]), "cells": list(p["cells"])}
                for p in town["places"]
            ],
            "families": list(cast["families"]),
            "gifts": [{key: g[key] for key in ("id", "zh", "en")} for g in gifts.things()],
            "cast": [
                {
                    key: p[key]
                    for key in (
                        "id",
                        "zh",
                        "en",
                        "role",
                        "bio",
                        "intro",
                        "token",
                        "family",
                        "home",
                        "work",
                    )
                }
                for p in cast["people"]
            ],
            "items": list(cast["items"]),
            "activities": list(cast["activities"]),
            "weather": list(town["weather"]),
            "phases": list(town["phases"]),
            "time": {
                "days": self.config["days"],
                "dawn_hour": clock.DAWN_HOUR,
                "dusk_hour": clock.DUSK_HOUR,
                "day_ticks_per_hour": clock.DAY_TICKS_PER_HOUR,
                "night_ticks_per_hour": clock.NIGHT_TICKS_PER_HOUR,
                "day_ticks": clock.DAY_TICKS,
                "night_ticks": clock.NIGHT_TICKS,
                "cycle_ticks": clock.CYCLE_TICKS,
            },
        }
        for hook in self._scene_hooks:
            for key, value in hook(self).items():
                if key in scene:
                    raise ValueError(f"scene key {key!r} is offered twice")
                scene[key] = value
        return scene

    # ------------------------------------------------------------------ state and inputs

    def new_state(self, rng: Pcg32) -> dict[str, Any]:
        state: dict[str, Any] = {name: {} for name in order.SECTIONS}
        for module in self.subsystems:
            state[module.SECTION] = module.init(self, rng)
        for module in self.subsystems:
            if hasattr(module, "start"):
                module.start(self, state)
        return state

    def validate_player(self, body: dict[str, Any]) -> dict[str, Any]:
        kind = body.get("type")
        handler = self.actions.get(kind) if isinstance(kind, str) else None
        if handler is None:
            raise InputError(f"player action: unknown type {kind!r}")
        return handler[0](self, body)

    def apply_player(self, ctx: Ctx, body: dict[str, Any]) -> None:
        sim = Sim(self, ctx)
        if not preview.reject_if_stale(sim, body):
            seen = len(ctx.events)
            self.actions[body["type"]][1](sim, body)
            hearts.sync(sim)  # a call may take an action and simulate nothing (a paused world)
            moments.after_action(sim, ctx.events[seen:])  # a moment may come of what was done
        agenda.refresh(sim)  # a call may take an action and simulate nothing (a paused world)

    def preview(self, state: dict[str, Any], action: Any) -> dict[str, Any]:
        """What an action would ask, give and cost, and what stands in its way (``preview``)."""
        return preview.preview(self, state, action)

    # ------------------------------------------------------------------ one tick

    def walking_grid(self, state: dict[str, Any]) -> Grid:
        """The grid that people walk on now. It is the closed town until the lane behind the temple
        is opened, which the section ``goals`` says (``goals.walking_grid``). The state is the
        world state, ``state["world"]``.
        """
        return goals.walking_grid(self, state)

    def simulate(self, ctx: Ctx) -> None:
        sim = Sim(self, ctx)
        for module in self.subsystems:
            module.tick(sim)

    def holds(self, state: dict[str, Any], condition: dict[str, Any]) -> bool:
        check = self.conditions.get(condition["op"])
        if check is None:
            raise ValueError(f"unknown condition {condition['op']!r}")
        return bool(check(self, state, condition))

    def on_result(self, ctx: Ctx, request: dict[str, Any], status: str, text: str) -> None:
        land = self.results.get(request["category"])
        if land is not None:
            sim = Sim(self, ctx)
            seen = len(ctx.events)
            land(sim, request, status, text)
            moments.after_action(sim, ctx.events[seen:])  # words that land may be an echo
            agenda.refresh(sim)

    # ------------------------------------------------------------------ the budget gate

    def admit(self, ctx: Ctx, request: dict[str, Any]) -> str | None:
        """The kernel's gate for a request that is about to go out (see ``budget``)."""
        return budget.admit(self, ctx, request)

    def settle(self, ctx: Ctx, request: dict[str, Any], usage: dict[str, int] | None) -> None:
        """Charge a settled request to the budget (see ``budget``)."""
        budget.settle(self, ctx, request, usage)

    def on_host(self, ctx: Ctx, body: dict[str, Any]) -> None:
        """Take in a ``host`` input: the cloud or the local model going away or coming back."""
        budget.on_host(self, ctx, body)

    # ------------------------------------------------------------------ outputs

    def rate(self, state: dict[str, Any]) -> tuple[int, int]:
        return clock.rate(state["world"])

    def halted(self, state: dict[str, Any]) -> bool:
        """Whether the world holds its own clock: a moment of the festival is held for the page
        (see ``moments``), or the manager is in a conversation and the world owes no time for what
        they did (see ``pace``). The kernel does not simulate a held world, and the host sees
        ``clock.paused`` as true, on top of any pause of its own."""
        world_state = state["world"]
        if moments.holding(world_state):
            return True
        return bool(world_state["player"]["talk"]) and not clock.owed(world_state)

    def ending(self, state: dict[str, Any]) -> dict[str, Any] | None:
        """The whole ending of the game, reveal included, or ``None`` before the last night."""
        return goals.ending(state["world"])

    def frame(self, state: dict[str, Any]) -> dict[str, Any]:
        now = clock.at(state["tick"])
        out: dict[str, Any] = {
            "npcs": [],
            "time": {"day": now.day, "hour": now.hour, "minute": now.minute, "phase": now.phase},
            "weather": weather.on_day(state["world"], now.day),
            "bubbles": [],
            "dots": [],
            "lanterns": [],
            "hud": {},
        }
        for hook in self._frame_hooks:
            hook(self, state, out)
        gazette.frame(self, state, out)  # the paper reads the keys the hooks made
        self.finish_frame(state, out)
        return out

    def finish_frame(self, state: dict[str, Any], out: dict[str, Any]) -> None:
        """The keys that read the others: what the talk puts first (``context``), the people
        (``roster``) and why an act is off (``unavailable``)."""
        world_state, tick = state["world"], state["tick"]
        context.talk_fields(self, out, world_state, tick)
        out["people"] = roster.wire(self, world_state)
        out["hud"]["verbs_off"] = unavailable.verbs_off(
            self, world_state, tick, out["hud"]["verbs"], out["player"]["look"]
        )
