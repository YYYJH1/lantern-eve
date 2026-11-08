"""The late liar: plays fair for four days, and on the last day says whatever will do.

Until the last day it asks and points at what people have told it, looks at what there is to be
looked at, and tells people only what it has been told. On the last day it asks the elder to call
the clan, tells the people it meets stories as if it had seen them, and shows the hall whatever it
holds. The town has no time left to find out.
"""

from __future__ import annotations

from bots.base import Steps
from bots.liar import Lies


class LateLiar(Lies):
    name = "late_liar"
    last_day = 5

    def lying(self) -> bool:
        return self.o.day >= self.last_day

    def prelude(self) -> Steps:
        yield from self.sweep_bridge()
        yield from self.boat()
        yield from self.gather()

    def last_day_push(self) -> Steps:
        """The elder, the clan, whatever evidence there is, and a table for the two families."""
        yield from self.await_day()
        yield from self.wait_until(self.last_day, 8)
        yield from self.convene_and_speak()

    def a_day(self, day: int) -> Steps:
        if day == self.last_day:
            yield from self.last_day_push()
        yield from super().a_day(day)
