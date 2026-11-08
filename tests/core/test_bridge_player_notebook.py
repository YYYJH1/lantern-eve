"""The notebook of the festival manager: listening, asking, tracing a rumour, the four marks."""

import json

import pytest
from bridge_helpers import CAST, CLEAR, CYCLE, at, bridge, npc_of, run_to, state_of, step
from player_helpers import ack, act, add_telling, beside, doc_scene, events, me, put, seed_of
from voice_helpers import claimed, says, says_pointing

from lantern_core.api import Game
from lantern_core.cognition import paths, provenance
from lantern_core.cognition.beliefs import Belief, Claim
from lantern_core.cognition.props import Prop
from lantern_core.world.bridge import answers, clock, evidence, notebook, notes, social
from lantern_core.world.bridge.lore import lore

LORE = lore()
VARIANTS = ("v_boat", "v_flood", "v_drunk")


def first_telling(game, limit=1500):
    """Run until somebody tells somebody something. The ``told`` event; the game stands after it."""
    while game.tick < limit:
        out = step(game)
        told = events(out, "told")
        if told:
            return told[0], out
    raise AssertionError("nobody told anybody anything")


def near_speaker(game, event):
    beside(game, event["speaker"], dx=1)


# ------------------------------------------------------------------------------ listening


def test_the_player_hears_a_telling_nearby_and_writes_it_down_as_heard_from_the_speaker():
    game = bridge(3, **CLEAR)
    told, out = first_telling(game)
    assert out["frame"]["bubbles"], "the telling shows words over the speaker"
    near_speaker(game, told)
    assert "listen" in step(game)["frame"]["hud"]["verbs"]
    out = act(game, "listen")
    assert ack(out) == ("applied", None)
    (heard,) = events(out, "heard")
    assert (heard["speaker"], heard["listener"], heard["claim"]) == (
        told["speaker"],
        told["listener"],
        told["claim"],
    )
    claim_note = state_of(game)["social"]["claims"][told["claim"]]
    assert heard["source"] == notes.decode_claim(told["claim"], claim_note).claimed_source
    section = me(game)
    (entry,) = section["notebook"]
    assert entry["id"] == "n1" and entry["prop"] == told["prop"] == heard["prop"]
    belief = notebook.belief_of(entry)
    claim = notes.decode_claim(told["claim"], state_of(game)["social"]["claims"][told["claim"]])
    assert (belief.source, belief.teller, belief.claimed_source) == (
        "heard",
        told["speaker"],
        claim.claimed_source,
    )
    assert (
        belief.claim == told["claim"]
        and belief.hop >= 1
        and belief.modality in ("assert", "speculate")
    )
    assert section["heard"] == [told["claim"]]
    (shown,) = out["frame"]["notebook"]
    assert shown["id"] == "n1" and shown["source"]["kind"] == "heard"
    assert shown["source"]["who"]["id"] == told["speaker"]
    assert shown["source"]["hand"] == belief.hop
    assert shown["text"]["zh"].endswith("。") and shown["text"]["en"].endswith(".")
    assert shown["text"]["en"][0].isupper()


def test_what_is_heard_walks_back_through_the_record_of_the_town_to_somebody_who_knew():
    for seed in (3, 4, 5):
        game = bridge(seed, **CLEAR)
        told, _ = first_telling(game)
        near_speaker(game, told)
        act(game, "listen")
        world_state = state_of(game)
        section = world_state["social"]
        stores = {**social.stores(section), notebook.PLAYER_ID: notebook.store(me(game))}
        trace = provenance.walk_back(
            notebook.PLAYER_ID, told["prop"], stores, social.claims(section), social.book(section)
        )
        assert trace.hops[0].holder == notebook.PLAYER_ID
        assert trace.hops[1].holder == told["speaker"]
        assert trace.end in provenance.ENDS and trace.end != "broken"


def test_nothing_is_heard_out_of_earshot_after_the_words_are_gone_or_twice():
    game = bridge(3, **CLEAR)
    told, _ = first_telling(game)
    put(game, 0, 0)
    assert ack(act(game, "listen")) == ("rejected", "nothing_to_hear")
    near_speaker(game, told)
    assert ack(act(game, "listen")) == ("applied", None)
    assert ack(act(game, "listen")) == ("rejected", "nothing_to_hear")  # it is in the book now
    assert [e["prop"] for e in me(game)["notebook"]] == [told["prop"]]
    other = bridge(3, **CLEAR)
    told, _ = first_telling(other)
    near_speaker(other, told)
    run_to(other, other.tick + 61)  # the words of that speaker are gone, whatever else was said
    expected = social_bubbles(other)
    out = act(other, "listen")
    assert (ack(out) == ("applied", None)) == bool(expected)


def social_bubbles(game):
    """The claims whose words are up and in earshot of the player now."""
    from lantern_core.world.bridge import overhear

    return overhear.audible(state_of(game), game.tick)


def test_the_player_hears_only_at_the_hearing_range_of_either_of_the_two():
    game = bridge(3, **CLEAR)
    told, _ = first_telling(game)
    speaker, listener = npc_of(game, told["speaker"]), npc_of(game, told["listener"])
    for who, expect in ((speaker, True), (listener, True)):
        put(game, who["x"] + 4, who["y"])
        assert bool(social_bubbles(game)) == expect
    put(game, speaker["x"] + 30, speaker["y"] + 10)
    assert not social_bubbles(game)


