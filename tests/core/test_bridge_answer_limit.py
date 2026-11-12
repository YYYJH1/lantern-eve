"""How much one answer says: two things at most, about what was asked, and no frame says how many
hands a thing passed through.

The rules of the town answer a question with one thing and, at most, the account somebody else told
them. A model's answer to a question is held to the same, and the source of an entry says what the
teller said of how they know it."""

from __future__ import annotations

import json
from typing import Any

import pytest
from agenda_helpers import frame_now, meet, slice_game
from bridge_helpers import at, run_to
from dealings_helpers import know
from player_helpers import acks, act, events, me
from reply_helpers import Room, Script, belief, say

from lantern_core.cognition.beliefs import SELF_SEEN, UNKNOWN
from lantern_core.world.bridge import notebook, prompts, speech

FORBIDDEN_KEYS = ("hand", "hands", "hop", "hops")


def keys_of(value: Any, path: str = ""):
    """Every key of a frame with the path it is at."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield f"{path}.{key}" if path else key, key
            yield from keys_of(item, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for item in value:
            yield from keys_of(item, f"{path}[]")


# ------------------------------------------------------------------------------ no hands


def frames_of_a_morning():
    game = slice_game()
    run_to(game, at(1, 8))
    seen = [frame_now(game)]
    for who in ("cha_laoban", "zhou_huoji", "li_laotai"):
        meet(game, who)
        seen.append(frame_now(game))
        for topic in ("li_er", "zhou_zhanggui", "old_he", "t_rail"):
            act(game, "ask", topic=topic)
            seen.append(frame_now(game))
        if me(game)["notebook"]:
            act(game, "ask_source", entry=me(game)["notebook"][0]["id"])
            seen.append(frame_now(game))
        act(game, "leave")
    return seen


def test_no_frame_of_a_morning_of_asking_says_how_many_hands_a_thing_passed_through():
    frames = frames_of_a_morning()
    assert sum(len(f["notebook"]) for f in frames) > 6
    for frame in frames:
        for path, key in keys_of(frame):
            assert key not in FORBIDDEN_KEYS, path
        for entry in frame["notebook"]:
            assert set(entry["source"]) <= {"kind", "who", "how", "via"}


def test_a_heard_entry_says_who_told_and_what_they_said_of_how_they_know_it():
    game = slice_game()
    run_to(game, at(1, 8))
    meet(game, "cha_laoban")
    act(game, "ask", topic="li_er")  # the madam: "Zhou's clerk whispered it to me"
    act(game, "ask", topic="old_he")  # and what she saw herself
    source = {e["text"]["zh"]: e["source"] for e in frame_now(game)["notebook"]}
    heard = [s for s in source.values() if s["kind"] == "heard"]
    assert {s["how"] for s in heard} == {"heard", "saw"}
    told_by_another = next(s for s in heard if s["how"] == "heard")
    assert (
        told_by_another["who"]["id"] == "cha_laoban"
        and told_by_another["via"]["id"] == "zhou_huoji"
    )
    saw = next(s for s in heard if s["how"] == "saw")
    assert "via" not in saw


@pytest.mark.parametrize(
    ("claimed", "how", "via"),
    [(SELF_SEEN, "saw", None), (UNKNOWN, "unsure", None), ("cha_laoban", "unsure", None),
     ("zhou_huoji", "heard", "zhou_huoji")],
)  # fmt: skip
def test_the_three_ways_a_teller_can_say_how_they_know_it(claimed, how, via):
    game = slice_game()
    entry = know(game, "pr_liner_damaged", "heard", "cha_laoban", hop=3, claimed=claimed)
    wired = next(e for e in frame_now(game)["notebook"] if e["id"] == entry["id"])
    source = wired["source"]
    assert source["kind"] == "heard" and source["who"]["id"] == "cha_laoban"
    assert source["how"] == how
    assert (source.get("via") or {}).get("id") == via
    assert "hand" not in source


def test_what_the_manager_saw_themselves_is_a_source_of_its_own():
    game = slice_game()
    entry, _ = notebook.add_seen(me(game), "pr_rail_broken", 5)
    wired = next(e for e in frame_now(game)["notebook"] if e["id"] == entry["id"])
    assert wired["source"] == {"kind": "seen"}


def test_the_number_of_hands_stays_in_the_state_for_the_rules_that_read_it():
    game = slice_game()
    entry = know(game, "pr_liner_damaged", "heard", "cha_laoban", hop=5, claimed="zhou_huoji")
    assert notebook.belief_of(entry).hop == 5
    wired = next(e for e in frame_now(game)["notebook"] if e["id"] == entry["id"])
    assert "hand" not in wired["source"]


# ------------------------------------------------------------------------------ the rules' answer


def test_the_rules_answer_a_question_with_one_thing_and_at_most_the_account_somebody_else_told():
    game = slice_game()
    run_to(game, at(1, 9))
    for partner in ("cha_laoban", "zhou_huoji", "zhou_zhanggui", "sishu_xiansheng", "old_he"):
        meet(game, partner)
        topics = [t["id"] for t in frame_now(game)["player"]["topics"] if t["kind"] != "entry"]
        for topic in topics[:3]:
            before = len(me(game)["notebook"]) + len(me(game)["claims"])
            out = act(game, "ask", topic=topic)
            if acks(out) != [("applied", None)]:
                break
            grew = len(me(game)["notebook"]) + len(me(game)["claims"]) - before
            assert 0 <= grew <= 4  # at most the answer and the account, each kept once as heard
            assert len(events(out, "asked")) == 1
            said = [b for b in out["frame"]["bubbles"] if b["npc"] == partner]
            # an account is at most three sentences (who told, what, why): one and at most the other
            assert (
                said and said[0]["text"]["zh"].count("。") + said[0]["text"]["zh"].count("！") <= 6
            )
        act(game, "leave")


# ------------------------------------------------------------------------------ a model's answer


def facts_of(request: dict[str, Any]) -> list[dict[str, Any]]:
    """The facts a request offers the model, with the act that says each."""
    text = request["messages"][1]["content"]
    return [json.loads(line) for line in text.splitlines() if line.startswith('{"id"')]


def acts_of_the_facts(request: dict[str, Any], count: int) -> list[dict[str, str]]:
    return [fact["act"] for fact in facts_of(request)][:count]


def acts_about_the_rail(request: dict[str, Any], count: int) -> list[dict[str, str]]:
    """The first acts of the facts about the rail: all on topic for a question about it."""
    about = [f for f in facts_of(request) if "rail" in f["id"] or "liner" in f["id"]]
    return [fact["act"] for fact in about][:count]


OPENING = {"variant": "v_boat", "opening": "op_li_er_hearsay", "goods": "promised"}


def room_and_request(topic: str, who: str = "cha_laoban"):
    """A talk in the game of the opening, where the rumour about Li Er is going round."""
    room = Room(who, seed=492, **OPENING)
    out = room.act("ask", topic=topic)
    (request,) = out["requests"]
    return room, request


def test_a_question_tells_the_model_to_put_two_acts_at_most_and_only_what_was_asked():
    _, request = room_and_request("li_er")
    note = prompts.ASK_NOTE
    assert note in request["messages"][1]["content"]
    assert "at most 2 acts" in note and "newest" in note and "most important" in note


def test_a_model_that_puts_three_acts_in_an_answer_to_a_question_is_asked_again():
    room, request = room_and_request("t_rail")
    acts = acts_about_the_rail(request, 3)
    assert len(acts) == 3
    out = room.result(request, "ok", say("x", "y", *acts))
    assert not room.answered(out)  # not landed: the gate refused it
    (repair,) = out["requests"]
    assert "too_many_acts" in repair["messages"][-1]["content"]
    assert "at most 2 acts in an answer to a question" in repair["messages"][-1]["content"]
    counts = room.section
    assert counts["errors"] == {"format": 1} and counts["repairs"] == 1


def test_a_model_that_puts_two_acts_about_what_was_asked_lands_both_and_no_more():
    room, request = room_and_request("t_rail")
    acts = acts_about_the_rail(request, 2)
    assert len(acts) == 2, [f["id"] for f in facts_of(request)]
    out = room.result(request, "ok", say("x", "y", *acts))
    (done,) = room.answered(out)
    assert done["result"] == "line" and len(done["claims"]) == 2


def test_a_model_that_answers_a_question_with_something_not_asked_is_refused_and_asked_again():
    room, request = room_and_request("t_rail", who="zhou_zhanggui")
    wrong = belief("pr_flooded", SELF_SEEN)  # the water is up: not a thing about the rail
    out = room.result(request, "ok", say("x", "y", wrong))
    assert not room.answered(out)
    (repair,) = out["requests"]
    assert "off_topic" in repair["messages"][-1]["content"]
    assert room.section["codes"] == {"path:off_topic": 1}


def test_a_second_failure_leaves_the_answer_of_the_rules_where_it_is():
    room, request = room_and_request("t_rail")
    acts = acts_about_the_rail(request, 3)
    out = room.result(request, "ok", say("x", "y", *acts))
    (repair,) = out["requests"]
    out = room.result(repair, "ok", say("x", "y", *acts))
    (done,) = room.answered(out)
    assert done["result"] == "template" and done["cause"] == "check"
    assert room.line()[2] == "claim"  # the answer of the rules is still on show


def test_the_limit_is_for_questions_only_other_verbs_keep_the_three_acts_of_the_contract():
    room = Room("cha_laoban")
    know(room.game, "pr_liner_looking", "heard", "zhou_huoji", hop=2)
    out = room.act("tell", entry=me(room.game)["notebook"][0]["id"], how="faithful")
    (request,) = out["requests"]
    assert prompts.ASK_NOTE not in request["messages"][1]["content"]
    assert speech.prompts.ASK_ACTS == 2


def test_who_told_them_is_a_question_too_and_is_held_to_the_limit():
    room = Room("cha_laoban", seed=492, **OPENING)
    act_out = room.act("ask", topic="li_er")
    (first,) = act_out["requests"]
    room.result(first, "error", "")
    entry = me(room.game)["notebook"][0]["id"]
    out = room.act("ask_source", entry=entry)
    (request,) = out["requests"]
    assert prompts.ASK_NOTE in request["messages"][1]["content"]
    acts = acts_of_the_facts(request, 3)
    if len(acts) == 3:
        out = room.result(request, "ok", say("x", "y", *acts))
        assert not room.answered(out)


def test_the_script_plays_a_model_that_obeys_and_the_notebook_grows_by_two_at_most():
    room, request = room_and_request("li_er")
    script = Script({"ask": [say("x", "y", *acts_of_the_facts(request, 2))]})
    before = len(me(room.game)["notebook"])
    script.play(room, {"requests": [request]})
    assert len(me(room.game)["notebook"]) - before <= 2
