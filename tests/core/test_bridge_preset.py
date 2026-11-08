"""A named game at another seed and with another story true.

``api.preset("slice")`` is the game the opening page starts: seed 492, the boatman as the truth.
Given a ``seed`` and a ``variant`` it is the rules of the slice (the hearsay of the opening, no
heavy rain, the goods promised for a time) in a case of its own, which is what a new game from the
menu and "another truth" on the ending page ask for.
"""

from __future__ import annotations

import pytest
from bridge_helpers import run_to, state_of
from social_helpers import VARIANTS

from lantern_core.api import Game, preset
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge.world import CHOICE_CONFIG, PRESETS

SLICE = preset("slice")
RULES = {key: value for key, value in SLICE["config"].items() if key != "variant"}


def started(**asked) -> Game:
    named = preset("slice", **asked)
    return Game(named["seed"], named["scenario"], named["config"])


def test_without_a_seed_and_a_variant_it_is_the_first_game_of_the_name():
    assert preset("slice", seed=None, variant=None) == SLICE
    assert preset("slice") == {
        "scenario": "bridge",
        "seed": 492,
        "config": {
            "variant": "v_boat",
            "opening": "op_li_er_hearsay",
            "weather_heavy": 0,
            "goods": "promised",
        },
    }


def test_a_seed_alone_keeps_the_story_and_a_variant_alone_keeps_the_seed():
    assert preset("slice", seed=7) == {**SLICE, "seed": 7}
    flood = preset("slice", variant="v_flood")
    assert flood["seed"] == 492
    assert flood["config"] == {**SLICE["config"], "variant": "v_flood"}
    both = preset("slice", seed=0, variant="v_drunk")  # seed 0 is a seed
    assert both["seed"] == 0 and both["config"]["variant"] == "v_drunk"
    assert both["scenario"] == "bridge"


def test_every_other_key_of_the_rules_is_the_presets_whatever_the_seed_and_the_story():
    for variant in CHOICE_CONFIG["variant"]:
        for seed in (1, 2**31, 2**53 - 1):
            named = preset("slice", seed=seed, variant=variant)
            assert named["seed"] == seed
            assert {k: v for k, v in named["config"].items() if k != "variant"} == RULES
            assert named["config"]["variant"] == variant


def test_the_config_is_a_copy_each_time_and_the_table_is_never_written():
    first = preset("slice", seed=3, variant="v_flood")
    first["config"]["weather_heavy"] = 99
    first["config"]["variant"] = "v_boat"
    assert preset("slice", seed=3, variant="v_flood")["config"]["weather_heavy"] == 0
    assert PRESETS["slice"]["config"]["variant"] == "v_boat" and PRESETS["slice"]["seed"] == 492


@pytest.mark.parametrize("seed", [-1, 2**53, True, False, 1.5, "7", [7]])
def test_a_seed_that_is_not_an_int_of_the_core_is_refused(seed):
    with pytest.raises(ValueError, match="seed must be an int"):
        preset("slice", seed=seed)


@pytest.mark.parametrize("variant", ["", "v_nothing", "V_BOAT", 3, ["v_boat"]])
def test_a_variant_that_is_not_one_of_the_scripts_is_refused(variant):
    with pytest.raises(ValueError, match="variant must be one of"):
        preset("slice", variant=variant)


def test_a_name_that_is_not_one_is_refused_whatever_else_is_asked():
    with pytest.raises(ValueError, match="unknown bridge preset"):
        preset("nowhere", seed=1, variant="v_boat")


def test_the_variants_of_the_script_are_the_three_stories_the_page_knows():
    assert CHOICE_CONFIG["variant"] == ("v_boat", "v_flood", "v_drunk")
    assert CHOICE_CONFIG["variant"] == VARIANTS


@pytest.mark.parametrize("variant", CHOICE_CONFIG["variant"])
def test_the_story_that_is_asked_for_is_the_one_that_is_true(variant):
    for seed in (1, 2, 3):
        game = started(seed=seed, variant=variant)
        assert state_of(game)["social"]["variant"] == variant
        header = game.header()
        assert header["seed"] == seed and header["config"]["variant"] == variant


def test_a_story_that_the_seed_draws_anyway_is_the_game_without_the_key():
    # "the draw is taken all the same": forcing what the seed draws changes nothing
    seed = 5
    plain = Game(seed, "bridge", RULES)
    drawn = state_of(plain)["social"]["variant"]
    forced = started(seed=seed, variant=drawn)
    run_to(plain, 400)
    run_to(forced, 400)
    # the games are one game; only the config of the one that was given the key says it
    assert state_of(forced) == state_of(plain)
    assert forced.header()["config"] == {**plain.header()["config"], "variant": drawn}


def test_another_story_is_the_town_the_seed_makes_with_the_truth_changed():
    seed = 5
    plain = Game(seed, "bridge", RULES)
    drawn = state_of(plain)["social"]["variant"]
    other = next(v for v in VARIANTS if v != drawn)
    twin = started(seed=seed, variant=other)
    assert state_of(twin)["social"]["variant"] == other
    # the same people are where the same seed puts them: the weather, the cast and the opening
    assert state_of(twin)["weather"]["plan"] == state_of(plain)["weather"]["plan"]
    assert "heavy_rain" not in state_of(twin)["weather"]["plan"]
    assert twin.header()["config"]["opening"] == "op_li_er_hearsay"


@pytest.mark.parametrize("variant", CHOICE_CONFIG["variant"])
def test_a_game_of_another_seed_and_story_records_both_and_rebuilds(variant):
    named = preset("slice", seed=21, variant=variant)
    game = Game(named["seed"], named["scenario"], named["config"])
    recorder = Recorder(game)
    for _ in range(260):
        recorder.step("[]")
    recording = recorder.recording()
    assert recording["header"]["seed"] == 21
    assert recording["header"]["config"]["variant"] == variant
    assert recording["header"]["config"]["goods"] == "promised"
    rebuilt = rebuild(recording)
    assert rebuilt.hash() == game.hash() and rebuilt.tick == game.tick == 260