def test_the_player_who_is_in_a_conversation_hears_nothing_of_what_others_say():
    game = doc_scene()
    assert "listen" in step(game)["frame"]["hud"]["verbs"]
    talk_to(game, "zhou_zhanggui")
    assert "listen" not in step(game)["frame"]["hud"]["verbs"]
    assert ack(act(game, "listen")) == ("rejected", "talking")
    assert me(game)["notebook"] == []
    act(game, "leave")
    assert ack(act(game, "listen")) == ("applied", None)  # the words are still up


# ------------------------------------------------------------------------------ the document's case


def test_the_shopkeepers_rumour_shows_only_the_tutorials_mark_until_the_manager_judges():
    game = doc_scene()
    out = act(game, "listen")
    assert ack(out) == ("applied", None)
    (entry,) = out["frame"]["notebook"]
    assert entry["id"] == "n1"
    assert entry["text"] == {
        "zh": "李二昨夜弄坏了石桥栏杆。",
        "en": "Li Er damaged the Stone Bridge Railing last night.",
    }
    assert entry["source"] == {
        "kind": "heard",
        "who": {"zh": "周掌柜", "en": "Shopkeeper Zhou", "id": "zhou_zhanggui"},
        "hand": 2,
    }
    clerk = {"zh": "周家伙计", "en": "Zhou's Clerk", "id": "zhou_huoji"}
    assert entry["chain"][1:] == [clerk, None]  # the clerk is named, and has not been asked
    assert entry["marks"] == []  # the notebook marks nothing the manager has not judged
    beside(game, "zhou_huoji")
    assert ack(act(game, "talk", npc="zhou_huoji")) == ("applied", None)
    out = act(game, "ask_source", entry="n1")
    assert ack(out) == ("applied", None)
    first, second = out["frame"]["notebook"]
    # the script shows the one relation of its tutorial: what the clerk saw does not show that
    # Li Er broke the rail. The others are for the manager to judge.
    assert first["marks"] == ["unsupported"]  # the demonstration of the script
    assert first["chain"][1:] == [clerk]  # asked: he says he saw it, so nothing is left to ask
    assert (
        second["id"] == "n2" and second["text"]["en"] == "Li Er was at the Stone Bridge last night."
    )
    assert second["source"]["who"]["id"] == "zhou_huoji" and second["source"]["hand"] == 1
    assert second["marks"] == [] and second["chain"] == [clerk]
    claimed(out, game, "zhou_huoji", "pr_liner_at_bridge", "self_seen", lead="not_said")
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "zhou_huoji"]
    assert "李二昨夜在石桥" in said["text"]["zh"]
    assert "Li Er was at the Stone Bridge last night" in said["text"]["en"]
    (asked,) = events(out, "asked")
    assert (asked["npc"], asked["answer"], asked["path"], asked["prop"], asked["source"]) == (
        "zhou_huoji",
        "claim",
        "belief",
        "pr_liner_at_bridge",
        "self_seen",
    )
    judged = act(game, "judge", a="n2", b="n1", relation="mismatch")
    assert ack(judged) == ("applied", None)
    assert events(judged, "judged")[0]["relation"] == "mismatch"
    assert judged["frame"]["notebook"][0]["marks"] == ["unsupported", "sourceMismatch"]


def talk_to(game, npc_id):
    beside(game, npc_id)
    assert ack(act(game, "talk", npc=npc_id)) == ("applied", None)


def entry_of(out, entry_id):
    return next(e for e in out["frame"]["notebook"] if e["id"] == entry_id)


def test_asking_the_one_who_is_not_next_on_the_trail_does_not_move_the_trail():
    game = doc_scene()
    act(game, "listen")
    before = entry_of(step(game), "n1")["chain"]
    out = act(game, "ask_source", entry="n1")  # still beside the shopkeeper, who told the player
    assert ack(out) == ("rejected", "not_talking")
    talk_to(game, "zhou_zhanggui")
    out = act(game, "ask_source", entry="n1")
    assert ack(out) == ("applied", None)
    assert entry_of(out, "n1")["chain"] == before  # the clerk is still the one to ask
    (asked,) = events(out, "asked")
    assert (
        asked["entry"] == "n1" and asked["new"] is False
    )  # he says it again, and it is in already
    claimed(out, game, "zhou_zhanggui", "pr_liner_damaged", "zhou_zhanggui")  # his own idea


def test_a_trail_that_leads_to_somebody_who_knows_nothing_goes_cold():
    game = doc_scene(named="mujiang")
    act(game, "listen")
    assert entry_of(step(game), "n1")["chain"][-1] is None
    act(game, "leave") if me(game)["talk"] else None
    talk_to(game, "mujiang")
    out = act(game, "ask_source", entry="n1")
    assert ack(out) == ("applied", None)
    (asked,) = events(out, "asked")
    assert asked["answer"] == "ignorant" and asked["prop"] is None and asked["entry"] is None
    chain = entry_of(out, "n1")["chain"]
    assert [c["id"] for c in chain] == ["zhou_zhanggui", "mujiang"]  # no more to ask
    assert (
        "sourceMismatch" not in entry_of(out, "n1")["marks"]
    )  # he said nothing: nothing on record
    says_pointing(out, "mujiang", "point_hub", "cha_laoban")  # and he sends the manager on
    assert len(out["frame"]["notebook"]) == 1


