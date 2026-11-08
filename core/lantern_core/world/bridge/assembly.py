"""Speaking in public: the teahouse in the evening, the hall when the elder calls the clan.

``speak_publicly`` (also ``speak``, the name the page uses) is for the manager when they are not
in a conversation. It has four kinds.

*Evidence* (the default): the manager shows a set of evidence to everyone who is there. It does not
tell the truth by itself: that is the full statement, below.
``evidence`` lists the evidence items they hold (``e_...``) and the entries of the notebook, which
stand for the items held that support them; ``entry`` is one entry; with neither, everything held.
The venue is the place the manager stands at (within a cell of it):

- the teahouse, from 17:00 to the end of the day (``EVENING``), or
- the hall, while the clan is called: the elder, asked to convene (``entrust`` with the kind
  ``convene``, before 17:00), sends ``MEETING_HOURS`` hours of work at the hall to ``INVITED`` and
  to himself. The clan takes ``GATHER_TICKS`` to come, and the hall is open from the hour after
  that to ``MEETING_TICKS`` ticks after the call.

Whoever of the named townsfolk is there (at the place they were bound for, awake) hears it, and
each updates by the same rule, in ints::

    strength   100 if the evidence set tells the true variant apart (it holds one of the script's
               ``evidence_sets`` for it); else 80 if it refutes what this person believes about
               the conflict; else 40 if any item bears on it; else 0
    score      strength + trust // 2 - firmness // 2 in what they believe that is false
               - 15 if they are of the family of the one the truth blames
    accepts    a person who believes the truth already and nothing false; or score >= 70, or 85
               for the elder, who weighs more; the one the truth blames never does

The elder weighs more only a proof that does not tell the story apart. A set that does tell it
apart refutes everything about the conflict that cannot be true with it, what the elder holds as
well, and he weighs it as anyone does (``ELDER_EXTRA`` is for the other proofs,
``ELDER_EASES_AT``): with the whole proof he takes the true account when he holds the other at 73
and trusts the manager a little (12 and over), and does not when he holds it at 87 and has no more
trust than that, which is for the manager to win first, or to answer with the proof in a talk with
him.

Firmness is the confidence less what the rival accounts a person keeps in mind against that belief
cost (``BeliefStore.firmness``: 4 for each, 12 at most): a person who was told another account
and held to their own accepts a whole proof at a lower trust than one who was told nothing, and the
elder is such a person if the manager told them the true account in a talk. An acceptor trusts the
manager 6 more. If at least ``MIN_NAMED`` are there and at least
``ACCEPT_PERCENT`` percent accept, whatever the elder did, the props the evidence refutes (and
their retellings) are refuted in public. If they are the rumour about Li Er, those who accepted
have seen it cleared in public, and so has the manager: they hold what a clarification gives
(``clarify.seen_cleared``), which is Granny Li's first way to the bamboo (``persuade``).

*Statement* (``"kind": "statement"``): the full statement of the card (``statement``), made where
the manager may speak in public from the evening of the fourth day, once a day, with five named
people there at least. It takes the game time of a speech. Three things are judged apart. Whether
each part is right in the story that is true (the options chosen against ``right`` in the script).
Whether the evidence held is enough (``complete``: it holds one of the evidence sets that tell the
true story apart). Whether the people there accept: the rule above, weighing what is stated and
not what is true (``accepts_claim``: told something other than the truth, a person who believes
what is stated accepts it, the person it blames never does, and the evidence persuades with its
full strength only as far as the cause stated is the true one). The truth is told, and the goal
``g_truth`` met (its metrics ``audience_named`` and ``accept_ratio`` are set from every statement,
and the flag ``elder_accepts`` and ``set_truth_cleared`` only by one that told it), only when all
three hold. Each head who accepts a statement that told the truth lets go of 10 points of grudge.
A statement with a part that did not hold costs the manager ``statement.STATEMENT_COST`` trust with
everyone there and is told which parts did not hold, with the kind of failure of each (``failure``
in ``statement``), and the people who accept a statement take in the props it states, right or
wrong, so that a wrong one accepted by many is how the lie becomes a legend. The statement is made
only when the card is filled in (``incomplete``), from the meeting of the fourth evening
(``too_early``), not twice on one day (``stated_today``), and with five named people there
(``few_present``): the rejections are the reasons of ``statement.block``, and cost nothing.

*Meal* (``"kind": "meal"``): the manager lays a table for the two family heads. Both must be
there, with at least ``MIN_WITNESS`` others. The grudge of each head against the other falls by
``MEAL_DROP``, or by ``MEAL_DROP_AFTER_TRUTH`` once the truth was told in public. Everyone there
trusts the manager 3 more, and a reconciliation was seen (``goals.set_reconciled``).

*Clarify* (``"kind": "clarify"``, ``"claim": entry``, ``"basis": [entries]``, ``"judgment"?``): the
manager shows that a claim goes beyond what a witness saw. Whoever is there takes a stand and says
why, and only they learn of it (see ``clarify``). When somebody takes it in, the heads of the
families who are there stop accusing in public, which is the first deed of the peace
(``peace.stop_blaming``).

State: ``public`` is ``{"refuted": [prop ids], "speeches": [[tick, venue, named, accepted, elder,
complete, cleared]], "seen": {venue: signature}}`` (``elder`` is 0 absent, 1 refused, 2 accepted; a
table keeps its signature under ``venue#meal``, so that a statement does not make a second table the
same day for the same people a new question),
with ``clarified`` (the clarifications made) and ``withdrawn`` (who has withdrawn an objection) once
there are some (``clarify`` and ``objection``), and ``told_cause`` (the id of the option of the
cause that the card named in the statement that told the truth, once it was told: the town heard it,
and the epilogue of the last night may say it, see ``roles``), and ``meeting`` is ``{}`` or
``{"tick", "until", "day", "invited": [person ids]}``. A showing of evidence has seven fields, the
last of which is 0 (it tells nothing by itself), a clarification, which is a speech in public too,
has the first six only, and a full statement has eight: the sixth is whether the evidence was
enough, the seventh ``cleared`` (1 if it told the truth in public) and the eighth the parts that did
not hold, each ``[part, kind, who]`` (``statement.failure``). ``last_statement`` is the last row of
the last kind.

The last statement and what it fell short of. The goal ``g_truth`` is met when at least
``MIN_NAMED`` named people were there, at least ``ACCEPT_PERCENT`` percent accepted and the elder
accepted, and the statement has the parts right and the proof. ``missed`` says what the last
statement fell short of, first in this order: a part that did not hold, the proof, then the three
of the goal as the game reads them (the numbers of the last statement, and the elder's word if he
gave it in any statement), and ``last_statement`` is what the board shows of it.

Events: ``spoke`` (``venue``, ``named``, ``accepted``, ``percent``, ``elder``, ``complete``,
``cleared``, which is false for a showing of evidence), ``stated`` (``venue``, ``named``,
``accepted``, ``percent``, ``elder``, ``proof``, ``told``, ``wrong``: the parts that did not hold,
and ``audience``: for each person there, as ``clarified`` has it, ``{npc, before, after, reason:
{zh, en}}`` with the stands ``for``, ``unsure`` and ``against`` what was stated, and the fixed line
they say in public), ``clarified`` (see ``clarify``), ``feast`` (``venue``, ``named``) and
``convened`` (``invited``).
Rejected: ``talking``, ``busy``, ``no_venue``, ``not_evening``, ``no_meeting``, ``empty_room``,
``no_evidence``, ``said_already``, ``heads_absent``, ``few_present``, for a clarification
``no_entry``, ``not_shown``, ``overclaim`` and ``no_witness``, and for a statement ``too_early``,
``stated_today`` and ``incomplete`` as well.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import SELF_SEEN, Belief
from lantern_core.cognition.props import Prop, lineage
from lantern_core.inputs import InputError
from lantern_core.world.bridge import (
    bonds,
    clarify,
    clock,
    converse,
    evidence,
    goals,
    goals_call,
    goals_ending,
    gossip,
    notebook,
    notes,
    objection,
    peace,
    repute,
    roles,
    statement,
    tasks,
    telling,
    voices,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import PLAYER, lore

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

TEAHOUSE, HALL = "p_teahouse", "p_clan_hall"
ELDER = goals_call.ELDER
HEADS = goals_call.HEADS
EVENING = (17, 21)
MIN_NAMED = 5
MIN_WITNESS = 3
ACCEPT_PERCENT = 60
ACCEPT_AT = 70
ELDER_EXTRA = 15
ELDER_EASES_AT = (
    100  # the strength of a proof that tells the story apart, which he weighs as anyone
)
KIN_PENALTY = 15
ACCEPT_TRUST = 6
GRUDGE_DROP = 10
MEAL_DROP = 12
MEAL_DROP_AFTER_TRUTH = 24
MEAL_TRUST = 3
MEETING_HOURS = 2
GATHER_TICKS = clock.DAY_TICKS_PER_HOUR  # the clan takes an hour to come to the hall
MEETING_TICKS = 4 * clock.DAY_TICKS_PER_HOUR
CALL_BEFORE = 17  # the elder calls the clan only in the first hours of the day
INVITED = (
    "li_laotai",
    "zhou_zhanggui",
    "cha_laoban",
    "old_he",
    "zhangfang",
    "miaozhu",
    "sishu_xiansheng",
    "mujiang",
)
TRUTH_CONFIDENCE = 85
KINDS = ("evidence", "meal", "clarify", "statement")


# ---------------------------------------------------------------------------- the elder's call


def meeting_open(section: dict[str, Any], tick: int) -> bool:
    """Whether the hall is open: the clan has come (``GATHER_TICKS`` after the call) and the hours
    of the meeting have not gone by."""
    meeting = section["meeting"]
    return bool(meeting) and meeting["tick"] <= tick <= meeting["until"]


def clan_called(section: dict[str, Any], tick: int) -> bool:
    """Whether the clan has been called and the hours of the meeting have not gone by, whether it
    has come yet or not."""
    meeting = section["meeting"]
    return bool(meeting) and tick <= meeting["until"]


def opens_at(called: clock.Now) -> int:
    """The tick at which the hall opens for a call made at ``called``: on the first full hour that
    is at least ``GATHER_TICKS`` after the call (the tasks look again on the hour, so that the cards
    know it is open), counted from the start of that day."""
    per_hour = clock.DAY_TICKS_PER_HOUR
    start = called.tick - called.cycle_tick
    hours = -(-(called.cycle_tick + GATHER_TICKS) // per_hour)
    return start + hours * per_hour


def can_convene(sim: Sim) -> str | None:
    """Why the elder cannot call the clan now: ``too_late`` or ``already_called``, else None."""
    if sim.now.phase != clock.DAY or sim.now.hour >= CALL_BEFORE:
        return "too_late"
    if clan_called(sim.state["player"], sim.ctx.tick):
        return "already_called"
    return None


def convene(sim: Sim) -> list[str]:
    """The elder calls the clan to the hall: the people who can come, and he, are sent there."""
    section, tick = sim.state["player"], sim.ctx.tick
    sent: list[str] = []
    for person in (ELDER, *INVITED):
        spec = {"npc": person, "kind": "work", "place": HALL, "hours": MEETING_HOURS}
        try:
            tasks.assign(sim.world, sim.state, spec)
        except tasks.TaskError:
            continue
        sent.append(person)
    if sent:
        section["meeting"] = {
            "tick": opens_at(sim.now),
            "until": tick + MEETING_TICKS,
            "day": sim.now.day,
            "invited": sent,
        }
        sim.emit("convened", invited=sent)
    return sent


# ---------------------------------------------------------------------------- the venue


def venue(
    world: BridgeWorld, world_state: dict[str, Any], now: clock.Now
) -> tuple[str, str | None]:
    """The venue the manager stands at and why it is not open: ``("", "no_venue")`` away from
    both, else the place and ``None`` if open, or ``not_evening`` or ``no_meeting``."""
    section = world_state["player"]
    for place in (TEAHOUSE, HALL):
        if not evidence.within_reach(world, section, place):
            continue
        if place == TEAHOUSE:
            evening = now.phase == clock.DAY and EVENING[0] <= now.hour < EVENING[1]
            return place, None if evening else "not_evening"
        return place, None if meeting_open(section, now.tick) else "no_meeting"
    return "", "no_venue"


def audience(world_state: dict[str, Any], place: str) -> list[str]:
    """The named people at the venue, awake and at the place they were bound for, in cast order."""
    return [
        npc["id"]
        for npc in world_state["npcs"]["list"]
        if npc["place"] == place and gossip.at_goal(npc) and not gossip.asleep(npc)
    ]


def open_here(world: BridgeWorld, world_state: dict[str, Any], now: clock.Now) -> bool:
    """Whether the manager stands where they may speak in public now, and is free to."""
    section = world_state["player"]
    if section["talk"] or section["busy"]:
        return False
    return venue(world, world_state, now)[1] is None


# ---------------------------------------------------------------------------- the evidence


def presented(section: dict[str, Any], body: dict[str, Any]) -> list[str]:
    """The evidence items shown: those named, or those that back the entries named, that the
    manager holds; everything held if nothing is named."""
    held = section["evidence"]
    names = list(body["evidence"]) + ([body["entry"]] if body["entry"] else [])
    if not names:
        return list(held)
    found: list[str] = []
    for name in names:
        if name in held and name not in found:
            found.append(name)
            continue
        entry = notebook.find(section, name)
        if entry is None:
            continue
        for item in SCRIPT["evidence"]:
            if item["id"] in held and entry["prop"] in item["supports"] and item["id"] not in found:
                found.append(item["id"])
    return found


def _items(ids: list[str]) -> list[dict[str, Any]]:
    return [item for item in SCRIPT["evidence"] if item["id"] in ids]


def complete(variant: str, ids: list[str]) -> bool:
    """Whether the items tell the true variant apart from the others."""
    return any(
        row["tells"] == variant and all(item in ids for item in row["items"])
        for row in SCRIPT["evidence_sets"]
    )


def refuted(variant: str, ids: list[str], whole: bool) -> list[str]:
    """The props of the script that the items refute, with their retellings, sorted.

    Each item lists what it refutes. A set that tells the truth apart refutes also whatever cannot
    be true together with the true props of the conflict.
    """
    lo = lore()
    book = lo.book.props
    core: set[str] = set()
    for item in _items(ids):
        core.update(item["refutes"])
    if whole:
        truths = goals_ending.true_conflict_props(variant)
        for pid in book:
            if any(lo.excludes(book[pid], truth) for truth in truths):
                core.add(pid)
    return sorted(pid for pid in book if pid in core or core & set(lineage(pid, book)[1:]))


def _beliefs_about(
    world_state: dict[str, Any], person: str, truths: list[Prop]
) -> tuple[list[tuple[str, int]], bool]:
    """The person's beliefs about the conflict that are false as against ``truths``, as ``(prop,
    firmness)``, and whether they believe one of ``truths``. A person who holds a rival account
    against a false belief holds it less firmly (``BeliefStore.firmness``), so that proof moves
    them more easily."""
    social = world_state["social"]
    view = notebook.view(social)
    mine = notes.store(social, person)
    false: list[tuple[str, int]] = []
    true = False
    for belief in mine:
        if belief.confidence < repute.BELIEVE_AT or belief.prop not in view:
            continue
        prop = view[belief.prop]
        if not goals_ending.about_the_conflict(prop):
            continue
        if goals_ending.is_true(prop, truths):
            true = True
        else:
            false.append((belief.prop, mine.firmness(belief.prop)))
    return false, true


def _beliefs_about_the_conflict(
    world_state: dict[str, Any], person: str, variant: str
) -> tuple[list[tuple[str, int]], bool]:
    """The person's false beliefs about the conflict as ``(prop, confidence)``, and whether they
    believe the truth of it."""
    return _beliefs_about(world_state, person, goals_ending.true_conflict_props(variant))


def blamed(props: list[Prop]) -> str | None:
    """The person the props blame for the rail, if one of them blames a person."""
    for prop in props:
        if prop.pred == "damaged" and prop.arg("who") is not None:
            return prop.arg("who")
    return None


def culprit_of(variant: str) -> str | None:
    """The person the truth blames, if it blames one."""
    return blamed(goals_ending.true_conflict_props(variant))


def accepts_claim(
    world_state: dict[str, Any],
    person: str,
    claimed: list[Prop],
    culprit: str | None,
    strength: int,
    refuted_ids: list[str],
) -> bool:
    """Whether ``person`` accepts what is claimed about the conflict (``claimed``, the props that
    say who or what broke the rail, and ``culprit``, the person they blame, if one) as shown with
    that ``strength``, by the rule in the docstring of the module. Told the truth, ``claimed`` is
    what the truth is; told something else it is what the manager said, and the rule is the same."""
    lo, section = lore(), world_state["player"]
    if person == culprit:
        return False
    false, true = _beliefs_about(world_state, person, claimed)
    if true and not false:
        return True
    shown = strength
    if shown < 100 and any(prop in refuted_ids for prop, _ in false):
        shown = max(shown, 80)
    held = max((conf for _, conf in false), default=0)
    score = shown + repute.trust(section, lo.index[person]) // 2 - held // 2
    if culprit is not None and lo.family[person] is not None:
        score -= KIN_PENALTY if lo.family[person] == lo.family.get(culprit) else 0
    # the elder weighs more, but not a proof that tells the story apart: that refutes what he holds
    extra = ELDER_EXTRA if person == ELDER and strength < ELDER_EASES_AT else 0
    return score >= ACCEPT_AT + extra


def accepts(
    world_state: dict[str, Any],
    person: str,
    variant: str,
    strength: int,
    refuted_ids: list[str],
) -> bool:
    """Whether ``person`` accepts the truth as shown, by the rule in the docstring of the module."""
    return accepts_claim(
        world_state,
        person,
        goals_ending.true_conflict_props(variant),
        culprit_of(variant),
        strength,
        refuted_ids,
    )


def take_in(sim: Sim, person: str, props: list[Prop], claimed: list[Prop]) -> None:
    """``person`` accepts: they come to believe ``props``, at 85 or just above what they believed
    that goes against ``claimed``, which is set aside."""
    social, lo = sim.state["social"], lore()
    view = notebook.view(social)
    false, _ = _beliefs_about(sim.state, person, claimed)
    held = max((conf for _, conf in false), default=0)
    for prop in props:
        have = notes.store(social, person).get(prop.id)
        if have is not None and have.confidence >= repute.BELIEVE_AT:
            continue
        conf = min(95, max(TRUTH_CONFIDENCE, held + 5))
        belief = Belief(
            person, prop.id, "assert", conf, "heard", PLAYER, SELF_SEEN, 1, sim.ctx.tick
        )
        telling.hold(sim, social, lo, view, prop, belief, None)


def take_in_truth(sim: Sim, person: str, variant: str) -> None:
    """``person`` accepts the truth: they come to believe the true props of the conflict."""
    truths = goals_ending.true_conflict_props(variant)
    take_in(sim, person, truths, truths)


# ---------------------------------------------------------------------------- the speech


def validate(world: BridgeWorld, body: dict[str, Any]) -> dict[str, Any]:
    where = "player action speak"
    out = converse.plain(body, str(body.get("type")))
    kind = body.get("kind", "evidence")
    if kind not in KINDS:
        raise InputError(f"{where}: kind must be one of {', '.join(KINDS)}")
    out["kind"] = kind
    names = body.get("evidence", [])
    if not isinstance(names, list) or len(names) > 16:
        raise InputError(f"{where}: evidence must be a list of at most 16 ids")
    out["evidence"] = [converse.id_field(name, where, "evidence") for name in names]
    entry = body.get("entry", "")
    out["entry"] = "" if entry == "" else converse.id_field(entry, where, "entry")
    if kind == "clarify":
        out.update(clarify.validate_fields(body, where))
    return out


def apply(sim: Sim, body: dict[str, Any]) -> None:
    section, world_state, now = sim.state["player"], sim.state, sim.now
    if body["kind"] == "statement":
        reason = statement.block(sim.world, world_state, now)
        if reason is not None:
            return converse.ack(sim, body, reason)
        place, _ = venue(sim.world, world_state, now)
        return _statement(sim, body, place, audience(world_state, place))
    if section["talk"]:
        return converse.ack(sim, body, "talking")
    if section["busy"]:
        return converse.ack(sim, body, "busy")
    place, why = venue(sim.world, world_state, now)
    if why is not None:
        return converse.ack(sim, body, why)
    here = audience(world_state, place)
    if not here:
        return converse.ack(sim, body, "empty_room")
    if body["kind"] == "meal":
        return _meal(sim, body, place, here)
    if body["kind"] == "clarify":
        return _clarify(sim, body, place, here)
    _speech(sim, body, place, here)


def _clarify(sim: Sim, body: dict[str, Any], place: str, here: list[str]) -> None:
    culprit = culprit_of(sim.state["social"]["variant"])
    made = len(sim.state["player"]["public"].get("clarified", ()))
    clarify.apply(sim, body, place, here, culprit)
    if len(sim.state["player"]["public"].get("clarified", ())) > made:  # somebody took it in
        peace.stop_blaming(sim, here)  # and the heads who heard it stop accusing in public
    objection.check(sim)  # Granny Li may have come to know that the rumour is cleared


def _speech(sim: Sim, body: dict[str, Any], place: str, here: list[str]) -> None:
    section, world_state, tick = sim.state["player"], sim.state, sim.ctx.tick
    ids = presented(section, body)
    if not ids:
        return converse.ack(sim, body, "no_evidence")
    sign = f"{sim.now.day}|{'+'.join(sorted(ids))}|{'+'.join(here)}"
    if section["public"]["seen"].get(place) == sign:
        return converse.ack(sim, body, "said_already")
    section["public"]["seen"][place] = sign
    variant, lo = world_state["social"]["variant"], lore()
    whole = complete(variant, ids)
    gone = refuted(variant, ids, whole)
    strength = 100 if whole else 40 if _bearing(variant, ids) else 0
    yes = [p for p in here if accepts(world_state, p, variant, strength, gone)]
    for person in yes:
        repute.nudge(section, lo.index[person], ACCEPT_TRUST)
    percent = 100 * len(yes) // len(here)
    elder = 0 if ELDER not in here else 2 if ELDER in yes else 1
    if len(here) >= MIN_NAMED and percent >= ACCEPT_PERCENT:
        known = section["public"]["refuted"]
        known.extend(pid for pid in gone if pid not in known)
        clarify.seen_cleared(sim, yes, gone)
    section["public"]["speeches"].append([tick, place, len(here), len(yes), elder, int(whole), 0])
    objection.check(sim)  # Granny Li may have seen the rumour cleared (the elder's word comes last)
    if ELDER in here:
        converse.say(section, ELDER, tick + 60, "text", "elder_yes" if elder == 2 else "elder_no")
    sim.emit(
        "spoke",
        venue=place,
        named=len(here),
        accepted=len(yes),
        percent=percent,
        elder=elder,
        complete=whole,
        cleared=False,
    )
    converse.ack(sim, body)


def _bearing(variant: str, ids: list[str]) -> bool:
    """Whether some item of the evidence refutes something or backs the truth."""
    return any(
        item["refutes"] or any(p in item["supports"] for p in _truths(variant))
        for item in _items(ids)
    )


def _statement(sim: Sim, body: dict[str, Any], place: str, here: list[str]) -> None:
    """The full statement: the options chosen on the card, said in public. Three things are judged
    apart. Whether each part is right in the story that is true (``statement.wrong_parts``).
    Whether the evidence held is enough: it tells the true story apart from the others
    (``complete``, the strength of the rule of the module). Whether the people there accept: five
    named, six in ten of them and the elder, each by the same rule as for evidence, weighing what
    is stated and not what is true, and the evidence persuading only as far as it bears on the
    cause that is stated.
    The truth is told only when all three hold. A part that did not hold costs the manager trust
    with everyone there, and the people who accept take in what was stated, right or wrong."""
    section, world_state, tick = sim.state["player"], sim.state, sim.ctx.tick
    variant, lo = world_state["social"]["variant"], lore()
    options = statement.picks(section)
    wrong = statement.wrong_parts(variant, options)
    fails = [statement.failure(section, part, options[part]) for part in wrong]
    ids = list(section["evidence"])
    whole = complete(variant, ids)
    sound = whole and "cause" not in wrong
    gone = refuted(variant, ids, sound)
    strength = 100 if sound else 40 if _bearing(variant, ids) else 0
    props = lo.book.props
    stated = [props[pid] for part in statement.PARTS for pid in options[part]["claims"]]
    claimed = [prop for prop in stated if goals_ending.about_the_conflict(prop)]
    culprit = blamed(claimed)
    yes = [p for p in here if accepts_claim(world_state, p, claimed, culprit, strength, gone)]
    stands = _stands(world_state, here, yes, claimed, culprit, tick + gossip.BUBBLE_TICKS)
    for person in yes:
        take_in(sim, person, [p for p in stated if p.id != clarify.CLAIM], claimed)
        if clarify.CLAIM in {p.id for p in stated}:
            clarify.hold_claim(sim, person)
            notebook.add_seen(section, clarify.CLAIM, tick)
        repute.nudge(section, lo.index[person], ACCEPT_TRUST)
    if wrong:
        for person in here:
            repute.nudge(section, lo.index[person], -statement.STATEMENT_COST)
    percent = 100 * len(yes) // len(here)
    elder = 0 if ELDER not in here else 2 if ELDER in yes else 1
    goals.set_metric(sim, "audience_named", len(here))
    goals.set_metric(sim, "accept_ratio", percent)
    enough = len(here) >= MIN_NAMED and percent >= ACCEPT_PERCENT
    told = False
    if enough and elder == 2 and not wrong and whole:
        goals.set_flag(sim, "elder_accepts")
        told = goals.set_truth_cleared(sim)
    if told:
        section["public"][roles.TOLD_CAUSE] = options["cause"]["id"]  # what the town heard
        for person in yes:
            if person in HEADS:
                _lower_grudge(world_state, person, GRUDGE_DROP)
    if enough:
        known = section["public"]["refuted"]
        known.extend(pid for pid in gone if pid not in known)
        clarify.seen_cleared(sim, yes, gone)
    section["public"]["speeches"].append(
        [tick, place, len(here), len(yes), elder, int(whole), int(told), fails]
    )
    objection.check(sim)  # Granny Li may have seen the rumour cleared (the elder's word comes last)
    if ELDER in here:
        converse.say(section, ELDER, tick + 60, "text", "elder_yes" if elder == 2 else "elder_no")
    sim.emit(
        "stated",
        venue=place,
        named=len(here),
        accepted=len(yes),
        percent=percent,
        elder=elder,
        proof=whole,
        told=told,
        wrong=wrong,
        audience=stands,
    )
    converse.ack(sim, body)


def _stands(
    world_state: dict[str, Any],
    here: list[str],
    yes: list[str],
    claimed: list[Prop],
    culprit: str | None,
    at: int,
) -> list[dict[str, Any]]:
    """What each person there made of a full statement, in the shape of ``clarified``: the stand
    they came with (``for`` if they believed what is stated and nothing against it, ``against`` if
    they held a version that goes against it, else ``unsure``), the stand they leave with
    (``clarify.stance_after``) and the fixed line they say in public. Read before those who accept
    take the statement in."""
    rows: list[dict[str, Any]] = []
    for person in here:
        false, true = _beliefs_about(world_state, person, claimed)
        held = max((conf for _, conf in false), default=0)
        if true and not false:
            before = clarify.FOR
        else:
            before = clarify.AGAINST if held >= clarify.HOLDS_AT else clarify.UNSURE
        accepts = person in yes
        after = clarify.stance_after(accepts, person == culprit, before, held)
        code = clarify.line_of(person, after, accepts, False)
        rows.append(
            {
                "npc": person,
                "before": before,
                "after": after,
                "reason": voices.phrase(person, code, at),
            }
        )
    return rows


def _truths(variant: str) -> list[str]:
    return [prop.id for prop in goals_ending.true_conflict_props(variant)]


def _lower_grudge(world_state: dict[str, Any], head: str, amount: int) -> None:
    """Lower the grudge of one family head against the other by ``amount``."""
    lo, social = lore(), world_state["social"]
    other = HEADS[1] if head == HEADS[0] else HEADS[0]
    left = amount
    while left > 0:
        step = min(bonds.MAX_STEP, left)
        bonds.nudge(social, lo, head, other, bonds.GRUDGE, -step)
        left -= step


def _meal(sim: Sim, body: dict[str, Any], place: str, here: list[str]) -> None:
    section, world_state = sim.state["player"], sim.state
    if not all(head in here for head in HEADS):
        return converse.ack(sim, body, "heads_absent")
    if len([p for p in here if p not in HEADS]) < MIN_WITNESS:
        return converse.ack(sim, body, "few_present")
    sign = f"meal|{sim.now.day}|{'+'.join(here)}"
    if section["public"]["seen"].get(f"{place}#meal") == sign:  # not the slot of a statement there
        return converse.ack(sim, body, "said_already")
    section["public"]["seen"][f"{place}#meal"] = sign
    lo = lore()
    drop = MEAL_DROP_AFTER_TRUTH if goals.flag_up(world_state, goals.TRUTH_TOLD) else MEAL_DROP
    for head in HEADS:
        peace.lower_grudge(world_state, head, drop)
    for person in here:
        repute.nudge(section, lo.index[person], MEAL_TRUST)
    goals.set_reconciled(sim)
    sim.emit("feast", venue=place, named=len(here))
    converse.ack(sim, body)


# ---------------------------------------------------------------------------- the last statement

EVIDENCE_ROW = 7  # the fields of a row of ``public["speeches"]`` that a showing of evidence made
STATEMENT_ROW = 8  # and of a full statement: the evidence row and the failures of the parts
ELDER_WORD = ("absent", "refused", "accepted")  # what the elder did, by the number a row keeps
# what a full statement falls short of, in the order that helps most
MISSED = ("parts", "proof", "named", "accepted", "elder_absent", "elder_refused")


def last_statement(world_state: dict[str, Any]) -> dict[str, Any] | None:
    """The last full statement in public, or None if there has been none.

    ``{"tick", "venue", "named", "accepted", "percent", "elder", "proof", "cleared", "fails"}``,
    with ``elder`` one of ``absent``, ``refused`` and ``accepted``, ``percent`` the share of the
    named people there who accepted, ``proof`` whether the evidence held was enough, ``cleared``
    whether it told the truth and ``fails`` the parts that did not hold, each ``[part, kind, who]``
    (``statement.failure``). A showing of evidence and a clarification are no full statement and
    are not counted.
    """
    for row in reversed(world_state["player"]["public"]["speeches"]):
        if len(row) != STATEMENT_ROW:
            continue
        tick, venue, named, accepted, elder, proof, cleared, fails = row
        return {
            "tick": tick,
            "venue": venue,
            "named": named,
            "accepted": accepted,
            "percent": 100 * accepted // named if named else 0,
            "elder": ELDER_WORD[elder],
            "proof": bool(proof),
            "cleared": bool(cleared),
            "fails": [list(fail) for fail in fails],
        }
    return None


def last_showing(world_state: dict[str, Any]) -> dict[str, Any] | None:
    """The last showing of evidence in public, or None if there has been none.

    ``{"tick", "venue", "named", "accepted", "percent", "elder"}`` as ``last_statement`` has them.
    A showing tells nothing by itself: it persuades, refutes and opens the way to the bamboo. A
    clarification and a full statement are not counted.
    """
    for row in reversed(world_state["player"]["public"]["speeches"]):
        if len(row) != EVIDENCE_ROW:
            continue
        tick, venue, named, accepted, elder = row[:5]
        return {
            "tick": tick,
            "venue": venue,
            "named": named,
            "accepted": accepted,
            "percent": 100 * accepted // named if named else 0,
            "elder": ELDER_WORD[elder],
        }
    return None


def stated_on(world_state: dict[str, Any], day: int) -> bool:
    """Whether a full statement was made on that game day: there is one a day."""
    return any(
        len(row) == STATEMENT_ROW and clock.at(row[0]).day == day
        for row in world_state["player"]["public"]["speeches"]
    )


def worth_saying(world_state: dict[str, Any], venue: str, day: int) -> bool:
    """Whether a statement of evidence at ``venue`` on ``day`` would be a new question for the
    town: the manager holds some, and either holds some that the last statement made there did not
    show or that one was made on an earlier day. The core answers ``said_already`` to the same
    evidence before the same people on the same day (the signature kept in ``public["seen"]``), so
    this is what the card can tell without knowing who will be there."""
    held = world_state["player"]["evidence"]
    if not held:
        return False
    last = world_state["player"]["public"]["seen"].get(venue)
    if last is None or last.startswith("meal|"):  # nothing of evidence was said there since
        return True
    said_day, shown, _ = last.split("|", 2)
    return int(said_day) < day or any(item not in shown.split("+") for item in held)


def missed(world_state: dict[str, Any]) -> str:
    """The first of ``MISSED`` that the last full statement fell short of, or "" if there has been
    none or it fell short of none.

    The order is the one that helps most: a part that did not hold, the proof not being enough,
    then the three of the goal ``g_truth`` in the script's order: enough named people there,
    enough of them accepting, the elder accepting. The elder counts if he accepted in any
    statement (the flag ``elder_accepts``), as the goal reads it.
    """
    last = last_statement(world_state)
    if last is None or last["cleared"]:
        return ""
    if last["fails"]:
        return "parts"
    if not last["proof"]:
        return "proof"
    if last["named"] < MIN_NAMED:
        return "named"
    if last["percent"] < ACCEPT_PERCENT:
        return "accepted"
    if last["elder"] != "accepted" and not goals.flag_up(world_state, "elder_accepts"):
        return f"elder_{last['elder']}"
    return ""
