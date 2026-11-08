"""The table of opportunities: what can be had from whom on which day, the same in every story.

The script lists, for each piece of evidence, where it is, who guards it, the hours of the day and
the days it can be had on (``since`` and ``until`` of ``acquire``). The table is the same whichever
story is true, so that it tells nothing of which one it is; what a place or a person yields is the
story's. The tests here hold the table to what the script says of it in words, hold the stories to
it (no story can be told apart before the fourth day, and each can be by the evening of it) and play
the gates in the three stories side by side."""

from __future__ import annotations

import json

import pytest
from bridge_helpers import CAST, CLEAR, TOWN, at, bridge, run_to, state_of, world_of
from player_helpers import acks, act, beside, events, me, put, silence

from lantern_core.api import Game
from lantern_core.world.bridge import clock, entrust, evidence
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

VARIANTS = ("v_boat", "v_flood", "v_drunk")
DAY = 1440
ITEMS = {item["id"]: item for item in SCRIPT["evidence"]}
LO = lore()

# the table as the script's comment gives it: item -> (first day, last day or None, hours from, to)
TABLE = {
    "e_footprint": (1, 2, 7, 18),
    "e_boat_scratches": (1, None, 8, 17),
    "e_flood_debris": (3, None, 7, 18),
    "e_xiaoman_testimony": (3, None, 17, 21),
    "e_dalang_home": (3, None, 8, 18),
    "e_he_lamp": (4, None, 8, 18),
    "e_repair_record": (4, None, 9, 17),
    "e_gengfu_boat": (4, None, 15, 23),
    "e_gengfu_flood": (4, None, 15, 23),
    "e_gengfu_dalang": (4, None, 15, 23),
    "e_liner_testimony": (1, None, 8, 18),
    "e_huoji_testimony": (1, None, 8, 18),
}


def first_day(item_id: str) -> int:
    since = ITEMS[item_id]["acquire"].get("since")
    return 1 if since is None else since // DAY + 1


def last_day(item_id: str) -> int | None:
    until = ITEMS[item_id]["acquire"]["until"]
    return None if until is None else (until - 1) // DAY + 1


# ------------------------------------------------------------------------------ the script's table


def test_the_script_has_the_table_it_describes():
    assert set(TABLE) == set(ITEMS)
    for item_id, (first, last, hours_from, hours_to) in TABLE.items():
        low, high = ITEMS[item_id]["acquire"]["daily"]
        assert (first_day(item_id), last_day(item_id)) == (first, last), item_id
        assert (low, high) == (hours_from * 60, hours_to * 60), item_id


def test_every_item_opens_before_it_closes_and_inside_the_game():
    for item_id, item in ITEMS.items():
        since, until = item["acquire"].get("since"), item["acquire"]["until"]
        assert since is None or 0 <= since < SCRIPT["days"] * DAY, item_id
        assert since is None or until is None or since < until, item_id


def completion_day(variant: str) -> int:
    """The first day on which a set that tells ``variant`` apart can be complete: the day the last
    of its items opens, for the quickest set."""
    return min(
        max(first_day(item) for item in row["items"])
        for row in SCRIPT["evidence_sets"]
        if row["tells"] == variant
    )


