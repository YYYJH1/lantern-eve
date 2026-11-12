"""What the manager can find out: their own judgements of the notes, the hint, the two leaks of what
is true (the colour of a dot, and the words of tellings out of earshot), and the people who point
the way when they know nothing.

The judgements are checked by the logic of the two notes and never by what is true in the game, so
a judgement is right or wrong whichever story the game was made with. The marks of the notebook are
the judgements that were right and the one relation the script shows from the start.
"""

from __future__ import annotations

import json

import pytest
from agenda_helpers import frame_now, meet, slice_game, states, tasks_of
from bridge_helpers import at, bridge, run_to, state_of, step
from player_helpers import acks, act, add_telling, events, me, put, silence
from voice_helpers import says, says_pointing

from lantern_core import canon
from lantern_core.api import Game, InputError
from lantern_core.cognition.beliefs import Claim
from lantern_core.world.bridge import clock, judge, notebook, notes, phrases, pointers, voices
from lantern_core.world.bridge.data import SCRIPT
from lantern_core.world.bridge.lore import lore

LO = lore()
VARIANTS = ("v_boat", "v_flood", "v_drunk")
RELATIONS = ("unsupported", "contradicts", "mismatch")
PROVES = "t_what_proves"


def clerk_notes() -> Game:
    """The slice at noon with the three things the clerk of the Zhou shop says of Li Er: n1 what he
    heard from the second son (that Li Er broke the rail on purpose), n2 that he saw Li Er at the
    bridge, and n3 that Li Er was looking for his lantern there."""
    game = slice_game()
    run_to(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    for _ in range(3):
        act(game, "ask", topic="li_er")
    props = [e["prop"] for e in me(game)["notebook"]]
    assert props == ["pr_liner_damaged_on_purpose", "pr_liner_at_bridge", "pr_liner_looking"]
    return game


def madam_and_clerk() -> Game:
    """The slice with the madam's version of the rumour (n1) and the clerk's own words (n2)."""
    game = slice_game()
    run_to(game, at(1, 9))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")
    act(game, "leave")
    run_to(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    act(game, "ask_source", entry="n1")
    return game


def judged(game: Game, a: str, b: str, relation: str) -> tuple[str, str | None]:
    (only,) = acks(act(game, "judge", a=a, b=b, relation=relation))
    return only


def marks(game: Game) -> dict[str, list[str]]:
    return {e["id"]: e["marks"] for e in frame_now(game)["notebook"]}


# ------------------------------------------------------------ judging


def test_a_judgement_that_holds_is_kept_and_shown():
    game = clerk_notes()
    out = act(game, "judge", a="n2", b="n1", relation="unsupported")
    assert acks(out) == [("applied", None)]
    (event,) = events(out, "judged")
    assert (event["a"], event["b"], event["relation"]) == ("n2", "n1", "unsupported")
    assert me(game)["judgments"] == [["n2", "n1", "unsupported", event["tick"]]]
    assert out["frame"]["judgments"] == [
        {"a": "n2", "b": "n1", "relation": "unsupported", "made": event["tick"]}
    ]


def test_judging_the_same_thing_twice_keeps_it_once():
    game = clerk_notes()
    assert judged(game, "n3", "n1", "unsupported") == ("applied", None)
    out = act(game, "judge", a="n3", b="n1", relation="unsupported")
    assert acks(out) == [("applied", None)] and events(out, "judged") == []
    assert len(me(game)["judgments"]) == 1


def test_a_judgement_that_does_not_hold_is_turned_down_and_costs_nothing():
    game = clerk_notes()
    step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})
    before = canon.dumps_str(state_of(game)["player"])
    assert judged(game, "n2", "n1", "contradicts") == ("rejected", "not_shown")
    assert judged(game, "n2", "n1", "mismatch") == ("rejected", "not_shown")
    # the claim goes beyond the evidence and not the other way round
    assert judged(game, "n1", "n2", "unsupported") == ("rejected", "not_shown")
    assert judged(game, "n3", "n2", "unsupported") == ("rejected", "not_shown")
    assert judged(game, "n2", "n2", "unsupported") == ("rejected", "not_shown")  # a note and itself
    assert canon.dumps_str(state_of(game)["player"]) == before
    assert me(game)["judgments"] == []


