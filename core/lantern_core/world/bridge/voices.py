"""The voices of the townsfolk: each person says the fixed words of the town in their own way.

``phrases`` has one text for each fixed line of the town (a person who will not talk, one who
knows nothing, the word that ends a talk) and ``content/tables/sentences.yaml`` one wording for
each frame that wraps what a person tells ("I saw it myself", "so-and-so told me that", a guess).
Those are the plain voice, and what anyone says who has no voice of their own. ``voice_data``
(generated from ``content/lines``) gives each person of the cast at least two variants of every
one of them, in both languages, and the words they hedge a guess in.

Which variant is a function of three integers: the person, the kind of line and a tick. The tick
is the one the state already holds for the line. For a fixed line it is the tick the line is kept
on show until (``converse.say``): outside a conversation that is the tick it was said plus
``LINE_TICKS``, and in one it is the tick the conversation ends, so a person says a kind of line
the same way all through a conversation. For what a person tells it is the tick of the claim. The
three are mixed with integer arithmetic and nothing else. The RNG is not drawn from and nothing is
kept, so the state does not know the voices are there and holds the same line whatever they say:
the words are made in the frame, from the line, as ever. A bubble does not change its words while
it is on show, because none of the three changes.

An unknown code is a mistake in the caller, as in ``phrases``.
"""

from __future__ import annotations

import functools
from typing import Any

from lantern_core.cognition.lines import frame_key
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import phrases
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

MASK = 0xFFFFFFFF
FNV_OFFSET, FNV_PRIME = 0x811C9DC5, 0x01000193
LINE, FRAME = "line:", "frame:"  # the two kinds of kind, so that a code and a frame never meet


def _fnv(text: str) -> int:
    """The 32-bit FNV-1a hash of the UTF-8 bytes of ``text``."""
    h = FNV_OFFSET
    for byte in text.encode("utf-8"):
        h = ((h ^ byte) * FNV_PRIME) & MASK
    return h


def mix(person: str, kind: str, tick: int) -> int:
    """A number from 0 to 2**32 - 1 made from the three, in which none of them can be seen."""
    h = ((_fnv(person) ^ _fnv(kind)) * 0x9E3779B1) & MASK
    h = ((h ^ (tick & MASK)) * 0x85EBCA6B) & MASK
    h ^= h >> 13
    h = (h * 0xC2B2AE35) & MASK
    return h ^ (h >> 16)


def choose(person: str, kind: str, tick: int, count: int) -> int:
    """Which of ``count`` variants ``person`` uses for ``kind`` at ``tick``: 0 to ``count - 1``."""
    return mix(person, kind, tick) % count


def has_voice(person: str) -> bool:
    """Whether ``person`` has a voice of their own, as every person of the cast does."""
    return person in VOICES


def variants(person: str, code: str) -> list[dict[str, str]]:
    """Every way ``person`` says the fixed line ``code``: their variants, or the plain words."""
    plain = phrases.phrase(code)
    voice = VOICES.get(person)
    said = None if voice is None else voice["lines"].get(code)
    return [dict(v) for v in said] if said else [plain]


def phrase(person: str, code: str, at: int) -> dict[str, str]:
    """The two texts of the fixed line ``code`` as ``person`` says it, for a line kept until
    the tick ``at``."""
    options = variants(person, code)
    return options[choose(person, LINE + code, at, len(options))]


def frame(person: str, key: str, at: int) -> dict[str, str] | None:
    """The wording of the frame ``key`` that ``person`` uses for a claim made at the tick ``at``,
    or None where they have none of their own."""
    voice = VOICES.get(person)
    said = None if voice is None else voice["frames"].get(key)
    if not said:
        return None
    return dict(said[choose(person, FRAME + key, at, len(said))])


def hedges(person: str) -> dict[str, list[str]] | None:
    """The words ``person`` hedges a guess in, in each language, or None."""
    voice: Any = VOICES.get(person)
    return None if voice is None else voice["hedges"]


@functools.lru_cache(maxsize=4096)
def rival_words(prop: Prop, teller: str, speaker: str, said_at: int) -> dict[str, str]:
    """What ``speaker`` adds, after the belief they hold, of the account ``prop`` that ``teller``
    told them and they did not take in, in their own voice. ``said_at`` is the tick of the claim.
    The words are a function of these four things alone, and the result is shared by every caller
    of the cache: do not change it."""
    lo = lore()
    return lo.lines.rival(
        prop, lo.names, teller=teller, speaker=speaker, frame=frame(speaker, "rival", said_at)
    )


@functools.lru_cache(maxsize=4096)
def claim_words(
    prop: Prop, modality: str, claimed_source: str, speaker: str, pick: int, said_at: int
) -> dict[str, str]:
    """What ``speaker`` says in saying ``prop`` in ``modality``, naming ``claimed_source``, in
    their own voice. ``pick`` is the number of the claim (it chooses the hedge) and ``said_at``
    the tick it was made. The words are a function of these six things alone, and the result is
    shared by every caller of the cache: do not change it."""
    lo = lore()
    return lo.lines.say(
        prop,
        lo.names,
        modality=modality,
        claimed_source=claimed_source,
        speaker=speaker,
        pick=pick,
        frame=frame(speaker, frame_key(modality, claimed_source, speaker), said_at),
        hedges=hedges(speaker),
    )
