"""Walking a belief back to where it came from.

Each heard belief points at the claim that delivered it, the claim names the speaker, and the
speaker's own belief is what the claim rested on: the same prop for a repeated belief, the
parent prop for a mutation. Following those links from the last hearer gives the chain back to
whoever saw it, guessed it, read it or made it up. The links are the real edges, so naming a
different source or hiding it (``unknown``) does not change where the walk goes.

The walk needs the stores of everyone along the way and the claims by id, which only the core
has. What a player gets to see of it is decided elsewhere.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.paths import backing_prop
from lantern_core.cognition.props import Prop

ENDS = ("saw", "inferred", "paper", "street", "lie", "broken")


@dataclass(frozen=True, slots=True)
class Hop:
    """One holder's belief on the way back, and the claim that delivered it, if any."""

    holder: str
    belief: Belief
    claim: Claim | None


@dataclass(frozen=True, slots=True)
class Trace:
    """The way from a belief back to its origin, nearest hop first.

    ``end`` says how the walk ended: at someone who saw it, who worked it out, a newspaper, street
    talk, a lie, or ``broken`` where a store, a claim or a belief is missing. ``origin`` is the
    person at that end (the liar, for a lie).
    """

    hops: tuple[Hop, ...]
    end: str
    origin: str | None

    @property
    def mutations(self) -> tuple[tuple[str, str, str], ...]:
        """``(claim id, speaker, operator)`` for each retelling that changed the prop."""
        return tuple(
            (h.claim.id, h.claim.speaker, h.claim.op)
            for h in self.hops
            if h.claim is not None and h.claim.path == "mutation" and h.claim.op is not None
        )

    def first_change(self) -> Hop | None:
        """The hop nearest the origin whose retelling changed the prop: where it changed shape."""
        changed = [h for h in self.hops if h.claim is not None and h.claim.path == "mutation"]
        return changed[-1] if changed else None


def walk_back(
    holder: str,
    prop_id: str,
    stores: Mapping[str, BeliefStore],
    claims: Mapping[str, Claim],
    props: Mapping[str, Prop],
) -> Trace:
    """The trace of ``holder``'s belief in ``prop_id`` back to where it started."""
    hops: list[Hop] = []
    seen: set[tuple[str, str]] = set()
    cur_holder, cur_prop = holder, prop_id
    while True:
        store = stores.get(cur_holder)
        belief = None if store is None else store.get(cur_prop)
        if belief is None or (cur_holder, cur_prop) in seen:
            return Trace(tuple(hops), "broken", hops[-1].holder if hops else cur_holder)
        seen.add((cur_holder, cur_prop))
        claim = claims.get(belief.claim) if belief.claim is not None else None
        hops.append(Hop(cur_holder, belief, claim))
        if belief.source in ("saw", "paper", "street"):
            return Trace(tuple(hops), belief.source, cur_holder)
        if belief.source == "inferred":
            # A prop the holder changed and then held stays tied to the prop it was changed from.
            if claim is not None and claim.path == "mutation" and claim.speaker == cur_holder:
                parent = backing_prop(claim, props)
                if parent is not None:
                    cur_prop = parent
                    continue
            return Trace(tuple(hops), "inferred", cur_holder)
        if claim is None or claim.speaker != belief.teller or claim.prop != cur_prop:
            return Trace(tuple(hops), "broken", cur_holder)
        if claim.path == "lie":
            return Trace(tuple(hops), "lie", claim.speaker)
        if claim.path == "speculation":
            return Trace(tuple(hops), "inferred", claim.speaker)
        backing = backing_prop(claim, props)
        if backing is None:
            return Trace(tuple(hops), "broken", cur_holder)
        cur_holder, cur_prop = claim.speaker, backing