def test_a_note_the_manager_does_not_hold_cannot_be_judged():
    game = clerk_notes()
    assert judged(game, "n9", "n1", "unsupported") == ("rejected", "unknown_note")
    assert judged(game, "n2", "n9", "unsupported") == ("rejected", "unknown_note")
    assert judged(game, "x", "y", "contradicts") == ("rejected", "unknown_note")
    assert me(game)["judgments"] == []


def test_a_relation_that_is_not_one_is_an_input_error():
    game = clerk_notes()
    for body in (
        {"a": "n1", "b": "n2", "relation": "friends"},
        {"a": "n1", "b": "n2"},
        {"a": 1, "b": "n2", "relation": "unsupported"},
        {"b": "n2", "relation": "unsupported"},
    ):
        with pytest.raises(InputError):
            act(game, "judge", **body)


def test_judging_costs_no_time_and_needs_no_talk():
    game = clerk_notes()
    act(game, "leave")
    step(game, {"seq": game.next_seq, "kind": "pause", "body": {}})
    tick, talk, busy = game.tick, dict(me(game)["talk"]), dict(me(game)["busy"])
    out = act(game, "judge", a="n2", b="n1", relation="unsupported")
    assert acks(out) == [("applied", None)] and not out["advanced"]
    assert game.tick == tick and me(game)["talk"] == talk == {} and me(game)["busy"] == busy
    assert out["clock"]["paused"] and me(game)["goal"] == [me(game)["x"], me(game)["y"]]


def test_judging_and_the_hint_owe_no_time_in_a_conversation_that_holds_the_world():
    """The acts of a conversation take minutes (``pace``), and these two are not among them: not
    when they are right and not when they are turned down."""
    game = clerk_notes()  # three questions to the clerk: their half hour is paid first
    while clock.owed(state_of(game)):
        game.step()
    assert me(game)["talk"]["npc"] == "zhou_huoji" and step(game)["advanced"] is False
    tick = game.tick
    for body in (
        {"type": "hint"},
        {"type": "judge", "a": "n2", "b": "n1", "relation": "unsupported"},  # right
        {"type": "judge", "a": "n2", "b": "n1", "relation": "contradicts"},  # not shown
        {"type": "judge", "a": "n9", "b": "n1", "relation": "unsupported"},  # no such note
        {"type": "hint"},
    ):
        out = act(game, body.pop("type"), **body)
        assert out["advanced"] is False and out["clock"] == {"paused": True, "rate": [1, 1]}
        assert game.tick == tick and "debt" not in state_of(game)["clock"]
    assert me(game)["judgments"] != [] and me(game)["talk"]["npc"] == "zhou_huoji"
    assert json.loads(game.step())["advanced"] is False  # and the world is held still


def test_a_judgement_between_two_notes_that_say_different_things_of_a_story_is_right_one_way():
    game = clerk_notes()
    # "at the bridge" does not show that Li Er was looking for a lantern there, nor the reverse
    assert judged(game, "n2", "n3", "unsupported") == ("applied", None)
    assert judged(game, "n3", "n2", "unsupported") == ("rejected", "not_shown")
    # and the lantern search does not show that he broke the rail on purpose
    assert judged(game, "n3", "n1", "unsupported") == ("applied", None)


def test_two_notes_that_cannot_both_be_true_contradict_in_either_order():
    game = slice_game()
    run_to(game, at(1, 10, 40))
    state_of(game)["social"]["next"] = [10**9] * 20
    meet(game, "old_he")
    act(game, "ask", topic="pr_he_under_bridge")  # he says he was at home
    act(game, "leave")
    meet(game, "xiao_man")
    act(game, "ask", topic="pr_he_under_bridge")  # the child saw him under the bridge
    props = [e["prop"] for e in me(game)["notebook"]]
    assert props == ["pr_he_home", "pr_he_under_bridge"]
    assert judged(game, "n1", "n2", "contradicts") == ("applied", None)
    assert judged(game, "n2", "n1", "contradicts") == ("applied", None)
    assert marks(game) == {"n1": ["contradicts"], "n2": ["contradicts"]}
    assert judged(game, "n1", "n2", "unsupported") == ("applied", None)  # nothing shows either


