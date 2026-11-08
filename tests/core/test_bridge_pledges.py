"""The manager's promises and the ledger of favours; what the town makes of kept and broken ones."""

import pytest
from bridge_helpers import CAST, at, run_to, state_of, step
from dealings_helpers import LO, acks, act, events, me, stored, talking, trust, trust_of
from player_helpers import beside, plain, silence
from voice_helpers import says

from lantern_core.inputs import InputError
from lantern_core.world.bridge import pledges, repute

PERSON = "cha_laoban"


def room(who=PERSON, **kwargs):
    game = talking(who, **kwargs)
    trust(game, who, 20)
    return game


def promise(game, **fields):
    return act(game, "promise", **fields)


def make(game, what, item="", amount=0, due=3):
    return promise(game, what=what, item=item, amount=amount, due=due)


def switch_to(game, who):
    """Leave the conversation and open one with ``who``, waiting for them to be free."""
    act(game, "leave")
    for _ in range(80):
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], acks(out)


# ------------------------------------------------------------------------------ what is held


def test_the_manager_holds_stalls_roles_wages_and_places_in_the_programme():
    game = room()
    assert pledges.left(me(game)) == {
        "stall_front": 2,
        "stall_back": 4,
        "roles": ["t_honor_light", "lead_lanterns", "stage_words"],
        "slots": ["1", "2", "3", "4", "5"],
        "purse": 60,
    }
    out = make(game, "role", "stage_words")
    left = out["frame"]["hud"]["resources"]
    assert left["roles"] == ["t_honor_light", "lead_lanterns"] and left["purse"] == 60
    assert [p["id"] for p in out["frame"]["hud"]["pledges"]] == ["k1"]


def test_there_are_two_front_stalls_and_no_third():
    game = room()
    assert acks(make(game, "stall", "front")) == [("applied", None)]
    assert acks(make(game, "stall", "front")) == [("applied", None)]
    out = make(game, "stall", "front")
    assert (
        acks(out) == [("rejected", "empty")] and events(out, "pledge_empty")[0]["item"] == "front"
    )
    assert acks(make(game, "stall", "back")) == [("applied", None)]  # there are the back ones


@pytest.mark.parametrize(("what", "item"), [("role", "t_honor_light"), ("slot", "3")])
def test_a_role_and_a_place_in_the_programme_go_to_one_person_each(what, item):
    game = room()
    assert acks(make(game, what, item)) == [("applied", None)]
    switch_to(game, "sishu_xiansheng")
    assert acks(make(game, what, item)) == [("rejected", "empty")]
    assert [p["to"] for p in me(game)["pledges"]] == [PERSON]


def test_wages_come_out_of_a_purse_of_sixty_coins_until_it_is_empty():
    game = room()
    assert acks(make(game, "wage", amount=40)) == [("applied", None)]
    assert acks(make(game, "wage", amount=30)) == [("rejected", "empty")]  # twenty are left
    assert acks(make(game, "wage", amount=20)) == [("applied", None)]
    assert pledges.left(me(game))["purse"] == 0
    assert acks(make(game, "wage", amount=1)) == [("rejected", "empty")]


@pytest.mark.parametrize(
    "fields",
    [
        {
            "what": "apology"
        },  # 'I will have Shopkeeper Zhou say he is sorry' is not the manager's to give
        {"what": "stall", "item": "middle"},
        {"what": "role", "item": "mayor"},
        {"what": "slot", "item": "9"},
        {"what": "wage", "amount": 0},
        {"what": "wage", "amount": 61},
        {"what": ""},
        {},
    ],
)
def test_a_promise_beyond_what_the_manager_holds_is_not_believed_on_the_spot(fields):
    game = room()
    before = (list(me(game)["pledges"]), me(game)["pseq"], trust_of(game, PERSON))
    out = promise(game, **fields)
    assert acks(out) == [("rejected", "empty")] and events(out, "pledge_empty")
    says(out, PERSON, "empty")
    assert (list(me(game)["pledges"]), me(game)["pseq"], trust_of(game, PERSON)) == before


# ------------------------------------------------------------------------------ making and keeping


