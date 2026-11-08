"""Promises made to the manager: what a person agreed to bring to the bridge, and by when.

*Promising.* A person who agrees to carry goods (``entrust`` of the kind ``material``, which ends in
``goals.agree_material``: Granny Li's ``lend`` only gives the nod, the bamboo is Li Da's to bring,
see ``objection``) does not set out in that tick if the game was made with the config ``goods`` set
to ``promised`` (``api.preset("slice")`` is). They promise a batch for a time. The batch is the
amount the script gives for the item (``batches``: four poles of bamboo, "the first batch"), or what
the bridge still lacks if that is less, or all of it for an item with no batch. The time is a rule
of the script (``due``): a promise made before 15:00 falls due the same day, two hours later on the
hour, and one made from 15:00 on falls due the next day at 07:00 (``due_of``). A promise is made
when the act that asks for it is over, since the world pays for the minutes of the act first
(``pace``): a yes at ten to three to a request that takes twenty minutes is made at ten past, and
falls due the next day. A game without the config key has the goods carried at once
(``goals_work.agree_material``).

*Keeping.* The person sets out at 06:00 of the day the promise falls due, or at once if that hour
has passed, with the errand ``carry`` of ``tasks`` for the amount (the errand is stamped with the
number of the promise, and its ``delivered`` event says so, see below). When the goods lie at the
bridge the promise is *delivered*. A promise that is not delivered three hours after it fell due
is *broken*, with a reason: ``rain`` if it is a heavy rain that day, else ``late``; or ``failed``
at once if the errand failed. A broken promise is not a broken pledge of the manager: nothing of
``pledges`` and no one's trust in the manager is touched. ``withdraw`` takes a promise back before
the person has set out (``withdrawn``). Goods that arrive after the promise was broken are at the
bridge all the same, and ``site`` shows them.

State (``state["world"]["commitments"]``)::

    {"list": [promise, ...],     in the order they were made
     "seq": the number of the next promise,
     "journal": [[number, kind, tick, fields]],   the events the recap is made from
     "seen": the number of the last event that went into the journal,
     "recap": {"day": the day of the last recap (0: none yet), "tick": its tick, "lines": [line],
               "news"?, "street"?, "talk"?: the paper of that morning, see ``gazette``}}

A promise is ``{"id": "m1", "by": npc, "item", "amount", "made": tick, "due": {"day", "hour"},
"start": the tick the person sets out, "due_at": tick, "late_at": the tick it is broken, "task":
the errand once the person has set out, else 0, "state": promised | delivered | broken |
withdrawn, "reason": a key of the reasons of the script, or "", "ended": tick or -1}``.

Events. ``commitment`` (``id``, ``by``, ``state``, ``item``, ``amount``, ``reason``) when a
promise is made (``promised``), broken or taken back (``withdrawn``). ``agreed`` (``npc``,
``what``) as ever, when the person agrees. And ``delivered``, the event of ``tasks`` for the
errand, which for one that keeps a promise has the ``id`` of it and the ``amount`` too: a promise
that is kept is told by that event alone. ``recap`` (``lines``) when the recap is made.

The frame. ``commitments`` is ``[{"id", "by", "to": "player", "what": {"zh", "en"}, "item",
"amount", "due": {"day", "hour"}, "state", "reason": {"zh", "en"} | null}]``, every promise made,
in order. ``site`` is ``{"bamboo": int, "timber": int}``, what lies at the bridge, whoever brought
it. ``recap`` is ``[{"text": {"zh", "en"}, "events": [number]}]`` or null. All three are in every
frame of every game; a game that carries its goods at once has no promises, and a ``site`` of what
was carried.

The recap. At ``recap_hour`` (07:00) of each morning from the second day the lines are made from the
events since the last recap, at most three: one of each kind and then more of them in turn, in this
order of kinds. A delivery (a promise kept), a person who withdrew an objection or changed their
mind in public (the events ``objection_withdrawn`` and ``clarified``, see ``objection`` and
``clarify``), and a promise made. The words are templates of the script. Each line points at the
events it is made from by their numbers, which are the state version when the event was emitted (the
first event of a game is 1, and a signal such as ``replied`` has none). The frame of the call that
made the recap has it, and every frame after that null. The event ``recap`` says so.

The paper. The recap is also the paper of the morning (``gazette``): in the same tick the record of
the recap keeps ``news`` (the headline and two short items, which also carry the lines of the
recap's kinds), ``street`` (how the townsfolk without names stood) and ``talk`` (the kinds of the
lines of street talk). The frame key ``gazette`` has them in the frame of the call that made them,
with what is to be done today; ``recap`` is as it was, for a page that does not know the paper.

The term of the tasks ``commitment`` (``by``, ``item``, ``state``) holds when a promise like that
is in that state (``agenda_terms``): ``t_li_da_promise`` appears with the promise, and
``t_bamboo_first`` is done with the delivery. With ``latest`` it holds for the newest promise of
that person for that item alone, which is how a task follows each batch in turn.

*Later batches.* A person who has kept a promise, or broken it, or taken it back, and whose goods
the bridge still lacks, can be asked again: the request is a new question (the situation it is
weighed in has the number of the promises they have made and the state of the last, ``round_mark``,
see ``entrust``), and if they agree they promise the next batch, up to what the bridge still lacks.
While a promise of theirs is open, a request is answered by saying so (``standing``): the line
``promise_open`` names the amount, the item and the day and hour, and the preview says the same.
When the bridge has all it needs of the item the answer is ``goods_enough``. Both are the
``said_already`` of the action, with their own words.
"""

