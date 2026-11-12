"""The words of the game keep to a few rules that no single place can hold: one name for one thing,
nobody called sir, Chinese quoted in corner brackets, and comments in the content that say what the
data is and point to nothing outside the repository.

The English and the Chinese of the game are read from the sources: the YAML of ``content/`` and the
tables of the page (``web/src/i18n``).
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]
CONTENT = ROOT / "content"
I18N = ROOT / "web" / "src" / "i18n"
# the words a player reads. The tables of the speech checker (``tables/speech.yaml``) list the
# other names a model may use for a person or a place, so they are not what the game says.
SPOKEN = ("lines", "scripts", "cast", "tables/sentences.yaml", "entities.yaml", "maps")


def sources() -> Iterator[Path]:
    for part in SPOKEN:
        path = CONTENT / part
        yield from sorted(path.rglob("*.yaml")) if path.is_dir() else [path]


def strings(node: Any, key: str | None = None) -> Iterator[tuple[str | None, str]]:
    """Every string of a YAML document with the key it stands under (the key of a list's owner).

    The notes of a voice are left out: they tell a model how a person speaks, and no player reads
    them."""
    if isinstance(node, dict):
        for k, v in node.items():
            if k != "voice":
                yield from strings(v, k)
    elif isinstance(node, list):
        for v in node:
            yield from strings(v, key)
    elif isinstance(node, str):
        yield key, node


def texts(lang: str) -> list[tuple[str, str]]:
    """``(where, text)`` for every English (``en``) or Chinese (``zh``) text of the content."""
    keys = {"en": ("en", "label_en"), "zh": ("zh", "label")}[lang]
    found = []
    for path in sources():
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        found += [(str(path.relative_to(ROOT)), text) for key, text in strings(doc) if key in keys]
    table = (I18N / f"{lang}.ts").read_text(encoding="utf-8")
    where = f"web/src/i18n/{lang}.ts"
    found += [(where, m.group(1)) for m in re.finditer(r'": "(.*)",$', table, re.M)]
    return found


EN, ZH = texts("en"), texts("zh")


def found(pattern: str, pool: list[tuple[str, str]]) -> list[str]:
    rule = re.compile(pattern)
    return [f"{where}: {text[:90]}" for where, text in pool if rule.search(text)]


@pytest.mark.parametrize(
    "pattern",
    [
        r"(?i)\bsir\b",
        r"(?i)\bma'am\b",
        r"(?i)\bmadam\b(?! Zhou)",  # a title before a name is not the manager's
    ],
)
def test_nobody_calls_the_manager_sir_or_madam(pattern: str) -> None:
    assert found(pattern, EN) == []


@pytest.mark.parametrize(
    "pattern",
    [
        r"Xiao Man",  # the child is Xiaoman
        r"Old He",  # the boatman is Boatman He in English
        r"[Tt]eahouse [Mm]adam",  # the teahouse keeper
        r"wine shop",  # the tavern
        r"Village School",  # the school
        r"\bHonor\b",  # British spelling
        r"stalk",  # bamboo and timber are counted in poles
        r"lengths of",
        r"procession|parade of lanterns",  # the lantern parade
        r"Mark my words",  # 我跟你说 is "I'm telling you"
        r"Where the talk came from",  # the third part of the card is Why people got it wrong
        r"How the rumour began|\bCourse\b",  # the names of the parts are the card's
        r"[Ww]ith more drama|made (it )?heavier|grew heavier",  # a story is exaggerated
        r"first bamboo",  # the first load of bamboo
        r"carry (the|that) claim",  # a line that does not hold a claim up does not prove it
        r"how (they|the two|two lines) stand",  # two lines relate
        r"along the telling",  # the talk is traced back one person at a time
        r"\b[Rr]ails?\b",  # the bridge has a railing
    ],
)
def test_one_name_for_one_thing_in_english(pattern: str) -> None:
    assert found(pattern, EN) == []


def test_the_chinese_is_quoted_in_corner_brackets() -> None:
    assert found(r"[“”‘’]", ZH) == []


def test_the_chinese_has_no_single_ellipsis() -> None:
    assert found(r"(?<!…)…(?!…)", ZH) == []


def test_the_comments_of_the_content_say_what_the_data_is() -> None:
    outside = re.compile(
        r"(?i)\bdesign (document|section)|\bsection \d+(\.\d+)*|\bpackages? (that|which)"
    )
    hits = []
    for path in sorted(CONTENT.rglob("*.yaml")):
        for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if line.lstrip().startswith("#") and outside.search(line):
                hits.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()[:90]}")
    assert hits == []


# The Chinese a player reads in the interface and in the cards, the gazette and the statement of
# the script: one word for the rumour (闲话), for the statement card (讲稿) and for the people who
# must be there (熟面孔), and no word of the game's machinery. The people speak as they do (the
# elder and the schoolmaster say 谣言), and the script's own labels of metrics and flags are not
# read by a player.
PLAYER_SECTIONS = ("tasks", "paper", "statement", "evidence", "endings", "commitments", "gifts")


def player_chinese() -> list[tuple[str, str]]:
    script = yaml.safe_load(
        (CONTENT / "scripts" / "broken_bridge.yaml").read_text(encoding="utf-8")
    )
    found = [
        (f"broken_bridge.yaml {section}", text)
        for section in PLAYER_SECTIONS
        for key, text in strings(script.get(section))
        if key in ("zh", "label")
    ]
    return found + [(where, text) for where, text in ZH if where.endswith("zh.ts")]


@pytest.mark.parametrize(
    "pattern",
    [r"陈述", r"谣言", r"传言", r"叫得出名字", r"有名有姓", r"判过", r"嫉妒", r"李周两家"],
)
def test_one_name_for_one_thing_in_the_chinese_a_player_reads(pattern: str) -> None:
    assert [
        f"{where}: {text[:60]}" for where, text in player_chinese() if re.search(pattern, text)
    ] == []


@pytest.mark.parametrize("pattern", [r"账房先生", r"陈述卡"])
def test_the_accountant_and_the_statement_card_have_one_name_everywhere(pattern: str) -> None:
    assert found(pattern, ZH) == []


def test_the_parts_of_the_statement_card_have_one_name_in_each_language():
    """The page names a part of the statement card by its blank (``blank.<part>``), and the core by
    the title the script gives it, in the reason a statement fell short. A result card shows both,
    one line under the other, so they are the same words."""
    script = yaml.safe_load(
        (CONTENT / "scripts" / "broken_bridge.yaml").read_text(encoding="utf-8")
    )
    differ = []
    for lang in ("en", "zh"):
        table = (I18N / f"{lang}.ts").read_text(encoding="utf-8")
        for part in script["statement"]["parts"]:
            blank = re.search(rf'"blank\.{part["id"]}": "(.*)",$', table, re.M)
            if blank is None or blank.group(1) != part["title"][lang]:
                differ.append(f"{lang} {part['id']}: {part['title'][lang]!r}")
    assert differ == []
