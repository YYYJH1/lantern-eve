"""The follower: a manager that does what the task card says and nothing else, and writes down
the places where the card leaves it with nothing to do.

It sees what a page sees and has no knowledge of the game beyond that: it does not know who keeps
the bamboo, whom to persuade first or where to speak. Each call it reads the ``tasks`` of the frame
and does the ``action`` of the task that is followed (``tracked``): it walks to the person or the
place, opens a talk and does the verb with what the action names, picking from the offers and the
topics of the frame the first that matches. It leaves a talk as soon as its verb is done and never
waits for the clock inside one. Where the card has no action it waits where its window says, as a
player does who reads the top bar, and where it has neither an action nor a time to wait for, it
presses the hint button of the notebook and judges the pair that the hint names (so it does for the
verb ``judge``). A person the card names is waited for until their window opens, since the window
is when they are about; but a card of an occasion (it lists who is expected at the place) has the
window of the occasion, and the person its button names is asked at once. A card that
says to keep a promise (the verb ``promise`` with the kind ``keep``) has it use the offer of the
talk for that promise. It never sends ``track``:
the task that is followed is the one the game follows (the mode ``tracked``, the default).

The statement card is filled in as a player who reasons from what it shows would (``bots.card``): in
each part the option with the most notes for it and none against, and no option that no note speaks
for (a part stays empty until something is found for it). The card says when (``state``, while
there is something to choose), and the full statement is made when it says so and the card allows
it (``can_state``). After a statement with a part that did not hold, that part takes the next best
option.

The mode ``list`` is for diagnosis. It picks its own card each call, the one that is followed, else
the open ones and then the blocked ones in the order of the list, follows it with ``track`` and so
shows what the cards would lead to were the top bar not in the way.

Nothing it does is clever. When an action is turned down, or does not change the card, it leaves
the card alone for a while (two hours of daylight, then four, then eight), and in the mode ``list``
goes on to the other cards, so that the game goes on to the end of the fifth day and shows every
place where it got stuck.

What it keeps for the report (``tools/follow_report.py``), all of it read from the frames:

``timeline``  when each task appeared, was followed, changed state or ended, and what the bot did;
``stalls``    where the card left the bot stuck, each with the hour and what the frame showed:

              ``no_live_task``      two hours of daylight or more with no live task while a job
                                    is open;
              ``blocked_long``      the task that is followed blocked for four hours of daylight or
                                    more (in the mode ``list``, any task);
              ``rejected``          the core turned an action down (``reason`` is its word);
              ``cannot_carry_out``  no offer, topic or entry matched the action, or the person
                                    or the place could not be reached;
              ``no_effect``         the bot did what the card says and the card did not change;
              ``no_next_step``      live tasks, but none says what to do or when to wait for;

``notes``     where the bot had to guess because the card does not say (which topic, which
              request).

Time is counted in minutes of daylight (06:00 to 21:00), since nobody can do anything at night.
"""

from __future__ import annotations

import json
from typing import Any

from bots.base import TALK_RANGE, Bot, Obs, Steps, cheb, since_dawn
from bots.card import changes

LIVE = ("open", "blocked")
JOBS = ("bridge", "truth", "peace")
MODES = ("tracked", "list")  # the card that is followed, or the bot's own pick from the list
PERSON_VERBS = ("talk", "ask", "ask_source", "tell", "entrust", "promise")

DAY_MINUTES = 900  # the daylight, 06:00 to 21:00
IDLE_LIMIT = 120  # minutes of daylight with no live task, or nothing to do, that count as a stall
BLOCKED_LIMIT = 240  # minutes of daylight a task is blocked before it counts as a stall
COOLDOWN, COOLDOWN_MAX = 120, 480  # the wait before the card is tried again, doubled each time
PAST_GRACE = 30  # minutes after a window closes before standing at its place is a stall
LOOK_FOR_THEM = 60  # minutes into a window after which the person should be at its place
FAR_FROM_WINDOW = 6  # cells from the place of the window at which the person is not there
APPROACH_CALLS, WALK_CALLS, TALK_TRIES, MOVE_TRIES = 1500, 1500, 3, 3
BUSY_TRIES = 8  # a person who is busy is tried again every half hour, for four hours
ASKS_A_VISIT = 3  # topics asked in one visit when the card names none

# refusals that say "not now" and not "not this way"
PASSING = ("busy", "asleep", "far", "talking", "not_talking", "stale")
# those after which a player tries again in half an hour: the hour, or the people, are not there yet
SOON = (
    *PASSING,
    "few_present",
    "heads_absent",
    "not_evening",
    "empty_room",
    "no_meeting",
    "closed",
)


# ---------------------------------------------------------------------------- reading the frame


def awake(o: Obs) -> int:
    """Minutes of daylight since the start of the game: the nights do not count."""
    return (o.day - 1) * DAY_MINUTES + min(since_dawn(o.hour, o.minute), DAY_MINUTES)


def clock_text(o: Obs) -> str:
    return f"d{o.day} {o.hour:02d}:{o.minute:02d}"


def words(value: dict[str, str] | None) -> str | None:
    return None if value is None else value["en"]


def signature(task: dict[str, Any]) -> tuple[Any, ...]:
    """What a card says to a player: its state, why it is blocked, what to do and the action."""
    action = json.dumps(task["action"], sort_keys=True)
    return (task["state"], words(task["blocker"]), words(task["why"]), words(task["next"]), action)