from __future__ import annotations

import functools
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import (
    agenda_terms,
    clock,
    goals_work,
    numerals,
    tasks,
    voices,
    weather,
)
from lantern_core.world.bridge.data import CAST, SCRIPT

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "commitments"

PROMISED, DELIVERED, BROKEN, WITHDRAWN = "promised", "delivered", "broken", "withdrawn"
STATES = (PROMISED, DELIVERED, BROKEN, WITHDRAWN)
GOODS = ("at_once", "promised")  # the values of the config key ``goods``
FIRST_BATCH = {"bamboo": 4}  # what the script is taken to say if it says nothing of an item
RECAP_LINES = 3
ARRIVAL_TICKS = 60  # how long the word of the person who brought the goods stays over their head
SIGNALS = ("replied",)  # events that the state does not count (``Ctx.signal``)
KINDS = ("delivery", "stance", "promise")  # the kinds of line of the recap, most important first
NO_TASK = 0
OPEN, ENOUGH = PROMISED, "enough"  # how a supplier stands: a promise of theirs is open, or no need
PROMISE_OPEN, GOODS_ENOUGH = "promise_open", "goods_enough"  # the fixed lines of ``phrases``
NUMERALS = numerals.DIGITS  # the digits of a day: 第二日


# ---------------------------------------------------------------------------- the script


@dataclass(frozen=True, slots=True)
class Rules:
    """The ``commitments`` of the script: when a promise falls due, what is promised, the words."""

    batches: dict[str, int]
    cutoff: int
    soon: int
    late: int
    start: int
    grace: int
    recap_hour: int
    what: dict[str, str]
    reasons: dict[str, dict[str, str]]
    recap: dict[str, dict[str, str]]


@functools.cache
def rules() -> Rules:
    raw = SCRIPT.get("commitments")
    if not raw:
        raise KeyError("the script has no commitments")
    due = raw["due"]
    return Rules(
        {**FIRST_BATCH, **raw.get("batches", {})},
        due["cutoff"],
        due["soon"],
        due["late"],
        raw["start"],
        raw["grace"],
        raw["recap_hour"],
        raw["what"],
        raw["reasons"],
        raw["recap"],
    )


def promises_goods(world: BridgeWorld) -> bool:
    """Whether this game has the goods promised for a time and not carried at once."""
    return world.config.get("goods") == "promised"


# ---------------------------------------------------------------------------- the section


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    return {
        "list": [],
        "seq": 1,
        "journal": [],
        "seen": 0,
        "recap": {"day": 0, "tick": -1, "lines": []},
    }


def tick_of(day: int, hour: int) -> int:
    """The tick at which the clock reads ``hour`` o'clock of game day ``day``. The hours after
    midnight are 24 to 29, since the night belongs to the day before it."""
    return (day - 1) * clock.CYCLE_TICKS + clock.hour_start(hour)


