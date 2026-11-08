"""The rallier: calls for helpers on the first morning, once, and then lets the town build."""

from __future__ import annotations

from bots.base import Bot, Steps


class Rallier(Bot):
    name = "rallier"

    def play(self) -> Steps:
        yield from self.wait_until(1, 7)
        yield from self.act("rally")
        while True:
            yield None
