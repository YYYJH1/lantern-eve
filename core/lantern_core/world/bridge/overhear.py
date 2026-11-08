"""Listening: what two people said within earshot of the player.

A telling between two townsfolk puts the speaker's words over their head for a while (``social``
keeps them as ``bubbles``). The player who stands within ``HEARING`` cells of either of the two
while the words are up can take them in with ``listen``. They go into the notebook as heard from
the speaker, at the hand the speaker's own belief makes it, naming the source the speaker named.
The claim itself is the one in the record of the town, so the way back from the entry is real.

Only what is new to the notebook can be heard: a prop that is in it already is not offered again.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from lantern_core.cognition import paths
from lantern_core.cognition.beliefs import Claim
from lantern_core.world.bridge import notebook, notes

HEARING = 4  # cells, as the king walks


def audible(world_state: dict[str, Any], tick: int) -> list[str]:
    """The ids of the claims the player could take in at ``tick``, the newest words first."""
    section, social = world_state["player"], world_state["social"]
    bubbles = social.get("bubbles")
    if not bubbles:
        return []
    npcs = world_state["npcs"]["list"]
    index = {npc["id"]: npc for npc in npcs}
    found: list[tuple[int, int, str]] = []
    for speaker, until, claim_id in bubbles:
        if until <= tick:
            continue
        claim = notes.decode_claim(claim_id, social["claims"][claim_id])
        if notebook.by_prop(section, claim.prop) is not None:
            continue
        near = any(
            max(abs(section["x"] - index[who]["x"]), abs(section["y"] - index[who]["y"])) <= HEARING
            for who in (speaker, claim.listeners[0])
        )
        if near:
            found.append((until, int(claim_id[1:]), claim_id))
    return [claim_id for _, _, claim_id in sorted(found, reverse=True)]


def take_in(world_state: dict[str, Any], claim_id: str) -> tuple[Claim, dict[str, Any], bool]:
    """Write down a claim the player heard. The claim, its entry, and whether the entry is new."""
    section, social = world_state["player"], world_state["social"]
    claim = notes.decode_claim(claim_id, social["claims"][claim_id])
    props = notebook.view(social)
    heard = dataclasses.replace(claim, listeners=(notebook.PLAYER_ID,))
    base = paths.listener_belief(
        heard, notebook.PLAYER_ID, notes.store(social, claim.speaker), props, confidence=50
    )
    belief = dataclasses.replace(
        base, confidence=notebook.heard_confidence(base.hop, base.modality)
    )
    entry, new = notebook.add_heard(section, belief)
    if claim_id not in section["heard"]:
        section["heard"].append(claim_id)
    return claim, entry, new
