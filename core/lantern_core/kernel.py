"""The deterministic kernel: inputs in, one tick of a world, outputs and a canonical state out.

``Game`` in ``api.py`` is the JSON face of this class. Everything that determines the future
lives in ``Kernel.state``, a dict of canonical values (see ``canon``): the clock, the sequence
counter, the RNG, the model requests in flight, the ledger and the scenario's own ``world``
state. A snapshot is that dict, so a restored kernel continues bit for bit. What a kernel keeps
besides its state is derived from the state and the scenario (caches, look-up tables) and holds
nothing the future depends on.

One call of ``step`` does this, in this order:

1. The whole list of inputs is validated (``inputs.normalize``). A refused list changes nothing.
2. The inputs are applied in order. ``pause`` and ``resume`` set the flag of the host. A ``player``
   action goes to the world unless its ``action_id`` was seen before, in which case it only draws an
   acknowledgement. A ``model_result`` settles the request it names (see ``_land``). A ``host``
   event, which says whether the cloud can be reached and whether a local model is there, goes
   to the world's gate, if it has one.
3. Unless the world is stopped now, which it is if the host paused it or the world holds its own
   clock (``World.halted``), the world simulates tick ``t`` and then the kernel checks
   every request still in flight against its ``valid_if``. A request whose conditions no longer
   hold gets its id into ``cancels``, once, and is marked so that nothing it later returns can
   be applied. Then the tick counter moves to ``t + 1``.
4. The RNG state is written back, the outputs are assembled, and on every tick that is a
   multiple of ``HASH_EVERY`` the state hash is added. The speed of the clock in the outputs is
   the world's answer (``World.rate``), and ``clock.paused`` is whether the world is stopped, both
   read from the state after the call.

Two things can stop the world, and they do not know of each other. The *pause* is the host's: it
is set by the inputs ``pause`` and ``resume`` and is part of the state, and a host that pauses for
a hidden page or a menu must not change the game. The *halt* is the world's own: a scenario can
hold its clock by what its state says (the bridge does while the festival manager is in a
conversation and the world owes no time for what they did), and a ``resume`` does not undo it. A
world with no ``halted`` is never halted. The outputs say only whether the world is stopped.

``state["issued"]`` is there only while a tick that has issued a request is not over: ``[tick, n]``,
how many requests the calls made at that tick have issued, so that a request id is the same whether
a stopped world was called once at a tick or several times (see ``Ctx.issue``).

``state["version"]`` counts the events emitted so far. A request records it when it goes out,
so that its result can be placed among the things that happened while it was in flight. A
*signal* (``Ctx.signal``) is an event that tells the host something about the call and that the
state does not count, so a signal can be added to a world, or taken away, without moving any
state hash.

A world may meter its model calls by offering a *gate* (see ``Gate``). Every request then passes
through it on its way out: the gate reserves money for it, may send it to a cheaper tier or to
a local model, or may turn it away. A request that is turned away never goes out. The world gets
its template outcome at once, in the same call and after the code that asked has returned, as
an ``error`` result whose text is the reason (``Kernel._answer_templates``). When a result
settles, the gate books what the call cost. Because the gate works from the requests in the
state and from the inputs, a replay makes the same decisions at the same ticks.

A call on a stopped world applies inputs and nothing else: no tick, no cancel check. Because
nothing but the inputs and the tick can change the state, one call that carries all the inputs
of a tick gives the same state as the several calls a host made while the world was stopped,
which is what lets a replay make one call per tick. (An input can start the world again, which is
decided after all of them have been applied: a paused world that gets ``resume``, or a halted one
that is owed time by an act, simulates the tick of that call.)
"""

from __future__ import annotations

from typing import Any, Protocol

from lantern_core import canon, inputs
from lantern_core import ledger as ledgers
from lantern_core.rng import Pcg32
from lantern_core.world import create_world

