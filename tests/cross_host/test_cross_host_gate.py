"""The budget gate and the street talk under CPython and under Pyodide in Node.

``gate_driver.run`` plays 3,000 ticks of the bridge game with a cap small enough to pass through
the stages: a script asks for calls, a host answers them (one in seven with a timeout) and tells the
core when the cloud and the local model go away and come back, and named people now and then speak
out in the open, which the crowd hears and passes on. The state hash after every call, and the
digest of every output, must be the same under both.
"""

import gate_driver as driver
import pytest
from pyodide_runner import HERE, ROOT, needs_pyodide, run_pyodide

FILES = (HERE / "gate_driver.py",)


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_goes_through_the_stages_the_tiers_and_the_events_of_the_host(cpython):
    summary = cpython["summary"]
    assert len(cpython["hashes"]) == cpython["final_tick"] == driver.TICKS
    assert summary["events"]["downgrade"] > 100 and summary["events"]["budget_stage"] >= 1
    assert set(summary["tiers"]) == {"cheap", "strong", "local"}  # and the template, unsent
    reasons = {key.rsplit(":", 1)[1] for key in summary["reasons"]}
    assert reasons == {"budget", "cloud_down"}
    kinds = {key.split(">")[1].split(":")[0] for key in summary["reasons"]}
    assert kinds == {"cheap", "local", "template"}
    budget = summary["budget"]
    assert (
        budget["templated"] > 100 and 0 < budget["spent"] * 100 <= driver.CONFIG["budget_cap"] * 90
    )
    ledger = summary["ledger"]
    assert all(ledger[tier]["timeout"] > 0 for tier in ("cheap", "strong", "local"))
    assert summary["goals"]["landed"]["template:error"] == budget["templated"]
    # the street heard what was said and passed it on to named people
    assert summary["goals"]["heard"] > 100 and summary["goals"]["passed"] > 100


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    pyodide = run_pyodide(
        "hashes",
        ["--src", str(ROOT / "core")],
        driver="gate_driver",
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