@pytest.mark.parametrize(
    ("what", "item", "amount", "size"),
    [
        ("stall", "back", 0, 1),
        ("stall", "front", 0, 2),
        ("role", "lead_lanterns", 0, 3),
        ("slot", "1", 0, 1),
        ("wage", "", 10, 1),
        ("wage", "", 20, 2),
        ("wage", "", 45, 3),
    ],
)
def test_a_promise_is_written_down_and_earns_a_little_trust_by_its_size(what, item, amount, size):
    game = room()
    out = make(game, what, item, amount, due=4)
    assert acks(out) == [("applied", None)]
    (pledge,) = me(game)["pledges"]
    assert pledge == {
        "id": "k1",
        "to": PERSON,
        "what": what,
        "item": item,
        "amount": amount,
        "size": size,
        "made": game.tick - 1,
        "due": 4,
        "state": "open",
        "ended": -1,
    }
    assert trust_of(game, PERSON) == 20 + pledges.MADE_GAIN[size]
    (event,) = events(out, "pledged")
    # the event says what was promised, the coins of a wage included, without a look at the frame
    assert {k: event[k] for k in ("npc", "pledge", "what", "item", "amount", "due")} == {
        "npc": PERSON,
        "pledge": "k1",
        "what": what,
        "item": item,
        "amount": amount,
        "due": 4,
    }
    says(out, PERSON, "deal")
    assert out["frame"]["hud"]["pledges"][0]["to"] == {
        "zh": "茶馆老板娘",
        "en": "Teahouse Keeper",
        "id": PERSON,
    }
    assert out["frame"]["hud"]["pledges"][0]["amount"] == event["amount"]


def test_only_a_wage_has_an_amount_whatever_the_body_of_the_promise_says():
    game = room()
    out = make(game, "stall", "front", amount=25)
    (event,) = events(out, "pledged")
    assert event["amount"] == 0 == me(game)["pledges"][0]["amount"]


def test_a_day_that_has_gone_or_is_beyond_the_festival_is_no_day_to_promise_for():
    game = room(day=3)
    assert acks(make(game, "slot", "1", due=2)) == [("rejected", "bad_due")]
    assert acks(make(game, "slot", "1", due=6)) == [("rejected", "bad_due")]
    assert acks(make(game, "slot", "1", due=3)) == [("applied", None)]
    assert acks(promise(game, what="slot", item="2")) == [("applied", None)]  # no day: the last
    assert [p["due"] for p in me(game)["pledges"]] == [3, 5]


def test_a_malformed_promise_is_an_error():
    game = room()
    for fields in (
        {"op": "give"},
        {"op": "keep"},
        {"op": "keep", "id": 4},
        {"what": 5},
        {"what": "wage", "amount": -3},
        {"what": "wage", "amount": "ten"},
        {"what": "slot", "due": 99},
    ):
        with pytest.raises(InputError):
            promise(game, **fields)


def test_a_promise_kept_in_person_is_a_deed_and_earns_more_trust():
    game = room()
    make(game, "stall", "front")
    assert pledges.in_hand(me(game), PERSON) == 2 and pledges.balance(me(game), PERSON) == 0
    out = promise(game, op="keep", id="k1")
    assert acks(out) == [("applied", None)]
    assert me(game)["pledges"][0]["state"] == "kept" and me(game)["pledges"][0]["ended"] > 0
    assert trust_of(game, PERSON) == 20 + pledges.MADE_GAIN[2] + pledges.KEPT_GAIN[2]
    # open it was a prospect; kept it is a deed: the same two points, not counted twice
    assert pledges.in_hand(me(game), PERSON) == 0 and pledges.balance(me(game), PERSON) == 2
    assert events(out, "pledge_kept")[0]["pledge"] == "k1"
    says(out, PERSON, "kept_thanks")
    assert out["frame"]["hud"]["pledges"] == []  # nothing is open
    assert pledges.left(me(game))["stall_front"] == 1  # and the stall is given away for good


def test_a_promise_is_kept_once_and_only_to_the_person_it_was_made_to():
    game = room()
    make(game, "slot", "1")
    assert acks(promise(game, op="keep", id="k9")) == [("rejected", "no_pledge")]
    switch_to(game, "sishu_xiansheng")
    assert acks(promise(game, op="keep", id="k1")) == [("rejected", "wrong_person")]
    assert me(game)["pledges"][0]["state"] == "open"
    switch_to(game, PERSON)
    assert acks(promise(game, op="keep", id="k1")) == [("applied", None)]
    gain = trust_of(game, PERSON)
    assert acks(promise(game, op="keep", id="k1")) == [("rejected", "kept_already")]
    assert trust_of(game, PERSON) == gain and len(me(game)["deeds"]) == 1


def test_a_promise_not_kept_by_its_day_is_broken_and_costs_trust_and_spreads_as_a_fact():
    game = room()
    make(game, "role", "stage_words", due=1)
    trust_made = trust_of(game, PERSON)
    act(game, "leave")
    run_to(game, at(2, 7))  # the first day is over
    assert me(game)["pledges"][0]["state"] == "broken" and me(game)["pledges"][0]["ended"] > 0
    assert trust_of(game, PERSON) == trust_made - pledges.BROKEN_DROP[3]
    belief = stored(game, PERSON, repute.BROKE)
    assert (belief.source, belief.confidence) == ("saw", repute.FIRST_HAND)
    assert me(game)["wary"][repute.BROKE] == [PERSON]
    assert pledges.left(me(game))["roles"] == ["t_honor_light", "lead_lanterns", "stage_words"]
    assert pledges.in_hand(me(game), PERSON) == 0 and pledges.balance(me(game), PERSON) == 0
    switch_to(game, PERSON)
    assert acks(promise(game, op="keep", id="k1")) == [("rejected", "lapsed")]


