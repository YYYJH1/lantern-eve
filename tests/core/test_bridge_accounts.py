"""The street's two accounts: what the paper says when two stories of how the rail broke are each
given out in public by enough of the named townsfolk.

``social`` keeps the latest account of the conflict each named person said in a public place, where
others could hear it, and the paper (``gazette``) groups them by whom they blame. These tests hold
the record, the grouping and its thresholds, the words in both languages, the rule that a pair is
told once, and that nothing hidden is in it.
"""

from __future__ import annotations

import json
import re

import pytest
from agenda_helpers import slice_game
from bridge_helpers import CAST, CYCLE, TOWN, at, bridge, run_to, state_of
from player_helpers import silence
from social_helpers import seeds_of

from lantern_core.api import Game
from lantern_core.world.bridge import (
    commitments,
    gazette,
    goals_ending,
    gossip,
    projection,
    social,
)
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

LO = lore()
LI_ER, LI_FAMILY, BOAT, FLOOD, DALANG, SEEN = (
    "pr_liner_damaged",
    "pr_li_damaged",
    "pr_boat_damaged",
    "pr_flood_damaged",
    "pr_dalang_damaged",
    "pr_liner_looking",
)
MORNING = at(2, 7)
CROWD = ("cha_laoban", "zhou_huoji", "mujiang", "gengfu", "zhou_niangzi", "li_da")


def aloud_by(speakers, prop, tick=100):
    return {who: [prop, tick] for who in speakers}


def give_out(game, rows):
    """Set the record of what was said out in the open, as the game keeps it."""
    state_of(game)["social"]["aloud"] = {who: list(row) for who, row in rows.items()}


# ------------------------------------------------------------------------------ the record


def test_a_game_that_has_not_been_told_anything_in_public_has_no_record():
    game = bridge(1)
    assert "aloud" not in state_of(game)["social"]
    assert gazette.accounts_aloud(state_of(game), 100) == []


def test_a_world_without_the_talk_between_neighbours_has_no_accounts_and_no_error(monkeypatch):
    from lantern_core.world.bridge import order

    quiet = tuple(m for m in order.SUBSYSTEMS if m.SECTION != "social")
    monkeypatch.setattr(order, "SUBSYSTEMS", quiet)
    game = bridge(3)
    run_to(game, at(2, 8))  # through the paper of the second morning and the night before it
    assert state_of(game)["social"] == {} or "aloud" not in state_of(game)["social"]
    assert gazette.accounts_aloud(state_of(game), game.tick) == []


def test_the_record_is_the_latest_account_each_named_person_gave_out_in_public():
    seed = seeds_of("v_drunk")[0]
    game = bridge(seed)
    expected: dict[str, list] = {}
    public, private = 0, 0
    while game.tick < 3 * CYCLE:
        out = json.loads(game.step())
        for event in out["events"]:
            if event["kind"] != "told":
                continue
            me_ = state_of(game)["npcs"]["list"][CAST.index[event["speaker"]]]
            room = TOWN.places[me_["place"]]
            if room.kind not in social.PUBLIC_KINDS or not gossip.at_goal(me_):
                private += 1
                continue
            public += 1
            prop = social.book(state_of(game)["social"])[event["prop"]]
            if goals_ending.about_the_conflict(prop):
                expected[event["speaker"]] = [event["prop"], event["tick"]]
    assert public > 5 and private > 5 and expected
    assert state_of(game)["social"]["aloud"] == expected
    # only the accounts of how the rail broke, and only by the named, said in public places
    book = social.book(state_of(game)["social"])
    for who, (prop_id, tick) in expected.items():
        assert who in LO.index and book[prop_id].pred in ("damaged", "flood_damaged")
        assert not book[prop_id].neg and 0 < tick <= game.tick


def test_the_same_game_keeps_the_same_record_and_a_saved_game_goes_on_with_it():
    seed = seeds_of("v_boat")[0]
    one, two = bridge(seed), bridge(seed)
    run_to(one, 2 * CYCLE)
    run_to(two, 2 * CYCLE)
    assert state_of(one)["social"].get("aloud") == state_of(two)["social"].get("aloud")
    restored = Game.from_snapshot_json(one.snapshot_json())
    run_to(one, 3 * CYCLE)
    run_to(restored, 3 * CYCLE)
    assert state_of(one)["social"].get("aloud") == state_of(restored)["social"].get("aloud")
    assert one.hash() == restored.hash()


# ------------------------------------------------------------------------------ the accounts