def test_a_retelling_that_is_not_what_the_source_said_is_a_mismatch_the_other_way_is_not():
    game = madam_and_clerk()
    assert [e["prop"] for e in me(game)["notebook"]][:2] == [
        "pr_liner_damaged_jealous",
        "pr_liner_at_bridge",
    ]
    assert judged(game, "n2", "n1", "mismatch") == ("applied", None)  # the madam's is not his
    assert judged(game, "n1", "n2", "mismatch") == ("rejected", "not_shown")
    assert marks(game)["n1"] == ["unsupported", "sourceMismatch"]


# ------------------------------------------------------------ the marks


def test_the_notebook_marks_nothing_but_the_relation_of_the_tutorial_until_it_is_judged():
    game = clerk_notes()
    assert marks(game) == {"n1": ["unsupported"], "n2": [], "n3": []}  # the one the script shows
    assert me(game)["judgments"] == []  # and it is not a judgement of the manager's
    assert judged(game, "n3", "n1", "unsupported") == ("applied", None)
    assert marks(game) == {"n1": ["unsupported"], "n2": [], "n3": []}  # the same mark, said again
    assert judged(game, "n2", "n3", "unsupported") == ("applied", None)
    assert marks(game) == {"n1": ["unsupported"], "n2": [], "n3": ["unsupported"]}


def test_the_relation_of_the_tutorial_is_the_one_in_the_script_and_it_holds():
    (rule,) = SCRIPT["tutorial_relations"]
    assert rule["a"] == ["pr_liner_at_bridge"] and rule["relation"] == "unsupported"
    props, groups = LO.book.props, LO.book.groups
    for a in rule["a"]:
        for b in rule["b"]:
            assert judge.holds(rule["relation"], {"prop": a}, {"prop": b}, props, groups), (a, b)
    assert "pr_liner_damaged" in rule["b"] and "pr_li_damaged_jealous" in rule["b"]


