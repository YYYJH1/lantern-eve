"""The clarification: the manager shows in public that a claim goes beyond what a witness saw.

``speak`` with ``"kind": "clarify"`` (see ``assembly``) is ``{"claim": entry, "basis": [entry, ...],
"judgment"?: relation}``. The entries are those of the notebook. The manager says that the ``claim``
(a version of the rumour that Li Er broke the rail) goes beyond the ``basis`` (what the witness
told them he saw himself). It is made where the manager may speak in public, the teahouse in the
evening or the hall while the clan is called, and it is for whoever of the named townsfolk is
there. It costs nothing but what the speech is worth in the eyes of the people there.

*What is shown.* The relation between the claim and the basis is the one that the judgement of the
notes finds (``judge.holds``, the basis being the evidence and the claim the claim), so that the
speech and the action ``judge`` agree on what the notebook shows: a pair of notes that the manager
can judge ``unsupported`` is a pair they can say it of in public, and one that ``judge`` turns down
as ``not_shown`` is no clarification. The manager has to name no more than the notes show.
``judgment`` is the relation the manager says there is (``unsupported`` if they say none): that
the claim goes beyond the basis, that the basis excludes the claim, or that the claim does not
match what its named source said (``judge`` says what each is, and where the claim is a version of
the basis that says more, ``judge.adds_to``). The speech adds one thing of its own, since it cites
several entries: the claim is not ``unsupported`` if the basis holds the manager's own sighting of
it (``relations.no_support``).
That a witness saw Li Er at the bridge does not exclude that Li Er broke the rail. Saying that it
does ("Li Er is innocent"), saying that nothing of it was seen by anyone ("I saw it myself": an
empty basis), or pairing two notes that have nothing to do with each other is overclaiming. It is
no clarification: the speech fails, the person who saw the story with their own eyes says that they
never said that, and the people there who know better trust the manager ``OVERCLAIM_DROP`` less.
The manager may say it again, with what they can show.

The basis has to hold what somebody says they saw (an entry told first-hand, or one the manager
saw), since otherwise nobody can bear it out: ``no_witness``. The same claim and basis are not
clarified twice (the speech is not made again for the people who came later, whom a telling has to
reach): ``said_already``. A speech that nobody took in does not count as made.

*What the people there make of it*, each in ints::

    strength   80 if a witness of the basis is there (the one who told the manager he saw it, or the
               manager if they saw it), who says in public only what he saw; 60 if only his words
               are cited
    score      strength + trust // 2 - held // 2 - 10 for the Zhou people who hold a grudge
               against the Li family
    accepts    the witness; else a score of ``ACCEPT_AT`` or more. The one the truth blames takes
               no stand: he stays where he was, says the line of that stand like anyone who is in
               it (so that nobody can tell him by what he says), never accepts, and as a witness
               would lend the speech no strength

``held`` is how sure the person is of the accusation, the claim or any other version of what the
basis says that goes beyond it (the confidence of the surest of them, counted only if they believe
it at all: a person who has only heard that the town talks is not sure of it). They take a stance
before and after: ``for`` the clarification, ``unsure`` or ``against`` (the accusation). Each says
why in a fixed line of their own voice: the witness only what he saw (``witness_in_public``), the
elder that he is satisfied (``elder_yes``), another who accepts that they note it (``took_in``),
and whoever does not accept that they are not convinced (``elder_no``) or that it is not what they
heard (``doubted``).

An acceptor drops their confidence in the claim and in the versions between it and the basis below
twenty, takes in ``CLAIM`` (the clerk only saw Li Er at the bridge looking for a lantern, said in
public: first-hand, since they were there), and trusts the manager ``ACCEPT_TRUST`` more, once: a
person who held ``CLAIM`` already trusts no more for hearing it again, so that a speech that
differs from the last by an entry or two of the basis earns nothing the last did not. Nobody who
was not there learns of it: it is a prop with a story of its own (it has no parent, so the quiet of
an opening does not hold it), and the talk of the town carries it from the people who know it.

Events: ``clarified`` (``venue``, ``audience``: ``[{npc, before, after, reason: {zh, en}}]``,
``accepted``: how many, ``claim`` and ``basis``: the entries, ``prop``: the prop of the claim).
Rejected: ``no_entry``, ``not_shown``, ``overclaim``, ``no_witness``, ``said_already``.
The state kept is ``public["clarified"]``: ``"claim prop|basis props"`` of each clarification that
was made.

Evidence shown in public that clears the rumour for enough of the town (``assembly``) gives its
acceptors ``CLAIM`` as well, and the manager a note of it (``seen_cleared``), so that the way to the
bamboo that was open to the evidence is open still, now that Granny Li's condition reads what she
herself knows (``objection``).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from lantern_core.cognition import relations
from lantern_core.cognition.beliefs import SELF_SEEN, Belief, BeliefStore
from lantern_core.cognition.props import Prop, lineage
from lantern_core.inputs import InputError
from lantern_core.world.bridge import (
    agenda_terms,
    bonds,
    converse,
    goals_call,
    gossip,
    judge,
    notebook,
    notes,
    repute,
    voices,
)
from lantern_core.world.bridge.lore import FIRST_HAND_CONFIDENCE, PLAYER, lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim

CLAIM = "pr_set_straight"  # what the audience takes in: the clerk only saw Li Er at the bridge
UNSUPPORTED, CONTRADICTS, MISMATCH = "unsupported", "contradicts", "mismatch"
RELATIONS = (UNSUPPORTED, CONTRADICTS, MISMATCH)
FOR, UNSURE, AGAINST = "for", "unsure", "against"
STRENGTH_WITNESS, STRENGTH_CITED = 80, 60
ACCEPT_AT = 60
GRUDGE_PENALTY, GRUDGE_FROM = 10, 20
ACCEPT_TRUST = 4
BELOW, DROPPED_TO = 20, 15  # an acceptor's confidence in the claim falls below twenty, to fifteen
OVERCLAIM_DROP = 8
MAX_BASIS = 4
HOLDS_AT = repute.BELIEVE_AT  # an accusation counts against the clarification from this confidence
KNOWS_AT = 40  # a person who was told of the clarification and took it in knows of it from here
ELDER = goals_call.ELDER
ZHOU, LI = "fam_zhou", "fam_li"


@dataclass(frozen=True, slots=True)
class Score:
    """What a person weighs of a clarification: the strength of it, half their trust in the
    manager, half what they hold of the accusation, and the grudge of the Zhou people."""

    strength: int
    trust: int
    held: int
    grudge: int

    @property
    def total(self) -> int:
        return self.strength + self.trust // 2 - self.held // 2 - self.grudge

    @property
    def accepts(self) -> bool:
        return self.total >= ACCEPT_AT


# ---------------------------------------------------------------------------- validating


def validate_fields(body: dict[str, Any], where: str) -> dict[str, Any]:
    """The fields of a clarification: the entry of the claim, the entries of the basis and, if
    given, the relation the manager says there is."""
    out: dict[str, Any] = {"claim": converse.id_field(body.get("claim"), where, "claim")}
    names = body.get("basis", [])
    if not isinstance(names, list) or len(names) > MAX_BASIS:
        raise InputError(f"{where}: basis must be a list of at most {MAX_BASIS} entry ids")
    ids = [converse.id_field(name, where, "basis") for name in names]
    out["basis"] = list(dict.fromkeys(ids))  # an entry cited twice is cited once
    if "judgment" in body and body["judgment"] is not None:
        if body["judgment"] not in RELATIONS:
            raise InputError(f"{where}: judgment must be one of {', '.join(RELATIONS)}")
        out["judgment"] = body["judgment"]
    return out


# ---------------------------------------------------------------------------- what is shown


def shown(
    world_state: Mapping[str, Any], claim: Mapping[str, Any], basis: list[Mapping[str, Any]]
) -> tuple[str, ...]:
    """The relations that the notebook shows between the claim and the basis, in the order of
    ``RELATIONS``. They are those the judgement of the notes finds (``judge.holds``, with the basis
    as the evidence and the claim as the claim): the speech shows what ``judge`` would accept, and
    nothing else. One thing is the speech's own, since it cites several entries: the claim is not
    ``unsupported`` if the manager saw it themselves in the basis (``relations.no_support``)."""
    props, groups = judge.context(world_state)
    mine = BeliefStore(notebook.PLAYER_ID, [notebook.belief_of(entry) for entry in basis])
    found: list[str] = []
    for relation in RELATIONS:
        if relation == UNSUPPORTED and not relations.no_support(props[claim["prop"]], mine, props):
            continue
        if any(judge.holds(relation, entry, claim, props, groups) for entry in basis):
            found.append(relation)
    return tuple(found)


def witnesses(basis: list[Mapping[str, Any]]) -> list[str]:
    """Who says they saw what the basis says: the person who told the manager first-hand, or the
    manager (``PLAYER``) for what they saw themselves."""
    found: list[str] = []
    for entry in basis:
        belief = notebook.belief_of(entry)
        if belief.source == "saw":
            who = PLAYER
        elif belief.source == "heard" and belief.claimed_source == SELF_SEEN and belief.teller:
            who = belief.teller
        else:
            continue
        if who not in found:
            found.append(who)
    return found


def story(claim_id: str, basis_ids: list[str], props: Mapping[str, Prop]) -> set[str]:
    """The props of the story of a clarification: the lineage of the claim and of the basis."""
    found = set(lineage(claim_id, props))
    for prop_id in basis_ids:
        found.update(lineage(prop_id, props))
    return found


# ---------------------------------------------------------------------------- what a person weighs


def held_against(
    world_state: Mapping[str, Any], person: str, claim_id: str, basis_ids: list[str]
) -> int:
    """How sure ``person`` is of the accusation: the confidence of the surest of the claim and the
    versions of the basis that go beyond it, that they believe. Nothing if they believe none."""
    social = world_state["social"]
    props = notebook.view(social)
    best = 0
    for belief in notes.store(social, person):
        if belief.confidence < HOLDS_AT or belief.prop not in props:
            continue
        if belief.prop == claim_id or any(judge.adds_to(belief.prop, b, props) for b in basis_ids):
            best = max(best, belief.confidence)
    return best


def grudge_penalty(world_state: Mapping[str, Any], person: str) -> int:
    """``GRUDGE_PENALTY`` for a Zhou who holds a grudge against the Li family, else nothing."""
    lo, social = lore(), world_state["social"]
    if lo.family[person] != ZHOU:
        return 0
    grudge = max(
        (bonds.value(social, lo, person, other, bonds.GRUDGE) for other in lo.people
         if lo.family[other] == LI),
        default=0,
    )  # fmt: skip
    return GRUDGE_PENALTY if grudge >= GRUDGE_FROM else 0


def score_of(world_state: Mapping[str, Any], person: str, strength: int, held: int) -> Score:
    """The score of ``person`` for a clarification of that ``strength``, who is that sure of the
    accusation."""
    section = world_state["player"]
    trust = repute.trust(section, lore().index[person])
    return Score(strength, trust, held, grudge_penalty(world_state, person))


def knows_claim(world_state: Mapping[str, Any], person: str) -> bool:
    """Whether ``person`` has taken in the clarification: they were there, or were told."""
    belief = notes.store(world_state["social"], person).get(CLAIM)
    return belief is not None and belief.confidence >= KNOWS_AT


def stance_before(world_state: Mapping[str, Any], person: str, held: int) -> str:
    if knows_claim(world_state, person):
        return FOR
    return AGAINST if held >= HOLDS_AT else UNSURE


def stance_after(accepts: bool, silent: bool, before: str, held: int) -> str:
    """Where a person stands when the speech is over. One who takes it in is ``for``. The one the
    truth blames takes no stand, and one who took a clarification in before stays with it, so
    both stay where they were. Anybody else holds to the accusation (``against``) or is not
    convinced (``unsure``)."""
    if accepts:
        return FOR
    if silent or before == FOR:
        return before
    return AGAINST if held >= HOLDS_AT else UNSURE


WITNESS_LINE, ELDER_LINE = "witness_in_public", "elder_yes"
LINES = {FOR: "took_in", AGAINST: "doubted", UNSURE: "elder_no"}  # the fixed line, by the stand


def line_of(person: str, after: str, accepts: bool, witness: bool) -> str:
    """The fixed line ``person`` says in public. The witness says only what he saw, the elder gives
    his word, and everybody else says the line of the stand they end at, the one the truth blames
    among them: so that nobody is known by what they say."""
    if accepts and witness:
        return WITNESS_LINE
    if accepts and person == ELDER:
        return ELDER_LINE
    return LINES[after]


def hold_claim(sim: Sim, person: str) -> None:
    """``person`` has seen the clarification made: they hold ``CLAIM`` first-hand."""
    social = sim.state["social"]
    have = notes.store(social, person).get(CLAIM)
    if have is not None and have.confidence >= FIRST_HAND_CONFIDENCE:
        return
    belief = Belief(
        person, CLAIM, "assert", FIRST_HAND_CONFIDENCE, "saw", None, None, 0, sim.ctx.tick
    )
    notes.hold(social, belief)


def clears_rumour(refuted: list[str]) -> bool:
    """Whether the props that evidence refutes are versions of the accusation of Li Er or his
    family: whoever takes the evidence in has seen the rumour cleared in public."""
    book = lore().book.props
    return any(
        book[prop_id].pred == "damaged" and book[prop_id].arg("who") in ("li_er", LI)
        for prop_id in refuted
        if prop_id in book
    )


def seen_cleared(sim: Sim, people: list[str], refuted: list[str]) -> None:
    """Evidence shown in public has cleared the rumour for enough of the town (see ``assembly``): if
    what it refutes is the rumour about Li Er, ``people``, who accepted it, hold ``CLAIM`` as those
    who were at a clarification do, and the manager, who was there, has it in the notebook, so
    that they can tell the ones who were not (Li Da) what was cleared."""
    if not people or not clears_rumour(refuted):
        return
    for person in people:
        hold_claim(sim, person)
    notebook.add_seen(sim.state["player"], CLAIM, sim.ctx.tick)


def take_in(sim: Sim, person: str, versions: list[str]) -> None:
    """``person`` accepts: their confidence in the claim and the versions falls below twenty, they
    hold ``CLAIM`` and trust the manager ``ACCEPT_TRUST`` more. One who held ``CLAIM`` already (they
    were there when it was said before, or were told) learns nothing new and trusts no more."""
    social, section = sim.state["social"], sim.state["player"]
    new = not knows_claim(sim.state, person)
    held = social["beliefs"][person]
    for prop_id in versions:
        if prop_id in held and notes.confidence_of(held[prop_id]) >= BELOW:
            held[prop_id] = notes.with_confidence(held[prop_id], DROPPED_TO)
        notes.forget_rivals(social, person, prop=prop_id)  # and the version they only kept in mind
    hold_claim(sim, person)
    if new:
        repute.nudge(section, lore().index[person], ACCEPT_TRUST, "cleared")


# ---------------------------------------------------------------------------- the speech


def _overclaim(
    sim: Sim, body: dict[str, Any], here: list[str], reason: str, known: set[str]
) -> None:
    """The manager said more than the notebook shows: the people there who saw the story with their
    own eyes say they never said that, and trust the manager less."""
    section, world_state = sim.state["player"], sim.state
    social, lo = world_state["social"], lore()
    knowing = [
        person
        for person in here
        if any(
            belief.source == "saw" and belief.prop in known
            for belief in notes.store(social, person)
        )
    ]
    for person in knowing:
        repute.nudge(section, lo.index[person], -OVERCLAIM_DROP, "overclaim")
    if knowing and not section["talk"]:
        converse.say(section, knowing[0], sim.ctx.tick + gossip.BUBBLE_TICKS, "text", "not_said")
    converse.ack(sim, body, reason)


def apply(sim: Sim, body: dict[str, Any], place: str, here: list[str], culprit: str | None) -> None:
    """The manager clarifies, in public, to the ``here`` who are there. ``culprit`` is the person
    the truth blames, if it blames one."""
    section, world_state, tick = sim.state["player"], sim.state, sim.ctx.tick
    social = world_state["social"]
    claim = notebook.find(section, body["claim"])
    basis = [notebook.find(section, name) for name in body["basis"]]
    if claim is None or any(entry is None for entry in basis):
        return converse.ack(sim, body, "no_entry")
    cited = [entry for entry in basis if entry is not None]
    props = notebook.view(social)
    claim_id, basis_ids = claim["prop"], [entry["prop"] for entry in cited]
    known = story(claim_id, basis_ids, props)
    said = body.get("judgment", UNSUPPORTED)
    if not cited:  # nothing to cite but themselves: "I saw it myself"
        return _overclaim(sim, body, here, "overclaim", known)
    seen_relations = shown(world_state, claim, cited)
    if not seen_relations:
        return _overclaim(sim, body, here, "not_shown", known)
    if said not in seen_relations:
        return _overclaim(sim, body, here, "overclaim", known)
    seers = witnesses(cited)
    if not seers:
        return converse.ack(sim, body, "no_witness")
    sign = f"{claim_id}|{'+'.join(sorted(basis_ids))}"
    made = section["public"].setdefault("clarified", [])
    if sign in made:
        return converse.ack(sim, body, "said_already")

    speaking = [who for who in seers if who == PLAYER or (who in here and who != culprit)]
    strength = STRENGTH_WITNESS if speaking else STRENGTH_CITED
    versions = sorted(
        prop_id for prop_id in props if prop_id == claim_id or any(
            judge.adds_to(prop_id, b, props) for b in basis_ids
        )
    )  # fmt: skip
    audience: list[dict[str, Any]] = []
    yes: list[str] = []
    for person in here:
        held = held_against(world_state, person, claim_id, basis_ids)
        before = stance_before(world_state, person, held)
        silent = person == culprit
        witness = person in seers
        accepts = not silent and (witness or score_of(world_state, person, strength, held).accepts)
        after = stance_after(accepts, silent, before, held)
        code = line_of(person, after, accepts, witness)
        audience.append(
            {
                "npc": person,
                "before": before,
                "after": after,
                "reason": voices.phrase(person, code, tick + gossip.BUBBLE_TICKS),
            }
        )
        if accepts:
            yes.append(person)
    for person in yes:
        take_in(sim, person, versions)
    if yes:
        made.append(sign)
        notebook.add_seen(section, CLAIM, tick)
    elder = 0 if ELDER not in here else 2 if ELDER in yes else 1
    section["public"]["speeches"].append([tick, place, len(here), len(yes), elder, 0])
    sim.emit(
        "clarified",
        venue=place,
        audience=audience,
        accepted=len(yes),
        claim=body["claim"],
        basis=list(body["basis"]),
        prop=claim_id,
    )
    converse.ack(sim, body)


# ---------------------------------------------------------------------------- the task term


def _clarified_records(cond: dict[str, Any]) -> dict[str, set[str]]:
    return {"clarified": {"accepted", "prop"}}


def _clarified(env: agenda_terms.Env, cond: dict[str, Any]) -> bool:
    """A clarification was accepted by somebody (of the claim in ``props``, if given)."""
    props = cond.get("props")
    for kind, _, fields in env.state["agenda"]["seen"]:
        if kind != "clarified" or fields.get("accepted", 0) < 1:
            continue
        if not props or fields.get("prop") in props:
            return True
    return False


agenda_terms.implement("clarified", _clarified, _clarified_records)
