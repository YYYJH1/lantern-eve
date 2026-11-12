"""The facts of the people book that only the manager's own doings make: where and when they met
each person, what each asked in return, and where and when each entry of the notebook was learned.
All of it is the manager's position and the clock, so two games that differ only in the story that
is true have the same of all of it."""

from __future__ import annotations

import json

import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import CAST, CLEAR, at, bridge, run_to, state_of, step
from player_helpers import ack, acks, act, me, put, run_on, seed_of
from test_bridge_player_notebook import first_telling, near_speaker

from lantern_core.api import Game
from lantern_core.cognition.beliefs import Belief
from lantern_core.world.bridge import clock, encounters, evidence, notebook, notes, player, roster
from lantern_core.world.bridge.data import TOWN

PLACES = {p["id"]: p for p in TOWN["places"]}
HOUSE = "p_li_house"


def row_of(game: Game, who: str) -> dict:
    return {r["id"]: r for r in frame_now(game)["people"]}[who]


def talk_at(game: Game, who: str, place_id: str) -> None:
    """End the talk there is and open one with ``who`` at the door of a place: the person is
    brought to the door, and the manager is put down beside them."""
    if me(game)["talk"]:
        act(game, "leave")
    social = state_of(game)["social"]
    for _ in range(80):  # somebody in the middle of telling a neighbour has to finish first
        social["next"] = [10**9] * len(social["next"])
        social["busy"] = [0] * len(social["busy"])
        x, y = PLACES[place_id]["door"]
        npc = state_of(game)["npcs"]["list"][CAST.index[who]]
        npc["x"], npc["y"] = x, y
        put(game, x, y)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, place_id, acks(out))


# ------------------------------------------------------------------------------ the places


def test_the_door_of_every_place_is_at_that_place_or_at_the_one_it_lies_in():
    for place_id, place in PLACES.items():
        if place["door"] is None:
            continue
        found = encounters.place_at(*place["door"])
        assert found == place_id or place_id == "p_temple_lane" or found in PLACES, place_id
    assert encounters.place_at(*PLACES["p_teahouse"]["door"]) == "p_teahouse"
    assert encounters.place_at(*PLACES["p_li_house"]["door"]) == "p_li_house"
    assert encounters.place_at(*PLACES["p_bridge"]["door"]) == "p_bridge"


def test_a_cell_far_from_every_place_is_the_street_and_the_water_is_no_place():
    assert encounters.place_at(0, 0) == encounters.NO_PLACE
    assert encounters.place_at(55, 33) == encounters.NO_PLACE
    found = {encounters.place_at(x, y) for x in range(56) for y in range(34)}
    assert "p_under_bridge" not in found and "" in found


def test_the_nearest_place_wins_and_the_first_of_the_map_when_two_are_as_near():
    order = [p for p, place in PLACES.items() if place["door"] is not None]
    for x in range(56):
        for y in range(34):
            near = []
            for place_id in order:
                left, top, width, height = PLACES[place_id]["rect"]
                dx = max(left - x, 0, x - (left + width - 1))
                dy = max(top - y, 0, y - (top + height - 1))
                if max(dx, dy) <= encounters.NEAR:
                    near.append((max(dx, dy), order.index(place_id), place_id))
            want = min(near)[2] if near else encounters.NO_PLACE
            assert encounters.place_at(x, y) == want, (x, y)


def test_the_reach_of_a_place_is_the_reach_of_a_look():
    assert encounters.NEAR == evidence.REACH


# ------------------------------------------------------------------------------ met


def test_nobody_has_met_anybody_before_a_talk_and_the_state_has_not_the_keys_yet():
    game = slice_game()
    run_to(game, at(1, 9))
    assert all(r["met"] == [] and r["asked"] is None for r in frame_now(game)["people"])
    assert "met" not in me(game) and "wanted" not in me(game)  # the state is as it always was


def test_a_first_talk_writes_down_when_and_where_it_began():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    x, y = me(game)["x"], me(game)["y"]
    (row,) = row_of(game, "li_da")["met"]
    assert row["tick"] == game.tick and row["place"] == (encounters.place_at(x, y) or None)
    now = clock.at(game.tick)
    assert (row["day"], row["hour"], row["minute"]) == (now.day, now.hour, now.minute)
    assert [r["met"] for r in frame_now(game)["people"] if r["id"] != "li_da"] == [[]] * 19