def test_two_people_who_name_each_other_make_a_circle_that_is_shown_as_it_is():
    game = doc_scene()
    state_of(game)["social"]["beliefs"]["zhou_huoji"]["pr_liner_damaged"] = notes.encode_belief(
        notes.decode_belief(
            "zhou_huoji", "pr_liner_damaged", "assert|70|heard|zhou_zhanggui|zhou_zhanggui|1|35|c2"
        )
    )
    act(game, "listen")
    talk_to(game, "zhou_huoji")
    out = act(game, "ask_source", entry="n1")
    chain = entry_of(out, "n1")["chain"]
    assert [c["id"] for c in chain] == ["zhou_zhanggui", "zhou_huoji", "zhou_zhanggui"]
    assert entry_of(out, "n1")["marks"] == []  # the clerk agrees: nothing to judge


def test_a_person_who_says_they_saw_it_confirms_it_even_when_it_is_a_lie():
    game = doc_scene()
    state_of(game)["social"]["bubbles"].clear()
    talk_to(game, "zhou_zhanggui")
    out = act(game, "ask", topic="pr_liner_at_bridge")  # he heard it from the clerk
    (asked,) = events(out, "asked")
    assert (asked["path"], asked["prop"]) == ("lie", "pr_liner_at_bridge")
    claimed(out, game, "zhou_zhanggui", "pr_liner_at_bridge", "self_seen")  # a lie: he saw it
    (entry,) = out["frame"]["notebook"]
    assert entry["marks"] == []  # nobody confirms it for the player, and nobody doubts it
    assert [c["id"] for c in entry["chain"]] == ["zhou_zhanggui"]
    claim = notebook.answer(me(game), "p1")
    assert (claim.path, claim.modality, claim.claimed_source, claim.template_id) == (
        "lie",
        "lie",
        "self_seen",
        "lie_zhang_saw_liner",
    )


# ------------------------------------------------------------------------------ looking


def at_the_bridge_water(variant, hour=9, day=3):
    """A game of ``variant`` at ``hour`` o'clock of ``day`` (the third: the water has fallen far
    enough to see the pier), with the player on the bridge over the water."""
    game = bridge(seed_of(variant), **CLEAR)
    run_to(game, at(day, hour))
    put(game, 27, 16)
    return game


def run_the_look(game):
    """Run until the inspection ends. The ``inspected`` event and the ticks it took."""
    start = game.tick
    while me(game)["busy"]:
        out = step(game)
        done = events(out, "inspected")
        if done:
            return done[0], game.tick - start
    raise AssertionError("no inspection")


@pytest.mark.parametrize("variant", VARIANTS)
def test_a_look_finds_what_is_real_in_this_game_and_the_gates_do_not_tell_which_game_it_is(variant):
    game = at_the_bridge_water(variant)
    out = act(game, "look", at="p_under_bridge")
    assert ack(out) == ("applied", None)
    assert out["frame"]["player"]["activity"] == "work"
    assert [
        v for v in out["frame"]["hud"]["verbs"] if v != "track"
    ] == []  # (picking costs nothing)
    done, ticks = run_the_look(game)
    assert ticks == 80 == 40 * 2  # the minutes of the item, two ticks a minute by day
    flood = variant == "v_flood"
    assert done["found"] == (["e_flood_debris"] if flood else [])
    assert [(e["prop"]) for e in me(game)["notebook"]] == (
        ["pr_flood_damaged", "pr_flooded"] if flood else []
    )
    out = step(game)
    assert out["frame"]["player"]["activity"] == "rest"
    for entry in out["frame"]["notebook"]:
        assert entry["source"] == {"kind": "seen"} and entry["chain"] == []
        assert "unsupported" not in entry["marks"] and "unconfirmed" not in entry["marks"]
    assert me(game)["evidence"] == (["e_flood_debris"] if flood else [])


def test_what_has_been_looked_at_is_not_offered_again_and_the_offer_does_not_say_what_was_there():
    for variant in VARIANTS:
        game = at_the_bridge_water(variant, day=2)
        # on the second day the water is offered though it is still high (an offer does not say),
        # and the rail has its footprint to look for
        assert evidence.in_reach(game._kernel.world, me(game), clock.at(game.tick)) == [
            "p_under_bridge",
            "t_rail",
        ]
        game = at_the_bridge_water(variant)
        assert evidence.in_reach(game._kernel.world, me(game), clock.at(game.tick)) == [
            "p_under_bridge"  # the footprint is trodden out from the third day
        ]
        act(game, "look", at="p_under_bridge")
        run_the_look(game)
        # found or not, the water is looked at, and there is nothing left to offer
        assert evidence.in_reach(game._kernel.world, me(game), clock.at(game.tick)) == []
        assert me(game)["looked"] == ["e_flood_debris"]
        assert ack(act(game, "look", at="p_under_bridge")) == ("rejected", "nothing_here")
        assert step(game)["frame"]["player"]["look"] == []


