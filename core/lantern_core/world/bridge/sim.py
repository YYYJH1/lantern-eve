"""What a subsystem sees during one tick.

One ``Sim`` is made per simulated tick and handed to the ``tick`` of every subsystem in turn.
It carries the world (the static content and the config), the kernel's ``Ctx`` (the tick, the
RNG, the way to emit events and to ask a model), the world state, and the time of this tick.
``replies`` counts the times in this call that a person has answered the manager (see
``converse.replied``): the rules read it where they may not read the signal that comes with it,
which the state does not count. ``act_seconds`` is what the act of the manager that is being done
will owe if it is carried out (see ``pace.timed``), for what is made in the act and has a time of
its own, such as the day and the hour a promise falls due. ``told`` is what the manager was told in
answer in this call, ``(speaker, prop)`` in the order it was said, for ``moments`` to look at.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from lantern_core.world.bridge import clock

if TYPE_CHECKING:
    from lantern_core.kernel import Ctx
    from lantern_core.world.bridge.world import BridgeWorld


class Sim:
    __slots__ = ("act_seconds", "ctx", "now", "replies", "state", "told", "world")

    def __init__(self, world: BridgeWorld, ctx: Ctx) -> None:
        self.world = world
        self.ctx = ctx
        self.state: dict[str, Any] = ctx.state["world"]
        self.now = clock.at(ctx.tick)
        self.replies = 0
        self.act_seconds = 0
        self.told: list[tuple[str, str]] = []

    def emit(self, kind: str, **fields: Any) -> None:
        """Add an event to the outputs of the call (see ``Ctx.emit``)."""
        self.ctx.emit(kind, **fields)

    def signal(self, kind: str, **fields: Any) -> None:
        """Add an event to the outputs that the state does not count (see ``Ctx.signal``)."""
        self.ctx.signal(kind, **fields)
