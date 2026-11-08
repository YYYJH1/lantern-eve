"""The tasks: what the player is told to do, which of them they follow, and what they have learned.

The script lists tasks (``tasks`` in ``content/scripts/broken_bridge.yaml``). Each says what it is
(``kind``: a thing to get, a lead, a promise somebody made, an obstacle, an occasion; ``job``: the
bridge, the truth or the peace), how urgent it is (``priority``, the smaller the more), the words
for it in both languages (``text``, ``why``, ``next``), what a click on it does (``action``), and
when it appears, is blocked, is done or goes stale, in the conditions of ``agenda_terms``. This
section keeps where each task stands, and which one the player follows.

State (``state["world"]["agenda"]``)::

    {"tasks": {id: {"state": open | blocked | done | stale,    only the tasks that have appeared
                    "since": the tick it came to that state,
                    "rule": which of the ``blocked`` rules of the task holds, else -1,
                    "why", "next", "act": which option of each is on show, else -1}},
     "tracked": id             the task that is followed, "" for none,
     "picked": true            there only while the player picked the task that is followed,
     "wants": {id: tick}       the wants of the script the player has learned,
     "seen": [[event, tick, {field: value}]]   the events the conditions ask about, as they came,
     "mark": [...]             what the section last looked at (see ``refresh``)}

A task appears once its ``appears`` holds, and stays. It is *done* when its ``done`` holds and
*stale* when its ``stale`` holds (no condition at all is never), and then it stays so. A task with
``again`` opens again, as a new round, when its ``appears`` holds once more after it ended and it
would be open or blocked (the promise of the batch that follows the one that was kept: its terms
read the newest promise, ``commitment`` with ``latest``). Otherwise it
is *blocked* by the first of its ``blocked`` rules whose conditions hold, or *open*. The ``why``,
``next`` and ``action`` on show are the first option of each whose conditions hold, those of the
rule that blocks the task in place of the task's own where the rule has them. An action whose person
is ``$frontier`` is ``ask_source`` of whoever the trail of the first note of the props it follows
leaves to ask, and one whose person is ``$helper`` is a request to join, or a promise, to the
person the manager is to ask next (``helper``). A task with no option of ``action`` that holds has
no action, and that is how a task that is open says there is nothing to do but wait (the bamboo,
once Li Da has promised it).

The words (``why``, ``next`` and the blocker) may write a number the player can see in braces:
``{bamboo_site}`` and the like, put in when the frame is made (``agenda_facts``).

The manager's promises. Each of the first ``pledges.CARDS`` promises the manager makes (``pledges``)
has a task of its own, ``t_keep_1`` and so on, which the script writes once as a template and the
compiled script has twenty times (``pledge`` is the number of the promise it is about). The task
appears when the promise is made, with the person, what was promised and the day it is to be kept
by in its words, and it has the day for its window: the person's routine says where they are that
day, and from the morning of the day it is due the task has the action, ``promise`` with ``kind:
keep`` and the number of the promise as the ``item`` (a person is named by ``$pledgeN`` in the
script), so it is the task that is followed then, after those whose own hours are now. It is done
when the promise is kept and stale when it is broken, and then the bar says what it cost
(``lapse``, in the words of the task).

Waiting on a person. A task that has asked a person for something is blocked while the last answer
was a no and asking again would only get "I have said it already" (``turned_down``, ``entrust``),
or, for a request to join, while the person has answered and nothing has been promised them since
(``helper_waits``). The card then says to promise them something, as long as ``can_promise``
holds (the manager has something left to promise and has made them fewer than ``PROMISE_LIMIT``
promises since they were first asked), and after that to wait until more of the town is behind the
manager. A promise, a favour or a friend who joined moves a number of the score, the same request
is a new question, and the task is open again.

Following a task. The player picks one with the action ``track`` (``{"task": id}``), which costs no
time and is answered ``applied``, or ``rejected`` as ``unknown_task`` (there is no such task, or it
has not appeared) or ``not_open`` (it is done or stale). A task the player picked stays the one
followed until it is done or stale, or the player picks another (``picked``, in the section while
it holds). Otherwise the core follows the task that is best to follow now, which it works out each
time it looks (``standing``). First comes a task whose time is now: the window that the clock sets,
that of the promise it waits on or its own, is open, and there is something to do in it (an action
on show, or the delivery of a promise to be there for), the one that closes soonest first. Then
comes the most urgent task with an action on show now. Last come the tasks that only wait, those
with a window still to come first, the one that opens soonest, then the most urgent. The task
followed is changed when another stands better: when it is done or stale, when it only waits and
another does not, when another's time has come, and when another with an action is more urgent.
The game starts following the first. Every change is the event ``task_changed`` (``from``, ``to``,
``reason`` in both languages, ``cause``: ``chosen``, ``done``, ``stale``, ``new``, ``waiting``
where the task followed turned to waiting, ``window`` where the time of another has come and
``ready`` where another with something to do is more urgent), with ``from`` and ``to`` null where
there is no task.

When it looks. ``refresh`` runs at the end of every tick, after every action of the player and
after a model's result, and only when something has moved since it last looked: the number of
events (``state["version"]``), the hour of the clock, or the cell the player stands on. A term
may read only what changes along with one of those (``agenda_terms``). Each run also hands the
events of the call so far to ``commitments.observe``, which keeps the ones its recap is made from.

The frame. ``tasks`` lists the tasks that have appeared, the most urgent first, each ``{"id",
"kind", "job", "text", "why", "next", "state", "blocker", "action", "window"}`` as the contract has
it (``why``, ``next``, ``blocker`` and ``action`` are null where the task has none or is not open
or blocked, ``action`` is ``{"verb", "npc"?, "place"?, "item"?, "request"?, "kind"?, "target"?}``,
``window`` is ``{"day", "from", "to", "place"}`` in whole hours). The ``request`` of an action is,
for the verb ``entrust``, the kind of request (``material``, ``lane``, ``testify``, ``lend``,
``join``, ``persuade`` or ``convene``; with only an ``item`` it is ``material``), the ``kind`` is,
for the verb ``speak``, ``evidence``, ``meal``, ``clarify`` or ``statement``, and the ``target`` is,
for the request ``persuade``, the person to be talked round. All three are as the script has them,
and left out where it names none. The ``item`` of an ``ask`` is the topic, that of a ``look`` the
thing (with its ``place``, where it lies), and that of a ``tell`` the note to tell: the script names
its prop and the frame its entry in the notebook (an option whose note is not there is not usable).
The verbs ``judge`` and ``state`` have the lines of the notebook set side by side and the statement
card to fill in, and name nothing. The window is when and where the task can be done
(``when_and_where``): for a task that waits on an open promise
(a ``commitment`` term of the reason on show, or of its appearance, names it), the time and place
of the promise, from the hour the person sets out to the hour it is due, at the bridge; else the
task's own ``window`` of the script, which with no ``day`` is the same hours every day and shows
the next of them; else, for a task that is open or blocked and whose action names a person, when
and where their routine has them up and about, which at night is the next morning. A time is
offered only where the act can be done then: a window of every day may keep to ``days``, ``[first,
last]``, the days on which the act is possible at all (the statement in public is made from the
fourth evening, so its window shows the fourth evening on the days before), and has ``unless``,
conditions that spend today's time (a statement was made today, and no second is allowed; a heavy
rain keeps the helpers from the bridge): the window is then the next day's, or none for a window of
one day; and the card of a promise that falls due today has none once the stretch of today in which
the person is up and about is over. A task that is open or blocked and has people expected at the
place of its window by their routines also has ``expected``, ``[{"id", "from", "to"}]`` with the
times as minutes of the day (17:30 is 1050), where it shows a window.
``tracked`` is the id of the task that is followed, or null. ``cards`` is the card of each person
the player has met or heard of (see ``cards``). ``track`` is in ``hud.verbs`` while there is a task
that is not the one followed and could be.
"""

