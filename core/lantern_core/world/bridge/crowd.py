"""The townsfolk without names, whose mood and street talk follow the named ones.

Two hundred townsfolk are a part of the world state and of its hash. No model is asked about them
and they do not walk the grid: this is a layer of numbers on top of the town. Each has

- two opinions, each a bounded int (see ``opinions``): ``enthusiasm`` for the festival, 0 to 100,
  and ``stance`` between the two families, -100 for the first family of the cast (the Li) to 100
  for the second (the Zhou);
- a *home district* (a house of the town, the neighbourhood round it, see ``districts``) and the
  district they are in now, which changes a few times a day by the table of slots, by the weather
  and by the RNG;
- a memory of up to three proposition ids, the things they heard named people say out in the
  street, newest last.

State (``state["world"]["crowd"]``), five parallel lists of ``SIZE`` entries and three more keys::

    {"enthusiasm": [int], "stance": [int], "home": [int], "at": [int], "heard": [[str]],
     "outbox": [{"to": npc id, "prop": prop id, "tick": int}],
     "slot": the slot of the day the townsfolk were last placed for,
     "rng": {"state": hex, "inc": hex}}

``home`` and ``at`` are indices into ``districts.Layout.places``.

Where the numbers come from
---------------------------
The crowd never draws from the RNG that the kernel hands round, so it uses up none of the numbers
that the walks of the named people and the weather draw, and a change to its rules moves neither.
Only what it hands to the talk between named people (through ``outbox``) can change what they say.
It has three generators of its own, all ``Pcg32``:

- Its *stream*, whose state is kept in ``rng``. It is seeded from the state of the kernel's RNG
  when the game is made, without taking a number from it. It places the townsfolk when a slot
  begins and draws the pairs that meet, and nothing else draws from it.
- One generator for each time a named person is heard in the street (``hear``), which decides
  which of the listeners keep what they heard. It is made for the call from the game's seed, the
  tick, the place, the speaker and the proposition, and is not kept.
- One generator for the street talk passed on in a tick (``_pass_on``), made from the game's seed
  and the tick, and not kept either.

So where each townsperson is and who meets whom depend on the seed, the config and the tick alone:
they are the same in every game of a seed, whatever the manager does. What the manager does
reaches the opinions of the townsfolk only through the pulls of ``hear``, which move an opinion by
part of a gap and take no number from the stream.

One tick
--------
1. When a new slot of the day begins (and at the first tick), everyone decides again where to be.
2. A fixed number of meetings (``MEETINGS_PER_TICK``): a pair is drawn uniformly from all the pairs
   of townsfolk who are in the same district, and each of their two opinions moves by the rule of
   bounded confidence in ``opinions``.
3. A fixed number of tries (``PASSES_PER_TICK``) at passing street talk on: a townsperson is
   drawn, and if they remember something, it is day and a named person is standing at their
   district (at the place they were bound for), they tell it to that person. It goes to the
   ``outbox`` and out of the townsperson's memory, so a thing is told once by each who heard it.

The talk between named people (the ``social`` module) calls ``hear`` when someone speaks in a
place in the open, and reads ``outbox`` at the start of its next tick and empties it. The outbox is
bounded: if nobody empties it, the oldest entries go.

The frame's ``hud`` gets ``keen``, the number of townsfolk whose enthusiasm is at ``KEEN_LINE`` or
above. The number of people expected at the festival is worked out elsewhere from ``keen_count``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core import canon
from lantern_core.rng import Pcg32
from lantern_core.world.bridge import clock, districts, npcs, opinions, weather

if TYPE_CHECKING:
    from lantern_core.world.bridge.sim import Sim
    from lantern_core.world.bridge.world import BridgeWorld

SECTION = "crowd"

SIZE = 200
MEMORY = 3  # propositions a townsperson remembers
KEEN_LINE = 60  # enthusiasm at which a townsperson counts as keen for the festival
MEETINGS_PER_TICK = 2
PASSES_PER_TICK = 2
OUTBOX_MAX = 64

# The start of a game: enthusiasm is 5 plus two throws of 0 to 45, which makes about a third of the
# townsfolk keen. A stance is the lean of the home plus two throws of 0 to 60, less 60.
HOME_LEAN = 45
STORE_PER_MILLE = 500  # the chance that a listener keeps what a named person said in the street

# How a named person is taken when they speak out in the open. The side of a family gives the
# stance, warmth the enthusiasm. Standing is 1, and 2 more for a gatekeeper and 1 more for a
# hub, because people listen to them, and every point of it pulls this much.
VOICE_STANCE = 60
VOICE_ENTHUSIASM = 20
PULL_PER_STANDING = 40  # per mille of the gap

_SEED_SALT = 0x63726F776421  # the crowd's seed is the state of the kernel's RNG with this mixed in
_STREAM = 0x63726F7764  # and its increment is this, so that its numbers are another sequence


def _draws_for(sim: Sim, *key: str) -> Pcg32:
    """A generator for one event of the crowd, made from the game's seed, the tick and ``key``.

    It holds no state between calls and does not touch the crowd's stream (see the top of this
    file), so what is drawn for one event never moves the numbers drawn for another.
    """
    digest = canon.digest([sim.ctx.state["seed"], sim.ctx.tick, *key])
    return Pcg32(int(digest[:16], 16), int(digest[16:32], 16))


def init(world: BridgeWorld, rng: Pcg32) -> dict[str, Any]:
    """The section at the start of a game: who lives where and what they think."""
    lay = districts.layout(world.town, world.cast)
    own = Pcg32(rng.state ^ _SEED_SALT, _STREAM)  # reads the kernel's RNG and does not draw
    home: list[int] = []
    enthusiasm: list[int] = []
    stance: list[int] = []
    for _ in range(SIZE):
        which = own.weighted(lay.home_share)
        home.append(lay.homes[which])
        enthusiasm.append(5 + own.below(46) + own.below(46))
        lean = lay.home_lean[which] * HOME_LEAN
        stance.append(
            opinions.clamp(
                lean + own.below(61) + own.below(61) - 60,
                opinions.STANCE_MIN,
                opinions.STANCE_MAX,
            )
        )
    return {
        "enthusiasm": enthusiasm,
        "stance": stance,
        "home": home,
        "at": list(home),
        "heard": [[] for _ in range(SIZE)],
        "outbox": [],
        "slot": -1,
        "rng": own.to_state(),
    }


# ---------------------------------------------------------------------------- reading


def section_of(state: dict[str, Any]) -> dict[str, Any]:
    """The crowd section of a kernel state, of a world state, or the section itself."""
    if "crowd" in state:
        return state["crowd"]
    if "world" in state:
        return state["world"]["crowd"]
    return state


def keen_count(state: dict[str, Any]) -> int:
    """How many townsfolk are keen for the festival: enthusiasm at ``KEEN_LINE`` or above.

    ``state`` is the kernel's state, the world state (``state["world"]``) or the crowd section.
    """
    return sum(1 for e in section_of(state)["enthusiasm"] if e >= KEEN_LINE)


def district_of(world: BridgeWorld, state: dict[str, Any], k: int, *, home: bool = False) -> str:
    """The place id of the district that townsperson ``k`` is in now, or lives in if ``home``."""
    lay = districts.layout(world.town, world.cast)
    return lay.places[section_of(state)["home" if home else "at"][k]]


def voice(world: BridgeWorld, speaker_id: str) -> tuple[int, int, int]:
    """How the townsfolk take a named person: ``(stance, enthusiasm, pull per mille)``.

    The stance is that of the person's family (0 for someone of neither), the enthusiasm follows
    their warmth, and the pull follows their standing. See the constants above.
    """
    lay = districts.layout(world.town, world.cast)
    person = world.cast.people[world.cast.index[speaker_id]]
    standing = 1 + (2 if "gatekeeper" in person.tags else 0) + (1 if "hub" in person.tags else 0)
    return (
        lay.side.get(person.family, 0) * VOICE_STANCE,
        min(opinions.ENTHUSIASM_MAX, VOICE_ENTHUSIASM + person.traits["warmth"]),
        PULL_PER_STANDING * standing,
    )


# ---------------------------------------------------------------------------- hearing


def _remember(heard: list[str], prop_id: str) -> bool:
    """Keep ``prop_id`` among the last ``MEMORY`` things heard. False if it was there already."""
    if prop_id in heard:
        return False
    heard.append(prop_id)
    if len(heard) > MEMORY:
        del heard[0]
    return True


def hear(sim: Sim, place_id: str, prop_id: str, speaker_id: str) -> int:
    """A named person spoke out in the open: the townsfolk of that district hear it.

    Their stance and their enthusiasm are pulled toward the speaker's (see ``voice``), and each
    keeps ``prop_id`` in their memory with the chance ``STORE_PER_MILLE``, the oldest going if
    there are three already. The chances come from a generator made for this call, so the
    crowd's stream is not touched. Nothing happens if the place is indoors. Returns the number of
    townsfolk who kept the proposition. An unknown place or speaker is an error.
    """
    world = sim.world
    place = world.town.places.get(place_id)
    if place is None:
        raise ValueError(f"unknown place {place_id!r}")
    if speaker_id not in world.cast.index:
        raise ValueError(f"unknown speaker {speaker_id!r}")
    if not isinstance(prop_id, str) or not prop_id:
        raise ValueError(f"a proposition id is a non-empty string, got {prop_id!r}")
    lay = districts.layout(world.town, world.cast)
    if place.indoor or place_id not in lay.index:
        return 0
    district = lay.index[place_id]
    stance, enthusiasm, per_mille = voice(world, speaker_id)
    section = sim.state["crowd"]
    rng = _draws_for(sim, "hear", place_id, speaker_id, prop_id)
    kept = 0
    for k, here in enumerate(section["at"]):
        if here != district:
            continue
        section["stance"][k] = opinions.pull(section["stance"][k], stance, per_mille)
        section["enthusiasm"][k] = opinions.pull(section["enthusiasm"][k], enthusiasm, per_mille)
        if rng.below(1000) < STORE_PER_MILLE and _remember(section["heard"][k], prop_id):
            kept += 1
    return kept


# ---------------------------------------------------------------------------- one tick


def _place_everyone(sim: Sim, section: dict[str, Any], lay: districts.Layout, rng: Pcg32) -> None:
    """Everyone decides again where to be, for the slot that begins."""
    slot = districts.slot_at(sim.now)
    kind = weather.today(sim.state)
    stay = districts.stay_at_home(slot, kind)
    where, weights = districts.destinations(lay, slot, kind)
    home, at = section["home"], section["at"]
    for k in range(SIZE):
        if not where or rng.below(1000) < stay:
            at[k] = home[k]
        else:
            at[k] = where[rng.weighted(weights)]


def _meet(section: dict[str, Any], rng: Pcg32) -> None:
    """Let ``MEETINGS_PER_TICK`` pairs talk, each drawn from the townsfolk of one district."""
    by_district: dict[int, list[int]] = {}
    for k, here in enumerate(section["at"]):
        by_district.setdefault(here, []).append(k)
    groups = [by_district[d] for d in sorted(by_district) if len(by_district[d]) >= 2]
    if not groups:
        return
    pairs = [len(g) * (len(g) - 1) // 2 for g in groups]
    enthusiasm, stance = section["enthusiasm"], section["stance"]
    for _ in range(MEETINGS_PER_TICK):
        group = groups[rng.weighted(pairs)]
        a = rng.below(len(group))
        b = rng.below(len(group) - 1)
        i, j = group[a], group[b + 1 if b >= a else b]
        enthusiasm[i], enthusiasm[j] = opinions.meet(
            enthusiasm[i], enthusiasm[j], opinions.ENTHUSIASM_BOUND
        )
        stance[i], stance[j] = opinions.meet(stance[i], stance[j], opinions.STANCE_BOUND)


def _named_in_districts(sim: Sim, lay: districts.Layout) -> dict[int, list[str]]:
    """The named people who are at the place they are bound for, by the district it is."""
    found: dict[int, list[str]] = {}
    for npc in sim.state["npcs"]["list"]:
        district = lay.index.get(npc["place"])
        if district is not None and npcs.is_at_goal(npc):
            found.setdefault(district, []).append(npc["id"])
    return found


def _pass_on(sim: Sim, section: dict[str, Any], lay: districts.Layout) -> None:
    """Try ``PASSES_PER_TICK`` times to have a townsperson tell a named person what they heard.

    The townsperson, the person told and the thing told are drawn from a generator made for this
    tick, so the crowd's stream is not touched.
    """
    heard, at, outbox = section["heard"], section["at"], section["outbox"]
    rng = _draws_for(sim, "pass")
    named: dict[int, list[str]] | None = None
    for _ in range(PASSES_PER_TICK):
        k = rng.below(SIZE)
        if not heard[k] or sim.now.phase != clock.DAY:
            continue
        if named is None:
            named = _named_in_districts(sim, lay)
        here = named.get(at[k])
        if not here:
            continue
        who = here[rng.below(len(here))]
        prop = heard[k].pop(rng.below(len(heard[k])))
        outbox.append({"to": who, "prop": prop, "tick": sim.ctx.tick})
    if len(outbox) > OUTBOX_MAX:
        del outbox[: len(outbox) - OUTBOX_MAX]


def tick(sim: Sim) -> None:
    """One tick of the section: a new slot of the day, the meetings, the talk passed on."""
    section = sim.state["crowd"]
    lay = districts.layout(sim.world.town, sim.world.cast)
    rng = Pcg32.from_state(section["rng"])
    key = districts.slot_key(sim.now)
    if key != section["slot"]:
        section["slot"] = key
        _place_everyone(sim, section, lay, rng)
    _meet(section, rng)
    section["rng"] = rng.to_state()
    _pass_on(sim, section, lay)


def frame(world: BridgeWorld, state: dict[str, Any], out: dict[str, Any]) -> None:
    """Put the number of townsfolk who are keen for the festival in the ``hud``."""
    out["hud"]["keen"] = keen_count(state)
