"""The game ``slice`` of the bridge scenario, the one the opening page starts: the config keys that
make it, the hearsay it opens with, the evening at the teahouse and the refusal that names the
rumour.

The slice is the game ``api.preset("slice")``: seed 492, the boatman as the truth, an opening of the
script (the rumour that Li Er broke the rail already going round the Zhou house and the teahouse
when the clock starts) and no heavy rain. The hops of the opening are claims like any others, so the
manager can ask who told whom and walk the rumour back to the clerk, who only saw Li Er at the
bridge.
"""

from __future__ import annotations

import json

import pytest
from bridge_helpers import at, bridge, run_to, state_of
from dealings_helpers import believe, know, tell, told_event
from player_helpers import acks, act, beside, events, me, silence

from bots.base import Bot, Obs
from lantern_core import canon
from lantern_core.api import Game, preset
from lantern_core.cognition.props import lineage
from lantern_core.cognition.provenance import walk_back
from lantern_core.replay import Recorder, rebuild
from lantern_core.world.bridge import (
    data,
    gossip,
    notebook,
    notes,
    opening,
    persuade,
    social,
    voices,
)
from lantern_core.world.bridge.lore import lore
from lantern_core.world.bridge.world import DEFAULT_CONFIG

LO = lore()
SLICE = preset("slice")
SEED = SLICE["seed"]
OPEN = {k: v for k, v in SLICE["config"].items() if k in ("variant", "opening")}
LOOKING, AT_BRIDGE, DAMAGED = "pr_liner_looking", "pr_liner_at_bridge", "pr_liner_damaged"
PURPOSE, JEALOUS = "pr_liner_damaged_on_purpose", "pr_liner_damaged_jealous"
FIVE = ("zuzhang", "cha_laoban", "zhou_huoji", "li_laotai", "li_da")
VARIANTS = ("v_boat", "v_flood", "v_drunk")
RUMOUR_LINE = "hard_hc_li_bamboo_rumour"


def slice_game(**config):
    """The game of the slice, with ``config`` laid over its keys."""
    return Game(SLICE["seed"], SLICE["scenario"], {**SLICE["config"], **config})


def held(game, who, prop_id):
    """What ``who`` holds about the prop: source, confidence, teller, named source and hand."""
    belief = notes.store(state_of(game)["social"], who).get(prop_id)
    if belief is None:
        return None
    return belief.source, belief.confidence, belief.teller, belief.claimed_source, belief.hop


def story(game):
    """Every belief about the story of the lantern and the rail, by person: the notes as kept."""
    section = state_of(game)["social"]
    view = notebook.view(section)
    return {
        who: {
            pid: note
            for pid, note in sorted(kept.items())
            if pid in view and lineage(pid, view)[-1] == LOOKING
        }
        for who, kept in sorted(section["beliefs"].items())
    }


def story_claims(game):
    """Every claim about the story, by id: the notes as kept."""
    section = state_of(game)["social"]
    view = notebook.view(section)
    return {
        cid: note
        for cid, note in section["claims"].items()
        if lineage(notes.decode_claim(cid, note).prop, view)[-1] == LOOKING
    }


def meet(game, who):
    """End the conversation there is, and open one with ``who``, next to them."""
    if me(game)["talk"]:
        act(game, "leave")
    for _ in range(80):  # someone in the middle of telling a neighbour has to finish first
        beside(game, who)
        silence(game)
        out = act(game, "talk", npc=who)
        if acks(out) != [("rejected", "busy")]:
            break
    assert acks(out) == [("applied", None)], (who, acks(out))
    return out


def met(who, hour, minute=0, **config):
    """The game of the slice's seed and opening, run to ``hour``:``minute`` of the first day, with
    the manager in a conversation with ``who``."""
    game = bridge(SEED, **{**OPEN, **config})
    run_to(game, at(1, hour, minute))
    meet(game, who)
    return game


def chain(entry):
    return [link and link["id"] for link in entry["chain"]]


# ------------------------------------------------------------------------------ the config keys


