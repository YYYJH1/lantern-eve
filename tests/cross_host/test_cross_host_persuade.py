"""A whole game won by the festival manager's actions alone, under CPython and under Pyodide.

``persuade_driver.run`` plays five days, 10,350 ticks, without a dev action: the manager promises
and asks the head of the Zhou family to join, calls for helpers, has the timber brought, is refused
the bamboo, follows the rumour back to the clerk and says in public at the teahouse in the evening
that it goes beyond what he saw (Granny Li lends the bamboo, and Li Da, who heard it, brings it, and
joins the helpers after three promises so that the Li family has someone among them), keeps a
promise, sees the helpers of both families mend the bridge on the third and the fourth morning,
hears the night watchman on the fourth night, and on the fifth morning has the clan elder call the
clan to the hall, shows the evidence there, fills in the card of the statement and tells the town
how the bridge broke so that the truth is taken in, sees the two families sit down at a table, and
makes up a lie that the person who hears it catches. It hashes the state after every call, and
throws the game away three times for one restored from its snapshot (in a conversation, in a pause,
which the script takes in a conversation, and where the clan is called). CPython runs it in this
process and Pyodide 314 (Python 3.14) in Node, with the core written into its file system. The
lists of hashes must be equal element by element, and so must the digest of every output the core
produced and the summary of what happened.

The restores must change nothing: the same run without them gives the same hashes.
"""

import persuade_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, needs_pyodide, run_pyodide

FILES = (HERE / "persuade_driver.py",)
# the pause adds calls, the last of them with the resume, and six calls more simulate no tick: the
# world stands still in a conversation that has just been opened
CALLS = driver.TICKS + driver.PAUSE_CALLS + 6


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_manager_mends_the_bridge_with_the_truth_and_with_peace_by_their_own_actions(cpython):
    summary = cpython["summary"]
    assert len(cpython["hashes"]) == CALLS and summary["calls"] == CALLS
    assert cpython["final_tick"] == driver.TICKS and summary["left"] == 0  # the script ran out
    assert "dev_actions" not in driver.CONFIG
    assert not {"assign", "dev_goal"} & set(summary["actions"])
    assert set(summary["actions"]) == {
        "ask", "ask_source", "entrust", "leave", "move", "promise", "rally", "speak", "statement",
        "talk", "tell",
    }  # fmt: skip
    ending = summary["ending"]
    assert ending["ending"] == "ending_full" and ending["passage"] == "mended"
    assert ending["inputs"] == {
        "bridge_fixed": True,
        "detour_done": False,
        "reconciled": True,
        "truth_told": True,
    }
    assert ending["tick"] == (driver.DAYS - 1) * driver.DAY + 1800
    assert set(summary["flags"]) == {
        "timber_delivered",
        "bamboo_delivered",
        "elder_accepts",
        "truth_told",
        "reconcile_seen",
        "reconciled",
        "bridge_fixed",
    }
    flags = summary["flags"]
    assert flags["timber_delivered"] < flags["bamboo_delivered"] < driver.DAY  # the first day
    assert flags["bridge_fixed"] < 4 * driver.DAY + 12 * 120  # mended by the fourth noon
    assert (
        4 * driver.DAY < flags["truth_told"] < flags["reconciled"] < 5 * driver.DAY
    )  # the fifth day
    assert summary["metrics"]["audience_named"] == 9 and summary["metrics"]["accept_ratio"] == 88
    assert summary["metrics"]["work_progress"] == 100 and summary["metrics"]["grudge"] < 30


def test_the_run_covers_every_kind_of_dealing(cpython):
    summary, events = cpython["summary"], cpython["summary"]["events"]
    assert summary["restored"] == 3 and summary["restored_talking"] == 2
    assert summary["restored_meeting"] == 1  # where the clan is called
    assert events["rally"] == 1 and events["ending"] == 1 and events["joined"] == summary["joined"]
    assert events["entrusted"] == 9 and events["testified"] == 1 and events["convened"] == 1
    assert events["agreed"] == 2 and events["objection_withdrawn"] == 1  # the timber, the bamboo
    assert events["clarified"] == 1 and events["spoke"] == 1 and events["stated"] == 1
    assert events["feast"] == 1
    assert events["eased"] == 4  # both heads stopped accusing; two mornings of work at the bridge
    assert events["pledged"] == 8 and events["pledge_kept"] == 1 and events["pledge_empty"] == 1
    assert events["lie_caught"] == 1
    results = summary["results"]
    assert results["granny-lend"] == ["rejected", "hard"]  # the way to the bamboo is shut
    assert results["granny-lend-again"] == ["rejected", "said_already"]
    assert results["clarify"] == ["applied", None]  # said in public at the teahouse
    assert results["granny-lend-now"] == ["applied", None]  # and open once the rumour is cleared
    assert results["li-da-bamboo"] == ["applied", None]  # the bamboo is his, and he was there
    assert results["zhou-empty"] == ["rejected", "empty"]
    assert results["hall-speak"] == ["applied", None] == results["hall-meal"]
    for label in (
        "card-cause",
        "card-course",
        "card-rumour",
        "hall-statement",
    ):
        assert results[label] == ["applied", None], label
    assert results["old-lie"] == ["applied", None]
    # the first promise was kept; the three to Li Da, whose day was the fourth, lapsed; the others
    # (the stalls and the wage of the watchman and the honour of the elder) are open
    assert summary["pledges"] == [
        ["k1", "kept"],
        ["k2", "open"],
        ["k3", "open"],
        ["k4", "broken"],
        ["k5", "broken"],
        ["k6", "broken"],
        ["k7", "open"],
        ["k8", "open"],
    ]
    assert summary["joined"] == 6  # the head of the Zhou family, four of his friends, and Li Da


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
        driver="persuade_driver",
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
