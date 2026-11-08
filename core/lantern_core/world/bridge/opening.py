"""The opening of a game: the hearsay that is going round when the clock starts.

A script may list openings (``openings`` in the script, checked by ``tools/check_content.py``), and
the config key ``opening`` names the one a game starts from. Without the key nothing here runs and
the game opens with what each person saw the night before and the public facts.

An opening is the hops of a rumour that happened before the first tick, one telling after another:
who told whom which prop, with how much confidence the listener took it in, and how far the speaker
believes the version they voiced (``own``; without it they do not hold it). ``apply`` writes each
hop as ``telling.tell`` would have, with nothing drawn:

- the claim, kept as ``c1``, ``c2`` and so on in the order of the hops, dated tick 0. A prop the
  speaker holds is said as it is (the path ``belief``). Otherwise the prop is a change of one the
  speaker holds, made by the operator the script gives it, and is said by the path ``mutation``
  (with the rule of the hop, when an assimilate changes the predicate). The source the speaker names
  is the one their belief gives (``Belief.honest_source``), as in every telling;
- the listener's belief, heard from the speaker at the hop their belief makes it;
- the speaker's own belief in the changed version, as inferred, if the hop gives ``own``.

Every claim goes through ``paths.authorize`` with the speaker's store as the hops before it left it,
the same check that judges every telling of a game, and the opening is refused if a hop fails it.
The grudge that a rule may ask of the speaker is taken as given: what the rumour rested on is
history, not something this game has to bring about. The beliefs the hops leave are dated tick 0
like what each person knew before the game, so none of it is news to anyone (``recall.lately``), and
the counts of what was told in the game (``social["counts"]``) do not include them.

*Quiet.* An opening may also say that the story stays where it is until a minute of the first
day (``quiet_until``, on the script clock where 06:00 is 360): nobody passes on, of their own
accord, any version of the stories the hops are about (the props whose lineage ends at the same root
as a hop's). What the manager asks is not a telling, and a telling the manager brings about is not
left out. Chance plays no part in who hears what in that time, so the first evening starts from the
same town whichever way the manager walked (``quiet_roots`` is what ``social`` asks each tick).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import Claim
from lantern_core.world.bridge import clock, notes

if TYPE_CHECKING:
    from lantern_core.world.bridge.lore import Lore
    from lantern_core.world.bridge.world import BridgeWorld

OPENING_TICK = 0


def _given(kind: str, holder: str, target: str) -> bool:
    """The relation a rule asks of the speaker, taken as given (see the module docstring)."""
    return True


def apply(lore: Lore, social: dict[str, Any], opening_id: str) -> None:
    """Write the hops of the opening into ``social``, the section as it stands at the start."""
    opening = lore.openings[opening_id]
    for number, hop in enumerate(opening["hops"], 1):
        where = f"opening {opening_id}, hop {number}"
        speaker, listener, prop_id = hop["speaker"], hop["listener"], hop["prop"]
        props = notes.PropView(notes.made_props(social), lore.book.props)
        prop, store = props[prop_id], notes.store(social, speaker)
        claim_id = f"c{social['seq']}"
        held = store.get(prop_id)
        if held is not None:
            modality = "deny" if held.modality == "assert" and prop.neg else held.modality
            claim = Claim(
                claim_id,
                speaker,
                (listener,),
                prop_id,
                modality,
                held.honest_source(),
                OPENING_TICK,
                "belief",
            )
        else:
            before = None if prop.parent is None else store.get(prop.parent)
            if before is None or prop.op is None:
                raise ValueError(
                    f"{where}: {speaker} holds neither {prop_id} nor what it was made from"
                )
            claim = Claim(
                claim_id,
                speaker,
                (listener,),
                prop_id,
                before.modality,
                before.honest_source(),
                OPENING_TICK,
                "mutation",
                rule_id=hop["via"],
                op=prop.op,
            )
        verdict, reason = paths.authorize(
            claim,
            store,
            props,
            tables=lore.tables,
            registry=lore.book.registry,
            rules=lore.book.rules,
            templates=lore.book.templates,
            suspicion=lore.traits[speaker]["suspicion"],
            relation=_given,
            public=lore.public,
        )
        if not verdict:
            raise ValueError(f"{where}: {reason}")
        social["seq"] += 1
        social["claims"][claim_id] = notes.encode_claim(claim)
        if claim.path == "mutation" and hop["own"] is not None:
            own = paths.speaker_belief(
                claim, store, props, confidence=hop["own"], public=lore.public
            )
            assert own is not None
            notes.hold(social, own)
        notes.hold(
            social,
            paths.listener_belief(claim, listener, store, props, confidence=hop["confidence"]),
        )


def quiet_until(opening: dict[str, Any]) -> int:
    """The tick until which the opening keeps its story quiet (0 if it does not)."""
    minute = opening["quiet_until"]
    if minute is None:
        return 0
    return (minute - clock.DAWN_HOUR * 60) * clock.DAY_TICKS_PER_HOUR // 60


def quiet_roots(world: BridgeWorld, lore: Lore, tick: int) -> frozenset[str]:
    """The roots of the stories that nobody passes on of their own accord at ``tick``."""
    opening_id = world.config.get("opening")
    if opening_id is None:
        return frozenset()
    if tick >= quiet_until(lore.openings[opening_id]):
        return frozenset()
    return lore.story_roots[opening_id]
