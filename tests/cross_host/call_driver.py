"""A game in which people name each other in words of their own, written to run unchanged under
CPython and under Pyodide.

``run`` gives five people the tables of ``call_helpers`` (the names they use for the people of the
town), plays the first day of the persuasion game with a model that answers (``reply_driver``), and
judges a fixed set of lines that models might write for those people. It returns the state hash
after every call, a digest of the outputs, and a summary of the words that were said and the lines
that passed or were refused. The cross-host test compares all of it between the two interpreters.

The tables are taken out again when the run ends, so that a run in a process that goes on to other
work leaves the voices as it found them.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import call_helpers
import reply_driver as base

from lantern_core.api import Game
from lantern_core.cognition import contract
from lantern_core.cognition.beliefs import Belief
from lantern_core.world.bridge import notes, prompts, speech, voices
from lantern_core.world.bridge.lore import lore

SEED = base.SEED
TICKS = base.TICKS
LOOKING = "pr_liner_looking"  # Li Er was looking for his lantern at the bridge (a plain act)
ROUND = "pr_gengfu_round"  # the watchman's round over the bridge (a plain act)
AT_BRIDGE = "pr_liner_at_bridge"  # Li Er was at the bridge (the core writes the sentence)
# the people who speak most on the first day of the game (the head of the Zhou house and his
# clerk) get a name for the second Li son as well, whom the whole day is about
MORE = {
    call_helpers.SHOPKEEPER: {"li_er": {"zh": "李家老二", "en": "the Li boy"}},
    call_helpers.CLERK: {"li_er": {"zh": "李二爷", "en": "Mister Er"}},
}
LINES = {
    "mother_names_her_son": (
        call_helpers.GRANNY,
        LOOKING,
        "老二在石桥找灯笼。",
        "Er was looking for the lantern at the bridge.",
    ),
    "mother_names_a_son_nobody_covers": (
        call_helpers.GRANNY,
        ROUND,
        "老二在石桥。",
        "Er was at the bridge.",
    ),
    "brother_means_his_brother": (
        call_helpers.BROTHER,
        LOOKING,
        "老二在石桥找灯笼。",
        "My brother was looking for the lantern at the bridge.",
    ),
    "maker_means_the_li_son": (
        call_helpers.MAKER,
        LOOKING,
        "二郎在石桥找灯笼。",
        "Erlang was looking for the lantern at the bridge.",
    ),
    "watchman_means_the_zhou_son": (
        "gengfu",
        LOOKING,
        "二郎在石桥找灯笼。",
        "Erlang was looking for the lantern at the bridge.",
    ),
    "watchman_has_no_laoer": (
        "gengfu",
        ROUND,
        "老二在石桥。",
        "Er was at the bridge.",
    ),
}


def judged(who: str, source: str | None, acts: list[dict[str, Any]], zh: str, en: str) -> dict:
    """What the gate makes of a line for ``who``, who holds the props of the acts (as seen, or as
    heard from ``source``), in a game of its own."""
    game = Game(1, "bridge")
    while game.tick < 5:
        game.step()
    world = game._kernel.state["world"]
    for act in acts:
        heard = source is not None
        belief = Belief(
            who,
            act["prop"],
            "assert",
            90,
            "heard" if heard else "saw",
            source,
            source,
            1 if heard else 0,
            0,
            None,
        )
        notes.hold(world["social"], belief)
    text = json.dumps({"acts": acts, "line": {"zh": zh, "en": en}}, ensure_ascii=False)
    speaker = speech.speaker_for(world, who, ("player",), game.tick)
    gated = contract.gate(text, speaker, speech.script())
    return {
        "ok": gated.ok,
        "by": gated.by,
        "errors": [error.to_canon() for error in gated.errors],
        "line": dict(gated.line or {}),
    }


def plain_act(prop: str) -> dict[str, Any]:
    return {"path": "belief", "prop": prop, "modality": "assert", "source": "unknown"}


def judgements() -> dict[str, dict]:
    """The lines of ``LINES`` as the gate judges them, and a line the core writes."""
    out = {
        name: judged(who, None, [plain_act(prop)], zh, en)
        for name, (who, prop, zh, en) in LINES.items()
    }
    named = {"path": "belief", "prop": AT_BRIDGE, "modality": "assert", "source": "zhou_zhanggui"}
    out["core_writes_for_the_mother"] = judged(
        call_helpers.GRANNY, "zhou_zhanggui", [named], "x", "y"
    )
    return out


def run(seed: int = SEED, ticks: int = TICKS, host_seed: int = 0, restores: bool = True) -> dict:
    """Run to ``ticks`` and return the state hash after every call, a digest of the outputs and a
    summary. ``host_seed`` is not used. It is there so that the runner can call every driver alike.
    """
    calls = call_helpers.Calls()
    calls.only(
        {person: {**table, **MORE.get(person, {})} for person, table in call_helpers.TABLES.items()}
    )
    try:
        driver = base.Driver(seed, restores=restores)
        hashes: list[str] = []
        digest = hashlib.sha256()
        prompts_digest = hashlib.sha256()
        said: dict[str, int] = {}
        leaks = 0
        asked = 0
        tables = [*call_helpers.TABLES.values(), *MORE.values()]
        names = sorted({pair["zh"] for table in tables for pair in table.values()})
        cast = lore().names
        while driver.game.tick < ticks:
            out_json, out = driver.call()
            digest.update(out_json.encode("utf-8"))
            hashes.append(driver.game.hash())
            for request in out["requests"]:
                system = request["messages"][0]["content"]
                prompts_digest.update(system.encode("utf-8"))
                asked += prompts.CALLS_NOTE in system
            for bubble in out["frame"]["bubbles"]:
                text = bubble["text"]
                if text is None:
                    continue
                for name in names:
                    said[name] = said.get(name, 0) + (name in text["zh"])
                table = voices.calls(bubble["npc"])
                bare = text["zh"]
                for pair in table.values():  # a name of the table may hold the cast's (李二爷)
                    bare = bare.replace(pair["zh"], "")
                leaks += sum(cast[other]["zh"] in bare for other in table)
        return {
            "hashes": hashes,
            "outputs_digest": digest.hexdigest(),
            "final_tick": driver.game.tick,
            "summary": {
                "calls": driver.calls,
                "said": dict(sorted(said.items())),
                "leaks": leaks,
                "prompts": prompts_digest.hexdigest(),
                "prompts_with_the_table": asked,
                "judged": judgements(),
                "final": hashlib.sha256(driver.game.snapshot_json().encode("utf-8")).hexdigest(),
            },
        }
    finally:
        calls.restore()
