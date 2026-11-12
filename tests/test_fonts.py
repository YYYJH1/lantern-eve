"""The fonts of the web client have every character that the game can show.

``tools/fonts/build.py`` cuts LXGW WenKai and Ma Shan Zheng down to the characters of the game. A
later change to a text that needs a character the cut faces lack fails here, and the cure is to run
the cut again (the command is in ``tools/fonts/README.md``). The tests read only the faces on disk
and the record that the cut leaves, so no full font is needed.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from fonts import build, chars

REPO = Path(__file__).resolve().parents[1]
FOLDER = REPO / "web" / "public" / "fonts"
RECORD = json.loads(build.RECORD.read_text(encoding="utf-8"))["faces"]
FACES = {face.key: face for face in build.FACES}
CUT_AGAIN = "Run: uv run python tools/fonts/build.py --src tools/fonts/src"

# What the three faces may weigh, in bytes. The exact size of each cut is in subsets.json.
BUDGET = {
    "lxgw-wenkai-regular": 340_000,
    "lxgw-wenkai-medium": 340_000,
    "ma-shan-zheng": 100_000,
}


def path_of(key: str) -> Path:
    return FOLDER / FACES[key].folder / FACES[key].output


def test_the_record_names_every_face_and_where_it_came_from() -> None:
    assert set(RECORD) == set(FACES)
    for key, face in FACES.items():
        entry = RECORD[key]
        assert entry["source"]["sha256"] == face.source.sha256
        assert entry["licence"]["sha256"] == face.licence.sha256
        assert entry["output"] == f"web/public/fonts/{face.folder}/{face.output}"
        # Ma Shan Zheng is pinned to a commit of the Google Fonts repository, WenKai to a release.
        url = entry["source"]["url"]
        assert url.startswith("https://")
        assert "/6c1dbe27dcf7d817d4b62cec033ba77fa8e2a5ec/" in url or "/v1.530/" in url


@pytest.mark.parametrize("key", sorted(FACES))
def test_each_face_is_there_beside_its_licence(key: str) -> None:
    path = path_of(key)
    assert path.is_file(), f"{path} is missing. {CUT_AGAIN}"
    licence = (path.parent / "OFL.txt").read_text(encoding="utf-8")
    assert "SIL OPEN FONT LICENSE Version 1.1" in licence
    assert licence.startswith("Copyright")
    assert path.stat().st_size == RECORD[key]["bytes"]
    assert path.stat().st_size <= BUDGET[key]


@pytest.mark.parametrize("key", ["lxgw-wenkai-regular", "lxgw-wenkai-medium"])
def test_every_character_the_game_can_show_is_in_the_body_faces(key: str) -> None:
    wanted = chars.game_chars()
    lacking = wanted - build.cmap_of(path_of(key)) - set(RECORD[key]["unavailable"])
    assert not lacking, (
        f"{len(lacking)} characters of the game are not in {path_of(key).name}: "
        f"{''.join(sorted(lacking))!r}. {CUT_AGAIN}"
    )


def test_every_character_of_a_title_is_in_the_title_face() -> None:
    wanted = chars.title_chars()
    have = build.cmap_of(path_of("ma-shan-zheng")) | set(RECORD["ma-shan-zheng"]["unavailable"])
    lacking = wanted - have
    assert not lacking, (
        f"{len(lacking)} characters of the titles are not in the title face: "
        f"{''.join(sorted(lacking))!r}. {CUT_AGAIN}"
    )


@pytest.mark.parametrize("key", sorted(FACES))
def test_the_characters_a_source_font_lacks_are_few_and_not_words(key: str) -> None:
    # A character that the full face lacks is drawn by the next face of the stack. The ones in the
    # record are symbols of the page (a triangle on a button), and never a Chinese character.
    for c in RECORD[key]["unavailable"]:
        assert not "一" <= c <= "鿿", f"{c!r} is a Chinese character that {key} lacks"
    assert len(RECORD[key]["unavailable"]) <= 6


def test_the_two_body_faces_have_the_same_characters() -> None:
    regular = build.cmap_of(path_of("lxgw-wenkai-regular"))
    medium = build.cmap_of(path_of("lxgw-wenkai-medium"))
    assert regular == medium


def test_the_title_face_covers_the_names_of_the_tasks_and_of_the_people() -> None:
    have = build.cmap_of(path_of("ma-shan-zheng"))
    for word in (
        "灯会前夕",
        "镇报",
        "修桥",
        "说清",
        "说和",
        "桥修好了",
        "第三天早上开工",
        "李老太",
    ):
        assert set(word) <= have, word
    # The words are found in the sources, not in a list written here that could drift from them.
    words = chars.title_text()
    assert "灯会前夕" in words
    assert "第三天早上开工" in words
    # What the slip says while there is no task to follow stands in the same face.
    for lang in ("zh", "en"):
        for key in ("top.task.pick", "top.task.idle", "top.task.over"):
            assert chars.messages(lang)[key] in words, (lang, key)


def test_the_collector_reads_comments_and_code_apart() -> None:
    source = (
        "// 注释里的字\n"
        'const a = "字符串"; /* 块注释 */ const re = /["\']+字/u; const u = "http://x.test";\n'
        "const t = `模板${x ? '条件' : \"另\"}末`; // 尾注\n"
        "const jsx = <b>标签字</b>; const closing = 1 / 2; // 除\n"
    )
    text = chars.script_text(source)
    for shown in "字符串模板条件另末标签":
        assert shown in text
    for hidden in "注释里的块尾除":
        assert hidden not in text
    assert "http://x.test" in text
    assert chars.style_text("a { content: '✓'; } /* 注 */") == "a { content: '✓'; } "
    python = '"""文档"""\nx = "正文"\ndef f():\n    "说明"\n    return "返回"\n'
    assert list(chars.python_strings(python)) == ["正文", "返回"]
