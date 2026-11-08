"""The server host: one port for the built web client and the WebSocket, one Session per game.

``ServerHost`` is an aiohttp application bound to 127.0.0.1. ``GET /ws`` upgrades to the
WebSocket protocol of ``protocol.py``, ``GET /api/replays`` and ``GET /api/replays/<id>`` list and
return the replays in the runs folder (``replays.py``, read only), and every other GET is a file of
the built client. Each connection says ``hello`` and is attached to a ``Session``, a new one or one
it left earlier. A session keeps running while a connection is attached and is held while none is.

Three checks keep a page of another origin from driving a game on this machine. The Host header
must name the loopback interface, which stops DNS rebinding. A WebSocket handshake with an Origin
header must come from the page's own origin. And the server binds nothing but 127.0.0.1.
"""

from __future__ import annotations

import asyncio
import json
import logging
import platform
import secrets
import threading
from collections import deque
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from aiohttp import WSMsgType, web

import lantern_eve
from lantern_core.api import InputError, preset
from lantern_eve import protocol
from lantern_eve.protocol import ProtocolError
from lantern_eve.replays import MAX_BYTES, Cache, list_replays, replay_path
from lantern_eve.session import CLOSED, GameSpec, Session
from lantern_eve.static import (
    WebDirError,
    content_type,
    default_web_dir,
    load_policy,
    resolve,
)
from lantern_eve.transport import Transport, mock_factory

LOG = logging.getLogger("lantern_eve")
LOOPBACK = ("127.0.0.1", "localhost", "::1")
BIND = "127.0.0.1"
# What the full state holds in itself, so that a page that falls behind loses these without a gap.
KINDS_COVERED_BY_STATE = ("frame", "stats", "model-calls")

TransportFactory = Callable[[GameSpec], Transport]


@dataclass
class HostOptions:
    """What a server host needs to know. The defaults are for ``lantern-eve play``."""

    # The built client. None looks for one (see static.default_web_dir). With none, only /ws works.
    web_dir: Path | None = None
    # Where replays go. None writes none.
    runs_dir: Path | None = Path("runs")
    transport_factory: TransportFactory | None = None
    transport_name: str = "mock"
    default_seed: int | None = None
    default_scenario: str = "m0"
    # A game of the core by name (``slice``) for a page that names no seed and no preset. Its seed
    # and scenario are used unless ``default_seed`` and ``default_scenario`` say otherwise.
    default_preset: str | None = None
    config: dict[str, int | str] | None = None
    # The config keys the host adds to a game of a scenario, such as the prices of the models.
    # What ``config`` sets, key by key, wins over them.
    game_config: Callable[[str], dict[str, int]] | None = None
    # Multiplies real time. For tests; 1 is the speed of the game.
    pace: int = 1
    snapshot_every: int | None = None
    heartbeat_s: float = 20.0
    hello_timeout_s: float = 10.0
    # How long to wait for a page to answer the server's close before the socket is dropped.
    close_timeout_s: float = 2.0
    # How long a session lives with nobody attached before it is closed.
    detached_ttl_s: float = 900.0
    max_sessions: int = 16
    # Messages that may wait for a page that reads slowly before frames are dropped for a state.
    queue_max: int = 512


def dumps(message: dict[str, Any]) -> str:
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))