FORMAT = 1
HASH_EVERY = 100
RNG_STREAM = 0x6C616E7465726E  # "lantern" read as a number: the initseq of the reference seeding
MAX_REQUEST_TOKENS = 4096
MAX_TEMPLATE_ROUNDS = 16  # how deep template outcomes may issue requests that are turned away
ROLES = ("system", "user", "assistant")
# Fields of a request that go out to the host. The record in the state has one more, the
# cancel flag, which only the core needs.
REQUEST_FIELDS = (
    "request_id",
    "interaction_id",
    "issued_tick",
    "state_version",
    "valid_if",
    "tier",
    "category",
    "messages",
    "max_tokens",
    "reserve",
    "hold",
)


class World(Protocol):
    """What the kernel needs from a scenario. ``lantern_core.world.m0`` implements it."""

    name: str
    config: dict[str, Any]
    ticks_per_hour: int

    def content_hash(self) -> str:
        """Digest of the scenario's static content (map, cast, schedules)."""

    def scene(self) -> dict[str, Any]:
        """The static content a client needs to draw the world, as canonical values."""

    def new_state(self, rng: Pcg32) -> dict[str, Any]:
        """The initial ``world`` state. It may draw from ``rng``."""

    def validate_player(self, body: dict[str, Any]) -> dict[str, Any]:
        """Check a player body and return it normalized, or raise ``InputError``."""

    def apply_player(self, ctx: Ctx, body: dict[str, Any]) -> None:
        """Apply a player action whose ``action_id`` is new."""

    def simulate(self, ctx: Ctx) -> None:
        """Advance the world by one tick, the tick ``ctx.tick``."""

    def holds(self, state: dict[str, Any], condition: dict[str, Any]) -> bool:
        """Whether one ``valid_if`` condition holds in ``state`` now."""

    def on_result(self, ctx: Ctx, request: dict[str, Any], status: str, text: str) -> None:
        """Apply the result of a request that is still valid, whatever its status."""

    def frame(self, state: dict[str, Any]) -> dict[str, Any]:
        """What the client draws at the end of a call. It has an ``npcs`` list."""

    def rate(self, state: dict[str, Any]) -> tuple[int, int]:
        """The speed of the clock as ``(num, den)``: ``10 * num / den`` ticks a second.

        It is part of the state, so that a scenario can change the pace of the world (run it fast
        for a while, say) and every host that replays the game sees the same rate at the same tick.
        """

    def halted(self, state: dict[str, Any]) -> bool:
        """Optional: whether the world holds its own clock, by what its state says.

        The kernel then neither simulates nor counts a tick, and says ``clock.paused`` to the host,
        as it does for a pause of the host. It is read after the inputs of a call and after the
        tick, from the state alone, so that it is the same in every replay and survives a snapshot.
        """


class Gate(Protocol):
    """What a world offers when it meters its model calls. The bridge world does, m0 does not.

    The kernel uses these three when the world has them and does without when it has not. Money
    is the gate's own business and lives in the world's state: the kernel only tells it when a
    request goes out, when one settles and when the host reports something about itself.
    """

    def admit(self, ctx: Ctx, request: dict[str, Any]) -> str | None:
        """Decide a request that is about to go out.

        The gate may change ``request["tier"]`` and must set ``request["hold"]``, the money it
        reserves for the request, which is a number of micro-yuan that counts against the budget
        for as long as the request is in flight. It returns ``None`` if the request goes out, or
        the reason (a short code) if it is turned away and the world gets its template outcome
        instead. It may emit events.
        """

    def settle(self, ctx: Ctx, request: dict[str, Any], usage: dict[str, int] | None) -> None:
        """Book the cost of a request that has settled. ``usage`` is None where it is unknown."""

    def on_host(self, ctx: Ctx, body: dict[str, Any]) -> None:
        """Apply a ``host`` event (see ``inputs.HOST_EVENTS``)."""