def test_a_broken_word_is_carried_by_the_talk_of_the_town_and_each_who_believes_it_trusts_less():
    game = room()
    make(game, "slot", "1", due=1)
    act(game, "leave")
    social = state_of(game)["social"]
    social["next"] = [0] * len(social["next"])
    run_to(game, at(3, 7) + 10)  # (the look at what the town believes comes every ten ticks)
    believers = [
        p
        for p in CAST.index
        if p != PERSON and repute.believes(state_of(game)["social"], p, repute.BROKE)
    ]
    assert len(believers) >= 3
    for person in believers:
        assert person in me(game)["wary"][repute.BROKE]
        assert trust_of(game, person) == 10 - repute.HEARSAY_DROP[repute.BROKE]


def test_a_broken_word_reads_as_a_fact_about_the_manager_in_both_languages():
    game = room()
    prop = repute.prop(state_of(game)["social"], repute.BROKE)
    said = LO.lines.statement(prop, LO.names)
    assert said == {"zh": "总管说话不算数", "en": "the Festival Manager broke a promise"}


# ------------------------------------------------------------------------------ the ledger


def test_a_deed_goes_in_the_ledger_once_whatever_the_number_of_times_it_is_done():
    game = room()
    section = me(game)
    assert pledges.add_deed(section, "gave:hat", PERSON, 2, 1, 0) is True
    assert pledges.add_deed(section, "gave:hat", PERSON, 2, 1, 5) is False  # the same deed again
    assert (
        pledges.add_deed(section, "gave:hat", PERSON, 3, 1, 5) is False
    )  # even bigger the 2nd time
    assert pledges.balance(section, PERSON) == 2
    assert pledges.add_deed(section, "gave:coat", PERSON, 1, 1, 6) is True
    assert pledges.balance(section, PERSON) == 3


def test_what_a_person_did_for_the_manager_is_owed_back_and_the_balance_is_held_to_six():
    game = room()
    section = me(game)
    pledges.add_deed(section, "gave", PERSON, 2, 1, 0)
    pledges.add_deed(section, "owed", PERSON, 3, -1, 0)
    assert pledges.balance(section, PERSON) == -1
    pledges.add_deed(section, "big", PERSON, 9, 1, 0)
    pledges.add_deed(section, "more", "li_er", 9, -1, 0)
    assert pledges.balance(section, PERSON) == 6 and pledges.balance(section, "li_er") == -6
    assert pledges.balance(section, "li_da") == 0


def test_a_request_the_town_granted_is_one_deed_even_when_it_is_asked_and_granted_twice():
    game = room("zhou_zhanggui")
    trust(game, "zhou_zhanggui", 80)
    act(game, "entrust", kind="material")
    act(game, "entrust", kind="material")  # on the way already
    assert [k for k in me(game)["deeds"] if k.startswith("asked:")] == [
        "asked:zhou_zhanggui|material|timber"
    ]
    assert pledges.balance(me(game), "zhou_zhanggui") == -2


def test_the_state_of_promises_and_deeds_is_plain_data_and_the_frame_lists_only_open_ones():
    game = room()
    make(game, "stall", "back")
    make(game, "slot", "2")
    promise(game, op="keep", id="k1")
    plain(game._kernel.state)
    out = step(game)
    assert [p["id"] for p in out["frame"]["hud"]["pledges"]] == ["k2"]


# ------------------------------------------------------------------------------ the stars


@pytest.mark.parametrize(
    ("mean", "stars"),
    [(0, 0), (10, 0), (11, 0), (12, 1), (24, 1), (25, 2), (39, 2), (40, 3), (100, 3)],
)
def test_the_town_trust_in_the_manager_is_boiled_down_to_three_stars(mean, stars):
    game = room()
    me(game)["trust"] = [mean] * len(CAST.index)
    assert repute.stars(me(game)) == stars
    assert step(game)["frame"]["hud"]["reputation"] == stars


def test_the_mean_is_taken_over_the_whole_town_and_a_new_game_has_no_stars():
    game = room()
    me(game)["trust"] = [100] * 6 + [0] * 14  # six friends and a town of strangers: 30
    assert repute.stars(me(game)) == 2


def test_a_new_game_has_no_stars_and_a_first_talk_does_not_change_it():
    game = room()
    assert step(game)["frame"]["hud"]["reputation"] == 0