def test_looking_is_by_the_hours_of_the_item_and_by_when_it_goes():
    game = at_the_bridge_water("v_flood", hour=6)
    assert ack(act(game, "look", at="p_under_bridge")) == ("rejected", "closed")  # opens at 07:00
    assert me(game)["busy"] == {}
    run_to(game, at(3, 7) + 1)
    assert ack(act(game, "look", at="p_under_bridge")) == ("applied", None)
    run_the_look(game)
    late = at_the_bridge_water("v_flood", hour=18)
    assert ack(act(late, "look", at="p_under_bridge")) == ("rejected", "closed")  # shut at 18:00
    # and the day: the water is too high to see the pier before the third
    early = at_the_bridge_water("v_flood", hour=9, day=2)
    assert ack(act(early, "look", at="p_under_bridge")) == ("rejected", "closed")
    assert me(early)["busy"] == {} and me(early)["looked"] == []
    # the footprint by the rail is gone from the third day on, whatever the hour
    rail = at_the_bridge_water("v_drunk", hour=17, day=2)
    assert ack(act(rail, "look", at="t_rail")) == ("applied", None)
    done, _ = run_the_look(rail)
    assert done["found"] == ["e_footprint"]
    after = at_the_bridge_water("v_drunk", hour=8, day=3)
    assert ack(act(after, "look", at="t_rail")) == ("rejected", "closed")
    assert step(after)["frame"]["player"]["look"] == ["p_under_bridge"]  # gone: not offered


def test_the_game_minute_counts_from_midnight_of_the_first_day_and_the_small_hours_are_the_next():
    assert evidence.game_minute(clock.at(0)) == 6 * 60
    assert evidence.game_minute(clock.at(at(2, 8))) == 1440 + 8 * 60
    night = clock.at(at(1, 23))
    assert evidence.game_minute(night) == 23 * 60
    small = clock.at(at(1, 2, 30))
    assert (small.day, small.hour, small.phase) == (1, 2, "night") and evidence.game_minute(
        small
    ) == 1440 + 150
    assert evidence.ticks_for(40, clock.at(0)) == 80 and evidence.ticks_for(40, night) == 20


def test_a_gatekeeper_who_does_not_trust_the_player_refuses_and_a_little_chat_opens_the_boat():
    game = bridge(seed_of("v_boat"), **CLEAR)
    boat = (30, 29)
    for day, expected in ((1, "refused"), (2, None)):
        run_to(game, at(day, 9))
        beside(game, "old_he")
        npc = npc_of(game, "old_he")
        assert npc["place"] == "p_ferry", npc  # at work by the water
        assert ack(act(game, "talk", npc="old_he")) == ("applied", None)
        act(game, "leave")
        put(game, *boat)
        out = act(game, "look", at="t_he_boat")
        if expected:
            assert ack(out) == ("rejected", "refused")
            assert events(out, "look_refused") == [
                {"kind": "look_refused", "tick": game.tick - 1, "at": "t_he_boat", "npc": "old_he"}
            ]
            (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "old_he"]
            assert said["text"]["zh"] and said["text"]["en"]
            assert me(game)["busy"] == {} and me(game)["trust"][CAST.index["old_he"]] == 13
        else:
            assert me(game)["trust"][CAST.index["old_he"]] == 16 >= 15
            assert ack(out) == ("applied", None)
            done, ticks = run_the_look(game)
            assert done["found"] == ["e_boat_scratches"] and ticks == 60
    (entry,) = [e for e in me(game)["notebook"]]
    assert entry["prop"] == "pr_boat_scratched" and notebook.belief_of(entry).source == "saw"


def test_an_item_needs_what_it_needs_before_it_can_be_got():
    world = bridge(1)._kernel.world
    item = next(e for e in evidence.SCRIPT["evidence"] if e["id"] == "e_huoji_testimony")
    section = {"trust": [100] * 20, "evidence": []}
    midday = clock.at(at(1, 12))
    assert evidence.gate(world, section, item, midday) == "needs"
    section["evidence"].append("e_liner_testimony")
    assert evidence.gate(world, section, item, midday) is None
    section["trust"][CAST.index["zhou_zhanggui"]] = 29
    assert evidence.gate(world, section, item, midday) == "refused"


def test_a_person_held_item_is_not_looked_at_and_everything_that_is_held_has_a_place():
    assert set(evidence.holders()) == {"p_under_bridge", "t_he_boat", "t_rail", "t_repair_ledger"}
    world = bridge(1)._kernel.world
    for holder in evidence.holders():
        assert evidence.place_of(world, holder) in world.town.places
    for item in evidence.SCRIPT["evidence"]:
        holder = item["acquire"]["from"]
        assert (holder in evidence.holders()) == (LORE.book.registry.type_of(holder) != "person")


def test_while_inspecting_the_player_can_do_nothing_else_and_far_or_unknown_targets_are_refused():
    game = at_the_bridge_water(
        "v_flood", day=2
    )  # (the footprint is there to look at till the third)
    assert ack(act(game, "look", at="p_market")) == ("rejected", "far")
    assert ack(act(game, "look", at="li_er")) == ("rejected", "unknown_target")
    put(game, 20, 20)
    assert ack(act(game, "look", at="p_market")) == ("rejected", "nothing_here")
    put(game, 27, 16)
    act(game, "look", at="t_rail")
    for kind, fields in (
        ("move", {"place": "p_teahouse"}),
        ("talk", {"npc": "zhou_zhanggui"}),
        ("listen", {}),
        ("look", {"at": "p_under_bridge"}),
    ):
        assert ack(act(game, kind, **fields)) == ("rejected", "busy")
    assert (me(game)["x"], me(game)["y"]) == (27, 16)


