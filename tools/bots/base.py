"""What every bot shares: reading a call's outputs as a page does, and the moves of a player.

A bot plays the festival manager through player actions alone. It sees what a page sees: the
scene (places, doors, the cast with family and role), and in every call the frame (positions,
the clock, the hud, the notebook, the offers and topics for the verbs) and the events. It never
reads the state of the world. What it knows beyond that is a veteran's knowledge of the rules
(who keeps the bamboo, when the night watchman talks), written down once in this module.

A bot is a generator. ``Bot.play`` yields one action (a dict of the action's fields) per call,
or None to let a tick pass, and after every ``yield`` the outputs of that call are in ``self.obs``.
The helpers below are generators too and are used with ``yield from``.
"""

from __future__ import annotations

from collections.abc import Generator, Iterable
from typing import Any

Action = dict[str, Any] | None
Steps = Generator[Action, None, Any]

# ---------------------------------------------------------------------------- what a veteran knows

LI_HEAD, ZHOU_HEAD, ELDER = "li_laotai", "zhou_zhanggui", "zuzhang"
LI_DA = "li_da"  # keeps the bamboo
HEADS = (LI_HEAD, ZHOU_HEAD)
TIMBER_KEEPER = ZHOU_HEAD
WATCHMAN, TEMPLE_KEEPER = "gengfu", "miaozhu"
CHILD_WITNESS = "xiao_man"
TEAHOUSE, HALL = "p_teahouse", "p_clan_hall"

# whom a veteran persuades first to help: whoever is known to many people, the keepers of the
# materials among them
HELPER_ORDER = (
    "zhou_zhanggui",
    "cha_laoban",
    "mujiang",
    "sishu_xiansheng",
    "zhou_niangzi",
    "li_da",
    "zhadeng_shifu",
    "old_he",
    "gengfu",
)
CREW_TARGET = 9  # helpers to aim for: half of those who could help
# What a veteran aims for when it means to mend the bridge: ten helpers do its ten hours in one
# morning, so that a morning lost to a heavy rain (a fifth of the days) does not lose the bridge.
# The call brings the crew of five and no more, so the others are asked one by one.
HEDGE_TARGET = 10
HEDGE_EXTRA = ("li_xiaomei", "zhou_huoji", "li_er")  # asked after the nine of ``HELPER_ORDER``
BATCH_ASKS = 4  # times in a row the bamboo is asked for, when Li Da gives it in batches
SMALL_TALK = ("p_bridge", "t_rail")  # what a manager asks about to get a person talking
CITE_MAX = 3  # entries the manager may point at in one request
HALL_WAIT = 470  # ticks the clan stays called

TALK_RANGE = 2

# the order in which a veteran spends what the manager can promise: the cheapest first
SWEETENERS = (
    "wage:10",
    "slot:",
    "stall:back",
    "wage:20",
    "stall:front",
    "role:",
)


def since_dawn(hour: int, minute: int) -> int:
    """Minutes since 06:00, so that the small hours of a night come after the evening."""
    return (hour * 60 + minute - 360) % 1440


def cheb(a: tuple[int, int], b: tuple[int, int]) -> int:
    return max(abs(a[0] - b[0]), abs(a[1] - b[1]))


# ---------------------------------------------------------------------------- reading a call


class Obs:
    """The outputs of one call as a page reads them."""

    __slots__ = (
        "day",
        "events",
        "frame",
        "hour",
        "hud",
        "me",
        "minute",
        "notebook",
        "npcs",
        "out",
        "phase",
        "pos",
        "talking",
        "tick",
        "verbs",
    )

    def __init__(self, out: dict[str, Any]) -> None:
        frame = out["frame"]
        self.out = out
        self.frame = frame
        self.tick = out["tick"] + (1 if out["advanced"] else 0)
        when = frame["time"]
        self.day, self.hour, self.minute, self.phase = (
            when["day"],
            when["hour"],
            when["minute"],
            when["phase"],
        )
        self.me = frame["player"]
        self.pos = (self.me["x"], self.me["y"])
        self.npcs = {n["id"]: n for n in frame["npcs"]}
        self.hud = frame["hud"]
        self.verbs = frozenset(self.hud["verbs"])
        self.notebook = frame["notebook"]
        self.events = out["events"]
        talk = self.me["talk"]
        self.talking = talk["npc"] if talk else None

    @property
    def clock(self) -> tuple[int, int]:
        """``(day, minutes since dawn)``: comparable, and right through the night."""
        return self.day, since_dawn(self.hour, self.minute)

    def events_of(self, kind: str) -> list[dict[str, Any]]:
        return [e for e in self.events if e["kind"] == kind]

    def cell_of(self, npc: str) -> tuple[int, int]:
        n = self.npcs[npc]
        return n["x"], n["y"]

    def offers(self, verb: str) -> list[dict[str, Any]]:
        return self.me["offers"].get(verb, [])

    def offer(self, verb: str, prefix: str) -> dict[str, Any] | None:
        """The first offer of a verb whose id starts with ``prefix``."""
        for found in self.offers(verb):
            if found["id"].startswith(prefix):
                return found
        return None


