"""The paper of the morning and the summary of the night (``gazette``).

The first tests hold the words: both languages, no person who is he or she, every slot filled. Then
the things that make the headline, kind by kind, and what the town saw in public in the stretch of
the day before and not outside it; the street talk against the street; what is to be done today;
the summary of the night and its three lines; a record that has no paper; and the audit of the
frame: nothing hidden is read but the street, which is marked public, along the same route under
the three stories.
"""

from __future__ import annotations

import json
import re
import string

import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import at, run_to, state_of, world_of
from player_helpers import acks, act
from test_bridge_projection import hidden_changes

from lantern_core.api import Game
from lantern_core.world.bridge import board, clock, commitments, gazette, projection, weather
from lantern_core.world.bridge.data import SCRIPT

MORNING = at(2, 7)
DUSK = at(1, 21)
KINDS = gazette.RANK
LI_DA = "li_da"


def clear_days(game: Game) -> None:
    """A sky without rain on every day, so that a quiet day is quiet."""
    section = state_of(game)["weather"]
    section["plan"] = ["clear"] * len(section["plan"])
    section["kind"] = "clear"


def next_frame(game: Game) -> dict:
    return json.loads(game.step())["frame"]


def twin(snapshot: str) -> Game:
    return Game.from_snapshot_json(snapshot)


def morning_game(**config) -> Game:
    """The slice at the call that makes the paper of the second morning, in a clear sky."""
    game = slice_game(**config)
    clear_days(game)
    run_to(game, MORNING)
    return game


def words_ok(words: dict) -> bool:
    return set(words) == {"zh", "en"} and all(
        isinstance(v, str) and v.strip() for v in words.values()
    )


# ------------------------------------------------------------------------------ the words


def test_every_line_of_the_paper_is_in_both_languages_and_names_no_person_he_or_she():
    paper = SCRIPT["paper"]
    assert set(paper) == {"when", "street", "news", "talk"}
    for group in ("when", "news", "talk"):
        for name, words in paper[group].items():
            assert words_ok(words), (group, name)
            assert not re.search("[他她]", words["zh"]), (group, name)
            assert not re.search(r"\b(he|she|his|her|hers|him)\b", words["en"], re.I), (group, name)
    assert set(paper["news"]) == {
        "bridge_mended", "truth_told", "reconciled", "statement", "statement_refused", "evidence",
        "evidence_refused", "meal", "stopped", "side_by_side", "helpers", "work_stopped", "work",
        "rain_heavy", "rain_light", "quiet", "two_accounts",
    }  # fmt: skip
    assert set(paper["talk"]) == {
        "festival_up", "festival_down", "festival_warm", "festival_mixed", "festival_cool",
        "peace", "talked_out", "li_more", "zhou_more", "li_side", "zhou_side", "split",
        "walk_look", "walk_call", "walk_hand",
    }  # fmt: skip


def test_the_slots_of_a_line_are_the_ones_the_core_fills():
    slots = {
        "statement": {"place", "named", "accepted"},
        "statement_refused": {"place", "named"},
        "evidence": {"place", "named", "accepted"},
        "evidence_refused": {"place", "named"},
        "stopped": {"who"},
        "helpers": {"n"},
        "work_stopped": {"why"},
        "work": {"hours", "left"},
        "rain_heavy": {"when"},
        "rain_light": {"when"},
        "quiet": {"when"},
        "two_accounts": {"first", "second"},
    }
    for name, words in SCRIPT["paper"]["news"].items():
        for lang in ("zh", "en"):
            used = {n for _, n, _, _ in string.Formatter().parse(words[lang]) if n}
            assert used == slots.get(name, set()), (name, lang)
    for name, words in SCRIPT["paper"]["talk"].items():
        for lang in ("zh", "en"):
            assert not [n for _, n, _, _ in string.Formatter().parse(words[lang]) if n], name


def test_the_thresholds_of_the_street_are_in_order():
    street = SCRIPT["paper"]["street"]
    assert street["cool"] < street["warm"] and street["side"] < street["split"]
    assert street["fresh"] >= 1


# ------------------------------------------------------------------------------ the morning


def test_there_is_no_paper_on_the_first_morning_and_one_in_the_call_that_makes_each_after():
    game = slice_game()
    shown = []
    while game.tick < at(5, 8):
        out = json.loads(game.step())
        if out["frame"]["gazette"] is not None:
            shown.append((out["tick"], out["frame"]["gazette"]["day"]))
    assert shown == [(at(day, 7), day) for day in (2, 3, 4, 5)]  # one frame each, none on the first


def test_a_paused_call_shows_the_paper_again_and_a_later_call_does_not():
    game = morning_game()
    assert next_frame(game)["gazette"] is not None
    assert frame_now(game)["gazette"] is not None  # the same instant, seen again
    assert next_frame(game)["gazette"] is None
    assert frame_now(game)["gazette"] is None


def test_the_frame_always_has_both_keys_and_they_are_null_on_most_calls():
    game = slice_game()
    for _ in range(40):
        frame = json.loads(game.step())["frame"]
        assert frame["gazette"] is None and frame["night"] is None


