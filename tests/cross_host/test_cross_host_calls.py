"""People who name each other in words of their own, under CPython and under Pyodide in Node.

``call_driver.run`` gives five people the tables of ``call_helpers`` and plays the first day of the
game with a model that answers. The state hash after every call and the digest of every output must
be the same under both interpreters, and so must the summary: the words people said with their
names, the prompts that carried the tables, and how the gate judged lines that name people by them.
"""

import json
import os
import subprocess
import sys

import call_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, needs_pyodide, run_pyodide

from lantern_core.world.bridge.voice_data import VOICES

FILES = (
    HERE / "call_driver.py",
    HERE / "reply_driver.py",
    HERE / "persuade_driver.py",
    ROOT / "tests" / "core" / "call_helpers.py",
)


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_has_people_naming_each_other_and_a_model_that_was_asked_with_the_tables(cpython):
    summary = cpython["summary"]
    assert cpython["final_tick"] == driver.TICKS
    said = summary["said"]
    for name in ("老二", "李家老二", "李二爷", "伙计"):
        assert said[name] > 0, (name, said)
    assert summary["leaks"] == 0  # nobody is named by the cast to whom their table gives a name
    assert summary["prompts_with_the_table"] > 0  # and the model was told the names they use


def test_the_gate_judges_the_names_of_a_table_for_the_person_whose_table_it_is(cpython):
    judged = cpython["summary"]["judged"]
    assert judged["mother_names_her_son"]["ok"]
    assert judged["maker_means_the_li_son"]["ok"]
    assert judged["watchman_has_no_laoer"]["ok"]  # a word that names no one for him
    for name in (
        "mother_names_a_son_nobody_covers",
        "brother_means_his_brother",
        "watchman_means_the_zhou_son",
    ):
        assert not judged[name]["ok"], name
        assert {error["type"] for error in judged[name]["errors"]} == {"entity"}, name
    core = judged["core_writes_for_the_mother"]
    assert core["ok"] and core["by"] == "core"
    assert "老二" in core["line"]["zh"] and "周家那个掌柜" in core["line"]["zh"]


def test_the_restore_changes_nothing(cpython):
    other = driver.run(restores=False)
    assert other["hashes"] == cpython["hashes"]
    assert other["summary"]["final"] == cpython["summary"]["final"]


@pytest.mark.parametrize("hash_seed", ["0", "1", "31337"])
def test_the_run_does_not_depend_on_the_string_hash_seed(hash_seed):
    ticks = 700
    code = (
        f"import json, call_driver as d; r = d.run(ticks={ticks}); "
        "print(json.dumps([r['hashes'], r['outputs_digest'], r['summary']], sort_keys=True))"
    )
    env = dict(os.environ, PYTHONHASHSEED=hash_seed)
    env["PYTHONPATH"] = os.pathsep.join([str(HERE), str(ROOT / "tests" / "core")])
    done = subprocess.run(
        [sys.executable, "-c", code], env=env, capture_output=True, text=True, check=True
    )
    ours = driver.run(ticks=ticks)
    expected = [ours["hashes"], ours["outputs_digest"], ours["summary"]]
    assert json.loads(done.stdout) == json.loads(json.dumps(expected, sort_keys=True))


def test_a_run_leaves_the_voices_as_it_found_them():
    before = json.dumps(VOICES, sort_keys=True, ensure_ascii=False)
    driver.run(ticks=60)
    assert json.dumps(VOICES, sort_keys=True, ensure_ascii=False) == before


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    pyodide = run_pyodide(
        "hashes",
        ["--src", str(ROOT / "core")],
        driver="call_driver",
        files=FILES,
        seed=driver.SEED,
        ticks=driver.TICKS,
    )
    assert pyodide["python"].startswith("3.14"), pyodide["python"]
    assert pyodide["final_tick"] == cpython["final_tick"]
    assert len(pyodide["hashes"]) == len(cpython["hashes"])
    for call, (theirs, ours) in enumerate(zip(pyodide["hashes"], cpython["hashes"], strict=True)):
        assert theirs == ours, f"call {call}: Pyodide {theirs}, CPython {ours}"
    assert pyodide["outputs_digest"] == cpython["outputs_digest"]
    assert pyodide["summary"] == cpython["summary"]
