"""The signal that the person the manager talks to has said the line that answers an action."""

import pytest
from bridge_helpers import CLEAR, CYCLE, bridge, run_to, step
from dealings_helpers import (
    acks,
    act,
    believe,
    events,
    know,
    me,
    talking,
    tell,
    told_event,
    trust,
)
from player_helpers import Bot, beside, seed_of
from voice_helpers import says

from lantern_core import canon
from lantern_core.world.bridge.sim import Sim

LISTENER = "cha_laoban"
LIE = {"how": "fabricate", "pred": "damaged", "subject": "zhou_dalang", "object": "t_rail"}


def replies(out):
    return events(out, "replied")


def room(who=LISTENER, **config):
    game = talking(who, **config)
    trust(game, who, 40)
    return game


def answered_once(out, who=LISTENER):
    """The call has one reply of ``who``, and it comes before the acknowledgement."""
    (reply,) = replies(out)
    assert reply["npc"] == who and reply["tick"] == out["tick"]
    kinds = [e["kind"] for e in out["events"]]
    assert kinds.index("replied") < kinds.index("action_ack")


# ------------------------------------------------------------------------------ the answers


def test_an_answer_to_a_question_comes_with_the_signal_whatever_the_person_knows():
    game = room()
    topics = step(game)["frame"]["player"]["topics"]
    assert len(topics) > 20
    said = set()
    for topic in topics:
        out = act(game, "ask", topic=topic["id"])
        assert acks(out) == [("applied", None)], topic
        answered_once(out)
        (asked,) = events(out, "asked")
        said.add(asked["answer"])
    assert {"claim", "ignorant"} <= said  # one who tells and one who does not know


def test_asking_for_the_source_is_answered_in_the_same_way():
    game = room()
    entry = know(game, "pr_liner_damaged", "heard", "zhou_zhanggui", hop=2)
    out = act(game, "ask_source", entry=entry["id"])
    assert acks(out) == [("applied", None)]
    answered_once(out)


@pytest.mark.parametrize("how", ["faithful", "as_seen"])
def test_what_the_listener_makes_of_a_telling_is_a_reply(how):
    game = room()
    entry = know(game, "pr_boat_scratched")
    out = tell(game, entry["id"], how)
    assert acks(out) == [("applied", None)] and told_event(out)["outcome"] == "took"
    answered_once(out)


def test_a_promise_made_and_a_promise_kept_are_replied_to_and_so_is_one_that_is_not_believed():
    game = room()
    made = act(game, "promise", what="stall", item="front", amount=0, due=3)
    assert acks(made) == [("applied", None)]
    answered_once(made)
    kept = act(game, "promise", op="keep", id="k1")
    assert acks(kept) == [("applied", None)]
    answered_once(kept)
    empty = act(game, "promise", what="stall", item="middle", amount=0, due=3)
    assert acks(empty) == [("rejected", "empty")]
    answered_once(empty)


def test_an_agreement_and_a_refusal_to_a_request_are_replies():
    game = room("miaozhu", seed=seed_of("v_flood"), hour=9, day=4)
    trust(game, "miaozhu", 30)
    agreed = act(game, "entrust", kind="testify")
    assert acks(agreed) == [("applied", None)]
    answered_once(agreed, "miaozhu")
    said_already = act(game, "entrust", kind="testify")
    assert acks(said_already) == [("rejected", "said_already")]
    answered_once(said_already, "miaozhu")
    game = room("li_laotai")
    refused = act(game, "entrust", kind="lend")
    assert acks(refused) == [("rejected", "hard")]
    answered_once(refused, "li_laotai")


def test_a_witness_with_nothing_to_tell_has_said_so():
    game = room("miaozhu", seed=seed_of("v_boat"), hour=9, day=4)
    trust(game, "miaozhu", 80)
    out = act(game, "entrust", kind="testify")
    assert acks(out) == [("rejected", "nothing_to_say")]
    answered_once(out, "miaozhu")


