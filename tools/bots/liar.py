"""The liar: the manager who gets by on what it says, whether or not it is so.

It has no promises to make. Before it asks anyone for anything it tells them something it did not
see as if it had: a story it only heard, told as seen, or a thing made up about who broke the
rail. It then points at the story when it asks. On the second morning it tells the people the
elder usually calls to the hall what the evidence it holds points at, asks the elder to call the
clan and shows what it holds. A lie costs it when the person already knows better and says so.
"""

from __future__ import annotations

from typing import Any

from bots.base import Steps
from bots.dealer import Dealer

# who the elder calls to the hall
REGULARS = (
    "cha_laoban",
    "sishu_xiansheng",
    "mujiang",
    "old_he",
    "zhangfang",
    "miaozhu",
    "li_laotai",
    "zhou_zhanggui",
)

# the things the bot makes up, all about who damaged the stone rail (the core takes any fact of its
# table of predicates as a made-up telling)
RAIL = "t_rail"
MADE_UP = [
    {
        "id": f"fab:damaged:{who}",
        "body": {"how": "fabricate", "pred": "damaged", "subject": who, "object": RAIL},
    }
    for who in ("li_er", "zhou_dalang", "old_he", "fam_li", "fam_zhou")
] + [{"id": "fab:flood", "body": {"how": "fabricate", "pred": "flood_damaged", "subject": RAIL}}]
# a lie to make up, by the words of the evidence that points at it
POINTS_AT = (
    ("flood", "fab:flood"),
    ("Dalang", "fab:damaged:zhou_dalang"),
    ("scratch", "fab:damaged:old_he"),
    ("boat", "fab:damaged:old_he"),
)


class Lies(Dealer):
    """A manager that can tell a lie. ``lying`` says when it does, and it has no promises to make
    in either case, so that a game with lies and a game without them differ in nothing else."""

    budget = 0

    def __init__(self, scene: dict[str, Any], seed: int = 0) -> None:
        super().__init__(scene, seed)
        self.told_to: dict[str, set[str]] = {}

    def lying(self) -> bool:
        return True

    def extra_cites(self, npc: str) -> Steps:
        """Tell the person a lie, and point at it when asking."""
        if not self.lying():
            return []
        told = yield from self.lie_to(npc)
        return [told] if told else []

    def lie_to(self, npc: str, made_up: bool = False) -> Steps:
        """Tell the person in the conversation a lie. The entry it is about, if it is an entry."""
        told = self.told_to.setdefault(npc, set())
        offers = self.o.offers("tell")
        for offer in reversed(offers):  # the newest story first
            if made_up:
                break
            if offer["id"].endswith(":as_seen") and offer["id"] not in told:
                told.add(offer["id"])
                result, _ = yield from self.act("tell", **offer["body"])
                return offer["body"]["entry"] if result == "applied" else None
        made_up = [o for o in MADE_UP if o["id"] not in told]
        if made_up:
            pick = self.best_lie(made_up)
            told.add(pick["id"])
            yield from self.act("tell", **pick["body"])
        return None

    def best_lie(self, offers: list[dict[str, Any]]) -> dict[str, Any]:
        """The made-up thing that the evidence in the notebook points at, else any."""
        seen = " ".join(e["text"]["en"] for e in self.o.notebook if e["source"]["kind"] == "seen")
        for word, offer_id in POINTS_AT:
            for offer in offers:
                if word in seen and offer["id"] == offer_id:
                    return offer
        return offers[(self.seed + len(self.told_to)) % len(offers)]

    def before_convene(self) -> Steps:
        """Tell those who are likely to be at the hall what the evidence in hand points at, as if
        seen, so that they take it for the truth when the clan is called."""
        if not self.lying():
            return
        for npc in REGULARS:
            if self.o.hour >= 15:
                return
            if (yield from self.meet(npc, timeout=300)):
                yield from self.lie_to(npc, made_up=True)
                yield from self.leave()

    def gather(self) -> Steps:
        """Ask the keeper of the teahouse what she knows, so that there are stories to tell."""
        if not (yield from self.meet("cha_laoban")):
            return
        for topic in ("li_er", "t_rail", "old_he"):
            yield from self.act("ask", topic=topic)
        yield from self.leave()


class Liar(Lies):
    name = "liar"

    def prelude(self) -> Steps:
        yield from self.sweep_bridge()
        yield from self.boat()
        yield from self.gather()

    def a_day(self, day: int) -> Steps:
        if day == 2:
            yield from self.await_day()
            yield from self.wait_until(2, 8)
            yield from self.convene_and_speak()
        yield from super().a_day(day)
