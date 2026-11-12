"""The cards of the people: one for each person the player has met or heard of, with only what the
player has been shown, asked or learned.

The cards are in every frame under ``cards``. They are read from the same slice as the tasks, so the
routes here are those of ``test_bridge_agenda``.
"""

from __future__ import annotations

from agenda_helpers import frame_now, idle, meet, slice_game
from bridge_helpers import at, state_of
from player_helpers import act, doc_scene, me, run_on

from lantern_core.api import Game
from lantern_core.world.bridge import pledges


def by_id(frame: dict) -> dict:
    return {card["id"]: card for card in frame["cards"]}


def refuse(game: Game) -> dict:
    run_on(game, at(1, 6, 30))
    meet(game, "li_laotai")
    return act(game, "entrust", kind="lend")


# ------------------------------------------------------------------------------ who has a card


def test_there_is_no_card_before_the_player_has_met_or_heard_of_anyone():
    game = slice_game()
    assert frame_now(game)["cards"] == []
    run_on(game, at(1, 12, 0))
    assert idle(game)["frame"]["cards"] == []


def test_a_person_the_player_has_talked_with_has_a_card_and_nobody_else_yet():
    game = slice_game()
    out = refuse(game)
    assert list(by_id(out["frame"])) == ["li_laotai"]  # the refusal names no one


def test_the_people_a_note_names_have_cards_too_as_people_heard_of():
    game = slice_game()
    refuse(game)
    out = act(game, "ask", topic="li_er")  # heard from Granny Li, who names the madam as the source
    cast = by_id(out["frame"])
    assert list(cast) == ["li_laotai", "li_er", "cha_laoban"]  # in the order of the cast file
    for heard_of in ("li_er", "cha_laoban"):
        card = cast[heard_of]
        assert card["met"] is False and card["find"] is None  # no place to find them: not met
        assert card["wants"] == [] and card["favours"] == 0 and card["stance"] is None
        assert card["agreed"] == []
    assert cast["li_er"]["family"] == "fam_li" and cast["cha_laoban"]["family"] is None


def test_the_cast_follows_the_trail_the_player_walks():
    game = slice_game()
    refuse(game)
    act(game, "ask", topic="li_er")
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")
    out = act(game, "ask_source", entry="n1")
    cast = by_id(out["frame"])
    assert set(cast) == {"li_laotai", "li_er", "cha_laoban", "zhou_huoji"}  # the clerk is named now
    assert cast["cha_laoban"]["met"] is True and cast["zhou_huoji"]["met"] is False


# ------------------------------------------------------------------------------ the identity


def test_a_card_says_who_the_person_is_in_both_languages():
    game = slice_game()
    card = by_id(refuse(game)["frame"])["li_laotai"]
    assert card["name"] == {"zh": "李老太", "en": "Granny Li"}
    assert card["role"] == {"zh": "李家老太太", "en": "Matriarch of the Li family"}
    assert (card["family"], card["met"]) == ("fam_li", True)
    assert set(card) == {
        "id",
        "name",
        "role",
        "family",
        "met",
        "find",
        "wants",
        "favours",
        "stance",
        "agreed",
    }


# ------------------------------------------------------------------------------ where to find them


def test_a_person_the_player_has_met_can_be_found_by_their_routine_from_now_on():
    game = slice_game()
    card = by_id(refuse(game)["frame"])["li_laotai"]
    assert card["find"] == [
        {"from": 6 * 60, "place": "p_li_house", "act": "meal", "now": True},
        {"from": 7 * 60, "place": "p_temple", "act": "pray"},
        {"from": 9 * 60, "place": "p_li_house", "act": "rest"},
    ]


def test_the_routine_goes_on_as_the_hours_do_and_comes_round_to_the_next_morning():
    game = slice_game()
    refuse(game)
    run_on(game, at(1, 15, 30))
    now = by_id(idle(game)["frame"])["li_laotai"]["find"]
    assert [(e["from"], e["place"]) for e in now] == [
        (15 * 60, "p_teahouse"),
        (19 * 60, "p_li_house"),
        (21 * 60, "p_li_house"),
    ]
    assert now[0].get("now") is True and not any("tomorrow" in e for e in now)
    run_on(game, at(1, 22, 0))
    late = by_id(idle(game)["frame"])["li_laotai"]["find"]
    assert [(e["from"], e["act"]) for e in late] == [
        (21 * 60, "sleep"),
        (6 * 60, "meal"),  # the next morning
        (7 * 60, "pray"),
    ]
    assert late[0].get("now") is True and late[1].get("tomorrow") is True
    assert late[2].get("tomorrow") is True


def test_the_start_of_an_entry_is_late_by_the_stagger_of_the_person():
    game = slice_game()
    refuse(game)
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")  # number 10 of the cast: 10 * 7 % 30 = 10 ticks late, 5 minutes
    card = by_id(act(game, "ask", topic="li_er")["frame"])["cha_laoban"]
    assert [e["from"] for e in card["find"]] == [7 * 60 + 5, 12 * 60 + 5, 13 * 60 + 5]


# ------------------------------------------------------------------------------ the wants


