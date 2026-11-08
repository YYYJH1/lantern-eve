"""One call to an OpenAI-compatible service: the request body, the HTTP exchange and its outcome.

``ChatClient.complete`` posts a request to ``{base_url}/chat/completions`` and turns whatever
comes back into a ``CallResult``. Calls are not streamed. The page only ever shows a sentence
that has passed the checks of the core as a whole, so the text of a call is of no use before the
call is over, and a reply that arrives in one JSON body has one failure mode where a stream has
several (a cut stream, a missing last chunk, a missing usage). ``usage`` comes from the body.

What the outcome says about the cost matters, because the budget gate of the core books it:

- A call the service answered with a 4xx status generated nothing, and a call that never got a
  connection (no route, no DNS, a refused connection, a proxy that would not tunnel) was never
  sent. Both cost nothing, and their usage is zero.
- After a 5xx status, a connection lost once the request was out, or a body that cannot be read,
  nobody knows what was generated, so the usage is None and the core books the whole reservation.
- A reply without a ``usage`` object has no usage either.

An error carries a short code and never a word the service said: services echo parts of the key
in their error messages. The codes are ``http_<status>``, ``network``, ``bad_body`` and
``provider_error``.

A provider on this machine is reached directly, whatever proxy the environment names. A remote
one goes through the proxy of the environment (``HTTPS_PROXY`` and ``NO_PROXY``, which aiohttp
reads). A SOCKS proxy in ``ALL_PROXY`` is not used.
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

import aiohttp

import lantern_eve
from lantern_eve.providers import Provider
from lantern_eve.scrub import SCRUBBER, Scrubber
from lantern_eve.transport import Status

ZERO_USAGE = {"input_tokens": 0, "output_tokens": 0}
# The most tokens the core takes in one count (lantern_core.inputs.MAX_TOKENS).
MAX_COUNT = 2**31
# A reply is a few hundred tokens. A body larger than this is not one.
MAX_BODY_BYTES = 1 << 20
USER_AGENT = f"lantern-eve/{lantern_eve.__version__}"
LONE_SURROGATE = re.compile("[\ud800-\udfff]")


@dataclass(frozen=True)
class CallResult:
    """How a call ended, before the transport gives it a request id and a latency."""

    status: Status
    text: str = ""
    usage: Mapping[str, int] | None = None
    code: str | None = None
    # Whether the service answered with an HTTP response (of any status), which is to say that
    # the network works. Nothing else counts as reaching it.
    reached: bool = False


def error(code: str, *, usage: Mapping[str, int] | None, reached: bool) -> CallResult:
    return CallResult("error", text=code, usage=usage, code=code, reached=reached)


class _TooLarge(Exception):
    pass


def request_body(
    provider: Provider, model: str, request: Mapping[str, Any], cap: int | None
) -> dict[str, Any]:
    """The JSON body of a chat completion for ``request``.

    The fields that switch thinking off come first, so that the ones the host decides cannot be
    overridden by them. The output is capped at the lower of what the core asked for and the
    provider's own cap, never above the first.
    """
    max_tokens = int(request["max_tokens"])
    if cap is not None:
        max_tokens = min(max_tokens, cap)
    return {
        **provider.extra_body,
        "model": model,
        "messages": [{"role": m["role"], "content": m["content"]} for m in request["messages"]],
        provider.max_tokens_field: max_tokens,
        "stream": False,
    }


def _count(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return None if value < 0 else min(int(value), MAX_COUNT)


def read_usage(data: Mapping[str, Any]) -> dict[str, int] | None:
    """The usage a body reports, or None where it reports none or reports it badly."""
    raw = data.get("usage")
    if not isinstance(raw, dict):
        return None
    tokens_in, tokens_out = _count(raw.get("prompt_tokens")), _count(raw.get("completion_tokens"))
    if tokens_in is None or tokens_out is None:
        return None
    return {"input_tokens": tokens_in, "output_tokens": tokens_out}


def read_text(data: Mapping[str, Any]) -> str | None:
    """The text of the first choice, or None where the body has no choice to read."""
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        return None
    message = choices[0].get("message")
    if not isinstance(message, dict):
        return None
    content = message.get("content")
    return content if isinstance(content, str) else ""


class ChatClient:
    """HTTP sessions for the providers of one transport. Create it inside a running event loop."""

    def __init__(self, connect_s: float, scrubber: Scrubber = SCRUBBER) -> None:
        self.connect_s = connect_s
        self.scrubber = scrubber
        # One session that follows the proxy of the environment, one that never does.
        self._sessions: dict[bool, aiohttp.ClientSession] = {}

    def _session(self, provider: Provider) -> aiohttp.ClientSession:
        use_env = not provider.loopback
        session = self._sessions.get(use_env)
        if session is None:
            timeout = aiohttp.ClientTimeout(
                total=None, connect=self.connect_s, sock_connect=self.connect_s
            )
            session = aiohttp.ClientSession(trust_env=use_env, timeout=timeout)
            self._sessions[use_env] = session
        return session

    async def aclose(self) -> None:
        sessions, self._sessions = list(self._sessions.values()), {}
        for session in sessions:
            await session.close()

    @staticmethod
    def _headers(key: str | None) -> dict[str, str]:
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        }
        if key:
            headers["Authorization"] = f"Bearer {key}"
        return headers

    async def complete(
        self, provider: Provider, key: str | None, body: Mapping[str, Any]
    ) -> CallResult:
        """Make the call. Raises nothing but ``asyncio.CancelledError``."""
        url = f"{provider.base_url}/chat/completions"
        try:
            async with self._session(provider).post(
                url, json=body, headers=self._headers(key), allow_redirects=False
            ) as response:
                status = response.status
                if not 200 <= status < 300:
                    # The body is not read: it may quote the key.
                    usage = ZERO_USAGE if 400 <= status < 500 else None
                    return error(f"http_{status}", usage=usage, reached=True)
                raw = await _read(response)
        except _TooLarge:
            return error("bad_body", usage=None, reached=True)
        except (aiohttp.ClientConnectorError, aiohttp.ClientHttpProxyError):
            return error("network", usage=ZERO_USAGE, reached=False)
        except (aiohttp.ClientError, OSError, TimeoutError):
            return error("network", usage=None, reached=False)
        return self._parse(raw)

    def _parse(self, raw: bytes) -> CallResult:
        try:
            data = json.loads(raw)
        except ValueError:
            return error("bad_body", usage=None, reached=True)
        if not isinstance(data, dict):
            return error("bad_body", usage=None, reached=True)
        if data.get("error"):
            return error("provider_error", usage=None, reached=True)
        text = read_text(data)
        if text is None:
            return error("bad_body", usage=None, reached=True)
        # The core refuses a text with a lone surrogate, and a service can send one.
        text = LONE_SURROGATE.sub("\ufffd", self.scrubber.scrub(text))
        return CallResult("ok", text=text, usage=read_usage(data), reached=True)

    async def models(
        self, provider: Provider, key: str | None, timeout_s: float
    ) -> tuple[int, Any] | None:
        """The model list of a service as ``(status, parsed body)``, or None if it did not answer.

        The body is None where the status is not 200 or the body is not JSON.
        """
        url = f"{provider.base_url}/models"
        timeout = aiohttp.ClientTimeout(total=timeout_s, connect=timeout_s, sock_connect=timeout_s)
        status = 0
        try:
            async with self._session(provider).get(
                url, headers=self._headers(key), allow_redirects=False, timeout=timeout
            ) as response:
                status = response.status
                if status != 200:
                    return status, None
                raw = await _read(response)
            return status, json.loads(raw)
        except (aiohttp.ClientError, OSError, TimeoutError):
            return None
        except (_TooLarge, ValueError):
            return status, None


async def _read(response: aiohttp.ClientResponse) -> bytes:
    chunks: list[bytes] = []
    size = 0
    async for chunk in response.content.iter_chunked(1 << 16):
        size += len(chunk)
        if size > MAX_BODY_BYTES:
            raise _TooLarge
        chunks.append(chunk)
    return b"".join(chunks)
