"""The gift: a small thing for a person, one a day in the town and two to a person, which adds trust
and nothing else, and what the manager learns of what people like by giving and by asking."""

from __future__ import annotations

import json

import pytest
from bridge_helpers import CAST, CLEAR, at, bridge, run_to, state_of
from dealings_helpers import acks, act, events, me, talking, trust, trust_of
from player_helpers import beside, put, silence

from lantern_core.api import Game
from lantern_core.world.bridge import gifts, pace, persuade, phrases, pledges, voices
from lantern_core.world.bridge.data import CAST as CAST_DATA
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

THINGS = ("tea", "pastry", "lantern_paper", "wine")


def frame_of(game: Game) -> dict:
    kernel = game._kernel
    return kernel.world.frame(kernel.state)


def person_row(game: Game, who: str) -> dict:
    return next(p for p in frame_of(game)["people"] if p["id"] == who)


def tastes_of(who: str) -> dict:
    return CAST_DATA["people"][CAST.index[who]]


def as_called(asker: str, target: str, zh: str, en: str) -> tuple[str, str]:
    """The words of the cast with the name of ``target`` in them as ``asker`` says it, the English
    starting in a capital."""
    cast, name = lore().names[target], voices.called(asker, target)
    said = en.replace(cast["en"], name["en"])
    return zh.replace(cast["zh"], name["zh"]), said[:1].upper() + said[1:]


def give(game: Game, item: str, **fields):
    return act(game, "gift", item=item, **fields)


def go_to(game: Game, day: int, hour: int = 9) -> None:
    """Leave the talk there is, and run on to ``hour`` o'clock of ``day``."""
    if me(game)["talk"]:
        act(game, "leave")
    run_to(game, at(day, hour))


def meet(game: Game, who: str):
    if me(game)["talk"]:
        act(game, "leave")
    for _ in range(80):
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, acks(out))
    return out


# ------------------------------------------------------------------------------ the things


def test_the_market_has_four_small_things_with_their_names_and_the_same_gain():
    assert tuple(row["id"] for row in gifts.things()) == THINGS
    assert [row["gain"] for row in gifts.things()] == [8, 8, 8, 8]
    assert all(row["zh"] and row["en"] for row in gifts.things())


def test_the_shares_are_all_of_the_gain_for_a_thing_that_is_liked_half_and_nothing():
    row = gifts.thing("tea")
    assert [gifts.gain_of(row, like) for like in ("like", "neutral", "dislike")] == [8, 4, 0]
    assert gifts.gain_of({"gain": 7}, "neutral") == 3  # whole numbers


def test_every_person_likes_something_and_the_things_are_liked_and_disliked_by_several():
    people = CAST_DATA["people"]
    for row in people:
        assert row["likes"] and not set(row["likes"]) & set(row["dislikes"]), row["id"]
        assert set(row["likes"]) | set(row["dislikes"]) <= set(THINGS)
        assert len(row["likes"]) <= 2 and len(row["dislikes"]) <= 1
    for thing in THINGS:
        assert sum(thing in row["likes"] for row in people) >= 4, thing
        assert sum(thing in row["dislikes"] for row in people) >= 3, thing


def test_the_hud_and_the_scene_say_what_the_market_gives_away():
    game = bridge(1)
    assert [g["id"] for g in json.loads(game.scene_json())["gifts"]] == list(THINGS)
    hud = frame_of(game)["hud"]["gift"]
    assert hud["day"] == 1 and hud["given"] is False and hud["to"] is None
    assert [item["id"] for item in hud["items"]] == list(THINGS)
    assert all(set(item) == {"id", "zh", "en"} for item in hud["items"])


# ------------------------------------------------------------------------------ giving