class Ctx:
    """What a world may do during one call: read the tick and the RNG, emit events, ask a model.

    One is made per call and thrown away with it. Events and requests collect here and become
    the outputs of the call.
    """

    __slots__ = (
        "cancels",
        "events",
        "kernel",
        "requests",
        "rng",
        "state",
        "templated",
        "tick",
    )

    def __init__(self, kernel: Kernel) -> None:
        self.kernel = kernel
        self.state: dict[str, Any] = kernel.state
        self.tick: int = kernel.state["tick"]
        self.rng = kernel.rng
        self.events: list[dict[str, Any]] = []
        self.requests: list[dict[str, Any]] = []
        self.cancels: list[str] = []
        self.templated: list[tuple[dict[str, Any], str]] = []

    def emit(self, kind: str, **fields: Any) -> None:
        """Add an event to the outputs and count it in the state version."""
        self.state["version"] += 1
        self.signal(kind, **fields)

    def signal(self, kind: str, **fields: Any) -> None:
        """Add an event to the outputs that the state does not count.

        It is for what only the host reads, such as the page's cue that a reply has come. Nothing
        in the world may depend on it, because it leaves no trace in the state: it is not in the
        version, and a game restored from a snapshot does not remember it.
        """
        event: dict[str, Any] = {"kind": kind, "tick": self.tick}
        event.update(fields)
        self.events.append(event)

    def issue(
        self,
        *,
        interaction_id: str,
        tier: str,
        category: str,
        messages: list[dict[str, str]],
        max_tokens: int,
        valid_if: list[dict[str, Any]],
    ) -> str:
        """Put a model request in flight and return its id.

        The id is ``r{tick}-{n}``, with ``n`` counting the requests issued at the tick over all the
        calls made at it. A stopped world takes the calls of a tick one after the other, and a
        replay makes one call of them, so the count is kept in the state (``state["issued"]``,
        ``[tick, n]``, which is there from the first request of a tick to the end of the tick) and
        the ids come out the same whichever way the calls were made. The request records the
        state version it was issued at, the conditions under which its result may still be
        applied, and the reservation: an upper bound on its cost in tokens, which is one input
        token per UTF-8 byte of the messages plus four per message for the role framing, and
        ``max_tokens`` for the output.

        If the world has a gate, the request goes through it before it is put in flight. It may
        go out on a lower tier than the one asked for, with the money it reserves in ``hold``.
        If the gate turns it away the id is still returned, nothing goes out, and the world is
        handed the template outcome once the code that is running returns (see
        ``Kernel._answer_templates``), the way a result from a host with no model would be.
        """
        if tier not in ledgers.TIERS:
            raise ValueError(f"unknown tier {tier!r}")
        if type(max_tokens) is not int or not 1 <= max_tokens <= MAX_REQUEST_TOKENS:
            raise ValueError(f"max_tokens must be an int in [1, {MAX_REQUEST_TOKENS}]")
        for message in messages:
            if message.get("role") not in ROLES or not isinstance(message.get("content"), str):
                raise ValueError("a message needs a role and a text content")
        mark = self.state.get("issued")
        number = mark[1] if mark is not None and mark[0] == self.tick else 0
        request_id = f"r{self.tick}-{number}"
        self.state["issued"] = [self.tick, number + 1]
        record: dict[str, Any] = {
            "request_id": request_id,
            "interaction_id": interaction_id,
            "issued_tick": self.tick,
            "state_version": self.state["version"],
            "valid_if": valid_if,
            "tier": tier,
            "category": category,
            "messages": messages,
            "max_tokens": max_tokens,
            "reserve": {
                "input_tokens": sum(len(m["content"].encode("utf-8")) + 4 for m in messages),
                "output_tokens": max_tokens,
            },
            "hold": 0,
            "cancel_sent": False,
        }
        gate = self.kernel.gate
        reason = None if gate is None else gate.admit(self, record)
        if reason is not None:
            self.templated.append((record, reason))
            return request_id
        self.state["requests"].append(record)
        self.state["ledger"][record["tier"]]["issued"] += 1
        self.requests.append({name: record[name] for name in REQUEST_FIELDS})
        return request_id


