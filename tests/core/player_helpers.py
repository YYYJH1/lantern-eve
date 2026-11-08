"""Helpers for the tests of the festival manager: sending actions and setting up a scene."""

from __future__ import annotations

import json
from typing import Any

from bridge_driver import Bot as DriverBot
from bridge_helpers import TOWN, npc_of, player, run_to, state_of, step

from lantern_core.api import Game


def act(game: Game, type_: str, **fields: Any) -> dict[str, Any]:
    """One call that carries one player action. The parsed outputs."""
    body = {"action_id": f"t{game.next_seq}", "type": type_, **fields}
    return step(game, player(game.next_seq, body))


def acks(out: dict[str, Any]) -> list[tuple[str, str | None]]:
    """The ``(result, reason)`` of each acknowledgement in the outputs."""
    return [(e["result"], e["reason"]) for e in out["events"] if e["kind"] == "action_ack"]


def ack(out: dict[str, Any]) -> tuple[str, str | None]:
    """The only acknowledgement in the outputs."""
    (only,) = acks(out)
    return only


def events(out: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [e for e in out["events"] if e["kind"] == kind]


def me(game: Game) -> dict[str, Any]:
    """The live section of the player. Read it; write it only to set up a case."""
    return state_of(game)["player"]


def run_on(game: Game, tick: int, each=None) -> None:
    """End the conversation there is, if any, and run on to ``tick``: the manager walks away. (A
    world that is held by a conversation does not get anywhere by being stepped.)"""
    if me(game)["talk"]:
        act(game, "leave")
    run_to(game, tick, each)


def put(game: Game, x: int, y: int) -> None:
    """Set the player down on a cell, standing still."""
    section = me(game)
    section["x"], section["y"] = x, y
    section["goal"] = [x, y]
    section["dest"] = ""


def beside(game: Game, npc_id: str, dx: int = 1, dy: int = 0) -> None:
    """Set the player down next to a person (on their cell if the cell next to it is blocked)."""
    npc = npc_of(game, npc_id)
    x, y = npc["x"] + dx, npc["y"] + dy
    if not TOWN.grid.inside(x, y) or not TOWN.grid.walkable(TOWN.grid.index(x, y)):
        x, y = npc["x"], npc["y"]
    put(game, x, y)


def silence(game: Game) -> None:
    """Keep the townsfolk from telling each other anything new, so a case set up by hand stays.

    Nobody is in the middle of a telling either: the game was played to the case, and a telling
    that happened to be going on then would keep the person from talking to the player.
    """
    social = state_of(game)["social"]
    social["next"] = [10**9] * len(social["next"])
    social["busy"] = [0] * len(social["busy"])


def doc_scene(seed: int = 2, named: str = "zhou_huoji") -> Game:
    """A rumour that has just reached the player, early on the first morning.

    Shopkeeper Zhou has just said in the teahouse that Li Er broke the bridge, and named the clerk
    (or ``named``) as the one who told him. The clerk only ever said that Li Er was at the bridge.
    The player stands beside the shopkeeper, his words are over his head, and nobody will say
    anything more."""
    from bridge_helpers import CLEAR, bridge, run_to

    from lantern_core.cognition.beliefs import Belief, Claim
    from lantern_core.world.bridge import notes

    game = bridge(seed, **CLEAR)
    run_to(game, 40)
    social = state_of(game)["social"]
    said = Claim(
        "c1", "zhou_huoji", ("zhou_zhanggui",), "pr_liner_at_bridge", "assert", "self_seen", 30,
        "belief",
    )  # fmt: skip
    rumour = Claim(
        "c2", "zhou_zhanggui", ("cha_laoban",), "pr_liner_damaged", "assert", named,
        game.tick, "mutation", rule_id="sr_presence_grudge", op="assimilate",
    )  # fmt: skip
    social["seq"] = 3
    social["claims"]["c1"] = notes.encode_claim(said)
    social["claims"]["c2"] = notes.encode_claim(rumour)
    notes.hold(
        social,
        Belief("zhou_zhanggui", "pr_liner_at_bridge", "assert", 70, "heard", "zhou_huoji",
               "self_seen", 1, 30, "c1"),
    )  # fmt: skip
    notes.hold(
        social,
        Belief("zhou_zhanggui", "pr_liner_damaged", "assert", 70, "inferred", None, None, 1,
               game.tick, "c2"),
    )  # fmt: skip
    social["bubbles"].append(["zhou_zhanggui", game.tick + 60, "c2"])
    silence(game)
    beside(game, "zhou_zhanggui")
    return game


def seed_of(variant: str) -> int:
    """The first seed whose game draws ``variant`` for the truth."""
    from social_helpers import seeds_of

    return seeds_of(variant)[0]


class Bot(DriverBot):
    """The bot of the cross-host driver, which plays a game for as long as it is asked to."""

    def play(
        self, game: Game, until: int, step_with=None, last: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """Play to ``until``. Every output of the way.

        ``step_with`` replaces ``game.step`` (a recorder's, say). ``last`` is the outputs of the
        call before, when the bot carries on a game it played before.
        """
        send = step_with or game.step
        seen: list[dict[str, Any]] = []
        out = last
        if out is None:
            out = json.loads(send("[]"))
            seen.append(out)
        while game.tick < until:
            choice = self.choose(game.tick, out)
            records = []
            if choice is not None:
                kind, fields = choice
                body = {"action_id": f"b{game.next_seq}", "type": kind, **fields}
                records = [player(game.next_seq, body)]
            out = json.loads(send(json.dumps(records)))
            seen.append(out)
        return seen


def add_telling(game: Game, claim, hold: tuple[str, str, str] | None = None) -> None:
    """Put a telling into the record of the town, with its words over the speaker's head.

    ``claim`` is a ``Claim``; ``hold`` is ``(holder, prop, kind)`` for a belief to give a person
    so that the claim is one they could make: kind ``saw``, or ``heard`` from the claim's speaker.
    """
    from lantern_core.cognition.beliefs import Belief
    from lantern_core.world.bridge import notes

    social = state_of(game)["social"]
    social["seq"] = max(social["seq"], int(claim.id[1:]) + 1)
    social["claims"][claim.id] = notes.encode_claim(claim)
    social["bubbles"].append([claim.speaker, game.tick + 60, claim.id])
    if hold is not None:
        holder, prop, kind = hold
        heard = kind == "heard"
        belief = Belief(
            holder, prop, "assert", 70, kind,
            claim.speaker if heard else None,
            claim.claimed_source if heard else None,
            1 if heard else 0, claim.tick, claim.id if heard else None,
        )  # fmt: skip
        notes.hold(social, belief)


def flipped(value: Any) -> Any:
    """The same value with every dict's keys in reverse order. Lists keep theirs."""
    if isinstance(value, dict):
        return {key: flipped(value[key]) for key in reversed(list(value))}
    if isinstance(value, list):
        return [flipped(item) for item in value]
    return value


def plain(value: Any, path: str = "$") -> None:
    """Fail on any type that would not survive a snapshot as itself: tuples, sets, floats."""
    if isinstance(value, dict):
        for key, item in value.items():
            assert type(key) is str, (path, key)
            plain(item, f"{path}.{key}")
    elif isinstance(value, list):
        for i, item in enumerate(value):
            plain(item, f"{path}[{i}]")
    else:
        assert value is None or type(value) in (str, int, bool), (path, type(value))
