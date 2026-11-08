"""Milliseconds per tick of a scenario, under CPython and under Pyodide in Node.

    uv run python tests/cross_host/bench.py [m0|bridge] [ticks]

Each figure is the best of three runs of the scripted driver, after a warm-up. "step" is the time
inside ``Game.step`` per simulated tick, "hash" the time of one ``Game.hash()`` after every call,
and "loop" the whole host loop (the mock host and the JSON round trips included, the hash left
out). The default is m0 for 2,000 ticks, and the whole five days (10,350 ticks) for the bridge.
"""

import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(ROOT / "tests" / "core"))  # the m0 driver imports the mock host from there

import bridge_driver  # noqa: E402
import m0_driver  # noqa: E402
from pyodide_runner import run_pyodide  # noqa: E402

# scenario -> (driver module, its name, the files Pyodide needs, the default number of ticks)
SCENARIOS = {
    "m0": (m0_driver, "m0_driver", (HERE / "m0_driver.py", ROOT / "tests/core/mock_host.py")),
    "bridge": (bridge_driver, "bridge_driver", (HERE / "bridge_driver.py",)),
}


def per_tick(run):
    """(step, hash, loop) in milliseconds per simulated tick."""
    ticks = run["ticks"]
    return tuple(
        run[key] * 1000 / ticks for key in ("step_seconds", "hash_seconds", "total_seconds")
    )


def report(label, runs):
    step, digest, loop = (min(values) for values in zip(*map(per_tick, runs), strict=True))
    worst = min(run["worst_step_seconds"] for run in runs) * 1000
    print(
        f"{label:16} step {step:.3f}   hash {digest:.3f}   loop {loop:.3f}   (ms per tick)"
        f"   worst step {worst:.1f} ms"
    )


def main(scenario, ticks):
    module, name, files = SCENARIOS[scenario]
    ticks = ticks or module.TICKS
    module.bench(ticks=300)
    print(f"{scenario}, {ticks} ticks")
    report(f"CPython {sys.version.split()[0]}", [module.bench(ticks=ticks) for _ in range(3)])
    result = run_pyodide(
        "bench",
        ["--src", str(ROOT / "core")],
        driver=name,
        files=files,
        seed=module.SEED,
        ticks=ticks,
        host_seed=getattr(module, "HOST_SEED", 0),
    )
    report(f"Pyodide {result['python'].split()[0]}", result["runs"])


if __name__ == "__main__":
    args = sys.argv[1:]
    scenario = args.pop(0) if args and args[0] in SCENARIOS else "m0"
    main(scenario, int(args[0]) if args else None)
