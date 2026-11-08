"""The four ways a speaker may say something, as checks on a claim.

A townsperson may say a prop only along one of four paths. Anything else is out of bounds,
however natural it sounds. Believing something false is not out of bounds, since that is the
state the character is really in.

- ``belief``: the prop is one the speaker holds. It is said in the modality of that belief and
  names the belief's source. The listener's copy is one hop further.
- ``speculation``: the prop is the conclusion of a script rule whose premises the speaker
  holds or the town knows. It is always said as a guess. The speaker records it as inferred,
  the listener as heard from the speaker, as a guess.
- ``mutation``: the prop is one operator's change to a belief the speaker holds. It is said in
  the modality of that belief, except that ``level`` may drop a guess to an assertion. The
  operator is on the claim, and the speaker holds the changed prop as inferred. One change
  also needs a rule: ``assimilate`` that turns a prop into another predicate (at the bridge
  into broke the bridge) is allowed only as the conclusion of a speculation rule whose other
  premises the speaker holds or the town knows, and the claim names that rule.
- ``lie``: the prop and the source named come from a template written for this speaker. It is
  said as an assertion, the listener hears it as one, and the speaker notes who was told.

A guess becomes an assertion in two ways only: the ``level`` operator, which drops the hedge
and is recorded on the claim, or a lie. ``authorize`` refuses every other route, with a reason
that begins with a short code (``modality``, ``source``, ``premises`` and so on) so that
refusals can be counted by kind.

The source a speaker names follows the belief: what was seen is ``self_seen``, what was heard
is the person who told it, and ``unknown`` may always be named instead, which hides the source
and nothing more. Naming anything else is a lie, and only a template can allow one.

A rule may demand a standing between the speaker and a person it names, such as a grudge. The
core does not hold relations, so ``authorize`` asks a callable, and without one the answer is no.
"""

from __future__ import annotations

from collections.abc import Callable, Collection, Mapping
from dataclasses import dataclass

from lantern_core.cognition.beliefs import (
    UNKNOWN,
    Belief,
    BeliefStore,
    Claim,
    LieNote,
)
from lantern_core.cognition.props import Prop, Registry, Tables, mutation_problem
from lantern_core.cognition.rules import LieTemplate, SpecRule

RelationCheck = Callable[[str, str, str], bool]
"""``(kind, holder, target) -> bool``: whether ``holder`` stands in the relation ``kind`` (such
as ``"grudge"``) toward ``target``."""


class PathError(ValueError):
    """A claim or a belief asked for in a way the four paths do not allow."""


# ----------------------------------------------------------------------------- authorization

Verdict = tuple[bool, str]
_OK: Verdict = (True, "ok")


def _no(code: str, detail: str) -> Verdict:
    return (False, f"{code}: {detail}")


@dataclass(frozen=True, slots=True)
class _Context:
    """What the script and the caller supply besides the claim, the store and the book."""

    tables: Tables
    registry: Registry
    rules: Mapping[str, SpecRule]
    templates: Mapping[str, LieTemplate]
    suspicion: int
    relation: RelationCheck | None
    public: Collection[str]


_EXTRAS = {
    "belief": (),
    "speculation": ("rule_id", "premises"),
    "mutation": ("op",),
    "lie": ("template_id",),
}


def _needs_rule(prop: Prop, props: Mapping[str, Prop]) -> bool:
    """Whether ``prop`` is an ``assimilate`` that changes the predicate of its parent."""
    parent = None if prop.parent is None else props.get(prop.parent)
    return prop.op == "assimilate" and parent is not None and parent.pred != prop.pred


def _extras_problem(claim: Claim, prop: Prop, props: Mapping[str, Prop]) -> str | None:
    present = {
        "rule_id": claim.rule_id is not None,
        "premises": bool(claim.premises),
        "op": claim.op is not None,
        "template_id": claim.template_id is not None,
    }
    needed = _EXTRAS[claim.path]
    if claim.path == "mutation" and _needs_rule(prop, props):
        needed = (*needed, "rule_id")
    for name, here in present.items():
        if here and name not in needed:
            if name == "rule_id" and claim.path == "mutation":
                return "rule_id belongs to a mutation only when assimilate changes the predicate"
            return f"{name} does not belong to the {claim.path} path"
    for name in needed:
        if not present[name]:
            return f"the {claim.path} path needs {name}"
    return None


def _source_verdict(claim: Claim, belief: Belief) -> Verdict:
    honest = belief.honest_source()
    if claim.claimed_source in (honest, UNKNOWN):
        return _OK
    return _no(
        "source",
        f"{claim.speaker} names {claim.claimed_source!r}, but the belief allows"
        f" {honest!r} or {UNKNOWN!r}",
    )


