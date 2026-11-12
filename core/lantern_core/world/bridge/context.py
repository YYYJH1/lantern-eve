"""What a talk puts forward first: the request to make, the return a person asks, the promises to
keep and the promise to offer, for a page that shows one thing at a time and the rest behind it.

Everything here is read from the state and the frame and changes nothing but one record (below): no
rule of the town is touched. The page has the full lists in ``player.offers`` (and the bots read
only those); this module picks from them, so that every route is still there. It adds these keys to
``player.talk``, in a talk with ``npc``::

    "ask_for"    the one request to put forward, an offer of ``entrust`` (``{"id", "label", "body",
                 "status", "for"}``, the label naming the person, ``for`` the task it serves), or
                 null if there is none
    "asks_more"  every other request of the offers of ``entrust``, in their order, each with its
                 ``status``
    "wants"      the return the person asks, or null (below)
    "keep"       the promise to ``npc`` to keep first, or null (below)
    "give"       the entry of "promise something" (below)
    "queue"      the context queue, the things to do with ``npc`` that are not a question, a
                 request, a telling or a farewell, in the order of the page: ``{"kind": "answer"}``
                 when ``npc`` waits for the manager's answer to what they asked, then
                 ``{"kind": "keep", ...}`` for each promise to keep, then ``{"kind": "give"}``
                 after a refusal for want of trust

*The request.* ``ask_for`` is picked from the requests ``npc`` can be asked (``offers.entrust``),
leaving out three kinds: what is done (the goods are all at the bridge, the lane is open, the bamboo
lent, all that ``npc`` has to tell in this game in hand, the clan called), what is agreed and waits
for its delivery (a promise of the goods that is open, or a yes won by a lie that waits), and what
``npc`` has turned down today (``said_no``). Of the rest it is first the request that the task
followed now (``tracked``, the red slip) asks for, and else the request of another task that is open
whose window closes first (a task with no window after those that have one, then in the order of
the tasks). With none it is null, and ``asks_more`` has all of them. Following another task
(``track``) changes what is put forward. ``status`` of a request is ``open``, ``done``, ``waiting``
(agreed, waits for delivery) or ``refused`` (turned down today), and a request with another status
than ``open`` is in ``asks_more`` all the same, so that it can be made again when what weighed on
it has changed.

*The return.* A person asks a return when they turned a request down for want of weight (the
score of ``persuade`` fell short, ``refused``), today, and the numbers have not moved since (the
request would only be answered with "I have said it already"), if the script gives them a return
(``ask`` of the cast, one promise: a stall, a role, a wage or a place in the programme) and the
manager still holds it. Of several such requests it is the one turned down last. ``wants`` is then
``{"key", "token", "asks", "request": offer, "offer": offer}``: the request they turned down
(``asks`` is its words, naming the person) and the promise to make, as an offer of ``promise``. The
promise is made with the action ``promise`` and its body; a promise moves the numbers (a promise in
hand counts, ``persuade.weigh``), so ``wants`` is gone and the request, put again or previewed again
(``preview``), is weighed anew. What is promised is counted for nothing until it is made. The return
asked is kept when it is asked (``note_ask``, called where the request is turned down), so that the
book of the people can say what each person asked after the talk is over (``encounters``); nothing
reads that record but the frame. ``token`` changes whenever the numbers move and the person turns
the request down again, so a page that has put the answer aside can tell a new question from the old
by ``key`` and ``token`` together (two requests weighed alike have one token).

*The promises to keep.* ``keep`` is the first of the promises to ``npc`` that are open, the earliest
due first (then the first made): ``{"kind": "keep", "pledge": id, "due": day, "early": bool, "what":
{"zh", "en"}, "offer"}`` with the offer of ``promise`` that keeps it. Every open promise can be kept
at once, early or on its day, so the queue lists them all.

*Promising something.* ``give`` is ``{"preferred", "more", "ways"}``: the return ``npc`` asks as an
offer of ``promise`` (null if the script gives none or the manager holds none of it), every other
promise the manager can make them (``more``, the offers of ``promise`` but for the ones that keep a
promise), and, when there is nothing at all to promise, the other ways open (``ways``, from
``WAYS``: ``clear_truth``, ``gift`` and ``ask_others``). The item ``give`` is in the queue when
``npc`` has turned down a request for want of weight today (the numbers as they were), or turned the
manager away from a look at what they keep for want of trust (``entrust.look_turned_down``), or
refused a testimony for want of trust. A promise made moves the trust, so it goes when the request
is put again and is turned down again.
"""

