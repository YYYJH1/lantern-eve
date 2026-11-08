"""Which tier answers for a person is a fixed rule, and it is fixed when the talk opens."""

from __future__ import annotations

import pytest
from bridge_helpers import TOWN, npc_of
from player_helpers import me
from reply_helpers import Room

from lantern_core.world.bridge import overhear, player, tiers
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

CENTRAL = {"li_er", "li_laotai", "old_he", "zhou_dalang", "zhou_zhanggui", "zuzhang"}
ORDINARY = "cha_laoban"


def test_the_people_the_plot_turns_on_are_read_off_the_script():
    assert tiers.central() == CENTRAL
    lo = lore()
    assert {env.holder for env in lo.book.lies} <= tiers.central()  # something to hide
    hard = SCRIPT["hard_conditions"][0]
    assert hard["holder"] in tiers.central()  # a hard condition rests on them
    named = {c["who"] for alt in hard["any"] for c in alt["all"] if "who" in c}
    assert named and named <= tiers.central()  # or names them
    assert tiers.central() <= set(lo.people)


def test_the_rule_is_a_table_of_distance_and_plot():
    near, far = tiers.NEAR, tiers.NEAR + 1
    assert tiers.NEAR == 2 * overhear.HEARING
    for person in sorted(CENTRAL):
        assert tiers.of(person, 0) == tiers.of(person, far) == tiers.STRONG
    assert tiers.of(ORDINARY, 0) == tiers.of(ORDINARY, near) == tiers.CHEAP
    assert tiers.of(ORDINARY, far) == tiers.RULE  # nobody is asked for a person far away
    assert set(tiers.TIERS) == {"rule", "cheap", "strong"}


def test_a_talk_is_always_near_so_an_ordinary_person_is_cheap():
    assert player.TALK_RANGE <= tiers.NEAR
    room = Room(ORDINARY)
    assert me(room.game)["talk"]["tier"] == tiers.CHEAP


@pytest.mark.parametrize("who", sorted(CENTRAL))
def test_a_person_the_plot_turns_on_is_asked_on_the_strong_tier(who):
    room = Room.awake(who)
    assert me(room.game)["talk"]["tier"] == tiers.STRONG
    out = room.act("ask", topic="t_rail")
    assert [r["tier"] for r in out["requests"]] == ["strong"]


def test_an_ordinary_person_is_asked_on_the_cheap_tier():
    room = Room(ORDINARY)
    out = room.act("ask", topic="t_rail")
    assert [r["tier"] for r in out["requests"]] == ["cheap"]


def test_the_tier_is_fixed_when_the_talk_opens_and_nothing_later_changes_it():
    room = Room(ORDINARY)
    start = me(room.game)["talk"]["tier"]
    # the person drifts a long way off in the state, and the manager's rank in town changes:
    # neither is looked at again, since the talk keeps the tier it opened with
    npc = npc_of(room.game, ORDINARY)
    npc["x"], npc["y"] = TOWN.places["p_clan_hall"].door
    me(room.game)["trust"][lore().index[ORDINARY]] = 90
    out = room.act("ask", topic="t_rail")
    assert me(room.game)["talk"]["tier"] == start
    assert [r["tier"] for r in out["requests"]] == [start]
    # and a reply from a model that says anything at all does not move it either
    room.result(out["requests"][0], "ok", "{")
    out = room.act("ask", topic="p_bridge")
    assert [r["tier"] for r in out["requests"]] == [start]


def test_the_tier_of_the_next_talk_is_decided_afresh():
    room = Room(ORDINARY)
    room.act("leave")
    assert me(room.game)["talk"] == {}
    assert me(Room.awake("li_er").game)["talk"]["tier"] == tiers.STRONG
