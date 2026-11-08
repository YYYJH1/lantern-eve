"""One person tells another something: the change, the check, and what is written down.

``tell`` is the whole of it. The speaker's belief is passed on as it is, or changed by one of
the operators of ``retell``, drawn by the speaker's habit: the cast file gives each person four
weights, and a fifth weight, for telling it straight, is greater the more the person follows
the crowd. Then the claim goes to ``paths.authorize`` with the speaker's own store, the book of
props, the script's rules and the town's public knowledge, and what the speaker may claim is
decided there and nowhere else. A claim that is refused is never applied: nothing is written, a
``refused`` event says why, and the refusal is counted by its code.

What an accepted claim does, in this order:

- the claim is kept, and a prop made on the way goes into the book of the game;
- the speaker comes to hold the changed prop, as a conclusion of their own, and so believes what
  they said (the belief it came from stays);
- the listener writes down a heard belief. Its confidence is the listener's trust in the speaker,
  moved by who the listener is, how many hands it has passed through, whether it is a guess,
  whether the source is hidden, whether the speaker says they saw it themselves (``SEEN_WEIGHT``:
  the listener cannot tell if it is so), whether the speaker is a child witness whom grown-ups do
  not quite believe or a gatekeeper whom they do, and whether it fits what the listener already
  holds;
- a belief that contradicts one the listener holds with some confidence is kept only if it is more
  confident than all it contradicts, and a held belief wins a tie. The firmness of a held belief
  counts, which is its confidence less what the rival accounts held against it cost
  (``BeliefStore.firmness``). The loser is set aside at confidence 0, not deleted, so that the
  chains that rest on it can still be walked back and the same thing is not told again, and a
  ``conflict`` event records the outcome. The listener also remembers the loser, if somebody told
  it to them, as a rival of the one they kept: who told it and when (see ``Rival``);
- the two feel a little more for each other, and a listener who is told that they or their kin did
  something blameworthy grows a grudge against the one who said it.

``hear_street`` is the other way a belief is written: a named person hears something from the
crowd in the street, with no one to name and little reason to believe it.
"""

from __future__ import annotations

import dataclasses
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN, Belief, BeliefStore, Claim, Rival
from lantern_core.cognition.props import Prop, lineage
from lantern_core.world.bridge import bonds, notes, retell
from lantern_core.world.bridge.lore import BLAME_PREDS

if TYPE_CHECKING:
    from lantern_core.world.bridge.lore import Lore
    from lantern_core.world.bridge.sim import Sim

SET_ASIDE = 0
STRAIGHT_BASE = 40  # the weight of telling it as it is, plus half the conformity trait
FIRST_HAND_STRAIGHT = 2  # a witness tells what they saw straight this many times as often
MAX_DEPTH = 8  # a story that has been changed this often is not changed further
STREET_CONFIDENCE = 20
AGREES_AT = 50  # a held belief at least this confident, in the lineage of the new one, agrees
SEEN_WEIGHT = 35  # a listener believes this much more of what the teller says they saw


@dataclass(frozen=True, slots=True)
class Told:
    """A telling that was accepted: the claim, and the prop it says."""

    claim: Claim
    prop: Prop


def confidence(
    lore: Lore,
    trust: int,
    tags: frozenset[str],
    claim: Claim,
    hop: int,
    agrees: bool,
) -> int:
    """How far the listener believes what they were told, from 5 to 95.

    ``trust`` is the listener's trust in the speaker and ``tags`` the speaker's network tags (a
    speaker who is no one of the cast has none), so that the festival manager is believed by the
    same rules as a neighbour.
    """
    traits = lore.traits[claim.listeners[0]]
    conf = trust
    conf += (traits["warmth"] - 50) // 5 - (traits["suspicion"] - 50) // 5 - 8 * (hop - 1)
    if claim.modality == "speculate":
        conf -= 12
    if claim.claimed_source == UNKNOWN:
        conf -= 10
    elif claim.claimed_source == SELF_SEEN:
        conf += SEEN_WEIGHT
    if "witness" in tags:
        conf -= 15
    if "gatekeeper" in tags:
        conf += 10
    if agrees:
        conf += 10
    return max(5, min(95, conf))


def _confidence(lore: Lore, social: dict[str, Any], claim: Claim, hop: int, agrees: bool) -> int:
    """How far a neighbour believes what they were told, from 5 to 95."""
    speaker, listener = claim.speaker, claim.listeners[0]
    trust = bonds.value(social, lore, listener, speaker, bonds.TRUST)
    return confidence(lore, trust, lore.tags[speaker], claim, hop, agrees)


