"""The call for helpers: thresholds, how the call spreads, the crew, the households that promise."""

import pytest
from bridge_helpers import CAST, PEOPLE, world_of
from goals_helpers import (
    HELPERS,
    LI,
    NEUTRAL,
    ZHOU,
    crew_of_five,
    dev,
    hand,
    join_all,
    rally,
    sim_of,
)

from lantern_core.rng import Pcg32
from lantern_core.world.bridge import goals, goals_call


def lay(h):
    return goals_call.lay(world_of(h.game))


def calm(h, **base):
    """Every helper at the highest threshold with no shift, but those in ``base``."""
    call = h.goals["call"]
    for person in HELPERS:
        call["base"][person], call["shift"][person] = 6, 0
    call["base"].update(base)


def threshold(h, person):
    return goals_call.threshold(h.state, person)


def trust(h, person, value=None):
    """The trust of a person in the manager, which the ``player`` section keeps; set it if given."""
    if value is not None:
        h.state["player"]["trust"][CAST.index[person]] = value
    return h.state["player"]["trust"][CAST.index[person]]


def joined_events(h):
    return [(e["npc"], e["round"], e["how"]) for e in h.kinds("joined")]


# ------------------------------------------------------------------------------ thresholds


def test_children_cannot_help_and_every_other_person_has_a_threshold():
    h = hand(1)
    call = h.goals["call"]
    assert set(call["base"]) == set(call["shift"]) == set(HELPERS)
    assert lay(h).helpers == tuple(p.id for p in PEOPLE if p.id in HELPERS)
    assert {"shitou", "xiao_man"}.isdisjoint(call["base"])
    assert call["open"] == -1 and call["joined"] == [] and call["households"] == []


def clamp(value):
    return max(0, min(goals_call.MAX_THRESHOLD, value))


def test_a_threshold_is_conformity_and_the_family_head_moved_by_one_draw_and_by_trust():
    for seed in range(10):
        h = hand(seed)
        call = h.goals["call"]
        for person in PEOPLE:
            if person.id not in call["base"]:
                continue
            plain = goals_call.BASE + person.traits["conformity"] // goals_call.CONFORMITY_STEP
            plain += (person.id in goals_call.HEADS) - (person.id == goals_call.ELDER)
            assert call["base"][person.id] in {clamp(plain + d) for d in (-1, 0, 1)}, person.id
            assert call["shift"][person.id] == 0
            # a stranger is trusted by no one: the threshold is the base
            assert 0 <= trust(h, person.id) < goals_call.TRUST_STEP
            assert threshold(h, person.id) == call["base"][person.id]


def test_a_follower_waits_for_more_people_than_an_independent_one_and_the_heads_for_most():
    totals = {"li_laotai": 0, "li_da": 0, "zhou_dalang": 0, "zhou_zhanggui": 0}
    seeds = range(40)
    for seed in seeds:
        h = hand(seed)
        for person in totals:
            totals[person] += h.goals["call"]["base"][person]
    mean = {person: total / len(seeds) for person, total in totals.items()}
    assert mean["zhou_dalang"] < mean["li_da"] < mean["li_laotai"]  # conformity 20, 55, 70
    assert mean["li_laotai"] - mean["li_da"] > 1.0  # a head waits for more
    assert abs(mean["li_laotai"] - mean["zhou_zhanggui"]) < 1.0


def test_the_elder_who_sent_for_the_manager_waits_for_one_person_fewer():
    plain = goals_call.BASE + 85 // goals_call.CONFORMITY_STEP
    for seed in range(20):
        base = hand(seed).goals["call"]["base"]["zuzhang"]
        assert plain - 2 <= base <= plain  # the draw, and one less
    mean = sum(hand(seed).goals["call"]["base"]["zuzhang"] for seed in range(20)) / 20
    assert plain - 1.8 < mean < plain - 0.2


def test_the_thresholds_are_a_function_of_the_seed_and_differ_from_seed_to_seed():
    def table(seed):
        return dict(hand(seed).goals["call"]["base"])

    assert table(5) == table(5)
    tables = {tuple(sorted(table(seed).items())) for seed in range(30)}
    assert len(tables) > 20
    # and the easiest person to win over is not always the same one
    easiest = set()
    for seed in range(40):
        base = hand(seed).goals["call"]["base"]
        easiest.add(min(HELPERS, key=lambda p: (base[p], HELPERS.index(p))))
    assert len(easiest) >= 3