def test_a_sighting_replaces_what_was_heard_of_the_same_prop_and_keeps_the_entrys_number():
    game = at_the_bridge_water("v_flood")
    social_ = state_of(game)["social"]
    from lantern_core.cognition.beliefs import Belief

    heard = Belief("player", "pr_flooded", "assert", 60, "heard", "li_da", "unknown", 1, 5, None)
    notebook.add_heard(me(game), heard)
    assert [e["id"] for e in me(game)["notebook"]] == ["n1"]
    assert step(game)["frame"]["notebook"][0]["marks"] == []
    act(game, "look", at="p_under_bridge")
    run_the_look(game)
    first, second = step(game)["frame"]["notebook"]
    assert (first["id"], first["source"], first["chain"]) == ("n1", {"kind": "seen"}, [])
    assert second["id"] == "n2" and "unsupported" not in first["marks"]
    assert social_ is state_of(game)["social"]


# ------------------------------------------------------------------------------ asking


def test_asking_needs_a_conversation_a_topic_the_game_knows_and_an_entry_that_is_in_the_book():
    game = doc_scene()
    assert ack(act(game, "ask", topic="pr_liner_damaged")) == ("rejected", "not_talking")
    talk_to(game, "zhou_zhanggui")
    assert ack(act(game, "ask", topic="pr_nothing_of_the_kind")) == ("rejected", "unknown_topic")
    assert ack(act(game, "ask_source", entry="n9")) == ("rejected", "no_entry")
    assert me(game)["notebook"] == [] and me(game)["claims"] == {}


def test_a_person_answers_a_question_about_a_prop_with_what_they_hold_and_how_they_know_it():
    game = doc_scene()
    talk_to(game, "zhou_huoji")
    out = act(game, "ask", topic="pr_liner_looking")
    assert ack(out) == ("applied", None)
    claimed(out, game, "zhou_huoji", "pr_liner_looking", "self_seen")
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "zhou_huoji"]
    assert "李二昨夜在石桥找掉进水里的灯笼" in said["text"]["zh"]
    assert (
        "Li Er was looking for the Lost Lantern at the Stone Bridge last night"
        in (said["text"]["en"])
    )
    assert said["until"] == me(game)["talk"]["until"]  # it stays up as long as they talk
    (entry,) = out["frame"]["notebook"]
    assert entry["source"]["who"]["id"] == "zhou_huoji" and entry["source"]["hand"] == 1
    assert entry["marks"] == [] and [c["id"] for c in entry["chain"]] == ["zhou_huoji"]
    claim = notebook.answer(me(game), "p1")
    assert (claim.speaker, claim.listeners, claim.path, claim.claimed_source) == (
        "zhou_huoji",
        ("player",),
        "belief",
        "self_seen",
    )
    # a second question about the same thing writes nothing new
    out = act(game, "ask", topic="pr_liner_looking")
    assert events(out, "asked")[0]["new"] is False and len(out["frame"]["notebook"]) == 1


def test_an_entry_of_the_notebook_stands_for_the_prop_it_says_when_asked_about():
    game = doc_scene()
    act(game, "listen")
    talk_to(game, "zhou_huoji")
    out = act(game, "ask", topic="n1")  # what the shopkeeper said: the clerk never said it
    (asked,) = events(out, "asked")
    assert (asked["topic"], asked["prop"], asked["new"]) == (
        "pr_liner_damaged",
        "pr_liner_at_bridge",
        True,
    )
    claimed(out, game, "zhou_huoji", "pr_liner_at_bridge", "self_seen")


def test_asked_about_a_subject_a_person_says_the_weightiest_thing_and_then_the_next():
    game = doc_scene()
    talk_to(game, "zhou_huoji")
    said = []
    for _ in range(4):
        out = act(game, "ask", topic="li_er")
        (asked,) = events(out, "asked")
        said.append((asked["prop"], asked["new"]))
    assert said == [
        ("pr_liner_at_bridge", True),
        ("pr_liner_looking", True),
        ("pr_liner_at_bridge", False),
        ("pr_liner_at_bridge", False),
    ]


def test_old_he_lies_that_he_was_home_and_pretends_not_to_know_who_broke_the_rail():
    game = bridge(seed_of("v_boat"), **CLEAR)
    run_to(game, 60)
    social_ = state_of(game)["social"]
    social_["next"] = [10**9] * 20
    talk_to(game, "old_he")
    out = act(game, "ask", topic="pr_he_under_bridge")
    (asked,) = events(out, "asked")
    assert (asked["answer"], asked["path"], asked["prop"]) == ("claim", "lie", "pr_he_home")
    claim = notebook.answer(me(game), "p1")
    assert (claim.modality, claim.claimed_source, claim.template_id) == (
        "lie",
        "self_seen",
        "lie_he_home",
    )
    claimed(out, game, "old_he", "pr_he_home", "self_seen")
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "old_he"]
    assert "I was at home last night" in said["text"]["en"]
    # he believes the truth, and the truth is not what the player is told
    assert social_["beliefs"]["old_he"]["pr_he_under_bridge"].startswith("assert|")
    for topic in ("pr_boat_damaged", "t_rail"):
        out = act(game, "ask", topic=topic)
        (asked,) = events(out, "asked")
        assert (asked["answer"], asked["path"], asked["prop"]) == ("ignorant", "ignorance", None)
        says_pointing(out, "old_he", "point_hub", "cha_laoban")  # as one who knows nothing would
    assert [e["prop"] for e in me(game)["notebook"]] == ["pr_he_home"]


