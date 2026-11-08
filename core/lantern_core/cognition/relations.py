"""The four marks of the notebook, as pure functions on props, groups and a holder's store.

The notebook compares typed props and never calls a model. It marks a statement as

- ``exclusive``: it cannot be true together with another statement the holder has. Two props
  exclude each other if they sit in one exclusive group, if they state and deny the same thing
  over spans that overlap, or if they put one person in two places at overlapping times.
- ``no_support``: nothing the holder saw makes it true. Only a first-hand belief in this prop,
  or in a statement of the same content that is not its parent or child, counts. What was seen of
  the parent of a changed prop does not, and neither does anything heard.
- ``source_mismatch``: the one who told it names a source, and what that source is on record as
  having said to the teller is a different prop.
- ``unconfirmed``: nobody in the chain behind it saw it.

Being exclusive and having no support are different. That Li Er was at the bridge that night does
not contradict that Li Er broke the bridge. It gives no support to it either.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping

from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN, Belief, BeliefStore, Claim
from lantern_core.cognition.props import (
    AT_PRED,
    ExclusiveGroups,
    Predicate,
    Prop,
    Tables,
    lineage,
    spans_overlap,
)
from lantern_core.cognition.provenance import Trace

EXCLUSIVE = "exclusive"
NO_SUPPORT = "no_support"
SOURCE_MISMATCH = "source_mismatch"
UNCONFIRMED = "unconfirmed"
MARKS = (EXCLUSIVE, NO_SUPPORT, SOURCE_MISMATCH, UNCONFIRMED)


def _at_slots(pred: Predicate) -> tuple[str, str] | None:
    """The names of the person slot and the place slot of ``at``, taken from the table by type."""
    people = [s.name for s in pred.slots if s.allows("person")]
    places = [s.name for s in pred.slots if s.allows("place")]
    return (people[0], places[0]) if people and places else None


def mutually_exclusive(
    a: Prop, b: Prop, groups: ExclusiveGroups, tables: Tables | None = None
) -> bool:
    """Whether ``a`` and ``b`` cannot both be true.

    A span that was not stated overlaps nothing, so a vague claim never contradicts a precise
    one. The one exception is a denial with no span, which denies the thing at any time.
    The person-in-two-places rule applies only when ``tables`` has the predicate ``at``.
    """
    if a.id == b.id:
        return False
    if groups.together(a.id, b.id):
        return True
    if a.pred == b.pred and a.args == b.args and a.neg != b.neg:
        positive, negative = (b, a) if a.neg else (a, b)
        return negative.span is None or spans_overlap(positive.span, negative.span)
    if tables is not None and a.pred == b.pred == AT_PRED and not a.neg and not b.neg:
        pred = tables.predicates.get(AT_PRED)
        slots = None if pred is None else _at_slots(pred)
        if slots is not None:
            who, where = slots
            return (
                a.arg(who) == b.arg(who)
                and a.arg(where) != b.arg(where)
                and spans_overlap(a.span, b.span)
            )
    return False


def conflicts(
    prop: Prop,
    store: BeliefStore,
    props: Mapping[str, Prop],
    groups: ExclusiveGroups,
    tables: Tables | None = None,
) -> list[str]:
    """The props in ``store`` that exclude ``prop``, in id order."""
    return [
        b.prop
        for b in store
        if (other := props.get(b.prop)) is not None
        and mutually_exclusive(prop, other, groups, tables)
    ]


def _same_witnessed_fact(prop: Prop, other_id: str, props: Mapping[str, Prop]) -> bool:
    """Whether a first-hand belief in ``other_id`` is a sighting of ``prop`` itself."""
    if other_id == prop.id:
        return True
    other = props.get(other_id)
    if other is None or not other.same_fact(prop):
        return False
    # The same words reached again by changing a parent back are not a sighting of the parent.
    return other_id not in lineage(prop.id, props) and prop.id not in lineage(other_id, props)


def supported(prop: Prop, store: BeliefStore, props: Mapping[str, Prop]) -> bool:
    """Whether the holder saw ``prop``, or saw another prop that says the same and is not kin."""
    return any(b.source == "saw" and _same_witnessed_fact(prop, b.prop, props) for b in store)


def no_support(prop: Prop, store: BeliefStore, props: Mapping[str, Prop]) -> bool:
    return not supported(prop, store, props)


def source_mismatch(
    belief: Belief, claims: Iterable[Claim], props: Mapping[str, Prop] | None = None
) -> bool:
    """Whether the source named for ``belief`` is on record as having said something else.

    Only a person can be checked. The claims looked at are those the named source made to the
    teller before the belief was written down. If there are none, nothing is known and the
    answer is no. With ``props``, a claim that states the same content under another id agrees.
    """
    named = belief.claimed_source
    if belief.source != "heard" or named in (None, SELF_SEEN, UNKNOWN):
        return False
    told = [
        c
        for c in claims
        if c.speaker == named and belief.teller in c.listeners and c.tick <= belief.tick
    ]
    if not told:
        return False
    own = None if props is None else props.get(belief.prop)

    def agrees(c: Claim) -> bool:
        if c.prop == belief.prop:
            return True
        said = None if props is None else props.get(c.prop)
        return own is not None and said is not None and said.same_fact(own)

    return not any(agrees(c) for c in told)


def unconfirmed(
    prop: Prop, store: BeliefStore, props: Mapping[str, Prop], trace: Trace | None = None
) -> bool:
    """Whether nobody the holder can trace the prop to saw it.

    Without a ``trace`` only the holder's own sightings count. With one, a hop at which someone
    saw this prop (or an unrelated prop of the same content) confirms it. A witness of the
    parent does not, since the prop in hand is not what they saw.
    """
    if supported(prop, store, props):
        return False
    if trace is None:
        return True
    return not any(
        hop.belief.source == "saw" and _same_witnessed_fact(prop, hop.belief.prop, props)
        for hop in trace.hops
    )


def marks(
    belief: Belief,
    store: BeliefStore,
    props: Mapping[str, Prop],
    groups: ExclusiveGroups,
    tables: Tables | None = None,
    claims: Iterable[Claim] = (),
    trace: Trace | None = None,
) -> tuple[str, ...]:
    """The marks that apply to one entry of the notebook, in the fixed order of ``MARKS``."""
    prop = props[belief.prop]
    found = []
    if conflicts(prop, store, props, groups, tables):
        found.append(EXCLUSIVE)
    if no_support(prop, store, props):
        found.append(NO_SUPPORT)
    if source_mismatch(belief, claims, props):
        found.append(SOURCE_MISMATCH)
    if unconfirmed(prop, store, props, trace):
        found.append(UNCONFIRMED)
    return tuple(found)