def test_a_want_is_on_the_card_only_once_the_player_has_learned_it():
    game = slice_game()
    run_on(game, at(1, 6, 30))
    out = meet(game, "li_laotai")
    assert by_id(out["frame"])["li_laotai"]["wants"] == []  # nothing has told them yet
    out = act(game, "entrust", kind="lend")  # she says no, and why
    (want,) = by_id(out["frame"])["li_laotai"]["wants"]
    assert want == {
        "id": "w_li_laotai_public",
        "text": {
            "zh": "有人出来把「李二毁桥」这话当众说清",
            "en": "Someone to set straight, in public, the talk that Li Er wrecked the bridge",
        },
    }
    assert state_of(game)["agenda"]["wants"]["w_li_laotai_public"] == out["tick"]
    twin = Game.from_snapshot_json(game.snapshot_json())  # what was learned is kept
    assert by_id(frame_now(twin))["li_laotai"]["wants"] == [want]


def test_what_the_elder_wants_is_known_from_the_start_and_shows_once_he_has_a_card():
    game = slice_game()
    assert state_of(game)["agenda"]["wants"] == {"w_elder_lantern": 0}  # but nobody has met him
    assert frame_now(game)["cards"] == []
    run_on(game, at(1, 9, 0))  # he is up
    out = meet(game, "zuzhang")
    (want,) = by_id(out["frame"])["zuzhang"]["wants"]
    assert want["id"] == "w_elder_lantern" and want["text"]["zh"].startswith("五天后")


# ------------------------------------------------------------------------------ the favours


def test_the_favours_between_the_player_and_a_person_are_their_balance_in_the_ledger():
    game = slice_game()
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")
    assert by_id(idle(game)["frame"])["cha_laoban"]["favours"] == 0
    assert act(game, "promise", what="stall", item="back", due=1)["frame"]
    out = act(game, "promise", op="keep", id="k1")  # a promise kept is a favour done
    card = by_id(out["frame"])["cha_laoban"]
    assert card["favours"] == pledges.balance(me(game), "cha_laoban") == 1
    assert by_id(out["frame"])["cha_laoban"]["agreed"] == []


# ------------------------------------------------------------------------------ the stance


def test_the_stance_is_the_latest_thing_they_said_to_the_player_about_the_conflict():
    game = slice_game()
    refuse(game)
    assert by_id(frame_now(game))["li_laotai"]["stance"] is None  # she has said nothing of it
    out = act(game, "ask", topic="li_er")
    stance = by_id(out["frame"])["li_laotai"]["stance"]
    assert stance["text"] == {
        "zh": "李二昨晚把栏杆弄坏了，是眼红人家出风头。",
        "en": "Li Er broke the bridge railing last night, out of envy.",
    }
    assert (stance["kind"], stance["entry"], stance["tick"]) == ("told", "n1", out["tick"])
    assert stance["how"] == {"zh": "亲口告诉你的", "en": "They told you themselves"}
    day, hour, minute = stance["at"]["day"], stance["at"]["hour"], stance["at"]["minute"]
    # the call that opens a talk simulates no tick: the entrust is at 06:30 and the ask a tick on
    assert (day, hour, minute) == (1, 6, 30)


def test_what_a_third_person_says_of_someone_is_not_their_stance():
    game = slice_game()
    refuse(game)
    cast = by_id(act(game, "ask", topic="li_er")["frame"])
    # the note says the madam told Granny Li, and the madam has not been asked: she has no stance
    assert cast["cha_laoban"]["stance"] is None and cast["li_er"]["stance"] is None


def test_the_stance_is_the_latest_and_only_about_the_conflict():
    game = slice_game()
    refuse(game)
    act(game, "leave")
    run_on(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    cast = by_id(act(game, "ask_source", entry="n1")["frame"])
    assert cast["zhou_huoji"]["stance"] is None  # what he says he saw is not about the rail
    for _ in range(3):
        cast = by_id(act(game, "ask", topic="li_er")["frame"])
    stance = cast["zhou_huoji"]["stance"]
    assert stance["text"]["en"] == "Li Er broke the bridge railing last night, on purpose."
    assert stance["kind"] == "told"  # the second and the third answers were about the bridge


def test_a_stance_the_player_overheard_says_so():
    game = doc_scene()  # the shopkeeper has just said that Li Er broke the bridge
    out = act(game, "listen")
    shopkeeper = by_id(out["frame"])["zhou_zhanggui"]
    assert shopkeeper["met"] is False and shopkeeper["find"] is None
    stance = shopkeeper["stance"]
    assert stance["kind"] == "overheard" and stance["entry"] == "n1"
    assert stance["how"] == {"zh": "你在旁边听到的", "en": "You overheard them"}
    assert stance["text"]["en"] == "Li Er broke the bridge railing last night."
    assert set(by_id(out["frame"])) == {"zhou_zhanggui", "zhou_huoji", "li_er"}


# ------------------------------------------------------------------------------ a view of the state


def test_a_card_is_made_from_the_state_so_the_game_restored_has_the_same_cards():
    game = slice_game()
    refuse(game)
    act(game, "ask", topic="li_er")
    run_on(game, at(1, 8, 0))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert frame_now(twin)["cards"] == frame_now(game)["cards"] != []