# ---------------------------------------------------------------------------- the scene


class Map:
    """The static map of the scene: where the doors are and which cells can be walked."""

    def __init__(self, scene: dict[str, Any]) -> None:
        self.scene = scene
        self.places = {p["id"]: p for p in scene["places"]}
        self.rows = scene["layers"]["terrain"]["rows"]
        legend = scene["layers"]["terrain"]["legend"]
        self.open_chars = {entry["char"] for entry in legend if entry.get("cost", 1) > 0}
        self.family = {c["id"]: c["family"] for c in scene["cast"]}
        self.names = {c["id"]: c["en"] for c in scene["cast"]}
        self.roles = {c["id"]: c["role"]["en"] for c in scene["cast"]}
        self.cast = [c["id"] for c in scene["cast"]]

    def door(self, place: str) -> tuple[int, int] | None:
        door = self.places[place]["door"]
        return None if door is None else (door[0], door[1])

    def walkable(self, x: int, y: int) -> bool:
        if not (0 <= y < len(self.rows) and 0 <= x < len(self.rows[y])):
            return False
        return self.rows[y][x] in self.open_chars

    def reach_cell(self, place: str, near: tuple[int, int]) -> tuple[int, int] | None:
        """A walkable cell within one cell of the place's rectangle, the closest to ``near``."""
        x, y, w, h = self.places[place]["rect"]
        best: tuple[int, tuple[int, int]] | None = None
        for cy in range(y - 1, y + h + 1):
            for cx in range(x - 1, x + w + 1):
                if self.walkable(cx, cy) and (best is None or cheb((cx, cy), near) < best[0]):
                    best = (cheb((cx, cy), near), (cx, cy))
        return None if best is None else best[1]


# ---------------------------------------------------------------------------- the bot