def test_a_note_with_no_partner_for_the_tutorial_has_no_mark():
    game = slice_game()
    run_to(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    act(game, "ask", topic="li_er")
    assert marks(game) == {"n1": []}


# ---------------------------------------------- the right is the same in every story


def twin(game: Game, variant: str) -> Game:
    other = Game.from_snapshot_json(game.snapshot_json())
    state_of(other)["social"]["variant"] = variant
    return other


def verdicts(game: Game) -> list[bool]:
    """Whether every relation holds between every two notes, as the core finds it."""
    world_state = state_of(game)
    props, groups = judge.context(world_state)
    entries = world_state["player"]["notebook"]
    return [
        judge.holds(relation, a, b, props, groups)
        for a in entries
        for b in entries
        for relation in RELATIONS
    ]


def test_whether_a_judgement_holds_does_not_depend_on_which_story_is_true():
    game = clerk_notes()
    base = verdicts(game)
    assert True in base and False in base
    for variant in VARIANTS:
        other = twin(game, variant)
        assert verdicts(other) == base, variant
        assert judged(other, "n2", "n1", "unsupported") == ("applied", None)
        assert judged(other, "n1", "n2", "unsupported") == ("rejected", "not_shown")


def test_the_hint_and_the_marks_do_not_depend_on_which_story_is_true_either():
    game = clerk_notes()
    act(game, "hint")
    for variant in VARIANTS:
        other = twin(game, variant)
        assert frame_now(other)["hint"] == frame_now(game)["hint"]
        assert frame_now(other)["notebook"] == frame_now(game)["notebook"]


# ------------------------------------------------------------ the task


def test_the_lead_that_asks_what_the_words_prove_is_done_by_a_right_judgement_and_not_before():
    game = clerk_notes()
    assert states(frame_now(game))[PROVES] == "open"
    assert judged(game, "n2", "n1", "contradicts") == ("rejected", "not_shown")
    assert states(frame_now(game))[PROVES] == "open"  # the tutorial's mark does not do it
    out = act(game, "judge", a="n2", b="n1", relation="unsupported")
    assert states(out["frame"])[PROVES] == "done"
    assert tasks_of(out["frame"])["t_clear_rumour"]["state"] == "open"  # and the next one comes


def test_a_task_can_wait_for_a_judgement_of_one_relation():
    game = clerk_notes()
    from lantern_core.world.bridge import agenda_terms

    env = agenda_terms.Env(game._kernel.world, state_of(game), None)
    wanted = [{"kind": "judged"}, {"kind": "judged", "relation": "unsupported"}]
    assert not any(agenda_terms.holds(env, cond) for cond in wanted)
    judged(game, "n2", "n1", "unsupported")
    assert all(agenda_terms.holds(env, cond) for cond in wanted)
    assert not agenda_terms.holds(env, {"kind": "judged", "relation": "contradicts"})


# ------------------------------------------------------------ the verbs


def test_judge_and_hint_are_among_the_verbs_once_there_are_two_notes():
    game = slice_game()
    run_to(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    act(game, "ask", topic="li_er")
    assert not {"judge", "hint"} & set(frame_now(game)["hud"]["verbs"])
    out = act(game, "ask", topic="li_er")
    assert {"judge", "hint"} <= set(out["frame"]["hud"]["verbs"])
    act(game, "leave")
    assert {"judge", "hint"} <= set(frame_now(game)["hud"]["verbs"])  # in a talk and out of it


# ------------------------------------------------------------ the hint


def test_a_hint_lights_a_pair_and_asking_again_says_how_they_stand():
    game = clerk_notes()
    assert frame_now(game)["hint"] is None
    first = act(game, "hint")
    assert acks(first) == [("applied", None)]
    lit = first["frame"]["hint"]
    assert set(lit) == {"a", "b"} and lit["a"] != lit["b"]
    second = act(game, "hint")["frame"]["hint"]
    assert second == {**lit, "relation": "unsupported"}
    third = act(game, "hint")["frame"]["hint"]
    assert third == second  # the same pair, as it was


def test_the_hint_goes_down_the_pairs_that_hold_and_leaves_out_the_ones_that_were_judged():
    game = clerk_notes()
    seen = []
    for _ in range(5):
        lit = act(game, "hint")["frame"]["hint"]
        if lit is None:
            break
        lit = act(game, "hint")["frame"]["hint"]  # asked again: how they stand
        pair = (lit["a"], lit["b"], lit["relation"])
        assert pair not in seen
        seen.append(pair)
        assert judged(game, *pair) == ("applied", None)  # it was worth judging
        assert frame_now(game)["hint"] is None  # and a pair that was judged is not hinted at again
    # the first is the one the script shows as a mark, which is a mark and not yet a judgement
    assert seen == [
        ("n2", "n1", "unsupported"),
        ("n2", "n3", "unsupported"),
        ("n3", "n1", "unsupported"),
    ]
    assert act(game, "hint")["frame"]["hint"] is None  # nothing is left to compare


def test_another_relation_of_a_judged_pair_is_still_hinted():
    game = madam_and_clerk()  # the clerk's words and the madam's version: they mismatch and more
    lit = act(game, "hint")["frame"]["hint"]
    assert lit == {"a": "n2", "b": "n1"}  # mismatches come before the notes that go beyond
    assert act(game, "hint")["frame"]["hint"] == {**lit, "relation": "mismatch"}
    assert judged(game, "n2", "n1", "mismatch") == ("applied", None)
    assert frame_now(game)["hint"] is None
    act(game, "hint")
    assert act(game, "hint")["frame"]["hint"] == {"a": "n2", "b": "n1", "relation": "unsupported"}


def test_judging_a_pair_other_than_the_hinted_one_leaves_the_hint_as_it_is():
    game = clerk_notes()
    lit = act(game, "hint")["frame"]["hint"]
    assert lit == {"a": "n2", "b": "n1"}
    assert judged(game, "n3", "n1", "unsupported") == ("applied", None)
    assert frame_now(game)["hint"] == lit  # n2 and n1 are still worth comparing
    assert act(game, "hint")["frame"]["hint"] == {**lit, "relation": "unsupported"}


def test_contradictions_are_hinted_first():
    game = slice_game()
    run_to(game, at(1, 10, 40))
    state_of(game)["social"]["next"] = [10**9] * 20
    meet(game, "old_he")
    act(game, "ask", topic="pr_he_under_bridge")
    act(game, "leave")
    meet(game, "xiao_man")
    act(game, "ask", topic="pr_he_under_bridge")
    act(game, "hint")
    lit = act(game, "hint")["frame"]["hint"]
    assert lit == {"a": "n1", "b": "n2", "relation": "contradicts"}


def test_a_hint_with_nothing_to_compare_lights_nothing_and_is_applied():
    game = slice_game()
    out = act(game, "hint")
    assert acks(out) == [("applied", None)] and out["frame"]["hint"] is None
    assert me(game)["hint"] == []


# ------------------------------------------------------------ F1: the colour of a dot


def colours_in_every_story(game: Game, until: int) -> tuple[set[str], int]:
    """Play on to ``until``. At every moment with a telling in flight, put the game into each of
    the stories in turn and see that its dots are the colours they were. Returns the colours seen
    and the number of moments looked at."""
    seen: set[str] = set()
    moments = 0
    while game.tick < until:
        game.step()
        if game.tick % 3 or not state_of(game)["social"]["talks"]:
            continue
        base = [(d["id"], d["topic"]) for d in frame_now(game)["dots"]]
        for variant in VARIANTS:
            other = Game.from_snapshot_json(game.snapshot_json())
            state_of(other)["social"]["variant"] = variant
            assert [(d["id"], d["topic"]) for d in frame_now(other)["dots"]] == base
        seen |= {topic for _, topic in base}
        moments += 1
    return seen, moments


def test_the_colour_of_a_dot_does_not_change_when_only_the_true_variant_changes():
    seen: set[str] = set()
    for game, until in ((slice_game(), 1900), (bridge(7), 700), (bridge(2015), 1500)):
        colours, moments = colours_in_every_story(game, until)
        assert moments > 5
        seen |= colours
    assert seen == {"blame", "clear", "other"}


def test_the_colour_of_a_dot_is_the_kind_of_thing_that_is_said():
    for pid, prop in LO.book.props.items():
        colour = LO.topic(prop)
        if prop.neg or prop.pred == "flood_damaged":
            assert colour == "clear", pid
        elif prop.pred in ("damaged", "took", "stole", "hid"):
            assert colour == "blame", pid
        else:
            assert colour == "other", pid


# ------------------------------------------------------------ F2: words out of earshot


def telling_in_flight(game: Game) -> tuple[str, str, str]:
    """Run until a bubble is up and return the speaker, the listener and the claim."""
    while True:
        for speaker, until, claim_id in state_of(game)["social"]["bubbles"]:
            if until > game.tick:
                claim = notes.decode_claim(claim_id, state_of(game)["social"]["claims"][claim_id])
                return speaker, claim.listeners[0], claim_id
        game.step()


def sentence_of(game: Game, claim_id: str) -> dict[str, str]:
    social_ = state_of(game)["social"]
    claim = notes.decode_claim(claim_id, social_["claims"][claim_id])
    prop = notebook.view(social_)[claim.prop]
    return dict(
        voices.claim_words(
            prop, claim.modality, claim.claimed_source, claim.speaker, int(claim_id[1:]), claim.tick
        )
    )


def test_a_telling_out_of_earshot_is_a_bubble_without_words():
    game = bridge(2015)
    speaker, listener, claim_id = telling_in_flight(game)
    # the manager stands on the bridge, far from both
    npcs = {n["id"]: n for n in state_of(game)["npcs"]["list"]}
    me_ = me(game)
    far = all(
        max(abs(me_["x"] - npcs[p]["x"]), abs(me_["y"] - npcs[p]["y"])) > 4
        for p in (speaker, listener)
    )
    assert far
    frame = frame_now(game)
    (bubble,) = [b for b in frame["bubbles"] if b["npc"] == speaker]
    assert bubble == {"npc": speaker, "until": bubble["until"], "text": None, "talking": True}
    # the words are nowhere in the frame
    said = sentence_of(game, claim_id)
    dump = json.dumps(frame, ensure_ascii=False)
    assert said["zh"] not in dump and said["en"] not in dump


def test_a_telling_within_hearing_has_its_words_over_the_head_of_the_speaker():
    game = bridge(2015)
    speaker, listener, claim_id = telling_in_flight(game)
    said = sentence_of(game, claim_id)
    npcs = {n["id"]: n for n in state_of(game)["npcs"]["list"]}
    for who in (speaker, listener):  # near either of the two
        put(game, npcs[who]["x"], npcs[who]["y"])
        (bubble,) = [b for b in frame_now(game)["bubbles"] if b["npc"] == speaker]
        assert bubble["text"] == said and "talking" not in bubble
    # four cells away is within hearing and five is not, of the speaker or of the listener
    for who in (speaker, listener):
        for dx, heard in ((4, True), (5, False)):
            put(game, npcs[who]["x"] + dx, npcs[who]["y"])
            others = [p for p in (speaker, listener) if p != who]
            close = any(
                max(abs(me(game)["x"] - npcs[p]["x"]), abs(me(game)["y"] - npcs[p]["y"])) <= 4
                for p in others
            )
            (bubble,) = [b for b in frame_now(game)["bubbles"] if b["npc"] == speaker]
            assert (bubble["text"] is not None) == (heard or close), (who, dx)


def test_what_a_person_says_to_the_manager_in_a_talk_is_always_shown():
    game = slice_game()
    run_to(game, at(1, 12, 20))
    meet(game, "zhou_huoji")
    out = act(game, "ask", topic="li_er")
    (bubble,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "zhou_huoji"]
    assert set(bubble["text"]) == {"zh", "en"} and "talking" not in bubble


def test_a_frame_of_a_whole_day_has_words_only_where_the_manager_could_hear():
    game = bridge(2015)
    seen_far = seen_near = 0
    while game.tick < 2070:
        out = json.loads(game.step())
        frame = out["frame"]
        for speaker, until, claim_id in state_of(game)["social"]["bubbles"]:
            if until <= game.tick:
                continue
            claim = notes.decode_claim(claim_id, state_of(game)["social"]["claims"][claim_id])
            npcs = {n["id"]: n for n in state_of(game)["npcs"]["list"]}
            me_ = me(game)
            hears = any(
                max(abs(me_["x"] - npcs[p]["x"]), abs(me_["y"] - npcs[p]["y"])) <= 4
                for p in (speaker, claim.listeners[0])
            )
            shown = [b for b in frame["bubbles"] if b["npc"] == speaker]
            if shown:
                assert (shown[0]["text"] is not None) == hears
            seen_far += not hears
            seen_near += hears
        if game.tick % 150 == 0:  # the manager walks about the town
            places = ["p_teahouse", "p_market", "p_bridge", "p_temple"]
            door = game._kernel.world.town.places[places[(game.tick // 150) % 4]].door
            put(game, door[0], door[1])
    assert seen_far > 100 and seen_near > 20


# ------------------------------------------------------------ pointing the way


def noon_with(who: str) -> Game:
    game = slice_game()
    run_to(game, at(1, 12, 30))
    meet(game, who)
    return game


def test_a_person_who_knows_nothing_sends_the_manager_to_the_hub_the_script_marks():
    assert SCRIPT["hubs"] == ["cha_laoban"]
    for who in ("zhou_dalang", "li_da", "mujiang", "zhou_erlang"):
        game = noon_with(who)
        out = act(game, "ask", topic="li_xiaomei")
        (asked,) = events(out, "asked")
        assert asked["answer"] == "ignorant" and asked["prop"] is None, who
        assert asked["pointer"] == "cha_laoban", who  # the id of the person the line names
        says_pointing(out, who, "point_hub", "cha_laoban")
        line = me(game)["line"]
        assert line[2:] == ["point", "point_hub", "cha_laoban"]  # the state keeps the code


def test_the_hub_herself_does_not_send_the_manager_to_herself():
    game = noon_with("cha_laoban")
    out = act(game, "ask", topic="li_xiaomei")
    says(out, "cha_laoban", "unknown")
    assert me(game)["line"][2:] == ["text", "unknown", ""]
    assert "pointer" not in events(out, "asked")[0]  # a line that points nowhere names nobody


def test_a_person_sends_the_manager_to_the_one_they_heard_speak_of_it():
    game = noon_with("zhou_erlang")
    heard = Claim(
        "c900", "cha_laoban", ("zhou_erlang",), "pr_liner_looking", "assert", "self_seen",
        game.tick, "belief",
    )  # fmt: skip
    add_telling(game, heard)  # and the second son did not take it in
    state_of(game)["social"]["bubbles"].clear()
    assert "pr_liner_looking" not in state_of(game)["social"]["beliefs"]["zhou_erlang"]
    out = act(game, "ask", topic="t_li_er_lantern")
    assert events(out, "asked")[0]["answer"] == "ignorant"
    assert events(out, "asked")[0]["pointer"] == "cha_laoban"  # the one he heard it from
    says_pointing(out, "zhou_erlang", "point_heard", "cha_laoban")
    assert me(game)["line"][2:] == ["point", "point_heard", "cha_laoban"]


def test_the_latest_telling_about_the_matter_is_the_one_that_is_named():
    game = noon_with("zhou_erlang")
    for number, speaker in ((900, "cha_laoban"), (901, "zhou_huoji"), (902, "old_he")):
        claim = Claim(
            f"c{number}", speaker, ("zhou_erlang",), "pr_liner_looking", "assert", "self_seen",
            game.tick + number, "belief",
        )  # fmt: skip
        add_telling(game, claim)
    assert pointers.heard_from(state_of(game), "zhou_erlang", "t_li_er_lantern") == "old_he"
    assert pointers.heard_from(state_of(game), "zhou_erlang", "pr_liner_looking") == "old_he"
    # the same story told another way is the same matter
    assert pointers.heard_from(state_of(game), "zhou_erlang", "pr_liner_at_bridge") == "old_he"
    assert pointers.heard_from(state_of(game), "zhou_erlang", "t_he_boat") is None


def test_the_one_who_told_them_about_something_else_is_not_named():
    game = noon_with("zhou_erlang")
    add_telling(
        game,
        Claim(
            "c902",
            "old_he",
            ("zhou_erlang",),
            "pr_he_owns_boat",
            "assert",
            "self_seen",
            game.tick,
            "belief",
        ),  # fmt: skip
    )
    assert pointers.heard_from(state_of(game), "zhou_erlang", "t_li_er_lantern") is None
    assert pointers.heard_from(state_of(game), "zhou_erlang", "t_he_boat") == "old_he"
    # and nobody names the one who spoke to them if it was the manager or they spoke it themselves
    assert pointers.heard_from(state_of(game), "old_he", "t_he_boat") is None


def test_someone_who_keeps_something_back_points_nowhere():
    from lantern_core.world.bridge import answers

    game = noon_with("zhou_dalang")
    real = answers.reply

    def evasive(*args, **kwargs):
        return answers.Reply(answers.EVASIVE)

    answers_module = answers
    answers_module.reply = evasive
    try:
        out = act(game, "ask", topic="li_xiaomei")
    finally:
        answers_module.reply = real
    says(out, "zhou_dalang", "evade")
    assert "pointer" not in events(out, "asked")[0]


def test_one_who_pretends_not_to_know_points_as_one_who_does_not():
    """The boatman keeps back what he did, and says he knows nothing of it. He is sent to the same
    place as a man who truly knows nothing, so that the direction does not tell the two apart."""
    pretender = noon_with("old_he")
    out = act(pretender, "ask", topic="pr_boat_damaged")
    (asked,) = events(out, "asked")
    assert (asked["answer"], asked["path"]) == ("ignorant", "ignorance")
    assert asked["pointer"] == "cha_laoban"
    says_pointing(out, "old_he", "point_hub", "cha_laoban")
    honest = noon_with("li_da")
    out = act(honest, "ask", topic="pr_boat_damaged")
    (asked,) = events(out, "asked")
    assert (asked["answer"], asked["path"]) == ("ignorant", "")
    assert asked["pointer"] == "cha_laoban"  # the same event as the pretender's
    says_pointing(out, "li_da", "point_hub", "cha_laoban")


@pytest.mark.parametrize("variant", VARIANTS)
def test_where_a_person_points_does_not_depend_on_which_story_is_true(variant):
    game = noon_with("mujiang")
    other = twin(game, variant)
    ours = act(game, "ask", topic="li_xiaomei")
    theirs = act(other, "ask", topic="li_xiaomei")
    assert ours["frame"]["bubbles"] == theirs["frame"]["bubbles"]
    assert me(game)["line"] == me(other)["line"]
    assert events(ours, "asked")[0]["pointer"] == events(theirs, "asked")[0]["pointer"]


def test_the_line_that_points_survives_a_snapshot_and_is_in_both_languages():
    game = noon_with("shitou")
    silence(game)
    out = act(game, "ask", topic="li_xiaomei")
    (bubble,) = [b for b in out["frame"]["bubbles"] if b["npc"] == "shitou"]
    assert "茶馆老板娘" in bubble["text"]["zh"] and "Teahouse Keeper" in bubble["text"]["en"]
    restored = Game.from_snapshot_json(game.snapshot_json())
    again = [b for b in frame_now(restored)["bubbles"] if b["npc"] == "shitou"]
    assert again == [bubble]


def test_every_person_has_two_ways_of_pointing_in_each_case_and_none_of_them_is_the_plain_one():
    for person in LO.people:
        for code in phrases.NAMED:
            ways = voices.variants(person, code)
            assert len(ways) >= 2
            assert phrases.phrase(code) not in ways
            for way in ways:
                assert way["zh"].count("{name}") == 1 and way["en"].count("{name}") == 1


def test_the_plain_words_of_a_pointer_name_the_person_in_both_languages():
    for code in phrases.NAMED:
        said = phrases.named(phrases.phrase(code), LO.names["li_laotai"])
        assert (
            "李老太" in said["zh"]
            and "Granny Li" in said["en"]
            and "{" not in said["zh"] + said["en"]
        )


# ------------------------------------------------------------------------------ the plain answers


def test_the_answer_that_the_entry_does_not_carry_the_claim_is_unsupported_with_the_claim_second():
    """A page that asks in plain words puts the entry shown first and the claim second: what the
    clerk saw (n2) does not carry that Li Er did it on purpose (n1), and not the other way."""
    game = clerk_notes()
    wrong_way = act(game, "judge", a="n1", b="n2", relation="unsupported")
    assert acks(wrong_way) == [("rejected", "not_shown")]
    assert me(game)["judgments"] == []  # a pair that is turned down is kept nowhere
    held = act(game, "judge", a="n2", b="n1", relation="unsupported")
    assert acks(held) == [("applied", None)]
    (row,) = held["frame"]["judgments"]
    assert (row["a"], row["b"], row["relation"]) == ("n2", "n1", "unsupported")


def test_the_three_relations_are_all_the_core_takes_whatever_the_words_of_the_page():
    game = clerk_notes()
    for relation in ("unsupported", "contradicts", "mismatch"):
        assert relation in judge.RELATIONS
    with pytest.raises(InputError):
        act(game, "judge", a="n2", b="n1", relation="looks_odd")