def test_making_the_thresholds_takes_no_number_from_the_games_generator():
    h = hand(2)
    rng = Pcg32(99, 7)
    before = rng.to_state()
    first = goals_call.seed(world_of(h.game), rng)
    assert rng.to_state() == before
    assert goals_call.seed(world_of(h.game), rng) == first
    other = goals_call.seed(world_of(h.game), Pcg32(100, 7))
    assert other["base"] != first["base"]


def test_trust_and_persuasion_move_a_threshold_within_its_bounds():
    h = hand(4)
    sim = sim_of(h)
    person = "li_da"
    h.goals["call"]["base"][person] = 3
    trust(h, person, 0)
    assert threshold(h, person) == 3
    assert goals.threshold(h.state, person) == 3
    trust(h, person, 29)
    assert threshold(h, person) == 3
    trust(h, person, 30)  # every 30 points of the manager's standing with a person take one off
    assert threshold(h, person) == 2
    trust(h, person, 90)
    assert threshold(h, person) == 0  # 3 - 3
    trust(h, person, 100)
    assert threshold(h, person) == 0
    trust(h, person, 0)
    assert goals.lower_threshold(sim, person) == 2
    assert goals.lower_threshold(sim, person, 2) == 0 and h.goals["call"]["shift"][person] == -3
    assert goals.lower_threshold(sim, person, -4) == 4  # one can put steps on as well: 3 + 1
    for _ in range(20):
        goals.lower_threshold(sim, person, 3)
    assert h.goals["call"]["shift"][person] == -goals_call.MAX_SHIFT
    assert threshold(h, person) == 0
    h.goals["call"]["base"][person] = 6
    assert goals.lower_threshold(sim, person, -50) == 6  # and it never goes past the top
    for bad in ("shitou", "nobody"):
        assert goals.lower_threshold(sim, bad) == -1
    assert goals.lower_threshold(sim, person, 1.5) == -1  # type: ignore[arg-type]


# ------------------------------------------------------------------------------ who knows whom


def test_the_acquaintances_are_family_and_those_whose_days_cross_theirs_but_not_the_other_family():
    h = hand(1)
    knows = lay(h).knows
    for person in HELPERS:
        assert person not in knows[person]
        for other in knows[person]:
            assert person in knows[other], (person, other)  # it goes both ways
    for a in LI:
        assert set(LI) - {a} <= set(knows[a])
        assert set(ZHOU).isdisjoint(knows[a]) or a == "li_xiaomei"
    for a in ZHOU:
        assert set(ZHOU) - {a} <= set(knows[a])
        assert set(LI).isdisjoint(knows[a]) or a == "zhou_erlang"
    assert knows["li_xiaomei"].count("zhou_erlang") == 1  # the two who are fond of each other
    assert knows["zhou_erlang"].count("li_xiaomei") == 1
    assert all(len(knows[p]) >= 2 for p in HELPERS)
    assert set(NEUTRAL) - {"miaozhu", "zhadeng_shifu"} <= set().union(*map(set, knows.values()))


# ------------------------------------------------------------------------------ the spread


def test_nothing_happens_until_the_manager_calls():
    h = hand(3)
    calm(h, li_er=0, zhou_dalang=0)  # two who would join at once
    h.run_to(500)
    assert h.goals["call"]["joined"] == [] and h.kinds("joined") == []
    out = h.send(rally())
    assert h.acks(out) == [("applied", None)]
    assert [(n, r) for n, r, _ in joined_events(h)][:2] == [("li_er", 1), ("zhou_dalang", 1)]
    assert h.goals["call"]["open"] == 500


def test_the_call_spreads_in_rounds_and_each_round_counts_those_before_it():
    h = hand(3)
    calm(h, li_er=0, li_da=1, li_xiaomei=2, li_laotai=3)  # a chain through the Li family
    h.send(rally())
    assert joined_events(h) == [
        ("li_er", 1, "call"),
        ("li_da", 2, "call"),
        ("li_xiaomei", 3, "call"),
        ("li_laotai", 4, "call"),
    ]
    assert goals.joined(h.state) == ["li_er", "li_da", "li_xiaomei", "li_laotai"]
    assert goals.promised(h.state) == ["fam_li"]
    for person in ("li_er", "li_da", "li_xiaomei", "li_laotai"):
        assert goals.waiting_for(world_of(h.game), h.state, person) == 0
    assert goals.waiting_for(world_of(h.game), h.state, "zhou_dalang") == 6 - 0  # it is at 6