class Bot:
    """A festival manager. Subclasses write ``play``."""

    name = "bot"
    budget: int | None = None  # promises the manager is willing to make in a game; None: any

    def __init__(self, scene: dict[str, Any], seed: int = 0) -> None:
        self.map = Map(scene)
        self.seed = seed
        self.obs: Obs | None = None
        self._steps: Steps | None = None
        self._ids = 0
        self.joined: list[str] = []  # who joined the call, from the ``joined`` events
        self.flags: dict[str, int] = {}  # the flags of the festival, from the ``flag`` events
        self.rejections: dict[str, int] = {}
        self.sent = 0
        self.entrusted: dict[tuple[str, str, str], str] = {}  # (npc, kind, detail) -> last result
        self.spoke: list[dict[str, Any]] = []  # the ``spoke`` events
        self.told_outcomes: dict[str, int] = {}
        self.evidence: list[str] = []  # the items of evidence in hand, from what was found
        self.trace: list[tuple[int, str, str]] = []  # (tick, what was done, how it came out)
        self.convened_at = -1  # the tick at which the elder last called the clan
        self.promised = 0  # promises made so far
        self.asked_source = 0  # times the manager asked who told someone something
        self.stated: list[dict[str, Any]] = []  # the ``stated`` events: the full statements made
        self.rejected: dict[str, set[str]] = {}  # part -> options stated that did not hold

    # -- the loop the runner drives -----------------------------------------------------------

    def decide(self, obs: Obs) -> Action:
        """The action for the next call, given the outputs of the last."""
        self.obs = obs
        self._read(obs)
        if self._steps is None:
            self._steps = self.play()
        try:
            action = next(self._steps)
        except StopIteration:
            return None
        if action is None:
            return None
        if "action_id" not in action:
            self._ids += 1
            action = {"action_id": f"{self.name}-{self._ids}", **action}
        self.sent += 1
        return action

    def _read(self, obs: Obs) -> None:
        for event in obs.events:
            kind = event["kind"]
            if kind == "joined" and event["npc"] not in self.joined:
                self.joined.append(event["npc"])
            elif kind == "flag":
                self.flags.setdefault(event["flag"], obs.tick)
            elif kind == "action_ack" and event["result"] == "rejected":
                reason = str(event["reason"])
                self.rejections[reason] = self.rejections.get(reason, 0) + 1
            elif kind == "entrusted" and event["result"] != "said_already":
                self.entrusted[(event["npc"], event["request"], event["detail"])] = event["result"]
            elif kind in ("inspected", "testified"):
                for item in event.get("found", event.get("items", [])):
                    if item not in self.evidence:
                        self.evidence.append(item)
            elif kind == "convened":
                self.convened_at = obs.tick
            elif kind == "spoke":
                self.spoke.append(event)
            elif kind == "stated":
                self.stated.append(event)
                card = obs.frame.get("statement") or {"parts": []}
                for part in card["parts"]:
                    if part["part"] in event["wrong"] and part["chosen"] is not None:
                        self.rejected.setdefault(part["part"], set()).add(part["chosen"])
            elif kind == "told":
                outcome = str(event.get("outcome"))
                self.told_outcomes[outcome] = self.told_outcomes.get(outcome, 0) + 1

    def play(self) -> Steps:
        raise NotImplementedError

    @property
    def o(self) -> Obs:
        assert self.obs is not None
        return self.obs

    # -- one action ---------------------------------------------------------------------------

    def act(self, type_: str, **fields: Any) -> Steps:
        """Send one action and return ``(result, reason)`` of its acknowledgement."""
        self._ids += 1
        action_id = f"{self.name}-{self._ids}"
        yield {"action_id": action_id, "type": type_, **fields}
        for event in self.o.events_of("action_ack"):
            if event["action_id"] == action_id:
                self.trace.append((self.o.tick, f"{type_} {fields}", str(event["reason"])))
                if type_ == "ask_source" and event["result"] == "applied":
                    self.asked_source += 1
                return event["result"], event["reason"]
        return "rejected", "no_ack"

    def last_event(self, kind: str) -> dict[str, Any] | None:
        found = self.o.events_of(kind)
        return found[-1] if found else None

    # -- time ---------------------------------------------------------------------------------

    def wait(self, ticks: int) -> Steps:
        for _ in range(ticks):
            yield None

    def wait_until(self, day: int, hour: int, minute: int = 0, limit: int = 6000) -> Steps:
        """Let the clock run to ``day`` ``hour``:``minute`` (hours of the daylight)."""
        goal = (day, since_dawn(hour, minute))
        for _ in range(limit):
            if self.o.clock >= goal:
                return True
            yield None
        return False

    def now_before(self, day: int, hour: int, minute: int = 0) -> bool:
        return self.o.clock < (day, since_dawn(hour, minute))

    def await_day(self) -> Steps:
        """Let a night pass (the people are asleep)."""
        while self.o.phase == "night":
            yield None

    def look(self, target: str) -> Steps:
        """Look at a thing or a place and wait until it is done. None, or why it was refused."""
        result, reason = yield from self.act("look", at=target)
        if result != "applied":
            return reason
        while self.o.me["activity"] == "work":
            yield None
        return None

    def people_at(self, place: str, margin: int = 2) -> list[str]:
        """The people standing at a place, or within ``margin`` cells of its rectangle."""
        x, y, w, h = self.map.places[place]["rect"]
        return [
            who
            for who, n in self.o.npcs.items()
            if x - margin <= n["x"] < x + w + margin and y - margin <= n["y"] < y + h + margin
        ]

    # -- walking ------------------------------------------------------------------------------

    def goto_cell(self, cell: tuple[int, int], timeout: int = 900) -> Steps:
        sent = -1000
        for _ in range(timeout):
            o = self.o
            if o.talking:
                yield from self.act("leave")
                continue
            if o.pos == cell:
                return True
            if "move" in o.verbs and (o.me["activity"] != "walk" or o.tick - sent >= 40):
                sent = o.tick
                result, reason = yield from self.act("move", x=cell[0], y=cell[1])
                if result == "rejected" and reason in ("blocked", "unreachable", "outside"):
                    return False
                continue
            yield None
        return False

    def goto(self, place: str, timeout: int = 900) -> Steps:
        door = self.map.door(place)
        if door is None:
            cell = self.map.reach_cell(place, self.o.pos)
            if cell is None:
                return False
            return (yield from self.goto_cell(cell, timeout))
        return (yield from self.goto_cell(door, timeout))

    def goto_reach(self, place: str, timeout: int = 900) -> Steps:
        """Walk to a cell from which the place can be looked at."""
        cell = self.map.reach_cell(place, self.o.pos)
        if cell is None:
            return False
        return (yield from self.goto_cell(cell, timeout))

    # -- people -------------------------------------------------------------------------------

    def meet(self, npc: str, timeout: int = 1200) -> Steps:
        """Walk up to ``npc`` and open a conversation. True once one is open with them."""
        retry_at = 0
        sent = -1000
        for _ in range(timeout):
            o = self.o
            if o.talking == npc:
                return True
            if o.talking:
                yield from self.act("leave")
                continue
            if o.me["activity"] == "work":
                yield None
                continue
            here = o.cell_of(npc)
            if cheb(o.pos, here) <= TALK_RANGE and "talk" in o.verbs and o.tick >= retry_at:
                result, reason = yield from self.act("talk", npc=npc)
                if result == "rejected":
                    retry_at = o.tick + (60 if reason == "busy" else 120)
                continue
            if cheb(o.pos, here) > TALK_RANGE and (
                o.me["activity"] != "walk" or o.tick - sent >= 20
            ):
                sent = o.tick
                yield from self.act("move", x=here[0], y=here[1])
                continue
            yield None
        return False

    def leave(self) -> Steps:
        if self.o.talking:
            yield from self.act("leave")

    # -- asking -------------------------------------------------------------------------------

    def entrust(self, kind: str, target: str = "", cite: Iterable[str] = ()) -> Steps:
        """Ask the person in the conversation for something. ``(result, reason)``: the result of
        the ``entrusted`` event (agreed, refused, hard, said_already), or ``rejected`` and why."""
        fields: dict[str, Any] = {"kind": kind}
        if target:
            fields["target"] = target
        cites = list(cite)
        if cites:
            fields["cite"] = cites
        result, reason = yield from self.act("entrust", **fields)
        if result == "applied":
            return "agreed", None
        event = self.last_event("entrusted")
        if event is not None:
            return event["result"], reason
        return "rejected", reason

    def before(self, npc: str, kind: str) -> str | None:
        """How this person last answered this kind of request, if they ever did."""
        found = [r for (who, what, _), r in self.entrusted.items() if who == npc and what == kind]
        return found[-1] if found else None

    def sweeten(self, spent: set[str], order: Iterable[str] = SWEETENERS) -> Steps:
        """Promise the cheapest thing the manager still holds, to the person in the conversation,
        and keep the promise at once. True if a promise was made."""
        o = self.o
        if self.budget is not None and self.promised >= self.budget:
            return False
        for prefix in order:
            found = o.offer("promise", prefix)
            if found is None or found["id"] in spent:
                continue
            spent.add(found["id"])
            result, _ = yield from self.act("promise", **found["body"])
            if result != "applied":
                continue
            self.promised += 1
            made = self.last_event("pledged")
            if made is not None:
                keep = self.o.offer("promise", f"keep:{made['pledge']}")
                if keep is not None:
                    yield from self.act("promise", **keep["body"])
            return True
        return False

    def persuade(
        self, kind: str, target: str = "", cite: Iterable[str] = (), tries: int = 7
    ) -> Steps:
        """Ask for something and, while the answer is a plain no, promise a little more.

        Returns ``(result, reason)`` at the end: ``agreed``, or why not.
        """
        spent: set[str] = set()
        result, reason = "rejected", "none"
        partner = self.o.talking or ""
        for attempt in range(tries):
            result, reason = yield from self.entrust(kind, target, cite)
            if result == "agreed":
                return result, reason
            if result == "said_already" or reason == "said_already":
                earlier = self.before(partner, kind)
                if earlier == "agreed":
                    return "agreed", None
                if earlier is None and attempt == 0:
                    return result, reason
                # they said no and nothing has moved since: a promise will
            elif result != "refused":
                return result, reason
            if not (yield from self.sweeten(spent)):
                return result, reason
        return result, reason

    # -- what every manager has to see to ----------------------------------------------------

    def recruit(self, order: Iterable[str] = HELPER_ORDER, target: int = CREW_TARGET) -> Steps:
        """Persuade people to join the helpers, one after the other, until enough have."""
        for npc in order:
            if len(self.joined) >= target:
                return
            if npc in self.joined:
                continue
            if not (yield from self.meet(npc)):
                continue
            yield from self.ask_of(npc, "join")
            yield from self.leave()

    def small_talk(self, npc: str) -> Steps:
        """Ask the person about the bridge and the rail, and return the entries of the notebook
        that hold what they said: the manager can point at them when it asks for something."""
        entries: list[str] = []
        for topic in SMALL_TALK:
            if not any(t["id"] == topic for t in self.o.me["topics"]):
                continue
            yield from self.act("ask", topic=topic)
            event = self.last_event("asked")
            if event and event["answer"] == "claim" and event["entry"] not in entries:
                entries.append(event["entry"])
        return entries

    def extra_cites(self, npc: str) -> Steps:
        """Entries to point at besides what the person said: none, for an honest manager."""
        return []
        yield

    def ask_of(self, npc: str, kind: str, target: str = "", once: bool = False) -> Steps:
        """What the manager does in a conversation to get a yes.

        It lets the person say what they know of the bridge and points at that when it asks (a
        person weighs more an entry they hold themselves). ``once`` asks a single time and leaves
        the promising to the caller."""
        cites: list[str] = []
        if self.o.talking == npc:
            said = yield from self.small_talk(npc)
            told = yield from self.extra_cites(npc)
            cites = [*told, *said]
        cites = cites[:CITE_MAX]
        if once:
            return (yield from self.entrust(kind, target, cites))
        return (yield from self.persuade(kind, target, cites))

    def agreed(self, npc: str, kind: str) -> bool:
        return self.before(npc, kind) == "agreed"

    def promises(self, npc: str, item: str) -> list[dict[str, Any]]:
        """What ``npc`` has promised the manager for ``item``, as the frame lists it (a game that
        sends the goods at once has no promises)."""
        rows = self.o.frame.get("commitments") or []
        return [row for row in rows if row["by"] == npc and row["item"] == item]

    def goods_wanted(self, npc: str, item: str, flag: str) -> bool:
        """Whether ``npc`` is to be asked for ``item`` now. Not when the bridge has all of it (the
        flag), nor when they agreed to send it at once, nor while a promise of theirs is open. When
        a promise has been kept, broken or taken back and the bridge still lacks some, they are
        asked again for the next batch."""
        if flag in self.flags:
            return False
        promised = self.promises(npc, item)
        if any(row["state"] == "promised" for row in promised):
            return False
        return bool(promised) or not self.agreed(npc, "material")

    def timber(self) -> Steps:
        if not self.goods_wanted(TIMBER_KEEPER, "timber", "timber_delivered"):
            return
        if (yield from self.meet(TIMBER_KEEPER)):
            yield from self.ask_of(TIMBER_KEEPER, "material")
            yield from self.leave()

    def await_batch(self, npc: str, item: str, until: int = 20) -> Steps:
        """Let the clock run until the open promise of ``npc`` for ``item`` is kept, broken or taken
        back, or the day is over (``until`` o'clock). True if it was kept."""
        day = self.o.day
        while any(row["state"] == "promised" for row in self.promises(npc, item)):
            if self.o.day != day or self.o.phase != "day" or self.o.hour >= until:
                return False
            yield None
        rows = self.promises(npc, item)
        return bool(rows) and rows[-1]["state"] == "delivered"

    def bamboo_from_li_da(self) -> Steps:
        """After Granny Li's nod the bamboo is Li Da's to bring, and he is asked himself. He moves
        once he has heard that the rumour was cleared in public (his mother tells him, if she saw
        it), and he is asked again on a later visit if he has not. In a game that has the goods
        promised for a time he gives the bamboo in batches: the manager waits for each to come and
        asks for the next, up to ``BATCH_ASKS`` times in a row."""
        for _ in range(BATCH_ASKS):
            if not self.goods_wanted(LI_DA, "bamboo", "bamboo_delivered"):
                return
            if self.before(LI_HEAD, "lend") != "agreed":
                return
            made = len(self.promises(LI_DA, "bamboo"))
            if not (yield from self.meet(LI_DA)):
                return
            yield from self.ask_of(LI_DA, "material", once=True)
            yield from self.leave()
            if len(self.promises(LI_DA, "bamboo")) == made:  # no promise: a no, or sent at once
                return
            if not (yield from self.await_batch(LI_DA, "bamboo")):
                return

    def open_the_lane(self) -> Steps:
        """Ask the temple keeper to open the lane: the way round when the bridge is lost."""
        if "lane_opened" in self.flags or self.agreed(TEMPLE_KEEPER, "lane"):
            return
        if (yield from self.meet(TEMPLE_KEEPER)):
            yield from self.ask_of(TEMPLE_KEEPER, "lane")
            yield from self.leave()

    def detour_if_needed(self) -> Steps:
        """If the bridge cannot be mended in time, open the lane behind the temple."""
        bridge = self.o.hud["bridge"]
        if bridge["state"] in ("mended", "detour"):
            return
        if self.o.day == 4 and bridge["percent"] >= 100:
            return
        yield from self.open_the_lane()

    def sweep_bridge(self) -> Steps:
        """Look at the water under the bridge and at the rail: the debris and the footprint."""
        for target, place in (("p_under_bridge", "p_under_bridge"), ("t_rail", "p_bridge")):
            yield from self.goto_reach(place)
            yield from self.look(target)

    def boat(self) -> Steps:
        """Win the boatman's trust with a small promise, then look at his boat."""
        if (yield from self.meet("old_he")):
            yield from self.sweeten(set())
            yield from self.leave()
        yield from self.goto_reach("p_ferry")
        yield from self.look("t_he_boat")

    def convene_and_speak(self) -> Steps:
        """Ask the elder to call the clan, show the evidence there, and lay a table."""
        yield from self.await_day()
        yield from self.before_convene()
        if not (yield from self.meet(ELDER)):
            return False
        asked = self.o.tick
        result, _ = yield from self.ask_of(ELDER, "convene")
        yield from self.leave()
        if result != "agreed":
            return False
        yield from self.goto(HALL)
        for _ in range(400):  # a yes won by a lie is acted on a little later
            if self.convened_at >= asked:
                break
            yield None
        called = self.convened_at if self.convened_at >= asked else self.o.tick
        shown = fed = False
        while self.o.tick < called + HALL_WAIT and not (shown and fed):
            here = self.people_at(HALL)
            if not shown and ELDER in here and len(here) >= 6:
                shown = yield from self.speak_now("evidence")
                if shown:
                    yield from self.state_it()
            if shown and not fed and all(head in here for head in HEADS) and len(here) >= 5:
                fed = yield from self.speak_now("meal")
            yield from self.wait(10)
        return shown

    def before_convene(self) -> Steps:
        """What the manager does before it asks the elder to call the clan: nothing, by default.
        (Those at the hall are at work there and will not talk until the meeting is done.)"""
        return
        yield

    def speak_now(self, kind: str) -> Steps:
        result, _ = yield from self.act("speak", kind=kind)
        return result == "applied"

    def fill_the_card(self) -> Steps:
        """Choose on the statement card, in each part, what the notes for and against it say (see
        ``bots.card``). True if the card is filled in."""
        from bots.card import changes  # not at the top: this file is run alone under Pyodide

        for part, option in changes(self.o.frame.get("statement") or {"parts": []}, self.rejected):
            yield from self.act("statement", op="choose", part=part, option=option)
        card = self.o.frame.get("statement")
        return card is not None and all(p["chosen"] is not None for p in card["parts"])

    def state_it(self) -> Steps:
        """Fill in the card and make the full statement, if it can be made here and now. True if
        one was made."""
        if not (yield from self.fill_the_card()):
            return False
        if not self.o.frame["statement"]["can_state"]:
            return False
        return (yield from self.speak_now("statement"))

    def evening_speech(self) -> Steps:
        """At the teahouse in the evening: the town that was not at the hall hears it too."""
        yield from self.wait_until(self.o.day, 17, 15)
        yield from self.goto(TEAHOUSE)
        for _ in range(8):
            if len(self.people_at(TEAHOUSE)) >= 6:
                yield from self.speak_now("evidence")
                yield from self.state_it()
                return
            yield from self.wait(25)

    def ask_source_of(self, entry_id: str) -> Steps:
        return (yield from self.act("ask_source", entry=entry_id))
