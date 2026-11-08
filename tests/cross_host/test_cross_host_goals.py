"""A three-day game with the goals at work under CPython and under Pyodide in Node.

``goals_driver.run`` plays 6,210 ticks: the call for helpers, the materials, the work on the
bridge, the lane and its lanterns, the truth, the peace and the last night with its ending and
reveal, with actions resent and refused, a pause, and three restores from a snapshot (in the
pause, in the middle of the work, and just before the last night). It hashes the state after
every call. CPython runs it in this process and Pyodide 314 (Python 3.14) in Node, with the core
written into its file system. The lists of hashes must be equal element by element, and so must
the digest of every output the core produced and the summary of what happened.

The restores must change nothing: the same run without them gives the same hashes.
"""

import goals_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, needs_pyodide, run_pyodide

FILES = (HERE / "goals_driver.py",)
CALLS = driver.TICKS + 5  # the pause adds calls: 5, the last of them with the resume


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_covers_the_call_the_materials_the_work_the_lane_and_the_last_night(cpython):
    summary = cpython["summary"]
    assert len(cpython["hashes"]) == CALLS and summary["calls"] == CALLS
    assert summary["restored"] == 3 and cpython["final_tick"] == driver.TICKS
    events = summary["events"]
    assert events["rally"] == 1 and events["ending"] == 1 and events["agreed"] == 3
    # Ten helpers are in, the crew and five more: the call is for the crew of five and no more, so
    # six are won over one by one (round 0) and the call takes four, in three rounds, before it
    # stops with the crew ready (the rest the script tries to win over are in by then).
    assert events["joined"] == summary["joined"] == 10
    assert sorted(summary["rounds"].values()) == [*[0] * 6, *[1] * 2, 2, 3]
    assert events["promised"] == len(summary["households"]) == summary["most_lanterns"] == 5
    assert summary["acks"] == {"applied": 13, "duplicate": 1, "already_open": 1, "no_change": 7}
    assert set(summary["flags"]) == {
        "bamboo_delivered",
        "timber_delivered",
        "lane_opened",
        "lamps_hung",
        "detour_done",
        "bridge_fixed",
        "truth_told",
        "reconcile_seen",
        "reconciled",
    }
    assert set(summary["done"]) == {
        "g_materials",
        "g_labor",
        "g_repair",
        "g_detour",
        "g_truth",
        "g_reconcile",
    }
    assert summary["metrics"]["work_progress"] == 100 and summary["metrics"]["detour_workers"] == 3
    assert summary["work"]["ticks"] == summary["work"]["seen"] == 10 * 120  # an hour from each
    assert summary["errands"] == {"carry": 2, "work": 10 + 1 + 3}  # the crew, the keeper, lanterns
    ending = summary["ending"]
    assert ending["ending"] == "ending_full" and ending["passage"] == "mended"
    assert ending["tick"] == 2 * driver.DAY + 1800 and ending["chains"] == 1
    assert ending["inputs"] == {
        "bridge_fixed": True,
        "detour_done": True,
        "reconciled": True,
        "truth_told": True,
    }
    assert summary["hud"]["ending"] == "ending_full"
    assert summary["hud"]["turnout"] == ending["turnout"] > 0
    assert summary["hud"]["bridge"]["state"] == "mended"


def test_restoring_from_a_snapshot_changes_nothing(cpython):
    plain = driver.run(restores=False)
    assert plain["summary"]["restored"] == 0
    assert plain["hashes"] == cpython["hashes"]
    assert plain["outputs_digest"] == cpython["outputs_digest"]
    assert plain["summary"]["final"] == cpython["summary"]["final"]


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    pyodide = run_pyodide(
        "hashes",
        ["--src", str(ROOT / "core")],
        driver="goals_driver",
        files=FILES,
        seed=driver.SEED,
        ticks=driver.TICKS,
    )
    assert pyodide["python"].startswith("3.14"), pyodide["python"]
    assert pyodide["final_tick"] == cpython["final_tick"] == driver.TICKS
    assert len(pyodide["hashes"]) == len(cpython["hashes"]) == CALLS
    for call, (theirs, ours) in enumerate(zip(pyodide["hashes"], cpython["hashes"], strict=True)):
        assert theirs == ours, f"call {call}: Pyodide {theirs}, CPython {ours}"
    assert pyodide["outputs_digest"] == cpython["outputs_digest"]
    assert pyodide["summary"] == cpython["summary"]