def due_of(now: clock.Now) -> tuple[int, int]:
    """The day and the hour a promise made at ``now`` falls due, by the rule of the script."""
    rule = rules()
    if now.phase == clock.DAY and now.hour < rule.cutoff:
        past = now.phase_tick % clock.DAY_TICKS_PER_HOUR
        return now.day, now.hour + rule.soon + (1 if past else 0)
    return now.day + 1, rule.late


def site(world_state: dict[str, Any]) -> dict[str, int]:
    """What lies at the bridge: the bamboo and the timber, whoever brought them."""
    lying = world_state["tasks"]["stock"].get(goals_work.BRIDGE, {})
    return {item: int(lying.get(item, 0)) for item in ("bamboo", "timber")}


def batch_for(item: str, lacking: int) -> int:
    """How much a promise of ``item`` is for when the bridge lacks ``lacking`` of it."""
    return min(rules().batches.get(item, lacking), lacking)


def promises_of(world_state: dict[str, Any], person: str, item: str) -> list[dict[str, Any]]:
    """The promises ``person`` made for ``item``, in the order they made them."""
    return [r for r in world_state[SECTION]["list"] if r["by"] == person and r["item"] == item]


def standing(world_state: dict[str, Any], person: str) -> tuple[str, dict[str, Any] | None] | None:
    """How a request for the goods stands with ``person``, before anything is weighed: ``("enough",
    None)`` when the bridge has all it needs of what they bring, ``("promised", row)`` when a
    promise of theirs for it is still open (the newest one), and None when they can be asked: they
    bring nothing, the game ended, or the bridge lacks the item and they have promised nothing open.
    It only reads."""
    supplier = goals_work.SUPPLIERS.get(person)
    if supplier is None or world_state["goals"].get("ending"):
        return None
    item = supplier[0]
    if site(world_state)[item] >= goals_work.NEED[item]:
        return ENOUGH, None
    for row in reversed(promises_of(world_state, person, item)):
        if row["state"] == PROMISED:
            return OPEN, row
    return None


def round_mark(world_state: dict[str, Any], person: str) -> str:
    """What the promises of ``person`` add to the situation a request for the goods is weighed in:
    ``p2:delivered``, the number of the promises they made for the item and the state of the last.
    Nothing before they made one, so that the first request is the plain one. A request that
    is put again after a delivery, a break or a taking back is then a new question and not the same
    one asked twice."""
    supplier = goals_work.SUPPLIERS.get(person)
    if supplier is None:
        return ""
    rows = promises_of(world_state, person, supplier[0])
    return f"p{len(rows)}:{rows[-1]['state']}" if rows else ""


def terms(world_state: dict[str, Any], now: clock.Now, person: str) -> dict[str, Any] | None:
    """What ``person`` would promise if they agreed now, without making the promise: the ``item``,
    the ``amount`` and the ``day`` and ``hour`` it would fall due. None where they would promise
    nothing: they bring nothing, have a promise open already, the bridge lacks none of it, or the
    game ended. It only reads (``promise`` makes what it says, and the preview of a request says
    when the goods would come)."""
    supplier = goals_work.SUPPLIERS.get(person)
    if supplier is None or world_state["goals"]["ending"]:
        return None
    item = supplier[0]
    rows = world_state[SECTION]["list"]
    if any(r["by"] == person and r["item"] == item and r["state"] == PROMISED for r in rows):
        return None
    open_amount = sum(r["amount"] for r in rows if r["item"] == item and r["state"] == PROMISED)
    lacking = goals_work.NEED[item] - site(world_state)[item] - open_amount
    if lacking <= 0:
        return None
    day, hour = due_of(now)
    return {"item": item, "amount": batch_for(item, lacking), "day": day, "hour": hour}


