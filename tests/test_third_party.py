"""THIRD_PARTY.md and its Chinese twin list what the built site carries, at its locked versions.

The packages are the ones web/package-lock.json lists as dependencies of the page and not as
development tools, and pyodide, whose runtime files are copied into the site. Each stands in a
table row of both documents, named in backticks in the first cell, with its locked version in the
second.
"""

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[1]
DOCUMENTS = ["THIRD_PARTY.md", "THIRD_PARTY_zh.md"]
BACKTICKED = re.compile(r"`([^`]+)`")


def locked() -> dict[str, str]:
    """name -> version of the packages the site is built from."""
    lock = json.loads((REPO / "web" / "package-lock.json").read_text(encoding="utf-8"))
    found: dict[str, str] = {}
    for path, info in lock["packages"].items():
        if "node_modules/" not in path or info.get("optional"):
            continue
        name = path.rsplit("node_modules/", 1)[1]
        if info.get("dev") and name != "pyodide":
            continue
        found[name] = info["version"]
    return found


def listed(document: str) -> dict[str, str]:
    """name -> version of the packages named in backticks in the first cell of a table row."""
    found: dict[str, str] = {}
    for line in (REPO / document).read_text(encoding="utf-8").splitlines():
        if not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        named = BACKTICKED.search(cells[0])
        if named and len(cells) >= 2:
            assert named.group(1) not in found, f"{document} lists {named.group(1)} twice"
            found[named.group(1)] = cells[1]
    return found


def test_the_lock_names_the_packages_of_the_site() -> None:
    packages = locked()
    assert {"pixi.js", "preact", "pyodide"} <= packages.keys()
    assert "typescript" not in packages and "vite" not in packages


@pytest.mark.parametrize("document", DOCUMENTS)
def test_every_package_of_the_site_is_listed_at_its_locked_version(document: str) -> None:
    assert listed(document) == locked()


def test_the_two_documents_name_the_same_components() -> None:
    def table_rows(document: str) -> list[tuple[str, ...]]:
        """The body rows of the tables: every row that is not a header and not a separator."""

        def is_separator(line: str) -> bool:
            return line.startswith("|") and set(line) <= set("|-: ")

        lines = (REPO / document).read_text(encoding="utf-8").splitlines()
        rows = []
        for number, line in enumerate(lines):
            if not line.startswith("|") or is_separator(line):
                continue
            if number + 1 < len(lines) and is_separator(lines[number + 1]):
                continue  # the header row, which stands above the separator
            rows.append(tuple(cell.strip() for cell in line.strip().strip("|").split("|")))
        return rows

    english, chinese = table_rows(DOCUMENTS[0]), table_rows(DOCUMENTS[1])
    assert len(english) == len(chinese) >= 17
    for row_en, row_zh in zip(english, chinese, strict=True):
        assert len(row_en) == len(row_zh) == 5
        # the licence and the source are the same in both languages, and so is the version itself
        assert (row_en[2], row_en[4]) == (row_zh[2], row_zh[4]), row_en[0]
        assert row_en[1].split()[-1] == row_zh[1].split()[-1], row_en[0]