def test_who_joined_first_decides_who_follows_and_in_what_order():
    h = hand(3)
    calm(h, li_er=0, li_da=1, li_xiaomei=2, li_laotai=3)
    # a head is won over first: the call then takes the others in rounds, those with equal
    # thresholds together and in the order of the cast
    join_all(h, ("li_laotai",))
    h.send(rally())
    assert [(n, r) for n, r, _ in joined_events(h)] == [
        ("li_laotai", 0),
        ("li_da", 1),
        ("li_er", 1),
        ("li_xiaomei", 2),
    ]
    # the same thresholds, and nobody the call can start from
    h = hand(3)
    calm(h, li_er=1, li_da=1, li_xiaomei=2, li_laotai=3)
    h.send(rally())
    assert h.kinds("joined") == []
    assert goals.waiting_for(world_of(h.game), h.state, "li_er") == 1
    join_all(h, ("zhou_dalang",))  # a Zhou: no Li knows him, so nobody is moved
    assert goals.joined(h.state) == ["zhou_dalang"]
    join_all(h, ("li_xiaomei",))  # a Li who is persuaded sets off the others
    assert goals.joined(h.state) == ["zhou_dalang", "li_xiaomei", "li_da", "li_er", "li_laotai"]
    assert [r for _, r, _ in joined_events(h)] == [0, 0, 1, 1, 2]


def closure(world, state, persuaded):
    """Who ends up in: the persuaded, then anyone whose threshold is met, until nothing changes."""
    knows = goals_call.lay(world).knows
    inside = set(persuaded)
    changed = True
    while changed:
        changed = False
        for person in goals_call.lay(world).helpers:
            if person in inside:
                continue
            if sum(1 for other in knows[person] if other in inside) >= goals_call.threshold(
                state, person
            ):
                inside.add(person)
                changed = True
    return inside


@pytest.mark.parametrize("seed", range(12))
def test_the_call_takes_the_crew_and_no_more_and_every_join_is_justified(seed):
    h = hand(seed)
    world = world_of(h.game)
    rng = Pcg32(seed, 3)
    pool = list(HELPERS)
    rng.shuffle(pool)
    persuaded = pool[: 1 + seed % 4]
    h.send(rally())
    join_all(h, tuple(persuaded))
    entries = h.goals["call"]["joined"]
    knows = goals_call.lay(world).knows
    # each join by the call came after enough of the person's acquaintances had joined
    for i, (person, _, _, how) in enumerate(entries):
        if how == "call":
            earlier = sum(1 for p, *_ in entries[:i] if p in knows[person])
            assert earlier >= goals_call.threshold(h.state, person), person
    # the call is for the crew and no more: nobody came by it once the crew was ready
    ready_at = next(
        (
            i
            for i in range(len(entries))
            if goals_call.crew_ready(world, {"joined": entries[: i + 1]})
        ),
        None,
    )
    if ready_at is not None:
        assert all(how != "call" for *_, how in entries[ready_at + 1 :])
    # and whoever it left out, whose threshold is met, it left out because the crew was ready, or
    # it had five and the person is of a family that has someone among them
    assert set(goals.joined(h.state)) <= closure(world, h.state, persuaded)
    count, per_family = goals_call.crew(world, h.goals["call"])
    for person in lay(h).helpers:
        if person not in goals.joined(h.state) and goals.waiting_for(world, h.state, person) == 0:
            assert goals.crew_ready(world, h.state) or (
                count >= goals_call.CREW and per_family.get(lay(h).family[person], 1) > 0
            ), person


def test_the_call_is_for_the_crew_and_leaves_the_rest_with_their_thresholds_met():
    h = hand(3)
    world = world_of(h.game)
    call = h.goals["call"]
    for person in HELPERS:  # everyone would come as soon as one friend has
        call["base"][person], call["shift"][person] = 0, 0
    h.send(rally())
    joined = goals.joined(h.state)
    assert len(joined) == goals_call.CREW and goals.crew_ready(world, h.state)
    _, per_family = goals_call.crew(world, call)
    assert all(count >= 1 for count in per_family.values())
    assert {how for *_, how in call["joined"]} == {"call"}
    left = [p for p in HELPERS if p not in joined]
    assert len(left) == len(HELPERS) - goals_call.CREW
    assert all(goals.waiting_for(world, h.state, p) == 0 for p in left)  # they would have come
    h.run_to(h.game.tick + 240)  # the hour comes round and the call does not go on
    assert goals.joined(h.state) == joined


