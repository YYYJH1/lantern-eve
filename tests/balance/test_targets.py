"""What the balance run is meant to give, on a few seeds: the pace of the rumour, the call for
helpers, and how each way of playing ends. The targets are those of a run over many seeds, with room
for the few games that stand in for them."""

from __future__ import annotations

import balance

DAY = balance.TICKS_PER_DAY
SEEDS = list(range(1, 13))
FEW = list(range(1, 7))


def strings(rows):
    return [{key: str(value) for key, value in row.items()} for row in rows]


def test_the_clerks_story_takes_about_a_day_and_a_half_to_reach_most_of_the_town():
    _, series = balance.run_games(SEEDS, ["passive"], jobs=3, stop_tick=3 * DAY)
    hours = balance.reach_times(strings(series), "chain")
    assert hours["passive.t50"] >= 6, "half the town hears it in a morning"
    assert 24 <= hours["passive.t75"] <= 48, hours


def test_calling_alone_brings_few_and_one_persuaded_hub_brings_the_five_and_no_more():
    rows, _ = balance.run_games(SEEDS, ["rallier", "hubber"], jobs=3, stop_tick=2 * DAY)
    rallier = [r for r in rows if r["bot"] == "rallier"]
    hubber = [r for r in rows if r["bot"] == "hubber"]
    assert sum(r["helpers"] for r in rallier) <= 2 * len(rallier)
    assert sum(1 for r in rallier if r["crew_day"] != "") <= 1
    # the call is for the crew and no more: the hub's friends make up five, and in no game does the
    # call take a dozen (a family that has nobody yet is asked for in person)
    assert sum(1 for r in hubber if r["helpers"] >= 5) >= 9
    assert max(r["helpers"] for r in hubber) <= 6
    assert all(r["helpers_persuaded"] == 1 for r in hubber)


def test_each_way_of_playing_ends_the_way_it_should():
    """In the game that starts from the hearsay (the one the page starts), where the truth cannot be
    told before the fourth day, so the bamboo comes by setting the rumour straight on the first
    evening, and the statement is made at the hall on the fifth morning."""
    rows, _ = balance.run_games(
        FEW, ["investigator", "dealer", "passive"], jobs=3, config={"opening": "op_li_er_hearsay"}
    )

    def endings(bot):
        return [r["ending"] for r in rows if r["bot"] == bot]

    assert endings("investigator").count("ending_full") >= 5
    assert "ending_split" not in endings("investigator")
    assert endings("dealer").count("ending_barely") >= 5 and "ending_full" not in endings("dealer")
    assert set(endings("passive")) == {"ending_split"}


def test_lies_clear_nothing_and_are_caught():
    rows, _ = balance.run_games(FEW, ["liar"], jobs=3, stop_tick=3 * DAY)
    assert all(r["truth_told"] == 0 for r in rows)
    assert sum(1 for r in rows if r["lies_caught"] > 0) >= 4
    assert all(r["lies_told"] > r["lies_caught"] for r in rows)


def test_lies_are_believed_by_the_town_and_cost_the_liar_its_trust():
    rows, _ = balance.run_games(SEEDS, ["talker", "liar"], jobs=3, stop_tick=3 * DAY)
    talker = [r for r in rows if r["bot"] == "talker"]
    liar = [r for r in rows if r["bot"] == "liar"]
    n = len(liar)
    # the same plan with and without the lies: by the third day the town believes more falsehoods
    assert sum(r["false_share"] for r in liar) > sum(r["false_share"] for r in talker) + 10 * n
    assert sum(1 for r in liar if r["lies_caught"] > 0) >= n // 2
    assert sum(r["trust_mean"] for r in liar) < sum(r["trust_mean"] for r in talker) - 3 * n


def test_asking_alone_gets_a_festival_less_often_than_asking_and_promising():
    rows, _ = balance.run_games(SEEDS, ["talker"], jobs=3)
    walks = sum(1 for r in rows if r["ending"] != "ending_split")
    assert len(SEEDS) // 2 <= walks <= 3 * len(SEEDS) // 4, walks
