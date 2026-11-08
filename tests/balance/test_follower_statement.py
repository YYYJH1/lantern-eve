"""The follower fills in the statement card the way a player who reasons from it would, and makes
the full statement when the card allows it.

The first tests are for the choice itself (``bots.card``), on lists of options set by hand. The
second play the follower on a stage, a frame kept by hand and a core that acknowledges what the bot
sends, with a card in the frame. The last play the real game, the one the opening page starts, in
each of the three stories.
"""

from __future__ import annotations

import json
from typing import Any

import pytest
from test_follower import SCENE, Stage, card, drive, kinds, offer

import balance
import bots
from bots import card as cards
from bots.base import Obs
from bots.follower import Follower
from lantern_core.api import preset

CAUSE = {
    "part": "cause",
    "title": {"zh": "成因", "en": "Cause"},
    "chosen": None,
    "gap": False,
    "options": [
        {"id": "boat", "text": {"zh": "船", "en": "boat"}, "support": 3, "against": 1},
        {"id": "flood", "text": {"zh": "汛", "en": "flood"}, "support": 2, "against": 0},
        {"id": "drunk", "text": {"zh": "醉", "en": "drunk"}, "support": 1, "against": 0},
        {"id": "li_er", "text": {"zh": "李二", "en": "Li Er"}, "support": 4, "against": 3},
    ],
}
COURSE = {
    "part": "course",
    "title": {"zh": "经过", "en": "Course"},
    "chosen": None,
    "gap": False,
    "options": [
        {"id": "boat_night", "text": {"zh": "船夜", "en": "boat"}, "support": 1, "against": 2},
        {"id": "flood_night", "text": {"zh": "汛夜", "en": "flood"}, "support": 2, "against": 1},
    ],
}
RUMOUR = {"part": "rumour", "title": {"zh": "缘由", "en": "Talk"}, "chosen": None, "gap": True}
RUMOUR["options"] = []


def parts(**chosen: str | None) -> list[dict[str, Any]]:
    out = []
    for part in (CAUSE, COURSE, RUMOUR):
        copy = {**part, "options": [dict(o) for o in part["options"]]}
        copy["chosen"] = chosen.get(part["part"])
        out.append(copy)
    return out


def statement(
    chosen: dict[str, str | None] | None = None, can_state: bool = True
) -> dict[str, Any]:
    return {
        "parts": parts(**(chosen or {})),
        "can_state": can_state,
        "why_not": None if can_state else {"zh": "没有人听", "en": "Nobody is here to hear it"},
        "used_today": False,
        "last": None,
    }


# ---------------------------------------- the choice


def test_in_each_part_the_option_with_the_most_notes_for_it_and_none_against_is_taken():
    assert cards.best(CAUSE, set()) == "flood"  # not the boat (3 for, 1 against) or Li Er (4, 3)
    assert cards.best(COURSE, set()) == "flood_night"  # every option has something against
    assert cards.best(RUMOUR, set()) is None  # nothing to choose from
    assert cards.changes(statement(), {}) == [("cause", "flood"), ("course", "flood_night")]


def test_where_everything_has_something_against_it_the_one_with_the_most_beyond_that_is_taken():
    assert cards.rank(COURSE["options"][1]) > cards.rank(COURSE["options"][0])
    one = {"id": "a", "support": 5, "against": 4}
    other = {"id": "b", "support": 2, "against": 0}
    assert cards.rank(other) > cards.rank(one)  # nothing against comes before the notes for


def test_an_option_stated_and_found_wanting_is_not_taken_again_and_the_next_best_is():
    assert cards.best(CAUSE, {"flood"}) == "drunk"
    assert cards.best(CAUSE, {"flood", "drunk"}) == "boat"  # nothing clean is left: the most beyond
    assert cards.best(CAUSE, {"boat", "flood", "drunk", "li_er"}) is None
    state = statement({"cause": "flood", "course": "flood_night"})
    assert cards.changes(state, {"cause": {"flood"}}) == [("cause", "drunk")]
    assert cards.changes(state, {}) == []  # filled in as it would be: nothing to change


# ---------------------------------------- the follower on a stage


def at_the_teahouse(action: dict[str, Any], state: dict[str, Any], **stage: Any):
    played = StatementStage(
        tasks=[card("t_tell_town", action=action)],
        tracked="t_tell_town",
        statement=state,
        can_speak=True,
        speak_offers=[offer("statement", {"kind": "statement"})],
        **stage,
    )
    played.at(18, 5, day=4)
    played.pos = (21, 20)
    return played, Follower(SCENE)


class StatementStage(Stage):
    """A stage with the card of the statement in the frame, and the choices kept as the core keeps
    them."""

    def __init__(self, **frame: Any) -> None:
        self.statement: dict[str, Any] | None = None
        super().__init__(**frame)

    def out(self) -> dict[str, Any]:
        out = super().out()
        out["frame"]["statement"] = self.statement
        return out

    def apply(self, action: dict[str, Any]) -> None:
        super().apply(action)
        if action["type"] == "statement" and self.statement is not None:
            for part in self.statement["parts"]:
                if part["part"] == action["part"]:
                    part["chosen"] = action["option"] if action["op"] == "choose" else None


