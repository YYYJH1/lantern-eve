"""Helpers for the tests of what the townsfolk say, each person in a voice of their own."""

from __future__ import annotations

from typing import Any

from bridge_helpers import state_of

from lantern_core.cognition.lines import frame_key
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import notebook, phrases, voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

VOICED = tuple(sorted(VOICES))  # the people who have a voice: the whole cast


def bubble(out: dict[str, Any], npc: str) -> dict[str, str]:
    """The words over the head of ``npc`` in the frame of ``out``: there is one bubble at most."""
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == npc]
    return said["text"]


def says(out: dict[str, Any], person: str, code: str) -> None:
    """The words over ``person``'s head are one of the ways they say the fixed line ``code``."""
    text = bubble(out, person)
    assert text in voices.variants(person, code), (person, code, text)


def says_pointing(out: dict[str, Any], person: str, code: str, who: str) -> None:
    """The words over ``person``'s head are one of the ways they say the pointing line ``code``,
    naming ``who``."""
    text = bubble(out, person)
    options = [phrases.named(v, voices.called(person, who)) for v in voices.variants(person, code)]
    assert text in options, (person, code, who, text)


def claim_wordings(
    prop: Prop, modality: str, source: str, speaker: str, pick: int = 0, lead: str = ""
) -> list[dict[str, str]]:
    """Every way ``speaker`` can word a claim of ``prop``: one for each variant of their frame,
    and with a ``lead`` (a fixed line that opens the answer), each of the ways they say that. The
    people in it are named as ``speaker`` names them."""
    lo = lore()
    voice = VOICES[speaker]
    key = frame_key(modality, source, speaker, lo.lines.is_known(prop))
    out = []
    for variant in voice["frames"][key]:
        said = lo.lines.say(
            prop,
            voices.names_for(speaker),
            modality=modality,
            claimed_source=source,
            speaker=speaker,
            pick=pick,
            frame=variant,
            hedges=voice["hedges"],
        )
        if lead:
            out += [phrases.joined(opener, said) for opener in voices.variants(speaker, lead)]
        else:
            out.append(said)
    return out


def claimed(
    out: dict[str, Any],
    game: Any,
    person: str,
    prop_id: str,
    source: str,
    lead: str = "",
    modality: str = "assert",
) -> None:
    """The words over ``person``'s head word the claim of ``prop_id`` that names ``source``, in
    one of the ways the person has (and, with a ``lead``, after one of their ways of opening)."""
    prop = notebook.view(state_of(game)["social"])[prop_id]
    text = bubble(out, person)
    options = claim_wordings(prop, modality, source, person, lead=lead)
    assert text in options, (person, prop_id, source, text)