def _rival_of(account: Belief, against: str) -> Rival | None:
    """The rival that an account which lost is, if somebody told it as a plain statement: a belief
    that was seen, worked out, read or heard in the street has no one to name, and a guess is not an
    account."""
    if account.source != "heard" or account.modality != "assert" or account.teller is None:
        return None
    return Rival(account.prop, against, account.teller, account.tick, account.claim)


def _remember_the_loser(
    social: dict[str, Any],
    holder: str,
    lore: Lore,
    view: notes.PropView,
    kept: Belief,
    set_aside: list[Belief],
) -> None:
    """``holder`` kept ``kept`` and set ``set_aside`` aside: they remember what lost as rivals of
    what they kept. The rivals that were held against a belief now set aside are held against the
    new one if they exclude it too, else they are forgotten with it."""
    for lost in set_aside:
        for rival in notes.rivals_of(social, holder):
            follows = rival.prop != kept.prop and lore.excludes(view[rival.prop], view[kept.prop])
            if rival.against == lost.prop and follows:
                notes.keep_rival(social, holder, dataclasses.replace(rival, against=kept.prop))
        notes.forget_rivals(social, holder, against=lost.prop)
    for lost in set_aside:
        rival = _rival_of(lost, kept.prop)
        if rival is not None:
            notes.keep_rival(social, holder, rival)


def _hold(
    sim: Sim,
    social: dict[str, Any],
    lore: Lore,
    view: notes.PropView,
    prop: Prop,
    belief: Belief,
    claim_id: str | None,
) -> bool:
    """Write ``belief`` unless it loses to a belief it contradicts. Returns whether it was written.

    Every belief held with some confidence that the new prop excludes is a clash. The new belief
    stays only if it is more confident than all of them, and then they are set aside. What is held
    is weighed by its firmness: a person who holds a rival account against it is easier to move.
    The one that loses is remembered as a rival of the one that is kept.
    """
    holder = belief.holder
    store: BeliefStore = notes.store(social, holder)
    clashes = [
        held
        for held in store
        if held.confidence > SET_ASIDE and lore.excludes(prop, view[held.prop])
    ]
    if clashes:
        firmest = max(clashes, key=lambda held: store.firmness(held.prop))
        kept_new = belief.confidence > store.firmness(firmest.prop)
        social["counts"]["conflicts"] += 1
        sim.emit(
            "conflict",
            holder=holder,
            new=prop.id,
            held=clashes[0].prop,
            kept="new" if kept_new else "held",
            claim=claim_id,
        )
        if not kept_new:
            # heard and not taken in: it stays on record, set aside, so it is not told again
            lost = dataclasses.replace(belief, confidence=SET_ASIDE)
            notes.hold(social, lost)
            _remember_the_loser(social, holder, lore, view, firmest, [lost])
            return False
        for held in clashes:
            note = social["beliefs"][holder][held.prop]
            social["beliefs"][holder][held.prop] = notes.with_confidence(note, SET_ASIDE)
        _remember_the_loser(social, holder, lore, view, belief, clashes)
    notes.hold(social, belief)
    notes.forget_rivals(social, holder, prop=belief.prop)  # what is held is no one's rival
    return True


hold = _hold  # the festival manager's tellings are written the same way


def _refuse(sim: Sim, social: dict[str, Any], claim: Claim, reason: str) -> None:
    code = reason.split(":", 1)[0]
    social["counts"]["refused"] += 1
    social["refusals"][code] = social["refusals"].get(code, 0) + 1
    sim.emit(
        "refused",
        speaker=claim.speaker,
        listener=claim.listeners[0],
        prop=claim.prop,
        path=claim.path,
        code=code,
        reason=reason,
    )


def _feelings(social: dict[str, Any], lore: Lore, claim: Claim, prop: Prop, believed: bool) -> None:
    """What the telling does to how the two feel about each other (see ``bonds``)."""
    speaker, listener = claim.speaker, claim.listeners[0]
    bonds.nudge(social, lore, listener, speaker, bonds.AFFINITY, 1)
    bonds.nudge(social, lore, speaker, listener, bonds.AFFINITY, 1)
    if not believed:
        bonds.nudge(social, lore, listener, speaker, bonds.TRUST, -3)
    blamed = not prop.neg and prop.pred in BLAME_PREDS and prop.arg("who") in lore.kin[listener]
    if blamed:
        outsider = lore.family[speaker] != lore.family[listener]
        bonds.nudge(social, lore, listener, speaker, bonds.GRUDGE, 10 if outsider else 6)
        bonds.nudge(social, lore, listener, speaker, bonds.TRUST, -6)
        bonds.nudge(social, lore, listener, speaker, bonds.AFFINITY, -4)