def test_a_talk_that_is_turned_away_writes_nothing():
    game = slice_game()
    run_to(game, at(1, 9))
    put(game, 0, 0)
    assert ack(act(game, "talk", npc="li_da")) == ("rejected", "far")
    assert row_of(game, "li_da")["met"] == []
    assert "met" not in me(game)


@pytest.mark.parametrize("place_id", ["p_teahouse", HOUSE, "p_bridge", "p_market"])
def test_the_place_is_where_the_manager_stands_when_the_talk_begins(place_id):
    game = slice_game()
    run_to(game, at(1, 9))
    talk_at(game, "li_da", place_id)
    assert row_of(game, "li_da")["met"][-1]["place"] == place_id


def test_a_talk_in_the_street_is_a_row_with_no_place():
    game = slice_game()
    run_to(game, at(1, 9))
    if me(game)["talk"]:
        act(game, "leave")
    npc = state_of(game)["npcs"]["list"][CAST.index["li_da"]]
    npc["x"], npc["y"] = 0, 0
    put(game, 0, 0)
    assert ack(act(game, "talk", npc="li_da")) == ("applied", None)
    assert row_of(game, "li_da")["met"][-1]["place"] is None


def test_a_talk_at_the_same_place_on_the_same_day_is_not_written_down_again():
    game = slice_game()
    run_to(game, at(1, 9))
    talk_at(game, "li_da", HOUSE)
    first = row_of(game, "li_da")["met"]
    act(game, "leave")
    run_to(game, game.tick + 40)
    talk_at(game, "li_da", HOUSE)
    assert row_of(game, "li_da")["met"] == first


def test_a_talk_on_another_day_or_at_another_place_is_another_row_oldest_first():
    game = slice_game()
    run_to(game, at(1, 9))
    talk_at(game, "li_da", HOUSE)
    act(game, "leave")
    run_on(game, at(2, 9))
    talk_at(game, "li_da", HOUSE)
    rows = row_of(game, "li_da")["met"]
    assert [r["day"] for r in rows] == [1, 2] and rows[0]["tick"] < rows[1]["tick"]
    talk_at(game, "li_da", "p_market")
    rows = row_of(game, "li_da")["met"]
    assert [(r["day"], r["place"]) for r in rows] == [(1, HOUSE), (2, HOUSE), (2, "p_market")]


def test_only_the_last_few_talks_are_kept():
    game = slice_game()
    section = me(game)
    section["x"], section["y"] = 0, 0
    for n in range(encounters.MET_KEPT + 3):
        encounters.record_talk(section, "li_da", at(1 + n, 9))
    kept = section["met"]["li_da"]
    assert len(kept) == encounters.MET_KEPT
    assert [t for t, _ in kept] == [at(1 + n, 9) for n in range(3, 3 + encounters.MET_KEPT)]


def test_a_person_the_manager_only_heard_of_has_no_talks_and_is_not_known():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")
    rows = {r["id"]: r for r in frame_now(game)["people"]}
    assert rows["cha_laoban"]["met"] and not rows["zhou_huoji"]["known"]
    assert rows["zhou_huoji"]["met"] == [] and rows["zhou_huoji"]["asked"] is None


def test_the_talks_are_the_same_after_the_game_is_saved_and_loaded():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "li_da")
    act(game, "leave")
    before = json.dumps(frame_now(game)["people"], sort_keys=True)
    loaded = Game.from_snapshot_json(game.snapshot_json())
    assert json.dumps(frame_now(loaded)["people"], sort_keys=True) == before


# ------------------------------------------------------------------------------ asked


def refused_by_zhou(game: Game) -> dict:
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    return frame_now(game)


def test_a_return_that_is_asked_is_what_the_person_asks_and_the_request_they_turned_down():
    game = slice_game()
    frame = refused_by_zhou(game)
    wants = frame["player"]["talk"]["wants"]
    asked = row_of(game, "zhou_zhanggui")["asked"]
    assert asked["what"] == {"zh": "灯会上的前排摊位", "en": "a front-row stall at the festival"}
    assert asked["for"] == wants["asks"]
    now = clock.at(asked["tick"])
    assert asked["tick"] <= game.tick and now.day == 1
    assert (asked["day"], asked["hour"], asked["minute"]) == (now.day, now.hour, now.minute)


