"""The scenarios a kernel can run, by name."""

from __future__ import annotations

from typing import Any

from lantern_core.world.bridge import BridgeWorld
from lantern_core.world.m0 import M0World

SCENARIOS = {"m0": M0World, "bridge": BridgeWorld}


def create_world(scenario: str, config: dict[str, Any] | None = None) -> M0World | BridgeWorld:
    """The scenario named ``scenario`` with ``config`` laid over its defaults."""
    try:
        cls = SCENARIOS[scenario]
    except (KeyError, TypeError):
        raise ValueError(f"unknown scenario {scenario!r}") from None
    return cls(config)
