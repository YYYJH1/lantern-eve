"""The manager's own judgements of their notes: how two of them stand to each other, and the hint.

The notebook does not say how its entries stand to each other. The manager pairs two of them and
says how (the action ``judge``), and the core checks the logic of the two notes and nothing else: it
never looks at what is true in the game, which variant, or what anybody believes. A judgement that
holds is kept and shown as a mark of the entries (``marks``, ``notebook``). One that does not is
turned down, and costs nothing.

State (``state["world"]["player"]``)::

    {"judgments": [[a, b, relation, made]]   what the manager judged right, in order: the entry
                                            ids, the relation and the tick,
     "hint": [] | [a, b, relation, level]    the pair the last hint lit: level 1 lights the pair
                                            and level 2 says the relation too}

Actions (both cost no time, and need no talk)
---------------------------------------------
``judge``  ``{"a": entry id, "b": entry id, "relation": relation}``. ``a`` is the note that is the
           evidence and ``b`` the note that is the claim. The relations, as the core checks them:

           ``unsupported``  ``b`` goes beyond what ``a`` shows. They say different things and are
                            about the same matter: one story told again (``b`` added something to
                            what ``a`` says, or ``a`` is ``b`` with detail taken away), a person
                            or thing both name, or a conclusion that the script lists as tempting
                            from what ``a`` shows. Said as "the second goes beyond the first".
           ``contradicts``  they cannot both be true: the exclusive groups of the script, a
                            statement and its denial, one person in two places at once. Either
                            order.
           ``mismatch``     ``b`` names a person as its source, ``a`` is what that person told the
                            manager, and the two say different things about one story: the
                            retelling is not what the source said.

           Applied: the event ``judged`` (``a``, ``b``, ``relation``) and a row of ``judgments``.
           Judging the same thing twice adds nothing. Rejected: ``unknown_note`` (an id is not an
           entry of the notebook) and ``not_shown`` (the relation does not hold: from these two
           lines alone that cannot be told).
``hint``   ``{}``. Lights a pair that is worth comparing: a relation that holds between two notes
           and that the manager has not judged. (A relation that the script shows from the
           start is a mark and not a judgement, so it is still worth judging.) Contradictions
           come first, then mismatches, then notes that go beyond their evidence, each in the
           order of the notebook. Asking again about the same pair says the relation too. With
           no such pair the hint is empty. Always applied.

The frame. ``judgments`` is ``[{"a", "b", "relation", "made"}]`` and ``hint`` is ``{"a", "b"}``,
with ``"relation"`` once the manager has asked again for the same pair, or null. ``hud.verbs``
lists ``judge`` and ``hint`` once the notebook has two entries.

The agenda term ``judged`` (``relation``?) holds once there is a judgement, of that relation if one
is given.
"""

from __future__ import annotations

import functools
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from lantern_core.cognition import relations
from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN
from lantern_core.cognition.props import ExclusiveGroups, Prop, lineage
from lantern_core.inputs import InputError
from lantern_core.world.bridge import agenda_terms, converse, marks, notebook
from lantern_core.world.bridge.converse import ack
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

RELATIONS = marks.RELATIONS
HINT_ORDER = ("contradicts", "mismatch", "unsupported")  # the pair that a hint lights first
MIN_ENTRIES = 2  # a judgement is between two entries


# --------------------------------------------------------------------------- the logic of two notes


@functools.cache
def _toward() -> frozenset[tuple[str, str]]:
    """The conclusions the script lists as tempting from an observation: (what it shows, what it
    tempts one to conclude). They say that the second goes beyond the first."""
    return frozenset(
        (shown, toward)
        for observation in SCRIPT["observations"]
        for shown in observation["shows"]
        for toward in observation["toward"]
    )


def _same_matter(one: Prop, other: Prop, props: Mapping[str, Prop]) -> bool:
    """Whether two props are about the same thing: one story told again, a person or a thing that
    both name, or a conclusion the script finds tempting from the other."""
    first, second = lineage(one.id, props), lineage(other.id, props)
    if first and second and first[-1] == second[-1]:
        return True
    if {entity for _, entity in one.args} & {entity for _, entity in other.args}:
        return True
    return (one.id, other.id) in _toward()


def adds_to(claim_id: str, evidence_id: str, props: Mapping[str, Prop]) -> bool:
    """Whether ``claim_id`` is a version of ``evidence_id`` that says more: it was made from it by
    retelling, with some step that adds (anything but a ``level``, which takes detail away)."""
    from_claim = lineage(claim_id, props)
    if evidence_id not in from_claim:
        return False
    return any(props[step].op != "level" for step in from_claim[: from_claim.index(evidence_id)])


def unsupported(evidence: Prop, claim: Prop, props: Mapping[str, Prop]) -> bool:
    """Whether ``claim`` goes beyond what ``evidence`` shows.

    Two props of one lineage (one was made from the other by retelling) compare by what the
    retelling did: a step that levels takes detail away, and any other step (sharpening, filling in
    a motive, swapping a person for their family) adds to it. The one made later goes beyond the
    other if anything was added, and the other goes beyond it if every step only levelled. Props
    that are not of one lineage are compared only if they are about the same matter."""
    if evidence.id == claim.id or evidence.same_fact(claim):
        return False  # the same thing said again supports itself
    from_evidence, from_claim = lineage(evidence.id, props), lineage(claim.id, props)
    if claim.id in from_evidence:  # the evidence was made from the claim
        steps = from_evidence[: from_evidence.index(claim.id)]
        return all(props[step].op == "level" for step in steps)
    if evidence.id in from_claim:  # the claim was made from the evidence
        return adds_to(claim.id, evidence.id, props)
    return _same_matter(evidence, claim, props)