def test_a_morning_when_nothing_happened_is_quiet_and_still_says_what_is_on_today():
    game = morning_game()
    frame = next_frame(game)
    paper = frame["gazette"]
    assert paper["head"]["kind"] == "quiet" and paper["news"] == []
    assert paper["head"]["text"] == {
        "zh": "昨天镇上没有什么大事。",
        "en": "Nothing much happened in town yesterday.",
    }
    assert set(paper["head"]) == {"kind", "text"}
    assert frame["recap"] is None  # the recap has no line on a quiet day, the paper has a headline
    assert paper["today"]["id"] == frame["tracked"]
    assert [kind["kind"] for kind in paper["talk"]][0].startswith("festival_")


def test_the_headline_is_the_delivery_and_the_short_items_are_the_other_lines_of_the_recap():
    game = slice_game(dev_actions=1)
    clear_days(game)
    run_to(game, at(1, 18, 20))
    act(game, "dev_goal", op="material", npc=LI_DA)
    run_to(game, MORNING)
    frame = next_frame(game)
    paper = frame["gazette"]
    assert paper["head"] == {
        "kind": "delivery",
        "text": {
            "zh": "李大答应的四根竹料，已经送到石桥。",
            "en": "The 4 poles of bamboo that Li Da promised have reached the Stone Bridge.",
        },
    }
    assert paper["news"] == [{"kind": "promise", "text": frame["recap"][1]["text"]}]
    assert frame["recap"][1]["text"]["zh"] == "李大答应送来四根竹料。"  # the recap is as it was
    assert [row["text"] for row in frame["recap"]] == [
        paper["head"]["text"],
        paper["news"][0]["text"],
    ]
    # the record keeps the numbers of the events that the lines are made from
    kept = state_of(game)[commitments.SECTION]["recap"]["news"]
    assert [row["events"] for row in kept] == [row["events"] for row in frame["recap"]]


def test_the_paper_is_kept_in_the_record_of_the_recap_with_the_street_it_found():
    game = morning_game()
    next_frame(game)
    record = state_of(game)[commitments.SECTION]["recap"]
    assert set(record) == {"day", "tick", "lines", "news", "street", "talk"}
    assert record["day"] == 2 and record["tick"] == MORNING
    assert [row["kind"] for row in record["news"]] == ["quiet"]
    assert set(record["street"]) == {"keen", "li", "zhou"}
    assert all(isinstance(n, int) for n in record["street"].values())
    assert all(kind in SCRIPT["paper"]["talk"] for kind in record["talk"])
    # a game that has not come to the second morning has none of it
    fresh = state_of(slice_game())[commitments.SECTION]
    assert fresh == commitments.init(None, None)


# ------------------------------------------------------------------------------ what makes the news


@pytest.fixture(scope="module")
def third():
    """A plain game on the morning of the third day, as a snapshot: the stretch is the second day,
    the work at the bridge has not had its first morning (so it is no news), nobody did anything."""
    game = slice_game()
    clear_days(game)
    run_to(game, at(3, 7))
    return game.snapshot_json()


@pytest.fixture(scope="module")
def late():
    """A plain game on the morning of the fourth day, as a snapshot: nobody did anything."""
    game = slice_game()
    clear_days(game)
    run_to(game, at(4, 7))
    return game.snapshot_json()


def items_of(game: Game, since: int, until: int, journal=(), which="morning") -> list:
    return gazette.collect(world_of(game), state_of(game), list(journal), since, until, which)


def kinds_of(game: Game, since: int, until: int, journal=(), which="morning") -> list[str]:
    return [item.kind for item in items_of(game, since, until, journal, which)]


def test_the_milestones_come_first_in_the_order_of_their_weight(third):
    game = twin(third)
    flags = state_of(game)["goals"]["flags"]
    flags.update(reconciled=at(2, 15), truth_told=at(2, 16), bridge_fixed=at(2, 17))
    flags["reconcile_seen"] = at(2, 15)
    speeches = state_of(game)["player"]["public"]["speeches"]
    told = [at(2, 16), "p_teahouse", 9, 8, 2, 1, 1, []]  # the statement that told the truth
    speeches.append(told)
    found = kinds_of(game, at(2, 7), at(3, 7))
    # the mended bridge, the truth told, the peace; the statement and the meal are what they were
    assert found == ["bridge_mended", "truth_told", "reconciled"]


def test_a_thing_outside_the_stretch_is_no_news_and_the_next_morning_has_its_own(third):
    game = twin(third)
    state_of(game)["goals"]["flags"]["bridge_fixed"] = at(2, 11)
    assert kinds_of(game, at(2, 7), at(3, 7)) == ["bridge_mended"]
    assert kinds_of(game, at(3, 7), at(4, 7)) == ["work_stopped"]  # not the bridge again
    assert kinds_of(game, at(1, 7), at(2, 7)) == ["quiet"]  # and not the day before it happened
    assert kinds_of(game, at(2, 11) - 1, at(2, 11)) == ["bridge_mended"]  # to the tick, in
    assert kinds_of(game, at(2, 11), at(2, 12)) == ["quiet"]  # and the tick it was raised at is out


def test_a_meal_is_news_until_the_families_are_at_peace_and_then_the_peace_is(third):
    game = twin(third)
    state_of(game)["goals"]["flags"]["reconcile_seen"] = at(2, 15)
    assert kinds_of(game, at(2, 7), at(3, 7)) == ["meal"]
    state_of(game)["goals"]["flags"]["reconciled"] = at(2, 15)
    assert kinds_of(game, at(2, 7), at(3, 7)) == ["reconciled"]