def test_a_crew_made_by_persuasion_leaves_nothing_for_the_call_to_do():
    h = hand(3)
    calm(h, li_er=0)
    join_all(h, crew_of_five())
    assert goals.crew_ready(world_of(h.game), h.state)
    h.send(rally())
    assert goals.joined(h.state) == list(crew_of_five())


def test_a_person_asked_in_person_comes_when_their_threshold_is_met_though_the_crew_is_ready():
    h = hand(3)
    calm(h)
    join_all(h, crew_of_five())
    h.send(rally())
    world, sim = world_of(h.game), sim_of(h)
    friends = lay(h).knows["li_laotai"]
    present = [p for p in friends if p in goals.joined(h.state)]
    assert len(present) >= 2
    call = h.goals["call"]
    call["base"]["li_laotai"] = len(present) + 1  # one friend short
    assert goals.waiting_for(world, h.state, "li_laotai") == 1
    assert goals.lower_threshold(sim, "li_laotai", 1) == len(present)  # asked: one step nearer
    assert goals.joined(h.state)[-1] == "li_laotai"  # and the friends there are enough
    assert call["joined"][-1][2:] == [goals_call.ROUND_PERSUADED, goals_call.PERSUASION]


def test_a_person_asked_in_person_whose_threshold_is_not_met_comes_one_step_nearer():
    h = hand(3)
    calm(h)
    h.send(rally())
    sim = sim_of(h)
    assert goals.lower_threshold(sim, "li_laotai", 1) == goals_call.MAX_THRESHOLD - 1
    assert goals.joined(h.state) == []
    assert goals.waiting_for(world_of(h.game), h.state, "li_laotai") == 5


def test_a_person_asked_before_the_call_does_not_come_until_it_is_made():
    h = hand(3)
    calm(h, li_laotai=0)
    sim = sim_of(h)
    assert goals.lower_threshold(sim, "li_laotai", 1) == 0
    assert goals.joined(h.state) == []
    h.send(rally())
    assert goals.joined(h.state) == ["li_laotai"]


def test_a_persuaded_person_joins_whatever_their_threshold_and_a_second_call_is_refused():
    h = hand(3)
    calm(h)
    out = h.send(dev("join", npc="mujiang"))
    assert h.acks(out) == [("applied", None)]
    assert joined_events(h) == [("mujiang", 0, "dev")]
    assert goals.joined(h.state) == ["mujiang"]
    out = h.send(dev("join", npc="mujiang"))  # in already
    assert h.acks(out) == [("rejected", "no_change")]
    assert h.acks(h.send(rally())) == [("applied", None)]
    assert h.acks(h.send(rally())) == [("rejected", "already_open")]
    assert len(h.kinds("rally")) == 1
    sim = sim_of(h)
    assert goals.join(sim, "shitou") is False and goals.join(sim, "nobody") is False
    assert goals.join(sim, "old_he") is True
    assert h.goals["call"]["joined"][-1][3] == "persuasion"


def test_a_threshold_that_falls_lets_the_call_reach_people_at_once_and_at_the_top_of_the_hour():
    h = hand(3)
    calm(h)
    h.send(rally())
    join_all(h, ("li_da",))
    assert goals.joined(h.state) == ["li_da"]
    sim = sim_of(h)
    assert goals.lower_threshold(sim, "li_er", 5) == 1
    assert goals.joined(h.state) == ["li_da", "li_er"]  # one acquaintance was enough
    # trust that a module changes behind the call's back is seen at the top of the next hour
    trust(h, "li_xiaomei", 90)
    h.goals["call"]["base"]["li_xiaomei"] = 2
    assert "li_xiaomei" not in goals.joined(h.state)
    h.run_to(h.game.tick + 120)
    assert "li_xiaomei" in goals.joined(h.state)
    assert [e["tick"] % 120 for e in h.kinds("joined") if e["npc"] == "li_xiaomei"] == [0]
    # unless the module says so: ``spread`` works the call out at once
    trust(h, "li_laotai", 90)
    h.goals["call"]["base"]["li_laotai"] = 2
    goals.spread(sim)
    assert "li_laotai" in goals.joined(h.state)