def _unavailable(
    store: BeliefStore, prop_id: str, tick: int, public: Collection[str]
) -> Verdict | None:
    """Why the speaker cannot rest on ``prop_id`` at ``tick``, or ``None`` if they can.

    A prop the town knows is available. Otherwise the speaker must hold a belief in it that is
    no younger than the claim.
    """
    if prop_id in public:
        return None
    held = store.get(prop_id)
    if held is None:
        return _no("premises", f"{store.holder} holds no belief in premise {prop_id}")
    if held.tick > tick:
        return _no("premature", f"premise {prop_id} was learnt after the claim")
    return None


def _relation_holds(rule: SpecRule, env: Mapping[str, str], speaker: str, ctx: _Context) -> bool:
    """Whether the standing the rule demands holds under ``env``. A rule without one always does."""
    if rule.relation is None:
        return True
    check = ctx.relation
    return check is not None and check(rule.relation.kind, speaker, env[rule.relation.target[1:]])


def _belief_path(claim: Claim, store: BeliefStore, prop: Prop) -> Verdict:
    belief = store.get(claim.prop)
    if belief is None:
        return _no("no_belief", f"{claim.speaker} holds no belief in {claim.prop}")
    if belief.tick > claim.tick:
        return _no("premature", f"the belief dates from {belief.tick}, after the claim")
    allowed = ("assert", "deny") if belief.modality == "assert" else ("speculate",)
    if claim.modality not in allowed:
        return _no(
            "modality",
            f"a {belief.modality} belief may be said as {list(allowed)}, not {claim.modality!r}",
        )
    if claim.modality == "deny" and not prop.neg:
        return _no("deny_needs_negation", f"{claim.prop} is not a negated prop")
    return _source_verdict(claim, belief)


def _speculation_path(
    claim: Claim, store: BeliefStore, prop: Prop, props: Mapping[str, Prop], ctx: _Context
) -> Verdict:
    if claim.modality != "speculate":
        return _no("modality", f"a guess is said as 'speculate', not {claim.modality!r}")
    assert claim.rule_id is not None
    rule = ctx.rules.get(claim.rule_id)
    if rule is None:
        return _no("unknown_rule", f"the script has no rule {claim.rule_id!r}")
    if ctx.suspicion < rule.min_suspicion:
        return _no(
            "suspicion", f"{rule.id} needs {rule.min_suspicion}, the speaker has {ctx.suspicion}"
        )
    if len(claim.premises) != len(rule.premises):
        return _no(
            "premises", f"{rule.id} has {len(rule.premises)} premises, got {len(claim.premises)}"
        )
    env: dict[str, str] = {}
    for i, premise_id in enumerate(claim.premises):
        premise = props.get(premise_id)
        if premise is None:
            return _no("premises", f"premise {premise_id} is not in the book")
        refused = _unavailable(store, premise_id, claim.tick, ctx.public)
        if refused is not None:
            return refused
        matched = rule.bind(i, premise, env, ctx.registry)
        if matched is None:
            return _no("premises", f"{premise_id} does not fit premise {i + 1} of {rule.id}")
        env = matched
    if not rule.concludes(prop, env, ctx.registry):
        return _no(
            "conclusion", f"{claim.prop} is not what {rule.id} concludes from these premises"
        )
    if not _relation_holds(rule, env, claim.speaker, ctx):
        return _no("relation", _relation_detail(rule, env, claim.speaker))
    if claim.claimed_source != claim.speaker:
        return _no("source", "a guess is attributed to the one who guesses")
    return _OK


def _relation_detail(rule: SpecRule, env: Mapping[str, str], speaker: str) -> str:
    assert rule.relation is not None
    target = env[rule.relation.target[1:]]
    return f"{rule.id} needs a {rule.relation.kind} of {speaker} toward {target}"


def _licence_verdict(
    claim: Claim,
    store: BeliefStore,
    parent: Prop,
    prop: Prop,
    props: Mapping[str, Prop],
    rule: SpecRule,
    ctx: _Context,
) -> Verdict:
    """Whether the speaker may apply ``rule`` to turn ``parent`` into ``prop``: suspicious
    enough, resting the other premises on what they hold or the town knows, and with the
    standing the rule demands toward whoever it binds."""
    if ctx.suspicion < rule.min_suspicion:
        return _no(
            "suspicion", f"{rule.id} needs {rule.min_suspicion}, the speaker has {ctx.suspicion}"
        )
    usable = [
        props[pid]
        for pid in sorted(props)
        if _unavailable(store, pid, claim.tick, ctx.public) is None
    ]
    found = list(rule.derivations(parent, prop, usable, ctx.registry))
    if not found:
        return _no(
            "premises",
            f"{claim.speaker} holds or knows nothing to rest the other premises of {rule.id} on",
        )
    if not any(_relation_holds(rule, env, claim.speaker, ctx) for env in found):
        return _no("relation", _relation_detail(rule, found[0], claim.speaker))
    return _OK


