"""Pinned hashes of scripted games, and what the gate and the requests for words must keep.

Three games are pinned:

- the bridge world after 1,200 ticks with nobody talking, for the seeds 1, 7 and 2015
  (``BRIDGE_HASHES``), with the hash of the content they were made from (``CONTENT_HASH``);
- the scripted game of ``tests/cross_host/bridge_driver.py`` over its first day: the hash after its
  last call (``DRIVER_LAST_HASH``), the digest of every output it sent (``DRIVER_OUTPUTS``) and the
  number of its calls (``DRIVER_CALLS``);
- the scripted game of ``m0_driver`` (``M0_LAST_HASH`` and ``M0_OUTPUTS``).

A change to a text of ``content/``, or to anything the core sends, moves some of these values. Words
move the content hash, the last hash and the outputs of the scripted game, and the hashes of the
games without a manager only through the content hash they carry. When the change is the one that
was meant, run the file as a script from the root of the repository and paste the lines it prints
over the constants below:

    PYTHONPATH=tests/cross_host:tests/core uv run python tests/core/test_bridge_speech_hashes.py

The other tests of the file hold what must stay as it is whatever the content says: a game in which
nobody talks asks no model, and the gate gives the same answers under any string hash seed and
under Pyodide.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import bridge_driver
import m0_driver
import pytest
import speech_driver
from bridge_helpers import state_of
from pyodide_runner import ROOT, build_wheel, needs_pyodide, run_pyodide
from speech_helpers import new_game

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.world.bridge import order, reflection, speech
from lantern_core.world.bridge import world as bridge_world
from lantern_core.world.bridge.lore import lore

TESTS = Path(__file__).resolve().parents[1]

# The state hashes of scripted games, pinned. The content hash is that of the town, the cast, the
# script and the clock, and also of the prompts and the words they quote.
BRIDGE_HASHES = {
    1: "906bb9719c9db6d68585f1f19694af359a2308e175ec3cab7f604e11e43b2e10",
    7: "86de32a6bd2f6e194b438d6a2fae9af6a99ca4ec8444aba1e52fd310d7aaee1c",
    2015: "8c8c7379d7971a0b7926f851fbb658bf089fcbc91365a2c771a2bca7e4bf91f9",
}
CONTENT_HASH = "a41bf790d92d276239dfede7e7c5f5adf679ca1d5f4851477615c3e028f5f0d8"
DRIVER_LAST_HASH = "3ab27fb752a656b2fe408812b7e7d6be1e83f82fb492cd9f42c6a976b15f052b"
DRIVER_OUTPUTS = "4dd8230fa60998e90d1d08af9dc5a2d0f9ac1cb2e36d3df16b75061f29b99cc5"
DRIVER_CALLS = 2071  # 2,070 ticks, and the one call in which the world stood still (a talk opens)
M0_LAST_HASH = "79b0a8997a3fbc5b560fe73e2981665415f06615d2d5b456b4e7fe3b0a73cf0d"
M0_OUTPUTS = "70853215b3f57b0a82b4cb9976d16a607be3160150b27fa48e804f0c6f27e610"


def current_pins() -> str:
    """The constants above for the tree as it is, as the lines to paste over them."""
    hashes, content = {}, ""
    for seed in sorted(BRIDGE_HASHES):
        game = Game(seed, "bridge")
        for _ in range(1200):
            game.step()
        hashes[seed] = game.hash()
        content = json.loads(game.snapshot_json())["content_hash"]
    run = bridge_driver.run(seed=2015, ticks=2070)
    rows = ["BRIDGE_HASHES = {"]
    rows += [f'    {seed}: "{hashes[seed]}",' for seed in sorted(hashes)]
    rows += ["}", f'CONTENT_HASH = "{content}"']
    rows += [
        f'DRIVER_LAST_HASH = "{run["hashes"][-1]}"',
        f'DRIVER_OUTPUTS = "{run["outputs_digest"]}"',
    ]
    rows += [f"DRIVER_CALLS = {len(run['hashes'])}"]
    return "\n".join(rows)


@pytest.mark.parametrize("seed", sorted(BRIDGE_HASHES))
def test_a_bridge_game_that_asks_for_no_reply_has_the_hash_it_has(seed):
    game = Game(seed, "bridge")
    for _ in range(1200):
        game.step()
    assert game.hash() == BRIDGE_HASHES[seed]
    assert json.loads(game.snapshot_json())["content_hash"] == CONTENT_HASH


def test_the_scripted_bridge_game_has_the_hashes_and_the_outputs_it_has():
    run = bridge_driver.run(seed=2015, ticks=2070)
    assert run["hashes"][-1] == DRIVER_LAST_HASH and len(run["hashes"]) == DRIVER_CALLS
    assert run["outputs_digest"] == DRIVER_OUTPUTS
    assert run["summary"]["events"]["reflected"] == 20  # the twenty, once, at eleven


def notes_of(task: dict):
    """Every sentence of the notes of a task, in both languages: why, next, what blocks it, and the
    last words of a promise."""
    for option in [*task["why"], *task["next"]]:
        yield task["id"], option["zh"], option["en"]
    for rule in task["blocked"]:
        yield task["id"], rule["blocker"]["zh"], rule["blocker"]["en"]
        for option in [*rule["why"], *rule["next"]]:
            yield task["id"], option["zh"], option["en"]
    if "lapse" in task:
        yield task["id"], task["lapse"]["zh"], task["lapse"]["en"]


def test_the_notes_of_the_tasks_are_sentences_with_no_dots_between_words_and_no_arrows():
    """A note is a sentence that ends in a full stop (a question may end in a question mark), and
    nothing is joined by a middle dot or an arrow. What blocks a task is a short phrase, which has
    no stop. The words of a promise that was not kept are two sentences at most."""
    script = bridge_world.BridgeWorld().content()["cognition"]["script"]
    for task in script["tasks"]:
        blockers = {rule["blocker"]["zh"] for rule in task["blocked"]}
        blockers |= {rule["blocker"]["en"] for rule in task["blocked"]}
        for task_id, zh, en in notes_of(task):
            for words in (zh, en):
                assert "·" not in words and "→" not in words and "—" not in words, (task_id, words)
            if zh in blockers or en in blockers:
                assert not zh.endswith(("。", "？")) and not en.endswith((".", "?")), (task_id, zh)
            else:
                assert zh.endswith(("。", "？")), (task_id, zh)
                assert en.endswith((".", "?", ".”")), (task_id, en)


def without_the_night(state: dict) -> dict:
    """``state`` without the section ``reflection`` and without the key ``reflect`` of the config.
    The content hash is left as it is. A copy that shares what it does not change."""
    world = {k: v for k, v in state["world"].items() if k != reflection.SECTION}
    config = {k: v for k, v in state["config"].items() if k != "reflect"}
    return {**state, "world": world, "config": config}


def test_a_game_with_the_thinking_over_off_is_the_game_the_pass_leaves_out(monkeypatch):
    """The config ``reflect`` set to 0 is leaving the pass out: a night is only sleep, and the
    scripted game has the hashes and the outputs it has with the pass patched away, once the key
    and the section of the night are taken out of what is hashed."""
    real = canon.digest

    def then(value):
        return real(without_the_night(value) if "content_hash" in value else value)

    with monkeypatch.context() as patch:
        patch.setattr(canon, "digest", then)
        patch.setattr(reflection, "tick", lambda sim: None)
        left_out = bridge_driver.run(seed=2015, ticks=2070)
    with monkeypatch.context() as patch:
        patch.setattr(canon, "digest", then)
        patch.setattr(bridge_driver, "CONFIG", {**bridge_driver.CONFIG, "reflect": 0})
        off = bridge_driver.run(seed=2015, ticks=2070)
    assert off["hashes"] == left_out["hashes"]
    assert off["outputs_digest"] == left_out["outputs_digest"]
    assert off["summary"]["events"].get("reflected", 0) == 0


def held_first_frame(seed: int) -> tuple[int, int]:
    """The grudge the board has in the first frame of a game that is held before its first tick
    (the page holds the world behind the tutorial), and in the frame of the first tick."""
    game = Game(seed, "bridge")
    held = json.loads(game.step(json.dumps([{"seq": 0, "kind": "pause", "body": {}}])))
    assert held["advanced"] is False and game.tick == 0
    ran = json.loads(game.step(json.dumps([{"seq": 1, "kind": "resume", "body": {}}])))
    assert ran["advanced"] is True and ran["tick"] == 0
    return held["frame"]["board"]["peace"]["grudge"], ran["frame"]["board"]["peace"]["grudge"]


@pytest.mark.parametrize("seed", sorted(BRIDGE_HASHES))
def test_a_game_that_is_held_before_its_first_tick_shows_the_grudge_the_first_tick_sets(seed):
    """The board of the page behind the tutorial reads the grudge between the heads of the two
    families from the first frame on, and not a 0 that it would take for a peace of 100%."""
    first, ran = held_first_frame(seed)
    assert first == ran and 0 < first < 100


def test_the_scripted_m0_game_has_the_hash_and_the_outputs_it_has():
    run = m0_driver.run(ticks=600)
    assert run["hashes"][-1] == M0_LAST_HASH and run["outputs_digest"] == M0_OUTPUTS


def test_a_game_with_no_talk_asks_nothing_and_has_the_section_from_the_start():
    game = Game(2015, "bridge")
    assert speech.SECTION in order.SECTIONS and state_of(game)[speech.SECTION] == speech.fresh()
    for _ in range(600):
        out = json.loads(game.step())
        assert out["requests"] == [] and out["cancels"] == []
    assert game.in_flight() == []


def test_the_scripted_game_asks_a_model_only_for_what_a_person_answers_in_a_talk():
    driver = bridge_driver.Driver(2015)
    asked = answered = 0
    while driver.game.tick < 2070:
        _, out = driver.call()
        asked += len(out["requests"])
        answered += sum(1 for event in out["events"] if event["kind"] == "replied")
        assert {r["category"] for r in out["requests"]} <= {"reply"}
    assert asked == answered > 10  # one request for each answer, and no other
    assert set(state_of(driver.game)) == set(order.SECTIONS)
    assert len(driver.game.in_flight()) == asked  # nobody answered them


def test_judging_a_reply_changes_no_game_state_until_the_world_lands_a_result():
    game = new_game(3, 200)
    before = game.snapshot_json()
    got = speech_driver.say(
        game, "gengfu", speech_driver.reply(speech_driver.WATER, **speech_driver.CALM)
    )
    assert (
        got.ok
        and game.snapshot_json() == before
        and game.hash() == Game.from_snapshot_json(before).hash()
    )


def test_every_person_of_the_cast_is_judged_and_worded_in_their_own_voice():
    game = new_game(1, 300)
    lines = set()
    for who in lore().people:
        got = speech_driver.say(
            game,
            who,
            speech_driver.reply(
                [speech_driver.belief("pr_rail_located", "self_seen")], mood="wary"
            ),
        )
        assert got.ok and got.by == "core", (who, got.errors)
        lines.add(got.line["zh"])
    assert len(lines) == len(lore().people)  # nobody says it as anyone else does


def run_in_another_interpreter(hash_seed: str) -> str:
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(TESTS / "cross_host"), str(TESTS / "core")])
    done = subprocess.run(
        [sys.executable, "speech_driver.py"],
        cwd=TESTS / "core",
        env=env,
        capture_output=True,
        text=True,
        check=True,
    )
    return json.loads(done.stdout)


@pytest.mark.parametrize("hash_seed", ["0", "1", "31337"])
def test_the_gate_does_not_depend_on_the_string_hash_seed(hash_seed):
    assert run_in_another_interpreter(hash_seed) == speech_driver.digest()


def test_the_gate_gives_the_same_answers_in_the_same_process_every_time():
    assert speech_driver.digest() == speech_driver.digest()
    batch = speech_driver.results()
    assert any(row[1] for row in batch) and any(not row[1] for row in batch)
    assert {row[2] for row in batch} == {"", "core", "model"}


def test_the_game_of_replies_goes_the_way_the_script_says():
    done = speech_driver.flow()
    assert done["requests"] == 6  # three first tries, and the one repair of each
    assert [row[2] for row in done["shown"]] == ["line", "template", "template"]
    assert done["counts"]["repairs"] == 3 and done["counts"]["templates"] == {"check": 2}
    assert done["counts"]["errors"] == {"connective": 3, "format": 2}
    assert speech_driver.flow() == done  # the same game every time


CORE_FILES = TESTS / "core"
PYODIDE_FILES = tuple(
    CORE_FILES / name
    for name in ("speech_driver.py", "speech_helpers.py", "bridge_helpers.py", "gate_helpers.py")
)


@needs_pyodide
@pytest.mark.parametrize("how", ["source", "wheel"])
def test_pyodide_gives_the_same_answers_and_plays_the_same_game_as_cpython(how, tmp_path):
    """Once with the core as files, once with the wheel that ``uv build`` makes of it, which is how
    the browser loads it."""
    core = (
        ["--src", str(ROOT / "core")]
        if how == "source"
        else ["--wheel", str(build_wheel(tmp_path))]
    )
    ours = speech_driver.run()
    theirs = run_pyodide(
        "hashes", core, driver="speech_driver", files=PYODIDE_FILES, seed=0, ticks=0
    )
    assert theirs["python"].startswith("3.14"), theirs["python"]
    assert theirs["digest"] == ours["digest"]
    assert theirs["flow"] == ours["flow"]


if __name__ == "__main__":
    print(current_pins())
