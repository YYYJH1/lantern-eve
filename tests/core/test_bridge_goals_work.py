"""The work of the festival: hours at the bridge, the materials, the lane and its lanterns."""

from bridge_helpers import CAST, at, near, stand, world_of
from goals_helpers import (
    DT,
    HELPERS,
    Hand,
    body,
    crew_of_five,
    dev,
    hand,
    join_all,
    rally,
    set_sky,
    sim_of,
)

from lantern_core.world.bridge import goals, goals_work

BRIDGE_TICKS = goals_work.BRIDGE_TICKS
assert BRIDGE_TICKS == 10 * DT


def bridge_work(h: Hand):
    """The work errands at the bridge that are not finished."""
    return [
        t
        for t in h.state["tasks"]["queue"]
        if t["kind"] == "work" and t["steps"][-1][1] == "p_bridge"
    ]


def work_ticks(h: Hand) -> int:
    return h.goals["work"]["ticks"]


def ready_crew(h: Hand, people=None):
    join_all(h, people or crew_of_five())
    assert goals.crew_ready(world_of(h.game), h.state)


def deliver_materials(h: Hand):
    out = h.send(dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui"))
    assert h.acks(out) == [("applied", None)] * 2


# ------------------------------------------------------------------------------ hours


def test_a_ready_crew_works_an_hour_each_at_the_bridge_on_the_mornings_of_day_3_and_4():
    h = hand(3)
    ready_crew(h)
    h.run_to(at(3, 7, 59))
    assert bridge_work(h) == [] and work_ticks(h) == 0  # nobody is asked before the morning
    h.run_to(at(3, 8, 30))
    asked = {t["npc"] for t in bridge_work(h)}
    assert asked == set(crew_of_five())
    h.run_to(at(3, 14))
    assert bridge_work(h) == []
    assert work_ticks(h) == 5 * DT == h.state["tasks"]["worked"]["p_bridge"]
    assert h.goals["metrics"]["work_progress"] == 50
    bridge = h.frame["hud"]["bridge"]
    assert (bridge["hours"], bridge["hours_need"], bridge["percent"]) == (5, 10, 50)
    assert bridge["state"] == "repairing"
    h.run_to(at(4, 14))
    assert work_ticks(h) == BRIDGE_TICKS == h.state["tasks"]["worked"]["p_bridge"]
    assert h.goals["metrics"]["work_progress"] == 100 and "g_labor" in h.goals["done"]
    h.run_to(at(5, 14))
    assert work_ticks(h) == BRIDGE_TICKS  # the bridge does not need more, and nobody is asked
    assert h.state["tasks"]["worked"]["p_bridge"] == BRIDGE_TICKS
    for day in (1, 2, 3, 4):  # who was asked when
        assert all(e["tick"] >= at(3, 8) for e in h.kinds("task_start") if e["goal"] == "work"), day


def test_the_crew_is_seen_at_work_on_the_bridge_in_the_morning():
    h = hand(3)
    ready_crew(h)
    h.run_to(at(3, 9, 20))
    world = world_of(h.game)
    at_work = []
    for person in crew_of_five():
        npc = h.state["npcs"]["list"][CAST.index[person]]
        row = next(n for n in h.frame["npcs"] if n["id"] == person)
        if near(npc, stand(person, "p_bridge")) and npc["mode"] == "task":
            at_work.append(person)
            assert row["activity"] == "work"
    assert len(at_work) >= 3
    assert world.town.places["p_bridge"].indoor is False


def test_no_one_works_in_a_heavy_rain_and_the_day_goes_by_without_orders():
    h = hand(3)
    set_sky(h, "clear", "clear", "heavy_rain", "clear", "clear")
    ready_crew(h)
    h.run_to(at(3, 14))
    assert bridge_work(h) == [] and work_ticks(h) == 0
    assert h.state["tasks"]["worked"].get("p_bridge", 0) == 0
    assert [e for e in h.kinds("task_start") if e["goal"] == "work"] == []
    h.run_to(at(4, 14))
    assert work_ticks(h) == 5 * DT  # one day's work is half of what the bridge needs
    assert "g_labor" not in h.goals["done"]
    assert h.frame["hud"]["bridge"]["state"] == "repairing"
    h.run_to(at(5, 14))
    assert work_ticks(h) == 5 * DT  # and the day after the deadline does not make it up
    assert "g_labor" not in h.goals["done"] and bridge_work(h) == []


def test_more_helpers_make_up_for_a_day_of_rain():
    h = hand(3)
    set_sky(h, "clear", "clear", "heavy_rain", "clear", "clear")
    extra = ("zhou_zhanggui", "zhou_huoji", "mujiang", "old_he", "zhadeng_shifu")
    ready_crew(h, (*crew_of_five(), *extra))
    assert len(goals.joined(h.state)) == 10
    h.run_to(at(4, 14))
    assert work_ticks(h) == BRIDGE_TICKS and "g_labor" in h.goals["done"]
    assert h.goals["done"]["g_labor"] < at(4, 12)  # on the morning of the day after the rain


def test_five_helpers_need_the_third_and_the_fourth_morning_and_no_morning_is_to_spare():
    h = hand(3)
    ready_crew(h)
    deliver_materials(h)
    h.run_to(at(3, 12, 30))
    assert work_ticks(h) == 5 * DT and "bridge_fixed" not in h.goals["flags"]
    assert h.frame["hud"]["bridge"]["hours"] == 5
    h.run_to(at(4, 12, 30))
    assert "bridge_fixed" in h.goals["flags"]
    assert clock_day(h.goals["flags"]["bridge_fixed"]) == 4  # the second morning does the rest
    assert h.goals["flags"]["bridge_fixed"] < at(4, 11)


def test_a_rainy_morning_costs_one_of_the_two_and_the_deadline_is_missed():
    for rainy in (3, 4):
        h = hand(3)
        sky = ["clear"] * 5
        sky[rainy - 1] = "heavy_rain"
        set_sky(h, *sky)
        ready_crew(h)
        deliver_materials(h)
        h.run_to(at(5, 14))
        assert work_ticks(h) == 5 * DT, rainy  # five helpers, one morning
        assert "bridge_fixed" not in h.goals["flags"] and "g_labor" not in h.goals["done"]
        assert h.frame["hud"]["bridge"]["state"] == "repairing"
        assert h.goals["work"]["ticks"] < BRIDGE_TICKS


def test_ten_helpers_do_it_in_the_one_morning_and_so_can_lose_the_other_to_the_rain():
    h = hand(3)
    set_sky(h, "clear", "clear", "heavy_rain", "clear", "clear")
    extra = ("zhou_zhanggui", "zhou_huoji", "mujiang", "old_he", "zhadeng_shifu")
    ready_crew(h, (*crew_of_five(), *extra))
    deliver_materials(h)
    h.run_to(at(4, 12))
    assert "bridge_fixed" in h.goals["flags"] and h.goals["flags"]["bridge_fixed"] < at(4, 11)


def test_a_helper_at_the_lane_is_not_asked_to_the_bridge_the_same_morning():
    h = hand(3)
    ready_crew(h)
    h.run_to(at(3, 6, 30))
    h.send(body("assign", npc="li_da", task={"kind": "work", "place": "p_temple_lane", "hours": 3}))
    (task,) = [t for t in h.state["tasks"]["queue"] if t["npc"] == "li_da"]
    h.goals["lane"]["lamps"]["li_da"] = task["id"]  # asked to hang lamps, and still at it
    h.run_to(at(3, 9))
    asked = {t["npc"] for t in bridge_work(h)}
    assert asked == set(crew_of_five()) - {"li_da"}
    assert "li_da" not in h.goals["work"]["ordered"]


def test_a_helper_with_an_hour_still_to_work_at_the_bridge_is_not_asked_to_the_lane():
    h = hand(3)
    ready_crew(h)
    h.run_to(at(3, 8, 5))
    busy = {t["npc"] for t in bridge_work(h)}
    assert busy == set(crew_of_five())
    h.goals["flags"]["lane_opened"] = h.game.tick
    g = h.goals
    sim = sim_of(h)
    goals_work._lamp_orders(sim, g)
    assert g["lane"]["lamps"] == {}  # all of them are at the bridge for the hour


def clock_day(tick: int) -> int:
    from lantern_core.world.bridge import clock

    return clock.at(tick).day


def test_a_light_rain_does_not_stop_the_work():
    h = hand(3)
    set_sky(h, "clear", "clear", "light_rain", "clear", "clear")
    ready_crew(h)
    h.run_to(at(3, 14))
    assert work_ticks(h) == 5 * DT


def test_without_a_full_crew_nobody_is_asked_to_work():
    h = hand(3)
    join_all(h, ("li_da", "li_er", "li_xiaomei", "li_laotai", "cha_laoban"))  # no Zhou
    h.run_to(at(4, 9))
    assert work_ticks(h) == 0 and [e for e in h.kinds("task_start") if e["goal"] == "work"] == []
    # a Zhou who comes on the morning of day 4 completes the crew, and the crew starts at once
    join_all(h, ("zhou_dalang",))
    h.run_to(at(4, 15))
    assert work_ticks(h) == 6 * DT


def test_a_helper_who_joins_during_the_morning_is_asked_that_morning_and_not_twice():
    h = hand(3)
    ready_crew(h)
    h.run_to(at(3, 10))
    join_all(h, ("old_he",))
    h.run_to(at(3, 14))
    assert work_ticks(h) == 6 * DT
    starts = [e["npc"] for e in h.kinds("task_start") if e["goal"] == "work"]
    assert sorted(starts) == sorted([*crew_of_five(), "old_he"])
    assert h.goals["work"]["ordered"]["old_he"] == 3


def test_work_at_the_bridge_counts_whoever_does_it_but_only_from_day_3():
    h = hand(3)
    h.run_to(at(1, 9))
    h.send(body("assign", npc="mujiang", task={"kind": "work", "place": "p_bridge", "hours": 2}))
    h.run_to(at(2, 20))
    assert h.state["tasks"]["worked"]["p_bridge"] == 2 * DT and work_ticks(h) == 0
    h.run_to(at(3, 9))
    h.send(body("assign", npc="gengfu", task={"kind": "work", "place": "p_bridge", "hours": 2}))
    h.run_to(at(3, 20))
    assert work_ticks(h) == 2 * DT and h.goals["metrics"]["work_progress"] == 20


def test_work_after_the_deadline_does_not_count():
    h = hand(3)
    h.run_to(at(4, 16))
    h.send(body("assign", npc="gengfu", task={"kind": "work", "place": "p_bridge", "hours": 3}))
    h.run_to(at(4, 20, 30))
    done = h.state["tasks"]["worked"]["p_bridge"]
    assert done == 3 * DT
    assert 0 < work_ticks(h) < done
    assert work_ticks(h) <= goals_work.labor_deadline() - at(4, 16)


# ------------------------------------------------------------------------------ materials


def test_the_work_is_done_but_the_bridge_is_not_mended_until_both_materials_lie_at_the_bridge():
    h = hand(3)
    ready_crew(h)
    h.run_to(at(4, 14))
    assert "g_labor" in h.goals["done"] and "bridge_fixed" not in h.goals["flags"]
    assert h.frame["hud"]["bridge"]["lacking"] == "bamboo"
    assert h.frame["hud"]["bridge"]["state"] == "repairing"
    out = h.send(dev("material", npc="li_da"))
    assert h.acks(out) == [("applied", None)]
    h.run_to(h.game.tick + 600)
    assert "bamboo_delivered" in h.goals["flags"] and "bridge_fixed" not in h.goals["flags"]
    assert h.frame["hud"]["bridge"]["lacking"] == "timber"
    assert "g_materials" not in h.goals["done"]
    h.send(dev("material", npc="zhou_zhanggui"))
    start = h.game.tick
    h.run_to(start + 600)
    flags = h.goals["flags"]
    assert {"timber_delivered", "bridge_fixed"} <= set(flags)
    assert flags["bridge_fixed"] == flags["timber_delivered"] > start  # at the tick it arrived
    assert {"g_materials", "g_repair"} <= set(h.goals["done"])
    bridge = h.frame["hud"]["bridge"]
    assert bridge["state"] == "mended" and "lacking" not in bridge


def test_materials_alone_do_not_mend_the_bridge_and_the_hours_come_after_them():
    h = hand(3)
    deliver_materials(h)
    h.run_to(at(1, 12))
    assert {"bamboo_delivered", "timber_delivered", "g_materials"} <= set(h.goals["flags"]) | set(
        h.goals["done"]
    )
    assert "bridge_fixed" not in h.goals["flags"]
    stock = h.state["tasks"]["stock"]
    assert stock["p_bridge"] == {"bamboo": 10, "timber": 8}
    assert stock["p_li_house"]["bamboo"] == 20 and stock["p_zhou_house"]["timber"] == 16
    ready_crew(h)
    h.run_to(at(4, 14))
    assert h.goals["flags"]["bridge_fixed"] >= at(4, 8)


def test_only_li_da_and_zhou_zhanggui_bring_materials_and_each_delivery_is_agreed_once():
    h = hand(3)
    for npc in ("li_laotai", "zhou_huoji", "mujiang", "miaozhu"):
        assert h.acks(h.send(dev("material", npc=npc))) == [("rejected", "no_change")]
    assert h.kinds("agreed") == []
    assert h.acks(h.send(dev("material", npc="li_da"))) == [("applied", None)]
    assert h.acks(h.send(dev("material", npc="li_da"))) == [("rejected", "no_change")]  # on the way
    assert [(e["npc"], e["what"]) for e in h.kinds("agreed")] == [("li_da", "bamboo")]
    queue = [t for t in h.state["tasks"]["queue"] if t["npc"] == "li_da"]
    assert len(queue) == 1 and queue[0]["kind"] == "carry"
    h.run_to(at(1, 12))
    assert h.acks(h.send(dev("material", npc="li_da"))) == [("rejected", "no_change")]  # done
    assert [t["kind"] for t in h.state["tasks"]["done"] if t["npc"] == "li_da"] == ["carry"]


def test_a_delivery_that_fails_can_be_agreed_again():
    h = hand(3)
    h.state["tasks"]["stock"]["p_li_house"]["bamboo"] = 3  # less than the bridge needs
    h.send(dev("material", npc="li_da"))
    h.run_to(at(1, 12))
    failed = [t for t in h.state["tasks"]["done"] if t["npc"] == "li_da"]
    assert [(t["status"], t["reason"]) for t in failed] == [("failed", "no_stock")]
    assert "bamboo_delivered" not in h.goals["flags"]
    h.state["tasks"]["stock"]["p_li_house"]["bamboo"] = 30
    assert h.acks(h.send(dev("material", npc="li_da"))) == [("applied", None)]
    h.run_to(at(1, 20))
    assert "bamboo_delivered" in h.goals["flags"]


def test_the_materials_count_whoever_brought_them():
    h = hand(3)
    h.run_to(at(1, 7))
    h.send(
        body(
            "assign",
            npc="zhou_huoji",
            task={
                "kind": "carry",
                "item": "timber",
                "qty": 8,
                "src": "p_zhou_house",
                "dst": "p_bridge",
            },
        )
    )
    h.run_to(at(1, 13))
    assert "timber_delivered" in h.goals["flags"] and "bamboo_delivered" not in h.goals["flags"]
    assert h.goals["supply"] == {}  # nobody agreed to it


# ------------------------------------------------------------------------------ the detour


def open_cost(h):
    """The cost of walking between the two halves of the lane, with the barrier shut and open."""
    world = world_of(h.game)
    north, south = (55, 19), (55, 22)
    closed = world.town.grid
    opened = world.town.grid_with_open(("lane_barrier",))
    out = []
    for grid in (closed, opened):
        field = grid.field(grid.index(*south))
        out.append(field[grid.index(*north)])
    return out, world.walking_grid(h.state)


def test_the_barrier_opens_when_the_temple_keeper_has_worked_his_hour_at_the_lane():
    h = hand(3)
    (shut, wide), grid = open_cost(h)
    assert wide < shut and grid is world_of(h.game).town.grid  # closed town to begin with
    h.run_to(at(1, 8))
    assert h.acks(h.send(dev("lane", npc="miaozhu"))) == [("applied", None)]
    assert h.acks(h.send(dev("lane", npc="miaozhu"))) == [("rejected", "no_change")]  # under way
    assert [(e["npc"], e["what"]) for e in h.kinds("agreed")] == [("miaozhu", "lane")]
    for _ in range(40):  # while he walks there, the lane is shut
        h.send()
    assert "lane_opened" not in h.goals["flags"]
    assert world_of(h.game).walking_grid(h.state) is world_of(h.game).town.grid
    h.run_to(at(1, 12))
    opened_at = h.goals["flags"]["lane_opened"]
    assert at(1, 8) + DT < opened_at < at(1, 12)
    (_, _), grid = open_cost(h)
    assert grid is world_of(h.game).town.grid_with_open(("lane_barrier",))
    assert [e["flag"] for e in h.kinds("flag")] == ["lane_opened"]
    assert h.acks(h.send(dev("lane", npc="miaozhu"))) == [("rejected", "no_change")]  # done


def test_the_lane_is_for_the_keeper_alone_and_not_in_a_heavy_rain():
    h = hand(3)
    set_sky(h, "heavy_rain", "clear", "clear")
    assert h.acks(h.send(dev("lane", npc="li_da"))) == [("rejected", "no_change")]
    h.run_to(at(1, 8))
    h.send(dev("lane", npc="miaozhu"))
    h.run_to(at(1, 20))
    assert "lane_opened" not in h.goals["flags"]  # he stays under a roof
    h.run_to(at(2, 12))
    assert "lane_opened" in h.goals["flags"]


def test_three_helpers_hang_lanterns_along_the_open_lane_and_the_detour_is_ready():
    h = hand(3)
    join_all(h, ("li_er", "zhou_dalang", "old_he", "mujiang"))
    h.send(dev("lane", npc="miaozhu"))
    h.run_to(at(1, 12))
    assert "lane_opened" in h.goals["flags"] and h.goals["lane"]["lamps"] == {}
    h.run_to(at(1, 13, 30))  # in the afternoon three of them are asked, in the order they joined
    assert sorted(h.goals["lane"]["lamps"]) == ["li_er", "old_he", "zhou_dalang"]
    assert all(
        t["steps"][-1][1] == "p_temple_lane"
        for t in h.state["tasks"]["queue"]
        if t["npc"] in h.goals["lane"]["lamps"]
    )
    h.run_to(at(1, 20))
    assert h.goals["lane"]["hung"] and len(h.goals["lane"]["hung"]) <= 3
    assert sorted(h.goals["lane"]["hung"]) == ["li_er", "old_he", "zhou_dalang"]
    assert h.goals["metrics"]["detour_workers"] == 3
    assert {"lamps_hung", "detour_done"} <= set(h.goals["flags"])
    assert {"g_detour"} <= set(h.goals["done"])
    assert "mujiang" not in h.goals["lane"]["hung"]  # no more were asked than were needed
    bridge = h.send()["frame"]["hud"]["bridge"]
    assert bridge["state"] == "detour" and "lacking" not in bridge
    assert "bridge_fixed" not in h.goals["flags"]


def test_two_lanterns_are_not_a_detour_and_a_third_finishes_it():
    h = hand(3)
    join_all(h, ("li_er", "zhou_dalang"))
    h.send(dev("lane", npc="miaozhu"))
    h.run_to(at(2, 20))
    assert sorted(h.goals["lane"]["hung"]) == ["li_er", "zhou_dalang"]
    assert h.goals["metrics"]["detour_workers"] == 2
    assert "lamps_hung" not in h.goals["flags"] and "detour_done" not in h.goals["flags"]
    join_all(h, ("old_he",))
    h.run_to(at(3, 12))  # the next afternoon is a day later
    assert "detour_done" not in h.goals["flags"]
    h.run_to(at(3, 20))
    assert "detour_done" in h.goals["flags"] and h.goals["metrics"]["detour_workers"] == 3


def test_no_lanterns_are_hung_before_the_lane_is_open_nor_in_a_heavy_rain():
    h = hand(3)
    set_sky(h, "clear", "heavy_rain", "clear")
    join_all(h, ("li_er", "zhou_dalang", "old_he"))
    h.run_to(at(1, 20))
    assert h.goals["lane"] == {"task": 0, "lamps": {}, "hung": []}
    h.send(dev("lane", npc="miaozhu"))
    h.run_to(at(2, 20))  # day 2 is a heavy rain
    assert h.goals["lane"]["hung"] == [] and h.goals["lane"]["lamps"] == {}
    h.run_to(at(3, 20))
    assert "detour_done" in h.goals["flags"]


def test_the_open_lane_is_a_new_way_for_people_on_foot():
    h = hand(3)
    h.run_to(at(1, 8))
    h.send(dev("lane", npc="miaozhu"))
    h.run_to(at(1, 12))
    assert "lane_opened" in h.goals["flags"]
    world = world_of(h.game)
    grid = world.walking_grid(h.state)
    assert grid.walkable(grid.index(55, 20)) and grid.walkable(grid.index(55, 21))
    closed = world.town.grid
    assert not closed.walkable(closed.index(55, 20))


def walk_time(h, start, person="gengfu", place="p_temple_lane"):
    """Ticks a person put at ``start`` takes to get within reach of their cell at ``place``."""
    npc = h.state["npcs"]["list"][CAST.index[person]]
    npc["x"], npc["y"] = start
    h.send(body("assign", npc=person, task={"kind": "goto", "place": place}))
    begun = h.game.tick
    while not near(npc, stand(person, place)):
        h.send()
        assert h.game.tick - begun < 600
    return h.game.tick - begun


def test_people_take_the_open_lane_as_the_shorter_way():
    shut = hand(3)
    shut.run_to(at(1, 10))
    open_ = hand(3)
    open_.run_to(at(1, 8))
    open_.send(dev("lane", npc="miaozhu"))
    open_.run_to(at(1, 10))
    assert "lane_opened" in open_.goals["flags"] and "lane_opened" not in shut.goals["flags"]
    north = (55, 18)  # above the barrier, with the lane they were bound for below it
    closed_time, open_time = walk_time(shut, north), walk_time(open_, north)
    assert open_time * 3 // 2 < closed_time  # about twice as long round the shut lane


def test_a_world_without_this_section_walks_on_the_closed_town():
    h = hand(3)
    world = world_of(h.game)
    assert goals.walking_grid(world, {}) is world.town.grid
    assert goals.walking_grid(world, {"goals": {"alive": True}}) is world.town.grid
    assert HELPERS and rally()  # (the helpers module is imported for its constants)