@pytest.mark.parametrize("seed", range(6))
def test_the_variant_key_forces_the_truth_and_the_rest_of_the_seed_goes_on(seed):
    plain = state_of(bridge(seed))
    drawn = plain["social"]["variant"]
    for variant in VARIANTS:
        forced = state_of(bridge(seed, variant=variant))
        assert forced["social"]["variant"] == variant
        # the draw is taken all the same, so the weather, the town and the bonds are the seed's
        for section in ("weather", "npcs", "tasks"):
            assert forced[section] == plain[section]
        assert forced["social"]["bonds"] == plain["social"]["bonds"]
        if variant == drawn:
            assert forced == plain  # the key adds nothing to a game that draws it anyway
        else:  # what was seen the night before is what the other truth leaves to see
            assert forced["social"]["beliefs"] != plain["social"]["beliefs"]


def test_a_game_without_the_keys_has_the_config_it_always_had():
    assert set(Game(1, "bridge").header()["config"]) == set(DEFAULT_CONFIG)
    config = bridge(1, variant="v_flood", opening="op_li_er_hearsay").header()["config"]
    assert set(config) == set(DEFAULT_CONFIG) | {"variant", "opening"}
    assert set(bridge(1, goods="promised").header()["config"]) == set(DEFAULT_CONFIG) | {"goods"}


@pytest.mark.parametrize("value", ["v_nope", "", 3, None, ["v_boat"], True])
def test_the_variant_key_takes_one_of_the_variants_of_the_script(value):
    with pytest.raises(ValueError, match="variant must be one of"):
        bridge(1, variant=value)


def test_the_opening_key_takes_an_opening_of_the_script():
    for value in ("op_nope", 1, None):
        with pytest.raises(ValueError, match="opening must be one of"):
            bridge(1, opening=value)
    assert sorted(LO.openings) == ["op_li_er_hearsay"]


def test_the_slice_is_seed_492_the_boat_the_opening_no_heavy_rain_and_the_goods_promised():
    assert SLICE == {
        "scenario": "bridge",
        "seed": 492,
        "config": {
            "variant": "v_boat",
            "opening": "op_li_er_hearsay",
            "weather_heavy": 0,
            "goods": "promised",
        },
    }
    state = state_of(slice_game())
    assert state["social"]["variant"] == "v_boat"
    plan = state["weather"]["plan"]
    assert "heavy_rain" not in plan and plan[1] == "clear"  # the bamboo is carried on day two
    assert state_of(bridge(SEED))["social"]["variant"] == "v_boat"  # the seed draws the boatman too
    handed_out = preset("slice")
    handed_out["config"]["weather_heavy"] = 99  # a copy is handed out each time
    assert preset("slice")["config"]["weather_heavy"] == 0
    with pytest.raises(ValueError, match="unknown bridge preset"):
        preset("nowhere")


def test_the_slice_is_a_game_like_any_other_it_restores_and_replays_from_its_header():
    game = slice_game()
    run_to(game, 300)
    twin = Game.from_snapshot_json(game.snapshot_json())
    header = game.header()
    assert header["seed"] == SEED and header["config"]["opening"] == "op_li_er_hearsay"
    rebuilt = Game(header["seed"], header["scenario"], header["config"])
    run_to(rebuilt, 300)
    for _ in range(100):
        game.step()
        twin.step()
        rebuilt.step()
    assert game.hash() == twin.hash() == rebuilt.hash()
    assert canon.loads(game.snapshot_json())["config"]["variant"] == "v_boat"


def test_a_recording_of_the_slice_with_a_manager_in_it_is_replayed_to_the_same_game():
    game = slice_game()
    recorder = Recorder(game)
    bot = RouteA(json.loads(game.scene_json()), SEED)
    obs = Obs(json.loads(recorder.step("[]")))
    while game.tick < at(1, 13, 30):
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        obs = Obs(json.loads(recorder.step(json.dumps(records))))
    recording = canon.loads(canon.dumps_str(recorder.recording()))  # as a file would carry it
    assert recording["header"]["config"]["opening"] == "op_li_er_hearsay"
    assert any(row[2] == "player" for row in recording["records"]) and recording["hashes"]
    again = rebuild(recording)  # it checks every hash on the way
    assert again.hash() == game.hash() and again.snapshot_json() == game.snapshot_json()