from __future__ import annotations

import hashlib
from typing import Any

from lantern_core.world.bridge import (
    agenda_terms,
    assembly,
    clock,
    commitments,
    encounters,
    entrust,
    gifts,
    goals,
    goals_call,
    goals_work,
    offers,
    pledges,
    prompts,
    repute,
)
from lantern_core.world.bridge.data import CAST
from lantern_core.world.bridge.lore import lore

OPEN, DONE, WAITING, REFUSED = "open", "done", "waiting", "refused"
WAYS = ("clear_truth", "gift", "ask_others")
TOKEN_CHARS = 8


def token_of(sign: str) -> str:
    """A short fixed token of the situation a request was turned down in."""
    return hashlib.sha256(sign.encode("utf-8")).hexdigest()[:TOKEN_CHARS]


# ---------------------------------------------------------------------------- the status


def status_of(
    world: Any, world_state: dict[str, Any], person: str, body: dict[str, Any], now: clock.Now
) -> str:
    """Where a request to ``person`` stands: ``done``, ``waiting``, ``refused`` (turned down
    today) or ``open``."""
    section, kind = world_state["player"], body["kind"]
    detail = entrust.detail_of(person, body)
    flags = world_state["goals"]["flags"]
    if kind == "material":
        held = commitments.standing(world_state, person)
        if held is not None:
            return DONE if held[0] == commitments.ENOUGH else WAITING
        item = goals_work.SUPPLIERS.get(person, ("",))[0]
        if goals_work.DELIVERED.get(item) in flags:
            return DONE
    elif kind == "lane":
        lane = world_state["goals"].get("lane", {})
        if goals_work.LANE_OPENED in flags or lane.get("task"):
            return DONE
    elif kind == "lend":
        if entrust.BAMBOO in section["nod"]:
            return DONE
    elif kind == "testify":
        real = entrust.testimony(person, world_state["social"]["variant"])
        if real and all(i["id"] in section["evidence"] for i in real):
            return DONE
    elif kind == "convene" and assembly.clan_called(section, now.tick):
        return DONE
    if any(
        row["npc"] == person and row["kind"] == kind and row["detail"] == detail
        for row in section["pending"]
    ):
        return WAITING
    said = section.get("said_no", {}).get(entrust.key_of(person, kind, detail))
    return REFUSED if said is not None and said[0] == now.day else OPEN


# ---------------------------------------------------------------------------- what is put first


def _action_offer(action: dict[str, Any], mine: list[dict[str, Any]]) -> dict[str, Any] | None:
    """The offer of ``entrust`` that the action of a task asks for, as the bots read it: the one
    with the request (and the person to talk round), or, naming only an item, the goods."""
    request, target, item = action.get("request"), action.get("target"), action.get("item")
    if request:
        return next(
            (
                o
                for o in mine
                if o["body"].get("kind") == request
                and (not target or o["body"].get("target") == target)
            ),
            None,
        )
    if item:
        return next((o for o in mine if o["body"].get("kind") == "material"), None) or next(
            (o for o in mine if o["body"].get("kind") == "lend"), None
        )
    return None


def _closes(task: dict[str, Any]) -> int:
    window = task.get("window")
    if not window:
        return 10**9
    return agenda_terms.minute_at(window["day"], window["to"])


def pick(
    out: dict[str, Any], person: str, requests: list[dict[str, Any]]
) -> tuple[dict[str, Any] | None, str]:
    """The request to put first among ``requests`` (offers with a ``status``), and the id of the
    task it serves: the one that the task followed asks for, else that of the open task whose
    window closes first. ``(None, "")`` if no task asks for an open request of ``person``."""
    free = {o["id"]: o for o in requests if o["status"] == OPEN}
    asking: list[tuple[int, dict[str, Any], dict[str, Any]]] = []
    for number, task in enumerate(out["tasks"]):
        action = task.get("action")
        if task["state"] not in ("open", "blocked") or not action:
            continue
        if action.get("verb") != "entrust" or action.get("npc") != person:
            continue
        found = _action_offer(action, requests)
        if found is not None and found["id"] in free:
            asking.append((number, task, free[found["id"]]))
    followed = out.get("tracked")
    for _, task, offer in asking:
        if task["id"] == followed:
            return offer, task["id"]
    if not asking:
        return None, ""
    _, task, offer = min(asking, key=lambda row: (_closes(row[1]), row[0]))
    return offer, task["id"]


