"""The weather of the bridge world: drawn from the seed, fixed from dawn to the next dawn."""

import pytest
from bridge_helpers import (
    CLEAR,
    CYCLE,
    HEAVY,
    LIGHT,
    assign_body,
    bridge,
    player,
    run_to,
    state_of,
    step,
)

from lantern_core.api import Game
from lantern_core.world.bridge import clock, weather


def plan_of(seed, **config):
    return state_of(Game(seed, "bridge", config or None))["weather"]["plan"]


def test_the_weather_of_every_day_is_drawn_when_the_game_is_made():
    state = state_of(bridge(5))
    section = state["weather"]
    assert section["day"] == 1 and len(section["plan"]) == 5
    assert set(section["plan"]) <= set(weather.KINDS)
    assert section["kind"] == section["plan"][0]
    assert set(section) == {"kind", "day", "plan"}


def test_the_plan_depends_on_the_seed_and_on_nothing_else():
    assert plan_of(7) == plan_of(7)
    assert len({tuple(plan_of(seed)) for seed in range(40)}) > 20
    # what people do does not move the weather: a game with errands has the same plan
    busy = Game(7, "bridge", {"dev_actions": 1})
    body = assign_body("a1", "li_da", kind="work", place="p_bridge", hours=2)
    step(busy, player(0, body))
    run_to(busy, 2 * CYCLE)
    assert state_of(busy)["weather"]["plan"][:5] == plan_of(7)
    quiet = Game(7, "bridge", {"dev_actions": 1})
    run_to(quiet, 2 * CYCLE)
    assert state_of(quiet)["weather"]["plan"] == state_of(busy)["weather"]["plan"]


def test_the_weights_of_the_config_set_how_often_each_kind_comes():
    counts = {kind: 0 for kind in weather.KINDS}
    for seed in range(120):
        for kind in plan_of(seed):
            counts[kind] += 1
    assert sum(counts.values()) == 600
    assert counts["clear"] > counts["light_rain"] > counts["heavy_rain"] > 60
    for config, kind in ((CLEAR, "clear"), (LIGHT, "light_rain"), (HEAVY, "heavy_rain")):
        assert set(plan_of(3, **config)) == {kind}


def test_the_weather_changes_at_dawn_and_at_no_other_time():
    seed = next(s for s in range(100) if len(set(plan_of(s))) >= 3)
    game = bridge(seed)
    plan = plan_of(seed)
    seen = []
    events = []

    def watch(out):
        seen.append((out["tick"], out["frame"]["weather"]))
        events.extend(
            (e["tick"], e["day"], e["weather"]) for e in out["events"] if e["kind"] == "weather"
        )

    run_to(game, 5 * CYCLE, watch)
    assert events == [(d * CYCLE, d + 1, plan[d]) for d in range(5)]
    for tick, shown in seen[:-1]:
        # the frame is drawn after the tick and shows the time and the weather of the next one
        assert shown == plan[(tick + 1) // CYCLE], tick
    changes = [t for (t, a), (_, b) in zip(seen, seen[1:], strict=False) if a != b]
    assert changes and all((t + 2) % CYCLE == 0 for t in changes)  # frames show the next tick


def test_a_day_past_the_plan_draws_its_weather_at_dawn():
    game = bridge(9, days=2)
    assert len(state_of(game)["weather"]["plan"]) == 2
    run_to(game, 4 * CYCLE)
    section = state_of(game)["weather"]
    assert section["day"] == 4 and len(section["plan"]) == 4
    assert section["kind"] == section["plan"][3]
    again = bridge(9, days=2)
    run_to(again, 4 * CYCLE)
    assert state_of(again)["weather"] == section  # the later draws are as deterministic


@pytest.mark.parametrize(
    "config",
    [
        {"weather_clear": 0, "weather_light": 0, "weather_heavy": 0},
        {"weather_clear": -1},
        {"weather_heavy": 1001},
        {"weather_light": 1.5},
        {"days": 0},
        {"days": 31},
        {"dev_actions": 2},
        {"move_day": 0},
        {"fidget_per_mille": 1001},
        {"rain": 1},
    ],
)
def test_a_bad_config_is_refused(config):
    with pytest.raises(ValueError):
        Game(1, "bridge", config)


def test_the_phase_of_the_weather_event_is_the_dawn_of_the_day():
    game = bridge(11)
    out = step(game)
    kinds = [(e["kind"], e["day"]) for e in out["events"]]
    assert kinds == [("dawn", 1), ("weather", 1)]
    assert clock.at(out["tick"]).phase == "day"