@pytest.mark.parametrize(
    ("thing", "like", "gain"),
    [("tea", "like", 8), ("lantern_paper", "neutral", 4), ("pastry", "dislike", 0)],
)
def test_a_gift_adds_trust_by_how_it_is_taken(thing, like, gain):
    """Li Da likes tea and wine, does not care for pastries, and is neither way about paper."""
    assert gifts.taste_of("li_da", thing) == like
    game = talking("li_da")
    before = trust_of(game, "li_da")
    out = give(game, thing)
    assert acks(out) == [("applied", None)]
    (gift,) = events(out, "gifted")
    assert gift == {**gift, "npc": "li_da", "item": thing, "like": like, "gain": gain}
    assert trust_of(game, "li_da") == before + gain


def test_a_gift_is_no_favour_the_ledger_and_the_score_of_a_request_move_by_the_trust_alone():
    game = talking("li_da")
    world, state = game._kernel.world, state_of(game)
    deeds = json.dumps(me(game)["deeds"], sort_keys=True)
    before = dict(persuade.weigh(world, state, "li_da", "material").parts)
    give(game, "tea")
    after = dict(persuade.weigh(world, state, "li_da", "material").parts)
    assert json.dumps(me(game)["deeds"], sort_keys=True) == deeds
    assert pledges.balance(me(game), "li_da") == 0
    assert after.pop("trust") - before.pop("trust") == 8
    assert after == before


def test_the_town_takes_one_gift_a_day_whoever_it_is_for():
    game = talking("li_da")
    assert acks(give(game, "tea")) == [("applied", None)]
    assert acks(give(game, "wine")) == [("rejected", "gift_today")]
    meet(game, "li_laotai")
    out = give(game, "pastry")
    assert acks(out) == [("rejected", "gift_today")]
    assert events(out, "gifted") == []
    hud = frame_of(game)["hud"]["gift"]
    assert hud["given"] is True and hud["to"] == "li_da"


def test_a_new_day_brings_a_gift_back_and_a_person_takes_two_in_a_game():
    game = bridge(1, **CLEAR)
    for day, expected in ((1, "applied"), (2, "applied"), (3, "rejected")):
        go_to(game, day)
        meet(game, "li_da")
        out = give(game, "tea")
        assert acks(out)[0][0] == expected, day
        act(game, "leave")
    assert acks(give_after_meeting(game)) == [("rejected", "gift_full")]
    assert person_row(game, "li_da")["gifts"] == 2


def give_after_meeting(game: Game):
    go_to(game, 4)
    meet(game, "li_da")
    return give(game, "wine")


def test_a_person_who_has_taken_two_does_not_stop_a_gift_to_somebody_else():
    game = bridge(1, **CLEAR)
    for day in (1, 2):
        go_to(game, day)
        meet(game, "li_da")
        give(game, "tea")
    go_to(game, 3)
    meet(game, "li_laotai")
    assert acks(give(game, "pastry")) == [("applied", None)]


def test_a_gift_is_turned_down_without_a_talk_for_another_person_or_for_a_thing_not_on_sale():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 9))
    assert acks(give(game, "tea")) == [("rejected", "not_talking")]
    meet(game, "li_da")
    assert acks(give(game, "tea", npc="li_laotai")) == [("rejected", "wrong_person")]
    assert acks(give(game, "jade")) == [("rejected", "unknown_item")]
    assert acks(give(game, "tea", npc="li_da")) == [("applied", None)]


def test_the_person_answers_in_a_line_that_says_how_they_take_it():
    game = talking("li_da")
    out = give(game, "tea")
    liked = [b for b in out["frame"]["bubbles"] if b["npc"] == "li_da"][0]["text"]
    assert "茶叶" in liked["zh"] and "tea leaves" in liked["en"]
    assert [e["kind"] for e in out["events"] if e["kind"] == "replied"] == ["replied"]
    other = talking("li_da", day=2, hour=9)
    cold = [b for b in give(other, "pastry")["frame"]["bubbles"] if b["npc"] == "li_da"][0]["text"]
    assert cold != liked and "点心" in cold["zh"]
    assert not any("他" in t or "她" in t for t in (liked["zh"], cold["zh"]))
    for text in (liked["en"], cold["en"]):
        assert not any(f" {word} " in f" {text.lower()} " for word in ("he", "she", "his", "her"))


