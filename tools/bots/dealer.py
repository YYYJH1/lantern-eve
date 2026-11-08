"""The dealer: skips the truth and trades what it may promise for materials and helpers.

It asks the keeper of the timber and the people who know many others, paying with promises when a
plain ask is refused, wins Granny Li's bamboo with the honour of lighting the main lantern, and
opens the lane behind the temple when the bridge is out of reach. It never looks into what broke
the rail and never shows anyone anything, so the best the town can have from it is a festival that
walks, with the quarrel still on.
"""

from __future__ import annotations

from bots.base import (
    CREW_TARGET,
    HELPER_ORDER,
    LI_DA,
    LI_HEAD,
    Bot,
    Steps,
)

# what is promised to Granny Li, biggest first: her trust has to reach forty-five
GRANNY_ORDER = ("role:t_honor_light", "stall:front", "role:", "wage:20", "slot:", "stall:back")


class Dealer(Bot):
    name = "dealer"

    def prelude(self) -> Steps:
        """What the manager does before the first ask: nothing, for the dealer."""
        return
        yield

    def play(self) -> Steps:
        yield from self.act("rally")
        yield from self.wait_until(1, 7)
        yield from self.prelude()
        yield from self.recruit(HELPER_ORDER[:2])
        yield from self.timber()
        yield from self.recruit(HELPER_ORDER[2:])
        yield from self.bamboo()
        for day in (2, 3, 4, 5):
            yield from self.a_day(day)
        while True:
            yield None

    def bamboo(self) -> Steps:
        """Granny Li lends her bamboo for the honour of lighting the main lantern and her trust, and
        Li Da is asked for it after her."""
        if not self.goods_wanted(LI_DA, "bamboo", "bamboo_delivered"):
            return
        if self.before(LI_HEAD, "lend") != "agreed":
            if not (yield from self.meet(LI_HEAD)):
                return
            spent: set[str] = set()
            for _ in range(9):
                result, _ = yield from self.ask_of(LI_HEAD, "lend", once=True)
                if result == "agreed" or not (yield from self.sweeten(spent, GRANNY_ORDER)):
                    break
            yield from self.leave()
        yield from self.bamboo_from_li_da()

    def a_day(self, day: int) -> Steps:
        yield from self.await_day()
        yield from self.wait_until(day, 8)
        yield from self.bamboo()
        yield from self.timber()
        if len(self.joined) < CREW_TARGET:
            yield from self.recruit(HELPER_ORDER)
        if day >= 3:
            yield from self.wait_until(day, 13)
            if "bamboo_delivered" not in self.flags or day >= 4:
                yield from self.detour_if_needed()