def test_a_statement_that_moved_people_is_news_and_one_that_moved_nobody_comes_after_the_rest(
    third,
):
    game = twin(third)
    speeches = state_of(game)["player"]["public"]["speeches"]
    speeches.append([at(2, 18), "p_teahouse", 8, 3, 1, 0, 0, []])
    (item,) = items_of(game, at(2, 7), at(3, 7))
    assert item.kind == "statement"
    assert item.text == {
        "zh": "你在茶馆当众陈述，八位有名有姓的人在场，三位接受。",
        "en": "You made your statement in public at the Teahouse. 3 of the 8 named people there "
        "accepted it.",
    }
    speeches[-1] = [at(2, 18), "p_clan_hall", 8, 0, 1, 0, 0, []]
    (item,) = items_of(game, at(2, 7), at(3, 7))
    assert item.kind == "statement_refused"
    assert item.text["zh"] == "你在祠堂当众陈述，八位有名有姓的人在场，没有人接受。"
    assert item.text["en"].startswith(
        "You made your statement in public at the Ancestral Hall, and none"
    )
    state_of(game)["goals"]["flags"]["bridge_fixed"] = at(2, 11)
    state_of(game)["goals"]["flags"]["truth_told"] = at(2, 12)  # a milestone, and the refusal after
    assert kinds_of(game, at(2, 7), at(3, 7)) == [
        "bridge_mended",
        "truth_told",
        "statement_refused",
    ]
    assert kinds_of(game, at(2, 7), at(2, 17)) == ["bridge_mended", "truth_told"]


def test_a_showing_of_evidence_is_news_too_and_one_that_moved_nobody_comes_after_the_rest(third):
    game = twin(third)
    speeches = state_of(game)["player"]["public"]["speeches"]
    speeches.append([at(2, 18), "p_clan_hall", 8, 3, 1, 0, 0])  # seven fields: a showing
    (item,) = items_of(game, at(2, 7), at(3, 7))
    assert item.kind == "evidence"
    assert item.text == {
        "zh": "你在祠堂当众出示了手里的证据，八位有名有姓的人在场，三位接受。",
        "en": "You showed what you hold in public at the Ancestral Hall. 3 of the 8 named people "
        "there took it in.",
    }
    speeches[-1] = [at(2, 18), "p_teahouse", 8, 0, 1, 0, 0]
    (item,) = items_of(game, at(2, 7), at(3, 7))
    assert item.kind == "evidence_refused"
    assert item.text["zh"] == "你在茶馆当众出示了手里的证据，八位有名有姓的人在场，没有人接受。"
    # a full statement and a showing in the same stretch are two items, the statement first
    speeches.append([at(2, 19), "p_teahouse", 8, 5, 2, 1, 0, []])
    assert kinds_of(game, at(2, 7), at(3, 7)) == ["statement", "evidence_refused"]


def test_the_deeds_of_the_peace_are_news_a_head_who_stops_accusing_and_the_helpers_of_both_families(
    third,
):
    game = twin(third)
    journal = [
        [11, "eased", at(2, 18), {"act": "stop_blaming", "npc": "zhou_zhanggui"}],
        [12, "eased", at(2, 19), {"act": "work_together", "day": 3}],
    ]
    items = items_of(game, at(2, 7), at(3, 7), journal)
    assert [item.kind for item in items] == ["stopped", "side_by_side"]
    assert items[0].events == (11,) and items[1].events == (12,)
    assert items[0].text == {
        "zh": "周掌柜当着众人，不再说对方家的不是了。",
        "en": "Shopkeeper Zhou has stopped speaking ill of the other family in public.",
    }
    assert items[1].text["en"] == "People of both families worked at the bridge together."
    # the peace itself comes before them, and the meal that was seen is no more than the deeds
    state_of(game)["goals"]["flags"]["reconciled"] = at(2, 20)
    assert kinds_of(game, at(2, 7), at(3, 7), journal) == ["reconciled", "stopped", "side_by_side"]


def test_the_helpers_who_joined_in_the_stretch_are_counted(third):
    game = twin(third)
    call = state_of(game)["goals"]["call"]
    call["joined"] = [
        [LI_DA, at(2, 8), 1, "call"],
        ["zhou_zhanggui", at(2, 9), 1, "call"],
        ["cha_laoban", at(1, 9), 1, "call"],  # the day before the stretch
    ]
    (item,) = items_of(game, at(2, 7), at(3, 7))
    assert (item.kind, item.text) == (
        "helpers",
        {
            "zh": "两位乡亲答应来桥边帮手。",
            "en": "2 more of the town agreed to help at the bridge.",
        },
    )


