"""The people of the frame: who is known, the line the town says of each, and that nothing hidden
reaches them. Two games in which the manager does the same and another story is true have the same
people, the same hearts and the same first-day talk, to the word."""

from __future__ import annotations

import json
import re

import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import CAST, at, bridge, run_to
from player_helpers import act, me

from lantern_core.world.bridge import context, pledges, projection
from lantern_core.world.bridge.data import CAST as CAST_DATA
from lantern_core.world.bridge.data import SCRIPT

# what the town does not say of a person in a line: the case, who saw what, what is true
CASE_WORDS = (
    "栏杆",
    "弄坏",
    "毁桥",
    "撑船",
    "证人",
    "目击",
    "秋汛",
    "醉酒",
    "真相",
    "凶手",
    "看见",
)
CASE_WORDS_EN = ("rail", "witness", "culprit", " broke ", "truth", " saw ", "blame", "damage")
PRONOUNS_EN = re.compile(r"\b(?:he|she|his|her|hers|him)\b", re.I)
OPENING_SIX = ("zuzhang", "li_laotai", "li_er", "li_da", "zhou_zhanggui", "zhou_huoji")


def people_of(frame):
    return frame["people"]


# ------------------------------------------------------------------------------ the lines


def test_the_frame_has_the_twenty_in_the_order_of_the_cast_with_no_line_of_the_town_in_a_row():
    frame = frame_now(bridge(1))
    rows = people_of(frame)
    assert [row["id"] for row in rows] == [p.id for p in CAST.people]
    assert all(set(row) == {"id", "known", "hearts", "likes_known", "gifts", "card",
                            "met", "asked"} for row in rows)  # fmt: skip
    assert all(row["known"] is False and row["card"] is None and row["hearts"] == 0 for row in rows)
    assert all(row["likes_known"] == [] and row["gifts"] == 0 for row in rows)


def test_the_line_of_the_town_is_in_the_scene_and_not_in_the_rows_and_is_the_same_everywhere():
    in_cast = {p["id"]: p["intro"] for p in CAST_DATA["people"]}
    for seed, variant in ((1, "v_boat"), (7, "v_flood"), (2015, "v_drunk")):
        game = bridge(seed, variant=variant)
        scene = json.loads(game.scene_json())
        assert {p["id"]: p["intro"] for p in scene["cast"]} == in_cast
        assert not any("intro" in row for row in people_of(frame_now(game)))


def test_every_line_is_a_line_of_both_languages_that_names_no_case_and_no_he_or_she():
    seen = set()
    for row in CAST_DATA["people"]:
        intro = row["intro"]
        assert set(intro) == {"zh", "en"} and intro["zh"] and intro["en"], row["id"]
        assert intro["zh"] not in seen and intro["en"] not in seen
        seen |= {intro["zh"], intro["en"]}
        assert not any(word in intro["zh"] for word in CASE_WORDS), (row["id"], intro["zh"])
        lowered = f" {intro['en'].lower()} "
        assert not any(word in lowered for word in CASE_WORDS_EN), (row["id"], intro["en"])
        assert not re.search("[他她]", intro["zh"]) and not PRONOUNS_EN.search(intro["en"])
        assert len(intro["zh"]) <= 60 and len(intro["en"]) <= 200
        assert not any(mark in intro["zh"] + intro["en"] for mark in ("；", ";", "—", "--"))


def test_the_six_the_opening_page_shows_each_have_a_line_that_says_who_they_are():
    scene = json.loads(slice_game().scene_json())
    cast = {p["id"]: p for p in scene["cast"]}
    for who in OPENING_SIX:
        assert cast[who]["intro"]["zh"] and cast[who]["intro"]["en"]
    lines = [cast[who]["intro"]["zh"] for who in OPENING_SIX]
    assert len(set(lines)) == 6


def test_the_projection_marks_the_people_known_and_their_line_in_the_scene_public():
    assert projection.mark_of("people[].hearts") == "known"
    assert projection.mark_of("people[].card.changes") == "known"
    assert projection.mark_of("hud.gift.items") == "known"
    assert projection.mark_of("hud.verbs_off") == "known"
    assert projection.mark_of("cast[].intro", projection.SCENE) == "public"


# ------------------------------------------------------------------------------ known


def test_a_person_is_known_once_the_manager_has_talked_with_them_and_not_before():
    game = slice_game()
    run_to(game, at(1, 9))
    assert not any(row["known"] for row in people_of(frame_now(game)))
    meet(game, "li_da")
    rows = {row["id"]: row for row in people_of(frame_now(game))}
    assert rows["li_da"]["known"] and rows["li_da"]["card"] is not None
    assert [who for who, row in rows.items() if row["known"]] == ["li_da"]


def test_hearing_of_a_person_gives_a_card_but_does_not_make_them_known():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")  # the madam names the clerk who told her
    frame = frame_now(game)
    assert "zhou_huoji" in {card["id"] for card in frame["cards"]}
    rows = {row["id"]: row for row in people_of(frame)}
    assert rows["zhou_huoji"]["known"] is False and rows["zhou_huoji"]["card"] is None