def _mutation_path(
    claim: Claim, store: BeliefStore, prop: Prop, props: Mapping[str, Prop], ctx: _Context
) -> Verdict:
    if prop.parent is None or prop.op is None:
        return _no("not_a_mutation", f"{claim.prop} has no parent and operator")
    if claim.op != prop.op:
        return _no("op", f"the claim says {claim.op!r}, the prop was made by {prop.op!r}")
    parent = props.get(prop.parent)
    if parent is None:
        return _no("unknown_prop", f"the parent {prop.parent} is not in the book")
    rule = None
    if _needs_rule(prop, props):
        assert claim.rule_id is not None
        rule = ctx.rules.get(claim.rule_id)
        if rule is None:
            return _no("unknown_rule", f"the script has no rule {claim.rule_id!r}")
    why = mutation_problem(parent, prop, prop.op, ctx.tables, ctx.registry, rule, book=props)
    if why is not None:
        return _no("op", why)
    belief = store.get(prop.parent)
    if belief is None:
        return _no("no_belief", f"{claim.speaker} holds no belief in the parent {prop.parent}")
    if belief.tick > claim.tick:
        return _no("premature", f"the belief dates from {belief.tick}, after the claim")
    if claim.modality != belief.modality:
        drops_a_guess = (
            belief.modality == "speculate" and claim.modality == "assert" and prop.op == "level"
        )
        if not drops_a_guess:
            return _no(
                "modality",
                f"a {belief.modality} belief changed by {prop.op} is said as {belief.modality},"
                f" not {claim.modality!r}",
            )
    verdict = _source_verdict(claim, belief)
    if not verdict[0] or rule is None:
        return verdict
    return _licence_verdict(claim, store, parent, prop, props, rule, ctx)


def _lie_path(claim: Claim, ctx: _Context) -> Verdict:
    if claim.modality != "lie":
        return _no("modality", f"a lie is said as 'lie', not {claim.modality!r}")
    assert claim.template_id is not None
    template = ctx.templates.get(claim.template_id)
    if template is None:
        return _no("unknown_template", f"the script has no lie {claim.template_id!r}")
    if template.kind != "claim":
        return _no("template_kind", f"{template.id} feigns ignorance and claims nothing")
    if template.holder != claim.speaker:
        return _no("template_speaker", f"{template.id} is written for {template.holder}")
    if template.prop != claim.prop:
        return _no("template_prop", f"{claim.prop} is not what {template.id} allows")
    if template.claimed_source != claim.claimed_source:
        return _no(
            "template_source",
            f"{template.id} names {template.claimed_source!r}, not {claim.claimed_source!r}",
        )
    return _OK


def authorize(
    claim: Claim,
    speaker_store: BeliefStore,
    props: Mapping[str, Prop],
    *,
    tables: Tables,
    registry: Registry,
    rules: Mapping[str, SpecRule] | None = None,
    templates: Mapping[str, LieTemplate] | None = None,
    suspicion: int = 0,
    relation: RelationCheck | None = None,
    public: Collection[str] = (),
) -> Verdict:
    """Whether the speaker may say this, as ``(ok, reason)``. The reason is ``"ok"`` or a code.

    ``speaker_store`` is the store of the speaker as it stands when the claim is made, and
    ``props`` is the book. ``tables`` and ``registry`` are the script's, which the operators are
    measured against. ``rules`` and ``templates`` are the script's, by id, and ``suspicion`` is the
    speaker's, which the speculation rules are measured against.

    ``relation`` answers whether the speaker stands in a relation (such as a grudge) toward a
    person, for the rules that demand one, and without it every such rule is refused. ``public``
    lists the props the whole town knows, such as where the bridge is, which a premise may rest
    on without the speaker having been told.
    """
    if speaker_store.holder != claim.speaker:
        return _no("wrong_store", f"{speaker_store.holder}'s store, but {claim.speaker} speaks")
    prop = props.get(claim.prop)
    if prop is None:
        return _no("unknown_prop", f"{claim.prop} is not in the book")
    extras = _extras_problem(claim, prop, props)
    if extras is not None:
        return _no("extras", extras)
    ctx = _Context(tables, registry, rules or {}, templates or {}, suspicion, relation, public)
    if claim.path == "belief":
        return _belief_path(claim, speaker_store, prop)
    if claim.path == "speculation":
        return _speculation_path(claim, speaker_store, prop, props, ctx)
    if claim.path == "mutation":
        return _mutation_path(claim, speaker_store, prop, props, ctx)
    return _lie_path(claim, ctx)