def test_each_person_answers_a_gift_in_their_own_words_for_how_they_take_it():
    """The answer is one of the person's own variants of the code for how they take the thing
    (``phrases.GIFT``), with the thing in it, never the plain words, and no two people say one."""
    said_by: dict[str, str] = {}
    for person in lore().people:
        for like, code in phrases.GIFT.items():
            own = voices.variants(person, code)
            assert phrases.phrase(code) not in own, (person, code)
            for item in THINGS:
                row = gifts.thing(item)
                words = gifts.reaction(person, row, like, 1234)
                filled = [{k: v[k].replace("{item}", row[k]) for k in ("zh", "en")} for v in own]
                assert words in filled, (person, like, item)
                assert row["zh"] in words["zh"] and row["en"] in words["en"]
            for variant in own:
                first = said_by.setdefault(variant["zh"], person)
                assert first == person, (first, person, variant["zh"])


def test_the_hearts_move_with_a_gift_that_earns_enough_and_say_gift():
    game = talking("li_da")
    out = give(game, "tea")
    (moved,) = events(out, "hearts")
    assert moved["why"] == "gift" and moved["delta"] >= 1
    out = give(talking("li_da", day=2, hour=9), "pastry")
    assert events(out, "hearts") == []  # a thing that is not liked earns nothing


def test_giving_a_thing_shows_the_person_how_they_take_it_and_the_book_of_the_people_keeps_it():
    game = talking("li_da")
    give(game, "tea")
    assert person_row(game, "li_da")["likes_known"] == [{"item": "tea", "like": "like"}]
    day2 = bridge(1, **CLEAR)
    run_to(day2, at(2, 9))
    meet(day2, "li_da")
    give(day2, "lantern_paper")
    assert person_row(day2, "li_da")["likes_known"] == [
        {"item": "lantern_paper", "like": "neutral"}
    ]


def test_the_hud_says_who_has_the_gift_of_the_day_and_a_new_day_clears_it():
    game = talking("li_da")
    give(game, "tea")
    assert frame_of(game)["hud"]["gift"]["given"] is True
    go_to(game, 2, 7)
    assert frame_of(game)["hud"]["gift"] == {
        **frame_of(game)["hud"]["gift"],
        "day": 2,
        "given": False,
    }


def test_gift_is_a_verb_in_a_talk_when_the_gift_can_be_given_and_off_with_a_reason_when_not():
    game = bridge(1, **CLEAR)
    run_to(game, at(1, 9))
    assert "gift" not in frame_of(game)["hud"]["verbs"]
    assert frame_of(game)["hud"]["verbs_off"]["gift"] == "not_talking"
    meet(game, "li_da")
    assert "gift" in frame_of(game)["hud"]["verbs"]
    give(game, "tea")
    hud = frame_of(game)["hud"]
    assert "gift" not in hud["verbs"] and hud["verbs_off"]["gift"] == "gift_today"
    game2 = bridge(1, **CLEAR)
    for day in (1, 2):
        go_to(game2, day)
        meet(game2, "li_da")
        give(game2, "tea")
        act(game2, "leave")
    go_to(game2, 3)
    meet(game2, "li_da")
    assert frame_of(game2)["hud"]["verbs_off"]["gift"] == "gift_full"


def test_a_gift_takes_no_game_time():
    game = talking("li_da")
    assert "gift" not in pace.costs() and "gift" not in pace.table()
    before = game.tick
    give(game, "tea")
    assert game.tick == before and game.paused


# ------------------------------------------------------------------------------ no way round