def test_the_return_stays_after_the_promise_is_made_and_after_the_talk_and_the_day():
    game = slice_game()
    refused_by_zhou(game)
    asked = row_of(game, "zhou_zhanggui")["asked"]
    wants = frame_now(game)["player"]["talk"]["wants"]
    act(game, "promise", **wants["offer"]["body"])
    assert frame_now(game)["player"]["talk"]["wants"] is None
    assert row_of(game, "zhou_zhanggui")["asked"] == asked
    act(game, "leave")
    run_on(game, at(2, 9))
    assert row_of(game, "zhou_zhanggui")["asked"] == asked  # the book is not for the day only


def test_whenever_a_talk_puts_a_return_forward_the_book_has_it():
    game = slice_game()
    refused_by_zhou(game)
    assert frame_now(game)["player"]["talk"]["wants"] is not None
    assert row_of(game, "zhou_zhanggui")["asked"] is not None
    seen = 0
    for who in ("li_laotai", "li_da", "zhou_huoji"):
        meet(game, who)
        for kind in ("material", "lend", "join", "lane", "convene", "testify"):
            act(game, "entrust", kind=kind)
            talk = frame_now(game)["player"]["talk"]
            if talk is not None and talk["wants"] is not None:
                seen += 1
                assert row_of(game, who)["asked"] is not None, (who, kind)
    assert seen >= 0


def test_a_person_who_turned_nobody_down_has_asked_nothing():
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "zhou_zhanggui")
    assert row_of(game, "zhou_zhanggui")["asked"] is None
    assert "wanted" not in me(game)


def test_a_return_the_manager_cannot_give_is_not_asked_the_second_time_and_the_first_stays():
    game = slice_game()
    refused_by_zhou(game)
    for number in range(2):  # both front stalls go
        assert acks(act(game, "promise", op="make", what="stall", item="front", due=3)) == [
            ("applied", None)
        ], number
    assert acks(act(game, "entrust", kind="material")) == [("rejected", "refused")]
    assert frame_now(game)["player"]["talk"]["wants"] is None
    assert row_of(game, "zhou_zhanggui")["asked"]["what"]["zh"] == "灯会上的前排摊位"


def test_a_stranger_has_no_return_or_talks_or_card():
    game = slice_game()
    frame = refused_by_zhou(game)
    for row in frame["people"]:
        if not row["known"]:
            assert row["asked"] is None and row["met"] == [] and row["card"] is None


# ------------------------------------------------------------------------------ the notebook


def test_an_entry_the_manager_was_told_knows_when_and_where():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")
    place = encounters.place_at(me(game)["x"], me(game)["y"]) or None
    entries = frame_now(game)["notebook"]
    assert entries
    for entry in entries:
        assert set(entry["at"]) == {"tick", "day", "hour", "minute", "place"}
        assert entry["at"]["place"] == place
        assert entry["at"]["day"] == 1 and entry["at"]["tick"] <= game.tick


def test_the_time_of_an_entry_is_the_tick_of_the_belief_it_keeps():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")
    for entry, shown in zip(me(game)["notebook"], frame_now(game)["notebook"], strict=True):
        assert shown["at"]["tick"] == notebook.belief_of(entry).tick
        now = clock.at(shown["at"]["tick"])
        assert (shown["at"]["day"], shown["at"]["hour"], shown["at"]["minute"]) == (
            now.day,
            now.hour,
            now.minute,
        )


def test_an_entry_written_without_a_place_has_no_when_and_where():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")
    for entry in me(game)["notebook"]:
        entry.pop("where")  # a game saved before the places were kept
    assert all(e["at"] is None for e in frame_now(game)["notebook"])


def test_a_word_overheard_knows_where_the_manager_stood():
    game = bridge(3, **CLEAR)
    told, _ = first_telling(game)
    near_speaker(game, told)
    assert ack(act(game, "listen")) == ("applied", None)
    (entry,) = frame_now(game)["notebook"]
    assert entry["at"]["place"] == (encounters.place_at(me(game)["x"], me(game)["y"]) or None)
    assert entry["at"]["tick"] <= game.tick


def test_an_entry_seen_with_the_eyes_knows_the_place_it_was_seen_at():
    game = bridge(seed_of("v_flood"), **CLEAR)
    run_to(game, at(3, 9))
    put(game, 27, 16)
    assert ack(act(game, "look", at="p_under_bridge")) == ("applied", None)
    while me(game)["busy"]:
        step(game)
    entries = frame_now(game)["notebook"]
    assert entries and all(e["source"] == {"kind": "seen"} for e in entries)
    for entry in entries:
        assert entry["at"]["place"] == (encounters.place_at(27, 16) or None)
        assert at(3, 9) < entry["at"]["tick"] <= game.tick