from __future__ import annotations

import functools
from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import (
    agenda_facts,
    agenda_terms,
    board,
    cards,
    clock,
    commitments,
    converse,
    goals,
    goals_call,
    goals_work,
    notebook,
    persuade,
    pledges,
)
from lantern_core.world.bridge.agenda_terms import Env
from lantern_core.world.bridge.data import SCRIPT

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.people import Cast
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "agenda"
LOOK_REFUSED = "look_refused"

OPEN, BLOCKED, DONE, STALE = "open", "blocked", "done", "stale"
LIVE = (OPEN, BLOCKED)
ENDED = (DONE, STALE)
FRONTIER = "$frontier"
HELPER = "$helper"
PLEDGE = "$pledge"  # followed by the number of the promise: the person it was made to
SLEEP = "sleep"  # the act of a routine in which nobody is to be found

# why the task that is followed changed, by the cause, with and without the one that follows it
REASONS: dict[str, tuple[dict[str, str], dict[str, str]]] = {
    "done": (
        {
            "zh": "「{old}」办成了，接着追踪「{new}」",
            "en": "“{old}” is done. Now following “{new}”",
        },
        {
            "zh": "「{old}」办成了，眼下没有别的事项",
            "en": "“{old}” is done. There is nothing else to follow for now",
        },
    ),
    "stale": (
        {
            "zh": "「{old}」已经过期，改追踪「{new}」",
            "en": "“{old}” has lapsed. Now following “{new}”",
        },
        {
            "zh": "「{old}」已经过期，眼下没有别的事项",
            "en": "“{old}” has lapsed. There is nothing else to follow for now",
        },
    ),
    "new": ({"zh": "有了新的事项：「{new}」", "en": "A new task: “{new}”"}, {"zh": "", "en": ""}),
    "chosen": ({"zh": "你改为追踪「{new}」", "en": "You now follow “{new}”"}, {"zh": "", "en": ""}),
    "waiting": (
        {
            "zh": "「{old}」眼下只能等，先看「{new}」",
            "en": "“{old}” can only wait for now. Now following “{new}”",
        },
        {"zh": "", "en": ""},
    ),
    "window": (
        {
            "zh": "「{new}」的时间到了，改追踪它",
            "en": "It is time for “{new}”. Now following it",
        },
        {"zh": "", "en": ""},
    ),
    "ready": (
        {
            "zh": "「{new}」有事可办了，改追踪它",
            "en": "There is something to do for “{new}” now. Now following it",
        },
        {"zh": "", "en": ""},
    ),
}


# ---------------------------------------------------------------------------- the content