def test_a_person_stands_for_their_family_and_the_flood_for_itself():
    book = LO.book.props
    assert gazette.account_key(book[LI_ER]) == "fam_li" == gazette.account_key(book[LI_FAMILY])
    assert gazette.account_key(book[BOAT]) == "old_he"  # (he is of no family)
    assert gazette.account_key(book[FLOOD]) == "flood"
    assert gazette.account_key(book[DALANG]) == "fam_zhou"


def test_an_account_is_the_street_s_when_a_tenth_of_the_named_people_gave_it_out():
    assert gazette.ACCOUNT_VOICES == 2 and len(LO.people) == 20
    game = bridge(1)
    world = state_of(game)
    rows = {**aloud_by(CROWD[:3], LI_ER), CROWD[3]: [BOAT, 100]}
    give_out(game, rows)
    assert gazette.accounts_aloud(world, 200) == [("fam_li", 3, LI_ER)]  # one is not enough
    give_out(game, {**rows, CROWD[4]: [BOAT, 100]})
    found = gazette.accounts_aloud(world, 200)
    assert [(k, n) for k, n, _ in found] == [("fam_li", 3), ("old_he", 2)]


def test_two_stories_of_one_family_are_one_account_and_the_most_said_wording_stands_for_it():
    game = bridge(1)
    give_out(
        game,
        {
            CROWD[0]: [LI_ER, 100],
            CROWD[1]: [LI_FAMILY, 100],
            CROWD[2]: [LI_FAMILY, 110],
            CROWD[3]: [BOAT, 100],
        },
    )
    assert gazette.accounts_aloud(state_of(game), 200) == [("fam_li", 3, LI_FAMILY)]


def test_the_wording_that_most_of_them_said_stands_for_the_account_and_a_tie_goes_to_the_first_id():
    game = bridge(1)
    give_out(game, {CROWD[0]: [LI_FAMILY, 1], CROWD[1]: [LI_ER, 1], CROWD[2]: [LI_ER, 1]})
    assert gazette.accounts_aloud(state_of(game), 5) == [("fam_li", 3, LI_ER)]
    give_out(
        game,
        {CROWD[0]: [LI_FAMILY, 1], CROWD[1]: [LI_ER, 1], CROWD[2]: ["pr_li_damaged_jealous", 1]},
    )
    assert gazette.accounts_aloud(state_of(game), 5) == [("fam_li", 3, LI_FAMILY)]


def test_what_was_said_more_than_two_days_ago_or_after_now_is_not_what_the_street_says():
    game = bridge(1)
    world = state_of(game)
    until = 5 * CYCLE
    old = until - gazette.ACCOUNT_DAYS * CYCLE
    give_out(
        game, {**aloud_by(CROWD[:3], BOAT, tick=old), **aloud_by(CROWD[3:], LI_ER, tick=until)}
    )
    assert gazette.accounts_aloud(world, until) == [("fam_li", 3, LI_ER)]  # old is out, now is in
    give_out(game, aloud_by(CROWD[:3], BOAT, tick=old + 1))
    assert [k for k, _, _ in gazette.accounts_aloud(world, until)] == ["old_he"]
    assert gazette.accounts_aloud(world, old) == []  # the record is read as of the time asked


def test_the_most_voiced_account_comes_first_and_ties_go_in_the_order_of_the_accounts():
    game = bridge(1)
    give_out(
        game,
        {
            **aloud_by(CROWD[:3], FLOOD),
            **aloud_by(("li_er", "li_xiaomei", "zhadeng_shifu", "miaozhu"), LI_ER),
            **aloud_by(("zhangfang", "sishu_xiansheng", "zuzhang"), BOAT),
        },
    )
    keys = [(k, n) for k, n, _ in gazette.accounts_aloud(state_of(game), 200)]
    assert keys == [("fam_li", 4), ("flood", 3), ("old_he", 3)]
    assert [k for k, _, _ in gazette.the_two_accounts(state_of(game), 200)] == ["fam_li", "flood"]


def test_one_account_alone_is_not_two():
    game = bridge(1)
    give_out(game, aloud_by(CROWD, LI_ER))
    assert gazette.the_two_accounts(state_of(game), 200) == []


# ------------------------------------------------------------------------------ the paper


def a_morning(rows, **config):
    """The slice a call before the paper of the second morning, in a clear sky, with ``rows`` as
    what was said out in the open."""
    game = slice_game(**config)
    section = state_of(game)["weather"]
    section["plan"] = ["clear"] * len(section["plan"])
    section["kind"] = "clear"
    run_to(game, MORNING)
    give_out(game, rows)
    silence(game)
    return game