def authorize_ignorance(
    speaker: str, template_id: str, templates: Mapping[str, LieTemplate]
) -> Verdict:
    """Whether ``speaker`` may pretend not to know about a kind of act, by the template.

    Feigned ignorance says no prop, so it is no claim and ``authorize`` does not see it. The
    template names the kind of act (``templates[template_id].about``) and the one it is written
    for.
    """
    template = templates.get(template_id)
    if template is None:
        return _no("unknown_template", f"the script has no lie {template_id!r}")
    if template.kind != "feign_ignorance":
        return _no("template_kind", f"{template.id} is a claim, not a feigned ignorance")
    if template.holder != speaker:
        return _no("template_speaker", f"{template.id} is written for {template.holder}")
    return _OK


# ----------------------------------------------------------------------------- what gets written


def backing_prop(claim: Claim, props: Mapping[str, Prop]) -> str | None:
    """The prop whose belief in the speaker's store the claim rests on, if there is one.

    That is the prop itself for a belief, the parent for a mutation, and none for a guess or a
    lie, which rest on a rule or a template instead.
    """
    if claim.path == "belief":
        return claim.prop
    if claim.path == "mutation":
        prop = props.get(claim.prop)
        return None if prop is None else prop.parent
    return None


def _backing_belief(claim: Claim, store: BeliefStore, props: Mapping[str, Prop]) -> Belief | None:
    prop_id = backing_prop(claim, props)
    return None if prop_id is None else store.get(prop_id)


def listener_belief(
    claim: Claim,
    listener: str,
    speaker_store: BeliefStore,
    props: Mapping[str, Prop],
    *,
    confidence: int,
) -> Belief:
    """What ``listener`` writes down on hearing ``claim``.

    It is a heard belief from the speaker, naming the source the speaker named, one hop further
    than the belief the claim rests on (hop 1 for a guess or a lie, which rest on none). A
    guess is kept as a guess. Everything else, a denial and a lie included, is kept as an
    assertion, since the listener cannot tell. The operator, rule or template sits on the claim
    that the belief refers to. Call it for a claim that ``authorize`` has accepted.
    """
    if listener not in claim.listeners:
        raise PathError(f"{listener} is not a listener of {claim.id}")
    backing_id = backing_prop(claim, props)
    backing = _backing_belief(claim, speaker_store, props)
    if backing_id is not None and backing is None:
        raise PathError(f"{claim.speaker} holds nothing to back {claim.id}")
    hop = 1 if backing is None else backing.hop + 1
    modality = "speculate" if claim.modality == "speculate" else "assert"
    return Belief(
        listener,
        claim.prop,
        modality,
        confidence,
        "heard",
        claim.speaker,
        claim.claimed_source,
        hop,
        claim.tick,
        claim.id,
    )


def speaker_belief(
    claim: Claim,
    speaker_store: BeliefStore,
    props: Mapping[str, Prop],
    *,
    confidence: int | None = None,
    public: Collection[str] = (),
) -> Belief | None:
    """What the speaker writes into their own store when saying ``claim``, if anything.

    A belief that is simply repeated is already there, and a lie is not believed, so neither
    adds a belief (a lie adds a note, see ``lie_notes``). A guess is recorded as inferred, and
    so is the changed prop of a mutation, which the speaker now holds as their own, with the
    modality that was said. The original belief stays where it is. ``confidence`` defaults to
    the weakest premise for a guess, counting a premise the town knows and the speaker does not
    hold as sure (``public`` lists those), and to the original belief's for a mutation.
    """
    if claim.path == "speculation":
        levels = []
        for premise_id in claim.premises:
            held = speaker_store.get(premise_id)
            if held is None and premise_id not in public:
                raise PathError(f"{claim.speaker} holds no belief in a premise of {claim.id}")
            levels.append(100 if held is None else held.confidence)
        if confidence is None and not levels:
            raise PathError(f"{claim.id} rests on no premise")
        conf = min(levels) if confidence is None else confidence
        return Belief(
            claim.speaker,
            claim.prop,
            "speculate",
            conf,
            "inferred",
            None,
            None,
            0,
            claim.tick,
            claim.id,
        )
    if claim.path == "mutation":
        original = _backing_belief(claim, speaker_store, props)
        if original is None:
            raise PathError(f"{claim.speaker} holds nothing to change for {claim.id}")
        conf = original.confidence if confidence is None else confidence
        modality = "speculate" if claim.modality == "speculate" else "assert"
        return Belief(
            claim.speaker,
            claim.prop,
            modality,
            conf,
            "inferred",
            None,
            None,
            original.hop,
            claim.tick,
            claim.id,
        )
    return None


def lie_notes(claim: Claim) -> tuple[LieNote, ...]:
    """The notes a liar keeps of who they told: one per listener, empty unless it is a lie."""
    if claim.path != "lie":
        return ()
    return tuple(LieNote(claim.prop, who, claim.id, claim.tick) for who in claim.listeners)