class Book:
    """The tasks and the wants of the script, read once, and the events its conditions ask for."""

    __slots__ = ("by_id", "order", "record", "spot", "tasks", "wants")

    def __init__(self) -> None:
        self.tasks: tuple[dict[str, Any], ...] = tuple(SCRIPT["tasks"])
        self.wants: tuple[dict[str, Any], ...] = tuple(SCRIPT["wants"])
        self.by_id = {task["id"]: task for task in self.tasks}
        # the most urgent first, and in the order of the script among those as urgent
        self.order = tuple(
            task["id"]
            for _, _, task in sorted(
                (task["priority"], number, task) for number, task in enumerate(self.tasks)
            )
        )
        self.spot = {task_id: number for number, task_id in enumerate(self.order)}
        conds: list[dict[str, Any]] = []
        for task in self.tasks:
            conds += [*task["appears"], *task["done"], *task["stale"]]
            if task["window"] is not None:
                conds += task["window"].get("unless", [])
            for rule in task["blocked"]:
                conds += rule["when"]
                for name in ("why", "next", "action"):
                    conds += [c for option in rule[name] for c in option["when"]]
            for name in ("why", "next", "action"):
                conds += [c for option in task[name] for c in option["when"]]
        for want in self.wants:
            conds += want["learned"]
        self.record = {
            kind: tuple(sorted(fields)) for kind, fields in agenda_terms.recorded(conds).items()
        }


@functools.cache
def book() -> Book:
    """The content, built once per process. A test that changes a term clears it."""
    return Book()


# ---------------------------------------------------------------------------- the section


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: nothing has appeared, nothing is followed."""
    return {"tasks": {}, "tracked": "", "wants": {}, "seen": [], "mark": []}


def start(world: BridgeWorld, state: dict[str, Any]) -> None:
    """Look at the first moment of the game, once every section is there: the tasks that are in
    from the start appear and the first of them is followed (there is no event for that)."""
    settle(Env(world, state, clock.at(0)), state[SECTION], 0, None)


def tick(sim: Sim) -> None:
    refresh(sim)


def refresh(sim: Sim) -> None:
    """Take in what happened in this call and, if anything has moved, look at the tasks again."""
    section = sim.state[SECTION]
    if not section:  # a world that has not this subsystem has nothing to look at
        return
    commitments.observe(sim)  # the events of the call so far, for the recap of the morning
    record(sim, section)
    if section["mark"] == moved(sim):
        return
    settle(Env(sim.world, sim.state, sim.now), section, sim.ctx.tick, sim)
    section["mark"] = moved(sim)  # after: looking may have made an event


def moved(sim: Sim) -> list[int]:
    """What a look depends on: the events so far, the hour of the clock and the player's cell."""
    player, now = sim.state["player"], sim.now
    return [sim.ctx.state["version"], now.day, now.hour, player["x"], player["y"]]


def promised_to(world_state: dict[str, Any], person: str) -> int:
    """How many promises the manager has made to ``person``, kept or not."""
    return sum(1 for pledge in world_state["player"]["pledges"] if pledge["to"] == person)


def refusal_reason(world_state: dict[str, Any], event: dict[str, Any]) -> str:
    """The code of the fixed line that a person said when they turned the player down for good
    (``entrust``, ``persuade.refusal``): the state is what it was when they said it."""
    if event.get("result") != "hard":
        return ""
    hard = persuade.HARD.get((event.get("request"), event.get("detail")))
    return "" if hard is None else persuade.refusal(world_state, hard)


def record(sim: Sim, section: dict[str, Any]) -> None:
    """Keep the events of this call that a condition asks about, with the fields it reads, once
    for each different one. Looking at the same events twice adds nothing."""
    wanted = book().record
    if not wanted:
        return
    rows = section["seen"]
    for event in sim.ctx.events:
        names = wanted.get(event["kind"])
        if names is None:
            continue
        fields = {name: event[name] for name in names if name in event}
        if event["kind"] == agenda_terms.ENTRUSTED and "reason" in names:
            fields["reason"] = refusal_reason(sim.state, event)
        if event["kind"] == agenda_terms.ENTRUSTED and "pledges" in names:
            fields["pledges"] = promised_to(sim.state, event["npc"])  # when they answered
        if event["kind"] == LOOK_REFUSED and "pledges" in names:
            fields["pledges"] = promised_to(
                sim.state, event["npc"]
            )  # when they turned the look away
            fields["talked"] = sim.state["player"]["talked"][sim.world.cast.index[event["npc"]]]
        if not any(row[0] == event["kind"] and row[2] == fields for row in rows):
            rows.append([event["kind"], event["tick"], fields])


# ---------------------------------------------------------------------------- where tasks stand


def status(env: Env, task: dict[str, Any]) -> tuple[str, int]:
    """Where a task that has appeared stands: its state, and the rule that blocks it, else -1."""
    if task["done"] and agenda_terms.holds_all(env, task["done"]):
        return DONE, -1
    if task["stale"] and agenda_terms.holds_all(env, task["stale"]):
        return STALE, -1
    for number, rule in enumerate(task["blocked"]):
        if agenda_terms.holds_all(env, rule["when"]):
            return BLOCKED, number
    return OPEN, -1


def options_of(task: dict[str, Any], rule: int, name: str) -> list[dict[str, Any]]:
    """The options for ``why``, ``next`` or ``action`` that apply: the blocking rule's, if it has
    any, else the task's."""
    if rule >= 0 and task["blocked"][rule][name]:
        return list(task["blocked"][rule][name])
    return list(task[name])


def frontier(world_state: dict[str, Any], follow: list[str]) -> str | None:
    """The person the player has yet to ask along the trail of the first note of the props that
    has one (``notebook.frontier``)."""
    for entry in world_state["player"]["notebook"]:
        if entry["prop"] in follow:
            who = notebook.frontier(entry)
            if who is not None:
                return who
    return None


ENTRUSTED = agenda_terms.ENTRUSTED