def brief(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task["id"],
        "state": task["state"],
        "action": task["action"],
        "window": task["window"],
        "blocker": words(task["blocker"]),
        "next": words(task["next"]),
    }


def window_edges(window: dict[str, Any]) -> tuple[tuple[int, int], tuple[int, int]]:
    """The clocks (day, minutes since dawn) at which a window opens and closes."""
    start = since_dawn(window["from"], 0)
    end = since_dawn(window["to"], 0)
    if end <= start:  # it runs on past the dawn
        end += 1440
    return (window["day"], start), (window["day"], end)


def window_phase(o: Obs, window: dict[str, Any] | None) -> str:
    """Where the clock stands against a window: ``none``, ``ahead``, ``open`` or ``past``."""
    if window is None:
        return "none"
    start, end = window_edges(window)
    if o.clock < start:
        return "ahead"
    return "past" if o.clock >= end else "open"


def window_over(o: Obs, window: dict[str, Any] | None) -> int:
    """Minutes since a window closed, 0 if it has not."""
    if window is None:
        return 0
    end = window_edges(window)[1]
    if o.day != end[0]:
        return 600 if o.day > end[0] else 0
    return max(0, o.clock[1] - end[1])


class Plan:
    """What the bot has decided to do about one card: the card as it stood, and the kind of work."""

    __slots__ = ("kind", "leg", "npc", "place", "sig", "task")

    def __init__(
        self, task: dict[str, Any], kind: str, *, npc: str = "", place: str = "", leg: bool = False
    ) -> None:
        self.task, self.kind, self.npc, self.place = task, kind, npc, place
        self.leg = leg  # a walk to where the card's verb is done, not the verb itself
        self.sig = signature(task)