# ------------------------------------------------------------------------------ the opening


def test_the_opening_is_the_table_of_the_script_and_a_game_without_it_opens_as_it_did():
    game = slice_game()
    assert held(game, "zhou_huoji", LOOKING) == ("saw", 90, None, None, 0)
    assert held(game, "zhou_huoji", AT_BRIDGE) == ("saw", 90, None, None, 0)
    assert held(game, "zhou_huoji", PURPOSE) == ("heard", 63, "zhou_erlang", "zhou_zhanggui", 3)
    assert held(game, "zhou_huoji", JEALOUS) is None  # he told it; he does not hold it
    assert held(game, "zhou_zhanggui", AT_BRIDGE) == ("heard", 87, "zhou_huoji", "self_seen", 1)
    assert held(game, "zhou_zhanggui", DAMAGED) == ("inferred", 87, None, None, 1)
    assert held(game, "zhou_erlang", DAMAGED) == ("heard", 86, "zhou_zhanggui", "zhou_huoji", 2)
    assert held(game, "zhou_erlang", PURPOSE) is None
    assert held(game, "cha_laoban", JEALOUS) == ("heard", 45, "zhou_huoji", "zhou_erlang", 4)
    assert held(game, "li_laotai", JEALOUS) == ("heard", 45, "cha_laoban", "zhou_huoji", 5)
    told = story(game)
    for nobody in ("zuzhang", "li_da"):  # the elder and the eldest son know nothing of it
        assert told[nobody] == {}
    section = state_of(game)["social"]
    assert section["seq"] == 6 and sorted(section["claims"]) == ["c1", "c2", "c3", "c4", "c5"]
    assert section["counts"]["told"] == 0 and section["props"] == {}
    plain = bridge(SEED)  # the same seed and truth without the opening: nobody has heard a word
    assert state_of(plain)["social"]["seq"] == 1 and state_of(plain)["social"]["claims"] == {}
    assert story(plain)["cha_laoban"] == {} and story(plain)["li_laotai"] == {}


@pytest.mark.parametrize("variant", VARIANTS)
@pytest.mark.parametrize("seed", [1, 2, 7, 492, 2015])
def test_the_opening_is_the_same_hearsay_whichever_story_is_true_and_whichever_seed(seed, variant):
    """What was passed round is false in every variant, and what the clerk saw is true in all."""
    game = bridge(seed, variant=variant, opening="op_li_er_hearsay")
    section = state_of(game)["social"]
    assert section["variant"] == variant and sorted(section["claims"]) == [
        "c1",
        "c2",
        "c3",
        "c4",
        "c5",
    ]
    assert held(game, "li_laotai", JEALOUS) == ("heard", 45, "cha_laoban", "zhou_huoji", 5)
    assert held(game, "zhou_huoji", PURPOSE) == ("heard", 63, "zhou_erlang", "zhou_zhanggui", 3)
    assert held(game, "zhou_huoji", AT_BRIDGE) == ("saw", 90, None, None, 0)
    for rumour in (DAMAGED, PURPOSE, JEALOUS):
        assert not LO.book.holds(variant, rumour)


def test_the_hops_of_the_opening_are_claims_with_the_operators_the_script_names():
    claims = social.claims(state_of(slice_game())["social"])
    rows = {
        cid: (c.speaker, c.listeners[0], c.prop, c.path, c.op, c.rule_id, c.claimed_source, c.tick)
        for cid, c in claims.items()
    }
    assert rows == {
        "c1": ("zhou_huoji", "zhou_zhanggui", AT_BRIDGE, "belief", None, None, "self_seen", 0),
        "c2": ("zhou_zhanggui", "zhou_erlang", DAMAGED, "mutation", "assimilate",
               "sr_presence_grudge", "zhou_huoji", 0),
        "c3": ("zhou_erlang", "zhou_huoji", PURPOSE, "mutation", "sharpen", None,
               "zhou_zhanggui", 0),
        "c4": ("zhou_huoji", "cha_laoban", JEALOUS, "mutation", "fill", None, "zhou_erlang", 0),
        "c5": ("cha_laoban", "li_laotai", JEALOUS, "belief", None, None, "zhou_huoji", 0),
    }  # fmt: skip