@pytest.mark.parametrize("variant", VARIANTS)
def test_no_story_can_be_told_apart_before_the_fourth_day_and_each_can_be_by_it(variant):
    assert completion_day(variant) == 4
    # and every set holds an item of the fourth day, so that no route round the table is left
    for row in SCRIPT["evidence_sets"]:
        assert max(first_day(item) for item in row["items"]) >= 4, row["id"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_places_of_the_lead_give_a_complete_set_in_each_story_by_the_evening_of_the_fourth_day(
    variant,
):
    """The rail on the first two days, the boat, the water and the watchman: whichever story is
    true,
    what those four yield (what is real in it) holds a set of the script."""
    lead = ("e_footprint", "e_boat_scratches", "e_flood_debris", "e_gengfu_boat", "e_gengfu_flood",
            "e_gengfu_dalang")  # fmt: skip
    got = {item for item in lead if variant in ITEMS[item]["real_in"]}
    assert any(
        set(row["items"]) <= got for row in SCRIPT["evidence_sets"] if row["tells"] == variant
    )


def test_the_two_stories_of_the_clerk_and_the_ledger_are_only_for_those_who_look_further():
    """The ledger and the lamp are side roads: the lead does not name them, and they open on the
    fourth day (the clerk's word on the third)."""
    lead = {"e_footprint", "e_boat_scratches", "e_flood_debris", "e_gengfu_boat", "e_gengfu_flood",
            "e_gengfu_dalang", "e_xiaoman_testimony"}  # fmt: skip
    assert {"e_repair_record", "e_he_lamp", "e_dalang_home"}.isdisjoint(lead)


# -------------------------------------------------------------------------- the gates, side by side


class Quiet:
    """The slice-like town in each story with nobody to talk to the manager, played on by day and
    kept at the moments a test looks at, so that a test can ask the same of the three stories."""

    def __init__(self, seed: int, moments: list[tuple[int, int, int]]) -> None:
        self.shots: dict[tuple[str, tuple[int, int, int]], str] = {}
        for variant in VARIANTS:
            game = bridge(seed, **CLEAR, variant=variant)
            for moment in moments:
                run_to(game, at(*moment))
                self.shots[variant, moment] = game.snapshot_json()

    def game(self, variant: str, moment: tuple[int, int, int]) -> Game:
        return Game.from_snapshot_json(self.shots[variant, moment])


SEED = 7
MOMENTS = [
    (2, 10, 0),  # the water is high, the ledger is away
    (2, 18, 30),  # the boy's evening of the second day
    (2, 19, 30),  # the watchman's evening of the second day
    (3, 10, 0),
    (3, 18, 30),
    (3, 19, 30),
    (4, 10, 30),
    (4, 14, 30),  # the watchman is up at his post, and his word opens at three
    (4, 15, 30),
    (4, 19, 30),
]


@pytest.fixture(scope="module")
def quiet():
    return Quiet(SEED, MOMENTS)


def trusting(game: Game, who: str, value: int = 60) -> None:
    me(game)["trust"][LO.index[who]] = value


def stand_at(game: Game, place: str) -> None:
    x, y, _, _ = TOWN.places[place].rect
    put(game, x, y)


def look(game: Game, target: str, place: str, trust: str | None = None):
    """The manager stands at ``place`` and looks at ``target``. The acknowledgements and the events
    of the whole look, to its end."""
    if trust:
        trusting(game, trust)
    if me(game)["talk"]:
        act(game, "leave")
    stand_at(game, place)
    out = act(game, "look", at=target)
    got = acks(out)
    found: list[str] = []
    if got == [("applied", None)]:
        for _ in range(400):
            out = json.loads(game.step())
            found += [i for e in events(out, "inspected") for i in e["found"]]
            if not me(game)["busy"]:
                break
    return got, found


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_water_under_the_bridge_is_not_to_be_seen_before_the_third_day(quiet, variant):
    game = quiet.game(variant, (2, 10, 0))
    got, found = look(game, "p_under_bridge", "p_under_bridge")
    assert got == [("rejected", "closed")] and found == []
    assert "e_flood_debris" not in me(game)["looked"]  # a look that was turned away is not a look
    game = quiet.game(variant, (3, 10, 0))
    got, found = look(game, "p_under_bridge", "p_under_bridge")
    assert got == [("applied", None)]
    assert ("e_flood_debris" in found) == (variant == "v_flood")
    assert "e_flood_debris" in me(game)["looked"]


@pytest.mark.parametrize("variant", VARIANTS)
def test_the_ledger_is_away_until_the_fourth_day(quiet, variant):
    game = quiet.game(variant, (3, 10, 0))
    got, found = look(game, "t_repair_ledger", "p_accountant_home", trust="zhangfang")
    assert got == [("rejected", "closed")]
    game = quiet.game(variant, (4, 10, 30))
    got, found = look(game, "t_repair_ledger", "p_accountant_home", trust="zhangfang")
    assert got == [("applied", None)]
    assert ("e_repair_record" in found) == (variant == "v_boat")


def meet(game: Game, who: str) -> None:
    for _ in range(80):
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, acks(out))


def ask_to_testify(game: Game, who: str):
    trusting(game, who)
    meet(game, who)
    out = act(game, "entrust", kind="testify")
    return acks(out), [e["items"] for e in events(out, "testified")]


@pytest.mark.parametrize(
    ("who", "moment"),
    [
        ("gengfu", (2, 19, 30)),
        ("gengfu", (3, 19, 30)),
        ("gengfu", (4, 14, 30)),
        ("xiao_man", (2, 18, 30)),
    ],
)
def test_a_witness_who_will_not_speak_yet_says_so_the_same_in_every_story(quiet, who, moment):
    """Whether a person saw anything is for them to say, and not before their day: the answer to an
    early request is the same whichever story is true, and nothing is handed over."""
    answers = set()
    for variant in VARIANTS:
        got, handed = ask_to_testify(quiet.game(variant, moment), who)
        assert handed == [], (variant, who)
        answers.add(tuple(got))
    assert answers == {(("rejected", "closed"),)}, (who, moment, answers)