NO = (*agenda_terms.REFUSALS, "said_already")  # the answers to a request to join that are a no
ANSWERED = (*NO, "agreed")  # and the yes, which is not a join yet when it is a yes to wait
PROMISE_LIMIT = 3  # promises to one person since they were first asked, past which the card goes on


def something_to_promise(world_state: dict[str, Any]) -> bool:
    """Whether the manager has anything left to promise: a stall, a role, a place in the
    programme, or coins."""
    have = pledges.left(world_state["player"])
    return bool(
        have["stall_front"] > 0
        or have["stall_back"] > 0
        or have["roles"]
        or have["slots"]
        or have["purse"] > 0
    )


def promises_since_asked(world_state: dict[str, Any], person: str) -> int:
    """How many promises the manager has made to ``person`` since the first time they asked them
    for anything (the first ``entrusted`` event the section keeps for them), or none if they never
    did."""
    for kind, _, fields in world_state[SECTION]["seen"]:
        if (
            kind in (ENTRUSTED, LOOK_REFUSED)
            and fields.get("npc") == person
            and "pledges" in fields
        ):
            return promised_to(world_state, person) - fields["pledges"]
    return 0


def unfinished_to_join(world_state: dict[str, Any], joined: set[str]) -> str | None:
    """The first person, in the order they were first asked, who has answered a request to join
    and has not joined: with a no, or with a yes that waits for others to go first. The card stays
    with them (a promise, and the request again) until they join, or until the manager has made
    them ``PROMISE_LIMIT`` promises since, or has nothing left to promise. The events the section
    keeps (the ``entrusted`` events, each different one once) say who was asked, what came of it,
    and how many promises the manager had made them when they answered."""
    first: dict[str, int] = {}
    for kind, _, fields in world_state[SECTION]["seen"]:
        if kind != ENTRUSTED or fields.get("request") != "join":
            continue
        if fields.get("result") in ANSWERED and fields["npc"] not in first:
            first[fields["npc"]] = fields.get("pledges") or 0
    if not first or not something_to_promise(world_state):
        return None
    return next(
        (
            who
            for who, before in first.items()
            if who not in joined and promised_to(world_state, who) - before < PROMISE_LIMIT
        ),
        None,
    )


def helper(world: BridgeWorld, world_state: dict[str, Any]) -> str | None:
    """The person to ask to join the helpers next, or None if every one has joined.

    A person who answered the request and has not joined comes first: the card goes on with them
    (promise them something, and ask again) and not with the next, who would answer the same.
    Else someone the manager has met comes before someone they have not, and among them a
    person of a family with nobody yet before the rest, then whoever knows the most people (it is
    a person known to many who brings others with them), then the cast order. A person the
    manager has asked already, and who has not joined, comes after everyone who was not asked. All
    of it is public (the cast, who joined, whom the manager talked to and what came of it), and
    none of it the trust or the thoughts of anyone."""
    if not goals.keeps_the_goals(world_state):
        return None
    call = world_state["goals"]["call"]
    lay = goals_call.lay(world)
    joined = set(goals_call.joined_ids(call))
    stuck = unfinished_to_join(world_state, joined)
    if stuck is not None:
        return stuck
    section = world_state["player"]
    _, per_family = goals_call.crew(world, call)
    needy = {family for family, count in per_family.items() if count == 0}
    left = [person for person in lay.helpers if person not in joined]
    fresh = [person for person in left if f"{person}|join|" not in section["asked"]]

    def order(person: str) -> tuple[bool, bool, int, int]:
        index = world.cast.index[person]
        return (
            not section["talked"][index],
            lay.family[person] not in needy,
            -len(lay.knows[person]),
            index,
        )

    pool = fresh or left
    return min(pool, key=order) if pool else None


def _helper_refused_records(cond: dict[str, Any]) -> dict[str, set[str]]:
    return {
        ENTRUSTED: {"npc", "request", "result", "pledges"},
        LOOK_REFUSED: {"npc", "pledges", "talked"},
    }


@agenda_terms.term("helper_waits", {}, _helper_refused_records)
def _helper_waits(env: Env, cond: dict[str, Any]) -> bool:
    """The person the manager is to ask next to join (``helper``) has answered the request, with a
    no or with a yes that waits, when as many promises were made to them as there are now: what is
    left to try is to promise them something. Once the manager has made one more promise to them,
    the request can be put again."""
    if not goals.keeps_the_goals(env.state):
        return False
    who = unfinished_to_join(env.state, set(goals_call.joined_ids(env.state["goals"]["call"])))
    if who is None:
        return False
    now = promised_to(env.state, who)
    return any(
        kind == ENTRUSTED
        and fields.get("npc") == who
        and fields.get("request") == "join"
        and fields.get("result") in ANSWERED
        and fields.get("pledges") == now
        for kind, _, fields in env.state[SECTION]["seen"]
    )


@agenda_terms.term("can_promise", {"npc": "person"}, _helper_refused_records)
def _can_promise(env: Env, cond: dict[str, Any]) -> bool:
    """The manager has something left to promise, and has made ``npc`` fewer than ``PROMISE_LIMIT``
    promises since they first asked them for anything: a promise is still worth trying, and past
    that the card says to wait until more has changed."""
    return (
        something_to_promise(env.state)
        and promises_since_asked(env.state, cond["npc"]) < PROMISE_LIMIT
    )


def pledge_row(world_state: dict[str, Any], npc: str) -> dict[str, Any] | None:
    """The promise that ``npc`` (``$pledge3``) names: the manager's third promise, or None."""
    return pledges.card_of(world_state["player"], int(npc[len(PLEDGE) :]))


