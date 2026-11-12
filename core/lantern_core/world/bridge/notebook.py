"""The notebook: the player's belief store, with the source of every entry and the four marks.

It is the same kind of store as the townsfolk's (``BeliefStore``, holder ``"player"``) with one
belief for each prop, and it lives in the ``player`` section as a list of entries::

    {"id": "n3",                the number the client knows the entry by, from "n1" on,
     "prop": prop id,
     "note": a belief note (see ``notes``): what was seen, or heard from whom at which hand,
     "trail": [[holder, claimed source, prop], ...],
     "where": the place the manager stood at when they wrote the entry down (``encounters``)}

The ``trail`` is the player's tracing of where a heard entry came from, and only the hops the
player has asked about are in it. The first hop is the one that told the player and the source it
named, and every ``ask_source`` that reaches the person at the end of the trail adds one. Each hop
is what that person said: who they say told them (a person, ``self_seen`` for "I saw it myself",
``unknown`` for "I heard it somewhere", or ``own`` for their own conclusion) and the prop they
said it about, which can be a parent of the entry when they know no more than that.

An entry is written once for a prop. Hearing the prop again does not write another. Seeing it
for oneself replaces what was only heard, keeping the number.

An answer that says a rival account after the belief (see ``answers``) is two answers, the belief
and the account somebody else told, and the section ``player`` keeps which went with which in
``twins``: ``{answer id: rival answer id}``. It has the key only once a person has answered so.

The marks of an entry are the relations to other entries that the manager has judged right (the
action ``judge``, see ``judge``) and the ones the script shows from the start
(``tutorial_relations``), and nothing the game works out on its own (see ``marks``). The relations
of ``cognition.relations`` are the logic that ``judge`` checks a judgement by, and the game does not
apply them to the notebook by itself any more.

Texts. An entry's text is its prop said in both languages by ``cognition.lines``, as a sentence of
its own: capitalised and with its full stop in English, with the Chinese full stop in Chinese.

The frame shows each entry as ``{"id", "text": {"zh", "en"}, "source", "at", "marks", "chain"}``
(see ``wire``). ``source`` is ``{"kind": "seen"}``, what the manager saw themselves, or ``{"kind":
"heard", "who": name, "how": how, "via"?: name}``: the teller, and what the teller said of how they
came to know it (``how``): ``saw`` (they were there), ``heard`` (they heard it from ``via``, a
person of the cast) or ``unsure`` (they heard it and cannot say from whom, or they worked it out
themselves). The number of hands the telling has passed through (``hop`` of the belief) stays in the
state and is in no frame: a player is told whom to ask and what they said, not how far it has come.
``at`` is when and where the manager learned the entry: the tick of the belief it keeps (when it was
said to them, or when they saw it) and the place they stood at, as ``encounters.stamp`` says them,
and null for an entry written before the places were kept. ``marks`` are the page's words for the
marks (``marks.ORDER``), and ``chain`` is the teller, then
each person the trail names, and a null at the end if the last of them has not been asked yet. A
trail that comes back to the player's own words ends with the player, named ``Festival Manager``
with the id ``player``. A name is ``{"zh", "en", "id"}``: the page reads the two languages, and
the id is the cast id.
"""

from __future__ import annotations

import dataclasses
import functools
from collections.abc import Mapping
from typing import Any

from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN, Belief, BeliefStore, Claim
from lantern_core.cognition.lines import capitalise
from lantern_core.cognition.props import ExclusiveGroups, Prop, lineage
from lantern_core.world.bridge import encounters, marks, notes
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

PLAYER_ID = "player"
OWN = "own"  # in a trail: the person gave their own conclusion as the source
SEEN_CONFIDENCE = 95
HEARD_CONFIDENCE = 60
HOP_PENALTY = 8
GUESS_PENALTY = 12


# ---------------------------------------------------------------------------- reading


def find(section: Mapping[str, Any], entry_id: str) -> dict[str, Any] | None:
    for entry in section["notebook"]:
        if entry["id"] == entry_id:
            return entry
    return None


def by_prop(section: Mapping[str, Any], prop_id: str) -> dict[str, Any] | None:
    for entry in section["notebook"]:
        if entry["prop"] == prop_id:
            return entry
    return None


def belief_of(entry: Mapping[str, Any]) -> Belief:
    return notes.decode_belief(PLAYER_ID, entry["prop"], entry["note"])


def store(section: Mapping[str, Any]) -> BeliefStore:
    """The notebook as a store of beliefs, for the marks and for the paths."""
    return BeliefStore(PLAYER_ID, [belief_of(e) for e in section["notebook"]])


