"""A game in which a model answers, under CPython and under Pyodide in Node.

``reply_driver.run`` plays the first day of the persuasion game, 2,070 ticks, with a host that
answers the requests of the core from a table: lines that pass, lines that are refused and repaired
or refused twice, text that is no reply, timeouts and errors, and judgements of the manager's words
with scores, scores past the limit and nonsense. The game is thrown away once for one restored from
its snapshot, in a conversation, with requests in flight. The state hash after every call and the
digest of every output must be the same under both interpreters, and so must the summary.
"""

import pytest
import reply_driver as driver
from pyodide_runner import HERE, ROOT, needs_pyodide, run_pyodide

FILES = (HERE / "reply_driver.py", HERE / "persuade_driver.py")


@pytest.fixture(scope="module")
def cpython():
    return driver.run()


def test_the_run_has_every_kind_of_result_a_host_can_give(cpython):
    summary = cpython["summary"]
    assert cpython["final_tick"] == driver.TICKS
    # a call in which the world stands still in a conversation simulates no tick
    assert len(cpython["hashes"]) == cpython["summary"]["calls"] > driver.TICKS
    assert summary["left"] > 0 and summary["restored_talking"] == 1  # a restore with a talk open
    model = summary["model"]
    for key in (
        "reply:ok",
        "reply:timeout",
        "reply:error",
        "repair:ok",
        "judge:ok",
        "judge:timeout",
    ):
        assert model.get(key, 0) > 0, (key, model)
    answered = summary["answered"]
    assert {key.split(":")[1] for key in answered} == {"line", "template"}
    causes = {key.split(":")[3] for key in answered if key.split(":")[1] == "template"}
    assert {"timeout", "check"} <= causes
    assert summary["events"]["void"] > 0  # and some answers came after the manager had moved on
    speech = summary["speech"]
    assert speech["repairs"] > 0 and speech["mended"] > 0 and speech["passed"] > 0
    judge = speech["judge"]
    assert judge["scored"] > 0 and judge["unscored"] > 0
    assert judge["asked"] == judge["scored"] + judge["unscored"]
    assert summary["thinking"] > 0 and set(summary["tiers"]) == {"cheap", "strong"}
    assert summary["pending"] == [] and summary["in_flight"] == []  # and nothing is left out


def test_the_restore_changes_nothing(cpython):
    other = driver.run(restores=False)
    assert other["hashes"] == cpython["hashes"]
    assert other["summary"]["final"] == cpython["summary"]["final"]


@needs_pyodide
def test_pyodide_matches_cpython_on_every_call(cpython):
    pyodide = run_pyodide(
        "hashes",
        ["--src", str(ROOT / "core")],
        driver="reply_driver",
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
