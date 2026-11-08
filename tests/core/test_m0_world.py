"""The m0 scenario: the map, the schedules, the walking and the meetings."""

import json

import pytest
from core_helpers import call

from lantern_core.api import Game
from lantern_core.world import m0
from lantern_core.world.grid import UNREACHABLE, Grid

DOORS = [m0.door(i) for i in range(12)]


def cells(game):
    return {n["id"]: (n["x"], n["y"]) for n in json.loads(game.snapshot_json())["world"]["npcs"]}


def near(a, b, radius):
    return max(abs(a[0] - b[0]), abs(a[1] - b[1])) <= radius


# ------------------------------------------------------------------------------ the map


def test_every_home_workplace_and_seat_is_walkable_and_reachable():
    grid = m0.M0World().grid
    key_cells = list(DOORS)
    key_cells += [c for cs in m0.WORK_CELLS.values() for c in cs]
    key_cells += list(m0.SEATS)
    assert len(set(key_cells)) == 36  # twelve doors, twelve work cells, twelve seats
    for x, y in key_cells:
        assert grid.walkable(grid.index(x, y)), (x, y)
    field = grid.field(grid.index(*DOORS[0]))
    for x, y in key_cells:
        assert field[grid.index(x, y)] < UNREACHABLE, (x, y)


def test_the_bridge_is_the_only_way_across_the_river():
    west, east = DOORS[0], DOORS[6]
    without_bridge = Grid(m0.ROWS, dict(m0.TERRAIN_COST, **{"=": 0}))
    field = without_bridge.field(without_bridge.index(*east))
    assert field[without_bridge.index(*west)] == UNREACHABLE
    with_bridge = m0.M0World().grid
    field = with_bridge.field(with_bridge.index(*east))
    assert field[with_bridge.index(*west)] < UNREACHABLE


def test_the_map_has_the_documented_size_and_features():
    rows = m0.ROWS
    assert (len(rows[0]), len(rows)) == (48, 32)
    glyphs = "".join(rows)
    assert glyphs.count("=") == 6 and glyphs.count("~") > 60 and glyphs.count("#") > 80


def test_the_walled_garden_is_walkable_but_cut_off():
    grid = m0.M0World().grid
    garden = grid.index(46, 29)
    assert grid.walkable(garden)
    assert grid.neighbours(garden) == ()
    assert grid.field(garden)[grid.index(*DOORS[0])] == UNREACHABLE


def test_a_field_is_the_cheapest_cost_and_a_step_follows_it_downhill():
    grid = m0.M0World().grid
    goal = grid.index(*m0.SEATS[0])
    field = grid.field(goal)
    here = grid.index(*DOORS[3])
    steps = 0
    while here != goal:
        before = field[here]
        nxt = grid.best_step(here, field)
        assert nxt in grid.neighbours(here)
        assert field[nxt] + grid.cost[nxt] == before
        here = nxt
        steps += 1
        assert steps < 200
    assert field[goal] == 0
    assert grid.best_step(goal, field) == goal


def test_equally_cheap_steps_resolve_north_first():
    grid = Grid(["...", "...", "..."], {".": 1})
    field = grid.field(grid.index(2, 2))
    assert grid.xy(grid.best_step(grid.index(0, 0), field)) == (1, 0)  # east before south
    field = grid.field(grid.index(0, 0))
    assert grid.xy(grid.best_step(grid.index(2, 2), field)) == (2, 1)  # north before west


def test_the_size_of_the_field_cache_changes_the_speed_and_nothing_else():
    rows = ["....", "....", "...."]
    small, big = Grid(rows, {".": 1}, max_fields=2), Grid(rows, {".": 1})
    for x, y in ((0, 0), (3, 0), (3, 2), (0, 0), (1, 1)):
        goal = small.index(x, y)
        assert small.field(goal) == big.field(goal)
        assert len(small._fields) <= 2
    assert len(big._fields) == 4


def test_a_blocked_goal_has_no_field():
    grid = m0.M0World().grid
    with pytest.raises(ValueError):
        grid.field(grid.index(22, 5))


def test_roads_are_cheaper_than_grass():
    grid = m0.M0World().grid
    start, goal = grid.index(4, 7), grid.index(19, 7)
    assert grid.field(goal)[start] == 15  # along the road, 1 for each of 15 cells entered
    assert grid.field(grid.index(4, 8))[grid.index(4, 6)] == 4  # onto the road (1), then grass (3)


# ------------------------------------------------------------------------------ walking


def test_everyone_starts_at_home():
    game = Game(1)
    assert [cells(game)[f"npc{i:02d}"] for i in range(12)] == DOORS


