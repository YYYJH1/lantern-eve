"""Helpers for the tests of the board and of the tasks of the truth and the peace.

``TruthRoute`` plays the slice the way the task card sends a manager, day by day: the first day to
the clarification and Li Da, then the steps of the lead as the days open them (the rail and the boat
on the second afternoon, the water under the bridge and the boy by the river on the third, the night
watchman on the fourth night), the five helpers of both families at work at the bridge on the third
and the fourth morning, the card of the statement filled in as the notes favour it
(``fill_the_card``), and the full statement in public and the table for the two heads on the fifth
evening. ``HallRoute`` is the same to the fifth morning, where the elder is asked to call the clan,
and the statement and the table are at the hall. Whichever story is true the moves are the same. The
route marks the steps with a label, and at each label keeps what the frame says (the tasks that are
on and the board) and the evidence in hand, and on request a snapshot of the game, so that a test
can look at the same moment in each story, or change what is hidden at that moment and look again.
"""

from __future__ import annotations

import json
from typing import Any

import slice_driver

from bots.base import ELDER, HALL, Obs
from lantern_core.api import Game, preset
from lantern_core.world.bridge import assembly, clock
from lantern_core.world.bridge.lore import lore

VARIANTS = ("v_boat", "v_flood", "v_drunk")
# the evidence that bears on how the rail broke (all but the two testimonies about Li Er's lantern)
CAUSE_ITEMS = (
    "e_boat_scratches",
    "e_xiaoman_testimony",
    "e_repair_record",
    "e_flood_debris",
    "e_gengfu_flood",
    "e_gengfu_boat",
    "e_he_lamp",
    "e_dalang_home",
    "e_gengfu_dalang",
    "e_footprint",
)
LIVE = ("open", "blocked")
TASKS = ("t_how_broke", "t_tell_town", "t_make_peace", "t_festival_night")
CALL = "t_call_clan"
LO = lore()


def card(task: dict[str, Any]) -> dict[str, Any]:
    """What a task says to the player, in the words of the frame: the part a test compares."""
    return {
        "id": task["id"],
        "state": task["state"],
        "next": task["next"],
        "why": task["why"],
        "action": task["action"],
        "window": task["window"],
    }


CREW = (
    "li_da",
    "li_er",
    "zhou_erlang",
    "zhou_huoji",
    "zhou_niangzi",
)  # five helpers, both families


class TruthRoute(slice_driver.Evening):
    """The slice to the fifth evening, the lead and the statement and the table. See the module."""

    name = "truth-route"
    crew: tuple[str, ...] = (
        CREW  # who is made to agree to help (the call for helpers is not under test)
    )

    def __init__(self, scene: dict[str, Any], seed: int = 0, snapshots: bool = False) -> None:
        super().__init__(scene, seed)
        self.stay = self.held = self.speech = -1
        self.marks: dict[str, dict[str, Any]] = {}
        self.order: list[str] = []
        self.want_snapshot: list[str] = []
        self.snapshots = snapshots
        self.finished = False

    def mark(self, label: str) -> None:
        """Keep what the frame says now, under ``label``."""
        o = self.o
        self.order.append(label)
        self.marks[label] = {
            "tick": o.tick,
            "tasks": [card(t) for t in o.frame["tasks"]],
            "board": o.frame["board"],
            "tracked": o.frame["tracked"],
            "evidence": sorted(self.evidence),
        }
        if self.snapshots:
            self.want_snapshot.append(label)

    def play(self):
        yield from self.steps()
        yield from self.wait_until(5, 17, 38)
        yield from self.goto("p_teahouse")
        yield from self.wait_until(5, 17, 50)  # the named people are there from half past five
        self.mark("teahouse")
        yield from self.fill_the_card()
        self.mark("filled")
        yield from self.act("speak", kind="statement")
        self.mark("told")
        yield from self.act("speak", kind="meal")
        self.mark("fed")
        self.finished = True
        while True:
            yield None

    def morning(self, day: int):
        """The helpers work the morning at the bridge (the game orders them, once five have agreed
        with one of each family), and the manager lets it go by."""
        yield from self.wait_until(day, 11, 0)

    def look_at(self, label: str, target: str, place: str):
        yield from self.goto_reach(place)
        yield from self.look(target)
        self.mark(label)

    def ask(self, label: str, who: str, hour: int, minute: int = 0, day: int = 0):
        """The boy or the watchman is asked what they saw, at this hour of this day."""
        yield from self.wait_until(day, hour, minute)
        if (yield from self.meet(who)):
            yield from self.entrust("testify")
            yield from self.leave()
        self.mark(label)

    def steps(self):
        """The first day to the clarification and Li Da, then the days of the lead, to the fifth
        morning."""
        yield from slice_driver.Evening.play(self)
        yield from self.act("speak", kind="clarify", claim="n1", basis=["n2"])
        if (yield from self.meet("li_da")):
            yield from self.entrust("material")
            yield from self.leave()
        self.mark("clarified")
        for who in self.crew:  # five agree, both families, unless the route is made alone
            yield from self.act("dev_goal", op="join", npc=who)
        yield from self.wait_until(2, 7, 30)
        self.mark("morning2")  # the lead is not there yet
        yield from self.wait_until(2, 12, 30)
        self.mark("noon2")
        yield from self.look_at("rail", "t_rail", "p_bridge")
        yield from self.look_at("boat", "t_he_boat", "p_ferry")
        yield from self.wait_until(2, 20, 0)
        self.mark("night2")
        yield from self.await_day()
        yield from self.wait_until(3, 6, 30)
        self.mark("morning3")  # the peace is there
        yield from self.morning(3)
        self.mark("work3")
        yield from self.look_at("water", "p_under_bridge", "p_under_bridge")
        yield from self.ask("river", "xiao_man", 17, 30, day=3)
        yield from self.wait_until(3, 20, 30)
        self.mark("night3")
        yield from self.await_day()
        yield from self.wait_until(4, 6, 30)
        self.mark("morning4")  # the call of the clan is there
        yield from self.morning(4)
        self.mark("work4")
        yield from self.ask("watch", "gengfu", 19, 5, day=4)
        yield from self.await_day()
        yield from self.wait_until(5, 6, 30)
        self.mark("morning5")