def test_the_way_back_from_granny_li_ends_at_the_clerk_who_saw_li_er_at_the_bridge():
    section = state_of(slice_game())["social"]
    trace = walk_back(
        "li_laotai", JEALOUS, social.stores(section), social.claims(section), social.book(section)
    )
    assert trace.end == "saw" and trace.origin == "zhou_huoji"
    assert [hop.holder for hop in trace.hops] == [
        "li_laotai", "cha_laoban", "zhou_huoji", "zhou_erlang", "zhou_zhanggui", "zhou_huoji",
    ]  # fmt: skip
    assert trace.mutations == (
        ("c4", "zhou_huoji", "fill"),
        ("c3", "zhou_erlang", "sharpen"),
        ("c2", "zhou_zhanggui", "assimilate"),
    )
    assert trace.hops[-1].belief.prop == AT_BRIDGE  # what the clerk saw is only the bridge


def test_an_opening_whose_hop_nobody_could_tell_is_refused(monkeypatch):
    def bad(hops):
        monkeypatch.setitem(
            LO.openings, "op_bad", {"id": "op_bad", "quiet_until": None, "hops": hops}
        )
        return state_of(bridge(SEED))["social"]

    def hop(speaker, listener, prop, via=None, own=None, confidence=50):
        return dict(speaker=speaker, listener=listener, prop=prop, via=via, own=own,
                    confidence=confidence)  # fmt: skip

    nothing_held = [hop("cha_laoban", "li_laotai", DAMAGED)]
    with pytest.raises(ValueError, match="holds neither"):
        opening.apply(LO, bad(nothing_held), "op_bad")
    no_rule = [
        hop("zhou_huoji", "zhou_zhanggui", AT_BRIDGE),
        hop("zhou_zhanggui", "zhou_erlang", DAMAGED),
    ]
    with pytest.raises(ValueError, match="needs rule_id"):
        opening.apply(LO, bad(no_rule), "op_bad")


def test_asking_the_clerk_three_times_about_li_er_gives_three_notes_in_order():
    game = met("zhou_huoji", 8)
    asked = []
    for _ in range(3):
        out = act(game, "ask", topic="li_er")
        asked.append(events(out, "asked")[0])
    assert [(e["prop"], e["source"], e["entry"]) for e in asked] == [
        (PURPOSE, "zhou_erlang", "n1"),  # what he heard from the second son
        (AT_BRIDGE, "self_seen", "n2"),  # what he saw
        (LOOKING, "self_seen", "n3"),
    ]
    first, second, third = out["frame"]["notebook"]
    assert "故意" in first["text"]["zh"] and "on purpose" in first["text"]["en"]
    assert "在石桥" in second["text"]["zh"] and "找" in third["text"]["zh"]
    assert [e["source"]["hand"] for e in (first, second, third)] == [4, 1, 1]
    assert [chain(e) for e in (first, second, third)] == [
        ["zhou_huoji", "zhou_erlang", None],  # the first is heard from the second son
        ["zhou_huoji"],  # and the other two are first hand: nobody is left to ask
        ["zhou_huoji"],
    ]
    # only the one relation the script shows from the start: the clerk saw him at the bridge, and
    # that does not show that he broke the rail
    assert first["marks"] == ["unsupported"] and second["marks"] == third["marks"] == []


def test_asking_who_told_them_walks_the_deliberate_version_back_to_the_shopkeeper():
    game = met("zhou_huoji", 8)
    out = act(game, "ask", topic="li_er")
    assert chain(out["frame"]["notebook"][0]) == ["zhou_huoji", "zhou_erlang", None]
    meet(game, "zhou_erlang")
    out = act(game, "ask_source", entry="n1")
    first = out["frame"]["notebook"][0]
    assert chain(first) == ["zhou_huoji", "zhou_erlang", "zhou_zhanggui", None]
    meet(game, "zhou_zhanggui")
    out = act(game, "ask_source", entry="n1")
    first = out["frame"]["notebook"][0]
    assert chain(first) == ["zhou_huoji", "zhou_erlang", "zhou_zhanggui"]  # his own conclusion
    assert first["marks"] == []  # the only note: nothing to set it against