# ---------------------------------------------------------------------------- the return


def asked_return(
    world: Any, world_state: dict[str, Any], person: str, day: int
) -> dict[str, Any] | None:
    """The return ``person`` asks for the script (``ask`` of the cast) as an offer of ``promise``,
    or None if the manager holds none of it."""
    ask = CAST["people"][lore().index[person]]["ask"]
    return offers.promise_offer(
        world,
        world_state["player"],
        day,
        ask["what"],
        ask.get("item", ""),
        ask.get("amount", 0),
        person=person,
    )


def refusals(
    world: Any, world_state: dict[str, Any], person: str, day: int
) -> list[dict[str, Any]]:
    """The requests ``person`` turned down today that stand as they were (nothing the answer
    weighed has moved), the newest last: ``{"key", "kind", "detail", "why", "sign"}``. The rows
    are told apart by the number they were kept with (``entrust.remember_no``), and the saved
    state has its keys in order, so the order of the rows says nothing."""
    out = []
    mine = f"{person}|"
    rows = world_state["player"].get("said_no", {})
    for key, row in sorted(rows.items(), key=lambda found: (_number(found[1]), found[0])):
        if not key.startswith(mine) or row[0] != day:
            continue
        _, kind, detail = key.split("|", 2)
        sign = row[2]
        if sign:
            current = current_sign(world, world_state, person, kind, detail, row[1])
            if current != sign:
                continue
        out.append({"key": key, "kind": kind, "detail": detail, "why": row[1], "sign": sign})
    return out


def _number(row: list[Any]) -> int:
    """How many refusals were kept by the time this one was (0 for a row of an older game)."""
    return int(row[3]) if len(row) > 3 else 0


def current_sign(
    world: Any, world_state: dict[str, Any], person: str, kind: str, detail: str, why: str
) -> str:
    """The situation a request is weighed in now, in the form its refusal was kept in: the
    signature of the score (``entrust.weigh_request``) for a request that was weighed, and for one
    that a gate turned away for trust the trust at that moment."""
    if why == entrust.TRUST_GATE:
        return f"t{repute.trust(world_state['player'], lore().index[person])}"
    return entrust.weigh_request(world, world_state, person, kind, detail).sign


def wants(
    world: Any,
    world_state: dict[str, Any],
    person: str,
    day: int,
    requests: list[dict[str, Any]],
) -> dict[str, Any] | None:
    """The return ``person`` asks now, or None (see the module docstring)."""
    section = world_state["player"]
    offer = asked_return(world, world_state, person, day)
    if offer is None:
        return None
    by_key = {
        entrust.key_of(person, o["body"]["kind"], entrust.detail_of(person, o["body"])): o
        for o in requests
    }
    for row in reversed(refusals(world, world_state, person, day)):
        if row["why"] != entrust.SCORE_SHORT or row["key"] not in by_key:
            continue
        if any(pending["npc"] == person for pending in section["pending"]):
            continue
        request = by_key[row["key"]]
        return {
            "key": row["key"],
            "token": token_of(row["sign"]),
            "asks": request["label"],
            "request": request,
            "offer": offer,
        }
    return None


def note_ask(
    world: Any,
    world_state: dict[str, Any],
    person: str,
    kind: str,
    detail: str,
    day: int,
    tick: int,
) -> None:
    """Keep that ``person`` has just asked a return, if the talk puts one forward now (``wants``
    would): the request has been turned down for want of weight, the script gives them a return,
    the manager still holds it, and nothing else of theirs waits on the manager. ``kind`` and
    ``detail`` are the request."""
    section = world_state["player"]
    offer = asked_return(world, world_state, person, day)
    if offer is None or any(pending["npc"] == person for pending in section["pending"]):
        return
    target = detail if kind == "persuade" else ""
    encounters.record_ask(section, person, tick, offer["body"], kind, target)