class Connection:
    """One WebSocket and the messages waiting to go out on it.

    The session offers messages without waiting. A writer task sends them in order. A page that
    reads slowly would make the queue grow, and then the queued frames and stats are dropped and
    the page is sent the full state instead, which covers them. The page sees a state whose
    ``seq`` is past the last frame it has, and goes on from there.
    """

    def __init__(self, ws: web.WebSocketResponse, queue_max: int) -> None:
        self.ws = ws
        self.queue_max = queue_max
        self.queue: deque[dict[str, Any]] = deque()
        self.wake = asyncio.Event()
        self.closed = False
        self.needs_state = False
        self.state_since: int | None = None
        self.state_source: Callable[[int | None], dict[str, Any]] | None = None
        # The seq of the last frame or state sent, which is where a page that fell behind resumes.
        self.last_seq = 0
        self.dropped = 0

    def offer(self, message: dict[str, Any]) -> None:
        if self.closed:
            return
        kind = message["type"]
        if self.needs_state and kind in KINDS_COVERED_BY_STATE:
            self.dropped += 1
            return
        if len(self.queue) >= self.queue_max:
            kept = deque(m for m in self.queue if m["type"] not in KINDS_COVERED_BY_STATE)
            self.dropped += len(self.queue) - len(kept)
            self.queue = kept
            if len(kept) >= self.queue_max:
                self.closed = True  # a page that does not read at all
                self.wake.set()
                return
            self.request_state(self.last_seq)
            if kind in KINDS_COVERED_BY_STATE:
                self.dropped += 1
                return
        self.queue.append(message)
        self.wake.set()

    def request_state(self, since: int | None) -> None:
        """Have the full state sent next, with the events after ``since``."""
        self.needs_state = True
        self.state_since = since
        self.wake.set()

    async def write_loop(self) -> None:
        try:
            while not self.closed:
                if not self.needs_state and not self.queue:
                    self.wake.clear()
                    await self.wake.wait()
                    continue
                if self.needs_state and self.state_source is not None:
                    self.needs_state = False
                    message = self.state_source(self.state_since)
                    self.state_since = None
                elif self.queue:
                    message = self.queue.popleft()
                else:
                    self.needs_state = False
                    continue
                if message["type"] in ("frame", "state"):
                    self.last_seq = message["seq"]
                await self.ws.send_str(dumps(message))
        except (ConnectionError, RuntimeError):
            pass  # the socket closed under the writer
        finally:
            self.closed = True


