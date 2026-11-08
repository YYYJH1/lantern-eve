"""An OpenAI-compatible server on 127.0.0.1 whose behaviour a test scripts in the prompt.

``POST /v1/chat/completions`` reads the text of the last user message as a command:

``ok [text]``        answer with ``text`` (default ``fake reply``) and a usage of 20 and 5 tokens
``status N``         answer with that status and an error body that quotes the Authorization header
``sleep S``          wait S seconds, then answer ``ok``
``hold NAME``        wait until the test sets the gate NAME (``fake.gate(NAME).set()``), then ``ok``
``slow500 S``        wait S seconds, then answer 500
``hang``             never answer
``drop``             close the connection without a word
``garbage``          200 with a body that is not JSON
``nochoice``         200 with an empty ``choices``
``errorbody``        200 with an ``error`` object
``nousage``          ``ok`` without a ``usage`` object
``badusage``         ``ok`` with usage counts that are not counts
``bigusage``         ``ok`` with usage counts far beyond what the core takes
``nullcontent``      ``ok`` whose content is null
``surrogate``        ``ok`` whose content holds a lone surrogate
``echokey``          ``ok`` whose text is the Authorization header, as a hostile service might
``huge``             200 with a body larger than the host reads

Anything else is ``ok``. ``GET /v1/models`` lists ``models`` with status ``models_status``. When
``key`` is set a request without that bearer token is answered 401.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

from aiohttp import web


@dataclass
class Seen:
    """One request the server received."""

    path: str
    headers: dict[str, str]
    body: dict[str, Any]
    order: int

    @property
    def content(self) -> str:
        users = [m["content"] for m in self.body.get("messages", []) if m["role"] == "user"]
        return users[-1] if users else ""

    @property
    def model(self) -> str:
        return self.body.get("model", "")


class FakeProvider:
    def __init__(
        self, *, models: tuple[str, ...] = ("fake-model",), key: str | None = None
    ) -> None:
        self.models = list(models)
        self.key = key
        self.models_status = 200
        self.models_body: Any = None
        self.models_delay = 0.0
        # Every answer waits this long, and every answer quotes the Authorization header in its
        # text when ``leak_key`` is set, as a hostile or careless service might.
        self.delay = 0.0
        self.leak_key = False
        self.seen: list[Seen] = []
        self.model_lists = 0
        self.active = 0
        self.peak = 0
        self.completed: list[str] = []
        self.aborted: list[str] = []
        self.arrivals: asyncio.Event | None = None
        self._gates: dict[str, asyncio.Event] = {}
        self._runner: web.AppRunner | None = None
        self.port = 0

    # --- Life cycle ---------------------------------------------------------------------------

    async def start(self, port: int = 0) -> FakeProvider:
        app = web.Application(client_max_size=1 << 22)
        app.router.add_post("/v1/chat/completions", self._chat)
        app.router.add_get("/v1/models", self._models)
        self._runner = web.AppRunner(app, handler_cancellation=True, shutdown_timeout=0.2)
        await self._runner.setup()
        await web.TCPSite(self._runner, "127.0.0.1", port).start()
        self.port = int(self._runner.addresses[0][1])
        return self

    async def stop(self) -> None:
        for gate in self._gates.values():
            gate.set()
        if self._runner is not None:
            await self._runner.cleanup()
            self._runner = None

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.port}/v1"

    def gate(self, name: str) -> asyncio.Event:
        return self._gates.setdefault(name, asyncio.Event())

    def release_all(self) -> None:
        for gate in self._gates.values():
            gate.set()

    # --- What the tests look at ---------------------------------------------------------------

    def contents(self) -> list[str]:
        """The command of every chat request, in the order they arrived."""
        return [seen.content for seen in self.seen]

    async def until_seen(self, n: int, timeout: float = 5.0) -> None:
        """Wait until ``n`` chat requests have arrived."""
        deadline = asyncio.get_running_loop().time() + timeout
        while len(self.seen) < n:
            if asyncio.get_running_loop().time() > deadline:
                raise TimeoutError(f"{len(self.seen)} requests arrived, expected {n}")
            await asyncio.sleep(0.005)

    # --- Handlers -----------------------------------------------------------------------------

    def _unauthorized(self, request: web.Request) -> web.Response | None:
        if self.key is not None and request.headers.get("Authorization") != f"Bearer {self.key}":
            return self._error(401, request)
        return None

    @staticmethod
    def _error(status: int, request: web.Request) -> web.Response:
        quoted = request.headers.get("Authorization", "")
        body = {"error": {"message": f"Incorrect API key provided: {quoted}", "type": "x"}}
        return web.json_response(body, status=status, headers={"Retry-After": "1"})

    async def _models(self, request: web.Request) -> web.Response:
        self.model_lists += 1
        if self.models_delay:
            await asyncio.sleep(self.models_delay)
        refused = self._unauthorized(request)
        if refused is not None:
            return refused
        if self.models_status != 200:
            return web.Response(status=self.models_status, text="no")
        body = self.models_body
        if body is None:
            body = {"object": "list", "data": [{"id": m, "object": "model"} for m in self.models]}
        return web.json_response(body)

    @staticmethod
    def _ok(seen: Seen, text: str = "fake reply", usage: Any = "default") -> web.Response:
        body: dict[str, Any] = {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "model": seen.model,
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": text},
                    "finish_reason": "stop",
                }
            ],
        }
        if usage == "default":
            usage = {"prompt_tokens": 20, "completion_tokens": 5, "total_tokens": 25}
        if usage is not None:
            body["usage"] = usage
        return web.json_response(body)

    async def _chat(self, request: web.Request) -> web.StreamResponse:
        refused = self._unauthorized(request)
        if refused is not None:
            return refused
        body = await request.json()
        seen = Seen(
            request.path,
            {k.lower(): v for k, v in request.headers.items()},
            body,
            len(self.seen),
        )
        self.seen.append(seen)
        self.active += 1
        self.peak = max(self.peak, self.active)
        if self.arrivals is not None:
            self.arrivals.set()
        try:
            response = await self._respond(seen, request)
            self.completed.append(seen.content)
            return response
        except asyncio.CancelledError:
            self.aborted.append(seen.content)
            raise
        finally:
            self.active -= 1

    async def _respond(self, seen: Seen, request: web.Request) -> web.StreamResponse:
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.leak_key:
            return self._ok(seen, text=request.headers.get("Authorization", ""))
        command, _, rest = seen.content.partition(" ")
        if command == "status":
            return self._error(int(rest), request)
        if command == "sleep":
            await asyncio.sleep(float(rest))
        elif command == "hold":
            await self.gate(rest).wait()
        elif command == "slow500":
            await asyncio.sleep(float(rest))
            return self._error(500, request)
        elif command == "hang":
            await asyncio.Event().wait()
        elif command == "drop":
            assert request.transport is not None
            request.transport.abort()
            await asyncio.sleep(1)
        elif command == "garbage":
            return web.Response(text="this is not json")
        elif command == "nochoice":
            return web.json_response({"choices": []})
        elif command == "errorbody":
            return web.json_response({"error": {"message": "quota", "code": 429}})
        elif command == "nousage":
            return self._ok(seen, usage=None)
        elif command == "badusage":
            return self._ok(seen, usage={"prompt_tokens": "many", "completion_tokens": -3})
        elif command == "bigusage":
            return self._ok(seen, usage={"prompt_tokens": 10**15, "completion_tokens": 2.0e12})
        elif command == "nullcontent":
            body = json.loads(self._ok(seen).text)
            body["choices"][0]["message"]["content"] = None
            return web.json_response(body)
        elif command == "surrogate":
            raw = self._ok(seen, text="x@@y").text.replace("@@", "\\ud800")
            return web.Response(text=raw, content_type="application/json")
        elif command == "echokey":
            return self._ok(seen, text=request.headers.get("Authorization", ""))
        elif command == "huge":
            return web.Response(body=b" " * ((1 << 20) + 10), content_type="application/json")
        elif command == "ok" and rest:
            return self._ok(seen, text=rest)
        return self._ok(seen)