# ------------------------------------------------------------------------------ the crew


def test_five_helpers_with_at_least_one_of_each_family_make_a_crew():
    h = hand(3)
    calm(h)
    world = world_of(h.game)
    ready = lambda: goals.crew_ready(world, h.state)  # noqa: E731
    join_all(h, LI)  # four Li
    assert not ready() and h.frame["hud"]["bridge"]["lacking"] == "bamboo"
    join_all(h, ("cha_laoban",))  # five, all of them Li or neutral
    assert not ready()
    h.send(dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui"))
    h.run_to(h.game.tick + 600)
    bridge = h.frame["hud"]["bridge"]
    assert bridge["done"] == 5 and bridge["need"] == 5
    assert bridge["lacking"] == {"zh": "两家的人", "en": "helpers from both families"}
    join_all(h, ("zhou_huoji",))
    assert ready()
    assert "lacking" not in h.send()["frame"]["hud"]["bridge"]


def test_four_helpers_of_both_families_are_not_enough_and_the_hud_asks_for_hands():
    h = hand(3)
    calm(h)
    join_all(h, ("li_da", "li_er", "zhou_dalang", "zhou_erlang"))
    world = world_of(h.game)
    assert not goals.crew_ready(world, h.state)
    h.send(dev("material", npc="li_da"), dev("material", npc="zhou_zhanggui"))
    h.run_to(h.game.tick + 600)
    bridge = h.send()["frame"]["hud"]["bridge"]
    assert (bridge["done"], bridge["need"]) == (4, 5)
    assert bridge["lacking"] == {"zh": "人手", "en": "hands"}
    join_all(h, ("old_he",))
    assert goals.crew_ready(world, h.state)


# ------------------------------------------------------------------------------ households


def test_a_household_promises_when_any_of_its_people_joins_and_hangs_one_lantern():
    h = hand(3)
    calm(h)
    assert h.send()["frame"]["lanterns"] == []
    out = h.send(dev("join", npc="li_da"))
    assert [e["household"] for e in out["events"] if e["kind"] == "promised"] == ["fam_li"]
    frame = out["frame"]
    assert frame["lanterns"] == [{"household": "fam_li", "place": "p_li_house", "x": 7, "y": 5}]
    out = h.send(
        dev("join", npc="li_er"), dev("join", npc="zhou_dalang"), dev("join", npc="old_he")
    )
    assert [e["household"] for e in out["events"] if e["kind"] == "promised"] == [
        "fam_zhou",
        "old_he",
    ]
    lanterns = out["frame"]["lanterns"]
    assert [lantern["household"] for lantern in lanterns] == ["fam_li", "fam_zhou", "old_he"]
    assert out["frame"]["hud"]["promised"] == 3 == len(goals.promised(h.state))
    layout = lay(h)
    for lantern in lanterns:
        home = layout.household[lantern["household"]]
        assert (lantern["place"], (lantern["x"], lantern["y"])) == (home.place, home.door)
    # a household is the people who live under one roof, 12 of them in the town
    assert len(layout.households) == 12
    assert sorted(m for hh in layout.households for m in hh.members) == sorted(CAST.index)
    assert (
        layout.household_of["shitou"] == "fam_li" and layout.household_of["li_laotai"] == "fam_li"
    )


def test_past_five_the_call_brings_only_a_family_that_has_nobody_yet():
    h = hand(3)
    world = world_of(h.game)
    call = h.goals["call"]
    for person in HELPERS:  # everyone would come as soon as one friend has
        call["base"][person], call["shift"][person] = 0, 0
    # five who are not of the Li family are in already: the crew is not ready
    join_all(h, ("zhou_dalang", "zhou_erlang", "old_he", "mujiang", "cha_laoban"))
    assert not goals.crew_ready(world, h.state)
    h.send(rally())
    joined = goals.joined(h.state)
    assert len(joined) == 6 and set(joined[5:]) <= set(LI)  # one of the Li, and the crew is ready
    assert goals.crew_ready(world, h.state)
    assert [how for *_, how in call["joined"]][5:] == ["call"]