def promise(sim: Sim, g: dict[str, Any], person: str) -> int:
    """``person`` promises the bamboo or the timber that they keep, for a time.

    The promise is made when the act that asks for it is over, so the time it falls due is counted
    from the clock as it will stand once the world has paid for the act (and for whatever it still
    owed): the minutes of the act can take the hour across the cutoff, or across the hour that the
    time is rounded up to. The person sets out then, if that is later than the hour they set out at.

    The number of the promise (``m3`` is 3), or 0 if ``person`` brings nothing, has a promise open
    already, the bridge lacks none of it, or the game ended.
    """
    after = clock.after(sim.state, sim.ctx.tick, sim.act_seconds)
    offer = terms(sim.state, after, person)
    if offer is None:
        return 0
    item, day, hour = offer["item"], offer["day"], offer["hour"]
    section = sim.state[SECTION]
    rows = section["list"]
    tick = sim.ctx.tick
    number = section["seq"]
    section["seq"] = number + 1
    row = {
        "id": f"m{number}",
        "by": person,
        "item": item,
        "amount": offer["amount"],
        "made": tick,
        "due": {"day": day, "hour": hour},
        "start": max(after.tick, tick_of(day, rules().start)),
        "due_at": tick_of(day, hour),
        "late_at": tick_of(day, hour + rules().grace),
        "task": NO_TASK,
        "state": PROMISED,
        "reason": "",
        "ended": -1,
    }
    rows.append(row)
    sim.emit("agreed", npc=person, what=item)
    _announce(sim, row)
    return number


def _announce(sim: Sim, row: dict[str, Any]) -> None:
    sim.emit(
        "commitment",
        id=row["id"],
        by=row["by"],
        state=row["state"],
        item=row["item"],
        amount=row["amount"],
        reason=row["reason"],
    )


def find(world_state: dict[str, Any], promise_id: str) -> dict[str, Any] | None:
    for row in world_state[SECTION]["list"]:
        if row["id"] == promise_id:
            return row
    return None


def thanks(sim: Sim) -> str:
    """The code of the line a person says to a request they agreed to, when it made a promise this
    very tick that falls due on a later day: ``batch_promised``. Else the empty string."""
    tick, day = sim.ctx.tick, sim.now.day
    for row in reversed(sim.state[SECTION]["list"]):
        if row["made"] == tick and row["state"] == PROMISED:
            return "batch_promised" if row["due"]["day"] > day else ""
    return ""


def withdraw(sim: Sim, promise_id: str, reason: str = "taken_back") -> bool:
    """The person takes a promise back before they have set out. False if there is no such
    promise, it is not open, or the person is on the way."""
    row = find(sim.state, promise_id)
    if row is None or row["state"] != PROMISED or row["task"] != NO_TASK:
        return False
    _end(sim, row, WITHDRAWN, reason)
    return True


# ---------------------------------------------------------------------------- keeping


def _end(sim: Sim, row: dict[str, Any], state: str, reason: str = "") -> None:
    row["state"], row["reason"], row["ended"] = state, reason, sim.ctx.tick
    if state == BROKEN and row["task"] != NO_TASK:  # a late arrival is then an errand like any
        for errand in sim.state["tasks"]["queue"]:
            if errand["id"] == row["task"]:
                errand.pop("commit", None)
    if state != DELIVERED:  # the delivery is told by the event of the errand
        _announce(sim, row)


def _outcome(world_state: dict[str, Any], task_id: int) -> str | None:
    """How an errand ended, ``done`` or ``failed``, or None while it is in the queue."""
    section = world_state["tasks"]
    if any(errand["id"] == task_id for errand in section["queue"]):
        return None
    for errand in reversed(section["done"]):
        if errand["id"] == task_id:
            return str(errand["status"])
    return None


def _set_out(sim: Sim, row: dict[str, Any]) -> None:
    source = goals_work.SUPPLIERS[row["by"]][1]
    try:
        row["task"] = tasks.assign(
            sim.world,
            sim.state,
            {
                "npc": row["by"],
                "kind": "carry",
                "item": row["item"],
                "qty": row["amount"],
                "src": source,
                "dst": goals_work.BRIDGE,
                "commit": row["id"],
            },
        )
    except tasks.TaskError:
        _end(sim, row, BROKEN, "failed")


def _keep(sim: Sim, row: dict[str, Any]) -> None:
    tick = sim.ctx.tick
    if row["task"] == NO_TASK:
        if tick < row["start"]:
            return
        _set_out(sim, row)
        if row["state"] != PROMISED:
            return
    outcome = _outcome(sim.state, row["task"])
    if outcome == tasks.DONE:
        _end(sim, row, DELIVERED)
    elif outcome == tasks.FAILED:
        _end(sim, row, BROKEN, "failed")
    elif tick >= row["late_at"]:
        heavy = weather.today(sim.state) == weather.HEAVY_RAIN
        _end(sim, row, BROKEN, "rain" if heavy else "late")


