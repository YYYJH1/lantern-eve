"""End a test that calls a held world for ever.

While the manager is in a conversation the world stands still: a call simulates no tick until the
manager acts (``lantern_core.world.bridge.pace``). A script that forgets that calls the core without
end, and a test that keeps the outputs of its calls (many do) grows until the machine is out of
memory. Here every ``Game`` counts the calls in a row that did not move its tick, and the call after
``MAX_STILL`` of them is an error that says so. The longest legitimate run of them is a few dozen: a
pause of some calls, a host that polls a held world. The drivers of the cross-host tests have the
same check with half the limit (``bridge_driver.MAX_STILL``): they run under Pyodide too, where
there is no pytest, and their error says which script is stuck. This is the net under the rest.

The fixture is session-scoped so that the fixtures of a module, which play whole games, are covered
too. ``conftest.py`` of the core tests and of the cross-host tests both bring it in.
"""

from __future__ import annotations

import pytest

from lantern_core.api import Game

MAX_STILL = 2000


@pytest.fixture(scope="session", autouse=True)
def no_endless_hold():
    step = Game.step

    def counted(self: Game, inputs_json: str = "[]") -> str:
        before = self.tick
        out = step(self, inputs_json)
        if self.tick != before:
            self._still = 0
        else:
            self._still = getattr(self, "_still", 0) + 1
            if self._still > MAX_STILL:
                raise AssertionError(
                    f"the world has stood still for {self._still} calls at tick {self.tick}: "
                    "somebody is in a conversation and nothing lets the world go on"
                )
        return out

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(Game, "step", counted)
        yield
