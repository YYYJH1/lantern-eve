"""The rule-based managers play through the frame and the events alone, and play the same game
every time."""

from __future__ import annotations

import ast
import json
from pathlib import Path

import pytest

import balance
import bots
from lantern_core.api import Game, preset

BOTS_DIR = Path(bots.__file__).resolve().parent
TWO_DAYS = 2 * balance.TICKS_PER_DAY
SEED = 3


def test_there_is_a_bot_for_every_way_of_playing():
    expected = {"investigator", "dealer", "liar", "late_liar", "passive", "rallier"}
    assert expected <= set(bots.BOTS)
    assert all(cls.name == name for name, cls in bots.BOTS.items())


def test_an_unknown_bot_is_refused_with_the_names_of_the_others():
    with pytest.raises(ValueError, match="investigator"):
        bots.make("nobody", {"places": [], "layers": {"terrain": {"rows": [], "legend": []}}})


def test_a_bot_never_reaches_for_the_state_of_the_game():
    """The bots import nothing from the core and call nothing that hands out its state."""
    forbidden_names = {
        "_kernel",
        "snapshot_json",
        "scene_json",
        "from_snapshot_json",
        "ledger_json",
    }
    for path in sorted(BOTS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                assert all(alias.name.split(".")[0] != "lantern_core" for alias in node.names), path
            elif isinstance(node, ast.ImportFrom):
                assert (node.module or "").split(".")[0] != "lantern_core", path
            elif isinstance(node, ast.Attribute):
                assert node.attr not in forbidden_names, (path.name, node.attr)
            elif isinstance(node, ast.Name):
                assert node.id not in forbidden_names, (path.name, node.id)


@pytest.mark.parametrize("name", list(bots.BOTS))
def test_a_bot_plays_two_days_without_a_storm_of_refused_actions(name):
    log: list = []
    row, _ = balance.play_game(SEED, name, stop_tick=TWO_DAYS, log=log)
    bot = log.pop()[1]
    sent, refused = int(row["actions"]), int(row["rejected"])
    assert sent == bot.sent
    # people say no to a request now and then, and a bot does not ask the same thing over and over
    assert refused <= sent // 5 + 4, (sent, refused, bot.rejections)
    assert max(bot.rejections.values(), default=0) <= 25, bot.rejections
    assert int(row["ticks"]) == TWO_DAYS


@pytest.mark.parametrize("name", ["investigator", "liar"])
def test_a_game_with_a_bot_is_the_same_game_every_time(name):
    first, series = balance.play_game(5, name, stop_tick=TWO_DAYS)
    again, series_again = balance.play_game(5, name, stop_tick=TWO_DAYS)
    first.pop("ms_per_tick"), again.pop("ms_per_tick")
    assert first == again
    assert series == series_again


def test_the_passive_manager_sends_nothing_and_the_rallier_one_call():
    for name, actions in (("passive", 0), ("rallier", 1)):
        row, _ = balance.play_game(SEED, name, stop_tick=balance.TICKS_PER_DAY)
        assert int(row["actions"]) == actions


HEARSAY = {"opening": "op_li_er_hearsay"}  # the rumour is going round when the game starts


def test_the_investigator_mends_the_bridge_and_clears_the_truth_on_a_known_seed():
    """It sets the rumour straight at the teahouse on the first evening (the game starts from the
    hearsay, as the slice does, so the version of the rumour is in hand), gets the bamboo from the
    Li family on the next days, gathers what the days open and tells the truth at the hall on the
    fifth morning. No story can be told apart before the fourth day, so not before it either. On
    this seed the head of the Zhou family was not at the teahouse on the first evening and has not
    stopped accusing in public, and holds the accusation at 87: the whole proof refutes it, which
    eases what it weighs against the statement, so he accepts it and lets go of his share of the
    grudge, and the families are at peace."""
    row, _ = balance.play_game(4, "investigator", config=HEARSAY)
    assert row["ending"] == "ending_full"
    assert (row["bridge_fixed"], row["truth_told"], row["reconciled"]) == (1, 1, 1)
    assert int(row["lies_told"]) == 0 and 4 <= int(row["truth_day"]) <= 5


def test_without_the_hearsay_nothing_names_the_rumour_so_the_bamboo_waits_for_the_truth():
    """In the game that starts with no rumour going round, the manager holds no version of it to set
    straight on the first evening, Granny Li keeps the bamboo until the truth is told on the fifth
    day, and the bridge is lost to the rain of the last days: the lane behind the temple it is."""
    row, _ = balance.play_game(4, "investigator")
    assert row["ending"] == "ending_barely" and row["passage"] == "detour"
    assert (row["bridge_fixed"], row["truth_told"], row["reconciled"]) == (0, 1, 1)
    assert int(row["truth_day"]) == 5 and row["bamboo_day"] == ""


def test_the_investigator_follows_the_rumour_back_to_whoever_it_came_from():
    """On a seed where nobody it asks first claims to have seen it himself (on seed 4 the shop head
    does, and the entry then has no longer chain to follow)."""
    log: list = []
    balance.play_game(13, "investigator", stop_tick=3 * balance.TICKS_PER_DAY, log=log)
    bot = log.pop()[1]
    assert bot.asked_source >= 2
    # an entry of the notebook whose chain has a name for each hop and ends where someone says they
    # saw it (a chain that is not finished ends with nobody)
    chains = [e["chain"] for e in bot.o.notebook if len(e["chain"]) >= 3]
    assert any(chain[-1] is not None for chain in chains), chains


def test_the_dealer_gets_a_festival_that_walks_but_never_clears_the_truth():
    row, _ = balance.play_game(4, "dealer")
    assert row["ending"] == "ending_barely"
    assert (row["truth_told"], row["reconciled"]) == (0, 0)
    assert int(row["promises"]) > 0


def test_the_passive_manager_ends_with_the_families_apart():
    row, _ = balance.play_game(4, "passive")
    assert row["ending"] == "ending_split"
    assert int(row["helpers"]) == 0


def test_a_liar_is_caught_and_pays_for_it_in_trust():
    # in seed 4 what the liar makes up is the flood, which is so, and nobody holds anything
    # against a lie that is true; in seed 3 it makes up what is not
    row, _ = balance.play_game(3, "liar", stop_tick=3 * balance.TICKS_PER_DAY)
    talker, _ = balance.play_game(3, "talker", stop_tick=3 * balance.TICKS_PER_DAY)
    assert int(row["lies_told"]) > 0 and int(talker["lies_told"]) == 0
    assert int(row["lies_caught"]) > 0
    assert float(row["trust_mean"]) < float(talker["trust_mean"])


def test_the_investigator_mends_the_bridge_in_the_game_the_opening_page_starts():
    """The slice has the bamboo promised in batches of four and the bridge needs ten, so the
    manager has to ask Li Da for the next batch when the last has come. The investigator does, and
    mends the bridge, as it did when all the goods were carried at once."""
    game = preset("slice")
    log: list = []
    row, _ = balance.play_game(game["seed"], "investigator", days=5, config=game["config"], log=log)
    bot = log.pop()[1]
    assert row["ending"] == "ending_full" and row["passage"] == "mended"
    assert (row["bridge_fixed"], row["truth_told"], row["reconciled"]) == (1, 1, 1)
    batches = bot.promises("li_da", "bamboo")
    assert [(b["amount"], b["state"]) for b in batches] == [(4, "delivered")] * 2 + [
        (2, "delivered")
    ]  # four, four, and what the bridge was still short of
    # (the town is told what happened on the fourth evening and no longer on the second day, so
    # Li Da, who weighs the regard of the town, gives the first batch a day later than he did)
    assert int(row["bamboo_day"]) <= 5 and int(row["work_percent"]) == 100


def test_a_bot_that_never_gets_the_first_batch_has_nothing_to_ask_for_again():
    """The dealer never wins the bamboo (Li Da has not heard of a clearing it never makes), so the
    slice and the game that carries its goods at once end the same way for it."""
    game = preset("slice")
    there, _ = balance.play_game(game["seed"], "dealer", days=5, config=game["config"])
    here, _ = balance.play_game(game["seed"], "dealer", days=5)
    for row in (there, here):
        assert (row["ending"], row["passage"], row["bamboo_day"]) == ("ending_barely", "detour", "")


def test_the_bots_ask_for_the_next_batch_only_when_the_goods_come_in_batches():
    """In a game that carries the goods at once a bot that was told yes does not ask again, and in
    one that promises them it asks again once the last promise is kept, and not before."""
    sent = {"commitments": [], "hud": {"bridge": {}}}
    bot = bots.make("investigator", json.loads(Game(1, "bridge").scene_json()))

    class Seen:
        frame = sent

    bot.obs = Seen()  # type: ignore[assignment]
    bot.entrusted[("li_da", "material", "bamboo")] = "agreed"
    assert not bot.goods_wanted("li_da", "bamboo", "bamboo_delivered")  # sent at once
    sent["commitments"] = [{"by": "li_da", "item": "bamboo", "state": "promised"}]
    assert not bot.goods_wanted("li_da", "bamboo", "bamboo_delivered")  # on its way
    sent["commitments"] = [{"by": "li_da", "item": "bamboo", "state": "delivered"}]
    assert bot.goods_wanted("li_da", "bamboo", "bamboo_delivered")  # the next batch
    sent["commitments"] = [{"by": "li_da", "item": "bamboo", "state": "broken"}]
    assert bot.goods_wanted("li_da", "bamboo", "bamboo_delivered")  # or the one that failed
    bot.flags["bamboo_delivered"] = 1
    assert not bot.goods_wanted("li_da", "bamboo", "bamboo_delivered")  # the bridge has it all
