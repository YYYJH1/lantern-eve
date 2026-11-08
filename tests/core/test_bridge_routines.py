"""What people do in the bridge world: their routines, the curfew, and shelter from the rain."""

import pytest
from bridge_helpers import (
    CLEAR,
    CYCLE,
    PEOPLE,
    TOWN,
    assign_body,
    at,
    bridge,
    near,
    npc_of,
    person,
    player,
    run_to,
    seed_with_weather,
    stand,
    state_of,
    step,
    world_of,
)

from lantern_core.world.bridge import clock

OUTDOOR = {p.id for p in TOWN.places.values() if not p.indoor and p.cells}


def block_ends(p):
    """(start, end, act, place) of each routine block of ``p`` in ticks of the game day."""
    rows = p.routine
    out = []
    for i, (start, act, place) in enumerate(rows):
        end = rows[i + 1][0] if i + 1 < len(rows) else CYCLE + rows[0][0]
        out.append((start, end, act, place))
    return out


def expected(p, last_tick, act, place):
    """Where a person should be at the last tick of a block, and what they should be doing."""
    if last_tick % CYCLE >= clock.DAY_TICKS and not p.night_shift:
        return p.home, "sleep", "curfew"  # the night sends day people home whatever the routine
    return place, act, "routine"


@pytest.fixture(scope="module")
def five_days():
    """Five clear days: the states at the end of every routine block, and a sample of places. The
    night's thinking over is off (``reflect``): it sends people on detours of the routine, which
    ``test_bridge_reflection`` is about."""
    game = bridge(5, reflect=0, **CLEAR)
    samples: dict[int, list[tuple[str, int, int, str, str, str]]] = {}
    wanted = set()
    for p in PEOPLE:
        for day in range(5):
            for _, end, *_ in block_ends(p):
                wanted.add(day * CYCLE + end - 1)
    visited: dict[tuple[str, int], set[tuple[str, str]]] = {}
    end_tick = 5 * CYCLE + 40
    while game.tick < end_tick:
        step(game)
        tick = game.tick - 1
        npcs = state_of(game)["npcs"]["list"]
        if tick in wanted:
            samples[tick] = [
                (n["id"], n["x"], n["y"], n["act"], n["mode"], n["place"]) for n in npcs
            ]
        if tick % 5 == 0:
            for n in npcs:
                if near(n, tuple(n["goal"])):
                    visited.setdefault((n["id"], tick // CYCLE), set()).add((n["place"], n["act"]))
    return samples, visited


# ------------------------------------------------------------------------------ the routines


def test_everyone_starts_at_home_where_the_last_entry_of_the_routine_puts_them():
    game = bridge(1)
    for p in PEOPLE:
        n = npc_of(game, p.id)
        last = p.routine[-1]
        assert (n["x"], n["y"]) == stand(p.id, last[2]) and last[2] == p.home
        assert n["act"] == last[1] and n["carry"] is None and n["shelter"] == ""
        assert n["mode"] == "routine"


def test_every_person_is_where_the_routine_says_at_the_end_of_every_block_of_five_days(five_days):
    samples, _ = five_days
    checked = 0
    for p in PEOPLE:
        for day in range(5):
            for _, end, act, place in block_ends(p):
                tick = day * CYCLE + end - 1
                where, what, mode = expected(p, tick, act, place)
                row = next(r for r in samples[tick] if r[0] == p.id)
                _, x, y, got_act, got_mode, got_place = row
                assert (got_place, got_act, got_mode) == (where, what, mode), (
                    p.id,
                    day,
                    act,
                    place,
                )
                assert near({"x": x, "y": y}, stand(p.id, where)), (p.id, day, act, place, (x, y))
                checked += 1
    assert checked == 5 * sum(len(p.routine) for p in PEOPLE) == 5 * 153


def test_everyone_but_the_night_shift_sleeps_at_home_when_the_night_ends(five_days):
    samples, _ = five_days
    for day in range(5):
        # the tick before each person's first entry of the next morning is the end of their night
        for p in PEOPLE:
            tick = (day + 1) * CYCLE + p.routine[0][0] - 1
            if tick not in samples:
                continue
            row = next(r for r in samples[tick] if r[0] == p.id)
            assert row[5] == p.home
            assert row[3] == ("rest" if p.id == "gengfu" else "sleep"), p.id
            assert near({"x": row[1], "y": row[2]}, stand(p.id, p.home)), (p.id, day)


def test_in_a_day_everyone_visits_every_place_of_their_routine(five_days):
    _, visited = five_days
    for p in PEOPLE:
        for day in range(5):
            wanted = {(place, act) for start, act, place in p.routine if start < clock.DAY_TICKS}
            seen = visited[(p.id, day)]
            assert wanted <= seen, (p.id, day, sorted(wanted - seen))
            assert (p.home, "sleep") in seen or p.night_shift


def test_the_town_does_not_move_as_one_body():
    starts = {p.routine[0][0] for p in PEOPLE}
    assert len(starts) >= 5 and min(starts) == 0 and max(starts) < 30
    # the entries of the night are not late: a night tick is four minutes
    assert {s for p in PEOPLE for s, *_ in p.routine if s >= clock.DAY_TICKS} <= set(
        range(clock.DAY_TICKS, CYCLE, clock.NIGHT_TICKS_PER_HOUR)
    )


def test_the_routines_fill_the_places_in_the_evening_with_the_teahouse_the_fullest():
    game = bridge(2, **CLEAR)
    run_to(game, at(1, 18, 30))
    crowd = {}
    for n in state_of(game)["npcs"]["list"]:
        if near(n, tuple(n["goal"])):
            crowd[n["place"]] = crowd.get(n["place"], 0) + 1
    fullest = max(crowd, key=lambda k: (crowd[k], k))
    assert fullest == "p_teahouse" and crowd["p_teahouse"] >= 6


def test_a_person_walks_one_cell_at_a_time_and_only_on_open_ground():
    game = bridge(4, **CLEAR)
    grid = TOWN.grid
    last = {n["id"]: (n["x"], n["y"]) for n in state_of(game)["npcs"]["list"]}
    moved = 0
    for _ in range(1800):
        step(game)
        for n in state_of(game)["npcs"]["list"]:
            here = (n["x"], n["y"])
            assert grid.walkable(grid.index(*here)), (n["id"], here)
            gap = abs(here[0] - last[n["id"]][0]) + abs(here[1] - last[n["id"]][1])
            assert gap <= 1, (n["id"], last[n["id"]], here)
            moved += gap
            last[n["id"]] = here
    assert moved > 2000


# ------------------------------------------------------------------------------ the curfew


def test_at_night_the_tavern_empties_and_the_drinker_walks_home():
    game = bridge(6, **CLEAR)
    run_to(game, at(1, 20, 59) + 1)
    dalang = npc_of(game, "zhou_dalang")
    assert (dalang["place"], dalang["act"], dalang["mode"]) == ("p_tavern", "drink", "routine")
    run_to(game, at(1, 21, 10))
    dalang = npc_of(game, "zhou_dalang")
    assert (dalang["place"], dalang["act"], dalang["mode"]) == ("p_zhou_house", "sleep", "curfew")
    out = step(game)
    assert next(n for n in out["frame"]["npcs"] if n["id"] == "zhou_dalang")["activity"] == "walk"
    run_to(game, at(1, 21) + 60)
    assert near(npc_of(game, "zhou_dalang"), stand("zhou_dalang", "p_zhou_house"))
    out = step(game)
    row = next(n for n in out["frame"]["npcs"] if n["id"] == "zhou_dalang")
    assert (row["activity"], row["status"]) == ("sleep", "sleep")


def test_the_night_shift_keeps_working_while_the_town_sleeps():
    game = bridge(6, **CLEAR)
    run_to(game, at(1, 22, 30))
    modes = {n["id"]: n["mode"] for n in state_of(game)["npcs"]["list"]}
    assert {i for i, m in modes.items() if m == "routine"} == {"xiao_man", "gengfu"}
    assert set(modes.values()) == {"routine", "curfew"}
    assert npc_of(game, "xiao_man")["act"] == "fish" and npc_of(game, "gengfu")["act"] == "patrol"
    assert near(npc_of(game, "xiao_man"), stand("xiao_man", "p_riverbank"))
    assert near(npc_of(game, "gengfu"), stand("gengfu", "p_bridge"), 1)
    run_to(game, at(1, 2, 30))  # past midnight the watchman has moved on to the market
    assert npc_of(game, "gengfu")["place"] == "p_market"
    assert person("gengfu").night_shift and person("xiao_man").night_shift


def test_an_errand_waits_out_the_night_and_the_curfew_sends_the_worker_home():
    game = Game_with_errands()
    run_to(game, at(1, 20, 55))
    worker = npc_of(game, "zhadeng_shifu")
    assert (worker["mode"], worker["place"], worker["act"]) == ("task", "p_bridge", "work")
    tasks = state_of(game)["tasks"]
    before = tasks["queue"][0]["progress"]
    assert before > 0 and tasks["jobs"]["zhadeng_shifu"]["place"] == "p_bridge"
    run_to(game, at(1, 21) + 90)
    worker = npc_of(game, "zhadeng_shifu")
    assert (worker["mode"], worker["place"], worker["act"]) == ("curfew", "p_workshop", "sleep")
    assert near(worker, stand("zhadeng_shifu", "p_workshop"))
    tasks = state_of(game)["tasks"]
    assert tasks["jobs"] == {} and tasks["queue"][0]["progress"] >= before
    frozen = tasks["queue"][0]["progress"]
    run_to(game, at(1, 5, 59))  # the night ends, the day after is day 2
    assert state_of(game)["tasks"]["queue"][0]["progress"] == frozen
    run_to(game, at(2, 12))
    assert state_of(game)["tasks"]["queue"] == []
    assert [t["status"] for t in state_of(game)["tasks"]["done"]] == ["done"]


def Game_with_errands():  # noqa: N802 - a named setup, used like a fixture
    game = bridge(6, dev_actions=1, **CLEAR)
    body = assign_body("late", "zhadeng_shifu", kind="work", place="p_bridge", hours=5)
    run_to(game, at(1, 19))
    step(game, player(0, body))
    return game


# ------------------------------------------------------------------------------ rain


def test_light_rain_changes_no_plans_but_puts_umbrellas_over_those_in_the_open():
    game = bridge(seed_with_weather(["light_rain"]))
    run_to(game, at(1, 10, 30))
    out = step(game)
    assert out["frame"]["weather"] == "light_rain"
    assert {n["mode"] for n in state_of(game)["npcs"]["list"]} == {"routine"}
    rows = {n["id"]: n for n in out["frame"]["npcs"]}
    assert rows["old_he"]["activity"] == "ferry" and rows["old_he"]["status"] == "umbrella"
    assert "status" not in rows["cha_laoban"]  # under her own roof
    assert rows["cha_laoban"]["activity"] == "work"


def test_heavy_rain_sends_those_who_would_be_in_the_open_under_the_nearest_roof():
    game = bridge(seed_with_weather(["heavy_rain", "clear"]))
    run_to(game, at(1, 10, 30))
    out = step(game)
    assert out["frame"]["weather"] == "heavy_rain"
    sheltering = []
    for p in PEOPLE:
        n = npc_of(game, p.id)
        intended = p.entry_at(clock.at(game.tick - 1).cycle_tick)[2]
        if intended in OUTDOOR:
            assert n["mode"] == "shelter", (p.id, intended)
            assert n["act"] == "shelter" and TOWN.places[n["place"]].indoor
            assert n["shelter"] == n["place"]
            assert near(n, stand(p.id, n["place"])), p.id
            sheltering.append(p.id)
        else:
            assert n["mode"] == "routine" and n["place"] == intended, p.id
    assert {"old_he", "zhou_zhanggui", "zhou_huoji", "zhangfang", "xiao_man"} <= set(sheltering)
    rows = {n["id"]: n for n in out["frame"]["npcs"]}
    assert rows["old_he"]["activity"] == "shelter" and "status" not in rows["old_he"]
    # the boatman, at the ferry, went to the nearest roof, which is his own
    assert npc_of(game, "old_he")["place"] == "p_he_home"


def test_when_the_rain_stops_the_roof_is_forgotten_and_the_routine_goes_on():
    game = bridge(seed_with_weather(["heavy_rain", "clear"]))
    run_to(game, at(1, 10, 30))
    assert npc_of(game, "old_he")["shelter"] == "p_he_home"
    run_to(game, at(2, 10, 30))
    boatman = npc_of(game, "old_he")
    assert (boatman["mode"], boatman["place"], boatman["act"]) == ("routine", "p_ferry", "ferry")
    assert boatman["shelter"] == ""
    assert near(boatman, stand("old_he", "p_ferry"))


def test_the_roof_is_the_one_with_the_cheapest_way_to_its_door():
    grid = TOWN.grid
    for y in range(0, grid.height, 3):
        for x in range(0, grid.width, 3):
            if not grid.walkable(grid.index(x, y)):
                continue
            here = grid.index(x, y)
            chosen = TOWN.nearest_shelter(x, y)
            costs = {
                s: grid.field(grid.index(*TOWN.places[s].cells[0]))[here] for s in TOWN.shelters
            }
            assert costs[chosen] == min(costs.values()), (x, y)
            first = next(s for s in TOWN.shelters if costs[s] == min(costs.values()))
            assert chosen == first  # ties go to the place that comes first in the map file


def test_an_errand_in_the_open_stands_still_in_a_heavy_rain_and_goes_on_when_it_clears():
    game = bridge(seed_with_weather(["heavy_rain", "clear"]), dev_actions=1)
    run_to(game, at(1, 8))
    body = assign_body("rain", "mujiang", kind="work", place="p_bridge", hours=1)
    step(game, player(0, body))
    run_to(game, at(1, 12))
    assert npc_of(game, "mujiang")["mode"] == "shelter"
    assert state_of(game)["tasks"]["queue"][0]["progress"] == 0
    assert state_of(game)["tasks"]["worked"] == {}
    run_to(game, at(2, 12))
    assert state_of(game)["tasks"]["queue"] == []
    assert state_of(game)["tasks"]["worked"] == {"p_bridge": clock.DAY_TICKS_PER_HOUR}


# ------------------------------------------------------------------------------ the barrier


def test_opening_the_lane_barrier_gives_a_grid_with_a_way_round_and_changes_nothing_else():
    closed = TOWN.grid
    opened = TOWN.grid_with_open(("lane_barrier",))
    assert TOWN.grid_with_open(()) is closed and TOWN.grid_with_open(("lane_barrier",)) is opened
    barrier = TOWN.data["barriers"][0]
    for x, y in barrier["cells"]:
        assert not closed.walkable(closed.index(x, y)) and opened.walkable(opened.index(x, y))
    assert closed.rows != opened.rows and len(closed.rows) == len(opened.rows)
    # from the end of the lane on the east road to the east end of the main street
    south, north = TOWN.places["p_temple_lane"].cells[0], (55, 17)
    before = closed.field(closed.index(*north))[closed.index(*south)]
    after = opened.field(opened.index(*north))[opened.index(*south)]
    assert after < before
    # everything else is the same: a path that does not use the lane costs the same
    a, b = stand("li_da", "p_li_house"), stand("li_da", "p_bridge")
    assert (
        closed.field(closed.index(*b))[closed.index(*a)]
        == opened.field(opened.index(*b))[opened.index(*a)]
    )


def test_people_walk_on_the_closed_town_until_a_package_says_otherwise():
    game = bridge(1)
    assert world_of(game).walking_grid(state_of(game)) is TOWN.grid
