"""Persuasion: what a person weighs before they agree to something the manager asks of them.

Two steps, in this order.

*Hard conditions.* The script lists, for a few requests, conditions that must hold before the
person will talk of it at all, with alternatives (``hard_conditions`` in the script): any one of
the listed alternatives opens the way, and each alternative is a list of conditions that all hold.
Without one the answer is no, whatever else the manager brings. A condition is a dict with a
``kind``, and the kinds are: ``refuted_publicly`` (every listed prop has been refuted in front of
the town, see ``assembly``), ``honor_given`` (the thing, a role of honour, is promised or given to
the person or to the family), ``trust_min`` (the holder trusts the manager at least this far),
``persuaded`` (the manager has won this person over), ``asked_by`` (this person has been
asked, by the manager's doing, to speak to the other) and ``knows`` (the holder holds one of the
listed claims with at least this confidence: they took in the clarification, or were told of it).
Two more kinds are not for the ways but for the reason of a refusal: ``believes`` (the holder holds
one of the listed props, a rumour, with at least this confidence) and ``unspoken`` (the manager has
not yet spoken in public). A kind that is not listed does not hold.

When every way is shut the person says why. The hard condition may list ``refusals``, each a list
of conditions and the code of a fixed line (``phrases``); the first whose conditions all hold gives
the line, and without one it is ``hard_<id of the hard condition>`` (``refusal``).

*The score.* If the way is open, the person adds up, all in ints::

    trust            their trust in the manager, 0 to 100
    + 4 * balance    the favours between them: positive if they owe the manager, -6 to 6
    + hand           4 for each point of promise in hand to them, at most 16
    + crowd          4 for each acquaintance of theirs who has already joined, at most 16
    + cite           what the notebook entries cited are worth to them, -9 to 9
    - personality    (suspicion - warmth) // 5: a wary, cold person asks more
    + wording        -10 to 10, what a model judges the manager's own words to be worth to this
                     person (``read_wording``), when they said any and a model was asked; else 0

and agree if the sum reaches ``NEED[kind]``, the price of that kind of request for anyone. A cited
entry is worth 5 to a person who believes what it says, -8 to one who believes something that
cannot be true with it, and 4 (or 2, if the manager only heard it) to one who knows nothing of it.
Pointing at what a person has just said costs the manager nothing, so the credit is held to
``CITE_LIMIT``, less than a promise in hand can add (``HAND_MAX``): a request is carried by a
promise, a favour or a crowd behind it, and a citation only tips it.

The same request, put again to the same person when none of these numbers has moved, is not
weighed again (``signature``): the person says they have said it already. The wording is not one
of the numbers that count there: it is judged when a request is new, and rewording a request does
not make it new, so rewriting the same request does not buy another throw of the dice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from lantern_core.cognition import contract
from lantern_core.world.bridge import goals_call, notebook, notes, pledges, repute
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

KINDS = ("testify", "join", "lane", "material", "persuade", "lend", "convene")
NEED = {
    "testify": 20,
    "join": 30,
    "lane": 30,
    "material": 40,
    "persuade": 35,
    "lend": 20,
    "convene": 30,
}
FAVOUR_WEIGHT = 4
HAND_WEIGHT, HAND_MAX = 4, 16
CROWD_WEIGHT, CROWD_MAX = 4, 16
CITE_MAX = 3  # entries that may be cited in one request
CITE_LIMIT = 9  # with the trust a stranger starts at, no citation reaches the cheapest price
CITE_AGREE, CITE_CLASH, CITE_SEEN, CITE_HEARD = 5, -8, 4, 2
WORDING = 0  # what the manager's words are worth when nobody judged them
WORDING_LIMIT = 10  # the most they may add, or take away

# The requests that the script puts a hard condition before, by the kind and what it is about.
HARD = {("lend", "bamboo"): "hc_li_bamboo"}


@dataclass(frozen=True, slots=True)
class Weighed:
    """What a person made of a request: the sum, the price, and the parts of the sum."""

    total: int
    need: int
    parts: tuple[tuple[str, int], ...]

    @property
    def agrees(self) -> bool:
        return self.total >= self.need


# ---------------------------------------------------------------------------- hard conditions


def hard_condition(hard_id: str) -> dict[str, Any]:
    for row in SCRIPT["hard_conditions"]:
        if row["id"] == hard_id:
            return dict(row)
    raise KeyError(hard_id)


def condition_holds(world_state: dict[str, Any], cond: dict[str, Any]) -> bool:
    """Whether one condition of an alternative holds, as the manager's dealings stand."""
    section, kind = world_state["player"], cond["kind"]
    if kind == "refuted_publicly":
        return all(prop in section["public"]["refuted"] for prop in cond["props"])
    if kind == "honor_given":
        return pledges.honoured(section, cond["thing"], cond["to"])
    if kind == "trust_min":
        return repute.trust(section, lore().index[cond["holder"]]) >= cond["min"]
    if kind == "persuaded":
        return cond["who"] in section["won"]
    if kind == "asked_by":
        return any(row[0] == cond["who"] and row[1] == cond["of"] for row in section["asks"])
    if kind in ("believes", "knows"):
        store = notes.store(world_state["social"], cond["holder"])
        return any(
            (belief := store.get(prop)) is not None and belief.confidence >= cond["min"]
            for prop in cond["props"]
        )
    if kind == "unspoken":
        return not section["public"]["speeches"]
    return False


