"""The talk between neighbours: who speaks to whom, what they pass on and how it changes on the way.

Named townsfolk who meet pass on what they believe. The retelling changes it by each person's
habits, and every hop is authorized by the same checker (``paths.authorize``) that will judge
what a model has a character say. Nobody here asks a model anything: who talks, about what, how it
changes and how far it is believed are all decided by ints and the game's RNG.

The game opens by drawing which variant of the script is true (the config key ``variant``
forces it instead; the draw is taken all the same, so the rest of the game is the one the seed
makes), and by writing down what each person knows: the public facts everyone has (the bridge is
where it is, the boatman owns his boat, the rail broke, the water is high) and what each saw for
themselves the night before (see ``lore``). The people stand toward each other as ``bonds`` says.
If the config names an ``opening``, the hearsay that was going round before the clock started is
written down after that, hop by hop (see ``opening``). Each tick, the talk is as ``gossip`` says
(who may speak, who hears, what is told) and ``telling`` does the telling, with the changes of
``retell``. The street (``crowd``) hears what is said outdoors and sends back what it has heard.

State (``state["world"]["social"]``)::

    {"variant": id            the variant of the script that is true in this game,
     "bonds": {person: [affinity, trust, favour, grudge] * 20}   see bonds,
     "beliefs": {person: {prop id: note}}      what each believes, see notes,
     "props": {prop id: note}                  the props made on the way, see notes,
     "claims": {claim id: note}                every claim that was said and passed the check,
     "seq": int                                the number of the next claim,
     "next": [tick] * 20      the tick from which each person may speak again,
     "busy": [tick] * 20      the tick until which each is in the middle of a telling,
     "talks": [[claim id, start, ticks]]       the tellings in flight, which the dots show,
     "bubbles": [[person, until, claim id]]    the words on show over a head,
     "counts": {"told", "mutated", "refused", "conflicts", "street", "street_skipped"},
     "refusals": {code: n},                    the refused claims by the code of the refusal
     "rivals": {person: [note]}                the accounts each keeps in mind against what they
                                               hold, see notes (only once someone does),
     "aloud": {person: [prop id, tick]}}       the latest account of the conflict each gave out in
                                               public, which the paper reads (only once one did)

``stores``, ``claims`` and ``book`` read it back as the types of ``lantern_core.cognition``,
which is what ``provenance.walk_back`` and the notebook need.

Events: ``told`` (``claim``, ``speaker``, ``listener``, ``prop``, ``path``, ``op``, ``modality``),
``conflict`` (``holder``, ``new``, ``held``, ``kept`` as ``new`` or ``held``, ``claim``), ``street``
(``holder``, ``prop``) and ``refused`` (``speaker``, ``listener``, ``prop``, ``path``, ``code``,
``reason``).

The frame: ``dots`` are the tellings in flight, ``{"id": claim id, "from", "to", "topic",
"progress"}`` with the topic ``blame`` for the claim that someone broke or took something,
``clear`` for a denial or a cause that is nobody's doing (the flood), and ``other``; it is made
from what the telling says and never from which story is true (``Lore.topic``). The progress is in
thousandths over the ticks a telling takes. ``bubbles`` are ``{"npc", "until", "text": {"zh",
"en"}}``, the line the speaker said, made from the prop by ``cognition.lines``, for a telling
that the manager is near enough to hear (``overhear.HEARING`` cells from either of the two); any
other telling shows as ``{"npc", "until", "text": null, "talking": true}``, which says that they
are talking and not what about.

The street. When a named person speaks outdoors, ``crowd.hear(sim, place_id, prop_id,
speaker_id)`` is called if the crowd module has it. At the start of its tick this section reads
the outbox of the crowd, ``state["world"]["crowd"]["outbox"]``, a list of ``{"to", "prop",
"tick"}``, turns each into a belief of low confidence from the street, and empties the list.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.cognition.beliefs import Belief, BeliefStore, Claim
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import (
    bonds,
    crowd,
    gossip,
    notes,
    opening,
    overhear,
    telling,
    voices,
)
from lantern_core.world.bridge.lore import PUBLIC_CONFIDENCE, Lore, lore

if TYPE_CHECKING:
    from lantern_core.rng import Pcg32
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "social"
# the kinds of place where a telling is said aloud: the teahouse and its like, where anyone who is
# there hears, and the open places, and not a house, a workshop, a school or the watch post
PUBLIC_KINDS = ("teahouse", "tavern", "temple", "hall", "market", "bank", "lane", "ferry", "bridge")


# ----------------------------------------------------------------------------- reading it back


def stores(social: dict[str, Any]) -> dict[str, BeliefStore]:
    """What every person believes, by person."""
    return notes.stores(social)


def claims(social: dict[str, Any]) -> dict[str, Claim]:
    """Every claim that was said, by id, in the order they were said."""
    return notes.claims(social)


def book(social: dict[str, Any]) -> notes.PropView:
    """Every prop of the game: those of the script and those made on the way."""
    return notes.PropView(notes.made_props(social), lore().book.props)


# ----------------------------------------------------------------------------- the start


def _seed_beliefs(lore_: Lore, social: dict[str, Any]) -> None:
    for pid in lore_.people:
        social["beliefs"][pid] = {}
    for prop_id in lore_.public:
        source = "paper" if lore_.is_headline(prop_id) else "saw"
        for holder in lore_.people:
            known = Belief(holder, prop_id, "assert", PUBLIC_CONFIDENCE, source, None, None, 0, 0)
            notes.hold(social, known)
    for holder, prop_id, confidence in lore_.sightings[social["variant"]]:
        notes.hold(
            social,
            Belief(holder, prop_id, "assert", confidence, "saw", None, None, 0, 0, None),
        )


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: the true variant, the bonds, what each one knows, and
    the hearsay of the opening if the game has one."""
    lore_ = lore()
    if tuple(p.id for p in world.cast.people) != lore_.people:
        raise ValueError("the cast of the world is not the cast of the script")
    variant = lore_.book.variants[rng.below(len(lore_.book.variants))]
    if "variant" in world.config:  # forced: the draw above is taken all the same
        variant = lore_.variants[world.config["variant"]]
    n = len(lore_.people)
    social: dict[str, Any] = {
        "variant": variant.id,
        "bonds": bonds.seed(lore_, rng),
        "beliefs": {},
        "props": {},
        "claims": {},
        "seq": 1,
        "next": [0] * n,
        "busy": [0] * n,
        "talks": [],
        "bubbles": [],
        "counts": {
            "told": 0,
            "mutated": 0,
            "refused": 0,
            "conflicts": 0,
            "street": 0,
            "street_skipped": 0,
        },
        "refusals": {},
    }
    _seed_beliefs(lore_, social)
    if "opening" in world.config:
        opening.apply(lore_, social, world.config["opening"])
    return social