def pledge_of(world_state: dict[str, Any], task: dict[str, Any]) -> dict[str, Any] | None:
    """The promise that a task keeps (it has the number of it as ``pledge``), or None."""
    number = task.get("pledge")
    return None if number is None else pledges.card_of(world_state["player"], number)


def usable(env: Env, option: dict[str, Any]) -> bool:
    if not agenda_terms.holds_all(env, option["when"]):
        return False
    if option["npc"] == FRONTIER:
        return frontier(env.state, option["follow"]) is not None
    if option["npc"] == HELPER:
        return helper(env.world, env.state) is not None
    if option["npc"] is not None and option["npc"].startswith(PLEDGE):
        return pledge_row(env.state, option["npc"]) is not None
    if option["verb"] == "tell" and option["item"] is not None:  # the note must be in the notebook
        return notebook.by_prop(env.state["player"], option["item"]) is not None
    return True


def first(env: Env, options: list[dict[str, Any]], action: bool = False) -> int:
    """The number of the first option that applies, else -1."""
    for number, option in enumerate(options):
        if usable(env, option) if action else agenda_terms.holds_all(env, option["when"]):
            return number
    return -1


def settle(env: Env, section: dict[str, Any], tick: int, sim: Sim | None) -> None:
    """Bring the tasks, the wants and the task that is followed up to date. With ``sim`` the change
    of the task that is followed is an event; the first look of a game has none."""
    rows = section["tasks"]
    lapsed: list[str] = []  # the tasks of promises that were not kept, as they lapse
    for task in book().tasks:
        row = rows.get(task["id"])
        if row is not None and row["state"] in ENDED:
            if not (task.get("again") and again(env, task)):
                continue
            row = None  # a new round of a task that opens again
        if row is None:
            if not agenda_terms.holds_all(env, task["appears"]):
                continue
            row = rows[task["id"]] = {
                "state": OPEN,
                "since": tick,
                "rule": -1,
                "why": -1,
                "next": -1,
                "act": -1,
            }
        state, rule = status(env, task)
        if state != row["state"]:
            row["state"], row["since"] = state, tick
            if state == STALE and task.get("lapse") is not None:
                lapsed.append(task["id"])
        row["rule"] = rule
        if state in LIVE:
            row["why"] = first(env, options_of(task, rule, "why"))
            row["next"] = first(env, options_of(task, rule, "next"))
            row["act"] = first(env, options_of(task, rule, "action"), action=True)
        else:
            row["why"] = row["next"] = row["act"] = -1
    for want in book().wants:
        if want["id"] not in section["wants"] and agenda_terms.holds_all(env, want["learned"]):
            section["wants"][want["id"]] = tick
    followed = section["tracked"]
    follow(env, section, sim)
    for task_id in lapsed:
        if task_id != followed:  # the bar of the task that was followed says it in its own change
            lapse(env, section, sim, task_id)


def again(env: Env, task: dict[str, Any]) -> bool:
    """Whether a task that ended and opens again does so now: its ``appears`` holds, and it would
    be open or blocked and not at once done or stale again."""
    return agenda_terms.holds_all(env, task["appears"]) and status(env, task)[0] in LIVE


NO_TIME = 10**9  # the place after every time of a window, for a task that has none to come
NOW, ACT, WAIT = 0, 1, 2  # the tiers of ``standing``


def clock_window(
    world: BridgeWorld,
    world_state: dict[str, Any],
    task: dict[str, Any],
    why: dict[str, Any] | None,
    tick: int,
) -> tuple[dict[str, Any] | None, bool]:
    """The window that the clock sets for a task, and whether it is that of a promise the task
    waits on: the time and place of the promise, else the task's own window of the script, which
    with no ``day`` shows the next of its hours. (The hours at which to find a person by their
    routine are not set by the clock: they are the same for most of the day.)"""
    if task.get("pledge") is not None:  # the day the promise is due, all of it
        row = pledge_of(world_state, task)
        if row is None or row["state"] != pledges.OPEN:
            return None, False
        whole_day = {"day": row["due"], "from": clock.DAWN_HOUR, "to": clock.DUSK_HOUR}
        return {**whole_day, "place": ""}, False
    promise = promise_waited(world_state, task, why)
    if promise is not None:
        return promise_window(promise), True
    own = task["window"]
    if own is None:
        return None, False
    if own["day"] is not None:  # a window of one day is not moved, but it is none once spent
        day = None if spent(world, world_state, own, clock.at(tick), own["day"]) else own["day"]
    else:
        day = next_day(world, own, tick, world_state)
    if day is None:
        return None, False
    return {"day": day, "from": own["from"], "to": own["to"], "place": own["place"]}, False


def standing(
    env: Env, task: dict[str, Any], row: dict[str, Any], tick: int
) -> tuple[int, int, int]:
    """How well a task that is open or blocked stands to be followed now, as ``(tier, time, spot)``
    where the smaller is the better.

    ``NOW``: its time is now. The window that the clock sets (``clock_window``) is open, and there
    is something to do in it: an action on show, or a promise to be there for when it is kept. Of
    those the window that closes soonest comes first (``time`` is its closing).
    ``ACT``: it has an action on show.
    ``WAIT``: it only waits. A task with a window still to come stands before one with none, the
    window that opens soonest first (``time`` is its opening, else ``NO_TIME``).
    Among equals the more urgent task, the one earlier in the order (``spot``), stands first."""
    spot = book().spot[task["id"]]
    why = pick(options_of(task, row["rule"], "why"), row["why"])
    window, promised = clock_window(env.world, env.state, task, why, tick)
    acts = row["act"] >= 0
    if window is None:
        return (ACT if acts else WAIT, 0 if acts else NO_TIME, spot)
    opens = agenda_terms.minute_at(window["day"], window["from"])
    closes = agenda_terms.minute_at(window["day"], window["to"])
    now = agenda_terms.minute_of(env.now)
    if opens <= now < closes and (acts or promised):
        return NOW, closes, spot
    if acts:
        return ACT, 0, spot
    return WAIT, opens if now < opens else NO_TIME, spot


