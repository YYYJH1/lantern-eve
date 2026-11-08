"""The WebSocket protocol between a page and the server host, version 1.

The page drives either host with the same messages. ``web/src/shared/protocol.ts`` defines them
for the browser host (``PageToHost`` up, ``HostToPage`` down), and the server host sends and
accepts the same JSON wherever a message applies. A message is one JSON text frame, an object
with a ``type``. Numbers are integers (a float anywhere refuses the message) and a message is at
most ``MAX_MESSAGE_BYTES`` long.

A connection starts with ``hello`` from the page and ``welcome`` and ``state`` from the server.
After that the server pushes ``frame`` messages, one per call of the core, and answers what the
page sends. Messages marked "WS only" exist on this transport and not between a page and a
worker.

Page to server
--------------
``hello`` (WS only)
    ``{"type": "hello", "version": 1, "session"?: str, "seed"?: int, "scenario"?: str,
    "preset"?: str, "hidden"?: bool, "since"?: int}``. It must come first. Without ``session``
    the server starts a game of ``seed`` and ``scenario`` (the page's ``init`` carries both). With
    a ``preset`` (the name of a game of the core, such as ``slice``: ``lantern_core.api.preset``)
    the seed, the scenario and the config of the game are the preset's, and ``seed`` and
    ``scenario`` are ignored. A name the core does not know closes the connection with code 4001.
    Without a seed and a preset the server starts the game it was told to by ``--seed`` and
    ``--preset``. With the ``session``
    of an earlier connection the server attaches this connection to that game, which keeps its
    place in the world, and ``since`` is the ``seq`` of the last frame the page saw. A ``session``
    the server does not know starts a new game, and ``welcome`` says so. ``hidden`` is whether
    the page is hidden, as the ``hidden`` flag of ``init``. A newer connection for a session
    closes the older one with code 4000.
``pause`` and ``resume``
    ``{"type": "pause", "reason": "user" | "hidden" | "page"}`` (the pause button, a tab that is
    hidden, and the page holding the world for a sheet of its own). As in the browser host the
    world runs when no reason to pause is left. A change between running and paused is an input
    of the core (``pause`` or ``resume``), recorded like any other.
``player``
    ``{"type": "player", "body": {"action_id": str, ...}}``. The body is a player action of the
    scenario. The host numbers it on receipt. A resent ``action_id`` acts once: the core ignores
    a second one and the server answers it with ``ack`` and ``duplicate``.
``new-game``
    ``{"type": "new-game", "seed": int, "scenario"?: str}`` or ``{"type": "new-game",
    "preset": str, "seed"?: int, "variant"?: str}``. The server writes the replay of the game so
    far, starts another and answers ``reset`` and ``state``. With a ``preset`` the game is the one
    the core names, and ``seed`` is not needed. With a ``seed`` it is the rules of that game
    played at another seed, and with a ``variant`` (one of the stories of the script, such as
    ``v_flood``) it is that story that is true: a case of its own on the rules of the first
    (``lantern_core.api.preset``). A ``variant`` needs a ``preset``. A seed or a variant the
    core does not accept changes nothing and gets the notice ``bad_game``.
``call``
    ``{"type": "call", "reqId": int, "call": {"op": ...}}``, answered by ``reply`` with the same
    ``reqId``. ``export`` returns the replay of the game so far. ``ending`` returns the whole
    ending of the game, reveal included, as ``Game.ending_json()`` has it: an object, or null
    before the last night. A page that holds only the ending of a frame, which leaves the reveal
    out, asks for it so. ``{"op": "preview", "action": {"verb": ..., "npc": ..., ...}}`` returns
    what the action would ask, give and cost and what stands in its way, as ``Game.preview_json``
    has it (``version``, ``cost``, ``asks``, ``gives``, ``blockers``, ``odds``, ``reasons``), or
    null in a game that has no previews. It only reads: nothing is recorded, nothing is drawn from
    the RNG and the hash of the game is the same after as before. An action the core cannot read
    (an unknown verb, a person who is not in the town, a field of the wrong type) fails with
    ``bad_action``, and a message whose action is not an object is a ``bad_message``.
    ``list-saves`` returns an empty list. ``save``, ``load`` and
    ``delete-save`` fail with ``unsupported``: the server host keeps its replays in files (see
    below), and saves belong to the browser host.
``configure``
    Accepted and ignored, with a ``notice`` of code ``server_model``: the model provider is
    configured on the server, and a key never travels from the page.
``resync`` (WS only)
    ``{"type": "resync", "since"?: int}``. The page lost frames (it saw a gap in ``seq``) and
    wants the full state. The server answers with ``state``.
``e2e``
    Refused with a ``reply`` of ``unsupported``.

Server to page
--------------
``welcome`` (WS only)
    ``{"type": "welcome", "version": 1, "session": str, "resumed": bool, "seed": int,
    "scenario": str, "core": {"version": str, "format": int}, "python": str,
    "host": {"name": "server", "version": str}, "transport": str}``. The page makes its
    ``ready`` from it.
``state`` (WS only)
    The whole state a page needs to draw from scratch, sent after ``welcome``, after ``reset``
    and on ``resync``, and by the server on its own when it had to drop frames for a page that
    reads too slowly. ``{"type": "state", "seq": int, "tick": int | null, "advanced": bool,
    "nextTick": int, "frame": {...} | null, "ending": {...} | null, "clock": {"paused", "rate"},
    "hash": str | null, "hashTick": int | null, "stateHash": str, "calls": [...], "events": [...],
    "reasons": [...], "seed": int, "scenario": str, "scene": {...}}``. ``seq`` is the number of
    the latest frame (0 before the first). ``tick``, ``advanced``, ``frame``, ``clock`` and
    ``hash`` are the fields of that frame. ``ending`` is ``Game.ending_json()``: the whole ending
    of the game, with the reveal, or null before the last night. It is here and not in the frame
    because the frames of a game that is over carry the ending without its reveal (the frame of
    the call that made the ending has all of it), so a page that comes to such a game, or that
    missed that call, gets the reveal from the state. ``nextTick`` is the tick the next call
    applies at. ``stateHash`` is the hash of the world as it is now, which a replay of the game
    reproduces at ``nextTick`` (while the world runs: inputs applied at ``nextTick`` itself are
    not in a replay stopped before it). ``events`` are the events of the frames after ``since``
    that the server still holds (the last 200 frames with events). ``calls`` is the list of model
    calls so far, oldest first (see ``model-calls``). ``scene`` is
    ``Game.scene_json()``. The next frame has ``seq + 1``. A page that comes back to a session
    finds the world running again: the server takes up the hold before it builds the state, so
    the state shows a world that is no longer paused.
``frame``
    ``{"type": "frame", "seq": int, "tick": int, "advanced": bool, "frame": {...}, "events":
    [...], "clock": {"paused", "rate"}, "hash"?: str}``: the ``frame`` message of ``protocol.ts``
    and the frame sequence number ``seq``, which counts calls of the core from 1. A page that
    sees ``seq`` jump sends ``resync``. Once the game has ended the ``ending`` key of ``frame`` is
    the ending as the ``ending`` event carries it (``kind``, ``tick``, ``ending``, ``label``,
    ``hidden``, ``inputs``, ``passage``, ``promised``, ``turnout`` and ``reveal``) in the frame
    of the call that made it, and in every frame after that the same object without ``reveal``.
    The whole ending is in ``state`` and in the call ``ending``.
``model-calls``
    ``{"type": "model-calls", "replace": false, "calls": [...]}``: the model calls that changed in
    a call of the core, sent just before its ``frame`` so that the money in the list is there when
    the frame says what was spent. A call is a record of ``calls.py`` (``ModelCallRecord`` in
    ``protocol.ts``): the request the core made, the tier it asked for and the tier it went out on,
    the model, the money held for it and the money the core booked for its result. A record is sent
    again each time it changes. A page that falls behind loses these messages and gets the whole
    list in ``state``.
``ack`` (WS only)
    ``{"type": "ack", "action_id": str | null, "result": "applied" | "duplicate" | "rejected" |
    "refused", "reason": str | null, "tick": int}``. What became of a player action, once per
    action that reached the server and once more for each resend. The first three are the core's
    ``action_ack`` events, with the tick of the call that applied them.
    ``refused`` is the host's: the core would not take the action (or the action was not
    well-formed JSON of the core), so it was dropped and is not in the replay. A page may resend
    an action it has no ack for after a reconnect.
``stats``, ``reset``, ``reply``, ``notice``, ``fatal``
    As in ``protocol.ts``. ``stats`` is ``HostStats``, sent twice a second and on a change of
    state. ``notice`` is something the server handled without stopping: ``input_refused``
    (player actions the core would not take), ``bad_message``, ``bad_game`` (a ``new-game`` that
    cannot be played), ``server_model``, ``host_error`` and ``thinking`` (a reply that the player
    waits for has not come after the time set in the provider file, 3 s by default, and the
    message names its request; it is not part of the game and is not recorded). ``fatal`` ends
    the session or refuses the connection: ``bad_message``, ``bad_version``, ``bad_hello`` (no
    hello in time), ``bad_game``, ``busy`` (the server runs as many games as it will),
    ``core_error``, ``tick_mismatch`` and ``host_error``. A refused connection is closed with
    code 4001.

While no connection is attached to a session the world is held (a pause with the reason
``offline``) and its replay is written. A connection that returns resumes it. A session that
nobody returns to within the time to live is closed.

Replays
-------
The server writes the replay of each game to ``runs/`` (see ``Session.write_replay``) when a
connection drops, when a game is replaced, when a session expires and when the server stops, as
``<UTC start>-seed<seed>-<session>.json``, replacing its own earlier write. A replay that cannot
be written is logged and the game goes on. The
file is the recording that ``lantern_core.replay`` defines plus ``host`` and ``final``, the keys
the browser host adds, so ``lantern_core.replay.rebuild`` and the browser's replay checks read
it as it stands. ``snapshots`` is filled (one per game hour of ticks), which the browser host
leaves empty.

What the model transport learns about its providers is recorded in the replay as ``host`` inputs
(``local_up``, ``local_down``, ``cloud_down``, ``cloud_up``), in the order of the other inputs, so
that a replay makes the same choices without asking any service.
"""