class AloneRoute(TruthRoute):
    """The same days with nobody joined to help: the town is not behind the manager, so what is
    asked of a stranger who has nothing to show for it is refused."""

    name = "alone-route"
    crew = ()


class HallRoute(TruthRoute):
    """The same days, and then the fifth morning: the elder is asked to call the clan, and the
    statement and the table are at the hall."""

    name = "hall-route"

    def play(self):
        yield from self.steps()
        if (yield from self.meet(ELDER)):
            yield from self.entrust("convene")
            yield from self.leave()
        self.mark("called")
        opens = assembly.opens_at(clock.at(self.convened_at))
        while self.o.tick < opens + 2:  # the clan comes to the hall, and the hall opens on the hour
            yield None
        yield from self.goto(HALL)
        for _ in range(600):  # the clan is there, the elder among them
            if ELDER in self.people_at(HALL) and len(self.people_at(HALL)) >= 6:
                break
            yield None
        self.mark("hall")
        yield from self.fill_the_card()
        self.mark("filled")
        yield from self.act("speak", kind="statement")
        self.mark("told")
        yield from self.act("speak", kind="meal")
        self.mark("fed")
        self.finished = True
        while True:
            yield None


def trusted(game: Game, *people: str, value: int = 40) -> None:
    """Set up the case: these people trust the manager as far as ``value``."""
    section = game._kernel.state["world"]["player"]
    for who in people:
        section["trust"][LO.index[who]] = value


def play_route(
    variant: str,
    *,
    snapshots: bool = False,
    trust: int | None = 40,
    trusting: tuple[str, ...] = ("gengfu", "old_he", "xiao_man"),
    until: int | None = None,
    route: type[TruthRoute] = TruthRoute,
) -> tuple[Game, TruthRoute, dict[str, str]]:
    """Play the route in the story ``variant`` from the opening of the slice.

    The people ``trusting`` (the ones the lead sends the manager to, by default) trust the manager
    as far as ``trust`` (nobody does if it is None), which stands for the persuasion that is not
    under test. Returns the game, the route with its marks, and the snapshots of the game by label.
    The route ends where it ends, or at tick ``until``.
    """
    started = preset("slice")
    config = {**started["config"], "variant": variant, "dev_actions": 1}
    game = Game(started["seed"], started["scenario"], config)
    if trust is not None:
        trusted(game, *trusting, value=trust)
    bot = route(json.loads(game.scene_json()), started["seed"], snapshots=snapshots)
    obs = Obs(json.loads(game.step("[]")))
    kept: dict[str, str] = {}
    limit = until if until is not None else 5 * 2070
    while game.tick < limit and not bot.finished:
        action = bot.decide(obs)
        while bot.want_snapshot:  # the moment of a mark, before the next act
            kept[bot.want_snapshot.pop()] = game.snapshot_json()
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(game.step(json.dumps(records))))
    return game, bot, kept


def hidden_changes() -> dict[str, Any]:
    """Ways to change what the game knows and the manager does not, as functions of the world state:
    the variant that is true, what each person believes, how they stand toward each other, how far
    each trusts the manager (the manager is not told that) and the street."""

    def another(step):
        def go(s):
            now = s["social"]["variant"]
            s["social"]["variant"] = VARIANTS[(VARIANTS.index(now) + step) % len(VARIANTS)]

        return go

    def forget(person):
        return lambda s: s["social"]["beliefs"][person].clear()

    def swap(a, b):
        def go(s):
            beliefs = s["social"]["beliefs"]
            beliefs[a], beliefs[b] = beliefs[b], beliefs[a]

        return go

    def trust(s):
        s["player"]["trust"] = [90 - n for n in range(len(s["player"]["trust"]))]

    def bonds(s):
        for person in s["social"]["bonds"]:
            s["social"]["bonds"][person] = [0] * len(s["social"]["bonds"][person])

    def street(s):
        s["crowd"]["enthusiasm"] = [0] * len(s["crowd"]["enthusiasm"])

    return {
        "the truth is the next story": another(1),
        "the truth is the one after it": another(2),
        "the boatman remembers nothing": forget("old_he"),
        "the shopkeeper remembers nothing": forget("zhou_zhanggui"),
        "the elder remembers nothing": forget("zuzhang"),
        "the boatman and the madam trade their minds": swap("old_he", "cha_laoban"),
        "nobody trusts the manager": trust,
        "nobody is fond of anyone": bonds,
        "the street is cold": street,
    }


def told(frame: dict[str, Any]) -> dict[str, Any]:
    """What a frame tells the player of the tasks and the board."""
    return {key: frame[key] for key in ("tasks", "tracked", "board")}