class Kernel:
    """A running game: the state, the scenario that interprets it, and the RNG object."""

    def __init__(self, state: dict[str, Any], world: World) -> None:
        self.state = state
        self.world = world
        self.gate: Gate | None = None
        if hasattr(world, "admit"):
            self.gate = world
        self.rng = Pcg32.from_state(state["rng"])
        self.last_applied: list[dict[str, Any]] = []
        self.last_hash: str | None = None

    @classmethod
    def create(cls, seed: int, scenario: str, config: dict[str, Any] | None) -> Kernel:
        """A new game at tick 0 of ``scenario`` with the RNG seeded from ``seed``."""
        if type(seed) is not int or not 0 <= seed <= canon.JS_SAFE_INT:
            raise ValueError(f"seed must be an int in [0, 2**53 - 1], got {seed!r}")
        world = create_world(scenario, config)
        rng = Pcg32(seed, RNG_STREAM)
        state: dict[str, Any] = {
            "format": FORMAT,
            "scenario": scenario,
            "seed": seed,
            "config": dict(world.config),
            "content_hash": world.content_hash(),
            "tick": 0,
            "paused": False,
            "next_seq": 0,
            "actions_seen": {},
            "version": 0,
            "requests": [],
            "ledger": ledgers.new(),
        }
        state["world"] = world.new_state(rng)
        state["rng"] = rng.to_state()
        canon.check(state)
        return cls(state, world)

    @classmethod
    def restore(cls, state: Any) -> Kernel:
        """Continue from a state produced by an earlier kernel, or refuse it."""
        if not isinstance(state, dict) or state.get("format") != FORMAT:
            found = state.get("format") if isinstance(state, dict) else None
            raise ValueError(f"snapshot format {found!r}, expected {FORMAT}")
        world = create_world(state["scenario"], state["config"])
        if state["content_hash"] != world.content_hash():
            raise ValueError("the snapshot was taken against different scenario content")
        return cls(state, world)

    def halted(self) -> bool:
        """Whether the world holds its own clock now: the world's answer, False if it has none."""
        hook = getattr(self.world, "halted", None)
        return hook is not None and bool(hook(self.state))

    def stopped(self) -> bool:
        """Whether a call would not simulate: the host paused the world, or the world holds it."""
        return self.state["paused"] or self.halted()

    def ending(self) -> dict[str, Any] | None:
        """The whole ending of the game, or ``None`` if it has not ended or has no endings.

        A world that has endings offers ``ending(state)``. The m0 world has none.
        """
        hook = getattr(self.world, "ending", None)
        return None if hook is None else hook(self.state)

    def preview(self, action: Any) -> dict[str, Any] | None:
        """What an action would ask, give and cost, or ``None`` for a world that has no previews.

        A world that has them offers ``preview(state, action)``, which only reads: it changes
        nothing in the state, draws nothing from the RNG and emits nothing.
        """
        hook = getattr(self.world, "preview", None)
        return None if hook is None else hook(self.state, action)

    def hash(self) -> str:
        """The state hash: SHA-256 of the canonical state."""
        self.state["rng"] = self.rng.to_state()
        return canon.digest(self.state)

    def snapshot(self) -> str:
        """The whole state in canonical form."""
        self.state["rng"] = self.rng.to_state()
        return canon.dumps_str(self.state)

    def header(self, core_version: str) -> dict[str, Any]:
        """What a replay needs to rebuild this game from tick 0."""
        state = self.state
        return {
            "format": FORMAT,
            "core_version": core_version,
            "content_hash": state["content_hash"],
            "scenario": state["scenario"],
            "config": dict(state["config"]),
            "seed": state["seed"],
        }

    def step(self, records: Any) -> dict[str, Any]:
        """Run one call (see the module docstring) and return its outputs."""
        state = self.state
        applied = inputs.normalize(records, state["next_seq"], self.world.validate_player)
        ctx = Ctx(self)
        for record in applied:
            state["next_seq"] = record["seq"] + 1
            self._apply(ctx, record)
            self._answer_templates(ctx)
        tick = ctx.tick
        advanced = not self.stopped()
        if advanced:
            self.world.simulate(ctx)
            self._answer_templates(ctx)
            self._cancel_invalid(ctx)
            state["tick"] = tick + 1
            state.pop("issued", None)  # the count of the requests of a tick ends with the tick
        state["rng"] = self.rng.to_state()
        outputs: dict[str, Any] = {
            "tick": tick,
            "advanced": advanced,
            "frame": self.world.frame(state),
            "events": ctx.events,
            "requests": ctx.requests,
            "cancels": ctx.cancels,
            "clock": {"paused": self.stopped(), "rate": list(self.world.rate(state))},
        }
        self.last_hash = None
        if advanced and tick % HASH_EVERY == 0:
            self.last_hash = outputs["hash"] = canon.digest(state)
        self.last_applied = applied
        return outputs

    def _apply(self, ctx: Ctx, record: dict[str, Any]) -> None:
        state = self.state
        kind, body = record["kind"], record["body"]
        if kind == "pause":
            state["paused"] = True
        elif kind == "resume":
            state["paused"] = False
        elif kind == "player":
            action_id = body["action_id"]
            if action_id in state["actions_seen"]:
                ctx.emit("action_ack", action_id=action_id, result="duplicate", reason=None)
            else:
                state["actions_seen"][action_id] = ctx.tick
                self.world.apply_player(ctx, body)
        elif kind == "host":
            if self.gate is not None:
                self.gate.on_host(ctx, body)
        else:
            self._land(ctx, body)

    def _land(self, ctx: Ctx, body: dict[str, Any]) -> None:
        """Settle the request a ``model_result`` names.

        The ledger books the result whatever happens to it, and so does the gate, which charges
        the usage the result reports or, where that is unknown, the whole reservation. A
        ``cancelled`` result is the host confirming an abort, and the world only closes what is
        still open. Any other result is applied only if the request was not cancelled and every
        ``valid_if`` condition holds now. Otherwise it is voided: it changes nothing but the
        ledger and the gate's books, and leaves a ``void`` event. A result for an id that is not
        in flight (an answer that arrives after its request timed out, or a repeated one) is
        voided too, and its usage is ``unattributed``. The gate does not charge it, since the
        settlement of the request already did.
        """
        state = self.state
        request_id, status, usage = body["request_id"], body["status"], body["usage"]
        requests = state["requests"]
        index = next((i for i, r in enumerate(requests) if r["request_id"] == request_id), None)
        if index is None:
            unattributed = state["ledger"]["unattributed"]
            unattributed["results"] += 1
            if usage is not None:
                unattributed["input_tokens"] += usage["input_tokens"]
                unattributed["output_tokens"] += usage["output_tokens"]
            ctx.emit(
                "void",
                request_id=request_id,
                interaction_id=None,
                status=status,
                reason="unknown_request",
            )
            return
        request = requests.pop(index)
        entry = state["ledger"][request["tier"]]
        entry["settled"] += 1
        entry[status] += 1
        ledgers.charge(entry, usage, request["reserve"])
        if self.gate is not None:
            self.gate.settle(ctx, request, usage)
        if status == "cancelled":
            self.world.on_result(ctx, request, status, "")
            return
        if request["cancel_sent"] or not self._holds(request):
            entry["voided"] += 1
            ctx.emit(
                "void",
                request_id=request_id,
                interaction_id=request["interaction_id"],
                status=status,
                reason="cancelled" if request["cancel_sent"] else "invalid",
            )
            return
        self.world.on_result(ctx, request, status, body["text"])

    def _answer_templates(self, ctx: Ctx) -> None:
        """Hand the world the template outcome of every request the gate turned away.

        It lands like an ``error`` result from a host with no model, at once and with the
        gate's reason as its text, and like any result it is voided if the conditions of the
        request no longer hold. Nothing of it reaches the ledger, since no call was made.
        Answering may issue requests that are turned away in turn: they are answered in rounds,
        and a world that keeps asking after ``MAX_TEMPLATE_ROUNDS`` of them is in error.
        """
        rounds = 0
        while ctx.templated:
            rounds += 1
            if rounds > MAX_TEMPLATE_ROUNDS:
                raise RuntimeError("template outcomes keep issuing requests that are turned away")
            batch, ctx.templated = ctx.templated, []
            for request, reason in batch:
                if self._holds(request):
                    self.world.on_result(ctx, request, "error", reason)
                else:
                    ctx.emit(
                        "void",
                        request_id=request["request_id"],
                        interaction_id=request["interaction_id"],
                        status="error",
                        reason="invalid",
                    )

    def _holds(self, request: dict[str, Any]) -> bool:
        return all(self.world.holds(self.state, c) for c in request["valid_if"])

    def _cancel_invalid(self, ctx: Ctx) -> None:
        for request in self.state["requests"]:
            if not request["cancel_sent"] and not self._holds(request):
                request["cancel_sent"] = True
                ctx.cancels.append(request["request_id"])