# ------------------------------------------------------------------------------ the same line again


def test_the_same_line_said_again_is_a_reply_again_so_that_the_line_alone_could_not_say_so():
    game = room()
    first = act(game, "promise", what="stall", item="middle", amount=0, due=3)
    second = act(game, "promise", what="stall", item="middle", amount=0, due=3)
    for out in (first, second):
        assert acks(out) == [("rejected", "empty")]
        answered_once(out)
    assert first["frame"]["bubbles"] == second["frame"]["bubbles"]


# ------------------------------------------------------------------------------ no reply, no signal


def test_an_action_that_nobody_answers_has_no_signal():
    game = room()
    for out in (
        act(game, "ask", topic="no_such_topic"),
        act(game, "ask_source", entry="n99"),
        act(game, "tell", entry="n99", how="faithful"),
        act(game, "promise", op="keep", id="k9"),
        act(game, "entrust", kind="no_such_kind"),
    ):
        assert acks(out)[0][0] == "rejected", acks(out)
        assert replies(out) == []
    act(game, "leave")
    out = act(game, "ask", topic="t_boat")
    assert acks(out) == [("rejected", "not_talking")] and replies(out) == []


def test_a_walk_a_person_who_will_not_talk_and_the_end_of_a_talk_make_no_reply():
    game = bridge(1)
    for _ in range(40):
        assert replies(step(game)) == []
    assert replies(act(game, "move", place="p_teahouse")) == []
    # somebody asleep says so over their head, and there is no talk for them to answer in
    asleep = bridge(1, **CLEAR)
    run_to(asleep, 2)
    beside(asleep, "zhou_dalang")
    out = act(asleep, "talk", npc="zhou_dalang")
    assert acks(out) == [("rejected", "asleep")] and events(out, "declined")
    assert replies(out) == []
    # leaving a talk, and a talk that runs out of time with the person's word that they must go
    game = room()
    assert replies(act(game, "leave")) == []
    game = room()
    out = act(game, "ask", topic="p_bridge")  # the world stands still until an act is paid for
    ended = []
    while me(game)["talk"]:
        out = act(game, "ask", topic="p_bridge") if game.paused else step(game)
        if events(out, "talk_end"):  # the call in which they say that they must go
            ended += replies(out)
    assert ended == [] and any(b["npc"] == LISTENER for b in out["frame"]["bubbles"])


def test_a_lie_that_is_caught_at_once_is_one_reply_and_says_caught():
    game = room()
    believe(game, LISTENER, "pr_boat_damaged", 90, "saw")
    out = tell(game, **LIE)
    assert told_event(out)["outcome"] == "caught"
    answered_once(out)
    says(out, LISTENER, "caught")


# ------------------------------------------------------------------------------ not in the state


def test_the_state_does_not_count_a_signal():
    game = bridge(2)
    outs = Bot().play(game, 2 * CYCLE)
    kinds = [event["kind"] for out in outs for event in out["events"]]
    assert kinds.count("replied") > 5
    assert game._kernel.state["version"] == len(kinds) - kinds.count("replied")


def test_a_game_without_the_signal_is_the_same_game(monkeypatch):
    def play():
        game = bridge(2)
        outs = Bot().play(game, 2 * CYCLE)
        return game, outs

    with_signal, outs = play()
    assert any(e["kind"] == "replied" for out in outs for e in out["events"])
    monkeypatch.setattr(Sim, "signal", lambda self, kind, **fields: None)
    without, quiet = play()
    assert not any(e["kind"] == "replied" for out in quiet for e in out["events"])
    assert without.hash() == with_signal.hash()
    assert canon.dumps_str(without._kernel.state) == canon.dumps_str(with_signal._kernel.state)
    # and what the manager has been told and asked is what it was
    assert me(without)["notebook"] == me(with_signal)["notebook"]
