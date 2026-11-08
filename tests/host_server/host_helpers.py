"""Helpers for the server host tests: a virtual clock, a session factory, a driver."""

from __future__ import annotations

import asyncio
import html
import json
import random
import subprocess
import threading
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import aiohttp

from lantern_eve.clock import NS_PER_MS
from lantern_eve.server import HostOptions, ServerHost
from lantern_eve.session import GameSpec, Session
from lantern_eve.transport import mock_factory

# Meetings are denser and chats likelier than the scenario's defaults, so that a short run has
# many model requests in flight at once, and cancels (the same setting as the cross-host test).
DENSE = {"encounter_cooldown": 200, "chatter_per_mille": 850}
SUMMON = {"type": "summon", "npc": "npc03", "x": 31, "y": 10}


class VirtualClock:
    """A monotonic clock in nanoseconds that moves only when a test moves it."""

    def __init__(self) -> None:
        self.ns = 0

    def __call__(self) -> int:
        return self.ns

    def advance_ms(self, ms: float) -> None:
        self.ns += int(ms * NS_PER_MS)


def make_session(
    seed: int = 1,
    *,
    config: dict[str, int] | None = DENSE,
    factory=None,
    pace: int = 1,
    runs_dir=None,
    hidden: bool = False,
    sink=None,
    snapshot_every: int | None = None,
    scenario: str = "m0",
) -> tuple[Session, VirtualClock, list[dict[str, Any]]]:
    """A started session on a virtual clock, and the list its messages are appended to."""
    clock = VirtualClock()
    messages: list[dict[str, Any]] = []
    session = Session(
        "s-test",
        GameSpec(seed, scenario, config),
        factory or mock_factory(),
        now_ns=clock,
        wall_clock=lambda: datetime(2026, 11, 2, 12, 0, 0, tzinfo=UTC),
        pace=pace,
        runs_dir=runs_dir,
        snapshot_every=snapshot_every,
        sink=sink if sink is not None else messages.append,
    )
    session.start(hidden)
    return session, clock, messages


def wake_gaps(total_ms: int, seed: int, low: int = 1, high: int = 250) -> list[int]:
    """Random gaps in milliseconds that add up to exactly ``total_ms``."""
    rng = random.Random(seed)
    gaps: list[int] = []
    left = total_ms
    while left > 0:
        gap = min(left, rng.randint(low, high))
        gaps.append(gap)
        left -= gap
    return gaps


def drive(session: Session, clock: VirtualClock, gaps: list[int]) -> None:
    """Wake the session after each gap, as an event loop that sleeps for what it was told to."""
    for gap in gaps:
        clock.advance_ms(gap)
        session.pump()


def drive_to_tick(session: Session, clock: VirtualClock, tick: int, wake_ms: int = 100) -> None:
    """Advance the clock in steps of ``wake_ms`` until the world has simulated ``tick`` ticks."""
    guard = 0
    while session.next_tick < tick:
        clock.advance_ms(wake_ms)
        session.pump()
        guard += 1
        assert guard < 100_000, "the world does not advance"


