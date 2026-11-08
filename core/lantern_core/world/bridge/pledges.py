"""The manager's promises, and the ledger of favours.

What the manager can promise is what they hold. Everything else is an empty promise, and the
person does not believe it on the spot (``promise`` is rejected as ``empty`` and nothing is
written). The manager holds, for the festival:

- ``STALLS``: places for stalls, ``front`` ones that people want and ``back`` ones;
- ``ROLES``: the roles of honour, each given to one person at most: the honour of lighting the
  main lantern (``t_honor_light``), leading the lantern parade and speaking the blessings on
  stage;
- ``PURSE`` coins of wages, to be paid out to helpers until they are gone;
- ``SLOTS`` places in the programme, ``"1"`` the first.

A promise held to is *open* until the manager keeps it in person (``promise`` with ``"op":
"keep"`` in a conversation with the one it was made to) by the day it is due. A promise that is
not kept by then is *broken* on the first tick of the day after: the person trusts the manager
less, and holds first-hand that the manager broke their word, which then spreads as a fact
(``repute.BROKE``). Resources are used up while a promise is open or kept and free again when it
is broken.

The ledger of favours (``deeds``) keeps what has really been done, each deed once: a key names
the deed (the same deed twice is one), and ``direction`` says whom it favours: +1 if the person
owes the manager, -1 if the manager owes the person. The balance for a person is the sum of
``size * direction`` over their deeds, held to ``-MAX_BALANCE`` and ``MAX_BALANCE``. A promise in
hand is not a deed: it counts toward the person's willingness while it is open (``in_hand``) and
becomes a deed when it is kept, so it is never counted twice.

State (``state["world"]["player"]``): ``pledges`` is a list of ``{"id", "to", "what", "item",
"amount", "size", "made", "due", "state", "ended"}`` (``state`` is ``open``, ``kept`` or
``broken``), ``pseq`` the number of the next, and ``deeds`` is ``{key: [person, size, direction,
tick]}``.

Events: ``pledged`` (``npc``, ``pledge``, ``what``, ``item``, ``amount`` and ``due``, which say what
was promised without a look at the open promises of the frame; ``amount`` is the coins of a wage
and 0 for any other promise, as the pledge keeps it), ``pledge_empty``, ``pledge_kept`` and
``pledge_broken``. Rejected: ``not_talking``, ``empty``, ``bad_due``, ``no_pledge``,
``wrong_person``, ``kept_already``, ``lapsed``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.inputs import InputError, int_field
from lantern_core.world.bridge import converse, repute
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

STALLS = {"front": 2, "back": 4}
ROLES = ("t_honor_light", "lead_lanterns", "stage_words")
SLOTS = 5
PURSE = 60
KINDS = ("stall", "role", "wage", "slot")
MAX_BALANCE = 6
OPEN, KEPT, BROKEN = "open", "kept", "broken"
MADE_GAIN = {1: 4, 2: 6, 3: 8}  # trust a promise earns when it is made, by its size
KEPT_GAIN = {1: 6, 2: 9, 3: 12}  # and when it is kept
BROKEN_DROP = {1: 10, 2: 14, 3: 18}  # and trust lost when it is broken
LOOK_STRIDE = 30
# the first promises made that have a task of their own (``agenda``): ``t_keep_1`` to 20, which is
# every promise the offers can make: two front stalls and four back ones, three roles, five places
# in the programme and six wages of ten coins
CARDS = 20


def card_of(section: dict[str, Any], number: int) -> dict[str, Any] | None:
    """The ``number``-th promise made (``k1`` is the first), or None if there is no such promise.
    The first ``CARDS`` of them have a task each, ``t_keep_1`` and so on."""
    wanted = f"k{number}"
    return next((p for p in section["pledges"] if p["id"] == wanted), None)


def size_of(what: str, item: str, amount: int) -> int:
    """How big a promise is, from 1 to 3: a role is large, a front stall medium, a wage by sum."""
    if what == "role":
        return 3
    if what == "stall":
        return 2 if item == "front" else 1
    if what == "wage":
        return 1 if amount <= 15 else 2 if amount <= 30 else 3
    return 1


# ---------------------------------------------------------------------------- what is left


def _held(section: dict[str, Any]) -> list[dict[str, Any]]:
    return [p for p in section["pledges"] if p["state"] in (OPEN, KEPT)]


def left(section: dict[str, Any]) -> dict[str, Any]:
    """What the manager still has to promise: stalls of each kind, free roles and slots, coins."""
    held = _held(section)
    return {
        "stall_front": STALLS["front"]
        - sum(1 for p in held if p["what"] == "stall" and p["item"] == "front"),
        "stall_back": STALLS["back"]
        - sum(1 for p in held if p["what"] == "stall" and p["item"] == "back"),
        "roles": [
            r for r in ROLES if not any(p["what"] == "role" and p["item"] == r for p in held)
        ],
        "slots": [
            str(n)
            for n in range(1, SLOTS + 1)
            if not any(p["what"] == "slot" and p["item"] == str(n) for p in held)
        ],
        "purse": PURSE - sum(p["amount"] for p in held if p["what"] == "wage"),
    }


def holds(section: dict[str, Any], what: str, item: str, amount: int) -> bool:
    """Whether the manager has this to promise now."""
    have = left(section)
    if what == "stall":
        return item in STALLS and have[f"stall_{item}"] > 0
    if what == "role":
        return item in have["roles"]
    if what == "slot":
        return item in have["slots"]
    if what == "wage":
        return 1 <= amount <= have["purse"]
    return False


# ---------------------------------------------------------------------------- the ledger


def add_deed(
    section: dict[str, Any], key: str, person: str, size: int, direction: int, tick: int
) -> bool:
    """Write a deed in the ledger. False if a deed with that key is in it already."""
    if key in section["deeds"]:
        return False
    section["deeds"][key] = [person, size, direction, tick]
    return True


def balance(section: dict[str, Any], person: str) -> int:
    """What the favours between the manager and ``person`` come to: positive if they owe the
    manager, from ``-MAX_BALANCE`` to ``MAX_BALANCE``."""
    total = sum(
        deed[1] * deed[2] for key, deed in sorted(section["deeds"].items()) if deed[0] == person
    )
    return max(-MAX_BALANCE, min(MAX_BALANCE, total))


def in_hand(section: dict[str, Any], person: str) -> int:
    """The size of the promises to ``person`` that are open: what they have in prospect."""
    return sum(p["size"] for p in section["pledges"] if p["to"] == person and p["state"] == OPEN)


def honoured(section: dict[str, Any], thing: str, to: str) -> bool:
    """Whether the role ``thing`` is promised or given (not broken) to ``to``: a person, or a
    family, in which case any of its people."""
    lo = lore()
    return any(
        p["what"] == "role"
        and p["item"] == thing
        and p["state"] in (OPEN, KEPT)
        and to in (p["to"], lo.family[p["to"]])
        for p in section["pledges"]
    )


# ---------------------------------------------------------------------------- making and keeping


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action promise"
    out = converse.plain(body, "promise")
    op = body.get("op", "make")
    if op not in ("make", "keep"):
        raise InputError(f"{where}: op must be make or keep")
    out["op"] = op
    if op == "keep":
        out["id"] = converse.id_field(body.get("id"), where, "id")
        return converse.with_words(out, body, where)
    for name in ("what", "item"):
        value = body.get(name, "")
        if not isinstance(value, str) or len(value) > converse.MAX_ID_CHARS:
            raise InputError(f"{where}: {name} must be a string of at most 64 characters")
        out[name] = value
    out["amount"] = int_field(body.get("amount", 0), where, "amount", 0, 100_000)
    out["due"] = int_field(body.get("due", 0), where, "due", 0, 30)
    return converse.with_words(out, body, where)


def apply(sim: Sim, body: dict[str, Any]) -> None:
    found = converse.partner(sim)
    if found is None:
        return converse.ack(sim, body, "not_talking")
    if body["op"] == "keep":
        return _keep(sim, body, found[0])
    _make(sim, body, found[0])


def _make(sim: Sim, body: dict[str, Any], index: int) -> None:
    section, tick = sim.state["player"], sim.ctx.tick
    person = lore().people[index]
    what, item, amount = body["what"], body["item"], body["amount"]
    due = body["due"] or sim.world.config["days"]
    if not holds(section, what, item, amount):
        converse.reply(sim, "empty")
        sim.emit("pledge_empty", npc=person, what=what, item=item, amount=amount)
        return converse.ack(sim, body, "empty")
    if not sim.now.day <= due <= sim.world.config["days"]:
        return converse.ack(sim, body, "bad_due")
    size = size_of(what, item, amount)
    pledge_id = f"k{section['pseq']}"
    section["pseq"] += 1
    owed = amount if what == "wage" else 0
    section["pledges"].append(
        {
            "id": pledge_id,
            "to": person,
            "what": what,
            "item": item,
            "amount": owed,
            "size": size,
            "made": tick,
            "due": due,
            "state": OPEN,
            "ended": -1,
        }
    )
    repute.nudge(section, index, MADE_GAIN[size])
    converse.reply(sim, "deal")
    sim.emit("pledged", npc=person, pledge=pledge_id, what=what, item=item, amount=owed, due=due)
    converse.ack(sim, body)


def _keep(sim: Sim, body: dict[str, Any], index: int) -> None:
    section, tick = sim.state["player"], sim.ctx.tick
    person = lore().people[index]
    pledge = next((p for p in section["pledges"] if p["id"] == body["id"]), None)
    if pledge is None:
        return converse.ack(sim, body, "no_pledge")
    if pledge["to"] != person:
        return converse.ack(sim, body, "wrong_person")
    if pledge["state"] != OPEN:
        return converse.ack(sim, body, "kept_already" if pledge["state"] == KEPT else "lapsed")
    pledge["state"], pledge["ended"] = KEPT, tick
    add_deed(section, f"kept:{pledge['id']}", person, pledge["size"], 1, tick)
    repute.nudge(section, index, KEPT_GAIN[pledge["size"]])
    converse.reply(sim, "kept_thanks")
    sim.emit("pledge_kept", npc=person, pledge=pledge["id"], what=pledge["what"])
    converse.ack(sim, body)


def watch(sim: Sim) -> None:
    """Break the promises that were not kept by their day, on the first tick after it."""
    if sim.ctx.tick % LOOK_STRIDE:
        return
    section, social, tick = sim.state["player"], sim.state["social"], sim.ctx.tick
    lo = lore()
    for pledge in section["pledges"]:
        if pledge["state"] != OPEN or sim.now.day <= pledge["due"]:
            continue
        pledge["state"], pledge["ended"] = BROKEN, tick
        person = pledge["to"]
        repute.nudge(section, lo.index[person], -BROKEN_DROP[pledge["size"]])
        repute.learn(social, person, repute.BROKE, tick)
        repute.mark(section, repute.BROKE, person)
        sim.emit("pledge_broken", npc=person, pledge=pledge["id"], what=pledge["what"])


def wire(world: Any, section: dict[str, Any]) -> list[dict[str, Any]]:
    """The promises still open, for the side panel: ``{"id", "to": name, "what", "item",
    "amount", "due"}``."""
    people = world.cast.people
    return [
        {
            "id": p["id"],
            "to": {
                "zh": people[world.cast.index[p["to"]]].zh,
                "en": people[world.cast.index[p["to"]]].en,
                "id": p["to"],
            },
            "what": p["what"],
            "item": p["item"],
            "amount": p["amount"],
            "due": p["due"],
        }
        for p in section["pledges"]
        if p["state"] == OPEN
    ]
