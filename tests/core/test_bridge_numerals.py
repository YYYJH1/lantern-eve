"""The numbers of the town in the Chinese lines the core writes.

In Chinese a quantity of the town is said in characters before its measure word (四根竹料, 五位,
两个早上), a clock time is in figures (07:00), a score on a scale keeps its digits (积怨还有39点)
and English keeps digits throughout. ``numerals`` is the one place that says a count in
characters, and the tasks, the recap and the paper, the lines of the townsfolk, the previews, the
offers and the board all go through it. The tests below hold each of them to it, and a sweep over
a day of the scripted driver and a whole game of the follower holds every Chinese string of every
frame to it.
"""

from __future__ import annotations

import json
import re
from typing import Any

import pytest
from agenda_helpers import slice_game
from bridge_driver import run as run_driver
from bridge_helpers import state_of, step, world_of
from dealings_helpers import talking

import follow_report
from lantern_core import api
from lantern_core.world.bridge import (
    agenda_facts,
    assembly,
    board,
    commitments,
    numerals,
    peace,
    preview,
    prompts,
)

# a digit that stands before a measure word of the town (or before 分钟, a span of the clock)
DIGIT_BEFORE_A_MEASURE = re.compile(
    r"\d(?=[根人位个次批份条成天日钟文户回句步对星拍家场夜晚只张件]|分钟)"
)
CJK = re.compile(r"[一-鿿]")


def digits_before_a_measure_word(value: Any) -> list[str]:
    """Every Chinese string inside ``value`` (a parsed frame, a list, a dict) that has a digit
    before a measure word of the town."""
    found: list[str] = []
    if isinstance(value, str):
        if CJK.search(value) and DIGIT_BEFORE_A_MEASURE.search(value):
            found.append(value)
    elif isinstance(value, dict):
        for key, inner in value.items():
            if key != "requests":  # the prompts of a model are English, with the names in Chinese
                found += digits_before_a_measure_word(inner)
    elif isinstance(value, list):
        for inner in value:
            found += digits_before_a_measure_word(inner)
    return found


# --------------------------------------------------------------------------------- the module


def test_a_count_is_said_in_characters_in_chinese_and_in_digits_in_english():
    counts = (0, 1, 2, 4, 5, 9, 10, 11, 12, 20, 22, 25, 99, 100, -1)
    assert [numerals.zh_count(n) for n in counts] == [
        *"零一两四五九十",
        "十一",
        "十二",
        "二十",
        "二十二",
        "二十五",
        "九十九",
        "100",
        "-1",
    ]
    assert numerals.count_words(2) == {"zh": "两", "en": "2"}
    assert numerals.count_words(12) == {"zh": "十二", "en": "12"}
    # the tasks and everything else count with the same function
    assert agenda_facts.zh_count is numerals.zh_count


def test_a_place_in_a_row_is_two_and_not_liang_and_a_share_is_in_tenths():
    assert [numerals.zh_ordinal(n) for n in (1, 2, 3, 9, 10, 12, 22)] == [
        "一",
        "二",
        "三",
        "九",
        "十",
        "十二",
        "二十二",
    ]
    assert [numerals.zh_share(p) for p in (10, 20, 60, 90)] == ["一成", "二成", "六成", "九成"]
    assert [numerals.zh_share(p) for p in (0, 65, 100)] == ["0%", "65%", "100%"]


def test_the_filler_of_the_recap_says_a_count_in_characters_and_a_text_as_it_is():
    said = commitments.fill(
        {
            "zh": "{who}送{amount}根{item}，{n}位在场，{text}",
            "en": "{who} {amount} {item} {n} {text}",
        },
        who={"zh": "李大", "en": "Li Da"},
        amount=2,
        item={"zh": "竹料", "en": "bamboo"},
        n=12,
        text="07:00前，5月",
    )
    assert said == {
        "zh": "李大送两根竹料，十二位在场，07:00前，5月",
        "en": "Li Da 2 bamboo 12 07:00前，5月",
    }


# ---------------------------------------------------------------------------- the previews


@pytest.mark.parametrize(
    ("today", "day", "hour", "zh", "en"),
    [
        (1, 1, 13, "今天13:00前", "by 13:00 today"),
        (2, 2, 7, "今天07:00前", "by 7:00 today"),
        (1, 2, 7, "明早07:00前", "by 7 tomorrow morning"),
        (1, 2, 15, "明天15:00前", "by 15:00 tomorrow"),
        (1, 3, 7, "第三天07:00前", "by 07:00 on day 3"),
        (1, 4, 18, "第四天18:00前", "by 18:00 on day 4"),
    ],
)
def test_the_hour_of_a_request_is_a_clock_time_in_chinese_in_the_form_of_a_promise(
    today, day, hour, zh, en
):
    got = preview._by(today, day, hour)
    assert got == {"zh": zh, "en": en}
    if day > today + 1:  # the same words as the promise has when it is made
        assert got["zh"] == commitments.when_words(day, hour)["zh"]


