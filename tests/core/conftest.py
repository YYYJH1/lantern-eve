"""Let the tests in this directory import the driver that lives with the cross-host tests, and end
a test that calls a held world for ever (``stall_guard``)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "cross_host"))

import pytest  # noqa: E402
from stall_guard import no_endless_hold  # noqa: E402, F401  (an autouse fixture)

from lantern_core.world.bridge import statement  # noqa: E402


@pytest.fixture
def the_meeting_is_open(monkeypatch):
    """The full statement is allowed from the first morning, for a test that speaks in the first
    days (the meeting of the fourth evening has tests of its own)."""
    monkeypatch.setattr(statement, "opens", lambda: (1, 6))
