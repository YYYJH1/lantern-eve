"""Whatever the festival manager says and asks, the world stays sane and the same inputs replay.

A seeded stream of actions, the sensible and the nonsensical, is played over two days: telling,
making things up, asking, promising, speaking, walking up to people and leaving. After every
call the state must be plain data, every trust between 0 and 100, the manager's holdings never
negative or promised twice, the ledger within its bounds, and each action answered exactly once.
A body that is not well formed is an error that leaves the game as it was.
"""

import json
import random

import pytest
from bridge_helpers import CAST, CLEAR, bridge
from player_helpers import beside, me, plain

from lantern_core.api import Game
from lantern_core.inputs import InputError
from lantern_core.world.bridge import assembly, entrust, pledges, speak
from lantern_core.world.bridge.lore import lore

LO = lore()
PEOPLE = list(CAST.index)
ENTITIES = [e.id for e in LO.book.registry]
PREDS = [*LO.tables.predicates, "no_such_predicate"]
WAYS = [*speak.HOWS, "boast"]
KINDS = [*entrust.KINDS, "stand_on_one_leg", ""]
WHATS = ["stall", "role", "wage", "slot", "apology", ""]
ITEMS = ["front", "back", "t_honor_light", "lead_lanterns", "stage_words", "1", "2", "9", ""]
SENSIBLE = [  # (predicate, subject, object) that the table can say
    ("damaged", "li_er", "t_rail"),
    ("damaged", "zhou_dalang", "t_rail"),
    ("damaged", "old_he", "t_rail"),
    ("damaged", "fam_li", "t_rail"),
    ("at", "li_er", "p_bridge"),
    ("at", "old_he", "p_he_home"),
    ("at", "zhou_dalang", "p_zhou_house"),
    ("drank", "zhou_dalang", "p_tavern"),
    ("flood_damaged", "t_rail", ""),
    ("scratched", "t_he_boat", ""),
    ("took", "li_er", "t_li_er_lantern"),
]
DAYS = 2
TICKS = DAYS * 2070


def body(rng: random.Random, game: Game) -> dict:
    """One action: well formed, or not."""
    notebook = [e["id"] for e in me(game)["notebook"]]
    entry = rng.choice([*notebook, "n99"]) if notebook else "n99"
    kind = rng.choice(
        ["ask", "ask", "ask", "tell", "tell", "tell", "fab", "fab", "entrust", "entrust", "entrust"]
        + ["promise", "promise", "keep", "speak", "meal", "leave"]
    )
    if kind == "tell":
        return {"type": "tell", "entry": entry, "how": rng.choice(WAYS)}
    if kind == "fab":
        fits = rng.choice(SENSIBLE) if rng.random() < 0.7 else None
        return {
            "type": "tell",
            "how": "fabricate",
            "pred": fits[0] if fits else rng.choice(PREDS),
            "subject": fits[1] if fits else rng.choice(ENTITIES),
            "object": fits[2] if fits else rng.choice([*ENTITIES, ""]),
            "neg": rng.random() < 0.3,
        }
    if kind == "entrust":
        cites = rng.sample([*notebook, "n99"], k=min(len(notebook) + 1, rng.randint(0, 4)))
        return {
            "type": "entrust",
            "kind": rng.choice(KINDS),
            "target": rng.choice([*PEOPLE, ""]),
            "cite": cites,
        }
    if kind == "promise":
        return {
            "type": "promise",
            "what": rng.choice(WHATS),
            "item": rng.choice(ITEMS),
            "amount": rng.randint(0, 70),
            "due": rng.randint(0, 6),
        }
    if kind == "keep":
        return {"type": "promise", "op": "keep", "id": f"k{rng.randint(1, 6)}"}
    if kind == "speak":
        held = me(game)["evidence"]
        return {
            "type": rng.choice(["speak", "speak_publicly"]),
            "evidence": rng.sample(held, k=min(len(held), rng.randint(0, 3))),
        }
    if kind == "meal":
        return {"type": "speak", "kind": "meal"}
    if kind == "ask":
        return {"type": "ask", "topic": rng.choice([*ENTITIES, entry])}
    return {"type": "leave"}


def malformed(rng: random.Random) -> dict:
    return rng.choice(
        [
            {"type": "tell", "how": "fabricate", "pred": 5, "subject": "li_er"},
            {"type": "tell", "entry": 7},
            {"type": "entrust", "kind": ["join"]},
            {"type": "entrust", "kind": "join", "cite": "n1"},
            {"type": "promise", "what": "slot", "amount": "ten"},
            {"type": "promise", "op": "keep"},
            {"type": "speak", "evidence": "all"},
            {"type": "speak", "kind": "sing"},
        ]
    )