def tick(sim: Sim) -> None:
    """One tick: the people set out, the goods arrive or do not, and in the morning the recap."""
    section = sim.state[SECTION]
    observe(sim)
    for row in section["list"]:
        if row["state"] == PROMISED:
            _keep(sim, row)
    _recap(sim, section)


# ---------------------------------------------------------------------------- words


def _person(world: BridgeWorld, npc: Any) -> dict[str, str]:
    index = world.cast.index.get(npc) if isinstance(npc, str) else None
    if index is None:
        return {"zh": str(npc), "en": str(npc)}
    person = world.cast.people[index]
    return {"zh": person.zh, "en": person.en}


def _item(world: BridgeWorld, item: Any) -> dict[str, str]:
    return item_words(item)


def _place(world: BridgeWorld, place: Any) -> dict[str, str]:
    found = world.town.places.get(place) if isinstance(place, str) else None
    return (
        {"zh": str(place), "en": str(place)} if found is None else {"zh": found.zh, "en": found.en}
    )


def item_words(item: Any) -> dict[str, str]:
    """The name of an item in both languages, the English in lower case, from the cast."""
    for row in CAST["items"]:
        if row["id"] == item:
            return {"zh": row["zh"], "en": row["en"].lower()}
    return {"zh": str(item), "en": str(item)}


def when_words(day: int, hour: int) -> dict[str, str]:
    """The day and the hour a promise falls due, as a person says them: 第二日07:00前, and by 07:00
    on day 2. The day is the number of the game day, so the words do not change as time passes."""
    numeral = NUMERALS[day] if 0 < day < len(NUMERALS) else str(day)
    return {"zh": f"第{numeral}日{hour:02d}:00前", "en": f"by {hour:02d}:00 on day {day}"}


def say_goods(
    world_state: dict[str, Any], said: dict[str, str], code: str, lead: str
) -> dict[str, str]:
    """The line ``code`` (``promise_open`` or ``goods_enough``) as ``said`` has it, with the slots
    filled in: the amount, the item and the day and hour of the promise whose number is ``lead``,
    or the item ``lead`` for the bridge that has enough of it. ``said`` is the plain words or the
    words of a person's voice, and the state keeps only the code and ``lead``."""
    if code == PROMISE_OPEN:
        row = find(world_state, lead)
        if row is not None:
            due = row["due"]
            return fill(
                said,
                amount=row["amount"],
                item=item_words(row["item"]),
                when=when_words(due["day"], due["hour"]),
            )
    return fill(said, item=item_words(lead))


def _said(value: Any, lang: str) -> str:
    """One value of ``fill`` in a language: its words, a count in characters in Chinese (四, 两,
    十二) and in digits in English, and any other text as it is."""
    if isinstance(value, dict):
        return str(value[lang])
    if lang == "zh" and type(value) is int:
        return numerals.zh_count(value)
    return str(value)


def fill(template: dict[str, str], **values: Any) -> dict[str, str]:
    """The template in both languages with ``values`` put in: a value is ``{"zh", "en"}``, or a
    count (``numerals.zh_count`` in Chinese, digits in English), or a text, which is the same in
    both."""
    out = {}
    for lang in ("zh", "en"):
        said = {k: _said(v, lang) for k, v in values.items()}
        out[lang] = template[lang].format(**said)
    return out


def wire(world: BridgeWorld, row: dict[str, Any]) -> dict[str, Any]:
    """A promise as the frame has it."""
    said = rules()
    why = row["reason"]
    return {
        "id": row["id"],
        "by": row["by"],
        "to": "player",
        "what": fill(
            said.what,
            amount=row["amount"],
            item=_item(world, row["item"]),
            place=_place(world, goals_work.BRIDGE),
        ),
        "item": row["item"],
        "amount": row["amount"],
        "due": {"day": row["due"]["day"], "hour": row["due"]["hour"]},
        "state": row["state"],
        "reason": dict(said.reasons[why]) if why else None,
    }