# ------------------------------------------------------------------------------ nothing hidden


def first_day(variant: str, seed: int = 492) -> list[dict]:
    """What the page is shown of the people, the day's gift, the verbs and the first talk, at
    every step of a first morning that does the same in every story."""
    game = slice_game(variant=variant)
    shown = []

    def look():
        frame = frame_now(game)
        talk = frame["player"]["talk"]
        shown.append(
            {
                "people": frame["people"],
                "gift": frame["hud"]["gift"],
                "bridge": frame["hud"]["bridge"],
                # whether two people talk within hearing is what the town does, and public
                "off": {k: v for k, v in frame["hud"]["verbs_off"].items() if k != "listen"},
                "talk": None
                if talk is None
                else {
                    k: talk[k] for k in ("ask_for", "asks_more", "wants", "keep", "give", "queue")
                },
                "topics": [(t["id"], t["kind"]) for t in frame["player"]["topics"]],
            }
        )

    run_to(game, at(1, 8))
    look()
    stall = {"op": "make", "what": "stall", "item": "front", "due": 3}
    for who, doings in (
        ("li_laotai", [("entrust", {"kind": "lend"}), ("gift", {"item": "pastry"})]),
        ("zhou_zhanggui", [("entrust", {"kind": "material"}), ("promise", stall)]),
        ("zhou_huoji", [("ask", {"topic": "li_er"}), ("entrust", {"kind": "testify"})]),
    ):
        meet(game, who)
        look()
        for kind, fields in doings:
            act(game, kind, **fields)
            look()
        act(game, "leave")
        look()
    return shown


def test_two_games_that_differ_only_in_the_story_that_is_true_show_the_same_people_and_talk():
    base = first_day("v_boat")
    assert len(base) > 12
    for variant in ("v_flood", "v_drunk"):
        assert first_day(variant) == base, variant


def test_the_people_book_does_not_depend_on_the_seed_of_the_town_either_in_what_it_says_of_them():
    one = people_of(frame_now(bridge(1)))
    two = people_of(frame_now(bridge(2015)))
    assert one == two and len(one) == len(CAST.people)


def test_what_people_believe_is_in_no_row_of_the_people():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_huoji")
    text = json.dumps(people_of(frame_now(game)), ensure_ascii=False)
    for secret in ("v_boat", "v_flood", "v_drunk", "variant", "belief", "pr_", "believes"):
        assert secret not in text


# ------------------------------------------------------------------------------ the content


def test_what_each_person_asks_for_a_favour_is_something_the_manager_has_to_promise():
    game = slice_game()
    state = game._kernel.state["world"]
    world = game._kernel.world
    for row in CAST_DATA["people"]:
        offer = context.asked_return(world, state, row["id"], 1)
        assert offer is not None, row["id"]
        assert offer["body"]["what"] in pledges.KINDS and offer["body"]["op"] == "make"
        assert offer["body"]["due"] == 3


def test_a_return_that_names_a_place_in_the_programme_takes_the_first_one_that_is_free():
    game = slice_game()
    state = game._kernel.state["world"]
    world = game._kernel.world
    state["player"]["pledges"].append(
        {"id": "k1", "to": "li_er", "what": "slot", "item": "1", "amount": 0, "size": 1,
         "made": 0, "due": 5, "state": "open", "ended": -1}
    )  # fmt: skip
    offer = context.asked_return(world, state, "shitou", 1)
    assert offer["id"] == "slot:2"


def test_the_tools_check_a_return_against_the_promises_of_the_core():
    import town_content

    assert town_content.ASK_KINDS == pledges.KINDS
    assert tuple(pledges.STALLS) == town_content.ASK_STALLS
    assert town_content.ASK_ROLES == pledges.ROLES
    assert town_content.ASK_SLOTS == pledges.SLOTS
    assert set(town_content.ASK_WAGES) <= {10, 20}  # the wages the offers make
    asked = {(row["ask"]["what"], row["ask"].get("item"), row["ask"].get("amount"))
             for row in CAST_DATA["people"]}  # fmt: skip
    assert len(asked) >= 6  # not everybody asks for the same


def test_the_small_things_a_person_likes_are_things_of_the_script_and_never_also_disliked():
    gifts = {g["id"] for g in SCRIPT["gifts"]}
    for row in CAST_DATA["people"]:
        assert set(row["likes"]) <= gifts and set(row["dislikes"]) <= gifts, row["id"]
        assert not set(row["likes"]) & set(row["dislikes"]), row["id"]


@pytest.mark.parametrize("who", ["li_laotai", "zhou_zhanggui"])
def test_a_first_talk_makes_the_person_known_and_the_hearts_start_at_the_half(who):
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, who)
    row = {r["id"]: r for r in people_of(frame_now(game))}[who]
    assert row["known"] and row["hearts"] == 1 and me(game)["trust"][CAST.index[who]] == 13
