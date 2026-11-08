"""What a person answers when the player asks: only what they may say, by the same paths as gossip.

The player asks about a *topic*, which is either a prop ("Li Er broke the bridge") or a subject
(the bridge, Old He, the boat). The person answers from their own beliefs, and whatever they say is
a claim to the player that ``paths.authorize`` has passed, by one of the paths a townsperson has
(``belief`` or ``lie``), or it is no claim at all (they know nothing, they pretend to know
nothing, or they would rather not say). Nobody tells the player what they would keep from anyone:
what ``Lore.guards`` lists is never said as it stands.

What a person says about a prop topic, in this order of what they hold:

1. the prop itself, or a prop that says the same;
2. a prop made from it by retelling, the most believed first;
3. the prop it was made from: the nearest the person saw for themselves, or else the nearest they
   hold. Asked who told them, they say so (``not_said`` opens the answer: "I never said that");
4. a prop that cannot be true together with it ("No, that is not so").

Asked about a subject, a person says the weightiest thing they believe about it (the weights of
``gossip.importance``) and that they have not already told the player; if they have told it all,
the weightiest again.

Guarded. A prop a person guards is not said. They tell a lie of their own instead, if the script
gives them one that denies it or cannot be true with it, and otherwise they pretend not to know
about it, if the script lets them pretend about that kind of act (the feigned ignorance of
``Lore.ignorance``), and otherwise they decline ("I would rather not talk about that").

A scripted lie that only changes the source of something true (``source_only``) is told whenever
the person says that very prop: they say they saw it themselves.

A rival account. A person who holds a belief against an account somebody told them and they did not
take in (``BeliefStore.rivals``) says so after the belief, when asked about a prop or a subject:
what they hold, and that the one who told them said otherwise. The rival is a claim of its own
(``Reply.rival``), the account as that person told it, by the path of a belief. Nobody says it of
something they keep back, of an account the manager told them (the manager knows what they said),
or when asked who told them (the question is about where the belief came from, not about what else
they heard).

Nothing here draws from the RNG: the same state gives the same answer.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.props import Prop, lineage
from lantern_core.cognition.rules import LieTemplate
from lantern_core.world.bridge import bonds, gossip, notebook, notes
from lantern_core.world.bridge.lore import Lore, lore

TOPIC, SOURCE = "topic", "source"  # the two ways to ask: about it, and who told them
CLAIM, IGNORANT, EVASIVE = "claim", "ignorant", "evasive"


@dataclass(frozen=True, slots=True)
class Reply:
    """What a person answers.

    ``kind`` is ``claim`` (``claim`` is set, and ``path`` is its path), ``ignorant`` (they know
    nothing, or pretend to: ``path`` is ``ignorance`` for the pretence and empty otherwise) or
    ``evasive``. ``lead`` is the code of the phrase that opens an answer which is not quite the one
    asked for, or empty. ``template`` is the lie or the feigned ignorance of the script that the
    answer is, if it is one. ``rival`` is the claim of the account that somebody told them and they
    did not take in, said after ``claim``, if they keep one against it.
    """

    kind: str
    claim: Claim | None = None
    path: str = ""
    lead: str = ""
    template: str | None = None
    rival: Claim | None = None


def topic_known(topic: str, props: Mapping[str, Prop]) -> bool:
    """Whether ``topic`` is a prop of the game or an entity of the script."""
    return topic in props or lore().book.registry.get(topic) is not None


def _held(store: BeliefStore, props: Mapping[str, Prop]) -> dict[str, Belief]:
    """What the person believes enough to say: the beliefs not set aside or doubted away."""
    return {b.prop: b for b in store if b.confidence >= gossip.MIN_CONFIDENCE and b.prop in props}


def _nearest_ancestor(
    topic: str, held: Mapping[str, Belief], props: Mapping[str, Prop]
) -> str | None:
    """The prop the topic was made from that the person saw, else the nearest they hold."""
    ancestors = [pid for pid in lineage(topic, props)[1:] if pid in held]
    seen = [pid for pid in ancestors if held[pid].source == "saw"]
    return (seen or ancestors or [None])[0]


def _about_prop(
    topic: str, held: Mapping[str, Belief], props: Mapping[str, Prop], lo: Lore, purpose: str
) -> tuple[str, str] | None:
    """The prop to say about a prop topic and the phrase that opens the answer, or None."""
    prop = props[topic]
    if topic in held:
        return topic, ""
    twins = sorted(pid for pid in held if props[pid].same_fact(prop))
    if twins:
        return twins[0], ""
    made = [pid for pid in held if topic in lineage(pid, props)[1:]]
    if made:
        return min(made, key=lambda pid: (-held[pid].confidence, pid)), ""
    parent = _nearest_ancestor(topic, held, props)
    if parent is not None:
        return parent, "not_said" if purpose == SOURCE else ""
    clashing = [pid for pid in held if lo.excludes(prop, props[pid])]
    if clashing:
        return min(clashing, key=lambda pid: (-held[pid].confidence, pid)), "not_so"
    return None


def _about_subject(
    subject: str,
    held: Mapping[str, Belief],
    props: Mapping[str, Prop],
    lo: Lore,
    told: set[str],
) -> str | None:
    """The weightiest prop the person holds about the subject, preferring one not yet told."""
    about = [pid for pid in held if subject in {entity for _, entity in props[pid].args}]
    about.sort(key=lambda pid: (-gossip.importance(lo, props[pid]), -held[pid].confidence, pid))
    top = about[0] if about else None
    if top is not None and lo.guards(held[top].holder, props[top]):
        return top  # the weightiest thing is the one they keep back: they do not turn to another
    fresh = [pid for pid in about if pid not in told]
    return (fresh or about or [None])[0]


def _envelope(lo: Lore, holder: str) -> tuple[LieTemplate, ...]:
    for envelope in lo.book.lies:
        if envelope.holder == holder:
            return envelope.templates
    return ()


def _lie_denying(
    lo: Lore, holder: str, prop: Prop, props: Mapping[str, Prop]
) -> LieTemplate | None:
    """The lie of ``holder`` that denies ``prop`` or cannot be true together with it."""
    claims = [t for t in _envelope(lo, holder) if t.kind == "claim" and not t.source_only]
    for template in claims:
        said = props[template.prop] if template.prop else None
        if said and said.pred == prop.pred and said.args == prop.args and said.neg != prop.neg:
            return template
    for template in claims:
        if template.prop and lo.excludes(prop, props[template.prop]):
            return template
    return None


def _ignorance_of(lo: Lore, holder: str, prop: Prop) -> LieTemplate | None:
    for template in _envelope(lo, holder):
        if template.kind == "feign_ignorance" and template.about == prop.pred:
            return template
    return None


def _authorized(
    claim: Claim,
    store: BeliefStore,
    props: Mapping[str, Prop],
    lo: Lore,
    social: Mapping[str, Any],
) -> bool:
    verdict, _ = paths.authorize(
        claim,
        store,
        props,
        tables=lo.tables,
        registry=lo.book.registry,
        rules=lo.book.rules,
        templates=lo.book.templates,
        suspicion=lo.traits[claim.speaker]["suspicion"],
        relation=bonds.grudge_check(social, lo),
        public=lo.public,
    )
    return verdict


def _rival(
    speaker: str,
    pid: str,
    store: BeliefStore,
    props: Mapping[str, Prop],
    lo: Lore,
    social: Mapping[str, Any],
    tick: int,
) -> Claim | None:
    """The claim of the newest rival account that ``speaker`` keeps in mind against ``pid`` and may
    say to the manager, or None."""
    for rival in reversed(store.rivals_against(pid)):
        belief = store.get(rival.prop)
        if belief is None or belief.source != "heard" or belief.teller != rival.teller:
            continue  # the account was overwritten since: there is no one it can be told as
        if rival.teller == notebook.PLAYER_ID or rival.prop not in props:
            continue
        prop = props[rival.prop]
        if lo.guards(speaker, prop):
            continue
        modality = "deny" if prop.neg else "assert"
        claim = Claim(
            "_", speaker, (notebook.PLAYER_ID,), rival.prop, modality, belief.honest_source(),
            tick, "belief",
        )  # fmt: skip
        if _authorized(claim, store, props, lo, social):
            return claim
    return None


def _say(
    speaker: str,
    pid: str,
    store: BeliefStore,
    props: Mapping[str, Prop],
    lo: Lore,
    social: Mapping[str, Any],
    tick: int,
    lead: str,
    purpose: str = TOPIC,
) -> Reply:
    """The person says what they hold about ``pid``, or keeps it back."""
    prop, belief = props[pid], store.get(pid)
    assert belief is not None
    to = (notebook.PLAYER_ID,)
    if lo.guards(speaker, prop):
        lie = _lie_denying(lo, speaker, prop, props)
        if lie is not None and lie.prop is not None:
            claim = Claim(
                "_",
                speaker,
                to,
                lie.prop,
                "lie",
                lie.claimed_source or "unknown",
                tick,
                "lie",
                template_id=lie.id,
            )
            if _authorized(claim, store, props, lo, social):
                return Reply(CLAIM, claim, "lie", "", lie.id)
        pretend = _ignorance_of(lo, speaker, prop)
        if (
            pretend is not None
            and paths.authorize_ignorance(speaker, pretend.id, lo.book.templates)[0]
        ):
            return Reply(IGNORANT, path="ignorance", template=pretend.id)
        return Reply(EVASIVE)
    for template in _envelope(lo, speaker):
        if template.source_only and template.prop == pid:
            claim = Claim(
                "_",
                speaker,
                to,
                pid,
                "lie",
                template.claimed_source or "unknown",
                tick,
                "lie",
                template_id=template.id,
            )
            if _authorized(claim, store, props, lo, social):
                return Reply(CLAIM, claim, "lie", lead, template.id)
    modality = belief.modality
    if modality == "assert" and prop.neg:
        modality = "deny"
    claim = Claim("_", speaker, to, pid, modality, belief.honest_source(), tick, "belief")
    if _authorized(claim, store, props, lo, social):
        other = None
        if purpose != SOURCE and belief.modality == "assert":
            other = _rival(speaker, pid, store, props, lo, social, tick)
        return Reply(CLAIM, claim, "belief", lead, rival=other)
    return Reply(IGNORANT)


def reply(
    world_state: Mapping[str, Any],
    tick: int,
    speaker: str,
    topic: str,
    purpose: str = TOPIC,
) -> Reply:
    """What ``speaker`` answers to a question about ``topic``. The topic must be known."""
    lo = lore()
    social, section = world_state["social"], world_state["player"]
    props = notebook.view(social)
    store = notes.store(social, speaker)
    held = _held(store, props)
    if topic in props:
        found = _about_prop(topic, held, props, lo, purpose)
    else:
        told = {
            notebook.answer(section, cid).prop
            for cid in section["claims"]
            if notebook.answer(section, cid).speaker == speaker
        }
        pid = _about_subject(topic, held, props, lo, told)
        found = None if pid is None else (pid, "")
    if found is None:
        return Reply(IGNORANT)
    pid, lead = found
    return _say(speaker, pid, store, props, lo, social, tick, lead, purpose)