def the_paper(game):
    frame = json.loads(game.step())["frame"]
    return frame["gazette"]


def kinds(paper):
    return [paper["head"]["kind"], *(row["kind"] for row in paper["news"])]


def item_of(paper):
    """The item of the street's two stories, wherever the paper puts it."""
    (item,) = [row for row in (paper["head"], *paper["news"]) if row["kind"] == "two_accounts"]
    return item


def two_stories(tick=None):
    tick = at(1, 15) if tick is None else tick
    return {**aloud_by(CROWD[:3], LI_ER, tick), **aloud_by(CROWD[3:], BOAT, tick)}


def test_the_morning_paper_says_the_street_has_two_stories_and_names_them():
    paper = the_paper(a_morning(two_stories()))
    assert "two_accounts" in kinds(paper)
    item = item_of(paper)
    assert item["text"]["zh"] == (
        "街上有两种说法：一说李二昨夜弄坏了石桥栏杆，一说船夫老何昨夜弄坏了石桥栏杆，是不小心的。"
    )
    assert item["text"]["en"] == (
        "The street has two stories. Some say that Li Er damaged the Stone Bridge Railing last"
        " night, and others say that Boatman He damaged the Stone Bridge Railing last night, by"
        " accident."
    )


def test_the_paper_has_the_two_stories_in_its_news_and_who_went_about_in_its_talk_in_two_lines():
    """The news item of the street's two stories and the street talk about who went about the day
    before (the night) are in one paper: the item among the news, the walkers in the talk, which
    keeps to the two lines the page reads and gives the second of them to the walkers."""
    game = a_morning(two_stories())
    state_of(game)["reflection"]["log"] = [
        [at(1, 15), "tell", "li_da", "cha_laoban"],
        [at(1, 16), "tell", "zhou_huoji", "mujiang"],
        [at(1, 17), "look", "gengfu", ""],
    ]
    paper = the_paper(game)
    assert "two_accounts" in kinds(paper)
    talk = [row["kind"] for row in paper["talk"]]
    assert len(talk) == gazette.TALK_LINES == 2
    assert talk[-1] == "walk_call" and "walk_call" not in kinds(paper)  # the calls, done most often


def test_the_words_of_the_item_are_in_both_languages_and_name_no_person_he_or_she():
    words = SCRIPT["paper"]["news"]["two_accounts"]
    assert set(words) == {"zh", "en"} and "{first}" in words["zh"] and "{second}" in words["en"]
    assert not re.search("[他她；—]|--", words["zh"])
    assert not re.search(r"\b(he|she|his|her|hers|him)\b", words["en"], re.I)
    item = item_of(the_paper(a_morning(two_stories())))
    assert "{" not in item["text"]["zh"] + item["text"]["en"]


def test_the_item_is_the_headline_of_a_quiet_morning_and_a_short_one_when_there_is_better_news():
    quiet = the_paper(a_morning(two_stories()))
    assert quiet["head"]["kind"] == "two_accounts"  # nothing happened that the paper ranks higher
    game = a_morning(two_stories())
    state_of(game)["goals"]["flags"]["truth_told"] = at(1, 20)  # but the truth told in public is
    paper = the_paper(game)
    assert paper["head"]["kind"] == "truth_told"
    assert [row["kind"] for row in paper["news"]][:1] == ["two_accounts"]
    assert gazette.RANK.index("two_accounts") > gazette.RANK.index("stance")
    assert gazette.RANK.index("two_accounts") < gazette.RANK.index("stopped")


def test_the_record_of_the_recap_keeps_the_pair_so_that_the_next_paper_tells_it_once():
    game = a_morning(two_stories())
    the_paper(game)
    record = state_of(game)[commitments.SECTION]["recap"]
    assert record["accounts"] == ["fam_li", "old_he"]
    # the same two stories the next morning, said again that day: the paper has said it
    run_to(game, at(2, 18))
    give_out(game, two_stories(tick=at(2, 17)))
    silence(game)
    run_to(game, at(3, 7))
    again = the_paper(game)
    assert "two_accounts" not in kinds(again)
    assert state_of(game)[commitments.SECTION]["recap"]["accounts"] == ["fam_li", "old_he"]


def test_another_pair_of_stories_is_told_again():
    game = a_morning(two_stories())
    the_paper(game)
    run_to(game, at(2, 18))
    give_out(
        game, {**aloud_by(CROWD[:3], LI_ER, at(2, 17)), **aloud_by(CROWD[3:], FLOOD, at(2, 17))}
    )
    silence(game)
    run_to(game, at(3, 7))
    paper = the_paper(game)
    item = item_of(paper)
    assert "洪" in item["text"]["zh"] or "汛" in item["text"]["zh"]
    assert state_of(game)[commitments.SECTION]["recap"]["accounts"] == ["fam_li", "flood"]