def test_the_work_at_the_bridge_is_news_when_it_stopped_and_when_it_has_got_on(late, monkeypatch):
    game = twin(late)
    state_of(game)["social"].pop("aloud", None)  # what the street says is not what this is about
    stopped = next(i for i in items_of(game, at(3, 7), at(4, 7)) if i.kind == "work_stopped")
    assert stopped.text["en"].startswith("Work at the bridge stopped. ")
    assert stopped.text["zh"].startswith("桥边的活停了。")
    assert board.NO_HANDS["zh"] in stopped.text["zh"]  # the words of the board, the same reason
    assert board.NO_HANDS["en"] in stopped.text["en"]
    monkeypatch.setattr(
        board, "wire", lambda world, ws, tick: {"stop": None, "hours": {"done": 4, "need": 10}}
    )
    (work,) = items_of(game, at(3, 7), at(4, 7))
    assert (work.kind, work.text) == (
        "work",
        {
            "zh": "桥边已经干了四个钟头，还差六个。",
            "en": "4 hours of work are done at the bridge, and 6 more are needed.",
        },
    )
    monkeypatch.setattr(
        board, "wire", lambda world, ws, tick: {"stop": None, "hours": {"done": 10, "need": 10}}
    )
    assert kinds_of(game, at(3, 7), at(4, 7)) == ["quiet"]
    monkeypatch.setattr(
        board, "wire", lambda world, ws, tick: {"stop": None, "hours": {"done": 0, "need": 10}}
    )
    assert kinds_of(game, at(3, 7), at(4, 7)) == ["quiet"]


def test_the_work_done_is_no_news_when_the_bridge_was_mended_in_the_stretch(late, monkeypatch):
    game = twin(late)
    state_of(game)["social"].pop("aloud", None)  # what the street says is not what this is about
    state_of(game)["goals"]["flags"]["bridge_fixed"] = at(3, 11)
    monkeypatch.setattr(
        board, "wire", lambda world, ws, tick: {"stop": None, "hours": {"done": 4, "need": 10}}
    )
    assert kinds_of(game, at(3, 7), at(4, 7)) == ["bridge_mended"]


def test_the_sky_of_the_day_before_is_news_when_it_rained_and_of_today_at_night(third):
    game = twin(third)
    plan = state_of(game)["weather"]["plan"]
    plan[1] = weather.HEAVY_RAIN
    (rain,) = items_of(game, at(2, 7), at(3, 7))
    assert rain.kind == "rain" and rain.text == {
        "zh": "昨天落了一场大雨，街上行人稀少。",
        "en": "Heavy rain fell yesterday, and the streets emptied.",
    }
    plan[1] = weather.LIGHT_RAIN
    (rain,) = items_of(game, at(2, 7), at(3, 7))
    assert rain.text == {"zh": "昨天飘了一阵小雨。", "en": "It drizzled yesterday."}
    (rain,) = items_of(game, at(2, 7), at(2, 21), which="night")  # the night is of the same day
    assert rain.text == {"zh": "今天飘了一阵小雨。", "en": "It drizzled today."}
    plan[1] = weather.CLEAR
    assert kinds_of(game, at(2, 7), at(3, 7)) == ["quiet"]


def test_the_journal_makes_the_delivery_the_stance_and_the_promise_and_the_newest_comes_first(
    third,
):
    game = twin(third)

    def delivered(n, tick, item, promise):
        note = {"id": promise, "npc": LI_DA, "item": item, "amount": 4, "place": "p_bridge"}
        return [n, "delivered", tick, note]

    def promised(n, tick, item, promise):
        return [n, "commitment", tick, {"id": promise, "by": LI_DA, "item": item, "amount": 4}]

    journal = [
        promised(3, 10, "bamboo", "m1"),
        delivered(5, 20, "bamboo", "m1"),
        [7, "objection_withdrawn", 30, {"npc": "li_laotai"}],
        promised(8, 35, "timber", "m2"),
        delivered(9, 40, "timber", "m2"),
    ]
    items = items_of(game, at(2, 7), at(3, 7), journal)
    assert [(item.kind, item.events) for item in items] == [
        ("delivery", (8, 9)),
        ("delivery", (3, 5)),
        ("stance", (7,)),
        ("promise", (8,)),
        ("promise", (3,)),
    ]
    assert "timber" in items[0].text["en"] and "bamboo" in items[1].text["en"]


def test_the_headline_and_two_short_items_are_kept_and_the_rest_dropped():
    game = morning_game()
    state_of(game)["goals"]["flags"].update(
        bridge_fixed=at(1, 11), truth_told=at(1, 12), reconciled=at(1, 13)
    )
    state_of(game)["weather"]["plan"][0] = weather.HEAVY_RAIN
    paper = next_frame(game)["gazette"]
    assert [paper["head"]["kind"]] + [row["kind"] for row in paper["news"]] == [
        "bridge_mended",
        "truth_told",
        "reconciled",
    ]  # the rain, the least of four, is left out
    kept = state_of(game)[commitments.SECTION]["recap"]["news"]
    assert [row["kind"] for row in kept] == ["bridge_mended", "truth_told", "reconciled"]


def test_the_short_items_are_one_of_each_other_kind_before_a_second_of_any():
    def item(kind: str, order: int) -> gazette.Item:
        return gazette.Item(kind, {"zh": kind, "en": f"{kind} {order}"}, order=order)

    ranked = [
        item("delivery", 9),
        item("delivery", 3),
        item("stance", 7),
        item("stance", 5),
        item("promise", 8),
    ]
    # the delivery that is the headline, then a stance and the promise: not a second stance
    assert [(i.kind, i.order) for i in gazette.front(ranked)] == [
        ("delivery", 9),
        ("stance", 7),
        ("promise", 8),
    ]
    # with only two kinds the room is filled with the next of the first kind
    two = [item("delivery", 9), item("delivery", 3), item("delivery", 1), item("stance", 7)]
    assert [(i.kind, i.order) for i in gazette.front(two)] == [
        ("delivery", 9),
        ("delivery", 3),
        ("stance", 7),
    ]
    assert gazette.front(ranked[:1]) == ranked[:1] and gazette.front(ranked[:2]) == ranked[:2]
    assert len(gazette.front(ranked + two)) == 3