# ----------------------------------------------------------------------------- one tick


def _hear_the_street(sim: Sim, social: dict[str, Any], lore_: Lore) -> None:
    """Turn what the crowd sent into beliefs, and empty its outbox."""
    outbox = sim.state["crowd"].get("outbox")
    if not isinstance(outbox, list) or not outbox:
        return
    entries = list(outbox)
    outbox.clear()
    for entry in entries:
        taken = (
            isinstance(entry, dict)
            and isinstance(entry.get("to"), str)
            and isinstance(entry.get("prop"), str)
            and type(entry.get("tick")) is int
            and telling.hear_street(
                sim,
                social,
                lore_,
                entry["to"],
                entry["prop"],
                max(0, min(entry["tick"], sim.ctx.tick)),
            )
        )
        if not taken:
            social["counts"]["street_skipped"] += 1


def _outdoors(sim: Sim, i: int) -> str | None:
    """The place person ``i`` is at if it is outdoors, else ``None``."""
    npc = sim.state["npcs"]["list"][i]
    place = sim.world.town.places[npc["place"]]
    return None if place.indoor or not gossip.at_goal(npc) else place.id


def in_public(sim: Sim, i: int) -> str | None:
    """The place person ``i`` is at if it is a public one (``PUBLIC_KINDS``) and they are at the
    place they were bound for, else ``None``."""
    npc = sim.state["npcs"]["list"][i]
    place = sim.world.town.places[npc["place"]]
    return place.id if place.kind in PUBLIC_KINDS and gossip.at_goal(npc) else None


def _said_aloud(social: dict[str, Any], speaker: str, prop: Prop, tick: int) -> None:
    """Keep the latest account of how the rail broke that ``speaker`` gave out in public, where
    others could hear it: the paper tells what the street says from these."""
    from lantern_core.world.bridge import goals_ending  # at the call: it reads this module

    if goals_ending.about_the_conflict(prop):
        social.setdefault("aloud", {})[speaker] = [prop.id, tick]