def test_asking_who_told_them_walks_the_madams_version_back_to_what_the_clerk_saw():
    game = met("cha_laoban", 8)
    out = act(game, "ask", topic="li_er")
    (entry,) = out["frame"]["notebook"]
    assert entry["source"]["who"]["id"] == "cha_laoban" and entry["source"]["hand"] == 5
    assert "envy" in entry["text"]["en"] and chain(entry) == ["cha_laoban", "zhou_huoji", None]
    meet(game, "zhou_huoji")
    out = act(game, "ask_source", entry="n1")
    first, second = out["frame"]["notebook"]
    assert chain(first) == ["cha_laoban", "zhou_huoji"]  # he says he saw it, and he saw this much
    assert (
        second["id"] == "n2" and second["text"]["en"] == "Li Er was at the Stone Bridge last night."
    )
    assert first["marks"] == ["unsupported"]  # the tutorial's, and nothing of the madam's words
    out = act(game, "judge", a="n2", b="n1", relation="mismatch")  # until the manager says so
    assert [(r, why) for r, why in acks(out)] == [("applied", None)]
    assert out["frame"]["notebook"][0]["marks"] == ["unsupported", "sourceMismatch"]


def test_asking_who_told_them_walks_granny_lis_version_back_through_the_madam_to_the_clerk():
    game = met("li_laotai", 7)
    out = act(game, "ask", topic="li_er")
    assert chain(out["frame"]["notebook"][0]) == ["li_laotai", "cha_laoban", None]
    meet(game, "cha_laoban")
    out = act(game, "ask_source", entry="n1")
    assert chain(out["frame"]["notebook"][0]) == ["li_laotai", "cha_laoban", "zhou_huoji", None]
    meet(game, "zhou_huoji")
    out = act(game, "ask_source", entry="n1")
    assert chain(out["frame"]["notebook"][0]) == ["li_laotai", "cha_laoban", "zhou_huoji"]


# ------------------------------------------------------------------------------ the routes


class Idle(Bot):
    """The manager who does nothing."""

    name = "idle"

    def play(self):
        while True:
            yield None


class RouteA(Bot):
    """Granny Li first thing, the clerk at noon, then the madam."""

    name = "route-a"

    def play(self):
        if (yield from self.meet("li_laotai")):
            yield from self.entrust("lend")
            yield from self.leave()
        yield from self.wait_until(1, 12, 0)
        if (yield from self.meet("zhou_huoji")):
            yield from self.act("ask", topic="li_er")
            yield from self.act("ask", topic="p_bridge")
            yield from self.leave()
        yield from self.wait_until(1, 13, 5)
        if (yield from self.meet("cha_laoban")):
            yield from self.act("ask", topic="li_er")
            yield from self.leave()
        yield from Idle.play(self)


class RouteB(Bot):
    """The madam first, Granny Li at half past nine, then the clerk."""

    name = "route-b"

    def play(self):
        if (yield from self.meet("cha_laoban")):
            yield from self.act("ask", topic="li_er")
            yield from self.leave()
        yield from self.wait_until(1, 9, 30)
        if (yield from self.meet("li_laotai")):
            yield from self.entrust("lend")
            yield from self.leave()
        if (yield from self.meet("zhou_huoji")):
            yield from self.act("ask", topic="li_er")
            yield from self.leave()
        yield from Idle.play(self)


class RouteC(Bot):
    """The clerk at noon with five questions, then the teahouse at twenty to six."""

    name = "route-c"

    def play(self):
        yield from self.wait_until(1, 12, 0)
        if (yield from self.meet("zhou_huoji")):
            for topic in ("li_er", "p_bridge", "t_rail", "zhou_zhanggui", "li_er"):
                yield from self.act("ask", topic=topic)
            yield from self.leave()
        yield from self.wait_until(1, 17, 40)
        yield from self.goto("p_teahouse")
        yield from Idle.play(self)