def agreed(world_state: dict[str, Any], person: str) -> list[str]:
    """The ids of the promises ``person`` made the manager, for the card of the person."""
    return [row["id"] for row in world_state[SECTION]["list"] if row["by"] == person]


# ---------------------------------------------------------------------------- the events


def numbered(sim: Sim) -> list[tuple[int, dict[str, Any]]]:
    """The events of this call so far, each with its number: the state version when it was emitted.
    A signal has no number, the state does not count it."""
    number = sim.ctx.state["version"]
    found = []
    for event in reversed(sim.ctx.events):
        if event["kind"] in SIGNALS:
            continue
        found.append((number, event))
        number -= 1
    found.reverse()
    return found


def _text(value: Any) -> bool:
    return isinstance(value, str) and value != ""


def _words(value: Any) -> dict[str, str] | None:
    """``{"zh", "en"}`` of two texts, as an event may carry them, else None."""
    if isinstance(value, dict) and _text(value.get("zh")) and _text(value.get("en")):
        return {"zh": value["zh"], "en": value["en"]}
    return None


def _note(event: dict[str, Any]) -> dict[str, Any] | None:
    """What the recap keeps of an event, or None if the recap has no use for it."""
    kind = event["kind"]
    if kind == "commitment" and event.get("state") == PROMISED:
        keep = ("id", "by", "item", "amount")
    elif kind == "delivered" and "id" in event:
        keep = ("id", "npc", "item", "amount", "place")
    elif kind == "objection_withdrawn":
        keep = ("npc",)
    elif kind == "eased":
        keep = ("act", "npc", "day")
    elif kind == "clarified":
        audience = event.get("audience")
        rows = audience if isinstance(audience, list) else []
        return {
            "audience": [
                {"npc": r["npc"], "before": r.get("before", ""), "after": r.get("after", "")}
                for r in rows
                if isinstance(r, dict) and _text(r.get("npc"))
            ]
        }
    else:
        return None
    note = {k: event[k] for k in keep if k in event}
    if kind == "objection_withdrawn":
        said = _words(event.get("what"))
        if said is not None:
            note["what"] = said
    return note


def observe(sim: Sim) -> None:
    """Take in the events of this call that the recap is made from, once each. The section changes
    only for such an event: ``seen`` is the number of the last one. ``agenda.refresh`` calls it at
    the end of every tick and after every action and result (the events of a call are gone with
    it), and the tick of this section calls it before it looks at the errands."""
    section = sim.state[SECTION]
    for number, event in numbered(sim):
        if number <= section["seen"]:
            continue
        note = _note(event)
        if note is not None:
            section["journal"].append([number, event["kind"], event["tick"], note])
            section["seen"] = number


# ---------------------------------------------------------------------------- the recap


def _join(names: list[dict[str, str]], lang: str) -> str:
    said = [n[lang] for n in names]
    if lang == "zh":
        return "、".join(said)
    return said[0] if len(said) == 1 else ", ".join(said[:-1]) + " and " + said[-1]


Found = dict[str, list[tuple[int, list[int], dict[str, str]]]]


def found(world: BridgeWorld, journal: list[list[Any]]) -> Found:
    """What the journal can say, by kind (``KINDS``), the newest first within a kind: for each
    ``(number, events, text)``, the number of the event it is about, the numbers of the events it is
    made from, and its words in both languages. A person who withdrew an objection comes before a
    claim that was set straight in public (both are of the kind ``stance``). It is the recap, and
    the paper (``gazette``) makes its items from the same lines."""
    said = rules().recap
    promised = {row[3]["id"]: row[0] for row in journal if row[1] == "commitment"}
    said_by_kind: Found = {k: [] for k in KINDS}
    clarified: list[tuple[int, list[int], dict[str, str]]] = []
    for number, kind, _, note in reversed(journal):
        if kind == "delivered":
            text = fill(
                said["delivery"],
                who=_person(world, note.get("npc")),
                amount=note.get("amount", 0),
                item=_item(world, note.get("item")),
                place=_place(world, note.get("place")),
            )
            cause = [promised[note["id"]]] if note.get("id") in promised else []
            said_by_kind["delivery"].append((number, [*cause, number], text))
        elif kind == "objection_withdrawn":
            who = _person(world, note.get("npc"))
            template = said["withdrawn"] if "what" in note else said["withdrawn_plain"]
            text = fill(template, who=who, what=note.get("what", ""))
            said_by_kind["stance"].append((number, [number], text))
        elif kind == "clarified":
            changed = [r for r in note["audience"] if r["before"] != r["after"]]
            if changed:
                names = [_person(world, r["npc"]) for r in changed[:3]]
                both = {lang: _join(names, lang) for lang in ("zh", "en")}
                clarified.append((number, [number], fill(said["clarified"], names=both)))
        elif kind == "commitment":
            text = fill(
                said["promise"],
                who=_person(world, note.get("by")),
                amount=note.get("amount", 0),
                item=_item(world, note.get("item")),
            )
            said_by_kind["promise"].append((number, [number], text))
    said_by_kind["stance"] += clarified
    return said_by_kind


