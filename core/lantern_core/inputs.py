"""Validation of the inputs a host hands to the core.

The whole list of one call is checked before any of it is applied, so a refused call leaves the
world untouched and the host can drop or repair the list. What passes comes back as normalized
copies (only the known keys, defaults filled in), and those copies, not what the host sent, are
what a replay logs. Fields the host adds beyond the documented ones are ignored.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

KINDS = ("pause", "resume", "player", "model_result", "host")
STATUSES = ("ok", "timeout", "cancelled", "error")
# What a host can tell the core about itself: whether the model service can be reached, and
# whether a local model can take requests. A game starts with the cloud up and no local model.
HOST_EVENTS = ("cloud_down", "cloud_up", "local_down", "local_up")
MAX_ID_CHARS = 64
MAX_TOKENS = 2**31


class InputError(ValueError):
    """The host sent a record, or a list of records, that the core refuses."""


def normalize(
    records: Any, next_seq: int, validate_player: Callable[[dict[str, Any]], dict[str, Any]]
) -> list[dict[str, Any]]:
    """Check a call's list of records and return normalized copies, or raise ``InputError``.

    ``seq`` must be an int that is at least ``next_seq`` and larger than the one before it, the
    kind must be one of ``KINDS``, and the body must fit the kind. ``validate_player`` checks the
    scenario's part of a player body and returns it normalized.
    """
    if not isinstance(records, list):
        raise InputError("inputs must be a JSON list")
    normalized: list[dict[str, Any]] = []
    expected = next_seq
    for i, record in enumerate(records):
        where = f"input {i}"
        if not isinstance(record, dict):
            raise InputError(f"{where}: not an object")
        seq = record.get("seq")
        if type(seq) is not int or seq < expected:
            raise InputError(f"{where}: seq {seq!r} must be an int of at least {expected}")
        kind = record.get("kind")
        if not isinstance(kind, str) or kind not in KINDS:
            raise InputError(f"{where}: unknown kind {kind!r}")
        body = record.get("body", {})
        if not isinstance(body, dict):
            raise InputError(f"{where}: body must be an object")
        if kind == "player":
            body = _player(body, where, validate_player)
        elif kind == "model_result":
            body = _model_result(body, where)
        elif kind == "host":
            body = _host(body, where)
        elif body:
            raise InputError(f"{where}: {kind} takes an empty body")
        normalized.append({"seq": seq, "kind": kind, "body": body})
        expected = seq + 1
    return normalized


def _well_formed(value: str, where: str, name: str) -> str:
    """``value`` if it has a UTF-8 form. A lone surrogate does not, and would fail later."""
    try:
        value.encode("utf-8")
    except UnicodeEncodeError:
        raise InputError(f"{where}: {name} holds a lone surrogate") from None
    return value


def _text_id(value: Any, where: str, name: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_ID_CHARS:
        raise InputError(f"{where}: {name} must be a string of 1 to {MAX_ID_CHARS} characters")
    return _well_formed(value, where, name)


def int_field(value: Any, where: str, name: str, low: int, high: int) -> int:
    """``value`` if it is a plain int within ``[low, high]``, else ``InputError``."""
    if type(value) is not int or not low <= value <= high:
        raise InputError(f"{where}: {name} must be an int in [{low}, {high}], got {value!r}")
    return value


def _player(
    body: dict[str, Any], where: str, validate_player: Callable[[dict[str, Any]], dict[str, Any]]
) -> dict[str, Any]:
    _text_id(body.get("action_id"), where, "action_id")
    return validate_player(body)


def _model_result(body: dict[str, Any], where: str) -> dict[str, Any]:
    request_id = _text_id(body.get("request_id"), where, "request_id")
    status = body.get("status")
    if not isinstance(status, str) or status not in STATUSES:
        raise InputError(f"{where}: status must be one of {', '.join(STATUSES)}, got {status!r}")
    text = body.get("text", "")
    if not isinstance(text, str):
        raise InputError(f"{where}: text must be a string")
    _well_formed(text, where, "text")
    usage = body.get("usage")
    if usage is not None:
        if not isinstance(usage, dict):
            raise InputError(f"{where}: usage must be an object or null")
        usage = {
            "input_tokens": int_field(
                usage.get("input_tokens"), where, "input_tokens", 0, MAX_TOKENS
            ),
            "output_tokens": int_field(
                usage.get("output_tokens"), where, "output_tokens", 0, MAX_TOKENS
            ),
        }
    latency = int_field(body.get("latency_ms", 0), where, "latency_ms", 0, 2**31)
    return {
        "request_id": request_id,
        "status": status,
        "text": text,
        "usage": usage,
        "latency_ms": latency,
    }


def _host(body: dict[str, Any], where: str) -> dict[str, Any]:
    event = body.get("event")
    if not isinstance(event, str) or event not in HOST_EVENTS:
        raise InputError(f"{where}: event must be one of {', '.join(HOST_EVENTS)}, got {event!r}")
    return {"event": event}