def test_somebody_with_nothing_to_hide_tells_what_a_liar_would_have_denied():
    game = bridge(seed_of("v_flood"), **CLEAR)
    run_to(game, 60)
    state_of(game)["social"]["next"] = [10**9] * 20
    talk_to(game, "old_he")
    out = act(game, "ask", topic="pr_he_under_bridge")
    (asked,) = events(out, "asked")
    assert (asked["path"], asked["prop"]) == ("belief", "pr_he_home")  # the truth, here
    claimed(out, game, "old_he", "pr_he_home", "self_seen", lead="not_so")
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "old_he"]
    assert "I was at home last night" in said["text"]["en"]


def test_the_drunk_son_denies_what_he_did_and_declines_to_speak_of_what_blames_him():
    game = bridge(seed_of("v_drunk"), **CLEAR)
    run_to(game, at(1, 10))  # he sleeps late
    state_of(game)["social"]["next"] = [10**9] * 20
    talk_to(game, "zhou_dalang")
    for topic, path, prop in (
        ("pr_dalang_at_bridge", "lie", "pr_dalang_not_bridge"),
        ("pr_dalang_drank", "lie", "pr_dalang_not_drank"),
    ):
        (asked,) = events(act(game, "ask", topic=topic), "asked")
        assert (asked["answer"], asked["path"], asked["prop"]) == ("claim", path, prop)
    out = act(game, "ask", topic="pr_dalang_damaged")
    (asked,) = events(out, "asked")
    assert (asked["answer"], asked["path"], asked["prop"]) == ("evasive", "", None)
    says(out, "zhou_dalang", "evade")
    denial = next(e for e in me(game)["notebook"] if e["prop"] == "pr_dalang_not_bridge")
    assert (
        notebook.belief_of(denial).modality == "assert"
    )  # the player cannot tell a lie from the rest


@pytest.fixture(scope="module")
def after_two_days():
    game = bridge(7, **CLEAR)
    run_to(game, 2 * CYCLE)
    return game


def test_everyone_answers_every_topic_by_a_path_the_checker_passes_and_gives_no_secret_away(
    after_two_days,
):
    world_state = state_of(after_two_days)
    social_ = world_state["social"]
    props = notebook.view(social_)
    topics = sorted(props) + sorted(entity.id for entity in LORE.book.registry)
    kinds = {}
    for speaker in LORE.people:
        store = notes.store(social_, speaker)
        for topic in topics:
            reply = answers.reply(world_state, after_two_days.tick, speaker, topic)
            kinds[reply.kind, reply.path] = kinds.get((reply.kind, reply.path), 0) + 1
            if reply.claim is None:
                if reply.path == "ignorance":
                    pretence = LORE.book.templates[reply.template]
                    assert pretence.holder == speaker and pretence.kind == "feign_ignorance"
                continue
            claim = reply.claim
            ok, why = paths.authorize(
                claim,
                store,
                props,
                tables=LORE.tables,
                registry=LORE.book.registry,
                rules=LORE.book.rules,
                templates=LORE.book.templates,
                suspicion=LORE.traits[speaker]["suspicion"],
                public=LORE.public,
            )
            assert ok, (speaker, topic, why)
            assert claim.speaker == speaker and claim.listeners == ("player",)
            if claim.path == "belief":
                assert not LORE.guards(speaker, props[claim.prop]), (speaker, topic)
                assert store.get(claim.prop).confidence > 0
            else:
                template = LORE.book.templates[reply.template]
                assert claim.path == "lie" and template.holder == speaker
                assert template.prop == claim.prop
    assert kinds[("claim", "belief")] > 100 and kinds[("claim", "lie")] > 10
    assert kinds[("ignorant", "")] > 100 and ("evasive", "") in kinds


def test_the_same_question_gets_the_same_answer_from_an_identical_game(after_two_days):
    twin = bridge(7, **CLEAR)
    run_to(twin, 2 * CYCLE)
    for speaker in ("cha_laoban", "old_he", "zhou_zhanggui"):
        for topic in ("li_er", "p_bridge", "pr_liner_damaged", "t_rail"):
            ours = answers.reply(state_of(after_two_days), after_two_days.tick, speaker, topic)
            theirs = answers.reply(state_of(twin), twin.tick, speaker, topic)
            assert ours == theirs


# ------------------------------------------------------------------------------ the marks


def marks_of(game, entry_id):
    return next(e for e in step(game)["frame"]["notebook"] if e["id"] == entry_id)["marks"]


