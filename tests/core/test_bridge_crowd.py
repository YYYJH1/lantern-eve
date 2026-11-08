"""The crowd: two hundred townsfolk without names, their opinions, days and street talk."""

import copy
import json
import statistics

import pytest
from bridge_helpers import CLEAR, HEAVY, TOWN, bridge, run_to, state_of, world_of
from hypothesis import given, settings
from hypothesis import strategies as st

from lantern_core import canon
from lantern_core.api import Game
from lantern_core.kernel import Ctx
from lantern_core.rng import Pcg32
from lantern_core.world.bridge import clock, crowd, districts, npcs, opinions, order, weather
from lantern_core.world.bridge.sim import Sim

DAY = clock.CYCLE_TICKS
SIZE = crowd.SIZE


@pytest.fixture(autouse=True)
def without_the_talk(monkeypatch):
    """Run the crowd on its own. The talk between named people calls ``hear`` and empties the
    outbox, which these tests would otherwise have to account for in every number they check."""
    quiet = tuple(m for m in order.SUBSYSTEMS if m.SECTION != "social")
    monkeypatch.setattr(order, "SUBSYSTEMS", quiet)


def crowd_of(game):
    return state_of(game)["crowd"]


def sim_of(game):
    """A ``Sim`` on the live state of ``game``, which is what the talk between people gets."""
    return Sim(world_of(game), Ctx(game._kernel))


def layout_of(game):
    world = world_of(game)
    return districts.layout(world.town, world.cast)


def key_at(tick):
    return districts.slot_key(clock.at(tick))


# ------------------------------------------------------------------------------ the start


def test_a_game_starts_with_two_hundred_townsfolk_inside_their_bounds():
    assert SIZE == 200
    for seed in (1, 2, 3):
        game = bridge(seed)
        section = crowd_of(game)
        assert set(section) == {
            "enthusiasm",
            "stance",
            "home",
            "at",
            "heard",
            "outbox",
            "slot",
            "rng",
        }
        for name in ("enthusiasm", "stance", "home", "at", "heard"):
            assert len(section[name]) == SIZE, name
        assert all(0 <= e <= 100 for e in section["enthusiasm"])
        assert all(-100 <= s <= 100 for s in section["stance"])
        lay = layout_of(game)
        assert all(TOWN.places[lay.places[h]].kind == "house" for h in section["home"])
        assert section["at"] == section["home"]  # they start the game at home
        assert section["heard"] == [[]] * SIZE and section["outbox"] == []
        for name in ("enthusiasm", "stance", "home", "at"):
            assert all(type(x) is int for x in section[name])


def test_a_home_is_a_house_and_the_two_big_ones_lean_to_their_own_family():
    game = bridge(1)
    lay = layout_of(game)
    houses = [p.id for p in TOWN.places.values() if p.kind == "house"]
    assert [lay.places[i] for i in lay.homes] == houses
    leans = dict(zip((lay.places[i] for i in lay.homes), lay.home_lean, strict=True))
    families = [f["id"] for f in json.loads(game.scene_json())["families"]]
    assert families == ["fam_li", "fam_zhou"] and lay.side == {"fam_li": -1, "fam_zhou": 1}
    assert leans["p_li_house"] == -1 and leans["p_zhou_house"] == 1
    assert [v for k, v in leans.items() if k not in ("p_li_house", "p_zhou_house")] == [0] * 4
    assert lay.home_share == tuple(4 if x else 1 for x in lay.home_lean)
    stances = {-1: [], 0: [], 1: []}
    for seed in range(1, 9):
        section = crowd_of(bridge(seed))
        for home, stance in zip(section["home"], section["stance"], strict=True):
            stances[lay.home_lean[lay.homes.index(home)]].append(stance)
    assert statistics.mean(stances[-1]) < -25 and statistics.mean(stances[1]) > 25
    assert abs(statistics.mean(stances[0])) < 8
    assert all(400 < len(group) < 700 for group in stances.values())  # a third of the town each


def test_the_start_is_a_function_of_the_seed_and_about_a_third_of_the_town_is_keen():
    assert crowd_of(bridge(5)) == crowd_of(bridge(5))
    assert crowd_of(bridge(5)) != crowd_of(bridge(6))
    keen = [crowd.keen_count(state_of(bridge(seed))) for seed in range(1, 21)]
    assert min(keen) >= 40 and max(keen) <= 90 and 50 <= statistics.mean(keen) <= 75