def contradicts(evidence: Prop, claim: Prop, groups: ExclusiveGroups, tables: Any) -> bool:
    """Whether the two cannot both be true."""
    return relations.mutually_exclusive(evidence, claim, groups, tables)


def mismatch(
    evidence: Mapping[str, Any], claim: Mapping[str, Any], props: Mapping[str, Prop]
) -> bool:
    """Whether the retelling ``claim`` is not what its source said, ``evidence`` being what that
    source told the manager about the same story."""
    told, heard = notebook.belief_of(evidence), notebook.belief_of(claim)
    named = heard.claimed_source
    if heard.source != "heard" or named in (None, SELF_SEEN, UNKNOWN, heard.teller):
        return False
    if told.source != "heard" or told.teller != named:
        return False
    one, other = props[evidence["prop"]], props[claim["prop"]]
    if one.id == other.id or one.same_fact(other):
        return False
    first, second = lineage(one.id, props), lineage(other.id, props)
    return bool(first) and bool(second) and first[-1] == second[-1]


def holds(
    relation: str,
    evidence: Mapping[str, Any],
    claim: Mapping[str, Any],
    props: Mapping[str, Prop],
    groups: ExclusiveGroups,
) -> bool:
    """Whether the relation holds between two entries of the notebook, by their props alone."""
    if relation == "unsupported":
        return unsupported(props[evidence["prop"]], props[claim["prop"]], props)
    if relation == "contradicts":
        one, other = props[evidence["prop"]], props[claim["prop"]]
        return contradicts(one, other, groups, lore().tables)
    return mismatch(evidence, claim, props)


def context(world_state: Mapping[str, Any]) -> tuple[Mapping[str, Prop], ExclusiveGroups]:
    """What a check reads besides the entries: every prop of the game, and the exclusive groups."""
    props = notebook.view(world_state["social"])
    return props, notebook.TwinGroups(lore().book.groups, props)


# --------------------------------------------------------------------------- the action judge


def validate_judge(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action judge"
    out = converse.plain(body, "judge")
    out["a"] = converse.id_field(body.get("a"), where, "a")
    out["b"] = converse.id_field(body.get("b"), where, "b")
    relation = body.get("relation")
    if relation not in RELATIONS:
        raise InputError(f"{where}: relation must be one of {', '.join(RELATIONS)}")
    out["relation"] = relation
    return out


def judged(section: Mapping[str, Any], a: str, b: str, relation: str) -> bool:
    return any(row[:3] == [a, b, relation] for row in section["judgments"])


def apply_judge(sim: Sim, body: dict[str, Any]) -> None:
    section = sim.state["player"]
    a, b = notebook.find(section, body["a"]), notebook.find(section, body["b"])
    if a is None or b is None:
        return ack(sim, body, "unknown_note")
    props, groups = context(sim.state)
    if a is b or not holds(body["relation"], a, b, props, groups):
        return ack(sim, body, "not_shown")
    relation = body["relation"]
    if not judged(section, a["id"], b["id"], relation):
        section["judgments"].append([a["id"], b["id"], relation, sim.ctx.tick])
        sim.emit("judged", a=a["id"], b=b["id"], relation=relation)
    hint = section["hint"]
    if hint and {hint[0], hint[1]} == {a["id"], b["id"]}:
        section["hint"] = []  # the pair it lit has been judged
    ack(sim, body)


# --------------------------------------------------------------------------- the action hint


def next_pair(world_state: Mapping[str, Any]) -> list[Any]:
    """The pair a hint lights now, ``[a, b, relation, 1]``, or ``[]`` where there is none."""
    section = world_state["player"]
    entries = section["notebook"]
    props, groups = context(world_state)
    done = {(row[0], row[1], row[2]) for row in section["judgments"]}
    for relation in HINT_ORDER:
        for a in entries:
            for b in entries:
                key = (a["id"], b["id"], relation)
                if a is b or key in done:
                    continue
                if relation == "contradicts" and (b["id"], a["id"], relation) in done:
                    continue  # two notes that contradict do so in either order
                if holds(relation, a, b, props, groups):
                    return [a["id"], b["id"], relation, 1]
    return []


def apply_hint(sim: Sim, body: dict[str, Any]) -> None:
    section = sim.state["player"]
    hint = section["hint"]
    if hint and not judged(section, hint[0], hint[1], hint[2]):
        hint[3] = 2  # the same pair again: say how they stand
    else:
        section["hint"] = next_pair(sim.state)
    ack(sim, body)


# --------------------------------------------------------------------------- reading it


def available(world_state: Mapping[str, Any]) -> bool:
    """Whether the manager has two notes to judge between (and so can ask for a hint)."""
    return len(world_state["player"]["notebook"]) >= MIN_ENTRIES


def wire_judgments(section: Mapping[str, Any]) -> list[dict[str, Any]]:
    return [
        {"a": a, "b": b, "relation": relation, "made": made}
        for a, b, relation, made in section["judgments"]
    ]


def wire_hint(section: Mapping[str, Any]) -> dict[str, Any] | None:
    hint = section["hint"]
    if not hint:
        return None
    out: dict[str, Any] = {"a": hint[0], "b": hint[1]}
    if hint[3] >= 2:
        out["relation"] = hint[2]
    return out


def _judged(env: agenda_terms.Env, cond: dict[str, Any]) -> bool:
    wanted = cond.get("relation")
    return any(wanted is None or row[2] == wanted for row in env.state["player"]["judgments"])


agenda_terms.implement("judged", _judged)

ACTIONS = {
    "judge": (validate_judge, apply_judge),
    "hint": (lambda world, body: converse.plain(body, "hint"), apply_hint),
}