def test_a_morning_without_two_stories_has_no_item_and_no_pair_in_the_record():
    game = a_morning(aloud_by(CROWD, LI_ER))
    paper = the_paper(game)
    assert "two_accounts" not in kinds(paper)
    assert "accounts" not in state_of(game)[commitments.SECTION]["recap"]


def test_a_stretch_that_ended_before_the_talk_was_given_out_is_still_the_street_s_word_now():
    """The item is about how the street stands when the paper is made, not about the stretch."""
    game = a_morning(two_stories(tick=at(1, 7)))
    assert "two_accounts" in kinds(the_paper(game))


def test_the_summary_of_the_night_has_it_as_the_change_when_nothing_ranks_higher():
    game = slice_game()
    section = state_of(game)["weather"]
    section["plan"] = ["clear"] * len(section["plan"])
    section["kind"] = "clear"
    run_to(game, at(1, 21))
    give_out(game, two_stories(tick=at(1, 20)))
    silence(game)
    night = json.loads(game.step())["frame"]["night"]
    assert night is not None and night["changed"]["kind"] == "two_accounts"
    other = slice_game()
    section = state_of(other)["weather"]
    section["plan"] = ["clear"] * len(section["plan"])
    section["kind"] = "clear"
    run_to(other, at(1, 21))
    state_of(other)["goals"]["flags"]["bridge_fixed"] = at(1, 20)
    give_out(other, two_stories(tick=at(1, 20)))
    silence(other)
    assert json.loads(other.step())["frame"]["night"]["changed"]["kind"] == "bridge_mended"


# ------------------------------------------------------------------------------ what is hidden


def hidden(s):
    """Ways to change what the game knows and the manager does not."""

    def other_story(state):
        state["social"].update(variant="v_flood")

    def forget(state):
        for who in CROWD:
            state["social"]["beliefs"][who].clear()

    def no_bonds(state):
        for person in state["social"]["bonds"]:
            state["social"]["bonds"][person] = [0] * len(state["social"]["bonds"][person])

    def cold_street(state):
        state["crowd"]["enthusiasm"] = [0] * len(state["crowd"]["enthusiasm"])

    def distrust(state):
        state["player"]["trust"] = [0] * len(state["player"]["trust"])

    return {
        "the truth is the flood": other_story,
        "the crowd remembers nothing": forget,
        "nobody is fond of anyone": no_bonds,
        "the street is cold": cold_street,
        "nobody trusts the manager": distrust,
    }


@pytest.mark.parametrize("name", list(hidden(None)))
def test_changing_what_is_hidden_changes_nothing_in_the_item(name):
    game = a_morning(two_stories())
    snapshot = game.snapshot_json()
    plain, changed = Game.from_snapshot_json(snapshot), Game.from_snapshot_json(snapshot)
    hidden(None)[name](state_of(changed))
    base = json.loads(plain.step())["frame"]["gazette"]
    other = json.loads(changed.step())["frame"]["gazette"]
    assert item_of(base)
    assert other["head"] == base["head"] and other["news"] == base["news"]


def test_the_item_follows_what_was_said_in_the_open_and_nothing_else():
    base = the_paper(a_morning(two_stories()))
    quiet = the_paper(a_morning(aloud_by(CROWD, LI_ER)))
    assert "two_accounts" in kinds(base) and "two_accounts" not in kinds(quiet)
    swapped = the_paper(a_morning({**aloud_by(CROWD[:3], DALANG), **aloud_by(CROWD[3:], LI_ER)}))
    item = item_of(swapped)
    assert "大郎" in item["text"]["zh"] and "李二" in item["text"]["zh"]


@pytest.mark.parametrize("variant", ["v_boat", "v_flood", "v_drunk"])
def test_the_same_things_said_in_the_open_make_the_same_paper_whichever_story_is_true(variant):
    base = the_paper(a_morning(two_stories(), variant="v_boat"))
    paper = the_paper(a_morning(two_stories(), variant=variant))
    assert paper["head"] == base["head"] and paper["news"] == base["news"]


def test_the_rows_of_the_audit_still_speak_for_the_paper_and_the_street_talk_is_the_public_part():
    assert projection.mark_of("gazette.news[].text.zh") == "known"
    assert projection.mark_of("gazette.talk[].text.zh") == "public"