def open_way(world_state: dict[str, Any], hard_id: str) -> str | None:
    """The id of the first alternative of the hard condition that holds, or None if none does."""
    for alt in hard_condition(hard_id)["any"]:
        if all(condition_holds(world_state, cond) for cond in alt["all"]):
            return str(alt["id"])
    return None


def refusal(world_state: dict[str, Any], hard_id: str) -> str:
    """The code of the fixed line that says why the way is shut, for a hard condition with no way
    open: that of the first refusal of the script whose conditions all hold, else ``hard_<id>``."""
    for row in hard_condition(hard_id).get("refusals", ()):
        if all(condition_holds(world_state, cond) for cond in row["when"]):
            return str(row["line"])
    return f"hard_{hard_id}"


# ---------------------------------------------------------------------------- the score


def cite_credit(world_state: dict[str, Any], person: str, cites: tuple[str, ...]) -> int:
    """What the entries the manager cites are worth in the eyes of ``person``."""
    section, social = world_state["player"], world_state["social"]
    view, lo = notebook.view(social), lore()
    store = notes.store(social, person)
    total = 0
    for entry_id in cites[:CITE_MAX]:
        entry = notebook.find(section, entry_id)
        if entry is None:
            continue
        prop = view[entry["prop"]]
        held = store.get(prop.id)
        if held is not None and held.confidence >= repute.BELIEVE_AT:
            total += CITE_AGREE
        elif any(
            other.confidence >= repute.BELIEVE_AT and lo.excludes(prop, view[other.prop])
            for other in store
        ):
            total += CITE_CLASH
        else:
            total += CITE_SEEN if notebook.belief_of(entry).source == "saw" else CITE_HEARD
    return max(-CITE_LIMIT, min(CITE_LIMIT, total))


def read_wording(text: str) -> int | None:
    """What a model's judgement of the manager's words says, as an int from ``-WORDING_LIMIT`` to
    ``WORDING_LIMIT``, or ``None`` if it says nothing the rules can use.

    The judgement is one JSON object with the key ``score`` and nothing else, and a whole number
    (not a float, not a text, not true or false) for it. A number past the limit is held to it.
    """
    found = contract.first_object(text)
    if found is None or set(found) != {"score"}:
        return None
    score = found["score"]
    if type(score) is not int:
        return None
    return max(-WORDING_LIMIT, min(WORDING_LIMIT, score))


def with_wording(weighed: Weighed, wording: int) -> Weighed:
    """``weighed`` with the judged wording in place of the part that was nothing."""
    wording = max(-WORDING_LIMIT, min(WORDING_LIMIT, wording))
    parts = tuple((name, wording if name == "wording" else value) for name, value in weighed.parts)
    return Weighed(sum(value for _, value in parts), weighed.need, parts)


def weigh(
    world: Any,
    world_state: dict[str, Any],
    person: str,
    kind: str,
    cites: tuple[str, ...] = (),
    need: int | None = None,
) -> Weighed:
    """The score of ``person`` for a request of ``kind``, against its price (or ``need``). The
    wording is nothing here: ``with_wording`` adds what a judge made of it."""
    lo, section = lore(), world_state["player"]
    traits = lo.traits[person]
    layout = goals_call.lay(world)
    known = 0
    if person in layout.knows:
        known = goals_call.known_to_have_joined(world, world_state["goals"]["call"], person)
    parts = (
        ("trust", repute.trust(section, lo.index[person])),
        ("favour", FAVOUR_WEIGHT * pledges.balance(section, person)),
        ("hand", min(HAND_MAX, HAND_WEIGHT * pledges.in_hand(section, person))),
        ("crowd", min(CROWD_MAX, CROWD_WEIGHT * known)),
        ("cite", cite_credit(world_state, person, cites)),
        ("personality", -((traits["suspicion"] - traits["warmth"]) // 5)),
        ("wording", WORDING),
    )
    return Weighed(sum(value for _, value in parts), NEED[kind] if need is None else need, parts)


def signature(weighed: Weighed, way: str | None, cites: tuple[str, ...], extra: str = "") -> str:
    """Everything a request was judged by, as one string: the same string is the same situation."""
    numbers = ",".join(f"{name}={value}" for name, value in weighed.parts)
    return f"{numbers}|{weighed.need}|{way or '-'}|{'+'.join(sorted(cites))}|{extra}"
