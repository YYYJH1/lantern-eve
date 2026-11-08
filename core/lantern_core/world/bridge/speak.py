"""What the manager tells a person: the five ways of telling, and what the person makes of it.

``tell`` in a conversation puts one thing in the ear of the person the manager is talking to. The
body is ``{"entry": id, "how": way}`` or, to make something up, ``{"how": "fabricate", "pred": id,
"subject": id, "object": id, "neg": bool, "source": "self_seen" | "unknown"}``. Without ``how`` a
thing is told as it is. The ways, and the rules they follow, are those of the town's own tellings
(``telling``, ``retell`` and ``paths``):

``faithful``     the entry as it stands, naming the source it has: "I saw it myself" if the manager
                 saw it, else the person who told them.
``as_seen``      the entry, said to have been seen. If the manager did see it that is the truth, and
                 otherwise it is a lie about the source. The listener hears it first-hand, so they
                 believe it more than the same thing at the hand it really came, and more again
                 for being told that it was seen (``telling.SEEN_WEIGHT``).
``sharpen``      the entry made heavier by the operator ``sharpen`` (took becomes stole, a missing
                 motive becomes on purpose), or by ``fill`` when there is nothing to sharpen. It is
                 a retelling like a neighbour's and not a lie. Nothing to sharpen is a rejection.
``hide_source``  the entry with the source left out: "I heard that". The listener believes it a
                 little less, and still knows who told them.
``fabricate``    a fact made up from the table of predicates: a predicate, a subject for its first
                 slot and an object for its second, from the entities of the script, or a denial of
                 it. Nothing in the notebook backs it, and the claim is recorded as a lie. It names
                 the source ``self_seen`` or ``unknown``, and the listener weighs it as such.

The listener takes it in as they would from a neighbour: the confidence is that of
``telling.confidence`` for the listener's trust in the manager, the hand it came to them at, the
source named and whether it fits what they hold; a belief that contradicts one they hold with more
confidence is set aside (``telling.hold``); and what they already hold is not overwritten. A person
who is told that they or their kin did something blameworthy trusts the manager ``BLAME_TRUST``
less, as they would hold a grudge against a neighbour for the same words. The claim goes into the
record of the town as the manager's (speaker ``"player"``), a prop made on the way into its book,
and the prop is the listener's to tell on, so it spreads. A lie goes into the ledger of ``lies``,
and the listener may catch it at once.

Events: ``told`` (``claim``, ``speaker``, ``listener``, ``prop``, ``path``, ``op``, ``modality``,
and ``how`` and ``outcome``: ``took``, ``knew``, ``doubted`` or ``caught``). Rejected:
``not_talking``, ``no_entry``, ``no_sharpen``, ``bad_claim``, ``refused``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN, Belief, Claim
from lantern_core.cognition.props import Prop, lineage
from lantern_core.inputs import InputError
from lantern_core.world.bridge import (
    bonds,
    converse,
    lies,
    notebook,
    notes,
    repute,
    retell,
    telling,
)
from lantern_core.world.bridge.lore import BLAME_PREDS, PLAYER, Lore, lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

HOWS = ("faithful", "as_seen", "sharpen", "hide_source", "fabricate")
SOURCES = (SELF_SEEN, UNKNOWN)  # what a made-up thing may say about where it comes from
META = (repute.MADE[repute.LIED], repute.MADE[repute.BROKE])  # not for making up
BLAME_TRUST = 6  # trust lost with a person who is told that they or their kin did wrong
TOOK, KNEW, DOUBTED, CAUGHT = "took", "knew", "doubted", "caught"
REACTIONS = {TOOK: "took_in", KNEW: "knew", DOUBTED: "doubted", CAUGHT: "caught"}


@dataclass(frozen=True, slots=True)
class Plan:
    """What the manager says: the prop, how, and where from."""

    prop: Prop
    modality: str
    source: str  # the source they name
    path: str  # belief, mutation or lie
    op: str | None = None

    @property
    def lie(self) -> bool:
        return self.path == "lie"


# ---------------------------------------------------------------------------- validating


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action tell"
    out = converse.plain(body, "tell")
    how = body.get("how", "faithful")
    if how not in HOWS:
        raise InputError(f"{where}: how must be one of {', '.join(HOWS)}")
    out["how"] = how
    if how == "fabricate":
        out["pred"] = converse.id_field(body.get("pred"), where, "pred")
        out["subject"] = converse.id_field(body.get("subject"), where, "subject")
        thing = body.get("object", "")
        if not isinstance(thing, str) or len(thing) > converse.MAX_ID_CHARS:
            raise InputError(f"{where}: object must be a string of at most 64 characters")
        out["object"] = thing
        neg = body.get("neg", False)
        if type(neg) is not bool:
            raise InputError(f"{where}: neg must be true or false")
        out["neg"] = neg
        source = body.get("source", SELF_SEEN)
        if source not in SOURCES:
            raise InputError(f"{where}: source must be one of {', '.join(SOURCES)}")
        out["source"] = source
    else:
        out["entry"] = converse.id_field(body.get("entry"), where, "entry")
    return converse.with_words(out, body, where)


# ---------------------------------------------------------------------------- the ways


def sharpened(lo: Lore, social: dict[str, Any], prop: Prop, belief: Belief, store: Any) -> Any:
    """The change the manager makes to a prop to tell it with more drama, or None: the operator
    ``sharpen``, else ``fill``. The prop it makes is settled into the book of the game."""
    view = notebook.view(social)
    changes = retell.changes(
        lo, view, prop, belief, store, suspicion=0, relation=lambda kind, holder, target: False
    )
    for op in ("sharpen", "fill"):
        for change in changes:
            if change.op == op:
                return retell.Change(
                    op, retell.settle(lo, notes.made_props(social), change.prop), change.rule
                )
    return None


def fabricated(lo: Lore, body: dict[str, Any]) -> Prop | None:
    """The prop that ``pred``, ``subject`` and ``object`` make, or None if the table cannot say it.

    The subject fills the first slot of the predicate and the object the second, each with an
    entity of the script of the type the slot takes, and every required slot is filled. The prop
    has no span and no motive. If the script has that very prop, it is the script's. Nothing is
    written to the book of the game: ``apply`` does that when the prop is told.
    """
    pred = lo.tables.predicates.get(body["pred"])
    if pred is None or pred.id in META:
        return None
    given = [body["subject"]] + ([body["object"]] if body["object"] else [])
    required = [s for s in pred.slots if s.required]
    if len(given) < len(required) or len(given) > len(pred.slots):
        return None
    args: dict[str, str] = {}
    for slot, entity_id in zip(pred.slots, given, strict=False):
        entity = lo.book.registry.get(entity_id)
        if entity is None or not slot.allows(entity.type):
            return None
        args[slot.name] = entity_id
    neg = body["neg"]
    for pid in lo.book.props:
        known = lo.book.props[pid]
        plain = known.span is None and known.motive is None and known.parent is None
        if plain and known.pred == pred.id and known.args_dict() == args and known.neg == neg:
            return known
    parts = [pred.id, *(args[s.name] for s in pred.slots if s.name in args)]
    prop_id = "fab__" + "__".join(parts) + ("__not" if neg else "")
    return Prop.of(prop_id, pred.id, args, None, neg)


def plan_of(sim: Sim, body: dict[str, Any]) -> Plan | str:
    """What the manager would say for a body, or the reason it cannot be said."""
    section, social, lo = sim.state["player"], sim.state["social"], lore()
    how = body["how"]
    if how == "fabricate":
        prop = fabricated(lo, body)
        if prop is None:
            return "bad_claim"
        return Plan(prop, "lie", body["source"], "lie")
    entry = notebook.find(section, body["entry"])
    if entry is None:
        return "no_entry"
    belief = notebook.belief_of(entry)
    prop = notebook.view(social)[entry["prop"]]
    modality = belief.modality
    if modality == "assert" and prop.neg:
        modality = "deny"
    honest = belief.honest_source()
    if how == "faithful":
        return Plan(prop, modality, honest, "belief")
    if how == "hide_source":
        return Plan(prop, modality, UNKNOWN, "belief")
    if how == "as_seen":
        if belief.source == "saw":
            return Plan(prop, modality, SELF_SEEN, "belief")
        return Plan(prop, "lie", SELF_SEEN, "lie")
    change = sharpened(lo, social, prop, belief, notebook.store(section))
    if change is None:
        return "no_sharpen"
    return Plan(change.prop, modality, honest, "mutation", change.op)


# ---------------------------------------------------------------------------- telling


def blames(lo: Lore, prop: Prop, person: str) -> bool:
    """Whether the prop says that ``person`` or their kin did something blameworthy."""
    return not prop.neg and prop.pred in BLAME_PREDS and prop.arg("who") in lo.kin[person]


def hear(sim: Sim, index: int, plan: Plan, claim: Claim, overlay: notes.PropView) -> str:
    """The listener's side: they write down what they were told unless they hold it already.

    Returns ``took`` (it is theirs now), ``knew`` (they held it) or ``doubted`` (they hold
    something against it that they trust more, so it is set aside).
    """
    section, social, lo = sim.state["player"], sim.state["social"], lore()
    person = lo.people[index]
    held = notes.store(social, person)
    known = held.get(plan.prop.id)
    if known is not None and known.confidence > 0:
        return KNEW
    agrees = any(
        (near := held.get(pid)) is not None and near.confidence >= telling.AGREES_AT
        for pid in lineage(plan.prop.id, overlay)[1:]
    )
    mine = notebook.store(section)
    hops = paths.listener_belief(claim, person, mine, overlay, confidence=50).hop
    conf = telling.confidence(lo, repute.trust(section, index), frozenset(), claim, hops, agrees)
    heard = paths.listener_belief(claim, person, mine, overlay, confidence=conf)
    kept = telling.hold(sim, social, lo, overlay, plan.prop, heard, claim.id)
    return TOOK if kept else DOUBTED


def apply(sim: Sim, body: dict[str, Any]) -> None:
    section, social, lo = sim.state["player"], sim.state["social"], lore()
    found = converse.partner(sim)
    if found is None:
        return converse.ack(sim, body, "not_talking")
    index, _ = found
    plan = plan_of(sim, body)
    if isinstance(plan, str):
        return converse.ack(sim, body, plan)
    person, tick = lo.people[index], sim.ctx.tick
    overlay = notes.PropView({plan.prop.id: plan.prop}, notebook.view(social))
    claim = Claim(
        f"c{social['seq']}", PLAYER, (person,), plan.prop.id, plan.modality, plan.source, tick,
        plan.path, op=plan.op,
    )  # fmt: skip
    if not plan.lie:
        verdict, _ = paths.authorize(
            claim,
            notebook.store(section),
            overlay,
            tables=lo.tables,
            registry=lo.book.registry,
            rules=lo.book.rules,
            templates=lo.book.templates,
            relation=bonds.grudge_check(social, lo),
            public=lo.public,
        )
        if not verdict:
            return converse.ack(sim, body, "refused")
    social["seq"] += 1
    social["claims"][claim.id] = notes.encode_claim(claim)
    social["counts"]["told"] += 1
    if plan.prop.id not in lo.book.props:
        social["props"].setdefault(plan.prop.id, notes.encode_prop(plan.prop))
    section["told"].append([claim.id, person, plan.prop.id, body["how"], int(plan.lie), tick])
    if plan.lie:
        lies.log(section, claim, body["how"])
    outcome = hear(sim, index, plan, claim, overlay)
    if outcome != KNEW and blames(lo, plan.prop, person):
        repute.nudge(section, index, -BLAME_TRUST)  # as a neighbour's grudge for the same words
    if plan.lie and lies.check(sim, person):
        outcome = CAUGHT
    sim.emit(
        "told",
        claim=claim.id,
        speaker=PLAYER,
        listener=person,
        prop=plan.prop.id,
        path=claim.path,
        op=claim.op,
        modality=claim.modality,
        how=body["how"],
        outcome=outcome,
    )
    if outcome != CAUGHT:  # a lie that is caught was answered, in the same words, by the catch
        converse.reply(sim, REACTIONS[outcome])
    converse.ack(sim, body)