def follow(env: Env, section: dict[str, Any], sim: Sim | None) -> None:
    """Follow another task if the one that is followed has ended, or if another stands better
    (``standing``), unless the player picked it: that stays until it ends or they pick another."""
    tracked = section["tracked"]
    row = section["tasks"].get(tracked) if tracked else None
    live = row is not None and row["state"] in LIVE
    if live and section.get("picked"):
        return
    tick = env.now.tick
    facts = agenda_facts.Facts(env.world, env.state)
    ranks = {
        task_id: standing(env, book().by_id[task_id], found, tick)
        for task_id in book().order
        if (found := section["tasks"].get(task_id)) is not None and found["state"] in LIVE
    }
    best = min(ranks, key=ranks.__getitem__) if ranks else ""
    if live:
        if not best or best == tracked or ranks[best] >= ranks[tracked]:
            return
        if ranks[best][0] == NOW:
            cause = "window"
        else:
            cause = "waiting" if ranks[tracked][0] == WAIT else "ready"
        change(section, sim, tracked, best, cause, facts)
        return
    section.pop("picked", None)
    if tracked:
        change(section, sim, tracked, best, row["state"] if row else "new", facts)
    elif best:
        change(section, sim, "", best, "new", facts)


# why the task of a promise that was not kept is no longer followed: what it cost (a sentence of
# its own, with its stop), then the next
LAPSED = (
    {"zh": "{lapse}改追踪「{new}」", "en": "{lapse} Now following “{new}”"},
    {"zh": "{lapse}", "en": "{lapse}"},
)


def reason(
    cause: str, old: str, new: str, facts: agenda_facts.Facts | None = None
) -> dict[str, str]:
    """Why the task that is followed changed, in both languages. ``facts`` fills the numbers of
    a title that has slots (the task of a promise names the person) and the words of what a promise
    that lapsed cost."""
    titles = book().by_id

    def title(task_id: str, lang: str) -> str:
        said = titles[task_id]["text"]
        if facts is not None and agenda_facts.has_slots(said):
            return agenda_facts.fill(said, facts)[lang]
        return said[lang]

    lapse = titles[old].get("lapse") if old and cause in ("stale", "lapsed") else None
    if lapse is not None and facts is not None:
        cost = agenda_facts.fill(lapse, facts)
        words = LAPSED[0] if new else LAPSED[1]
        return {
            lang: words[lang].format(lapse=cost[lang], new=title(new, lang) if new else "")
            for lang in ("zh", "en")
        }
    with_new, without = REASONS[cause]
    words = with_new if new else without
    return {
        lang: words[lang].format(
            old=title(old, lang) if old else "",
            new=title(new, lang) if new else "",
        )
        for lang in ("zh", "en")
    }


def lapse(env: Env, section: dict[str, Any], sim: Sim | None, task_id: str) -> None:
    """Say that a promise was not kept, and what it cost, when the task that is followed is
    another: the same event as a change of the task (``cause`` ``lapsed``), from the task that is
    followed to the same one, so that the page puts the words on its card."""
    if sim is None:
        return
    tracked = section["tracked"]
    facts = agenda_facts.Facts(env.world, env.state)
    sim.emit(
        "task_changed",
        **{"from": tracked or None, "to": tracked or None},
        reason=reason("lapsed", task_id, "", facts),
        cause="lapsed",
    )


def change(
    section: dict[str, Any],
    sim: Sim | None,
    old: str,
    new: str,
    cause: str,
    facts: agenda_facts.Facts | None = None,
) -> None:
    section["tracked"] = new
    if sim is not None:
        sim.emit(
            "task_changed",
            **{"from": old or None, "to": new or None, "reason": reason(cause, old, new, facts)},
            cause=cause,
        )


# ---------------------------------------------------------------------------- the action