def played(bot_class, until, **config):
    """The slice played by ``bot_class`` to ``until``: the game, and the tellings of the story of
    the lantern and the rail on the way, as (tick, speaker, listener, prop)."""
    game = slice_game(**config)
    bot = bot_class(json.loads(game.scene_json()), SEED)
    obs = Obs(json.loads(game.step("[]")))
    hops = []
    while game.tick < until:
        action = bot.decide(obs)
        records = (
            [] if action is None else [{"seq": game.next_seq, "kind": "player", "body": action}]
        )
        out = json.loads(game.step(json.dumps(records)))
        obs = Obs(out)
        view = notebook.view(state_of(game)["social"])
        hops += [
            (e["tick"], e["speaker"], e["listener"], e["prop"])
            for e in out["events"]
            if e["kind"] == "told" and lineage(e["prop"], view)[-1] == LOOKING
        ]
    return game, hops


ROUTES = (Idle, RouteA, RouteB, RouteC)


def test_the_story_before_five_does_not_depend_on_the_way_the_manager_walks():
    """Whichever way the manager goes, nobody passes the story on before the evening, so every hop
    before 17:00 is the opening's and the town is as the opening left it."""
    start, start_claims = story(slice_game()), story_claims(slice_game())
    assert sorted(start_claims) == ["c1", "c2", "c3", "c4", "c5"]
    for route in ROUTES:
        game, hops = played(route, at(1, 17, 0))
        assert hops == [], route.name
        assert story(game) == start, route.name
        assert story_claims(game) == start_claims, route.name


def test_without_the_quiet_the_story_is_told_before_five_and_the_routes_part_ways(monkeypatch):
    monkeypatch.setattr(opening, "quiet_roots", lambda world, lore, tick: frozenset())
    hops = {route.name: played(route, at(1, 17, 0))[1] for route in (Idle, RouteA)}
    assert len(hops["idle"]) > 5  # the madam and the rest would have told it
    assert hops["route-a"] != hops["idle"]  # and a talk with Granny Li would have changed who


def test_the_story_is_quiet_until_the_end_of_the_evening_and_not_after():
    start = story(slice_game())
    game, hops = played(Idle, at(1, 18, 59))
    assert hops == [] and story(game) == start  # the evening window of the teahouse is untouched
    game, hops = played(Idle, at(2, 12, 0))
    assert hops and min(hop[0] for hop in hops) >= at(1, 19, 0)
    assert opening.quiet_until(LO.openings["op_li_er_hearsay"]) == at(1, 19, 0)
    assert opening.quiet_roots(game._kernel.world, LO, at(1, 19, 0)) == frozenset()
    assert opening.quiet_roots(game._kernel.world, LO, 0) == {LOOKING}
    assert (
        opening.quiet_roots(bridge(1)._kernel.world, LO, 0) == frozenset()
    )  # no opening, no quiet


def test_the_quiet_leaves_the_story_out_of_what_a_person_would_tell_and_nothing_else():
    game = slice_game()
    section = state_of(game)["social"]
    view = notebook.view(section)

    def would_tell(quiet):
        return gossip.best_belief(LO, section, view, "li_laotai", "li_da", game.tick, quiet)

    assert would_tell(()) == JEALOUS and would_tell({LOOKING}) is None
    believe(game, "li_laotai", "pr_dalang_drank", 80, "heard", "mujiang", "mujiang", 1)
    assert would_tell({LOOKING}) == "pr_dalang_drank"  # another story is told as ever


def test_what_the_manager_tells_goes_round_even_while_the_story_is_quiet():
    game = met("li_da", 7)
    entry = know(game, AT_BRIDGE, "saw")
    event = told_event(tell(game, entry["id"], "faithful"))
    assert event["outcome"] == "took"
    assert held(game, "li_da", AT_BRIDGE)[0] == "heard"


# ------------------------------------------------------------------------------ the evening