def test_the_crowd_takes_nothing_from_the_kernels_rng_when_it_is_made_or_ticked():
    game = bridge(4)
    world = world_of(game)
    rng = Pcg32(7, 3)
    before = rng.to_state()
    made = crowd.init(world, rng)
    assert rng.to_state() == before  # it reads the state of the RNG for a seed and draws nothing
    assert crowd.init(world, Pcg32(8, 3)) != made  # another state of the RNG, another crowd
    run_to(game, 100)
    kernel_rng = game._kernel.rng.to_state()
    for _ in range(5):
        crowd.tick(sim_of(game))
    assert game._kernel.rng.to_state() == kernel_rng


def test_the_crowd_changes_nothing_that_the_kernels_rng_decides(monkeypatch):
    # a game with the crowd's tick switched off walks the named people exactly like one with it on
    with_crowd = bridge(4)
    run_to(with_crowd, 900)
    monkeypatch.setattr(crowd, "tick", lambda sim: None)
    plain = bridge(4)
    run_to(plain, 900)
    for name in ("npcs", "weather", "tasks", "clock"):
        assert state_of(with_crowd)[name] == state_of(plain)[name], name
    assert with_crowd._kernel.state["rng"] == plain._kernel.state["rng"]
    assert crowd_of(with_crowd) != crowd_of(plain)


# ------------------------------------------------------------------------------ opinions


@settings(max_examples=300, deadline=None)
@given(
    a=st.integers(-100, 100),
    b=st.integers(-100, 100),
    bound=st.integers(1, 201),
    mu=st.integers(1, 500),
)
def test_a_meeting_keeps_the_sum_and_moves_each_toward_the_other_never_past(a, b, bound, mu):
    x, y = opinions.meet(a, b, bound, mu)
    assert x + y == a + b
    low, high = min(a, b), max(a, b)
    assert low <= x <= high and low <= y <= high
    assert abs(y - x) <= abs(b - a)
    assert (x - a) * (b - a) >= 0  # a moved toward b, or stayed
    if abs(b - a) >= bound:
        assert (x, y) == (a, b)  # beyond the bound they do not listen
    assert opinions.meet(b, a, bound, mu) == (y, x)  # and who is first does not matter


def test_a_meeting_works_in_whole_numbers_rounded_toward_zero():
    assert opinions.meet(0, 10, 12, 250) == (2, 8)  # 2.5 of the gap rounds down to 2
    assert opinions.meet(10, 0, 12, 250) == (8, 2)
    assert opinions.meet(0, 3, 12, 250) == (0, 3)  # three apart is too little to move a unit
    assert opinions.meet(0, 4, 12, 250) == (1, 3)
    assert opinions.meet(-7, -17, 12, 250) == (-9, -15)
    assert opinions.meet(0, 12, 12, 250) == (0, 12)  # the bound itself is not within it
    assert opinions.meet(0, 11, 12, 500) == (5, 6)


@settings(max_examples=300, deadline=None)
@given(x=st.integers(-100, 100), target=st.integers(-100, 100), per_mille=st.integers(0, 1000))
def test_a_pull_goes_toward_the_target_by_part_of_the_gap_and_never_past_it(x, target, per_mille):
    moved = opinions.pull(x, target, per_mille)
    assert min(x, target) <= moved <= max(x, target)
    assert abs(moved - x) <= abs(target - x) * per_mille // 1000
    assert opinions.pull(x, target, 1000) == target


def test_opinions_stay_inside_their_bounds_and_with_no_one_speaking_the_sums_never_change():
    game = bridge(3)
    start = copy.deepcopy(crowd_of(game))
    totals = (sum(start["enthusiasm"]), sum(start["stance"]))
    for tick in range(97, 3 * DAY, 97):
        run_to(game, tick)
        section = crowd_of(game)
        assert all(0 <= e <= 100 for e in section["enthusiasm"])
        assert all(-100 <= s <= 100 for s in section["stance"])
        assert all(0 <= d < len(layout_of(game).places) for d in section["at"])
        # a meeting trades between two, so the sums are what they were at the start
        assert (sum(section["enthusiasm"]), sum(section["stance"])) == totals
    twin = bridge(3)
    run_to(twin, game.tick)
    assert twin.hash() == game.hash()
    assert crowd_of(twin)["enthusiasm"] != start["enthusiasm"]  # and they did move