def test_two_entries_that_cannot_both_be_true_contradict_each_other_once_the_manager_says_so():
    game = bridge(seed_of("v_boat"), **CLEAR)
    run_to(game, at(1, 10) + 40)  # the child is up
    state_of(game)["social"]["next"] = [10**9] * 20
    talk_to(game, "old_he")
    act(game, "ask", topic="pr_he_under_bridge")  # he says he was at home
    act(game, "leave")
    talk_to(game, "xiao_man")
    act(game, "ask", topic="pr_he_under_bridge")  # the child saw him under the bridge
    first, second = step(game)["frame"]["notebook"]
    assert first["text"]["en"].startswith("Boatman He was at home")
    assert second["text"]["en"].startswith("Boatman He was at the Water Beneath the Bridge")
    assert first["marks"] == [] and second["marks"] == []  # nothing is marked until it is judged
    assert second["source"]["who"]["id"] == "xiao_man"
    out = act(game, "judge", a="n1", b="n2", relation="contradicts")
    assert ack(out) == ("applied", None)
    assert marks_of(game, "n1") == ["contradicts"] and marks_of(game, "n2") == ["contradicts"]
    assert ack(act(game, "judge", a="n2", b="n1", relation="contradicts")) == ("applied", None)


def test_what_is_seen_and_what_clashes_with_it_are_judged_whoever_said_it():
    game = at_the_bridge_water("v_flood")
    act(game, "look", at="p_under_bridge")
    run_the_look(game)  # the timber: the flood did it
    assert {e["prop"]: e["marks"] for e in zip_props(game)} == {
        "pr_flood_damaged": [],
        "pr_flooded": [],
    }
    # somebody says it was the boat: that clashes with what the player saw, and with nothing else
    heard = Belief("player", "pr_boat_damaged", "assert", 60, "heard", "li_da", "unknown", 1, 9)
    notebook.add_heard(me(game), heard)
    assert all(not marks for marks in (e["marks"] for e in zip_props(game)))
    ids = {e["prop"]: e["id"] for e in me(game)["notebook"]}
    flood, flooded, boat = ids["pr_flood_damaged"], ids["pr_flooded"], ids["pr_boat_damaged"]
    assert ack(act(game, "judge", a=flood, b=boat, relation="contradicts")) == ("applied", None)
    marks = {e["prop"]: e["marks"] for e in zip_props(game)}
    assert marks["pr_boat_damaged"] == ["contradicts"]
    assert marks["pr_flood_damaged"] == ["contradicts"]  # what the player saw, and what clashes
    assert marks["pr_flooded"] == []
    # the high water alone clashes with nothing
    out = act(game, "judge", a=flooded, b=boat, relation="contradicts")
    assert ack(out) == ("rejected", "not_shown")


def zip_props(game):
    out = step(game)["frame"]["notebook"]
    return [
        {"prop": entry["prop"], "marks": wire["marks"]}
        for entry, wire in zip(me(game)["notebook"], out, strict=True)
    ]


def test_a_prop_made_on_the_way_clashes_with_what_its_twin_in_the_script_clashes_with():
    game = at_the_bridge_water("v_flood")
    social_ = state_of(game)["social"]
    made = Prop.of(
        "pr_boat_damaged__lv",
        "damaged",
        {"who": "old_he", "what": "t_rail"},
        parent="pr_boat_damaged",
        op="level",
    )
    social_["props"][made.id] = notes.encode_prop(made)
    act(game, "look", at="p_under_bridge")
    run_the_look(game)
    heard = Belief("player", made.id, "assert", 50, "heard", "cha_laoban", "unknown", 2, 20, None)
    notebook.add_heard(me(game), heard)
    ids = {e["prop"]: e["id"] for e in me(game)["notebook"]}
    out = act(game, "judge", a=ids["pr_flood_damaged"], b=ids[made.id], relation="contradicts")
    assert ack(out) == ("applied", None)
    marks = {e["prop"]: e["marks"] for e in zip_props(game)}
    assert marks[made.id] == ["contradicts"]
    assert marks["pr_flood_damaged"] == ["contradicts"]
    # the groups of the script alone would not have seen it
    props = notebook.view(social_)
    groups = LORE.book.groups
    assert not groups.together(made.id, "pr_flood_damaged")
    assert notebook.TwinGroups(groups, props).together(made.id, "pr_flood_damaged")


def test_overhearing_both_sides_shows_the_mismatch_once_it_is_judged():
    game = doc_scene()
    clerk_said = Claim(
        "c1",
        "zhou_huoji",
        ("zhou_zhanggui",),
        "pr_liner_at_bridge",
        "assert",
        "self_seen",
        30,
        "belief",
    )
    add_telling(game, clerk_said)  # the player was by when the clerk told the shopkeeper
    state_of(game)["social"]["bubbles"].reverse()  # the shopkeeper's words are the newer ones
    assert ack(act(game, "listen")) == ("applied", None)
    assert ack(act(game, "listen")) == ("applied", None)
    first, second = step(game)["frame"]["notebook"]
    assert (first["text"]["en"], second["text"]["en"]) == (
        "Li Er damaged the Stone Bridge Railing last night.",
        "Li Er was at the Stone Bridge last night.",
    )
    assert first["marks"] == ["unsupported"] and second["marks"] == []  # the tutorial's one
    # the words of the shopkeeper are not what the clerk said, and the clerk's words are the
    # evidence: the other way round, the retelling is not what the evidence was made from
    assert ack(act(game, "judge", a="n1", b="n2", relation="mismatch")) == ("rejected", "not_shown")
    assert ack(act(game, "judge", a="n2", b="n1", relation="mismatch")) == ("applied", None)
    assert ack(act(game, "judge", a="n2", b="n1", relation="unsupported")) == ("applied", None)
    assert ack(act(game, "judge", a="n1", b="n2", relation="unsupported")) == (
        "rejected",
        "not_shown",
    )
    assert marks_of(game, "n1") == ["unsupported", "sourceMismatch"]
    assert marks_of(game, "n2") == []
    assert [row[:3] for row in me(game)["judgments"]] == [
        ["n2", "n1", "mismatch"],
        ["n2", "n1", "unsupported"],
    ]