def test_the_schedules_of_granny_li_and_her_eldest_son_bring_them_to_the_teahouse_for_the_evening():
    routines = {
        p["id"]: [(e["hour"], e["act"], e["place"]) for e in p["routine"]]
        for p in data.CAST["people"]
    }
    assert routines["li_laotai"] == [
        (6, "meal", "p_li_house"),
        (7, "pray", "p_temple"),
        (9, "rest", "p_li_house"),
        (12, "meal", "p_li_house"),
        (13, "rest", "p_li_house"),
        (15, "tea", "p_teahouse"),  # and no going home at five: she stays until dinner
        (19, "meal", "p_li_house"),
        (21, "sleep", "p_li_house"),
    ]
    assert routines["li_da"] == [
        (6, "meal", "p_li_house"),
        (7, "work", "p_li_house"),
        (11, "work", "p_market"),
        (13, "meal", "p_li_house"),
        (14, "work", "p_li_house"),
        (
            16,
            "tea",
            "p_teahouse",
        ),  # he sets out at four, and is in the room when the evening begins
        (20, "rest", "p_li_house"),
        (21, "sleep", "p_li_house"),
    ]


def test_the_five_are_together_at_the_teahouse_from_half_past_five_to_seven_under_the_preset():
    game = slice_game()
    together = []
    while game.tick < at(1, 19, 0) + 30:
        tick = game.tick
        game.step()
        npcs = {n["id"]: n for n in state_of(game)["npcs"]["list"]}
        if all(
            npcs[who]["place"] == "p_teahouse"
            and gossip.at_goal(npcs[who])
            and not gossip.asleep(npcs[who])
            for who in FIVE
        ):
            together.append(tick)
    assert set(range(at(1, 17, 39), at(1, 18, 59))) <= set(together)
    # the clerk is the last to come (twenty-eight minutes past), Li Da has been there since four
    assert min(together) < at(1, 17, 40) and max(together) >= at(1, 18, 58)
    assert not [t for t in together if t < at(1, 17, 20) or t > at(1, 19, 5)]


# ------------------------------------------------------------------------------ the refusal


def refused(game):
    """The words over Granny Li's head after she is asked for the bamboo, and the event."""
    out = act(game, "entrust", kind="lend")
    assert acks(out) == [("rejected", "hard")]
    (event,) = events(out, "entrusted")
    (bubble,) = (b for b in out["frame"]["bubbles"] if b["npc"] == "li_laotai")
    return event, bubble["text"]


def test_at_dawn_granny_li_refuses_and_names_the_rumour_and_the_managers_silence():
    game = met("li_laotai", 6, 30)
    event, words = refused(game)
    assert event["result"] == "hard" and event["way"] == ""
    assert words in voices.variants("li_laotai", RUMOUR_LINE)
    assert words not in voices.variants("li_laotai", "hard_hc_li_bamboo")
    assert any(
        "一声不吭" in v["zh"] and "老二" in v["zh"]
        for v in voices.variants("li_laotai", RUMOUR_LINE)
    )
    assert persuade.refusal(state_of(game), "hc_li_bamboo") == RUMOUR_LINE


def test_her_refusal_is_the_old_one_when_she_has_not_heard_of_the_rumour_or_the_manager_spoke():
    game = bridge(
        SEED, variant="v_boat"
    )  # the same town without the opening: she has heard nothing
    run_to(game, at(1, 6, 30))
    meet(game, "li_laotai")
    assert persuade.refusal(state_of(game), "hc_li_bamboo") == "hard_hc_li_bamboo"
    assert refused(game)[1] in voices.variants("li_laotai", "hard_hc_li_bamboo")
    faint = met("li_laotai", 6, 30)
    believe(faint, "li_laotai", JEALOUS, 20, "heard", "cha_laoban", "zhou_huoji", 5)
    assert persuade.refusal(state_of(faint), "hc_li_bamboo") == "hard_hc_li_bamboo"  # barely heard
    spoke = met("li_laotai", 6, 30)
    me(spoke)["public"]["speeches"].append([0, "p_teahouse", 1, 0, 0, False])
    assert persuade.refusal(state_of(spoke), "hc_li_bamboo") == "hard_hc_li_bamboo"  # not silent
    event, words = refused(spoke)
    assert words in voices.variants("li_laotai", "hard_hc_li_bamboo")