def view(social: Mapping[str, Any]) -> notes.PropView:
    """Every prop of the game: those of the script and those made on the way."""
    return notes.PropView(notes.made_props(social), lore().book.props)


# ---------------------------------------------------------------------------- writing


def heard_confidence(hop: int, modality: str) -> int:
    """How far the player takes what they were told, from 10 to 90: less the further it came."""
    conf = HEARD_CONFIDENCE - HOP_PENALTY * (hop - 1)
    if modality == "speculate":
        conf -= GUESS_PENALTY
    return max(10, min(90, conf))


def _new_id(section: dict[str, Any]) -> str:
    entry_id = f"n{section['seq']}"
    section["seq"] += 1
    return entry_id


def add_heard(section: dict[str, Any], belief: Belief) -> tuple[dict[str, Any], bool]:
    """Write down something heard, unless the prop is in the notebook already.

    Returns the entry for the prop and whether it is a new one.
    """
    held = by_prop(section, belief.prop)
    if held is not None:
        return held, False
    claimed = belief.claimed_source
    assert belief.teller is not None and claimed is not None
    entry = {
        "id": _new_id(section),
        "prop": belief.prop,
        "note": notes.encode_belief(belief),
        "trail": [[belief.teller, trail_word(claimed, belief.teller), belief.prop]],
        "where": encounters.where_is(section),
    }
    section["notebook"].append(entry)
    return entry, True


def add_seen(section: dict[str, Any], prop_id: str, tick: int) -> tuple[dict[str, Any], bool]:
    """Write down something the player saw, replacing what they only heard of the prop."""
    belief = Belief(PLAYER_ID, prop_id, "assert", SEEN_CONFIDENCE, "saw", None, None, 0, tick)
    held = by_prop(section, prop_id)
    if held is None:
        entry = {
            "id": _new_id(section),
            "prop": prop_id,
            "note": notes.encode_belief(belief),
            "trail": [],
            "where": encounters.where_is(section),
        }
        section["notebook"].append(entry)
        return entry, True
    if belief_of(held).source == "saw":
        return held, False
    held["note"] = notes.encode_belief(belief)
    held["trail"] = []
    held["where"] = encounters.where_is(section)
    return held, True


def trail_word(claimed: str, speaker: str) -> str:
    """What a trail keeps of a named source: a person's own conclusion has a word of its own."""
    return OWN if claimed == speaker else claimed


def frontier(entry: Mapping[str, Any]) -> str | None:
    """The person the trail names last and the player has not asked yet, if there is one."""
    trail = entry["trail"]
    if not trail:
        return None
    named = trail[-1][1]
    if named in (SELF_SEEN, UNKNOWN, OWN, PLAYER_ID) or any(hop[0] == named for hop in trail):
        return None
    return named


def extend_trail(entry: dict[str, Any], holder: str, claimed: str, prop_id: str) -> None:
    """Add what ``holder`` said when asked who told them: the next hop of the trail."""
    entry["trail"].append([holder, trail_word(claimed, holder), prop_id])


def add_answer(section: dict[str, Any], claim: Claim) -> str:
    """Keep a claim made to the player and return its id (``p1``, ``p2``...)."""
    claim_id = f"p{section['cseq']}"
    section["cseq"] += 1
    section["claims"][claim_id] = notes.encode_claim(dataclasses.replace(claim, id=claim_id))
    return claim_id


def answer(section: Mapping[str, Any], claim_id: str) -> Claim:
    return notes.decode_claim(claim_id, section["claims"][claim_id])


def pair_rival(section: dict[str, Any], claim_id: str, rival_id: str) -> None:
    """Keep that the answer ``rival_id`` was said after the answer ``claim_id``, as the account
    somebody else told the person who answered."""
    section.setdefault("twins", {})[claim_id] = rival_id


def twin_of(section: Mapping[str, Any], claim_id: str) -> str | None:
    """The id of the rival answer said after the answer ``claim_id``, if one was."""
    return section.get("twins", {}).get(claim_id)


def unpair_rival(section: dict[str, Any], claim_id: str) -> None:
    """Keep that the answer ``claim_id`` was not said with its rival after all: the words that came
    to be on show (a model's) left it out. The section has no ``twins`` once none is left."""
    twins = section.get("twins")
    if twins is not None:
        twins.pop(claim_id, None)
        if not twins:
            del section["twins"]


def find_answer(section: Mapping[str, Any], claim: Claim) -> str | None:
    """The id of an answer that says what ``claim`` says, in the same way, or None."""
    same = (claim.speaker, claim.prop, claim.modality, claim.claimed_source)
    for claim_id in sorted(section["claims"], key=lambda cid: int(cid[1:])):
        said = answer(section, claim_id)
        if (said.speaker, said.prop, said.modality, said.claimed_source) == same and (
            said.path,
            said.rule_id,
            said.premises,
            said.op,
            said.template_id,
        ) == (claim.path, claim.rule_id, claim.premises, claim.op, claim.template_id):
            return claim_id
    return None