def chosen(stage: StatementStage) -> dict[str, str | None]:
    return {p["part"]: p["chosen"] for p in stage.statement["parts"]}


def test_when_the_card_says_to_fill_it_in_the_follower_chooses_in_each_part_and_nothing_else():
    stage, bot = at_the_teahouse({"verb": "state"}, statement())
    sent = drive(stage, bot, calls=12)
    choices = [(a["part"], a["option"]) for a in sent if a["type"] == "statement"]
    assert choices == [("cause", "flood"), ("course", "flood_night")]
    assert all(a["op"] == "choose" for a in sent if a["type"] == "statement")
    assert "speak" not in kinds(sent)  # filling in is not stating
    assert chosen(stage) == {"cause": "flood", "course": "flood_night", "rumour": None}


def test_the_follower_states_when_the_card_allows_it_and_fills_the_card_in_first():
    stage, bot = at_the_teahouse({"verb": "speak", "kind": "statement"}, statement())
    sent = drive(stage, bot, calls=12)
    assert kinds(sent).count("speak") == 1
    spoke = next(a for a in sent if a["type"] == "speak")
    assert spoke["kind"] == "statement"
    assert kinds(sent).index("statement") < kinds(sent).index("speak")  # the card, then the speech
    assert chosen(stage)["cause"] == "flood"


def test_the_follower_waits_while_the_card_does_not_allow_the_statement_and_says_why_it_waits():
    stage, bot = at_the_teahouse({"verb": "speak", "kind": "statement"}, statement(can_state=False))
    sent = drive(stage, bot, calls=12)
    assert "speak" not in kinds(sent)
    assert "statement" not in kinds(sent)
    assert not [s for s in bot.stalls if s["kind"] == "no_next_step"]  # a wait the card explains
    stage.statement = statement()
    assert "speak" in kinds(drive(stage, bot, calls=12))


def test_after_a_statement_with_a_part_that_did_not_hold_that_part_takes_the_next_best_option():
    stage, bot = at_the_teahouse({"verb": "speak", "kind": "statement"}, statement())
    drive(stage, bot, calls=12)
    assert chosen(stage)["cause"] == "flood"
    stage.events = [
        {
            "kind": "stated",
            "tick": stage.tick,
            "venue": "p_teahouse",
            "named": 9,
            "accepted": 5,
            "percent": 55,
            "elder": 2,
            "proof": True,
            "told": False,
            "wrong": ["cause"],
        }
    ]
    bot.decide(Obs(stage.out()))
    assert bot.rejected == {"cause": {"flood"}}
    stage.statement["used_today"] = False
    stage.at(18, 5, day=5)
    stage.tasks = [card("t_tell_town", action={"verb": "state"})]
    stage.events = []
    sent = drive(stage, bot, calls=12)
    changes = [(a["part"], a["option"]) for a in sent if a["type"] == "statement"]
    assert changes == [("cause", "drunk")]  # the part named wrong; the course is left as it was
    assert chosen(stage) == {"cause": "drunk", "course": "flood_night", "rumour": None}


# ---------------------------------------- the real game


@pytest.mark.parametrize("variant", ["v_boat", "v_flood", "v_drunk"])
def test_the_follower_tells_the_truth_on_the_fourth_evening_in_each_story(variant):
    """Following the card in the game the opening page starts, whichever story is true, the card
    is filled in with the right option in each part every time, the watchman is asked in the
    afternoon of the fourth day (no story can be told apart before he speaks), the elder is asked
    to call the clan, and the first statement, at the hall a little after five, tells the truth.
    In the story of the flood the elder holds on to the boat, which the scratches on it seem to
    show, and the whole proof, which refutes it, is what moves him."""
    started = preset("slice")
    log: list[Any] = []
    row, _ = balance.play_game(
        started["seed"],
        "follower",
        days=5,
        config={**started["config"], "variant": variant},
        log=log,
    )
    bot = log.pop()[1]
    assert int(row["truth_told"]) == 1 and row["ending"] == "ending_full"
    (first,) = bot.stated
    assert first["wrong"] == [] and first["told"] is True and first["proof"] is True
    assert first["tick"] >= balance.TICKS_PER_DAY * 3 + 11 * 120  # the fourth day, after five
    assert first["tick"] < balance.TICKS_PER_DAY * 3 + 15 * 120  # and before nine in the evening
    assert first["elder"] == 2  # the elder nodded
    assert bot.rejected == {}
    assert int(row["truth_day"]) == 4
    assert bots.make("follower", SCENE).rejected == {}
    assert json.loads(json.dumps(first)) == first
