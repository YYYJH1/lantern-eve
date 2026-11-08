"""The hubber: calls for helpers and wins over one well-connected person, and does nothing else.

It is the bot that shows what one persuaded hub does to the call. It promises Madam Zhou, who
knows more people than anyone, a little more each time until she joins for sure.
"""

from __future__ import annotations

from bots.base import Bot, Steps

HUB = "zhou_niangzi"


class Hubber(Bot):
    name = "hubber"

    def play(self) -> Steps:
        yield from self.act("rally")
        yield from self.wait_until(1, 7)
        if (yield from self.meet(HUB)):
            spent: set[str] = set()
            for _ in range(8):
                result, _ = yield from self.entrust("join")
                if HUB in self.joined or result == "rejected":
                    break
                if not (yield from self.sweeten(spent)):
                    break
            yield from self.leave()
        while True:
            yield None
