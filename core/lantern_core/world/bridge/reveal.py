"""The manager's part of the reveal at the end: what they learned, how far their words went.

``ending_reveal(world_state)`` is the hook that ``goals_ending.reveal`` calls on the module
``player``, and what it returns goes into the reveal under ``"player"``. It is plain data:

``entries``    every entry of the notebook with its whole chain, which the game never showed. For
               each entry: ``id``, ``prop``, ``source`` (``seen`` or ``heard``), ``hand``,
               ``true`` (whether the game made it true: a bool, or null for a statement the story
               has no truth for), ``chain`` (the hops from the manager's own belief back, each
               ``{"holder", "how", "prop", "told_by", "claim", "path", "op", "tick"}``: how the
               holder came to hold it and who told them, the prop they held, which is what the
               hop says (its words are in ``texts``), the claim that carried it, and the operator
               if the telling changed it), ``end`` (how the walk back ended: ``saw``, ``lie``,
               ``inferred``, ``paper``, ``street`` or ``broken``) and ``origin`` (who stands at
               that end).
``spoke``      how far the manager's own words went: ``tellings`` (how many times they told
               someone something), ``lies`` (how many of those were lies), ``ways`` (the count for
               each way of telling), ``told`` (``[claim, listener, prop, way, lie, tick]``),
               ``reached`` (the people whose beliefs go back to a telling of the manager's, in
               cast order), ``retold`` (the claims townsfolk made that rest on one), ``furthest``
               (the most hands a telling of the manager's got to, 1 being the person they told
               themselves) and ``caught`` (``[prop, person, tick]`` for each lie that was caught).
``said_of_me`` the claims in the record of the town about the manager: ``[claim, speaker,
               listener, prop, tick]``, in the order they were said.
``pledges``    the promises: ``[id, person, what, item, due, state]``.
``trust``      how far each person trusts the manager at the end, ``[person, trust]``, and
               ``stars`` the reputation.
``texts``      every prop mentioned, said in both languages: ``{prop id: {"zh", "en"}}``.
"""

from __future__ import annotations

from typing import Any

from lantern_core.cognition.props import Prop, lineage
from lantern_core.cognition.provenance import Trace, walk_back
from lantern_core.world.bridge import goals_ending, notebook, repute, social
from lantern_core.world.bridge.lore import PLAYER, lore


def _hops(trace: Trace) -> list[dict[str, Any]]:
    return [
        {
            "holder": hop.holder,
            "how": hop.belief.source,
            "prop": hop.belief.prop,
            "told_by": hop.belief.teller or "",
            "claim": "" if hop.claim is None else hop.claim.id,
            "path": "" if hop.claim is None else hop.claim.path,
            "op": "" if hop.claim is None or hop.claim.op is None else hop.claim.op,
            "tick": hop.belief.tick,
        }
        for hop in trace.hops
    ]


def _true(world_state: dict[str, Any], prop: Prop) -> bool | None:
    """Whether the game made the prop true, or None if the story has no truth for it."""
    section = world_state["social"]
    variant, lo = section["variant"], lore()
    if prop.id in lo.book.props:
        return bool(lo.book.holds(variant, prop.id))
    if goals_ending.about_the_conflict(prop):
        return goals_ending.is_true(prop, goals_ending.true_conflict_props(variant))
    return None


def ending_reveal(world_state: dict[str, Any]) -> dict[str, Any]:
    """The manager's part of the reveal, from the state of the world."""
    mine, section = world_state["player"], world_state["social"]
    if "beliefs" not in section:  # a world without the talk between neighbours
        return {}
    lo = lore()
    view = notebook.view(section)
    stores = social.stores(section)
    stores[PLAYER] = notebook.store(mine)
    claims = dict(social.claims(section))
    for claim_id in sorted(mine["claims"], key=lambda c: int(c[1:])):
        claims[claim_id] = notebook.answer(mine, claim_id)
    texts: dict[str, dict[str, str]] = {}

    def text(prop_id: str) -> None:
        if prop_id not in texts:
            texts[prop_id] = notebook.sentence(view[prop_id])

    entries = []
    for entry in mine["notebook"]:
        belief = notebook.belief_of(entry)
        trace = walk_back(PLAYER, entry["prop"], stores, claims, view)
        text(entry["prop"])
        for hop in trace.hops:
            text(hop.belief.prop)
        entries.append(
            {
                "id": entry["id"],
                "prop": entry["prop"],
                "source": "seen" if belief.source == "saw" else "heard",
                "hand": belief.hop,
                "true": _true(world_state, view[entry["prop"]]),
                "chain": _hops(trace),
                "end": trace.end,
                "origin": trace.origin or "",
            }
        )

    told = [list(row) for row in mine["told"]]
    counts: dict[str, int] = {}
    for row in told:
        counts[row[3]] = counts.get(row[3], 0) + 1
        text(row[2])
    told_props = {row[2] for row in told}
    reached: list[str] = []
    furthest = 0
    for person in lo.people:
        best = 0
        for belief in stores[person]:
            if belief.prop not in view or not (told_props & set(lineage(belief.prop, view))):
                continue
            trace = walk_back(person, belief.prop, stores, claims, view)
            for k, hop in enumerate(trace.hops):
                if hop.claim is not None and hop.claim.speaker == PLAYER:
                    best = max(best, k + 1)
        if best:
            reached.append(person)
            furthest = max(furthest, best)
    retold = 0
    for claim in claims.values():
        if claim.speaker in stores and claim.speaker != PLAYER:
            belief = stores[claim.speaker].get(claim.prop)
            if belief is None or not (told_props & set(lineage(claim.prop, view))):
                continue
            trace = walk_back(claim.speaker, claim.prop, stores, claims, view)
            if any(h.claim is not None and h.claim.speaker == PLAYER for h in trace.hops):
                retold += 1

    said = []
    for claim in social.claims(section).values():
        prop = view.get(claim.prop)
        if prop is not None and any(entity == PLAYER for _, entity in prop.args):
            said.append([claim.id, claim.speaker, claim.listeners[0], claim.prop, claim.tick])
            text(claim.prop)

    return {
        "entries": entries,
        "spoke": {
            "tellings": len(told),
            "lies": sum(row[4] for row in told),
            "ways": {way: counts[way] for way in sorted(counts)},
            "told": told,
            "reached": reached,
            "retold": retold,
            "furthest": furthest,
            "caught": [list(row) for row in mine["caught"]],
        },
        "said_of_me": said,
        "pledges": [
            [p["id"], p["to"], p["what"], p["item"], p["due"], p["state"]] for p in mine["pledges"]
        ],
        "trust": [[person, int(mine["trust"][i])] for i, person in enumerate(lo.people)],
        "stars": repute.stars(mine),
        "texts": {prop_id: texts[prop_id] for prop_id in sorted(texts)},
    }