def take_answer(
    world_state: Mapping[str, Any], partner: str, claim: Claim, reuse: bool = False
) -> tuple[str, dict[str, Any], bool]:
    """Write down what ``partner`` told the manager in answer, which the paths have passed.

    The claim is kept as an answer (``p1``...), and the manager hears it as from the speaker: a
    heard belief naming the source the speaker named, at the hand the speaker's own belief makes
    it and as sure as ``heard_confidence`` says, written to the notebook unless the notebook has
    the prop already. With ``reuse``, an answer that says the same is not kept twice. Returns the
    id of the answer, the entry of the notebook for its prop and whether the entry is new.
    """
    section, social = world_state["player"], world_state["social"]
    claim_id = find_answer(section, claim) if reuse else None
    if claim_id is None:
        claim_id = add_answer(section, claim)
    base = paths.listener_belief(
        answer(section, claim_id),
        PLAYER_ID,
        notes.store(social, partner),
        view(social),
        confidence=50,
    )
    belief = dataclasses.replace(base, confidence=heard_confidence(base.hop, base.modality))
    entry, new = add_heard(section, belief)
    return claim_id, entry, new


# ---------------------------------------------------------------------------- what the player knows


@functools.cache
def _script_twins() -> dict[tuple[str, tuple[tuple[str, str], ...], bool], tuple[str, ...]]:
    """The props of the script that say the same thing, by predicate, arguments and polarity."""
    book = lore().book.props
    twins: dict[tuple[str, tuple[tuple[str, str], ...], bool], list[str]] = {}
    for prop_id in book:
        prop = book[prop_id]
        twins.setdefault((prop.pred, prop.args, prop.neg), []).append(prop_id)
    return {key: tuple(ids) for key, ids in twins.items()}


class TwinGroups(ExclusiveGroups):
    """The exclusive groups of the script, read through the props that say the same thing.

    A prop made on the way is in no group, but it says what some prop of the script says, perhaps
    with less about when or why, so it clashes with whatever that prop clashes with.
    """

    __slots__ = ("_view",)

    def __init__(self, groups: ExclusiveGroups, props: Mapping[str, Prop]) -> None:
        super().__init__(groups.groups)
        self._view = props

    def _same_as(self, prop_id: str) -> list[str]:
        prop = self._view.get(prop_id)
        if prop is None:
            return [prop_id]
        return [prop_id, *_script_twins().get((prop.pred, prop.args, prop.neg), ())]

    def together(self, a: str, b: str) -> bool:
        if a == b:
            return False
        return any(
            super(TwinGroups, self).together(x, y)
            for x in self._same_as(a)
            for y in self._same_as(b)
        )


def _same_story(one: str, other: str, props: Mapping[str, Prop]) -> bool:
    first, second = lineage(one, props), lineage(other, props)
    return bool(first) and bool(second) and first[-1] == second[-1]


def known_claims(
    section: Mapping[str, Any], social: Mapping[str, Any], props: Mapping[str, Prop]
) -> list[Claim]:
    """The claims the player knows were made: those they overheard, the ones they made themselves,
    and the named sources' own.

    When an entry names a source, and that source has told the player something about the same
    story, the player knows what that source says they told the teller: it is taken for a claim of
    the source to the teller, dated to the telling. Whether it agrees with the entry is for
    ``source_mismatch`` to say.
    """
    known = [notes.decode_claim(cid, social["claims"][cid]) for cid in section["heard"]]
    known += [notes.decode_claim(row[0], social["claims"][row[0]]) for row in section["told"]]
    told: dict[str, list[Claim]] = {}
    for cid in sorted(section["claims"], key=lambda c: int(c[1:])):
        said = answer(section, cid)
        told.setdefault(said.speaker, []).append(said)
    for entry in section["notebook"]:
        belief = belief_of(entry)
        named = belief.claimed_source
        if belief.source != "heard" or named in (None, SELF_SEEN, UNKNOWN, belief.teller):
            continue
        for said in told.get(named, ()):
            if _same_story(entry["prop"], said.prop, props):
                modality = "assert" if said.modality == "lie" else said.modality
                known.append(
                    Claim(
                        f"a-{entry['id']}-{said.id}",
                        named,
                        (belief.teller,),
                        said.prop,
                        modality,
                        said.claimed_source,
                        belief.tick,
                        "belief",
                    )
                )
    return known


# ---------------------------------------------------------------------------- what the page sees