def test_trust_alone_opens_no_hard_condition_two_gifts_to_granny_li_change_nothing_she_asks():
    """Her bamboo needs the rumour cleared in public, a role of honour with trust, or the elder:
    the best she can take of the gifts is two liked ones."""
    game = bridge(1, **CLEAR)
    liked = tastes_of("li_laotai")["likes"][0]
    for day in (1, 2):
        go_to(game, day)
        meet(game, "li_laotai")
        assert acks(give(game, liked)) == [("applied", None)]
        act(game, "leave")
    go_to(game, 3)
    meet(game, "li_laotai")
    trust(game, "li_laotai", 99)  # and as much trust as can be had
    out = act(game, "entrust", kind="lend")
    assert acks(out) == [("rejected", "hard")]
    assert "li_laotai" not in me(game)["won"] and "bamboo" not in me(game)["nod"]


def test_the_most_two_gifts_to_one_person_and_five_in_a_game_are_the_trust_the_gifts_can_earn():
    assert gifts.PER_PERSON * max(row["gain"] for row in gifts.things()) == 16
    assert gifts.PER_DAY == 1 and SCRIPT["days"] == 5  # at most five gifts in a game


# ------------------------------------------------------------------------------ asking


def asked_taste(game: Game, who: str):
    return act(game, "ask", topic=gifts.PREFIX + who)


def test_a_question_about_what_a_person_likes_is_put_for_each_person_the_manager_has_a_card_of():
    game = talking("li_laotai")  # Granny Li has a card now
    act(game, "leave")
    meet(game, "cha_laoban")
    topics = frame_of(game)["player"]["topics"]
    taste = [t for t in topics if t["kind"] == "taste"]
    assert [t["id"] for t in taste] == ["likes:li_laotai"]
    assert taste[0]["label"] == {"zh": "李老太喜欢什么", "en": "What Granny Li likes"}
    meet(game, "li_laotai")
    again = [t["id"] for t in frame_of(game)["player"]["topics"] if t["kind"] == "taste"]
    assert again == ["likes:cha_laoban"]  # not about the person one talks to, and nobody else


def test_the_keeper_of_the_teahouse_knows_what_everyone_likes_two_things_at_a_time():
    game = talking("li_laotai")
    act(game, "leave")
    meet(game, "cha_laoban")
    out = asked_taste(game, "li_laotai")
    assert acks(out) == [("applied", None)]
    (asked,) = events(out, "asked")
    assert asked["answer"] == gifts.TASTE_ASKED and asked["prop"] is None
    assert asked["learned"] == [
        {"item": "pastry", "like": "like"},
        {"item": "wine", "like": "dislike"},
    ]
    said = [b for b in out["frame"]["bubbles"] if b["npc"] == "cha_laoban"][0]["text"]
    assert (said["zh"], said["en"]) == as_called(
        "cha_laoban",
        "li_laotai",
        "李老太喜欢点心，不爱酒。",
        "Granny Li likes pastries and does not care for wine.",
    )
    assert person_row(game, "li_laotai")["likes_known"] == [
        {"item": "pastry", "like": "like"},
        {"item": "wine", "like": "dislike"},
    ]


def test_a_second_question_gives_what_is_left_and_then_the_topic_is_gone():
    game = talking("li_da")  # likes tea and wine, does not care for pastries
    act(game, "leave")
    meet(game, "cha_laoban")
    first = events(asked_taste(game, "li_da"), "asked")[0]["learned"]
    second = events(asked_taste(game, "li_da"), "asked")[0]["learned"]
    assert first == [{"item": "tea", "like": "like"}, {"item": "pastry", "like": "dislike"}]
    assert second == [{"item": "wine", "like": "like"}]
    ids = [t["id"] for t in frame_of(game)["player"]["topics"] if t["kind"] == "taste"]
    assert "likes:li_da" not in ids
    out = asked_taste(game, "li_da")  # asked all the same: the keeper has told it all
    said = [b for b in out["frame"]["bubbles"] if b["npc"] == "cha_laoban"][0]["text"]
    assert events(out, "asked")[0]["answer"] == "ignorant"
    assert (
        "知道的都说了" in said["zh"]
        and said["en"]
        == as_called("cha_laoban", "li_da", "", "That is all I know of what Li Da likes.")[1]
    )