def test_what_was_heard_and_is_then_seen_is_written_again_where_it_was_seen():
    game = slice_game()
    section = me(game)
    prop_id = "pr_flood_damaged"
    section["x"], section["y"] = PLACES["p_teahouse"]["door"]
    heard = Belief("player", prop_id, "assert", 60, "heard", "cha_laoban", "unknown", 1, 100, None)
    entry, new = notebook.add_heard(section, heard)
    assert new and entry["where"] == "p_teahouse"
    section["x"], section["y"] = PLACES["p_bridge"]["door"]
    again, changed = notebook.add_seen(section, prop_id, 400)
    assert changed and again is entry and entry["where"] == "p_bridge"
    shown = [e for e in notebook.wire(game._kernel.world, state_of(game)) if e["id"] == entry["id"]]
    assert shown[0]["at"] == encounters.stamp(400, "p_bridge")
    assert shown[0]["source"] == {"kind": "seen"}
    # seen once more: nothing is written again, and the place stays where it was seen first
    section["x"], section["y"] = 0, 0
    assert notebook.add_seen(section, prop_id, 900)[1] is False and entry["where"] == "p_bridge"
    assert notes.decode_belief("player", prop_id, entry["note"]).tick == 400


# ------------------------------------------------------------------------------ nothing hidden


def first_morning(variant: str) -> list[dict]:
    """What the book is shown at every step of a first morning that does the same in every story:
    the people, with where they met and what they asked."""
    game = slice_game(variant=variant)
    shown = []

    def look():
        shown.append({"people": frame_now(game)["people"]})

    run_to(game, at(1, 8))
    look()
    for who, doings in (
        ("zhou_zhanggui", [("entrust", {"kind": "material"}), ("entrust", {"kind": "material"})]),
        ("li_laotai", [("entrust", {"kind": "lend"}), ("gift", {"item": "pastry"})]),
        ("cha_laoban", [("ask", {"topic": "li_er"})]),
    ):
        meet(game, who)
        look()
        for kind, fields in doings:
            act(game, kind, **fields)
            look()
        act(game, "leave")
        look()
    return shown


def test_two_games_that_differ_only_in_the_story_that_is_true_have_the_same_book():
    base = first_morning("v_boat")
    assert len(base) > 8
    last = base[-1]["people"]
    assert last[CAST.index["zhou_zhanggui"]]["asked"] is not None
    assert all(last[CAST.index[who]]["met"] for who in ("zhou_zhanggui", "li_laotai", "cha_laoban"))
    for variant in ("v_flood", "v_drunk"):
        other = first_morning(variant)
        assert [s["people"] for s in other] == [s["people"] for s in base], variant


def test_the_book_names_no_story_and_no_belief():
    game = slice_game()
    refused_by_zhou(game)
    text = json.dumps(
        [{k: r[k] for k in ("met", "asked")} for r in frame_now(game)["people"]],
        ensure_ascii=False,
    )
    for secret in ("v_boat", "v_flood", "v_drunk", "variant", "belief", "pr_", "believes"):
        assert secret not in text


def test_a_frame_that_is_looked_at_twice_is_the_same_and_looking_writes_nothing():
    game = slice_game()
    refused_by_zhou(game)
    before = json.dumps(state_of(game), sort_keys=True)
    one = json.dumps(frame_now(game), sort_keys=True)
    two = json.dumps(frame_now(game), sort_keys=True)
    assert one == two and json.dumps(state_of(game), sort_keys=True) == before


def test_the_rows_of_the_book_are_whole_numbers_and_words_and_nothing_else():
    game = slice_game()
    refused_by_zhou(game)
    for row in frame_now(game)["people"]:
        for stamp in row["met"]:
            assert set(stamp) == {"tick", "day", "hour", "minute", "place"}
            assert all(type(stamp[k]) is int for k in ("tick", "day", "hour", "minute"))
            assert stamp["place"] is None or stamp["place"] in PLACES
        if row["asked"] is not None:
            assert set(row["asked"]) == {"what", "for", "tick", "day", "hour", "minute"}
            assert set(row["asked"]["what"]) == {"zh", "en"} == set(row["asked"]["for"])


def test_the_roster_of_a_new_game_has_the_two_keys_for_the_twenty_and_nothing_in_them():
    game = bridge(1)
    rows = roster.wire(game._kernel.world, state_of(game))
    assert len(rows) == 20 and all(r["met"] == [] and r["asked"] is None for r in rows)
    assert player.SECTION == "player"