def test_a_game_restored_from_a_snapshot_goes_on_with_the_same_crowd():
    game = bridge(6)
    run_to(game, 1500)
    twin = Game.from_snapshot_json(game.snapshot_json())
    for _ in range(700):
        game.step()
        twin.step()
        assert crowd_of(game) == crowd_of(twin)
    assert game.hash() == twin.hash()
    canon.check(game._kernel.state)


def test_a_meeting_is_between_two_in_one_district_and_trades_inside_it():
    game = bridge(2)
    run_to(game, 40)
    section = crowd_of(game)
    for k in range(SIZE):  # two camps, in two districts
        section["at"][k] = 0 if k < SIZE // 2 else 5
    section["slot"] = key_at(game.tick)  # the same slot goes on, so no one is placed again

    def sums():
        return [
            (sum(section[o][k] for k in range(lo, hi)) for o in ("enthusiasm", "stance"))
            for lo, hi in ((0, SIZE // 2), (SIZE // 2, SIZE))
        ]

    before = [tuple(pair) for pair in sums()]
    first = (list(section["enthusiasm"]), list(section["stance"]))
    run_to(game, game.tick + 1)
    changed = [
        k
        for k in range(SIZE)
        if (section["enthusiasm"][k], section["stance"][k]) != (first[0][k], first[1][k])
    ]
    assert 0 < len(changed) <= 2 * crowd.MEETINGS_PER_TICK
    run_to(game, game.tick + 60)
    assert [tuple(pair) for pair in sums()] == before  # nothing crossed from one camp to the other
    assert (section["enthusiasm"], section["stance"]) != first


# ------------------------------------------------------------------------------ the day


def test_at_night_everyone_is_at_home_and_by_day_many_are_out():
    game = bridge(1, **CLEAR)
    out = {}
    for tick in (0, clock.hour_start(10), clock.hour_start(19), clock.hour_start(22)):
        run_to(game, tick + 1)
        section = crowd_of(game)
        out[tick] = sum(a != h for a, h in zip(section["at"], section["home"], strict=True))
        if tick == clock.hour_start(10):
            lay = layout_of(game)
            kinds = {lay.kinds[d] for d in section["at"]}
            assert {"market", "workshop", "bridge", "bank", "house"} <= kinds  # a working morning
    assert 0 < out[0] < 80  # at dawn most are still in
    assert out[clock.hour_start(10)] > 100 and out[clock.hour_start(19)] > 80
    assert out[clock.hour_start(22)] == 0  # the curfew: everyone is at home


def test_the_townsfolk_decide_again_only_when_a_slot_begins():
    game = bridge(2, **CLEAR)
    starts = {t for t in range(DAY + 1) if t == 0 or key_at(t) != key_at(t - 1)}
    assert starts == {0, *(clock.hour_start(h) for h in (9, 12, 15, 18, 21)), DAY}
    moves = set()
    before = list(crowd_of(game)["at"])
    for tick in range(DAY + 1):
        game.step()
        after = list(crowd_of(game)["at"])
        if after != before:
            moves.add(tick)
        before = after
        assert crowd_of(game)["slot"] == key_at(tick)
    assert moves == starts


def test_slots_follow_the_hour_and_the_night_is_a_slot_of_its_own():
    slots = {6: 0, 8: 0, 9: 1, 11: 1, 12: 2, 14: 2, 15: 3, 17: 3, 18: 4, 20: 4}
    for hour, slot in slots.items():
        assert districts.slot_at(clock.at(clock.hour_start(hour))) == slot, hour
    assert districts.slot_at(clock.at(clock.hour_start(21))) == districts.NIGHT_SLOT
    assert districts.slot_at(clock.at(DAY - 1)) == districts.NIGHT_SLOT
    assert key_at(clock.hour_start(9)) == key_at(0) + 1
    assert key_at(DAY) > key_at(DAY - 1) > key_at(clock.hour_start(20))  # the next dawn is new
    assert len({key_at(t) for t in range(2 * DAY)}) == 2 * districts.SLOTS_A_DAY


def test_in_a_heavy_rain_nobody_goes_out_in_the_open_and_more_stay_at_home():
    heavy, clear = bridge(1, **HEAVY), bridge(1, **CLEAR)
    lay = layout_of(heavy)
    for tick in (clock.hour_start(10), clock.hour_start(16), clock.hour_start(19)):
        run_to(heavy, tick + 1)
        run_to(clear, tick + 1)
        at = crowd_of(heavy)["at"]
        assert not [d for d in at if not lay.indoor[d]], tick

        def left_home(game):
            section = crowd_of(game)
            return sum(a != h for a, h in zip(section["at"], section["home"], strict=True))

        assert left_home(heavy) < left_home(clear)
    assert any(not lay.indoor[d] for d in crowd_of(clear)["at"])  # on a clear day they go out


def test_in_a_light_rain_the_open_places_are_visited_less():
    lay = layout_of(bridge(1))
    slot = 3  # the afternoon
    clear_at, clear_weights = districts.destinations(lay, slot, weather.CLEAR)
    light_at, light_weights = districts.destinations(lay, slot, weather.LIGHT_RAIN)
    heavy_at, _ = districts.destinations(lay, slot, weather.HEAVY_RAIN)
    assert clear_at == light_at and heavy_at and all(lay.indoor[d] for d in heavy_at)
    assert any(not lay.indoor[d] for d in clear_at)
    for d, clear_weight, light_weight in zip(clear_at, clear_weights, light_weights, strict=True):
        assert light_weight == (clear_weight if lay.indoor[d] else max(1, clear_weight // 2))
    stay = districts.stay_at_home
    assert stay(slot, weather.HEAVY_RAIN) == stay(slot, weather.CLEAR) + 300
    assert stay(districts.NIGHT_SLOT, weather.CLEAR) == 1000 and stay(0, weather.HEAVY_RAIN) == 1000
    assert districts.destinations(lay, districts.NIGHT_SLOT, weather.CLEAR) == ((), ())


# ------------------------------------------------------------------------------ being heard


def staged(seed=1, tick=40):
    """A game with the townsfolk set out for a test: 50 each at the market, the riverbank and the
    teahouse, and the other fifty at home, with the slot kept so that no one is moved again."""
    game = bridge(seed, **CLEAR)
    run_to(game, tick)
    section = crowd_of(game)
    lay = layout_of(game)
    where = [lay.index[p] for p in ("p_market", "p_riverbank", "p_teahouse")]
    for k in range(SIZE):
        section["at"][k] = where[k // 50] if k < 150 else section["home"][k]
    section["slot"] = key_at(game.tick)
    return game, section, lay


def snapshot_of(section):
    return copy.deepcopy({name: section[name] for name in ("enthusiasm", "stance", "heard")})


def test_a_voice_is_the_side_of_the_family_the_warmth_and_the_standing():
    world = world_of(bridge(1))
    assert crowd.voice(world, "li_da") == (-60, 70, 40)  # a Li: warmth 50, no tag
    assert crowd.voice(world, "zhou_niangzi") == (60, 70, 40)
    assert crowd.voice(world, "zuzhang") == (0, 65, 120)  # of neither family, a gatekeeper
    assert crowd.voice(world, "cha_laoban") == (0, 90, 80)  # of neither, a hub
    assert crowd.voice(world, "shitou") == (-60, 100, 40)  # warmth 80 is as keen as it gets
    with pytest.raises(KeyError):
        crowd.voice(world, "nobody")


def test_hearing_moves_the_district_of_the_place_and_no_other(monkeypatch):
    monkeypatch.setattr(crowd, "STORE_PER_MILLE", 1000)
    game, section, lay = staged()
    before = snapshot_of(section)
    kept = crowd.hear(sim_of(game), "p_market", "prop-7", "zhou_niangzi")
    market = lay.index["p_market"]
    for k in range(SIZE):
        if section["at"][k] == market:
            assert section["stance"][k] == opinions.pull(before["stance"][k], 60, 40)
            assert section["enthusiasm"][k] == opinions.pull(before["enthusiasm"][k], 70, 40)
            assert section["heard"][k] == ["prop-7"]
        else:
            assert section["stance"][k] == before["stance"][k]
            assert section["enthusiasm"][k] == before["enthusiasm"][k]
            assert section["heard"][k] == []
    assert kept == sum(1 for here in section["at"] if here == market) == 50
    assert section["stance"][:50] != before["stance"][:50]  # the market did move


def test_a_standing_voice_pulls_harder_and_toward_its_own_stance(monkeypatch):
    monkeypatch.setattr(crowd, "STORE_PER_MILLE", 0)
    moved = {}
    for speaker in ("li_da", "zuzhang"):
        game, section, lay = staged()
        section["stance"][50] = 100  # at the far end of the Zhou side, 160 from a Li and 100 from 0
        before = snapshot_of(section)
        crowd.hear(sim_of(game), "p_riverbank", "prop-1", speaker)
        side, _, per_mille = crowd.voice(world_of(game), speaker)
        for k in range(50, 100):  # the riverbank
            old, new = before["stance"][k], section["stance"][k]
            assert new == opinions.pull(old, side, per_mille)
        moved[speaker] = before["stance"][50] - section["stance"][50]
        assert all(section["heard"][k] == [] for k in range(SIZE))  # nothing was kept
    # the elder is three times as heard and has less far to pull
    assert moved == {"li_da": 6, "zuzhang": 12}
    game, section, _ = staged()
    section["stance"][50], section["stance"][51] = 80, -80
    crowd.hear(sim_of(game), "p_riverbank", "prop-1", "zuzhang")
    assert section["stance"][50] < 80 and section["stance"][51] > -80  # toward 0 from either side


def test_a_listener_keeps_the_three_latest_things_and_a_repeat_changes_nothing(monkeypatch):
    monkeypatch.setattr(crowd, "STORE_PER_MILLE", 1000)
    game, section, lay = staged()
    sim = sim_of(game)
    for prop in ("p1", "p2", "p3", "p4"):
        assert crowd.hear(sim, "p_market", prop, "li_da") == 50
    assert all(section["heard"][k] == ["p2", "p3", "p4"] for k in range(50))
    assert crowd.hear(sim, "p_market", "p3", "li_da") == 0  # heard already: kept by no one new
    assert section["heard"][0] == ["p2", "p3", "p4"]
    assert crowd.MEMORY == 3 and all(len(h) <= 3 for h in section["heard"])


def test_by_default_about_half_of_a_district_keeps_what_it_hears():
    game, section, lay = staged()
    kept = crowd.hear(sim_of(game), "p_market", "prop-7", "li_da")
    assert 15 < kept < 35 and sum(1 for h in section["heard"] if h) == kept


def test_indoors_and_on_the_water_nobody_hears_and_bad_arguments_are_errors():
    game, section, lay = staged()
    before = (snapshot_of(section), dict(section["rng"]))
    sim = sim_of(game)
    assert crowd.hear(sim, "p_teahouse", "prop-7", "cha_laoban") == 0  # fifty are in the teahouse
    assert crowd.hear(sim, "p_under_bridge", "prop-7", "old_he") == 0  # water has no district
    assert (snapshot_of(section), dict(section["rng"])) == before
    for args in (
        ("p_nowhere", "prop-7", "li_da"),
        ("p_market", "prop-7", "no_one"),
        ("p_market", "", "li_da"),
        ("p_market", 7, "li_da"),
    ):
        with pytest.raises(ValueError, match="unknown|string"):
            crowd.hear(sim, *args)
    assert (snapshot_of(section), dict(section["rng"])) == before


def test_hearing_is_deterministic_and_the_crowd_stays_canonical():
    outcomes = []
    for _ in range(2):
        game, section, _ = staged(seed=3)
        crowd.hear(sim_of(game), "p_riverbank", "prop-2", "cha_laoban")
        run_to(game, game.tick + 30)
        outcomes.append(game.hash())
        canon.check(game._kernel.state)
    assert outcomes[0] == outcomes[1]


# ------------------------------------------------------------------------------ passing it on


def a_named_person_at_a_place(game):
    """Run on to mid-morning until someone stands at the place they are bound for.

    Returns the district of that place and the ids of the named people at their goals there.
    """
    lay = layout_of(game)
    run_to(game, max(game.tick, clock.hour_start(10)))
    for _ in range(400):
        game.step()
        here = {}
        for npc in state_of(game)["npcs"]["list"]:
            if npcs.is_at_goal(npc) and npc["place"] in lay.index:
                here.setdefault(lay.index[npc["place"]], []).append(npc["id"])
        if here:
            district = sorted(here, key=lambda d: (-len(here[d]), d))[0]
            return district, here[district]
    raise AssertionError("nobody stood anywhere")


def everyone_holds(section, district, props):
    for k in range(SIZE):
        section["at"][k] = district
        section["heard"][k] = list(props)


def test_street_talk_goes_to_a_named_person_standing_there_and_out_of_the_townsperson(monkeypatch):
    game = bridge(1, **CLEAR)
    run_to(game, clock.hour_start(10) - 5)
    section = crowd_of(game)
    district, named = a_named_person_at_a_place(game)
    everyone_holds(section, district, ["prop-9"])
    section["slot"] = key_at(game.tick)
    tick = game.tick
    game.step()
    outbox = section["outbox"]
    assert len(outbox) == crowd.PASSES_PER_TICK
    for entry in outbox:
        assert set(entry) == {"to", "prop", "tick"}
        assert type(entry["tick"]) is int and entry["tick"] == tick
        assert entry["prop"] == "prop-9" and entry["to"] in named
    assert sum(1 for h in section["heard"] if not h) == len(outbox)  # told once, then forgotten
    section["outbox"].clear()  # the talk between named people reads and empties it
    game.step()
    assert (
        len(section["outbox"]) == crowd.PASSES_PER_TICK and section["outbox"][0]["tick"] == tick + 1
    )


def test_a_townsperson_with_nothing_to_tell_or_nobody_to_tell_it_to_passes_nothing_on():
    game = bridge(1, **CLEAR)
    district, named = a_named_person_at_a_place(game)
    section = crowd_of(game)
    lay = layout_of(game)
    everyone_holds(section, district, [])  # the right place, nothing to tell
    section["slot"] = key_at(game.tick)
    run_to(game, game.tick + 40)
    assert section["outbox"] == []
    bound_for = {npc["place"] for npc in state_of(game)["npcs"]["list"]}
    empty = next(d for d, place in enumerate(lay.places) if place not in bound_for)
    everyone_holds(section, empty, ["prop-9"])  # something to tell, in a place where no one is
    run_to(game, game.tick + 20)
    assert section["outbox"] == [] and all(h == ["prop-9"] for h in section["heard"])


def test_at_night_the_street_is_quiet():
    game = bridge(1, **CLEAR)
    run_to(game, clock.hour_start(22))
    section = crowd_of(game)
    lay = layout_of(game)
    homes = {n["place"] for n in state_of(game)["npcs"]["list"]}
    district = lay.index[sorted(homes)[0]]  # a house where someone sleeps
    everyone_holds(section, district, ["prop-9"])
    run_to(game, game.tick + 50)
    assert section["outbox"] == [] and section["heard"][0] == ["prop-9"]


def test_the_outbox_is_bounded_and_keeps_the_newest_if_no_one_empties_it():
    game = bridge(1, **CLEAR)
    run_to(game, clock.hour_start(10) - 5)
    section = crowd_of(game)
    district, _ = a_named_person_at_a_place(game)
    everyone_holds(section, district, ["a", "b", "c"])
    section["slot"] = key_at(game.tick)
    last = game.tick
    for _ in range(100):
        game.step()
        assert len(section["outbox"]) <= crowd.OUTBOX_MAX
    ticks = [entry["tick"] for entry in section["outbox"]]
    assert len(ticks) == crowd.OUTBOX_MAX == 64 and ticks == sorted(ticks)
    assert ticks[-1] >= last + 90 and ticks[0] > last  # the oldest went first
    passed = sum(3 - len(h) for h in section["heard"])
    assert passed > crowd.OUTBOX_MAX  # more was told than the outbox holds


# ------------------------------------------------------------------------------ count and hud


def test_keen_is_enthusiasm_at_the_line_or_above_and_reads_any_of_the_states():
    game = bridge(1)
    section = crowd_of(game)
    section["enthusiasm"][:7] = [59, 60, 61, 100, 0, 30, 60]
    section["enthusiasm"][7:] = [0] * (SIZE - 7)
    assert crowd.KEEN_LINE == 60
    kernel_state = game._kernel.state
    assert crowd.keen_count(kernel_state) == 4  # 60, 61, 100, 60
    assert crowd.keen_count(kernel_state["world"]) == 4
    assert crowd.keen_count(section) == 4
    section["enthusiasm"][0] = 60
    assert crowd.keen_count(kernel_state) == 5
    assert (
        crowd.district_of(world_of(game), kernel_state, 0)
        == layout_of(game).places[section["at"][0]]
    )
    home = crowd.district_of(world_of(game), kernel_state, 0, home=True)
    assert home == layout_of(game).places[section["home"][0]] and TOWN.places[home].kind == "house"


def test_the_frame_hud_carries_the_keen_count_in_every_call():
    game = bridge(2)
    for tick in range(0, 400, 40):
        run_to(game, tick)
        out = json.loads(game.step())
        keen = out["frame"]["hud"]["keen"]
        assert type(keen) is int and keen == crowd.keen_count(game._kernel.state)
    section = crowd_of(game)
    section["enthusiasm"][:] = [100] * SIZE
    assert json.loads(game.step())["frame"]["hud"]["keen"] == SIZE
    section["enthusiasm"][:] = [0] * SIZE
    assert json.loads(game.step())["frame"]["hud"]["keen"] == 0