class Follower(Bot):
    name = "follower"

    def __init__(self, scene: dict[str, Any], seed: int = 0, mode: str = "tracked") -> None:
        super().__init__(scene, seed)
        if mode not in MODES:
            raise ValueError(f"unknown mode {mode!r}; the modes are {', '.join(MODES)}")
        self.mode = mode
        # every task seen: its words, when it came, how it stands
        self.tasks: dict[str, dict[str, Any]] = {}
        self.timeline: list[dict[str, Any]] = []
        self.stalls: list[dict[str, Any]] = []
        self.notes: list[dict[str, Any]] = []
        self._stall_index: dict[tuple[Any, ...], dict[str, Any]] = {}
        self._note_index: set[tuple[Any, ...]] = set()
        self._cool: dict[str, dict[str, Any]] = {}  # task -> when to try its card again
        self._blocked_since: dict[str, int] = {}
        self._blocked_told: list[str] = []  # tasks whose blocked stretch is already a stall
        self._empty_since: int | None = None
        self._empty_told = False
        self._idle_since: int | None = None
        self._idle_told = False
        self._asked: dict[tuple[str, str], int] = {}  # (person, topic) -> the tick it was asked
        self._spent: list[tuple[str, str]] = []  # judged pairs already said in public
        self._no_pair_at: tuple[int, int] | None = None  # notebook size when the hint found nothing
        self._soon = False  # the last refusal said that it may be different in half an hour
        self._waits: dict[str, str] = {}  # why each live card was not worked on this call
        self._legit: set[str] = set()  # those the bot waits on for a time or place the card names
        self.pairs_judged = 0
        self.deliveries: list[dict[str, Any]] = []  # goods that came, and whether the bot was there

    # ------------------------------------------------------------------ what the frames show

    def _read(self, obs: Obs) -> None:
        super()._read(obs)
        frame = obs.frame
        for event in obs.events:
            if event["kind"] == "task_changed":
                self.log("followed", event["to"], f"after {event['from']} ({event['cause']})", obs)
            elif event["kind"] == "delivered":
                self.deliveries.append(
                    {
                        "tick": obs.tick,
                        "item": event.get("item"),
                        "amount": event.get("amount"),
                        "place": event.get("place"),
                        "stood_there": self.near_place(event.get("place"), obs.pos),
                    }
                )
        tasks = frame.get("tasks") or []
        now = awake(obs)
        for task in tasks:
            self._watch(task, obs, now)
        live = [t for t in tasks if t["state"] in LIVE]
        if live or not self.jobs_open():
            self._empty_since, self._empty_told = None, False
        elif self._empty_since is None:
            self._empty_since = now
        elif now - self._empty_since >= IDLE_LIMIT and not self._empty_told:
            self._empty_told = True
            self.stall(
                "no_live_task",
                None,
                "no_live_task",
                f"no task to follow since {self._clock_at(self._empty_since)}; "
                f"jobs still open: {', '.join(self.jobs_open())}",
            )

    def _watch(self, task: dict[str, Any], obs: Obs, now: int) -> None:
        seen = self.tasks.get(task["id"])
        if seen is None:
            seen = self.tasks[task["id"]] = {
                "text": task["text"],
                "job": task["job"],
                "kind": task["kind"],
                "appeared": obs.tick,
                "state": None,
                "ended": None,
            }
            self.log("appeared", task["id"], task["state"], obs)
        if seen["state"] != task["state"]:
            if seen["state"] is not None:
                self.log(task["state"], task["id"], words(task["blocker"]) or "", obs)
            seen["state"] = task["state"]
            if task["state"] in ("done", "stale"):
                seen["ended"] = obs.tick
        followed = self.mode == "list" or obs.frame.get("tracked") == task["id"]
        if task["state"] == "blocked" and followed:
            since = self._blocked_since.setdefault(task["id"], now)
            if now - since >= BLOCKED_LIMIT and task["id"] not in self._blocked_told:
                self._blocked_told.append(task["id"])
                self.stall(
                    "blocked_long",
                    task["id"],
                    "blocked",
                    f"blocked since {self._clock_at(since)}: {words(task['blocker'])}",
                )
        else:
            self._blocked_since.pop(task["id"], None)
            if task["id"] in self._blocked_told:
                self._blocked_told.remove(task["id"])

    def jobs_open(self) -> list[str]:
        """The jobs of the festival that are not done yet, from the flags the bot has seen."""
        done = {
            "bridge": "bridge_fixed" in self.flags or "detour_done" in self.flags,
            "truth": "truth_told" in self.flags,
            "peace": "reconciled" in self.flags,
        }
        return [job for job in JOBS if not done[job]]

    def _clock_at(self, minutes: int) -> str:
        day, rest = divmod(minutes, DAY_MINUTES)
        return f"d{day + 1} {6 + rest // 60:02d}:{rest % 60:02d}"

    # ------------------------------------------------------------------ keeping the record

    def log(
        self, kind: str, task: str | None, detail: str, obs: Obs | None = None, **extra: Any
    ) -> None:
        o = obs or self.o
        self.timeline.append(
            {
                "tick": o.tick,
                "clock": clock_text(o),
                "kind": kind,
                "task": task,
                "detail": detail,
                **extra,
            }
        )

    def snapshot(self) -> dict[str, Any]:
        """What the frame shows now, short: the clock, the tasks and the bridge."""
        o = self.o
        bridge = o.hud.get("bridge") or {}
        keys = ("state", "percent", "done", "need", "hours", "hours_need")
        return {
            "clock": clock_text(o),
            "at": [o.pos[0], o.pos[1]],
            "tracked": o.frame.get("tracked"),
            "tasks": [brief(t) for t in o.frame.get("tasks") or []],
            "bridge": {k: bridge[k] for k in keys if k in bridge},
            "jobs_open": self.jobs_open(),
        }

    def stall(self, kind: str, task: str | None, reason: str, detail: str, **extra: Any) -> None:
        key = (kind, task, reason)
        found = self._stall_index.get(key)
        if found is not None:
            found["count"] += 1
            found["last"] = self.o.tick
            return
        entry = {
            "kind": kind,
            "task": task,
            "reason": reason,
            "detail": detail,
            "tick": self.o.tick,
            "last": self.o.tick,
            "count": 1,
            "frame": self.snapshot(),
            **extra,
        }
        self._stall_index[key] = entry
        self.stalls.append(entry)

    def guess(self, task: str, what: str, detail: str) -> None:
        """The card does not say, and the bot picked."""
        key = (task, what)
        if key in self._note_index:
            return
        self._note_index.add(key)
        self.notes.append(
            {
                "tick": self.o.tick,
                "clock": clock_text(self.o),
                "task": task,
                "what": what,
                "detail": detail,
            }
        )

    def cannot(self, plan: Plan, reason: str, detail: str) -> None:
        self.stall("cannot_carry_out", plan.task["id"], reason, detail)

    def current(self, task_id: str) -> dict[str, Any] | None:
        for task in self.o.frame.get("tasks") or []:
            if task["id"] == task_id:
                return task
        return None

    # ------------------------------------------------------------------ the loop

    def play(self) -> Steps:
        while True:
            plan = self.choose()
            if plan is None:
                self.idle()
                yield None
                continue
            self._idle_since, self._idle_told = None, False
            try:
                yield from self.run(plan)
            except (AssertionError, KeyError, IndexError, TypeError, ValueError) as error:
                # a card or a frame of a shape the bot does not know: written down, not a crash
                detail = f"{type(error).__name__}: {error}"
                self.stall("cannot_carry_out", plan.task["id"], "bot_error", detail)
                self.rest(plan)
                yield from self.leave()
                yield None

    def idle(self) -> None:
        """Nothing to do this call. A wait for a time the card names is no stall; two hours of
        daylight with live tasks and nothing to do or to wait for is."""
        o = self.o
        live = self.cards()
        waiting = bool(self._legit) or any(window_phase(o, t["window"]) == "ahead" for t in live)
        if not live or waiting:
            self._idle_since, self._idle_told = None, False
            return
        now = awake(o)
        if self._idle_since is None:
            self._idle_since = now
        elif now - self._idle_since >= IDLE_LIMIT and not self._idle_told:
            self._idle_told = True
            cards = "; ".join(
                f"{t['id']} ({t['state']}: {self._waits.get(t['id'], 'no way to go on')})"
                for t in live
            )
            self.stall(
                "no_next_step",
                None,
                "nothing_to_do",
                f"since {self._clock_at(self._idle_since)} there is nothing to do: {cards}",
            )

    def cards(self) -> list[dict[str, Any]]:
        """The cards the bot works on, in the order it tries them. In the mode ``tracked`` that is
        the card that is followed, if it is live, and nothing else. In the mode ``list`` it is the
        followed card first, then the open ones, then the blocked ones, each in the order of the
        list (the most urgent first)."""
        o = self.o
        live = [t for t in o.frame.get("tasks") or [] if t["state"] in LIVE]
        followed = o.frame.get("tracked")
        order = [t for t in live if t["id"] == followed]
        if self.mode == "list":
            order += [t for t in live if t["state"] == "open" and t["id"] != followed]
            order += [t for t in live if t["state"] == "blocked" and t["id"] != followed]
        return order

    def choose(self) -> Plan | None:
        """The card to work on: the first of ``cards`` that the bot can do now."""
        self._waits, self._legit = {}, set()
        for task in self.cards():
            try:
                plan = self.plan_for(task)
            except (AssertionError, KeyError, IndexError, TypeError, ValueError) as error:
                detail = f"{type(error).__name__}: {error}"
                self.skip(Plan(task, "go"), "cannot_carry_out", "bot_error", detail)
                continue
            if plan is not None:
                return plan
        return None

    def skip(self, plan: Plan, kind: str, reason: str, detail: str) -> None:
        """The card cannot be done now, and is let alone for a while."""
        self.stall(kind, plan.task["id"], reason, detail)
        self.rest(plan)

    def rest(self, plan: Plan, short: bool = False) -> None:
        """Leave a card alone for a while: two hours of daylight, then four, then eight. A card that
        has changed since is looked at again at once."""
        tid = plan.task["id"]
        old = self._cool.get(tid)
        tries = (old["tries"] + 1) if old and old["sig"] == plan.sig else 1
        wait = 30 if short else min(COOLDOWN * 2 ** (tries - 1), COOLDOWN_MAX)
        self._cool[tid] = {"until": awake(self.o) + wait, "tries": tries, "sig": plan.sig}

    def plan_for(self, task: dict[str, Any]) -> Plan | None:
        """Whether, and how, the card can be worked on now. When it cannot, ``_waits`` says why."""
        o = self.o
        tid = task["id"]
        cool = self._cool.get(tid)
        if cool is not None and cool["sig"] == signature(task) and awake(o) < cool["until"]:
            self._waits[tid] = f"tried, left alone until {self._clock_at(cool['until'])}"
            return None
        action, window = task["action"], task["window"]
        phase = window_phase(o, window)
        if action is None:
            if window is None:  # nothing to do and nothing to wait for: look at the notebook
                if "hint" not in o.verbs:
                    self._waits[tid] = "no action, no time, and no pair of lines to compare"
                elif self._no_pair_at == self.notebook_state():
                    self._waits[tid] = "no action, no time, and the hint button names no pair"
                else:
                    return Plan(task, "notebook")
                return None
            if phase == "ahead":
                self._waits[tid] = f"waits for d{window['day']} {window['from']}:00"
                self._legit.add(tid)
                return None
            if self.at_place(window["place"]):
                self._waits[tid] = f"waits at {window['place']} for the card to change"
                self._legit.add(tid)
                return None
            plan = Plan(task, "go", place=window["place"])
            if window["place"] not in self.map.places:
                self.skip(
                    plan, "cannot_carry_out", "unknown_place", f"{window['place']} is no place"
                )
                return None
            return plan
        verb = action["verb"]
        venue = window["place"] if window else ""
        if verb in ("move", "go"):
            place = action.get("place") or venue
            plan = Plan(task, "go", place=place)
            if not place:
                self.skip(plan, "cannot_carry_out", "no_place", f"the card says {verb}, no place")
                return None
            if place not in self.map.places:
                self.skip(plan, "cannot_carry_out", "unknown_place", f"{place} is no place")
                return None
            if self.at_place(place):
                if self.stands_for(task):
                    self._waits[tid] = f"at {place} as the card says, for the time it names"
                    self._legit.add(tid)
                    return None
                self.skip(
                    plan, "no_effect", "unchanged", f"already at {place}; the card says to go"
                )
                return None
            return plan
        if verb in PERSON_VERBS:
            npc = action.get("npc")
            plan = Plan(task, "visit", npc=npc or "")
            if not npc:
                self.skip(plan, "cannot_carry_out", "no_person", f"the card says {verb}, no person")
                return None
            if npc not in o.npcs:
                self.skip(plan, "cannot_carry_out", "unknown_person", f"{npc} is nobody on the map")
                return None
            if phase == "ahead" and task.get("expected") is None:
                # the window is when to find the person; a task of an occasion (it lists who is
                # expected at the place) has the window of the occasion, and the person is asked now
                self._waits[tid] = f"{npc} is about from d{window['day']} {window['from']}:00"
                self._legit.add(tid)
                return None
            if verb == "ask_source" and self.entry_for(npc) is None:
                detail = f"ask_source of {npc}, but no entry of the notebook leads to them"
                self.skip(plan, "cannot_carry_out", "no_entry", detail)
                return None
            return plan
        if verb == "state":  # the statement card is to be filled in from what the notes show
            card = o.frame.get("statement")
            if card is None or not changes(card, self.rejected):
                self._waits[tid] = "to fill in the card, but there is nothing to choose"
                return None
            return Plan(task, "card")
        if verb == "speak":
            place = action.get("place") or venue
            if action.get("kind") == "statement" and "speak" in o.verbs:
                card = o.frame.get("statement") or {}
                if not card.get("can_state"):  # nobody is there yet, or the card is not filled
                    why = (card.get("why_not") or {}).get("en") or "it cannot be made yet"
                    self._waits[tid] = f"to state, but {why.lower()}"
                    self._legit.add(tid)
                    return None
                return Plan(task, "public")
            if "speak" in o.verbs:
                return Plan(task, "public")
            if place and not self.at_place(place):
                return Plan(task, "go", place=place, leg=True)
            self._waits[tid] = "to speak in public, but that is not offered here and now"
            return None
        if verb == "look":
            plan = Plan(task, "look")
            if not (action.get("item") or action.get("place")):
                self.skip(
                    plan, "cannot_carry_out", "nothing_named", "the card says look, no target"
                )
                return None
            return plan
        if verb == "judge":  # the lines of the notebook are to be set side by side
            if "hint" not in o.verbs:
                self._waits[tid] = "to judge, but the notebook has no pair of lines to compare"
            elif self._no_pair_at == self.notebook_state():
                self._waits[tid] = "to judge, and the hint button names no pair"
            else:
                return Plan(task, "notebook")
            return None
        if verb == "listen":
            return Plan(task, "listen", place=action.get("place") or venue)
        if verb == "rally":
            return Plan(task, "rally")
        plan = Plan(task, "go")
        self.skip(plan, "cannot_carry_out", "unknown_verb", f"the bot has no way to {verb}")
        return None

    def run(self, plan: Plan) -> Steps:
        task = plan.task
        self._soon = False
        if (
            self.mode == "list"
            and self.o.frame.get("tracked") != task["id"]
            and "track" in self.o.verbs
        ):
            yield from self.act("track", task=task["id"])
        outcome = yield from getattr(self, f"do_{plan.kind}")(plan)
        yield from self.leave()
        yield None  # a tick, for the card to settle
        self.settle(plan, outcome)

    def settle(self, plan: Plan, outcome: str) -> None:
        """Whether the work changed the card. If it did not, the card is let alone for a while."""
        now = self.current(plan.task["id"])
        if now is None or now["state"] not in LIVE or signature(now) != plan.sig:
            self._cool.pop(plan.task["id"], None)
            return
        if outcome == "done" and plan.leg:
            return  # on the way to where the card's verb is done: the verb comes next
        if outcome == "done" and plan.kind == "go" and self.stands_for(now):
            return  # at the place the card names, for the time it names: that is all it asks
        if outcome == "done":
            self.stall(
                "no_effect",
                plan.task["id"],
                "unchanged",
                f"did what the card says ({self.describe(plan)}) and the card did not change",
            )
        self.rest(plan, short=outcome == "rejected" and self._soon)

    def stands_for(self, task: dict[str, Any]) -> bool:
        """Whether the card only asks the bot to be at a place until its time comes: it has no
        action but a window, or it says to go to a place and gives a time that is not over."""
        window = task["window"]
        if task["action"] is None:
            return window is not None
        if task["action"]["verb"] not in ("move", "go"):
            return False
        phase = window_phase(self.o, window)
        return phase in ("ahead", "open") or (
            phase == "past" and window_over(self.o, window) < PAST_GRACE
        )

    def describe(self, plan: Plan) -> str:
        action = plan.task["action"]
        if action is None:
            return plan.kind
        return " ".join(f"{k}={v}" for k, v in action.items())

    # ------------------------------------------------------------------ where things are

    def near_place(self, place: str | None, cell: tuple[int, int]) -> bool:
        """Whether ``cell`` is within a cell of the rectangle of the place."""
        if place not in self.map.places:
            return False
        x, y, w, h = self.map.places[place]["rect"]
        return (
            max(x - cell[0], 0, cell[0] - (x + w - 1), y - cell[1], 0, cell[1] - (y + h - 1)) <= 1
        )

    def at_place(self, place: str) -> bool:
        """The player stands within a cell of the rectangle of the place."""
        return self.near_place(place, self.o.pos)

    def gap_to(self, place: str, cell: tuple[int, int]) -> int:
        x, y, w, h = self.map.places[place]["rect"]
        return max(x - cell[0], 0, cell[0] - (x + w - 1), y - cell[1], 0, cell[1] - (y + h - 1))

    def near(self, cell: tuple[int, int]) -> tuple[int, int]:
        """The walkable cell next to ``cell`` that is the closest to the player."""
        if self.map.walkable(*cell):
            return cell
        best = cell
        for radius in (1, 2):
            found = [
                (cheb(self.o.pos, (x, y)), x, y)
                for x in range(cell[0] - radius, cell[0] + radius + 1)
                for y in range(cell[1] - radius, cell[1] + radius + 1)
                if self.map.walkable(x, y)
            ]
            if found:
                _, x, y = min(found)
                return x, y
        return best

    def notebook_state(self) -> tuple[int, int]:
        return len(self.o.notebook), len(self.o.frame.get("judgments") or [])

    def entry_for(self, npc: str) -> dict[str, Any] | None:
        """The entry of the notebook whose trail leaves ``npc`` to be asked next."""
        for entry in self.o.notebook:
            chain = entry.get("chain") or []
            if len(chain) >= 2 and chain[-1] is None and chain[-2] and chain[-2]["id"] == npc:
                return entry
        return None

    # ------------------------------------------------------------------ sending, and being refused

    def send(self, plan: Plan, type_: str, **fields: Any) -> Steps:
        result, reason = yield from self.act(type_, **fields)
        if type_ not in ("move", "leave", "track", "talk"):
            outcome = "ok" if result == "applied" else str(reason)
            detail = f"{type_} {_short(fields)}: {outcome}"
            self.log("did", plan.task["id"], detail, verb=type_, outcome=outcome)
        if result == "rejected":
            self.refused(plan, type_, fields, str(reason))
        return result, reason

    def refused(self, plan: Plan, type_: str, fields: dict[str, Any], reason: str) -> None:
        now = self.current(plan.task["id"])
        explained = now is None or signature(now) != plan.sig  # the card changed, and says why
        self._soon = reason in SOON
        self.stall(
            "rejected",
            plan.task["id"],
            f"{type_}:{reason}",
            f"{type_} {_short(fields)} was turned down: {reason}",
            action={"type": type_, **fields},
            transient=reason in PASSING,
            explained=explained,
        )

    # ------------------------------------------------------------------ walking and talking

    def do_go(self, plan: Plan) -> Steps:
        if not (yield from self.walk_to(plan, plan.place)):
            return "cannot"
        return "done"

    def walk_to(self, plan: Plan, place: str) -> Steps:
        if place not in self.map.places:
            self.cannot(plan, "unknown_place", f"{place} is not a place of the town")
            return False
        door = self.map.door(place)
        cell = None if door is not None else self.map.reach_cell(place, self.o.pos)
        if door is None and cell is None:
            self.cannot(plan, "no_way", f"no way to walk to {place}")
            return False
        sent, refused = -1000, 0
        for _ in range(WALK_CALLS):
            o = self.o
            if o.talking:
                yield from self.act("leave")
                continue
            if self.at_place(place):
                return True
            if o.me["activity"] != "walk" or o.tick - sent >= 40:
                sent = o.tick
                fields = {"place": place} if door is not None else {"x": cell[0], "y": cell[1]}
                result, reason = yield from self.send(plan, "move", **fields)
                if result == "rejected" and reason not in PASSING:
                    refused += 1
                    if refused >= MOVE_TRIES:
                        self.cannot(plan, "unreachable", f"could not walk to {place}: {reason}")
                        return False
                continue
            yield None
        self.cannot(plan, "too_far", f"did not get to {place} in time")
        return False

    def approach(self, plan: Plan, npc: str) -> Steps:
        """Walk up to ``npc`` and open a talk. True once one is open with them."""
        self.check_window(plan, npc)
        declined, retry_at, sent, refused = 0, 0, -1000, 0
        for _ in range(APPROACH_CALLS):
            o = self.o
            if o.talking == npc:
                return True
            if o.talking:
                yield from self.act("leave")
                continue
            if o.me["activity"] == "work":
                yield None
                continue
            there = o.cell_of(npc)
            if cheb(o.pos, there) <= TALK_RANGE:
                if o.tick < retry_at:
                    yield None
                    continue
                result, reason = yield from self.send(plan, "talk", npc=npc)
                if result == "rejected":
                    declined += 1
                    if declined >= (BUSY_TRIES if reason == "busy" else TALK_TRIES):
                        self.cannot(plan, "will_not_talk", f"{npc} would not talk: {reason}")
                        return False
                    retry_at = self.o.tick + (60 if reason == "busy" else 120)
                continue
            if o.me["activity"] != "walk" or o.tick - sent >= 20:
                sent = o.tick
                x, y = self.near(there)
                result, reason = yield from self.send(plan, "move", x=x, y=y)
                if result == "rejected" and reason not in PASSING:
                    refused += 1
                    if refused >= MOVE_TRIES:
                        self.cannot(plan, "unreachable", f"could not walk up to {npc}: {reason}")
                        return False
                continue
            yield None
        self.cannot(plan, "not_reached", f"did not get to {npc} in time")
        return False

    def check_window(self, plan: Plan, npc: str) -> None:
        """The card puts the person at a place for a stretch of the day. Are they there?"""
        window = plan.task["window"]
        o = self.o
        if window is None or window_phase(o, window) != "open":
            return
        start, end = window_edges(window)
        if o.clock[1] - start[1] < LOOK_FOR_THEM or end[1] - o.clock[1] < 30:
            return
        gap = self.gap_to(window["place"], o.cell_of(npc))
        if gap > FAR_FROM_WINDOW:
            self.stall(
                "cannot_carry_out",
                plan.task["id"],
                "not_at_window",
                f"the card puts {npc} at {window['place']} from {window['from']}:00 to "
                f"{window['to']}:00, and at {clock_text(o)} they are {gap} cells away",
            )

    def do_visit(self, plan: Plan) -> Steps:
        action = plan.task["action"]
        assert action is not None
        if not (yield from self.approach(plan, plan.npc)):
            return "cannot"
        return (yield from getattr(self, f"verb_{action['verb']}")(plan, action))

    # ------------------------------------------------------------------ the verbs of a talk

    def verb_talk(self, plan: Plan, action: dict[str, Any]) -> Steps:
        return "done"
        yield

    def verb_ask(self, plan: Plan, action: dict[str, Any]) -> Steps:
        npc = plan.npc
        topics = [t["id"] for t in self.o.me["topics"]]
        item = action.get("item")
        if item:
            if item not in topics:
                self.cannot(
                    plan, "no_topic", f"the card says ask {npc} about {item}, which is not a topic"
                )
                return "cannot"
            chosen = [item]
        else:
            chosen = [t for t in topics if (npc, t) not in self._asked][:ASKS_A_VISIT]
            if not chosen:
                self.cannot(plan, "no_topic", f"every topic has been asked of {npc} already")
                return "cannot"
            self.guess(
                plan.task["id"],
                "topic",
                f"the card says ask {npc} and names no topic: the first not yet asked",
            )
        for topic in chosen:
            self._asked[(npc, topic)] = self.o.tick
            entries = len(self.o.notebook)
            result, _ = yield from self.send(plan, "ask", topic=topic)
            if result != "applied":
                return "rejected"
            now = self.current(plan.task["id"])
            if len(self.o.notebook) > entries or now is None or signature(now) != plan.sig:
                break
        return "done"

    def verb_ask_source(self, plan: Plan, action: dict[str, Any]) -> Steps:
        entry = self.entry_for(plan.npc)
        if entry is None:
            self.cannot(plan, "no_entry", f"no entry of the notebook leads to {plan.npc}")
            return "cannot"
        result, _ = yield from self.send(plan, "ask_source", entry=entry["id"])
        return "done" if result == "applied" else "rejected"

    def verb_entrust(self, plan: Plan, action: dict[str, Any]) -> Steps:
        offers = self.o.offers("entrust")
        request, target, item = action.get("request"), action.get("target"), action.get("item")
        chosen = None
        if request:
            for offer in offers:
                body = offer["body"]
                if body.get("kind") == request and (not target or body.get("target") == target):
                    chosen = offer
                    break
        elif item:
            for kind in ("material", "lend"):  # an item asked for: brought, or lent
                chosen = next((o for o in offers if o["body"].get("kind") == kind), None)
                if chosen is not None:
                    if kind != "material":
                        self.guess(
                            plan.task["id"],
                            "request",
                            f"the card names the item {item} and no request: took {kind}",
                        )
                    break
        elif offers:
            chosen = offers[0]
            self.guess(
                plan.task["id"], "request", "the card names no request: took the first offer"
            )
        if chosen is None:
            have = ", ".join(o["id"] for o in offers) or "none"
            self.cannot(
                plan,
                "no_offer",
                f"no request of {plan.npc} matches {_short(action)}; the offers are: {have}",
            )
            return "cannot"
        result, _ = yield from self.send(plan, "entrust", **chosen["body"])
        return "done" if result == "applied" else "rejected"

    def verb_promise(self, plan: Plan, action: dict[str, Any]) -> Steps:
        if action.get("kind") == "keep":
            return (yield from self.keep_promise(plan, action))
        offers = self.o.offers("promise")
        item = action.get("item")
        chosen = None
        if item:
            for offer in offers:
                body = offer["body"]
                if item in (offer["id"], body.get("what"), body.get("item")) or offer[
                    "id"
                ].startswith(f"{item}:"):
                    chosen = offer
                    break
        else:
            chosen = next((o for o in offers if o["body"].get("op") != "keep"), None)
            if chosen is None and offers:
                chosen = offers[0]
            self.guess(
                plan.task["id"], "promise", "the card names no promise: took the first offer"
            )
        if chosen is None:
            have = ", ".join(o["id"] for o in offers) or "none"
            self.cannot(
                plan,
                "no_offer",
                f"no promise to {plan.npc} matches {_short(action)}; the offers are: {have}",
            )
            return "cannot"
        result, _ = yield from self.send(plan, "promise", **chosen["body"])
        return "done" if result == "applied" else "rejected"

    def keep_promise(self, plan: Plan, action: dict[str, Any]) -> Steps:
        """Keep the promise the card names (its number is the item), with the offer that the talk
        puts forward for it: ``keep:<number>``."""
        number = action.get("item")
        offers = self.o.offers("promise")
        chosen = next((o for o in offers if o["id"] == f"keep:{number}"), None)
        if chosen is None:
            have = ", ".join(o["id"] for o in offers) or "none"
            self.cannot(
                plan,
                "no_offer",
                f"no offer to keep the promise {number} to {plan.npc}; the offers are: {have}",
            )
            return "cannot"
        result, _ = yield from self.send(plan, "promise", **chosen["body"])
        return "done" if result == "applied" else "rejected"

    def verb_tell(self, plan: Plan, action: dict[str, Any]) -> Steps:
        entries = self.o.notebook
        item = action.get("item")
        chosen = next((e for e in entries if e["id"] == item), None) if item else None
        if chosen is None and entries:
            chosen = entries[0]
            self.guess(
                plan.task["id"], "entry", "the card names no entry of the notebook: took the first"
            )
        if chosen is None:
            self.cannot(plan, "no_entry", "the notebook is empty, so there is nothing to tell")
            return "cannot"
        result, _ = yield from self.send(plan, "tell", entry=chosen["id"], how="faithful")
        return "done" if result == "applied" else "rejected"

    # ------------------------------------------------------------------ the rest of the verbs

    def do_look(self, plan: Plan) -> Steps:
        action = plan.task["action"]
        assert action is not None
        target = action.get("item") or action.get("place") or ""
        place = action.get("place") or (plan.task["window"] or {}).get("place") or ""
        out_of_reach = target not in self.o.me["look"] and place and not self.at_place(place)
        if out_of_reach and not (yield from self.walk_to(plan, place)):
            return "cannot"
        result, _ = yield from self.send(plan, "look", at=target)
        if result != "applied":
            return "rejected"
        for _ in range(400):
            if self.o.me["activity"] != "work":
                break
            yield None
        return "done"

    def do_card(self, plan: Plan) -> Steps:
        """Fill in the statement card: in each part the option the notes favour."""
        if self.o.talking:
            yield from self.act("leave")
        card = self.o.frame["statement"]
        sent = 0
        for part, option in changes(card, self.rejected):
            result, _ = yield from self.send(
                plan, "statement", op="choose", part=part, option=option
            )
            if result != "applied":
                return "rejected"
            sent += 1
        return "done" if sent else "cannot"

    def do_listen(self, plan: Plan) -> Steps:
        out_of_hearing = (
            "listen" not in self.o.verbs and plan.place and not self.at_place(plan.place)
        )
        if out_of_hearing and not (yield from self.walk_to(plan, plan.place)):
            return "cannot"
        result, _ = yield from self.send(plan, "listen")
        return "done" if result == "applied" else "rejected"

    def do_rally(self, plan: Plan) -> Steps:
        result, _ = yield from self.send(plan, "rally")
        return "done" if result == "applied" else "rejected"

    # ------------------------------------------------------------------ speaking in public

    def do_public(self, plan: Plan) -> Steps:
        action = plan.task["action"]
        assert action is not None
        fields = yield from self.speech(plan, action.get("kind"))
        if fields is None:
            return "cannot"
        result, reason = yield from self.send(plan, "speak", **fields)
        if fields.get("kind") == "clarify" and (result == "applied" or reason == "said_already"):
            self._spent.append((fields["basis"][0], fields["claim"]))  # the next pair, next time
        return "done" if result == "applied" else "rejected"

    def speech(self, plan: Plan, kind: str | None) -> Steps:
        """The fields of the speech the card asks for, from what the frame offers, or None."""
        offers = self.o.offers("speak")
        task = plan.task["id"]
        if kind is None:
            self.guess(
                task,
                "speech",
                "the card says speak and names no kind: judged lines first, else what is offered",
            )
            if self.pair() is not None or not offers:
                kind = "clarify"
        if kind == "clarify":
            if self.pair() is None:
                yield from self.press_hint(plan)
            pair = self.pair()
            if pair is None:
                self.cannot(
                    plan,
                    "no_pair",
                    "the card says to clear it up and no pair of lines has been judged",
                )
                return None
            return {
                "kind": "clarify",
                "claim": pair["b"],
                "basis": [pair["a"]],
                "judgment": pair["relation"],
            }
        if kind == "statement":
            yield from self.fill_the_card()  # with the latest notes, and the next best for a part
            for offer in self.o.offers("speak"):  # that did not hold
                if offer["body"].get("kind") == "statement":
                    return offer["body"]
            self.cannot(plan, "no_offer", "the card says to state, and no statement is offered")
            return None
        if kind not in (None, "evidence", "meal"):
            self.cannot(plan, "unknown_kind", f"the bot does not know how to speak as {kind!r}")
            return None
        wanted = "meal" if kind == "meal" else "evidence"
        for offer in offers:
            if offer["body"].get("kind") == wanted and "evidence" not in offer["body"]:
                return offer["body"]
        if kind is None and offers:
            return offers[0]["body"]
        have = ", ".join(o["id"] for o in offers) or "none"
        self.cannot(plan, "no_offer", f"nothing to speak of as {wanted}: the offers are {have}")
        return None

    def pair(self) -> dict[str, Any] | None:
        """The first judged pair not yet said in public, else the first."""
        judged = self.o.frame.get("judgments") or []
        for j in judged:
            if (j["a"], j["b"]) not in self._spent:
                return j
        return judged[0] if judged else None

    # ------------------------------------------------------------------ the hint button

    def do_notebook(self, plan: Plan) -> Steps:
        self.guess(
            plan.task["id"],
            "notebook",
            "the card has no action and no time: pressed the hint button",
        )
        before = self.pairs_judged
        yield from self.press_hint(plan)
        return "done" if self.pairs_judged > before else "cannot"

    def press_hint(self, plan: Plan) -> Steps:
        """Ask for a hint, then again for how the two lines stand, and judge them as it says."""
        for _ in range(4):
            if "hint" not in self.o.verbs:
                return
            yield from self.act("hint")
            hint = self.o.frame.get("hint")
            if hint is None:
                self._no_pair_at = self.notebook_state()
                return
            if hint.get("relation") is None:
                yield from self.act("hint")
                hint = self.o.frame.get("hint")
                if hint is None or hint.get("relation") is None:
                    return
            result, _ = yield from self.send(
                plan, "judge", a=hint["a"], b=hint["b"], relation=hint["relation"]
            )
            if result != "applied":
                return
            self.pairs_judged += 1


def _short(fields: dict[str, Any]) -> str:
    return " ".join(f"{k}={v}" for k, v in fields.items())