def test_the_day_goes_home_then_work_then_tea_then_home():
    game = Game(2, config={"ticks_per_hour": 300})  # a 3,600-tick day, so the walk home fits in it
    seen = {}
    for tick in range(3600):
        call(game)
        if tick + 1 in (290, 1400, 3000, 3600):
            seen[tick + 1] = cells(game)
    assert all(near(seen[290][f"npc{i:02d}"], DOORS[i], 2) for i in range(12))
    works = [m0._work_cell(i) for i in range(12)]
    assert all(near(seen[1400][f"npc{i:02d}"], works[i], 2) for i in range(12))
    teahouse = (29, 9, 35, 13)
    for i in range(12):
        x, y = seen[3000][f"npc{i:02d}"]
        assert teahouse[0] <= x <= teahouse[2] and teahouse[1] <= y <= teahouse[3], (i, x, y)
        assert near(seen[3000][f"npc{i:02d}"], m0.SEATS[i], 2)
    assert all(near(seen[3600][f"npc{i:02d}"], DOORS[i], 2) for i in range(12))


def test_an_npc_moves_at_most_one_cell_a_tick_and_only_onto_walkable_cells():
    game = Game(3)
    grid = m0.M0World().grid
    previous = cells(game)
    moved = 0
    for _ in range(2000):
        out = call(game)
        now = {n["id"]: (n["x"], n["y"]) for n in out["frame"]["npcs"]}
        for npc, (x, y) in now.items():
            assert grid.walkable(grid.index(x, y))
            px, py = previous[npc]
            assert abs(x - px) + abs(y - py) <= 1
            moved += (x, y) != (px, py)
        previous = now
    assert moved > 1000


def test_walking_is_seeded_by_the_core_rng_through_detours_and_fidgets():
    quiet = {"detour_per_mille": 0, "fidget_per_mille": 0}

    def trail(seed, config):
        game = Game(seed, config=config)
        return [call(game)["frame"]["npcs"] for _ in range(1200)]

    assert trail(1, quiet) == trail(2, quiet)  # no draw changes where anyone goes
    assert trail(1, {}) != trail(2, {})
    assert trail(1, {}) == trail(1, {})


def test_detours_stay_close_to_the_shortest_route():
    # With a high detour rate an NPC still gets to work, only later.
    game = Game(4, config={"detour_per_mille": 300, "ticks_per_hour": 300})
    for _ in range(900):
        call(game)
    works = [m0._work_cell(i) for i in range(12)]
    assert sum(near(cells(game)[f"npc{i:02d}"], works[i], 2) for i in range(12)) >= 10


# ------------------------------------------------------------------------------ meetings


def collect(game, ticks):
    events, positions = [], {}
    for _ in range(ticks):
        out = call(game)
        positions[out["tick"]] = {n["id"]: (n["x"], n["y"]) for n in out["frame"]["npcs"]}
        events += out["events"]
    return events, positions


def test_an_encounter_is_two_adjacent_npcs_and_the_cooldown_spaces_a_pair():
    game = Game(5)
    events, positions = collect(game, 2400)
    encounters = [e for e in events if e["kind"] == "encounter"]
    assert len(encounters) > 50
    last = {}
    for e in encounters:
        a, b = positions[e["tick"]][e["a"]], positions[e["tick"]][e["b"]]
        assert near(a, b, 1) and (e["x"], e["y"]) == a
        key = (e["a"], e["b"])
        assert e["a"] < e["b"]
        assert key not in last or e["tick"] - last[key] >= 600
        last[key] = e["tick"]


def test_no_npc_is_in_two_chats_at_once():
    game = Game(
        6, config={"encounter_cooldown": 100, "chatter_per_mille": 1000, "max_in_flight": 50}
    )
    for _ in range(2000):
        call(game)
        state = json.loads(game.snapshot_json())["world"]["interactions"]
        talkers = [n for it in state for n in (it["a"], it["b"])]
        assert len(talkers) == len(set(talkers))
        assert all(it["request"] in game.in_flight() for it in state)


def test_a_chat_ends_when_the_pair_parts_or_its_window_closes():
    game = Game(7, config={"chat_window": 50, "encounter_cooldown": 100, "chatter_per_mille": 1000})
    events, _ = collect(game, 2400)
    outcomes = {}
    for e in events:
        if e["kind"] == "interaction_end":
            outcomes[e["outcome"]] = outcomes.get(e["outcome"], 0) + 1
    assert outcomes.get("parted", 0) > 0 and outcomes.get("ended", 0) > 0


def test_the_chat_prompt_names_the_pair_and_the_place():
    game = Game(8)
    found = None
    for _ in range(3000):
        out = call(game)
        if out["requests"]:
            found = out["requests"][0]
            break
    assert found is not None
    user = found["messages"][-1]["content"]
    pair = next(c for c in found["valid_if"] if c["op"] == "adjacent")
    names = {n[0]: n[1] for n in m0.NPCS}
    assert names[pair["a"]] in user and names[pair["b"]] in user
    assert found["messages"][0]["role"] == "system"


# ------------------------------------------------------------------------------ determinism


def test_the_scenario_content_hash_does_not_depend_on_the_config_or_the_seed():
    a, b = Game(1).header(), Game(2, config={"chat_window": 10}).header()
    assert a["content_hash"] == b["content_hash"]


def test_a_longer_day_stretches_every_schedule():
    game = Game(9, config={"ticks_per_hour": 200})
    scene = json.loads(game.scene_json())
    assert scene["day_ticks"] == 2400
    for _ in range(2400):
        out = call(game)
    assert out["frame"]["time"] == {"day": 2, "hour": 6, "minute": 0}
