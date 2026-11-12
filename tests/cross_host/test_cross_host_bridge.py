"""A whole five-day game of the bridge scenario under CPython and under Pyodide in Node.

``bridge_driver.run`` plays 10,350 ticks: errands posted at fixed ticks, a resend, two pauses,
and three restores from a snapshot: in the middle of the third day and in the middle of each
pause. A bot plays the festival manager all the while: it walks, listens, talks (two of the
restores find it in the middle of a conversation, with the world held or running fast to pay for
an act), asks, asks who told it what, and looks. It hashes the state after every call. CPython
runs it in this process. Pyodide 314 (Python 3.14) runs it in Node, once with the core written into
its file system and once with the wheel that ``uv build`` makes, which is how the browser loads it.
The lists of hashes must be equal element by element, and so must the digest of every output the
core produced.

The restores must change nothing: the same run without them gives the same hashes.
"""

import bridge_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, build_wheel, needs_pyodide, run_pyodide

FILES = (HERE / "bridge_driver.py",)
# the pauses add calls: 5 and 4, each with its resume; and each of the five conversations opens with
# a call in which the world stands still
CALLS = driver.TICKS + 9 + 5


def run_bridge(core_args):
    return run_pyodide(
        "hashes",
        core_args,
        driver="bridge_driver",
        files=FILES,
        seed=driver.SEED,
        ticks=driver.TICKS,
    )


def assert_same_run(pyodide, cpython):
    assert pyodide["python"].startswith("3.14"), pyodide["python"]
    assert pyodide["final_tick"] == cpython["final_tick"] == driver.TICKS
    assert len(pyodide["hashes"]) == len(cpython["hashes"]) == CALLS
    for call, (theirs, ours) in enumerate(zip(pyodide["hashes"], cpython["hashes"], strict=True)):
        assert theirs == ours, f"call {call}: Pyodide {theirs}, CPython {ours}"
    assert pyodide["outputs_digest"] == cpython["outputs_digest"]
    assert pyodide["summary"] == cpython["summary"]


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_covers_five_days_of_weather_errands_and_restores(cpython):
    summary = cpython["summary"]
    assert len(cpython["hashes"]) == CALLS and summary["calls"] == CALLS
    assert summary["restored"] == 3  # in each of the two pauses, and in the middle of day 3
    assert summary["restored_talking"] == 2  # the pause at 3000 and the middle of day 3
    events = summary["events"]
    assert events["dawn"] == events["dusk"] == events["weather"] == 5
    assert set(summary["weather"]) == {"clear", "light_rain", "heavy_rain"}
    acks = summary["acks"]
    assert (acks["duplicate"], acks["no_plan"], acks["refused"]) == (1, 1, 1)  # the keeper's no
    # (three talks were asked of someone in the middle of telling a neighbour, who is busy; the
    # refusal is in test_bridge_player) and one look is turned away as out of its time: the table
    # of the evidence has days, and the bot looks at what it stands by without knowing them
    assert (acks["busy"], acks["closed"]) == (3, 1)
    assert acks["applied"] > 100
    assert set(acks) == {"applied", "busy", "closed", "duplicate", "no_plan", "refused"}
    assert sorted(summary["errands"].values()) == ["done"] * 7 + ["no_stock"]
    assert events["taken"] == events["delivered"] == 4
    assert events["talk_start"] == events["talk_end"] == 5  # all five end, one way or the other
    assert events["look_start"] == events["inspected"] == 1 and events["look_refused"] == 1
    assert events["heard"] >= 5 and events["asked"] >= 50 and events["arrived"] >= 8
    # the night: the twenty think over the day at eleven on each of the first four nights, and some
    # go on the errand they chose (the same under Pyodide, call for call: the hashes say so)
    assert events["reflected"] == 4 * 20 and events["errand"] >= 3
    assert {"sleep", "work", "walk", "carry", "tea", "patrol", "drink"} <= set(
        summary["activities"]
    )


def test_restoring_from_a_snapshot_changes_nothing(cpython):
    plain = driver.run(restores=False)
    assert plain["summary"]["restored"] == 0
    assert plain["hashes"] == cpython["hashes"]
    assert plain["outputs_digest"] == cpython["outputs_digest"]
    assert plain["summary"]["final"] == cpython["summary"]["final"]


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    assert_same_run(run_bridge(["--src", str(ROOT / "core")]), cpython)


@needs_pyodide
def test_the_wheel_loads_in_pyodide_and_gives_the_same_run(cpython, tmp_path_factory):
    wheel = build_wheel(tmp_path_factory.mktemp("wheel"))
    assert_same_run(run_bridge(["--wheel", str(wheel)]), cpython)