# ------------------------------------------------------------------------------ the street


def street(keen: int, li: int, zhou: int) -> dict:
    return {"keen": keen, "li": li, "zhou": zhou}


def crowd_of(game: Game, keen: int, li: int, zhou: int) -> None:
    """Set the townsfolk without names: ``keen`` of them keen, ``li`` on the side of the Li family,
    ``zhou`` on the side of the Zhou family."""
    section = state_of(game)["crowd"]
    size = len(section["enthusiasm"])
    section["enthusiasm"] = [70] * keen + [10] * (size - keen)
    section["stance"] = [-60] * li + [60] * zhou + [0] * (size - li - zhou)


@pytest.mark.parametrize(
    ("keen", "kind"),
    [(70, "festival_warm"), (50, "festival_warm"), (49, "festival_mixed"), (30, "festival_mixed"),
     (29, "festival_cool"), (0, "festival_cool")],
)  # fmt: skip
def test_the_street_is_warm_mixed_or_cool_by_how_many_are_keen(keen, kind):
    game = slice_game()
    crowd_of(game, keen, 0, 0)
    assert gazette.street_talk(state_of(game), None, at(2, 7))[0] == kind


def test_a_change_of_eight_keen_since_the_last_morning_is_the_street_warming_or_cooling():
    game = slice_game()
    crowd_of(game, 60, 0, 0)
    before = street(52, 0, 0)
    assert gazette.street_talk(state_of(game), before, at(2, 7))[0] == "festival_up"
    assert gazette.street_talk(state_of(game), street(53, 0, 0), at(2, 7))[0] == "festival_warm"
    assert gazette.street_talk(state_of(game), street(68, 0, 0), at(2, 7))[0] == "festival_down"
    assert gazette.street_talk(state_of(game), street(67, 0, 0), at(2, 7))[0] == "festival_warm"


@pytest.mark.parametrize(
    ("li", "zhou", "before", "kind"),
    [
        (80, 20, None, "li_side"),
        (20, 80, None, "zhou_side"),
        (80, 60, None, "split"),
        (50, 50, None, "split"),
        (30, 10, None, None),  # too few on either side to be called anything
        (60, 20, street(60, 60, 20), "li_side"),
        (90, 40, street(60, 60, 40), "li_more"),
        (40, 90, street(60, 40, 60), "zhou_more"),
    ],
)
def test_the_street_leans_to_a_side_splits_or_turns_since_the_last_morning(li, zhou, before, kind):
    game = slice_game()
    crowd_of(game, 60, li, zhou)
    talk = gazette.street_talk(state_of(game), before, at(2, 7))
    assert talk[1:] == ([] if kind is None else [kind])


def test_the_peace_and_the_truth_told_are_what_the_street_talks_of_while_they_are_fresh():
    game = slice_game()
    crowd_of(game, 60, 80, 20)
    flags = state_of(game)["goals"]["flags"]
    flags["truth_told"] = at(3, 12)
    assert gazette.street_talk(state_of(game), None, at(4, 7))[1:] == ["talked_out"]
    assert gazette.street_talk(state_of(game), None, at(5, 7))[1:] == ["talked_out"]
    assert gazette.street_talk(state_of(game), None, at(5, 13))[1:] == ["li_side"]  # three days on
    flags["reconciled"] = at(4, 9)
    assert gazette.street_talk(state_of(game), None, at(5, 7))[1:] == ["peace"]


def test_the_street_talk_of_the_frame_is_the_script_s_words_in_both_languages():
    game = morning_game()
    crowd_of(game, 20, 70, 20)
    frame = next_frame(game)
    talk = frame["gazette"]["talk"]
    assert [row["kind"] for row in talk] == ["festival_cool", "li_side"]
    assert talk[0]["text"] == SCRIPT["paper"]["talk"]["festival_cool"]
    assert talk[1]["text"]["zh"] == "街上向着李家说话的人多些。"
    assert talk[1]["text"]["en"].startswith("More people on the street speak up for the Li")


# ------------------------------------------------------------------------------ what is on today


def test_what_is_to_be_done_today_is_the_task_followed_with_its_time_and_place():
    game = morning_game()
    frame = next_frame(game)
    paper = frame["gazette"]
    followed = next(task for task in frame["tasks"] if task["id"] == frame["tracked"])
    assert paper["today"] == {
        "id": followed["id"],
        "text": followed["text"],
        "state": followed["state"],
        "window": followed["window"],
        "next": followed["next"],
    }
    assert paper["today"]["window"] is not None
    assert words_ok(paper["today"]["text"])


def test_the_other_chances_today_are_live_tasks_with_a_time_today_one_for_each_time_and_place():
    game = morning_game()
    frame = next_frame(game)
    paper = frame["gazette"]
    assert len(paper["more"]) <= 2
    live = {task["id"]: task for task in frame["tasks"] if task["state"] in ("open", "blocked")}
    seen = [paper["today"]["window"]]
    for row in paper["more"]:
        assert row["id"] in live and row["id"] != paper["today"]["id"]
        assert row["window"]["day"] == 2
        assert row["window"] not in seen
        seen.append(row["window"])
    starts = [row["window"]["from"] for row in paper["more"]]
    assert starts == sorted(starts)