def sane(game: Game) -> None:
    state = game._kernel.state
    plain(state)
    section = state["world"]["player"]
    assert all(0 <= t <= 100 for t in section["trust"]), section["trust"]
    have = pledges.left(section)
    assert have["stall_front"] >= 0 and have["stall_back"] >= 0 and have["purse"] >= 0
    held = [p for p in section["pledges"] if p["state"] in ("open", "kept")]
    roles = [p["item"] for p in held if p["what"] == "role"]
    slots = [p["item"] for p in held if p["what"] == "slot"]
    assert len(roles) == len(set(roles)) and len(slots) == len(set(slots))
    for person in PEOPLE:
        assert -pledges.MAX_BALANCE <= pledges.balance(section, person) <= pledges.MAX_BALANCE
    assert len(section["caught"]) == len({(row[0], row[1]) for row in section["caught"]})
    assert all(row[0] in state["world"]["social"]["claims"] for row in section["told"])
    meeting = section["meeting"]
    # the hall opens on the hour after the clan has had time to come, and shuts a set time after
    # the call
    opens, shuts = assembly.GATHER_TICKS, assembly.MEETING_TICKS
    hour = assembly.clock.DAY_TICKS_PER_HOUR
    assert (
        not meeting or shuts - opens - hour <= meeting["until"] - meeting["tick"] <= shuts - opens
    )


def send(game: Game, action: dict) -> dict | None:
    """One action in a call of its own, then the checks. None if the call was refused."""
    seq = game.next_seq
    record = {"action_id": f"f{seq}", **action}
    before = game.hash()
    try:
        out = json.loads(game.step(json.dumps([{"seq": seq, "kind": "player", "body": record}])))
    except InputError:
        assert game.hash() == before  # a refused call leaves the game as it was
        return None
    acks = [e for e in out["events"] if e["kind"] == "action_ack"]
    assert len(acks) == 1 and acks[0]["action_id"] == record["action_id"]
    sane(game)
    return out


def idle(game: Game, rng: random.Random) -> None:
    for _ in range(rng.choice([0, 1, 2, 5, 12, 40, 150])):
        game.step()


def visit(game: Game, rng: random.Random) -> int:
    """Walk up to somebody, talk, do a few things at random, and leave. Returns the actions sent."""
    npc = rng.choice(PEOPLE)
    for _ in range(40):  # a person in the middle of telling a neighbour finishes first
        if me(game)["talk"]:
            send(game, {"type": "leave"})
        beside(game, npc)
        out = send(game, {"type": "talk", "npc": npc})
        if out is not None and not any(
            e["reason"] == "busy" for e in out["events"] if e["kind"] == "action_ack"
        ):
            break
        game.step()
    sent = 1
    for _ in range(rng.randint(1, 8)):
        send(game, malformed(rng) if rng.random() < 0.06 else body(rng, game))
        sent += 1
        if rng.random() < 0.3:
            idle(game, rng)
    send(game, {"type": "leave"})
    return sent


def address(game: Game, rng: random.Random) -> int:
    """Stand at the teahouse or the hall, and speak in public or lay a table."""
    npc = rng.choice(["cha_laoban", "zuzhang"])
    if not me(game)["talk"]:
        beside(game, npc)
    sent = 0
    for _ in range(rng.randint(1, 3)):
        send(game, body_of_speech(rng, game))
        sent += 1
    return sent


def body_of_speech(rng: random.Random, game: Game) -> dict:
    held = me(game)["evidence"]
    return {
        "type": rng.choice(["speak", "speak_publicly"]),
        "kind": rng.choice(["evidence", "evidence", "meal"]),
        "evidence": rng.sample(held, k=min(len(held), rng.randint(0, 3))),
    }


def play(seed: int) -> tuple[list[str], dict]:
    rng = random.Random(seed)
    game = bridge(seed, **CLEAR)
    me(game)["trust"] = [rng.randint(25, 90) for _ in PEOPLE]  # some trust to spend
    me(game)["evidence"].extend(["e_gengfu_dalang", "e_footprint"])  # and something to show
    hashes: list[str] = []
    sent = 0
    while game.tick < TICKS:
        roll = rng.random()
        if roll < 0.75:
            sent += visit(game, rng)
        elif roll < 0.9:
            sent += address(game, rng)
        else:  # the day goes by to the evening, or just a little
            span = rng.choice([30, 200, 600])
            for _ in range(span):
                game.step()
        idle(game, rng)
        hashes.append(game.hash())
    return hashes, {"sent": sent, "told": len(me(game)["told"])}


@pytest.mark.parametrize("seed", [3, 11, 27])
def test_any_sequence_of_dealings_leaves_a_sane_world_and_replays_the_same(seed):
    first, summary = play(seed)
    assert summary["sent"] > 100 and summary["told"] > 3
    second, _ = play(seed)
    assert first == second