@pytest.mark.parametrize("moment", [(4, 15, 30), (4, 19, 30)])
@pytest.mark.parametrize("variant", VARIANTS)
def test_the_watchman_speaks_from_three_in_the_afternoon_of_the_fourth_day_in_every_story(
    quiet, variant, moment
):
    got, handed = ask_to_testify(quiet.game(variant, moment), "gengfu")
    assert got == [("applied", None)]
    assert len(handed) == 1 and len(handed[0]) == 1  # the one thing the story gave them to see
    assert handed[0][0] in {"e_gengfu_boat", "e_gengfu_flood", "e_gengfu_dalang"}
    assert variant in ITEMS[handed[0][0]]["real_in"]


def test_the_boy_speaks_from_the_third_evening_and_has_something_to_tell_in_one_story(quiet):
    results = {}
    for variant in VARIANTS:
        got, handed = ask_to_testify(quiet.game(variant, (3, 18, 30)), "xiao_man")
        results[variant] = (tuple(got), handed)
    assert results["v_boat"] == ((("applied", None),), [["e_xiaoman_testimony"]])
    assert results["v_flood"] == results["v_drunk"] == ((("rejected", "nothing_to_say"),), [])


def test_a_request_to_testify_is_a_new_question_on_a_later_day_for_a_person_with_a_timed_item(
    quiet,
):
    """The answer to a request that nothing has changed is "I have said it already", but a person
    whose word opens on a day of its own has something new to say on that day."""
    assert entrust.opens_later("gengfu") and entrust.opens_later("xiao_man")
    assert not entrust.opens_later("old_he")  # the boat has no day of its own
    signs = []
    for moment in ((3, 19, 30), (4, 19, 30)):
        game = quiet.game("v_boat", moment)
        trusting(game, "gengfu")
        weighing = entrust.weigh_request(world_of(game), state_of(game), "gengfu", "testify", "")
        signs.append(weighing.sign)
    assert signs[0] != signs[1] and signs[0].endswith("day3") and signs[1].endswith("day4")


def test_the_footprint_is_gone_from_the_third_day_and_the_boat_is_there_from_the_first(quiet):
    for variant in VARIANTS:
        game = quiet.game(variant, (2, 10, 0))
        got, found = look(game, "t_rail", "p_bridge")
        assert got == [("applied", None)]
        assert ("e_footprint" in found) == (variant == "v_drunk")
        game = quiet.game(variant, (3, 10, 0))
        got, found = look(game, "t_rail", "p_bridge")
        assert got == [("rejected", "closed")] and found == []
        game = quiet.game(variant, (2, 10, 0))
        got, found = look(game, "t_he_boat", "p_ferry", trust="old_he")
        assert got == [("applied", None)]
        assert ("e_boat_scratches" in found) == (variant in ("v_boat", "v_flood"))


def test_the_hours_of_the_day_are_still_the_hours_of_the_table(quiet):
    """The boy speaks from five to nine, so not at ten in the morning of the third day."""
    for variant in VARIANTS:
        got, handed = ask_to_testify(quiet.game(variant, (3, 10, 0)), "xiao_man")
        assert got == [("rejected", "closed")] and handed == [], variant


def test_the_gate_reads_the_day_of_the_clock_and_nothing_of_the_story():
    """``evidence.gate`` is a function of the item, the manager's trust and the time. It has no
    story in its arguments, so the three stories cannot tell by it."""
    game = bridge(SEED, **CLEAR)
    run_to(game, 10)
    world, section = world_of(game), me(game)
    for index in range(len(section["trust"])):
        section["trust"][index] = 90
    for item in ITEMS.values():
        for day in range(1, 6):
            for hour in (8, 12, 18, 20):
                now = clock.at(at(day, hour))
                shut = evidence.gate(world, section, item, now)
                low, high = item["acquire"]["daily"]
                by_day = first_day(item["id"]) <= day and (
                    last_day(item["id"]) is None or day <= last_day(item["id"])
                )
                open_now = by_day and low <= hour * 60 < high
                needs = any(n not in section["evidence"] for n in item["acquire"]["needs"])
                assert (shut is None) == (open_now and not needs), (item["id"], day, hour, shut)


def test_the_cast_has_every_holder_of_the_table():
    for item in ITEMS.values():
        holder = item["acquire"]["from"]
        assert holder in CAST.index or holder in TOWN.places or holder in evidence.LOCATION