def test_with_no_task_left_there_is_nothing_to_recommend():
    assert gazette._today({"tasks": [], "tracked": None}, 2) == (None, [])
    done = {
        "id": "t_x",
        "text": {"zh": "x", "en": "x"},
        "state": "done",
        "window": None,
        "next": None,
    }
    assert gazette._today({"tasks": [done], "tracked": "t_x"}, 2) == (None, [])
    live = {**done, "id": "t_y", "state": "open"}
    today, more = gazette._today({"tasks": [done, live], "tracked": "t_x"}, 2)
    assert today["id"] == "t_y" and more == []  # the one followed is done: the most urgent live one


# ------------------------------------------------------------------------------ the night


def refused_the_bamboo(game: Game) -> None:
    """Granny Li is asked for the bamboo at half past six and says no, naming the rumour: the task
    of the bamboo is blocked."""
    run_to(game, at(1, 6, 30))
    meet(game, "li_laotai")
    assert acks(act(game, "entrust", kind="lend")) == [("rejected", "hard")]
    act(game, "leave")


@pytest.fixture(scope="module")
def evening():
    """The slice at the call before the first dusk, in a clear sky and the bamboo refused."""
    game = slice_game()
    clear_days(game)
    refused_the_bamboo(game)
    run_to(game, DUSK)
    return game.snapshot_json()


@pytest.fixture(scope="module")
def quiet_evening():
    """The same, in a game in which nobody asked for anything."""
    game = slice_game()
    clear_days(game)
    run_to(game, DUSK)
    return game.snapshot_json()


def test_the_night_comes_in_the_call_that_makes_the_dusk_of_each_day_but_the_last():
    game = slice_game()
    shown = []
    while game.tick < at(5, 22):
        out = json.loads(game.step())
        if out["frame"]["night"] is not None:
            shown.append((out["tick"], out["frame"]["night"]["day"]))
    assert shown == [(at(day, 21), day) for day in (1, 2, 3, 4)]  # the fifth dusk is the ending's


def test_a_paused_call_at_dusk_shows_the_night_again_and_a_later_call_does_not(evening):
    game = twin(evening)
    assert next_frame(game)["night"] is not None
    assert frame_now(game)["night"] is not None
    assert next_frame(game)["night"] is None


def test_the_night_has_what_changed_what_is_in_the_way_and_the_step_for_tomorrow(evening):
    game = twin(evening)
    frame = next_frame(game)
    night = frame["night"]
    assert night["day"] == 1 and set(night) == {"day", "changed", "blocked", "step"}
    assert night["changed"] == {
        "kind": "quiet",
        "text": {
            "zh": "今天镇上没有什么大事。",
            "en": "Nothing much happened in town today.",
        },
    }
    blocked = [task for task in frame["tasks"] if task["state"] == "blocked"]
    assert [task["id"] for task in blocked] == ["t_bamboo_first"]  # Granny Li said no
    assert night["blocked"] == {
        "id": "t_bamboo_first",
        "text": blocked[0]["text"],
        "blocker": blocked[0]["blocker"],
    }
    assert night["blocked"]["blocker"]["zh"] == "李家不肯给竹料"
    tomorrow = [
        task
        for task in frame["tasks"]
        if task["state"] in ("open", "blocked")
        and task["window"] is not None
        and task["window"]["day"] == 2
    ]
    first = min(tomorrow, key=lambda task: task["window"]["from"])
    assert night["step"] == {"id": first["id"], "text": first["text"], "window": first["window"]}
    assert first["window"]["day"] == 2


def test_the_most_urgent_blocked_task_is_the_obstacle_the_first_of_tomorrow_the_step(evening):
    game = twin(evening)
    frame = next_frame(game)
    order = [task["id"] for task in frame["tasks"]]  # the most urgent first
    blocked = [task["id"] for task in frame["tasks"] if task["state"] == "blocked"]
    assert frame["night"]["blocked"]["id"] == blocked[0] == min(blocked, key=order.index)
    timed = {
        task["id"]: task["window"]["from"]
        for task in frame["tasks"]
        if task["state"] in ("open", "blocked")
        and task["window"] is not None
        and task["window"]["day"] == 2
    }
    assert timed[frame["night"]["step"]["id"]] == min(timed.values())


def test_what_changed_today_is_the_first_item_of_the_day_since_the_recap(quiet_evening):
    game = twin(quiet_evening)
    state_of(game)["goals"]["flags"]["truth_told"] = at(1, 18)
    night = next_frame(game)["night"]
    assert night["changed"] == {"kind": "truth_told", "text": SCRIPT["paper"]["news"]["truth_told"]}
    # on a later day only what came after the recap of that morning counts
    later = slice_game()
    clear_days(later)
    state_of(later)["goals"]["flags"]["truth_told"] = at(
        2, 6, 30
    )  # before the recap of the morning
    run_to(later, at(2, 21))
    assert next_frame(later)["night"]["changed"]["kind"] == "quiet"
    again = slice_game()
    clear_days(again)
    run_to(again, at(2, 20))
    state_of(again)["goals"]["flags"]["truth_told"] = at(2, 20)
    run_to(again, at(2, 21))
    assert next_frame(again)["night"]["changed"]["kind"] == "truth_told"