def _name(world: Any, person_id: str) -> dict[str, str]:
    if person_id == PLAYER_ID:  # a trail that comes back to the manager's own words
        return {"zh": "总管", "en": "Festival Manager", "id": PLAYER_ID}
    person = world.cast.people[world.cast.index[person_id]]
    return {"zh": person.zh, "en": person.en, "id": person_id}


def name_of(world: Any, person_id: str) -> dict[str, str]:
    """A person as the page names them: ``{"zh", "en", "id"}``, the cast's own words."""
    return _name(world, person_id)


def sentence(prop: Prop) -> dict[str, str]:
    """A prop as a sentence of its own in each language."""
    lo = lore()
    said = lo.lines.statement(prop, lo.names)
    return {"zh": said["zh"] + "。", "en": capitalise(said["en"]) + "."}


def how_told(world: Any, belief: Belief) -> dict[str, Any]:
    """What a teller said of how they came to know what they told, for the frame: ``{"how":
    "saw"}`` if they said they saw it, ``{"how": "heard", "via": name}`` if they named the person
    they heard it from, and ``{"how": "unsure"}`` if they could not say whom, or gave their own
    conclusion."""
    claimed = belief.claimed_source
    if claimed == SELF_SEEN:
        return {"how": "saw"}
    if claimed in (None, UNKNOWN, belief.teller):
        return {"how": "unsure"}
    return {"how": "heard", "via": _name(world, claimed)}


def chain_of(world: Any, entry: Mapping[str, Any]) -> list[dict[str, str] | None]:
    """The teller, each person the trail names, and a null if the last has yet to be asked."""
    trail = entry["trail"]
    if not trail:
        return []
    chain: list[dict[str, str] | None] = [_name(world, trail[0][0])]
    for _, named, _ in trail:
        if named in (SELF_SEEN, UNKNOWN, OWN):
            return chain
        chain.append(_name(world, named))
        if named == PLAYER_ID:  # back to the manager's own words: there is no one left to ask
            return chain
    if frontier(entry) is not None:
        chain.append(None)
    return chain


def when_where(entry: Mapping[str, Any], belief: Belief) -> dict[str, Any] | None:
    """When and where the manager learned an entry, for the frame: the tick of its belief and the
    place the manager stood at, or null for an entry that was written without a place."""
    place = entry.get("where")
    if place is None:
        return None
    return encounters.stamp(belief.tick, place)


def _signature(section: Mapping[str, Any], social: Mapping[str, Any]) -> tuple[Any, ...]:
    """Everything the entries as the client reads them depend on, as a value to compare."""
    entries = tuple(
        (e["id"], e["prop"], e["note"], tuple(tuple(hop) for hop in e["trail"]), e.get("where"))
        for e in section["notebook"]
    )
    made = social.get("props", {})
    props = tuple((e[1], made[e[1]]) for e in entries if e[1] in made)
    heard = tuple((cid, social["claims"][cid]) for cid in section["heard"])
    told = tuple(tuple(row) for row in section["told"])
    judged = tuple(tuple(row) for row in section["judgments"])
    return (entries, heard, tuple(section["claims"].items()), props, told, judged)


_WIRED: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
MAX_WIRED = 16


def wire(world: Any, world_state: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The entries as the client reads them, in the order they were written.

    The entries change when the player acts and not between actions, so the list made for a
    notebook is kept and handed out again while the notebook is the same. A caller must not change
    what it gets.
    """
    section = world_state["player"]
    if not section["notebook"]:
        return []
    social = world_state["social"]
    key = _signature(section, social)
    wired = _WIRED.get(key)
    if wired is None:
        wired = _wire(world, section, social)
        if len(_WIRED) >= MAX_WIRED:
            _WIRED.clear()
        _WIRED[key] = wired
    return list(wired)


def _wire(
    world: Any, section: Mapping[str, Any], social: Mapping[str, Any]
) -> list[dict[str, Any]]:
    props = view(social)
    shown = marks.of_entries(
        [(entry["id"], entry["prop"]) for entry in section["notebook"]],
        section["judgments"],
        SCRIPT["tutorial_relations"],
    )
    out = []
    for entry in section["notebook"]:
        belief = belief_of(entry)
        source: dict[str, Any] = {"kind": "seen"}
        if belief.source == "heard":
            assert belief.teller is not None
            source = {"kind": "heard", "who": _name(world, belief.teller)}
            source.update(how_told(world, belief))
        out.append(
            {
                "id": entry["id"],
                "text": sentence(props[entry["prop"]]),
                "source": source,
                "at": when_where(entry, belief),
                "marks": shown[entry["id"]],
                "chain": chain_of(world, entry),
            }
        )
    return out
