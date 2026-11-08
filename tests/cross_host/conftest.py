"""Let the cross-host tests import the mock host that lives with the core tests, and end a test that
calls a held world for ever (``stall_guard``)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "core"))

from stall_guard import no_endless_hold  # noqa: E402, F401  (an autouse fixture)
