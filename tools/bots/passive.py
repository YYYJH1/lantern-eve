"""The passive manager: does nothing, so the town takes its own course."""

from __future__ import annotations

from bots.base import Bot, Steps


class Passive(Bot):
    name = "passive"

    def play(self) -> Steps:
        while True:
            yield None