def test_a_source_that_says_he_saw_the_very_thing_agrees_with_the_teller_and_is_no_mismatch():
    game = doc_scene()
    state_of(game)["social"]["bubbles"].clear()
    said = Claim(
        "c3",
        "zhou_zhanggui",
        ("cha_laoban",),
        "pr_liner_at_bridge",
        "assert",
        "zhou_huoji",
        game.tick,
        "belief",
    )
    add_telling(game, said)
    act(game, "listen")
    assert marks_of(game, "n1") == []
    talk_to(game, "zhou_huoji")
    act(game, "ask_source", entry="n1")
    entry = entry_of(step(game), "n1")
    assert entry["marks"] == []  # he said what the shopkeeper says
    assert [c["id"] for c in entry["chain"]] == ["zhou_zhanggui", "zhou_huoji"]
    assert len(step(game)["frame"]["notebook"]) == 1  # his answer is the entry that is there


def test_an_inspection_and_the_words_of_an_answer_survive_a_snapshot_and_finish_the_same():
    game = at_the_bridge_water("v_flood")
    act(game, "look", at="p_under_bridge")
    run_to(game, game.tick + 30)
    twin = Game.from_snapshot_json(game.snapshot_json())
    assert me(twin)["busy"] == me(game)["busy"] != {}
    for _ in range(60):
        assert json.loads(game.step()) == json.loads(twin.step())
    assert me(twin)["busy"] == {} and me(twin)["evidence"] == ["e_flood_debris"]
    assert twin.snapshot_json() == game.snapshot_json()
    # an answer that is on show when the game is saved is on show when it comes back
    asked = doc_scene()
    talk_to(asked, "zhou_huoji")
    act(asked, "ask", topic="pr_liner_looking")
    copy = Game.from_snapshot_json(asked.snapshot_json())
    ours = [b for b in step(asked)["frame"]["bubbles"] if b["npc"] == "zhou_huoji"]
    theirs = [b for b in step(copy)["frame"]["bubbles"] if b["npc"] == "zhou_huoji"]
    assert ours == theirs and len(ours) == 1


def test_a_rumour_is_traced_hop_by_hop_to_the_one_who_made_it_up():
    game = doc_scene(named="zhou_niangzi")
    social_ = state_of(game)["social"]
    notes.hold(
        social_,
        Belief("zhou_niangzi", "pr_liner_damaged", "assert", 60, "heard", "cha_laoban",
               "cha_laoban", 2, 30, "c1"),
    )  # fmt: skip
    notes.hold(
        social_,
        Belief("cha_laoban", "pr_liner_damaged", "assert", 60, "inferred", None, None, 1, 20, None),
    )
    act(game, "listen")
    assert chain_ids(step(game), "n1") == ["zhou_zhanggui", "zhou_niangzi", None]
    talk_to(game, "zhou_niangzi")
    out = act(game, "ask_source", entry="n1")
    assert chain_ids(out, "n1") == ["zhou_zhanggui", "zhou_niangzi", "cha_laoban", None]
    claimed(out, game, "zhou_niangzi", "pr_liner_damaged", "cha_laoban")
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "zhou_niangzi"]
    assert "Teahouse Keeper" in said["text"]["en"] and "茶馆老板娘" in said["text"]["zh"]
    assert "Li Er damaged the Stone Bridge Railing last night" in said["text"]["en"]
    assert [e["id"] for e in out["frame"]["notebook"]] == ["n1"]  # nothing new: it is the entry
    act(game, "leave")
    talk_to(game, "cha_laoban")
    out = act(game, "ask_source", entry="n1")
    assert chain_ids(out, "n1") == ["zhou_zhanggui", "zhou_niangzi", "cha_laoban"]  # her own idea
    claimed(out, game, "cha_laoban", "pr_liner_damaged", "cha_laoban")  # her own idea: "own"
    (said,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "cha_laoban"]
    assert "Li Er damaged the Stone Bridge Railing last night" in said["text"]["en"]
    assert entry_of(out, "n1")["marks"] == []  # nobody saw it, and the manager has judged nothing
    assert notebook.frontier(notebook.find(me(game), "n1")) is None  # and nobody is left to ask
    # asking her again does not add a hop
    again = act(game, "ask_source", entry="n1")
    assert chain_ids(again, "n1") == ["zhou_zhanggui", "zhou_niangzi", "cha_laoban"]


def chain_ids(out, entry_id):
    chain = entry_of(out, entry_id)["chain"]
    return [None if hop is None else hop["id"] for hop in chain]