def test_nobody_tells_more_than_two_things_in_an_answer():
    game = talking("li_laotai")
    act(game, "leave")
    meet(game, "cha_laoban")
    for who in (p.id for p in CAST.people if p.id != "cha_laoban"):
        out = asked_taste(game, who)
        if acks(out) == [("applied", None)]:
            assert len(events(out, "asked")[0]["learned"]) <= gifts.MAX_TOLD


def test_somebody_who_does_not_know_the_person_says_so_and_teaches_nothing():
    world = bridge(1)._kernel.world
    stranger = next(
        (a, b)
        for a in (p.id for p in CAST.people)
        for b in (p.id for p in CAST.people)
        if a != b
        and a not in SCRIPT["hubs"]
        and not gifts.knows(world, a, b)
        and tastes_of(b)["likes"]
    )
    speaker, target = stranger
    game = talking(target)  # the manager has a card of the person they are asked about
    act(game, "leave")
    meet(game, speaker)
    out = asked_taste(game, target)
    assert acks(out) == [("applied", None)]
    (asked,) = events(out, "asked")
    assert asked["answer"] == "ignorant" and asked["learned"] == []
    assert person_row(game, target)["likes_known"] == []
    said = [b for b in out["frame"]["bubbles"] if b["npc"] == speaker][0]["text"]
    assert "说不上来" in said["zh"] and "I could not say" in said["en"]


def test_a_person_does_not_tell_what_they_like_themselves_and_an_unknown_id_is_refused():
    game = talking("li_laotai")
    assert acks(asked_taste(game, "li_laotai")) == [("rejected", "unknown_topic")]
    assert acks(asked_taste(game, "nobody")) == [("rejected", "unknown_topic")]


def test_a_question_about_tastes_costs_the_minutes_of_a_question():
    game = talking("li_laotai")
    act(game, "leave")
    meet(game, "cha_laoban")
    out = asked_taste(game, "li_laotai")
    assert out["clock"] == {"paused": False, "rate": [20, 1]}  # the world pays for the act
    assert pace.minutes("ask") == 10


def test_the_preview_of_a_question_about_tastes_has_no_blocker_where_it_can_be_asked():
    from lantern_core.api import Game as G

    game = talking("li_laotai")
    act(game, "leave")
    meet(game, "cha_laoban")
    preview = json.loads(
        game.preview_json(
            json.dumps({"verb": "ask", "npc": "cha_laoban", "topic": "likes:li_laotai"})
        )
    )
    assert preview["blockers"] == [] and "李老太" in preview["asks"]["zh"]
    assert G is Game


# ------------------------------------------------------------------------------ what it is for


def look_at_the_boat(game: Game):
    put(game, *game._kernel.world.town.places["p_ferry"].rect[:2])
    return acks(act(game, "look", at="t_he_boat"))


@pytest.mark.parametrize(
    ("thing", "opens"), [("wine", True), ("lantern_paper", True), ("pastry", False)]
)
def test_a_gift_the_boatman_likes_or_does_not_mind_takes_the_trust_past_what_his_boat_asks(
    thing, opens
):
    """The first talk earns 3 (13 in all) and the boat is shut below 15: 8 and 4 open it, a thing
    the boatman does not care for does not."""
    assert gifts.taste_of("old_he", thing) == {"wine": "like", "lantern_paper": "neutral"}.get(
        thing, "dislike"
    )
    game = bridge(1, **CLEAR)
    go_to(game, 1, 9)
    meet(game, "old_he")
    give(game, thing)
    act(game, "leave")
    run_to(game, game.tick + 1)
    assert look_at_the_boat(game) == ([("applied", None)] if opens else [("rejected", "refused")])


def test_without_a_gift_the_boat_is_shut_to_a_manager_who_has_only_talked():
    game = bridge(1, **CLEAR)
    go_to(game, 1, 9)
    meet(game, "old_he")
    act(game, "leave")
    assert look_at_the_boat(game) == [("rejected", "refused")]