def refused_for_trust(world: Any, world_state: dict[str, Any], person: str, day: int) -> bool:
    """Whether ``person`` turned the manager down today for want of weight or of trust, and nothing
    has moved since: a request the score fell short of or a testimony the trust gate shut, or a
    look at what they keep (``entrust.look_turned_down``)."""
    if any(
        row["why"] in (entrust.SCORE_SHORT, entrust.TRUST_GATE)
        for row in refusals(world, world_state, person, day)
    ):
        return True
    return entrust.look_turned_down(world_state, person)


# ---------------------------------------------------------------------------- the promises


def to_keep(
    world: Any,
    world_state: dict[str, Any],
    person: str,
    today: int,
    promises: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """The promises to ``person`` that are open, the earliest due first: the items ``keep`` of the
    queue, each with the offer of ``promise`` that keeps it (one of ``promises``). Every one can be
    kept at once."""
    section, mine = world_state["player"], []
    offered = {o["id"]: o for o in promises}
    for pledge in section["pledges"]:
        offer = offered.get(f"keep:{pledge['id']}")
        if pledge["to"] != person or pledge["state"] != pledges.OPEN or offer is None:
            continue
        mine.append(
            {
                "kind": "keep",
                "pledge": pledge["id"],
                "due": pledge["due"],
                "early": pledge["due"] > today,
                "what": prompts.promise_text(
                    world, pledge["what"], pledge["item"], pledge["amount"], town=True
                ),
                "offer": offer,
            }
        )
    return sorted(mine, key=lambda item: (item["due"], int(item["pledge"][1:])))


def ways(world: Any, world_state: dict[str, Any], person: str, today: int) -> list[str]:
    """The ways other than a promise to win a person over that are open now: ``clear_truth`` (the
    truth is not told in public yet), ``gift`` (a gift can still be given them today) and
    ``ask_others`` (somebody who is acquainted with them is yet to be asked in, and they are not
    in themselves)."""
    section, found = world_state["player"], []
    if not goals.flag_up(world_state, goals.TRUTH_TOLD):
        found.append("clear_truth")
    if gifts.things() and gifts.refusal(section, today, person) is None:
        found.append("gift")
    layout = goals_call.lay(world)
    joined = set(goals_call.joined_ids(world_state["goals"]["call"]))
    if person in layout.helpers and person not in joined:
        helpers = [
            other
            for other in layout.helpers
            if other != person and other not in joined and person in layout.knows.get(other, ())
        ]
        if helpers:
            found.append("ask_others")
    return found


def give(
    world: Any, world_state: dict[str, Any], person: str, day: int, promises: list[dict[str, Any]]
) -> dict[str, Any]:
    """The entry of "promise something": the preferred promise, every other that can be made, and
    the other ways open when there is nothing to promise."""
    preferred = asked_return(world, world_state, person, day)
    more = [
        o
        for o in promises
        if not o["id"].startswith("keep:") and (preferred is None or o["id"] != preferred["id"])
    ]
    other = [] if preferred is not None or more else ways(world, world_state, person, day)
    return {"preferred": preferred, "more": more, "ways": other}


# ---------------------------------------------------------------------------- the talk


def talk_fields(world: Any, out: dict[str, Any], world_state: dict[str, Any], tick: int) -> None:
    """Add the keys of the module docstring to ``out["player"]["talk"]``, in a talk."""
    talk = out["player"]["talk"]
    if not talk:
        return
    person, now = talk["npc"], clock.at(tick)
    entrusts = out["player"]["offers"]["entrust"]
    requests = []
    for found in entrusts:
        row = dict(found)
        row["label"] = offers.request_label(person, found["body"])
        row["status"] = status_of(world, world_state, person, found["body"], now)
        requests.append(row)
    first, task_id = pick(out, person, requests)
    if first is not None:
        first = {**first, "for": task_id}
    talk["ask_for"] = first
    talk["asks_more"] = [o for o in requests if first is None or o["id"] != first["id"]]
    asked = wants(world, world_state, person, now.day, requests)
    talk["wants"] = asked
    promises = out["player"]["offers"]["promise"]
    keeps = to_keep(world, world_state, person, now.day, promises)
    talk["keep"] = keeps[0] if keeps else None
    talk["give"] = give(world, world_state, person, now.day, promises)
    queue: list[dict[str, Any]] = []
    if asked is not None:
        queue.append({"kind": "answer", "key": asked["key"], "token": asked["token"]})
    queue.extend(keeps)
    if refused_for_trust(world, world_state, person, now.day):
        queue.append({"kind": "give"})
    talk["queue"] = queue