class ServerHost:
    def __init__(self, options: HostOptions | None = None) -> None:
        self.options = options or HostOptions()
        self.sessions: dict[str, Session] = {}
        self.connections: dict[str, Connection] = {}
        self.factory = self.options.transport_factory or mock_factory()
        self.web_dir = self.options.web_dir or default_web_dir()
        self.csp = load_policy(self.web_dir) if self.web_dir is not None else None
        self.port: int | None = None
        self._expiry: dict[str, asyncio.TimerHandle] = {}
        self._closing: set[asyncio.Task[None]] = set()
        # What was read of the replay files for the list, by file name, size and time of change.
        # Lists are made on a thread of the executor, one at a time.
        self._replay_cache: Cache = {}
        self._replay_lock = threading.Lock()
        self.app = web.Application(middlewares=[self._guard])
        self.app.on_response_prepare.append(self._headers)
        self.app.router.add_get("/ws", self._ws)
        self.app.router.add_get("/api/replays", self._replays)
        self.app.router.add_get("/api/replays/{name}", self._replay_file)
        self.app.router.add_get("/{tail:.*}", self._static)
        self.runner: web.AppRunner | None = None

    # --- Start and stop -----------------------------------------------------------------------

    async def start(self, port: int = 0) -> int:
        """Listen on 127.0.0.1. ``port=0`` takes a free one. Returns the port."""
        self.runner = web.AppRunner(self.app, access_log=None, shutdown_timeout=2.0)
        await self.runner.setup()
        await web.TCPSite(self.runner, BIND, port).start()
        self.port = int(self.runner.addresses[0][1])
        return self.port

    @property
    def url(self) -> str:
        return f"http://{BIND}:{self.port}/"

    async def stop(self) -> None:
        """End every session (writing its replay), close the connections and stop listening."""
        for handle in self._expiry.values():
            handle.cancel()
        self._expiry.clear()
        for session in list(self.sessions.values()):
            await session.aclose()
            path = session.replay_path()
            if path is not None:
                LOG.info("session %s: replay written to %s", session.id, path)
        for conn in list(self.connections.values()):
            await conn.ws.close(code=1001, message=b"server stopping")
        self.sessions.clear()
        if self._closing:
            await asyncio.gather(*self._closing, return_exceptions=True)
        if self.runner is not None:
            await self.runner.cleanup()
            self.runner = None

    # --- HTTP ---------------------------------------------------------------------------------

    @web.middleware
    async def _guard(
        self, request: web.Request, handler: Callable[[web.Request], Awaitable[web.StreamResponse]]
    ) -> web.StreamResponse:
        hostname = urlsplit(f"//{request.host}").hostname
        if hostname not in LOOPBACK:
            return web.Response(status=403, text="this server answers on the loopback address only")
        return await handler(request)

    async def _headers(self, request: web.Request, response: web.StreamResponse) -> None:
        response.headers["X-Content-Type-Options"] = "nosniff"
        if self.csp is not None:
            response.headers["Content-Security-Policy"] = self.csp

    async def _static(self, request: web.Request) -> web.StreamResponse:
        if self.web_dir is None:
            return web.Response(
                status=404, text="the web client is not built: run npm run build in web/"
            )
        path = resolve(self.web_dir, request.path)
        if path is None:
            return web.Response(status=404, text="not found")
        data = await asyncio.get_running_loop().run_in_executor(None, path.read_bytes)
        return web.Response(
            body=data, headers={"Content-Type": content_type(path), "Cache-Control": "no-cache"}
        )

    async def _replays(self, request: web.Request) -> web.StreamResponse:
        """The list of the replays in the runs folder, newest first."""
        loop = asyncio.get_running_loop()
        found = await loop.run_in_executor(None, self._list_replays)
        return web.Response(
            text=dumps({"replays": found}),
            content_type="application/json",
            charset="utf-8",
            headers={"Cache-Control": "no-cache"},
        )

    def _list_replays(self) -> list[dict[str, Any]]:
        with self._replay_lock:
            return list_replays(self.options.runs_dir, self._replay_cache)

    async def _replay_file(self, request: web.Request) -> web.StreamResponse:
        """One replay file of the runs folder, as it is. Nothing outside the folder is named."""
        path = replay_path(self.options.runs_dir, request.match_info["name"])
        if path is None:
            return web.Response(status=404, text="not found")
        try:
            if path.stat().st_size > MAX_BYTES:
                return web.Response(status=413, text="that replay is too large to serve")
            data = await asyncio.get_running_loop().run_in_executor(None, path.read_bytes)
        except OSError:
            return web.Response(status=404, text="not found")
        return web.Response(
            body=data,
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "Cache-Control": "no-cache",
            },
        )

    # --- The WebSocket ------------------------------------------------------------------------

    async def _ws(self, request: web.Request) -> web.StreamResponse:
        origin = request.headers.get("Origin")
        if origin is not None and urlsplit(origin).netloc.lower() != request.host.lower():
            return web.Response(status=403, text="a page of another origin may not use this server")
        ws = web.WebSocketResponse(
            heartbeat=self.options.heartbeat_s,
            max_msg_size=protocol.MAX_MESSAGE_BYTES,
            timeout=self.options.close_timeout_s,
        )
        await ws.prepare(request)
        conn = Connection(ws, self.options.queue_max)
        writer = asyncio.get_running_loop().create_task(conn.write_loop())
        session: Session | None = None
        try:
            session = await self._hello(ws, conn)
            if session is not None:
                async for message in ws:
                    if message.type == WSMsgType.TEXT:
                        self._on_text(conn, session, message.data)
                    elif message.type == WSMsgType.BINARY:
                        conn.offer(_notice("bad_message", "binary frames are not used"))
                    else:
                        break
        finally:
            conn.closed = True
            conn.wake.set()
            writer.cancel()
            await asyncio.gather(writer, return_exceptions=True)
            if session is not None:
                self._detached(session, conn)
            if not ws.closed:
                await ws.close()
        return ws

    async def _hello(self, ws: web.WebSocketResponse, conn: Connection) -> Session | None:
        """Read the first message and attach the connection to a session, or refuse it."""
        try:
            first = await asyncio.wait_for(ws.receive(), self.options.hello_timeout_s)
            if first.type != WSMsgType.TEXT:
                raise ProtocolError("bad_message", "the first message must be a hello")
            message = protocol.parse(first.data)
            if message["type"] != "hello":
                raise ProtocolError("bad_message", "the first message must be a hello")
            fields = protocol.hello_fields(message)
            return self._attach(conn, fields)
        except (ProtocolError, ValueError) as err:
            code = err.code if isinstance(err, ProtocolError) else "bad_game"
            text = err.message if isinstance(err, ProtocolError) else str(err)
            await self._refuse(ws, code, text)
        except TimeoutError:
            await self._refuse(ws, "bad_hello", "no hello within the time allowed")
        return None

    async def _refuse(self, ws: web.WebSocketResponse, code: str, message: str) -> None:
        if not ws.closed:
            await ws.send_str(dumps({"type": "fatal", "code": code, "message": message}))
            await ws.close(code=protocol.CLOSE_BAD_HELLO, message=code.encode())

    def _attach(self, conn: Connection, fields: dict[str, Any]) -> Session:
        sid = fields["session"]
        session = self.sessions.get(sid) if sid is not None else None
        resumed = session is not None
        if session is None:
            if len(self.sessions) >= self.options.max_sessions:
                raise ProtocolError("busy", "this server is running as many games as it will")
            session = self._new_session(fields)
        else:
            self._cancel_expiry(session.id)
            old = self.connections.get(session.id)
            if old is not None:
                # The newer connection takes the game over. The older one is told and closed.
                task = asyncio.get_running_loop().create_task(
                    old.ws.close(code=protocol.CLOSE_REPLACED, message=b"replaced")
                )
                self._closing.add(task)
                task.add_done_callback(self._closing.discard)
            # Nobody is told while the world takes up where it was held: the state below says it.
            session.sink = None
            session.set_hidden(fields["hidden"])
            session.resume("offline")
        if resumed:
            LOG.info("session %s: a page came back", session.id)
        conn.state_source = session.state_message
        conn.offer(self._welcome(session, resumed))
        conn.offer(session.state_message(fields["since"] if resumed else None))
        self.connections[session.id] = conn
        session.attach(conn.offer)
        return session

    def _new_session(self, fields: dict[str, Any]) -> Session:
        options = self.options
        seed, scenario = fields["seed"], fields["scenario"]
        named = fields["preset"]
        by_default = named is None and seed is None and options.default_preset is not None
        if by_default:
            named = options.default_preset
        config: dict[str, int | str] = {}
        if named is not None:
            # A game of the core by name: its seed, its scenario and its config are the core's.
            # (A name it does not know is a ValueError, and the connection is refused for it.)
            game = preset(named)
            seed, scenario = game["seed"], game["scenario"]
            config.update(game["config"])
            if by_default and options.default_seed is not None:
                seed = options.default_seed  # --seed says which seed the preset is played at
        if seed is None:
            seed = (
                options.default_seed
                if options.default_seed is not None
                else secrets.randbelow(2**31)
            )
        scenario = scenario or options.default_scenario
        config.update(options.game_config(scenario) if options.game_config else {})
        config.update(options.config or {})
        spec = GameSpec(seed, scenario, config or None)
        session = Session(
            f"s-{secrets.token_hex(6)}",
            spec,
            self.factory,
            pace=options.pace,
            runs_dir=options.runs_dir,
            snapshot_every=options.snapshot_every,
            config_for=options.game_config,
        )
        session.start(fields["hidden"])
        session.start_loop()
        self.sessions[session.id] = session
        LOG.info("session %s: a new game, seed %d, scenario %s", session.id, seed, spec.scenario)
        return session

    def _welcome(self, session: Session, resumed: bool) -> dict[str, Any]:
        return {
            "type": "welcome",
            "version": protocol.PROTOCOL_VERSION,
            "session": session.id,
            "resumed": resumed,
            "seed": session.spec.seed,
            "scenario": session.spec.scenario,
            "core": session.core_info(),
            "python": platform.python_version(),
            "host": {"name": "server", "version": lantern_eve.__version__},
            "transport": self.options.transport_name,
        }

    def _on_text(self, conn: Connection, session: Session, text: str) -> None:
        try:
            self._dispatch(conn, session, protocol.parse(text))
        except ProtocolError as err:
            conn.offer(_notice(err.code, err.message))
        except Exception:  # a bug in the host must not end the connection
            LOG.exception("handling a message of session %s", session.id)
            conn.offer(_notice("host_error", "the server could not handle that message"))

    def _dispatch(self, conn: Connection, session: Session, message: dict[str, Any]) -> None:
        kind = message["type"]
        if kind == "pause":
            session.pause(protocol.pause_reason(message))
        elif kind == "resume":
            session.resume(protocol.pause_reason(message))
        elif kind == "player":
            session.player(protocol.player_body(message))
        elif kind == "new-game":
            seed, scenario, named, variant = protocol.new_game_fields(message)
            try:
                if named is not None:
                    game = preset(named, seed=seed, variant=variant)
                    session.new_game(game["seed"], game["scenario"], game["config"])
                else:
                    assert seed is not None
                    session.new_game(seed, scenario)
            except ValueError as err:
                raise ProtocolError("bad_game", str(err)) from None
            conn.offer(session.state_message())
        elif kind == "resync":
            conn.request_state(protocol.resync_since(message))
        elif kind == "call":
            req_id, op = protocol.call_fields(message)
            if op == "preview":
                conn.offer(self._preview(session, req_id, protocol.call_action(message)))
            else:
                conn.offer(self._call(session, req_id, op))
        elif kind == "configure":
            conn.offer(
                _notice("server_model", "the model provider is set on the server, not by the page")
            )
        elif kind == "e2e":
            req_id = message.get("reqId")
            conn.offer(_reply_error(req_id, "unsupported", "test hooks belong to the browser host"))
        elif kind == "hello":
            raise ProtocolError("bad_message", "already said hello")
        else:
            raise ProtocolError("bad_message", f"unknown message type {kind!r}")

    @staticmethod
    def _preview(session: Session, req_id: int, action: dict[str, Any]) -> dict[str, Any]:
        try:
            result = session.preview(action)
        except InputError as err:  # a verb, a person or a field the core cannot read
            return _reply_error(req_id, "bad_action", str(err))
        return {"type": "reply", "reqId": req_id, "ok": True, "result": result}

    @staticmethod
    def _call(session: Session, req_id: int, op: str) -> dict[str, Any]:
        if op == "export":
            return {"type": "reply", "reqId": req_id, "ok": True, "result": session.replay()}
        if op == "ending":
            return {"type": "reply", "reqId": req_id, "ok": True, "result": session.ending()}
        if op == "list-saves":
            return {"type": "reply", "reqId": req_id, "ok": True, "result": []}
        return _reply_error(req_id, "unsupported", f"{op}: saves belong to the browser host")

    # --- Sessions without a connection --------------------------------------------------------

    def _detached(self, session: Session, conn: Connection) -> None:
        session.detach(conn.offer)
        if self.connections.get(session.id) is conn:
            del self.connections[session.id]
        if session.sink is None and session.id in self.sessions and session.mode != CLOSED:
            loop = asyncio.get_running_loop()
            ttl = self.options.detached_ttl_s
            self._expiry[session.id] = loop.call_later(ttl, self._expire, session.id)

    def _cancel_expiry(self, session_id: str) -> None:
        handle = self._expiry.pop(session_id, None)
        if handle is not None:
            handle.cancel()

    def _expire(self, session_id: str) -> None:
        self._expiry.pop(session_id, None)
        session = self.sessions.pop(session_id, None)
        if session is not None:
            LOG.info(
                "session %s: closed, nobody came back in %s s",
                session.id,
                self.options.detached_ttl_s,
            )
            task = asyncio.get_running_loop().create_task(session.aclose())
            self._closing.add(task)
            task.add_done_callback(self._closing.discard)


def _notice(code: str, message: str) -> dict[str, Any]:
    return {"type": "notice", "code": code, "message": message}


def _reply_error(req_id: Any, code: str, message: str) -> dict[str, Any]:
    return {
        "type": "reply",
        "reqId": req_id if type(req_id) is int else None,
        "ok": False,
        "error": {"code": code, "message": message},
    }


__all__ = ["HostOptions", "ServerHost", "WebDirError", "mock_factory"]
