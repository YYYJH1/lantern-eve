"""A three-day game that its page watches, under CPython and under Pyodide in Node.

``moments_driver.run`` plays the game of ``goals_driver`` with the page's part added: the page says
that it shows the moments of the festival, a moment holds the world until the page lets it go
(after three calls in which the world stood still), and the game is thrown away for one restored
from its snapshot in the middle of the first hold. The lists of hashes must be equal element by
element, and so must the digest of every output the core produced and the summary.
"""

import moments_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, needs_pyodide, run_pyodide

FILES = (HERE / "moments_driver.py", HERE / "goals_driver.py")


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_has_the_moments_held_and_let_go_and_the_festival_of_the_last_night(cpython):
    summary = cpython["summary"]
    assert len(cpython["hashes"]) == summary["calls"] and cpython["final_tick"] == driver.TICKS
    assert [m["moment"] for m in summary["moments"]] == ["both_banks", "together_work"]
    assert summary["events"]["moment"] == 2 and summary["acks"]["applied"] > 13
    first, second = summary["listed"]
    assert (first["kind"], first["place"], first["x"], first["y"]) == (
        "both_banks",
        "p_bridge",
        27,
        15,
    )
    assert (second["kind"], second["round"]) == ("together_work", 3)
    assert first["tick"] < 2 * 2070 < second["tick"] and summary["held"] == []
    # each hold stood still for three calls and was let go by the page
    assert [kinds for _, kinds in summary["holds"]] == [["both_banks"], ["together_work"]]
    assert summary["stills"] >= 2 * (driver.STILL_CALLS - 1) and summary["restored_held"] == 1
    ending = summary["ending"]
    assert ending["ending"] == "ending_full"
    assert ending["festival"]["route"] == "bridge" and ending["festival"]["together"] is True
    assert ending["festival"]["lighter"] == ["li_laotai", "zhou_zhanggui"]
    assert sum(ending["festival"]["bearers"].values()) == 120 < ending["turnout"]
    assert len(ending["festival"]["named"]) == 20


def test_restoring_from_a_snapshot_changes_nothing_not_even_in_the_middle_of_a_hold(cpython):
    plain = driver.run(restores=False)
    assert plain["summary"]["restored"] == 0 and plain["summary"]["restored_held"] == 0
    assert plain["hashes"] == cpython["hashes"]
    assert plain["outputs_digest"] == cpython["outputs_digest"]
    assert plain["summary"]["final"] == cpython["summary"]["final"]


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    pyodide = run_pyodide(
        "hashes",
        ["--src", str(ROOT / "core")],
        driver="moments_driver",
        files=FILES,
        seed=driver.SEED,
        ticks=driver.TICKS,
    )
    assert pyodide["python"].startswith("3.14"), pyodide["python"]
    assert pyodide["final_tick"] == cpython["final_tick"] == driver.TICKS
    assert len(pyodide["hashes"]) == len(cpython["hashes"])
    for call, (theirs, ours) in enumerate(zip(pyodide["hashes"], cpython["hashes"], strict=True)):
        assert theirs == ours, f"call {call}: Pyodide {theirs}, CPython {ours}"
    assert pyodide["outputs_digest"] == cpython["outputs_digest"]
    assert pyodide["summary"] == cpython["summary"]
