"""The same scripted run under CPython and under Pyodide in Node: every call's hash must match.

``m0_driver.run`` plays 2,000 ticks of the m0 game against the mock model host, with two pauses and
player actions at fixed ticks, and hashes the state after every call. CPython runs it in this
process. Pyodide 314 (Python 3.14) runs it in Node through ``run_pyodide.mjs``, once with the core
written into its file system and once with the wheel that ``uv build`` makes, which is how the
browser loads it. The lists of hashes must be equal element by element, and so must the digest
of every output the core produced. The bridge scenario has its own run, in
``test_cross_host_bridge.py``.

These tests need Node 22 and the pinned Pyodide: run ``npm ci`` in ``tests/cross_host``. Without
either they are skipped, and the reason says which is missing.
"""

import json
import re
import sys

import m0_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, build_wheel, needs_pyodide, run_pyodide

FILES = (HERE / "m0_driver.py", ROOT / "tests" / "core" / "mock_host.py")


def run_m0(core_args):
    return run_pyodide(
        "hashes",
        core_args,
        driver="m0_driver",
        files=FILES,
        seed=driver.SEED,
        ticks=driver.TICKS,
        host_seed=driver.HOST_SEED,
    )


def assert_same_run(pyodide, cpython):
    assert pyodide["python"].startswith("3.14"), pyodide["python"]
    assert pyodide["final_tick"] == cpython["final_tick"] == driver.TICKS
    assert len(pyodide["hashes"]) == len(cpython["hashes"]) > driver.TICKS
    py = "{}.{}".format(*sys.version_info[:2])
    for call, (theirs, ours) in enumerate(zip(pyodide["hashes"], cpython["hashes"], strict=True)):
        assert theirs == ours, f"call {call}: Pyodide {theirs}, CPython {py} {ours}"
    assert pyodide["outputs_digest"] == cpython["outputs_digest"]
    assert pyodide["summary"] == cpython["summary"]


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_pin_is_exact_and_locked():
    package = json.loads((HERE / "package.json").read_text(encoding="utf-8"))
    version = package["dependencies"]["pyodide"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", version), "pin Pyodide to one exact version"
    assert version.startswith("314."), "Pyodide 314 is the one that ships Python 3.14"
    lock = json.loads((HERE / "package-lock.json").read_text(encoding="utf-8"))
    assert lock["packages"]["node_modules/pyodide"]["version"] == version


def test_the_run_exercises_pauses_actions_cancels_and_late_answers(cpython):
    summary = cpython["summary"]
    assert len(cpython["hashes"]) > driver.TICKS
    assert summary["events"]["action_ack"] == 5 and summary["cancels"] > 0
    assert summary["voids"].keys() >= {"cancelled", "unknown_request"}


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    assert_same_run(run_m0(["--src", str(ROOT / "core")]), cpython)


@needs_pyodide
def test_the_wheel_loads_in_pyodide_and_gives_the_same_run(cpython, tmp_path_factory):
    wheel = build_wheel(tmp_path_factory.mktemp("wheel"))
    assert_same_run(run_m0(["--wheel", str(wheel)]), cpython)