from __future__ import annotations

from typing import Any

from lantern_core import canon

PROTOCOL_VERSION = 1
MAX_MESSAGE_BYTES = 64 * 1024
MAX_ID_CHARS = 64
PAUSE_REASONS = ("user", "hidden", "page")
CALL_OPS = ("save", "load", "list-saves", "delete-save", "export", "ending", "preview")
# Close codes of this transport. 1001 is "going away", the rest are the application's own.
CLOSE_REPLACED = 4000
CLOSE_BAD_HELLO = 4001
MAX_SEED = canon.JS_SAFE_INT


class ProtocolError(Exception):
    """A message the server will not act on. ``code`` is the one a ``notice`` carries."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def parse(text: str) -> dict[str, Any]:
    """The message in ``text``, or a ``ProtocolError``."""
    try:
        message = canon.loads(text)
    except (ValueError, RecursionError, canon.CanonError) as err:
        raise ProtocolError("bad_message", f"not canonical JSON: {err}") from None
    if not isinstance(message, dict) or not isinstance(message.get("type"), str):
        raise ProtocolError("bad_message", "a message is an object with a string type")
    return message


def _int(message: dict[str, Any], key: str, low: int, high: int, *, required: bool) -> int | None:
    value = message.get(key)
    if value is None:
        if required:
            raise ProtocolError("bad_message", f"{message['type']}: {key} is required")
        return None
    if type(value) is not int or not low <= value <= high:
        raise ProtocolError(
            "bad_message", f"{message['type']}: {key} must be an int in [{low}, {high}]"
        )
    return value


def _text(message: dict[str, Any], key: str, *, required: bool) -> str | None:
    value = message.get(key)
    if value is None:
        if required:
            raise ProtocolError("bad_message", f"{message['type']}: {key} is required")
        return None
    if not isinstance(value, str) or not 1 <= len(value) <= MAX_ID_CHARS:
        raise ProtocolError(
            "bad_message",
            f"{message['type']}: {key} must be a string of 1 to {MAX_ID_CHARS} characters",
        )
    return value


def hello_fields(message: dict[str, Any]) -> dict[str, Any]:
    """The checked fields of a ``hello``."""
    version = message.get("version")
    if version != PROTOCOL_VERSION:
        raise ProtocolError(
            "bad_version", f"this server speaks protocol {PROTOCOL_VERSION}, not {version!r}"
        )
    hidden = message.get("hidden", False)
    if not isinstance(hidden, bool):
        raise ProtocolError("bad_message", "hello: hidden must be a boolean")
    return {
        "session": _text(message, "session", required=False),
        "seed": _int(message, "seed", 0, MAX_SEED, required=False),
        "scenario": _text(message, "scenario", required=False),
        "preset": _text(message, "preset", required=False),
        "hidden": hidden,
        "since": _int(message, "since", 0, MAX_SEED, required=False),
    }


def pause_reason(message: dict[str, Any]) -> str:
    reason = message.get("reason")
    if reason not in PAUSE_REASONS:
        raise ProtocolError(
            "bad_message", f"{message['type']}: reason must be one of {PAUSE_REASONS}"
        )
    return reason


def player_body(message: dict[str, Any]) -> dict[str, Any]:
    body = message.get("body")
    if not isinstance(body, dict):
        raise ProtocolError("bad_message", "player: body must be an object")
    return body


def new_game_fields(
    message: dict[str, Any],
) -> tuple[int | None, str | None, str | None, str | None]:
    """The seed, the scenario, the preset and the variant of a ``new-game``. A message that names
    a preset needs no seed (with one, the preset is played at that seed), and any other needs
    one. A variant is the story that is true in a game of a preset, so it needs the preset."""
    preset = _text(message, "preset", required=False)
    seed = _int(message, "seed", 0, MAX_SEED, required=preset is None)
    variant = _text(message, "variant", required=False)
    if variant is not None and preset is None:
        raise ProtocolError("bad_message", "new-game: a variant needs a preset")
    return seed, _text(message, "scenario", required=False), preset, variant


def call_fields(message: dict[str, Any]) -> tuple[int, str]:
    req_id = _int(message, "reqId", 0, MAX_SEED, required=True)
    call = message.get("call")
    if not isinstance(call, dict) or call.get("op") not in CALL_OPS:
        raise ProtocolError("bad_message", f"call: op must be one of {CALL_OPS}")
    assert req_id is not None
    return req_id, call["op"]


def call_action(message: dict[str, Any]) -> dict[str, Any]:
    """The action of a ``preview`` call: an object, which the core reads."""
    call = message.get("call")
    action = call.get("action") if isinstance(call, dict) else None
    if not isinstance(action, dict):
        raise ProtocolError("bad_message", "call preview: action must be an object")
    return action


def resync_since(message: dict[str, Any]) -> int | None:
    return _int(message, "since", 0, MAX_SEED, required=False)