def test_with_nothing_blocked_there_is_no_obstacle_and_with_no_time_tomorrow_the_task_followed(
    quiet_evening,
):
    game = twin(quiet_evening)
    frame = next_frame(game)
    assert frame["night"]["blocked"] is None  # nobody has been refused
    out = {
        "tasks": [
            {"id": "t_a", "text": {"zh": "甲", "en": "A"}, "state": "open", "window": None,
             "next": None, "blocker": None},
            {"id": "t_b", "text": {"zh": "乙", "en": "B"}, "state": "open",
             "window": {"day": 1, "from": 17, "to": 19, "place": "p_teahouse"},
             "next": None, "blocker": None},
        ],
        "tracked": "t_a",
    }  # fmt: skip
    night = gazette._night(world_of(game), game._kernel.state, out, clock.at(at(1, 21)))
    assert night["step"] == {"id": "t_a", "text": {"zh": "甲", "en": "A"}, "window": None}
    out["tasks"][1]["window"]["day"] = 2
    night = gazette._night(world_of(game), game._kernel.state, out, clock.at(at(1, 21)))
    assert night["step"]["id"] == "t_b" and night["step"]["window"]["day"] == 2
    out["tasks"] = []
    out["tracked"] = None
    night = gazette._night(world_of(game), game._kernel.state, out, clock.at(at(1, 21)))
    assert night["blocked"] is None and night["step"] is None


def test_the_last_dusk_is_the_ending_s_and_there_is_no_night_after_it():
    game = slice_game()
    run_to(game, at(5, 21))
    out = json.loads(game.step())
    assert out["frame"]["night"] is None and out["frame"]["ending"] is not None
    assert next_frame(game)["night"] is None


# ------------------------------------------------------------------------------ before the paper


def test_a_record_from_before_the_paper_has_a_paper_made_of_the_lines_of_the_recap():
    game = slice_game(dev_actions=1)
    clear_days(game)
    run_to(game, at(1, 18, 20))
    act(game, "dev_goal", op="material", npc=LI_DA)
    run_to(game, MORNING)
    frame = next_frame(game)
    assert frame["gazette"]["head"]["kind"] == "delivery"
    record = state_of(game)[commitments.SECTION]["recap"]
    for key in ("news", "street", "talk"):  # a record made before the paper has none of them
        del record[key]
    old = frame_now(game)
    assert old["recap"] == frame["recap"]
    paper = old["gazette"]
    assert paper["head"] == {"kind": "recap", "text": frame["recap"][0]["text"]}
    assert paper["news"] == [{"kind": "recap", "text": row["text"]} for row in frame["recap"][1:]]
    assert paper["talk"] == [] and paper["today"] is not None
    # and a record of a quiet morning from before has the quiet line
    quiet = morning_game()
    next_frame(quiet)
    record = state_of(quiet)[commitments.SECTION]["recap"]
    for key in ("news", "street", "talk"):
        del record[key]
    paper = frame_now(quiet)["gazette"]
    assert paper["head"]["kind"] == "quiet" and paper["news"] == [] and paper["talk"] == []


def test_a_world_that_keeps_no_goals_of_the_festival_has_both_keys_null():
    game = morning_game()
    world, state = world_of(game), game._kernel.state
    saved = state["world"]["goals"]
    state["world"]["goals"] = {"probe": 1}  # another subsystem under the name
    try:
        out = {"tasks": [], "tracked": None}
        gazette.frame(world, state, out)
        assert out == {"tasks": [], "tracked": None, "gazette": None, "night": None}
        assert (
            gazette.print_morning(
                type("Sim", (), {"world": world, "state": state["world"], "ctx": None})(),
                {"tick": -1},
                [],
            )
            == {}
        )
    finally:
        state["world"]["goals"] = saved


# ------------------------------------------------------------------------------ the audit


def test_the_rows_of_the_audit_name_the_paper_and_the_street_talk_is_the_public_part():
    rows = {entry.path: entry for entry in projection.FRAME}
    assert rows["gazette"].mark == "known" and rows["night"].mark == "known"
    assert rows["gazette.talk[]"].mark == "public"
    for path, mark in (
        ("gazette.head.text.zh", "known"),
        ("gazette.today.window.place", "known"),
        ("gazette.talk", "public"),
        ("gazette.talk[].text.en", "public"),
        ("night.step.window.from", "known"),
        ("night.changed.kind", "known"),
    ):
        assert projection.mark_of(path) == mark, path
    assert (
        projection.mark_of("gazette.secret") is None and projection.mark_of("night.truth") is None
    )
    assert projection.mark_of("gazette.head.events") == "known"  # ... but the frame has none:
    game = morning_game()
    paper = next_frame(game)["gazette"]
    assert "events" not in json.dumps(paper)


def paper_of(frame: dict) -> dict:
    return {key: frame[key] for key in ("gazette", "night")}


@pytest.fixture(scope="module")
def eve_of_the_morning():
    """The slice a call before the paper of the second morning, with the bamboo promised and a
    helper joined, as a snapshot."""
    game = slice_game(dev_actions=1)
    run_to(game, at(1, 18, 20))
    act(game, "dev_goal", op="material", npc=LI_DA)
    act(game, "dev_goal", op="join", npc="zhou_zhanggui")
    run_to(game, MORNING)
    return game.snapshot_json()