def _after(
    sim: Sim, social: dict[str, Any], lore_: Lore, told: telling.Told, i: int, j: int
) -> None:
    """What a telling leaves behind: the dot, the bubble, who is busy, and what the street hears."""
    tick, claim = sim.ctx.tick, told.claim
    social["talks"].append([claim.id, tick, gossip.TELL_TICKS])
    social["bubbles"] = [b for b in social["bubbles"] if b[0] != claim.speaker]
    social["bubbles"].append([claim.speaker, tick + gossip.BUBBLE_TICKS, claim.id])
    social["next"][i] = tick + gossip.cooldown(lore_, claim.speaker)
    social["busy"][i] = social["busy"][j] = tick + gossip.TELL_TICKS
    place = _outdoors(sim, i)
    hear = getattr(crowd, "hear", None)
    if place is not None and hear is not None:
        hear(sim, place, told.prop.id, claim.speaker)
    if in_public(sim, i) is not None:
        _said_aloud(social, claim.speaker, told.prop, tick)


def tick(sim: Sim) -> None:
    """One tick of the section: the street is heard, and the people whose turn it is may speak."""
    social, lore_ = sim.state["social"], lore()
    now, rng = sim.ctx.tick, sim.ctx.rng
    quiet = opening.quiet_roots(sim.world, lore_, now)
    _hear_the_street(sim, social, lore_)
    social["talks"] = [t for t in social["talks"] if now - t[1] < gossip.TELL_TICKS]
    social["bubbles"] = [b for b in social["bubbles"] if b[1] > now]
    npcs, town = sim.state["npcs"]["list"], sim.world.town
    free_at, busy = social["next"], social["busy"]
    for i, npc in enumerate(npcs):
        if (now + i) % gossip.STRIDE or free_at[i] > now or busy[i] > now or gossip.asleep(npc):
            continue
        speaker = lore_.people[i]
        if rng.below(1000) >= gossip.speak_per_mille(lore_, speaker):
            continue
        near = [j for j in gossip.neighbours(town, npcs, i) if busy[j] <= now]
        if not near:
            continue
        liking = [
            bonds.value(social, lore_, speaker, lore_.people[j], bonds.AFFINITY) for j in near
        ]
        j = near[rng.weighted([max(1, 110 + like) for like in liking])]
        listener = lore_.people[j]
        prop_id = gossip.best_belief(lore_, social, book(social), speaker, listener, now, quiet)
        told = None
        if prop_id is not None:
            told = telling.tell(sim, social, lore_, speaker, listener, prop_id)
        if told is None:
            free_at[i] = now + gossip.RETRY
        else:
            _after(sim, social, lore_, told, i, j)


# ----------------------------------------------------------------------------- the frame


def near(state: dict[str, Any], who: tuple[str, str]) -> bool:
    """Whether the manager stands within hearing of one of two people, by their cells."""
    world_state = state["world"]
    section = world_state["player"]
    found = {npc["id"]: npc for npc in world_state["npcs"]["list"]}
    return any(
        max(abs(section["x"] - found[person]["x"]), abs(section["y"] - found[person]["y"]))
        <= overhear.HEARING
        for person in who
    )


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """Add the tellings in flight as dots, and the words on show as bubbles.

    Only a telling the manager is near enough to hear has its words over the head. The others are
    bubbles without text (``"text": null, "talking": true``), so that the map shows that people
    are talking and not what they say (the notebook and ``listen`` are for that)."""
    social, lore_, now = state["world"]["social"], lore(), state["tick"]

    def claim_and_prop(claim_id: str) -> tuple[Claim, Prop]:
        claim = notes.decode_claim(claim_id, social["claims"][claim_id])
        made = social["props"].get(claim.prop)
        prop = lore_.book.props[claim.prop] if made is None else notes.decode_prop(claim.prop, made)
        return claim, prop

    for claim_id, start, ticks in social["talks"]:
        claim, prop = claim_and_prop(claim_id)
        out["dots"].append(
            {
                "id": claim_id,
                "from": claim.speaker,
                "to": claim.listeners[0],
                "topic": lore_.topic(prop),
                "progress": max(0, min(1000, (now - start) * 1000 // ticks)),
            }
        )
    for npc_id, until, claim_id in social["bubbles"]:
        if until > now:
            claim, prop = claim_and_prop(claim_id)
            if not near(state, (npc_id, claim.listeners[0])):
                far = {"npc": npc_id, "until": until, "text": None, "talking": True}
                out["bubbles"].append(far)
                continue
            said = voices.claim_words(
                prop,
                claim.modality,
                claim.claimed_source,
                claim.speaker,
                int(claim_id[1:]),
                claim.tick,
            )
            out["bubbles"].append({"npc": npc_id, "until": until, "text": dict(said)})