def frames(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [m for m in messages if m["type"] == "frame"]


def kinds(session: Session) -> list[tuple[int, str]]:
    """The tape's (tick, kind) pairs without the model results."""
    return [(r[0], r[2]) for r in session.recorder.records if r[2] != "model_result"]


# --- A server over a real WebSocket -------------------------------------------------------------

CSP = (
    "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; "
    "img-src 'self' data:; connect-src 'self' https://example.invalid; worker-src 'self'; "
    "base-uri 'none'; form-action 'none'; object-src 'none'"
)


def make_web_dir(root: Path) -> Path:
    """A tiny stand-in for web/dist: a page with the policy in a <meta> tag, and a few files."""
    root.mkdir(parents=True, exist_ok=True)
    meta = html.escape(CSP, quote=True)
    (root / "index.html").write_text(
        f'<!doctype html><meta http-equiv="Content-Security-Policy" content="{meta}">'
        '<title>stand-in</title><script type="module" src="./assets/app.js"></script>',
        encoding="utf-8",
    )
    (root / "assets").mkdir(exist_ok=True)
    (root / "assets" / "app.js").write_text("export const x = 1;\n", encoding="utf-8")
    (root / "assets" / "app.css").write_text("body{margin:0}\n", encoding="utf-8")
    (root / "assets" / "core.wasm").write_bytes(b"\x00asm\x01\x00\x00\x00")
    (root / "assets" / "data.json").write_text("{}", encoding="utf-8")
    return root


@asynccontextmanager
async def serving(tmp_path: Path, **overrides: Any):
    """A server host on a free port, with a stand-in web dir. Stopped on exit."""
    web = overrides.pop("web_dir", None) or make_web_dir(tmp_path / "web")
    options = HostOptions(
        web_dir=web,
        runs_dir=tmp_path / "runs",
        config=overrides.pop("config", DENSE),
        pace=overrides.pop("pace", 20),
        **overrides,
    )
    host = ServerHost(options)
    await host.start(0)
    try:
        yield host
    finally:
        await host.stop()


class Client:
    """A page's side of the WebSocket, with every message it received."""

    def __init__(self, http: aiohttp.ClientSession, ws: aiohttp.ClientWebSocketResponse) -> None:
        self.http = http
        self.ws = ws
        self.received: list[dict[str, Any]] = []

    @classmethod
    async def connect(cls, host: ServerHost, **headers: str) -> Client:
        return await cls.connect_port(host.port, **headers)

    @classmethod
    async def connect_port(cls, port: int, **headers: str) -> Client:
        http = aiohttp.ClientSession()
        try:
            ws = await http.ws_connect(f"ws://127.0.0.1:{port}/ws", headers=headers or None)
        except BaseException:
            await http.close()
            raise
        return cls(http, ws)

    async def send(self, message: dict[str, Any]) -> None:
        await self.ws.send_str(json.dumps(message))

    async def hello(self, **fields: Any) -> None:
        await self.send({"type": "hello", "version": 1, **fields})

    async def recv(self, timeout: float = 10.0) -> dict[str, Any]:
        text = await asyncio.wait_for(self.ws.receive_str(), timeout)
        message = json.loads(text)
        self.received.append(message)
        return message

    async def until(self, kind: str, timeout: float = 10.0, **match: Any) -> dict[str, Any]:
        """Read until a message of ``kind`` (with the given fields) arrives, and return it."""
        deadline = asyncio.get_running_loop().time() + timeout
        while True:
            left = deadline - asyncio.get_running_loop().time()
            if left <= 0:
                raise TimeoutError(f"no {kind} {match} in {timeout} s; got {self.kinds()[-12:]}")
            message = await self.recv(left)
            if message["type"] == kind and all(message.get(k) == v for k, v in match.items()):
                return message

    async def frames(self, n: int, timeout: float = 10.0) -> list[dict[str, Any]]:
        """The next ``n`` frames."""
        out: list[dict[str, Any]] = []
        while len(out) < n:
            out.append(await self.until("frame", timeout))
        return out

    async def quiet(self, seconds: float) -> list[dict[str, Any]]:
        """Everything that arrives in the next ``seconds``."""
        got: list[dict[str, Any]] = []
        end = asyncio.get_running_loop().time() + seconds
        while (left := end - asyncio.get_running_loop().time()) > 0:
            try:
                got.append(await self.recv(left))
            except TimeoutError:
                break
        return got

    def kinds(self) -> list[str]:
        return [m["type"] for m in self.received]

    async def close(self) -> None:
        await self.ws.close()
        await self.http.close()

    async def drop(self) -> None:
        """Go away without the closing handshake, as a page whose network died does."""
        await self.http.close()


async def wait_for(condition, timeout: float = 5.0, step: float = 0.01) -> None:
    """Poll until ``condition()`` is true."""
    deadline = asyncio.get_running_loop().time() + timeout
    while not condition():
        if asyncio.get_running_loop().time() > deadline:
            raise TimeoutError("the condition did not come true")
        await asyncio.sleep(step)


def read_first_line(proc: subprocess.Popen, timeout: float = 60.0) -> str:
    """The first line the process prints, or a failure with what it printed instead."""
    box: list[str] = []
    reader = threading.Thread(target=lambda: box.append(proc.stdout.readline()), daemon=True)
    reader.start()
    reader.join(timeout)
    assert box and box[0], f"no first line in {timeout} s (exit status {proc.poll()})"
    return box[0].strip()