def validate_track(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    out = converse.plain(body, "track")
    out["task"] = converse.id_field(body.get("task"), "player action track", "task")
    return out


def apply_track(sim: Sim, body: dict[str, Any]) -> None:
    """Follow another task. It costs no time, and changes nothing but which task is followed."""
    section = sim.state[SECTION]
    row = section["tasks"].get(body["task"])
    if row is None:
        return converse.ack(sim, body, "unknown_task")
    if row["state"] in ENDED:
        return converse.ack(sim, body, "not_open")
    if section["tracked"] != body["task"]:
        facts = agenda_facts.Facts(sim.world, sim.state)
        change(section, sim, section["tracked"], body["task"], "chosen", facts)
    section["picked"] = True
    converse.ack(sim, body)


ACTIONS = {"track": (validate_track, apply_track)}


def can_track(world_state: dict[str, Any]) -> bool:
    """Whether there is a task that the player could follow in place of the one they do."""
    section = world_state[SECTION]
    if not section:
        return False
    return any(
        task_id != section["tracked"]
        and (row := section["tasks"].get(task_id)) is not None
        and row["state"] in LIVE
        for task_id in book().order
    )


# ---------------------------------------------------------------------------- the frame


def words(option: dict[str, Any]) -> dict[str, str]:
    return {"zh": option["zh"], "en": option["en"]}


def action_of(
    world: BridgeWorld, world_state: dict[str, Any], option: dict[str, Any]
) -> dict[str, str]:
    """An action as the frame has it: the verb, and the person, place, item, request, kind and
    target it names. The script's own fields go through as they are."""
    out = {"verb": option["verb"]}
    npc = option["npc"]
    item = option["item"]
    if npc == FRONTIER:
        npc = frontier(world_state, option["follow"])
    elif npc == HELPER:
        npc = helper(world, world_state)
    elif npc is not None and npc.startswith(PLEDGE):
        row = pledge_row(world_state, npc)  # keep it: the person, and the number of the promise
        npc, item = (None, None) if row is None else (row["to"], row["id"])
    if (
        option["verb"] == "tell" and item is not None
    ):  # the script names the prop, the frame the note
        found = notebook.by_prop(world_state["player"], item)
        item = None if found is None else found["id"]
    for key, value in (
        ("npc", npc),
        ("place", option["place"]),
        ("item", item),
        ("request", option.get("request")),
        ("kind", option.get("kind")),
        ("target", option.get("target")),
    ):
        if value is not None:
            out[key] = value
    return out


def pick(options: list[dict[str, Any]], number: int) -> dict[str, Any] | None:
    return options[number] if 0 <= number < len(options) else None


def promise_waited(
    world_state: dict[str, Any], task: dict[str, Any], why: dict[str, Any] | None
) -> dict[str, Any] | None:
    """The open promise a task waits on: the latest one still ``promised`` of the person and the
    item that a ``commitment`` term of the reason on show names, or else a term of the task's
    appearance. None if there is no such promise open."""
    terms = [*(() if why is None else why["when"]), *task["appears"]]
    rows = world_state[commitments.SECTION]["list"]
    for term in terms:
        if term.get("kind") != "commitment" or term.get("state") != commitments.PROMISED:
            continue
        for row in reversed(rows):
            if (row["by"], row["item"], row["state"]) == (
                term["by"],
                term["item"],
                commitments.PROMISED,
            ):
                return row
    return None


def promise_window(row: dict[str, Any]) -> dict[str, Any]:
    """When and where a promise is kept: at the bridge, from the hour the person sets out to the
    hour it falls due."""
    due = row["due"]
    return {
        "day": due["day"],
        "from": clock.at(row["start"]).hour,
        "to": due["hour"],
        "place": goals_work.BRIDGE,
    }


def person_window(world: BridgeWorld, person: str, tick: int) -> dict[str, Any] | None:
    """When and where to find ``person`` up and about: the stretch of their routine at one place
    that is in force at ``tick``, from the start of its entry. Asleep, or at night for anyone not on
    the night shift (who is at home from nightfall, see ``people``), it is the next stretch after
    the night. A stretch ends where the routine takes the person elsewhere or to sleep, and at
    nightfall for anyone not on the night shift. None for a routine of sleep alone."""
    who = world.cast.people[world.cast.index[person]]
    routine, count = who.routine, len(who.routine)
    now = clock.at(tick)
    base, number = tick - now.cycle_tick, 0  # 06:00 of the game day, and the entry in force
    if now.phase == clock.NIGHT and not who.night_shift:
        base += clock.CYCLE_TICKS
    else:
        for i, (start, _act, _place) in enumerate(routine):
            if start > now.cycle_tick:
                break
            number = i

    def entry(k: int) -> tuple[int, str, str]:
        wraps, i = divmod(k, count)
        start, act, place = routine[i]
        return base + wraps * clock.CYCLE_TICKS + start, act, place

    first = next((k for k in range(number, number + count) if entry(k)[1] != SLEEP), None)
    if first is None:
        return None
    begin, _act, place = entry(first)
    last = first + 1
    while last < first + count and entry(last)[2] == place and entry(last)[1] != SLEEP:
        last += 1
    end = entry(last)[0]
    if not who.night_shift:
        end = min(end, begin - clock.at(begin).cycle_tick + clock.DAY_TICKS)
    start = clock.at(begin)
    return {"day": start.day, "from": start.hour, "to": clock.at(end).hour, "place": place}


def spent(
    world: BridgeWorld,
    world_state: dict[str, Any] | None,
    window: dict[str, Any],
    now: clock.Now,
    day: int,
) -> bool:
    """Whether the time of ``window`` on ``day`` is spent: it is today, and the conditions of its
    ``unless`` hold (the statement in public was made today, a heavy rain keeps the helpers from
    the bridge). Only today is looked at, for the state says nothing of a day to come."""
    unless = window.get("unless")
    if not unless or world_state is None or day != now.day:
        return False
    return agenda_terms.holds_all(Env(world, world_state, now), unless)


def next_day(
    world: BridgeWorld,
    window: dict[str, Any],
    tick: int,
    world_state: dict[str, Any] | None = None,
) -> int | None:
    """The day of the next time of a window of the script that has no day of its own, which is the
    same hours every day: today if they have not ended and are not spent (``spent``), else tomorrow,
    and never before the first of its ``days`` nor after the last (the last day of the game, for a
    window that names none). None where there is no such day."""
    now = clock.at(tick)
    first, last = window.get("days") or (1, world.config["days"])
    day = max(now.day, first)
    if day == now.day and (
        agenda_terms.minute_of(now) >= agenda_terms.minute_at(day, window["to"])
        or spent(world, world_state, window, now, day)
    ):
        day += 1
    return day if day <= min(last, world.config["days"]) else None


def when_and_where(
    world: BridgeWorld,
    world_state: dict[str, Any],
    task: dict[str, Any],
    why: dict[str, Any] | None,
    action: dict[str, str] | None,
    tick: int,
) -> dict[str, Any] | None:
    """The ``window`` of a task in the frame: the time and place of the promise it waits on, else
    its own window from the script, else, while it is open or blocked, when and where to find the
    person its action names."""
    if task.get("pledge") is not None:
        return pledge_where(world, world_state, task, tick)
    window, _ = clock_window(world, world_state, task, why, tick)
    if window is not None:
        return window
    if task["window"] is not None:  # its own window has no day left
        return None
    npc = None if action is None else action.get("npc")
    return None if npc is None else person_window(world, npc, tick)


def pledge_where(
    world: BridgeWorld, world_state: dict[str, Any], task: dict[str, Any], tick: int
) -> dict[str, Any] | None:
    """When and where to find the person a promise is to be kept to, while it is open: by their
    routine on the day it falls due, as far as that day has come, and else as they are now. After
    the last stretch of that day, when the person is at home for the night, there is none: the
    stretch of the next morning comes when the promise has lapsed."""
    row = pledge_of(world_state, task)
    if row is None or row["state"] != pledges.OPEN:
        return None
    dawn = agenda_facts.window_tick(row["due"], clock.DAWN_HOUR)
    found = person_window(world, row["to"], max(tick, dawn))
    return None if found is not None and found["day"] > row["due"] else found


def told(option: dict[str, Any], facts: agenda_facts.Facts) -> dict[str, str]:
    """The words of an option, with the numbers of the game put in where they write any."""
    said = words(option)
    return agenda_facts.fill(said, facts) if agenda_facts.has_slots(said) else said


def wire(
    world: BridgeWorld,
    world_state: dict[str, Any],
    task: dict[str, Any],
    row: dict[str, Any],
    tick: int,
    facts: agenda_facts.Facts | None = None,
) -> dict[str, Any]:
    """One task as the frame has it. ``facts`` is where the numbers in its words come from."""
    facts = facts or agenda_facts.Facts(world, world_state)
    live = row["state"] in LIVE
    rule = row["rule"]
    why = pick(options_of(task, rule, "why"), row["why"]) if live else None
    nxt = pick(options_of(task, rule, "next"), row["next"]) if live else None
    act = pick(options_of(task, rule, "action"), row["act"]) if live else None
    window = task["window"]
    action = None if act is None else action_of(world, world_state, act)
    blocker = task["blocked"][rule]["blocker"] if row["state"] == BLOCKED else None
    shown = when_and_where(world, world_state, task, why, action, tick)
    out: dict[str, Any] = {
        "id": task["id"],
        "kind": task["kind"],
        "job": task["job"],
        "text": told(task["text"], facts),
        "why": None if why is None else told(why, facts),
        "next": None if nxt is None else told(nxt, facts),
        "state": row["state"],
        "blocker": None if blocker is None else told(blocker, facts),
        "action": action,
        "window": shown,
    }
    # who is expected is told with a time and a place to find them at, and not without
    if live and task["expected"] is not None and window is not None and shown is not None:
        span = task["expected"]
        out["expected"] = list(expected(world.cast, window["place"], span["from"], span["to"]))
    return out


@functools.lru_cache(maxsize=64)
def expected(cast: Cast, place: str, begin: int, end: int) -> tuple[dict[str, Any], ...]:
    """The people whose routines have them at ``place`` between the minutes ``begin`` and ``end`` of
    the day, in cast order: ``{"id", "from", "to"}``, the first stretch of it, in minutes of the
    day. It is as static as the cast is, so what it returns is shared and not to be changed."""
    first_tick = (begin - 360) * clock.DAY_TICKS_PER_HOUR // 60
    last_tick = (end - 360) * clock.DAY_TICKS_PER_HOUR // 60
    found = []
    for person in cast.people:
        starts = [entry[0] for entry in person.routine]
        stretches = [
            (starts[i], starts[i + 1] if i + 1 < len(starts) else starts[0] + clock.CYCLE_TICKS, i)
            for i in range(len(starts))
        ]
        stretches.append((starts[-1] - clock.CYCLE_TICKS, starts[0], len(starts) - 1))
        for low, high, i in sorted(stretches):
            low, high = max(low, first_tick), min(high, last_tick)
            if person.routine[i][2] == place and low < high:
                start, stop = clock.at(low), clock.at(high)
                found.append(
                    {
                        "id": person.id,
                        "from": start.hour * 60 + start.minute,
                        "to": stop.hour * 60 + stop.minute,
                    }
                )
                break
    return tuple(found)


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """``tasks`` (those that have appeared, the most urgent first), ``tracked`` and ``cards``, and
    the ``board`` that shows how the three jobs stand (``board``)."""
    world_state = state["world"]
    section = world_state[SECTION]
    rows = section["tasks"]
    by_id = book().by_id
    facts = agenda_facts.Facts(world, world_state)
    out["tasks"] = [
        wire(world, world_state, by_id[task_id], rows[task_id], state["tick"], facts)
        for task_id in book().order
        if task_id in rows
    ]
    out["tracked"] = section["tracked"] or None
    out["cards"] = cards.wire(world, world_state, state["tick"])
    board.frame(world, state, out)
