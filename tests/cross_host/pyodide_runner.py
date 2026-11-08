"""Run a driver module under Pyodide in Node, and build the wheel it can load.

Shared by the cross-host tests. Pyodide needs Node 22 and the pinned package: run ``npm ci`` in
``tests/cross_host``. Without either the tests that need it are skipped, and the reason says
which is missing.
"""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
NODE = shutil.which("node")
PYODIDE = HERE / "node_modules" / "pyodide" / "pyodide.mjs"

if NODE is None:
    MISSING = "node is not on the PATH, so Pyodide cannot run (install Node 22)"
elif not PYODIDE.exists():
    MISSING = "Pyodide is not installed: run `npm ci` in tests/cross_host"
else:
    MISSING = ""

needs_pyodide = pytest.mark.skipif(bool(MISSING), reason=MISSING)


def run_pyodide(mode, core_args, *, driver, files, seed, ticks, host_seed=0):
    """Run ``driver.run`` or ``driver.bench`` under Pyodide and return the JSON it prints.

    ``driver`` is the module name, ``files`` the files to write next to each other into
    Pyodide's file system (the driver and what it imports), and ``core_args`` either
    ``["--src", <dir holding lantern_core>]`` or ``["--wheel", <wheel>]``.
    """
    command = [
        NODE,
        str(HERE / "run_pyodide.mjs"),
        "--mode",
        mode,
        "--ticks",
        str(ticks),
        "--seed",
        str(seed),
        "--host-seed",
        str(host_seed),
        "--driver",
        driver,
        *core_args,
        *(arg for file in files for arg in ("--file", str(file))),
    ]
    done = subprocess.run(command, cwd=HERE, capture_output=True, text=True, timeout=1200)
    assert done.returncode == 0, done.stderr[-3000:]
    return json.loads(done.stdout.strip().splitlines()[-1])


def build_wheel(out_dir):
    """The wheel that ``uv build`` makes of the core, which is how the browser loads it."""
    if shutil.which("uv") is None:
        pytest.skip("uv is not on the PATH, so the wheel cannot be built")
    built = subprocess.run(
        ["uv", "build", "--wheel", "core", "-o", str(out_dir)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        timeout=600,
    )
    assert built.returncode == 0, built.stderr[-3000:]
    (wheel,) = Path(out_dir).glob("lantern_core-*.whl")
    return wheel
