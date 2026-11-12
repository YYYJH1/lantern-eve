"""Helpers for the tests of the names a person uses for others (``call`` in ``content/lines``).

The real tables are written by the content, and a test must not depend on what they say. These
helpers put a table of the test's own into the voices of the people for the length of a test and
take it out again, and clear what the voices remember of the words they made.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from lantern_core.world.bridge import voices
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.voice_data import VOICES

# What the people of the tests call each other: a small table in the manner of the content. Two
# words mean different people in different mouths: "老二" is the second Li son to his mother and
# the second Zhou son to his brother, and the lantern maker's 二郎 is the second Li son, though the
# town's own alias for 二郎 (content/tables/speech.yaml) is the second Zhou son.
GRANNY = "li_laotai"
BROTHER = "zhou_dalang"
MAKER = "zhadeng_shifu"
CLERK = "zhou_huoji"
SHOPKEEPER = "zhou_zhanggui"
TABLES: dict[str, dict[str, dict[str, str]]] = {
    GRANNY: {
        "li_da": {"zh": "老大", "en": "Da"},
        "li_er": {"zh": "老二", "en": "Er"},
        "li_xiaomei": {"zh": "小妹", "en": "little Mei"},
        "zhou_zhanggui": {"zh": "周家那个掌柜", "en": "that Zhou shopkeeper"},
        "zhou_niangzi": {"zh": "周家的", "en": "the Zhou wife"},
    },
    BROTHER: {
        "zhou_erlang": {"zh": "老二", "en": "my brother"},
        "zhou_huoji": {"zh": "伙计", "en": "the clerk"},
        "li_er": {"zh": "李家老二", "en": "the Li boy"},
    },
    MAKER: {
        "li_er": {"zh": "二郎", "en": "Erlang"},
        "li_xiaomei": {"zh": "小妹", "en": "Mei"},
    },
    CLERK: {
        "zhou_zhanggui": {"zh": "掌柜的", "en": "the master"},
        "zhou_dalang": {"zh": "大少爷", "en": "young master"},
        "zhou_erlang": {"zh": "二少爷", "en": "second young master"},
    },
    SHOPKEEPER: {
        "zhou_niangzi": {"zh": "我家那口子", "en": "my wife"},
        "zhou_dalang": {"zh": "大郎", "en": "Dalang"},
    },
}
NOTHING = object()


class Calls:
    """Tables put into the voices, and the way back."""

    def __init__(self) -> None:
        self.saved: dict[str, Any] = {}

    def install(self, person: str, table: Mapping[str, Mapping[str, str]]) -> None:
        """Give ``person`` the table, in place of the one they had."""
        voice = VOICES[person]
        self.saved.setdefault(person, voice.get("call", NOTHING))
        voice["call"] = {other: dict(pair) for other, pair in table.items()}
        forget()

    def only(self, tables: Mapping[str, Mapping[str, Mapping[str, str]]]) -> None:
        """Give the people of ``tables`` their table, and everyone else of the cast none, whatever
        the content gives them, so that a test depends on its own tables alone."""
        for person in lore().people:
            self.install(person, tables.get(person, {}))

    def tables(self) -> None:
        """Give every person of ``TABLES`` their table, and everyone else none."""
        self.only(TABLES)

    def everyone(self) -> None:
        """Give every person of the cast a table that names every other by a marker of its own:
        ``〔speaker>other〕`` in Chinese and ``<speaker>other`` in English."""
        people = lore().people
        for speaker in people:
            self.install(
                speaker,
                {
                    other: {"zh": f"〔{speaker}>{other}〕", "en": f"<{speaker}>{other}"}
                    for other in people
                    if other != speaker
                },
            )

    def restore(self) -> None:
        for person, call in self.saved.items():
            if call is NOTHING:
                VOICES[person].pop("call", None)
            else:
                VOICES[person]["call"] = call
        self.saved.clear()
        forget()


def forget() -> None:
    """Clear what the voices remember of the words they have made."""
    voices.claim_words.cache_clear()
    voices.rival_words.cache_clear()