def test_the_preview_of_a_promise_says_the_coins_and_the_place_in_characters():
    game = talking("li_da")
    wage = {
        "verb": "promise",
        "npc": "li_da",
        "op": "make",
        "what": "wage",
        "item": "",
        "amount": 20,
    }
    got = json.loads(game.preview_json(json.dumps({**wage, "due": 3})))
    assert got["asks"] == {"zh": "二十文工钱", "en": "20 coins in wages"}
    slot = {**wage, "what": "slot", "item": "2", "amount": 0, "due": 3}
    got = json.loads(game.preview_json(json.dumps(slot)))
    assert got["asks"] == {"zh": "节目单上的第二位", "en": "place 2 in the programme"}


def test_the_words_of_a_promise_to_a_model_keep_their_digits_and_those_for_the_player_do_not():
    world = world_of(talking("li_da"))
    assert prompts.promise_text(world, "wage", "", 20) == {
        "zh": "20文工钱",
        "en": "20 coins in wages",
    }
    assert prompts.promise_text(world, "wage", "", 20, town=True) == {
        "zh": "二十文工钱",
        "en": "20 coins in wages",
    }
    assert prompts.promise_text(world, "slot", "2")["zh"] == "节目单上的第2位"
    assert prompts.promise_text(world, "slot", "2", town=True)["zh"] == "节目单上的第二位"
    assert prompts.promise_text(world, "slot", "12", town=True)["zh"] == "节目单上的第十二位"
    stall = prompts.promise_text(world, "stall", "front")
    assert prompts.promise_text(world, "stall", "front", town=True) == stall  # no number in it


# ------------------------------------------------------------------------------ the offers


def test_the_offers_to_promise_say_the_coins_and_the_place_in_characters():
    game = talking("li_da")
    labels = {o["id"]: o["label"] for o in step(game)["frame"]["player"]["offers"]["promise"]}
    assert labels["wage:10"] == {"zh": "许李大十文工钱", "en": "Promise Li Da 10 coins in wages"}
    assert labels["wage:20"] == {"zh": "许李大二十文工钱", "en": "Promise Li Da 20 coins in wages"}
    assert labels["slot:1"] == {
        "zh": "许李大节目单上第一位",
        "en": "Promise Li Da slot 1 of the programme",
    }


# -------------------------------------------------------------------------------- the board


def test_the_words_of_the_board_say_the_town_in_characters_and_the_scores_in_digits():
    assert board.SHORT["named"]["zh"] == "在场的熟面孔不到五个"
    assert board.SHORT["accepted"]["zh"] == "在场的人里信的不到六成"
    assert board.SHORT["named"]["en"] == (
        f"Fewer than {assembly.MIN_NAMED} familiar faces were there"
    )
    assert f"{assembly.ACCEPT_PERCENT}%" in board.SHORT["accepted"]["en"]
    by_id = {act["id"]: act["text"] for act in board.ACTS}
    assert by_id[peace.WORK]["zh"].endswith("最多算两个早上")  # a count of mornings
    assert f"积怨各降{peace.WORK_DROP}点" in by_id[peace.WORK]["zh"]  # a score
    assert f"积怨各降{peace.STOP_DROP}点" in by_id[peace.STOP]["zh"]
    assert f"积怨降{assembly.MEAL_DROP}点" in by_id[peace.MEAL]["zh"]


# ------------------------------------------------------------------------------ the tasks


def test_the_hours_of_the_work_are_clock_times_in_both_languages():
    facts = agenda_facts.Facts(world_of(slice_game()), state_of(slice_game()))
    assert facts["work_from"] == {"zh": "08:00", "en": "08:00"}
    assert facts["work_to"] == {"zh": "12:00", "en": "12:00"}


# ------------------------------------------------------------------------------ the sweep


def test_the_sweep_knows_a_bad_line_from_a_good_one():
    bad = {"a": ["把4根竹料送到石桥", {"b": "5位乡亲"}], "requests": ["把4根竹料"], "c": 4}
    assert digits_before_a_measure_word(bad) == ["把4根竹料送到石桥", "5位乡亲"]
    good = ["把四根竹料送到石桥", "积怨还有39点", "第四天07:00前", "接受的不到60%", "Bring 4 poles"]
    assert digits_before_a_measure_word(good) == []


class Sweep:
    """Wraps ``Game.step`` for a test and keeps every Chinese string with a digit before a measure
    word of every output."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch) -> None:
        self.found: dict[str, int] = {}
        real = api.Game.step
        sweep = self

        def step(self: api.Game, inputs_json: str = "[]") -> str:
            out = real(self, inputs_json)
            for text in digits_before_a_measure_word(json.loads(out)):
                sweep.found[text] = sweep.found.get(text, 0) + 1
            return out

        monkeypatch.setattr(api.Game, "step", step)


def test_no_frame_of_the_scripted_day_has_a_digit_before_a_measure_word(monkeypatch):
    sweep = Sweep(monkeypatch)
    run_driver(seed=2015, ticks=2070)
    assert sweep.found == {}


def test_no_frame_of_a_whole_game_of_the_follower_has_a_digit_before_a_measure_word(monkeypatch):
    """The follower plays the game the opening page starts to the end of the fifth day. It sees the
    paper of every morning, the night summaries, the recap, the tasks with the promises in them, the
    ledger and the offers, and every Chinese string of every frame is held to the rule."""
    sweep = Sweep(monkeypatch)
    (game,) = follow_report.plan_games([492], [])
    result = follow_report.play(game)
    assert result["ending"] != "none" and "error" not in result
    assert sweep.found == {}
