"""The investigator: finds out what broke the rail, shows the town, and gets the bridge built.

It traces the clerk's story back to the people who told it and says in public at the teahouse on the
first evening that it goes beyond what the clerk saw (Granny Li lends the bamboo, and Li Da, who is
there, brings it). It collects the evidence that every version of the truth leaves behind as the
days open it (the footprint by the rail on the first two days, the debris under the bridge from the
third, the scratches on the boat, and what the child and the night watchman saw, from the third
evening and the fourth night), shows all of it in public in front of the elder on the fifth morning,
lays a table for the two families, and persuades the keepers of the materials and enough helpers to
build. It spends what it may promise only when a plain ask is refused. If the rain takes the bridge
away it opens the lane behind the temple instead."""

from __future__ import annotations

from typing import Any

from bots.base import (
    CHILD_WITNESS,
    ELDER,
    HEDGE_EXTRA,
    HEDGE_TARGET,
    HELPER_ORDER,
    LI_DA,
    LI_HEAD,
    TEAHOUSE,
    TEMPLE_KEEPER,
    WATCHMAN,
    Bot,
    Steps,
)

RUMOUR = "Li Er broke"  # how the versions of the rumour begin, in the words of the frame
SIGHT = "Li Er was at the bridge"  # and what the clerk saw himself


class Investigator(Bot):
    name = "investigator"

    # ------------------------------------------------------------------ the whole game

    def play(self) -> Steps:
        yield from self.act("rally")
        yield from self.wait_until(1, 7)
        yield from self.goto_reach("p_bridge")  # the footprint is there on the first two days
        yield from self.look("t_rail")
        yield from self.wait_until(1, 8, 5)  # the boat is open to look at from eight
        yield from self.boat()
        yield from self.recruit(HELPER_ORDER[:2], HEDGE_TARGET)
        yield from self.timber()
        yield from self.recruit((*HELPER_ORDER[2:], *HEDGE_EXTRA), HEDGE_TARGET)
        yield from self.wait_until(1, 12)
        yield from self.trace_rumour()
        yield from self.clear_the_rumour()
        yield from self.bamboo()
        for day in (2, 3, 4, 5):
            yield from self.a_day(day)
        while True:
            yield None

    # ------------------------------------------------------------------ the rumour, in public

    def entry_with(self, words: str) -> dict[str, Any] | None:
        found = [e for e in self.o.notebook if words in e["text"]["en"]]
        return found[-1] if found else None

    def clear_the_rumour(self) -> Steps:
        """The clerk is asked what he saw himself, and at the teahouse after six the manager says
        that the version of the rumour goes beyond it: Granny Li, who is there, lends the bamboo
        then. Only when the manager holds the version to be cleared (the opening of the slice gives
        it)."""
        if self.entry_with(SIGHT) is None and (yield from self.meet("zhou_huoji", timeout=300)):
            for _ in range(3):
                yield from self.act("ask", topic="li_er")
            yield from self.leave()
        claim, basis = self.entry_with(RUMOUR), self.entry_with(SIGHT)
        if claim is None or basis is None:
            return
        yield from self.wait_until(self.o.day, 17, 40)
        yield from self.goto(TEAHOUSE)
        yield from self.wait_until(self.o.day, 18, 0)
        yield from self.act("speak", kind="clarify", claim=claim["id"], basis=[basis["id"]])

    # ------------------------------------------------------------------ evidence

    def testimony(self, npc: str, day: int, hour: int, minute: int) -> Steps:
        """Ask a person to tell what they saw, at the hour they can."""
        yield from self.wait_until(day, hour, minute)
        if not (yield from self.meet(npc)):
            return False
        result, _ = yield from self.persuade("testify")
        yield from self.leave()
        return result == "agreed"

    def more_evidence(self) -> Steps:
        """What is left to ask for when the first set did not tell the truth apart."""
        if self.o.phase != "day" or self.o.hour >= 17:
            return
        if (yield from self.meet(TEMPLE_KEEPER)):
            yield from self.persuade("testify")
            yield from self.leave()

    def win_the_elder(self) -> Steps:
        """After a full statement the elder would not take, win some of his regard: meet him and
        promise him the cheapest thing the manager holds, and keep the promise."""
        if not self.stated or self.stated[-1]["told"] or self.stated[-1]["elder"] != 1:
            return
        if (yield from self.meet(ELDER)):
            yield from self.sweeten(set())
            yield from self.leave()

    # ------------------------------------------------------------------ people

    def bamboo(self) -> Steps:
        """Granny Li's nod, and then Li Da, who brings the bamboo once he has been asked."""
        if not self.goods_wanted(LI_DA, "bamboo", "bamboo_delivered"):
            return
        if self.before(LI_HEAD, "lend") != "agreed" and (yield from self.meet(LI_HEAD)):
            yield from self.ask_of(LI_HEAD, "lend")
            yield from self.leave()
        yield from self.bamboo_from_li_da()

    # ------------------------------------------------------------------ the rumour

    def trace_rumour(self) -> Steps:
        """Ask the two who hear the most (and the clerk's neighbour, who hears it first) what they
        know of Li Er, and follow who told whom, as far as each one says who told them, until
        someone says they saw it."""
        for hub in ("cha_laoban", "sishu_xiansheng", "zhou_niangzi"):
            if not (yield from self.meet(hub, timeout=300)):
                continue
            yield from self.act("ask", topic="li_er")
            entry = self.traceable()
            yield from self.leave()
            hops = 0
            while entry is not None and hops < 4:
                if not (yield from self.meet(entry["chain"][-2]["id"], timeout=300)):
                    break
                yield from self.act("ask_source", entry=entry["id"])
                yield from self.leave()
                hops += 1
                entry = next((e for e in self.o.notebook if e["id"] == entry["id"]), None)
                if entry is not None and not (entry["chain"] and entry["chain"][-1] is None):
                    entry = None
            if hops:
                return

    def traceable(self) -> dict[str, Any] | None:
        found = [e for e in self.o.notebook if e["chain"] and e["chain"][-1] is None]
        return found[-1] if found else None

    # ------------------------------------------------------------------ the days that follow

    def a_day(self, day: int) -> Steps:
        yield from self.await_day()
        yield from self.wait_until(day, 8)
        unfinished = "truth_told" not in self.flags or "reconciled" not in self.flags
        if unfinished and day == 5 and self.now_before(5, 13):
            yield from self.win_the_elder()
            shown = yield from self.convene_and_speak()
            if not shown and "truth_told" not in self.flags:
                yield from self.more_evidence()
        yield from self.bamboo()
        if "timber_delivered" not in self.flags:
            yield from self.timber()
        if len(self.joined) < HEDGE_TARGET:
            yield from self.recruit((*HELPER_ORDER, *HEDGE_EXTRA), HEDGE_TARGET)
        if day == 3:  # the water has fallen: the debris on the pier shows
            yield from self.goto_reach("p_under_bridge")
            yield from self.look("p_under_bridge")
        if day >= 4:
            yield from self.wait_until(day, 13)
            yield from self.detour_if_needed()
        # what the child and the watchman saw, when they will say it
        if day == 3:
            yield from self.testimony(CHILD_WITNESS, 3, 17, 30)
        elif day == 4:
            yield from self.testimony(WATCHMAN, 4, 19, 5)
        if day == 5:
            yield from self.evening_speech()