def _lines(world: BridgeWorld, journal: list[list[Any]]) -> list[dict[str, Any]]:
    """The lines of the recap from the journal: one of each kind, the newest, and then more of each
    in turn, in the order of ``KINDS``, until there are ``RECAP_LINES`` or nothing is left. The
    lines come in the order of ``KINDS`` and, within a kind, of the events."""
    said = found(world, journal)
    picked: Found = {k: [] for k in KINDS}
    total = 0
    for round_ in range(RECAP_LINES):
        for kind in KINDS:
            if total < RECAP_LINES and round_ < len(said[kind]):
                picked[kind].append(said[kind][round_])
                total += 1
    return [
        {"text": text, "events": events}
        for kind in KINDS
        for _, events, text in sorted(picked[kind], key=lambda row: row[0])
    ]


def _recap(sim: Sim, section: dict[str, Any]) -> None:
    """At the hour of the recap, from the second day: make the lines and forget the journal."""
    now, last = sim.now, section["recap"]
    if now.phase != clock.DAY or now.day < 2 or now.hour < rules().recap_hour:
        return
    if last["day"] >= now.day:
        return
    from lantern_core.world.bridge import gazette  # not at the top: the paper reads this module

    observe(sim)
    journal = section["journal"]
    lines = _lines(sim.world, journal)
    record = {"day": now.day, "tick": sim.ctx.tick, "lines": lines}
    record.update(gazette.print_morning(sim, last, journal))  # the paper of the morning
    section["journal"] = []
    section["recap"] = record
    if lines:
        sim.emit("recap", lines=len(lines))


# ---------------------------------------------------------------------------- the frame


def shown(state: dict[str, Any], section: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The recap if the frame is the one the call that made it gives, else null."""
    last = section["recap"]
    if last["lines"] and state["tick"] == last["tick"] + 1:
        return [
            {"text": dict(line["text"]), "events": list(line["events"])} for line in last["lines"]
        ]
    return None


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """``commitments``, ``site`` and ``recap``, and the word of whoever brought the bamboo."""
    world_state = state["world"]
    section = world_state[SECTION]
    out["commitments"] = [wire(world, row) for row in section["list"]]
    out["site"] = site(world_state)
    out["recap"] = shown(state, section)
    now = state["tick"]
    for row in section["list"]:
        if (
            row["state"] == DELIVERED
            and row["item"] == "bamboo"
            and now < row["ended"] + ARRIVAL_TICKS
        ):
            until = row["ended"] + ARRIVAL_TICKS
            out["bubbles"] = [b for b in out["bubbles"] if b["npc"] != row["by"]]
            out["bubbles"].append(
                {
                    "npc": row["by"],
                    "until": until,
                    "text": voices.phrase(row["by"], "bamboo_arrived", until),
                }
            )


# ---------------------------------------------------------------------------- the term of the tasks


def _holds(env: agenda_terms.Env, cond: dict[str, Any]) -> bool:
    """``commitment``: somebody has a promise to the manager for that item in that state, or with
    ``latest`` the newest promise of theirs for that item is in that state."""
    rows = promises_of(env.state, cond["by"], cond["item"])
    if cond.get("latest"):
        rows = rows[-1:]
    return any(row["state"] == cond["state"] for row in rows)


agenda_terms.implement("commitment", _holds)