@pytest.fixture(scope="module")
def eve_of_the_dusk():
    game = slice_game(dev_actions=1)
    run_to(game, at(1, 18, 20))
    act(game, "dev_goal", op="material", npc=LI_DA)
    run_to(game, DUSK)
    return game.snapshot_json()


@pytest.mark.parametrize("name", list(hidden_changes(None)))
def test_changing_what_is_hidden_changes_nothing_in_the_paper_but_the_street_talk(
    eve_of_the_morning, name
):
    """The headline and the short items read the dealings of the manager and the public record; what
    is to be done today reads the tasks of the frame, which read the grudge between the heads that
    the board shows (the one hidden change that zeroes it moves the words of the task of the peace,
    in the frame's own ``tasks`` too); the street talk reads the street."""
    plain, changed = twin(eve_of_the_morning), twin(eve_of_the_morning)
    hidden_changes(state_of(changed))[name](state_of(changed))
    base, other = next_frame(plain), next_frame(changed)
    assert base["gazette"] is not None and base["gazette"]["head"]["kind"] == "delivery"
    for key in ("day", "head", "news"):
        assert other["gazette"][key] == base["gazette"][key], key
    if (other["tasks"], other["tracked"]) == (base["tasks"], base["tracked"]):
        for key in ("today", "more"):
            assert other["gazette"][key] == base["gazette"][key], key
    else:
        assert name == "nobody is fond of anyone"  # the grudge is on the board: not hidden
        assert other["board"]["peace"]["grudge"] != base["board"]["peace"]["grudge"]
    if name != "the street is cold":
        assert other["gazette"]["talk"] == base["gazette"]["talk"]


def test_the_street_talk_follows_the_street_and_nothing_else_hidden(eve_of_the_morning):
    plain, cold = twin(eve_of_the_morning), twin(eve_of_the_morning)
    hidden_changes(state_of(cold))["the street is cold"](state_of(cold))
    base, other = next_frame(plain), next_frame(cold)
    assert other["gazette"]["talk"] != base["gazette"]["talk"]
    assert other["gazette"]["talk"][0]["kind"] == "festival_cool"


@pytest.mark.parametrize("name", list(hidden_changes(None)))
def test_changing_what_is_hidden_changes_nothing_in_the_summary_of_the_night(eve_of_the_dusk, name):
    plain, changed = twin(eve_of_the_dusk), twin(eve_of_the_dusk)
    hidden_changes(state_of(changed))[name](state_of(changed))
    base, other = next_frame(plain), next_frame(changed)
    assert base["night"] is not None
    assert other["night"] == base["night"]


def along_the_route(variant: str) -> list:
    """The same doings by the clock under a story, from the first morning to the third: the paper
    and the night in every call that has them."""
    game = slice_game(variant=variant, dev_actions=1)
    plan = {
        at(1, 18, 20): {"op": "material", "npc": LI_DA},
        at(2, 8): {"op": "join", "npc": "zhou_zhanggui"},
        at(2, 8, 30): {"op": "join", "npc": "cha_laoban"},
        at(2, 12): {"op": "truth"},
        at(2, 13): {"op": "grudge", "value": 10},
        at(2, 14): {"op": "reconcile"},
    }
    seen = []
    while game.tick < at(3, 8):
        out = (
            act(game, "dev_goal", **plan[game.tick])
            if game.tick in plan
            else json.loads(game.step())
        )
        frame = out["frame"]
        if frame["gazette"] is not None or frame["night"] is not None:
            seen.append((out["tick"], paper_of(frame)))
    return seen


@pytest.fixture(scope="module")
def under_the_boatman():
    return along_the_route("v_boat")


@pytest.mark.parametrize("variant", ["v_flood", "v_drunk"])
def test_the_paper_and_the_night_after_every_call_are_the_same_whichever_story_is_true(
    under_the_boatman, variant
):
    """The street talk is left out: it reads the townsfolk without names, whose mood can differ from
    story to story along a route as the talk about the rail goes round (the side panel shows the
    same turnout), and the test of the hidden changes holds it to the street alone."""

    def without_the_street(route: list) -> list:
        return [
            (tick, {**paper, "gazette": paper["gazette"] and {**paper["gazette"], "talk": None}})
            for tick, paper in route
        ]

    assert without_the_street(along_the_route(variant)) == without_the_street(under_the_boatman)


def test_the_route_has_the_paper_of_two_mornings_and_the_night_of_two_days(under_the_boatman):
    assert [tick for tick, _ in under_the_boatman] == [at(1, 21), at(2, 7), at(2, 21), at(3, 7)]
    kinds = [
        row["kind"]
        for _, frame in under_the_boatman
        if frame["gazette"] is not None
        for row in (frame["gazette"]["head"], *frame["gazette"]["news"])
    ]
    assert kinds[:2] == ["delivery", "promise"]  # the first morning
    assert {"truth_told", "reconciled"} <= set(kinds[2:])
    nights = [frame["night"]["changed"]["kind"] for _, frame in under_the_boatman if frame["night"]]
    assert nights[0] == "promise" and nights[1] == "truth_told"


def test_the_clock_the_paper_reads_is_the_one_of_the_recap():
    assert gazette.rules().street["fresh"] * clock.CYCLE_TICKS == 2 * 2070
    assert commitments.rules().recap_hour == 7
