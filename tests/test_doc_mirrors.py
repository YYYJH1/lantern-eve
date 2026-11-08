"""The Chinese documents mirror the English ones.

Every document that readers see exists twice, as ``X.md`` in English and ``X_zh.md`` in Chinese,
and the English one is the source. A program can check three things about the pair: the language
switch on the first line, the headings, and the code blocks. Headings and code blocks are found
the way Markdown reads them, so a line that starts with ``#`` inside a code block is a comment of
the code and not a heading.
"""

import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]


GENERATED = {"node_modules", "dist", "dist-e2e", "test-results", "playwright-report"}


def in_the_checkout(path: Path) -> bool:
    parts = path.relative_to(REPO).parts
    return not any(part in GENERATED or part.startswith(".") for part in parts)


def documents() -> list[tuple[str, str]]:
    """(English file, Chinese file) for every Markdown document of the repository.

    A document is found by its name: ``X.md`` has the twin ``X_zh.md``. Nothing is listed by hand,
    so a new document is checked as soon as it exists."""
    found: list[tuple[str, str]] = []
    for path in sorted(REPO.glob("**/*.md")):
        if in_the_checkout(path) and not path.stem.endswith("_zh"):
            twin = path.with_name(f"{path.stem}_zh.md")
            found.append((path.relative_to(REPO).as_posix(), twin.relative_to(REPO).as_posix()))
    return found


PAIRS = documents()
IDS = [english for english, _ in PAIRS]

# The two versions of a pair sit in the same folder, so the link is the bare file name.
SWITCH_ENGLISH = '<p align="center"><b>English</b> · <a href="{other}">简体中文</a></p>'
SWITCH_CHINESE = '<p align="center"><a href="{other}">English</a> · <b>简体中文</b></p>'

FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
HEADING = re.compile(r"^(#{1,6})[ \t]")


def read(name: str) -> str:
    return (REPO / name).read_text(encoding="utf-8")


def outline(name: str) -> tuple[list[int], int]:
    """The level of every heading in order, and the number of fenced code blocks."""
    levels: list[int] = []
    blocks = 0
    fence = None
    for line in read(name).splitlines():
        marker = FENCE.match(line)
        if fence is None:
            if marker:
                fence = marker.group(1)
                blocks += 1
                continue
            heading = HEADING.match(line)
            if heading:
                levels.append(len(heading.group(1)))
        elif (
            marker
            and marker.group(1)[0] == fence[0]
            and len(marker.group(1)) >= len(fence)
            and line.strip() == marker.group(1)
        ):
            fence = None
    assert fence is None, f"{name} ends inside a code block"
    return levels, blocks


@pytest.mark.parametrize(("english", "chinese"), PAIRS, ids=IDS)
def test_both_versions_exist(english: str, chinese: str) -> None:
    assert (REPO / english).is_file(), f"{english} is missing"
    assert (REPO / chinese).is_file(), f"{chinese} is missing"


@pytest.mark.parametrize(("english", "chinese"), PAIRS, ids=IDS)
def test_the_first_line_of_each_version_is_the_language_switch(english: str, chinese: str) -> None:
    first_english = read(english).split("\n", 1)[0]
    first_chinese = read(chinese).split("\n", 1)[0]
    assert first_english == SWITCH_ENGLISH.format(other=Path(chinese).name), (
        f"the first line of {english} is not its language switch"
    )
    assert first_chinese == SWITCH_CHINESE.format(other=Path(english).name), (
        f"the first line of {chinese} is not its language switch"
    )


@pytest.mark.parametrize(("english", "chinese"), PAIRS, ids=IDS)
def test_the_headings_have_the_same_levels_in_the_same_order(english: str, chinese: str) -> None:
    levels_english, _ = outline(english)
    levels_chinese, _ = outline(chinese)
    assert len(levels_chinese) == len(levels_english), (
        f"{english} has {len(levels_english)} headings and {chinese} has {len(levels_chinese)}"
    )
    for number, (a, b) in enumerate(zip(levels_english, levels_chinese, strict=True), start=1):
        assert a == b, f"heading {number} has level {a} in {english} and level {b} in {chinese}"


@pytest.mark.parametrize(("english", "chinese"), PAIRS, ids=IDS)
def test_the_two_versions_have_the_same_number_of_code_blocks(english: str, chinese: str) -> None:
    _, blocks_english = outline(english)
    _, blocks_chinese = outline(chinese)
    assert blocks_chinese == blocks_english, (
        f"{english} has {blocks_english} code blocks and {chinese} has {blocks_chinese}"
    )


def test_every_chinese_document_has_an_english_original() -> None:
    english = {name for name, _ in PAIRS}
    for chinese in REPO.glob("**/*_zh.md"):
        if in_the_checkout(chinese):
            original = chinese.with_name(chinese.name.removesuffix("_zh.md") + ".md")
            name = original.relative_to(REPO).as_posix()
            assert name in english, f"{chinese.relative_to(REPO)} has no English original"