def tell(
    sim: Sim, social: dict[str, Any], lore: Lore, speaker: str, listener: str, prop_id: str
) -> Told | None:
    """``speaker`` tells ``listener`` what they believe about ``prop_id``.

    Returns the accepted claim and the prop it says, or ``None`` if the claim was refused.
    """
    tick = sim.ctx.tick
    made = notes.made_props(social)
    view = notes.PropView(made, lore.book.props)
    store = notes.store(social, speaker)
    belief = store.get(prop_id)
    assert belief is not None
    parent = view[prop_id]
    relation = bonds.grudge_check(social, lore)
    suspicion = lore.traits[speaker]["suspicion"]

    ancestors = lineage(prop_id, view)
    possible = []
    if len(ancestors) <= MAX_DEPTH:
        possible = retell.changes(
            lore, view, parent, belief, store, suspicion=suspicion, relation=relation
        )
    options = []
    for change in possible:
        child = retell.settle(lore, made, change.prop)
        back_again = any(view[a].same_fact(child) for a in ancestors[1:])
        pointless = child.same_fact(parent) and not change.drops_hedge
        if child.id in social["beliefs"][listener] or back_again or pointless:
            continue
        if not lore.guards(speaker, child):  # nobody gives a secret away by changing it a little
            options.append((change, child))
    habit = lore.ops[speaker]
    straight = STRAIGHT_BASE + lore.traits[speaker]["conformity"] // 2
    weights = [straight * (FIRST_HAND_STRAIGHT if belief.source == "saw" else 1)]
    for change, _ in options:
        # a suspicious speaker jumps to the conclusion a rule offers
        jump = suspicion // 2 if change.rule is not None else 0
        weights.append(habit[change.op] + jump)
    drawn = sim.ctx.rng.weighted(weights)

    claim_id = f"c{social['seq']}"
    if drawn == 0:
        shown = parent
        modality = belief.modality
        if modality == "assert" and parent.neg:
            modality = "deny"
        claim = Claim(
            claim_id,
            speaker,
            (listener,),
            prop_id,
            modality,
            belief.honest_source(),
            tick,
            "belief",
        )
    else:
        change, shown = options[drawn - 1]
        claim = Claim(
            claim_id,
            speaker,
            (listener,),
            shown.id,
            "assert" if change.drops_hedge else belief.modality,
            belief.honest_source(),
            tick,
            "mutation",
            rule_id=change.rule,
            op=change.op,
        )
    overlay = notes.PropView({shown.id: shown}, view)
    verdict, reason = paths.authorize(
        claim,
        store,
        overlay,
        tables=lore.tables,
        registry=lore.book.registry,
        rules=lore.book.rules,
        templates=lore.book.templates,
        suspicion=suspicion,
        relation=relation,
        public=lore.public,
    )
    if not verdict:
        _refuse(sim, social, claim, reason)
        return None

    social["seq"] += 1
    social["claims"][claim_id] = notes.encode_claim(claim)
    social["counts"]["told"] += 1
    sim.emit(
        "told",
        claim=claim_id,
        speaker=speaker,
        listener=listener,
        prop=shown.id,
        path=claim.path,
        op=claim.op,
        modality=claim.modality,
    )
    if claim.path == "mutation":
        social["counts"]["mutated"] += 1
        if shown.id not in lore.book.props:
            social["props"].setdefault(shown.id, notes.encode_prop(shown))
        if shown.id not in social["beliefs"][speaker]:
            own = paths.speaker_belief(claim, store, overlay, public=lore.public)
            assert own is not None
            notes.hold(social, own)

    listener_store = notes.store(social, listener)
    agrees = any(
        (held := listener_store.get(pid)) is not None and held.confidence >= AGREES_AT
        for pid in lineage(shown.id, overlay)[1:]
    )
    hops = paths.listener_belief(claim, listener, store, overlay, confidence=50).hop
    conf = _confidence(lore, social, claim, hops, agrees)
    heard = paths.listener_belief(claim, listener, store, overlay, confidence=conf)
    believed = _hold(sim, social, lore, overlay, shown, heard, claim_id)
    _feelings(social, lore, claim, shown, believed)
    return Told(claim, shown)


def hear_street(
    sim: Sim, social: dict[str, Any], lore: Lore, holder: str, prop_id: str, tick: int
) -> bool:
    """A named person hears ``prop_id`` from the street. Returns whether they took it in."""
    if holder not in lore.index or prop_id in social["beliefs"][holder]:
        return False
    view = notes.PropView(notes.made_props(social), lore.book.props)
    prop = view.get(prop_id)
    if prop is None:
        return False
    belief = Belief(holder, prop_id, "assert", STREET_CONFIDENCE, "street", None, None, 1, tick)
    if not _hold(sim, social, lore, view, prop, belief, None):
        return False
    social["counts"]["street"] += 1
    sim.emit("street", holder=holder, prop=prop_id)
    return True
